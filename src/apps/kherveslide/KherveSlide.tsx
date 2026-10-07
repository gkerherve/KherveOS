// KherveSlide: a slide designer that typesets with beamer — the desktop
// KherveSlide (../KherveSlide, kherveslide/) in KherveOS.
//
// As on the desktop the presentation model (model.ts) is the single source of
// truth: the slide sorter and the Visual canvas draw it, serializer.ts turns it
// into exactly the beamer LaTeX the desktop writes, and the KherveOS server
// compiles that with tectonic (os/services/latex.ts) for the PDF, the PDF
// export and the exact theme under the canvas (backdrop.ts). Files are the
// desktop's .kslide JSON, written byte for byte as the desktop writes them.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { zipSync } from 'fflate'
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowUpToLine, Bold, BringToFront, FileDown, FilePlus, FolderOpen, Image as ImageIcon,
  Italic, List, ListOrdered, Lock, LockOpen, MoveRight, PaintBucket, Play, Redo2, Save, SendToBack, Shapes, Sigma, Slash, Square, Table,
  Type, Undo2, Unlock, ZoomIn, ZoomOut,
} from 'lucide-react'
import { os, fs, path as P, HOME, type AppProps, type MenuBarMenu, type MenuItem } from '@/os'
import { useAppTools } from '@/os/ai/appTools'
import { compileLatex } from '@/os/services/latex'
import {
  cloneDeck, fromJson, lowerObject, makeObject, makeSlide, OBJECT_LABEL, raiseObject, slideHeading, toBack, toFront, toJson,
  type Deck, type Slide, type SlideObject, type SlideText,
} from './model'
import { serializeDeck } from './serializer'
import { SHAPE_GROUPS } from './shapes'
import {
  addSlideFromBullets, applyKit, bulletBox, bulletsOf, itemize, newFromTemplate, SLIDE_LAYOUTS, slideLayout, TEMPLATES, THEME_PRESETS,
} from './templates'
import { ASPECTS, deckLook } from './look'
import { BEAMER_COLOR_THEMES, BEAMER_THEMES } from './serializer'
import { compileBundle, isPicture, Media, PICTURE_EXTENSIONS, usedPictures } from './media'
import { useBackdrop } from './backdrop'
import { fetchExample, findExample, loadExamples, type ExampleItem } from './examples'
import { Canvas } from './Canvas'
import { Sorter } from './Sorter'
import { ConsolePanel, LatexPanel, PdfPanel } from './Panels'
import { Present } from './Present'
import { ColorButton, EquationDialog, FieldsDialog, type Values } from './dialogs'
import { OBJECT_FIELDS, PAGE_FIELDS, THEME_FIELDS } from './props'
import { geometry } from './SlideView'
import { texToPlain } from './texhtml'
import './kherveslide.css'

type PanelTab = 'none' | 'latex' | 'console' | 'pdf'

interface CompileState {
  busy: boolean
  log: string
  errors: { line?: number; file?: string; message: string }[]
  missing: string[]
  pdf: Uint8Array | null
  /** The deck JSON the PDF was made from. */
  of: string
}

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv']
const FONT_SIZES = [8, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 44, 48, 54, 60, 72, 96]
const HISTORY_MAX = 200

/** Objects copied with ⌘C, shared by every KherveSlide window. */
let objectClipboard: SlideObject[] = []

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const stemOf = (p: string) => P.basename(p).replace(/\.kslide(\.json)?$/i, '').replace(/\.json$/i, '')

