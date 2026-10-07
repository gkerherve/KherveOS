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
import { strFromU8, strToU8 } from 'fflate'
import { os, fs, path, HOME, type AppProps, type MenuBarMenu, type MenuItem } from '@/os'
import { useWindows, desktopSize, isSmallScreen } from '@/os/windows'
import { DRAG_MIME } from '@/os/fileActions'
import { useAuth } from '@/os/server'
import { compileLatex, latexStatus, type LatexError } from '@/os/services/latex'
import {
  blankDocument, chapterEntry, citedKeys, classSupportsChapter, defaultMeta, fromJson, HIGHLIGHT_COLORS, plainText, projectFromJson,
  projectToJson, section, text, toJson, type DocMeta, type Document, type Project,
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
  CitationDialog, CrossRefDialog, FigureDialog, LinkDialog, MATH_ENVIRONMENTS, SettingsDialog, SymbolPalette,
  TableInsertDialog, TablePropsDialog, TextDialog,
  type Done, type FigureResult, type TableInsertResult, type TablePropsResult,
} from './ui/dialogs'
import { ChemfigEditor, ChemistryEditor, EquationEditor, unwrapCe, type EquationResult } from './ui/MathEditors'
import { CodeTab, ConsoleTab, FindBar, revealLine, type CompileView } from './ui/panels'
import { SideToolbar, STYLES, TopToolbar, type EditorSnapshot, type StyleCode } from './ui/Toolbar'
import { ACTIONS, iconUrl, type ActionId } from './ui/actions'
import { StatusBar } from './ui/StatusBar'
import { DocumentsPanel } from './ui/DocumentsPanel'
import { PdfView } from './ui/PdfView'
import PdfWindow from './PdfWindow'
import { dropLink, updateLink } from './pdfLink'
import * as git from '@/os/services/git'
import { openPdf as openPdfDoc } from '@/os/services/pdf'
import {
  chapterDocument, pageCountsFromLog, projectRows, projectSources, readDoc, recomputeAutoPages, safeName, uniquePath, writeDoc,
  writeProjectJson,
} from './project'
import { exportDocx, importDocx, importMarkdown, importPdf } from './importers2'
import { chartFromJson, chartToJson, naturalWidth, type Flowchart } from './flowchart'
import { FlowchartDialog, type FlowchartResult } from './ui/FlowchartDialog'
import { DrawingDialog, type DrawingResult } from './ui/DrawingDialog'
import {
  AboutDialog, BUNDLED_STYLES, HelpGuideDialog, HistoryDialog, RemoteDialog, ShortcutsDialog, StylesDialog, userStylesDir, WelcomeDialog,
  type WelcomeResult,
} from './ui/AppDialogs'
import type { ProjectView } from './ui/DocumentsPanel'
import './khervetex.css'

type Tab = 'visual' | 'code' | 'console'
/** Where the PDF lives (mainwindow.py apply_layout_mode): beside the editor, in its own window, or nowhere. */
export type Layout = 'side' | 'window' | 'visual' | 'page'

const LAYOUT_KEY = 'khervetex.layout'
const WELCOME_KEY = 'khervetex.showWelcome'
const RECENT_KEY = 'khervetex.recent'

function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // private mode: not remembered
  }
}

/** The desktop opens with the PDF in its own window; a small screen has no room for two. */
function initialLayout(): Layout {
  const saved = readSetting(LAYOUT_KEY) as Layout | null
  const mode = saved && ['side', 'window', 'visual', 'page'].includes(saved) ? saved : 'window'
  if (isSmallScreen()) return mode === 'window' || mode === 'side' ? 'visual' : mode
  return mode
}

