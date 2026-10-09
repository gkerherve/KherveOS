// kClimate — a climate data explorer. Open datasets (CO2 at Mauna Loa, global temperature, ENSO, Arctic sea ice, sea
// level…) plotted with anomalies against a baseline and smoothing; trends with confidence intervals that allow for
// autocorrelation; the seasonal cycle of the Keeling curve; lagged correlation and regression; warming stripes; and
// a zero-dimensional energy-balance model. Files are .kclim. All the calculations are in pure modules (analysis.ts,
// stats.ts, seasonal.ts, relate.ts, ebm.ts); this file is the window.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardCopy, FilePlus, FileUp, FolderOpen, Redo2, Save, Undo2 } from 'lucide-react'
import { os, fs, path, HOME, type AppProps, type MenuBarMenu } from '@/os'
import type { MenuItem } from '@/os/ui/Menu'
import { useAppTools } from '@/os/ai/appTools'
import { exampleFolderPath, groupExamples, seedExampleFolder, type ExampleFile } from '@/os/exampleFiles'
import { exportCsv } from './analysis'
import { kclimateTools, type Hooks } from './aiTools'
import { catalogRefs, Library, type Manifest, type RefInfo } from './catalog'
import DatasetsTab from './DatasetsTab'
import type { Env, LoadState } from './env'
import { buildExamples } from './examples'
import { KCLIMATE_EXAMPLES_FOLDER } from './exampleFiles'
import ImportDialog from './ImportDialog'
import { importedSeries, type ImportedDataset } from './importCsv'
import { addRecent, clearRecent, loadDataset, loadManifest, loadPrefs, recentFiles, savePrefs, type Prefs } from './loader'
import ModelTab from './ModelTab'
import type { ChartHandle } from './PlotlyChart'
import { cloneProject, DEFAULT_PROJECT, parseKclim, serializeKclim, TABS, type Project, type TabId } from './project'
import RelateTab from './RelateTab'
import { reportMarkdown } from './report'
import SeasonalTab from './SeasonalTab'
import SeriesTab from './SeriesTab'
import SourcesTab from './SourcesTab'
import StripesTab from './StripesTab'
import TrendTab from './TrendTab'
import './kclimate.css'

