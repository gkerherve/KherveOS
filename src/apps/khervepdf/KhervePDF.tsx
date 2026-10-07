// KhervePDF: view, annotate and edit PDFs — a port of the desktop KhervePDF
// (PySide6 + PyMuPDF) onto the KherveOS PDF service (MuPDF.js).
//
// One PDF per tab. Annotations are edited in memory and written into the file
// when it is saved (untouched ones are kept exactly as they were); page
// operations, form filling, redaction and bookmarks change the document
// directly. Everything is undoable.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDown, Download, FilePlus, FileText, FolderOpen, ImagePlus, Lock, Maximize2, MonitorPlay, PanelLeft, Presentation,
  Printer, Redo2, RotateCcw, RotateCw, Save, Scissors, Search, Trash2, Undo2, X, ZoomIn, ZoomOut, Columns2, Merge, Timer,
} from 'lucide-react'
import { os, fs, path, HOME, type AppProps, type MenuBarMenu, type MenuItem } from '@/os'
import { DRAG_MIME } from '@/os/fileActions'
import { openPdf, PdfPasswordError, type PdfAnnot, type PdfOutlineItem } from '@/os/services/pdf'
import { FindBar } from './FindBar'
import { fitTextRect, parsePageRange, rotateAnnot } from './geometry'
import { newAnnotId, PdfTab, useTab } from './model'
import { markSelection, PageView, selectAllOnPage } from './PageView'
import { Sidebar } from './Sidebar'
import { INTERVAL_MAX, INTERVAL_MIN, Slideshow, type SlideSettings } from './Slideshow'
import { ToolOptions } from './ToolOptions'
import { loadToolSettings, saveToolSettings, TOOL_BY_ID, TOOLS, type ToolId, type ToolSetting, type ToolSettings } from './tools'
import './khervepdf.css'

/** 100 % = real size: 96 CSS pixels per inch, 72 points per inch. */
const ACTUAL = 96 / 72
const ZOOM_PRESETS = [50, 75, 100, 125, 150, 200, 300, 400]
const RECENT_KEY = 'khervepdf.recent'
const PREFS_KEY = 'khervepdf.prefs'

interface Prefs {
  sidebar: boolean
  slide: SlideSettings
}

function loadPrefs(): Prefs {
  const d: Prefs = { sidebar: true, slide: { continuous: false, seconds: 5, loop: true } }
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    return { sidebar: p.sidebar ?? d.sidebar, slide: { ...d.slide, ...(p.slide ?? {}) } }
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

function pushRecent(p: string): string[] {
  const list = [p, ...loadRecent().filter((x) => x !== p)].slice(0, 10)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    /* private mode */
  }
  return list
}

