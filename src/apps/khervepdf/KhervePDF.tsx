// KhervePDF: view, annotate and edit PDFs — a 1:1 port of the desktop KhervePDF
// (PySide6 + PyMuPDF, ../KhervePDF mainwindow.py / pdftab.py) onto the KherveOS
// PDF service (MuPDF.js). Checklist: docs/parity/khervepdf.md.
//
// One PDF per tab. Annotations are edited in memory and written into the file
// when it is saved (untouched ones are kept exactly as they were); page
// operations, text editing, form filling, redaction and bookmarks change the
// document directly. Everything is undoable.

import { useCallback, useEffect, useRef, useState } from 'react'
import { os, fs, path, HOME, type AppProps, type MenuBarMenu, type MenuItem } from '@/os'
import { DRAG_MIME } from '@/os/fileActions'
import { useSettings } from '@/os/settings'
import * as git from '@/os/services/git'
import { openPdf, PdfPasswordError, type PdfAnnot, type PdfOutlineItem, type PdfRect } from '@/os/services/pdf'
import {
  AboutDialog, AuthorDialog, EditTextDialog, FormDialog, HistoryDialog, PrintPreview, RemoteDialog, VERSION,
  type EditTextSpec, type FormSpec, type HistoryRow,
} from './Dialogs'
import { FindBar } from './FindBar'
import { fitTextRect, parsePageRange, rotateAnnot, textWidth } from './geometry'
import { AppMark, Icon, mi, type Glyph } from './icons'
import { fontStyleOf, moveItem, parseZoomText, relativeTo, wordsText, ZOOM_BASE, ZOOM_ITEMS, zoomComboText, type Paragraph } from './logic'
import { newAnnotId, PdfTab, useTab } from './model'
import { PageView, selectAllOnPage, type PageActions } from './PageView'
import { Sidebar } from './Sidebar'
import { INTERVAL_MAX, INTERVAL_MIN, Slideshow, type SlideSettings } from './Slideshow'
import { ToolOptions } from './ToolOptions'
import {
  loadToolSettings, OPTIONS_TOOLS, saveToolSettings, TOOL_BY_ID, TOOLS, toolStatusName, type ToolId, type ToolSetting, type ToolSettings,
} from './tools'
import { useAppTools } from '@/os/ai/appTools'
import { khervepdfAiTools } from './aiTools'
import './khervepdf.css'

const RECENT_KEY = 'khervepdf.recent'
const PREFS_KEY = 'khervepdf.prefs'
const APP_ID = 'khervepdf'

interface Prefs {
  sidebar: boolean
  /** The Document dock on the right of the window. */
  sideRight: boolean
  slide: SlideSettings
  /** Help ▸ Check for Updates Automatically. */
  autoUpdate: boolean
}

function loadPrefs(): Prefs {
  const d: Prefs = { sidebar: true, sideRight: false, slide: { continuous: false, seconds: 5, loop: true }, autoUpdate: true }
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    return { ...d, ...p, slide: { ...d.slide, ...(p.slide ?? {}) } }
  } catch {
    return d
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* private mode */
  }
}

