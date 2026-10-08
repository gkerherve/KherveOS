// Pages in one continuous editor, the way Word's print layout looks: the
// window draws white pages (with gaps) behind the text, and this plugin pushes
// text down to the next page with spacers — before a block that does not fit,
// or inside a paragraph at the first line that does not fit (so paragraphs
// split across pages), or at a table row. Tab characters get their widths
// from the paragraph's tab stops the same way.
//
// computeLayout() measures the DOM, works out where everything would be
// without the current spacers ("natural" positions), and lays the pages out
// again; the window dispatches the result (meta on layoutKey) when it changed.

import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMNodeT } from '@tiptap/pm/model'

export const layoutKey = new PluginKey<DecorationSet>('kwLayout')

/** Page geometry in CSS pixels (unscaled). */
export interface Geometry {
  paged: boolean
  pageW: number
  pageH: number
  gap: number
  top: number
  bottom: number
  left: number
  right: number
  /** The view's CSS scale (zoom). */
  scale: number
  /** Default tab stops every … px (Word: 1.27 cm). */
  defaultTab: number
}

export interface Spacer {
  pos: number
  h: number
  kind: 'block' | 'inline' | 'after' | 'row'
}

export interface TabWidth {
  pos: number
  w: number
}

export interface FootnoteOnPage {
  page: number
  pos: number
  text: string
}

export interface LayoutResult {
  spacers: Spacer[]
  tabs: TabWidth[]
  pages: number
  /** The page (0-based) where each textblock starts: position → page. */
  blockPages: { pos: number; page: number }[]
  footnotes: FootnoteOnPage[]
  /** Height reserved for footnotes at the bottom of each page (px). */
  reserve: number[]
}

export function emptyLayout(): LayoutResult {
  return { spacers: [], tabs: [], pages: 1, blockPages: [], footnotes: [], reserve: [] }
}

// ------------------------------------------------------------------ the plugin

/** Decorations from a layout result. */
export function layoutDecorations(doc: PMNodeT, r: LayoutResult): DecorationSet {
  const decos: Decoration[] = []
  for (const s of r.spacers) {
    if (s.pos < 0 || s.pos > doc.content.size) continue
    if (s.kind === 'row') {
      const node = doc.nodeAt(s.pos)
      if (!node) continue
      decos.push(Decoration.node(s.pos, s.pos + node.nodeSize, { class: 'kw-rowpush', 'data-kw-push': String(s.h), style: `--kw-push:${s.h}px` }))
      continue
    }
    const h = Math.max(0, Math.round(s.h * 100) / 100)
    const inline = s.kind === 'inline'
    decos.push(
      Decoration.widget(
        s.pos,
        () => {
          const el = document.createElement(inline ? 'span' : 'div')
          el.className = 'kw-spacer'
          el.dataset.kwSpacer = String(h)
          el.style.height = `${h}px`
          el.contentEditable = 'false'
          return el
        },
        { side: inline ? -1 : s.kind === 'after' ? 1 : -1, key: `sp:${s.kind}:${h}`, ignoreSelection: true },
      ),
    )
  }
  for (const t of r.tabs) {
    if (t.pos < 0 || t.pos + 1 > doc.content.size) continue
    decos.push(Decoration.inline(t.pos, t.pos + 1, { class: 'kw-tab', style: `width:${Math.max(1, Math.round(t.w * 10) / 10)}px` }))
  }
  return DecorationSet.create(doc, decos)
}

export function layoutPlugin(onUpdate: (view: EditorView) => void) {
  return new Plugin<DecorationSet>({
    key: layoutKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const meta = tr.getMeta(layoutKey) as LayoutResult | undefined
        if (meta) return layoutDecorations(tr.doc, meta)
        return set.map(tr.mapping, tr.doc)
      },
    },
    props: {
      decorations(state) {
        return layoutKey.getState(state)
      },
    },
    view: (view) => {
      onUpdate(view)
      return { update: (v) => onUpdate(v) }
    },
  })
}

// ------------------------------------------------------------------ measuring

const isList = (n: string) => n === 'bulletList' || n === 'orderedList' || n === 'listItem'

interface Unit {
  pos: number
  node: PMNodeT
  kind: 'text' | 'table' | 'break' | 'block'
}

function units(doc: PMNodeT): Unit[] {
  const out: Unit[] = []
  doc.descendants((node, pos) => {
    const name = node.type.name
    if (name === 'pageBreak') {
      out.push({ pos, node, kind: 'break' })
      return false
    }
    if (name === 'table') {
      out.push({ pos, node, kind: 'table' })
      return false
    }
    if (node.isTextblock) {
      out.push({ pos, node, kind: 'text' })
      return false
    }
    if (node.isBlock && node.isAtom) {
      out.push({ pos, node, kind: 'block' })
      return false
    }
    return true
  })
  return out
}

/** Where a spacer before the node at `pos` goes: before its list item when it opens one (the bullet moves too). */
function spacerPos(doc: PMNodeT, pos: number): number {
  let p = pos
  for (let i = 0; i < 20; i++) {
    const $p = doc.resolve(p)
    if ($p.depth === 0 || $p.index() !== 0 || !isList($p.parent.type.name)) break
    p = $p.before()
  }
  return p
}

