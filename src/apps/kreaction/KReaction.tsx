// kReaction — a workbench for molecular reactions: build and check a reaction (names, SMILES, balance, RDKit
// pictures), a library of ~50 reactions with mechanisms, a step-by-step mechanism viewer, product prediction with
// reaction templates, a kinetics simulator with data analysis, energy profiles, thermodynamics and equilibrium,
// and a notebook. Everything is saved in .kreact files. The chemistry is in the pure modules next to this file.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowRightLeft, BookOpen, Clock3, NotebookPen, Sparkles, Workflow, Zap, type LucideIcon } from 'lucide-react'
import { os, HOME, path as ospath, type AppProps, type MenuBarMenu } from '@/os'
import { useAppTools } from '@/os/ai/appTools'
import { exampleFolderPath, groupExamples, seedExampleFolder, type ExampleFile } from '@/os/exampleFiles'
import { kreactionTools } from './aiTools'
import { BuilderTool } from './BuilderTool'
import { EnergyTool, profileOfReaction } from './EnergyTool'
import { dataUrlToBytes, svgToPng } from './files'
import { KineticsTool } from './KineticsTool'
import { LibraryTool } from './LibraryTool'
import { MechanismTool } from './MechanismTool'
import { newEntry, entryText, toMarkdown, toPlainText, MAX_ENTRIES, type NotebookEntry } from './notebook'
import { NotebookTool } from './NotebookTool'
import { svgFromDataUrl } from './PlotlyChart'
import { PredictTool } from './PredictTool'
import { currentRDKit, loadRDKit, useRDKit } from './rdkit'
import { analyseReaction } from './reaction'
import { reportMarkdown } from './report'
import { findReaction } from './library'
import { nameOfSmiles } from './compounds'
import { printSvg, resolveHooks } from './structures'
import { KrContext, type KrApi } from './ui'
import { defaultWorkspace, parseWorkspace, serializeWorkspace, TOOL_IDS, type ToolId, type Workspace } from './workspace'
import './kreaction.css'

interface ToolDef {
  id: ToolId
  label: string
  icon: LucideIcon
}

const TOOLS: ToolDef[] = [
  { id: 'builder', label: 'Reaction builder', icon: ArrowRightLeft },
  { id: 'library', label: 'Reaction library', icon: BookOpen },
  { id: 'mechanism', label: 'Mechanism', icon: Workflow },
  { id: 'predict', label: 'Predict products', icon: Sparkles },
  { id: 'kinetics', label: 'Kinetics', icon: Clock3 },
  { id: 'energy', label: 'Energy & equilibrium', icon: Zap },
  { id: 'notebook', label: 'Notebook', icon: NotebookPen },
]

const PREFS_KEY = 'kherveos.kreaction.prefs'
const NOTEBOOK_KEY = 'kherveos.kreaction.notebook'
const RECENT_KEY = 'kherveos.kreaction.recent'
const SIG_CHOICES = [3, 4, 5, 6, 8]
const EXAMPLES_FOLDER = 'kReaction Examples'

interface Prefs {
  tool: ToolId
  sig: number
}

function loadPrefs(): Prefs {
  const d: Prefs = { tool: 'builder', sig: 4 }
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    return {
      tool: TOOL_IDS.includes(raw.tool as ToolId) ? (raw.tool as ToolId) : d.tool,
      sig: typeof raw.sig === 'number' && raw.sig >= 2 && raw.sig <= 10 ? Math.round(raw.sig) : d.sig,
    }
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

function loadNotebook(): NotebookEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(NOTEBOOK_KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .filter((e): e is NotebookEntry => !!e && typeof e === 'object' && typeof (e as NotebookEntry).id === 'string' && typeof (e as NotebookEntry).text === 'string')
      .map((e) => ({ id: e.id, label: String(e.label ?? ''), tool: String(e.tool ?? ''), text: e.text, time: Number(e.time) || 0, svgs: Array.isArray(e.svgs) ? e.svgs.filter((s) => typeof s === 'string') : undefined }))
      .slice(-MAX_ENTRIES)
  } catch {
    return []
  }
}

function saveNotebook(entries: NotebookEntry[]) {
  try {
    localStorage.setItem(NOTEBOOK_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)))
  } catch {
    /* full or private: the notebook stays in memory */
  }
}

function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, 8) : []
  } catch {
    return []
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)))
  } catch {
    /* private mode */
  }
}

