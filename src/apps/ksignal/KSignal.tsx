// kSignal — a signal-processing lab. Generate, import or record a signal; look at it in time, as a spectrum and as a
// spectrogram; design and apply filters (own IIR / FIR designs, scipy for the advanced ones); listen to the result;
// watch the microphone live. Files are .ksig (the signal spec and all settings). Heavy numerics are in the pure modules
// next to this file (tested in tools/tests/ksignal.test.ts); Plotly is loaded lazily.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AudioLines, BookOpen, FilePlus, FolderOpen, Import, LineChart, Mic, PanelLeft, PanelRight, Play, Save, SlidersHorizontal, Square, Waves, Wind,
} from 'lucide-react'
import { fs, HOME, os, path, type AppProps, type MenuBarMenu } from '@/os'
import type { MenuItem } from '@/os/ui/Menu'
import { PythonKernel } from '@/os/python/kernel'
import { useAppTools } from '@/os/ai/appTools'
import { exampleFolderPath, groupExamples, seedExampleFolder, type ExampleFile } from '@/os/exampleFiles'
import { ksignalTools, type Hooks } from './aiTools'
import {
  describeProcess, processTrace, sourceSamples, summarizeTrace, traceSpectrum, traceWelch, type Trace,
} from './analysis'
import { closeAudio, playSamples, type Playback } from './audio'
import { toCsv } from './csv'
import { estimatePeriod, findTimePeaks, heartRate, signalStats } from './dsp'
import { EXAMPLES, exampleProject, type Example } from './examples'
import { KSIGNAL_EXAMPLES_FOLDER } from './exampleFiles'
import { Check, NumField } from './Fields'
import { describeSpec, designFilter, type FilterDesign, type FilterSpec } from './filters'
import {
  forExport, LIGHT_PALETTE, magnitudeFigure, psdFigure, spectrogramFigure, spectrumFigure, timeFigure, type DesignLine, type Figure, type Palette,
} from './figures'
import FilterTab from './FilterTab'
import Inspector, { type Cursors } from './Inspector'
import LiveTab from './LiveTab'
import PlotlyChart, { figureImage, usePalette } from './PlotlyChart'
import {
  DEFAULT_ANALYSIS, NO_PROCESS, TAB_LABELS, TABS, newProject, parseKsig, serializeKsig, type AnalysisSettings, type DataSource, type KsigProject, type ParsedKsig, type Process, type Source, type Tab,
} from './project'
import { spectrumReadout, timeReadout } from './readouts'
import { buildReport } from './report'
import { IMPORT_EXTENSIONS, readSignalFile, type LoadedSignal } from './signalFiles'
import SourcePanel, { type RecordedSignal } from './SourcePanel'
import { DEFAULT_GENERATOR, type GeneratorSource, COMPONENT_LABELS, COMPONENT_TYPES, defaultComponent, type ComponentType } from './generators'
import { spectrumPeaks, stft, toneMetrics } from './spectrum'
import { fmtHz, fmtNum, fmtTime } from './stats'
import { mixToMono, writeWav, type WavFormat } from './wav'
import { WINDOW_LABELS, WINDOW_NAMES } from './windows'
import './ksignal.css'

const DIR = `${HOME}/Documents/kSignal`
/** The longest signal imported (about 95 s at 44.1 kHz). */
const MAX_IMPORT = 4_194_304
const PREFS_KEY = 'kherveos.ksignal.prefs'
const RECENT_KEY = 'kherveos.ksignal.recent'

interface Prefs { left: boolean; right: boolean; clickTarget: 'a' | 'b' }
const DEFAULT_PREFS: Prefs = { left: true, right: true, clickTarget: 'a' }

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    return { ...DEFAULT_PREFS, ...Object.fromEntries(Object.entries(raw).filter(([k, v]) => k in DEFAULT_PREFS && typeof v === typeof DEFAULT_PREFS[k as keyof Prefs])) }
  } catch { return DEFAULT_PREFS }
}
function savePrefs(p: Prefs) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* storage blocked */ } }
function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, 8) : []
  } catch { return [] }
}
function saveRecent(list: string[]) { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8))) } catch { /* storage blocked */ } }

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'signal'

function startGenerator(): GeneratorSource {
  return {
    ...DEFAULT_GENERATOR,
    components: [{ ...defaultComponent('sine'), freq: 440, amp: 1 }, { ...defaultComponent('sine'), freq: 1000, amp: 0.3 }],
    noise: { sigma: 0.02, seed: 1, color: 'white' },
  }
}

const TAB_ICONS: Record<Tab, React.ReactNode> = {
  time: <Activity size={14} />, spectrum: <LineChart size={14} />, spectrogram: <Waves size={14} />, filter: <SlidersHorizontal size={14} />, live: <Mic size={14} />,
}

const SHORTCUTS = `File
  ⌘N  New        ⌘O  Open…        ⌘S  Save        ⇧⌘S  Save as…
  ⌘I  Import a signal (WAV, audio, CSV)        ⌘E  Export the report

Views
  ⌘1  Time      ⌘2  Spectrum      ⌘3  Spectrogram      ⌘4  Filter      ⌘5  Live
  ⌘0  Reset the time zoom        Esc  stop playback

Plots
  click  place cursor A          Shift-click (or Alt-click)  place cursor B
  A / B  choose which cursor the next click moves
  drag   zoom                    double-click  reset the zoom
  Space  play / stop the signal (processed if there is one)`

const HELP = `kSignal is a signal-processing lab.

1. Choose a signal in the left panel: a generator (sines, chirps, noise, ECG, AM/FM…), a file (WAV, audio, CSV) or the microphone.
2. Look at it: Time shows the waveform, Spectrum the amplitude and phase of its frequencies (pick a window, FFT size, Welch averaging), Spectrogram how the frequencies change over time.
3. In the Filter tab design a filter, see its Bode plot, poles and zeros and step response, apply it, and listen to original and processed. “Advanced (scipy)” runs Remez, elliptic and Bessel designs (and a cross-check) in Python.
4. Live shows the microphone as an oscilloscope and a spectrum analyser.
5. The right panel gives the cursor readouts, the peak table (frequency, amplitude, phase) and the metrics (RMS, THD, SNR, SINAD, ENOB).

File > Open Example opens ready-made signals (all synthetic). Projects are saved as .ksig files with the signal spec, not its samples (an imported signal is embedded unless it is long).`

type Live = {
  project: KsigProject
  imported: Float64Array | null
  rev: number
  savedRev: number
  filePath: string | null
}

