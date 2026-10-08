// KherveCalc — a very scientific calculator: exact (SymPy) and arbitrary-
// precision (mpmath) maths in the window's own Python, a pretty 2D display,
// calculus, linear algebra, statistics, units & CODATA constants, graphs,
// bases and a Python cell. Sessions are .kcalc files; the last one is kept in
// ~/.khervecalc/autosave.kcalc and reopened.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calculator, Grid3x3, LineChart, BarChart3, Ruler, Binary, Code2, Keyboard, PanelRight, Loader2, Square } from 'lucide-react'
import { os, HOME, path, type AppProps, type MenuBarMenu } from '@/os'
import type { KernelStatus } from '@/os/python/kernel'
import { useAppTools } from '@/os/ai/appTools'
import { CalcBridge, type Pending } from './bridge'
import { CalcView, engineSettings, type VarInfo } from './CalcView'
import { GraphView } from './GraphView'
import { MatrixView } from './MatrixView'
import { StatsView } from './StatsView'
import { UnitsView } from './UnitsView'
import { ProgrammerView } from './ProgrammerView'
import { ProgramView } from './ProgramView'
import { calcTools } from './aiTools'
import { GRAPH_COLORS } from './plot'
import {
  MAX_HISTORY, ansIds, defName, historyText, newId, newSession, parseSession, serializeSession, upsertDef,
  type Answer, type CalcSettings, type HistoryEntry, type Session,
} from './session'
import './khervecalc.css'

type Tab = 'calc' | 'graph' | 'matrix' | 'stats' | 'units' | 'base' | 'python'

const TABS: { id: Tab; label: string; icon: typeof Calculator }[] = [
  { id: 'calc', label: 'Calculate', icon: Calculator },
  { id: 'graph', label: 'Graph', icon: LineChart },
  { id: 'matrix', label: 'Matrix', icon: Grid3x3 },
  { id: 'stats', label: 'Statistics', icon: BarChart3 },
  { id: 'units', label: 'Units & constants', icon: Ruler },
  { id: 'base', label: 'Base', icon: Binary },
  { id: 'python', label: 'Python', icon: Code2 },
]

const AUTOSAVE = `${HOME}/.khervecalc/autosave.kcalc`
const PREFS_KEY = 'kherveos.khervecalc.prefs'

interface Prefs {
  keypad: boolean
  side: boolean
  tab: Tab
}

function loadPrefs(): Prefs {
  const d: Prefs = { keypad: true, side: true, tab: 'calc' }
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    return { ...d, ...raw, tab: TABS.some((t) => t.id === raw.tab) ? (raw.tab as Tab) : 'calc' }
  } catch {
    return d
  }
}

const DIGIT_CHOICES = [6, 8, 10, 12, 15, 20, 30, 50, 100, 200, 500, 1000]