const HELP = [
  'SPECIES. Type a name from the built-in table (about 200: ethanol, acetic acid, sodium chloride…), a SMILES string, or a molecular formula.',
  'SMILES. Atoms in the organic subset (B C N O P S F Cl Br I) need no brackets and get their hydrogens automatically: CCO is ethanol, CC(=O)O acetic acid, c1ccccc1 benzene, C=C ethene, C#N hydrogen cyanide. Branches use ( ), rings use digits (C1CCCCC1), "." separates fragments. Anything else goes in brackets with its charge: [Na+], [OH-], [Fe+3], [NH4+], [Cu].',
  'FORMULAS. H2O, Fe2O3, Ca(OH)2, CuSO4·5H2O, SO4^2-, Fe3+. A text that is also valid SMILES (CO, NO, CN) is read as SMILES: use a name (carbon monoxide) or brackets ([C-]#[O+]) for the other meaning.',
  'COEFFICIENTS. Edit them by hand or press Balance for the smallest whole numbers (exact arithmetic). The check shows atoms, mass and charge.',
  'KINETICS SYNTAX. "A = 1" initial concentration, "fixed B = 3" held constant, "A + B -> C ; k = 0.1", "A <=> B ; kf = 2, kr = 0.5" (or K = 4), Arrhenius "; A = 1e8, Ea = 50" with a line "T = 298" (Ea in kJ/mol), "0 -> A ; k = 0.01" a source. Mass-action rates; a species on both sides is a catalyst.',
  'EQUILIBRIUM. "N2O4 <=> 2 NO2" with initial amounts "N2O4 = 0.1" and K. Mark pure solids and liquids with (s) or (l).',
  'FILES. A .kreact file holds the whole workspace: reaction, network, energy profile, equilibrium and notebook.',
].join('\n\n')

