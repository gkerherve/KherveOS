// Chart, Trendline, Solver and Sort dialogs. Charts keep the chart spec
// core/charts draws; trendlines use core/fitting's models; the Solver is
// core/solver (Powell / SLSQP / differential evolution, as on the desktop).

import { useState } from 'react'
import { LoaderCircle, Plus, Trash2 } from 'lucide-react'
import { errorText, type Book } from './book'
import { Modal } from './dialogs'
import { colName, key, rangeA1, type ChartSeries, type ChartSpec, type Range, type Trendline } from './model'
import { CHART_COLORS, CHART_TYPES, runSolver, savedSolver, updateChart, type SolverOutcome, type SolverProblem } from './objects'
import { looksLikeHeader, sortRange } from './ops'

const dash: Record<string, string> = { '--': 'Dashed', '-': 'Solid', ':': 'Dotted', '-.': 'Dash-dot' }

export function ChartDialog({ book, id, onClose }: { book: Book; id: string; onClose: () => void }) {
  const ch = book.active.charts.find((c) => c.id === id)
  const [spec, setSpec] = useState<ChartSpec | null>(ch ? JSON.parse(JSON.stringify(ch.spec)) : null)
  if (!ch || !spec) return null
  const set = (p: Partial<ChartSpec>) => setSpec({ ...spec, ...p })
  const setSeries = (i: number, p: Partial<ChartSeries>) => set({ series: spec.series.map((s, j) => (j === i ? { ...s, ...p } : s)) })
  const inline = spec.series.some((s) => s.ref.startsWith('@')) || (spec.x ?? '').startsWith('@')
  return (
    <Modal
      title="Chart"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="k-btn" onClick={onClose}>Cancel</button>
          <button className="k-btn primary" onClick={() => {
            updateChart(book, id, spec)
            onClose()
          }}>OK</button>
        </>
      }
    >
      <div className="ks-form two">
        <label className="ks-field">
          Type
          <select className="k-input" value={spec.type} onChange={(e) => set({ type: e.target.value })}>
            {CHART_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="ks-field">
          Title
          <input className="k-input" value={spec.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label className="ks-field">
          X axis title
          <input className="k-input" value={spec.xLabel ?? ''} onChange={(e) => set({ xLabel: e.target.value })} />
        </label>
        <label className="ks-field">
          Y axis title
          <input className="k-input" value={spec.yLabel ?? ''} onChange={(e) => set({ yLabel: e.target.value })} />
        </label>
        <label className="ks-field">
          X values (categories)
          <input className="k-input ks-mono" value={spec.x ?? ''} placeholder="A2:A20 (empty: 1, 2, 3…)" disabled={inline} onChange={(e) => set({ x: e.target.value.trim() || null })} />
        </label>
        <div className="ks-row">
          <label className="ks-field small">
            Width
            <input className="k-input" type="number" min={160} value={spec.width} onChange={(e) => set({ width: Math.max(160, Number(e.target.value) || 480) })} />
          </label>
          <label className="ks-field small">
            Height
            <input className="k-input" type="number" min={120} value={spec.height} onChange={(e) => set({ height: Math.max(120, Number(e.target.value) || 320) })} />
          </label>
        </div>
      </div>
      <div className="ks-row">
        <label className="ks-check"><input type="checkbox" checked={spec.legend ?? spec.series.length > 1} onChange={(e) => set({ legend: e.target.checked })} /> Legend</label>
        <label className="ks-check"><input type="checkbox" checked={!!spec.grid} onChange={(e) => set({ grid: e.target.checked })} /> Gridlines</label>
        <label className="ks-check"><input type="checkbox" checked={!!spec.logX} onChange={(e) => set({ logX: e.target.checked })} /> Log X</label>
        <label className="ks-check"><input type="checkbox" checked={!!spec.logY} onChange={(e) => set({ logY: e.target.checked })} /> Log Y</label>
      </div>
      <h4 className="ks-h4">Series</h4>
      {inline && <p className="ks-note">This chart holds its own numbers (saved by the desktop); its ranges cannot be changed here.</p>}
      <div className="ks-series">
        {spec.series.map((s, i) => (
          <div key={i} className="ks-series-row">
            <input className="k-input ks-mono" value={s.ref} disabled={inline} aria-label="Range" onChange={(e) => setSeries(i, { ref: e.target.value.trim() })} />
            <input className="k-input" value={s.name ?? ''} placeholder="Name" aria-label="Name" onChange={(e) => setSeries(i, { name: e.target.value || null })} />
            <input type="color" className="ks-color" value={s.color ?? CHART_COLORS[i % CHART_COLORS.length]} aria-label="Colour" onChange={(e) => setSeries(i, { color: e.target.value })} />
            <button className="k-icon-btn" title="Remove the series" disabled={spec.series.length <= 1 || inline} onClick={() => set({ series: spec.series.filter((_s, j) => j !== i) })}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      {!inline && (
        <button className="k-btn small" onClick={() => {
          const g = book.active.sel.ranges[0]
          set({ series: [...spec.series, { ref: rangeA1({ ...g, c2: g.c1 }), name: colName(g.c1) }] })
        }}>
          <Plus size={14} /> Add the selected column as a series
        </button>
      )}
    </Modal>
  )
}

export function TrendlineDialog({ book, id, onClose }: { book: Book; id: string; onClose: () => void }) {
  const ch = book.active.charts.find((c) => c.id === id)
  const [list, setList] = useState<Trendline[]>(ch ? JSON.parse(JSON.stringify(ch.spec.trendlines ?? [])) : [])
  const [series, setSeries] = useState(0)
  const [model, setModel] = useState('Linear')
  const [order, setOrder] = useState(2)
  const [period, setPeriod] = useState(2)
  const [color, setColor] = useState('#d62728')
  const [showEq, setShowEq] = useState(true)
  const [showR2, setShowR2] = useState(true)
  const [forward, setForward] = useState(0)
  const [backward, setBackward] = useState(0)
  if (!ch) return null
  const models = book.trendModels.length ? book.trendModels : ['Linear', 'Quadratic', 'Exponential', 'Polynomial', 'Moving Average']
  const fits = ch.fits ?? []
  const save = (next: Trendline[]) => {
    setList(next)
    updateChart(book, id, { ...ch.spec, trendlines: next }, 'Trendline')
  }
  return (
    <Modal title="Trendline" wide onClose={onClose} footer={<button className="k-btn primary" onClick={onClose}>Done</button>}>
      <div className="ks-form two">
        <label className="ks-field">
          Series
          <select className="k-input" value={series} onChange={(e) => setSeries(Number(e.target.value))}>
            {ch.spec.series.map((s, i) => (
              <option key={i} value={i}>{s.name || s.ref}</option>
            ))}
          </select>
        </label>
        <label className="ks-field">
          Model
          <select className="k-input" value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        {model === 'Polynomial' && (
          <label className="ks-field">
            Order
            <input className="k-input" type="number" min={2} max={9} value={order} onChange={(e) => setOrder(Math.max(2, Math.min(9, Number(e.target.value) || 2)))} />
          </label>
        )}
        {model === 'Moving Average' && (
          <label className="ks-field">
            Period
            <input className="k-input" type="number" min={2} value={period} onChange={(e) => setPeriod(Math.max(2, Number(e.target.value) || 2))} />
          </label>
        )}
        <label className="ks-field">
          Forecast forward
          <input className="k-input" type="number" value={forward} onChange={(e) => setForward(Number(e.target.value) || 0)} />
        </label>
        <label className="ks-field">
          Forecast backward
          <input className="k-input" type="number" value={backward} onChange={(e) => setBackward(Number(e.target.value) || 0)} />
        </label>
      </div>
      <div className="ks-row">
        <label className="ks-check"><input type="checkbox" checked={showEq} onChange={(e) => setShowEq(e.target.checked)} /> Show the equation</label>
        <label className="ks-check"><input type="checkbox" checked={showR2} onChange={(e) => setShowR2(e.target.checked)} /> Show R²</label>
        <label className="ks-check">Colour <input type="color" className="ks-color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
        <button className="k-btn small primary" onClick={() => save([...list, { series, model, polyOrder: order, maPeriod: period, color, showEquation: showEq, showR2, forward, backward, linestyle: '--', linewidth: 1.5 }])}>
          <Plus size={14} /> Add Trendline
        </button>
      </div>
      <h4 className="ks-h4">On this chart</h4>
      {!list.length && <p className="ks-note">No trendline yet.</p>}
      {list.map((t, i) => {
        const fit = fits[i]
        return (
          <div key={i} className="ks-trend">
            <span className="ks-dot" style={{ background: t.color ?? '#d62728' }} />
            <div className="ks-trend-body">
              <b>{t.model}</b> on {ch.spec.series[t.series]?.name || ch.spec.series[t.series]?.ref || `series ${t.series + 1}`} · {dash[t.linestyle ?? '--'] ?? 'Dashed'}
              {fit?.error ? (
                <div className="k-error">{fit.error}</div>
              ) : fit?.equation ? (
                <div className="ks-mono">
                  {fit.equation}
                  {typeof fit.gof?.['R²'] === 'number' && <span className="k-muted"> · R² = {fit.gof['R²'].toFixed(5)}</span>}
                </div>
              ) : (
                <div className="k-muted">Fitted when the chart is drawn…</div>
              )}
            </div>
            <button className="k-icon-btn" title="Remove" onClick={() => save(list.filter((_t, j) => j !== i))}>
              <Trash2 size={14} />
            </button>
          </div>
        )
      })}
    </Modal>
  )
}

export function SolverDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  const sh = book.active
  const saved = savedSolver(sh)
  const sel = sh.sel
  const [objective, setObjective] = useState(saved.objective ?? `$${colName(sel.active.c)}$${sel.active.r + 1}`)
  const [variables, setVariables] = useState(saved.variables ?? '')
  const [goal, setGoal] = useState<SolverProblem['goal']>(saved.goal ?? 'min')
  const [target, setTarget] = useState(saved.target ?? 0)
  const [method, setMethod] = useState(saved.method ?? 'GRG Nonlinear')
  const [nonNegative, setNonNegative] = useState(saved.nonNegative ?? false)
  const [constraints, setConstraints] = useState<SolverProblem['constraints']>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SolverOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const methods = book.solverMethods.length ? book.solverMethods : ['GRG Nonlinear', 'LP Simplex', 'Evolutionary']
  const solve = async () => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await runSolver(book, { objective, variables, goal, target, constraints, nonNegative, method }))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title="Solver"
      wide
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="k-btn" disabled={busy} onClick={onClose}>Close</button>
          <button className="k-btn primary" disabled={busy || !objective || !variables} onClick={() => void solve()}>
            {busy && <LoaderCircle size={14} className="k-spin" />} Solve
          </button>
        </>
      }
    >
      <div className="ks-form two">
        <label className="ks-field">
          Set objective
          <input className="k-input ks-mono" value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="$B$10" />
        </label>
        <label className="ks-field">
          By changing cells
          <input className="k-input ks-mono" value={variables} onChange={(e) => setVariables(e.target.value)} placeholder="$B$2:$B$4" />
        </label>
      </div>
      <div className="ks-row">
        <label className="ks-check"><input type="radio" checked={goal === 'max'} onChange={() => setGoal('max')} /> Max</label>
        <label className="ks-check"><input type="radio" checked={goal === 'min'} onChange={() => setGoal('min')} /> Min</label>
        <label className="ks-check"><input type="radio" checked={goal === 'value'} onChange={() => setGoal('value')} /> Value of</label>
        <input className="k-input ks-num" type="number" value={target} disabled={goal !== 'value'} onChange={(e) => setTarget(Number(e.target.value) || 0)} />
      </div>
      <h4 className="ks-h4">Subject to the constraints</h4>
      {constraints.map((con, i) => (
        <div key={i} className="ks-series-row">
          <input className="k-input ks-mono" value={con.cell} placeholder="$B$2" onChange={(e) => setConstraints(constraints.map((x, j) => (j === i ? { ...x, cell: e.target.value } : x)))} />
          <select className="k-input" value={con.op} onChange={(e) => setConstraints(constraints.map((x, j) => (j === i ? { ...x, op: e.target.value as '<=' | '>=' | '=' } : x)))}>
            <option value="<=">≤</option>
            <option value=">=">≥</option>
            <option value="=">=</option>
          </select>
          <input className="k-input" type="number" value={con.value} onChange={(e) => setConstraints(constraints.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) || 0 } : x)))} />
          <button className="k-icon-btn" title="Remove" onClick={() => setConstraints(constraints.filter((_x, j) => j !== i))}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button className="k-btn small" onClick={() => setConstraints([...constraints, { cell: '', op: '<=', value: 0 }])}>
        <Plus size={14} /> Add a constraint
      </button>
      <div className="ks-row">
        <label className="ks-check"><input type="checkbox" checked={nonNegative} onChange={(e) => setNonNegative(e.target.checked)} /> Make unconstrained variables non-negative</label>
        <label className="ks-field small">
          Method
          <select className="k-input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {methods.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
      </div>
      {busy && <p className="ks-note">Searching… (scipy runs in this window's Python; the first use downloads it).</p>}
      {error && <p className="k-error">{error}</p>}
      {result && (
        <p className={result.found ? 'ks-ok' : 'k-error'}>
          {result.found ? (result.success ? 'Solver found a solution.' : `Solver kept the best values found (${result.message}).`) : result.message || 'Solver could not find a solution.'}
          {result.found && result.objective !== null && ` Objective cell value: ${Number(result.objective.toPrecision(10))}`}
        </p>
      )}
    </Modal>
  )
}

export function SortDialog({ book, range, onClose }: { book: Book; range: Range; onClose: () => void }) {
  const sh = book.active
  const [header, setHeader] = useState(looksLikeHeader(sh, range))
  const [col, setCol] = useState(Math.min(Math.max(sh.sel.active.c, range.c1), range.c2))
  const [ascending, setAscending] = useState(true)
  const cols: number[] = []
  for (let c = range.c1; c <= range.c2; c++) cols.push(c)
  const label = (c: number) => (header ? `${colName(c)} — ${sh.cells.get(key(range.r1, c))?.t || '(empty)'}` : `Column ${colName(c)}`)
  return (
    <Modal
      title={`Sort ${rangeA1(range)}`}
      onClose={onClose}
      footer={
        <>
          <button className="k-btn" onClick={onClose}>Cancel</button>
          <button className="k-btn primary" onClick={() => {
            void sortRange(book, range, col, ascending, header)
            onClose()
          }}>Sort</button>
        </>
      }
    >
      <label className="ks-check"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> My data has a header row</label>
      <label className="ks-field">
        Sort by
        <select className="k-input" value={col} onChange={(e) => setCol(Number(e.target.value))}>
          {cols.map((c) => (
            <option key={c} value={c}>{label(c)}</option>
          ))}
        </select>
      </label>
      <div className="ks-row">
        <label className="ks-check"><input type="radio" checked={ascending} onChange={() => setAscending(true)} /> A → Z (smallest first)</label>
        <label className="ks-check"><input type="radio" checked={!ascending} onChange={() => setAscending(false)} /> Z → A (largest first)</label>
      </div>
    </Modal>
  )
}
