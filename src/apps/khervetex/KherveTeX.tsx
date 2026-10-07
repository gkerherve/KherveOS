// KherveTeX: WYSIWYG documents typeset with LaTeX — the desktop KherveTeX
// (Python package khervedoc) in KherveOS.
//
// The document model (model.ts) is the single source of truth, as on the
// desktop: the visual editor (TipTap) shows it, serializer.ts turns it into
// exactly the LaTeX the desktop writes, and the KherveOS server typesets that
// with tectonic (os/services/latex.ts). Files are .ktex archives, the same as
// the desktop's (ktex.ts).

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Editor, JSONContent } from '@tiptap/core'
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView as CMView } from '@codemirror/view'
import { strFromU8 } from 'fflate'
import {
  BookOpen, Download, FileDown, FilePlus, FileText, FolderOpen, Keyboard, Printer, Save, Search, Settings2, ZoomIn, ZoomOut,
} from 'lucide-react'
import { os, fs, path, HOME, type AppProps, type MenuBarMenu, type MenuItem } from '@/os'
import { DRAG_MIME } from '@/os/fileActions'
import { useAuth } from '@/os/server'
import { compileLatex, latexStatus, type LatexError } from '@/os/services/latex'
import {
  blankDocument, classSupportsChapter, fromJson, HIGHLIGHT_COLORS, plainText, toJson, type DocMeta, type Document,
} from './model'
import { escapeText, latexToDisplay, serializeDocument } from './serializer'
import { pageSizeByCode } from './pageSizes'
import { BIB_FILE, docStem, figureFiles, isBundlePath, isLegacyBundle, readBundle, writeBundle, writeLatexZip, type Bundle } from './ktex'
import {
  applyCompileRange, applyNotCompileRanges, COMPILE_END, COMPILE_START, hasCompileMarkers, NOT_COMPILE_END, NOT_COMPILE_START, stripImages,
} from './compileTools'
import { createExtensions, refreshKey, type EditKind, type KtxEnv } from './editor/extensions'
import { docToEditor, editorToModel } from './editor/convert'
import { bibSources, parseBibtex, shortAuthor } from './references'
import { adoptSerializerPreamble, expandIncludes, importTex } from './importer'
import { isDisplayable, mimeOf, nextFigurePath, PICTURE_EXTENSIONS, toLatexPicture } from './figures'
import { EXAMPLES, loadExample } from './examples/index'
import { TEXT_MODE_SYMBOLS } from './symbols'
import {
  CitationDialog, CrossRefDialog, FigureDialog, LinkDialog, MATH_ENVIRONMENTS, MathDialog, SettingsDialog, SymbolPalette,
  TableInsertDialog, TablePropsDialog, TextDialog,
  type Done, type FigureResult, type MathResult, type TableInsertResult, type TablePropsResult,
} from './ui/dialogs'
import { CodeTab, ConsoleTab, FindBar, PdfPanel, revealLine, type CompileView } from './ui/panels'
import { SideToolbar, STYLES, TopToolbar, type EditorSnapshot, type StyleCode } from './ui/Toolbar'
import './khervetex.css'

type Tab = 'visual' | 'code' | 'console'

const OPENABLE = ['.ktex', '.ktexz', '.kdocz', '.json', '.tex']
const AUX_EXTENSIONS = ['.bib', '.cls', '.sty', '.bst']
const MULTICOL_REGION =
  '\\begin{multicols}{2}\n' +
  'Replace this paragraph with the content that should flow across two columns. Add as many paragraphs as you like — ' +
  'everything between \\begin{multicols} and \\end{multicols} is balanced into the two columns automatically.\n' +
  '\\end{multicols}'

const NO_SNAPSHOT: EditorSnapshot = {
  bold: false, italic: false, underline: false, strike: false, code: false, smallcaps: false, subscript: false, superscript: false,
  align: null, style: null, numbered: null, bullet: false, ordered: false, canUndo: false, canRedo: false, inTable: false,
  hasSelection: false, inComment: false,
}

function snapshot(e: Editor): EditorSnapshot {
  const { $from, empty } = e.state.selection
  const parent = $from.parent
  let style: StyleCode | null = null
  let align: string | null = null
  let numbered: boolean | null = null
  switch (parent.type.name) {
    case 'paragraph':
      style = 'body'
      align = (parent.attrs.textAlign as string | null) ?? 'justify'
      break
    case 'section': {
      const level = Number(parent.attrs.level) || 0
      style = level === 0 ? 'chapter' : (`h${Math.min(5, level)}` as StyleCode)
      numbered = !!parent.attrs.numbered
      break
    }
    case 'title': case 'author': case 'affiliation': case 'correspondence': case 'abstract': case 'keywords': case 'frame':
      style = parent.type.name as StyleCode
      break
  }
  return {
    bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'),
    code: e.isActive('code'), smallcaps: e.isActive('smallcaps'), subscript: e.isActive('subscript'), superscript: e.isActive('superscript'),
    align, style, numbered,
    bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'),
    canUndo: e.can().undo(), canRedo: e.can().redo(),
    inTable: e.isActive('table'),
    hasSelection: !empty && !(e.state.selection instanceof NodeSelection),
    inComment: e.isActive('comment'),
  }
}

/** Python's datetime.now().isoformat(timespec="seconds"), as the desktop stamps comments. */
function localIsoSeconds(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** The editor's font for the document (the desktop's screen_font_for). */
function fontStack(m: DocMeta): string {
  const stacks: Record<string, string> = {
    default: "'KaTeX_Main', 'Latin Modern Roman', 'CMU Serif', 'Times New Roman', serif",
    times: "'Times New Roman', Times, 'TeX Gyre Termes', serif",
    palatino: "'Palatino Linotype', Palatino, 'Book Antiqua', 'TeX Gyre Pagella', serif",
    helvetica: "Helvetica, Arial, 'TeX Gyre Heros', sans-serif",
    courier: "'Courier New', Courier, monospace",
    charter: "Charter, 'Bitstream Charter', XCharter, serif",
    libertine: "'Linux Libertine O', 'Libertinus Serif', 'Linux Libertine', serif",
  }
  const base = stacks[m.body_font_family] ?? stacks.default
  const chosen = m.visual_font_family
  return chosen && chosen !== 'Georgia' ? `'${chosen.replace(/'/g, '')}', ${base}` : base
}

