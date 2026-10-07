// KherveSlide: a slide designer that typesets with beamer — the desktop
// KherveSlide (../KherveSlide, branch dev, kherveslide/window.py) in KherveOS,
// laid out as the desktop lays it out:
//
//   main window   top toolbar · vertical "Insert & arrange" toolbar on the left
//                 Visual | LaTeX | Console tabs (Visual = Slides list + the
//                 Frame / Header fields, the slide, the Foot fields)
//                 status bar: message · "Compiled ✓" · Slide n of N · Theme ·
//                 Normal / Overview / Master · slideshow · zoom
//   PDF window    PDF | Overview tabs, a second KherveOS window placed to the
//                 right (View ▸ Visual + PDF in its own window, the default),
//                 or docked beside the Visual editor (side by side), or hidden
//                 (Visual only).
//
// As on the desktop the presentation model (model.ts) is the single source of
// truth: the navigator and the Visual canvas draw it, serializer.ts turns it
// into exactly the beamer LaTeX the desktop writes, and the KherveOS server
// compiles that with tectonic (os/services/latex.ts) for the PDF and the exact
// theme under the canvas (backdrop.ts). Files are the desktop's .kslide JSON.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { zipSync } from 'fflate'
import type { EditorView } from '@codemirror/view'
import { os, fs, path as P, HOME, type AppProps, type MenuBarMenu, type MenuItem } from '@/os'
import { useWindows, desktopSize, isSmallScreen } from '@/os/windows'
import { useAppTools } from '@/os/ai/appTools'
import { compileLatex } from '@/os/services/latex'
import { openPdf } from '@/os/services/pdf'
import {
  cloneDeck, fromJson, lowerObject, makeObject, makeSlide, raiseObject, slideHeading, toBack, toFront, toJson,
  type Deck, type Slide, type SlideObject, type SlidePicture, type SlideTable, type SlideText,
} from './model'
import { serializeDeck, BEAMER_COLOR_THEMES, BEAMER_THEMES, BLOCK_ENVS, THEOREM_ENVS } from './serializer'
import { SHAPE_GROUPS } from './shapes'
import { addSlideFromBullets, applyKit, bulletBox, bulletsOf, itemize, newFromTemplate, SLIDE_LAYOUTS, slideLayout, TEMPLATES, THEME_PRESETS } from './templates'
import { ASPECTS, deckLook } from './look'
import { compileBundle, isPicture, Media, PICTURE_EXTENSIONS } from './media'
import { useBackdrop } from './backdrop'
import { fetchExample, findExample, loadExamples, type ExampleItem } from './examples'
import { Canvas } from './Canvas'
import { Navigator } from './Navigator'
import { ConsoleTab, LatexTab } from './Panels'
import { Overview, PdfWindow, RightTabs } from './PdfPane'
import { Present, type AutoPlay } from './Present'
import { ColorButton, EquationDialog, FieldsDialog, type FieldSpec, type Values } from './dialogs'
import {
  AboutDialog, applyTableStyle, AutoSlideshowDialog, ChemfigDialog, chemfigDoc, CompilerStatusDialog, ListDialog, SymbolDialog, TableDesignDialog,
  TableGridDialog, TEXT_MODE_SYMBOLS, ThemeGallery, UserGuideDialog, type ShowMode, type TableStyle,
} from './desktopDialogs'
import { FRAME, OBJECT_FIELDS, THEME_FIELDS } from './props'
import { geometry, SlideView } from './SlideView'
import { texToPlain } from './texhtml'
import { Ico, menuIcon } from './icons'
import { tip, TIPS } from './tooltips'
import { FontSpin, SideToolbar, TopToolbar, ViewBar, type TBItem, type ViewMode } from './Toolbars'
import { useLinks, type PdfLink, type PdfLinkActions, type RightTab } from './link'
import { LAYOUT_TEXT, RecentPanel, StartPage, type Layout } from './Start'
import './kherveslide.css'

export default function KherveSlide(props: AppProps) {
  return typeof props.args.pdfFor === 'string' ? <PdfWindow {...props} /> : <MainWindow {...props} />
}

// ------------------------------------------------------------------ settings (the desktop's QSettings)

interface Prefs {
  layout: Layout
  autoCompile: boolean
  skipImages: boolean
  showTheme: boolean
  gridDivisions: number
  spellcheck: boolean
  spellLang: string
  showWelcome: boolean
  recent: string[]
  /** User templates: name → the presentation's JSON (templates.TemplateStore). */
  templates: Record<string, string>
  autoShow: AutoPlay & { mode: ShowMode; fromCurrent: boolean }
}

const PREFS_KEY = 'kherveslide.prefs'
const DEFAULT_PREFS: Prefs = {
  // First launch: the PDF in its own window (welcome.LAYOUT_DEFAULT).
  layout: 'window',
  autoCompile: true,
  skipImages: false,
  showTheme: true,
  gridDivisions: 40,
  spellcheck: true,
  spellLang: 'en',
  showWelcome: false,
  recent: [],
  templates: {},
  autoShow: { seconds: 10, repeat: 'once', minutes: 30, mode: 'full', fromCurrent: false },
}

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>) }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

function savePrefs(p: Partial<Prefs>) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...p }))
  } catch {
    /* private mode: the defaults next time */
  }
}

// ------------------------------------------------------------------ helpers

interface CompileState {
  busy: boolean
  log: string
  errors: { line?: number; file?: string; message: string }[]
  missing: string[]
  pdf: Uint8Array | null
  /** What the PDF was made from ("n"/"s" for with / without pictures, then the LaTeX). */
  of: string
}

type StatusKind = 'idle' | 'busy' | 'ok' | 'err'

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv']
const HISTORY_MAX = 200
const GRID_SIZES: [string, number][] = [['Coarse (10)', 10], ['Medium (20)', 20], ['Fine (40)', 40], ['Very fine (60)', 60], ['Ultra fine (80)', 80]]
const SPELL_LANGUAGES: [string, string][] = [['English', 'en'], ['French', 'fr'], ['German', 'de'], ['Spanish', 'es'], ['Portuguese', 'pt'], ['Russian', 'ru']]
const DEFAULT_MESSAGE = 'Double-click to edit • while editing, ⌘B / ⌘I bold/italicise the selection'

/** Box ▸ kinds (window._build_toolbar's type combo). */
const BOX_KINDS: [string, string][] = [
  ['text', 'Text'], ['block', 'Block'], ['alertblock', 'Alert block'], ['exampleblock', 'Example block'], ['theorem', 'Theorem'],
  ['definition', 'Definition'], ['corollary', 'Corollary'], ['lemma', 'Lemma'], ['example', 'Example (thm)'], ['proof', 'Proof'], ['fact', 'Fact'],
  ['equation', 'Equation'], ['image', 'Image'], ['table', 'Table'],
]
const COLOURED_BLOCKS = new Set(['block', 'alertblock', 'exampleblock'])
const ALL_BLOCK_ENVS = new Set([...BLOCK_ENVS, ...THEOREM_ENVS])
const TEXT_KINDS = new Set(['text', 'equation', ...ALL_BLOCK_ENVS])

/** Dynamic bits for a header / footer / frame-title slot (window._HF_INSERTS). */
const HF_INSERTS: ([string, string] | null)[] = [
  ['Slide number', '\\insertframenumber'],
  ['Slide n / N', '\\insertframenumber\\,/\\,\\inserttotalframenumber'],
  ['Total slides', '\\inserttotalframenumber'],
  null,
  ['Date (today)', '\\today'],
  ['Date (numbers)', '\\the\\day/\\the\\month/\\the\\year'],
  ['Year', '\\the\\year'],
  null,
  ['Presentation title', '\\inserttitle'],
  ['Short title', '\\insertshorttitle'],
  ["This slide's frame title", '\\insertframetitle'],
  ['Author', '\\insertauthor'],
  ['Short author', '\\insertshortauthor'],
  ['Institute', '\\insertinstitute'],
  null,
  ['Section', '\\insertsectionhead'],
  ['Subsection', '\\insertsubsectionhead'],
]

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const stemOf = (p: string) => P.basename(p).replace(/\.kslide(\.json)?$/i, '').replace(/\.json$/i, '')
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const K = (s: string) => (isMac ? s : s.replace(/⌘/g, 'Ctrl+').replace(/⇧/g, 'Shift+').replace(/⌥/g, 'Alt+'))

/** Objects copied with ⌘C, shared by every KherveSlide window. */
let objectClipboard: SlideObject[] = []

const INCLUDE_RE = /\\includegraphics(\*?)(\[[^\]]*\])?\{([^}]+)\}/g

/** compiler._strip_images: every picture becomes an empty framed box of its size. */
function stripImages(tex: string): string {
  return tex.replace(INCLUDE_RE, (_m, _star: string, opts: string | undefined) => {
    const w = /width=([^,\]]+)/.exec(opts ?? '')?.[1].trim() ?? '0.3\\paperwidth'
    const h = /height=([^,\]]+)/.exec(opts ?? '')?.[1].trim() ?? '0.2\\paperheight'
    return `{\\setlength{\\fboxsep}{0pt}\\framebox[${w}]{\\rule{0pt}{${h}}}}`
  })
}

/** A box holding nothing but maths (canvas._math_only): the inner LaTeX, or null. */
function mathOnly(text: string): string | null {
  const t = text.trim()
  const m = /^\$\$([\s\S]+)\$\$$/.exec(t) ?? /^\\\[([\s\S]+)\\\]$/.exec(t) ?? /^\$([^$]+)\$$/.exec(t)
  return m ? m[1].trim() : null
}

/** \ce{…} → its body (chemistry.unwrap_ce), else null. */
function unwrapCe(inner: string): string | null {
  const m = /^\\ce\{([\s\S]*)\}$/.exec(inner.trim())
  return m ? m[1] : null
}

function objKind(o: SlideObject | undefined): string {
  if (!o) return 'text'
  if (o.type === 'SlidePicture') return 'image'
  if (o.type === 'SlideTable') return 'table'
  if (o.type === 'SlideText') {
    if (ALL_BLOCK_ENVS.has(o.block)) return o.block
    if (o.text.includes('$')) return 'equation'
  }
  return 'text'
}

/** Change a textarea's text as if typed (React sees an input event). */
function editTextarea(ta: HTMLTextAreaElement, fn: (v: string, a: number, b: number) => { value: string; a: number; b: number }) {
  const r = fn(ta.value, ta.selectionStart, ta.selectionEnd)
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, r.value)
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  ta.setSelectionRange(r.a, r.b)
}

/** The in-place text editor, when it has the focus. */
const activeEditor = (): HTMLTextAreaElement | null => {
  const el = document.activeElement
  return el instanceof HTMLTextAreaElement && el.classList.contains('ks2-editor') ? el : null
}

/** The browser's print dialog for a PDF (File ▸ Print… / Print preview…). */
function printPdf(pdf: Uint8Array) {
  const url = URL.createObjectURL(new Blob([pdf as BlobPart], { type: 'application/pdf' }))
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  frame.src = url
  frame.onload = () => {
    try {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
    } catch {
      os.notify({ title: 'Print', body: 'The browser would not print the PDF; export it and print it from KhervePDF.' })
    }
    setTimeout(() => {
      frame.remove()
      URL.revokeObjectURL(url)
    }, 60_000)
  }
  document.body.appendChild(frame)
}

// ------------------------------------------------------------------ the main window