export default function KherveCalc({ win, args }: AppProps) {
  const [session, setSessionState] = useState<Session>(newSession)
  const sref = useRef(session)
  const setSession = useCallback((f: Session | ((s: Session) => Session)) => {
    const next = typeof f === 'function' ? f(sref.current) : f
    sref.current = next
    setSessionState(next)
  }, [])
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const [vars, setVars] = useState<VarInfo[]>([])
  const varsRef = useRef(vars)
  varsRef.current = vars
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<Pending | null>(null)
  const [now, setNow] = useState(Date.now())
  const [progress, setProgress] = useState<string | null>(null)
  const [kstatus, setKstatus] = useState<KernelStatus>('off')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const bridge = useMemo(() => new CalcBridge(`khervecalc-${win.id}`), [win.id])

  const setPrefs = (p: Partial<Prefs>) =>
    setPrefsState((old) => {
      const next = { ...old, ...p }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      } catch {
        /* private mode */
      }
      return next
    })
  const tab = prefs.tab
  const settings = session.settings
  const setSettings = useCallback((p: Partial<CalcSettings>) => setSession((s) => ({ ...s, settings: { ...s.settings, ...p } })), [setSession])

  // ------------------------------------------------------------ Python

  useEffect(() => {
    bridge.onBusy = setBusy
    bridge.onProgress = setProgress
    bridge.onRestarted = async () => {
      const s = sref.current
      const results = s.history.filter((h) => h.answer.ok && h.answer.srepr).slice(-60).map((h) => ({ id: h.id, srepr: h.answer.srepr }))
      const r = await bridge.direct('restore', { settings: engineSettings(s.settings), defs: s.defs, results, lists: s.lists })
      if (r.ok && Array.isArray(r.vars)) setVars(r.vars as VarInfo[])
    }
    const off = bridge.kernel.onStatus(setKstatus)
    return () => {
      off()
      bridge.dispose()
    }
  }, [bridge])

  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [busy])

  // open the file given, or the autosaved session; then start Python
  useEffect(() => {
    let alive = true
    void (async () => {
      const p = typeof args.path === 'string' ? args.path : null
      const from = p ?? (os.fs.exists(AUTOSAVE) ? AUTOSAVE : null)
      if (from) {
        try {
          const s = parseSession(await os.fs.readText(from))
          if (!alive) return
          setSession(s)
          if (p) setFilePath(p)
        } catch (e) {
          if (p) void os.dialog.alert(e instanceof Error ? e.message : String(e), { title: 'kCalc' })
        }
      }
      setLoaded(true)
      bridge.ensure().catch((e: unknown) => setProgress(e instanceof Error ? e.message : String(e)))
    })()
    return () => {
      alive = false
    }
  }, [args.path, bridge, setSession])

  // autosave
  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => {
      os.fs.writeText(AUTOSAVE, serializeSession(session), { mkdirs: true }).catch(() => {})
    }, 1200)
    return () => clearTimeout(t)
  }, [session, loaded])

  // the statistics lists are L1…L6 in Calculate too
  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => void bridge.call('lists', { lists: session.lists }).catch(() => {}), 300)
    return () => clearTimeout(t)
  }, [session.lists, loaded, bridge])

  useEffect(() => {
    win.setTitle(filePath ? `kCalc — ${path.basename(filePath)}` : 'kCalc')
  }, [filePath, win])

  // ---------------------------------------------------------- actions

  const evaluate = useCallback(
    async (src: string, o: { approx?: boolean; replaceId?: string; override?: Partial<CalcSettings> } = {}): Promise<HistoryEntry | null> => {
      const s0 = sref.current
      const st: CalcSettings = { ...s0.settings, ...(o.override ?? {}), ...(o.approx ? { number: 'decimal' as const } : {}) }
      const idx = o.replaceId ? s0.history.findIndex((h) => h.id === o.replaceId) : -1
      const id = o.replaceId && idx >= 0 ? o.replaceId : newId()
      let answer: Answer
      try {
        answer = await bridge.call<Answer>('eval', {
          src, settings: engineSettings(st), ans: ansIds(s0.history, idx >= 0 ? idx : s0.history.length), id,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg === 'Cancelled') return null
        answer = { ok: false, error: msg }
      }
      const entry: HistoryEntry = {
        id, input: src, inputLatex: answer.input_latex ?? undefined, answer, time: Date.now(),
        mode: { number: st.number, angle: st.angle, digits: st.digits },
      }
      setSession((s) => {
        const at = s.history.findIndex((h) => h.id === id)
        const history = at >= 0 ? s.history.map((h) => (h.id === id ? entry : h)) : [...s.history, entry].slice(-MAX_HISTORY)
        const defs = answer.ok && answer.kind === 'def' && answer.name ? upsertDef(s.defs, answer.name, src) : s.defs
        return { ...s, history, defs }
      })
      if (Array.isArray(answer.vars)) setVars(answer.vars as VarInfo[])
      return entry
    },
    [bridge, setSession],
  )

  const deleteEntry = (id: string) => {
    setSession((s) => ({ ...s, history: s.history.filter((h) => h.id !== id) }))
    void bridge.call('forget', { ids: [id] }).catch(() => {})
  }
  const clearHistory = async () => {
    if (!sref.current.history.length) return
    if (!(await os.dialog.confirm('Clear the whole history? Variables stay defined.', { title: 'kCalc', okLabel: 'Clear', danger: true }))) return
    const ids = sref.current.history.map((h) => h.id)
    setSession((s) => ({ ...s, history: [] }))
    void bridge.call('forget', { ids }).catch(() => {})
  }
  const deleteVar = async (name: string) => {
    const r = await bridge.call<{ ok: boolean; vars?: VarInfo[] }>('delvar', { name })
    if (r.vars) setVars(r.vars)
    setSession((s) => ({ ...s, defs: s.defs.filter((d) => defName(d) !== name) }))
  }
  const clearVars = async () => {
    if (!(await os.dialog.confirm('Forget every variable and function?', { title: 'kCalc', okLabel: 'Forget', danger: true }))) return
    await bridge.call('clearvars')
    setVars([])
    setSession((s) => ({ ...s, defs: [] }))
  }
  const insertToCalc = (text: string) => {
    setPrefs({ tab: 'calc' })
    const el = inputRef.current
    const start = el?.selectionStart ?? input.length
    const end = el?.selectionEnd ?? input.length
    const next = input.slice(0, start) + text + input.slice(end)
    setInput(next)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(start + text.length, start + text.length)
    })
  }
  const addGraph = (expr: string) => {
    setSession((s) => {
      const used = new Set(s.graphs.map((g) => g.color))
      const color = GRAPH_COLORS.find((c) => !used.has(c)) ?? GRAPH_COLORS[s.graphs.length % GRAPH_COLORS.length]
      return { ...s, graphs: [...s.graphs, { id: newId(), kind: 'y', expr, color, visible: true }] }
    })
    setPrefs({ tab: 'graph' })
  }
  const refreshVars = () => void bridge.call<{ ok: boolean; vars?: VarInfo[] }>('vars').then((r) => r.vars && setVars(r.vars)).catch(() => {})

  /** Replace the session (New, Open): Python restarts and replays it. */
  const replaceSession = async (s: Session, file: string | null) => {
    setSession(s)
    setFilePath(file)
    setVars([])
    setInput('')
    await bridge.cancel()
  }

  const newSessionCmd = async () => {
    if (sref.current.history.length && !(await os.dialog.confirm('Start a new session? Save this one first if you want to keep it.', { title: 'kCalc', okLabel: 'New session' }))) return
    await replaceSession(newSession(), null)
  }
  const openCmd = async () => {
    const p = await os.dialog.openFile({ title: 'Open a kCalc session', extensions: ['.kcalc'] })
    if (!p) return
    try {
      await replaceSession(parseSession(await os.fs.readText(p)), p)
    } catch (e) {
      void os.dialog.alert(e instanceof Error ? e.message : String(e), { title: 'kCalc' })
    }
  }
  const saveAs = async () => {
    const p = await os.dialog.saveFile({ title: 'Save the session', extensions: ['.kcalc'], defaultName: filePath ?? 'Session.kcalc' })
    if (!p) return
    await os.fs.writeText(p, serializeSession(sref.current), { mkdirs: true })
    setFilePath(p)
    os.notify({ title: 'Session saved', body: p })
  }
  const save = async () => {
    if (!filePath) return saveAs()
    await os.fs.writeText(filePath, serializeSession(sref.current))
    os.notify({ title: 'Session saved', body: filePath })
  }
  const exportText = async () => {
    const p = await os.dialog.saveFile({ title: 'Export the history', extensions: ['.txt'], defaultName: 'kCalc history.txt' })
    if (p) await os.fs.writeText(p, historyText(sref.current.history), { mkdirs: true })
  }
  const copyLast = (latex: boolean) => {
    const h = [...sref.current.history].reverse().find((x) => x.answer.ok)
    if (!h) return
    void navigator.clipboard?.writeText((latex ? h.answer.latex : h.answer.text) ?? '').catch(() => {})
  }
  const cancel = () => void bridge.cancel()

  // ------------------------------------------------------------- AI

  useAppTools(
    win,
    calcTools({
      settings: () => sref.current.settings,
      evaluate: (src, override) => evaluate(src, { override }),
      convert: (value, from, to) => bridge.call<Answer>('convert', { value, from, to, settings: engineSettings(sref.current.settings) }),
      history: () => sref.current.history,
      vars: () => varsRef.current,
      setSettings,
    }),
  )

  // ------------------------------------------------------------ menus

  const menus: MenuBarMenu[] = useMemo(() => {
    const radio = <K extends keyof CalcSettings>(key: K, items: [CalcSettings[K], string][]) =>
      items.map(([v, label]) => ({ label, checked: settings[key] === v, onClick: () => setSettings({ [key]: v } as Partial<CalcSettings>) }))
    return [
      {
        label: 'File',
        items: [
          { label: 'New Session', onClick: () => void newSessionCmd() },
          { label: 'Open Session…', shortcut: '⌘O', onClick: () => void openCmd() },
          '-',
          { label: 'Save Session', shortcut: '⌘S', onClick: () => void save() },
          { label: 'Save Session As…', onClick: () => void saveAs() },
          { label: 'Export History as Text…', onClick: () => void exportText() },
          '-',
          { label: 'Close', onClick: () => win.close() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Copy Last Result', onClick: () => copyLast(false) },
          { label: 'Copy Last Result as LaTeX', onClick: () => copyLast(true) },
          '-',
          { label: 'Clear Line', onClick: () => setInput('') },
          { label: 'Clear History…', onClick: () => void clearHistory() },
          { label: 'Forget Variables…', onClick: () => void clearVars() },
        ],
      },
      {
        label: 'Mode',
        items: [
          ...radio('number', [['exact', 'Exact (symbolic)'], ['decimal', 'Decimal'], ['fraction', 'Fraction']]),
          '-',
          ...radio('angle', [['deg', 'Degrees'], ['rad', 'Radians'], ['grad', 'Gradians']]),
          '-',
          ...radio('complex', [['rect', 'Complex: a + bi'], ['polar', 'Complex: r∠θ']]),
          '-',
          { label: 'Number Format', submenu: radio('format', [['normal', 'Normal'], ['sci', 'Scientific'], ['eng', 'Engineering'], ['fix', 'Fixed decimals']]) },
          { label: 'Digits', submenu: DIGIT_CHOICES.map((d) => ({ label: String(d), checked: settings.digits === d, onClick: () => setSettings({ digits: d }) })) },
        ],
      },
      {
        label: 'View',
        items: [
          ...TABS.map((t, i) => ({ label: t.label, shortcut: `⌃${i + 1}`, checked: tab === t.id, onClick: () => setPrefs({ tab: t.id }) })),
          '-',
          { label: 'Keypad', checked: prefs.keypad, onClick: () => setPrefs({ keypad: !prefs.keypad }) },
          { label: 'Variables & Catalog', checked: prefs.side, onClick: () => setPrefs({ side: !prefs.side }) },
        ],
      },
      {
        label: 'Python',
        items: [
          { label: 'Cancel the Calculation', shortcut: '⌃.', disabled: !busy, onClick: cancel },
          { label: 'Restart Python', onClick: cancel },
        ],
      },
      {
        label: 'Help',
        items: [{ label: 'kCalc Syntax', onClick: () => void showHelp() }],
      },
    ]
  }, [settings, tab, prefs, busy, filePath])

  useEffect(() => {
    win.setMenus(menus)
  }, [menus, win])
  useEffect(() => () => win.setMenus(null), [win])

  // ----------------------------------------------------------- render

  const elapsed = busy ? (now - busy.since) / 1000 : 0
  const showBusy = busy && (busy.op !== 'preview' || elapsed > 1.5) && elapsed > 0.25
  const seg = <K extends keyof CalcSettings>(key: K, items: [CalcSettings[K], string, string?][]) => (
    <div className="kc-seg">
      {items.map(([v, label, title]) => (
        <button key={String(v)} className={settings[key] === v ? 'active' : ''} title={title} onClick={() => setSettings({ [key]: v } as Partial<CalcSettings>)}>
          {label}
        </button>
      ))}
    </div>
  )

  return (
    <div
      className="k-app kc-app"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && /^[1-7]$/.test(e.key)) {
          e.preventDefault()
          setPrefs({ tab: TABS[Number(e.key) - 1].id })
        } else if ((e.ctrlKey || e.metaKey) && e.key === '.') {
          e.preventDefault()
          cancel()
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault()
          void save()
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
          e.preventDefault()
          void openCmd()
        }
      }}
    >
      <div className="kc-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setPrefs({ tab: t.id })}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      <div className="k-toolbar kc-toolbar">
        {seg('number', [['exact', 'Exact', 'Symbolic, exact results'], ['decimal', 'Decimal', 'Decimal results'], ['fraction', 'a/b', 'Fractions']])}
        <label className="kc-inline" title="Significant digits (up to 1000)">
          <select className="k-input kc-small-select" value={DIGIT_CHOICES.includes(settings.digits) ? settings.digits : ''} onChange={(e) => setSettings({ digits: Number(e.target.value) })}>
            {!DIGIT_CHOICES.includes(settings.digits) && <option value="">{settings.digits}</option>}
            {DIGIT_CHOICES.map((d) => <option key={d} value={d}>{d} digits</option>)}
          </select>
        </label>
        <span className="k-sep" />
        {seg('format', [['normal', 'Norm', 'Normal notation'], ['sci', 'Sci', 'Scientific notation'], ['eng', 'Eng', 'Engineering notation'], ['fix', 'Fix', 'Fixed decimals']])}
        {settings.format !== 'normal' && (
          <input className="k-input kc-num kc-fix" type="number" min={0} max={100} value={settings.fix} title={settings.format === 'fix' ? 'Decimals' : 'Significant digits (0 = all)'} onChange={(e) => setSettings({ fix: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
        )}
        <span className="k-sep" />
        {seg('angle', [['deg', 'DEG'], ['rad', 'RAD'], ['grad', 'GRAD']])}
        <span className="k-sep" />
        {seg('complex', [['rect', 'a+bi', 'Rectangular complex numbers'], ['polar', 'r∠θ', 'Polar complex numbers']])}
        <span className="k-spacer" />
        {showBusy && (
          <span className="kc-busy">
            <Loader2 size={14} className="k-spin" /> computing… {elapsed >= 1 ? `${Math.floor(elapsed)} s` : ''}
            <button className="k-btn small danger" onClick={cancel} title="Stop (restarts Python; your session is kept) — Ctrl+.">
              <Square size={11} /> Cancel
            </button>
          </span>
        )}
        {tab === 'calc' && (
          <>
            <button className={`k-icon-btn${prefs.keypad ? ' active' : ''}`} title="Keypad" onClick={() => setPrefs({ keypad: !prefs.keypad })}><Keyboard size={16} /></button>
            <button className={`k-icon-btn${prefs.side ? ' active' : ''}`} title="Variables & Catalog" onClick={() => setPrefs({ side: !prefs.side })}><PanelRight size={16} /></button>
          </>
        )}
      </div>
      <div className="kc-body">
        {tab === 'calc' && (
          <CalcView
            bridge={bridge}
            settings={settings}
            history={session.history}
            vars={vars}
            input={input}
            setInput={setInput}
            inputRef={inputRef}
            evaluate={evaluate}
            deleteEntry={deleteEntry}
            clearHistory={() => void clearHistory()}
            deleteVar={(n) => void deleteVar(n)}
            clearVars={() => void clearVars()}
            showKeypad={prefs.keypad}
            showSide={prefs.side}
            busy={!!busy && busy.op !== 'preview'}
          />
        )}
        {tab === 'graph' && (
          <GraphView
            bridge={bridge}
            settings={settings}
            graphs={session.graphs}
            setGraphs={(graphs) => setSession((s) => ({ ...s, graphs }))}
            view={session.view}
            setView={(view) => setSession((s) => ({ ...s, view }))}
          />
        )}
        {tab === 'matrix' && <MatrixView settings={settings} vars={vars} evaluate={(src) => evaluate(src)} insertToCalc={insertToCalc} busy={!!busy && busy.op !== 'preview'} />}
        {tab === 'stats' && (
          <StatsView
            bridge={bridge}
            settings={settings}
            lists={session.lists}
            setLists={(lists) => setSession((s) => ({ ...s, lists }))}
            evaluate={(src) => evaluate(src)}
            addGraph={addGraph}
          />
        )}
        {tab === 'units' && <UnitsView bridge={bridge} settings={settings} insertToCalc={insertToCalc} />}
        {tab === 'base' && <ProgrammerView settings={settings} setSettings={setSettings} />}
        {tab === 'python' && <ProgramView bridge={bridge} code={session.program} setCode={(program) => setSession((s) => ({ ...s, program }))} onDefined={refreshVars} />}
      </div>
      <div className="k-statusbar kc-status">
        <span>
          {progress ?? (kstatus === 'off' ? 'Python not started' : kstatus === 'starting' ? 'Starting Python…' : kstatus === 'dead' ? 'Python stopped' : 'Python ready')}
        </span>
        <span>
          {settings.number === 'exact' ? 'Exact' : settings.number === 'decimal' ? 'Decimal' : 'Fraction'} · {settings.digits} digits · {settings.angle.toUpperCase()} ·{' '}
          {settings.format === 'normal' ? 'Norm' : `${settings.format.toUpperCase()} ${settings.fix}`} · {settings.complex === 'rect' ? 'a+bi' : 'r∠θ'}
        </span>
        <span>{session.history.length} results · {vars.length} variables</span>
        <span className="k-spacer" />
        <span>{filePath ? path.basename(filePath) : 'autosaved'}</span>
      </div>
    </div>
  )
}

function showHelp() {
  return os.dialog.alert(
    <div className="kc-help">
      <p><b>Typing.</b> <code>^</code> or <code>**</code> powers, <code>2x</code> and <code>sin x</code> multiply/apply, <code>5!</code>, <code>√2</code>, <code>π</code>, <code>e</code>, <code>i</code>, <code>oo</code>. <code>log</code> is base 10, <code>ln</code> natural.</p>
      <p><b>Answers.</b> <code>ans</code> = <code>ans1</code> is the last result, <code>ans2</code> the one before… Click a result to insert it, an input to reuse it, ✎ to edit it in place.</p>
      <p><b>Define.</b> <code>a := 5</code>, <code>f(x, y) := x^2 + y</code>, or store: <code>7 → b</code>.</p>
      <p><b>Equations.</b> <code>solve(x^2 = 2, x)</code>, <code>solve([x+y=3, x-y=1], [x,y])</code>, <code>nsolve(cos x = x, x, 1)</code>, <code>roots(x^3 - 1)</code>, <code>dsolve(y'' + y = 0, y(0) = 1, y'(0) = 0)</code>.</p>
      <p><b>Calculus.</b> <code>diff(f, x, 2)</code>, <code>integrate(f, x)</code>, <code>integrate(f, x, 0, 1)</code>, <code>nint(f, x, a, b)</code>, <code>limit(f, x, 0, "+")</code>, <code>taylor(f, x, 0, 8)</code>, <code>sum(1/k^2, k, 1, oo)</code>.</p>
      <p><b>Matrices.</b> <code>[[1,2],[3,4]]</code>, <code>A^-1</code>, <code>det(A)</code>, <code>eig(A)</code>, <code>lu(A)</code>, <code>svd(A)</code>, <code>linsolve(A, b)</code>; vectors <code>[1,2,3]</code>, <code>cross(u, v)</code>. Indexes start at 0: <code>A[0, 1]</code>.</p>
      <p><b>Units.</b> <code>3_m/_s * 2_h</code>, <code>100_km/_h ▶ _m/_s</code> (or <code>-&gt;</code>), <code>20°C ▶ °F</code>, prefixes on SI units (<code>_µm</code>, <code>_MPa</code>).</p>
      <p><b>Constants.</b> <code>#c</code>, <code>#h</code>, <code>#hbar</code>, <code>#e</code>, <code>#me</code>, <code>#NA</code>, <code>#kB</code>… or any CODATA name: <code>const("muon mass")</code>.</p>
      <p><b>Complex.</b> <code>3 + 4i</code>, <code>5∠30°</code>, <code>abs</code>, <code>arg</code>, <code>conj</code>. <b>Statistics.</b> lists <code>L1</code>…<code>L6</code> from the Statistics tab: <code>mean(L1)</code>.</p>
      <p><b>Keys.</b> Enter calculates, Ctrl+Enter gives a decimal, ↑/↓ recall, Tab completes, Esc clears, Ctrl+. cancels, Ctrl+1…7 switch tabs.</p>
    </div>,
    { title: 'kCalc syntax' },
  )
}