function loadRecent(): string[] {
  try {
    const r = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function storeRecent(list: string[]): string[] {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    /* private mode */
  }
  return list
}

const pushRecent = (p: string) => storeRecent([p, ...loadRecent().filter((x) => x !== p)].slice(0, 10))

/** A blank one-page A4 PDF (MainWindow._new: 595 × 842). */
function blankPdf(w = 595, h = 842): Uint8Array {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << >> /Contents 4 0 R >>`,
    '<< /Length 0 >>\nstream\n\nendstream',
  ]
  let out = '%PDF-1.7\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

const stem = (name: string) => name.replace(/\.pdf$/i, '')
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const kb = (n: number) => `${Math.round(n / 1024)} KB`
const dirOf = (t: PdfTab) => (t.path ? path.dirname(t.path) : `${HOME}/Documents`)

/** PNG or JPEG bytes (other formats are converted) and the picture's size. */
async function pdfImage(bytes: Uint8Array): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart]))
  const { width, height } = bmp
  const png = bytes[0] === 0x89 && bytes[1] === 0x50
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8
  if (png || jpg) {
    bmp.close()
    return { bytes, width, height }
  }
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  c.getContext('2d')?.drawImage(bmp, 0, 0)
  bmp.close()
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'))
  if (!blob) throw new Error('Could not read the picture.')
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height }
}

type Dialog =
  | { kind: 'about' }
  | { kind: 'author' }
  | { kind: 'preview'; tab: PdfTab }
  | { kind: 'history'; tab: PdfTab; root: string }
  | { kind: 'remote'; tab: PdfTab; root: string; url: string }

// --------------------------------------------------------------------- app

export default function KhervePDF({ win, args }: AppProps) {
  const [tabs, setTabs] = useState<PdfTab[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [tool, setToolState] = useState<ToolId>('hand')
  const [settings, setSettings] = useState<ToolSettings>(loadToolSettings)
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const [find, setFind] = useState<{ focusKey: number } | null>(null)
  const [show, setShow] = useState<{ start: number; fullscreen: boolean } | null>(null)
  const [options, setOptions] = useState<{ left: number; top: number } | null>(null)
  const [status, setStatusText] = useState('')
  const [opening, setOpening] = useState<string | null>(null)
  const [form, setForm] = useState<FormSpec | null>(null)
  const [editText, setEditText] = useState<EditTextSpec | null>(null)
  const [marker, setMarker] = useState<{ page: number; rect: PdfRect } | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [dropping, setDropping] = useState(false)
  const [zoomText, setZoomText] = useState<string | null>(null)
  const light = useSettings((s) => s.lightApps.includes(APP_ID))
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const tab = tabs.find((t) => t.key === activeKey) ?? null
  useTab(tab)

  const live = useRef({ tabs, tab, tool, settings })
  live.current = { tabs, tab, tool, settings }

  /** statusBar().showMessage(msg, ms) */
  const setStatus = useCallback((msg: string, ms = 4000) => {
    setStatusText(msg)
    if (statusTimer.current) clearTimeout(statusTimer.current)
    statusTimer.current = setTimeout(() => setStatusText(''), ms)
  }, [])

  const setPrefs = (p: Partial<Prefs>) =>
    setPrefsState((old) => {
      const next = { ...old, ...p }
      savePrefs(next)
      return next
    })

  /** MainWindow._activate_tool */
  const setTool = (t: ToolId) => {
    setToolState(t)
    if (t !== 'select') tab?.selected.size && tab.select([])
    if (t !== 'select_text' && t !== 'select' && t !== 'hand') tab?.textSel && tab.setTextSel(null)
  }

  const updateSetting = (id: ToolId, s: ToolSetting) =>
    setSettings((old) => {
      const next = { ...old, [id]: s }
      saveToolSettings(next)
      return next
    })

  const ask = (spec: Omit<FormSpec, 'resolve'>) => new Promise<Record<string, string> | null>((resolve) => setForm({ ...spec, resolve }))

  const fail = (title: string, e: unknown) => void os.dialog.alert(errText(e), { title })

  const setLight = (on: boolean) => {
    const s = useSettings.getState()
    const others = s.lightApps.filter((a) => a !== APP_ID)
    s.set({ lightApps: on ? [...others, APP_ID] : others })
  }

  // ------------------------------------------------------------- git

  const rootOf = (t: PdfTab) => (t.path ? git.findRoot(path.dirname(t.path)) : null)

  const refreshBranch = async (t: PdfTab) => {
    const root = rootOf(t)
    let b: string | null = null
    try {
      b = root ? await git.currentBranch(root) : null
    } catch {
      b = null
    }
    if (b !== t.branch) {
      t.branch = b
      t.emit()
    }
  }

  /**
   * git_backend.commit_file: stage the PDF and commit. `create` makes a
   * repository in the PDF's folder first when there is none (Git ▸ Commit Now).
   */
  const commitFile = async (t: PdfTab, message: string, create: boolean): Promise<boolean> => {
    if (!t.path) return false
    let root = rootOf(t)
    if (!root) {
      if (!create) return false
      root = path.dirname(t.path)
      await git.init(root, { defaultBranch: 'dev' })
    }
    const rel = relativeTo(root, t.path)
    if (!rel) return false
    await git.add(root, rel)
    const author = (await git.resolveIdentity(root)) ?? { name: 'KhervePDF', email: 'khervepdf@local' }
    await git.commit(root, { message, author })
    void refreshBranch(t)
    return true
  }

  // ------------------------------------------------------------- opening

  const addTab = (t: PdfTab) => {
    setTabs((old) => [...old, t])
    setActiveKey(t.key)
    void refreshBranch(t)
  }

  const openBytes = async (bytes: Uint8Array, filePath: string | null, name: string): Promise<PdfTab | null> => {
    let password = ''
    for (;;) {
      try {
        const pdf = await openPdf(bytes, { password })
        try {
          const annots = await pdf.detachAnnotations()
          return new PdfTab(pdf, annots, filePath, name)
        } catch (e) {
          pdf.close()
          throw e
        }
      } catch (e) {
        if (!(e instanceof PdfPasswordError)) throw e
        const r = await ask({
          title: 'Password required',
          message: e.wrongPassword ? `That password is not correct for “${name}”.` : `“${name}” is protected by a password.`,
          fields: [{ key: 'pw', label: 'Password:', value: '', type: 'password' }],
          ok: 'Open',
        })
        if (!r) return null
        password = r.pw
      }
    }
  }

  const openingPaths = useRef(new Set<string>())
  /** MainWindow.open_path (a PDF already open comes to the front, as open_request does). */
  const openPath = async (p: string) => {
    const have = live.current.tabs.find((t) => t.path === p)
    if (have) return setActiveKey(have.key)
    if (openingPaths.current.has(p)) return
    openingPaths.current.add(p)
    const name = path.basename(p)
    setOpening(`Opening ${name}…`)
    try {
      const bytes = await fs.readBytes(p)
      const t = await openBytes(bytes, p, name)
      if (!t) return
      addTab(t)
      setRecent(pushRecent(p))
    } catch (e) {
      void os.dialog.alert(<>Could not open <b>{name}</b>:<br />{errText(e)}</>, { title: 'Open failed' })
    } finally {
      openingPaths.current.delete(p)
      setOpening(null)
    }
  }

  const openDialog = async () => {
    const p = await os.dialog.openFile({ title: 'Open PDF', startDir: tab ? dirOf(tab) : `${HOME}/Documents`, extensions: ['.pdf'] })
    if (p) await openPath(p)
  }

  /** MainWindow._new: a blank A4 page, named with Save As (not added to Recent). */
  const newDoc = async () => {
    try {
      const t = await openBytes(blankPdf(), null, 'Untitled.pdf')
      if (t) addTab(t)
    } catch (e) {
      fail('New', e)
    }
  }

  // AI tools (khervepdf_get_info, _read_text…: src/os/ai/appManifest.ts).
  useAppTools(win, khervepdfAiTools({ tabs: () => live.current.tabs, tab: () => live.current.tab, open: (p) => openPath(p) }))

  // Open the file the window was started with (and later ones handed to it).
  useEffect(() => {
    if (typeof args.path === 'string' && args.path) void openPath(args.path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args])

  // Close every document when the window goes.
  useEffect(() => () => live.current.tabs.forEach((t) => t.close()), [])
  useEffect(() => () => win.setMenus(null), [win])

  // Follow renames of open files.
  useEffect(
    () =>
      fs.watch((ev) => {
        if (ev.type !== 'rename') return
        for (const t of live.current.tabs) {
          if (t.path && path.isInside(t.path, ev.oldPath)) {
            const np = ev.path + t.path.slice(ev.oldPath.length)
            t.path = np
            t.name = path.basename(np)
            t.emit()
          }
        }
      }),
    [],
  )

  // ------------------------------------------------------------- saving

  /** MainWindow._save / _save_as (+ the commit when the folder is a Git repository). */
  const saveTab = async (t: PdfTab, as = false): Promise<boolean> => {
    let target = t.path
    if (as || !target || !fs.exists(path.dirname(target))) {
      target = await os.dialog.saveFile({ title: 'Save PDF As', defaultName: t.path ?? `${HOME}/Documents/${t.name}`, extensions: ['.pdf'] })
      if (!target) return false
    }
    try {
      const bytes = await t.bytes()
      await fs.writeBytes(target, bytes)
      t.markSaved(target, path.basename(target))
      setRecent(pushRecent(target))
      let committed = false
      try {
        committed = await commitFile(t, `Save ${t.name}`, false)
      } catch {
        committed = false
      }
      setStatus(`Saved ${path.pretty(target)}${committed ? ' · committed to git' : ''}`)
      return true
    } catch (e) {
      void os.dialog.alert(<>Could not save:<br />{errText(e)}</>, { title: 'Save failed' })
      return false
    }
  }

  const download = async (t: PdfTab) => {
    try {
      const bytes = await t.bytes()
      os.downloadBlob(t.name.toLowerCase().endsWith('.pdf') ? t.name : `${t.name}.pdf`, new Blob([bytes as BlobPart], { type: 'application/pdf' }))
    } catch (e) {
      fail('Download', e)
    }
  }

  const askSave = async (dirty: PdfTab[]): Promise<boolean> => {
    if (!dirty.length) return true
    const msg = dirty.length === 1
      ? `Save the changes to “${dirty[0].name}” before closing?`
      : `${dirty.length} documents have unsaved changes. Save them before closing?`
    const choice = await os.dialog.choose(msg, [
      { label: 'Cancel', value: 'cancel' },
      { label: "Don't save", value: 'discard', danger: true },
      { label: dirty.length === 1 ? 'Save' : 'Save all', value: 'save', primary: true },
    ], { title: 'Unsaved changes' })
    if (choice === 'discard') return true
    if (choice !== 'save') return false
    for (const t of dirty) {
      setActiveKey(t.key)
      if (!(await saveTab(t))) return false
    }
    return true
  }

  const dropTab = (t: PdfTab) => {
    if (show && t === live.current.tab) setShow(null)
    t.close()
    setTabs((old) => {
      const i = old.indexOf(t)
      const rest = old.filter((x) => x !== t)
      setActiveKey((k) => (k === t.key ? (rest[Math.min(i, rest.length - 1)]?.key ?? null) : k))
      return rest
    })
  }

  const closeTab = async (t: PdfTab) => {
    if (t.dirty && !(await askSave([t]))) return
    dropTab(t)
  }

  /** _DetachableTabBar._detach_tab: the PDF opens in a new KhervePDF window and leaves this one. */
  const detachTab = async (t: PdfTab) => {
    if (t.dirty && !(await askSave([t]))) return
    if (!t.path) {
      void os.dialog.alert('Save the document first to open it in a new window.', { title: 'Open in new window' })
      return
    }
    os.open(APP_ID, { path: t.path, newWindow: true })
    dropTab(t)
  }

  // Ask before the window closes with unsaved changes.
  useEffect(() => {
    win.setCloseGuard(() => askSave(live.current.tabs.filter((t) => t.dirty)))
    return () => win.setCloseGuard(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win])

  // MainWindow._update_title: "KhervePDF v0.75 — file.pdf".
  useEffect(() => {
    win.setTitle(`KhervePDF v${VERSION} — ${tab ? tab.name : 'Untitled'}`)
  })
  useEffect(() => win.setDocumentPath(tab?.path ?? null), [win, tab, tab?.path])

  // --------------------------------------------------------- page actions

  const shiftFrom = (annots: PdfAnnot[], from: number, delta: number) => annots.map((a) => (a.page >= from ? { ...a, page: a.page + delta } : a))

  const run = async <T,>(title: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn()
    } catch (e) {
      fail(title, e)
      return undefined
    }
  }

  /** Pages ▸ Insert Blank Page: after the current page, its size. */
  const insertBlank = (t: PdfTab, after = t.view.page) =>
    run('Insert page', async () => {
      const ref = t.pdf.pages[after] ?? t.pdf.pages[0]
      const at = after + 1
      await t.docOp('Insert page', () => t.pdf.insertBlankPage(at, { width: ref.width, height: ref.height }), (an) => shiftFrom(an, at, 1))
      t.goto(at)
    })

  const deletePages = async (t: PdfTab, pages: number[]) => {
    const n = t.pdf.pageCount
    if (pages.length >= n) return void os.dialog.alert('Cannot delete the last page.', { title: 'Delete page' })
    const ok = await os.dialog.confirm(pages.length === 1 ? `Delete page ${pages[0] + 1} of ${n}?` : `Delete ${pages.length} pages?`, {
      title: 'Delete page', okLabel: 'Yes', danger: true,
    })
    if (!ok) return
    const gone = new Set(pages)
    await run('Delete page', () =>
      t.docOp('Delete page', () => t.pdf.deletePages(pages), (an) =>
        an.filter((a) => !gone.has(a.page)).map((a) => ({ ...a, page: a.page - pages.filter((p) => p < a.page).length })),
      ),
    )
  }

  const rotatePages = (t: PdfTab, pages: number[], delta: number) => {
    const before = t.pdf.pages.slice()
    const set = new Set(pages)
    return run('Rotate', () =>
      t.docOp(delta > 0 ? 'Rotate right' : 'Rotate left', () => t.pdf.rotatePages(pages, delta), (an) =>
        an.map((a) => (set.has(a.page) ? rotateAnnot(a, delta, before[a.page]) : a)),
      ),
    )
  }

  const movePage = (t: PdfTab, from: number, to: number) => {
    const order = t.pdf.pages.map((_, i) => i)
    const [moved] = order.splice(from, 1)
    order.splice(Math.max(0, Math.min(to, order.length)), 0, moved)
    const where = new Map(order.map((old, i) => [old, i]))
    return run('Reorder', async () => {
      await t.docOp('Move page', () => t.pdf.rearrangePages(order), (an) => an.map((a) => ({ ...a, page: where.get(a.page) ?? a.page })))
      t.goto(where.get(from) ?? to)
    })
  }

  /** Pages ▸ Merge PDF(s)…: inserted after the current page. */
  const mergePdf = async (t: PdfTab) => {
    const p = await os.dialog.openFile({ title: 'Choose PDF(s) to insert after the current page', startDir: dirOf(t), extensions: ['.pdf'] })
    if (!p) return
    const at = t.view.page + 1
    await run('Merge', async () => {
      const bytes = await fs.readBytes(p)
      let password = ''
      for (;;) {
        try {
          await t.docOp(`Insert ${path.basename(p)}`, () => t.pdf.insertPdf(bytes, at, { password, detach: true }), (an, res) => [
            ...shiftFrom(an, at, res.count),
            ...res.annotations.map((a) => ({ ...a, id: newAnnotId() })),
          ])
          setStatus('Merged 1 PDF(s)')
          t.goto(at)
          return
        } catch (e) {
          if (!(e instanceof PdfPasswordError)) throw e
          const f = await ask({ title: 'Password required', message: `“${path.basename(p)}” is protected by a password.`, fields: [{ key: 'pw', label: 'Password:', value: '', type: 'password' }], ok: 'Insert' })
          if (!f) return
          password = f.pw
        }
      }
    })
  }

  const writeUnique = async (dir: string, name: string, bytes: Uint8Array) => {
    const target = path.join(dir, fs.uniqueName(dir, name))
    await fs.writeBytes(target, bytes)
    return target
  }

  const splitPdf = async (t: PdfTab) => {
    const dir = await os.dialog.pickFolder({ title: 'Choose a folder to write the split PDFs into', startDir: dirOf(t) })
    if (!dir) return
    await run('Split', async () => {
      const n = t.pdf.pageCount
      const width = String(n).length
      for (let i = 0; i < n; i += 20) {
        const groups = [...Array(Math.min(20, n - i)).keys()].map((k) => [i + k])
        const files = await t.pdf.extractPages(groups, { annotations: t.annots })
        for (let k = 0; k < files.length; k++) await writeUnique(dir, `${stem(t.name)}_p${String(i + k + 1).padStart(width, '0')}.pdf`, files[k])
      }
      setStatus(`Wrote ${n} file(s) to ${path.pretty(dir)}`)
    })
  }

  const extractPages = async (t: PdfTab) => {
    const n = t.pdf.pageCount
    const r = await ask({
      title: 'Extract pages',
      message: `Pages to extract (1–${n}). Comma-separated, ranges allowed — e.g. <code>1, 3-5, 9</code>:`,
      fields: [{ key: 'range', label: 'Pages:', value: `1-${n}` }],
    })
    if (!r || !r.range.trim()) return
    const pages = parsePageRange(r.range, n)
    if (!pages.length) return void os.dialog.alert("Couldn't parse that page range.", { title: 'Extract' })
    const target = await os.dialog.saveFile({ title: 'Save extracted PDF as', defaultName: `${dirOf(t)}/${stem(t.name)}_pages.pdf`, extensions: ['.pdf'] })
    if (!target) return
    await run('Extract', async () => {
      const [bytes] = await t.pdf.extractPages([pages], { annotations: t.annots })
      await fs.writeBytes(target, bytes)
      setStatus(`Extracted ${pages.length} page(s) to ${path.pretty(target)}`)
    })
  }

  /** Pages ▸ Watermark every page… (Text, Size 20–200 pt; grey, diagonal). */
  const watermark = async (t: PdfTab) => {
    const r = await ask({
      title: 'Watermark every page',
      fields: [
        { key: 'text', label: 'Text:', value: 'DRAFT' },
        { key: 'size', label: 'Size:', value: '72', type: 'number', min: 20, max: 200, suffix: 'pt' },
      ],
    })
    if (!r || !r.text.trim()) return
    const size = Math.max(20, Math.min(200, Number(r.size) || 72))
    await run('Watermark', async () => {
      await t.docOp('Watermark', () => t.pdf.stampText({ text: r.text.trim(), position: 'diagonal', size, color: '#b3b3b3' }))
      setStatus(`Watermarked ${t.pdf.pageCount} page(s)`)
    })
  }

  /** Pages ▸ Number every page…: "N / total" at the bottom centre. */
  const numberPages = (t: PdfTab) =>
    run('Number pages', async () => {
      await t.docOp('Number pages', () => t.pdf.stampText({ text: '{n} / {total}', position: 'bottom', size: 10, color: '#333333', margin: 24 }))
      setStatus(`Numbered ${t.pdf.pageCount} page(s)`)
    })

  const applyRedactions = async (t: PdfTab) => {
    const marks = t.annots.filter((a) => a.kind === 'redact' && a.rect)
    if (!marks.length) {
      setTool('redact')
      return void os.dialog.alert('First mark the areas to black out with the Redact tool, then apply the redactions.', { title: 'Redact' })
    }
    const ok = await os.dialog.confirm(
      `Black out ${marks.length} marked area${marks.length === 1 ? '' : 's'}? The text, pictures and drawings underneath are removed from the document for good once it is saved.`,
      { title: 'Apply redactions', okLabel: 'Redact', danger: true },
    )
    if (!ok) return
    await run('Redact', () =>
      t.docOp('Redact', () => t.pdf.applyRedactions(marks.map((m) => ({ page: m.page, rect: m.rect! }))), (an) => an.filter((a) => a.kind !== 'redact')),
    )
  }

  /** MainWindow._place_qimage: at most 60 % of the page, centred, on the current page. */
  const insertImageBytes = async (t: PdfTab, raw: Uint8Array) => {
    const img = await pdfImage(raw)
    const page = t.view.page
    const info = t.pdf.pages[page]
    let w = Math.min(img.width, info.width * 0.6)
    let h = (img.height * w) / Math.max(1, img.width)
    if (h > info.height * 0.6) {
      h = info.height * 0.6
      w = (img.width * h) / Math.max(1, img.height)
    }
    const x = info.x + (info.width - w) / 2
    const y = info.y + (info.height - h) / 2
    const a: PdfAnnot = { id: newAnnotId(), kind: 'image', page, color: '#000000', opacity: 1, width: 1, rect: [x, y, x + w, y + h], image: img.bytes }
    t.setAnnots([...t.annots, a], 'Insert image')
  }

  const insertImage = async (t: PdfTab) => {
    const p = await os.dialog.openFile({ title: 'Insert image', startDir: dirOf(t), extensions: ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.tif', '.tiff', '.webp'] })
    if (!p) return
    await run('Insert image', async () => insertImageBytes(t, await fs.readBytes(p)))
  }

  const editOutline = (t: PdfTab, items: PdfOutlineItem[]) =>
    run('Bookmarks', async () => {
      await t.docOp('Edit bookmarks', () => t.pdf.setOutline(items))
      t.outlineCache = null
      t.emit()
    })

  const properties = async (t: PdfTab) => {
    const m = t.pdf.metadata
    const r = await ask({
      title: 'Document properties',
      fields: [
        { key: 'title', label: 'Title:', value: m.title ?? '' },
        { key: 'author', label: 'Author:', value: m.author ?? '' },
        { key: 'subject', label: 'Subject:', value: m.subject ?? '' },
        { key: 'keywords', label: 'Keywords:', value: m.keywords ?? '' },
      ],
      hint: [m.creator && `Created with ${m.creator}`, m.producer && `PDF by ${m.producer}`, m.creationDate && new Date(m.creationDate).toLocaleString()].filter(Boolean).join(' · ') || undefined,
    })
    if (!r) return
    await run('Document properties', () => t.docOp('Document properties', () => t.pdf.setMetadata(r)))
  }

  /** File ▸ Export Text…: every page's text, pages separated by a form feed. */
  const exportText = async (t: PdfTab) => {
    const target = await os.dialog.saveFile({ title: 'Export text', defaultName: `${dirOf(t)}/${stem(t.name)}.txt`, extensions: ['.txt'] })
    if (!target) return
    await run('Export text', async () => {
      const parts: string[] = []
      for (let i = 0; i < t.pdf.pageCount; i++) parts.push(await t.pdf.pageText(i))
      await fs.writeText(target, parts.join('\f'))
      setStatus(`Wrote text of ${parts.length} page(s) to ${path.pretty(target)}`)
    })
  }

  /** File ▸ Export pages as PNG / JPEG… (Format, Resolution 36–600 dpi, Pages, then a folder). */
  const exportImages = async (t: PdfTab) => {
    const n = t.pdf.pageCount
    const r = await ask({
      title: 'Export pages as images',
      fields: [
        { key: 'format', label: 'Format:', value: 'png', type: 'radio', options: [['png', 'PNG (lossless)'], ['jpeg', 'JPEG (smaller)']] },
        { key: 'dpi', label: 'Resolution:', value: '150', type: 'number', min: 36, max: 600, step: 36, suffix: 'dpi' },
        { key: 'range', label: 'Pages:', value: `1-${n}` },
      ],
    })
    if (!r) return
    const pages = parsePageRange(r.range, n)
    if (!pages.length) return void os.dialog.alert("Couldn't parse that page range.", { title: 'Export images' })
    const dir = await os.dialog.pickFolder({ title: 'Choose output directory', startDir: dirOf(t) })
    if (!dir) return
    const format = r.format === 'jpeg' ? 'jpeg' : 'png'
    const dpi = Math.max(36, Math.min(600, Number(r.dpi) || 150))
    const width = String(n).length
    let written = 0
    await run('Export images', async () => {
      for (let i = 0; i < pages.length; i += 8) {
        const chunk = pages.slice(i, i + 8)
        const files = await t.pdf.exportImages(chunk, { dpi, format, annotations: t.annots })
        for (let k = 0; k < files.length; k++) {
          await writeUnique(dir, `${stem(t.name)}_p${String(chunk[k] + 1).padStart(width, '0')}.${format === 'png' ? 'png' : 'jpg'}`, files[k])
          written++
        }
      }
    })
    setStatus(`Wrote ${written} image(s) to ${path.pretty(dir)}`)
  }

  /** File ▸ Compress / shrink…: a recompressed copy, sizes before → after. */
  const compressedCopy = async (t: PdfTab) => {
    const target = await os.dialog.saveFile({ title: 'Save compressed PDF as', defaultName: `${dirOf(t)}/${stem(t.name)}_compressed.pdf`, extensions: ['.pdf'] })
    if (!target) return
    await run('Compress', async () => {
      const before = t.path ? (fs.stat(t.path)?.size ?? 0) : 0
      const bytes = await t.bytes({ compact: true })
      await fs.writeBytes(target, bytes)
      const pct = before ? (1 - bytes.length / before) * 100 : 0
      setStatus(before ? `Compressed: ${kb(before)} → ${kb(bytes.length)} (${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%)` : `Saved compressed copy to ${path.pretty(target)}`, 6000)
    })
  }

  /** File ▸ Encrypt / password protect… (AES-256). */
  const encryptedCopy = async (t: PdfTab) => {
    const r = await ask({
      title: 'Encrypt PDF',
      fields: [
        { key: 'user', label: 'User password (open):', value: '', type: 'password' },
        { key: 'owner', label: 'Owner password (edit):', value: '', type: 'password' },
      ],
      hint: "Leave a field empty to skip that level. At least one is required. AES-256 used; readers without the user password won't see the document at all.",
    })
    if (!r) return
    if (!r.user && !r.owner) return void os.dialog.alert('Need at least one password.', { title: 'Encrypt' })
    const target = await os.dialog.saveFile({ title: 'Save encrypted PDF as', defaultName: `${dirOf(t)}/${stem(t.name)}_encrypted.pdf`, extensions: ['.pdf'] })
    if (!target) return
    await run('Encrypt', async () => {
      await fs.writeBytes(target, await t.bytes({ encrypt: { userPassword: r.user, ownerPassword: r.owner || r.user } }))
      setStatus(`Saved encrypted PDF to ${path.pretty(target)}`, 5000)
    })
  }

  /** File ▸ Digitally sign (PKCS#12)…: the desktop's dialog; signing itself needs pyHanko. */
  const digitallySign = async () => {
    const r = await ask({
      title: 'Digitally sign PDF',
      fields: [
        {
          key: 'p12', label: 'Certificate:', value: '', type: 'file', placeholder: 'Path to .p12 / .pfx file',
          browse: () => os.dialog.openFile({ title: 'Pick certificate', startDir: `${HOME}/Documents`, extensions: ['.p12', '.pfx'] }),
        },
        { key: 'pw', label: 'Password:', value: '', type: 'password' },
        { key: 'reason', label: 'Reason:', value: '', placeholder: 'e.g. Approval, Reviewed' },
        { key: 'location', label: 'Location:', value: '', placeholder: 'e.g. Imperial College London' },
        { key: 'contact', label: 'Contact:', value: '', placeholder: 'e.g. e-mail' },
      ],
    })
    if (!r) return
    if (!r.p12) return void os.dialog.alert('Need a certificate.', { title: 'Sign' })
    void os.dialog.alert(
      'Cryptographic (PKCS#7) signatures are not in the web edition yet: the desktop signs with pyHanko, which has no browser version. Use the Signature tool to stamp a drawn signature.',
      { title: 'Digital signature' },
    )
  }

  /** The browser's print dialog from a hidden frame (File ▸ Print… → the OS printer dialog). */
  const print = async (t: PdfTab) => {
    await run('Print', async () => {
      const bytes = await t.bytes()
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
      const frame = document.createElement('iframe')
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
      frame.src = url
      frame.onload = () => {
        try {
          frame.contentWindow?.focus()
          frame.contentWindow?.print()
          setStatus('Sent to the print dialog')
        } catch {
          os.downloadBlob(`${stem(t.name)}.pdf`, new Blob([bytes as BlobPart], { type: 'application/pdf' }))
          setStatus('This browser can’t print from KherveOS: the PDF was downloaded, print it from there')
        }
        window.setTimeout(() => {
          frame.remove()
          URL.revokeObjectURL(url)
        }, 120_000)
      }
      document.body.appendChild(frame)
    })
  }

  const goToPage = async (t: PdfTab) => {
    const n = t.pdf.pageCount
    const v = await os.dialog.prompt(`Go to page (1–${n}):`, { title: 'Go to page', defaultValue: String(t.view.page + 1) })
    if (v === null) return
    const k = parseInt(v, 10)
    if (k >= 1 && k <= n) t.goto(k - 1)
    else {
      const byLabel = t.pdf.pages.findIndex((p) => p.label === v.trim())
      if (byLabel >= 0) t.goto(byLabel)
    }
  }

  // ------------------------------------------------------- text actions

  const copySelection = async (t: PdfTab) => {
    const text = await t.selectedText()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setStatus('Copied selected text', 1500)
    } catch (e) {
      fail('Copy', e)
    }
  }

  const singleSpan = (t: PdfTab) => {
    const spans = t.selSpans()
    if (spans.length !== 1) {
      setStatus(spans.length ? 'Select text on one page' : 'Select some text first', 2000)
      return null
    }
    return spans[0]
  }

  /** pdftab.copy_selection_as_image: the selected lines' area at 200 dpi. */
  const copySelectionImage = async (t: PdfTab) => {
    const span = singleSpan(t)
    if (!span) return
    const rects = t.selLineRects(span[0])
    if (!rects.length) return
    const clip: PdfRect = [Math.min(...rects.map((r) => r[0])) - 2, Math.min(...rects.map((r) => r[1])) - 2, Math.max(...rects.map((r) => r[2])) + 2, Math.max(...rects.map((r) => r[3])) + 2]
    await run('Copy as Image', async () => {
      const [png] = await t.pdf.exportImages([span[0]], { dpi: 200, clip, annotations: t.annots })
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([png as BlobPart], { type: 'image/png' }) })])
      setStatus('Copied the selection as an image', 2000)
    })
  }

  /** pdftab.delete_selected_text: the selected words leave the page (one undo step). */
  const deleteSelectedText = async (t: PdfTab) => {
    const span = singleSpan(t)
    if (!span) return
    const erase = t.selLineRects(span[0])
    await run('Delete Selected Text', () => t.docOp('Delete text', () => t.pdf.rewriteText([{ page: span[0], erase }])))
  }

  /** pdftab.replace_selected_text */
  const replaceText: PageActions['replaceText'] = (page, rects, text, style) => {
    const t = live.current.tab
    if (!t) return
    const r: PdfRect = [Math.min(...rects.map((x) => x[0])), Math.min(...rects.map((x) => x[1])), Math.max(...rects.map((x) => x[2])), Math.max(...rects.map((x) => x[3]))]
    const info = t.pdf.pages[page]
    const widest = Math.max(...text.split('\n').map((l) => textWidth(l, style.size, style.font))) * 1.06
    const right = Math.min(info.x + info.width - 4, Math.max(r[2], r[0] + widest))
    void run('Edit Selected Text', () =>
      t.docOp('Edit text', () =>
        t.pdf.rewriteText([{ page, erase: rects, text, rect: [r[0], r[1], right, r[3]], size: style.size, color: style.color, font: style.font, bold: style.bold, italic: style.italic, leading: 1.25 }]),
      ),
    )
  }

  /** Edit Text tool: _edit_existing_text — the paragraph in the Edit text dialog, then rewritten in place. */
  const editParagraph = (par: Paragraph) => {
    const t = live.current.tab
    if (!t) return
    const words = (t.wordsOf(par.page) ?? []).filter((_, i) => par.words.includes(i))
    const st = fontStyleOf(par.fontName)
    setMarker({ page: par.page, rect: par.rect })
    setEditText({
      joined: wordsText(words, false), broken: wordsText(words, true), font: st.font, size: par.size, bold: st.bold, italic: st.italic, align: par.align,
      resolve: (r) => {
        setMarker(null)
        if (!r) return
        void run('Edit text', () =>
          t.docOp('Edit text', () =>
            t.pdf.rewriteText([{
              page: par.page, erase: par.lines, text: r.text, rect: par.rect, size: r.size, color: par.color, font: r.font, bold: r.bold, italic: r.italic, align: r.align,
            }]),
          ),
        )
      },
    })
  }

  /** Move Text tool: the paragraph is taken out and written again where it was dropped. */
  const moveParagraph = (par: Paragraph, dx: number, dy: number) => {
    const t = live.current.tab
    if (!t) return
    const info = t.pdf.pages[par.page]
    const words = (t.wordsOf(par.page) ?? []).filter((_, i) => par.words.includes(i))
    const st = fontStyleOf(par.fontName)
    let [x0, y0, x1, y1] = [par.rect[0] + dx, par.rect[1] + dy, par.rect[2] + dx, par.rect[3] + dy]
    x0 = Math.max(info.x, x0)
    y0 = Math.max(info.y, y0)
    x1 = Math.min(info.x + info.width, x1)
    y1 = Math.min(info.y + info.height, y1)
    if (x1 - x0 < 2 || y1 - y0 < 2) return
    void run('Move text', () =>
      t.docOp('Move text', () =>
        t.pdf.rewriteText([{
          page: par.page, erase: par.lines, text: wordsText(words, false), rect: [x0, y0, x1, y1], size: par.size, color: par.color, font: st.font, bold: st.bold, italic: st.italic, align: par.align,
        }]),
      ),
    )
  }

  /** pdftab.paste_text: the text becomes a text box at the point (or the last click). */
  const addTextBox = (t: PdfTab, page: number, x: number, y: number, text: string) => {
    const s = live.current.settings.text
    const a: PdfAnnot = {
      id: newAnnotId(), kind: 'text', page, color: s.color, opacity: 1, width: 0, fontSize: s.width, font: 'Helv', text,
      rect: fitTextRect(x, y, text, s.width),
    }
    t.setAnnots([...t.annots, a], 'Paste text')
  }

  const pasteTextAt: PageActions['pasteTextAt'] = (page, x, y) => {
    const t = live.current.tab
    if (!t) return
    void navigator.clipboard
      .readText()
      .then((text) => {
        const v = text.replace(/\s+$/, '')
        if (v) addTextBox(t, page, x, y, v)
        else setStatus('The clipboard has no text', 2000)
      })
      .catch(() => setStatus('Use ⌘V to paste here (the browser keeps the clipboard to itself)', 3000))
  }

  const pageActions: PageActions = {
    copyText: () => tab && void copySelection(tab),
    copyImage: () => tab && void copySelectionImage(tab),
    deleteSelection: () => tab && void deleteSelectedText(tab),
    pasteTextAt,
    editParagraph,
    moveParagraph,
    replaceText,
  }

  const deleteSelectedAnnots = (t: PdfTab) => {
    if (!t.selected.size) return
    t.setAnnots(t.annots.filter((a) => !t.selected.has(a.id)), t.selected.size === 1 ? 'Delete annotation' : 'Delete annotations')
  }

  // ------------------------------------------------------ tools menu, git

  const ocr = () => {
    if (!tab) return void os.dialog.alert('Open a PDF first.', { title: 'Recognize Text' })
    void os.dialog.alert('OCR support is not available in this build (the desktop uses Tesseract, which the web edition does not have yet).', { title: 'Recognize Text' })
  }

  /** MainWindow._pdf_for_kherveref: offer to save unsaved annotations first. */
  const pdfForKherveRef = async (t: PdfTab): Promise<string | null> => {
    if (t.dirty || !t.path) {
      const choice = await os.dialog.choose('There are unsaved annotations. Save them into the PDF first so KherveRef gets the annotated file?', [
        { label: 'Cancel', value: 'cancel' },
        { label: 'No', value: 'no' },
        { label: 'Yes', value: 'yes', primary: true },
      ], { title: 'KherveRef' })
      if (choice === 'cancel' || choice === null) return null
      if (choice === 'yes' && !(await saveTab(t))) return null
    }
    return t.path
  }

  const addToKherveRef = async (t: PdfTab) => {
    const p = await pdfForKherveRef(t)
    if (!p) return
    os.open('kherveref', { add: p })
    setStatus(`Sent to KherveRef: ${path.basename(p)}`)
  }

  const showInKherveRef = async (t: PdfTab) => {
    const p = await pdfForKherveRef(t)
    if (!p) return
    os.open('kherveref')
    setStatus(`Showing in KherveRef: ${path.basename(p)}`)
  }

  const gitCommitNow = async (t: PdfTab) => {
    if (!t.path) return void os.dialog.alert('Save the PDF first, then commit it.', { title: 'Git' })
    try {
      if (await commitFile(t, `Manual commit — ${t.name}`, true)) setStatus(`Committed ${t.name} to git`, 3000)
      else void os.dialog.alert('Nothing to commit (no changes since last commit?) or git operation failed.', { title: 'Commit' })
    } catch (e) {
      void os.dialog.alert(`Nothing to commit (no changes since last commit?) or git operation failed.\n${git.describeGitError(e)}`, { title: 'Commit' })
    }
  }

  const gitHistory = (t: PdfTab) => {
    const root = rootOf(t)
    if (!root) return void os.dialog.alert('This PDF is not under Git yet: Git ▸ Commit Now starts its history.', { title: 'Git' })
    setDialog({ kind: 'history', tab: t, root })
  }

  const gitRemote = async (t: PdfTab) => {
    const root = rootOf(t)
    if (!root) return void os.dialog.alert('This PDF is not under Git yet: Git ▸ Commit Now starts its history.', { title: 'Git' })
    const url = (await git.getRemoteUrl(root).catch(() => null)) ?? ''
    setDialog({ kind: 'remote', tab: t, root, url })
  }

  const loadHistory = async (root: string): Promise<HistoryRow[]> =>
    (await git.log(root, { depth: 200 })).map((c) => ({ oid: c.oid, short: c.short, time: c.author.time, author: c.author.name, subject: c.subject }))

  const restoreCommit = async (t: PdfTab, root: string, row: HistoryRow): Promise<boolean> => {
    if (!t.path) return false
    const ok = await os.dialog.confirm(<>Restore <b>{t.name}</b> to commit <code>{row.short}</code>?<br />The current file on disk will be overwritten.</>, { title: 'Restore?', okLabel: 'Yes' })
    if (!ok) return false
    const rel = relativeTo(root, t.path)
    const data = rel ? await git.readFileAtCommit(root, row.oid, rel).catch(() => null) : null
    if (!data) {
      void os.dialog.alert('Could not check out that commit.', { title: 'Restore failed' })
      return false
    }
    await fs.writeBytes(t.path, data)
    await commitFile(t, `Restore to ${row.short}`, false).catch(() => false)
    void os.dialog.alert('File reverted. Close and reopen the tab to view.', { title: 'Restored' })
    return true
  }

  // ------------------------------------------------------------------ zoom

  const zoomBy = (k: number) => tab && tab.setZoom(tab.view.zoom * k, null)
  const fit = (mode: 'width' | 'page') => tab && tab.setZoom(tab.view.zoom, mode)
  const zoomPct = tab ? Math.round((tab.view.zoom / ZOOM_BASE) * 100) : 100
  const comboText = zoomComboText(tab?.view.fit === 'width', zoomPct)

  /** MainWindow._apply_zoom_combo */
  const applyZoom = (text: string) => {
    setZoomText(null)
    if (!tab) return
    const v = parseZoomText(text)
    if (v === 'fit') fit('width')
    else if (v !== null) tab.setZoom(v * ZOOM_BASE, null)
  }

  // ------------------------------------------------------------- slideshow

  const [showPage, setShowPage] = useState(0)
  const startShow = (fullscreen: boolean) => {
    if (!tab) return setStatus('Open a PDF to start a slideshow.', 3000)
    setFind(null)
    setShowPage(tab.view.page)
    setShow({ start: tab.view.page, fullscreen })
  }
  const endShow = (page: number) => {
    setShow(null)
    tab?.goto(page)
    setTimeout(() => rootRef.current?.querySelector<HTMLElement>('.kp-scroll')?.focus(), 0)
  }
  const toggleShow = (fullscreen: boolean) => {
    if (show && show.fullscreen === fullscreen) endShow(showPage)
    else if (show) setShow({ start: showPage, fullscreen })
    else startShow(fullscreen)
  }

  // Switching tabs ends the show (it belongs to the tab it started on).
  useEffect(() => {
    setShow(null)
    setOptions(null)
    setZoomText(null)
  }, [activeKey])

  // --------------------------------------------------------------- menus

  const has = !!tab
  const pageMenuItems = (t: PdfTab, page: number): MenuItem[] => [
    { label: 'Insert Blank Page After', image: mi('page_insert'), onClick: () => void insertBlank(t, page) },
    { label: 'Delete Page', image: mi('page_delete'), danger: true, disabled: t.pdf.pageCount <= 1, onClick: () => void deletePages(t, [page]) },
    '-',
    { label: 'Rotate Page Left', image: mi('rotate_l'), onClick: () => void rotatePages(t, [page], -90) },
    { label: 'Rotate Page Right', image: mi('rotate_r'), onClick: () => void rotatePages(t, [page], 90) },
    '-',
    { label: 'Move Page Up', disabled: page === 0, onClick: () => void movePage(t, page, page - 1) },
    { label: 'Move Page Down', disabled: page >= t.pdf.pageCount - 1, onClick: () => void movePage(t, page, page + 1) },
  ]

  const sidebarShown = prefs.sidebar && has
  const toggleSidebar = () => has && setPrefs({ sidebar: !prefs.sidebar })
  const openFind = () => tab && setFind((f) => ({ focusKey: (f?.focusKey ?? 0) + 1 }))
  const openAi = () => os.open('kherveai')

  useEffect(() => {
    const t = tab
    const need = (fn: (t: PdfTab) => void) => () => (t ? fn(t) : setStatus('Open a PDF first', 2000))
    const menus: MenuBarMenu[] = [
      {
        label: 'File',
        items: [
          { label: 'New', image: mi('new'), shortcut: '⌘N', onClick: () => void newDoc() },
          { label: 'Open…', image: mi('open'), shortcut: '⌘O', onClick: () => void openDialog() },
          {
            label: 'Open Recent',
            image: mi('history'),
            submenu: recent.length
              ? [
                  ...recent.map((p): MenuItem => ({ label: path.basename(p), onClick: () => void openPath(p) })),
                  '-',
                  { label: 'Clear list', onClick: () => setRecent(storeRecent([])) },
                ]
              : [{ label: '(empty)', disabled: true }],
          },
          '-',
          { label: 'Save', image: mi('save'), shortcut: '⌘S', onClick: need((x) => void saveTab(x)) },
          { label: 'Save As…', image: mi('save_as'), shortcut: '⇧⌘S', onClick: need((x) => void saveTab(x, true)) },
          '-',
          { label: 'Export pages as PNG / JPEG…', image: mi('export_png'), onClick: need((x) => void exportImages(x)) },
          { label: 'Export Text…', image: mi('export_txt'), onClick: need((x) => void exportText(x)) },
          { label: 'Compress / shrink…', image: mi('save_as'), onClick: need((x) => void compressedCopy(x)) },
          { label: 'Encrypt / password protect…', image: mi('save_as'), onClick: need((x) => void encryptedCopy(x)) },
          { label: 'Digitally sign (PKCS#12)…', image: mi('signature'), onClick: need(() => void digitallySign()) },
          { label: 'Print…', image: mi('print'), shortcut: '⌘P', onClick: need((x) => void print(x)) },
          { label: 'Print Preview…', image: mi('print'), shortcut: '⇧⌘P', onClick: need((x) => setDialog({ kind: 'preview', tab: x })) },
          '-',
          { label: 'Document Properties…', onClick: need((x) => void properties(x)) },
          { label: 'Download to Computer', image: mi('download'), onClick: need((x) => void download(x)) },
          '-',
          { label: 'Close Tab', image: mi('close'), shortcut: '⌘W', onClick: () => t && void closeTab(t) },
          { label: 'Exit', shortcut: '⌘Q', onClick: () => win.close() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', image: mi('undo'), shortcut: '⌘Z', onClick: () => t && void t.undo() },
          { label: 'Redo', image: mi('redo'), shortcut: '⌘Y', onClick: () => t && void t.redo() },
          '-',
          { label: 'Copy Selected Text', shortcut: '⌘C', onClick: () => t && void copySelection(t) },
          { label: 'Select All Text on Page', shortcut: '⌘A', onClick: need((x) => selectAllOnPage(x, x.view.page)) },
          { label: 'Edit Selected Text…', onClick: need((x) => x.ui.editSelection?.()) },
          { label: 'Copy Selection as Image', image: mi('snapshot'), onClick: need((x) => void copySelectionImage(x)) },
          '-',
          { label: 'Find…', image: mi('find'), shortcut: '⌘F', onClick: openFind },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Zoom In', image: mi('zoom_in'), shortcut: '⌘+', onClick: () => zoomBy(1.25) },
          { label: 'Zoom Out', image: mi('zoom_out'), shortcut: '⌘−', onClick: () => zoomBy(1 / 1.25) },
          { label: 'Fit Width', image: mi('fit_width'), shortcut: '⌘0', onClick: () => fit('width') },
          { label: 'Fit Page', image: mi('fit_page'), onClick: () => fit('page') },
          '-',
          { label: 'Rotate Left', onClick: () => t && void rotatePages(t, [t.view.page], -90) },
          { label: 'Rotate Right', onClick: () => t && void rotatePages(t, [t.view.page], 90) },
          '-',
          { label: 'Show Page Thumbnails', image: mi('thumbs'), checked: sidebarShown, disabled: !has, onClick: toggleSidebar },
          { label: 'Show AI Assistant', image: mi('ai'), onClick: openAi },
          '-',
          {
            label: 'Slideshow',
            image: mi('slideshow_full'),
            submenu: [
              { label: 'Normal View', image: mi('normal_view'), checked: !show, disabled: !has, onClick: () => show && endShow(showPage) },
              { label: 'Slideshow in Window', image: mi('slideshow_window'), shortcut: '⇧F5', checked: !!show && !show.fullscreen, disabled: !has, onClick: () => toggleShow(false) },
              { label: 'Slideshow Full Screen', image: mi('slideshow_full'), shortcut: 'F5', checked: !!show?.fullscreen, disabled: !has, onClick: () => toggleShow(true) },
              '-',
              { label: 'Continuous — advance automatically', image: mi('autoplay'), checked: prefs.slide.continuous, onClick: () => setPrefs({ slide: { ...prefs.slide, continuous: !prefs.slide.continuous } }) },
              { label: 'Loop back to the first page', image: mi('loop'), checked: prefs.slide.loop, onClick: () => setPrefs({ slide: { ...prefs.slide, loop: !prefs.slide.loop } }) },
            ],
          },
          '-',
          {
            label: 'Theme',
            submenu: [
              { label: 'Kherve Green (dark)', checked: !light, onClick: () => setLight(false) },
              { label: 'Light', checked: light, onClick: () => setLight(true) },
            ],
          },
        ],
      },
      {
        label: 'Tools',
        items: [
          ...(['select', 'select_text', 'pen', 'highlight', 'text', 'line', 'arrow', 'rect', 'ellipse', 'note', 'signature', 'redact'] as ToolId[]).map(
            (id): MenuItem => ({ label: TOOL_BY_ID[id].label, checked: tool === id, onClick: () => setTool(id) }),
          ),
          { label: 'Apply Redactions…', onClick: need((x) => void applyRedactions(x)) },
          '-',
          { label: 'Recognize Text (OCR)…', image: mi('ocr'), onClick: ocr },
          '-',
          { label: 'Add to KherveRef', image: mi('kherveref'), disabled: !t, onClick: () => t && void addToKherveRef(t) },
          { label: 'Show in KherveRef', image: mi('kherveref_show'), disabled: !t, onClick: () => t && void showInKherveRef(t) },
          { label: 'Locate KherveRef…', onClick: () => void os.dialog.alert('KherveRef is part of KherveOS: Add to KherveRef and Show in KherveRef open it directly.', { title: 'Locate KherveRef' }) },
        ],
      },
      {
        label: 'Pages',
        items: [
          { label: 'Insert Blank Page', image: mi('page_insert'), onClick: need((x) => void insertBlank(x)) },
          { label: 'Delete Current Page', image: mi('page_delete'), onClick: need((x) => void deletePages(x, [x.view.page])) },
          '-',
          { label: 'Rotate Page Left', image: mi('rotate_l'), onClick: need((x) => void rotatePages(x, [x.view.page], -90)) },
          { label: 'Rotate Page Right', image: mi('rotate_r'), onClick: need((x) => void rotatePages(x, [x.view.page], 90)) },
          '-',
          { label: 'Merge PDF(s)…', image: mi('page_merge'), onClick: need((x) => void mergePdf(x)) },
          { label: 'Split into one PDF per page…', image: mi('page_split'), onClick: need((x) => void splitPdf(x)) },
          { label: 'Extract pages…', image: mi('page_split'), onClick: need((x) => void extractPages(x)) },
          '-',
          { label: 'Watermark every page…', image: mi('text'), onClick: need((x) => void watermark(x)) },
          { label: 'Number every page…', image: mi('text'), onClick: need((x) => void numberPages(x)) },
        ],
      },
      {
        label: 'Git',
        items: [
          { label: 'Commit Now', image: mi('commit'), onClick: () => t && void gitCommitNow(t) },
          { label: 'History…', image: mi('history'), onClick: () => t && gitHistory(t) },
          { label: 'Remote / Push…', image: mi('remote'), onClick: () => t && void gitRemote(t) },
        ],
      },
      {
        label: 'Help',
        items: [
          { label: 'Check for Updates…', image: mi('update'), onClick: () => void os.dialog.alert(`KhervePDF is up to date (latest release: v${VERSION}). KherveOS brings new versions itself.`, { title: 'Check for Updates' }) },
          { label: 'Check for Updates Automatically', checked: prefs.autoUpdate, onClick: () => setPrefs({ autoUpdate: !prefs.autoUpdate }) },
          '-',
          { label: 'About KhervePDF', image: mi('about'), onClick: () => setDialog({ kind: 'about' }) },
          { label: 'Meet the Author…', image: mi('author'), onClick: () => setDialog({ kind: 'author' }) },
        ],
      },
    ]
    win.setMenus(menus)
  })

  // ------------------------------------------------------------ keyboard

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = live.current.tab
    const target = e.target as HTMLElement
    const typing = target.closest('input, textarea, select, [contenteditable="true"]')
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    const take = (fn: () => void) => {
      e.preventDefault()
      fn()
    }
    if (e.key === 'F5') return take(() => toggleShow(!e.shiftKey))
    if (mod && k === 'o') return take(() => void openDialog())
    if (mod && k === 'n' && !e.shiftKey) return take(() => void newDoc())
    if (mod && k === 'q') return take(() => win.close())
    if (!t) return
    if (mod && k === 's') take(() => void saveTab(t, e.shiftKey))
    else if (mod && k === 'p') take(() => (e.shiftKey ? setDialog({ kind: 'preview', tab: t }) : void print(t)))
    else if (mod && k === 'w') take(() => void closeTab(t))
    else if (mod && k === 'f') take(openFind)
    else if (mod && (k === '=' || k === '+')) take(() => zoomBy(1.25))
    else if (mod && k === '-') take(() => zoomBy(1 / 1.25))
    else if (mod && k === '0') take(() => fit('width'))
    else if (typing) return
    else if (mod && k === 'z') take(() => void (e.shiftKey ? t.redo() : t.undo()))
    else if (mod && k === 'y') take(() => void t.redo())
    else if (mod && k === 'c' && t.textSel) take(() => void copySelection(t))
    else if (mod && k === 'a') take(() => selectAllOnPage(t, t.view.page))
    else if ((e.key === 'Delete' || e.key === 'Backspace') && t.selected.size) take(() => deleteSelectedAnnots(t))
    else if ((e.key === 'Delete' || e.key === 'Backspace') && t.textSel) take(() => void deleteSelectedText(t))
    else if (e.key === 'Escape') {
      if (t.textSel) t.setTextSel(null)
      else if (t.selected.size) t.select([])
      else if (find) setFind(null)
    }
  }

  /** Ctrl+V: a picture is placed on the current page; text becomes a text box at the last click. */
  const onPaste = (e: React.ClipboardEvent) => {
    const t = live.current.tab
    if (!t || (e.target as HTMLElement).closest('input, textarea')) return
    const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
    if (file) {
      e.preventDefault()
      void file.arrayBuffer().then((b) => run('Insert image', () => insertImageBytes(t, new Uint8Array(b))))
      return
    }
    const text = e.clipboardData.getData('text/plain').replace(/\s+$/, '')
    if (!text) return
    e.preventDefault()
    const at = t.lastClick && t.lastClick.page === t.view.page ? t.lastClick : null
    const info = t.pdf.pages[t.view.page]
    addTextBox(t, t.view.page, at ? at.x : info.x + 72, at ? at.y : info.y + 72, text)
  }

  // ------------------------------------------------------- drag and drop

  const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(DRAG_MIME)
  const onDragOver = (e: React.DragEvent) => {
    if (!isFileDrag(e) || e.dataTransfer.types.includes('application/x-khervepdf-page')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!dropping) setDropping(true)
  }
  const onDrop = (e: React.DragEvent) => {
    setDropping(false)
    if (!isFileDrag(e)) return
    e.preventDefault()
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (raw) {
      try {
        for (const p of JSON.parse(raw) as string[]) if (path.extname(p) === '.pdf') void openPath(p)
      } catch {
        /* not ours */
      }
      return
    }
    const files = [...e.dataTransfer.files].filter((f) => f.name.toLowerCase().endsWith('.pdf'))
    if (!files.length) return
    void os.importFiles(`${HOME}/Downloads`, files).then((paths) => paths.forEach((p) => void openPath(p)))
  }

  // -------------------------------------------------------------- tab drag

  const tabBarRef = useRef<HTMLDivElement>(null)
  const tabDrag = useRef<{ key: string; x: number; y: number; moved: boolean } | null>(null)
  const onTabPointerDown = (e: React.PointerEvent, t: PdfTab) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.kp-tab-close')) return
    tabDrag.current = { key: t.key, x: e.clientX, y: e.clientY, moved: false }
    const move = (ev: PointerEvent) => {
      const d = tabDrag.current
      if (!d) return
      if (!d.moved && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 6) return
      d.moved = true
      // Reorder while over the tab bar (QTabBar.setMovable).
      const over = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('.kp-tab')
      const overKey = over?.dataset.key
      if (overKey && overKey !== d.key) {
        setTabs((old) => {
          const from = old.findIndex((x) => x.key === d.key)
          const to = old.findIndex((x) => x.key === overKey)
          return from < 0 || to < 0 ? old : moveItem(old, from, to)
        })
      }
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const d = tabDrag.current
      tabDrag.current = null
      if (!d?.moved) return
      // Released away from the tab bar: tear the tab off into its own window.
      const r = tabBarRef.current?.getBoundingClientRect()
      if (r && (ev.clientY < r.top - 6 || ev.clientY > r.bottom + 6 || ev.clientX < r.left - 6 || ev.clientX > r.right + 6)) {
        const t2 = live.current.tabs.find((x) => x.key === d.key)
        if (t2) void detachTab(t2)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ------------------------------------------------------------- render

  const showOptions = (e: React.MouseEvent, id: ToolId) => {
    setTool(id)
    const r = (e.currentTarget as HTMLElement).closest('.kp-split')!.getBoundingClientRect()
    setOptions((o) => (o ? null : { left: r.left, top: r.bottom + 2 }))
  }

  const tb = (name: Glyph, tip: string, onClick: () => void, opts: { active?: boolean; disabled?: boolean } = {}) => (
    <button className={`kp-tb${opts.active ? ' active' : ''}`} title={tip} disabled={opts.disabled} onClick={onClick}>
      <Icon name={name} />
    </button>
  )

  const zoomMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect()
    os.contextMenu({ clientX: r.left, clientY: r.bottom + 2 }, ZOOM_ITEMS.map((z) => ({ label: z, checked: z === comboText, onClick: () => applyZoom(z) })))
  }

  const toolbar = (
    <div className="kp-toolbar">
      {tb('open', 'Open PDF (Ctrl+O)', () => void openDialog())}
      {tb('save', 'Save (Ctrl+S)', () => tab && void saveTab(tab))}
      {tb('undo', 'Undo (Ctrl+Z)', () => tab && void tab.undo())}
      {tb('redo', 'Redo (Ctrl+Y)', () => tab && void tab.redo())}
      {tb('image', 'Insert image from file (Ctrl+V to paste)', () => tab && void insertImage(tab))}
      {tb('thumbs', 'Show/hide the Pages side panel', toggleSidebar, { active: sidebarShown, disabled: !has })}
      {tb('ai', 'Show/hide the AI assistant panel', openAi)}
      <span className="kp-tb-sep" />
      {TOOLS.filter((d) => d.toolbar).map((d) =>
        OPTIONS_TOOLS.has(d.id) ? (
          <span key={d.id} className={`kp-split${tool === d.id ? ' active' : ''}`}>
            <button className="kp-tb" title={d.tip} onClick={() => setTool(d.id)}>
              <Icon name={d.icon} />
            </button>
            <button className="kp-split-arrow" title={`${d.label} options`} onClick={(e) => showOptions(e, d.id)}>
              <Icon name="menu_down" size={14} />
            </button>
          </span>
        ) : (
          <button key={d.id} className={`kp-tb${tool === d.id ? ' active' : ''}`} title={d.tip} onClick={() => setTool(d.id)}>
            <Icon name={d.icon} />
          </button>
        ),
      )}
      <span className="kp-tb-sep" />
      {tb('zoom_out', 'Zoom Out', () => zoomBy(1 / 1.25))}
      {tb('zoom_in', 'Zoom In', () => zoomBy(1.25))}
      {tb('fit_width', 'Fit Width', () => fit('width'))}
      <span className="kp-tb kp-tb-label" aria-hidden><Icon name="zoom_in" /></span>
      <span className="kp-zoom-combo" title="Zoom level — pick a preset or type a percentage">
        <input
          value={zoomText ?? comboText}
          disabled={!has}
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setZoomText(e.target.value)}
          onBlur={() => setZoomText(null)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') applyZoom(e.currentTarget.value)
            else if (e.key === 'Escape') setZoomText(null)
          }}
        />
        <button disabled={!has} onClick={zoomMenu} tabIndex={-1}><Icon name="menu_down" size={16} /></button>
      </span>
    </div>
  )

  const tabBar = tabs.length > 0 && (
    <div className="kp-tabs" role="tablist" ref={tabBarRef}>
      {tabs.map((t) => (
        <TabButton
          key={t.key}
          t={t}
          active={t === tab}
          onActivate={() => setActiveKey(t.key)}
          onClose={() => void closeTab(t)}
          onPointerDown={(e) => onTabPointerDown(e, t)}
          onMenu={(e) => os.contextMenu(e, [{ label: 'Open in new window', onClick: () => void detachTab(t) }])}
        />
      ))}
    </div>
  )

  const welcome = (
    <div className="kp-welcome">
      <svg className="kp-welcome-waves" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {[...Array(7).keys()].map((i) => (
          <polyline
            key={i}
            points={[...Array(25).keys()].map((s) => `${(s / 24) * 100},${55 + i * 6 + Math.sin((s / 24) * Math.PI * 2 + i * 0.6) * 4}`).join(' ')}
          />
        ))}
      </svg>
      <div className="kp-welcome-card">
        <div className="kp-welcome-head">
          <AppMark size={88} />
          <div>
            <h1>KhervePDF</h1>
            <p>View, annotate and edit PDFs — with Git history · v{VERSION}</p>
          </div>
        </div>
        <div className="kp-welcome-actions">
          <button className="kp-big primary" title="Browse for a file  (Ctrl+O)" onClick={() => void openDialog()}>
            <Icon name="open" size={26} /> Open PDF…
          </button>
          <button className="kp-big" title="Start a blank document" onClick={() => void newDoc()}>
            <Icon name="new" size={26} /> New
          </button>
        </div>
        {recent.length > 0 && (
          <div className="kp-recent">
            <div className="kp-recent-title">Recent files</div>
            {recent.slice(0, 8).map((p) => {
              const folder = path.pretty(path.dirname(p))
              return (
                <button key={p} className="kp-recent-item" title={p} disabled={!fs.exists(p)} onClick={() => void openPath(p)}>
                  <Icon name="recent_doc" size={18} />
                  <span className="kp-recent-name">{path.basename(p)}</span>
                  <span className="kp-recent-dir">{folder.length > 60 ? `…${folder.slice(-59)}` : folder}</span>
                </button>
              )
            })}
          </div>
        )}
        <p className="kp-welcome-hint">{opening ?? 'Tip: drop a PDF anywhere on this window to open it.'}</p>
      </div>
    </div>
  )

  const toolDef = TOOL_BY_ID[tool]
  const busy = !!opening || !!tab?.busy
  const sidebar = sidebarShown && tab && !show && (
    <Sidebar
      tab={tab}
      right={prefs.sideRight}
      onClose={() => setPrefs({ sidebar: false })}
      onMoveSide={() => setPrefs({ sideRight: !prefs.sideRight })}
      onMovePage={(from, to) => void movePage(tab, from, to)}
      onPageMenu={(e, page) => os.contextMenu(e, pageMenuItems(tab, page))}
      onEditOutline={(items) => void editOutline(tab, items)}
    />
  )

  return (
    <div
      ref={rootRef}
      className={`k-app kp-app${dropping ? ' dropping' : ''}`}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onDragOver={onDragOver}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropping(false)}
      onDrop={onDrop}
    >
      {!show && toolbar}
      <div className="kp-body">
        {!prefs.sideRight && sidebar}
        <div className="kp-center">
          {!tab ? (
            welcome
          ) : show ? (
            <Slideshow
              key={tab.key}
              tab={tab}
              start={show.start}
              fullscreen={show.fullscreen}
              settings={prefs.slide}
              onSettings={(slide) => setPrefs({ slide })}
              onPage={setShowPage}
              onToggleFullscreen={() => setShow((s) => (s ? { start: showPage, fullscreen: !s.fullscreen } : s))}
              onExit={endShow}
            />
          ) : (
            <>
              {tabBar}
              <div className="kp-main">
                <PageView key={tab.key} tab={tab} tool={tool} settings={settings} onStatus={(m) => setStatus(m, 2500)} actions={pageActions} marker={marker} />
                {find && (
                  <FindBar
                    tab={tab}
                    focusKey={find.focusKey}
                    onClose={() => {
                      setFind(null)
                      tab.search = null
                      tab.emit()
                    }}
                  />
                )}
              </div>
            </>
          )}
        </div>
        {prefs.sideRight && sidebar}
      </div>
      <div className="kp-status">
        {status ? (
          <span className="kp-status-msg">{status}</span>
        ) : tab ? (
          <button className="kp-status-page" title="Go to page…" onClick={() => void goToPage(tab)}>
            Page {(show ? showPage : tab.view.page) + 1} of {tab.pdf.pageCount}
          </button>
        ) : (
          <span className="kp-status-page">—</span>
        )}
        <span className="k-spacer" />
        {busy && <span className="kp-progress" title={opening ?? tab?.busy ?? ''}><span /></span>}
        <span>{toolStatusName(toolDef.id)}</span>
        <span>{tab ? `${zoomPct}%` : '—'}</span>
        {tab?.branch && <span title="Git branch">⎇ {tab.branch}</span>}
        <div className="kp-views">
          <button className={!show ? 'active' : ''} title="Normal view" disabled={!has} onClick={() => show && endShow(showPage)}><Icon name="normal_view" size={18} /></button>
          <button className={show && !show.fullscreen ? 'active' : ''} title="Slideshow in this window, one page at a time (Shift+F5)" disabled={!has} onClick={() => toggleShow(false)}><Icon name="slideshow_window" size={18} /></button>
          <button className={show?.fullscreen ? 'active' : ''} title="Slideshow full screen, one page at a time (F5)" disabled={!has} onClick={() => toggleShow(true)}><Icon name="slideshow_full" size={18} /></button>
          <span className="kp-views-sep" />
          <button
            className={prefs.slide.continuous ? 'active' : ''}
            title="Continuous: turn the page automatically (set the seconds beside this button)"
            onClick={() => setPrefs({ slide: { ...prefs.slide, continuous: !prefs.slide.continuous } })}
          >
            <Icon name="autoplay" size={18} />
          </button>
          <span className="kp-views-spin" title="Seconds each page stays on screen in a continuous slideshow">
            <input
              type="number"
              min={INTERVAL_MIN}
              max={INTERVAL_MAX}
              value={prefs.slide.seconds}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                const v = Math.round(Number(e.target.value))
                if (v >= INTERVAL_MIN && v <= INTERVAL_MAX) setPrefs({ slide: { ...prefs.slide, seconds: v } })
              }}
            />
            s
          </span>
        </div>
      </div>
      {options && OPTIONS_TOOLS.has(tool) && (
        <ToolOptions tool={tool} setting={settings[tool]} anchor={options} onChange={(s) => updateSetting(tool, s)} onClose={() => setOptions(null)} />
      )}
      {form && <FormDialog spec={form} onClose={() => setForm(null)} />}
      {editText && <EditTextDialog spec={editText} onClose={() => setEditText(null)} />}
      {dialog?.kind === 'about' && <AboutDialog onAuthor={() => setDialog({ kind: 'author' })} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'author' && <AuthorDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'preview' && (
        <PrintPreview
          pdf={dialog.tab.pdf}
          name={dialog.tab.name}
          onClose={() => setDialog(null)}
          onPrint={() => {
            const t = dialog.tab
            setDialog(null)
            void print(t)
          }}
        />
      )}
      {dialog?.kind === 'history' && (
        <HistoryDialog
          name={dialog.tab.name}
          branch={dialog.tab.branch}
          load={() => loadHistory(dialog.root)}
          onRestore={(row) => restoreCommit(dialog.tab, dialog.root, row)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'remote' && (
        <RemoteDialog
          name={dialog.tab.name}
          branch={dialog.tab.branch}
          url={dialog.url}
          onSave={async (url) => {
            try {
              await git.setRemoteUrl(dialog.root, url)
              return true
            } catch {
              void os.dialog.alert('Could not save the remote URL.', { title: 'Remote' })
              return false
            }
          }}
          onPush={async () => {
            try {
              await git.push(dialog.root, { token: git.getGithubToken() || undefined, username: git.getGithubLogin() || undefined })
              void os.dialog.alert('Pushed.', { title: 'Push' })
            } catch (e) {
              void os.dialog.alert(git.describeGitError(e), { title: 'Push failed' })
            }
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dropping && <div className="kp-drop-hint">Drop PDFs to open them</div>}
    </div>
  )
}

function TabButton({ t, active, onActivate, onClose, onMenu, onPointerDown }: {
  t: PdfTab
  active: boolean
  onActivate: () => void
  onClose: () => void
  onMenu: (e: React.MouseEvent) => void
  onPointerDown: (e: React.PointerEvent) => void
}) {
  useTab(t)
  return (
    <div
      role="tab"
      aria-selected={active}
      data-key={t.key}
      className={`kp-tab${active ? ' active' : ''}`}
      title={t.path ? path.pretty(t.path) : t.name}
      onClick={onActivate}
      onPointerDown={onPointerDown}
      onAuxClick={(e) => e.button === 1 && onClose()}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e)
      }}
    >
      <span className="kp-tab-name">{t.name}</span>
      <button
        className="kp-tab-close"
        title="Close Tab"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  )
}