/** LaTeX's distance between lines as a multiple of the font size (latex_fonts.baselineskip_pt). */
function lineHeight(m: DocMeta): number {
  const skip: Record<number, number> = { 10: 12.0, 11: 13.6, 12: 14.5 }
  const onehalf: Record<number, number> = { 10: 1.25, 11: 1.213, 12: 1.241 }
  const double: Record<number, number> = { 10: 1.667, 11: 1.618, 12: 1.655 }
  const size = [10, 11, 12].reduce((a, b) => (Math.abs(b - m.body_font_pt) < Math.abs(a - m.body_font_pt) ? b : a))
  let stretch = m.line_spacing || 1
  if (Math.abs(m.line_spacing - 1.5) < 0.01) stretch = onehalf[size]
  else if (Math.abs(m.line_spacing - 2) < 0.01) stretch = double[size]
  return (skip[size] / size) * stretch
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export default function KherveTeX({ win, args }: AppProps) {
  const initial = useMemo(() => blankDocument(), [])
  const [meta, setMeta] = useState<DocMeta>(initial.meta)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [docName, setDocName] = useState('Untitled')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(!!(args.path || args.example || args.importTex))
  const [latex, setLatex] = useState(() => serializeDocument(initial))
  const [words, setWords] = useState(0)
  const [tab, setTab] = useState<Tab>('visual')
  const [showPdf, setShowPdf] = useState(true)
  const [pdfWidth, setPdfWidth] = useState(45)
  const [autoCompile, setAutoCompile] = useState(true)
  const [skipImages, setSkipImages] = useState(false)
  const [compileRange, setCompileRange] = useState(true)
  const [showMarks, setShowMarks] = useState(false)
  const [spell, setSpell] = useState(true)
  const [zoom, setZoom] = useState(100)
  const [fitWidth, setFitWidth] = useState(true)
  const [fitZoom, setFitZoom] = useState(100)
  const [findOpen, setFindOpen] = useState(false)
  const [symbolsOpen, setSymbolsOpen] = useState(false)
  const [compileView, setCompileView] = useState<CompileView>({ running: false, ok: null, errors: [], log: '', at: null })
  const [pdf, setPdf] = useState<{ url: string; bytes: Uint8Array } | null>(null)
  const [pdfNotice, setPdfNotice] = useState<string | null>(null)
  const [dialog, setDialog] = useState<ReactNode>(null)
  const [dragging, setDragging] = useState(false)
  const [codeDraft, setCodeDraft] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)

  const files = useRef(new Map<string, Uint8Array>())
  const urls = useRef(new Map<string, string>())
  const extra = useRef<{ bib: string; project: string | null }>({ bib: '', project: null })
  const bibTexts = useRef<string[]>([])
  const savedJson = useRef(toJson(initial))
  const model = useRef<Document>(initial)
  const compiler = useRef({ running: false, pending: false, lastOk: '', lastFailed: '' })
  const timers = useRef<{ refresh?: number; compile?: number; code?: number }>({})
  /** The folder an imported .tex came from: its pictures, .bib and .cls files compile with it. */
  const importDir = useRef<string | null>(null)
  const codeView = useRef<CMView | null>(null)
  const codeDraftRef = useRef<string | null>(null)
  /** Code-tab text not yet read back into the document. */
  const codePending = useRef(false)
  const visualRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<HTMLDivElement>(null)
  const lastPointer = useRef({ clientX: 200, clientY: 120 })
  const live = useRef({ meta, filePath, dirty, autoCompile, skipImages, compileRange, showPdf, tab, pdf, latex })
  live.current = { meta, filePath, dirty, autoCompile, skipImages, compileRange, showPdf, tab, pdf, latex }

  // ------------------------------------------------------------- the editor

  const handlers = useRef({
    edit: (_kind: EditKind, _pos: number) => {},
    action: (_name: string) => false as boolean,
    update: () => {},
    contextMenu: (_view: EditorView, _e: MouseEvent) => {},
    drop: (_view: EditorView, _e: DragEvent) => false as boolean,
    paste: (_e: ClipboardEvent) => false as boolean,
  })

  const env = useMemo<KtxEnv>(
    () => ({
      figureUrl: (p) => figureUrl(p),
      hasFile: (p) => files.current.has(p),
      edit: (kind, pos) => handlers.current.edit(kind, pos),
      action: (name) => handlers.current.action(name),
      get bibTexts() {
        return bibTexts.current
      },
    }),
    [],
  )
  const extensions = useMemo(() => createExtensions(() => env), [env])

  // One options object for the editor's life: TipTap re-applies options that change identity.
  const editorOptions = useMemo(
    () => ({
      extensions,
      content: docToEditor(initial),
      editorProps: {
        attributes: { class: 'ktx-prose', spellcheck: 'true' },
        handleDOMEvents: {
          contextmenu: (view: EditorView, e: MouseEvent) => {
            handlers.current.contextMenu(view, e)
            return true
          },
        },
        handleDrop: (view: EditorView, e: DragEvent, _slice: unknown, moved: boolean) => !moved && handlers.current.drop(view, e),
        handlePaste: (_view: EditorView, e: ClipboardEvent) => handlers.current.paste(e),
      },
      onUpdate: () => handlers.current.update(),
    }),
    [extensions, initial],
  )
  const editor = useEditor(editorOptions, [])
  const edRef = useRef<Editor | null>(editor)
  edRef.current = editor

  const st = useEditorState({ editor, selector: ({ editor: e }) => (e ? snapshot(e) : NO_SNAPSHOT) }) ?? NO_SNAPSHOT

  function figureUrl(p: string): string | null {
    const cached = urls.current.get(p)
    if (cached) return cached
    const data = files.current.get(p)
    if (!data || !isDisplayable(p)) return null
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mimeOf(p) }))
    urls.current.set(p, url)
    return url
  }

  /** The document as it is now (fresh from the editor, with any Code-tab edit read in). */
  function currentModel(): Document {
    flushCode()
    const ed = edRef.current
    if (!ed || ed.isDestroyed) return model.current
    model.current = editorToModel(ed.state.doc, live.current.meta)
    return model.current
  }

  function refresh() {
    const m = currentModel()
    setLatex(serializeDocument(m))
    setDirty(toJson(m) !== savedJson.current)
    let n = 0
    for (const b of m.children) if ('children' in b) n += plainText(b.children).split(/\s+/).filter(Boolean).length
    setWords(n)
    if (live.current.autoCompile && live.current.showPdf) scheduleCompile()
  }

  function scheduleRefresh(delay = 200) {
    window.clearTimeout(timers.current.refresh)
    timers.current.refresh = window.setTimeout(refresh, delay)
  }

  function updateMeta(patch: Partial<DocMeta>) {
    const next = { ...live.current.meta, ...patch }
    live.current.meta = next
    setMeta(next)
    scheduleRefresh(0)
  }

  function ensurePackage(name: string) {
    const m = live.current.meta
    if (!m.packages.includes(name) && !m.preamble_extras.includes(`{${name}}`)) updateMeta({ packages: [...m.packages, name] })
  }

  // --------------------------------------------------------------- compiling

  function scheduleCompile(delay = 1200) {
    window.clearTimeout(timers.current.compile)
    timers.current.compile = window.setTimeout(() => void compile(false), delay)
  }

  async function compileFiles(m: Document, tex: string, withImages: boolean): Promise<Record<string, string | Uint8Array>> {
    const out: Record<string, string | Uint8Array> = { 'document.tex': tex }
    if (withImages) for (const [p, data] of figureFiles(m, files.current)) out[p] = data
    if (m.meta.ref_library && extra.current.bib) out[BIB_FILE] = extra.current.bib
    // Like the desktop: .bib, .cls, .sty and .bst files beside the document go along.
    const fp = live.current.filePath
    const dir = fp ? path.dirname(fp) : importDir.current
    if (dir) {
      try {
        for (const s of fs.list(dir)) {
          if (s.type === 'file' && s.size < 8 * 2 ** 20 && AUX_EXTENSIONS.includes(path.extname(s.name)) && !(s.name in out)) {
            out[s.name] = await fs.readBytes(s.path)
          }
        }
      } catch {
        // the folder is gone
      }
    }
    return out
  }

  function showPdfBytes(bytes: Uint8Array) {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
    setPdf((old) => {
      if (old) window.setTimeout(() => URL.revokeObjectURL(old.url), 15_000)
      return { url, bytes }
    })
  }

  /** The desktop keeps <name>.pdf beside the document, so it opens instantly next time. */
  async function cachePdf(fp: string, bytes: Uint8Array) {
    const dir = path.dirname(fp)
    if (!fs.isDir(dir)) return
    try {
      await fs.writeBytes(path.join(dir, `${docStem(path.basename(fp))}.pdf`), bytes)
    } catch {
      // not important
    }
  }

  async function compile(manual: boolean): Promise<void> {
    const c = compiler.current
    if (c.running) {
      c.pending = true
      return
    }
    const L = live.current
    const m = currentModel()
    let tex = serializeDocument(m)
    const partial = (L.compileRange && hasCompileMarkers(tex)) || L.skipImages
    if (L.compileRange) tex = applyNotCompileRanges(applyCompileRange(tex))
    if (L.skipImages) tex = stripImages(tex)
    if (!manual && (tex === c.lastOk || tex === c.lastFailed)) return
    c.running = true
    setCompileView((v) => ({ ...v, running: true }))
    let result
    try {
      result = await compileLatex('document.tex', await compileFiles(m, tex, !L.skipImages))
    } finally {
      c.running = false
    }
    setCompileView({ running: false, ok: result.ok, errors: result.errors, log: result.log, at: new Date().toLocaleTimeString() })
    if (result.ok && result.pdf) {
      c.lastOk = tex
      c.lastFailed = ''
      showPdfBytes(result.pdf)
      setPdfNotice(null)
      const fp = live.current.filePath
      if (fp && !partial) void cachePdf(fp, result.pdf)
    } else {
      c.lastFailed = tex
      const first = result.errors[0]
      setPdfNotice(first ? `Not compiled${first.line ? ` (line ${first.line})` : ''}: ${first.message}` : 'The document did not compile.')
    }
    if (c.pending) {
      c.pending = false
      scheduleCompile(50)
    }
  }

  /** A complete PDF (no compile range, with images) for export and printing. */
  async function fullPdf(): Promise<Uint8Array | null> {
    const m = currentModel()
    const tex = serializeDocument(m)
    setCompileView((v) => ({ ...v, running: true }))
    const r = await compileLatex('document.tex', await compileFiles(m, tex, true))
    setCompileView({ running: false, ok: r.ok, errors: r.errors, log: r.log, at: new Date().toLocaleTimeString() })
    if (r.ok && r.pdf) return r.pdf
    await os.dialog.alert(r.errors[0]?.message ?? 'The document did not compile. See the Console.', { title: 'Compile failed' })
    return null
  }

  // ---------------------------------------------------------------- dialogs

  function ask<T>(render: (done: Done<T>) => ReactNode): Promise<T | null> {
    return new Promise((resolve) => {
      const done: Done<T> = (v) => {
        setDialog(null)
        resolve(v)
        requestAnimationFrame(() => edRef.current?.commands.focus())
      }
      setDialog(render(done))
    })
  }

  // ------------------------------------------------------- loading documents

  function resetEditor(json: JSONContent) {
    const ed = edRef.current
    if (!ed) return
    // A fresh state, so undo can't reach back into the previous document.
    ed.view.updateState(EditorState.create({ doc: ed.schema.nodeFromJSON(json), plugins: ed.state.plugins }))
    ed.view.dispatch(ed.state.tr.setMeta(refreshKey, true))
  }

  async function loadBibs(m: Document, p: string | null) {
    const texts: string[] = []
    if (extra.current.bib) texts.push(extra.current.bib)
    if (p) {
      const names = new Set<string>()
      for (const b of m.children) if (b.type === 'RawLatex') for (const n of bibSources(b.text)) names.add(n)
      for (const n of names) {
        const bibPath = path.join(path.dirname(p), n)
        if (fs.isFile(bibPath)) {
          try {
            texts.push(await fs.readText(bibPath))
          } catch {
            // unreadable: citations show their keys
          }
        }
      }
    }
    bibTexts.current = texts
    const ed = edRef.current
    if (ed && !ed.isDestroyed) ed.view.dispatch(ed.state.tr.setMeta(refreshKey, true))
  }

  function applyBundle(b: Bundle, p: string | null, name: string, fromDir: string | null = null) {
    importDir.current = fromDir
    window.clearTimeout(timers.current.code)
    codePending.current = false
    codeDraftRef.current = null
    setCodeDraft(null)
    setCodeError(null)
    for (const u of urls.current.values()) URL.revokeObjectURL(u)
    urls.current.clear()
    files.current = new Map(b.files)
    extra.current = { bib: b.bib, project: b.project }
    live.current.meta = b.doc.meta
    setMeta(b.doc.meta)
    resetEditor(docToEditor(b.doc))
    const m = currentModel()
    savedJson.current = toJson(m)
    setFilePath(p)
    live.current.filePath = p
    setDocName(name)
    setDirty(false)
    setLatex(serializeDocument(m))
    compiler.current.lastOk = ''
    compiler.current.lastFailed = ''
    setTab('visual')
    void loadBibs(m, p ?? (fromDir ? path.join(fromDir, 'document.tex') : null))
    refresh()
    if (live.current.autoCompile && live.current.showPdf) scheduleCompile(50)
  }

  /** Import a .tex file from the drive as a new, untitled document. */
  async function importTexPath(p: string) {
    setLoading(true)
    try {
      const dir = path.dirname(p)
      const read = async (fp: string) => (fs.isFile(fp) ? fs.readText(fp) : null)
      const source = await expandIncludes(await fs.readText(p), dir, read)
      const doc = adoptSerializerPreamble(importTex(source, { unwrapColumns: true }))
      // The pictures come into the document, as figures/figure_NNN.
      const pictures = new Map<string, Uint8Array>()
      for (const b of doc.children) {
        if (b.type !== 'Figure' || !b.path || /[\\#]/.test(b.path)) continue
        const base = b.path.startsWith('/') ? b.path : path.join(dir, b.path)
        const found = [base, ...['.pdf', '.png', '.jpg', '.jpeg'].map((e) => base + e)].find((c) => fs.isFile(c))
        if (!found) continue
        try {
          const { bytes, ext } = await toLatexPicture(found, await fs.readBytes(found))
          const key = nextFigurePath(pictures.keys(), ext)
          pictures.set(key, bytes)
          b.path = key
        } catch {
          // keep the path: it compiles as a "missing image" box
        }
      }
      applyBundle({ doc, files: pictures, bib: '', project: null }, null, `${docStem(path.basename(p))} (imported)`, dir)
      os.notify({ title: `Imported ${path.basename(p)}`, body: 'Save it to keep it as a KherveTeX document.' })
    } catch (e) {
      await os.dialog.alert(`Could not import ${path.basename(p)}: ${errorText(e)}`, { title: 'KherveTeX' })
    } finally {
      setLoading(false)
    }
  }

  async function importDialog() {
    const p = await os.dialog.openFile({
      title: 'Import LaTeX',
      extensions: ['.tex'],
      startDir: live.current.filePath ? path.dirname(live.current.filePath) : `${HOME}/Documents`,
    })
    if (!p) return
    if (pristine()) await importTexPath(p)
    else os.open('khervetex', { importTex: p, _new: Date.now() })
  }

  // --------------------------------------------------------- the Code tab

  /** Drawings and flowcharts reach LaTeX as their PDF: point the figure back at its PNG preview. */
  function relinkFigures(doc: Document) {
    for (const b of doc.children) {
      if (b.type !== 'Figure' || files.current.has(b.path) || !b.path.toLowerCase().endsWith('.pdf')) continue
      const stem = b.path.slice(0, -4)
      if (!files.current.has(`${stem}.png`)) continue
      b.path = `${stem}.png`
      b.source = files.current.has(`${stem}.flow.json`) ? 'flowchart' : 'drawing'
    }
  }

  function onCodeEdit(text: string) {
    // The editor also reports text it was given; only the user's edits count.
    if (codeDraftRef.current === null && text === live.current.latex) return
    if (text === codeDraftRef.current) return
    codeDraftRef.current = text
    codePending.current = true
    setCodeDraft(text)
    window.clearTimeout(timers.current.code)
    timers.current.code = window.setTimeout(flushCode, 700)
  }

  /** Read pending Code-tab edits into the document now. */
  function flushCode() {
    if (!codePending.current || codeDraftRef.current === null) return
    window.clearTimeout(timers.current.code)
    codePending.current = false
    applyCode(codeDraftRef.current)
  }

  /** The visual document changed: the Code tab shows its LaTeX again. */
  function dropCodeDraft() {
    flushCode()
    if (codeDraftRef.current === null) return
    codeDraftRef.current = null
    setCodeDraft(null)
  }

  function applyCode(text: string) {
    const ed = edRef.current
    if (!ed) return
    let doc: Document
    try {
      doc = adoptSerializerPreamble(importTex(text, { unwrapColumns: true }))
    } catch (e) {
      setCodeError(`Could not read this LaTeX: ${errorText(e)}`)
      return
    }
    setCodeError(null)
    relinkFigures(doc)
    // What LaTeX does not carry stays as it was.
    const old = live.current.meta
    const next: DocMeta = { ...doc.meta, visual_font_family: old.visual_font_family, ref_library: old.ref_library, bib_style: old.bib_style }
    live.current.meta = next
    setMeta(next)
    ed.chain().setContent(docToEditor({ ...doc, meta: next }), { emitUpdate: false }).run()
    const m = editorToModel(ed.state.doc, next)
    model.current = m
    setDirty(toJson(m) !== savedJson.current)
    if (live.current.autoCompile && live.current.showPdf) scheduleCompile(300)
  }

  function switchTab(t: Tab) {
    if (t !== 'code' && codeDraftRef.current !== null) {
      dropCodeDraft()
      scheduleRefresh(0)
    }
    setTab(t)
  }

  async function loadPath(p: string) {
    if (path.extname(p) === '.tex') return importTexPath(p)
    setLoading(true)
    try {
      const bytes = await fs.readBytes(p)
      const name = path.basename(p)
      let bundle: Bundle
      if (isBundlePath(p)) bundle = readBundle(bytes)
      else {
        const text = strFromU8(bytes)
        const raw = JSON.parse(text) as { type?: unknown; children?: unknown } | null
        if (!raw || (raw.type !== 'Document' && !Array.isArray(raw.children))) throw new Error('this JSON file is not a KherveTeX document')
        bundle = { doc: fromJson(text), files: new Map(), bib: '', project: null }
      }
      applyBundle(bundle, p, name)
      const cached = path.join(path.dirname(p), `${docStem(name)}.pdf`)
      if (fs.isFile(cached)) showPdfBytes(await fs.readBytes(cached))
      if (bundle.project !== null) {
        os.notify({ title: `${name} is a project`, body: 'KherveOS opens its main document; the other documents stay as they are.' })
      }
    } catch (e) {
      await os.dialog.alert(`Could not open ${path.basename(p)}: ${errorText(e)}`, { title: 'KherveTeX' })
    } finally {
      setLoading(false)
    }
  }

  async function loadExampleFile(file: string) {
    const entry = EXAMPLES.find((x) => x.file === file)
    setLoading(true)
    try {
      const doc = fromJson(await loadExample(file))
      applyBundle({ doc, files: new Map(), bib: '', project: null }, null, entry?.label ?? 'Example')
    } catch (e) {
      await os.dialog.alert(`Could not open the example: ${errorText(e)}`)
    } finally {
      setLoading(false)
    }
  }

  /** Untitled and untouched: a file can open in this window instead of a new one. */
  const pristine = () => !live.current.filePath && !live.current.dirty

  async function openDialog() {
    const p = await os.dialog.openFile({
      title: 'Open a KherveTeX document (or a .tex to import)',
      extensions: OPENABLE,
      startDir: live.current.filePath ? path.dirname(live.current.filePath) : `${HOME}/Documents`,
    })
    if (!p) return
    const isTex = path.extname(p) === '.tex'
    if (pristine()) {
      await loadPath(p)
      if (!isTex) win.setDocumentPath(p)
    } else if (isTex) os.open('khervetex', { importTex: p, _new: Date.now() })
    else os.open('khervetex', { path: p })
  }

  function openExample(file: string) {
    if (pristine()) void loadExampleFile(file)
    else os.open('khervetex', { example: file, _new: Date.now() })
  }

  // ------------------------------------------------------------------ saving

  function suggestedName(): string {
    const title = model.current.children.find((b) => b.type === 'Title')
    const t = title && 'children' in title ? plainText(title.children) : live.current.meta.title
    const clean = (t || '').replace(/[\\/:*?"<>|$]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
    return clean && clean !== 'Untitled' ? clean : docName.replace(/\.[^.]+$/, '') || 'Untitled'
  }

  async function writeTo(p: string): Promise<boolean> {
    const m = currentModel()
    try {
      if (p.toLowerCase().endsWith('.json')) await fs.writeText(p, toJson(m))
      else {
        const bib = m.meta.ref_library ? extra.current.bib : ''
        await fs.writeBytes(p, writeBundle({ doc: m, files: files.current, bib, project: extra.current.project }))
      }
    } catch (e) {
      await os.dialog.alert(`Could not save: ${errorText(e)}`, { title: 'KherveTeX' })
      return false
    }
    savedJson.current = toJson(m)
    setDirty(false)
    return true
  }

  async function saveAs(): Promise<boolean> {
    const fp = live.current.filePath
    const target = await os.dialog.saveFile({
      title: 'Save As',
      defaultName: fp ? path.join(path.dirname(fp), `${docStem(path.basename(fp))}.ktex`) : `${HOME}/Documents/${suggestedName()}.ktex`,
      extensions: ['.ktex'],
    })
    if (!target) return false
    if (!(await writeTo(target))) return false
    setFilePath(target)
    live.current.filePath = target
    setDocName(path.basename(target))
    win.setDocumentPath(target)
    void loadBibs(model.current, target)
    return true
  }

  async function save(): Promise<boolean> {
    const fp = live.current.filePath
    if (!fp || !fs.isDir(path.dirname(fp))) return saveAs()
    let target = fp
    // Old .ktexz / .kdocz bundles become .ktex on their next save; the old file stays.
    if (isLegacyBundle(fp)) target = fp.replace(/\.(ktexz|kdocz)$/i, '.ktex')
    if (!(await writeTo(target))) return false
    if (target !== fp) {
      setFilePath(target)
      live.current.filePath = target
      setDocName(path.basename(target))
      win.setDocumentPath(target)
      os.notify({ title: `Saved as ${path.basename(target)}`, body: 'The new .ktex format; the old file is unchanged.' })
    }
    return true
  }

  function exportBase(ext: string): string {
    const fp = live.current.filePath
    return fp ? path.join(path.dirname(fp), `${docStem(path.basename(fp))}${ext}`) : `${HOME}/Documents/${suggestedName()}${ext}`
  }

  async function exportTex() {
    const target = await os.dialog.saveFile({ title: 'Export LaTeX', defaultName: exportBase('.tex'), extensions: ['.tex'] })
    if (target) {
      await fs.writeText(target, serializeDocument(currentModel()))
      os.notify({ title: 'LaTeX exported', body: path.pretty(target) })
    }
  }

  async function exportZip() {
    const target = await os.dialog.saveFile({ title: 'Export LaTeX package', defaultName: exportBase('.zip'), extensions: ['.zip'] })
    if (!target) return
    const m = currentModel()
    const main = live.current.filePath ? docStem(path.basename(live.current.filePath)) : 'main'
    await fs.writeBytes(target, writeLatexZip({ doc: m, files: files.current, bib: extra.current.bib, project: null }, main))
    os.notify({ title: 'LaTeX package exported', body: `${path.pretty(target)} — main .tex, figures/ and equations/` })
  }

  async function exportPdf() {
    const target = await os.dialog.saveFile({ title: 'Export PDF', defaultName: exportBase('.pdf'), extensions: ['.pdf'] })
    if (!target) return
    const bytes = await fullPdf()
    if (!bytes) return
    await fs.writeBytes(target, bytes)
    showPdfBytes(bytes)
    os.notify({ title: 'PDF exported', body: path.pretty(target) })
  }

  async function downloadPdf() {
    const bytes = live.current.pdf?.bytes ?? (await fullPdf())
    if (bytes) os.downloadBlob(`${suggestedName()}.pdf`, new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  }

  async function print() {
    const bytes = await fullPdf()
    if (!bytes) return
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
    const frame = document.createElement('iframe')
    frame.className = 'ktx-print-frame'
    frame.src = url
    frame.onload = () => {
      try {
        frame.contentWindow?.focus()
        frame.contentWindow?.print()
      } catch {
        window.open(url, '_blank', 'noopener')
      }
      window.setTimeout(() => {
        frame.remove()
        URL.revokeObjectURL(url)
      }, 60_000)
    }
    document.body.appendChild(frame)
  }

  // ------------------------------------------------------- editing commands

  function chain() {
    return edRef.current!.chain().focus()
  }

  function applyStyle(code: StyleCode) {
    const ed = edRef.current
    if (!ed) return
    const parent = ed.state.selection.$from.parent
    if (code === 'body') chain().setParagraph().run()
    else if (code === 'chapter' || /^h\d$/.test(code)) {
      const level = code === 'chapter' ? 0 : Number(code.slice(1))
      if (parent.type.name === 'section') chain().updateAttributes('section', { level }).run()
      else chain().setNode('section', { level, numbered: true, label: null }).run()
    } else chain().setNode(code).run()
  }

  /** Insert a block where the caret is, with a paragraph after it to keep typing in. */
  function insertBlock(json: JSONContent) {
    const ed = edRef.current
    if (!ed) return
    const sel = ed.state.selection
    if (sel instanceof NodeSelection || sel.$from.depth !== 1) {
      const pos = sel instanceof NodeSelection ? sel.to : sel.$from.after(1)
      ed.chain().focus().insertContentAt(pos, [json, { type: 'paragraph' }]).run()
      return
    }
    const parent = sel.$from.parent
    const atEnd = sel.empty && sel.$from.parentOffset === parent.content.size
    const content = parent.isTextblock && (parent.content.size === 0 || atEnd) ? [json, { type: 'paragraph' }] : [json]
    ed.chain().focus().insertContent(content).run()
  }

  function insertRaw(text: string) {
    insertBlock({ type: 'rawLatex', content: [{ type: 'text', text }] })
  }

  async function insertMath(display: boolean) {
    const ed = edRef.current
    if (!ed) return
    const sel = ed.state.selection
    const selected = sel.empty || sel instanceof NodeSelection ? '' : ed.state.doc.textBetween(sel.from, sel.to, ' ')
    const r = await ask<MathResult>((done) => (
      <MathDialog initial={{ latex: selected, display, numbered: display, label: null }} done={done} />
    ))
    if (!r) return
    if (r.display || /\\begin\{/.test(r.latex)) insertBlock({ type: 'mathBlock', attrs: { latex: r.latex, numbered: r.numbered, label: r.label } })
    else chain().insertContent({ type: 'mathInline', attrs: { latex: r.latex } }).run()
  }

  function insertEnvironment(latex: string) {
    insertBlock({ type: 'mathBlock', attrs: { latex, numbered: false, label: null } })
  }

  function insertSymbol(latex: string) {
    if (TEXT_MODE_SYMBOLS.has(latex)) chain().insertContent({ type: 'inlineRaw', attrs: { latex } }).run()
    else chain().insertContent({ type: 'mathInline', attrs: { latex } }).run()
  }

  async function insertLink() {
    const ed = edRef.current
    if (!ed) return
    const existing = ed.getAttributes('link').href as string | undefined
    const hasSel = !ed.state.selection.empty
    const r = await ask<{ url: string; text: string }>((done) => <LinkDialog initialUrl={existing ?? ''} askText={!hasSel && !existing} done={done} />)
    if (!r) return
    ensurePackage('hyperref')
    if (existing) chain().extendMarkRange('link').setLink({ href: r.url }).run()
    else if (hasSel) chain().setLink({ href: r.url }).run()
    else chain().insertContent({ type: 'text', text: r.text || r.url, marks: [{ type: 'link', attrs: { href: r.url } }] }).run()
  }

  async function insertFootnote() {
    const text = await ask<string>((done) => <TextDialog title="Footnote" label="Note text" multiline done={done} okLabel="Insert" />)
    if (text && text.trim()) chain().insertContent({ type: 'footnote', attrs: { text: text.trim(), children: null } }).run()
  }

  function bibEntries(): { key: string; text: string }[] {
    const out = new Map<string, string>()
    for (const t of bibTexts.current) {
      for (const [key, e] of parseBibtex(t)) {
        if (!out.has(key)) out.set(key, [shortAuthor(e.author), e.year && `(${e.year})`, e.title.replace(/[{}]/g, '')].filter(Boolean).join(' '))
      }
    }
    for (const b of model.current.children) {
      if (b.type === 'RawLatex') for (const m of b.text.matchAll(/\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}/g)) if (!out.has(m[1])) out.set(m[1], '')
    }
    return [...out].map(([key, text]) => ({ key, text }))
  }

  async function insertCitation() {
    const r = await ask<{ keys: string[]; style: string }>((done) => <CitationDialog initial={{ keys: [], style: 'cite' }} entries={bibEntries()} done={done} />)
    if (!r) return
    const m = live.current.meta
    if (r.style !== 'cite' && !m.packages.includes('biblatex') && !m.preamble_extras.includes('biblatex') && !m.documentclass.toLowerCase().startsWith('elsarticle')) {
      ensurePackage('natbib')
    }
    chain().insertContent({ type: 'citation', attrs: { keys: r.keys, style: r.style } }).run()
  }

  function documentLabels(): { label: string; what: string }[] {
    const out: { label: string; what: string }[] = []
    for (const b of currentModel().children) {
      if (b.type === 'Section' && b.label) out.push({ label: b.label, what: `${b.level === 0 ? 'Chapter' : 'Heading'}: ${plainText(b.children)}` })
      else if (b.type === 'Figure' && b.label) out.push({ label: b.label, what: `Figure: ${latexToDisplay(b.caption)}` })
      else if (b.type === 'Table' && b.label) out.push({ label: b.label, what: `Table: ${latexToDisplay(b.caption)}` })
      else if (b.type === 'MathBlock' && b.label && b.numbered) out.push({ label: b.label, what: `Equation: ${b.latex.slice(0, 50)}` })
    }
    return out
  }

  async function insertCrossRef() {
    const r = await ask<{ label: string; kind: string }>((done) => <CrossRefDialog labels={documentLabels()} initial={{ label: '', kind: 'ref' }} done={done} />)
    if (r) chain().insertContent({ type: 'crossref', attrs: r }).run()
  }

  async function pickPictureFromDrive(): Promise<{ name: string; bytes: Uint8Array } | null> {
    const p = await os.dialog.openFile({ title: 'Choose a picture', extensions: PICTURE_EXTENSIONS, startDir: `${HOME}/Pictures` })
    if (!p) return null
    return { name: path.basename(p), bytes: await fs.readBytes(p) }
  }

  /** Store a picture with the document (figures/figure_NNN.ext); returns its path. */
  async function storePicture(pic: { name: string; bytes: Uint8Array }): Promise<string | null> {
    try {
      const { bytes, ext } = await toLatexPicture(pic.name, pic.bytes)
      const p = nextFigurePath(files.current.keys(), ext)
      files.current.set(p, bytes)
      return p
    } catch (e) {
      await os.dialog.alert(errorText(e), { title: 'Picture' })
      return null
    }
  }

  async function insertFigure() {
    const r = await ask<FigureResult>((done) => (
      <FigureDialog edit={false} initial={{ caption: '', label: null, width: '0.8\\textwidth', previewUrl: null }} pickFromDrive={pickPictureFromDrive} done={done} />
    ))
    if (!r?.picture) return
    const p = await storePicture(r.picture)
    if (p) insertBlock({ type: 'figure', attrs: { path: p, caption: escapeText(r.caption), label: r.label, width: r.width, source: '' } })
  }

  async function insertPictureAt(pic: { name: string; bytes: Uint8Array }, at: number | null) {
    const p = await storePicture(pic)
    const ed = edRef.current
    if (!p || !ed) return
    const json = { type: 'figure', attrs: { path: p, caption: '', label: null, width: '0.6\\textwidth', source: '' } }
    if (at === null) return insertBlock(json)
    const $p = ed.state.doc.resolve(Math.min(at, ed.state.doc.content.size))
    ed.chain().focus().insertContentAt($p.depth >= 1 ? $p.after(1) : $p.pos, json).run()
  }

  async function insertTable() {
    const r = await ask<TableInsertResult>((done) => <TableInsertDialog done={done} />)
    if (!r) return
    const cell = { type: 'tableCell', content: [{ type: 'paragraph' }] }
    insertBlock({
      type: 'table',
      attrs: { caption: escapeText(r.caption), label: r.label, alignment: '', ruleStyle: '' },
      content: Array.from({ length: r.rows }, () => ({ type: 'tableRow', content: Array.from({ length: r.cols }, () => cell) })),
    })
  }

  async function insertTextBlock(title: string, label: string, wrap: (s: string) => string, pkg?: string) {
    const text = await ask<string>((done) => <TextDialog title={title} label={label} multiline mono done={done} okLabel="Insert" />)
    if (!text || !text.trim()) return
    if (pkg) ensurePackage(pkg)
    insertRaw(wrap(text.replace(/\n+$/, '')))
  }

  async function addComment() {
    const ed = edRef.current
    if (!ed || ed.state.selection.empty) return
    const note = await ask<string>((done) => <TextDialog title="New comment" label="Comment" multiline done={done} okLabel="Add" />)
    if (!note || !note.trim()) return
    const author = useAuth.getState().user?.display_name ?? ''
    chain().setMark('comment', { note: note.trim(), author, timestamp: localIsoSeconds(), resolved: false }).run()
  }

  function highlightMenu(at?: { clientX: number; clientY: number }) {
    const ed = edRef.current
    if (!ed) return
    const items: MenuItem[] = [
      ...Object.keys(HIGHLIGHT_COLORS).map((color) => ({
        label: color[0].toUpperCase() + color.slice(1),
        disabled: ed.state.selection.empty,
        onClick: () => chain().setMark('highlight', { color }).run(),
      })),
      '-',
      { label: 'Remove highlight', onClick: () => chain().unsetMark('highlight').run() },
    ]
    os.contextMenu(at ?? lastPointer.current, items)
  }

  function gotoComment(forward: boolean) {
    const ed = edRef.current
    if (!ed) return
    const ranges: { from: number; to: number }[] = []
    ed.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.marks.some((m) => m.type.name === 'comment')) return
      const last = ranges.at(-1)
      if (last && last.to === pos) last.to = pos + node.nodeSize
      else ranges.push({ from: pos, to: pos + node.nodeSize })
    })
    const { from, to } = ed.state.selection
    const r = forward ? ranges.find((x) => x.from > from) ?? ranges[0] : [...ranges].reverse().find((x) => x.to < to) ?? ranges.at(-1)
    if (r) ed.chain().focus().setTextSelection(r).scrollIntoView().run()
  }

  function setAttrs(pos: number, attrs: Record<string, unknown>) {
    const ed = edRef.current
    const node = ed?.state.doc.nodeAt(pos)
    if (!ed || !node) return
    ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }))
  }

  async function editAt(kind: EditKind, pos: number) {
    const ed = edRef.current
    const node = ed?.state.doc.nodeAt(pos)
    if (!ed || !node) return
    const a = node.attrs
    switch (kind) {
      case 'mathBlock':
      case 'mathInline': {
        const block = kind === 'mathBlock'
        const r = await ask<MathResult>((done) => (
          <MathDialog initial={{ latex: String(a.latex ?? ''), display: block, numbered: !!a.numbered, label: a.label ?? null }} canSwitch={false} done={done} />
        ))
        if (r) setAttrs(pos, block ? { latex: r.latex, numbered: r.numbered, label: r.label } : { latex: r.latex })
        return
      }
      case 'figure': {
        const r = await ask<FigureResult>((done) => (
          <FigureDialog
            edit
            initial={{ caption: String(a.caption ?? ''), label: a.label ?? null, width: String(a.width ?? ''), previewUrl: figureUrl(String(a.path ?? '')) }}
            pickFromDrive={pickPictureFromDrive}
            done={done}
          />
        ))
        if (!r) return
        const attrs: Record<string, unknown> = { caption: r.caption, label: r.label, width: r.width }
        if (r.picture) {
          const p = await storePicture(r.picture)
          if (p) Object.assign(attrs, { path: p, source: '' })
        }
        setAttrs(pos, attrs)
        return
      }
      case 'table': {
        const r = await ask<TablePropsResult>((done) => (
          <TablePropsDialog initial={{ caption: String(a.caption ?? ''), label: a.label ?? null, alignment: String(a.alignment ?? ''), style: String(a.ruleStyle ?? '') }} done={done} />
        ))
        if (r) {
          setAttrs(pos, { caption: r.caption, label: r.label, alignment: r.alignment, ruleStyle: r.style })
          if (r.style === 'booktabs') ensurePackage('booktabs')
        }
        return
      }
      case 'footnote': {
        const t = await ask<string>((done) => <TextDialog title="Footnote" label="Note text" multiline initial={String(a.text ?? '')} done={done} />)
        if (t !== null) setAttrs(pos, { text: t.trim(), children: null })
        return
      }
      case 'citation': {
        const r = await ask<{ keys: string[]; style: string }>((done) => (
          <CitationDialog initial={{ keys: (a.keys as string[]) ?? [], style: String(a.style ?? 'cite') }} entries={bibEntries()} done={done} />
        ))
        if (r) setAttrs(pos, r)
        return
      }
      case 'crossref': {
        const r = await ask<{ label: string; kind: string }>((done) => (
          <CrossRefDialog labels={documentLabels()} initial={{ label: String(a.label ?? ''), kind: String(a.kind ?? 'ref') }} done={done} />
        ))
        if (r) setAttrs(pos, r)
        return
      }
      case 'inlineRaw': {
        const t = await ask<string>((done) => <TextDialog title="Raw LaTeX" label="LaTeX (verbatim)" mono initial={String(a.latex ?? '')} done={done} />)
        if (t !== null && t.trim()) setAttrs(pos, { latex: t })
        return
      }
    }
  }

  /** The table around the caret: [position, node], or null. */
  function tableAround(): [number, PMNode] | null {
    const ed = edRef.current
    if (!ed) return null
    const { $from } = ed.state.selection
    for (let d = $from.depth; d > 0; d--) {
      const n = $from.node(d)
      if (n.type.name === 'table') return [$from.before(d), n]
    }
    return null
  }

  async function labelSection() {
    const ed = edRef.current
    if (!ed) return
    const { $from } = ed.state.selection
    if ($from.parent.type.name !== 'section') return
    const pos = $from.before($from.depth)
    const v = await ask<string>((done) => (
      <TextDialog title="Heading label" label="Label" mono initial={String($from.parent.attrs.label ?? '')} placeholder="sec:introduction" hint="Refer to it with Insert ▸ Cross-reference." done={done} />
    ))
    if (v !== null) setAttrs(pos, { label: v.trim() || null })
  }

  function showInCode() {
    const ed = edRef.current
    if (!ed) return
    const snippet = ed.state.selection.$from.parent.textContent.trim().slice(0, 30)
    setTab('code')
    if (!snippet) return
    window.setTimeout(() => {
      const v = codeView.current
      if (!v) return
      const text = v.state.doc.toString()
      let i = text.indexOf(escapeText(snippet))
      if (i < 0) i = text.indexOf(snippet.slice(0, 12))
      if (i >= 0) revealLine(v, v.state.doc.lineAt(i).number)
    }, 60)
  }

  function convertSelectionToMath() {
    const ed = edRef.current
    if (!ed || ed.state.selection.empty) return
    const { from, to } = ed.state.selection
    const latex = ed.state.doc.textBetween(from, to, ' ').trim()
    if (latex) chain().insertContent({ type: 'mathInline', attrs: { latex } }).run()
  }

  // -------------------------------------------------------- the right-click

  function contextMenu(view: EditorView, e: MouseEvent) {
    e.preventDefault()
    const ed = edRef.current
    if (!ed) return
    const hit = view.posAtCoords({ left: e.clientX, top: e.clientY })
    if (hit) {
      const sel = ed.state.selection
      const insideSel = !sel.empty && hit.pos >= sel.from && hit.pos <= sel.to
      if (!insideSel) {
        const node = hit.inside >= 0 ? ed.state.doc.nodeAt(hit.inside) : null
        const tr = ed.state.tr
        if (node && node.isAtom && !node.isText) tr.setSelection(NodeSelection.create(ed.state.doc, hit.inside))
        else tr.setSelection(TextSelection.near(ed.state.doc.resolve(hit.pos)))
        view.dispatch(tr)
      }
    }
    const state = ed.state
    const sel = state.selection
    const items: MenuItem[] = []
    const add = (...xs: MenuItem[]) => {
      if (items.length && xs.length && items.at(-1) !== '-') items.push('-')
      items.push(...xs)
    }
    if (sel instanceof NodeSelection) {
      const n = sel.node
      const pos = sel.from
      switch (n.type.name) {
        case 'mathBlock':
          add(
            { label: 'Edit equation…', onClick: () => void editAt('mathBlock', pos) },
            { label: 'Numbered equation', checked: !!n.attrs.numbered, onClick: () => setAttrs(pos, { numbered: !n.attrs.numbered }) },
            { label: 'Equation label…', disabled: !n.attrs.numbered, onClick: () => void editAt('mathBlock', pos) },
          )
          break
        case 'mathInline':
          add({ label: 'Edit maths…', onClick: () => void editAt('mathInline', pos) })
          break
        case 'figure':
          add({ label: 'Figure…', onClick: () => void editAt('figure', pos) })
          break
        case 'footnote': case 'citation': case 'crossref': case 'inlineRaw':
          add({ label: 'Edit…', onClick: () => void editAt(n.type.name as EditKind, pos) })
          break
      }
      add({ label: 'Delete', danger: true, onClick: () => chain().deleteSelection().run() })
    } else {
      if (!sel.empty) {
        add(
          { label: 'Cut', shortcut: '⌘X', onClick: () => document.execCommand('cut') },
          { label: 'Copy', shortcut: '⌘C', onClick: () => document.execCommand('copy') },
        )
        add(
          { label: 'Convert to equation', onClick: convertSelectionToMath },
          { label: 'Highlight', submenu: Object.keys(HIGHLIGHT_COLORS).map((color) => ({ label: color[0].toUpperCase() + color.slice(1), onClick: () => chain().setMark('highlight', { color }).run() })) },
          { label: 'New comment…', onClick: () => void addComment() },
        )
      }
      if (ed.isActive('link')) {
        add(
          { label: 'Edit link…', onClick: () => void insertLink() },
          { label: 'Remove link', onClick: () => chain().extendMarkRange('link').unsetLink().run() },
        )
      }
      if (ed.isActive('highlight')) add({ label: 'Remove highlight', onClick: () => chain().extendMarkRange('highlight').unsetMark('highlight').run() })
      if (ed.isActive('comment')) {
        const c = ed.getAttributes('comment')
        add(
          { label: `Comment${c.author ? ` by ${c.author}` : ''}: ${String(c.note).slice(0, 40)}`, disabled: true },
          { label: 'Accept comment (keep the text)', onClick: () => run('acceptComment') },
          { label: 'Reject comment (delete the text)', danger: true, onClick: () => run('rejectComment') },
        )
      }
      if (sel.$from.parent.type.name === 'section') {
        const numbered = !!sel.$from.parent.attrs.numbered
        add(
          { label: 'Numbered heading', checked: numbered, onClick: () => run(numbered ? 'numberedOff' : 'numberedOn') },
          { label: 'Heading label…', onClick: () => void labelSection() },
        )
      }
      const table = tableAround()
      if (table) {
        add(
          { label: 'Insert row above', onClick: () => chain().addRowBefore().run() },
          { label: 'Insert row below', onClick: () => chain().addRowAfter().run() },
          { label: 'Insert column left', onClick: () => chain().addColumnBefore().run() },
          { label: 'Insert column right', onClick: () => chain().addColumnAfter().run() },
        )
        add(
          { label: 'Delete row', disabled: table[1].childCount < 2, onClick: () => chain().deleteRow().run() },
          { label: 'Delete column', disabled: (table[1].firstChild?.childCount ?? 0) < 2, onClick: () => chain().deleteColumn().run() },
          { label: 'Table…', onClick: () => void editAt('table', table[0]) },
          { label: 'Delete table', danger: true, onClick: () => chain().deleteTable().run() },
        )
      }
    }
    add({ label: 'Show in Code', onClick: showInCode })
    os.contextMenu(e, items)
  }

  // ------------------------------------------------------ dropped pictures

  function onDrop(view: EditorView, e: DragEvent): boolean {
    const dt = e.dataTransfer
    if (!dt) return false
    const at = view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos ?? null
    const internal = dt.getData(DRAG_MIME)
    if (internal) {
      let paths: string[] = []
      try {
        paths = JSON.parse(internal) as string[]
      } catch {
        return false
      }
      const pictures = paths.filter((p) => PICTURE_EXTENSIONS.includes(path.extname(p)))
      const docs = paths.filter((p) => OPENABLE.includes(path.extname(p)))
      if (!pictures.length && !docs.length) return false
      e.preventDefault()
      void (async () => {
        for (const p of pictures) await insertPictureAt({ name: path.basename(p), bytes: await fs.readBytes(p) }, at)
        for (const d of docs) os.open('khervetex', { path: d })
      })()
      return true
    }
    const pictures = [...dt.files].filter((f) => f.type.startsWith('image/') || f.name.toLowerCase().endsWith('.pdf'))
    if (!pictures.length) return false
    e.preventDefault()
    void (async () => {
      for (const f of pictures) await insertPictureAt({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }, at)
    })()
    return true
  }

  function onPaste(e: ClipboardEvent): boolean {
    const pictures = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
    if (!pictures.length) return false
    e.preventDefault()
    void (async () => {
      for (const f of pictures) await insertPictureAt({ name: f.name || 'pasted.png', bytes: new Uint8Array(await f.arrayBuffer()) }, null)
    })()
    return true
  }

  // ---------------------------------------------------------------- actions

  async function openSettings() {
    const m = await ask<DocMeta>((done) => <SettingsDialog initial={live.current.meta} done={done} />)
    if (m) updateMeta(m)
  }

  async function compilerStatus() {
    const s = await latexStatus()
    await os.dialog.alert(
      s === null
        ? 'The KherveOS server could not be asked: it is offline, or you are not signed in (from another computer, compiling needs an account).'
        : s.available
          ? `${s.engine} on the KherveOS server.\n${s.sandbox ? `Compiles run in a sandbox (${s.sandbox}).` : 'Compiles run without a sandbox (only allowed from this computer).'}\nPackages missing from its cache are downloaded on first use.`
          : 'tectonic is not installed on the KherveOS server, so documents cannot be typeset. Install it (e.g. brew install tectonic) and restart the server.',
      { title: 'LaTeX compiler' },
    )
  }

  function showShortcuts() {
    const rows: [string, string][] = [
      ['⌘S / ⇧⌘S', 'Save / Save As'], ['⌘O', 'Open'], ['⌘↩', 'Compile the PDF'], ['⌘P', 'Print'],
      ['⌘B ⌘I ⌘U', 'Bold, italic, underline'], ['⇧⌘X', 'Strikethrough'], ['⌘E', 'Code (monospace)'], ['⌘, / ⌘.', 'Subscript / superscript'],
      ['⌘M / ⇧⌘M', 'Inline maths / display equation'], ['⇧⌘G', 'Symbols'], ['⌘K', 'Hyperlink'], ['⇧↩', 'Line break (\\\\)'],
      ['⇧⌘H', 'Highlight'], ['⌥⌘M', 'New comment'], ['⌘F', 'Find and replace'],
      ['⌘1 / ⌘2 / ⌘6', 'Visual / Code / Console'], ['⌘4', 'PDF side panel'], ['Double-click', 'Edit an equation, figure, citation…'],
    ]
    void os.dialog.alert(
      <table className="ktx-shortcuts">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td><kbd>{k}</kbd></td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>,
      { title: 'Keyboard shortcuts' },
    )
  }

  function run(a: string): boolean {
    const ed = edRef.current
    if (!ed) return false
    flushCode()
    switch (a) {
      case 'undo': chain().undo().run(); break
      case 'redo': chain().redo().run(); break
      case 'bold': chain().toggleBold().run(); break
      case 'italic': chain().toggleItalic().run(); break
      case 'underline': chain().toggleUnderline().run(); break
      case 'strike': chain().toggleStrike().run(); break
      case 'code': chain().toggleCode().run(); break
      case 'smallcaps': chain().toggleMark('smallcaps').run(); break
      case 'subscript': chain().toggleSubscript().run(); break
      case 'superscript': chain().toggleSuperscript().run(); break
      case 'clearFormat': chain().unsetAllMarks().run(); break
      case 'alignLeft': chain().setTextAlign('left').run(); break
      case 'alignCenter': chain().setTextAlign('center').run(); break
      case 'alignRight': chain().setTextAlign('right').run(); break
      case 'alignJustify': chain().setTextAlign('justify').run(); break
      case 'bullet': chain().toggleBulletList().run(); break
      case 'ordered': chain().toggleOrderedList().run(); break
      case 'numberedOn': chain().updateAttributes('section', { numbered: true }).run(); break
      case 'numberedOff': chain().updateAttributes('section', { numbered: false }).run(); break
      case 'mathInline': void insertMath(false); break
      case 'mathBlock': void insertMath(true); break
      case 'symbol': setSymbolsOpen((o) => !o); break
      case 'link': void insertLink(); break
      case 'footnote': void insertFootnote(); break
      case 'citation': void insertCitation(); break
      case 'crossref': void insertCrossRef(); break
      case 'figure': void insertFigure(); break
      case 'table': void insertTable(); break
      case 'cols1': updateMeta({ column_count: 1 }); break
      case 'cols2': updateMeta({ column_count: 2 }); break
      case 'cols3': updateMeta({ column_count: 3 }); break
      case 'pagebreak': insertRaw('\\newpage'); break
      case 'hrule': insertRaw('\\hrulefill'); break
      case 'multicol': insertRaw(MULTICOL_REGION); break
      case 'codeBlock': void insertTextBlock('Code block', 'Code', (s) => `\\begin{lstlisting}\n${s}\n\\end{lstlisting}`, 'listings'); break
      case 'rawLatex': void insertTextBlock('Raw LaTeX', 'LaTeX (verbatim)', (s) => s); break
      case 'compileStart': insertRaw(COMPILE_START); break
      case 'compileEnd': insertRaw(COMPILE_END); break
      case 'notCompileStart': insertRaw(NOT_COMPILE_START); break
      case 'notCompileEnd': insertRaw(NOT_COMPILE_END); break
      case 'abstract': applyStyle('abstract'); break
      case 'keywords': applyStyle('keywords'); break
      case 'highlight': {
        const c = ed.view.coordsAtPos(ed.state.selection.from)
        highlightMenu({ clientX: c.left, clientY: c.bottom + 4 })
        break
      }
      case 'comment': void addComment(); break
      case 'acceptComment': chain().extendMarkRange('comment').unsetMark('comment').run(); break
      case 'rejectComment': chain().extendMarkRange('comment').deleteSelection().run(); break
      case 'nextComment': gotoComment(true); break
      case 'prevComment': gotoComment(false); break
      case 'compile':
        if (!live.current.showPdf) togglePdf(true)
        void compile(true)
        break
      case 'auto': {
        const next = !live.current.autoCompile
        live.current.autoCompile = next
        setAutoCompile(next)
        if (next) scheduleCompile(50)
        break
      }
      case 'skipImages':
        live.current.skipImages = !live.current.skipImages
        setSkipImages(live.current.skipImages)
        scheduleCompile(50)
        break
      case 'compileRange':
        live.current.compileRange = !live.current.compileRange
        setCompileRange(live.current.compileRange)
        scheduleCompile(50)
        break
      case 'pdf': togglePdf(); break
      case 'marks': setShowMarks((v) => !v); break
      case 'find': setFindOpen(true); switchTab('visual'); break
      case 'settings': void openSettings(); break
      default: return false
    }
    return true
  }

  function togglePdf(show = !live.current.showPdf) {
    live.current.showPdf = show
    setShowPdf(show)
    if (show && live.current.autoCompile) scheduleCompile(50)
  }

  handlers.current = {
    edit: (kind, pos) => void editAt(kind, pos),
    action: run,
    update: () => {
      if (codeDraftRef.current !== null) dropCodeDraft()
      scheduleRefresh()
    },
    contextMenu,
    drop: onDrop,
    paste: onPaste,
  }

  // ------------------------------------------------------------ side effects

  // What the window was opened with.
  useEffect(() => {
    if (typeof args.path === 'string') void loadPath(args.path)
    else if (typeof args.importTex === 'string') void importTexPath(args.importTex)
    else if (typeof args.example === 'string') void loadExampleFile(args.example)
    else {
      refresh()
      if (live.current.autoCompile) scheduleCompile(300)
    }
  }, [])

  // Tidy up: timers and blob URLs.
  useEffect(
    () => () => {
      window.clearTimeout(timers.current.refresh)
      window.clearTimeout(timers.current.compile)
      window.clearTimeout(timers.current.code)
      for (const u of urls.current.values()) URL.revokeObjectURL(u)
      if (live.current.pdf) URL.revokeObjectURL(live.current.pdf.url)
    },
    [],
  )

  useEffect(() => {
    win.setTitle(`${dirty ? '• ' : ''}${docName} — KherveTeX`)
  }, [win, docName, dirty])

  // Follow the file when it is renamed or moved.
  useEffect(
    () =>
      fs.watch((ev) => {
        const current = live.current.filePath
        if (!current || ev.type !== 'rename' || !path.isInside(current, ev.oldPath)) return
        const moved = ev.path + current.slice(ev.oldPath.length)
        setFilePath(moved)
        live.current.filePath = moved
        setDocName(path.basename(moved))
        win.setDocumentPath(moved)
      }),
    [win],
  )

  // Ask before closing with unsaved changes.
  useEffect(() => {
    win.setCloseGuard(async () => {
      // currentModel() also reads in Code-tab typing that is still waiting to be applied.
      if (toJson(currentModel()) === savedJson.current) return true
      const choice = await os.dialog.choose(
        `Save the changes to "${docName}" before closing?`,
        [
          { label: 'Cancel', value: 'cancel' },
          { label: "Don't save", value: 'discard', danger: true },
          { label: 'Save', value: 'save', primary: true },
        ],
        { title: 'Unsaved changes' },
      )
      if (choice === 'save') return save()
      return choice === 'discard'
    })
    return () => win.setCloseGuard(null)
  })

  // Spell checking is the browser's own. Set through the editor's options, which
  // also reach a page that is not mounted yet (its view would throw).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const props = editor.options.editorProps
    const attributes = { ...(props.attributes as Record<string, string>), spellcheck: spell ? 'true' : 'false' }
    editor.setOptions({ editorProps: { ...props, attributes } })
  }, [editor, spell])

  // Fit the page to the width of the visual pane.
  useEffect(() => {
    const el = visualRef.current
    if (!el) return
    const page = pageSizeByCode(meta.page_size)
    const fit = () => setFitZoom(Math.max(25, Math.min(200, Math.floor(((el.clientWidth - 40) / (page.widthIn * 96)) * 100))))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [meta.page_size, tab])

  // Remember where the pointer was, for menus opened from the toolbar.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      lastPointer.current = { clientX: e.clientX, clientY: e.clientY + 4 }
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [])

  // ------------------------------------------------------------------ menus

  const effectiveZoom = fitWidth ? fitZoom : zoom
  const setZoomTo = (z: number) => {
    setFitWidth(false)
    setZoom(Math.max(25, Math.min(300, Math.round(z))))
  }

  useEffect(() => {
    const ed = editor
    const chapterOk = classSupportsChapter(meta.documentclass)
    const frameOk = meta.documentclass.toLowerCase() === 'beamer'
    const menus: MenuBarMenu[] = [
      {
        label: 'File',
        items: [
          { label: 'New', icon: FilePlus, onClick: () => os.open('khervetex', { _new: Date.now() }) },
          { label: 'Open…', icon: FolderOpen, shortcut: '⌘O', onClick: () => void openDialog() },
          '-',
          { label: 'Save', icon: Save, shortcut: '⌘S', onClick: () => void save() },
          { label: 'Save As…', shortcut: '⇧⌘S', onClick: () => void saveAs() },
          '-',
          { label: 'Import LaTeX (.tex)…', onClick: () => void importDialog() },
          {
            label: 'Export',
            icon: FileDown,
            submenu: [
              { label: 'LaTeX (.tex)…', onClick: () => void exportTex() },
              { label: 'LaTeX package (.zip)…', onClick: () => void exportZip() },
              { label: 'PDF…', onClick: () => void exportPdf() },
            ],
          },
          { label: 'Download PDF to this computer', icon: Download, onClick: () => void downloadPdf() },
          { label: 'Print…', icon: Printer, shortcut: '⌘P', onClick: () => void print() },
          '-',
          { label: 'Document settings…', icon: Settings2, onClick: () => void openSettings() },
          { label: 'Show in Files', disabled: !filePath, onClick: () => filePath && os.open('files', { path: path.dirname(filePath) }) },
          '-',
          { label: 'Close', onClick: () => win.close() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', shortcut: '⌘Z', disabled: !st.canUndo, onClick: () => run('undo') },
          { label: 'Redo', shortcut: '⇧⌘Z', disabled: !st.canRedo, onClick: () => run('redo') },
          '-',
          { label: 'Cut', shortcut: '⌘X', onClick: () => document.execCommand('cut') },
          { label: 'Copy', shortcut: '⌘C', onClick: () => document.execCommand('copy') },
          { label: 'Select All', shortcut: '⌘A', onClick: () => ed?.chain().focus().selectAll().run() },
          '-',
          { label: 'Find and Replace…', icon: Search, shortcut: '⌘F', onClick: () => run('find') },
          '-',
          { label: 'Clear formatting', onClick: () => run('clearFormat') },
        ],
      },
      {
        label: 'Format',
        items: [
          { label: 'Bold', shortcut: '⌘B', checked: st.bold, onClick: () => run('bold') },
          { label: 'Italic', shortcut: '⌘I', checked: st.italic, onClick: () => run('italic') },
          { label: 'Underline', shortcut: '⌘U', checked: st.underline, onClick: () => run('underline') },
          { label: 'Strikethrough', shortcut: '⇧⌘X', checked: st.strike, onClick: () => run('strike') },
          { label: 'Code (monospace)', shortcut: '⌘E', checked: st.code, onClick: () => run('code') },
          { label: 'Small caps', checked: st.smallcaps, onClick: () => run('smallcaps') },
          { label: 'Subscript', shortcut: '⌘,', checked: st.subscript, onClick: () => run('subscript') },
          { label: 'Superscript', shortcut: '⌘.', checked: st.superscript, onClick: () => run('superscript') },
          '-',
          {
            label: 'Alignment',
            submenu: [
              { label: 'Align left', checked: st.align === 'left', disabled: st.align === null, onClick: () => run('alignLeft') },
              { label: 'Centre', checked: st.align === 'center', disabled: st.align === null, onClick: () => run('alignCenter') },
              { label: 'Align right', checked: st.align === 'right', disabled: st.align === null, onClick: () => run('alignRight') },
              { label: 'Justify', checked: st.align === 'justify', disabled: st.align === null, onClick: () => run('alignJustify') },
            ],
          },
          {
            label: 'Paragraph style',
            submenu: STYLES.map(([code, label]) => ({
              label,
              checked: st.style === code,
              disabled: (code === 'chapter' && !chapterOk) || (code === 'frame' && !frameOk),
              onClick: () => applyStyle(code),
            })),
          },
          { label: 'Numbered heading', checked: st.numbered === true, disabled: st.numbered === null, onClick: () => run(st.numbered ? 'numberedOff' : 'numberedOn') },
          { label: 'Heading label…', disabled: st.numbered === null, onClick: () => void labelSection() },
        ],
      },
      {
        label: 'Insert',
        items: [
          { label: 'Inline maths…', shortcut: '⌘M', onClick: () => run('mathInline') },
          { label: 'Display equation…', shortcut: '⇧⌘M', onClick: () => run('mathBlock') },
          { label: 'Maths environment', submenu: MATH_ENVIRONMENTS.map(([name, tex]) => ({ label: name, onClick: () => insertEnvironment(tex) })) },
          { label: 'Symbol…', shortcut: '⇧⌘G', onClick: () => run('symbol') },
          '-',
          { label: 'Abstract paragraph', onClick: () => run('abstract') },
          { label: 'Keywords paragraph', onClick: () => run('keywords') },
          '-',
          { label: 'Bullet list', onClick: () => run('bullet') },
          { label: 'Numbered list', onClick: () => run('ordered') },
          '-',
          { label: 'Hyperlink…', shortcut: '⌘K', onClick: () => run('link') },
          { label: 'Footnote…', onClick: () => run('footnote') },
          { label: 'Citation…', onClick: () => run('citation') },
          { label: 'Cross-reference…', onClick: () => run('crossref') },
          '-',
          { label: 'Figure…', onClick: () => run('figure') },
          { label: 'Table…', onClick: () => run('table') },
          '-',
          { label: 'Page break', onClick: () => run('pagebreak') },
          { label: 'Horizontal rule', onClick: () => run('hrule') },
          { label: 'Multi-column region (2)', onClick: () => run('multicol') },
          { label: 'Code block…', onClick: () => run('codeBlock') },
          { label: 'Raw LaTeX…', onClick: () => run('rawLatex') },
          '-',
          {
            label: 'Compile markers',
            submenu: [
              { label: 'Compile start marker', onClick: () => run('compileStart') },
              { label: 'Compile end marker', onClick: () => run('compileEnd') },
              { label: 'Not-compile start marker', onClick: () => run('notCompileStart') },
              { label: 'Not-compile end marker', onClick: () => run('notCompileEnd') },
            ],
          },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Visual', shortcut: '⌘1', checked: tab === 'visual', onClick: () => switchTab('visual') },
          { label: 'Code', shortcut: '⌘2', checked: tab === 'code', onClick: () => switchTab('code') },
          { label: 'Console', shortcut: '⌘6', checked: tab === 'console', onClick: () => switchTab('console') },
          '-',
          { label: 'PDF side panel', shortcut: '⌘4', checked: showPdf, onClick: () => togglePdf() },
          { label: 'Visual only (no PDF, no compiling)', checked: !showPdf, onClick: () => togglePdf(false) },
          '-',
          { label: 'Zoom In', icon: ZoomIn, onClick: () => setZoomTo(effectiveZoom + 10) },
          { label: 'Zoom Out', icon: ZoomOut, onClick: () => setZoomTo(effectiveZoom - 10) },
          { label: 'Actual Size', onClick: () => setZoomTo(100) },
          { label: 'Fit Page Width', checked: fitWidth, onClick: () => setFitWidth((v) => !v) },
          '-',
          { label: 'Show formatting marks', checked: showMarks, onClick: () => run('marks') },
          { label: 'Check spelling', checked: spell, onClick: () => setSpell((v) => !v) },
        ],
      },
      {
        label: 'Review',
        items: [
          { label: 'Highlight', shortcut: '⇧⌘H', submenu: Object.keys(HIGHLIGHT_COLORS).map((color) => ({ label: color[0].toUpperCase() + color.slice(1), disabled: !st.hasSelection, onClick: () => chain().setMark('highlight', { color }).run() })) },
          { label: 'Remove highlight', onClick: () => chain().unsetMark('highlight').run() },
          '-',
          { label: 'New comment…', shortcut: '⌥⌘M', disabled: !st.hasSelection, onClick: () => run('comment') },
          { label: 'Accept comment', disabled: !st.inComment, onClick: () => run('acceptComment') },
          { label: 'Reject comment', disabled: !st.inComment, onClick: () => run('rejectComment') },
          '-',
          { label: 'Previous comment', onClick: () => run('prevComment') },
          { label: 'Next comment', onClick: () => run('nextComment') },
        ],
      },
      {
        label: 'Compiler',
        items: [
          { label: 'Compile PDF', shortcut: '⌘↩', onClick: () => run('compile') },
          '-',
          { label: 'Auto-compile', checked: autoCompile, onClick: () => run('auto') },
          { label: 'Skip images', checked: skipImages, onClick: () => run('skipImages') },
          { label: 'Compile range', checked: compileRange, onClick: () => run('compileRange') },
          '-',
          { label: 'Compiler status…', onClick: () => void compilerStatus() },
        ],
      },
      {
        label: 'Examples',
        items: [
          ...EXAMPLES.filter((x) => x.group === 'main').map((x) => ({ label: x.label, onClick: () => openExample(x.file) })),
          '-',
          { label: 'Journal / publisher templates', submenu: EXAMPLES.filter((x) => x.group === 'journal').map((x) => ({ label: x.label, onClick: () => openExample(x.file) })) },
        ],
      },
      {
        label: 'Help',
        items: [
          { label: 'Welcome tour', icon: BookOpen, onClick: () => openExample('welcome-tour.json') },
          { label: 'Keyboard shortcuts', icon: Keyboard, onClick: showShortcuts },
          '-',
          {
            label: 'About KherveTeX',
            icon: FileText,
            onClick: () =>
              void os.dialog.alert(
                'KherveTeX — WYSIWYG documents typeset with LaTeX. The KherveOS edition of the desktop KherveTeX: same .ktex files, same LaTeX. Free software (GPL-3.0).',
                { title: 'About KherveTeX' },
              ),
          },
        ],
      },
    ]
    win.setMenus(menus)
  })
  useEffect(() => () => win.setMenus(null), [win])

  // -------------------------------------------------------------- shortcuts

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return
    if (e.key === 'Escape' && findOpen) {
      setFindOpen(false)
      return
    }
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    const k = e.key.toLowerCase()
    let handled = true
    if (k === 's') void (e.shiftKey ? saveAs() : save())
    else if (k === 'o' && !e.shiftKey) void openDialog()
    else if (k === 'enter' || (e.ctrlKey && e.shiftKey && k === 'c')) run('compile')
    else if (k === 'f' && !e.shiftKey) run('find')
    else if (k === 'p' && !e.shiftKey) void print()
    else if (k === '1') switchTab('visual')
    else if (k === '2') switchTab('code')
    else if (k === '6') switchTab('console')
    else if (k === '3') togglePdf(true)
    else if (k === '4') togglePdf()
    else handled = false
    if (handled) e.preventDefault()
  }

  // ----------------------------------------------------------------- render

  const page = pageSizeByCode(meta.page_size)
  const z = effectiveZoom / 100
  const cm = (96 / 2.54) * z
  const pageStyle = {
    width: `${page.widthIn * 96 * z}px`,
    minHeight: `${page.heightIn * 96 * z}px`,
    padding: `${meta.margin_top_cm * cm}px ${meta.margin_right_cm * cm}px ${meta.margin_bottom_cm * cm}px ${meta.margin_left_cm * cm}px`,
    fontSize: `${meta.body_font_pt * z}pt`,
    fontFamily: fontStack(meta),
    lineHeight: String(lineHeight(meta)),
    '--ktx-cm': `${cm}px`,
  } as CSSProperties

  const status = compileView.running
    ? 'Compiling…'
    : compileView.ok === null
      ? ''
      : compileView.ok
        ? compileView.errors.length ? `Compiled (${compileView.errors.length} error${compileView.errors.length > 1 ? 's' : ''})` : 'Compiled'
        : 'Not compiled'

  /** Put the caret on the text nearest to a point outside it (margins, the grey around the page). */
  function caretNear(x: number, y: number) {
    const ed = edRef.current
    if (!ed) return
    const r = ed.view.dom.getBoundingClientRect()
    const hit = ed.view.posAtCoords({
      left: Math.min(Math.max(x, r.left + 2), r.right - 2),
      top: Math.min(Math.max(y, r.top + 2), r.bottom - 2),
    })
    if (hit) ed.chain().focus().setTextSelection(hit.pos).run()
    else ed.commands.focus('end')
  }

  const gotoError = (err: LatexError) => {
    if (!err.line || (err.file && err.file !== 'document.tex')) return
    setTab('code')
    window.setTimeout(() => codeView.current && revealLine(codeView.current, err.line!), 60)
  }

  return (
    <div
      ref={appRef}
      className={`k-app ktx-app${dragging ? ' ktx-dragging' : ''}`}
      onKeyDown={onKeyDown}
    >
      <TopToolbar
        st={st}
        meta={meta}
        flags={{ auto: autoCompile, skipImages, compileRange, pdf: showPdf, marks: showMarks, compiling: compileView.running }}
        run={run}
        onStyle={applyStyle}
        onMeta={updateMeta}
      />
      <div className="ktx-main">
        <SideToolbar meta={meta} run={run} />
        <div className="ktx-work" style={showPdf ? { flexBasis: `${100 - pdfWidth}%` } : undefined}>
          <div className="ktx-tabs">
            {(['visual', 'code', 'console'] as Tab[]).map((t) => (
              <button
                key={t}
                className={`ktx-tab${tab === t ? ' active' : ''}${t === 'console' && compileView.ok === false ? ' bad' : ''}`}
                onClick={() => switchTab(t)}
              >
                {t === 'visual' ? 'Visual' : t === 'code' ? 'Code' : 'Console'}
              </button>
            ))}
          </div>
          <div className="ktx-pane">
            <div
              ref={visualRef}
              className="ktx-visual"
              hidden={tab !== 'visual'}
              onMouseDown={(e) => {
                // A click beside the text puts the caret on the nearest line, like a word processor.
                const el = e.currentTarget
                const target = e.target as HTMLElement
                if (target !== el && !target.classList.contains('ktx-page')) return
                if (e.nativeEvent.offsetX >= el.clientWidth || e.nativeEvent.offsetY >= el.clientHeight) return // the scrollbar
                caretNear(e.clientX, e.clientY)
                e.preventDefault()
              }}
            >
              <div className={`ktx-page${showMarks ? ' marks' : ''}${meta.paragraph_indent ? ' indent' : ''}`} style={pageStyle}>
                <EditorContent editor={editor} />
              </div>
            </div>
            {tab === 'code' && (
              <CodeTab value={codeDraft ?? latex} error={codeError} onEdit={onCodeEdit} onReady={(v) => (codeView.current = v)} />
            )}
            {tab === 'console' && <ConsoleTab view={compileView} onGoto={gotoError} />}
            {symbolsOpen && tab === 'visual' && <SymbolPalette onPick={insertSymbol} onClose={() => setSymbolsOpen(false)} />}
            {loading && <div className="ktx-loading k-muted">Opening…</div>}
          </div>
          {findOpen && editor && <FindBar editor={editor} onClose={() => setFindOpen(false)} />}
        </div>
        {showPdf && (
          <>
            <div
              className="ktx-splitter"
              onPointerDown={(e) => {
                const host = appRef.current?.querySelector('.ktx-main') as HTMLElement | null
                if (!host) return
                ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
                setDragging(true)
                const rect = host.getBoundingClientRect()
                const move = (ev: PointerEvent) => setPdfWidth(Math.max(20, Math.min(75, ((rect.right - ev.clientX) / rect.width) * 100)))
                const up = () => {
                  setDragging(false)
                  window.removeEventListener('pointermove', move)
                  window.removeEventListener('pointerup', up)
                }
                window.addEventListener('pointermove', move)
                window.addEventListener('pointerup', up)
              }}
            />
            <div className="ktx-pdf-wrap" style={{ flexBasis: `${pdfWidth}%` }}>
              <PdfPanel
                url={pdf?.url ?? null}
                view={compileView}
                notice={pdfNotice}
                onCompile={() => void compile(true)}
                onDownload={() => void downloadPdf()}
                onClose={() => togglePdf(false)}
              />
            </div>
          </>
        )}
      </div>
      <div className="k-statusbar">
        <span className="ktx-status-path">{filePath ? path.pretty(filePath) : `${docName} — not saved yet`}</span>
        <span>{dirty ? 'Edited' : filePath ? 'Saved' : ''}</span>
        <span>{words} words</span>
        <span style={{ marginLeft: 'auto' }} className="ktx-zoom">
          <button className="ktx-zoom-btn" title="Zoom out" onClick={() => setZoomTo(effectiveZoom - 10)}>−</button>
          <button className={`ktx-zoom-btn wide${fitWidth ? ' on' : ''}`} title="Fit page width" onClick={() => setFitWidth((v) => !v)}>{effectiveZoom}%</button>
          <button className="ktx-zoom-btn" title="Zoom in" onClick={() => setZoomTo(effectiveZoom + 10)}>+</button>
        </span>
        <span className={`ktx-status-compile${compileView.ok === false ? ' bad' : ''}`}>{status}</span>
      </div>
      {dialog}
    </div>
  )
}