const DIR = `${HOME}/Documents/kClimate`
const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
const safeName = (s: string): string => s.trim().replace(/[^\w.+-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'kclimate'

const WELCOME = 'Welcome to kClimate. The Datasets tab lists the open data that come with it (CO₂, temperature, sea ice, ENSO…); the other tabs analyse them. File › Open Example has ready-made analyses, and File › Import CSV… brings in your own time series.'

function starter(): Project {
  const p = cloneProject(DEFAULT_PROJECT)
  p.notes = WELCOME
  return p
}

const SHORTCUTS = [
  '⌘N  New project', '⌘O  Open…', '⌘S  Save', '⇧⌘S  Save as…', '⌘I  Import a CSV file…', '⌘Z / ⇧⌘Z  Undo / redo a change of settings',
  '⌘1 … ⌘8  Datasets, Time series, Trends, Seasonal cycle, Relationships, Stripes & records, Energy balance, Data sources',
].join('\n')

const HELP = [
  'kClimate explores open climate data.',
  '',
  '• Datasets: tick the datasets you want; import your own CSV (a year, a decimal year, dates, or year and month columns).',
  '• Time series: several series on two axes, anomalies against a baseline (1850–1900, 1951–1980, 1961–1990…), smoothing, a trend line.',
  '• Trends: linear, quadratic or exponential fits with the slope per decade and a 95 % interval that allows for autocorrelation; a breakpoint; periods compared.',
  '• Seasonal cycle: the trend, seasonal cycle and residual of a monthly series such as the Keeling curve, and the size of the cycle over time.',
  '• Relationships: correlation, lagged correlation (ENSO against temperature) and multiple regression on CO₂, ENSO and volcanic aerosol.',
  '• Stripes & records: warming stripes, decadal means, the warmest years, histograms of two periods, and the pre-industrial gauges.',
  '• Energy balance: a one-box model of the Earth with climate sensitivity, ocean heat uptake, CO₂ scenarios, the ice–albedo loop and the 255 K Earth.',
  '• Data sources: provider, URL, licence, version and retrieval date of every built-in dataset.',
  '',
  'Every chart can be saved as PNG or SVG; File › Export saves the data (CSV) and a report (Markdown). Projects are .kclim files.',
].join('\n')

export default function KClimate({ win, args }: AppProps) {
  const [project, setProject] = useState<Project>(starter)
  const [tab, setTabState] = useState<TabId>(project.tab)
  const [rev, setRev] = useState(0)
  const [savedRev, setSavedRev] = useState(0)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [manifestError, setManifestError] = useState<string | null>(null)
  const [status, setStatus] = useState<Record<string, LoadState>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const [notesOpen, setNotesOpen] = useState(true)
  const [notesWide, setNotesWide] = useState(false)
  const [exampleFiles, setExampleFiles] = useState<ExampleFile[]>([])
  const [importDlg, setImportDlg] = useState<{ text: string; name: string } | null>(null)
  const [narrow, setNarrow] = useState(false)
  const [message, setMessage] = useState('')

  const lib = useMemo(() => new Library(), [])
  const root = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ChartHandle | null>(null)
  const alive = useRef(true)
  const loading = useRef(new Set<string>())
  const importSig = useRef(new Map<string, string>())
  const hist = useRef<{ past: string[]; future: string[]; at: number }>({ past: [], future: [], at: 0 })
  const msgTimer = useRef<number | undefined>(undefined)

  const projRef = useRef(project)
  projRef.current = project
  const live = useRef({ tab, rev, savedRev, filePath })
  live.current = { tab, rev, savedRev, filePath }
  const dirty = rev !== savedRev
  const [, bumpHistory] = useState(0)

  const flash = useCallback((text: string) => {
    setMessage(text)
    window.clearTimeout(msgTimer.current)
    msgTimer.current = window.setTimeout(() => setMessage(''), 5000)
  }, [])
  useEffect(() => () => { alive.current = false; window.clearTimeout(msgTimer.current) }, [])

  const setPrefs = (patch: Partial<Prefs>) => setPrefsState((p) => { const n = { ...p, ...patch }; savePrefs(n); return n })

  // ------------------------------------------------------------ the project and its undo history

  const commit = useCallback((next: Project) => {
    const h = hist.current
    const now = Date.now()
    // quick successive changes (a slider drag) are one undo step
    if (now - h.at > 600) {
      h.past.push(JSON.stringify(projRef.current))
      if (h.past.length > 100) h.past.shift()
    }
    h.at = now
    h.future = []
    projRef.current = next
    setProject(next)
    setRev((r) => r + 1)
  }, [])

  const update = useCallback((change: (p: Project) => void) => {
    const next = cloneProject(projRef.current)
    change(next)
    commit(next)
  }, [commit])

  const undo = () => {
    const h = hist.current
    const prev = h.past.pop()
    if (prev === undefined) return
    h.future.push(JSON.stringify(projRef.current))
    h.at = 0
    const p = JSON.parse(prev) as Project
    projRef.current = p
    setProject(p)
    setRev((r) => r + 1)
    bumpHistory((n) => n + 1)
  }
  const redo = () => {
    const h = hist.current
    const next = h.future.pop()
    if (next === undefined) return
    h.past.push(JSON.stringify(projRef.current))
    h.at = 0
    const p = JSON.parse(next) as Project
    projRef.current = p
    setProject(p)
    setRev((r) => r + 1)
    bumpHistory((n) => n + 1)
  }

  const setTab = useCallback((t: TabId) => { setTabState(t); chartRef.current = null }, [])

  // ------------------------------------------------------------ loading the data

  useEffect(() => {
    let dead = false
    loadManifest().then((m) => !dead && setManifest(m), (e) => !dead && setManifestError(msgOf(e)))
    return () => { dead = true }
  }, [])

  const refs: RefInfo[] = useMemo(() => [
    ...(manifest ? catalogRefs(manifest) : []),
    ...project.imports.flatMap((d) => d.columns.map((c): RefInfo => ({ ref: `${d.id}.${c.key}`, name: d.synthetic ? `${c.name} (synthetic)` : c.name, dataset: d.id, unit: c.unit, step: d.step, kind: c.kind }))),
  ], [manifest, project.imports])

  const datasetTitle = useCallback((id: string): string => {
    if (id.startsWith('user:')) {
      const d = projRef.current.imports.find((x) => x.id === id)
      return d ? `${d.name}${d.synthetic ? ' (synthetic)' : ''}: yours` : id
    }
    return manifest?.datasets.find((d) => d.id === id)?.title ?? id
  }, [manifest])

  // keep the library in step with the project: imports and shipped datasets
  useEffect(() => {
    let changed = false
    const wanted = new Set([...project.datasets, ...project.imports.map((d) => d.id)])
    for (const id of lib.datasets()) {
      if (!wanted.has(id)) { lib.removeDataset(id); importSig.current.delete(id); changed = true }
    }
    for (const im of project.imports) {
      const sig = JSON.stringify(im)
      if (importSig.current.get(im.id) !== sig || !lib.datasets().includes(im.id)) {
        lib.addDataset(im.id, importedSeries(im))
        importSig.current.set(im.id, sig)
        changed = true
      }
    }
    if (manifest) {
      for (const id of project.datasets) {
        if (lib.datasets().includes(id) || loading.current.has(id)) continue
        const entry = manifest.datasets.find((d) => d.id === id)
        if (!entry) {
          setErrors((e) => ({ ...e, [id]: `This project uses the dataset “${id}”, which this version of kClimate does not have.` }))
          setStatus((s) => ({ ...s, [id]: 'error' }))
          continue
        }
        loading.current.add(id)
        setStatus((s) => ({ ...s, [id]: 'loading' }))
        loadDataset(entry).then(
          (series) => {
            loading.current.delete(id)
            if (!alive.current || !projRef.current.datasets.includes(id)) return
            lib.addDataset(id, series)
            setStatus((s) => ({ ...s, [id]: 'ready' }))
            setVersion((v) => v + 1)
          },
          (e) => {
            loading.current.delete(id)
            if (!alive.current) return
            setStatus((s) => ({ ...s, [id]: 'error' }))
            setErrors((er) => ({ ...er, [id]: msgOf(e) }))
            flash(`${entry.title} could not be loaded: ${msgOf(e)}`)
          },
        )
      }
    }
    if (changed) setVersion((v) => v + 1)
  }, [project.datasets, project.imports, manifest, lib, flash])

  const ensureRef = useCallback((ref: string) => {
    const id = ref.replace(/@\d+$/, '').split('.')[0]
    if (id.startsWith('user:') || projRef.current.datasets.includes(id)) return
    if (!manifest?.datasets.some((d) => d.id === id)) return
    update((p) => { p.datasets.push(id) })
  }, [manifest, update])

  const toggleDataset = useCallback((id: string, on: boolean) => {
    update((p) => { p.datasets = on ? [...new Set([...p.datasets, id])] : p.datasets.filter((d) => d !== id) })
  }, [update])

  const removeImport = useCallback((id: string) => {
    update((p) => { p.imports = p.imports.filter((d) => d.id !== id) })
  }, [update])

  // ------------------------------------------------------------ files

  const confirmDiscard = async (): Promise<boolean> => {
    if (live.current.rev === live.current.savedRev) return true
    return os.dialog.confirm('This project has changes that are not saved. Continue and lose them?', { title: 'Unsaved changes', okLabel: 'Continue', danger: true })
  }

  const loadProject = useCallback((p: Project, p2: string | null) => {
    hist.current = { past: [], future: [], at: 0 }
    projRef.current = p
    setProject(p)
    setTabState(p.tab)
    chartRef.current = null
    setFilePath(p2)
    setRev(0)
    setSavedRev(0)
    setNotesOpen(true)
    setNotesWide(false)
    win.setDocumentPath(p2)
  }, [win])

  const openText = useCallback((text: string, p2: string | null, fileName: string) => {
    const r = parseKclim(text)
    if (!r.project.title || r.project.title === 'Untitled') r.project.title = fileName
    loadProject(r.project, p2)
    if (r.warnings.length) flash(r.warnings[0])
  }, [loadProject, flash])

  const openPath = useCallback(async (p: string) => {
    try {
      openText(await fs.readText(p), p, path.basename(p).replace(/\.[^.]+$/, ''))
      addRecent(p)
    } catch (e) {
      await os.dialog.alert(`Could not open “${path.basename(p)}”: ${msgOf(e)}`, { title: 'Open' })
    }
  }, [openText])

  const openDialog = async () => {
    if (!(await confirmDiscard())) return
    const p = await os.dialog.openFile({ extensions: ['.kclim'], startDir: fs.isDir(DIR) ? DIR : undefined })
    if (p) await openPath(p)
  }

  useEffect(() => {
    if (args.path && fs.exists(args.path)) void openPath(args.path)
    else if (typeof args.text === 'string' && args.text.trim()) {
      try { openText(args.text, null, typeof args.name === 'string' ? args.name : 'Untitled') } catch (e) { void os.dialog.alert(msgOf(e), { title: 'Open' }) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.path, args.text])

  const newProject = async () => {
    if (!(await confirmDiscard())) return
    loadProject(starter(), null)
  }

  const write = async (p: string, retitle?: string) => {
    const proj = { ...projRef.current, tab: live.current.tab, ...(retitle ? { title: retitle } : {}) }
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeText(p, serializeKclim(proj))
    if (retitle) { projRef.current = proj; setProject(proj) }
    setFilePath(p)
    setSavedRev(live.current.rev)
    win.setDocumentPath(p)
    addRecent(p)
  }

  const saveAs = async (): Promise<boolean> => {
    if (!fs.isDir(DIR)) await fs.mkdir(DIR, { recursive: true })
    const p = await os.dialog.saveFile({ defaultName: `${safeName(projRef.current.title)}.kclim`, extensions: ['.kclim'], startDir: DIR })
    if (!p) return false
    const target = /\.kclim$/i.test(p) ? p : `${p}.kclim`
    const base = path.basename(target).replace(/\.kclim$/i, '')
    await write(target, projRef.current.title === 'Untitled' ? base : undefined)
    os.notify({ title: 'Project saved', body: path.pretty(target) })
    return true
  }

  const save = async (): Promise<boolean> => {
    const p = live.current.filePath
    if (!p) return saveAs()
    await write(p)
    os.notify({ title: 'Project saved', body: path.pretty(p) })
    return true
  }

  // examples copied to ~/Documents/kClimate Examples
  useEffect(() => {
    let dead = false
    void seedExampleFolder({ app: 'kclimate', folderName: KCLIMATE_EXAMPLES_FOLDER, fs }).then((files) => !dead && setExampleFiles(files))
    return () => { dead = true }
  }, [])

  const builtIn = useMemo(() => buildExamples(), [])
  const openExampleFile = async (f: ExampleFile) => { if (await confirmDiscard()) await openPath(f.path) }
  const openBuiltIn = async (i: number) => { if (await confirmDiscard()) loadProject(cloneProject(builtIn[i].project), null) }

  // ------------------------------------------------------------ import, export

  const chooseCsv = async (): Promise<{ name: string; text: string } | null> => {
    const p = await os.dialog.openFile({ extensions: ['.csv', '.tsv', '.txt', '.dat'], startDir: fs.isDir(`${HOME}/Documents`) ? `${HOME}/Documents` : undefined })
    if (!p) return null
    try {
      return { name: path.basename(p).replace(/\.[^.]+$/, ''), text: await fs.readText(p) }
    } catch (e) {
      await os.dialog.alert(`Could not read “${path.basename(p)}”: ${msgOf(e)}`, { title: 'Import' })
      return null
    }
  }

  const openImport = useCallback(async (text?: string) => {
    if (text === undefined) {
      const f = await chooseCsv()
      if (f) setImportDlg({ text: f.text, name: f.name })
    } else setImportDlg({ text, name: 'My data' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addImport = (d: ImportedDataset) => {
    const had = projRef.current.imports.some((x) => x.id === d.id)
    update((p) => { p.imports = [...p.imports.filter((x) => x.id !== d.id), d] })
    setImportDlg(null)
    setTab('data')
    flash(`${had ? 'Replaced' : 'Imported'} “${d.name}”: ${d.t.length} rows${d.synthetic ? ' (labelled synthetic)' : ''}. Choose its series in the other tabs.`)
  }

  const saveBytes = async (data: Uint8Array | string, defaultName: string, ext: string, what: string) => {
    if (!fs.isDir(DIR)) await fs.mkdir(DIR, { recursive: true })
    const p = await os.dialog.saveFile({ defaultName, extensions: [`.${ext}`], startDir: DIR })
    if (!p) return
    const target = p.toLowerCase().endsWith(`.${ext}`) ? p : `${p}.${ext}`
    if (typeof data === 'string') await fs.writeText(target, data)
    else await fs.writeBytes(target, data)
    os.notify({ title: `${what} saved`, body: path.pretty(target) })
  }

  const saveImage = useCallback(async (chart: ChartHandle | null, format: 'png' | 'svg', name: string, title?: string) => {
    if (!chart) { flash('The chart is not ready yet.'); return }
    try {
      const data = await chart.exportImage(format, title)
      await saveBytes(data, `${safeName(projRef.current.title)}-${name}.${format}`, format, 'Chart')
    } catch (e) {
      await os.dialog.alert(`The chart could not be saved: ${msgOf(e)}`, { title: 'Export' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash])

  const exportData = async () => {
    const r = exportCsv({ ...projRef.current, tab: live.current.tab }, lib)
    if (!r) { await os.dialog.alert('This tab has no numbers to export. Open a tab with a chart first.', { title: 'Export data' }); return }
    await saveBytes(r.csv, `${safeName(projRef.current.title)}-${r.name}.csv`, 'csv', 'Data')
  }

  const reportText = () => reportMarkdown({ ...projRef.current, tab: live.current.tab }, lib, manifest, { date: new Date().toISOString().slice(0, 10) })
  const exportReport = async () => {
    try { await saveBytes(reportText(), `${safeName(projRef.current.title)}-report.md`, 'md', 'Report') } catch (e) { await os.dialog.alert(msgOf(e), { title: 'Export report' }) }
  }
  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportText())
      flash('The report was copied to the clipboard.')
    } catch {
      flash('The clipboard is not available here. Use File › Export › Report instead.')
    }
  }

  const editTitle = async () => {
    const t = await os.dialog.prompt('Title of this project:', { title: 'Project title', defaultValue: projRef.current.title })
    if (t !== null && t.trim()) update((p) => { p.title = t.trim() })
  }
  const editNotes = async () => {
    const t = await os.dialog.prompt('Notes shown above the tabs (what this analysis is about):', { title: 'Project notes', defaultValue: projRef.current.notes })
    if (t !== null) update((p) => { p.notes = t })
  }

  // ------------------------------------------------------------ window: title, close guard, size, menus

  useEffect(() => { win.setTitle(`kClimate — ${project.title}${dirty ? ' •' : ''}`) }, [win, project.title, dirty])

  useEffect(() => {
    win.setCloseGuard(async () => {
      if (live.current.rev === live.current.savedRev) return true
      const choice = await os.dialog.choose(
        `Save the changes to “${projRef.current.title}” before closing?`,
        [{ label: 'Cancel', value: 'cancel' }, { label: "Don't save", value: 'discard', danger: true }, { label: 'Save', value: 'save', primary: true }],
        { title: 'Unsaved changes' },
      )
      if (choice === 'save') { try { return await save() } catch { return false } }
      return choice === 'discard'
    })
    return () => win.setCloseGuard(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win])

  useEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 860))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const goto = useCallback((t: TabId, change?: (p: Project) => void) => {
    if (change) update(change)
    setTab(t)
  }, [update, setTab])

  useEffect(() => {
    const tabItem = (id: TabId, shortcut?: string): MenuItem => ({ label: TABS.find((t) => t.id === id)!.label, checked: tab === id, shortcut, onClick: () => setTab(id) })
    const groups = groupExamples(exampleFiles)
    const exampleItems: MenuItem[] = exampleFiles.length
      ? groups.map((g) => ({ label: g.group || 'Other', submenu: g.files.map((f) => ({ label: f.title, onClick: () => void openExampleFile(f) })) }))
      : [...new Set(builtIn.map((e) => e.group))].map((g) => ({ label: g, submenu: builtIn.map((e, i) => ({ e, i })).filter((x) => x.e.group === g).map((x) => ({ label: x.e.title, onClick: () => void openBuiltIn(x.i) })) }))
    const recent = recentFiles()
    const recentItems: MenuItem[] = recent.length
      ? [...recent.map((p): MenuItem => ({ label: path.basename(p), disabled: !fs.exists(p), onClick: () => void confirmDiscard().then((ok) => { if (ok) void openPath(p) }) })), '-', { label: 'Clear Menu', onClick: () => { clearRecent(); bumpHistory((n) => n + 1) } }]
      : [{ label: '(no recent projects)', disabled: true }]
    const menus: MenuBarMenu[] = [
      {
        label: 'File',
        items: [
          { label: 'New', icon: FilePlus, shortcut: '⌘N', onClick: () => void newProject() },
          { label: 'Open…', icon: FolderOpen, shortcut: '⌘O', onClick: () => void openDialog() },
          { label: 'Open Recent', submenu: recentItems },
          { label: 'Open Example', submenu: exampleItems },
          { label: 'Open Examples Folder', onClick: () => void seedExampleFolder({ app: 'kclimate', folderName: KCLIMATE_EXAMPLES_FOLDER, fs }).then((files) => { setExampleFiles(files); os.open('files', { path: exampleFolderPath(KCLIMATE_EXAMPLES_FOLDER) }) }) },
          '-',
          { label: 'Save', icon: Save, shortcut: '⌘S', onClick: () => void save().catch((e) => os.dialog.alert(msgOf(e))) },
          { label: 'Save As…', shortcut: '⇧⌘S', onClick: () => void saveAs().catch((e) => os.dialog.alert(msgOf(e))) },
          '-',
          { label: 'Import CSV File…', icon: FileUp, shortcut: '⌘I', onClick: () => void openImport() },
          { label: 'Import Pasted CSV…', onClick: () => void openImport('') },
          {
            label: 'Export', submenu: [
              { label: 'Chart as PNG…', onClick: () => void saveImage(chartRef.current, 'png', live.current.tab, TABS.find((t) => t.id === live.current.tab)?.label) },
              { label: 'Chart as SVG…', onClick: () => void saveImage(chartRef.current, 'svg', live.current.tab, TABS.find((t) => t.id === live.current.tab)?.label) },
              { label: 'Data as CSV…', onClick: () => void exportData() },
              { label: 'Report (Markdown)…', onClick: () => void exportReport() },
            ],
          },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', icon: Undo2, shortcut: '⌘Z', disabled: hist.current.past.length === 0, onClick: undo },
          { label: 'Redo', icon: Redo2, shortcut: '⇧⌘Z', disabled: hist.current.future.length === 0, onClick: redo },
          '-',
          { label: 'Copy Report', icon: ClipboardCopy, onClick: () => void copyReport() },
          '-',
          { label: 'Project Title…', onClick: () => void editTitle() },
          { label: 'Project Notes…', onClick: () => void editNotes() },
        ],
      },
      {
        label: 'Data',
        items: [
          tabItem('data', '⌘1'),
          '-',
          { label: 'Use Dataset', submenu: (manifest?.datasets ?? []).map((d) => ({ label: d.title, checked: project.datasets.includes(d.id), onClick: () => toggleDataset(d.id, !project.datasets.includes(d.id)) })) },
          { label: 'Remove Imported Dataset', disabled: project.imports.length === 0, submenu: project.imports.map((d) => ({ label: d.name, onClick: () => removeImport(d.id) })) },
          '-',
          { label: 'Reload the Catalog', onClick: () => { setManifestError(null); void loadManifest().then(setManifest, (e) => setManifestError(msgOf(e))) } },
          tabItem('sources', '⌘8'),
        ],
      },
      {
        label: 'Analysis',
        items: [
          tabItem('series', '⌘2'),
          tabItem('trend', '⌘3'),
          tabItem('seasonal', '⌘4'),
          tabItem('relate', '⌘5'),
          tabItem('stripes', '⌘6'),
          tabItem('model', '⌘7'),
          '-',
          { label: 'Lagged Correlation (ENSO)', onClick: () => goto('relate', (p) => { p.relate.mode = 'lag' }) },
          { label: 'Regression on CO₂, ENSO and Volcanoes', onClick: () => goto('relate', (p) => { p.relate.mode = 'regression' }) },
          { label: 'Find a Breakpoint in the Trend', onClick: () => goto('trend', (p) => { p.trend.breakpoint = true }) },
          { label: 'Ice–Albedo Hysteresis Loop', onClick: () => goto('model', (p) => { p.model.tool = 'hysteresis' }) },
          { label: 'Earth With No Greenhouse Effect', onClick: () => goto('model', (p) => { p.model.tool = 'blackbody' }) },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Settings Panel', checked: prefs.settings, onClick: () => setPrefs({ settings: !prefs.settings }) },
          { label: 'Project Notes', checked: notesOpen, disabled: !project.notes.trim(), onClick: () => setNotesOpen(!notesOpen) },
        ],
      },
      {
        label: 'Help',
        items: [
          { label: 'How to Use kClimate', onClick: () => void os.dialog.alert(HELP, { title: 'kClimate' }) },
          { label: 'Keyboard Shortcuts', onClick: () => void os.dialog.alert(SHORTCUTS, { title: 'kClimate shortcuts' }) },
          { label: 'About the Data', onClick: () => setTab('sources') },
        ],
      },
    ]
    win.setMenus(menus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, prefs, notesOpen, project, manifest, exampleFiles, rev, savedRev, filePath, builtIn])

  // ------------------------------------------------------------ keyboard

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod || e.altKey) return
    const k = e.key.toLowerCase()
    const typing = !!(e.target as HTMLElement).closest('input, textarea, select')
    if (k === 's') { e.preventDefault(); void (e.shiftKey ? saveAs() : save()).catch((x) => os.dialog.alert(msgOf(x))); return }
    if (k === 'o') { e.preventDefault(); void openDialog(); return }
    if (k === 'n') { e.preventDefault(); void newProject(); return }
    if (k === 'i') { e.preventDefault(); void openImport(); return }
    if (k >= '1' && k <= '8') { e.preventDefault(); setTab(TABS[Number(k) - 1].id); return }
    if (typing) return
    if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
    else if (k === 'y') { e.preventDefault(); redo() }
  }

  // ------------------------------------------------------------ AI tools

  const hooks: Hooks = {
    state: () => ({ project: { ...projRef.current, tab: live.current.tab }, lib, manifest, dirty: live.current.rev !== live.current.savedRev, filePath: live.current.filePath }),
    ensure: async (ref) => {
      const id = ref.replace(/@\d+$/, '').split('.')[0]
      if (id.startsWith('user:')) return lib.has(ref)
      const m = manifest ?? (await loadManifest().catch(() => null))
      const entry = m?.datasets.find((d) => d.id === id)
      if (!entry) return false
      if (!lib.datasets().includes(id)) {
        try {
          lib.addDataset(id, await loadDataset(entry))
          setVersion((v) => v + 1)
        } catch {
          return false
        }
      }
      if (!projRef.current.datasets.includes(id)) update((p) => { p.datasets.push(id) })
      return true
    },
    show: (change, t) => { update(change); if (t) setTab(t) },
    examples: () => builtIn.map((e, i) => ({ n: i + 1, title: e.title, group: e.group, description: e.description })),
    openExample: async (n) => {
      const ex = builtIn[n - 1]
      const file = exampleFiles.find((f) => f.title === ex.title)
      if (file && fs.exists(file.path)) await openPath(file.path)
      else loadProject(cloneProject(ex.project), null)
      return ex.title
    },
  }
  useAppTools(win, kclimateTools(hooks))

  // ------------------------------------------------------------ render

  const env: Env = {
    project, update, lib, version, manifest, manifestError, refs, status, errors, datasetTitle, ensureRef, toggleDataset, removeImport, openImport: (t) => void openImport(t), narrow, settings: prefs.settings,
    flash, saveImage: (c, f, n, t) => void saveImage(c, f, n, t), chartRef, setTab,
  }

  const body = (() => {
    switch (tab) {
      case 'data': return <DatasetsTab env={env} />
      case 'series': return <SeriesTab env={env} />
      case 'trend': return <TrendTab env={env} />
      case 'seasonal': return <SeasonalTab env={env} />
      case 'relate': return <RelateTab env={env} />
      case 'stripes': return <StripesTab env={env} />
      case 'model': return <ModelTab env={env} />
      case 'sources': return <SourcesTab env={env} />
    }
  })()

  const loadedCount = lib.datasets().length
  const pendingCount = Object.values(status).filter((s) => s === 'loading').length

  return (
    <div className={`k-app cl-app${narrow ? ' narrow' : ''}`} ref={root} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="k-toolbar cl-toolbar">
        <button type="button" className="k-icon-btn" title="New project (⌘N)" aria-label="New project" onClick={() => void newProject()}><FilePlus size={16} /></button>
        <button type="button" className="k-icon-btn" title="Open (⌘O)" aria-label="Open" onClick={() => void openDialog()}><FolderOpen size={16} /></button>
        <button type="button" className="k-icon-btn" title="Save (⌘S)" aria-label="Save" onClick={() => void save().catch((e) => os.dialog.alert(msgOf(e)))}><Save size={16} /></button>
        <span className="k-sep" />
        <button type="button" className="k-icon-btn" title="Undo (⌘Z)" aria-label="Undo" disabled={hist.current.past.length === 0} onClick={undo}><Undo2 size={16} /></button>
        <button type="button" className="k-icon-btn" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={hist.current.future.length === 0} onClick={redo}><Redo2 size={16} /></button>
        <span className="k-sep" />
        <button type="button" className="k-btn small" title="Import a CSV time series (⌘I)" onClick={() => void openImport()}><FileUp size={13} /> Import CSV</button>
        <span className="k-spacer" />
        <span className="cl-title" title={filePath ?? 'Not saved yet'}>{project.title}{dirty ? ' •' : ''}</span>
      </div>
      <nav className="cl-tabs" role="tablist" aria-label="kClimate sections" onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return
        e.preventDefault()
        const i = TABS.findIndex((t) => t.id === tab)
        const j = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length
        setTab(TABS[j].id)
        requestAnimationFrame(() => e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[j]?.focus())
      }}>
        {TABS.map((t, i) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} className={tab === t.id ? 'on' : ''} title={`${t.label} (⌘${i + 1})`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </nav>
      {notesOpen && project.notes.trim() && (
        <div className={`cl-notes${notesWide ? ' open' : ''}`}>
          <p>{project.notes}</p>
          <div className="cl-notes-actions">
            <button type="button" className="k-link-btn" onClick={() => setNotesWide(!notesWide)}>{notesWide ? 'less' : 'more'}</button>
            <button type="button" className="k-link-btn" onClick={() => setNotesOpen(false)} aria-label="Hide the notes">hide</button>
          </div>
        </div>
      )}
      <main className="cl-main" role="tabpanel">{body}</main>
      <div className="k-statusbar">
        <span>{message || (pendingCount ? `Loading ${pendingCount} dataset${pendingCount > 1 ? 's' : ''}…` : 'Ready')}</span>
        <span className="k-spacer" style={{ flex: 1 }} />
        <span>{loadedCount} dataset{loadedCount === 1 ? '' : 's'}, {lib.all().length} series</span>
        <span>{filePath ? path.pretty(filePath) : 'not saved'}</span>
      </div>
      {importDlg && <ImportDialog initialText={importDlg.text} initialName={importDlg.name} chooseFile={chooseCsv} onImport={addImport} onCancel={() => setImportDlg(null)} />}
    </div>
  )
}