export default function KherveSlide({ win, args }: AppProps) {
  const media = useMemo(() => new Media(), [])
  useEffect(() => () => media.dispose(), [media])

  const [deck, setDeckState] = useState<Deck>(() => newFromTemplate('Blank'))
  const deckRef = useRef(deck)
  const past = useRef<Deck[]>([])
  const future = useRef<Deck[]>([])
  const [, setHistoryTick] = useState(0)
  const [current, setCurrent] = useState(0)
  const [masterMode, setMasterMode] = useState(false)
  const [sel, setSel] = useState<number[]>([])
  const [editingText, setEditingText] = useState<number | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [savedJson, setSavedJson] = useState(() => toJson(deck))
  const [panel, setPanel] = useState<PanelTab>('none')
  const [compile, setCompile] = useState<CompileState>({ busy: false, log: '', errors: [], missing: [], pdf: null, of: '' })
  const [exact, setExact] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [present, setPresent] = useState<{ start: number; pdf: Uint8Array | null; presenter: boolean } | null>(null)
  const [modal, setModal] = useState<ReactNode>(null)
  const [examples, setExamples] = useState<ExampleItem[] | null>(null)
  const [loading, setLoading] = useState(!!(args.path || args.example))
  const [untitledName, setUntitledName] = useState('Untitled')

  const slideIndex = Math.max(0, Math.min(current, deck.slides.length - 1))
  const slide: Slide = masterMode ? deck.master : (deck.slides[slideIndex] ?? makeSlide())
  const look = useMemo(() => deckLook(deck), [deck])
  const backdrop = useBackdrop(deck, media, exact)
  const json = useMemo(() => toJson(deck), [deck])
  const dirty = json !== savedJson
  const docName = filePath ? P.basename(filePath) : untitledName

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
    setHistoryTick((t) => t + 1)
  }
  const redo = () => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(deckRef.current)
    deckRef.current = next
    setDeckState(next)
    setSel([])
    setHistoryTick((t) => t + 1)
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
    setMasterMode(false)
    setCompile({ busy: false, log: '', errors: [], missing: [], pdf: null, of: '' })
    media.deckDir = path ? P.dirname(path) : null
    win.setDocumentPath(path)
  }

  useEffect(() => {
    win.setTitle(`${dirty ? '• ' : ''}${docName} — KherveSlide`)
  }, [win, docName, dirty])

  useEffect(() => {
    setSel([])
    setEditingText(null)
  }, [slideIndex, masterMode])

  // ------------------------------------------------------------------ files

  const confirmDiscard = async (): Promise<boolean> => {
    if (toJson(deckRef.current) === savedJson) return true
    const choice = await os.dialog.choose(
      `Save the changes to "${docName}" first?`,
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

  const openPath = async (p: string) => {
    setLoading(true)
    try {
      const d = fromJson(await fs.readText(p))
      if (!d.slides.length) d.slides.push(makeSlide())
      media.assets.clear()
      replaceDeck(d, p)
    } catch (e) {
      await os.dialog.alert(`"${P.basename(p)}" could not be opened: ${errorText(e)}`, { title: 'KherveSlide' })
    } finally {
      setLoading(false)
    }
  }

  const openDialog = async () => {
    if (!(await confirmDiscard())) return
    const p = await os.dialog.openFile({ title: 'Open a presentation', extensions: ['.kslide', '.json'], startDir: filePath ? P.dirname(filePath) : undefined })
    if (p) await openPath(p)
  }

  const newDeck = async (template = 'Blank') => {
    if (!(await confirmDiscard())) return
    media.assets.clear()
    replaceDeck(newFromTemplate(template), null)
  }

  const openExample = async (item: ExampleItem, ask = true) => {
    if (ask && !(await confirmDiscard())) return
    setLoading(true)
    try {
      const { deck: d, assets } = await fetchExample(item)
      media.assets.clear()
      for (const [k, v] of assets) media.assets.set(k, v)
      replaceDeck(d, null, item.title)
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
      return true
    } catch (e) {
      await os.dialog.alert(`Could not save: ${errorText(e)}`, { title: 'KherveSlide' })
      return false
    }
  }

  const saveAs = async (): Promise<boolean> => {
    const p = await os.dialog.saveFile({
      title: 'Save the presentation',
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
    win.setCloseGuard(async () => confirmDiscard())
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

  // ------------------------------------------------------------------ compile and export

  const lastCompileError = useRef('')
  const runCompile = async (show = true): Promise<Uint8Array | null> => {
    setCompile((c) => ({ ...c, busy: true }))
    const d = deckRef.current
    const b = await compileBundle(d, media)
    const r = await compileLatex('presentation.tex', b.files)
    setCompile((c) => ({ busy: false, log: r.log, errors: r.errors, missing: b.missing, pdf: r.pdf ?? c.pdf, of: r.pdf ? toJson(d) : c.of }))
    if (!r.pdf) {
      lastCompileError.current = r.errors[0]?.message ?? 'The slides could not be compiled.'
      if (show) setPanel('console')
      os.notify({ title: 'KherveSlide', body: lastCompileError.current })
      return null
    }
    lastCompileError.current = ''
    if (show) setPanel((p) => (p === 'none' || p === 'console' ? (r.errors.length ? 'console' : 'pdf') : p))
    return r.pdf
  }

  const defaultExportPath = (ext: string) =>
    filePath ? P.join(P.dirname(filePath), `${stemOf(filePath)}${ext}`) : P.join(HOME, 'Documents', `${(deckRef.current.title || untitledName).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Presentation'}${ext}`)

  const exportPdf = async () => {
    const p = await os.dialog.saveFile({ title: 'Export PDF', extensions: ['.pdf'], defaultName: defaultExportPath('.pdf') })
    if (!p) return
    const pdf = await runCompile()
    if (!pdf) return
    await fs.writeBytes(p, pdf, { mkdirs: true })
    os.notify({ title: 'PDF exported', body: P.pretty(p) })
  }

  const exportTex = async () => {
    const p = await os.dialog.saveFile({ title: 'Export LaTeX', extensions: ['.tex'], defaultName: defaultExportPath('.tex') })
    if (!p) return
    await fs.writeText(p, serializeDeck(deckRef.current), { mkdirs: true })
    os.notify({ title: 'LaTeX exported', body: `${P.pretty(p)} — pictures keep their paths.` })
  }

  const exportZip = async () => {
    const p = await os.dialog.saveFile({ title: 'Export the LaTeX project', extensions: ['.zip'], defaultName: defaultExportPath('.zip') })
    if (!p) return
    const b = await compileBundle(deckRef.current, media)
    const enc = new TextEncoder()
    const entries: Record<string, Uint8Array> = {}
    for (const [name, data] of Object.entries(b.files)) entries[name] = typeof data === 'string' ? enc.encode(data) : data
    await fs.writeBytes(p, zipSync(entries), { mkdirs: true })
    os.notify({ title: 'LaTeX project exported', body: `${P.pretty(p)}: presentation.tex and its pictures, ready for any LaTeX (XeLaTeX or tectonic).` })
  }

  const startShow = async (fromCurrent: boolean, pdfMode: boolean, presenter = false) => {
    const d = deckRef.current
    const shownBefore = d.slides.slice(0, slideIndex).filter((s) => !s.hidden).length
    let pdf: Uint8Array | null = null
    if (pdfMode) {
      pdf = compile.pdf && compile.of === toJson(d) ? compile.pdf : await runCompile(false)
      if (!pdf) return
    }
    setEditingText(null)
    setPresent({ start: fromCurrent ? shownBefore : 0, pdf, presenter })
  }

  // ------------------------------------------------------------------ objects

  const addObject = (o: SlideObject) => {
    editSlide((s) => s.objects.push(o))
    setSel([slide.objects.length])
  }

  const addText = (text = 'Text', fields: Partial<SlideText> = {}) =>
    addObject(makeObject('SlideText', { x: 0.2, y: 0.3, w: 0.6, h: 0.15, text, font_pt: 20, locked: false, ...fields }))

  const pictureBox = async (p: string, w = 0.5): Promise<{ w: number; h: number }> => {
    const g = geometry(deckRef.current)
    try {
      const url = await media.url(p)
      if (!url) throw new Error()
      const img = new Image()
      img.src = url
      await img.decode()
      const h = Math.min(0.8, (w * g.W * img.naturalHeight) / img.naturalWidth / g.H)
      return { w: (h * g.H * img.naturalWidth) / img.naturalHeight / g.W, h }
    } catch {
      return { w, h: 0.5 }
    }
  }

  const addPicture = async () => {
    const p = await os.dialog.openFile({ title: 'Insert a picture', extensions: PICTURE_EXTENSIONS })
    if (!p) return
    const { w, h } = await pictureBox(p)
    addObject(makeObject('SlidePicture', { path: p, x: (1 - w) / 2, y: Math.max(0.05, (1 - h) / 2), w, h, locked: false }))
  }

  const swapPicture = async (i: number) => {
    const p = await os.dialog.openFile({ title: 'Choose a picture', extensions: PICTURE_EXTENSIONS })
    if (!p) return
    editSlide((s) => {
      const o = s.objects[i]
      if (o?.type === 'SlidePicture') o.path = p
    })
  }

  const addVideo = async () => {
    const p = await os.dialog.openFile({ title: 'Insert a video', extensions: VIDEO_EXTENSIONS })
    if (!p) return
    addObject(makeObject('SlideVideo', { path: p }))
    os.notify({ title: 'Video', body: 'In the PDF the video is a link that opens the file in the video player; keep the file with the PDF.' })
  }

  const addEquation = () =>
    setModal(
      <EquationDialog
        initial=""
        onDone={(tex) => {
          setModal(null)
          if (tex) addText(`\\[${tex}\\]`, { align: 'center', font_pt: 24, x: 0.15, w: 0.7, h: 0.18 })
        }}
      />,
    )

  const editEquation = (i: number) => {
    const o = slide.objects[i] as SlideText
    const m = /^\s*\\\[([\s\S]*)\\\]\s*$/.exec(o.text) ?? /^\s*\$([\s\S]*)\$\s*$/.exec(o.text)
    setModal(
      <EquationDialog
        initial={m ? m[1].trim() : o.text}
        onDone={(tex) => {
          setModal(null)
          if (tex !== null) editSlide((s) => ((s.objects[i] as SlideText).text = `\\[${tex}\\]`))
        }}
      />,
    )
  }

  const addTable = () =>
    setModal(
      <FieldsDialog
        title="Insert a table"
        fields={[
          { key: 'rows', label: 'Rows', kind: 'number', min: 1, max: 30, step: 1 },
          { key: 'cols', label: 'Columns', kind: 'number', min: 1, max: 12, step: 1 },
          { key: 'header', label: 'Header row', kind: 'bool' },
        ]}
        values={{ rows: 3, cols: 3, header: true }}
        onDone={(v) => {
          setModal(null)
          if (!v) return
          const rows = Array.from({ length: Math.round(Number(v.rows)) }, (_, r) =>
            Array.from({ length: Math.round(Number(v.cols)) }, (_, c) => (r === 0 && v.header ? `Heading ${c + 1}` : '')),
          )
          addObject(makeObject('SlideTable', { rows, header: !!v.header, x: 0.1, y: 0.25, w: 0.8, h: 0.08 * rows.length, locked: false }))
        }}
      />,
    )

  const addShape = (shape: string) => addObject(makeObject('SlideShape', { shape, locked: false, fill: '#DDEBF7', border_color: look.structure }))
  const addLine = (arrow: boolean) => addObject(makeObject('SlideLine', { arrow_end: arrow, locked: false, color: arrow ? '#555555' : '#000000', width_pt: arrow ? 2 : 1.5 }))
  const addBlock = (block: string) => addText('Block text', { block, block_title: block === 'block' ? 'Title' : '', font_pt: 16, x: 0.1, w: 0.8, h: 0.25 })

  const dropFiles = async (paths: string[], at: { x: number; y: number }) => {
    let k = 0
    for (const p of paths.filter(isPicture)) {
      const { w, h } = await pictureBox(p, 0.35)
      const o = makeObject('SlidePicture', { path: p, x: Math.max(0, Math.min(1 - w, at.x - w / 2 + k * 0.03)), y: Math.max(0, Math.min(1 - h, at.y - h / 2 + k * 0.03)), w, h, locked: false })
      editSlide((s) => s.objects.push(o))
      k++
    }
    const decks = paths.filter((p) => /\.kslide$/i.test(p))
    if (!k && decks.length && (await confirmDiscard())) await openPath(decks[0])
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
  }

  const paste = () => {
    if (!objectClipboard.length) return
    const n = slide.objects.length
    const copies = objectClipboard.map((o) => ({ ...structuredClone(o), x: o.x + 0.02, y: o.y + 0.02 }))
    objectClipboard = copies.map((o) => structuredClone(o))
    editSlide((s) => s.objects.push(...copies))
    setSel(copies.map((_, k) => n + k))
  }

  const duplicateSelected = () => {
    const s = selected()
    if (!s.length) return
    const n = slide.objects.length
    editSlide((sl) => sl.objects.push(...s.map((i) => ({ ...structuredClone(sl.objects[i]), x: sl.objects[i].x + 0.02, y: sl.objects[i].y + 0.02 }))))
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

  const zOrder = (how: 'front' | 'back' | 'up' | 'down') => {
    const s = selected()
    if (s.length !== 1) return
    let ni = s[0]
    editSlide((sl) => {
      ni = how === 'front' ? toFront(sl, s[0]) : how === 'back' ? toBack(sl, s[0]) : how === 'up' ? raiseObject(sl, s[0]) : lowerObject(sl, s[0])
    })
    setSel([ni])
  }

  const group = (on: boolean) => {
    const s = selected()
    if (!s.length) return
    const next = on ? Math.max(0, ...deckRef.current.slides.flatMap((x) => x.objects.map((o) => o.group)), ...deckRef.current.master.objects.map((o) => o.group)) + 1 : 0
    editSlide((sl) => {
      for (const i of s) sl.objects[i].group = next
    })
  }

  const properties = (i: number) => {
    const o = slide.objects[i]
    if (!o) return
    const fields = OBJECT_FIELDS[o.type]
    setModal(
      <FieldsDialog
        title={`${OBJECT_LABEL[o.type][0].toUpperCase()}${OBJECT_LABEL[o.type].slice(1)} properties`}
        fields={fields}
        values={{ ...o } as unknown as Values}
        onDone={(v) => {
          setModal(null)
          if (!v) return
          editSlide((s) => {
            const t = s.objects[i] as unknown as Record<string, unknown>
            if (!t) return
            for (const f of fields) {
              const val = v[f.key]
              t[f.key] = f.kind === 'number' && (f.key === 'font_pt' || f.key === 'group') ? Math.round(Number(val)) : val
            }
          })
        }}
      />,
    )
  }

  // ------------------------------------------------------------------ slides

  const goto = (i: number) => {
    setMasterMode(false)
    setCurrent(Math.max(0, Math.min(i, deckRef.current.slides.length - 1)))
  }

  const addSlide = (layout = 'Title + content', at = slideIndex + 1) => {
    mutate((d) => d.slides.splice(at, 0, slideLayout(layout)))
    goto(at)
  }
  const duplicateSlide = (i = slideIndex) => {
    mutate((d) => d.slides.splice(i + 1, 0, structuredClone(d.slides[i])))
    goto(i + 1)
  }
  const deleteSlide = (i = slideIndex) => {
    mutate((d) => {
      d.slides.splice(i, 1)
      if (!d.slides.length) d.slides.push(makeSlide())
    })
    goto(Math.min(i, deckRef.current.slides.length - 1))
  }
  const moveSlide = (from: number, to: number) => {
    if (to < 0 || to >= deckRef.current.slides.length || from === to) return
    mutate((d) => {
      const [s] = d.slides.splice(from, 1)
      d.slides.splice(to, 0, s)
    })
    goto(to)
  }
  const toggleHidden = (i = slideIndex) => mutate((d) => (d.slides[i].hidden = !d.slides[i].hidden))
  const applyLayout = (name: string, i = slideIndex) =>
    mutate((d) => {
      const fresh = slideLayout(name)
      d.slides[i] = { ...d.slides[i], objects: fresh.objects, bg: fresh.bg || d.slides[i].bg }
    })

  const frameTitle = async () => {
    const t = await os.dialog.prompt('The frame title (shown by the theme; leave empty for none):', { title: 'Frame title', defaultValue: slide.title })
    if (t !== null) editSlide((s) => (s.title = t))
  }

  const slideBackground = () =>
    setModal(
      <FieldsDialog
        title="Slide background"
        fields={[
          { key: 'bg', label: 'Colour', kind: 'color' },
          { key: 'bg_alpha', label: 'Strength (0–1)', kind: 'number', min: 0, max: 1, step: 0.05 },
        ]}
        values={{ bg: slide.bg, bg_alpha: slide.bg_alpha }}
        onDone={(v) => {
          setModal(null)
          if (v) editSlide((s) => Object.assign(s, { bg: String(v.bg ?? ''), bg_alpha: Number(v.bg_alpha) }))
        }}
      />,
    )

  // ------------------------------------------------------------------ the presentation

  const themeDialog = () => {
    const d = deckRef.current
    setModal(
      <FieldsDialog
        title="Theme"
        intro="A beamer theme, optionally with your own colours, title bar, footer and logo on top (the desktop's theme builder)."
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
          })
        }}
      />,
    )
  }

  const pageDialog = () => {
    const d = deckRef.current
    setModal(
      <FieldsDialog
        title="Presentation settings"
        fields={PAGE_FIELDS}
        values={{ ...d } as unknown as Values}
        onDone={(v) => {
          setModal(null)
          if (!v) return
          mutate((dd) => {
            const r = dd as unknown as Record<string, unknown>
            for (const f of PAGE_FIELDS) r[f.key] = v[f.key]
          })
        }}
      />,
    )
  }

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
      const pdf = await runCompile(false)
      if (!pdf) throw new Error(`LaTeX could not compile the slides: ${lastCompileError.current || 'see the console in KherveSlide'}`)
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

  // ------------------------------------------------------------------ keyboard

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented || modal || present) return
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    let handled = true
    if (mod && k === 'z') e.shiftKey ? redo() : undo()
    else if (mod && k === 'y') redo()
    else if (mod && k === 's') void (e.shiftKey ? saveAs() : save())
    else if (mod && k === 'o') void openDialog()
    else if (mod && k === 'r') void runCompile()
    else if (mod && k === 'c') copySelected()
    else if (mod && k === 'x') copySelected(true)
    else if (mod && k === 'v') paste()
    else if (mod && k === 'd') duplicateSelected()
    else if (mod && k === 'a') setSel(slide.objects.map((_, i) => i))
    else if (mod && k === 'g') group(!e.shiftKey)
    else if (mod && k === 'b') setOnSelected({ bold: !(slide.objects[sel[0]] as SlideText | undefined)?.bold }, ['SlideText'])
    else if (mod && k === 'i') setOnSelected({ italic: !(slide.objects[sel[0]] as SlideText | undefined)?.italic }, ['SlideText'])
    else if (mod) handled = false
    else if (k === 'delete' || k === 'backspace') sel.length ? deleteSelected() : (handled = false)
    else if (k === 'escape') setSel([])
    else if (k === 'f5') void startShow(e.shiftKey, false)
    else if ((k === 'enter' || k === 'f2') && sel.length === 1 && slide.objects[sel[0]]?.type === 'SlideText') setEditingText(sel[0])
    else if (k.startsWith('arrow') && sel.length) {
      const step = e.shiftKey ? 0.02 : 0.004
      nudge(k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0)
    } else if ((k === 'arrowdown' || k === 'arrowright' || k === 'pagedown') && !masterMode) goto(slideIndex + 1)
    else if ((k === 'arrowup' || k === 'arrowleft' || k === 'pageup') && !masterMode) goto(slideIndex - 1)
    else handled = false
    if (handled) e.preventDefault()
  }

  // ------------------------------------------------------------------ context menus

  const objectMenu = (e: React.MouseEvent, i: number | null) => {
    e.preventDefault()
    const o = i !== null ? slide.objects[i] : undefined
    const items: MenuItem[] = o
      ? [
          ...(o.type === 'SlideText'
            ? [
                { label: 'Edit text', onClick: () => setEditingText(i) },
                ...(/^\s*(\\\[|\$)/.test(o.text) ? [{ label: 'Edit equation…', icon: Sigma, onClick: () => editEquation(i!) }] : []),
              ]
            : []),
          ...(o.type === 'SlidePicture' ? [{ label: 'Change picture…', icon: ImageIcon, onClick: () => void swapPicture(i!) }] : []),
          ...(o.type === 'SlideTable'
            ? [
                { label: 'Add row', onClick: () => tableOp(i!, 'add_row') },
                { label: 'Add column', onClick: () => tableOp(i!, 'add_col') },
                { label: 'Delete last row', onClick: () => tableOp(i!, 'del_row') },
                { label: 'Delete last column', onClick: () => tableOp(i!, 'del_col') },
              ]
            : []),
          { label: 'Properties…', onClick: () => properties(i!) },
          '-',
          { label: 'Bring to front', icon: BringToFront, onClick: () => zOrder('front') },
          { label: 'Bring forward', onClick: () => zOrder('up') },
          { label: 'Send backward', onClick: () => zOrder('down') },
          { label: 'Send to back', icon: SendToBack, onClick: () => zOrder('back') },
          '-',
          o.locked
            ? { label: 'Unlock (free position)', icon: LockOpen, onClick: () => setOnSelected({ locked: false }) }
            : { label: 'Lock (beamer places it)', icon: Lock, onClick: () => setOnSelected({ locked: true }) },
          { label: 'Group', shortcut: '⌘G', disabled: sel.length < 2, onClick: () => group(true) },
          { label: 'Ungroup', shortcut: '⇧⌘G', disabled: !o.group, onClick: () => group(false) },
          '-',
          { label: 'Cut', shortcut: '⌘X', onClick: () => copySelected(true) },
          { label: 'Copy', shortcut: '⌘C', onClick: () => copySelected() },
          { label: 'Duplicate', shortcut: '⌘D', onClick: duplicateSelected },
          { label: 'Delete', danger: true, onClick: deleteSelected },
        ]
      : [
          { label: 'Paste', shortcut: '⌘V', disabled: !objectClipboard.length, onClick: paste },
          '-',
          { label: 'Text box', icon: Type, onClick: () => addText() },
          { label: 'Picture…', icon: ImageIcon, onClick: () => void addPicture() },
          { label: 'Equation…', icon: Sigma, onClick: addEquation },
          '-',
          { label: 'Frame title…', onClick: () => void frameTitle() },
          { label: 'Background colour…', onClick: slideBackground },
          { label: 'Apply layout', submenu: Object.keys(SLIDE_LAYOUTS).map((n) => ({ label: n, onClick: () => applyLayout(n) })) },
        ]
    os.contextMenu(e, items)
  }

  const tableOp = (i: number, op: 'add_row' | 'add_col' | 'del_row' | 'del_col') =>
    editSlide((s) => {
      const t = s.objects[i]
      if (t?.type !== 'SlideTable') return
      const cols = Math.max(1, ...t.rows.map((r) => r.length))
      if (op === 'add_row') {
        t.rows.push(Array.from({ length: cols }, () => ''))
        t.h += t.h / Math.max(1, t.rows.length - 1)
      } else if (op === 'add_col') t.rows = t.rows.map((r) => [...r, ...Array.from({ length: cols + 1 - r.length }, () => '')])
      else if (op === 'del_row' && t.rows.length > 1) {
        t.rows.pop()
        t.h -= t.h / (t.rows.length + 1)
      } else if (op === 'del_col' && cols > 1) t.rows = t.rows.map((r) => r.slice(0, cols - 1))
    })

  const slideMenu = (e: React.MouseEvent, i: number) =>
    os.contextMenu(e, [
      { label: 'New slide after', submenu: Object.keys(SLIDE_LAYOUTS).map((n) => ({ label: n, onClick: () => addSlide(n, i + 1) })) },
      { label: 'Apply layout to this slide', submenu: Object.keys(SLIDE_LAYOUTS).map((n) => ({ label: n, onClick: () => applyLayout(n, i) })) },
      { label: 'Duplicate slide', onClick: () => duplicateSlide(i) },
      '-',
      { label: 'Move up', disabled: i === 0, onClick: () => moveSlide(i, i - 1) },
      { label: 'Move down', disabled: i === deck.slides.length - 1, onClick: () => moveSlide(i, i + 1) },
      { label: deck.slides[i]?.hidden ? 'Show slide' : 'Hide slide', onClick: () => toggleHidden(i) },
      '-',
      { label: 'Delete slide', danger: true, onClick: () => deleteSlide(i) },
    ])

  // ------------------------------------------------------------------ menus

  const A = useRef({ save, saveAs, openDialog, newDeck, openExample, exportPdf, exportTex, exportZip, runCompile, startShow, undo, redo })
  A.current = { save, saveAs, openDialog, newDeck, openExample, exportPdf, exportTex, exportZip, runCompile, startShow, undo, redo }
  const B = useRef({ addText, addPicture, addVideo, addEquation, addTable, addShape, addLine, addBlock, addSlide, duplicateSlide, deleteSlide, toggleHidden, moveSlide, applyLayout, frameTitle, slideBackground, themeDialog, pageDialog, mutate, copySelected, paste, duplicateSelected, deleteSelected, group, properties, setOnSelected })
  B.current = { addText, addPicture, addVideo, addEquation, addTable, addShape, addLine, addBlock, addSlide, duplicateSlide, deleteSlide, toggleHidden, moveSlide, applyLayout, frameTitle, slideBackground, themeDialog, pageDialog, mutate, copySelected, paste, duplicateSelected, deleteSelected, group, properties, setOnSelected }

  const menuKey = [
    past.current.length > 0, future.current.length > 0, sel.length, masterMode, panel, exact, deck.theme, deck.color_theme, deck.aspect, deck.page_number,
    deck.nav_symbols, deck.plain_frames, examples?.length ?? -1, slideIndex, deck.slides.length, slide.hidden, filePath, compile.busy,
  ].join('|')

  useEffect(() => {
    const b = () => B.current
    const menus: MenuBarMenu[] = [
      {
        label: 'File',
        items: [
          { label: 'New', icon: FilePlus, shortcut: '⌘N', onClick: () => void A.current.newDeck('Blank') },
          { label: 'New from template', submenu: Object.keys(TEMPLATES).map((n) => ({ label: n, onClick: () => void A.current.newDeck(n) })) },
          { label: 'Open…', icon: FolderOpen, shortcut: '⌘O', onClick: () => void A.current.openDialog() },
          '-',
          { label: 'Save', icon: Save, shortcut: '⌘S', onClick: () => void A.current.save() },
          { label: 'Save As…', shortcut: '⇧⌘S', onClick: () => void A.current.saveAs() },
          '-',
          { label: 'Compile to PDF', shortcut: '⌘R', disabled: compile.busy, onClick: () => void A.current.runCompile() },
          { label: 'Export PDF…', icon: FileDown, onClick: () => void A.current.exportPdf() },
          { label: 'Export LaTeX (.tex)…', onClick: () => void A.current.exportTex() },
          { label: 'Export LaTeX project (.zip)…', onClick: () => void A.current.exportZip() },
          '-',
          { label: 'Close', onClick: () => win.close() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', icon: Undo2, shortcut: '⌘Z', disabled: !past.current.length, onClick: () => A.current.undo() },
          { label: 'Redo', icon: Redo2, shortcut: '⇧⌘Z', disabled: !future.current.length, onClick: () => A.current.redo() },
          '-',
          { label: 'Cut', shortcut: '⌘X', disabled: !sel.length, onClick: () => b().copySelected(true) },
          { label: 'Copy', shortcut: '⌘C', disabled: !sel.length, onClick: () => b().copySelected() },
          { label: 'Paste', shortcut: '⌘V', onClick: () => b().paste() },
          { label: 'Duplicate', shortcut: '⌘D', disabled: !sel.length, onClick: () => b().duplicateSelected() },
          { label: 'Delete', disabled: !sel.length, onClick: () => b().deleteSelected() },
          '-',
          { label: 'Group', shortcut: '⌘G', disabled: sel.length < 2, onClick: () => b().group(true) },
          { label: 'Ungroup', shortcut: '⇧⌘G', disabled: !sel.length, onClick: () => b().group(false) },
          { label: 'Properties…', disabled: sel.length !== 1, onClick: () => b().properties(live.current.sel[0]) },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Visual only', checked: panel === 'none', onClick: () => setPanel('none') },
          { label: 'Visual + LaTeX', checked: panel === 'latex', onClick: () => setPanel('latex') },
          { label: 'Visual + PDF', checked: panel === 'pdf', onClick: () => setPanel('pdf') },
          { label: 'Visual + Console', checked: panel === 'console', onClick: () => setPanel('console') },
          '-',
          { label: 'Exact theme (compiled by LaTeX)', checked: exact, onClick: () => setExact((v) => !v) },
          { label: 'Edit the master slide', checked: masterMode, onClick: () => setMasterMode((v) => !v) },
          '-',
          { label: 'Zoom in', icon: ZoomIn, onClick: () => setZoom((z) => Math.min(3, z * 1.25)) },
          { label: 'Zoom out', icon: ZoomOut, onClick: () => setZoom((z) => Math.max(0.3, z / 1.25)) },
          { label: 'Fit the slide', onClick: () => setZoom(1) },
        ],
      },
      {
        label: 'Insert',
        items: [
          { label: 'Text box', icon: Type, onClick: () => b().addText() },
          { label: 'Bullet list', icon: List, onClick: () => b().addText(itemize(['First point', 'Second point'])) },
          { label: 'Numbered list', icon: ListOrdered, onClick: () => b().addText(itemize(['First point', 'Second point'], true)) },
          { label: 'Equation…', icon: Sigma, onClick: () => b().addEquation() },
          {
            label: 'Block',
            submenu: [
              ['block', 'Block'], ['alertblock', 'Alert block'], ['exampleblock', 'Example block'], ['theorem', 'Theorem'], ['definition', 'Definition'],
              ['proof', 'Proof'],
            ].map(([k, l]) => ({ label: l, onClick: () => b().addBlock(k) })),
          },
          '-',
          { label: 'Picture…', icon: ImageIcon, onClick: () => void b().addPicture() },
          { label: 'Video…', onClick: () => void b().addVideo() },
          { label: 'Table…', icon: Table, onClick: () => b().addTable() },
          '-',
          { label: 'Line', icon: Slash, onClick: () => b().addLine(false) },
          { label: 'Arrow', icon: MoveRight, onClick: () => b().addLine(true) },
          { label: 'Shapes', icon: Shapes, submenu: SHAPE_GROUPS.map(([g, items]) => ({ label: g, submenu: items.map(([k, l]) => ({ label: l, onClick: () => b().addShape(k) })) })) },
        ],
      },
      {
        label: 'Slide',
        items: [
          { label: 'New slide', onClick: () => b().addSlide() },
          { label: 'New slide with layout', submenu: Object.keys(SLIDE_LAYOUTS).map((n) => ({ label: n, onClick: () => b().addSlide(n) })) },
          { label: 'Apply layout', submenu: Object.keys(SLIDE_LAYOUTS).map((n) => ({ label: n, onClick: () => b().applyLayout(n) })) },
          { label: 'Duplicate slide', onClick: () => b().duplicateSlide() },
          { label: 'Delete slide', disabled: masterMode, onClick: () => b().deleteSlide() },
          { label: slide.hidden ? 'Show slide' : 'Hide slide', disabled: masterMode, onClick: () => b().toggleHidden() },
          { label: 'Move slide up', disabled: slideIndex === 0, onClick: () => b().moveSlide(slideIndex, slideIndex - 1) },
          { label: 'Move slide down', disabled: slideIndex >= deck.slides.length - 1, onClick: () => b().moveSlide(slideIndex, slideIndex + 1) },
          '-',
          { label: 'Frame title…', onClick: () => void b().frameTitle() },
          { label: 'Background colour…', onClick: () => b().slideBackground() },
          { label: 'Clear background', onClick: () => b().mutate((d) => ((masterMode ? d.master : d.slides[slideIndex]).bg = '')) },
        ],
      },
      {
        label: 'Design',
        items: [
          { label: 'Theme…', onClick: () => b().themeDialog() },
          {
            label: 'Ready-made themes',
            submenu: THEME_PRESETS.map((k) => ({ label: k.name, onClick: () => b().mutate((d) => applyKit(d, { ...k, logo: d.theme_spec.logo || k.logo })) })),
          },
          {
            label: 'Beamer theme',
            submenu: BEAMER_THEMES.map((t) => ({ label: t, checked: deck.theme === t, onClick: () => b().mutate((d) => (d.theme = t)) })),
          },
          {
            label: 'Colour theme',
            submenu: ['', ...BEAMER_COLOR_THEMES].map((t) => ({ label: t || '(theme default)', checked: deck.color_theme === t, onClick: () => b().mutate((d) => (d.color_theme = t)) })),
          },
          {
            label: 'Turn off my own theme colours',
            disabled: !deck.theme_spec.enabled,
            onClick: () => b().mutate((d) => (d.theme_spec.enabled = false)),
          },
          '-',
          { label: 'Aspect ratio', submenu: ASPECTS.map(([k, l]) => ({ label: l, checked: deck.aspect === k && !deck.page_w_cm, onClick: () => b().mutate((d) => Object.assign(d, { aspect: k, page_w_cm: 0, page_h_cm: 0 })) })) },
          {
            label: 'Slide numbers',
            submenu: [['none', 'None'], ['number', 'Number'], ['of_total', 'n / N']].map(([k, l]) => ({ label: l, checked: deck.page_number === k, onClick: () => b().mutate((d) => (d.page_number = k)) })),
          },
          { label: 'Navigation symbols (prev / next)', checked: deck.nav_symbols, onClick: () => b().mutate((d) => (d.nav_symbols = !d.nav_symbols)) },
          { label: 'Theme decorations', checked: !deck.plain_frames, onClick: () => b().mutate((d) => (d.plain_frames = !d.plain_frames)) },
          '-',
          { label: 'Title, author, page and footer…', onClick: () => b().pageDialog() },
        ],
      },
      {
        label: 'Slideshow',
        items: [
          { label: 'From the beginning', icon: Play, shortcut: 'F5', onClick: () => void A.current.startShow(false, false) },
          { label: 'From this slide', shortcut: '⇧F5', onClick: () => void A.current.startShow(true, false) },
          { label: 'Presenter view', onClick: () => void A.current.startShow(true, false, true) },
          '-',
          { label: 'Present the PDF (compiled by LaTeX)', onClick: () => void A.current.startShow(false, true) },
          { label: 'Present the PDF from this slide', onClick: () => void A.current.startShow(true, true) },
        ],
      },
      {
        label: 'Examples',
        items: examples?.length
          ? examples.map((x) => ({ label: x.title, onClick: () => void A.current.openExample(x) }))
          : [{ label: examples ? 'No examples found' : 'Loading…', disabled: true }],
      },
    ]
    win.setMenus(menus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win, menuKey])
  useEffect(() => () => win.setMenus(null), [win])

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
  }, [loading, present])
  const g = geometry(deck)
  const fitWidth = Math.max(160, Math.min(stage.w - 48, ((stage.h - 48) * g.W) / g.H))
  const canvasWidth = fitWidth * zoom

  const one = sel.length === 1 ? slide.objects[sel[0]] : undefined
  const texts = sel.map((i) => slide.objects[i]).filter((o): o is SlideText => o?.type === 'SlideText')
  const t0 = texts[0]
  const framed = sel.map((i) => slide.objects[i]).filter((o) => o && 'fill' in o) as unknown as { fill: string; border_color: string }[]
  const tex = useMemo(() => (panel === 'latex' ? serializeDeck(deck) : ''), [deck, panel])
  const pdfStale = !!compile.pdf && compile.of !== json

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
          onExit={(shown) => {
            setPresent(null)
            const at = deck.slides.map((x, i) => (x.hidden ? -1 : i)).filter((i) => i >= 0)[shown]
            if (at !== undefined) goto(at)
          }}
        />
      </div>
    )
  }

  return (
    <div className="k-app ks2-app" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="k-toolbar ks2-toolbar">
        <button className="k-icon-btn" title="New (⌘N)" onClick={() => void newDeck()}>
          <FilePlus size={16} />
        </button>
        <button className="k-icon-btn" title="Open (⌘O)" onClick={() => void openDialog()}>
          <FolderOpen size={16} />
        </button>
        <button className="k-icon-btn" title="Save (⌘S)" onClick={() => void save()}>
          <Save size={16} />
        </button>
        <span className="ks2-sep" />
        <button className="k-icon-btn" title="Undo (⌘Z)" disabled={!past.current.length} onClick={undo}>
          <Undo2 size={16} />
        </button>
        <button className="k-icon-btn" title="Redo (⇧⌘Z)" disabled={!future.current.length} onClick={redo}>
          <Redo2 size={16} />
        </button>
        <span className="ks2-sep" />
        <button className="k-icon-btn" title="Text box" onClick={() => addText()}>
          <Type size={16} />
        </button>
        <button className="k-icon-btn" title="Bullet list" onClick={() => addText(itemize(['First point', 'Second point']))}>
          <List size={16} />
        </button>
        <button className="k-icon-btn" title="Equation" onClick={addEquation}>
          <Sigma size={16} />
        </button>
        <button className="k-icon-btn" title="Picture from the drive" onClick={() => void addPicture()}>
          <ImageIcon size={16} />
        </button>
        <button className="k-icon-btn" title="Table" onClick={addTable}>
          <Table size={16} />
        </button>
        <button className="k-icon-btn" title="Rectangle (more in Insert ▸ Shapes)" onClick={() => addShape('rounded_rect')}>
          <Square size={16} />
        </button>
        <button className="k-icon-btn" title="Arrow" onClick={() => addLine(true)}>
          <MoveRight size={16} />
        </button>
        <span className="ks2-sep" />
        {/* The Format toolbar: follows the selection. */}
        <select
          className="k-input ks2-select"
          title="Font size (pt)"
          disabled={!t0}
          value={t0 ? String(t0.font_pt) : ''}
          onChange={(e) => setOnSelected({ font_pt: Number(e.target.value) }, ['SlideText', 'SlideTable'])}
        >
          {!t0 && <option value="">pt</option>}
          {[...new Set([...(t0 ? [t0.font_pt] : []), ...FONT_SIZES])].sort((a, b) => a - b).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button className={`k-icon-btn${t0?.bold ? ' active' : ''}`} title="Bold (⌘B)" disabled={!t0} onClick={() => setOnSelected({ bold: !t0?.bold }, ['SlideText'])}>
          <Bold size={15} />
        </button>
        <button className={`k-icon-btn${t0?.italic ? ' active' : ''}`} title="Italic (⌘I)" disabled={!t0} onClick={() => setOnSelected({ italic: !t0?.italic }, ['SlideText'])}>
          <Italic size={15} />
        </button>
        {(
          [
            ['left', AlignLeft],
            ['center', AlignCenter],
            ['right', AlignRight],
          ] as const
        ).map(([al, Icon]) => (
          <button
            key={al}
            className={`k-icon-btn${t0?.align === al ? ' active' : ''}`}
            title={`Align ${al}`}
            disabled={!t0}
            onClick={() => setOnSelected({ align: al }, ['SlideText', 'SlideTable'])}
          >
            <Icon size={15} />
          </button>
        ))}
        <ColorButton icon={<Type size={13} />} title="Text colour" value={t0?.color ?? ''} disabled={!texts.length && one?.type !== 'SlideLine'} allowNone={false} onChange={(c) => setOnSelected({ color: c || '#000000' })} />
        <ColorButton icon={<PaintBucket size={13} />} title="Fill" value={framed[0]?.fill ?? ''} disabled={!framed.length} onChange={(c) => setOnSelected({ fill: c })} />
        <ColorButton icon={<Square size={13} />} title="Border / outline" value={framed[0]?.border_color ?? ''} disabled={!framed.length} onChange={(c) => setOnSelected({ border_color: c })} />
        <button className="k-icon-btn" title="Bring to front" disabled={sel.length !== 1} onClick={() => zOrder('front')}>
          <ArrowUpToLine size={15} />
        </button>
        <button className="k-icon-btn" title="Send to back" disabled={sel.length !== 1} onClick={() => zOrder('back')}>
          <ArrowDownToLine size={15} />
        </button>
        <button
          className="k-icon-btn"
          title={one?.locked ? 'Unlock: free position' : 'Lock: beamer places it'}
          disabled={!one}
          onClick={() => setOnSelected({ locked: !one?.locked })}
        >
          {one?.locked ? <Lock size={15} /> : <Unlock size={15} />}
        </button>
        <span className="ks2-flex" />
        <button className="k-btn ks2-compile" disabled={compile.busy} title="Typeset with LaTeX (⌘R)" onClick={() => void runCompile()}>
          <FileDown size={15} />
          {compile.busy ? 'Compiling…' : 'PDF'}
        </button>
        <button className="k-btn primary" title="Slideshow (F5)" onClick={() => void startShow(false, false)}>
          <Play size={15} />
          Present
        </button>
      </div>

      {loading ? (
        <div className="k-center k-muted">Opening…</div>
      ) : (
        <div className="ks2-main">
          <Sorter
            deck={deck}
            look={look}
            media={media}
            backdrop={backdrop.pages}
            current={masterMode ? -1 : slideIndex}
            disabled={masterMode}
            onSelect={goto}
            onMove={moveSlide}
            onContextMenu={slideMenu}
            onAdd={() => addSlide()}
          />
          <div className="ks2-stage" ref={stageRef} onPointerDown={(e) => e.target === e.currentTarget && setSel([])}>
            {masterMode && (
              <div className="ks2-banner">
                Master slide: its objects are drawn behind every slide.
                <button className="k-btn small" onClick={() => setMasterMode(false)}>
                  Done
                </button>
              </div>
            )}
            <div className="ks2-stage-inner" style={{ minWidth: canvasWidth + 48 }} onPointerDown={(e) => e.target === e.currentTarget && setSel([])}>
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
                setEditingText={setEditingText}
                onPickPicture={(i) => void swapPicture(i)}
                onProperties={properties}
                onContextMenu={objectMenu}
                onDropFiles={(p, at) => void dropFiles(p, at)}
              />
            </div>
          </div>
          {panel !== 'none' && (
            <div className="ks2-panel">
              <div className="ks2-tabs">
                {(['latex', 'pdf', 'console'] as const).map((t) => (
                  <button key={t} className={`ks2-tab${panel === t ? ' active' : ''}`} onClick={() => setPanel(t)}>
                    {t === 'latex' ? 'LaTeX' : t === 'pdf' ? `PDF${pdfStale ? ' •' : ''}` : `Console${compile.errors.length ? ` (${compile.errors.length})` : ''}`}
                  </button>
                ))}
                <span className="ks2-flex" />
                <button className="k-icon-btn" title="Close the panel" onClick={() => setPanel('none')}>
                  ×
                </button>
              </div>
              {panel === 'latex' && <LatexPanel tex={tex} />}
              {panel === 'pdf' && <PdfPanel pdf={compile.pdf} busy={compile.busy} />}
              {panel === 'console' && <ConsolePanel log={compile.log} errors={compile.errors} missing={compile.missing} />}
            </div>
          )}
        </div>
      )}

      <div className="k-statusbar ks2-status">
        <span>{masterMode ? 'Master slide' : `Slide ${slideIndex + 1} of ${deck.slides.length}${slide.hidden ? ' (hidden)' : ''}`}</span>
        <span>
          {deck.theme}
          {deck.color_theme ? ` · ${deck.color_theme}` : ''}
          {deck.theme_spec.enabled ? ' · own colours' : ''} · {ASPECTS.find(([k]) => k === deck.aspect)?.[1] ?? deck.aspect}
        </span>
        <span title={backdrop.error || undefined}>
          {!exact
            ? 'Theme: drawn approximately'
            : backdrop.state === 'ready'
              ? 'Theme: exact'
              : backdrop.state === 'compiling'
                ? 'Theme: compiling…'
                : backdrop.state === 'failed'
                  ? 'Theme: approximate (LaTeX unavailable)'
                  : 'Theme: …'}
        </span>
        {sel.length > 0 && <span>{sel.length === 1 && one ? OBJECT_LABEL[one.type] : `${sel.length} objects`}</span>}
        {usedPictures(deck).some((p) => !media.has(p)) && <span className="ks2-warn">Some pictures are missing</span>}
        <span className="ks2-flex" />
        <span>{Math.round(zoom * 100)}%</span>
      </div>
      {modal}
    </div>
  )
}

