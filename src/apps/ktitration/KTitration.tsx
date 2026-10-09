// kTitration — a titration and acid–base equilibrium lab: exact curves for acid–base, redox, EDTA and precipitation
// titrations with a virtual burette and flask, speciation diagrams, analysis of measured data (derivatives, Gran
// plots, a nonlinear fit of the full model), a buffer designer, an indicator chooser and reference tables.
// Files are .ktitr.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen, Download, FilePlus, FlaskConical, FolderOpen, Library, Redo2, Save, Table2, Undo2, Beaker, LineChart, Droplets, Search, Sigma,
} from 'lucide-react'
import { os, fs, path, HOME, type AppProps, type MenuBarMenu } from '@/os'
import { useAppTools } from '@/os/ai/appTools'
import { exampleFolderPath, groupExamples, seedExampleFolder, type ExampleFile } from '@/os/exampleFiles'
import { ktitrationTools, type Hooks } from './aiTools'
import { AnalyseTab } from './AnalyseTab'
import { BufferTab } from './BufferTab'
import { Boundary } from './Boundary'
import { renderImage } from './Chart'
import { systemOf, type PkaEntry } from './data/pka'
import { EXAMPLES } from './examples'
import { LIGHT_PALETTE, type Figure, type Palette } from './figures'
import { fitTitration, type FitResult } from './fit'
import { safeName } from './format'
import { History } from './history'
import { IndicatorTab } from './IndicatorTab'
import { bestPair } from './buffer'
import { parseData } from './analyse'
import { TABS, newProject, parseKtitr, serializeKtitr, weakFrom, type Project, type SpeciationSpec, type TabId } from './project'
import { ReferenceTab } from './ReferenceTab'
import { analysisReport, curveCsv, titrationReport } from './report'
import { computeResult, factsText } from './result'
import { speciesTitration } from './speciation'
import { DEFAULT_TITRATION_PREFS, TitrationTab, type TitrationPrefs } from './TitrationTab'
import { SpeciationTab } from './SpeciationTab'
import './ktitration.css'

const DIR = `${HOME}/Documents/kTitration`
const EXAMPLES_FOLDER = 'kTitration Examples'
const PREFS_KEY = 'kherveos.ktitration.prefs'

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

function loadPrefs(): TitrationPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<TitrationPrefs>
    const out = { ...DEFAULT_TITRATION_PREFS }
    for (const k of Object.keys(out) as Array<keyof TitrationPrefs>) if (typeof raw[k] === 'boolean') out[k] = raw[k] as boolean
    return out
  } catch { return DEFAULT_TITRATION_PREFS }
}
function savePrefs(p: TitrationPrefs) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* storage blocked */ } }

const TAB_ICONS: Record<TabId, typeof Beaker> = { titration: Beaker, speciation: LineChart, analyse: Sigma, buffer: FlaskConical, indicators: Droplets, reference: Table2 }