export function computeLayout(view: EditorView, g: Geometry): LayoutResult {
  const root = view.dom as HTMLElement
  const rr = root.getBoundingClientRect()
  const s = g.scale || 1
  const Y = (y: number) => (y - rr.top) / s
  const X = (x: number) => (x - rr.left) / s
  const doc = view.state.doc

  // The spacers now on screen, top to bottom.
  const old: { y: number; h: number }[] = []
  root.querySelectorAll<HTMLElement>('[data-kw-spacer]').forEach((el) => old.push({ y: Y(el.getBoundingClientRect().top), h: Number(el.dataset.kwSpacer) || 0 }))
  root.querySelectorAll<HTMLElement>('[data-kw-push]').forEach((el) => old.push({ y: Y(el.getBoundingClientRect().top), h: Number(el.dataset.kwPush) || 0 }))
  old.sort((a, b) => a.y - b.y)
  const natural = (y: number) => {
    let sub = 0
    for (const o of old) {
      if (o.y < y - 0.5) sub += o.h
      else break
    }
    return y - sub
  }
  const coords = (pos: number) => {
    try {
      return view.coordsAtPos(pos, 1)
    } catch {
      return null
    }
  }

  // Tabs: widths from the paragraph's stops (positions measured from the left margin).
  const tabs: TabWidth[] = []
  const contentW = g.pageW - g.left - g.right
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (!node.textContent.includes('\t')) return false
    const stops = (Array.isArray(node.attrs.tabs) ? (node.attrs.tabs as { pos: number; align?: string }[]) : []).map((t) => ({ x: (t.pos * 96) / 72, align: t.align ?? 'left' })).sort((a, b) => a.x - b.x)
    const indentLeft = typeof node.attrs.indentLeft === 'number' ? (node.attrs.indentLeft * 96) / 72 : 0
    const hanging = typeof node.attrs.indentFirst === 'number' && node.attrs.indentFirst < 0
    let lineTop = -1
    let delta = 0
    node.descendants((child, off) => {
      if (!child.isText || !child.text) return
      for (let i = 0; i < child.text.length; i++) {
        if (child.text[i] !== '\t') continue
        const tp = pos + 1 + off + i
        const a = coords(tp)
        const b = coords(tp + 1)
        if (!a || !b) continue
        if (Math.abs(a.top - lineTop) > 2) {
          lineTop = a.top
          delta = 0
        }
        const oldW = b.top === a.top ? (b.left - a.left) / s : 0
        const x = X(a.left) - g.left + delta
        let stop = stops.find((t) => t.x > x + 0.5)
        if (!stop && hanging && x + 0.5 < indentLeft) stop = { x: indentLeft, align: 'left' }
        let w: number
        if (stop && stop.x <= contentW + 1) {
          w = stop.x - x
          if (stop.align === 'right' || stop.align === 'center' || stop.align === 'decimal') {
            // The text after the tab (up to the next tab or the end) ends at / centres on the stop.
            const rest = child.text.slice(i + 1)
            const n = rest.indexOf('\t')
            const endPos = n < 0 ? pos + 1 + off + child.text.length : tp + 1 + n
            const e = coords(endPos)
            const segW = e && e.top === b.top ? (e.left - b.left) / s : 0
            w = stop.align === 'center' ? w - segW / 2 : w - segW
          }
        } else {
          w = (Math.floor(x / g.defaultTab) + 1) * g.defaultTab - x
        }
        w = Math.max(2, w)
        delta += w - oldW
        tabs.push({ pos: tp, w })
      }
    })
    return false
  })

  const empty: LayoutResult = { spacers: [], tabs, pages: 1, blockPages: [], footnotes: [], reserve: [] }
  if (!g.paged) return empty

  const H = g.pageH
  const G = g.gap
  const reserve: number[] = []
  const top = (p: number) => p * (H + G) + g.top
  const bottom = (p: number) => p * (H + G) + H - g.bottom - (reserve[p] ?? 0)
  const spacers: Spacer[] = []
  const blockPages: { pos: number; page: number }[] = []
  const footnotes: FootnoteOnPage[] = []
  let page = 0
  let offset = 0
  const charW = 5.6
  const fnHeight = (text: string) => Math.ceil(Math.max(1, (text.length + 4) * charW) / Math.max(100, contentW)) * 15 + 2

  for (const u of units(doc)) {
    const el = view.nodeDOM(u.pos) as HTMLElement | null
    if (!el || !(el instanceof HTMLElement)) continue
    const r = el.getBoundingClientRect()
    let t = natural(Y(r.top)) + offset
    let b = natural(Y(r.bottom)) + offset

    if (u.kind === 'break') {
      const h = top(page + 1) - b
      if (h > 0) {
        spacers.push({ pos: u.pos + u.node.nodeSize, h, kind: 'after' })
        offset += h
      }
      page++
      continue
    }
    // Something that starts in a gap or a top margin goes to the top of the page.
    if (t < top(page) - 0.5 && page > 0) {
      const h = top(page) - t
      spacers.push({ pos: spacerPos(doc, u.pos), h, kind: 'block' })
      offset += h
      t += h
      b += h
    }
    // Footnotes referenced in this block take room at the bottom of its page.
    const notes: { pos: number; text: string }[] = []
    if (u.kind === 'text') u.node.descendants((n, off) => void (n.type.name === 'footnote' && notes.push({ pos: u.pos + 1 + off, text: String(n.attrs.text ?? '') })))
    const notesH = notes.reduce((sum, n) => sum + fnHeight(n.text), 0)
    const fits = (p: number, y: number) => y <= bottom(p) - (notesH ? notesH + (reserve[p] ? 0 : 14) : 0) + 0.5

    if (!fits(page, b)) {
      if (u.kind === 'text') {
        const start = u.pos + 1
        const end = u.pos + u.node.nodeSize - 1
        let from = start
        for (let guard = 0; guard < 200 && !fits(page, b); guard++) {
          const limit = bottom(page) - offset - (notesH ? notesH + 14 : 0)
          // First position whose line bottom is past the limit.
          let lo = from
          let hi = end
          let q = -1
          while (lo <= hi) {
            const mid = (lo + hi) >> 1
            const c = coords(mid)
            if (c && natural(Y(c.bottom)) > limit + 0.5) {
              q = mid
              hi = mid - 1
            } else lo = mid + 1
          }
          if (q < 0) break
          const lineTop = natural(Y(coords(q)!.top))
          // The first position on that line.
          lo = from
          hi = q
          let ls = q
          while (lo <= hi) {
            const mid = (lo + hi) >> 1
            const c = coords(mid)
            if (c && natural(Y(c.top)) >= lineTop - 1) {
              ls = mid
              hi = mid - 1
            } else lo = mid + 1
          }
          if (ls <= start) {
            // The first line does not fit: the whole paragraph moves (unless it already starts a page).
            if (t <= top(page) + 1) break
            const h = top(page + 1) - t
            spacers.push({ pos: spacerPos(doc, u.pos), h, kind: 'block' })
            offset += h
            t += h
            b += h
            page++
            continue
          }
          const h = top(page + 1) - (lineTop + offset)
          spacers.push({ pos: ls, h, kind: 'inline' })
          offset += h
          b += h
          page++
          from = ls + 1
        }
      } else {
        if (t > top(page) + 1) {
          const h = top(page + 1) - t
          spacers.push({ pos: spacerPos(doc, u.pos), h, kind: 'block' })
          offset += h
          t += h
          b += h
          page++
        }
        if (u.kind === 'table' && !fits(page, b)) {
          // Split the table at its rows.
          const rows = Array.from(el.querySelectorAll<HTMLElement>(':scope > table > tbody > tr'))
          let rowPos = u.pos + 1
          for (let i = 0; i < u.node.childCount && i < rows.length; i++) {
            const row = u.node.child(i)
            const rr2 = rows[i].getBoundingClientRect()
            const rt = natural(Y(rr2.top)) + offset
            const rb = natural(Y(rr2.bottom)) + offset
            if (rb > bottom(page) + 0.5 && rt > top(page) + 1) {
              const h = top(page + 1) - rt
              spacers.push({ pos: rowPos, h, kind: 'row' })
              offset += h
              b += h
              page++
            }
            rowPos += row.nodeSize
          }
        }
      }
      // Taller than a page: it runs on.
      while (b > bottom(page) + 0.5 && page < 2000) page++
    }
    if (u.kind === 'text') blockPages.push({ pos: u.pos, page: pageAt(t) })
    for (const n of notes) {
      reserve[page] = (reserve[page] ?? 14) + fnHeight(n.text)
      footnotes.push({ page, pos: n.pos, text: n.text })
    }
  }
  const lastBottom = (() => {
    const last = root.lastElementChild?.getBoundingClientRect()
    return last ? natural(Y(last.bottom)) + offset : 0
  })()
  const pages = Math.max(page + 1, Math.floor(lastBottom / (H + G)) + 1)
  return { spacers, tabs, pages, blockPages, footnotes, reserve }

  function pageAt(y: number) {
    return Math.max(0, Math.floor((y + 1) / (H + G)))
  }
}

/** Same layout (within half a pixel)? */
export function sameLayout(a: LayoutResult, b: LayoutResult): boolean {
  if (a.pages !== b.pages || a.spacers.length !== b.spacers.length || a.tabs.length !== b.tabs.length || a.footnotes.length !== b.footnotes.length) return false
  for (let i = 0; i < a.spacers.length; i++) {
    const x = a.spacers[i]
    const y = b.spacers[i]
    if (x.pos !== y.pos || x.kind !== y.kind || Math.abs(x.h - y.h) > 0.5) return false
  }
  for (let i = 0; i < a.tabs.length; i++) if (a.tabs[i].pos !== b.tabs[i].pos || Math.abs(a.tabs[i].w - b.tabs[i].w) > 0.5) return false
  for (let i = 0; i < a.footnotes.length; i++) if (a.footnotes[i].page !== b.footnotes[i].page || a.footnotes[i].text !== b.footnotes[i].text) return false
  return true
}
