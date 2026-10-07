// KhervePDF's AI tools (khervepdf_get_info, _read_text, _go_to_page,
// _search, _open): names, arguments and descriptions are in
// src/os/ai/appManifest.ts; KhervePDF.tsx registers these with useAppTools.

import { fs, path } from '@/os'
import { drivePath } from '@/os/ai/tools'
import { clipText, waitUntil, type AppTools } from '@/os/ai/appTools'
import type { PdfOutlineItem } from '@/os/services/pdf'
import type { PdfTab } from './model'

export interface PdfAiHost {
  tabs(): PdfTab[]
  /** The tab shown. */
  tab(): PdfTab | null
  open(path: string): Promise<void>
}

function flatOutline(items: PdfOutlineItem[], depth = 0, out: { title: string; page: number | null; level: number }[] = []) {
  for (const it of items) {
    if (out.length >= 80) break
    out.push({ title: it.title, page: it.page === null ? null : it.page + 1, level: depth + 1 })
    if (it.children) flatOutline(it.children, depth + 1, out)
  }
  return out
}

export function khervepdfAiTools(host: PdfAiHost): AppTools {
  const shown = (): PdfTab => {
    const t = host.tab()
    if (!t) throw new Error('No PDF is open in KhervePDF: open one with khervepdf_open.')
    return t
  }
  const pageArg = (t: PdfTab, v: unknown, name: string, fallback: number): number => {
    if (v === undefined || v === null) return fallback
    const n = typeof v === 'number' ? Math.round(v) : NaN
    if (!(n >= 1 && n <= t.pdf.pageCount)) throw new Error(`"${name}" must be a page from 1 to ${t.pdf.pageCount}.`)
    return n
  }

  return {
    async get_info() {
      const t = host.tab()
      const base = { open_tabs: host.tabs().map((x) => (x.path ? path.pretty(x.path) : x.name)) }
      if (!t) return { ...base, shown: null }
      let outline: ReturnType<typeof flatOutline> = []
      try {
        outline = flatOutline(await t.pdf.outline())
      } catch {
        // no outline
      }
      return {
        ...base,
        shown: t.path ? path.pretty(t.path) : t.name,
        pages: t.pdf.pageCount,
        current_page: t.view.page + 1,
        title: t.pdf.metadata.title || null,
        author: t.pdf.metadata.author || null,
        outline,
      }
    },

    async read_text(a) {
      const t = shown()
      const from = pageArg(t, a.from_page, 'from_page', t.view.page + 1)
      const to = pageArg(t, a.to_page, 'to_page', t.pdf.pageCount)
      if (to < from) throw new Error('"to_page" is before "from_page".')
      const max = typeof a.max_chars === 'number' && a.max_chars > 0 ? a.max_chars : 20_000
      let text = ''
      let last = from - 1
      for (let p = from; p <= to && text.length < max; p++) {
        text += `--- page ${p} ---\n${(await t.pdf.pageText(p - 1)).trim()}\n`
        last = p
      }
      return {
        file: t.path ? path.pretty(t.path) : t.name,
        pages_read: `${from}-${last}`,
        pages: t.pdf.pageCount,
        text: clipText(text, max),
        ...(last < to && { more: `Pages ${last + 1}-${to} not read: call again with from_page ${last + 1}.` }),
      }
    },

    async go_to_page(a) {
      const t = shown()
      const p = pageArg(t, a.page, 'page', 1)
      t.goto(p - 1)
      return { page: p, pages: t.pdf.pageCount }
    },

    async search(a) {
      const t = shown()
      const q = String(a.text ?? '').trim()
      if (!q) throw new Error('"text" is empty.')
      const hits = await t.pdf.search(q)
      const pages = hits.filter((h) => h.rects.length).map((h) => ({ page: h.page + 1, matches: h.rects.length }))
      if (pages.length) {
        const r = hits.find((h) => h.rects.length)!.rects[0]
        t.goto(pages[0].page - 1, [r.x, r.y, r.x + r.w, r.y + r.h], true)
      }
      return { text: q, total: pages.reduce((n, p) => n + p.matches, 0), pages: pages.slice(0, 100) }
    },

    async open(a, ctx) {
      const given = String(a.path ?? '').trim()
      if (!given) throw new Error('"path" is empty.')
      const p = drivePath(given)
      if (!fs.isFile(p)) throw new Error(`${path.pretty(p)} is not a file.`)
      if (path.extname(p).toLowerCase() !== '.pdf') throw new Error(`${path.pretty(p)} is not a PDF.`)
      await host.open(p)
      if (!(await waitUntil(() => host.tab()?.path === p, 30_000, ctx.signal))) throw new Error(`${path.pretty(p)} did not open (it may need a password).`)
      return { opened: path.pretty(p), pages: host.tab()!.pdf.pageCount }
    },
  }
}