export default function KSignal({ win, args }: AppProps) {
  const pal = usePalette()
  // opened with { example: 'aliasing' } (and optionally { tab: 'spectrum' }) it starts on a built-in example
  const [project, setProjectState] = useState<KsigProject>(() => {
    const ex = typeof args.example === 'string' ? EXAMPLES.find((e) => e.id === args.example) : undefined
    const p = ex ? exampleProject(ex) : { ...newProject(startGenerator()), name: 'Untitled' }
    return TABS.includes(args.tab as Tab) ? { ...p, tab: args.tab as Tab } : p
  })
  const [imported, setImported] = useState<Float64Array | null>(null)
  const [channelData, setChannelData] = useState<Float64Array[] | null>(null)
  const [lastGenerator, setLastGenerator] = useState<GeneratorSource>(startGenerator)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [rev, setRev] = useState(0)
  const [savedRev, setSavedRev] = useState(0)
  const [view, setView] = useState<[number, number] | null>(null)
  const [timeCursors, setTimeCursors] = useState<Cursors>({ a: null, b: null })
  const [showOriginal, setShowOriginal] = useState(true)
  const [showProcessed, setShowProcessed] = useState(true)
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const [width, setWidth] = useState(1200)
  const [playing, setPlaying] = useState<'original' | 'processed' | null>(null)
  const [exampleFiles, setExampleFiles] = useState<ExampleFile[]>([])
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [status, setStatus] = useState('')

  const root = useRef<HTMLDivElement>(null)
  const playback = useRef<Playback | null>(null)
  const kernel = useRef<PythonKernel | null>(null)
  const live = useRef<Live>({ project, imported, rev, savedRev, filePath })
  live.current = { project, imported, rev, savedRev, filePath }
  const dirty = rev !== savedRev
  const setPrefs = (patch: Partial<Prefs>) => setPrefsState((p) => { const n = { ...p, ...patch }; savePrefs(n); return n })

  // ------------------------------------------------------------ document

  const setProject = useCallback((fn: (p: KsigProject) => KsigProject, markDirty = true) => {
    setProjectState(fn)
    if (markDirty) setRev((r) => r + 1)
  }, [])
  const setAnalysis = (patch: Partial<AnalysisSettings>) => setProject((p) => ({ ...p, analysis: { ...p.analysis, ...patch } }))
  const setFilter = (patch: Partial<FilterSpec>) => setProject((p) => ({ ...p, filter: { ...p.filter, ...patch } }))
  const setTab = (tab: Tab) => setProject((p) => ({ ...p, tab }), false)

  const stopPlayback = useCallback(() => { playback.current?.stop(); playback.current = null; setPlaying(null) }, [])

  const loadProject = useCallback((parsed: ParsedKsig, p: string | null) => {
    stopPlayback()
    setProjectState(parsed.project)
    setImported(parsed.samples)
    setChannelData(null)
    if (parsed.project.source.kind === 'generator') setLastGenerator(parsed.project.source)
    setFilePath(p)
    setRev(0)
    setSavedRev(0)
    setView(null)
    setTimeCursors({ a: null, b: null })
    win.setDocumentPath(p)
    setStatus(parsed.warnings[0] ?? '')
  }, [stopPlayback, win])

  const confirmDiscard = async (): Promise<boolean> => {
    if (live.current.rev === live.current.savedRev) return true
    return os.dialog.confirm('This signal has changes that are not saved. Continue and lose them?', { title: 'Unsaved changes', okLabel: 'Continue', danger: true })
  }

  const remember = (p: string) => {
    setRecent((r) => { const n = [p, ...r.filter((x) => x !== p)].slice(0, 8); saveRecent(n); return n })
  }

  /** Puts a freshly read signal in the window as the source. */
  const applyLoaded = useCallback((sig: LoadedSignal, pathRef: string | null) => {
    stopPlayback()
    let warning = sig.warnings[0] ?? ''
    if (sig.channels[0].length > MAX_IMPORT) {
      warning = `Only the first ${fmtTime(MAX_IMPORT / sig.fs)} of the ${fmtTime(sig.channels[0].length / sig.fs)} file were imported (${MAX_IMPORT.toLocaleString('en')} samples).`
      sig = { ...sig, channels: sig.channels.map((c) => c.subarray(0, MAX_IMPORT)) }
    }
    const samples = sig.channels[0]
    const source: DataSource = {
      kind: 'data', name: sig.name, fs: sig.fs, count: samples.length, origin: sig.origin,
      ...(pathRef ? { path: pathRef } : {}), ...(sig.channels.length > 1 ? { channel: 0 as const } : {}),
    }
    setChannelData(sig.channels.length > 1 ? sig.channels : null)
    setImported(samples)
    setView(null)
    setTimeCursors({ a: null, b: null })
    setProject((p) => ({
      ...p,
      name: p.name === 'Untitled' || p.name === 'Recording' ? sig.name : p.name,
      description: undefined, synthetic: undefined,
      source, process: NO_PROCESS,
      filter: p.filter.f1 >= sig.fs / 2 || p.filter.f2 >= sig.fs / 2 ? { ...p.filter, f1: Math.round(sig.fs / 8), f2: Math.round(sig.fs / 4) } : p.filter,
      analysis: { ...p.analysis, start: 0, analyse: 'original' },
    }))
    setStatus(warning)
  }, [setProject, stopPlayback])

  const askRate = async (suggested: number): Promise<number | null> => {
    const v = await os.dialog.prompt('This file has no time column. What is the sample rate in Hz?', { title: 'Sample rate', defaultValue: String(suggested), okLabel: 'Import' })
    if (v === null) return null
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : suggested
  }

  const importPath = useCallback(async (p: string) => {
    try {
      const sig = await readSignalFile(p, askRate)
      applyLoaded(sig, p)
      remember(p)
    } catch (e) {
      if (msgOf(e) !== 'cancelled') await os.dialog.alert(`Could not import “${path.basename(p)}”: ${msgOf(e)}`, { title: 'Import' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyLoaded])

  const importDialog = async () => {
    const p = await os.dialog.openFile({ title: 'Import a signal', extensions: IMPORT_EXTENSIONS.filter((e) => e !== '.ksig'), startDir: fs.isDir(DIR) ? DIR : undefined })
    if (p) await importPath(p)
  }

  const openText = useCallback(async (text: string, p: string | null) => {
    const parsed = parseKsig(text)
    loadProject(parsed, p)
    const src = parsed.project.source
    if (src.kind === 'data' && !parsed.samples) {
      if (src.path && fs.exists(src.path)) {
        try {
          const sig = await readSignalFile(src.path, async () => src.fs)
          setChannelData(sig.channels.length > 1 ? sig.channels : null)
          const ch = src.channel === 'mix' ? mixToMono(sig.channels) : sig.channels[Math.min(sig.channels.length - 1, typeof src.channel === 'number' ? src.channel : 0)]
          setImported(ch)
        } catch (e) { void os.dialog.alert(`The signal file could not be read again: ${msgOf(e)}`, { title: 'kSignal' }) }
      } else void os.dialog.alert(src.path ? `The signal file “${src.path}” is missing. Import it again with File > Import.` : 'This project has no samples. Import the signal again with File > Import.', { title: 'kSignal' })
    }
  }, [loadProject])

  const openPath = useCallback(async (p: string) => {
    try {
      if (/\.ksig$/i.test(p)) {
        await openText(await fs.readText(p), p)
        remember(p)
      } else await importPath(p)
    } catch (e) {
      await os.dialog.alert(`Could not open “${path.basename(p)}”: ${msgOf(e)}`, { title: 'Open' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openText, importPath])

  const openDialog = async () => {
    if (!(await confirmDiscard())) return
    const p = await os.dialog.openFile({ title: 'Open', extensions: IMPORT_EXTENSIONS, startDir: fs.isDir(DIR) ? DIR : undefined })
    if (p) await openPath(p)
  }

  useEffect(() => {
    let alive = true
    void seedExampleFolder({ app: 'ksignal', folderName: KSIGNAL_EXAMPLES_FOLDER, fs }).then((files) => alive && setExampleFiles(files))
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (typeof args.path === 'string' && fs.exists(args.path)) void openPath(args.path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.path])

  const newDocument = async () => {
    if (!(await confirmDiscard())) return
    loadProject({ project: { ...newProject(startGenerator()), name: 'Untitled' }, samples: null, warnings: [] }, null)
  }

  const openBuiltIn = (ex: Example, ask = true) => {
    void (async () => {
      if (ask && !(await confirmDiscard())) return
      loadProject({ project: exampleProject(ex), samples: null, warnings: [] }, null)
    })()
  }

  const openExampleFile = (f: ExampleFile) => void confirmDiscard().then((ok) => { if (ok) void openPath(f.path) })

  const writeProject = async (p: string, withName?: string): Promise<string> => {
    const l = live.current
    await fs.mkdir(path.dirname(p), { recursive: true })
    const proj = withName ? { ...l.project, name: withName } : l.project
    await fs.writeText(p, serializeKsig(proj, l.project.source.kind === 'data' ? l.imported : null))
    if (withName) setProjectState((q) => ({ ...q, name: withName }))
    setFilePath(p)
    setSavedRev(l.rev)
    win.setDocumentPath(p)
    remember(p)
    return p
  }

  const saveAs = async (): Promise<boolean> => {
    if (!fs.isDir(DIR)) await fs.mkdir(DIR, { recursive: true })
    const p = await os.dialog.saveFile({ defaultName: `${safeName(live.current.project.name)}.ksig`, extensions: ['.ksig'], startDir: DIR })
    if (!p) return false
    const target = /\.ksig$/i.test(p) ? p : `${p}.ksig`
    await writeProject(target, path.basename(target).replace(/\.ksig$/i, ''))
    os.notify({ title: 'Project saved', body: path.pretty(target) })
    return true
  }

  const save = async (): Promise<boolean> => {
    const p = live.current.filePath
    if (!p) return saveAs()
    await writeProject(p)
    os.notify({ title: 'Project saved', body: path.pretty(p) })
    return true
  }

  // ------------------------------------------------------------ the signal and its processing

  const base = useMemo<{ trace: Trace | null; error: string | null }>(() => {
    try { return { trace: sourceSamples(project.source, imported), error: null } } catch (e) { return { trace: null, error: msgOf(e) } }
  }, [project.source, imported])
  const fsNow = base.trace?.fs ?? project.source.fs

  const designed = useMemo<{ design: FilterDesign | null; error: string | null }>(() => {
    try { return { design: designFilter(project.filter, fsNow), error: null } } catch (e) { return { design: null, error: msgOf(e) } }
  }, [project.filter, fsNow])
  const compareDesign = useMemo<FilterDesign | null>(() => {
    if (!project.compare) return null
    try { return designFilter(project.compare, fsNow) } catch { return null }
  }, [project.compare, fsNow])

  const proc = useMemo<{ trace: Trace | null; error: string | null }>(() => {
    if (!base.trace || project.process.type === 'none') return { trace: null, error: null }
    try { return { trace: processTrace(base.trace, project.process, designed.design), error: null } } catch (e) { return { trace: null, error: msgOf(e) } }
  }, [base.trace, project.process, designed.design])

  const analysis = project.analysis
  const analysed: Trace | null = analysis.analyse === 'processed' && proc.trace ? proc.trace : base.trace
  const other: Trace | null = proc.trace ? (analysed === proc.trace ? base.trace : proc.trace) : null
  const otherName = other === proc.trace ? 'processed' : 'original'
  const analysedName = analysed === proc.trace && proc.trace ? 'processed' : 'original'

  const spectrum = useMemo(() => {
    if (!analysed || analysed.x.length < 8) return null
    try { return traceSpectrum(analysed, analysis) } catch { return null }
  }, [analysed, analysis])
  const otherSpectrum = useMemo(() => {
    if (!other || other.x.length < 8) return null
    try { return traceSpectrum(other, analysis) } catch { return null }
  }, [other, analysis])
  const compareSpectra = useMemo(() => {
    if (!analysed || project.tab !== 'spectrum' || analysis.mode !== 'fft' || !analysis.compare.length) return []
    return analysis.compare.map((window) => ({ window, spectrum: traceSpectrum(analysed, analysis, window) }))
  }, [analysed, analysis, project.tab])
  const psd = useMemo(() => {
    if (!analysed || project.tab !== 'spectrum' || analysis.mode !== 'welch' || analysed.x.length < 16) return null
    try { return { main: traceWelch(analysed, analysis), other: other && other.x.length >= 16 ? traceWelch(other, analysis) : null } } catch { return null }
  }, [analysed, other, analysis, project.tab])
  const peaks = useMemo(() => (spectrum ? spectrumPeaks(spectrum, { rangeDb: analysis.peakRangeDb, maxPeaks: analysis.maxPeaks }) : []), [spectrum, analysis.peakRangeDb, analysis.maxPeaks])
  const tone = useMemo(() => (spectrum ? toneMetrics(spectrum, { fundamental: analysis.fundamental || undefined, beta: analysis.beta }) : null), [spectrum, analysis.fundamental, analysis.beta])
  const stats = useMemo(() => (analysed ? signalStats(analysed.x) : null), [analysed])
  const timePeaks = useMemo(() => (analysed && analysis.timePeaks.enabled ? findTimePeaks(analysed.x, analysed.fs, analysis.timePeaks.height, analysis.timePeaks.minDistance) : null), [analysed, analysis.timePeaks])
  const hr = useMemo(() => (timePeaks ? heartRate(timePeaks) : null), [timePeaks])
  const period = useMemo(() => {
    if (!analysed || analysed.x.length < 64) return 0
    try { return estimatePeriod(analysed.x.subarray(0, 32768), analysed.fs, 20, Math.min(4000, analysed.fs / 4)) } catch { return 0 }
  }, [analysed])
  const stftData = useMemo(() => {
    if (!analysed || project.tab !== 'spectrogram') return null
    try { return stft(analysed.x, analysed.fs, { nperseg: Math.min(analysis.stftSize, analysed.x.length), overlap: analysis.overlap, window: analysis.window, beta: analysis.beta }) } catch { return null }
  }, [analysed, project.tab, analysis.stftSize, analysis.overlap, analysis.window, analysis.beta])

  const cursors: Cursors = project.tab === 'time' ? timeCursors : project.cursors
  const setCursors = (c: Cursors) => (project.tab === 'time' ? setTimeCursors(c) : setProject((p) => ({ ...p, cursors: c }), false))
  const readouts = useMemo(() => {
    if (project.tab === 'time' && base.trace) return timeReadout({ original: base.trace.x, fs: base.trace.fs, processed: proc.trace }, timeCursors)
    if (project.tab === 'spectrum' && spectrum) return spectrumReadout(spectrum, project.cursors)
    return []
  }, [project.tab, base.trace, proc.trace, timeCursors, spectrum, project.cursors])

  // ------------------------------------------------------------ figures

  const viewNow = view && base.trace && view[0] < base.trace.x.length / base.trace.fs ? view : null
  const timeFig = useMemo(() => (base.trace ? timeFigure({
    x: base.trace.x, fs: base.trace.fs, processed: proc.trace, view: viewNow, cursors: timeCursors, peaks: timePeaks ?? undefined, showOriginal, showProcessed,
  }, pal) : null), [base.trace, proc.trace, viewNow, timeCursors, timePeaks, showOriginal, showProcessed, pal])

  const makeSpectrumFigure = (colors: Palette): Figure | null => {
    if (analysis.mode === 'welch') {
      if (!psd) return null
      return psdFigure({ psd: psd.main, settings: analysis, cursors: project.cursors, name: analysedName, extra: psd.other ? { psd: psd.other, name: otherName } : null }, colors)
    }
    if (!spectrum) return null
    return spectrumFigure({
      primary: spectrum, primaryName: analysedName, other: otherSpectrum ? { spectrum: otherSpectrum, name: otherName } : null,
      compare: compareSpectra, peaks, settings: analysis, cursors: project.cursors,
    }, colors)
  }
  const spectrumFig = useMemo(() => (project.tab === 'spectrum' ? makeSpectrumFigure(pal) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.tab, spectrum, otherSpectrum, compareSpectra, peaks, analysis, project.cursors, psd, pal, analysedName, otherName])
  const spectrogramFig = useMemo(() => (stftData ? spectrogramFigure(stftData, analysis, pal) : null), [stftData, analysis, pal])

  const filterLines = (): DesignLine[] => {
    const out: DesignLine[] = []
    if (designed.design) out.push({ design: designed.design, name: designed.design.label, color: LIGHT_PALETTE.accent })
    if (compareDesign) out.push({ design: compareDesign, name: compareDesign.label, color: LIGHT_PALETTE.link })
    return out
  }

  const exportFigure = (): Figure | null => {
    switch (project.tab) {
      case 'time': return base.trace ? timeFigure({ x: base.trace.x, fs: base.trace.fs, processed: proc.trace, view: viewNow, cursors: timeCursors, peaks: timePeaks ?? undefined, showOriginal, showProcessed }, LIGHT_PALETTE) : null
      case 'spectrum': return makeSpectrumFigure(LIGHT_PALETTE)
      case 'spectrogram': return stftData ? spectrogramFigure(stftData, analysis, LIGHT_PALETTE) : null
      case 'filter': { const l = filterLines(); return l.length ? magnitudeFigure(l, LIGHT_PALETTE) : null }
      default: return null
    }
  }

  // ------------------------------------------------------------ window: title, close guard, size

  useEffect(() => { win.setTitle(`kSignal — ${project.name}${dirty ? ' •' : ''}`) }, [win, project.name, dirty])

  useEffect(() => {
    win.setCloseGuard(async () => {
      if (live.current.rev === live.current.savedRev) return true
      const choice = await os.dialog.choose(
        `Save the changes to “${live.current.project.name}” before closing?`,
        [{ label: 'Cancel', value: 'cancel' }, { label: "Don't save", value: 'discard', danger: true }, { label: 'Save', value: 'save', primary: true }],
        { title: 'Unsaved changes' },
      )
      if (choice === 'save') { try { return await save() } catch { return false } }
      return choice === 'discard'
    })
    return () => win.setCloseGuard(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win])

  useEffect(() => () => {
    playback.current?.stop()
    kernel.current?.dispose()
    closeAudio()
  }, [])

  useEffect(() => {
    const el = root.current
    if (!el) return
    let first = true
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      setWidth(w)
      if (first && w > 0) { first = false; if (w < 1000) setPrefsState((p) => ({ ...p, right: false })); if (w < 760) setPrefsState((p) => ({ ...p, left: false })) }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const size = width < 760 ? 's' : width < 1000 ? 'm' : 'l'

  // ------------------------------------------------------------ actions

  const play = (which: 'original' | 'processed') => {
    stopPlayback()
    const t = which === 'processed' ? proc.trace : base.trace
    if (!t || t.x.length === 0) return
    try {
      const pb = playSamples(t.x, t.fs)
      playback.current = pb
      setPlaying(which)
      void pb.done.then(() => { if (playback.current === pb) { playback.current = null; setPlaying(null) } })
    } catch (e) { void os.dialog.alert(msgOf(e), { title: 'Playback' }) }
  }
  const togglePlay = () => { if (playback.current) stopPlayback(); else play(proc.trace ? 'processed' : 'original') }

  const runPython = async (code: string, onStatus: (t: string) => void): Promise<string> => {
    const k = (kernel.current ??= new PythonKernel('ksignal'))
    let out = ''
    onStatus(k.status === 'off' ? 'Starting Python (the first time it downloads about 10 MB)…' : 'Running…')
    const r = await k.runCell(code, { onStdout: (t) => { out += t }, onStatus })
    if (!r.ok) throw new Error(r.error ? `${r.error.type}: ${r.error.message}` : 'The Python code failed.')
    return out
  }

  const applyFilter = () => {
    if (!designed.design) return
    setProject((p) => ({ ...p, process: { type: 'filter' }, analysis: { ...p.analysis, analyse: p.analysis.analyse } }))
    setStatus(`Applied ${designed.design.label}${designed.design.spec.zeroPhase ? ' (zero phase)' : ''}`)
  }
  const setProcess = (process: Process) => setProject((p) => ({ ...p, process, analysis: process.type === 'none' ? { ...p.analysis, analyse: 'original' } : p.analysis }))

  const askNumber = async (message: string, def: number, title: string): Promise<number | null> => {
    const v = await os.dialog.prompt(message, { title, defaultValue: String(def), okLabel: 'Apply' })
    if (v === null) return null
    const n = Math.round(Number(v))
    return Number.isFinite(n) && n >= 1 ? n : null
  }
  const processSmooth = async (method: 'ma' | 'median' | 'sg') => {
    const cur = live.current.project.process
    const w0 = cur.type === 'smooth' ? cur.width : 11
    const width2 = await askNumber(method === 'sg' ? 'Window length in samples (odd, larger than the order):' : 'Window length in samples:', w0, method === 'ma' ? 'Moving average' : method === 'median' ? 'Median filter' : 'Savitzky–Golay')
    if (width2 === null) return
    let order = 3
    if (method === 'sg') {
      const o = await askNumber('Polynomial order:', cur.type === 'smooth' ? cur.order : 3, 'Savitzky–Golay')
      if (o === null) return
      order = o
    }
    setProcess({ type: 'smooth', method, width: width2, order })
  }
  const processDecimate = async () => {
    const q = await askNumber('Keep every n-th sample (after an anti-alias low-pass):', 2, 'Decimate')
    if (q !== null) setProcess({ type: 'decimate', factor: Math.min(64, Math.max(2, q)) })
  }

  const channelChange = (c: number | 'mix') => {
    if (!channelData) return
    setImported(c === 'mix' ? mixToMono(channelData) : channelData[Math.min(channelData.length - 1, c)])
    setProject((p) => (p.source.kind === 'data' ? { ...p, source: { ...p.source, channel: c } } : p))
  }

  const recorded = (r: RecordedSignal) => {
    const name = `Recording ${new Date().toISOString().slice(11, 19).replace(/:/g, '.')}`
    stopPlayback()
    setChannelData(null)
    setImported(r.x)
    setView(null)
    setTimeCursors({ a: null, b: null })
    setProject((p) => ({
      ...p, name: p.name === 'Untitled' ? 'Recording' : p.name, description: undefined, synthetic: undefined, process: NO_PROCESS,
      source: { kind: 'data', name, fs: r.fs, count: r.x.length, origin: 'recording' },
      filter: p.filter.f1 >= r.fs / 2 ? { ...p.filter, f1: Math.round(r.fs / 8), f2: Math.round(r.fs / 4) } : p.filter,
      analysis: { ...p.analysis, start: 0, analyse: 'original' },
    }))
  }

  const onSource = (s: Source) => {
    if (s.kind === 'generator') setLastGenerator(s)
    setProject((p) => {
      const same = p.source.kind === s.kind
      return { ...p, source: s, synthetic: s.kind === 'generator' && same ? p.synthetic : s.kind === 'generator' ? p.synthetic : undefined, process: same ? p.process : NO_PROCESS }
    })
    if (s.kind === 'generator') { setImported(null); setChannelData(null) }
  }

  // ---- exports

  const saveBytes = async (defaultName: string, ext: string, data: string | Uint8Array, what: string) => {
    if (!fs.isDir(DIR)) await fs.mkdir(DIR, { recursive: true })
    const p = await os.dialog.saveFile({ defaultName, extensions: [ext], startDir: DIR })
    if (!p) return
    if (typeof data === 'string') await fs.writeText(p, data)
    else await fs.writeBytes(p, data)
    os.notify({ title: `${what} saved`, body: path.pretty(p) })
  }
  const guarded = (fn: () => Promise<void>, title: string) => void fn().catch((e) => os.dialog.alert(msgOf(e), { title }))

  const exportWav = (which: 'original' | 'processed') => guarded(async () => {
    const t = which === 'processed' ? proc.trace : base.trace
    if (!t) throw new Error(which === 'processed' ? 'There is no processed signal: apply a filter or smoothing first.' : 'There is no signal.')
    const choice = await os.dialog.choose('Sample format of the WAV file:', [
      { label: 'Cancel', value: 'cancel' }, { label: '16-bit', value: 'pcm16' }, { label: '24-bit', value: 'pcm24' }, { label: '32-bit float', value: 'float32', primary: true },
    ], { title: 'Export WAV' })
    if (!choice || choice === 'cancel') return
    if (t.fs < 1 || !Number.isFinite(t.fs)) throw new Error('The sample rate is not valid for a WAV file.')
    await saveBytes(`${safeName(project.name)}-${which}.wav`, '.wav', writeWav([t.x], t.fs, choice as WavFormat), 'WAV file')
  }, 'Export')

  const exportCsv = () => guarded(async () => {
    if (!base.trace) throw new Error('There is no signal.')
    const cols = [{ name: 'original', x: base.trace.x as ArrayLike<number> }]
    if (proc.trace && proc.trace.fs === base.trace.fs) cols.push({ name: 'processed', x: proc.trace.x })
    else if (proc.trace) {
      await saveBytes(`${safeName(project.name)}-processed.csv`, '.csv', toCsv([{ name: 'processed', x: proc.trace.x }], proc.trace.fs), 'CSV file')
    }
    await saveBytes(`${safeName(project.name)}.csv`, '.csv', toCsv(cols, base.trace.fs), 'CSV file')
  }, 'Export')

  const exportImage = (format: 'png' | 'svg') => guarded(async () => {
    const fig = exportFigure()
    if (!fig) throw new Error('There is nothing to export in this view.')
    const img = await figureImage(forExport(fig, LIGHT_PALETTE), format)
    await saveBytes(`${safeName(project.name)}-${project.tab}.${format}`, `.${format}`, img, 'Plot')
  }, 'Export')

  const exportReport = () => guarded(async () => {
    if (!analysed) throw new Error('There is no signal to report on.')
    const summary = summarizeTrace(project.name, analysed, analysis)
    await saveBytes(`${safeName(project.name)}-report.md`, '.md', buildReport(project, summary), 'Report')
  }, 'Report')

  const copyPeaks = () => {
    const lines = ['#\tfrequency_Hz\tamplitude\tdB\tphase_deg', ...peaks.map((p, i) => `${i + 1}\t${p.freq}\t${p.amp}\t${p.ampDb}\t${((p.phase ?? 0) * 180) / Math.PI}`)]
    void navigator.clipboard?.writeText(lines.join('\n')).catch(() => {})
    os.notify({ title: 'Peak table copied', body: `${peaks.length} peaks` })
  }

  const onPlotClick = (x: number, shift: boolean) => {
    const target = shift ? (prefs.clickTarget === 'a' ? 'b' : 'a') : prefs.clickTarget
    setCursors({ ...cursors, [target]: x })
  }
  const onTimeRange = (r: [number, number] | null) => setView(r)

  // ------------------------------------------------------------ menus

  useEffect(() => {
    const exampleGroups = groupExamples(exampleFiles)
    const exampleItems: MenuItem[] = exampleFiles.length
      ? exampleGroups.map((g) => ({ label: g.group || 'Other', submenu: g.files.map((f) => ({ label: f.title, onClick: () => openExampleFile(f) })) }))
      : Array.from(new Set(EXAMPLES.map((e) => e.group))).map((g) => ({ label: g, submenu: EXAMPLES.filter((e) => e.group === g).map((e) => ({ label: e.title, onClick: () => openBuiltIn(e) })) }))
    const recentItems: MenuItem[] = recent.filter((p) => fs.exists(p)).map((p) => ({ label: path.basename(p), onClick: () => void confirmDiscard().then((ok) => { if (ok) void openPath(p) }) }))
    const hasProc = !!proc.trace
    const tabItem = (t: Tab, shortcut: string): MenuItem => ({ label: TAB_LABELS[t], shortcut, checked: project.tab === t, onClick: () => setTab(t) })
    const menus: MenuBarMenu[] = [
      {
        label: 'File',
        items: [
          { label: 'New', icon: FilePlus, shortcut: '⌘N', onClick: () => void newDocument() },
          { label: 'Open…', icon: FolderOpen, shortcut: '⌘O', onClick: () => void openDialog() },
          { label: 'Open Example', submenu: exampleItems },
          { label: 'Open Examples Folder', onClick: () => void seedExampleFolder({ app: 'ksignal', folderName: KSIGNAL_EXAMPLES_FOLDER, fs }).then((files) => { setExampleFiles(files); os.open('files', { path: exampleFolderPath(KSIGNAL_EXAMPLES_FOLDER) }) }) },
          { label: 'Open Recent', disabled: recentItems.length === 0, submenu: recentItems },
          '-',
          { label: 'Save', icon: Save, shortcut: '⌘S', onClick: () => guarded(async () => { await save() }, 'Save') },
          { label: 'Save As…', shortcut: '⇧⌘S', onClick: () => guarded(async () => { await saveAs() }, 'Save') },
          '-',
          { label: 'Import Signal…', icon: Import, shortcut: '⌘I', onClick: () => void importDialog() },
          {
            label: 'Export', submenu: [
              { label: 'Processed Signal as WAV…', disabled: !hasProc, onClick: () => exportWav('processed') },
              { label: 'Original Signal as WAV…', onClick: () => exportWav('original') },
              { label: 'Signals as CSV…', onClick: exportCsv },
              '-',
              { label: 'Plot as PNG…', disabled: project.tab === 'live', onClick: () => exportImage('png') },
              { label: 'Plot as SVG…', disabled: project.tab === 'live', onClick: () => exportImage('svg') },
              '-',
              { label: 'Report (Markdown)…', shortcut: '⌘E', onClick: exportReport },
            ],
          },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Copy Peak Table', shortcut: '⌘C', disabled: peaks.length === 0, onClick: copyPeaks },
          { label: 'Clear Cursors', onClick: () => setCursors({ a: null, b: null }) },
          { label: 'Reset Time Zoom', shortcut: '⌘0', disabled: !view, onClick: () => setView(null) },
          '-',
          { label: 'Reset Analysis Settings', onClick: () => setAnalysis({ ...DEFAULT_ANALYSIS, timePeaks: { ...DEFAULT_ANALYSIS.timePeaks } }) },
        ],
      },
      {
        label: 'Signal',
        items: [
          { label: 'Add Component', disabled: project.source.kind !== 'generator', submenu: COMPONENT_TYPES.map((t: ComponentType) => ({ label: COMPONENT_LABELS[t], onClick: () => { const s = live.current.project.source; if (s.kind === 'generator') onSource({ ...s, components: [...s.components, defaultComponent(t)] }) } })) },
          '-',
          {
            label: 'Process', icon: Wind, submenu: [
              { label: 'None', checked: project.process.type === 'none', onClick: () => setProcess(NO_PROCESS) },
              { label: 'Apply the Filter', checked: project.process.type === 'filter', disabled: !designed.design, onClick: applyFilter },
              { label: 'Moving Average…', checked: project.process.type === 'smooth' && project.process.method === 'ma', onClick: () => void processSmooth('ma') },
              { label: 'Median Filter…', checked: project.process.type === 'smooth' && project.process.method === 'median', onClick: () => void processSmooth('median') },
              { label: 'Savitzky–Golay…', checked: project.process.type === 'smooth' && project.process.method === 'sg', onClick: () => void processSmooth('sg') },
              { label: 'Hilbert Envelope', checked: project.process.type === 'envelope', onClick: () => setProcess({ type: 'envelope' }) },
              { label: 'Decimate…', checked: project.process.type === 'decimate', onClick: () => void processDecimate() },
            ],
          },
          '-',
          { label: playing ? 'Stop Playback' : 'Play', icon: playing ? Square : Play, shortcut: 'Space', disabled: !base.trace, onClick: togglePlay },
          { label: 'Play Original', disabled: !base.trace, onClick: () => play('original') },
          { label: 'Play Processed', disabled: !hasProc, onClick: () => play('processed') },
        ],
      },
      {
        label: 'Analysis',
        items: [
          tabItem('time', '⌘1'), tabItem('spectrum', '⌘2'), tabItem('spectrogram', '⌘3'), tabItem('filter', '⌘4'), tabItem('live', '⌘5'),
          '-',
          { label: 'Window', submenu: WINDOW_NAMES.map((w) => ({ label: WINDOW_LABELS[w], checked: analysis.window === w, onClick: () => setAnalysis({ window: w }) })) },
          { label: 'Welch Averaging', checked: analysis.mode === 'welch', onClick: () => setAnalysis(analysis.mode === 'welch' ? { mode: 'fft', scale: 'db' } : { mode: 'welch', scale: 'psd' }) },
          { label: 'Logarithmic Frequency Axis', checked: analysis.logFreq, onClick: () => setAnalysis({ logFreq: !analysis.logFreq }) },
          { label: 'Detect Peaks in Time', checked: analysis.timePeaks.enabled, onClick: () => setAnalysis({ timePeaks: { ...analysis.timePeaks, enabled: !analysis.timePeaks.enabled } }) },
          { label: 'Analyse the Processed Trace', checked: analysis.analyse === 'processed', disabled: !hasProc, onClick: () => setAnalysis({ analyse: analysis.analyse === 'processed' ? 'original' : 'processed' }) },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Source Panel', icon: PanelLeft, checked: prefs.left, onClick: () => setPrefs({ left: !prefs.left }) },
          { label: 'Inspector', icon: PanelRight, checked: prefs.right, onClick: () => setPrefs({ right: !prefs.right }) },
          '-',
          { label: 'Show Original Trace', checked: showOriginal, onClick: () => setShowOriginal(!showOriginal) },
          { label: 'Show Processed Trace', checked: showProcessed, disabled: !hasProc, onClick: () => setShowProcessed(!showProcessed) },
        ],
      },
      {
        label: 'Help',
        items: [
          { label: 'Keyboard Shortcuts', icon: BookOpen, onClick: () => void os.dialog.alert(SHORTCUTS, { title: 'kSignal shortcuts' }) },
          { label: 'How to Use kSignal', onClick: () => void os.dialog.alert(HELP, { title: 'kSignal' }) },
        ],
      },
    ]
    win.setMenus(menus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, exampleFiles, recent, prefs, playing, peaks.length, view, proc.trace, designed.design, base.trace, showOriginal, showProcessed, rev])

  // ------------------------------------------------------------ keyboard

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement
    const typing = !!target.closest('input, textarea, select, [contenteditable="true"]')
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    if (mod && !e.altKey) {
      if (k === 's') { e.preventDefault(); guarded(async () => { await (e.shiftKey ? saveAs() : save()) }, 'Save'); return }
      if (k === 'o') { e.preventDefault(); void openDialog(); return }
      if (k === 'n') { e.preventDefault(); void newDocument(); return }
      if (k === 'i') { e.preventDefault(); void importDialog(); return }
      if (k === 'e') { e.preventDefault(); exportReport(); return }
      if (k >= '1' && k <= '5') { e.preventDefault(); setTab(TABS[Number(k) - 1]); return }
      if (k === '0' && !typing) { e.preventDefault(); setView(null); return }
      if (k === 'c' && !typing && !window.getSelection()?.toString() && peaks.length) { e.preventDefault(); copyPeaks() }
      return
    }
    if (typing || e.altKey) return
    if (e.key === ' ' && project.tab !== 'live' && !(target.closest('button, summary'))) { e.preventDefault(); togglePlay(); return }
    if (e.key === 'Escape') { if (playback.current) stopPlayback(); return }
    if (k === 'a' || k === 'b') setPrefs({ clickTarget: k })
  }

  // ------------------------------------------------------------ AI tools

  const hooks: Hooks = {
    state: () => ({ project: live.current.project, samples: live.current.imported, dirty: live.current.rev !== live.current.savedRev }),
    setFilter: (spec, apply) => {
      setProject((p) => ({ ...p, filter: spec, process: apply ? { type: 'filter' } : p.process, tab: apply ? 'filter' : p.tab }))
    },
    openExample: async (ex) => { loadProject({ project: exampleProject(ex), samples: null, warnings: [] }, null) },
    showSignal: (source, name) => {
      const np = { ...newProject(source), name, synthetic: true as const }
      loadProject({ project: np, samples: null, warnings: [] }, null)
    },
  }
  useAppTools(win, ksignalTools(hooks))

  // ------------------------------------------------------------ rendering

  const hasProcessed = !!proc.trace
  const tabBody = (() => {
    if (base.error && project.tab !== 'filter' && project.tab !== 'live') {
      const missing = project.source.kind === 'data'
      return (
        <div className="sg-empty" role="alert">
          <p><strong>{base.error}</strong></p>
          {missing && <button type="button" className="k-btn primary" onClick={() => void importDialog()}>Import a file…</button>}
          {!missing && <p className="k-muted">Change the sample rate or duration in the Source panel.</p>}
        </div>
      )
    }
    switch (project.tab) {
      case 'time':
        return (
          <div className="sg-tabbody">
            <div className="sg-chartbar">
              <label className="sg-field">
                <span className="sg-field-label">Process</span>
                <select className="k-input sg-select" value={project.process.type === 'smooth' ? `smooth:${project.process.method}` : project.process.type} aria-label="Processing"
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === 'none') setProcess(NO_PROCESS)
                    else if (v === 'filter') applyFilter()
                    else if (v === 'envelope') setProcess({ type: 'envelope' })
                    else if (v === 'decimate') setProcess({ type: 'decimate', factor: 2 })
                    else if (v.startsWith('smooth:')) setProcess({ type: 'smooth', method: v.slice(7) as 'ma' | 'median' | 'sg', width: 11, order: 3 })
                  }}>
                  <option value="none">None</option>
                  <option value="filter" disabled={!designed.design}>Filter (from the Filter tab)</option>
                  <option value="smooth:ma">Moving average</option>
                  <option value="smooth:median">Median</option>
                  <option value="smooth:sg">Savitzky–Golay</option>
                  <option value="envelope">Hilbert envelope</option>
                  <option value="decimate">Decimate</option>
                </select>
              </label>
              {project.process.type === 'smooth' && <NumField label="Window" unit="samples" value={project.process.width} min={1} max={10001} step={2} narrow onChange={(w) => setProcess({ ...(project.process as Extract<Process, { type: 'smooth' }>), width: Math.round(w) })} />}
              {project.process.type === 'smooth' && project.process.method === 'sg' && <NumField label="Order" value={project.process.order} min={0} max={10} step={1} narrow onChange={(o) => setProcess({ ...(project.process as Extract<Process, { type: 'smooth' }>), order: Math.round(o) })} />}
              {project.process.type === 'decimate' && <NumField label="By" value={project.process.factor} min={2} max={64} step={1} narrow onChange={(f) => setProcess({ type: 'decimate', factor: Math.round(f) })} />}
              {hasProcessed && <Check label="Original" checked={showOriginal} onChange={setShowOriginal} />}
              {hasProcessed && <Check label="Processed" checked={showProcessed} onChange={setShowProcessed} />}
              <span className="sg-spacer" />
              <ClickTarget value={prefs.clickTarget} onChange={(clickTarget) => setPrefs({ clickTarget })} />
              {viewNow && <button type="button" className="k-btn small" onClick={() => setView(null)}>Reset zoom</button>}
              {playing ? <button type="button" className="k-btn small" onClick={stopPlayback}><Square size={12} /> Stop</button> : (
                <>
                  <button type="button" className="k-btn small" disabled={!base.trace} onClick={() => play('original')} title="Play the original signal"><Play size={12} /> Original</button>
                  <button type="button" className="k-btn small" disabled={!hasProcessed} onClick={() => play('processed')} title="Play the processed signal"><Play size={12} /> Processed</button>
                </>
              )}
            </div>
            {proc.error && <div className="sg-problem" role="alert">{proc.error}</div>}
            {project.process.type === 'filter' && designed.error && <div className="sg-problem" role="alert">The filter cannot be applied: {designed.error}</div>}
            <div className="sg-plot"><PlotlyChart figure={timeFig} onPlotClick={onPlotClick} onXRange={onTimeRange} /></div>
            {timePeaks && hr && (
              <div className="sg-note" role="status">
                {timePeaks.length} peaks · mean interval {fmtTime(hr.meanRR)} → {fmtNum(hr.bpm, 4)} per minute · SDNN {fmtTime(hr.sdnn)}
                {hr.rr.length > 0 && <span className="k-muted"> · intervals: {hr.rr.slice(0, 8).map((r) => fmtNum(r * 1000, 4)).join(', ')}{hr.rr.length > 8 ? '…' : ''} ms</span>}
              </div>
            )}
          </div>
        )
      case 'spectrum':
        return (
          <div className="sg-tabbody">
            <div className="sg-chartbar">
              <span className="k-muted">
                {analysis.mode === 'welch' ? 'Welch power spectral density' : 'Single FFT'} of the {analysedName} trace · {WINDOW_LABELS[analysis.window]} window
                {spectrum && analysis.mode === 'fft' && analysed && spectrum.n < analysed.x.length && ` · samples ${Math.round(analysis.start * analysed.fs).toLocaleString('en')}–${(Math.round(analysis.start * analysed.fs) + spectrum.n).toLocaleString('en')} of ${analysed.x.length.toLocaleString('en')}`}
              </span>
              <span className="sg-spacer" />
              <ClickTarget value={prefs.clickTarget} onChange={(clickTarget) => setPrefs({ clickTarget })} />
            </div>
            <div className="sg-plot"><PlotlyChart figure={spectrumFig} onPlotClick={onPlotClick} empty="The signal is too short for a spectrum." /></div>
            {spectrum && analysis.mode === 'fft' && spectrum.n < spectrum.nfft && <div className="sg-note k-muted">Only {spectrum.n.toLocaleString('en')} samples are left after the start: the segment is zero-padded.</div>}
          </div>
        )
      case 'spectrogram':
        return (
          <div className="sg-tabbody">
            <div className="sg-chartbar"><span className="k-muted">Short-time Fourier transform of the {analysedName} trace · {analysis.stftSize} samples, {Math.round(analysis.overlap * 100)} % overlap · {WINDOW_LABELS[analysis.window]}</span></div>
            <div className="sg-plot"><PlotlyChart figure={spectrogramFig} empty="Nothing to show yet." /></div>
          </div>
        )
      case 'filter':
        return (
          <FilterTab
            fs={fsNow} spec={project.filter} compare={project.compare} process={project.process} design={designed.design} error={designed.error} compareDesign={compareDesign} pal={pal}
            hasSignal={!!base.trace} hasProcessed={hasProcessed} playing={playing}
            onSpec={setFilter} onReplaceSpec={(spec) => setProject((p) => ({ ...p, filter: spec }))} onCompare={(c) => setProject((p) => ({ ...p, compare: c }))}
            onApply={applyFilter} onRemove={() => setProcess(NO_PROCESS)} onPlay={play} onStop={stopPlayback} runPython={runPython}
          />
        )
      case 'live':
        return <LiveTab pal={pal} />
    }
  })()

  const sub = base.trace ? `${base.trace.x.length.toLocaleString('en')} samples · ${fmtHz(base.trace.fs)} · ${fmtTime(base.trace.x.length / base.trace.fs)}` : 'no signal'

  return (
    <div ref={root} className="k-app sg-app" data-size={size} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="k-toolbar sg-toolbar">
        <button type="button" className={`k-icon-btn${prefs.left ? ' active' : ''}`} title="Source panel" aria-label="Source panel" aria-pressed={prefs.left} onClick={() => setPrefs({ left: !prefs.left })}><PanelLeft size={16} /></button>
        <button type="button" className="k-icon-btn" title="New (⌘N)" aria-label="New" onClick={() => void newDocument()}><FilePlus size={16} /></button>
        <button type="button" className="k-icon-btn" title="Open (⌘O)" aria-label="Open" onClick={() => void openDialog()}><FolderOpen size={16} /></button>
        <button type="button" className="k-icon-btn" title="Save (⌘S)" aria-label="Save" onClick={() => guarded(async () => { await save() }, 'Save')}><Save size={16} /></button>
        <button type="button" className="k-icon-btn" title="Import a signal (⌘I)" aria-label="Import a signal" onClick={() => void importDialog()}><Import size={16} /></button>
        <span className="k-sep" />
        <button type="button" className="k-btn small" disabled={!base.trace || project.tab === 'live'} onClick={togglePlay} title="Play / stop (Space)">{playing ? <><Square size={12} /> Stop</> : <><Play size={12} /> Play</>}</button>
        <span className="sg-title" title={filePath ?? undefined}><AudioLines size={14} /> {project.name}{dirty ? ' •' : ''}</span>
        <span className="k-spacer" />
        <button type="button" className={`k-icon-btn${prefs.right ? ' active' : ''}`} title="Inspector" aria-label="Inspector" aria-pressed={prefs.right} onClick={() => setPrefs({ right: !prefs.right })}><PanelRight size={16} /></button>
      </div>
      <div className="sg-tabs" role="tablist" aria-label="Views">
        {TABS.map((t, i) => (
          <button key={t} type="button" role="tab" aria-selected={project.tab === t} className={project.tab === t ? 'on' : ''} title={`${TAB_LABELS[t]} (⌘${i + 1})`} onClick={() => setTab(t)}>{TAB_ICONS[t]}<span>{TAB_LABELS[t]}</span></button>
        ))}
      </div>
      <div className="sg-body">
        {prefs.left && (
          <aside className="sg-left" aria-label="Source">
            <SourcePanel project={project} lastGenerator={lastGenerator} channels={channelData?.length ?? 1} onSource={onSource} onName={(name) => setProject((p) => ({ ...p, name }))}
              onImport={() => void importDialog()} onRecorded={recorded} onChannel={channelChange} />
          </aside>
        )}
        <main className="sg-center">{tabBody}</main>
        {prefs.right && (
          <aside className="sg-right" aria-label="Inspector">
            <Inspector
              tab={project.tab} analysis={analysis} onAnalysis={setAnalysis} hasProcessed={hasProcessed} fs={analysed?.fs ?? fsNow} stats={stats}
              spectrum={spectrum ? { df: spectrum.df, enbw: spectrum.enbw, nfft: spectrum.nfft, ...(psd ? { nfft: psd.main.nperseg, segments: psd.main.segments, df: psd.main.freq[1] ?? spectrum.df } : {}) } : null}
              peaks={peaks} tone={tone} timePeaks={timePeaks} heartRate={hr} period={period} cursors={cursors} onCursors={setCursors} readouts={readouts}
              onPeak={(f) => { setProject((p) => ({ ...p, cursors: { ...p.cursors, a: f } }), false); if (project.tab !== 'spectrum') setTab('spectrum') }} onCopyPeaks={copyPeaks}
            />
          </aside>
        )}
        {(prefs.left || prefs.right) && size !== 'l' && <button type="button" className="sg-scrim" aria-label="Close the panels" onClick={() => setPrefsState((p) => ({ ...p, left: false, right: false }))} />}
      </div>
      <div className="k-statusbar sg-status">
        <span>{sub}</span>
        {project.process.type !== 'none' && <span>· {describeProcess(project.process, designed.design)}</span>}
        {project.source.kind === 'generator' && project.synthetic && <span>· synthetic</span>}
        {status && <span className="k-muted" role="status">· {status}</span>}
        <span className="k-spacer" />
        <span className="k-muted">Filter: {describeSpec(project.filter)}</span>
      </div>
    </div>
  )
}

function ClickTarget({ value, onChange }: { value: 'a' | 'b'; onChange: (v: 'a' | 'b') => void }) {
  return (
    <div className="sg-seg small" role="radiogroup" aria-label="Cursor moved by a click">
      <span className="sg-seg-label k-muted">Click sets</span>
      {(['a', 'b'] as const).map((c) => <button key={c} type="button" role="radio" aria-checked={value === c} className={value === c ? 'on' : ''} onClick={() => onChange(c)}>{c.toUpperCase()}</button>)}
    </div>
  )
}