export function recentFiles(): string[] {
  try {
    const v = JSON.parse(readSetting(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && fs.isFile(x)) : []
  } catch {
    return []
  }
}
function rememberRecent(p: string) {
  writeSetting(RECENT_KEY, JSON.stringify([p, ...recentFiles().filter((x) => x !== p)].slice(0, 8)))
}

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

/** The open project: its manifest, its main .ktex, the document in the editor, and documents read so far. */
interface ProjState {
  proj: Project
  mainPath: string
  idx: number
  cache: Map<number, Bundle>
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function MainWindow({ win, args }: AppProps) {
  const initial = useMemo(() => blankDocument(), [])
  const [meta, setMeta] = useState<DocMeta>(initial.meta)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [docName, setDocName] = useState('Untitled')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(!!(args.path || args.example || args.importTex))
  const [latex, setLatex] = useState(() => serializeDocument(initial))
  const [tab, setTab] = useState<Tab>('visual')
  const [layout, setLayout] = useState<Layout>(initialLayout)
  const [pdfWidth, setPdfWidth] = useState(62)
  const [docsVisible, setDocsVisible] = useState(layout !== 'page')
  const [docsFloat, setDocsFloat] = useState<{ x: number; y: number } | null>(null)
  const [pdfZoom, setPdfZoom] = useState(100)
  const [pdfFitZoom, setPdfFitZoom] = useState(100)
  const [pdfReveal, setPdfReveal] = useState<{ text: string; seq: number } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [compilerLabel, setCompilerLabel] = useState<{ text: string; ok: boolean | null }>({ text: 'LaTeX (tectonic)', ok: null })
  const [autoCompile, setAutoCompile] = useState(layout !== 'visual' && layout !== 'page')
  const [skipImages, setSkipImages] = useState(false)
  const [compileRange, setCompileRange] = useState(true)
  const [showMarks, setShowMarks] = useState(false)
  const [spell, setSpell] = useState(true)
  const [zoom, setZoom] = useState(100)
  const [fitWidth, setFitWidth] = useState(true)
  const [fitZoom, setFitZoom] = useState(100)
  const [findOpen, setFindOpen] = useState<false | 'find' | 'replace'>(false)
  const [pdfFit, setPdfFit] = useState(true)
  const [symbolsOpen, setSymbolsOpen] = useState(false)
  const [compileView, setCompileView] = useState<CompileView>({ running: false, ok: null, errors: [], log: '', at: null })
  const [pdf, setPdf] = useState<{ bytes: Uint8Array; version: number } | null>(null)
  const [pdfNotice, setPdfNotice] = useState<string | null>(null)
  const [dialog, setDialog] = useState<ReactNode>(null)
  const [dragging, setDragging] = useState(false)
  const [codeDraft, setCodeDraft] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)

  const files = useRef(new Map<string, Uint8Array>())
  const pdfWinId = useRef<string | null>(null)
  const [project, setProjectState] = useState<ProjState | null>(null)
  const projRef = useRef<ProjState | null>(null)
  const pendingCommitMessage = useRef<string | null>(null)
  const urls = useRef(new Map<string, string>())
  const extra = useRef<{ bib: string; project: string | null }>({ bib: '', project: null })
  const bibTexts = useRef<string[]>([])
  const savedJson = useRef(toJson(initial))
  const model = useRef<Document>(initial)
  const compiler = useRef({ running: false, pending: false, lastOk: '', lastFailed: '' })
  const timers = useRef<{ refresh?: number; compile?: number; code?: number; message?: number }>({})
  /** The folder an imported .tex came from: its pictures, .bib and .cls files compile with it. */
  const importDir = useRef<string | null>(null)
  const codeView = useRef<CMView | null>(null)
  const codeDraftRef = useRef<string | null>(null)
  /** Code-tab text not yet read back into the document. */
  const codePending = useRef(false)
  const visualRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<HTMLDivElement>(null)
  const lastPointer = useRef({ clientX: 200, clientY: 120 })
  const showPdf = layout === 'side' || layout === 'window'
  const live = useRef({ meta, filePath, dirty, autoCompile, skipImages, compileRange, showPdf, tab, pdf, latex, layout })
  live.current = { meta, filePath, dirty, autoCompile, skipImages, compileRange, showPdf, tab, pdf, latex, layout }

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
    await addStyles(out, m.meta.documentclass)
    return out
  }

  /** Manage styles: the user's .cls/.sty/.bst files, and the bundled ones, reach the compiler (style_manager.all_style_dirs). */
  async function addStyles(out: Record<string, string | Uint8Array>, documentclass: string) {
    const dir = userStylesDir(HOME)
    if (fs.isDir(dir)) {
      for (const st of fs.list(dir)) {
        if (st.type === 'file' && ['.cls', '.sty', '.bst'].includes(path.extname(st.name)) && !(st.name in out)) out[st.name] = await fs.readBytes(st.path)
      }
    }
    for (const name of BUNDLED_STYLES) {
      if (name in out || name !== `${documentclass}.cls`) continue
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}apps/khervetex/styles/${name}`)
        if (r.ok) out[name] = await r.text()
      } catch {
        // offline: the class is missing, LaTeX says so
      }
    }
  }

  function showPdfBytes(bytes: Uint8Array) {
    setPdf((old) => ({ bytes, version: (old?.version ?? 0) + 1 }))
  }

  /** QStatusBar.showMessage: a passing message in place of the document's name. */
  function flash(text: string, ms = 4000) {
    setMessage(text)
    window.clearTimeout(timers.current.message)
    timers.current.message = window.setTimeout(() => setMessage(null), ms)
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
    if (projRef.current) return compileProject(manual)
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
      rememberRecent(p)
      // A main .ktex holding project.json opens the whole project (mainwindow._open_path).
      if (bundle.project !== null) {
        setLoading(false)
        await openProjectFromPath(p, bundle)
        return
      }
      await leaveProject()
      applyBundle(bundle, p, name)
      const cached = path.join(path.dirname(p), `${docStem(name)}.pdf`)
      if (fs.isFile(cached)) showPdfBytes(await fs.readBytes(cached))
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
      void entry
      // As on the desktop, an example opens as an untitled document.
      applyBundle({ doc, files: new Map(), bib: '', project: null }, null, 'Untitled')
    } catch (e) {
      await os.dialog.alert(`Could not open the example: ${errorText(e)}`)
    } finally {
      setLoading(false)
    }
  }

  /** Untitled and untouched: a file can open in this window instead of a new one. */
  const pristine = () => !live.current.filePath && !live.current.dirty



  /** Examples ▸ …: each opens in a new window, so the current document isn't replaced (mainwindow._open_example). */
  function openExample(file: string) {
    os.open('khervetex', { example: file, _new: Date.now() })
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
        const proj = projRef.current
        const projectJson = proj && p === proj.mainPath ? projectToJson(proj.proj) : extra.current.project
        await fs.writeBytes(p, writeBundle({ doc: m, files: files.current, bib, project: projectJson }))
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
    if (projRef.current) return saveProject()
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
    rememberRecent(target)
    void gitSnapshot([target], pendingCommitMessage.current ?? undefined)
    pendingCommitMessage.current = null
    return true
  }

  async function save(): Promise<boolean> {
    if (projRef.current) return saveProject()
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
    rememberRecent(target)
    void gitSnapshot([target], pendingCommitMessage.current ?? undefined)
    pendingCommitMessage.current = null
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
        void downloadPdf() // no print dialog from here: download it instead (never a new tab)
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
    const r = await ask<EquationResult>((done) => (
      <EquationEditor initial={{ latex: selected, display, numbered: display, label: null }} showLayout done={done} />
    ))
    if (!r) return
    if (r.display || /\\begin\{/.test(r.latex)) insertBlock({ type: 'mathBlock', attrs: { latex: r.latex, numbered: r.numbered, label: r.label } })
    else chain().insertContent({ type: 'mathInline', attrs: { latex: r.latex } }).run()
  }

  /** Insert ▸ Chemical reaction: \ce{} rides in the ordinary maths nodes; mhchem is added on first use. */
  async function insertChemistry() {
    const r = await ask<{ latex: string; display: boolean }>((done) => <ChemistryEditor done={done} />)
    if (!r) return
    ensurePackage('mhchem')
    if (r.display) insertBlock({ type: 'mathBlock', attrs: { latex: r.latex, numbered: true, label: null } })
    else chain().insertContent({ type: 'mathInline', attrs: { latex: r.latex } }).run()
  }

  /** Insert ▸ Chemical structure: chemfig is text mode, so it goes in as raw LaTeX. */
  async function insertChemfig() {
    const latex = await ask<string>((done) => <ChemfigEditor done={done} />)
    if (!latex) return
    ensurePackage('chemfig')
    insertRaw(latex)
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
        const latex = String(a.latex ?? '')
        // A \ce{} reopens the chemistry editor (equation_editor: unwrap_ce).
        const ce = unwrapCe(latex)
        if (ce !== null) {
          const r = await ask<{ latex: string; display: boolean }>((done) => <ChemistryEditor initial={ce} done={done} />)
          if (r) setAttrs(pos, { latex: r.latex })
          return
        }
        const r = await ask<EquationResult>((done) => (
          <EquationEditor initial={{ latex, display: block, numbered: !!a.numbered, label: a.label ?? null }} showLayout={false} done={done} />
        ))
        if (r) setAttrs(pos, { latex: r.latex })
        return
      }
      case 'figure': {
        // A flowchart or a drawing reopens in its editor (flowchart_source_for / drawing_source_for).
        const stem = String(a.path ?? '').replace(/\.png$/i, '')
        if (a.source === 'flowchart' && files.current.has(`${stem}.flow.json`)) return insertFlowchart(pos)
        if (a.source === 'drawing' && files.current.has(`${stem}.svg`)) return insertDrawing(pos)
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

  function showInCode(given?: string) {
    const ed = edRef.current
    if (!ed) return
    const snippet = (given ?? ed.state.selection.$from.parent.textContent).trim().slice(0, 30)
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
            { label: 'Equation label…', disabled: !n.attrs.numbered, onClick: () => void labelEquation(pos) },
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
    add({ label: 'Show in Code', onClick: () => showInCode() }, { label: 'Show in PDF', onClick: () => showInPdf(sel.$from.parent.textContent) })
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
      case 'compile': void compile(true); break
      case 'auto': setAuto(!live.current.autoCompile); break
      case 'skipImages':
        live.current.skipImages = !live.current.skipImages
        setSkipImages(live.current.skipImages)
        if (live.current.autoCompile) scheduleCompile(50)
        break
      case 'compileRange':
        live.current.compileRange = !live.current.compileRange
        setCompileRange(live.current.compileRange)
        if (live.current.autoCompile) scheduleCompile(50)
        break
      case 'marks': setShowMarks((v) => !v); break
      case 'spell': setSpell((v) => !v); break
      case 'find': setFindOpen('find'); switchTab('visual'); break
      case 'replace': setFindOpen('replace'); switchTab('visual'); break
      case 'settings': case 'docProps': void openSettings(); break
      case 'new': newDocument(); break
      case 'newWindow': os.open('khervetex', { _new: Date.now() }); break
      case 'open': void openDialog(); break
      case 'openInNewWindow': void openDialog(true); break
      case 'save': void save(); break
      case 'saveAs': void saveAs(); break
      case 'closeDoc': newDocument(); break
      case 'exportPdf': void exportPdf(); break
      case 'exportTex': void exportTex(); break
      case 'exportZip': void exportZip(); break
      case 'print': void print(); break
      case 'printPreview': void printPreview(); break
      case 'importTex': void importDialog(); break
      case 'showInExplorer': if (live.current.filePath) os.open('files', { path: path.dirname(live.current.filePath) }); break
      case 'quit': win.close(); break
      case 'removeHighlight': chain().unsetMark('highlight').run(); break
      case 'viewVisual': switchTab('visual'); break
      case 'viewCode': switchTab('code'); break
      case 'viewConsole': switchTab('console'); break
      case 'viewPdf':
        if (live.current.layout === 'window') focusPdfWindow()
        else if (live.current.layout !== 'side') applyLayout('side')
        break
      case 'sideBySide': applyLayout(live.current.layout === 'side' ? 'visual' : 'side'); break
      case 'visualOnly': applyLayout('visual'); break
      case 'pdfWindow': applyLayout('window'); break
      case 'documents': setDocsVisible((v) => !v); break
      case 'fitPageWidth': setFit(!(fitWidth && pdfFit)); break
      default: return runMore(a)
    }
    return true
  }

  function setAuto(next: boolean) {
    live.current.autoCompile = next
    setAutoCompile(next)
    if (next) scheduleCompile(50)
  }

  // ------------------------------------------------- where the PDF lives

  /** mainwindow.py apply_layout_mode. */
  function applyLayout(mode: Layout) {
    const visual = mode === 'visual' || mode === 'page'
    live.current.layout = mode
    live.current.showPdf = !visual
    setLayout(mode)
    setDocsVisible(mode !== 'page')
    if (mode === 'window') openPdfWindow()
    else closePdfWindow()
    setAuto(!visual)
    writeSetting(LAYOUT_KEY, mode)
  }

  function openPdfWindow() {
    const ws = useWindows.getState()
    const existing = pdfWinId.current && ws.windows.find((w) => w.id === pdfWinId.current)
    if (existing) {
      ws.focus(existing.id)
      return
    }
    updateLink(win.id, { closing: false, pdfWinId: null })
    const id = os.open('khervetex', { pdfOf: win.id, _new: Date.now() })
    pdfWinId.current = id
    updateLink(win.id, { pdfWinId: id })
    if (id) placeSideBySide(id)
    win.focus()
  }

  function closePdfWindow() {
    if (!pdfWinId.current) return
    pdfWinId.current = null
    updateLink(win.id, { closing: true, pdfWinId: null })
  }

  function focusPdfWindow() {
    if (pdfWinId.current) useWindows.getState().focus(pdfWinId.current)
    else openPdfWindow()
  }

  /** The editor on the left, the PDF window beside it on the right — the desktop's first view. */
  function placeSideBySide(pdfId: string) {
    const ws = useWindows.getState()
    const me = ws.windows.find((w) => w.id === win.id)
    const desk = desktopSize()
    if (!me || desk.w < 900) return
    const h = desk.h - 16
    if (me.maximized || me.snapped) {
      const w = Math.round(desk.w * 0.4)
      ws.setBounds(pdfId, { x: desk.w - w - 8, y: 8, w, h })
      return
    }
    const total = desk.w - 24
    const mainW = Math.round(total * 0.6)
    ws.setBounds(win.id, { x: 8, y: 8, w: mainW, h })
    ws.setBounds(pdfId, { x: 16 + mainW, y: 8, w: total - mainW, h })
  }


  // ------------------------------------------------- more window actions

  async function labelEquation(pos: number) {
    const node = edRef.current?.state.doc.nodeAt(pos)
    if (!node) return
    const v = await ask<string>((done) => (
      <TextDialog title="Equation label" label="Label" mono initial={String(node.attrs.label ?? '')} placeholder="eq:energy" hint="Refer to it with Insert ▸ Cross-reference." done={done} />
    ))
    if (v !== null) setAttrs(pos, { label: v.trim() || null, numbered: true })
  }

  /** offer_save_before: false when the user cancels. */
  async function offerSave(reason: string): Promise<boolean> {
    if (toJson(currentModel()) === savedJson.current) return true
    const choice = await os.dialog.choose(
      `Save the changes to "${docName}" before ${reason}?`,
      [
        { label: 'Cancel', value: 'cancel' },
        { label: "Don't save", value: 'discard', danger: true },
        { label: 'Save', value: 'save', primary: true },
      ],
      { title: 'Unsaved changes' },
    )
    if (choice === 'save') return save()
    return choice === 'discard'
  }

  /** File ▸ New: a blank page in this window. */
  async function newDocument() {
    if (!(await offerSave('starting a new document'))) return
    await leaveProject()
    applyBundle({ doc: blankDocument(), files: new Map(), bib: '', project: null }, null, 'Untitled')
    win.setDocumentPath(null)
  }

  const IMPORTABLE = ['.tex', '.md', '.markdown', '.docx', '.pdf']

  async function openDialog(newWindow = false) {
    const p = await os.dialog.openFile({
      title: newWindow ? 'Open document in new window' : 'Open document',
      extensions: [...OPENABLE, ...IMPORTABLE.filter((e) => e !== '.tex')],
      startDir: live.current.filePath ? path.dirname(live.current.filePath) : `${HOME}/Documents`,
    })
    if (!p) return
    if (newWindow) {
      const ext = path.extname(p).toLowerCase()
      if (IMPORTABLE.includes(ext)) os.open('khervetex', { importPath: p, _new: Date.now() })
      else os.open('khervetex', { path: p })
      return
    }
    if (!(await offerSave('opening another document'))) return
    await openPath(p)
  }

  /** _open_path: documents open here; .tex/.md/.docx/.pdf are imported as a new, untitled document. */
  async function openPath(p: string) {
    const ext = path.extname(p).toLowerCase()
    if (ext === '.tex') return importTexPath(p)
    if (ext === '.md' || ext === '.markdown') return importMdPath(p)
    if (ext === '.docx') return importDocxPath(p)
    if (ext === '.pdf') return importPdfPath(p)
    await loadPath(p)
    if (live.current.filePath === p) win.setDocumentPath(p)
  }

  async function importPicked(title: string, exts: string[], run: (p: string) => Promise<void>) {
    const p = await os.dialog.openFile({ title, extensions: exts, startDir: `${HOME}/Documents` })
    if (!p) return
    if (!pristine()) {
      os.open('khervetex', { importPath: p, _new: Date.now() })
      return
    }
    await run(p)
  }

  function adoptImported(doc: Document, name: string, dir: string | null, pictures = new Map<string, Uint8Array>()) {
    applyBundle({ doc, files: pictures, bib: '', project: null }, null, `${name} (imported)`, dir)
    os.notify({ title: `Imported ${name}`, body: 'Save it to keep it as a KherveTeX document.' })
  }

  async function importMdPath(p: string) {
    setBusy('Importing…')
    try {
      adoptImported(importMarkdown(await fs.readText(p)), path.basename(p), path.dirname(p))
    } catch (e) {
      await os.dialog.alert(`Could not import ${path.basename(p)}: ${errorText(e)}`, { title: 'Import .md' })
    } finally {
      setBusy(null)
    }
  }

  async function importDocxPath(p: string) {
    setBusy('Importing…')
    try {
      const { doc, pictures } = importDocx(await fs.readBytes(p))
      const files = new Map<string, Uint8Array>()
      for (const b of doc.children) {
        if (b.type !== 'Figure' || !b.path.startsWith('@picture:')) continue
        const pic = pictures[Number(b.path.slice(9))]
        try {
          const { bytes, ext } = await toLatexPicture(pic.name, pic.bytes)
          b.path = nextFigurePath(files.keys(), ext)
          files.set(b.path, bytes)
        } catch {
          b.path = pic.name
        }
      }
      adoptImported(doc, path.basename(p), path.dirname(p), files)
    } catch (e) {
      await os.dialog.alert(`Could not import ${path.basename(p)}: ${errorText(e)}`, { title: 'Import .docx' })
    } finally {
      setBusy(null)
    }
  }

  async function importPdfPath(p: string) {
    setBusy('Importing…')
    let pdfDoc: Awaited<ReturnType<typeof openPdfDoc>> | null = null
    try {
      pdfDoc = await openPdfDoc(await fs.readBytes(p))
      const doc = await importPdf(pdfDoc, (n, total) => setBusy(`Importing page ${n} of ${total}…`))
      adoptImported(doc, path.basename(p), path.dirname(p))
    } catch (e) {
      await os.dialog.alert(`Could not import ${path.basename(p)}: ${errorText(e)}`, { title: 'Import .pdf' })
    } finally {
      pdfDoc?.close()
      setBusy(null)
    }
  }

  async function exportDocxFile() {
    const target = await os.dialog.saveFile({ title: 'Export Word document', defaultName: exportBase('.docx'), extensions: ['.docx'] })
    if (!target) return
    await fs.writeBytes(target, exportDocx(currentModel()))
    os.notify({ title: 'Word document exported', body: path.pretty(target) })
  }

  /** Print preview: the pages exactly as they will print, in KhervePDF. */
  async function printPreview() {
    const bytes = await fullPdf()
    if (!bytes) return
    const target = `/tmp/${suggestedName()} (print preview).pdf`
    await fs.writeBytes(target, bytes, { mkdirs: true })
    os.open('khervepdf', { path: target })
  }

  async function pasteFromClipboard() {
    try {
      const t = await navigator.clipboard.readText()
      if (t) chain().insertContent(t).run()
    } catch {
      await os.dialog.alert('Use ⌘V to paste: the browser only gives the clipboard to a key press.', { title: 'Paste' })
    }
  }

  // ------------------------------------------------- welcome, help, about

  async function showWelcome() {
    const r = await ask<WelcomeResult>((done) => (
      <WelcomeDialog recent={recentFiles()} layout={live.current.layout} showAtStart={readSetting(WELCOME_KEY) !== '0'} done={done} />
    ))
    if (!r) return
    writeSetting(WELCOME_KEY, r.showAtStart ? '1' : '0')
    if (r.layout !== live.current.layout) applyLayout(r.layout)
    const c = r.choice
    if (c.kind === 'new') void newDocument()
    else if (c.kind === 'open') void openDialog()
    else if (c.kind === 'project') void newProject()
    else if (c.kind === 'recent') void openPath(c.path)
    else if (c.kind === 'example') void loadExampleFile(c.file)
  }

  function showDialog(render: (close: () => void) => ReactNode) {
    void ask<true>((done) => render(() => done(true)))
  }

  async function connectClaude() {
    const go = await os.dialog.confirm(
      'Claude reaches the KherveOS apps through the KherveOS assistant and its MCP server. Open KherveAI to work with Claude beside this document?',
      { title: 'Connect to Claude', okLabel: 'Open KherveAI' },
    )
    if (go) os.open('kherveai')
  }

  // ---------------------------------------------------- my templates

  const TEMPLATES_DIR = `${HOME}/.khervetex/templates`

  function templatesMenu(): MenuItem[] {
    const list = fs.isDir(TEMPLATES_DIR) ? fs.list(TEMPLATES_DIR).filter((s) => s.type === 'file' && s.name.endsWith('.json')) : []
    if (!list.length) return [{ label: '(no saved templates)', disabled: true }]
    return list
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({
        label: s.name.slice(0, -5),
        submenu: [
          { label: 'Open in new window', onClick: () => os.open('khervetex', { template: s.path, _new: Date.now() }) },
          {
            label: 'Delete template',
            onClick: async () => {
              if (await os.dialog.confirm(`Permanently delete the template "${s.name.slice(0, -5)}"?`, { title: 'Delete template?', okLabel: 'Delete', danger: true })) {
                await fs.remove(s.path)
                flash(`Template deleted: ${s.name.slice(0, -5)}`)
              }
            },
          },
        ],
      }))
  }

  async function saveAsTemplate() {
    const m = currentModel()
    const name = await os.dialog.prompt('Template name:', { title: 'Save as template', defaultValue: m.meta.title || 'My template' })
    if (!name?.trim()) return
    const p = path.join(TEMPLATES_DIR, `${name.trim().replace(/[\\/:*?"<>|]+/g, ' ')}.json`)
    if (fs.exists(p) && !(await os.dialog.confirm(`A template named "${name.trim()}" already exists. Overwrite it?`, { title: 'Overwrite?' }))) return
    await fs.writeText(p, toJson(m), { mkdirs: true })
    flash(`Template saved: ${name.trim()}`)
  }

  // ------------------------------------------------------ cross navigation

  /** The words of a line of LaTeX or PDF text, without commands, to look for elsewhere. */
  function plainSnippet(text: string): string {
    return text.replace(/\\[a-zA-Z]+\*?\{?/g, ' ').replace(/[{}\\&%$]/g, '').replace(/\s+/g, ' ').trim()
  }

  /** Show in Visual: select the first paragraph holding the text. */
  function showInVisual(text: string) {
    const ed = edRef.current
    const words = plainSnippet(text).split(' ').filter((w) => w.length > 2)
    if (!ed || !words.length) {
      switchTab('visual')
      return
    }
    switchTab('visual')
    const probes = [words.slice(0, 5).join(' '), words.slice(0, 3).join(' '), words.slice(-3).join(' '), words[0]]
    for (const probe of probes) {
      let hit: { from: number; to: number } | null = null
      ed.state.doc.descendants((node, pos) => {
        if (hit || !node.isTextblock) return !hit
        const t = node.textContent.replace(/\s+/g, ' ')
        const i = t.indexOf(probe)
        if (i >= 0) hit = { from: pos + 1 + i, to: pos + 1 + i + probe.length }
        return false
      })
      if (hit) {
        const h = hit as { from: number; to: number }
        window.setTimeout(() => ed.chain().focus().setTextSelection(h).scrollIntoView().run(), 30)
        return
      }
    }
  }

  function showInPdf(text: string) {
    const snippet = plainSnippet(text)
    if (!snippet) return
    if (live.current.layout === 'visual' || live.current.layout === 'page') applyLayout('side')
    const next = { text: snippet, seq: Date.now() }
    setPdfReveal(next)
    updateLink(win.id, { reveal: next })
    if (live.current.layout === 'window') focusPdfWindow()
  }

  function showFromPdf(where: 'visual' | 'code', text: string) {
    win.focus()
    if (where === 'visual') showInVisual(text)
    else showInCode(plainSnippet(text))
  }

  // ---------------------------------------------------------------- citations

  /** Insert ▸ Check citations: cited keys no bibliography defines. */
  async function checkCitations() {
    const m = currentModel()
    const known = new Set(bibEntries().map((e) => e.key))
    const cited = new Set<string>()
    for (const k of citedKeys(m)) cited.add(k)
    const missing = [...cited].filter((k) => !known.has(k))
    await os.dialog.alert(
      !cited.size
        ? 'This document cites nothing yet.'
        : missing.length
          ? `${missing.length} cited key${missing.length > 1 ? 's are' : ' is'} not defined by any KherveRef library or bibliography file:\n\n${missing.join(', ')}`
          : `All ${cited.size} cited key${cited.size > 1 ? 's are' : ' is'} defined.`,
      { title: 'Check citations' },
    )
  }

  // --------------------------------------------------------------------- Git

  const [branch, setBranch] = useState<string | null>(null)
  useEffect(() => {
    const fp = filePath
    if (!fp) {
      setBranch(null)
      return
    }
    const root = git.findRoot(path.dirname(fp))
    if (!root) {
      setBranch(null)
      return
    }
    void git.currentBranch(root).then(setBranch).catch(() => setBranch(null))
  }, [filePath, dirty])

  async function gitIdentity(root: string): Promise<git.Identity> {
    const id = await git.resolveIdentity(root)
    if (id) return id
    const u = useAuth.getState().user
    return { name: u?.display_name || u?.username || 'KherveTeX', email: `${u?.username || 'khervetex'}@kherveos.local` }
  }

  /** _git_snapshot: commit the saved files (and upload them when a cloud is connected). */
  async function gitSnapshot(saved: string[], message?: string) {
    if (!saved.length) return
    const dir = path.dirname(saved[0])
    try {
      let root = git.findRoot(dir)
      if (!root) {
        await git.init(dir)
        root = dir
      }
      const rels = saved.map((f) => f.slice(root!.length).replace(/^\/+/, ''))
      await git.add(root, rels)
      const staged = (await git.status(root)).filter((f) => f.staged !== ' ')
      if (!staged.length) {
        flash('✔ Saved (nothing new to snapshot)')
        return
      }
      const name = path.basename(saved[0])
      const when = localIsoSeconds()
      await git.commit(root, { message: message || `Save ${name} at ${when}`, author: await gitIdentity(root) })
      if (await git.getRemoteUrl(root)) {
        flash('✔ Saved and snapshot created — uploading…', 60_000)
        try {
          await git.push(root, git.githubAuth())
          flash('✔ Saved, snapshot created, and uploaded to cloud', 5000)
        } catch (e) {
          flash('✔ Saved and snapshot created (⚠ upload failed — see dialog)', 8000)
          await os.dialog.alert(
            `${git.describeGitError(e)}\n\nWhat you can try:\n  • Check your internet connection\n  • Make sure the cloud URL is correct (Git → Connect to GitHub)\n  • Sign in to GitHub with a token in KherveOS`,
            { title: 'Upload failed' },
          )
        }
      } else flash('✔ Saved and snapshot created (use Git → Connect to GitHub to enable cloud backup)', 6000)
      const br = await git.currentBranch(root).catch(() => null)
      setBranch(br)
    } catch (e) {
      flash(`✔ Saved (no snapshot: ${git.describeGitError(e)})`, 6000)
    }
  }

  function needSaved(what: string, text: string): boolean {
    if (live.current.filePath) return true
    void os.dialog.alert(text, { title: what })
    return false
  }

  /** Git ▸ Save snapshot and upload: a message, then save (which snapshots). */
  async function commitNow() {
    if (!needSaved('Save snapshot', 'You need to save your document first before a snapshot can be created.\n\nUse File → Save (⌘S) to save it, then try again.')) return
    const fp = live.current.filePath!
    const def = `Save ${path.basename(fp)} at ${localIsoSeconds()}`
    const msg = await os.dialog.prompt('Describe what you changed:', { title: 'Commit message', defaultValue: def })
    if (msg === null) return
    pendingCommitMessage.current = msg.trim() || def
    await save()
  }

  async function pullFromRemote() {
    if (!needSaved('Download latest', 'You need to save your document first.\n\nUse File → Save (⌘S), then try again.')) return
    const fp = live.current.filePath!
    const root = git.findRoot(path.dirname(fp))
    if (!root || !(await git.getRemoteUrl(root))) {
      const yes = await os.dialog.confirm(
        'This document is not connected to a cloud service yet.\n\nTo download changes from a collaborator you first need to connect to GitHub, GitLab or another git server.\n\nWould you like to set that up now?',
        { title: 'Download latest' },
      )
      if (yes) void configureRemotes()
      return
    }
    flash('Downloading latest from origin…', 60_000)
    try {
      const r = await git.pull(root, { ...git.githubAuth(), author: await gitIdentity(root) })
      if (r.upToDate) flash('✔ Already up to date — you have the latest version', 5000)
      else {
        flash('✔ Downloaded the latest version', 6000)
        await loadPath(fp)
      }
    } catch (e) {
      setMessage(null)
      await os.dialog.alert(
        `${git.describeGitError(e)}\n\nWhat you can try:\n  • Check your internet connection\n  • Make sure the cloud URL is correct (Git → Connect to GitHub)\n  • If the problem says "diverged", ask a colleague for help or use the git command line`,
        { title: 'Download failed' },
      )
    }
  }

  async function configureRemotes() {
    if (!needSaved('Connect to cloud', 'You need to save your document first so KherveTeX knows where to create the connection.\n\nUse File → Save (⌘S), then try again.')) return
    const dir = path.dirname(live.current.filePath!)
    let root = git.findRoot(dir)
    if (!root) {
      await git.init(dir)
      root = dir
    }
    const r = root
    showDialog((close) => <RemoteDialog root={r} done={close} />)
  }

  async function showHistory(branchesOnly: boolean) {
    const fp = live.current.filePath
    if (!fp) {
      await os.dialog.alert(
        branchesOnly ? 'Save your document first so the repository exists.' : 'You need to save your document at least once before there is any history to show.\n\nUse File → Save (⌘S), then try again.',
        { title: branchesOnly ? 'Branches' : 'Version history' },
      )
      return
    }
    const root = git.findRoot(path.dirname(fp))
    if (!root) {
      await os.dialog.alert('No snapshots yet. Every time you save, KherveTeX automatically creates a snapshot.\n\nSave your document and come back here to see its history.', { title: 'Version history' })
      return
    }
    showDialog((close) => (
      <HistoryDialog
        root={root}
        file={branchesOnly ? null : fp}
        onRestore={(bytes) => {
          try {
            const b = readBundle(bytes)
            const m = b.doc
            files.current = new Map(b.files)
            live.current.meta = m.meta
            setMeta(m.meta)
            resetEditor(docToEditor(m))
            refresh()
            flash('Restored — save (⌘S) to record it as a new snapshot', 8000)
          } catch (e) {
            void os.dialog.alert(`Could not restore: ${errorText(e)}`, { title: 'Restore failed' })
          }
        }}
        done={close}
      />
    ))
  }

  // ------------------------------------------------------------- projects

  function setProject(p: ProjState | null) {
    projRef.current = p
    setProjectState(p ? { ...p } : null)
  }

  function projectTitle(): string {
    const p = projRef.current
    if (!p) return docName
    const ch = p.proj.chapters[p.idx]
    const t = p.proj.meta.title || docStem(path.basename(p.mainPath))
    return ch ? `${t} — ${ch.label || docStem(path.basename(ch.path))}` : t
  }

  function projectView(): ProjectView | null {
    const p = project
    if (!p) return null
    const { rows, summary } = projectRows(p.proj)
    return { title: p.proj.meta.title || 'Untitled Project', summary, autoPages: p.proj.auto_page_numbers, chapters: rows, active: p.idx }
  }

  const chapterPath = (p: ProjState, i: number) => path.join(path.dirname(p.mainPath), p.proj.chapters[i].path)

  /** _flush_current_chapter: the open document goes back to its file. */
  async function flushChapter() {
    const p = projRef.current
    if (!p || p.idx < 0) return
    const m = currentModel()
    const b: Bundle = { doc: m, files: new Map(files.current), bib: m.meta.ref_library ? extra.current.bib : '', project: p.idx === 0 ? projectToJson(p.proj) : null }
    p.cache.set(p.idx, b)
    const fp = chapterPath(p, p.idx)
    await writeDoc(fp, fp === p.mainPath ? { ...b, project: projectToJson(p.proj) } : b)
    savedJson.current = toJson(m)
    setDirty(false)
  }

  async function openProjectFromPath(p: string, given?: Bundle) {
    await leaveProject()
    try {
      const b = given ?? (await readDoc(p))
      if (!b.project) throw new Error(`${path.basename(p)} does not hold a project`)
      const proj = projectFromJson(b.project)
      const st: ProjState = { proj, mainPath: p, idx: -1, cache: new Map() }
      if (proj.chapters.length && path.join(path.dirname(p), proj.chapters[0].path) === p) st.cache.set(0, b)
      setProject(st)
      setDocsVisible(true)
      if (proj.chapters.length) await switchChapter(0)
      flash(`Opened project: ${proj.meta.title} (${proj.chapters.length} chapters)`, 5000)
    } catch (e) {
      await os.dialog.alert(errorText(e), { title: 'Open project failed' })
    }
  }

  async function leaveProject() {
    if (!projRef.current) return
    await flushChapter()
    setProject(null)
  }

  async function switchChapter(i: number) {
    const p = projRef.current
    if (!p || i < 0 || i >= p.proj.chapters.length) return
    await flushChapter()
    const fp = chapterPath(p, i)
    let b = p.cache.get(i)
    if (!b) {
      try {
        b = fs.isFile(fp) ? await readDoc(fp) : { doc: chapterDocument(p.proj.chapters[i].label, p.proj), files: new Map(), bib: '', project: null }
      } catch (e) {
        await os.dialog.alert(`Could not load ${p.proj.chapters[i].path}:\n${errorText(e)}`, { title: 'Chapter load failed' })
        return
      }
      p.cache.set(i, b)
    }
    p.idx = i
    applyBundle(b, fp, path.basename(fp))
    setProject(p)
    win.setDocumentPath(p.mainPath)
  }

  async function saveProject(): Promise<boolean> {
    const p = projRef.current
    if (!p) return false
    try {
      await flushChapter()
      if (p.idx !== 0) await writeProjectJson(p.mainPath, p.proj)
    } catch (e) {
      await os.dialog.alert(`Could not save the project: ${errorText(e)}`, { title: 'KherveTeX' })
      return false
    }
    const saved = [p.mainPath]
    if (p.idx > 0) saved.push(chapterPath(p, p.idx))
    void gitSnapshot(saved, pendingCommitMessage.current ?? undefined)
    pendingCommitMessage.current = null
    return true
  }

  async function newProject() {
    const title = await os.dialog.prompt('Project title:', { title: 'New Project', defaultValue: 'My Thesis' })
    if (!title?.trim()) return
    const dir = await os.dialog.pickFolder({ title: 'Choose project folder', startDir: `${HOME}/Documents` })
    if (!dir) return
    if (!(await offerSave('starting a project'))) return
    const proj: Project = {
      meta: defaultMeta({ documentclass: 'book', title: title.trim() }),
      chapters: [], bibliography: '', bib_style: '', auto_page_numbers: true,
    }
    const main = uniquePath(dir, safeName(title.trim()))
    proj.chapters.push(chapterEntry({ path: path.basename(main), label: 'Introduction', start_page: 1 }))
    const doc: Document = { type: 'Document', children: [section(1, [text('Introduction')])], meta: proj.meta }
    await writeDoc(main, { doc, files: new Map(), bib: '', project: projectToJson(proj) })
    await openProjectFromPath(main)
  }

  async function openProjectDialog() {
    const p = await os.dialog.openFile({ title: 'Open project', extensions: ['.ktex'], startDir: `${HOME}/Documents` })
    if (!p) return
    if (!(await offerSave('opening a project'))) return
    await openProjectFromPath(p)
  }

  /** _make_project_from_open_document: the open document becomes the project's main .ktex. */
  async function makeProjectFromOpenDocument(): Promise<boolean> {
    if (!live.current.filePath) {
      await os.dialog.alert('Save this document first — the documents of a project are kept together in its folder.', { title: 'Add document' })
      if (!(await saveAs())) return false
    }
    let main = live.current.filePath!
    if (!isBundlePath(main) || isLegacyBundle(main)) main = path.join(path.dirname(main), `${docStem(path.basename(main))}.ktex`)
    const m = currentModel()
    const stem = docStem(path.basename(main))
    const proj: Project = {
      meta: { ...m.meta, packages: [...m.meta.packages], title: m.meta.title || stem },
      chapters: [chapterEntry({ path: path.basename(main), label: stem, start_page: 1 })],
      bibliography: '', bib_style: '', auto_page_numbers: true,
    }
    const b: Bundle = { doc: m, files: new Map(files.current), bib: m.meta.ref_library ? extra.current.bib : '', project: projectToJson(proj) }
    await writeDoc(main, b)
    savedJson.current = toJson(m)
    await openProjectFromPath(main, b)
    return true
  }

  async function appendChapter(label: string) {
    const p = projRef.current
    if (!p) return
    const dir = path.dirname(p.mainPath)
    const chPath = uniquePath(dir, safeName(label).toLowerCase())
    const b: Bundle = { doc: chapterDocument(label, p.proj), files: new Map(), bib: '', project: null }
    await writeDoc(chPath, b)
    p.proj.chapters.push(chapterEntry({ path: path.basename(chPath), label }))
    p.cache.set(p.proj.chapters.length - 1, b)
    setProject(p)
    await switchChapter(p.proj.chapters.length - 1)
  }

  /** "+ Add ▸ New document…" */
  async function addNewDocument() {
    const inProject = !!projRef.current
    const label = await os.dialog.prompt('Name of the new document:', { title: 'Add document', defaultValue: inProject ? 'New Chapter' : 'Chapter 2' })
    if (!label?.trim()) return
    if (!inProject && !(await makeProjectFromOpenDocument())) return
    await appendChapter(label.trim())
    await saveProject()
  }

  /** "+ Add ▸ Existing file…": a .ktex of the folder is listed as it is; anything else is copied in as a .ktex. */
  async function addExistingDocuments() {
    const src = await os.dialog.openFile({ title: 'Add existing documents', extensions: ['.ktex', '.ktexz', '.kdocz', '.json', '.tex'], startDir: `${HOME}/Documents` })
    if (!src) return
    if (!projRef.current && !(await makeProjectFromOpenDocument())) return
    const p = projRef.current!
    const dir = path.dirname(p.mainPath)
    const have = new Set(p.proj.chapters.map((c) => path.join(dir, c.path)))
    if (have.has(src)) return
    try {
      let rel: string
      const native = isBundlePath(src) && !isLegacyBundle(src)
      if (native && path.dirname(src) === dir) rel = path.basename(src)
      else {
        let b: Bundle
        if (native || isBundlePath(src)) b = readBundle(await fs.readBytes(src))
        else if (src.toLowerCase().endsWith('.tex')) {
          const d = adoptSerializerPreamble(importTex(await fs.readText(src), { unwrapColumns: true }))
          b = { doc: d, files: new Map(), bib: '', project: null }
        } else b = { doc: fromJson(await fs.readText(src)), files: new Map(), bib: '', project: null }
        const dest = uniquePath(dir, docStem(path.basename(src)))
        await writeDoc(dest, { ...b, project: null })
        rel = path.basename(dest)
      }
      p.proj.chapters.push(chapterEntry({ path: rel, label: docStem(path.basename(src)) }))
      setProject(p)
      await saveProject()
      flash('Added 1 document', 5000)
    } catch (e) {
      await os.dialog.alert(`Could not add:\n${path.basename(src)}: ${errorText(e)}`, { title: 'Add documents' })
    }
  }

  function toggleChapter(i: number, on: boolean) {
    const p = projRef.current
    if (!p) return
    p.proj.chapters[i].enabled = on
    setProject(p)
    if (live.current.autoCompile) scheduleCompile(300)
  }

  async function reorderChapters(order: number[]) {
    const p = projRef.current
    if (!p) return
    await flushChapter()
    p.proj.chapters = order.map((i) => p.proj.chapters[i])
    const cache = new Map<number, Bundle>()
    order.forEach((old, nw) => {
      const b = p.cache.get(old)
      if (b) cache.set(nw, b)
    })
    p.cache = cache
    if (p.idx >= 0) p.idx = order.indexOf(p.idx)
    setProject(p)
    await saveProject()
    if (live.current.autoCompile) scheduleCompile(50)
  }

  async function moveChapter(i: number, d: number) {
    const p = projRef.current
    if (!p) return
    const j = i + d
    if (i < 0 || j < 0 || i >= p.proj.chapters.length || j >= p.proj.chapters.length) return
    const order = p.proj.chapters.map((_, k) => k)
    ;[order[i], order[j]] = [order[j], order[i]]
    await reorderChapters(order)
  }

  async function removeChapter(i: number) {
    const p = projRef.current
    if (!p || i < 0 || i >= p.proj.chapters.length) return
    if (p.proj.chapters.length === 1) {
      await os.dialog.alert('A project needs at least one document.', { title: 'Remove document' })
      return
    }
    const ch = p.proj.chapters[i]
    const name = ch.label || docStem(path.basename(ch.path))
    if (!(await os.dialog.confirm(`Remove “${name}” from the project?\n\nIts file stays in the project folder.`, { title: 'Remove document', okLabel: 'Remove' }))) return
    await flushChapter()
    const wasCurrent = i === p.idx
    const order = p.proj.chapters.map((_, k) => k).filter((k) => k !== i)
    p.proj.chapters.splice(i, 1)
    const cache = new Map<number, Bundle>()
    order.forEach((old, nw) => {
      const b = p.cache.get(old)
      if (b) cache.set(nw, b)
    })
    p.cache = cache
    if (wasCurrent) {
      p.idx = -1
      setProject(p)
      await switchChapter(Math.min(i, p.proj.chapters.length - 1))
    } else {
      if (p.idx > i) p.idx -= 1
      setProject(p)
    }
    await saveProject()
  }

  function setAutoPages(on: boolean) {
    const p = projRef.current
    if (!p) return
    p.proj.auto_page_numbers = on
    if (on) recomputeAutoPages(p.proj)
    setProject(p)
  }

  function chapterMenu(i: number): MenuItem[] {
    const p = projRef.current
    if (!p) return []
    const ch = p.proj.chapters[i]
    const redraw = () => setProject(p)
    const types: [string, string][] = [
      ['frontmatter', 'Front matter (preface, dedication…)'], ['chapter', 'Chapter (numbered)'], ['appendix', 'Appendix'], ['backmatter', 'Back matter (bibliography, index…)'],
    ]
    return [
      { label: 'Add document…', onClick: () => void addNewDocument() },
      { label: 'Move up', disabled: i === 0, onClick: () => void moveChapter(i, -1) },
      { label: 'Move down', disabled: i >= p.proj.chapters.length - 1, onClick: () => void moveChapter(i, 1) },
      '-',
      {
        label: 'Rename label…',
        onClick: async () => {
          const v = await os.dialog.prompt('Label:', { title: 'Rename chapter', defaultValue: ch.label })
          if (v?.trim()) {
            ch.label = v.trim()
            redraw()
          }
        },
      },
      {
        label: 'Section type',
        submenu: types.map(([key, label]) => ({
          label,
          checked: ch.chapter_type === key,
          onClick: () => {
            ch.chapter_type = key
            if (key === 'frontmatter' || key === 'backmatter') ch.numbering = 'roman'
            redraw()
          },
        })),
      },
      {
        label: 'Set chapter number…',
        onClick: async () => {
          const v = await os.dialog.prompt('Chapter number (0 = auto from position):', { title: 'Set chapter number', defaultValue: String(ch.chapter_number ?? 0) })
          if (v === null) return
          const n = Math.trunc(Number(v))
          ch.chapter_number = Number.isFinite(n) && n > 0 ? Math.min(n, 999) : null
          redraw()
        },
      },
      {
        label: 'Set start page…',
        onClick: async () => {
          const v = await os.dialog.prompt('Page number (0 = continue from previous):', { title: 'Set start page', defaultValue: String(ch.start_page ?? 0) })
          if (v === null) return
          const n = Math.trunc(Number(v))
          ch.start_page = Number.isFinite(n) && n > 0 ? Math.min(n, 9999) : null
          redraw()
        },
      },
      {
        label: 'Page numbering',
        submenu: [
          { label: 'Arabic (1, 2, 3…)', checked: ch.numbering === 'arabic', onClick: () => { ch.numbering = 'arabic'; redraw() } },
          { label: 'Roman (i, ii, iii…)', checked: ch.numbering === 'roman', onClick: () => { ch.numbering = 'roman'; redraw() } },
        ],
      },
      '-',
      { label: 'Remove from project…', onClick: () => void removeChapter(i) },
    ]
  }

  /** _compile_project: every enabled document through the master .tex. */
  async function compileProject(manual: boolean) {
    const p = projRef.current
    if (!p) return
    const c = compiler.current
    if (c.running) {
      c.pending = true
      return
    }
    const L = live.current
    const docs = new Map<number, Bundle>()
    const m = currentModel()
    for (let i = 0; i < p.proj.chapters.length; i++) {
      if (!p.proj.chapters[i].enabled) continue
      if (i === p.idx) docs.set(i, { doc: m, files: files.current, bib: '', project: null })
      else {
        let b = p.cache.get(i)
        if (!b) {
          try {
            b = await readDoc(chapterPath(p, i))
            p.cache.set(i, b)
          } catch {
            continue
          }
        }
        docs.set(i, b)
      }
    }
    const { tex, files: out } = projectSources(p.proj, docs, !L.skipImages)
    await addStyles(out, p.proj.meta.documentclass)
    if (!manual && (tex === c.lastOk || tex === c.lastFailed) && docs.size) return
    c.running = true
    setCompileView((v) => ({ ...v, running: true }))
    let result
    try {
      result = await compileLatex('document.tex', out)
    } finally {
      c.running = false
    }
    setCompileView({ running: false, ok: result.ok, errors: result.errors, log: result.log, at: new Date().toLocaleTimeString() })
    if (result.ok && result.pdf) {
      c.lastOk = tex
      showPdfBytes(result.pdf)
      setPdfNotice(null)
      try {
        const doc = await openPdfDoc(result.pdf)
        const total = doc.pageCount
        doc.close()
        if (pageCountsFromLog(p.proj, result.log, total)) setProject(p)
      } catch {
        // page counts stay as they were
      }
      flash('✔ Project compiled successfully', 5000)
    } else {
      c.lastFailed = tex
      const first = result.errors[0]
      setPdfNotice(first ? `Not compiled${first.line ? ` (line ${first.line})` : ''}: ${first.message}` : 'The project did not compile.')
    }
    if (c.pending) {
      c.pending = false
      scheduleCompile(50)
    }
  }

  /** Insert ▸ Drawing (or a double-click on a drawing): drawing_NNN.png, .svg and .pdf, as the desktop writes them. */
  async function insertDrawing(editPos: number | null = null) {
    let svg: string | null = null
    let stem: string | null = null
    if (editPos !== null) {
      const node = edRef.current?.state.doc.nodeAt(editPos)
      stem = String(node?.attrs.path ?? '').replace(/\.png$/i, '')
      const src = files.current.get(`${stem}.svg`)
      svg = src ? strFromU8(src) : null
    }
    const r = await ask<DrawingResult>((done) => <DrawingDialog initialSvg={svg} done={done} />)
    if (!r) return
    const target = stem ?? nextPictureStem('drawing')
    files.current.set(`${target}.png`, r.png)
    files.current.set(`${target}.svg`, strToU8(r.svg))
    if (r.pdf) files.current.set(`${target}.pdf`, r.pdf)
    else files.current.delete(`${target}.pdf`)
    const old = urls.current.get(`${target}.png`)
    if (old) {
      URL.revokeObjectURL(old)
      urls.current.delete(`${target}.png`)
    }
    // Without a PDF (LaTeX could not draw it), LaTeX includes the PNG.
    const source = r.pdf ? 'drawing' : ''
    if (editPos !== null) {
      setAttrs(editPos, { path: `${target}.png`, source })
      edRef.current?.view.dispatch(edRef.current.state.tr.setMeta(refreshKey, true))
    } else {
      const frac = Math.min(1, Math.max(0.2, Math.round((r.widthMm / 150) * 100) / 100))
      insertBlock({ type: 'figure', attrs: { path: `${target}.png`, caption: '', label: null, width: `${frac}\\textwidth`, source } })
    }
  }

  /** The next free figures/<kind>_NNN stem: no sibling of any of its files may exist. */
  function nextPictureStem(kind: string): string {
    for (let i = 1; ; i++) {
      const stem = `figures/${kind}_${String(i).padStart(3, '0')}`
      if (![...files.current.keys()].some((k) => k.startsWith(`${stem}.`))) return stem
    }
  }

  /** Insert ▸ Flowchart builder (or a double-click on a flowchart): PNG preview, PDF, .flow.json and .tikz side by side. */
  async function insertFlowchart(editPos: number | null = null) {
    let initialChart: Flowchart | null = null
    let stem: string | null = null
    if (editPos !== null) {
      const node = edRef.current?.state.doc.nodeAt(editPos)
      const p = String(node?.attrs.path ?? '')
      stem = p.replace(/\.png$/i, '')
      const src = files.current.get(`${stem}.flow.json`)
      if (src) {
        try {
          initialChart = chartFromJson(strFromU8(src))
        } catch {
          initialChart = null
        }
      }
    }
    const r = await ask<FlowchartResult>((done) => <FlowchartDialog initial={initialChart} done={done} />)
    if (!r) return
    const target = stem ?? nextPictureStem('flowchart')
    files.current.set(`${target}.png`, r.png)
    files.current.set(`${target}.pdf`, r.pdf)
    files.current.set(`${target}.flow.json`, strToU8(chartToJson(r.chart)))
    files.current.set(`${target}.tikz`, strToU8(r.tikz))
    const old = urls.current.get(`${target}.png`)
    if (old) {
      URL.revokeObjectURL(old)
      urls.current.delete(`${target}.png`)
    }
    if (editPos !== null) {
      setAttrs(editPos, { path: `${target}.png`, source: 'flowchart' })
      edRef.current?.view.dispatch(edRef.current.state.tr.setMeta(refreshKey, true))
    } else {
      insertBlock({ type: 'figure', attrs: { path: `${target}.png`, caption: '', label: null, width: naturalWidth(r.widthPt), source: 'flowchart' } })
    }
    ensurePackage('graphicx')
  }

  // ------------------------------------------------------- remaining actions

  function runMore(a: string): boolean {
    switch (a) {
      case 'equationBuilder': void insertMath(true); break
      case 'chemistry': void insertChemistry(); break
      case 'chemfig': void insertChemfig(); break
      case 'drawing': void insertDrawing(); break
      case 'flowchart': void insertFlowchart(); break
      case 'checkCitations': void checkCitations(); break
      case 'importMd': void importPicked('Import Markdown', ['.md', '.markdown'], importMdPath); break
      case 'importDocx': void importPicked('Import Word document', ['.docx'], importDocxPath); break
      case 'importPdf': void importPicked('Import PDF', ['.pdf'], importPdfPath); break
      case 'exportDocx': void exportDocxFile(); break
      case 'newProject': void newProject(); break
      case 'openProject': void openProjectDialog(); break
      case 'saveProject': void saveProject(); break
      case 'closeProject': void newDocument(); break
      case 'manageStyles': showDialog((close) => <StylesDialog dir={userStylesDir(HOME)} done={close} />); break
      case 'commitNow': void commitNow(); break
      case 'pull': void pullFromRemote(); break
      case 'remotes': void configureRemotes(); break
      case 'history': void showHistory(false); break
      case 'branches': void showHistory(true); break
      case 'helpGuide': showDialog((close) => <HelpGuideDialog done={close} />); break
      case 'shortcuts': showDialog((close) => <ShortcutsDialog done={close} />); break
      case 'about': showDialog((close) => <AboutDialog done={close} />); break
      default: return false
    }
    return true
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

  // What the window was opened with. With nothing, the desktop's first launch:
  // the welcome tour, and the Welcome page over it.
  useEffect(() => {
    // TipTap may replace its first editor while the window mounts: load once the live one is there.
    const whenReady = (fn: () => void, tries = 0) => {
      const ed = edRef.current
      if ((ed && !ed.isDestroyed && ed.schema) || tries > 300) fn()
      else window.setTimeout(() => whenReady(fn, tries + 1), 16)
    }
    whenReady(openInitial)
    if (live.current.layout === 'window') openPdfWindow()
    void latexStatus().then((st) =>
      setCompilerLabel(
        st === null
          ? { text: 'LaTeX (tectonic): server offline', ok: false }
          : st.available
            ? { text: 'LaTeX (tectonic): OK', ok: true }
            : { text: 'tectonic: NOT FOUND', ok: false },
      ),
    )
  }, [])

  function openInitial() {
    if (typeof args.path === 'string') void loadPath(args.path)
    else if (typeof args.importTex === 'string') void importTexPath(args.importTex)
    else if (typeof args.example === 'string') void loadExampleFile(args.example)
    else if (typeof args.importPath === 'string') void openPath(args.importPath)
    else if (typeof args.template === 'string') {
      const t = args.template
      void fs.readText(t).then(
        (json) => applyBundle({ doc: fromJson(json), files: new Map(), bib: '', project: null }, null, 'Untitled'),
        (e: unknown) => os.dialog.alert(`Could not load template:\n${errorText(e)}`, { title: 'Template error' }),
      )
    } else if (args.blank) {
      refresh()
      if (live.current.autoCompile) scheduleCompile(300)
    } else {
      void loadExampleFile('welcome-tour.json').then(() => {
        if (readSetting(WELCOME_KEY) !== '0') void showWelcome()
      })
    }
  }

  // Tidy up: timers, blob URLs, and the PDF window (closing the editor closes it).
  useEffect(
    () => () => {
      window.clearTimeout(timers.current.refresh)
      window.clearTimeout(timers.current.compile)
      window.clearTimeout(timers.current.code)
      window.clearTimeout(timers.current.message)
      for (const u of urls.current.values()) URL.revokeObjectURL(u)
      dropLink(win.id)
    },
    [],
  )

  const title = `KherveTeX — ${docName}`
  useEffect(() => {
    win.setTitle(`${dirty ? '• ' : ''}${title}`)
  }, [win, title, dirty])

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
    win.setCloseGuard(() => offerSave('closing'))
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
    const fit = () => setFitZoom(Math.max(25, Math.min(300, Math.floor(((el.clientWidth - 48) / (page.widthIn * 96)) * 100))))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [meta.page_size, tab, layout, docsVisible])

  // Remember where the pointer was, for menus opened from the toolbar.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      lastPointer.current = { clientX: e.clientX, clientY: e.clientY + 4 }
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [])

  // ------------------------------------------------------------------- zoom

  const effectiveZoom = fitWidth ? fitZoom : zoom
  /** The editor zoom slider: a manual zoom turns fit-to-width off (snapped to 5 %). */
  const setZoomTo = (z: number) => {
    setFitWidth(false)
    setZoom(Math.max(25, Math.min(300, 5 * Math.round(z / 5))))
  }
  const effectivePdfZoom = pdfFit ? pdfFitZoom : pdfZoom
  const setPdfZoomTo = (z: number) => {
    setPdfFit(false)
    setPdfZoom(Math.max(25, Math.min(400, 5 * Math.round(z / 5))))
  }
  /** View ▸ Fit page width and the status bar's button: the editor and the PDF together. */
  function setFit(on: boolean) {
    setFitWidth(on)
    setPdfFit(on)
  }

  // --------------------------------------------------- the PDF window link

  const linkHandlers = useRef({ userClose: () => {}, fitZoom: (_p: number) => {}, showIn: (_w: 'visual' | 'code', _t: string) => {} })
  linkHandlers.current = {
    userClose: () => {
      // The PDF window's own close button docks the PDF back (mainwindow.py _reattach_pdf_from_window).
      pdfWinId.current = null
      if (live.current.layout === 'window') applyLayout('side')
    },
    fitZoom: (p) => setPdfFitZoom(p),
    showIn: (where, text) => showFromPdf(where, text),
  }
  const stableLink = useMemo(
    () => ({
      onUserClose: () => linkHandlers.current.userClose(),
      onFitZoom: (p: number) => linkHandlers.current.fitZoom(p),
      showIn: (w: 'visual' | 'code', t: string) => linkHandlers.current.showIn(w, t),
    }),
    [],
  )

  // ------------------------------------------------------------------ menus

  const mi = (id: ActionId, opts: { checked?: boolean; disabled?: boolean; onClick?: () => void } = {}): MenuItem => {
    const a = ACTIONS[id] as { label: string; icon?: string; shortcut?: string }
    return {
      label: a.label,
      shortcut: a.shortcut,
      image: a.icon && !opts.checked ? <img className="ktx-menu-img" src={iconUrl(a.icon)} alt="" draggable={false} /> : undefined,
      checked: opts.checked,
      disabled: opts.disabled,
      onClick: opts.onClick ?? (() => run(id)),
    }
  }

  const chapterOk = classSupportsChapter(meta.documentclass)
  const frameOk = meta.documentclass.toLowerCase() === 'beamer'
  const recent = recentFiles()
  const allWindows = useWindows((s) => s.windows)
  const khervetexWindows = allWindows.filter((w) => w.appId === 'khervetex' && !w.args.pdfOf)
  const menus: MenuBarMenu[] = [
    {
      label: 'File',
      items: [
        mi('new'),
        mi('newWindow'),
        mi('open'),
        mi('openInNewWindow'),
        {
          label: 'Open recent',
          submenu: recent.length
            ? recent.map((p) => ({ label: path.basename(p), onClick: () => void openPath(p) }))
            : [{ label: '(empty)', disabled: true }],
        },
        '-',
        mi('save'),
        mi('saveAs'),
        mi('closeDoc'),
        '-',
        { label: 'Project', submenu: [mi('newProject'), mi('openProject'), mi('saveProject', { disabled: !project }), mi('closeProject', { disabled: !project })] },
        '-',
        { label: 'Import', submenu: [mi('importTex'), mi('importDocx'), mi('importPdf'), mi('importMd')] },
        {
          label: 'Export',
          submenu: [
            mi('exportTex'), mi('exportZip'), mi('exportDocx'), mi('exportPdf'),
            '-',
            { label: 'Download the PDF to this computer', onClick: () => void downloadPdf() },
          ],
        },
        '-',
        mi('printPreview'),
        mi('print'),
        '-',
        mi('showInExplorer', { disabled: !filePath }),
        mi('docProps'),
        mi('manageStyles'),
        '-',
        mi('quit'),
      ],
    },
    {
      label: 'Edit',
      items: [
        mi('undo', { disabled: !st.canUndo }),
        mi('redo', { disabled: !st.canRedo }),
        '-',
        mi('cut', { onClick: () => document.execCommand('cut') }),
        mi('copy', { onClick: () => document.execCommand('copy') }),
        mi('paste', { onClick: () => void pasteFromClipboard() }),
        mi('selectAll', { onClick: () => editor?.chain().focus().selectAll().run() }),
        '-',
        mi('find'),
        mi('replace'),
        '-',
        mi('clearFormat'),
      ],
    },
    {
      label: 'Format',
      items: [
        mi('bold', { checked: st.bold }),
        mi('italic', { checked: st.italic }),
        mi('underline', { checked: st.underline }),
        mi('strike', { checked: st.strike }),
        mi('code', { checked: st.code }),
        mi('smallcaps', { checked: st.smallcaps }),
        mi('subscript', { checked: st.subscript }),
        mi('superscript', { checked: st.superscript }),
        '-',
        {
          label: 'Alignment',
          submenu: [
            mi('alignLeft', { checked: (st.align ?? 'left') === 'left' }),
            mi('alignCenter', { checked: st.align === 'center' }),
            mi('alignRight', { checked: st.align === 'right' }),
            mi('alignJustify', { checked: st.align === 'justify' }),
          ],
        },
        '-',
        {
          label: 'Paragraph style',
          submenu: STYLES.filter(([code]) => code === 'body' || /^h\d$/.test(code)).map(([code, label]) => ({
            label,
            checked: st.style === code,
            image: code === 'body' ? undefined : <img className="ktx-menu-img" src={iconUrl(`heading-${code.slice(1)}`)} alt="" />,
            onClick: () => applyStyle(code),
          })),
        },
      ],
    },
    {
      label: 'Insert',
      items: [
        mi('mathInline'),
        mi('mathBlock'),
        mi('symbol'),
        mi('equationBuilder'),
        mi('chemistry'),
        mi('chemfig'),
        { label: 'Math environment', submenu: MATH_ENVIRONMENTS.map(([name, tex]) => ({ label: name, onClick: () => insertEnvironment(tex) })) },
        '-',
        mi('abstract'),
        mi('keywords'),
        '-',
        mi('bullet'),
        mi('ordered'),
        '-',
        mi('link'),
        mi('footnote'),
        mi('citation'),
        mi('crossref'),
        mi('checkCitations'),
        '-',
        mi('figure'),
        mi('table'),
        mi('drawing'),
        mi('flowchart'),
        '-',
        mi('pagebreak'),
        mi('hrule'),
        mi('multicol'),
        mi('codeBlock'),
        mi('rawLatex'),
        '-',
        mi('compileStart'),
        mi('compileEnd'),
        mi('notCompileStart'),
        mi('notCompileEnd'),
      ],
    },
    {
      label: 'View',
      items: [
        mi('viewVisual', { checked: tab === 'visual' }),
        mi('viewCode', { checked: tab === 'code' }),
        mi('viewPdf'),
        mi('viewConsole', { checked: tab === 'console' }),
        '-',
        mi('marks', { checked: showMarks }),
        '-',
        mi('visualOnly', { checked: layout === 'visual' || layout === 'page' }),
        mi('sideBySide', { checked: layout === 'side' }),
        mi('pdfWindow', { checked: layout === 'window' }),
        mi('documents', { checked: docsVisible }),
        '-',
        mi('fitPageWidth', { checked: fitWidth && pdfFit }),
        '-',
        mi('spell', { checked: spell }),
      ],
    },
    {
      label: 'Review',
      items: [
        mi('highlight', { disabled: !st.hasSelection }),
        mi('removeHighlight'),
        '-',
        mi('comment', { disabled: !st.hasSelection }),
        mi('acceptComment', { disabled: !st.inComment }),
        mi('rejectComment', { disabled: !st.inComment }),
        '-',
        mi('prevComment'),
        mi('nextComment'),
      ],
    },
    {
      label: 'Compiler',
      items: [
        { label: 'LaTeX (tectonic)', checked: true, onClick: () => {} },
        { label: 'Typst', disabled: true },
        '-',
        { label: 'Compiler status…', onClick: () => void compilerStatus() },
        { label: 'Download offline bundle…', disabled: true },
        { label: 'Open the package cache folder', disabled: true },
      ],
    },
    {
      label: 'Git',
      items: [mi('commitNow'), mi('pull'), '-', mi('history'), mi('branches'), '-', mi('remotes')],
    },
    {
      label: 'Examples',
      items: [
        ...EXAMPLES.filter((x) => x.group === 'main').map((x) => ({ label: x.label, onClick: () => openExample(x.file) })),
        '-',
        { label: 'Journal / publisher templates', submenu: EXAMPLES.filter((x) => x.group === 'journal').map((x) => ({ label: x.label, onClick: () => openExample(x.file) })) },
        '-',
        { label: 'My templates', submenu: templatesMenu() },
        { label: 'Save current as template…', onClick: () => void saveAsTemplate() },
      ],
    },
    {
      label: 'AI',
      items: [{ label: 'Connect to Claude…', onClick: () => void connectClaude() }],
    },
    {
      label: 'Window',
      items: [
        mi('newWindow'),
        mi('openInNewWindow'),
        '-',
        ...khervetexWindows.map((w) => ({
          label: w.title.replace(/^• /, '').replace(/^KherveTeX — /, ''),
          checked: w.id === win.id,
          onClick: () => useWindows.getState().focus(w.id),
        })),
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Welcome page…', onClick: () => void showWelcome() },
        mi('helpGuide'),
        mi('shortcuts'),
        '-',
        mi('about'),
      ],
    },
  ]
  void chapterOk
  void frameOk

  useEffect(() => {
    win.setMenus(menus)
    updateLink(win.id, {
      menus, title, notice: pdfNotice, compiling: compileView.running, pdf, zoom: effectivePdfZoom, fit: pdfFit,
      ...stableLink,
    })
  })
  useEffect(() => () => win.setMenus(null), [win])

  // -------------------------------------------------------------- shortcuts

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return
    if (e.key === 'Escape' && findOpen) {
      setFindOpen(false)
      return
    }
    if (e.key === 'F1') {
      e.preventDefault()
      run('helpGuide')
      return
    }
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    const k = e.key.toLowerCase()
    let handled = true
    if (k === 's') void (e.shiftKey ? saveAs() : save())
    else if (k === 'o' && !e.shiftKey) void openDialog()
    else if (k === 'o' && e.shiftKey) void openDialog(true)
    else if (k === 'enter' || (e.ctrlKey && e.shiftKey && k === 'c')) run('compile')
    else if (k === 'f' && !e.shiftKey) run('find')
    else if (k === 'f' && e.shiftKey) run('flowchart')
    else if (k === 'h' && e.ctrlKey && !e.shiftKey) run('replace')
    else if (k === 'p' && !e.shiftKey) void print()
    else if (k === 'p' && e.shiftKey) void printPreview()
    else if (k === 'e' && e.shiftKey) run('equationBuilder')
    else if (k === '1') switchTab('visual')
    else if (k === '2') switchTab('code')
    else if (k === '6') switchTab('console')
    else if (k === '3') run('viewPdf')
    else if (k === '4') run('sideBySide')
    else if (k === '5') run('documents')
    else if (k === '0') run('fitPageWidth')
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

  /** Put the caret on the text nearest to a point outside it (margins, the desk around the page). */
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

  const docsPanel = docsVisible && (
    <DocumentsPanel
      name={project ? '' : filePath ? docStem(path.basename(filePath)) : docName}
      project={projectView()}
      onClose={() => setDocsVisible(false)}
      onFloat={() => setDocsFloat((f) => (f ? null : { x: 60, y: 60 }))}
      onAddNew={() => void addNewDocument()}
      onAddExisting={() => void addExistingDocuments()}
      onOpen={(i) => void switchChapter(i)}
      onToggle={(i, on) => toggleChapter(i, on)}
      onMove={(i, d) => void moveChapter(i, d)}
      onRemove={(i) => void removeChapter(i)}
      onCompile={() => void compile(true)}
      onAutoPages={(on) => setAutoPages(on)}
      chapterMenu={chapterMenu}
    />
  )

  const pdfView = (
    <PdfView
      bytes={pdf?.bytes ?? null}
      zoom={effectivePdfZoom}
      fit={pdfFit}
      notice={pdfNotice}
      compiling={compileView.running}
      reveal={pdfReveal}
      onFitZoom={setPdfFitZoom}
      onContextMenu={(e, _page, text) =>
        os.contextMenu(e, [
          { label: 'Show in Visual', onClick: () => showFromPdf('visual', text) },
          { label: 'Show in Code', onClick: () => showFromPdf('code', text) },
        ])
      }
    />
  )

  return (
    <div ref={appRef} className={`k-app ktx-app${dragging ? ' ktx-dragging' : ''}`} onKeyDown={onKeyDown}>
      <TopToolbar
        st={st}
        meta={meta}
        flags={{ auto: autoCompile, skipImages, compileRange, marks: showMarks, spell, compiling: compileView.running }}
        run={run}
        onStyle={applyStyle}
        onMeta={updateMeta}
      />
      <div className="ktx-main">
        <SideToolbar meta={meta} run={run} />
        {docsPanel && !docsFloat && docsPanel}
        <div className="ktx-center">
          <div className="ktx-split">
            <div className="ktx-work" style={layout === 'side' ? { flexBasis: `${pdfWidth}%` } : undefined}>
              <div className="ktx-tabbar">
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
              <div className="ktx-tabpane">
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
                  <CodeTab
                    value={codeDraft ?? latex}
                    error={codeError}
                    onEdit={onCodeEdit}
                    onReady={(v) => (codeView.current = v)}
                    onContextMenu={(e, lineText) =>
                      os.contextMenu(e, [
                        { label: 'Show in Visual', onClick: () => showInVisual(lineText) },
                        { label: 'Show in PDF', onClick: () => showInPdf(lineText) },
                      ])
                    }
                  />
                )}
                {tab === 'console' && <ConsoleTab view={compileView} onGoto={gotoError} />}
                {symbolsOpen && <SymbolPalette onPick={insertSymbol} onClose={() => setSymbolsOpen(false)} />}
                {loading && <div className="ktx-loading">Opening…</div>}
              </div>
            </div>
            {layout === 'side' && (
              <>
                <div
                  className="ktx-splitter"
                  onPointerDown={(e) => {
                    const host = appRef.current?.querySelector('.ktx-split') as HTMLElement | null
                    if (!host) return
                    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
                    setDragging(true)
                    const rect = host.getBoundingClientRect()
                    const move = (ev: PointerEvent) => setPdfWidth(Math.max(20, Math.min(80, ((ev.clientX - rect.left) / rect.width) * 100)))
                    const up = () => {
                      setDragging(false)
                      window.removeEventListener('pointermove', move)
                      window.removeEventListener('pointerup', up)
                    }
                    window.addEventListener('pointermove', move)
                    window.addEventListener('pointerup', up)
                  }}
                />
                <div className="ktx-side-tabs">
                  <div className="ktx-tabbar">
                    <button className="ktx-tab active">PDF</button>
                  </div>
                  <div className="ktx-tabpane">{pdfView}</div>
                </div>
              </>
            )}
          </div>
          {findOpen && editor && <FindBar editor={editor} replace={findOpen === 'replace'} onClose={() => setFindOpen(false)} />}
        </div>
        {docsPanel && docsFloat && (
          <div className="ktx-dock-float" style={{ left: docsFloat.x, top: docsFloat.y }}>
            {docsPanel}
          </div>
        )}
      </div>
      <StatusBar
        name={project ? projectTitle() : filePath ? path.basename(filePath) : docName}
        folder={filePath ? path.pretty(path.dirname(filePath)) : null}
        branch={branch}
        message={message}
        editorZoom={effectiveZoom}
        showEditorZoom={tab === 'visual'}
        onEditorZoom={setZoomTo}
        pdfZoom={effectivePdfZoom}
        showPdfZoom={showPdf}
        onPdfZoom={setPdfZoomTo}
        fit={pdfFit}
        onFit={() => setFit(!pdfFit)}
        compiler={compilerLabel.text}
        compilerOk={compilerLabel.ok}
        compiling={compileView.running}
        busy={busy}
      />
      {dialog}
    </div>
  )
}

/** One app, two kinds of window: the editor, and the PDF window it opens beside itself. */
export default function KherveTeX(props: AppProps) {
  const mainId = props.args.pdfOf
  if (typeof mainId === 'string') return <PdfWindow {...props} mainId={mainId} />
  return <MainWindow {...props} />
}