export default function KReaction({ win, args }: AppProps) {
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const [ws, setWs] = useState<Workspace>(() => ({ ...defaultWorkspace(), tool: loadPrefs().tool, notebook: loadNotebook() }))
  const [filePath, setFilePath] = useState<string | null>(null)
  const [recent, setRecent] = useState<string[]>(loadRecent)
  // the example workspaces copied to ~/Documents/kReaction Examples (File > Open example)
  const [exampleFiles, setExampleFiles] = useState<ExampleFile[]>([])
  useEffect(() => {
    let alive = true
    void seedExampleFolder({ app: 'kreaction', folderName: EXAMPLES_FOLDER, fs: os.fs }).then((files) => alive && setExampleFiles(files))
    return () => { alive = false }
  }, [])
  const [flash, setFlash] = useState('')
  const { rd, status: rdStatus } = useRDKit()

  const wsRef = useRef(ws)
  wsRef.current = ws
  const filePathRef = useRef(filePath)
  filePathRef.current = filePath
  const dirty = useRef(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // the current result of each tool, for Edit > Copy result and Pin result
  const results = useRef<Partial<Record<ToolId, { text: string; label: string; svgs?: () => string[] }>>>({})

  const sig = prefs.sig
  const tool = ws.tool

  const say = useCallback((m: string) => {
    setFlash(m)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(''), 3500)
  }, [])
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])

  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((old) => {
      const next = { ...old, ...p }
      savePrefs(next)
      return next
    })
  }, [])

  // ---------------------------------------------------------------- state

  const update = useCallback((fn: (w: Workspace) => Workspace) => {
    dirty.current = true
    setWs(fn)
  }, [])

  const patch = useCallback<KrApi['patch']>(
    (key, p) => {
      dirty.current = true
      setWs((w) => ({ ...w, [key]: { ...w[key], ...p } }))
    },
    [],
  )

  const go = useCallback(
    (id: ToolId) => {
      setWs((w) => ({ ...w, tool: id }))
      setPrefs({ tool: id })
    },
    [setPrefs],
  )

  const copy = useCallback(
    (text: string) => {
      const done = () => say('Copied to the clipboard')
      const fallback = () => {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        try {
          document.execCommand('copy')
          done()
        } catch {
          say('Could not copy')
        }
        ta.remove()
      }
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback)
      else fallback()
    },
    [say],
  )

  // ---------------------------------------------------------------- notebook

  const commitNotebook = useCallback((fn: (list: NotebookEntry[]) => NotebookEntry[]) => {
    dirty.current = true
    setWs((w) => {
      const notebook = fn(w.notebook)
      saveNotebook(notebook)
      return { ...w, notebook }
    })
  }, [])

  const pin = useCallback<KrApi['pin']>(
    async (toolName, defaultLabel, text, svgs = []) => {
      if (!text.trim()) return
      const label = await os.dialog.prompt('Label for this result', { title: 'Pin to the notebook', defaultValue: defaultLabel, okLabel: 'Pin' })
      if (label === null) return
      commitNotebook((list) => [...list, newEntry(toolName, label, text, svgs)])
      say('Pinned to the notebook')
    },
    [commitNotebook, say],
  )

  const report = useCallback<KrApi['report']>((id, text, label, svgs) => {
    results.current[id] = { text, label, svgs }
  }, [])

  // ---------------------------------------------------------------- pictures and files

  const saveImage = useCallback<KrApi['saveImage']>(
    async (name, data, format) => {
      const ext = format === 'svg' ? '.svg' : '.png'
      const target = await os.dialog.saveFile({ title: `Save the picture (${format.toUpperCase()})`, extensions: [ext], defaultName: `${HOME}/Documents/${name}${ext}` })
      if (!target) return
      try {
        if (format === 'svg') await os.fs.writeText(target, data.startsWith('data:') ? svgFromDataUrl(data) : data, { mkdirs: true })
        else await os.fs.writeBytes(target, data.startsWith('data:') ? dataUrlToBytes(data) : await svgToPng(data), { mkdirs: true })
        os.notify({ title: 'Picture saved', body: target })
      } catch (e) {
        void os.dialog.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`, { title: 'kReaction' })
      }
    },
    [],
  )

  /** The Markdown report of the reaction in the builder (structures embedded as SVG). */
  const buildReport = useCallback(async (): Promise<string> => {
    const mod = currentRDKit() ?? (await loadRDKit())
    const b = wsRef.current.builder
    const rows = [...b.reactants, ...b.products]
    const coeffs = b.coeffs && b.coeffs.length === rows.length ? b.coeffs.filter((_, i) => rows[i].trim() !== '') : null
    const analysis = analyseReaction({ reactants: b.reactants, products: b.products, arrow: b.arrow, above: b.above, below: b.below }, resolveHooks(mod), coeffs)
    const svgs = new Map<string, string>()
    if (mod) {
      for (const s of [...analysis.reactants, ...analysis.products]) {
        if (!s.smiles) continue
        const svg = printSvg(mod, s.smiles, 300, 220)
        if (svg) svgs.set(s.smiles, svg)
      }
    }
    const lib = b.fromId ? findReaction(b.fromId) : null
    const sections = lib ? [{ heading: 'About this reaction', body: `${lib.explanation}\n\nReagents: ${lib.above || '—'}. Conditions: ${lib.below || '—'}.` }] : []
    return reportMarkdown({ title: lib?.name ?? 'Reaction report', analysis, input: b, coeffs, svgs, sections })
  }, [])

  const exportReport = useCallback(async () => {
    const b = wsRef.current.builder
    if (b.reactants.every((r) => r.trim() === '') || b.products.every((r) => r.trim() === '')) {
      void os.dialog.alert('Enter the reactants and products in the Reaction builder first.', { title: 'kReaction' })
      return
    }
    const target = await os.dialog.saveFile({ title: 'Save the reaction report', extensions: ['.md', '.txt'], defaultName: `${HOME}/Documents/reaction-report.md` })
    if (!target) return
    try {
      await os.fs.writeText(target, await buildReport(), { mkdirs: true })
      os.notify({ title: 'Report saved', body: target })
    } catch (e) {
      void os.dialog.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`, { title: 'kReaction' })
    }
  }, [buildReport])

  // ---------------------------------------------------------------- reactions in and out of the builder

  const setReaction = useCallback<KrApi['setReaction']>(
    (r, show) => {
      update((w) => ({
        ...w,
        tool: show ? 'builder' : w.tool,
        builder: {
          reactants: r.reactants.length ? r.reactants : [''],
          products: r.products.length ? r.products : [''],
          arrow: r.arrow ?? 'forward',
          above: r.above ?? '',
          below: r.below ?? '',
          coeffs: r.coeffs ?? null,
          fromId: null,
        },
      }))
      if (show) setPrefs({ tool: 'builder' })
    },
    [update, setPrefs],
  )

  const loadReaction = useCallback<KrApi['loadReaction']>(
    (id, into) => {
      const r = findReaction(id)
      if (!r) return
      if (into === 'builder') {
        // species are shown by name when the table knows them
        const label = (s: string) => nameOfSmiles(s) ?? s
        update((w) => ({
          ...w,
          tool: 'builder',
          builder: { reactants: r.reactants.map(label), products: r.products.map(label), arrow: r.arrow, above: r.above, below: r.below, coeffs: r.coeffs, fromId: r.id },
        }))
        setPrefs({ tool: 'builder' })
      } else if (into === 'mechanism') {
        if (!r.mechanism) return say('This reaction has no mechanism in the library.')
        update((w) => ({ ...w, tool: 'mechanism', mechanism: { reactionId: r.id, step: 0 } }))
        setPrefs({ tool: 'mechanism' })
      } else {
        const profile = profileOfReaction(id)
        if (!profile) return say('No energy data for this reaction.')
        update((w) => ({ ...w, tool: 'energy', energy: { ...w.energy, tab: 'profile', profile, source: id } }))
        setPrefs({ tool: 'energy' })
      }
    },
    [update, setPrefs, say],
  )

  // ---------------------------------------------------------------- .kreact files

  const remember = useCallback((p: string) => {
    setRecent((old) => {
      const next = [p, ...old.filter((x) => x !== p)].slice(0, 8)
      saveRecent(next)
      return next
    })
  }, [])

  const confirmDiscard = useCallback(async (): Promise<boolean> => {
    if (!dirty.current) return true
    return os.dialog.confirm('Discard the changes made since the last save?', { title: 'kReaction', okLabel: 'Discard' })
  }, [])

  const newFile = useCallback(async () => {
    if (!(await confirmDiscard())) return
    const keepNotebook = wsRef.current.notebook
    setWs({ ...defaultWorkspace(), tool: 'builder', builder: { reactants: [''], products: [''], arrow: 'forward', above: '', below: '', coeffs: null, fromId: null }, notebook: keepNotebook })
    setFilePath(null)
    win.setDocumentPath(null)
    dirty.current = false
  }, [confirmDiscard, win])

  const loadPath = useCallback(
    async (p: string) => {
      try {
        const { workspace, warnings } = parseWorkspace(await os.fs.readText(p))
        setWs(workspace)
        saveNotebook(workspace.notebook)
        setFilePath(p)
        win.setDocumentPath(p)
        remember(p)
        dirty.current = false
        setPrefs({ tool: workspace.tool })
        if (warnings.length) say(warnings[0])
      } catch (e) {
        void os.dialog.alert(`Could not open ${ospath.basename(p)}: ${e instanceof Error ? e.message : String(e)}`, { title: 'kReaction' })
      }
    },
    [win, remember, setPrefs, say],
  )

  const openFile = useCallback(async () => {
    if (!(await confirmDiscard())) return
    const p = await os.dialog.openFile({ title: 'Open a kReaction file', extensions: ['.kreact'] })
    if (p) await loadPath(p)
  }, [confirmDiscard, loadPath])

  const writeTo = useCallback(
    async (p: string) => {
      try {
        await os.fs.writeText(p, serializeWorkspace(wsRef.current), { mkdirs: true })
        setFilePath(p)
        win.setDocumentPath(p)
        remember(p)
        dirty.current = false
        say(`Saved ${ospath.basename(p)}`)
      } catch (e) {
        void os.dialog.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`, { title: 'kReaction' })
      }
    },
    [win, remember, say],
  )

  const saveAs = useCallback(async () => {
    const name = filePathRef.current ? ospath.basename(filePathRef.current) : 'reaction.kreact'
    const p = await os.dialog.saveFile({ title: 'Save the workspace', extensions: ['.kreact'], defaultName: `${HOME}/Documents/${name}` })
    if (p) await writeTo(p.toLowerCase().endsWith('.kreact') ? p : `${p}.kreact`)
  }, [writeTo])

  const save = useCallback(async () => {
    if (filePathRef.current) await writeTo(filePathRef.current)
    else await saveAs()
  }, [writeTo, saveAs])

  useEffect(() => {
    if (typeof args.path === 'string') void loadPath(args.path)
    // opened once with these arguments
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    win.setCloseGuard(async () => {
      if (!dirty.current) return true
      return os.dialog.confirm('This workspace has changes that are not saved in a .kreact file. Close anyway?', { title: 'kReaction', okLabel: 'Close' })
    })
    return () => win.setCloseGuard(null)
  }, [win])

  // ---------------------------------------------------------------- notebook actions

  const exportNotebook = useCallback(async () => {
    const list = wsRef.current.notebook
    if (list.length === 0) return void os.dialog.alert('The notebook is empty: pin a result first.', { title: 'kReaction' })
    const target = await os.dialog.saveFile({ title: 'Export the notebook', defaultName: `${HOME}/Documents/kreaction-notebook.md`, extensions: ['.md', '.txt'] })
    if (!target) return
    try {
      await os.fs.writeText(target, target.toLowerCase().endsWith('.txt') ? toPlainText(list) : toMarkdown(list), { mkdirs: true })
      os.notify({ title: 'Notebook exported', body: target })
    } catch (e) {
      void os.dialog.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`, { title: 'kReaction' })
    }
  }, [])

  const notebook = useMemo(
    () => ({
      copyEntry: (e: NotebookEntry) => copy(entryText(e)),
      copyAll: (f: 'md' | 'txt') => copy(f === 'md' ? toMarkdown(wsRef.current.notebook) : toPlainText(wsRef.current.notebook)),
      rename: async (e: NotebookEntry) => {
        const label = await os.dialog.prompt('Label', { title: 'Rename', defaultValue: e.label })
        if (label !== null && label.trim()) commitNotebook((list) => list.map((x) => (x.id === e.id ? { ...x, label: label.trim() } : x)))
      },
      remove: (e: NotebookEntry) => commitNotebook((list) => list.filter((x) => x.id !== e.id)),
      clear: async () => {
        if (await os.dialog.confirm('Remove every pinned result from the notebook?', { title: 'Clear the notebook', okLabel: 'Clear' })) commitNotebook(() => [])
      },
      exportAs: () => void exportNotebook(),
    }),
    [copy, commitNotebook, exportNotebook],
  )

  // ---------------------------------------------------------------- AI tools

  const rdPromise = useCallback(async () => currentRDKit() ?? (await loadRDKit()), [])
  useAppTools(win, kreactionTools({
    ws: () => wsRef.current,
    update,
    go,
    loadReaction,
    setReaction,
    rd: rdPromise,
    reportText: buildReport,
  }))

  // ---------------------------------------------------------------- menus and keys

  useEffect(() => {
    const name = filePath ? ` — ${ospath.basename(filePath)}` : ''
    win.setTitle(`kReaction${name} — ${TOOLS.find((t) => t.id === tool)?.label ?? ''}`)
  }, [win, tool, filePath])

  const current = useCallback(() => results.current[wsRef.current.tool] ?? null, [])
  const copyResult = useCallback(() => {
    const c = current()
    if (c && c.text) copy(c.text)
    else say('Nothing to copy here')
  }, [current, copy, say])
  const pinResult = useCallback(() => {
    const c = current()
    if (c && c.text) void pin(TOOLS.find((t) => t.id === wsRef.current.tool)?.label ?? 'kReaction', c.label, c.text, c.svgs?.())
    else say('Nothing to pin here')
  }, [current, pin, say])

  const noteCount = ws.notebook.length
  useEffect(() => {
    const menus: MenuBarMenu[] = [
      {
        label: 'File',
        items: [
          { label: 'New', shortcut: '⌘N', onClick: () => void newFile() },
          { label: 'Open…', shortcut: '⌘O', onClick: () => void openFile() },
          {
            label: 'Open recent',
            disabled: recent.length === 0,
            submenu: recent.map((p) => ({ label: ospath.basename(p), onClick: () => void confirmDiscard().then((ok) => { if (ok) void loadPath(p) }) })),
          },
          {
            label: 'Open example',
            disabled: exampleFiles.length === 0,
            submenu: groupExamples(exampleFiles).map((g) => ({
              label: g.group || 'Examples',
              submenu: g.files.map((f) => ({ label: f.title, onClick: () => void confirmDiscard().then((ok) => { if (ok) void loadPath(f.path) }) })),
            })),
          },
          { label: 'Open examples folder', onClick: () => void seedExampleFolder({ app: 'kreaction', folderName: EXAMPLES_FOLDER, fs: os.fs }).then((files) => { setExampleFiles(files); os.open('files', { path: exampleFolderPath(EXAMPLES_FOLDER) }) }) },
          '-',
          { label: 'Save', shortcut: '⌘S', onClick: () => void save() },
          { label: 'Save as…', shortcut: '⇧⌘S', onClick: () => void saveAs() },
          '-',
          { label: 'Export reaction report…', shortcut: '⌘E', onClick: () => void exportReport() },
          { label: 'Export notebook…', disabled: noteCount === 0, onClick: () => void exportNotebook() },
          '-',
          { label: 'Close', onClick: () => win.close() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Copy result', shortcut: '⌥C', onClick: copyResult },
          { label: 'Pin result to the notebook', shortcut: '⌘D', onClick: pinResult },
          '-',
          { label: 'Clear the notebook', disabled: noteCount === 0, danger: true, onClick: () => void notebook.clear() },
        ],
      },
      {
        label: 'Tools',
        items: TOOLS.map((t, i) => ({ label: t.label, icon: t.icon, shortcut: `⌥${i + 1}`, checked: t.id === tool, onClick: () => go(t.id) })),
      },
      {
        label: 'Settings',
        items: SIG_CHOICES.map((n) => ({ label: `${n} significant figures`, checked: prefs.sig === n, onClick: () => setPrefs({ sig: n }) })),
      },
      {
        label: 'Help',
        items: [{ label: 'SMILES, formulas and syntax', onClick: () => void os.dialog.alert(HELP, { title: 'kReaction — syntax' }) }],
      },
    ]
    win.setMenus(menus)
  }, [win, tool, recent, exampleFiles, noteCount, prefs.sig, newFile, openFile, save, saveAs, exportReport, exportNotebook, copyResult, pinResult, notebook, go, setPrefs, loadPath, confirmDiscard])
  useEffect(() => () => win.setMenus(null), [win])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.metaKey || e.ctrlKey
    const stop = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    const digit = /^Digit(\d)$/.exec(e.code)
    if (digit && (e.altKey || mod) && !e.shiftKey && Number(digit[1]) >= 1 && Number(digit[1]) <= TOOLS.length) {
      stop()
      go(TOOLS[Number(digit[1]) - 1].id)
    } else if (mod && !e.altKey && e.key.toLowerCase() === 's') {
      stop()
      void (e.shiftKey ? saveAs() : save())
    } else if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'o') {
      stop()
      void openFile()
    } else if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'n') {
      stop()
      void newFile()
    } else if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'd') {
      stop()
      pinResult()
    } else if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'e') {
      stop()
      void exportReport()
    } else if (e.altKey && !mod && e.code === 'KeyC') {
      stop()
      copyResult()
    }
  }

  const api = useMemo<KrApi>(
    () => ({
      ws, update, patch, rd, rdStatus, sig, go, say, copy, pin: (t, l, x, s) => void pin(t, l, x, s), report, saveImage: (n, d, f) => void saveImage(n, d, f),
      loadReaction, setReaction, exportReport: () => void exportReport(),
    }),
    [ws, update, patch, rd, rdStatus, sig, go, say, copy, pin, report, saveImage, loadReaction, setReaction, exportReport],
  )

  const active = TOOLS.find((t) => t.id === tool) ?? TOOLS[0]

  return (
    <KrContext.Provider value={api}>
      <div className="k-app kr-app" onKeyDown={onKeyDown}>
        <div className="kr-body">
          <nav className="kr-side" aria-label="kReaction tools">
            {TOOLS.map((t) => (
              <button key={t.id} className={`kr-nav ${t.id === tool ? 'on' : ''}`} onClick={() => go(t.id)} title={t.label} aria-current={t.id === tool ? 'page' : undefined}>
                <t.icon size={16} />
                <span className="kr-nav-label">{t.label}</span>
                {t.id === 'notebook' && noteCount > 0 && <span className="kr-count">{noteCount}</span>}
              </button>
            ))}
          </nav>
          <main className="kr-main">
            {tool === 'builder' && <BuilderTool />}
            {tool === 'library' && <LibraryTool />}
            {tool === 'mechanism' && <MechanismTool />}
            {tool === 'predict' && <PredictTool />}
            {tool === 'kinetics' && <KineticsTool />}
            {tool === 'energy' && <EnergyTool />}
            {tool === 'notebook' && <NotebookTool a={notebook} />}
          </main>
        </div>
        <div className="k-statusbar">
          <span>{active.label}</span>
          <span className="kr-flash">{flash}</span>
          <span className="k-spacer" style={{ flex: 1 }} />
          <span className="k-muted" title="The structures and the reaction engine are RDKit">
            {rdStatus === 'ready' ? 'RDKit ready' : rdStatus === 'failed' ? 'RDKit unavailable: no pictures' : 'loading RDKit…'}
          </span>
          <label className="kr-sig">
            Significant figures
            <select className="k-input kr-sigsel" value={sig} aria-label="Significant figures" onChange={(e) => setPrefs({ sig: Number(e.target.value) })}>
              {SIG_CHOICES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
      </div>
    </KrContext.Provider>
  )
}