export default function KTitration({ win, args }: AppProps) {
  const [project, setProject] = useState<Project>(newProject)
  const [tab, setTabState] = useState<TabId>('titration')
  const [rev, setRev] = useState(0)
  const [savedRev, setSavedRev] = useState(0)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [docKey, setDocKey] = useState(0)
  const [fit, setFit] = useState<FitResult | null>(null)
  const [fitKey, setFitKey] = useState('')
  const [fitting, setFitting] = useState(false)
  const [prefs, setPrefsState] = useState<TitrationPrefs>(loadPrefs)
  const [width, setWidth] = useState(1100)
  const [exampleFiles, setExampleFiles] = useState<ExampleFile[]>([])
  const [, force] = useState(0)

  const root = useRef<HTMLDivElement>(null)
  const exportRef = useRef<null | ((pal: Palette) => Figure | null)>(null)
  const hist = useRef(new History<Project>())
  const live = useRef({ project, tab, rev, savedRev, filePath, fit })
  live.current = { project, tab, rev, savedRev, filePath, fit }
  const dirty = rev !== savedRev
  const compact = width < 900

  const setPrefs = (patch: Partial<TitrationPrefs>) => setPrefsState((p) => { const n = { ...p, ...patch }; savePrefs(n); return n })

  const result = useMemo(() => computeResult(project), [project.mode, project.acidbase, project.redox, project.edta, project.precip]) // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ the document

  const update = useCallback((fn: (p: Project) => Project, key = '') => {
    const prev = live.current.project
    const next = fn(prev)
    if (next === prev) return
    hist.current.push(prev, key)
    live.current.project = next
    setProject(next)
    setRev((r) => r + 1)
  }, [])

  const setTab = useCallback((t: TabId) => {
    live.current.tab = t
    setTabState(t)
  }, [])

  const runFit = useCallback((p: Project = live.current.project) => {
    const text = p.analyse.text
    setFitting(true)
    // let the “Fitting…” state paint first
    window.setTimeout(() => {
      try {
        const d = parseData(text).data
        setFit(fitTitration(d, p.analyse.setup))
        setFitKey(JSON.stringify([text, p.analyse.setup]))
      } catch (e) {
        setFit({ ok: false, message: msgOf(e), params: [], Ca: NaN, pKa: [], Ct: NaN, dV: 0, temperature: p.analyse.setup.temperature, fitted: [], residuals: [], rmse: NaN, r2: NaN, dof: 0, iterations: 0, converged: false, eq: [], correlation: [] })
      } finally {
        setFitting(false)
      }
    }, 20)
  }, [])

  const load = useCallback((p: Project, from: string | null, opts: { dirty?: boolean; runFit?: boolean } = {}) => {
    hist.current.clear()
    live.current.project = p
    live.current.tab = p.tab
    setProject(p)
    setTabState(p.tab)
    setFilePath(from)
    setDocKey((k) => k + 1)
    setRev(opts.dirty ? 1 : 0)
    setSavedRev(0)
    setFit(null)
    setFitKey('')
    win.setDocumentPath(from)
    if ((opts.runFit ?? p.tab === 'analyse') && p.analyse.text.trim() && (p.analyse.view === 'fit' || opts.runFit)) runFit(p)
  }, [win, runFit])

  const confirmDiscard = async (): Promise<boolean> => {
    if (live.current.rev === live.current.savedRev) return true
    return os.dialog.confirm('This titration has changes that are not saved. Continue and lose them?', { title: 'Unsaved changes', okLabel: 'Continue', danger: true })
  }

  const currentDoc = (): Project => ({ ...live.current.project, tab: live.current.tab })

  const openText = useCallback((text: string, from: string | null) => {
    const p = parseKtitr(text)
    load(p, from)
  }, [load])

  const openPath = useCallback(async (p: string) => {
    try {
      openText(await fs.readText(p), /\.ktitr$/i.test(p) ? p : null)
    } catch (e) {
      await os.dialog.alert(`Could not open “${path.basename(p)}”: ${msgOf(e)}`, { title: 'Open' })
    }
  }, [openText])

  const openDialog = async () => {
    if (!(await confirmDiscard())) return
    const p = await os.dialog.openFile({ extensions: ['.ktitr'], startDir: fs.isDir(DIR) ? DIR : undefined })
    if (p) await openPath(p)
  }

  useEffect(() => {
    if (args.path && fs.exists(args.path)) void (async () => { if (await confirmDiscard()) await openPath(args.path as string) })()
    else if (typeof args.text === 'string' && args.text.trim()) {
      try { openText(args.text, null) } catch (e) { void os.dialog.alert(msgOf(e), { title: 'Open' }) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.path, args.text])

  const newDocument = async () => {
    if (!(await confirmDiscard())) return
    load(newProject(), null)
  }

  const writeFile = async (p: string, name?: string): Promise<void> => {
    const doc = currentDoc()
    if (name) doc.name = name
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeText(p, serializeKtitr(doc))
    if (name) { live.current.project = doc; setProject(doc) }
    setFilePath(p)
    setSavedRev(live.current.rev)
    win.setDocumentPath(p)
  }

  const saveAs = async (): Promise<boolean> => {
    if (!fs.isDir(DIR)) await fs.mkdir(DIR, { recursive: true })
    const p = await os.dialog.saveFile({ defaultName: `${safeName(live.current.project.name)}.ktitr`, extensions: ['.ktitr'], startDir: DIR })
    if (!p) return false
    const target = /\.ktitr$/i.test(p) ? p : `${p}.ktitr`
    await writeFile(target, path.basename(target).replace(/\.ktitr$/i, ''))
    os.notify({ title: 'Titration saved', body: path.pretty(target) })
    return true
  }

  const save = async (): Promise<boolean> => {
    const p = live.current.filePath
    if (!p) return saveAs()
    await writeFile(p)
    os.notify({ title: 'Titration saved', body: path.pretty(p) })
    return true
  }

  const undo = () => { const p = hist.current.undo(live.current.project); if (p) { live.current.project = p; setProject(p); setRev((r) => r + 1); force((n) => n + 1) } }
  const redo = () => { const p = hist.current.redo(live.current.project); if (p) { live.current.project = p; setProject(p); setRev((r) => r + 1); force((n) => n + 1) } }

  // ------------------------------------------------------------ examples

  useEffect(() => {
    let alive = true
    void seedExampleFolder({ app: 'ktitration', folderName: EXAMPLES_FOLDER, fs }).then((files) => alive && setExampleFiles(files))
    return () => { alive = false }
  }, [])

  const openExampleFile = (f: ExampleFile) => void confirmDiscard().then(async (ok) => {
    if (!ok) return
    try {
      const p = parseKtitr(await fs.readText(f.path))
      load(p, null) // a copy: Save asks where to put it, the example file is left alone
    } catch (e) { await os.dialog.alert(`Could not open “${f.title}”: ${msgOf(e)}`, { title: 'Open example' }) }
  })

  const openExample = (id: string) => void confirmDiscard().then((ok) => {
    const ex = EXAMPLES.find((e) => e.id === id)
    if (ok && ex) load(structuredClone({ ...ex.project, name: ex.title, description: ex.description }), null)
  })

  // ------------------------------------------------------------ files: exports

  const saveText = async (defaultName: string, ext: string, text: string) => {
    try {
      if (!fs.isDir(DIR)) await fs.mkdir(DIR, { recursive: true })
      const p = await os.dialog.saveFile({ defaultName: `${safeName(defaultName)}${ext}`, extensions: [ext], startDir: DIR })
      if (!p) return
      await fs.writeText(p, text)
      os.notify({ title: 'Saved', body: path.pretty(p) })
    } catch (e) { await os.dialog.alert(msgOf(e), { title: 'Save' }) }
  }

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      os.notify({ title: `${what} copied`, body: 'On the clipboard.' })
    } catch {
      await os.dialog.alert('The browser did not allow copying. Select the text and copy it yourself.', { title: 'Copy' })
    }
  }

  const exportChart = async (format: 'png' | 'svg') => {
    const build = exportRef.current
    const fig = build ? build(LIGHT_PALETTE) : null
    if (!fig) { await os.dialog.alert('There is no chart to export on this tab.', { title: 'Export' }); return }
    try {
      const data = await renderImage(fig, format)
      if (!fs.isDir(DIR)) await fs.mkdir(DIR, { recursive: true })
      const p = await os.dialog.saveFile({ defaultName: `${safeName(live.current.project.name)}-${live.current.tab}.${format}`, extensions: [`.${format}`], startDir: DIR })
      if (!p) return
      if (typeof data === 'string') await fs.writeText(p, data)
      else await fs.writeBytes(p, data)
      os.notify({ title: 'Chart saved', body: path.pretty(p) })
    } catch (e) { await os.dialog.alert(`The chart could not be exported: ${msgOf(e)}`, { title: 'Export' }) }
  }

  const dataText = (): string | null => {
    const l = live.current
    if (l.tab === 'analyse') {
      const d = parseData(l.project.analyse.text).data
      return d.V.length ? d.V.map((v, i) => `${v}\t${d.pH[i]}`).join('\n') : null
    }
    return null
  }

  const exportCsv = () => {
    const l = live.current
    if (l.tab === 'analyse') {
      const text = l.project.analyse.text.trim() ? analysisCsv() : null
      if (text) void saveText(`${l.project.name} data`, '.csv', text)
      else void os.dialog.alert('There are no measured data to export.', { title: 'Export' })
      return
    }
    const r = computeResult(l.project)
    if (r.invalid) { void os.dialog.alert(r.invalid, { title: 'Export' }); return }
    void saveText(`${l.project.name} curve`, '.csv', curveCsv(r))
  }
  const analysisCsv = (): string => {
    const d = parseData(live.current.project.analyse.text).data
    const f = live.current.fit
    return ['V_mL,pH' + (f?.ok ? ',pH_fit,residual' : ''), ...d.V.map((v, i) => `${v},${d.pH[i]}${f?.ok ? `,${f.fitted[i].toFixed(5)},${f.residuals[i].toFixed(5)}` : ''}`)].join('\n') + '\n'
  }

  const exportReport = () => {
    const l = live.current
    if (l.tab === 'analyse') {
      const d = parseData(l.project.analyse.text).data
      if (!d.V.length) { void os.dialog.alert('There are no measured data to report.', { title: 'Report' }); return }
      void saveText(`${l.project.name} analysis`, '.md', analysisReport(l.project.name, d, [], l.project.analyse.setup, null, l.fit?.ok ? l.fit : null, l.project.analyse.source))
      return
    }
    void saveText(`${l.project.name} report`, '.md', titrationReport(l.project, computeResult(l.project), new Date().toISOString().slice(0, 10)))
  }

  const sendToKplot = (text: string, name: string) => {
    try { os.open('kplot', { text, name }) } catch (e) { void os.dialog.alert(`kPlot could not be opened: ${msgOf(e)}`, { title: 'kPlot' }) }
  }

  const openInKplot = () => {
    const l = live.current
    if (l.tab === 'analyse') {
      const t = dataText()
      if (t) sendToKplot('V (mL)\tpH\n' + t, l.project.name || 'Titration data')
      else void os.dialog.alert('There are no measured data to plot.', { title: 'kPlot' })
      return
    }
    const r = computeResult(l.project)
    if (r.invalid) { void os.dialog.alert(r.invalid, { title: 'kPlot' }); return }
    sendToKplot(`V (mL)\t${r.yShort}\td${r.yShort}/dV\n` + r.V.map((v, i) => `${v}\t${r.y[i]}\t${r.dy[i]}`).join('\n'), l.project.name || 'Titration curve')
  }

  const importData = async () => {
    const p = await os.dialog.openFile({ extensions: ['.csv', '.txt', '.tsv', '.dat'], startDir: fs.isDir(DIR) ? DIR : undefined })
    if (!p) return
    try {
      const text = await fs.readText(p)
      update((pr) => ({ ...pr, analyse: { ...pr.analyse, text, source: path.basename(p) } }))
      setTab('analyse')
    } catch (e) { await os.dialog.alert(msgOf(e), { title: 'Import' }) }
  }

  const pasteData = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) { await os.dialog.alert('The clipboard is empty.', { title: 'Paste' }); return }
      update((pr) => ({ ...pr, analyse: { ...pr.analyse, text } }))
      setTab('analyse')
    } catch {
      await os.dialog.alert('The browser did not allow reading the clipboard. Click in the data box and paste with ⌘V.', { title: 'Paste' })
      setTab('analyse')
    }
  }

  // ------------------------------------------------------------ moves between tabs

  const usePka = (e: PkaEntry, where: 'titration' | 'speciation' | 'buffer') => {
    update((p) => {
      if (where === 'titration') {
        const base = e.category === 'Amines and N-bases' || (e.category === 'Biological buffers' && e.z0 === 1)
        return {
          ...p, mode: 'acidbase',
          acidbase: { ...p.acidbase, items: [weakFrom(e, base ? e.pKa.length : 0, 0.1, 25)], titrant: base ? { kind: 'strong-acid', label: 'HCl', conc: 0.1 } : { kind: 'strong-base', label: 'NaOH', conc: 0.1 }, water: 0, indicator: base ? 'methylred' : 'phenolphthalein', vmax: null },
        }
      }
      if (where === 'speciation') return { ...p, speciation: { ...p.speciation, lib: e.id, sys: systemOf(e), forms: [...e.forms] } }
      const sys = systemOf(e)
      const bp = bestPair(sys, p.buffer.pH)
      const base = e.category === 'Amines and N-bases' || (e.category === 'Biological buffers' && e.z0 === 1)
      return { ...p, buffer: { ...p.buffer, lib: e.id, sys, forms: [...e.forms], formA: bp.formA, formB: bp.formB, mode: base ? 'base-acid' : 'acid-base' } }
    })
    setTab(where)
  }

  const useIndicator = (id: string) => {
    update((p) => ({ ...p, mode: 'acidbase', acidbase: { ...p.acidbase, indicator: id } }))
    os.notify({ title: 'Indicator in the flask', body: 'Open the Titration tab to see the colour change.' })
  }

  const titrateSpecies = (s: SpeciationSpec, form: number, direction: 'base' | 'acid') => {
    update((p) => ({ ...p, mode: 'acidbase', acidbase: { ...speciesTitration({ sys: s.sys, conc: s.conc, ionic: s.ionic, activity: s.activity, T: s.temperature }, form, direction), indicator: null } }))
    setTab('titration')
  }

  // ------------------------------------------------------------ window: title, close guard, size, menus

  useEffect(() => { win.setTitle(`kTitration — ${project.name}${dirty ? ' •' : ''}`) }, [win, project.name, dirty])

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

  useEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const openItem = (f: ExampleFile) => ({ label: f.title, onClick: () => openExampleFile(f) })
    const groups = groupExamples(exampleFiles)
    const exampleItems = exampleFiles.length > 0
      ? groups.map((g) => ({ label: g.group || 'Other', submenu: g.files.map(openItem) }))
      : [...new Set(EXAMPLES.map((e) => e.group))].map((g) => ({ label: g, submenu: EXAMPLES.filter((e) => e.group === g).map((e) => ({ label: e.title, onClick: () => openExample(e.id) })) }))
    const menus: MenuBarMenu[] = [
      {
        label: 'File',
        items: [
          { label: 'New', icon: FilePlus, shortcut: '⌘N', onClick: () => void newDocument() },
          { label: 'Open…', icon: FolderOpen, shortcut: '⌘O', onClick: () => void openDialog() },
          { label: 'Open Example', icon: Library, submenu: exampleItems },
          { label: 'Open Examples Folder', onClick: () => void seedExampleFolder({ app: 'ktitration', folderName: EXAMPLES_FOLDER, fs }).then((files) => { setExampleFiles(files); os.open('files', { path: exampleFolderPath(EXAMPLES_FOLDER) }) }) },
          '-',
          { label: 'Save', icon: Save, shortcut: '⌘S', onClick: () => void save().catch((e) => os.dialog.alert(msgOf(e))) },
          { label: 'Save As…', shortcut: '⇧⌘S', onClick: () => void saveAs().catch((e) => os.dialog.alert(msgOf(e))) },
          '-',
          { label: 'Import Titration Data…', icon: Download, onClick: () => void importData() },
          {
            label: 'Export', submenu: [
              { label: 'Chart as PNG…', onClick: () => void exportChart('png') },
              { label: 'Chart as SVG…', onClick: () => void exportChart('svg') },
              '-',
              { label: 'Data as CSV…', onClick: exportCsv },
              { label: 'Report as Markdown…', onClick: exportReport },
            ],
          },
          { label: 'Open in kPlot', onClick: openInKplot },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', icon: Undo2, shortcut: '⌘Z', disabled: !hist.current.canUndo, onClick: undo },
          { label: 'Redo', icon: Redo2, shortcut: '⇧⌘Z', disabled: !hist.current.canRedo, onClick: redo },
          '-',
          { label: 'Copy Results', onClick: () => void copy(factsText(computeResult(live.current.project)), 'Results') },
          { label: 'Paste Titration Data', onClick: () => void pasteData() },
        ],
      },
      {
        label: 'Titration',
        items: [
          { label: 'Acid–base', checked: project.mode === 'acidbase', onClick: () => { update((p) => ({ ...p, mode: 'acidbase' })); setTab('titration') } },
          { label: 'Redox', checked: project.mode === 'redox', onClick: () => { update((p) => ({ ...p, mode: 'redox' })); setTab('titration') } },
          { label: 'EDTA (complexometric)', checked: project.mode === 'edta', onClick: () => { update((p) => ({ ...p, mode: 'edta' })); setTab('titration') } },
          { label: 'Precipitation', checked: project.mode === 'precip', onClick: () => { update((p) => ({ ...p, mode: 'precip' })); setTab('titration') } },
          '-',
          { label: 'Fit the Model to the Data', shortcut: '⌘R', disabled: !project.analyse.text.trim(), onClick: () => { setTab('analyse'); runFit() } },
          '-',
          { label: 'Marks', checked: prefs.marks, onClick: () => setPrefs({ marks: !prefs.marks }) },
          { label: 'Buffer Regions', checked: prefs.buffers, onClick: () => setPrefs({ buffers: !prefs.buffers }) },
          { label: 'Indicator Band', checked: prefs.band, onClick: () => setPrefs({ band: !prefs.band }) },
          { label: 'Derivatives', checked: prefs.derivs, onClick: () => setPrefs({ derivs: !prefs.derivs }) },
        ],
      },
      {
        label: 'View',
        items: TABS.map((t, i) => ({ label: t.label, shortcut: `⌘${i + 1}`, checked: tab === t.id, onClick: () => setTab(t.id) })),
      },
      {
        label: 'Help',
        items: [
          { label: 'Keyboard Shortcuts', icon: BookOpen, onClick: () => void os.dialog.alert(SHORTCUTS, { title: 'kTitration shortcuts' }) },
          { label: 'How to Use kTitration', onClick: () => void os.dialog.alert(HELP, { title: 'kTitration' }) },
          { label: 'About the Model', onClick: () => void os.dialog.alert(ABOUT, { title: 'The model behind the curves' }) },
        ],
      },
    ]
    win.setMenus(menus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.mode, project.analyse.text, tab, prefs, rev, exampleFiles])

  // ------------------------------------------------------------ keyboard

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod || e.altKey) return
    const k = e.key.toLowerCase()
    const typing = !!(e.target as HTMLElement).closest('input, textarea, select')
    if (k === 's') { e.preventDefault(); void (e.shiftKey ? saveAs() : save()).catch((x) => os.dialog.alert(msgOf(x))); return }
    if (k === 'o') { e.preventDefault(); void openDialog(); return }
    if (k === 'n') { e.preventDefault(); void newDocument(); return }
    if (k === 'r') { e.preventDefault(); if (live.current.project.analyse.text.trim()) { setTab('analyse'); runFit() } return }
    if (/^[1-6]$/.test(k)) { e.preventDefault(); setTab(TABS[Number(k) - 1].id); return }
    if (typing) return
    if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
    if (k === 'y') { e.preventDefault(); redo() }
  }

  // ------------------------------------------------------------ AI tools

  const hooks: Hooks = {
    state: () => ({ project: currentDoc(), dirty: live.current.rev !== live.current.savedRev, fit: live.current.fit }),
    apply: (p, opts) => load(p, null, { dirty: true, runFit: opts?.runFit }),
  }
  useAppTools(win, ktitrationTools(hooks))

  // ------------------------------------------------------------ render

  const stale = fit !== null && fitKey !== JSON.stringify([project.analyse.text, project.analyse.setup])
  const first = result.invalid ? null : result.eq[0]

  return (
    <div className="k-app ti-app" ref={root} tabIndex={-1} data-size={compact ? 's' : width < 1150 ? 'm' : 'l'} onKeyDown={onKeyDown}>
      <div className="ti-tabs" role="tablist" aria-label="kTitration sections">
        {TABS.map((t, i) => {
          const Icon = TAB_ICONS[t.id]
          return (
            <button key={t.id} role="tab" id={`ti-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="ti-panel" className={tab === t.id ? 'on' : ''} title={`${t.label} (⌘${i + 1})`} onClick={() => setTab(t.id)}>
              <Icon size={13} /> <span className="ti-tab-label">{t.label}</span>
            </button>
          )
        })}
        <span className="ti-spacer" />
        <button type="button" className="k-icon-btn" aria-label="Undo" title="Undo (⌘Z)" disabled={!hist.current.canUndo} onClick={undo}><Undo2 size={14} /></button>
        <button type="button" className="k-icon-btn" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!hist.current.canRedo} onClick={redo}><Redo2 size={14} /></button>
        <button type="button" className="k-icon-btn" aria-label="Save" title="Save (⌘S)" onClick={() => void save().catch((e) => os.dialog.alert(msgOf(e)))}><Save size={14} /></button>
      </div>
      <div className="ti-panel" id="ti-panel" role="tabpanel" aria-labelledby={`ti-tab-${tab}`}>
        <Boundary key={`${tab}-${docKey}`} label={TABS.find((t) => t.id === tab)?.label ?? 'this tab'} onReset={() => load(newProject(), null)}>
        {tab === 'titration' && (
          <TitrationTab project={project} result={result} update={update} docKey={docKey} prefs={prefs} setPrefs={setPrefs} exportRef={exportRef} copy={(t, w) => void copy(t, w)} compact={compact} />
        )}
        {tab === 'speciation' && <SpeciationTab project={project} update={update} exportRef={exportRef} compact={compact} onTitrate={titrateSpecies} />}
        {tab === 'analyse' && (
          <AnalyseTab
            project={project} update={update} fit={fit} fitStale={stale} fitting={fitting} onFit={() => runFit()} exportRef={exportRef} compact={compact}
            onImport={() => void importData()} onPaste={() => void pasteData()} onSaveText={(n, e, t) => void saveText(n, e, t)} onCopy={(t, w) => void copy(t, w)} onKplot={sendToKplot}
          />
        )}
        {tab === 'buffer' && <BufferTab project={project} update={update} exportRef={exportRef} compact={compact} onCopy={(t, w) => void copy(t, w)} onSaveText={(n, e, t) => void saveText(n, e, t)} />}
        {tab === 'indicators' && <IndicatorTab project={project} result={result} update={update} exportRef={exportRef} compact={compact} onUse={() => undefined} />}
        {tab === 'reference' && <ReferenceTab onUsePka={usePka} onUseIndicator={useIndicator} />}
        </Boundary>
      </div>
      <div className="k-statusbar ti-status">
        <span>{project.name}{dirty ? ' (unsaved)' : ''}</span>
        {tab === 'titration' && result.invalid === null && first && <span>{result.title}: first equivalence at {first.V.toFixed(2)} mL ({result.yShort} {first.y.toFixed(2)})</span>}
        {tab === 'analyse' && fit?.ok && <span>Fit: c = {fit.Ca.toPrecision(4)} M{fit.pKa.length ? `, pKa ${fit.pKa.map((x) => x.toFixed(2)).join(', ')}` : ''}{stale ? ' (out of date)' : ''}</span>}
        <span className="ti-spacer" />
        <span title="Unicode search of the databases is in the Reference tab"><Search size={11} /> {TABS.find((t) => t.id === tab)?.label}</span>
      </div>
    </div>
  )
}

const SHORTCUTS = [
  '⌘1 … ⌘6 switch tab · ⌘N new · ⌘O open · ⌘S save · ⇧⌘S save as',
  '⌘Z undo · ⇧⌘Z redo · ⌘R fit the model to the data',
  'Titration tab: D adds a drop (0.05 mL) · A adds the chosen step · − takes a step back · R back to zero · Space pours continuously',
  'Quiz: 1–4 pick an answer · Enter next question',
  'Pickers: type to search, ↑ ↓ to move, Enter to choose, Esc to close',
].join('\n\n')

const HELP = [
  'Titration: choose the kind (acid–base, redox, EDTA, precipitation) and describe the flask and the burette. The curve, its equivalence points, half-equivalence points and buffer regions appear at once. Add an indicator to see the colour band on the curve and the colour of the flask.',
  'Burette: pour titrant with the slider, the Add and Drop buttons or Play, and watch the pH meter, the flask colour and the species in the flask. Practice gives you an unknown to titrate by hand; Quiz asks questions computed from the model.',
  'Speciation: α diagram, log C–pH (Sillén) diagram and buffer capacity for any acid or base, with temperature and ionic-strength corrections.',
  'Analyse data: paste volume and pH columns (or import a file). kTitration finds the equivalence points from the smoothed derivatives, draws Gran plots and fits the exact model for the concentration and the pKa values, with standard errors and residuals.',
  'Buffer designer: target pH, concentration, ionic strength and temperature give the exact amounts and the volumes of your stock solutions.',
  'Indicator chooser: every indicator against the steep part of your curve, with its titration error. Reference: the pKa, indicator, potential, EDTA and solubility tables.',
].join('\n\n')

const ABOUT = [
  'Acid–base: for every volume of titrant the charge balance Σ zᵢcᵢ + [H⁺] − [OH⁻] = 0 is solved exactly for the pH (Brent’s method), with dilution. Nothing is approximated by “weak acid before the equivalence point” formulas. With an activity model (Davies or extended Debye–Hückel) the ionic strength is iterated to self-consistency and the pKa values are corrected: the pH shown is −log a(H⁺).',
  'Redox: the potential comes from the Nernst equation of both couples and the electron balance, solved exactly. The equivalence potential is the weighted mean of the formal potentials when each couple has one reduced species.',
  'EDTA: the conditional constant K′ = K·α(Y⁴⁻)/α(M) with hydroxo and ammine side reactions, and the exact mass balance for pM. Precipitation: the free silver (or thiocyanate) from the exact mass balance with every solid in equilibrium.',
  'Limits: carbon dioxide exchange with the air, ion pairing and activity coefficients above I ≈ 0.5 M are not modelled. The database values are typical literature values to 0.01–0.05 pK units.',
].join('\n\n')