/** A blank one-page A4 PDF. */
function blankPdf(w = 595.28, h = 841.89): Uint8Array {
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
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`

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

// ----------------------------------------------------------------- dialogs

interface Field {
  key: string
  label: string
  value: string
  type?: 'text' | 'password'
  placeholder?: string
}

interface FormSpec {
  title: string
  message?: string
  fields: Field[]
  ok: string
  resolve: (values: Record<string, string> | null) => void
}

function FormDialog({ spec, onClose }: { spec: FormSpec; onClose: () => void }) {
  const [values, setValues] = useState(() => Object.fromEntries(spec.fields.map((f) => [f.key, f.value])))
  const done = (ok: boolean) => {
    onClose()
    spec.resolve(ok ? values : null)
  }
  return (
    <div className="kp-modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && done(false)}>
      <form
        className="kp-modal kp-form"
        onSubmit={(e) => {
          e.preventDefault()
          done(true)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') done(false)
        }}
      >
        <div className="kp-modal-title">{spec.title}</div>
        {spec.message && <p className="k-muted kp-modal-hint">{spec.message}</p>}
        {spec.fields.map((f, i) => (
          <label key={f.key} className="kp-form-row">
            <span>{f.label}</span>
            <input
              className="k-input"
              type={f.type ?? 'text'}
              autoFocus={i === 0}
              value={values[f.key]}
              placeholder={f.placeholder}
              spellCheck={false}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          </label>
        ))}
        <div className="kp-modal-buttons">
          <span className="k-spacer" />
          <button type="button" className="k-btn" onClick={() => done(false)}>Cancel</button>
          <button type="submit" className="k-btn primary">{spec.ok}</button>
        </div>
      </form>
    </div>
  )
}

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
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [dropping, setDropping] = useState(false)
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const tab = tabs.find((t) => t.key === activeKey) ?? null
  useTab(tab)

  const live = useRef({ tabs, tab, tool, settings })
  live.current = { tabs, tab, tool, settings }

  const setStatus = useCallback((msg: string) => {
    setStatusText(msg)
    if (statusTimer.current) clearTimeout(statusTimer.current)
    statusTimer.current = setTimeout(() => setStatusText(''), 4500)
  }, [])

  const setPrefs = (p: Partial<Prefs>) =>
    setPrefsState((old) => {
      const next = { ...old, ...p }
      savePrefs(next)
      return next
    })

  const setTool = (t: ToolId) => {
    setToolState(t)
    setOptions(null)
    if (t !== 'select') tab?.selected.size && tab.select([])
  }

  const updateSetting = (id: ToolId, s: ToolSetting) =>
    setSettings((old) => {
      const next = { ...old, [id]: s }
      saveToolSettings(next)
      return next
    })

  const ask = (spec: Omit<FormSpec, 'resolve'>) => new Promise<Record<string, string> | null>((resolve) => setForm({ ...spec, resolve }))

  const fail = (what: string, e: unknown) => void os.dialog.alert(`${what}: ${errText(e)}`, { title: 'KhervePDF' })

  // ------------------------------------------------------------- opening

  const addTab = (t: PdfTab) => {
    setTabs((old) => [...old, t])
    setActiveKey(t.key)
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
          fields: [{ key: 'pw', label: 'Password', value: '', type: 'password' }],
          ok: 'Open',
        })
        if (!r) return null
        password = r.pw
      }
    }
  }

  const openingPaths = useRef(new Set<string>())
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
      fail(`Could not open ${name}`, e)
    } finally {
      openingPaths.current.delete(p)
      setOpening(null)
    }
  }

  const openDialog = async () => {
    const p = await os.dialog.openFile({
      title: 'Open PDF',
      startDir: tab?.path ? path.dirname(tab.path) : `${HOME}/Documents`,
      extensions: ['.pdf'],
    })
    if (p) await openPath(p)
  }

  const newDoc = async () => {
    try {
      const t = await openBytes(blankPdf(), null, 'Untitled.pdf')
      if (t) addTab(t)
    } catch (e) {
      fail('Could not create a document', e)
    }
  }

  // Open the file the window was started with (and later ones handed to it).
  useEffect(() => {
    if (typeof args.path === 'string' && args.path) void openPath(args.path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args])

  // Close every document when the window goes.
  useEffect(() => () => live.current.tabs.forEach((t) => t.close()), [])

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

  const saveTab = async (t: PdfTab, as = false): Promise<boolean> => {
    let target = t.path
    if (as || !target || !fs.exists(path.dirname(target))) {
      target = await os.dialog.saveFile({
        title: 'Save PDF As',
        defaultName: t.path ?? `${HOME}/Documents/${t.name}`,
        extensions: ['.pdf'],
      })
      if (!target) return false
    }
    try {
      setStatus(`Saving ${path.basename(target)}…`)
      const bytes = await t.bytes()
      await fs.writeBytes(target, bytes)
      t.markSaved(target, path.basename(target))
      setRecent(pushRecent(target))
      setStatus(`Saved ${path.pretty(target)}`)
      return true
    } catch (e) {
      fail('Could not save', e)
      return false
    }
  }

  const download = async (t: PdfTab) => {
    try {
      const bytes = await t.bytes()
      os.downloadBlob(t.name.toLowerCase().endsWith('.pdf') ? t.name : `${t.name}.pdf`, new Blob([bytes as BlobPart], { type: 'application/pdf' }))
    } catch (e) {
      fail('Could not download', e)
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

  const closeTab = async (t: PdfTab) => {
    if (t.dirty && !(await askSave([t]))) return
    if (show && t === live.current.tab) setShow(null)
    t.close()
    setTabs((old) => {
      const i = old.indexOf(t)
      const rest = old.filter((x) => x !== t)
      setActiveKey((k) => (k === t.key ? (rest[Math.min(i, rest.length - 1)]?.key ?? null) : k))
      return rest
    })
  }

  // Ask before the window closes with unsaved changes.
  useEffect(() => {
    win.setCloseGuard(() => askSave(live.current.tabs.filter((t) => t.dirty)))
    return () => win.setCloseGuard(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win])

  // Window title and document path follow the active tab.
  useEffect(() => {
    win.setTitle(tab ? `${tab.dirty ? '• ' : ''}${tab.name} — KhervePDF` : 'KhervePDF')
  })
  useEffect(() => win.setDocumentPath(tab?.path ?? null), [win, tab, tab?.path])

  // --------------------------------------------------------- page actions

  const shiftFrom = (annots: PdfAnnot[], from: number, delta: number) => annots.map((a) => (a.page >= from ? { ...a, page: a.page + delta } : a))

  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn()
    } catch (e) {
      fail(label, e)
      return undefined
    }
  }

  const insertBlank = (t: PdfTab, after = t.view.page) =>
    run('Could not insert a page', async () => {
      const ref = t.pdf.pages[after] ?? t.pdf.pages[0]
      const at = after + 1
      await t.docOp('Insert page', () => t.pdf.insertBlankPage(at, { width: ref.width, height: ref.height }), (an) => shiftFrom(an, at, 1))
      t.goto(at)
    })

  const deletePages = async (t: PdfTab, pages: number[]) => {
    const n = t.pdf.pageCount
    if (pages.length >= n) return void os.dialog.alert('A PDF needs at least one page.', { title: 'Delete page' })
    const ok = await os.dialog.confirm(
      pages.length === 1 ? `Delete page ${pages[0] + 1} of ${n}?` : `Delete ${pages.length} pages?`,
      { title: 'Delete page', okLabel: 'Delete', danger: true },
    )
    if (!ok) return
    const gone = new Set(pages)
    await run('Could not delete the page', () =>
      t.docOp('Delete page', () => t.pdf.deletePages(pages), (an) =>
        an.filter((a) => !gone.has(a.page)).map((a) => ({ ...a, page: a.page - pages.filter((p) => p < a.page).length })),
      ),
    )
  }

  const rotatePages = (t: PdfTab, pages: number[], delta: number) => {
    const before = t.pdf.pages.slice()
    const set = new Set(pages)
    return run('Could not rotate', () =>
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
    return run('Could not move the page', async () => {
      await t.docOp('Move page', () => t.pdf.rearrangePages(order), (an) => an.map((a) => ({ ...a, page: where.get(a.page) ?? a.page })))
      t.goto(where.get(from) ?? to)
    })
  }

  const mergePdf = async (t: PdfTab) => {
    const p = await os.dialog.openFile({ title: 'Insert a PDF after the current page', startDir: t.path ? path.dirname(t.path) : `${HOME}/Documents`, extensions: ['.pdf'] })
    if (!p) return
    const at = t.view.page + 1
    await run(`Could not insert ${path.basename(p)}`, async () => {
      const bytes = await fs.readBytes(p)
      let password = ''
      for (;;) {
        try {
          const r = await t.docOp(`Insert ${path.basename(p)}`, () => t.pdf.insertPdf(bytes, at, { password, detach: true }), (an, res) => [
            ...shiftFrom(an, at, res.count),
            ...res.annotations.map((a) => ({ ...a, id: newAnnotId() })),
          ])
          setStatus(`Inserted ${r.count} page${r.count === 1 ? '' : 's'} from ${path.basename(p)}`)
          t.goto(at)
          return
        } catch (e) {
          if (!(e instanceof PdfPasswordError)) throw e
          const f = await ask({ title: 'Password required', message: `“${path.basename(p)}” is protected by a password.`, fields: [{ key: 'pw', label: 'Password', value: '', type: 'password' }], ok: 'Insert' })
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
    const dir = await os.dialog.pickFolder({ title: 'Choose a folder for the pages', startDir: t.path ? path.dirname(t.path) : `${HOME}/Documents` })
    if (!dir) return
    await run('Could not split', async () => {
      const n = t.pdf.pageCount
      const width = String(n).length
      setStatus('Splitting…')
      for (let i = 0; i < n; i += 20) {
        const groups = [...Array(Math.min(20, n - i)).keys()].map((k) => [i + k])
        const files = await t.pdf.extractPages(groups, { annotations: t.annots })
        for (let k = 0; k < files.length; k++) await writeUnique(dir, `${stem(t.name)}_p${String(i + k + 1).padStart(width, '0')}.pdf`, files[k])
      }
      setStatus(`Wrote ${n} file${n === 1 ? '' : 's'} to ${path.pretty(dir)}`)
    })
  }

  const extractPages = async (t: PdfTab) => {
    const n = t.pdf.pageCount
    const r = await ask({
      title: 'Extract pages',
      message: `Pages to put in a new PDF (1–${n}), e.g. 1, 3-5, 9`,
      fields: [{ key: 'range', label: 'Pages', value: `${t.view.page + 1}` }],
      ok: 'Extract',
    })
    if (!r) return
    const pages = parsePageRange(r.range, n)
    if (!pages.length) return void os.dialog.alert('No pages in that range.', { title: 'Extract pages' })
    const target = await os.dialog.saveFile({ title: 'Save extracted pages as', defaultName: `${t.path ? path.dirname(t.path) : `${HOME}/Documents`}/${stem(t.name)}_pages.pdf`, extensions: ['.pdf'] })
    if (!target) return
    await run('Could not extract', async () => {
      const [bytes] = await t.pdf.extractPages([pages], { annotations: t.annots })
      await fs.writeBytes(target, bytes)
      setStatus(`Extracted ${pages.length} page${pages.length === 1 ? '' : 's'} to ${path.pretty(target)}`)
    })
  }

  const watermark = async (t: PdfTab) => {
    const r = await ask({ title: 'Watermark every page', fields: [{ key: 'text', label: 'Text', value: 'DRAFT' }, { key: 'size', label: 'Size (pt)', value: '72' }], ok: 'Add watermark' })
    if (!r || !r.text.trim()) return
    const size = Math.max(8, Math.min(300, Number(r.size) || 72))
    await run('Could not add the watermark', () =>
      t.docOp('Watermark', () => t.pdf.stampText({ text: r.text.trim(), position: 'diagonal', size, color: '#808080', opacity: 0.35 })),
    )
  }

  const numberPages = (t: PdfTab) =>
    run('Could not number the pages', () =>
      t.docOp('Number pages', () => t.pdf.stampText({ text: '{n} / {total}', position: 'bottom', size: 10, color: '#333333' })),
    )

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
    await run('Could not redact', () =>
      t.docOp('Redact', () => t.pdf.applyRedactions(marks.map((m) => ({ page: m.page, rect: m.rect! }))), (an) => an.filter((a) => a.kind !== 'redact')),
    )
  }

  const insertImageBytes = async (t: PdfTab, raw: Uint8Array) => {
    const img = await pdfImage(raw)
    const page = t.view.page
    const info = t.pdf.pages[page]
    // At most 60 % of the page, centred (as the desktop app does).
    let w = Math.min(img.width * 0.75, info.width * 0.6)
    let h = (img.height * w) / img.width
    if (h > info.height * 0.6) {
      h = info.height * 0.6
      w = (img.width * h) / img.height
    }
    const x = info.x + (info.width - w) / 2
    const y = info.y + (info.height - h) / 2
    const a: PdfAnnot = { id: newAnnotId(), kind: 'image', page, color: '#000000', opacity: 1, width: 1, rect: [x, y, x + w, y + h], image: img.bytes }
    t.setAnnots([...t.annots, a], 'Insert picture')
    setTool('select')
    t.select([a.id])
  }

  const insertImage = async (t: PdfTab) => {
    const p = await os.dialog.openFile({ title: 'Insert picture', startDir: `${HOME}/Pictures`, extensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'] })
    if (!p) return
    await run('Could not insert the picture', async () => insertImageBytes(t, await fs.readBytes(p)))
  }

  const editOutline = (t: PdfTab, items: PdfOutlineItem[]) =>
    run('Could not change the bookmarks', async () => {
      await t.docOp('Edit bookmarks', () => t.pdf.setOutline(items))
      t.outlineCache = null
      t.emit()
    })

  const properties = async (t: PdfTab) => {
    const m = t.pdf.metadata
    const r = await ask({
      title: 'Document properties',
      fields: [
        { key: 'title', label: 'Title', value: m.title ?? '' },
        { key: 'author', label: 'Author', value: m.author ?? '' },
        { key: 'subject', label: 'Subject', value: m.subject ?? '' },
        { key: 'keywords', label: 'Keywords', value: m.keywords ?? '' },
      ],
      message: [m.creator && `Created with ${m.creator}`, m.producer && `PDF by ${m.producer}`, m.creationDate && new Date(m.creationDate).toLocaleString()].filter(Boolean).join(' · ') || undefined,
      ok: 'Save properties',
    })
    if (!r) return
    await run('Could not change the properties', () => t.docOp('Document properties', () => t.pdf.setMetadata(r)))
  }

  const exportText = async (t: PdfTab) => {
    const target = await os.dialog.saveFile({ title: 'Export text', defaultName: `${t.path ? path.dirname(t.path) : `${HOME}/Documents`}/${stem(t.name)}.txt`, extensions: ['.txt'] })
    if (!target) return
    await run('Could not export the text', async () => {
      const parts: string[] = []
      for (let i = 0; i < t.pdf.pageCount; i++) parts.push(await t.pdf.pageText(i))
      await fs.writeText(target, parts.join('\f'))
      setStatus(`Wrote the text of ${parts.length} page${parts.length === 1 ? '' : 's'} to ${path.pretty(target)}`)
    })
  }

  const exportImages = async (t: PdfTab) => {
    const n = t.pdf.pageCount
    const r = await ask({
      title: 'Export pages as pictures',
      fields: [
        { key: 'range', label: 'Pages', value: `1-${n}` },
        { key: 'dpi', label: 'Resolution (dpi)', value: '150' },
      ],
      ok: 'Continue',
    })
    if (!r) return
    const pages = parsePageRange(r.range, n)
    if (!pages.length) return void os.dialog.alert('No pages in that range.', { title: 'Export pages' })
    const format = await os.dialog.choose('Which format?', [
      { label: 'Cancel', value: 'cancel' },
      { label: 'JPEG (smaller)', value: 'jpeg' },
      { label: 'PNG (lossless)', value: 'png', primary: true },
    ], { title: 'Export pages' })
    if (format !== 'png' && format !== 'jpeg') return
    const dir = await os.dialog.pickFolder({ title: 'Choose a folder for the pictures', startDir: `${HOME}/Pictures` })
    if (!dir) return
    const dpi = Math.max(36, Math.min(600, Number(r.dpi) || 150))
    const width = String(n).length
    await run('Could not export the pages', async () => {
      for (let i = 0; i < pages.length; i += 8) {
        const chunk = pages.slice(i, i + 8)
        setStatus(`Exporting page ${chunk[0] + 1}…`)
        const files = await t.pdf.exportImages(chunk, { dpi, format, annotations: t.annots })
        for (let k = 0; k < files.length; k++) {
          await writeUnique(dir, `${stem(t.name)}_p${String(chunk[k] + 1).padStart(width, '0')}.${format === 'png' ? 'png' : 'jpg'}`, files[k])
        }
      }
      setStatus(`Wrote ${pages.length} picture${pages.length === 1 ? '' : 's'} to ${path.pretty(dir)}`)
    })
  }

  const compressedCopy = async (t: PdfTab) => {
    const target = await os.dialog.saveFile({ title: 'Save compressed copy', defaultName: `${t.path ? path.dirname(t.path) : `${HOME}/Documents`}/${stem(t.name)}_compressed.pdf`, extensions: ['.pdf'] })
    if (!target) return
    await run('Could not compress', async () => {
      const before = t.path ? (fs.stat(t.path)?.size ?? 0) : 0
      const bytes = await t.bytes({ compact: true })
      await fs.writeBytes(target, bytes)
      setStatus(before ? `Compressed: ${kb(before)} → ${kb(bytes.length)}` : `Saved ${path.pretty(target)} (${kb(bytes.length)})`)
    })
  }

  const encryptedCopy = async (t: PdfTab) => {
    const r = await ask({
      title: 'Password-protect a copy',
      message: 'AES-256. The open password is needed to view the copy; the owner password unlocks printing and editing restrictions. Leave the owner password empty to use the same one.',
      fields: [
        { key: 'user', label: 'Open password', value: '', type: 'password' },
        { key: 'owner', label: 'Owner password', value: '', type: 'password' },
      ],
      ok: 'Continue',
    })
    if (!r) return
    if (!r.user && !r.owner) return void os.dialog.alert('Type at least one password.', { title: 'Password-protect' })
    const target = await os.dialog.saveFile({ title: 'Save protected copy as', defaultName: `${t.path ? path.dirname(t.path) : `${HOME}/Documents`}/${stem(t.name)}_protected.pdf`, extensions: ['.pdf'] })
    if (!target) return
    await run('Could not protect the copy', async () => {
      await fs.writeBytes(target, await t.bytes({ encrypt: { userPassword: r.user, ownerPassword: r.owner } }))
      setStatus(`Saved a password-protected copy to ${path.pretty(target)}`)
    })
  }

  const print = async (t: PdfTab) => {
    await run('Could not print', async () => {
      const bytes = await t.bytes()
      // The browser's print dialog from a hidden frame: KherveOS stays where it is (no new tab).
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
      const frame = document.createElement('iframe')
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
      frame.src = url
      frame.onload = () => {
        try {
          frame.contentWindow?.focus()
          frame.contentWindow?.print()
          setStatus('Printing — choose a printer in the print dialog')
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

  const copySelection = async (t: PdfTab) => {
    const text = await t.selectedText()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setStatus('Copied the selected text')
    } catch (e) {
      fail('Could not copy', e)
    }
  }

  const deleteSelected = (t: PdfTab) => {
    if (!t.selected.size) return
    const n = t.selected.size
    t.setAnnots(t.annots.filter((a) => !t.selected.has(a.id)), n === 1 ? 'Delete annotation' : 'Delete annotations')
  }

  // ------------------------------------------------------------------ zoom

  const zoomBy = (k: number) => tab && tab.setZoom(tab.view.zoom * k, null)
  const zoomTo = (pct: number) => tab && tab.setZoom((pct / 100) * ACTUAL, null)
  const fit = (mode: 'width' | 'page') => tab && tab.setZoom(tab.view.zoom, mode)
  const zoomPct = tab ? Math.round((tab.view.zoom / ACTUAL) * 100) : 100

  const zoomMenu = (e: React.MouseEvent) =>
    os.contextMenu(e, [
      { label: 'Fit Width', checked: tab?.view.fit === 'width', onClick: () => fit('width') },
      { label: 'Fit Page', checked: tab?.view.fit === 'page', onClick: () => fit('page') },
      '-',
      ...ZOOM_PRESETS.map((p) => ({ label: `${p}%`, checked: !tab?.view.fit && zoomPct === p, onClick: () => zoomTo(p) })),
    ])

  // ------------------------------------------------------------- slideshow

  const startShow = (fullscreen: boolean) => {
    if (!tab) return setStatus('Open a PDF to start a slideshow')
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
    if (show && show.fullscreen === fullscreen) endShow(tab?.view.page ?? 0)
    else if (show) setShow({ ...show, fullscreen })
    else startShow(fullscreen)
  }
  const [showPage, setShowPage] = useState(0)

  // Switching tabs ends the show (it belongs to the tab it started on).
  useEffect(() => {
    setShow(null)
    setOptions(null)
  }, [activeKey])

  // --------------------------------------------------------------- menus

  const has = !!tab
  const pageMenuItems = (t: PdfTab, page: number): MenuItem[] => [
    { label: 'Insert Blank Page After', icon: FilePlus, onClick: () => void insertBlank(t, page) },
    { label: 'Delete Page', icon: Trash2, danger: true, disabled: t.pdf.pageCount <= 1, onClick: () => void deletePages(t, [page]) },
    '-',
    { label: 'Rotate Left', icon: RotateCcw, onClick: () => void rotatePages(t, [page], -90) },
    { label: 'Rotate Right', icon: RotateCw, onClick: () => void rotatePages(t, [page], 90) },
    '-',
    { label: 'Move Page Up', disabled: page === 0, onClick: () => void movePage(t, page, page - 1) },
    { label: 'Move Page Down', disabled: page >= t.pdf.pageCount - 1, onClick: () => void movePage(t, page, page + 1) },
  ]

  useEffect(() => {
    const t = tab
    const menus: MenuBarMenu[] = [
      {
        label: 'File',
        items: [
          { label: 'New', icon: FilePlus, onClick: () => void newDoc() },
          { label: 'Open…', icon: FolderOpen, shortcut: '⌘O', onClick: () => void openDialog() },
          {
            label: 'Open Recent',
            submenu: recent.length
              ? [
                  ...recent.map((p): MenuItem => ({ label: path.basename(p), disabled: !fs.exists(p), onClick: () => void openPath(p) })),
                  '-',
                  { label: 'Clear List', onClick: () => setRecent(pushRecentClear()) },
                ]
              : [{ label: '(empty)', disabled: true }],
          },
          '-',
          { label: 'Save', icon: Save, shortcut: '⌘S', disabled: !t, onClick: () => t && void saveTab(t) },
          { label: 'Save As…', shortcut: '⇧⌘S', disabled: !t, onClick: () => t && void saveTab(t, true) },
          { label: 'Download to Computer', icon: Download, disabled: !t, onClick: () => t && void download(t) },
          '-',
          { label: 'Export Pages as Pictures…', disabled: !t, onClick: () => t && void exportImages(t) },
          { label: 'Export Text…', disabled: !t, onClick: () => t && void exportText(t) },
          { label: 'Save Compressed Copy…', disabled: !t, onClick: () => t && void compressedCopy(t) },
          { label: 'Save Password-Protected Copy…', icon: Lock, disabled: !t, onClick: () => t && void encryptedCopy(t) },
          { label: 'Print…', icon: Printer, disabled: !t, onClick: () => t && void print(t) },
          '-',
          { label: 'Document Properties…', disabled: !t, onClick: () => t && void properties(t) },
          '-',
          { label: 'Close Tab', disabled: !t, onClick: () => t && void closeTab(t) },
          { label: 'Close Window', onClick: () => win.close() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: t?.canUndo ? `Undo ${t.undoLabel}` : 'Undo', icon: Undo2, shortcut: '⌘Z', disabled: !t?.canUndo, onClick: () => t && void t.undo() },
          { label: t?.canRedo ? `Redo ${t.redoLabel}` : 'Redo', icon: Redo2, shortcut: '⇧⌘Z', disabled: !t?.canRedo, onClick: () => t && void t.redo() },
          '-',
          { label: 'Copy Selected Text', shortcut: '⌘C', disabled: !t?.textSel, onClick: () => t && void copySelection(t) },
          { label: 'Select All Text on Page', shortcut: '⌘A', disabled: !t, onClick: () => t && selectAllOnPage(t, t.view.page) },
          { label: 'Highlight Selected Text', disabled: !t?.textSel, onClick: () => t && markSelection(t, 'highlight', settings) },
          { label: 'Underline Selected Text', disabled: !t?.textSel, onClick: () => t && markSelection(t, 'underline', settings) },
          { label: 'Strike Out Selected Text', disabled: !t?.textSel, onClick: () => t && markSelection(t, 'strikeout', settings) },
          '-',
          { label: 'Delete Selected Annotations', icon: Trash2, shortcut: '⌫', disabled: !t?.selected.size, onClick: () => t && deleteSelected(t) },
          '-',
          { label: 'Find…', icon: Search, shortcut: '⌘F', disabled: !t, onClick: () => setFind((f) => ({ focusKey: (f?.focusKey ?? 0) + 1 })) },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Zoom In', icon: ZoomIn, shortcut: '⌘+', disabled: !t, onClick: () => zoomBy(1.25) },
          { label: 'Zoom Out', icon: ZoomOut, shortcut: '⌘−', disabled: !t, onClick: () => zoomBy(1 / 1.25) },
          { label: 'Actual Size', disabled: !t, onClick: () => zoomTo(100) },
          { label: 'Fit Width', icon: Columns2, shortcut: '⌘0', checked: t?.view.fit === 'width', disabled: !t, onClick: () => fit('width') },
          { label: 'Fit Page', checked: t?.view.fit === 'page', disabled: !t, onClick: () => fit('page') },
          '-',
          { label: 'Go to Page…', disabled: !t, onClick: () => t && void goToPage(t) },
          { label: 'Show Side Panel', icon: PanelLeft, checked: prefs.sidebar, onClick: () => setPrefs({ sidebar: !prefs.sidebar }) },
          '-',
          {
            label: 'Slideshow',
            icon: Presentation,
            submenu: [
              { label: 'Normal View', checked: !show, onClick: () => show && endShow(t?.view.page ?? 0) },
              { label: 'Slideshow in Window', icon: MonitorPlay, shortcut: '⇧F5', checked: !!show && !show.fullscreen, disabled: !t, onClick: () => toggleShow(false) },
              { label: 'Slideshow Full Screen', icon: Maximize2, shortcut: 'F5', checked: !!show?.fullscreen, disabled: !t, onClick: () => toggleShow(true) },
              '-',
              { label: 'Continuous — advance automatically', icon: Timer, checked: prefs.slide.continuous, onClick: () => setPrefs({ slide: { ...prefs.slide, continuous: !prefs.slide.continuous } }) },
              { label: 'Loop back to the first page', checked: prefs.slide.loop, onClick: () => setPrefs({ slide: { ...prefs.slide, loop: !prefs.slide.loop } }) },
            ],
          },
        ],
      },
      {
        label: 'Tools',
        items: [
          ...TOOLS.map((d): MenuItem => ({ label: d.label, icon: d.icon, checked: tool === d.id, onClick: () => setTool(d.id) })),
          '-',
          { label: 'Apply Redactions…', disabled: !t, onClick: () => t && void applyRedactions(t) },
          { label: 'Insert Picture…', icon: ImagePlus, disabled: !t, onClick: () => t && void insertImage(t) },
        ],
      },
      {
        label: 'Pages',
        items: t
          ? [
              ...pageMenuItems(t, t.view.page),
              '-',
              { label: 'Insert PDF…', icon: Merge, onClick: () => void mergePdf(t) },
              { label: 'Split into One PDF per Page…', icon: Scissors, onClick: () => void splitPdf(t) },
              { label: 'Extract Pages…', onClick: () => void extractPages(t) },
              '-',
              { label: 'Watermark Every Page…', onClick: () => void watermark(t) },
              { label: 'Number Every Page', onClick: () => void numberPages(t) },
            ]
          : [{ label: 'Open a PDF first', disabled: true }],
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
    if (e.key === 'F5') {
      e.preventDefault()
      toggleShow(!e.shiftKey)
      return
    }
    if (mod && k === 'o') {
      e.preventDefault()
      void openDialog()
      return
    }
    if (!t) return
    if (mod && k === 's') {
      e.preventDefault()
      void saveTab(t, e.shiftKey)
    } else if (mod && k === 'f') {
      e.preventDefault()
      setFind((f) => ({ focusKey: (f?.focusKey ?? 0) + 1 }))
    } else if (mod && (k === '=' || k === '+')) {
      e.preventDefault()
      zoomBy(1.25)
    } else if (mod && k === '-') {
      e.preventDefault()
      zoomBy(1 / 1.25)
    } else if (mod && k === '0') {
      e.preventDefault()
      fit('width')
    } else if (typing) {
      return
    } else if (mod && k === 'z') {
      e.preventDefault()
      void (e.shiftKey ? t.redo() : t.undo())
    } else if (mod && k === 'y') {
      e.preventDefault()
      void t.redo()
    } else if (mod && k === 'c' && t.textSel) {
      e.preventDefault()
      void copySelection(t)
    } else if (mod && k === 'a') {
      e.preventDefault()
      selectAllOnPage(t, t.view.page)
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && t.selected.size) {
      e.preventDefault()
      deleteSelected(t)
    } else if (e.key === 'Escape') {
      if (t.selected.size) t.select([])
      else if (t.textSel) t.setTextSel(null)
      else if (find) setFind(null)
    }
  }

  const onPaste = (e: React.ClipboardEvent) => {
    const t = live.current.tab
    if (!t || (e.target as HTMLElement).closest('input, textarea')) return
    const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
    if (file) {
      e.preventDefault()
      void file.arrayBuffer().then((b) => run('Could not paste the picture', () => insertImageBytes(t, new Uint8Array(b))))
      return
    }
    const text = e.clipboardData.getData('text/plain').replace(/\s+$/, '')
    if (!text) return
    e.preventDefault()
    // At the last click on the page in view, else near its top-left corner.
    const at = t.lastClick && t.lastClick.page === t.view.page ? t.lastClick : null
    const info = t.pdf.pages[t.view.page]
    const s = live.current.settings.text
    const a: PdfAnnot = {
      id: newAnnotId(), kind: 'text', page: t.view.page, color: s.color, opacity: 1, width: 0, fontSize: s.width, font: 'Helv', text,
      rect: fitTextRect(at ? at.x : info.x + 72, at ? at.y : info.y + 72, text, s.width),
    }
    t.setAnnots([...t.annots, a], 'Paste text')
    setStatus('Pasted the text as a text box')
  }

  // ------------------------------------------------------- drag and drop

  const isPdfDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(DRAG_MIME)
  const onDragOver = (e: React.DragEvent) => {
    if (!isPdfDrag(e) || e.dataTransfer.types.includes('application/x-khervepdf-page')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!dropping) setDropping(true)
  }
  const onDrop = (e: React.DragEvent) => {
    setDropping(false)
    if (!isPdfDrag(e)) return
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
    if (!files.length) return setStatus('Only PDF files can be opened here')
    void os.importFiles(`${HOME}/Downloads`, files).then((paths) => paths.forEach((p) => void openPath(p)))
  }

  // ------------------------------------------------------------- render

  const toolDef = TOOL_BY_ID[tool]
  const hasOptions = !!toolDef.options
  const setting = settings[tool]

  const toolbar = (
    <div className="k-toolbar kp-toolbar">
      <button className="k-icon-btn" title="Open PDF (⌘O)" onClick={() => void openDialog()}><FolderOpen size={17} /></button>
      <button className="k-icon-btn" title="Save (⌘S)" disabled={!has} onClick={() => tab && void saveTab(tab)}><Save size={17} /></button>
      <span className="k-sep" />
      <button className="k-icon-btn" title={tab?.canUndo ? `Undo ${tab.undoLabel} (⌘Z)` : 'Undo (⌘Z)'} disabled={!tab?.canUndo} onClick={() => tab && void tab.undo()}><Undo2 size={17} /></button>
      <button className="k-icon-btn" title={tab?.canRedo ? `Redo ${tab.redoLabel} (⇧⌘Z)` : 'Redo (⇧⌘Z)'} disabled={!tab?.canRedo} onClick={() => tab && void tab.redo()}><Redo2 size={17} /></button>
      <span className="k-sep" />
      <button className={`k-icon-btn${prefs.sidebar ? ' active' : ''}`} title="Show or hide the side panel" disabled={!has} onClick={() => setPrefs({ sidebar: !prefs.sidebar })}><PanelLeft size={17} /></button>
      <span className="k-sep" />
      <div className="kp-tools">
        {TOOLS.map((d) => (
          <button key={d.id} className={`k-icon-btn${tool === d.id ? ' active' : ''}`} title={d.tip} onClick={() => setTool(d.id)}>
            <d.icon size={17} />
          </button>
        ))}
      </div>
      <button
        className="kp-options-btn"
        title={hasOptions ? `${toolDef.label} options — colour, width…` : 'This tool has no options'}
        disabled={!hasOptions}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setOptions((o) => (o ? null : { left: r.left, top: r.bottom + 6 }))
        }}
      >
        <span className="kp-options-swatch" style={{ background: hasOptions ? setting.color : 'transparent' }} />
        <ChevronDown size={13} />
      </button>
      {tool === 'redact' && tab && (
        <button className="k-btn small kp-apply-redact" onClick={() => void applyRedactions(tab)}>Apply redactions</button>
      )}
      <span className="k-spacer" />
      <button className={`k-icon-btn${find ? ' active' : ''}`} title="Find (⌘F)" disabled={!has} onClick={() => setFind((f) => (f ? null : { focusKey: 1 }))}><Search size={17} /></button>
      <span className="k-sep" />
      <button className="k-icon-btn" title="Zoom out (⌘−)" disabled={!has} onClick={() => zoomBy(1 / 1.25)}><ZoomOut size={17} /></button>
      <button className="kp-zoom" title="Zoom" disabled={!has} onClick={zoomMenu}>
        {tab?.view.fit === 'width' ? 'Fit width' : tab?.view.fit === 'page' ? 'Fit page' : `${zoomPct}%`}
        <ChevronDown size={12} />
      </button>
      <button className="k-icon-btn" title="Zoom in (⌘+)" disabled={!has} onClick={() => zoomBy(1.25)}><ZoomIn size={17} /></button>
      <button className={`k-icon-btn${tab?.view.fit === 'width' ? ' active' : ''}`} title="Fit width (⌘0)" disabled={!has} onClick={() => fit('width')}><Columns2 size={17} /></button>
      <span className="k-sep" />
      <button className="k-icon-btn" title="Slideshow full screen (F5)" disabled={!has} onClick={() => startShow(true)}><Presentation size={17} /></button>
    </div>
  )

  const tabBar = tabs.length > 0 && (
    <div className="kp-tabs" role="tablist">
      {tabs.map((t) => (
        <TabButton
          key={t.key}
          t={t}
          active={t === tab}
          onActivate={() => setActiveKey(t.key)}
          onClose={() => void closeTab(t)}
          onMenu={(e) =>
            os.contextMenu(e, [
              { label: 'Close', onClick: () => void closeTab(t) },
              { label: 'Close Other Tabs', disabled: tabs.length < 2, onClick: () => tabs.filter((x) => x !== t).forEach((x) => void closeTab(x)) },
              '-',
              { label: 'Show in Files', disabled: !t.path, onClick: () => t.path && os.open('files', { path: t.path }) },
            ])
          }
        />
      ))}
    </div>
  )

  const welcome = (
    <div className="kp-welcome">
      <div className="kp-welcome-card">
        <div className="kp-welcome-head">
          <img src="/icons/apps/khervepdf.png" alt="" className="k-appicon-img kp-welcome-icon" draggable={false} />
          <div>
            <h1>KhervePDF</h1>
            <p className="k-muted">View, annotate and edit PDFs</p>
          </div>
        </div>
        <div className="kp-welcome-actions">
          <button className="k-btn primary" onClick={() => void openDialog()}><FolderOpen size={16} /> Open PDF…</button>
          <button className="k-btn" onClick={() => void newDoc()}><FilePlus size={16} /> New</button>
        </div>
        {recent.filter((p) => fs.exists(p)).length > 0 && (
          <div className="kp-recent">
            <div className="kp-recent-title k-muted">Recent</div>
            {recent.filter((p) => fs.exists(p)).map((p) => (
              <button key={p} className="kp-recent-item" title={path.pretty(p)} onClick={() => void openPath(p)}>
                <FileText size={15} />
                <span className="kp-recent-name">{path.basename(p)}</span>
                <span className="kp-recent-dir k-muted">{path.pretty(path.dirname(p))}</span>
              </button>
            ))}
          </div>
        )}
        <p className="k-muted kp-welcome-hint">{opening ?? 'or drop a PDF on this window'}</p>
      </div>
    </div>
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
      {!show && tabBar}
      <div className="kp-body">
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
            onToggleFullscreen={() => setShow((s) => (s ? { ...s, fullscreen: !s.fullscreen } : s))}
            onExit={endShow}
          />
        ) : (
          <>
            {prefs.sidebar && (
              <Sidebar
                tab={tab}
                onClose={() => setPrefs({ sidebar: false })}
                onMovePage={(from, to) => void movePage(tab, from, to)}
                onPageMenu={(e, page) => os.contextMenu(e, pageMenuItems(tab, page))}
                onEditOutline={(items) => void editOutline(tab, items)}
              />
            )}
            <div className="kp-main">
              <PageView key={tab.key} tab={tab} tool={tool} settings={settings} onStatus={setStatus} />
              {find && <FindBar tab={tab} focusKey={find.focusKey} onClose={() => {
                setFind(null)
                tab.search = null
                tab.emit()
              }} />}
              {opening && <div className="kp-opening">{opening}</div>}
            </div>
          </>
        )}
      </div>
      <div className="k-statusbar kp-status">
        {tab ? (
          <>
            <button className="kp-status-btn" title="Go to page…" onClick={() => void goToPage(tab)}>
              Page {(show ? showPage : tab.view.page) + 1} of {tab.pdf.pageCount}
              {tab.pdf.pages[tab.view.page]?.label !== String(tab.view.page + 1) && tab.pdf.pages[tab.view.page] ? ` (${tab.pdf.pages[tab.view.page].label})` : ''}
            </button>
            <span>{tab.busy ? `${tab.busy}…` : tab.dirty ? 'Edited' : tab.path ? 'Saved' : 'Not saved yet'}</span>
          </>
        ) : (
          <span>{opening ?? 'No document'}</span>
        )}
        <span className="kp-status-msg">{status}</span>
        <span className="k-spacer" />
        {tab && <span>{toolDef.label}</span>}
        {tab && <span>{zoomPct}%</span>}
        <div className="kp-views">
          <button className={!show ? 'active' : ''} title="Normal view" disabled={!has} onClick={() => show && endShow(tab?.view.page ?? 0)}><PanelLeft size={13} /></button>
          <button className={show && !show.fullscreen ? 'active' : ''} title="Slideshow in this window (⇧F5)" disabled={!has} onClick={() => toggleShow(false)}><MonitorPlay size={13} /></button>
          <button className={show?.fullscreen ? 'active' : ''} title="Slideshow full screen (F5)" disabled={!has} onClick={() => toggleShow(true)}><Maximize2 size={13} /></button>
          <span className="kp-views-sep" />
          <button
            className={prefs.slide.continuous ? 'active' : ''}
            title="Continuous: turn the page automatically"
            onClick={() => setPrefs({ slide: { ...prefs.slide, continuous: !prefs.slide.continuous } })}
          >
            <Timer size={13} />
          </button>
          <input
            className="kp-views-secs"
            type="number"
            min={INTERVAL_MIN}
            max={INTERVAL_MAX}
            title="Seconds each page stays on screen in a continuous slideshow"
            value={prefs.slide.seconds}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const v = Math.round(Number(e.target.value))
              if (v >= INTERVAL_MIN && v <= INTERVAL_MAX) setPrefs({ slide: { ...prefs.slide, seconds: v } })
            }}
          />
          <span className="k-muted">s</span>
        </div>
      </div>
      {options && hasOptions && (
        <ToolOptions tool={tool} setting={setting} anchor={options} onChange={(s) => updateSetting(tool, s)} onClose={() => setOptions(null)} />
      )}
      {form && <FormDialog spec={form} onClose={() => setForm(null)} />}
      {dropping && <div className="kp-drop-hint">Drop PDFs to open them</div>}
    </div>
  )
}

function TabButton({ t, active, onActivate, onClose, onMenu }: {
  t: PdfTab
  active: boolean
  onActivate: () => void
  onClose: () => void
  onMenu: (e: React.MouseEvent) => void
}) {
  useTab(t)
  return (
    <div
      role="tab"
      aria-selected={active}
      className={`kp-tab${active ? ' active' : ''}`}
      title={t.path ? path.pretty(t.path) : t.name}
      onClick={onActivate}
      onAuxClick={(e) => e.button === 1 && onClose()}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e)
      }}
    >
      <FileText size={13} className="kp-tab-icon" />
      <span className="kp-tab-name">{t.name}</span>
      {t.dirty && <span className="kp-tab-dirty" title="Edited">•</span>}
      <button
        className="kp-tab-close"
        title="Close"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        <X size={12} />
      </button>
    </div>
  )
}

function pushRecentClear(): string[] {
  try {
    localStorage.setItem(RECENT_KEY, '[]')
  } catch {
    /* private mode */
  }
  return []
}