function MainWindow({ win, args }: AppProps) {
  const media = useMemo(() => new Media(), [])
  useEffect(() => () => media.dispose(), [media])
  const initialPrefs = useMemo(loadPrefs, [])

  const [deck, setDeckState] = useState<Deck>(() => newFromTemplate('Title + content'))
  const deckRef = useRef(deck)
  const past = useRef<Deck[]>([])
  const future = useRef<Deck[]>([])
  const [, setHistoryTick] = useState(0)
  const [current, setCurrent] = useState(0)
  const [view, setView] = useState<ViewMode>('normal')
  const masterMode = view === 'master'
  const [sel, setSel] = useState<number[]>([])
  const [editingText, setEditingText] = useState<number | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [savedJson, setSavedJson] = useState(() => toJson(deck))
  const [compile, setCompile] = useState<CompileState>({ busy: false, log: '', errors: [], missing: [], pdf: null, of: '' })
  const [compileStatus, setCompileStatus] = useState<{ text: string; kind: StatusKind }>({ text: 'Ready', kind: 'idle' })
  const [zoom, setZoom] = useState(1)
  const [present, setPresent] = useState<{ start: number; pdf: Uint8Array | null; presenter: boolean; windowed: boolean; auto: AutoPlay | null } | null>(null)
  const [modal, setModal] = useState<ReactNode>(null)
  const [examples, setExamples] = useState<ExampleItem[] | null>(null)
  const [loading, setLoading] = useState(!!(args.path || args.example))
  const [untitledName, setUntitledName] = useState('Untitled')
  const [layout, setLayout] = useState<Layout>(initialPrefs.layout)
  const [leftTab, setLeftTab] = useState<'visual' | 'latex' | 'console'>('visual')
  const [rightTab, setRightTab] = useState<RightTab>('pdf')
  const [navShown, setNavShown] = useState(true)
  const [showTheme, setShowTheme] = useState(initialPrefs.showTheme)
  const [autoCompile, setAutoCompile] = useState(initialPrefs.autoCompile)
  const [skipImages, setSkipImages] = useState(initialPrefs.skipImages)
  const [showGrid, setShowGrid] = useState(false)
  const [gridDivisions, setGridDivisions] = useState(initialPrefs.gridDivisions)
  const [snapGrid, setSnapGrid] = useState(false)
  const [snapObjects, setSnapObjects] = useState(false)
  const [spell, setSpell] = useState(initialPrefs.spellcheck)
  const [spellLang, setSpellLang] = useState(initialPrefs.spellLang)
  const [find, setFind] = useState<{ open: boolean; text: string; count: string }>({ open: false, text: '', count: '' })
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [override, setOverride] = useState<{ text: string; base: string } | null>(null)
  const [pageTick, setPageTick] = useState(0)
  const [welcome, setWelcome] = useState(initialPrefs.showWelcome && !args.path && !args.example && !args.template)
  const [rightWidth, setRightWidth] = useState(0.4)
  const [prefsTick, setPrefsTick] = useState(0)

  const slideIndex = Math.max(0, Math.min(current, deck.slides.length - 1))
  const slide: Slide = masterMode ? deck.master : (deck.slides[slideIndex] ?? makeSlide())
  const look = useMemo(() => deckLook(deck), [deck])
  const backdrop = useBackdrop(deck, media, showTheme)
  const json = useMemo(() => toJson(deck), [deck])
  const generated = useMemo(() => serializeDeck(deck), [deck])
  const latexSource = override?.text ?? generated
  const dirty = json !== savedJson
  const docName = filePath ? P.basename(filePath) : untitledName
  const title = `${dirty ? '• ' : ''}${docName} — KherveSlide`
  const pdfPageOf = (row: number) => deck.slides.slice(0, row).filter((s) => !s.hidden).length

  // ------------------------------------------------------------------ status bar

  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flash = useCallback((text: string, ms = 4000) => {
    setMessage(text)
    if (msgTimer.current) clearTimeout(msgTimer.current)
    if (ms) msgTimer.current = setTimeout(() => setMessage(''), ms)
  }, [])
  useEffect(() => () => {
    if (msgTimer.current) clearTimeout(msgTimer.current)
  }, [])

  // ------------------------------------------------------------------ the model and its history

  const setDeck = useCallback((next: Deck, record = true) => {
    if (record) {
      past.current.push(deckRef.current)
      if (past.current.length > HISTORY_MAX) past.current.shift()
      future.current = []
      setHistoryTick((t) => t + 1)
    }
    deckRef.current = next
    setDeckState(next)
  }, [])

  /** Change the presentation (a copy is changed; the old one goes to Undo). */
  const mutate = useCallback(
    (fn: (d: Deck) => void, record = true) => {
      const d = cloneDeck(deckRef.current)
      fn(d)
      setDeck(d, record)
    },
    [setDeck],
  )

  const live = useRef({ slideIndex, masterMode, sel })
  live.current = { slideIndex, masterMode, sel }
  const target = (d: Deck) => (live.current.masterMode ? d.master : d.slides[live.current.slideIndex])

  const editSlide = useCallback(
    (fn: (s: Slide) => void, record = true) =>
      mutate((d) => {
        const s = target(d)
        if (s) fn(s)
      }, record),
    [mutate],
  )
  const begin = useCallback(() => {
    past.current.push(deckRef.current)
    future.current = []
    setHistoryTick((t) => t + 1)
  }, [])

  const undo = () => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(deckRef.current)
    deckRef.current = prev
    setDeckState(prev)
    setSel([])
    setOverride(null)
    setHistoryTick((t) => t + 1)
  }
  const redo = () => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(deckRef.current)
    deckRef.current = next
    setDeckState(next)
    setSel([])
    setOverride(null)
    setHistoryTick((t) => t + 1)
  }

  const addRecent = (p: string) => {
    const recent = [p, ...loadPrefs().recent.filter((x) => x !== p)].slice(0, 20)
    savePrefs({ recent })
    setPrefsTick((t) => t + 1)
  }

  /** Start over with this presentation (no undo back to the previous one). */
  const replaceDeck = (d: Deck, path: string | null, name = 'Untitled') => {
    past.current = []
    future.current = []
    deckRef.current = d
    setDeckState(d)
    setSavedJson(toJson(d))
    setFilePath(path)
    setUntitledName(name)
    setCurrent(0)
    setSel([])
    setEditingText(null)
    setView('normal')
    setOverride(null)
    setWelcome(false)
    setCompile({ busy: false, log: '', errors: [], missing: [], pdf: null, of: '' })
    media.deckDir = path ? P.dirname(path) : null
    win.setDocumentPath(path)
    if (path) addRecent(path)
  }

  useEffect(() => {
    win.setTitle(title)
  }, [win, title])

  useEffect(() => {
    setSel([])
    setEditingText(null)
  }, [slideIndex, masterMode])

  // A real slide edit regenerates hand-edited LaTeX (window._refresh_latex).
  useEffect(() => {
    if (override && generated !== override.base) {
      setOverride(null)
      flash('Slide edited — LaTeX regenerated from the slides (manual LaTeX edits replaced)', 4000)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generated])

  // ------------------------------------------------------------------ files

  const confirmDiscard = async (doing = 'continuing'): Promise<boolean> => {
    if (toJson(deckRef.current) === savedJson) return true
    const choice = await os.dialog.choose(
      `Save the presentation before ${doing}?`,
      [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Discard', value: 'discard', danger: true },
        { label: 'Save', value: 'save', primary: true },
      ],
      { title: 'KherveSlide' },
    )
    if (choice === 'save') return save()
    return choice === 'discard'
  }

  const openPath = async (p: string) => {
    if (!fs.exists(p)) {
      await os.dialog.alert(`File not found:\n${p}`, { title: 'Open' })
      savePrefs({ recent: loadPrefs().recent.filter((x) => x !== p) })
      setPrefsTick((t) => t + 1)
      return
    }
    setLoading(true)
    try {
      const d = fromJson(await fs.readText(p))
      if (!d.slides.length) d.slides.push(makeSlide())
      media.assets.clear()
      replaceDeck(d, p)
    } catch (e) {
      await os.dialog.alert(`"${P.basename(p)}" could not be opened: ${errorText(e)}`, { title: 'Open' })
    } finally {
      setLoading(false)
    }
  }

  const openDialog = async (ask = true) => {
    if (ask && !(await confirmDiscard('opening another presentation'))) return
    const p = await os.dialog.openFile({ title: 'Open presentation', extensions: ['.kslide', '.json'], startDir: filePath ? P.dirname(filePath) : undefined })
    if (p) await openPath(p)
  }

  const newDeck = async (template = 'Blank') => {
    if (!(await confirmDiscard('starting a new presentation'))) return
    media.assets.clear()
    replaceDeck(instantiateTemplate(template), null)
  }

  const openExample = async (item: ExampleItem, ask = true) => {
    if (ask && !(await confirmDiscard('opening an example'))) return
    setLoading(true)
    try {
      const { deck: d, assets } = await fetchExample(item)
      media.assets.clear()
      for (const [k, v] of assets) media.assets.set(k, v)
      replaceDeck(d, null, item.title)
      flash(`Example “${item.title}” — edit freely, then Save As to keep it`, 5000)
    } catch (e) {
      await os.dialog.alert(`The example could not be opened: ${errorText(e)}`, { title: 'KherveSlide' })
    } finally {
      setLoading(false)
    }
  }

  const writeTo = async (p: string): Promise<boolean> => {
    const d = deckRef.current
    const text = toJson(d)
    try {
      await fs.writeText(p, text, { mkdirs: true })
      // Like the desktop: the beamer source next to it, so a diff shows the content.
      await fs.writeText(P.join(P.dirname(p), `${stemOf(p)}.tex`), serializeDeck(d)).catch(() => {})
      const copied = await media.saveAssets(d, P.dirname(p))
      if (copied) os.notify({ title: 'KherveSlide', body: `${copied} picture${copied === 1 ? '' : 's'} saved next to the presentation.` })
      media.deckDir = P.dirname(p)
      setSavedJson(text)
      if (p !== filePath) {
        setFilePath(p)
        win.setDocumentPath(p)
      }
      addRecent(p)
      flash(`✔ Saved ${P.pretty(p)}`, 4000)
      return true
    } catch (e) {
      await os.dialog.alert(`Could not save: ${errorText(e)}`, { title: 'KherveSlide' })
      return false
    }
  }

  const saveAs = async (): Promise<boolean> => {
    const p = await os.dialog.saveFile({
      title: 'Save presentation as',
      extensions: ['.kslide'],
      defaultName: filePath ? P.basename(filePath) : `${untitledName.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Presentation'}.kslide`,
      startDir: filePath ? P.dirname(filePath) : P.join(HOME, 'Documents'),
    })
    if (!p) return false
    return writeTo(/\.(kslide|json)$/i.test(p) ? p : `${p}.kslide`)
  }

  const save = async (): Promise<boolean> => (filePath ? writeTo(filePath) : saveAs())

  // Ask before closing with unsaved changes.
  useEffect(() => {
    win.setCloseGuard(async () => confirmDiscard('closing'))
    return () => win.setCloseGuard(null)
  })

  // Opened with a file, an example or a template.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    if (typeof args.path === 'string') void openPath(args.path)
    else if (typeof args.example === 'string') {
      void loadExamples()
        .then((items) => {
          const item = findExample(items, String(args.example))
          if (item) return openExample(item, false)
        })
        .finally(() => setLoading(false))
    } else if (typeof args.template === 'string' && args.template in TEMPLATES) replaceDeck(newFromTemplate(args.template), null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadExamples()
      .then(setExamples)
      .catch(() => setExamples([]))
  }, [])

  // ------------------------------------------------------------------ templates (templates.TemplateStore)

  const userTemplates = (): Record<string, string> => loadPrefs().templates
  const templateNames = () => [...Object.keys(TEMPLATES), ...Object.keys(userTemplates()).sort()]
  function instantiateTemplate(name: string): Deck {
    const user = userTemplates()[name]
    if (user) {
      try {
        return fromJson(user)
      } catch {
        /* a broken entry: fall back to a built-in */
      }
    }
    return newFromTemplate(name)
  }
  const saveAsTemplate = async () => {
    const name = (await os.dialog.prompt('New template name:', { title: 'Save template' }))?.trim()
    if (!name) return
    if (name in TEMPLATES) return void os.dialog.alert(`'${name}' is a built-in template name`, { title: 'Template' })
    savePrefs({ templates: { ...userTemplates(), [name]: toJson(deckRef.current) } })
    flash(`Saved template '${name}'`)
  }
  const renameTemplate = () => {
    const names = Object.keys(userTemplates()).sort()
    if (!names.length) return void os.dialog.alert('No user templates yet.', { title: 'Rename' })
    setModal(
      <ListDialog
        title="Rename template"
        label="Template:"
        items={names}
        onDone={async (old) => {
          setModal(null)
          if (!old) return
          const nu = (await os.dialog.prompt('New name:', { title: 'Rename template', defaultValue: old }))?.trim()
          if (!nu || nu === old) return
          const all = userTemplates()
          if (nu in TEMPLATES) return void os.dialog.alert(`'${nu}' is a built-in template name`, { title: 'Rename' })
          if (nu in all) return void os.dialog.alert(`A template named '${nu}' already exists`, { title: 'Rename' })
          all[nu] = all[old]
          delete all[old]
          savePrefs({ templates: all })
        }}
      />,
    )
  }
  const deleteTemplate = () => {
    const names = Object.keys(userTemplates()).sort()
    if (!names.length) return void os.dialog.alert('No user templates yet.', { title: 'Delete' })
    setModal(
      <ListDialog
        title="Delete template"
        label="Template:"
        items={names}
        onDone={(name) => {
          setModal(null)
          if (!name) return
          const all = userTemplates()
          delete all[name]
          savePrefs({ templates: all })
        }}
      />,
    )
  }
  /** The toolbar's Templates button (window._templates_menu). */
  const templatesChooser = () => {
    const choices = [...templateNames().map((n) => `New from: ${n}`), '— Save current presentation as template…', '— Rename a template…', '— Delete a template…']
    setModal(
      <ListDialog
        title="Templates"
        label="Choose an action:"
        items={choices}
        onDone={(c) => {
          setModal(null)
          if (!c) return
          if (c.startsWith('New from: ')) void newDeck(c.slice('New from: '.length))
          else if (c.includes('Save current')) void saveAsTemplate()
          else if (c.includes('Rename')) renameTemplate()
          else if (c.includes('Delete')) deleteTemplate()
        }}
      />,
    )
  }

  // ------------------------------------------------------------------ compile

  const overrideRef = useRef(override)
  overrideRef.current = override
  const skipRef = useRef(skipImages)
  skipRef.current = skipImages
  const latexDown = useRef(false)
  const compileRun = useRef({ running: false, pending: false })
  const compileOf = useRef('')

  /** The LaTeX the PDF is made from — the LaTeX tab's, hand edits included — and every file it needs. */
  const buildFiles = async (skip: boolean) => {
    const d = deckRef.current
    const b = await compileBundle(d, media)
    let tex = b.tex
    const ov = overrideRef.current
    if (ov) {
      tex = ov.text
      for (const [stored, name] of b.paths) {
        tex = tex.split(`{${stored}}`).join(`{${name}}`)
        tex = tex.split(`{${stored.replace(/\\/g, '/')}}`).join(`{${name}}`)
      }
    }
    const files = { ...b.files }
    if (skip) {
      tex = stripImages(tex)
      for (const k of Object.keys(files)) if (k.startsWith('img/')) delete files[k]
    }
    files['presentation.tex'] = tex
    return { tex, files, missing: b.missing, key: `${skip ? 's' : 'n'}${tex}` }
  }

  const setStatus = (text: string, kind: StatusKind) => setCompileStatus({ text, kind })

  const runCompile = async (): Promise<Uint8Array | null> => {
    if (compileRun.current.running) {
      compileRun.current.pending = true // coalesce: run again when done
      return null
    }
    compileRun.current.running = true
    setCompile((c) => ({ ...c, busy: true }))
    setStatus('Compiling…', 'busy')
    try {
      const { files, missing, key } = await buildFiles(skipRef.current)
      const r = await compileLatex('presentation.tex', files)
      const down = !r.ok && (r.log.includes('not reachable') || r.log.includes('Sign in'))
      latexDown.current = down
      if (r.pdf) compileOf.current = key
      setCompile((c) => ({ busy: false, log: r.log, errors: r.errors, missing, pdf: r.pdf ?? c.pdf, of: r.pdf ? key : c.of }))
      if (r.pdf) setStatus('Compiled ✓', 'ok')
      else {
        setStatus(down ? 'LaTeX unavailable ✗' : 'Compile failed ✗', 'err')
        flash(down ? r.errors[0]?.message ?? 'LaTeX is not available.' : 'Compile failed — see Console tab', 0)
      }
      return r.pdf ?? null
    } finally {
      compileRun.current.running = false
      if (compileRun.current.pending) {
        compileRun.current.pending = false
        setTimeout(() => void runCompile(), 0)
      }
    }
  }

  // Auto-compile shortly after each change (not in Visual only, nor while LaTeX is unreachable).
  useEffect(() => {
    if (!autoCompile || layout === 'visual' || latexDown.current || loading || present) return
    const t = setTimeout(() => void runCompile(), 900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, override?.text, autoCompile, layout, skipImages, loading, present])

  /** Compile now and show the PDF (the ▶ button, ⌘R, File ▸ Compile to PDF). */
  const compileNow = () => {
    latexDown.current = false
    if (layout === 'visual') applyLayout('side')
    setRightTab('pdf')
    void runCompile()
  }

  /** For theme / decoration changes: show the PDF and compile straight away. */
  const recompileNow = () => {
    if (layout === 'visual') return
    setRightTab('pdf')
    setTimeout(() => void runCompile(), 0)
  }

  const defaultExportPath = (ext: string) =>
    filePath ? P.join(P.dirname(filePath), `${stemOf(filePath)}${ext}`) : P.join(HOME, 'Documents', `${(deckRef.current.title || untitledName).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'presentation'}${ext}`)

  /** The compiled presentation as it is now, with its pictures: the last compile when current, else a compile now. */
  const slideshowPdf = async (): Promise<{ pdf: Uint8Array | null; down: boolean }> => {
    const { files, missing, key } = await buildFiles(false)
    if (compile.pdf && compileOf.current === key) return { pdf: compile.pdf, down: false }
    flash('Building the slides for the show…', 0)
    const r = await compileLatex('presentation.tex', files)
    flash('', 1)
    if (r.pdf) {
      compileOf.current = key
      setCompile((c) => ({ ...c, log: r.log, errors: r.errors, missing, pdf: r.pdf!, of: key }))
      return { pdf: r.pdf, down: false }
    }
    const down = r.log.includes('not reachable') || r.log.includes('Sign in')
    setCompile((c) => ({ ...c, log: r.log, errors: r.errors, missing }))
    return { pdf: null, down }
  }

  const exportPdf = async () => {
    const p = await os.dialog.saveFile({ title: 'Export PDF', extensions: ['.pdf'], defaultName: P.basename(defaultExportPath('.pdf')), startDir: P.dirname(defaultExportPath('.pdf')) })
    if (!p) return
    flash('Exporting PDF…', 0)
    const { pdf, down } = await slideshowPdf()
    if (!pdf) {
      setLeftTab('console')
      flash('PDF export failed — see Console tab', 0)
      await os.dialog.alert(down ? 'LaTeX is not available: the KherveOS server compiles the slides.' : 'Compilation failed; see the Console tab for the log.', { title: 'Export PDF' })
      return
    }
    await fs.writeBytes(p, pdf, { mkdirs: true })
    flash(`Exported PDF to ${P.pretty(p)}`)
  }

  const exportTex = async () => {
    const p = await os.dialog.saveFile({ title: 'Export LaTeX', extensions: ['.tex'], defaultName: P.basename(defaultExportPath('.tex')), startDir: P.dirname(defaultExportPath('.tex')) })
    if (!p) return
    await fs.writeText(p, latexSource, { mkdirs: true })
    flash(`Exported ${P.pretty(p)}`)
  }

  const exportZip = async () => {
    const p = await os.dialog.saveFile({ title: 'Export the LaTeX project', extensions: ['.zip'], defaultName: P.basename(defaultExportPath('.zip')), startDir: P.dirname(defaultExportPath('.zip')) })
    if (!p) return
    const { files } = await buildFiles(false)
    const enc = new TextEncoder()
    const entries: Record<string, Uint8Array> = {}
    for (const [name, data] of Object.entries(files)) entries[name] = typeof data === 'string' ? enc.encode(data) : data
    await fs.writeBytes(p, zipSync(entries), { mkdirs: true })
    os.notify({ title: 'LaTeX project exported', body: `${P.pretty(p)}: presentation.tex and its pictures, ready for any LaTeX (XeLaTeX or tectonic).` })
  }

  const print = async () => {
    setEditingText(null)
    const { pdf, down } = await slideshowPdf()
    if (!pdf) return void os.dialog.alert(down ? 'LaTeX is not available, so the slides cannot be built.' : 'The slides could not be compiled — see the Console tab.', { title: 'Print' })
    printPdf(pdf)
  }

  // ------------------------------------------------------------------ slideshow (slideshow.py)

  const startSlideshow = async (mode: ShowMode | 'next' = 'full', fromCurrent = false, auto: AutoPlay | null = null) => {
    setEditingText(null)
    const { pdf, down } = await slideshowPdf()
    if (!pdf && !down) {
      setLeftTab('console')
      return void os.dialog.alert('The slides could not be compiled — see the Console tab.', { title: 'Slideshow' })
    }
    if (!pdf) os.notify({ title: 'Slideshow', body: 'LaTeX is not available: the slides are shown as the Visual editor draws them.' })
    const d = deckRef.current
    const shownBefore = d.slides.slice(0, slideIndex).filter((s) => !s.hidden).length
    setPresent({ start: fromCurrent ? shownBefore : 0, pdf, presenter: mode === 'presenter' || mode === 'next', windowed: mode === 'window', auto })
  }

  const autoSlideshow = () => {
    const a = loadPrefs().autoShow
    setModal(
      <AutoSlideshowDialog
        auto={a}
        mode={a.mode}
        fromCurrent={a.fromCurrent}
        onDone={(r) => {
          setModal(null)
          if (!r) return
          savePrefs({ autoShow: { ...r.auto, mode: r.mode, fromCurrent: r.fromCurrent } })
          void startSlideshow(r.mode, r.fromCurrent, r.auto)
        }}
      />,
    )
  }

  // ------------------------------------------------------------------ objects

  /** window._place_stacked: just below the bottom-most object, at its left and width. */
  const placeStacked = (obj: SlideObject, s: Slide) => {
    const others = s.objects.filter((o) => o !== obj)
    if (!others.length) return
    const last = others.reduce((a, b) => (b.y + b.h > a.y + a.h ? b : a))
    obj.x = Math.round(last.x * 1e4) / 1e4
    if (obj.type !== 'SlidePicture') obj.w = last.w
    let y = last.y + last.h + 0.02
    if (y + obj.h > 1) y = Math.max(0, 1 - obj.h)
    obj.y = Math.round(y * 1e4) / 1e4
  }

  const offset = (o: SlideObject) => {
    o.x = Math.round(Math.min(0.92, o.x + 0.03) * 1e4) / 1e4
    o.y = Math.round(Math.min(0.92, o.y + 0.03) * 1e4) / 1e4
  }

  /** Add an object (stacked below the others, or nudged), select it. */
  const addObject = (o: SlideObject, how: 'stack' | 'offset' | 'none' = 'none', after?: (o: SlideObject) => void) => {
    const n = slide.objects.length
    editSlide((s) => {
      if (how === 'stack') placeStacked(o, s)
      else if (how === 'offset') offset(o)
      after?.(o)
      s.objects.push(o)
    })
    setSel([n])
  }

  const addText = () => addObject(makeObject('SlideText'), 'stack')

  const addPicture = async () => {
    const p = await os.dialog.openFile({ title: 'Choose image', extensions: PICTURE_EXTENSIONS })
    // As on the desktop: a cancelled choice still adds an empty picture box to fill later.
    addObject(makeObject('SlidePicture', { path: p ?? '' }), 'stack')
  }

  const addVideo = async () => {
    const p = await os.dialog.openFile({ title: 'Choose video', extensions: VIDEO_EXTENSIONS })
    if (!p) return
    addObject(makeObject('SlideVideo', { path: p }), 'stack')
  }

  const insertTable = (rows: number, cols: number, style?: TableStyle) => {
    const t = makeObject('SlideTable', { rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => '')) })
    if (style) applyTableStyle(t, style)
    addObject(t, 'stack')
  }
  const addTable = () => insertTable(2, 2)

  const tablePicker = () =>
    setModal(
      <TableGridDialog
        onDone={(size) => {
          setModal(null)
          if (size) insertTable(size[0], size[1])
        }}
        onDesign={() => tableDesign()}
      />,
    )

  const tableDesign = () => {
    const i = sel.length === 1 && slide.objects[sel[0]]?.type === 'SlideTable' ? sel[0] : -1
    setModal(
      <TableDesignDialog
        onDone={(st) => {
          setModal(null)
          if (!st) return
          if (i < 0) insertTable(3, 3, st)
          else editSlide((s) => applyTableStyle(s.objects[i] as SlideTable, st))
        }}
      />,
    )
  }

  /** The equation builder: a wide maths box so the PDF keeps it on one line (window._add_equation). */
  const mathBox = (latex: string) => addObject(makeObject('SlideText', { text: `$${latex}$`, font_pt: 28, align: 'center', x: 0.08, w: 0.84, h: 0.14, locked: false }), 'stack', (o) => {
    o.x = 0.08
    o.w = 0.84
  })

  const addEquation = () =>
    setModal(
      <EquationDialog
        initial=""
        onDone={(tex) => {
          setModal(null)
          if (tex?.trim()) mathBox(tex.trim())
        }}
      />,
    )

  const addChemistry = () =>
    setModal(
      <EquationDialog
        initial=""
        title="Chemical reaction"
        chemistry
        onDone={(tex) => {
          setModal(null)
          if (tex?.trim()) mathBox(`\\ce{${tex.trim()}}`)
        }}
      />,
    )

  /** Double-click on a maths-only box reopens the editor that built it. */
  const editMathBox = (i: number): boolean => {
    const o = slide.objects[i]
    if (o?.type !== 'SlideText') return false
    const inner = mathOnly(o.text)
    if (inner === null) return false
    const ce = unwrapCe(inner)
    const rewrap = (body: string) => {
      const t = o.text.trim()
      return t.startsWith('$$') ? `$$${body}$$` : t.startsWith('\\[') ? `\\[${body}\\]` : `$${body}$`
    }
    setModal(
      <EquationDialog
        initial={ce ?? inner}
        title={ce !== null ? 'Chemical reaction' : 'Equation builder'}
        chemistry={ce !== null}
        onDone={(tex) => {
          setModal(null)
          if (tex?.trim()) editSlide((s) => ((s.objects[i] as SlideText).text = rewrap(ce !== null ? `\\ce{${tex.trim()}}` : tex.trim())))
        }}
      />,
    )
    return true
  }

  const figuresDir = () => (filePath ? P.join(P.dirname(filePath), 'figures') : P.join(HOME, 'Documents', 'KherveSlide figures'))

  /** A 2-D molecule drawn by chemfig: compiled once, placed as a picture, its source kept beside it. */
  const addChemStructure = async (i: number | null = null) => {
    const existing = i !== null ? (slide.objects[i] as SlidePicture) : null
    let initial = ''
    if (existing?.path) {
      const src = existing.path.replace(/\.[^./]+$/, '.chemfig')
      const d = media.drivePath(src)
      if (d) initial = await fs.readText(d).catch(() => '')
    }
    setModal(
      <ChemfigDialog
        initial={initial}
        onDone={async (code) => {
          setModal(null)
          if (!code) return
          flash('Compiling the structure…', 0)
          const r = await compileLatex('figure.tex', { 'figure.tex': chemfigDoc(code) })
          flash('', 1)
          if (!r.pdf) return void os.dialog.alert(`The structure could not be compiled:\n\n${r.log.slice(-1200)}`, { title: 'Chemical structure' })
          const doc = await openPdf(r.pdf)
          try {
            const bmp = await doc.renderPage(0, 4)
            const c = document.createElement('canvas')
            c.width = bmp.width
            c.height = bmp.height
            c.getContext('2d')!.drawImage(bmp, 0, 0)
            bmp.close()
            const png = new Uint8Array(await (await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'))).arrayBuffer())
            let target = existing ? media.drivePath(existing.path) : null
            if (!target) {
              const dir = figuresDir()
              let n = 1
              while (fs.exists(P.join(dir, `structure_${String(n).padStart(3, '0')}.png`))) n++
              target = P.join(dir, `structure_${String(n).padStart(3, '0')}.png`)
            }
            await fs.writeBytes(target, png, { mkdirs: true })
            await fs.writeText(target.replace(/\.png$/, '.chemfig'), code)
            if (existing && i !== null) editSlide((s) => ((s.objects[i] as SlidePicture).path = target!))
            else addObject(makeObject('SlidePicture', { path: target, x: 0.3, y: 0.3, w: 0.35, h: 0.35, keep_aspect: true, locked: false }), 'stack')
          } finally {
            doc.close()
          }
        }}
      />,
    )
  }

  const notInKherveOS = (what: string, extra = '') =>
    void os.dialog.alert(`${what} is not in KherveSlide for KherveOS yet.${extra ? `\n\n${extra}` : ''}`, { title: 'KherveSlide' })
  const addFlowchart = () => notInKherveOS('The flowchart builder', 'Draw the chart with the shapes, lines and arrows of the left toolbar, or in KhervePaint, and add it as a picture.')
  const addDrawing = () =>
    notInKherveOS('The drawing editor', 'Draw in KhervePaint, export a PNG and add it with Add image (or drop it on the slide).')

  const insertIntoText = (latex: string) => {
    const ta = activeEditor()
    if (ta) {
      editTextarea(ta, (v, a, b) => ({ value: v.slice(0, a) + latex + v.slice(b), a: a + latex.length, b: a + latex.length }))
      return
    }
    const i = sel.length === 1 && slide.objects[sel[0]]?.type === 'SlideText' ? sel[0] : -1
    if (i >= 0) editSlide((s) => ((s.objects[i] as SlideText).text += latex))
    else addObject(makeObject('SlideText', { text: latex }))
  }

  const insertSymbol = () =>
    setModal(
      <SymbolDialog
        onDone={(latex) => {
          setModal(null)
          if (latex) insertIntoText(TEXT_MODE_SYMBOLS.has(latex) ? latex : `$${latex}$`)
        }}
      />,
    )

  const insertList = (numbered: boolean) => {
    const ta = activeEditor()
    const env = numbered ? 'enumerate' : 'itemize'
    if (ta) {
      editTextarea(ta, (v, a, b) => {
        const lines = (v.slice(a, b) || 'First point').split('\n').map((l) => `  \\item ${l}`)
        const block = `\\begin{${env}}\n${lines.join('\n')}\n\\end{${env}}`
        return { value: v.slice(0, a) + block + v.slice(b), a, b: a + block.length }
      })
      return
    }
    insertIntoText(`\\begin{${env}}\n  \\item First point\n  \\item Second point\n\\end{${env}}`)
  }

  const addLine = (arrow: boolean) => addObject(makeObject('SlideLine', arrow ? { arrow_end: true } : {}))
  const addRect = () => addObject(makeObject('SlideShape', { shape: 'rect' }), 'offset')
  const addEllipse = () => addObject(makeObject('SlideShape', { shape: 'ellipse', w: 0.22, h: 0.22 }), 'offset')
  const addShape = (key: string) => {
    const square = ['circle', 'ellipse', 'star4', 'star5', 'star6', 'plus', 'pentagon', 'hexagon', 'heptagon', 'octagon'].includes(key)
    addObject(makeObject('SlideShape', { shape: key, w: 0.22, h: square ? 0.22 : 0.18 }), 'offset')
  }

  const dropFiles = async (paths: string[], at: { x: number; y: number }) => {
    let k = 0
    for (const p of paths.filter(isPicture)) {
      const w = 0.3
      const h = 0.3
      const o = makeObject('SlidePicture', { path: p, x: Math.max(0, Math.min(1 - w, at.x - w / 2 + k * 0.03)), y: Math.max(0, Math.min(1 - h, at.y - h / 2 + k * 0.03)), w, h, keep_aspect: true })
      editSlide((s) => s.objects.push(o))
      k++
    }
    const decks = paths.filter((p) => /\.kslide$/i.test(p))
    if (!k && decks.length && (await confirmDiscard(`opening ${P.basename(decks[0])}`))) await openPath(decks[0])
  }

  const selected = () => live.current.sel.filter((i) => i < slide.objects.length)

  const deleteSelected = () => {
    const s = new Set(selected())
    if (!s.size) return
    editSlide((sl) => (sl.objects = sl.objects.filter((_, i) => !s.has(i))))
    setSel([])
  }

  const copySelected = (cut = false) => {
    const s = selected()
    if (!s.length) return
    objectClipboard = s.map((i) => structuredClone(slide.objects[i]))
    if (cut) deleteSelected()
    else flash('Copied')
  }

  /** Paste objects copied in KherveSlide, else a picture from the system clipboard. */
  const paste = async () => {
    if (objectClipboard.length) {
      const n = slide.objects.length
      const copies = objectClipboard.map((o) => {
        const c = structuredClone(o)
        offset(c)
        return c
      })
      objectClipboard = copies.map((o) => structuredClone(o))
      editSlide((s) => s.objects.push(...copies))
      setSel(copies.map((_, k) => n + k))
      return
    }
    try {
      const items = await navigator.clipboard.read()
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith('image/'))
        if (!type) continue
        const data = new Uint8Array(await (await it.getType(type)).arrayBuffer())
        const dir = filePath ? P.dirname(filePath) : P.join(HOME, 'Documents', 'KherveSlide figures')
        let n = 1
        while (fs.exists(P.join(dir, `pasted_${String(n).padStart(3, '0')}.png`))) n++
        const p = P.join(dir, `pasted_${String(n).padStart(3, '0')}.png`)
        await fs.writeBytes(p, data, { mkdirs: true })
        const i = sel.length === 1 && slide.objects[sel[0]]?.type === 'SlidePicture' ? sel[0] : -1
        if (i >= 0) {
          editSlide((s) => ((s.objects[i] as SlidePicture).path = p))
          flash('Image pasted into the picture box')
        } else addObject(makeObject('SlidePicture', { path: p, x: 0.35, y: 0.35, w: 0.3, h: 0.3, keep_aspect: true }))
        return
      }
    } catch {
      /* no permission or nothing to paste */
    }
  }

  const duplicateSelected = () => {
    const s = selected()
    if (!s.length) return
    const n = slide.objects.length
    editSlide((sl) =>
      sl.objects.push(
        ...s.map((i) => {
          const c = structuredClone(sl.objects[i])
          offset(c)
          return c
        }),
      ),
    )
    setSel(s.map((_, k) => n + k))
  }

  const nudge = (dx: number, dy: number) => {
    const s = selected().filter((i) => !slide.objects[i].locked)
    if (!s.length) return
    editSlide((sl) => {
      for (const i of s) {
        sl.objects[i].x += dx
        sl.objects[i].y += dy
      }
    })
  }

  const setOnSelected = (fields: Record<string, unknown>, types?: SlideObject['type'][]) => {
    const s = selected()
    if (!s.length) return
    editSlide((sl) => {
      for (const i of s) {
        const o = sl.objects[i]
        if (types && !types.includes(o.type)) continue
        for (const [k, v] of Object.entries(fields)) if (k in o) (o as unknown as Record<string, unknown>)[k] = v
      }
    })
  }

  const zOrder = (how: 'front' | 'back' | 'raise' | 'lower') => {
    const s = selected()
    if (!s.length) return
    let ni = s[0]
    editSlide((sl) => {
      ni = how === 'front' ? toFront(sl, s[0]) : how === 'back' ? toBack(sl, s[0]) : how === 'raise' ? raiseObject(sl, s[0]) : lowerObject(sl, s[0])
    })
    setSel([ni])
  }

  const group = (on: boolean) => {
    const s = selected()
    if (on && s.length < 2) return flash('Select two or more objects to group', 4000)
    if (!on && !s.some((i) => slide.objects[i].group)) return flash('No group selected', 4000)
    const gid = Math.max(0, ...slide.objects.map((o) => o.group)) + 1
    const gids = new Set(s.map((i) => slide.objects[i].group).filter(Boolean))
    let n = 0
    editSlide((sl) => {
      if (on) for (const i of s) sl.objects[i].group = gid
      else
        for (const o of sl.objects)
          if (gids.has(o.group)) {
            o.group = 0
            n++
          }
    })
    flash(on ? `Grouped ${s.length} objects` : `Ungrouped ${n} objects`, 4000)
  }

  /** A property sheet for one object (the desktop's per-type property dialogs). */
  const fieldsFor = (i: number, title: string, fields: FieldSpec[], extra?: (set: (v: Values) => void) => ReactNode) => {
    const o = slide.objects[i]
    if (!o) return
    setModal(
      <FieldsDialog
        title={title}
        fields={fields}
        values={{ ...o } as unknown as Values}
        extra={extra}
        onDone={(v) => {
          setModal(null)
          if (!v) return
          editSlide((s) => {
            const t = s.objects[i] as unknown as Record<string, unknown>
            if (!t) return
            for (const f of fields) {
              if (!(f.key in t)) continue
              const val = v[f.key]
              t[f.key] = f.kind === 'number' && (f.key === 'font_pt' || f.key === 'group') ? Math.round(Number(val)) : val
            }
          })
        }}
      />,
    )
  }

  /** Crop & rotate… (picture_editor.PictureEditDialog): path, crop, rotation, opacity and the picture effects. */
  const editPicture = (i: number) =>
    fieldsFor(i, 'Picture', OBJECT_FIELDS.SlidePicture, (set) => (
      <button
        className="k-btn"
        onClick={async () => {
          const p = await os.dialog.openFile({ title: 'Choose image', extensions: PICTURE_EXTENSIONS })
          if (p) set({ path: p })
        }}
      >
        Choose another picture…
      </button>
    ))

  const replaceImage = async (i: number) => {
    const p = await os.dialog.openFile({ title: 'Choose image', extensions: PICTURE_EXTENSIONS })
    if (p) editSlide((s) => ((s.objects[i] as SlidePicture).path = p))
  }

  const rotatePicture = (i: number, delta: number) =>
    editSlide((s) => {
      const o = s.objects[i] as SlidePicture
      const a = (((o.rotation + delta) % 360) + 360) % 360
      o.rotation = a > 180 ? a - 360 : a
    })

  const exportPicturePng = async (i: number) => {
    const o = slide.objects[i] as SlidePicture
    const data = o.path ? await media.bytes(o.path) : null
    if (!data) return void os.dialog.alert('This box has no image.', { title: 'Export to PNG' })
    const p = await os.dialog.saveFile({ title: 'Export image to PNG', extensions: ['.png'], defaultName: 'image.png' })
    if (!p) return
    const img = new Image()
    img.src = URL.createObjectURL(new Blob([data as BlobPart]))
    await img.decode()
    const sw = Math.max(1, (1 - o.crop_l - o.crop_r) * img.naturalWidth)
    const sh = Math.max(1, (1 - o.crop_t - o.crop_b) * img.naturalHeight)
    const rad = (o.rotation * Math.PI) / 180
    const cw = Math.abs(sw * Math.cos(rad)) + Math.abs(sh * Math.sin(rad))
    const ch = Math.abs(sw * Math.sin(rad)) + Math.abs(sh * Math.cos(rad))
    const c = document.createElement('canvas')
    c.width = Math.round(cw)
    c.height = Math.round(ch)
    const ctx = c.getContext('2d')!
    ctx.translate(cw / 2, ch / 2)
    ctx.rotate(rad)
    ctx.drawImage(img, o.crop_l * img.naturalWidth, o.crop_t * img.naturalHeight, sw, sh, -sw / 2, -sh / 2, sw, sh)
    URL.revokeObjectURL(img.src)
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
    if (!blob) return
    await fs.writeBytes(p.endsWith('.png') ? p : `${p}.png`, new Uint8Array(await blob.arrayBuffer()), { mkdirs: true })
    flash(`Exported image to ${P.pretty(p)}`)
  }

  const transparency = async (i: number) => {
    const o = slide.objects[i] as SlidePicture
    const v = await os.dialog.prompt('Opacity (%):', { title: 'Transparency', defaultValue: String(Math.round(o.opacity * 100)) })
    if (v === null) return
    const n = Math.max(0, Math.min(100, Math.round(Number(v))))
    if (Number.isFinite(n)) editSlide((s) => ((s.objects[i] as SlidePicture).opacity = n / 100))
  }

  const blockTitle = async (i: number) => {
    const o = slide.objects[i] as SlideText
    const t = await os.dialog.prompt('Block title:', { title: 'Block title', defaultValue: o.block_title })
    if (t !== null) editSlide((s) => ((s.objects[i] as SlideText).block_title = t))
  }

  const TABLE_PROPS: FieldSpec[] = [
    { key: 'nrows', label: 'Rows', kind: 'number', min: 1, max: 50, step: 1 },
    { key: 'ncols', label: 'Columns', kind: 'number', min: 1, max: 20, step: 1 },
    { key: 'header', label: 'First row is a header', kind: 'bool' },
    { key: 'header_bg', label: 'Header fill', kind: 'color' },
    { key: 'header_fg', label: 'Header text', kind: 'color' },
    { key: 'align', label: 'Cell alignment', kind: 'select', options: [['left', 'left'], ['center', 'center'], ['right', 'right']] },
    { key: 'font_pt', label: 'Font size (pt)', kind: 'number', min: 6, max: 60, step: 1 },
    { key: 'color', label: 'Text colour', kind: 'color' },
    { key: 'grid', label: 'Grid lines', kind: 'select', options: [['all', 'all'], ['horizontal', 'horizontal'], ['outer', 'outer'], ['none', 'none']] },
    { key: 'rule_color', label: 'Rule colour', kind: 'color' },
    { key: 'rule_width', label: 'Rule width (pt)', kind: 'number', min: 0.1, max: 6, step: 0.2 },
    { key: 'striped', label: 'Zebra-stripe body rows', kind: 'bool' },
    { key: 'stripe_color', label: 'Stripe colour', kind: 'color' },
    { key: 'caption', label: 'Caption', kind: 'text' },
    { key: 'fill', label: 'Box fill', kind: 'color' },
    { key: 'border_color', label: 'Box frame', kind: 'color' },
  ]

  const tableProps = (i: number) => {
    const o = slide.objects[i] as SlideTable
    setModal(
      <FieldsDialog
        title="Table properties"
        fields={TABLE_PROPS}
        values={{ ...o, nrows: o.rows.length, ncols: Math.max(1, ...o.rows.map((r) => r.length)) } as unknown as Values}
        onDone={(v) => {
          setModal(null)
          if (!v) return
          editSlide((s) => {
            const t = s.objects[i] as SlideTable
            const nr = Math.round(Number(v.nrows))
            const nc = Math.round(Number(v.ncols))
            t.rows = Array.from({ length: nr }, (_, r) => Array.from({ length: nc }, (_, c) => t.rows[r]?.[c] ?? ''))
            const r = t as unknown as Record<string, unknown>
            for (const f of TABLE_PROPS) if (f.key !== 'nrows' && f.key !== 'ncols') r[f.key] = f.key === 'font_pt' ? Math.round(Number(v[f.key])) : v[f.key]
            t.color = t.color || '#000000'
            t.border = t.grid !== 'none'
          })
        }}
      />,
    )
  }

  const tableOp = (op: 'add_row' | 'add_col' | 'del_row' | 'del_col' | 'header' | 'caption', at = sel.length === 1 ? sel[0] : -1) => {
    if (slide.objects[at]?.type !== 'SlideTable') return flash('Select a table first', 4000)
    if (op === 'caption') {
      void os.dialog.prompt('Caption:', { title: 'Table caption', defaultValue: (slide.objects[at] as SlideTable).caption }).then((c) => {
        if (c !== null) editSlide((s) => ((s.objects[at] as SlideTable).caption = c))
      })
      return
    }
    editSlide((s) => {
      const t = s.objects[at] as SlideTable
      const cols = Math.max(1, ...t.rows.map((r) => r.length))
      if (op === 'add_row') t.rows.push(Array.from({ length: cols }, () => ''))
      else if (op === 'add_col') t.rows.forEach((r) => r.push(''))
      else if (op === 'del_row' && t.rows.length > 1) t.rows.pop()
      else if (op === 'del_col' && cols > 1) t.rows.forEach((r) => r.length > 1 && r.pop())
      else if (op === 'header') t.header = !t.header
    })
  }

  // ------------------------------------------------------------------ the Format toolbar

  const one = sel.length === 1 ? slide.objects[sel[0]] : undefined
  const t0 = one?.type === 'SlideText' ? one : undefined

  /** Bold / italic: the selection while editing in place, else the whole box. */
  const toggleRunOrBox = (kind: 'bold' | 'italic') => {
    const ta = activeEditor()
    if (ta) {
      const cmd = kind === 'bold' ? '\\textbf{' : '\\textit{'
      editTextarea(ta, (v, a, b) => ({ value: `${v.slice(0, a)}${cmd}${v.slice(a, b)}}${v.slice(b)}`, a: a + cmd.length, b: b + cmd.length }))
      return
    }
    if (t0) setOnSelected({ [kind]: !t0[kind] }, ['SlideText'])
  }

  /** Super / subscript: the selection while editing, else the whole box. */
  const scriptSelection = (kind: 'super' | 'sub') => {
    const cmd = kind === 'super' ? '\\textsuperscript{' : '\\textsubscript{'
    const ta = activeEditor()
    if (ta) {
      editTextarea(ta, (v, a, b) => ({ value: `${v.slice(0, a)}${cmd}${v.slice(a, b)}}${v.slice(b)}`, a: a + cmd.length, b: b + cmd.length }))
      return
    }
    if (!t0) return flash('Select a text box (or edit it) to apply super/subscript', 4000)
    editSlide((s) => {
      const o = s.objects[sel[0]] as SlideText
      o.text = `${cmd}${o.text}}`
    })
  }

  /** Box ▸ change the selected box's type in place (window._on_type_combo). */
  const changeKind = (kind: string) => {
    const i = sel[0]
    const o = slide.objects[i]
    if (!o || objKind(o) === kind) return
    if (TEXT_KINDS.has(kind) && o.type === 'SlideText') {
      editSlide((s) => {
        const t = s.objects[i] as SlideText
        t.block = kind === 'text' || kind === 'equation' ? '' : kind
        if (COLOURED_BLOCKS.has(t.block) && !t.block_title) t.block_title = 'Block'
        if (kind === 'equation' && !t.text.includes('$')) {
          const x = t.text.trim()
          t.text = x ? `$${x}$` : '$  $'
          t.align = 'center'
        }
      })
      if (kind !== 'text' && kind !== 'equation') flash('Block — right-click ▸ Block title… to rename it', 5000)
      return
    }
    const geo = { x: o.x, y: o.y, w: o.w, h: o.h, locked: o.locked }
    const convert = async (): Promise<SlideObject | null> => {
      if (TEXT_KINDS.has(kind)) {
        const text = 'text' in o ? String((o as SlideText).text ?? '') : ''
        const block = kind === 'text' || kind === 'equation' ? '' : kind
        const t = makeObject('SlideText', { ...geo, text: text || 'Text', block, block_title: COLOURED_BLOCKS.has(block) ? 'Block' : '' })
        if (kind === 'equation') {
          const x = text.trim()
          t.text = x && !x.includes('$') ? `$${x}$` : x || '$  $'
          t.align = 'center'
        }
        return t
      }
      if (kind === 'image') {
        let path = 'path' in o ? String((o as SlidePicture).path ?? '') : ''
        if (!path) path = (await os.dialog.openFile({ title: 'Choose image', extensions: PICTURE_EXTENSIONS })) ?? ''
        return makeObject('SlidePicture', { ...geo, path, keep_aspect: true })
      }
      if (kind === 'table') return makeObject('SlideTable', geo)
      return null
    }
    void convert().then((n) => {
      if (n) editSlide((s) => (s.objects[i] = n))
    })
  }

  // ------------------------------------------------------------------ slides

  const goto = (i: number) => {
    if (live.current.masterMode) setView('normal')
    const n = Math.max(0, Math.min(i, deckRef.current.slides.length - 1))
    setCurrent(n)
    setPageTick((t) => t + 1)
  }

  const addSlide = (layoutName = 'Blank', row = slideIndex) => {
    const at = row + 1
    mutate((d) => d.slides.splice(at, 0, slideLayout(layoutName)))
    goto(at)
  }
  const duplicateSlide = (i = slideIndex) => {
    mutate((d) => d.slides.splice(i + 1, 0, structuredClone(d.slides[i])))
    goto(i + 1)
  }
  /** Slide ▸ Delete slide / Remove active slide (window._del_slide), or the slide right-clicked / Delete in the list (_delete_slide_at). */
  const deleteSlide = (i = slideIndex, active = true) => {
    if (deckRef.current.slides.length <= 1) return
    mutate((d) => d.slides.splice(i, 1))
    goto(active ? Math.max(0, i - 1) : Math.min(i, deckRef.current.slides.length - 1))
  }
  const moveSlide = (from: number, delta: number) => {
    const to = from + delta
    if (to < 0 || to >= deckRef.current.slides.length) return
    mutate((d) => {
      const [s] = d.slides.splice(from, 1)
      d.slides.splice(to, 0, s)
    })
    goto(to)
  }
  const reorder = (order: number[]) => {
    if (live.current.masterMode) return
    const cur = live.current.slideIndex
    mutate((d) => (d.slides = order.map((i) => d.slides[i])))
    goto(Math.max(0, order.indexOf(cur)))
  }
  const toggleHidden = (i = slideIndex) => {
    if (masterMode) return
    const hidden = !deckRef.current.slides[i].hidden
    mutate((d) => (d.slides[i].hidden = hidden))
    setCurrent(i)
    flash(hidden ? `Slide ${i + 1} hidden — not in the PDF or the slideshow` : `Slide ${i + 1} shown again`, 4000)
  }
  const applyLayoutTo = (i: number, name: string) => {
    mutate((d) => (d.slides[i] = slideLayout(name)))
    goto(i)
  }

  const frameTitle = async () => {
    const t = await os.dialog.prompt("Title shown in the theme's title bar (decorations on):", { title: 'Frame title', defaultValue: slide.title })
    if (t !== null) editSlide((s) => (s.title = t))
  }

  const slideBackground = () =>
    setModal(
      <FieldsDialog
        title="Slide background"
        intro="The colour, and how strongly it shows (1 = full colour; lower gives a tint)."
        fields={[
          { key: 'bg', label: 'Colour', kind: 'color' },
          { key: 'bg_alpha', label: 'Opacity (0–1)', kind: 'number', min: 0, max: 1, step: 0.05 },
        ]}
        values={{ bg: slide.bg || '#FFFFFF', bg_alpha: slide.bg_alpha }}
        onDone={(v) => {
          setModal(null)
          if (v) editSlide((s) => Object.assign(s, { bg: String(v.bg ?? ''), bg_alpha: Number(v.bg_alpha) }))
        }}
      />,
    )

  // ------------------------------------------------------------------ the presentation and its theme

  const setDeckField = async (key: 'title' | 'author', label: string) => {
    const t = await os.dialog.prompt(`${label}:`, { title: key === 'title' ? 'Presentation title' : 'Author', defaultValue: deckRef.current[key] })
    if (t !== null) mutate((d) => (d[key] = t))
  }

  const setTheme = (name: string) => {
    mutate((d) => {
      d.theme = name
      d.theme_spec.enabled = false // a built-in theme replaces the custom layer
    })
    recompileNow()
  }
  const setColourTheme = (name: string) => {
    mutate((d) => (d.color_theme = name))
    recompileNow()
  }

  const themeGallery = () =>
    setModal(
      <ThemeGallery
        deck={deck}
        slide={slide}
        media={media}
        themes={BEAMER_THEMES}
        colourThemes={BEAMER_COLOR_THEMES}
        onDone={(r) => {
          setModal(null)
          if (!r) return
          mutate((d) => {
            d.theme = r.theme
            d.color_theme = r.color
            d.theme_spec.enabled = false
            d.plain_frames = false
          })
          recompileNow()
        }}
      />,
    )

  /** The theme wizard / advanced builder: presets, colours, title bar, footer, logo. */
  const themeBuilder = (title: string) => {
    const d = deckRef.current
    setModal(
      <FieldsDialog
        title={title}
        intro="A beamer theme, optionally with your own colours, title bar, footer and logo on top."
        fields={THEME_FIELDS}
        values={{ ...d.theme_spec, theme: d.theme, color_theme: d.color_theme } as unknown as Values}
        extra={(set) => (
          <label className="ks2-field">
            <span className="ks2-field-label">Start from</span>
            <span className="ks2-field-input">
              <select
                className="k-input"
                value=""
                onChange={(e) => {
                  const kit = THEME_PRESETS.find((k) => k.name === e.target.value)
                  if (!kit) return
                  const tmp = cloneDeck(d)
                  applyKit(tmp, { ...kit, logo: d.theme_spec.logo })
                  set({ ...tmp.theme_spec, theme: tmp.theme, color_theme: tmp.color_theme } as unknown as Values)
                }}
              >
                <option value="">A ready-made theme…</option>
                {THEME_PRESETS.map((k) => (
                  <option key={k.name}>{k.name}</option>
                ))}
              </select>
            </span>
          </label>
        )}
        onDone={(v) => {
          setModal(null)
          if (!v) return
          mutate((dd) => {
            dd.theme = String(v.theme || 'default')
            dd.color_theme = String(v.color_theme ?? '')
            const spec = dd.theme_spec as unknown as Record<string, unknown>
            for (const f of THEME_FIELDS) if (f.key in spec) spec[f.key] = v[f.key]
            if (dd.theme_spec.enabled) dd.plain_frames = false // custom themes touch decorated elements: show them
          })
          recompileNow()
        }}
      />,
    )
  }

  const pageSetup = () => {
    const d = deckRef.current
    setModal(
      <FieldsDialog
        title="Page setup"
        fields={[
          { key: 'aspect', label: 'Aspect ratio', kind: 'select', options: ASPECTS },
          { key: 'custom', label: 'Use custom size instead of aspect ratio', kind: 'bool' },
          { key: 'page_w_cm', label: 'Width (cm)', kind: 'number', min: 1, max: 200, step: 0.1 },
          { key: 'page_h_cm', label: 'Height (cm)', kind: 'number', min: 1, max: 200, step: 0.1 },
          { key: 'gap', label: 'Margin / gap (%)', kind: 'number', min: 0, max: 45, step: 0.5 },
        ]}
        values={{ aspect: d.aspect, custom: d.page_w_cm > 0 && d.page_h_cm > 0, page_w_cm: d.page_w_cm || 12.8, page_h_cm: d.page_h_cm || 9.6, gap: d.gap * 100 }}
        onDone={(v) => {
          setModal(null)
          if (!v) return
          mutate((dd) => {
            dd.aspect = String(v.aspect)
            dd.page_w_cm = v.custom ? Number(v.page_w_cm) : 0
            dd.page_h_cm = v.custom ? Number(v.page_h_cm) : 0
            dd.gap = Number(v.gap) / 100
          })
          recompileNow()
        }}
      />,
    )
  }

  // ------------------------------------------------------------------ views, layouts, find

  const pdfWin = useRef<string | null>(null)

  const applyLayout = (mode: Layout) => {
    if (mode !== layout) flash(LAYOUT_TEXT[mode][0], 3000)
    setLayout(mode)
    savePrefs({ layout: mode })
  }

  const setViewMode = (mode: ViewMode) => {
    setEditingText(null)
    setWelcome(false)
    setLeftTab('visual')
    setView(mode)
    if (mode === 'overview') {
      if (layout !== 'visual') {
        setRightTab('overview')
        if (pdfWin.current) useWindows.getState().focus(pdfWin.current)
      }
    } else if (rightTab === 'overview') setRightTab('pdf')
  }

  const toggleSlidesList = () => setNavShown((v) => !v)

  const findQuery = useRef<{ q: string; matches: [number, number][]; idx: number }>({ q: '', matches: [], idx: -1 })
  const latexView = useRef<EditorView | null>(null)
  const findNext = (backwards = false) => {
    const text = find.text
    if (!text) return
    if (leftTab === 'latex' && latexView.current) {
      const v = latexView.current
      const doc = v.state.doc.toString()
      const low = doc.toLowerCase()
      const q = text.toLowerCase()
      const from = backwards ? v.state.selection.main.from - 1 : v.state.selection.main.to
      let i = backwards ? low.lastIndexOf(q, Math.max(0, from)) : low.indexOf(q, from)
      if (i < 0) i = backwards ? low.lastIndexOf(q) : low.indexOf(q)
      if (i >= 0) v.dispatch({ selection: { anchor: i, head: i + q.length }, scrollIntoView: true })
      setFind((f) => ({ ...f, count: i >= 0 ? '' : 'Not found' }))
      return
    }
    setLeftTab('visual')
    const q = text.toLowerCase()
    const fq = findQuery.current
    if (fq.q !== q) {
      fq.q = q
      fq.idx = -1
      fq.matches = []
      deck.slides.forEach((s, si) =>
        s.objects.forEach((o, oi) => {
          const hay = o.type === 'SlideText' ? o.text : o.type === 'SlideTable' ? o.rows.map((r) => r.join(' ')).join(' ') : ''
          if (hay.toLowerCase().includes(q)) fq.matches.push([si, oi])
        }),
      )
    }
    if (!fq.matches.length) return setFind((f) => ({ ...f, count: '0 / 0' }))
    fq.idx = (fq.idx + (backwards ? -1 : 1) + fq.matches.length) % fq.matches.length
    const [si, oi] = fq.matches[fq.idx]
    if (si !== slideIndex || masterMode) goto(si)
    setTimeout(() => setSel([oi]), 0)
    setFind((f) => ({ ...f, count: `${fq.idx + 1} / ${fq.matches.length}` }))
  }

  // ------------------------------------------------------------------ the PDF window (desktop _PdfWindow)

  const L = useRef({ goto, reorder, applyLayout, setViewMode, slideMenu: (_e: React.MouseEvent, _i: number) => {}, setRightTab, view })
  const linkActions = useMemo<PdfLinkActions>(
    () => ({
      goto: (i) => L.current.goto(i),
      open: (i) => {
        L.current.goto(i)
        L.current.setViewMode('normal')
      },
      reorder: (order) => L.current.reorder(order),
      slideMenu: (e, i) => L.current.slideMenu(e, i),
      tab: (t) => {
        // Picking the Overview tab by hand is the Overview view too (window._on_right_tab).
        L.current.setRightTab(t)
        if (t === 'overview') L.current.setViewMode('overview')
        else if (L.current.view === 'overview') L.current.setViewMode('normal')
      },
      dock: () => {
        pdfWin.current = null
        L.current.applyLayout('side')
      },
    }),
    [],
  )

  const linkData: PdfLink = {
    title,
    pdf: compile.pdf,
    busy: compile.busy,
    page: pdfPageOf(slideIndex),
    pageTick,
    tab: rightTab,
    deck,
    look,
    media,
    backdrop: backdrop.pages,
    current: slideIndex,
    menus: null,
    windowId: pdfWin.current,
    actions: linkActions,
  }
  const menusRef = useRef<MenuBarMenu[] | null>(null)
  useEffect(() => {
    useLinks.getState().put(win.id, { ...linkData, menus: menusRef.current })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, compile.pdf, compile.busy, slideIndex, pageTick, rightTab, deck, look, backdrop.pages])

  // Open the PDF window to the right of this one (or close it when leaving that layout).
  useEffect(() => {
    const wm = useWindows.getState()
    if (layout === 'window') {
      if (pdfWin.current && wm.windows.some((w) => w.id === pdfWin.current)) return
      const id = os.open('kherveslide', { pdfFor: win.id })
      pdfWin.current = id
      if (!id || isSmallScreen()) return
      const desk = desktopSize()
      const gap = 8
      const mainW = Math.max(560, Math.round((desk.w - 3 * gap) * 0.62))
      const me = wm.windows.find((w) => w.id === win.id)
      if (me && (me.maximized || me.snapped)) wm.snap(win.id, null)
      useWindows.getState().setBounds(win.id, { x: gap, y: gap, w: mainW, h: desk.h - 2 * gap })
      useWindows.getState().setBounds(id, { x: 2 * gap + mainW, y: gap, w: Math.max(320, desk.w - 3 * gap - mainW), h: desk.h - 2 * gap })
      useWindows.getState().focus(win.id)
    } else if (pdfWin.current) {
      const id = pdfWin.current
      pdfWin.current = null
      void wm.close(id, true)
    }
  }, [layout, win.id])

  // Closing the main window closes its PDF window.
  useEffect(
    () => () => {
      if (pdfWin.current) void useWindows.getState().close(pdfWin.current, true)
      useLinks.getState().drop(win.id)
    },
    [win.id],
  )

  // ------------------------------------------------------------------ AI tools (appManifest.ts: kherveslide_*)

  const slideNumber = (v: unknown): number => {
    const n = Math.round(Number(v))
    const count = deckRef.current.slides.length
    if (!Number.isFinite(n) || n < 1 || n > count) throw new Error(`There is no slide ${String(v)}: the presentation has ${count} slide${count === 1 ? '' : 's'} (1 = first).`)
    return n - 1
  }
  const strings = (v: unknown): string[] | null => {
    if (v === undefined || v === null) return null
    if (Array.isArray(v)) return v.map((x) => String(x))
    return String(v)
      .split('\n')
      .map((x) => x.replace(/^\s*[-•*]\s+/, '').trim())
      .filter(Boolean)
  }

  useAppTools(win, {
    list_slides: async () => {
      const d = deckRef.current
      return {
        file: filePath ?? `${untitledName} (not saved)`,
        title: d.title,
        author: d.author,
        theme: d.theme + (d.theme_spec.enabled ? ' + custom colours' : ''),
        shown: slideIndex + 1,
        slides: d.slides.map((s, i) => ({
          number: i + 1,
          title: slideHeading(s),
          ...(s.hidden ? { hidden: true } : {}),
          bullets: bulletsOf(s),
          texts: s.objects
            .filter((o): o is SlideText => o.type === 'SlideText' && o !== bulletBox(s))
            .map((o) => texToPlain(o.text).slice(0, 200))
            .filter(Boolean),
          objects: s.objects.map((o) => o.type.replace('Slide', '').toLowerCase()),
        })),
      }
    },
    add_slide: async (a) => {
      const bullets = strings(a.bullets) ?? []
      const at = a.after === undefined ? deckRef.current.slides.length : Math.max(0, Math.min(Math.round(Number(a.after)), deckRef.current.slides.length))
      mutate((d) => addSlideFromBullets(d, String(a.title ?? ''), bullets, at))
      goto(at)
      return { added: at + 1, slides: deckRef.current.slides.length }
    },
    edit_slide: async (a) => {
      const i = slideNumber(a.slide)
      const changed: string[] = []
      mutate((d) => {
        const s = d.slides[i]
        if (typeof a.title === 'string') {
          // A slide built from a layout has its heading in a text box at the top; otherwise it is the frame title.
          const head = !s.title ? s.objects.find((o): o is SlideText => o.type === 'SlideText' && o.y < 0.2 && !/\\begin\{(itemize|enumerate)/.test(o.text)) : undefined
          if (head) head.text = a.title
          else s.title = a.title
          changed.push('title')
        }
        const bullets = strings(a.bullets)
        if (bullets) {
          const box = bulletBox(s)
          if (box) box.text = itemize(bullets)
          else s.objects.push(makeObject('SlideText', { x: 0.06, y: 0.2, w: 0.88, h: 0.7, text: itemize(bullets), font_pt: 20 }))
          changed.push('bullets')
        }
        if (typeof a.find === 'string' && a.find) {
          let n = 0
          for (const o of s.objects) {
            if (o.type === 'SlideText' && o.text.includes(a.find)) {
              n += o.text.split(a.find).length - 1
              o.text = o.text.split(a.find).join(String(a.replace ?? ''))
            }
            if (o.type === 'SlideTable') o.rows = o.rows.map((r) => r.map((c) => (c.includes(String(a.find)) ? (n++, c.split(String(a.find)).join(String(a.replace ?? ''))) : c)))
          }
          if (!n) throw new Error(`"${a.find}" is not on slide ${i + 1}.`)
          changed.push(`${n} replacement${n === 1 ? '' : 's'}`)
        }
        if (typeof a.hidden === 'boolean') {
          s.hidden = a.hidden
          changed.push(a.hidden ? 'hidden' : 'shown')
        }
      })
      if (!changed.length) throw new Error('Nothing to change: give "title", "bullets", "find"/"replace" or "hidden".')
      goto(i)
      return { slide: i + 1, changed }
    },
    export_pdf: async (a, ctx) => {
      let p = typeof a.path === 'string' && a.path.trim() ? P.resolve(HOME, a.path.trim()) : defaultExportPath('.pdf')
      if (!/\.pdf$/i.test(p)) p += '.pdf'
      if (fs.exists(p) && !(await ctx.confirm(`replace ${P.pretty(p)}`))) throw new Error('The user kept the existing file.')
      const { pdf } = await slideshowPdf()
      if (!pdf) throw new Error(`LaTeX could not compile the slides: ${compile.errors[0]?.message || 'see the console in KherveSlide'}`)
      await fs.writeBytes(p, pdf, { mkdirs: true })
      return { path: P.pretty(p), bytes: pdf.length }
    },
    open_example: async (a) => {
      const items = examples ?? (await loadExamples())
      if (!a.title) return { examples: items.map((x) => `${x.title}: ${x.description}`) }
      const item = findExample(items, String(a.title))
      if (!item) throw new Error(`No example called "${a.title}". There are: ${items.map((x) => x.title).join(', ')}.`)
      if (toJson(deckRef.current) !== savedJson) throw new Error('The open presentation has unsaved changes; save it first (or ask the user).')
      await openExample(item, false)
      return { opened: item.title, slides: deckRef.current.slides.length }
    },
  })

  // ------------------------------------------------------------------ context menus

  const layoutThumb = (name: string): ReactNode => {
    const s = slideLayout(name)
    const d = { ...deck, slides: [s] }
    return (
      <span className="ks2-app ks2-layout-thumb">
        <SlideView deck={d} slide={s} look={look} media={media} width={78} />
      </span>
    )
  }
  const layoutItems = (pick: (name: string) => void): MenuItem[] => Object.keys(SLIDE_LAYOUTS).map((n) => ({ label: n, image: layoutThumb(n), onClick: () => pick(n) }))

  const slideMenu = (e: React.MouseEvent, row: number) => {
    if (masterMode || row < 0 || row >= deck.slides.length) return
    os.contextMenu(
      e,
      [
        { label: 'Apply layout to this slide', submenu: layoutItems((n) => applyLayoutTo(row, n)) },
        '-',
        { label: 'New slide after', submenu: layoutItems((n) => addSlide(n, row)) },
        { label: 'Duplicate slide', onClick: () => duplicateSlide(row) },
        '-',
        { label: 'Move up', disabled: row === 0, onClick: () => moveSlide(row, -1) },
        { label: 'Move down', disabled: row >= deck.slides.length - 1, onClick: () => moveSlide(row, 1) },
        '-',
        { label: deck.slides[row].hidden ? 'Show slide' : 'Hide slide', onClick: () => toggleHidden(row) },
        { label: 'Delete slide', disabled: deck.slides.length <= 1, onClick: () => deleteSlide(row, false) },
      ],
      { className: 'ks2-layout-menu' },
    )
  }
  L.current = { goto, reorder, applyLayout, setViewMode, slideMenu, setRightTab, view }

  const canvasMenu = (e: React.MouseEvent, i: number | null) => {
    e.preventDefault()
    const o = i !== null ? slide.objects[i] : undefined
    if (!o) {
      os.contextMenu(e, [
        { label: 'Add text box', onClick: addText },
        { label: 'Add image…', onClick: () => void addPicture() },
        { label: 'Add table', onClick: addTable },
        { label: 'Equation builder...', image: menuIcon('equation_builder'), shortcut: K('⇧⌘E'), onClick: addEquation },
        { label: 'Chemical reaction...', image: menuIcon('chemistry'), shortcut: K('⇧⌘R'), onClick: addChemistry },
        { label: 'Chemical structure...', image: menuIcon('chemfig_structure'), shortcut: K('⇧⌘T'), onClick: () => void addChemStructure() },
        { label: 'Flowchart builder...', image: menuIcon('flowchart_builder'), shortcut: K('⇧⌘F'), onClick: addFlowchart },
        { label: 'Add drawing…', onClick: addDrawing },
        '-',
        { label: 'Paste', onClick: () => void paste() },
      ])
      return
    }
    const s = selected()
    const grouped = s.some((k) => slide.objects[k]?.group)
    const positioned = o.type === 'SlideLine' || o.type === 'SlideShape' || o.type === 'SlideVideo'
    const items: MenuItem[] = [
      { label: 'Copy', onClick: () => copySelected() },
      { label: 'Paste', onClick: () => void paste() },
      { label: 'Cut', onClick: () => copySelected(true) },
      { label: 'Duplicate', onClick: duplicateSelected },
      { label: 'Delete', onClick: deleteSelected },
      '-',
      ...(s.length > 1 ? [{ label: 'Group', onClick: () => group(true) }] : []),
      ...(grouped ? [{ label: 'Ungroup', onClick: () => group(false) }] : []),
      ...(s.length > 1 || grouped ? ['-' as const] : []),
      { label: positioned ? 'Lock position (no dragging)' : 'Locked (beamer places it)', checked: o.locked, onClick: () => setOnSelected({ locked: !o.locked }) },
      { label: 'Bring to front', onClick: () => zOrder('front') },
      { label: 'Send to back', onClick: () => zOrder('back') },
    ]
    if (o.type === 'SlidePicture') {
      items.push(
        '-',
        { label: 'Crop & rotate…', onClick: () => editPicture(i!) },
        { label: 'Rotate left 90°', onClick: () => rotatePicture(i!, -90) },
        { label: 'Rotate right 90°', onClick: () => rotatePicture(i!, 90) },
        { label: 'Lock aspect ratio', checked: o.keep_aspect, onClick: () => editSlide((sl) => ((sl.objects[i!] as SlidePicture).keep_aspect = !o.keep_aspect)) },
        { label: 'Transparency…', onClick: () => void transparency(i!) },
        { label: 'Replace image…', onClick: () => void replaceImage(i!) },
        { label: 'Paste image here', onClick: () => void paste() },
        { label: 'Export to PNG…', disabled: !o.path, onClick: () => void exportPicturePng(i!) },
      )
    }
    items.push('-')
    if (o.type === 'SlideShape') items.push({ label: 'Shape properties…', onClick: () => fieldsFor(i!, 'Shape properties', OBJECT_FIELDS.SlideShape) })
    else if (o.type === 'SlideLine') items.push({ label: 'Line / arrow properties…', onClick: () => fieldsFor(i!, 'Line / arrow properties', OBJECT_FIELDS.SlideLine) })
    else if (o.type === 'SlideTable') items.push({ label: 'Table design…', onClick: tableDesign }, { label: 'Table properties…', onClick: () => tableProps(i!) })
    else if (o.type === 'SlideVideo') items.push({ label: 'Video properties…', onClick: () => fieldsFor(i!, 'Video properties', OBJECT_FIELDS.SlideVideo) })
    else items.push({ label: 'Box style (border / fill)…', onClick: () => fieldsFor(i!, 'Box style', FRAME) })
    if (o.type === 'SlideText' && o.block) items.push({ label: 'Block title…', onClick: () => void blockTitle(i!) })
    os.contextMenu(e, items)
  }

  // ------------------------------------------------------------------ header / footer fields

  const hfExample = (token: string): string => {
    const today = new Date()
    const n = slideIndex + 1
    const total = deck.slides.length
    return (
      {
        '\\insertframenumber': String(n),
        '\\insertframenumber\\,/\\,\\inserttotalframenumber': `${n} / ${total}`,
        '\\inserttotalframenumber': String(total),
        '\\today': `${today.getDate()} ${today.toLocaleString('en-GB', { month: 'long' })} ${today.getFullYear()}`,
        '\\the\\day/\\the\\month/\\the\\year': `${today.getDate()}/${today.getMonth() + 1}/${today.getFullYear()}`,
        '\\the\\year': String(today.getFullYear()),
        '\\inserttitle': deck.title,
        '\\insertshorttitle': deck.title,
        '\\insertframetitle': slide.title || '(none on this slide)',
        '\\insertauthor': deck.author || '(no author set)',
        '\\insertshortauthor': deck.author || '(no author set)',
      } as Record<string, string>
    )[token] ?? ''
  }

  const applyFrameTitle = (v: string) => {
    if (!masterMode && slide.title !== v) editSlide((s) => (s.title = v))
  }
  const applyHeadFoot = (key: 'header' | 'foot_left' | 'foot_center' | 'foot_right', v: string) => {
    if (deckRef.current[key] !== v) {
      mutate((d) => (d[key] = v))
      recompileNow()
    }
  }

  const hfInsert = (el: HTMLInputElement, token: string, apply: (v: string) => void) => {
    el.focus()
    el.setRangeText(token, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, 'end')
    apply(el.value)
  }

  const hfField = (name: string, value: string, placeholder: string, apply: (v: string) => void, disabled = false) => (
    <input
      key={`${name}:${value}`}
      className="ks2-hf-input"
      defaultValue={value}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      title="Double-click to insert the slide number, date, title, author… (accepts LaTeX too, e.g. \today)."
      onBlur={(e) => apply(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      onDoubleClick={(e) => {
        const el = e.currentTarget
        const r = el.getBoundingClientRect()
        os.contextMenu({ clientX: r.left, clientY: r.bottom }, [
          { label: 'Insert into this field:', disabled: true },
          ...HF_INSERTS.map((x): MenuItem => {
            if (!x) return '-'
            const ex = hfExample(x[1])
            return { label: ex ? `${x[0]}    —  ${ex}` : x[0], onClick: () => hfInsert(el, x[1], apply) }
          }),
          '-',
          {
            label: 'Clear field',
            onClick: () => {
              el.value = ''
              apply('')
            },
          },
        ])
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        const el = e.currentTarget
        os.contextMenu(e, [
          { label: 'Insert', submenu: HF_INSERTS.map((x): MenuItem => (x ? { label: x[0], onClick: () => hfInsert(el, x[1], apply) } : '-')) },
          '-',
          {
            label: 'Clear field',
            onClick: () => {
              el.value = ''
              apply('')
            },
          },
        ])
      }}
    />
  )

  // ------------------------------------------------------------------ menus (window._build_menus)

  const themeMenuItems = (): MenuItem[] => [
    { label: 'Presentation theme (whole look)', submenu: BEAMER_THEMES.map((t) => ({ label: t, checked: deck.theme === t, onClick: () => setTheme(t) })) },
    {
      label: 'Colour theme (colours only)',
      submenu: ['', ...BEAMER_COLOR_THEMES].map((t) => ({ label: t || '(theme default)', checked: deck.color_theme === t, onClick: () => setColourTheme(t) })),
    },
    '-',
    { label: 'Preview themes…', onClick: themeGallery },
    { label: 'Generate all theme previews…', onClick: () => void os.dialog.alert('The previews are drawn by the Visual editor: there is nothing to generate in advance.', { title: 'Theme previews' }) },
    { label: 'Theme wizard — make or import a theme…', onClick: () => themeBuilder('Theme wizard') },
    { label: 'Advanced theme builder…', onClick: () => themeBuilder('Advanced theme builder') },
    '-',
    {
      label: 'Show theme decorations',
      checked: !deck.plain_frames,
      onClick: () => {
        mutate((d) => (d.plain_frames = !d.plain_frames))
        recompileNow()
      },
    },
  ]

  const showMenuItems = (): MenuItem[] => [
    { label: 'From the beginning', shortcut: 'F5', onClick: () => void startSlideshow('full', false) },
    { label: 'From the current slide', shortcut: '⇧F5', onClick: () => void startSlideshow('full', true) },
    { label: 'Presenter view', shortcut: '⌥F5', onClick: () => void startSlideshow('presenter', true) },
    { label: 'Current + next slide (two screens)', onClick: () => void startSlideshow('next', true) },
    { label: 'In a window', onClick: () => void startSlideshow('window', true) },
    { label: 'Automatic slideshow…', onClick: autoSlideshow },
    '-',
    {
      label: 'Show the slides on',
      submenu: [
        { label: 'Automatic (the other screen if there is one)', checked: true },
        { label: 'This screen (the browser shows on one screen)', disabled: true },
      ],
    },
  ]

  const recentMenu = (): MenuItem[] => {
    const files = loadPrefs().recent
    if (!files.length) return [{ label: '(no recent files)', disabled: true }]
    return [
      ...files.map((p) => ({ label: P.basename(p), onClick: () => void confirmDiscard('opening another presentation').then((ok) => { if (ok) void openPath(p) }) })),
      '-',
      {
        label: 'Clear recent files',
        onClick: () => {
          savePrefs({ recent: [] })
          setPrefsTick((t) => t + 1)
        },
      },
    ]
  }

  const tableMenu = (): MenuItem[] => [
    { label: 'Insert table…', onClick: tablePicker },
    { label: 'Table design…', onClick: tableDesign },
    '-',
    { label: 'Add row', onClick: () => tableOp('add_row') },
    { label: 'Add column', onClick: () => tableOp('add_col') },
    { label: 'Delete row', onClick: () => tableOp('del_row') },
    { label: 'Delete column', onClick: () => tableOp('del_col') },
    '-',
    { label: 'Toggle header row', onClick: () => tableOp('header') },
    { label: 'Caption…', onClick: () => tableOp('caption') },
    '-',
    { label: 'Table properties…', onClick: () => (one?.type === 'SlideTable' ? tableProps(sel[0]) : flash('Select a table first', 4000)) },
  ]

  const gitStub = (what: string) => () =>
    notInKherveOS(`Git ▸ ${what}`, 'Every save writes the .kslide and its .tex; commit the folder from KhervePY’s Git panel to keep versions.')

  const buildMenus = (): MenuBarMenu[] => [
    {
      label: 'File',
      items: [
        { label: 'New', shortcut: K('⌘N'), onClick: () => void newDeck('Blank') },
        { label: 'New window', shortcut: K('⇧⌘N'), onClick: () => os.open('kherveslide', { _new: Date.now() }) },
        { label: 'Open…', shortcut: K('⌘O'), onClick: () => void openDialog() },
        { label: 'Import PowerPoint (.pptx)…', onClick: () => notInKherveOS('Importing PowerPoint files') },
        { label: 'Open recent', submenu: recentMenu() },
        {
          label: 'Templates',
          submenu: [
            { label: 'New presentation from template', submenu: templateNames().map((n) => ({ label: n, onClick: () => void newDeck(n) })) },
            '-',
            { label: 'Save current presentation as template…', onClick: () => void saveAsTemplate() },
            { label: 'Rename template…', onClick: renameTemplate },
            { label: 'Delete template…', onClick: deleteTemplate },
          ],
        },
        {
          label: 'Example presentations',
          submenu: examples?.length ? examples.map((x) => ({ label: x.title, onClick: () => void openExample(x) })) : [{ label: examples ? 'No examples found' : 'Loading…', disabled: true }],
        },
        '-',
        { label: 'Save', shortcut: K('⌘S'), onClick: () => void save() },
        { label: 'Save As…', shortcut: K('⇧⌘S'), onClick: () => void saveAs() },
        {
          label: 'Open file location',
          onClick: () => (filePath ? os.open('files', { path: P.dirname(filePath) }) : void os.dialog.alert('Save the presentation first — it has no file yet.', { title: 'Open file location' })),
        },
        '-',
        { label: 'Export LaTeX (.tex)…', onClick: () => void exportTex() },
        { label: 'Export LaTeX project (.zip)…', onClick: () => void exportZip() },
        { label: 'Export PDF…', onClick: () => void exportPdf() },
        { label: 'Export PowerPoint (.pptx)…', onClick: () => notInKherveOS('Exporting to PowerPoint', 'Export a PDF instead (File ▸ Export PDF…).') },
        { label: 'Compile to PDF', shortcut: K('⌘R'), onClick: compileNow },
        '-',
        { label: 'Print preview…', onClick: () => void print() },
        { label: 'Print…', shortcut: K('⌘P'), onClick: () => void print() },
        '-',
        { label: 'Quit', shortcut: K('⌘Q'), onClick: () => win.close() },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', image: menuIcon('undo'), shortcut: K('⌘Z'), disabled: !past.current.length, onClick: undo },
        { label: 'Redo', image: menuIcon('redo'), shortcut: K('⌘Y'), disabled: !future.current.length, onClick: redo },
        '-',
        { label: 'Copy', shortcut: K('⌘C'), onClick: () => copySelected() },
        { label: 'Cut', shortcut: K('⌘X'), onClick: () => copySelected(true) },
        { label: 'Paste', shortcut: K('⌘V'), onClick: () => void paste() },
        { label: 'Duplicate', shortcut: K('⌘D'), onClick: duplicateSelected },
        '-',
        { label: 'Group', shortcut: K('⌘G'), onClick: () => group(true) },
        { label: 'Ungroup', shortcut: K('⇧⌘G'), onClick: () => group(false) },
        '-',
        { label: 'Find…', shortcut: K('⌘F'), onClick: () => setFind((f) => ({ ...f, open: true })) },
        {
          label: 'Check spelling…',
          shortcut: 'F7',
          onClick: () => void os.dialog.alert('Spelling is checked as you type: misspelled words are underlined in the text box you edit (View ▸ Check spelling).', { title: 'Spell check' }),
        },
        { label: 'Page setup…', onClick: pageSetup },
        '-',
        {
          label: 'Presentation',
          submenu: [
            { label: 'Title…', onClick: () => void setDeckField('title', 'Title') },
            { label: 'Author…', onClick: () => void setDeckField('author', 'Author') },
            {
              label: 'Navigation symbols (prev / next)',
              checked: deck.nav_symbols,
              onClick: () => {
                mutate((d) => (d.nav_symbols = !d.nav_symbols))
                recompileNow()
              },
            },
            {
              label: 'Slide numbers',
              submenu: (
                [
                  ['none', 'Off'],
                  ['number', 'Slide number'],
                  ['of_total', 'Slide number / total'],
                ] as const
              ).map(([k, l]) => ({
                label: l,
                checked: deck.page_number === k,
                onClick: () => {
                  mutate((d) => (d.page_number = k))
                  recompileNow()
                },
              })),
            },
          ],
        },
      ],
    },
    {
      label: 'View',
      items: [
        ...(['side', 'window', 'visual'] as Layout[]).map((m, k) => ({ label: LAYOUT_TEXT[m][0], checked: layout === m, shortcut: K(`⌘${4 + k}`), onClick: () => applyLayout(m) })),
        '-',
        { label: 'Normal (one slide)', image: menuIcon('view_normal'), checked: view === 'normal', onClick: () => setViewMode('normal') },
        { label: 'Overview of all the slides', image: menuIcon('view_overview'), checked: view === 'overview', onClick: () => setViewMode('overview') },
        { label: 'Master (the template behind every slide)', image: menuIcon('view_master'), checked: view === 'master', onClick: () => setViewMode('master') },
        '-',
        { label: 'Show slides list', image: menuIcon('toggle_navigator'), checked: navShown, shortcut: K('⌘B'), onClick: toggleSlidesList },
        {
          label: 'Show the theme on the slide (as in the PDF)',
          checked: showTheme,
          onClick: () => {
            setShowTheme(!showTheme)
            savePrefs({ showTheme: !showTheme })
          },
        },
        '-',
        { label: 'Show grid', checked: showGrid, shortcut: K("⌘'"), onClick: () => setShowGrid((v) => !v) },
        {
          label: 'Grid size',
          submenu: GRID_SIZES.map(([l, d]) => ({
            label: l,
            checked: gridDivisions === d,
            onClick: () => {
              setGridDivisions(d)
              savePrefs({ gridDivisions: d })
            },
          })),
        },
        { label: 'Snap to grid', checked: snapGrid, onClick: () => setSnapGrid((v) => !v) },
        { label: 'Snap to objects', checked: snapObjects, onClick: () => setSnapObjects((v) => !v) },
        '-',
        {
          label: 'Check spelling',
          checked: spell,
          onClick: () => {
            setSpell(!spell)
            savePrefs({ spellcheck: !spell })
          },
        },
        {
          label: 'Spell-check language',
          submenu: SPELL_LANGUAGES.map(([l, c]) => ({
            label: l,
            checked: spellLang === c,
            onClick: () => {
              setSpellLang(c)
              savePrefs({ spellLang: c })
            },
          })),
        },
        {
          label: 'Appearance',
          submenu: [
            { label: 'KherveOS (Settings › Appearance)', checked: true },
            { label: 'Open Settings…', onClick: () => os.open('settings') },
          ],
        },
        { label: 'LaTeX editor theme', submenu: [{ label: 'Match app theme', checked: true }] },
        '-',
        { label: 'Slide theme', submenu: themeMenuItems() },
      ],
    },
    {
      label: 'Slide',
      items: [
        { label: 'Add blank slide', onClick: () => addSlide('Blank') },
        { label: 'Add slide with layout', submenu: Object.keys(SLIDE_LAYOUTS).map((n) => ({ label: n, onClick: () => addSlide(n) })) },
        { label: 'Delete slide', disabled: masterMode || deck.slides.length <= 1, onClick: () => deleteSlide() },
        { label: 'Hide / show slide', disabled: masterMode, onClick: () => toggleHidden() },
        '-',
        { label: 'Move slide up', shortcut: K('⇧⌘↑'), disabled: masterMode || slideIndex === 0, onClick: () => moveSlide(slideIndex, -1) },
        { label: 'Move slide down', shortcut: K('⇧⌘↓'), disabled: masterMode || slideIndex >= deck.slides.length - 1, onClick: () => moveSlide(slideIndex, 1) },
        '-',
        { label: 'Frame title…', disabled: masterMode, onClick: () => void frameTitle() },
        { label: 'Background colour…', onClick: slideBackground },
        { label: 'Clear background', onClick: () => editSlide((s) => Object.assign(s, { bg: '', bg_alpha: 1 })) },
      ],
    },
    {
      label: 'Insert',
      items: [
        { label: 'Text box', onClick: addText },
        { label: 'Picture', onClick: () => void addPicture() },
        { label: 'Video…', onClick: () => void addVideo() },
        { label: 'Equation builder...', image: menuIcon('equation_builder'), shortcut: K('⇧⌘E'), onClick: addEquation },
        { label: 'Chemical reaction...', image: menuIcon('chemistry'), shortcut: K('⇧⌘R'), onClick: addChemistry },
        { label: 'Chemical structure...', image: menuIcon('chemfig_structure'), shortcut: K('⇧⌘T'), onClick: () => void addChemStructure() },
        { label: 'Flowchart builder...', image: menuIcon('flowchart_builder'), shortcut: K('⇧⌘F'), onClick: addFlowchart },
        { label: 'Drawing…', onClick: addDrawing },
        '-',
        {
          label: 'Shapes',
          submenu: [
            { label: 'Line', onClick: () => addLine(false) },
            { label: 'Arrow', onClick: () => addLine(true) },
            '-',
            ...SHAPE_GROUPS.map(([g, items]): MenuItem => ({ label: g, submenu: items.map(([k, l]) => ({ label: l, onClick: () => addShape(k) })) })),
          ],
        },
        { label: 'Table', submenu: tableMenu() },
      ],
    },
    {
      label: 'Compiler',
      items: [
        { label: 'Compile to PDF', onClick: compileNow },
        '-',
        { label: 'Compiler status…', onClick: () => setModal(<CompilerStatusDialog last={compileStatus.text} onClose={() => setModal(null)} />) },
        {
          label: 'Download offline bundle…',
          onClick: () => void os.dialog.alert('In KherveOS the slides are typeset by tectonic on the server, which keeps its own package cache.', { title: 'Offline LaTeX packages' }),
        },
        {
          label: 'Open the package cache folder',
          onClick: () => void os.dialog.alert('The package cache is on the KherveOS server, not on your drive.', { title: 'Package cache' }),
        },
      ],
    },
    { label: 'Slideshow', items: showMenuItems() },
    {
      label: 'Git',
      items: [
        {
          label: 'Save snapshot and upload',
          image: menuIcon('commit'),
          onClick: async () => {
            if (await save()) gitStub('Save snapshot and upload')()
          },
        },
        { label: 'Download latest from cloud', onClick: gitStub('Download latest from cloud') },
        '-',
        { label: 'View version history…', image: menuIcon('history'), onClick: gitStub('View version history') },
        { label: 'Branches…', image: menuIcon('branch'), onClick: gitStub('Branches') },
        '-',
        { label: 'Connect to GitHub / GitLab…', onClick: gitStub('Connect to GitHub / GitLab') },
      ],
    },
    {
      label: 'AI',
      items: [{ label: 'Connect to Claude…', onClick: () => os.open('kherveai') }],
    },
    {
      label: 'Help',
      items: [
        { label: 'User Guide', shortcut: 'F1', onClick: () => setModal(<UserGuideDialog onClose={() => setModal(null)} />) },
        { label: 'Welcome page…', onClick: () => setWelcome(true) },
        '-',
        { label: 'Check for updates (KherveOS updates its apps)', disabled: true },
        '-',
        { label: 'About KherveSlide', onClick: () => setModal(<AboutDialog onClose={() => setModal(null)} onLink={(u) => os.openUrl(u)} />) },
      ],
    },
  ]

  const B = useRef(buildMenus)
  B.current = buildMenus
  const menuKey = [
    past.current.length > 0, future.current.length > 0, sel.length, view, layout, showTheme, deck.theme, deck.color_theme, deck.page_number, deck.nav_symbols,
    deck.plain_frames, examples?.length ?? -1, slideIndex, deck.slides.length, filePath, navShown, showGrid, gridDivisions, snapGrid, snapObjects, spell, spellLang,
    compileStatus.text, prefsTick, one?.type, sel.join(','), json, override ? 1 : 0, compile.pdf ? 1 : 0,
  ].join('|')
  useEffect(() => {
    const menus = B.current()
    menusRef.current = menus
    win.setMenus(menus)
    useLinks.getState().put(win.id, { menus })
  }, [win, menuKey])
  useEffect(() => () => win.setMenus(null), [win])

  // ------------------------------------------------------------------ keyboard (the desktop's shortcuts)

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented || modal || present) return
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    const inField = !!(e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"], .cm-editor')
    let handled = true
    if (mod && k === 's') void (e.shiftKey ? saveAs() : save())
    else if (mod && k === 'o') void openDialog()
    else if (mod && k === 'r' && e.shiftKey) addChemistry()
    else if (mod && k === 'r') compileNow()
    else if (mod && k === 'p') void print()
    else if (mod && k === 'f' && e.shiftKey) addFlowchart()
    else if (mod && k === 'f') setFind((f) => ({ ...f, open: true }))
    else if (mod && (k === '4' || k === '5' || k === '6')) applyLayout((['side', 'window', 'visual'] as Layout[])[Number(k) - 4])
    else if (mod && k === 'e' && e.shiftKey) addEquation()
    else if (mod && k === 't' && e.shiftKey) void addChemStructure()
    else if (e.key === 'F1') setModal(<UserGuideDialog onClose={() => setModal(null)} />)
    else if (e.key === 'F5') void startSlideshow(e.altKey ? 'presenter' : 'full', e.shiftKey || e.altKey)
    else if (inField) handled = false
    else if (mod && k === 'z') e.shiftKey ? redo() : undo()
    else if (mod && k === 'y') redo()
    else if (mod && k === 'c') copySelected()
    else if (mod && k === 'x') copySelected(true)
    else if (mod && k === 'v') void paste()
    else if (mod && k === 'd') duplicateSelected()
    else if (mod && k === 'a') setSel(slide.objects.map((_, i) => i))
    else if (mod && k === 'g') group(!e.shiftKey)
    else if (mod && k === 'b') toggleSlidesList()
    else if (mod && k === "'") setShowGrid((v) => !v)
    else if (mod && e.shiftKey && k === 'arrowup') moveSlide(slideIndex, -1)
    else if (mod && e.shiftKey && k === 'arrowdown') moveSlide(slideIndex, 1)
    else if (mod) handled = false
    else if (e.key === 'F7') void os.dialog.alert('Spelling is checked as you type in the text box you edit.', { title: 'Spell check' })
    else if (k === 'delete' || k === 'backspace') sel.length ? deleteSelected() : (handled = false)
    else if (k === 'escape') {
      if (welcome) setWelcome(false)
      else if (find.open) setFind((f) => ({ ...f, open: false, count: '' }))
      else setSel([])
    } else if ((k === 'enter' || k === 'f2') && sel.length === 1 && slide.objects[sel[0]]?.type === 'SlideText') setEditingText(sel[0])
    else if (k.startsWith('arrow') && sel.length) {
      const step = e.shiftKey ? 0.02 : 0.004
      nudge(k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0)
    } else if ((k === 'pagedown' || k === 'arrowdown' || k === 'arrowright') && !masterMode) goto(slideIndex + 1)
    else if ((k === 'pageup' || k === 'arrowup' || k === 'arrowleft') && !masterMode) goto(slideIndex - 1)
    else handled = false
    if (handled) e.preventDefault()
  }

  // ------------------------------------------------------------------ layout

  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ w: 800, h: 500 })
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setStage({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [loading, present, welcome, view, leftTab])
  const g = geometry(deck)
  const fitWidth = Math.max(160, Math.min(stage.w - 24, ((stage.h - 24) * g.W) / g.H))
  const canvasWidth = fitWidth * zoom

  const splitRef = useRef<HTMLDivElement>(null)
  const dragSplit = (e: React.PointerEvent) => {
    const el = splitRef.current
    if (!el) return
    e.preventDefault()
    const r = el.getBoundingClientRect()
    const move = (ev: PointerEvent) => setRightWidth(Math.max(0.2, Math.min(0.7, (r.right - ev.clientX) / r.width)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('k-dragging')
    }
    document.body.classList.add('k-dragging')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  if (present) {
    return (
      <div className="k-app ks2-app">
        <Present
          deck={deck}
          look={look}
          media={media}
          backdrop={backdrop.pages}
          pdf={present.pdf}
          start={present.start}
          presenter={present.presenter}
          windowed={present.windowed}
          auto={present.auto}
          onExit={(shown) => {
            setPresent(null)
            // Land on the slide the show ended on.
            const at = deck.slides.map((x, i) => (x.hidden ? -1 : i)).filter((i) => i >= 0)[shown]
            if (at !== undefined) goto(at)
          }}
        />
      </div>
    )
  }

  // ---- the toolbars (window._build_toolbar / _build_slide_toolbar)

  const T = (key: string, shortcut = '') => tip(key, shortcut)
  const isText = !!t0
  const isPic = one?.type === 'SlidePicture'
  const noType = one?.type === 'SlideLine' || one?.type === 'SlideShape'
  /** A toolbar button with the desktop's tooltip (tooltips.py) for `key`. */
  const btn = (key: string, icon: Extract<TBItem, { kind: 'btn' }>['icon'], label: string, onClick: () => void, extra: Partial<Extract<TBItem, { kind: 'btn' }>> = {}, shortcut = ''): TBItem => ({
    kind: 'btn', key, icon, label, tip: TIPS[key] ? T(key, shortcut) : label, onClick, ...extra,
  })
  const sep = (key: string): TBItem => ({ kind: 'sep', key })

  const topItems: TBItem[] = [
    btn('new', 'file_new', 'New', () => void newDeck('Blank'), {}, K('⌘N')),
    btn('open', 'file_open', 'Open', () => void openDialog(), {}, K('⌘O')),
    btn('save', 'file_save', 'Save', () => void save(), {}, K('⌘S')),
    sep('s1'),
    btn('undo', 'undo', 'Undo', undo, { disabled: !past.current.length }, K('⌘Z')),
    btn('redo', 'redo', 'Redo', redo, { disabled: !future.current.length }, K('⌘Y')),
    sep('s2'),
    btn('templates', 'templates_icon', 'Templates', templatesChooser),
    btn('export_pdf', 'export_pdf', 'Export PDF', () => void exportPdf()),
    sep('s3'),
    btn('zoom_out', 'zoom_out', 'Zoom out', () => setZoom((z) => Math.max(0.2, z / 1.25))),
    btn('fit', 'fit_width', 'Fit slide to window', () => setZoom(1)),
    btn('zoom_in', 'zoom_in', 'Zoom in', () => setZoom((z) => Math.min(5, z * 1.25))),
    sep('s4'),
    {
      kind: 'widget',
      key: 'box',
      node: (
        <>
          <span className="ks2-tb-label">Box</span>
          <select className="ks2-combo" title={T('box_type')} disabled={!one || noType || sel.length > 1} value={objKind(one)} onChange={(e) => changeKind(e.target.value)}>
            {BOX_KINDS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </>
      ),
    },
    sep('s5'),
    {
      kind: 'widget',
      key: 'font',
      node: (
        <>
          <span className="ks2-tb-label">Font</span>
          <select className="ks2-combo" title={T('font_family')} disabled={!isText} value={t0?.font_family ?? ''} onChange={(e) => setOnSelected({ font_family: e.target.value }, ['SlideText'])}>
            <option value="">Default</option>
            <option value="sf">Sans-serif</option>
            <option value="rm">Serif</option>
            <option value="tt">Monospace</option>
          </select>
          <FontSpin value={t0?.font_pt ?? null} disabled={!isText} title={T('font_size')} onChange={(n) => setOnSelected({ font_pt: n }, ['SlideText'])} />
        </>
      ),
    },
    btn('bold', 'bold', 'Bold', () => toggleRunOrBox('bold'), { disabled: !isText, checked: !!t0?.bold, keepFocus: true }),
    btn('italic', 'italic', 'Italic', () => toggleRunOrBox('italic'), { disabled: !isText, checked: !!t0?.italic, keepFocus: true }),
    btn('superscript', 'superscript', 'Superscript', () => scriptSelection('super'), { disabled: !isText, keepFocus: true }),
    btn('subscript', 'subscript', 'Subscript', () => scriptSelection('sub'), { disabled: !isText, keepFocus: true }),
    sep('s6'),
    btn('align_left', 'align_left', 'Align left', () => setOnSelected({ align: 'left' }, ['SlideText']), { disabled: !isText, checked: isText && (t0!.align || 'left') === 'left' }),
    btn('align_center', 'align_center', 'Centre', () => setOnSelected({ align: 'center' }, ['SlideText']), { disabled: !isText, checked: t0?.align === 'center' }),
    btn('align_right', 'align_right', 'Align right', () => setOnSelected({ align: 'right' }, ['SlideText']), { disabled: !isText, checked: t0?.align === 'right' }),
    sep('s7'),
    {
      kind: 'widget',
      key: 'colours',
      node: (
        <>
          <ColorButton plain icon={<Ico name="text_colour" />} title={T('text_colour')} value={t0?.color ?? ''} disabled={!isText} allowNone={false} onChange={(c) => setOnSelected({ color: c || '#000000' }, ['SlideText'])} />
          <ColorButton plain icon={<Ico name="fill_colour" />} title={T('fill_colour')} value={t0?.fill ?? ''} disabled={!isText} onChange={(c) => setOnSelected({ fill: c }, ['SlideText'])} />
        </>
      ),
    },
    sep('s8'),
    btn('bullets', 'bullet_list', 'Insert bullet list', () => insertList(false), { keepFocus: true }),
    btn('numbered', 'numbered_list', 'Insert numbered list', () => insertList(true), { keepFocus: true }),
    sep('s9'),
    btn('replace_image', 'image_box', 'Replace image…', () => void replaceImage(sel[0]), { disabled: !isPic }),
    { kind: 'spacer', key: 'spacer' },
    btn('pdf_side', 'pdf_side_panel', 'Visual + PDF side by side', () => applyLayout(layout === 'side' ? 'visual' : 'side'), { checked: layout === 'side' }, K('⌘4')),
    sep('s10'),
    btn(
      'skip_images',
      'compile_no_images',
      'Skip images',
      () => {
        const on = !skipImages
        setSkipImages(on)
        savePrefs({ skipImages: on })
        flash(on ? 'Skip images ON — faster compiles (placeholders shown)' : 'Skip images OFF — pictures included', 3000)
      },
      { checked: skipImages },
    ),
    btn('compile', 'play', 'Compile now', compileNow, {}, K('⌘R')),
    btn(
      'auto_compile',
      autoCompile ? 'auto_compile_on' : 'auto_compile_off',
      'Auto-compile',
      () => {
        const on = !autoCompile
        setAutoCompile(on)
        savePrefs({ autoCompile: on })
        if (on) latexDown.current = false
        flash(on ? 'Auto-compile ON' : 'Auto-compile OFF — use the play button to compile', 3000)
      },
      { checked: autoCompile, disabled: layout === 'visual' },
    ),
  ]

  const sideItems: TBItem[] = [
    btn('prev_slide', 'prev_slide', 'Previous slide', () => !masterMode && goto(slideIndex - 1)),
    btn('next_slide', 'next_slide', 'Next slide', () => !masterMode && goto(slideIndex + 1)),
    btn('slides_list', 'toggle_navigator', 'Show slides list', toggleSlidesList, { checked: navShown }, K('⌘B')),
    sep('v1'),
    btn('add_slide', 'slide_add', 'Add slide', () => addSlide('Blank'), { menu: () => layoutItems((n) => addSlide(n)), menuClass: 'ks2-layout-menu' }),
    btn('remove_slide', 'slide_remove', 'Remove active slide', () => deleteSlide()),
    sep('v2'),
    btn('text_box', 'text_box', 'Add text box', addText),
    btn('picture', 'image_box', 'Add image', () => void addPicture()),
    btn('video', 'video_box', 'Add video', () => void addVideo()),
    btn('table', 'table', 'Add table', addTable),
    btn('equation', 'equation_builder', 'Equation builder', addEquation, {}, K('⇧⌘E')),
    btn('chemistry', 'chemistry', 'Chemical reaction', addChemistry, {}, K('⇧⌘R')),
    btn('chemfig', 'chemfig_structure', 'Chemical structure', () => void addChemStructure(), {}, K('⇧⌘T')),
    btn('flowchart', 'flowchart_builder', 'Flowchart builder', addFlowchart, {}, K('⇧⌘F')),
    btn('symbol', 'symbol', 'Insert symbol…', insertSymbol, { keepFocus: true }),
    btn('drawing', 'drawing', 'Add drawing', addDrawing),
    btn('line', 'line_tool', 'Add line', () => addLine(false)),
    btn('arrow', 'arrow_tool', 'Add arrow', () => addLine(true)),
    btn('rect', 'rect_tool', 'Add rectangle', addRect),
    btn('ellipse', 'ellipse_tool', 'Add circle / ellipse', addEllipse),
    sep('v3'),
    btn('raise', 'raise_box', 'Raise object', () => zOrder('raise')),
    btn('lower', 'lower_box', 'Lower object', () => zOrder('lower')),
    btn('front', 'to_front', 'Bring to front', () => zOrder('front')),
    btn('back', 'to_back', 'Send to back', () => zOrder('back')),
    sep('v4'),
    btn('delete', 'delete_box', 'Delete object', deleteSelected),
  ]

  // ---- the Visual tab

  const recent = loadPrefs().recent
  void prefsTick
  const navWidth = 176

  const visualTab = (
    <div className="ks2-visual">
      {navShown ? (
        <div className="ks2-nav-panel">
          <div className="ks2-nav-head">
            <b>{welcome ? 'Recent' : 'Slides'}</b>
            <button className="ks2-fold" title={`Hide the slides list (${K('⌘B')})`} onClick={() => setNavShown(false)}>
              «
            </button>
          </div>
          {welcome ? (
            <RecentPanel files={recent} exists={(p) => fs.exists(p)} onChoose={(p) => void confirmDiscard('opening another presentation').then((ok) => { if (ok) void openPath(p) })} onOpen={() => void openDialog(false)} />
          ) : (
            <Navigator
              deck={deck}
              look={look}
              media={media}
              backdrop={backdrop.pages}
              current={slideIndex}
              masterOf={masterMode ? slideIndex : null}
              width={navWidth}
              onSelect={goto}
              onReorder={reorder}
              onContextMenu={slideMenu}
              onDelete={(i) => deleteSlide(i, false)}
            />
          )}
        </div>
      ) : (
        <button className="ks2-nav-strip" title={`Show the slides list (${K('⌘B')})`} onClick={() => setNavShown(true)}>
          {'»\nS\nl\ni\nd\ne\ns'}
        </button>
      )}
      <div className="ks2-right-stack">
        {welcome ? (
          <StartPage
            templates={templateNames().map((n) => [n, () => instantiateTemplate(n)])}
            examples={examples}
            media={media}
            layout={layout}
            showAtStart={loadPrefs().showWelcome}
            onShowAtStart={(on) => {
              savePrefs({ showWelcome: on })
              setPrefsTick((t) => t + 1)
            }}
            onLayout={applyLayout}
            onNew={() => void newDeck('Blank')}
            onOpen={() => void openDialog()}
            onImport={() => notInKherveOS('Importing PowerPoint files')}
            onContinue={() => setWelcome(false)}
            onTemplate={(n) => void newDeck(n)}
            onExample={(x) => void openExample(x)}
          />
        ) : view === 'overview' && layout === 'visual' ? (
          <Overview deck={deck} look={look} media={media} backdrop={backdrop.pages} current={slideIndex} onGo={goto} onOpen={(i) => (goto(i), setViewMode('normal'))} onReorder={reorder} onMenu={slideMenu} />
        ) : (
          <div className="ks2-canvas-box">
            {masterMode && (
              <div className="ks2-master-banner">
                <span>
                  <b>Master</b> — what you put here (logo, text, lines, pictures…) shows on every slide, behind the slide's own content.
                </span>
                <button className="k-btn small" onClick={() => setViewMode('normal')}>
                  Close master view
                </button>
              </div>
            )}
            <div className="ks2-hf-row">
              <span>Frame:</span>
              {hfField('frame', masterMode ? '' : slide.title, 'Frame title (this slide)', applyFrameTitle, masterMode)}
              <span>Header:</span>
              {hfField('header', deck.header, 'Header', (v) => applyHeadFoot('header', v))}
              <label className="ks2-navcheck" title="Show beamer's prev/next navigation symbols at the bottom-right of every slide">
                <input
                  type="checkbox"
                  checked={deck.nav_symbols}
                  onChange={() => {
                    mutate((d) => (d.nav_symbols = !d.nav_symbols))
                    recompileNow()
                  }}
                />
                Nav ▾▴
              </label>
            </div>
            <div className="ks2-stage" ref={stageRef} onPointerDown={(e) => e.target === e.currentTarget && setSel([])}>
              {loading ? (
                <div className="k-center k-muted">Opening…</div>
              ) : (
                <div className="ks2-stage-inner" style={{ minWidth: canvasWidth + 24, minHeight: (canvasWidth * g.H) / g.W + 24 }} onPointerDown={(e) => e.target === e.currentTarget && setSel([])}>
                  <div className="ks2-gridwrap">
                    <Canvas
                      deck={deck}
                      slide={slide}
                      look={look}
                      media={media}
                      backdrop={masterMode ? null : (backdrop.pages?.[slideIndex] ?? null)}
                      master={!masterMode}
                      width={canvasWidth}
                      selection={sel.filter((i) => i < slide.objects.length)}
                      setSelection={setSel}
                      edit={editSlide}
                      begin={begin}
                      editingText={editingText}
                      setEditingText={(i) => {
                        if (i !== null && editMathBox(i)) return
                        setEditingText(i)
                      }}
                      onPickPicture={(i) => editPicture(i)}
                      onProperties={(i) => {
                        const o = slide.objects[i]
                        if (o?.type === 'SlideVideo') fieldsFor(i, 'Video properties', OBJECT_FIELDS.SlideVideo)
                        else if (o?.type === 'SlideShape') fieldsFor(i, 'Shape properties', OBJECT_FIELDS.SlideShape)
                        else if (o?.type === 'SlideLine') fieldsFor(i, 'Line / arrow properties', OBJECT_FIELDS.SlideLine)
                        else if (o) fieldsFor(i, 'Properties', OBJECT_FIELDS[o.type])
                      }}
                      onContextMenu={canvasMenu}
                      onDropFiles={(p, at) => void dropFiles(p, at)}
                      snapGrid={snapGrid ? gridDivisions : 0}
                      snapObjects={snapObjects}
                      spellcheck={spell}
                      lang={spellLang}
                    />
                    {showGrid && <div className="ks2-grid" style={{ backgroundSize: `${canvasWidth / gridDivisions}px ${canvasWidth / gridDivisions}px` }} />}
                  </div>
                </div>
              )}
            </div>
            <div className="ks2-hf-row">
              <span>Foot:</span>
              {hfField('l', deck.foot_left, 'Left foot', (v) => applyHeadFoot('foot_left', v))}
              {hfField('c', deck.foot_center, 'Centre foot', (v) => applyHeadFoot('foot_center', v))}
              {hfField('r', deck.foot_right, 'Right foot', (v) => applyHeadFoot('foot_right', v))}
            </div>
          </div>
        )}
      </div>
    </div>
  )

  const tabs: ['visual' | 'latex' | 'console', string][] = [['visual', 'Visual'], ['latex', 'LaTeX'], ['console', 'Console']]

  return (
    <div className="k-app ks2-app" tabIndex={-1} onKeyDown={onKeyDown}>
      <TopToolbar items={topItems} />
      <div className="ks2-body">
        <SideToolbar items={sideItems} />
        <div className="ks2-central">
          <div className="ks2-split" ref={splitRef}>
            <div className="ks2-lefttabs">
              <div className="ks2-qtabs">
                {tabs.map(([k, l]) => (
                  <button key={k} className={`ks2-qtab${leftTab === k ? ' active' : ''}`} onClick={() => setLeftTab(k)}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="ks2-qtab-body">
                <div className="ks2-tabpage" hidden={leftTab !== 'visual'}>
                  {visualTab}
                </div>
                <div className="ks2-tabpage" hidden={leftTab !== 'latex'}>
                  <LatexTab
                    source={latexSource}
                    overridden={!!override}
                    onEdit={(text) => setOverride((o) => ({ text, base: o?.base ?? generated }))}
                    onRegenerate={() => {
                      setOverride(null)
                      flash('LaTeX regenerated from the slides', 3000)
                    }}
                    onView={(v) => (latexView.current = v)}
                  />
                </div>
                <div className="ks2-tabpage" hidden={leftTab !== 'console'}>
                  <ConsoleTab log={compile.log} errors={compile.errors} missing={compile.missing} />
                </div>
              </div>
            </div>
            {layout === 'side' && (
              <>
                <div className="ks2-splitter" onPointerDown={dragSplit} />
                <div className="ks2-sidepanel" style={{ width: `${rightWidth * 100}%` }}>
                  <RightTabs link={linkData} />
                </div>
              </>
            )}
          </div>
          {find.open && (
            <div className="ks2-findbar">
              <input
                autoFocus
                className="k-input"
                placeholder="Find in slides / LaTeX…"
                value={find.text}
                onChange={(e) => {
                  findQuery.current.q = ''
                  setFind({ open: true, text: e.target.value, count: '' })
                }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') findNext(e.shiftKey)
                  if (e.key === 'Escape') setFind((f) => ({ ...f, open: false, count: '' }))
                }}
              />
              <span className="ks2-find-count">{find.count}</span>
              <button className="k-btn small" title="Previous match" onClick={() => findNext(true)}>
                ▲
              </button>
              <button className="k-btn small" title="Next match" onClick={() => findNext(false)}>
                ▼
              </button>
              <button className="k-btn small" onClick={() => setFind((f) => ({ ...f, open: false, count: '' }))}>
                ✕
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="ks2-statusbar">
        <span className="ks2-status-msg" title={backdrop.error || undefined}>
          {message}
        </span>
        <span className={`ks2-status-state ${compileStatus.kind}`}>{compileStatus.text}</span>
        <ViewBar
          counter={masterMode ? 'Master' : `Slide ${slideIndex + 1} of ${deck.slides.length}`}
          view={view}
          tips={{
            theme: T('theme'),
            normal: T('view_normal'),
            overview: T('view_overview'),
            master: T('view_master'),
            slideshow: T('slideshow', '⇧F5'),
            zoom_out: T('zoom_out'),
            fit: T('fit'),
            zoom_in: T('zoom_in'),
          }}
          themeMenu={themeMenuItems}
          showMenu={showMenuItems}
          onView={setViewMode}
          onSlideshow={() => void startSlideshow('full', true)}
          onZoomOut={() => setZoom((z) => Math.max(0.2, z / 1.25))}
          onFit={() => setZoom(1)}
          onZoomIn={() => setZoom((z) => Math.min(5, z * 1.25))}
        />
      </div>
      {modal}
    </div>
  )
}
