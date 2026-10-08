// kChem — the chemistry you do at the bench: formulas and molar masses (with isotope patterns and
// empirical formulas), an equation balancer, stoichiometry with the limiting reagent, solutions and
// dilutions, acids and pH, gases, the periodic table, a unit converter and a notebook of pinned
// results. Every number updates as you type.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  ArrowRightLeft, Beaker, Droplets, FlaskConical, Grid3x3, NotebookPen, Repeat, Scale, TestTube, Wind, type LucideIcon,
} from 'lucide-react'
import { os, HOME, type AppProps, type MenuBarMenu } from '@/os'
import { useAppTools } from '@/os/ai/appTools'
import { getSigFigs, setSigFigs } from './chem'
import { kchemTools } from './aiTools'
import { AcidsTool } from './AcidsTool'
import { BalanceTool } from './BalanceTool'
import { ConverterTool } from './ConverterTool'
import { DilutionTool } from './DilutionTool'
import { FormulaTool } from './FormulaTool'
import { GasesTool } from './GasesTool'
import { NotebookTool } from './NotebookTool'
import { PeriodicTool } from './PeriodicTool'
import { SolutionsTool } from './SolutionsTool'
import { StoichTool } from './StoichTool'
import { DEFAULT_FORMS, type Forms } from './forms'
import { loadNotebook, newEntry, saveNotebook, toMarkdown, toPlainText, entryText, type NotebookEntry } from './notebook'
import { KcContext, type KcApi, type ToolId } from './ui'
import './kchem.css'

interface ToolDef {
  id: ToolId
  label: string
  icon: LucideIcon
}

const TOOLS: ToolDef[] = [
  { id: 'formula', label: 'Formula', icon: FlaskConical },
  { id: 'balance', label: 'Equation balancer', icon: ArrowRightLeft },
  { id: 'stoich', label: 'Stoichiometry', icon: Scale },
  { id: 'solutions', label: 'Solutions', icon: Beaker },
  { id: 'dilution', label: 'Dilution', icon: Droplets },
  { id: 'acids', label: 'Acids & pH', icon: TestTube },
  { id: 'gases', label: 'Gases', icon: Wind },
  { id: 'periodic', label: 'Periodic table', icon: Grid3x3 },
  { id: 'converter', label: 'Converter', icon: Repeat },
  { id: 'notebook', label: 'Notebook', icon: NotebookPen },
]

const PREFS_KEY = 'kherveos.kchem.prefs'
const SIG_CHOICES = [3, 4, 5, 6, 8, 10]

interface Prefs {
  tool: ToolId
  sig: number
}

function loadPrefs(): Prefs {
  const d: Prefs = { tool: 'formula', sig: 4 }
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    return {
      tool: TOOLS.some((t) => t.id === raw.tool) ? (raw.tool as ToolId) : d.tool,
      sig: typeof raw.sig === 'number' && raw.sig >= 2 && raw.sig <= 10 ? Math.round(raw.sig) : d.sig,
    }
  } catch {
    return d
  }
}

const HELP = [
  'Formulas: H2O, Ca(OH)2, K4[Fe(CN)6], Fe₂O₃.',
  'Hydrates: CuSO4·5H2O (a dot, "." or "*" also work).',
  'Charges: SO4^2-, Fe^3+, NH4+, Cl-, Cr2O72-. A lone digit before the sign is a charge for a single atom (Fe3+) and a subscript otherwise (NH4+, NO3-): use ^ to be explicit.',
  'Phases (s), (l), (g), (aq) are allowed after a species. The electron is e-.',
  'Equations: Fe + O2 -> Fe2O3 (-> , → or = between the sides, + between the species).',
  'Symbols are case-sensitive: Co is cobalt, CO is carbon monoxide.',
  'Numbers: a comma or a point works as the decimal mark; 1e-5 is fine.',
].join('\n\n')

export default function KChem({ win }: AppProps) {
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const [forms, setForms] = useState<Forms>(DEFAULT_FORMS)
  const [entries, setEntries] = useState<NotebookEntry[]>(loadNotebook)
  const [flash, setFlash] = useState('')
  const tool = prefs.tool
  setSigFigs(prefs.sig) // `fmt` reads it while the tools render

  const formsRef = useRef(forms)
  formsRef.current = forms
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const toolRef = useRef(tool)
  toolRef.current = tool
  // the current result text of each tool (and slot), for Copy result and Pin
  const results = useRef<Record<string, Record<string, { text: string; label: string }>>>({})
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const say = useCallback((m: string) => {
    setFlash(m)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(''), 3000)
  }, [])
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])

  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((old) => {
      const next = { ...old, ...p }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      } catch {
        /* private mode */
      }
      return next
    })
  }, [])

  // the sample formula is replaced by the first element clicked in the periodic table; a typed one is added to
  const formulaTouched = useRef(false)
  const patch = useCallback(<K extends keyof Forms>(k: K, p: Partial<Forms[K]>) => {
    if (k === 'formula') formulaTouched.current = true
    setForms((f) => ({ ...f, [k]: { ...f[k], ...p } }))
  }, [])

  const go = useCallback((id: ToolId) => setPrefs({ tool: id }), [setPrefs])

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

  const commit = useCallback((next: NotebookEntry[]) => {
    entriesRef.current = next
    setEntries(next)
    saveNotebook(next)
  }, [])

  const pin = useCallback(
    async (id: ToolId, defaultLabel: string, text: string) => {
      if (!text.trim()) return
      const label = await os.dialog.prompt('Label for this calculation', { title: 'Pin to the notebook', defaultValue: defaultLabel, okLabel: 'Pin' })
      if (label === null) return
      const name = TOOLS.find((t) => t.id === id)?.label ?? 'kChem'
      commit([...entriesRef.current, newEntry(name, label, text)])
      say('Pinned to the notebook')
    },
    [commit, say],
  )

  const report = useCallback((id: ToolId, text: string, slot = '', label = '') => {
    const m = (results.current[id] ??= {})
    m[slot] = { text, label }
  }, [])

  /** The main result of the tool in front (the first slot with text). */
  const current = useCallback((): { text: string; label: string } | null => {
    const m = results.current[toolRef.current]
    if (!m) return null
    return m[''] && m[''].text ? m[''] : Object.values(m).find((x) => x.text) ?? null
  }, [])

  const insertElement = useCallback((symbol: string) => {
    const fresh = !formulaTouched.current
    formulaTouched.current = true
    setForms((f) => ({ ...f, formula: { ...f.formula, formula: (fresh ? '' : f.formula.formula) + symbol } }))
  }, [])

  const api = useMemo<KcApi>(() => ({ report, pin: (t, l, x) => void pin(t, l, x), copy, insertElement, go }), [report, pin, copy, insertElement, go])

  // ---------------------------------------------------------------- notebook actions

  const exportNotebook = useCallback(async () => {
    const list = entriesRef.current
    if (list.length === 0) {
      void os.dialog.alert('The notebook is empty: pin a result first.', { title: 'kChem' })
      return
    }
    const target = await os.dialog.saveFile({ title: 'Export the notebook', defaultName: `${HOME}/Documents/kchem-notebook.md`, extensions: ['.md', '.txt'] })
    if (!target) return
    try {
      await os.fs.writeText(target, target.toLowerCase().endsWith('.txt') ? toPlainText(list) : toMarkdown(list), { mkdirs: true })
      os.notify({ title: 'Notebook exported', body: target })
    } catch (e) {
      void os.dialog.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`, { title: 'kChem' })
    }
  }, [])

  const notebook = useMemo(
    () => ({
      entries,
      copyEntry: (e: NotebookEntry) => copy(entryText(e)),
      copyAll: (f: 'md' | 'txt') => copy(f === 'md' ? toMarkdown(entriesRef.current) : toPlainText(entriesRef.current)),
      rename: async (e: NotebookEntry) => {
        const label = await os.dialog.prompt('Label', { title: 'Rename', defaultValue: e.label })
        if (label !== null && label.trim()) commit(entriesRef.current.map((x) => (x.id === e.id ? { ...x, label: label.trim() } : x)))
      },
      remove: (e: NotebookEntry) => commit(entriesRef.current.filter((x) => x.id !== e.id)),
      clear: async () => {
        if (await os.dialog.confirm('Remove every pinned calculation from the notebook?', { title: 'Clear the notebook', okLabel: 'Clear' })) commit([])
      },
      exportAs: () => void exportNotebook(),
    }),
    [entries, copy, commit, exportNotebook],
  )

  // ---------------------------------------------------------------- AI tools

  useAppTools(win, kchemTools({
    show: (id, form, p) => {
      patch(form, p)
      go(id)
    },
    forms: () => formsRef.current,
  }))

  // ---------------------------------------------------------------- window, menus, keys

  useEffect(() => {
    win.setTitle(`kChem — ${TOOLS.find((t) => t.id === tool)?.label ?? ''}`)
  }, [win, tool])

  const copyResult = useCallback(() => {
    const c = current()
    if (c) copy(c.text)
    else say('Nothing to copy here')
  }, [current, copy, say])
  const pinResult = useCallback(() => {
    const c = current()
    if (c) void pin(toolRef.current, c.label || TOOLS.find((t) => t.id === toolRef.current)?.label || 'Result', c.text)
    else say('Nothing to pin here')
  }, [current, pin, say])

  useEffect(() => {
    const menus: MenuBarMenu[] = [
      {
        label: 'File',
        items: [
          { label: 'Pin result to the notebook', shortcut: '⌘D', onClick: pinResult },
          { label: 'Export notebook…', shortcut: '⌘E', disabled: entries.length === 0, onClick: () => void exportNotebook() },
          '-',
          { label: 'Close', onClick: () => win.close() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Copy result', shortcut: '⌥C', onClick: copyResult },
          '-',
          { label: 'Clear the notebook', disabled: entries.length === 0, danger: true, onClick: () => void notebook.clear() },
        ],
      },
      {
        label: 'Tools',
        items: TOOLS.map((t, i) => ({ label: t.label, icon: t.icon, shortcut: `⌥${(i + 1) % 10}`, checked: t.id === tool, onClick: () => go(t.id) })),
      },
      {
        label: 'Settings',
        items: SIG_CHOICES.map((n) => ({ label: `${n} significant figures`, checked: prefs.sig === n, onClick: () => setPrefs({ sig: n }) })),
      },
      {
        label: 'Help',
        items: [{ label: 'Formula and equation syntax', onClick: () => void os.dialog.alert(HELP, { title: 'kChem — syntax' }) }],
      },
    ]
    win.setMenus(menus)
  }, [win, tool, entries.length, prefs.sig, pinResult, copyResult, exportNotebook, notebook, go, setPrefs])
  useEffect(() => () => win.setMenus(null), [win])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.metaKey || e.ctrlKey
    const digit = /^Digit(\d)$/.exec(e.code)
    if (digit && (e.altKey || mod) && !e.shiftKey) {
      const i = (Number(digit[1]) + 9) % 10
      e.preventDefault()
      e.stopPropagation()
      go(TOOLS[i].id)
    } else if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      e.stopPropagation()
      pinResult()
    } else if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'e') {
      e.preventDefault()
      e.stopPropagation()
      void exportNotebook()
    } else if (e.altKey && !mod && e.code === 'KeyC') {
      e.preventDefault()
      e.stopPropagation()
      copyResult()
    }
  }

  const active = TOOLS.find((t) => t.id === tool) ?? TOOLS[0]

  return (
    <KcContext.Provider value={api}>
      <div className="k-app kc-app" onKeyDown={onKeyDown}>
        <div className="kc-body">
          <nav className="kc-side" aria-label="kChem tools">
            {TOOLS.map((t) => (
              <button key={t.id} className={`kc-nav ${t.id === tool ? 'on' : ''}`} onClick={() => go(t.id)} title={t.label} aria-current={t.id === tool ? 'page' : undefined}>
                <t.icon size={16} />
                <span className="kc-nav-label">{t.label}</span>
                {t.id === 'notebook' && entries.length > 0 && <span className="kc-count">{entries.length}</span>}
              </button>
            ))}
          </nav>
          <main className="kc-main">
            <div className="kc-tool" hidden={tool !== 'formula'}><FormulaTool f={forms.formula} set={(p) => patch('formula', p)} /></div>
            <div className="kc-tool" hidden={tool !== 'balance'}>
              <BalanceTool
                f={forms.balance}
                set={(p) => patch('balance', p)}
                toStoich={(eq) => {
                  patch('stoich', { equation: eq })
                  go('stoich')
                }}
              />
            </div>
            <div className="kc-tool" hidden={tool !== 'stoich'}><StoichTool f={forms.stoich} set={(p) => patch('stoich', p)} /></div>
            <div className="kc-tool" hidden={tool !== 'solutions'}><SolutionsTool f={forms.solutions} set={(p) => patch('solutions', p)} /></div>
            <div className="kc-tool" hidden={tool !== 'dilution'}><DilutionTool f={forms.dilution} set={(p) => patch('dilution', p)} /></div>
            <div className="kc-tool" hidden={tool !== 'acids'}><AcidsTool f={forms.acids} set={(p) => patch('acids', p)} /></div>
            <div className="kc-tool" hidden={tool !== 'gases'}><GasesTool f={forms.gases} set={(p) => patch('gases', p)} /></div>
            <div className="kc-tool" hidden={tool !== 'periodic'}>
              <PeriodicTool
                f={forms.periodic}
                set={(p) => patch('periodic', p)}
                formula={forms.formula.formula}
                setFormula={(formula) => patch('formula', { formula })}
              />
            </div>
            <div className="kc-tool" hidden={tool !== 'converter'}><ConverterTool f={forms.converter} set={(p) => patch('converter', p)} /></div>
            <div className="kc-tool" hidden={tool !== 'notebook'}><NotebookTool a={notebook} /></div>
          </main>
        </div>
        <div className="k-statusbar">
          <span>{active.label}</span>
          <span className="kc-flash">{flash}</span>
          <span className="k-spacer" style={{ flex: 1 }} />
          <label className="kc-sig">
            Significant figures
            <select className="k-input kc-sigsel" value={getSigFigs()} aria-label="Significant figures" onChange={(e) => setPrefs({ sig: Number(e.target.value) })}>
              {SIG_CHOICES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
      </div>
    </KcContext.Provider>
  )
}
