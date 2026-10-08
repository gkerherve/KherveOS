// The Statistics tab: the list editor (L1…L6, also usable in Calculate),
// one-variable summaries with a histogram, regressions with the fit plotted,
// probability distributions and hypothesis tests (SciPy).

import { useEffect, useMemo, useState, type ClipboardEvent } from 'react'
import { Eraser, FunctionSquare, LineChart, Save } from 'lucide-react'
import { os } from '@/os'
import { Tex } from './Tex'
import { Plot, type PlotLayer } from './PlotCanvas'
import { MODELS, histogram, nums, oneVar, pairs, regression, type Fit, type Model } from './stats'
import { fmt } from './format'
import { linspace, type View } from './plot'
import { LIST_NAMES, type CalcSettings, type HistoryEntry, type ListName } from './session'
import { engineSettings } from './CalcView'
import type { CalcBridge } from './bridge'

type Lists = Record<ListName, (number | null)[]>
type Sub = '1var' | 'reg' | 'dist' | 'test'

interface Props {
  bridge: CalcBridge
  settings: CalcSettings
  lists: Lists
  setLists: (l: Lists) => void
  evaluate: (src: string) => Promise<HistoryEntry | null>
  addGraph: (expr: string) => void
}

const DISTS: { id: string; label: string; params: [string, number][]; discrete?: boolean }[] = [
  { id: 'normal', label: 'Normal', params: [['μ', 0], ['σ', 1]] },
  { id: 't', label: 'Student t', params: [['ν', 10]] },
  { id: 'chi2', label: 'χ²', params: [['k', 4]] },
  { id: 'f', label: 'F', params: [['d₁', 5], ['d₂', 10]] },
  { id: 'exponential', label: 'Exponential', params: [['λ', 1]] },
  { id: 'uniform', label: 'Uniform', params: [['a', 0], ['b', 1]] },
  { id: 'gamma', label: 'Gamma', params: [['k', 2], ['θ', 1]] },
  { id: 'beta', label: 'Beta', params: [['α', 2], ['β', 5]] },
  { id: 'lognormal', label: 'Log-normal', params: [['μ', 0], ['σ', 1]] },
  { id: 'weibull', label: 'Weibull', params: [['k', 1.5], ['λ', 1]] },
  { id: 'cauchy', label: 'Cauchy', params: [['x₀', 0], ['γ', 1]] },
  { id: 'binomial', label: 'Binomial', params: [['n', 10], ['p', 0.5]], discrete: true },
  { id: 'poisson', label: 'Poisson', params: [['λ', 3]], discrete: true },
  { id: 'geometric', label: 'Geometric', params: [['p', 0.3]], discrete: true },
  { id: 'hypergeometric', label: 'Hypergeometric', params: [['M', 50], ['n', 10], ['N', 12]], discrete: true },
  { id: 'negbinomial', label: 'Negative binomial', params: [['r', 5], ['p', 0.5]], discrete: true },
]

const TESTS: { id: string; label: string; needs: ('a' | 'b' | 'mu0' | 'sigma' | 'prop' | 'table' | 'pooled')[] }[] = [
  { id: 't1', label: 'One-sample t-test', needs: ['a', 'mu0'] },
  { id: 'z1', label: 'One-sample z-test (σ known)', needs: ['a', 'mu0', 'sigma'] },
  { id: 't2', label: 'Two-sample t-test', needs: ['a', 'b', 'pooled'] },
  { id: 'paired', label: 'Paired t-test', needs: ['a', 'b'] },
  { id: 'prop1', label: 'One-proportion z-test', needs: ['prop'] },
  { id: 'chi2gof', label: 'χ² goodness of fit (observed, expected)', needs: ['a', 'b'] },
  { id: 'chi2ind', label: 'χ² independence (lists = columns)', needs: ['table'] },
  { id: 'anova', label: 'One-way ANOVA (lists = groups)', needs: ['table'] },
  { id: 'linreg', label: 'Linear regression t-test (x, y)', needs: ['a', 'b'] },
  { id: 'normality', label: 'Shapiro–Wilk normality', needs: ['a'] },
]

export function StatsView({ bridge, settings, lists, setLists, evaluate, addGraph }: Props) {
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [sub, setSub] = useState<Sub>('1var')
  const [one, setOne] = useState<{ list: ListName; freq: ListName | '' }>({ list: 'L1', freq: '' })
  const [reg, setReg] = useState<{ x: ListName; y: ListName; model: Model; name: string }>({ x: 'L1', y: 'L2', model: 'linear', name: 'freg' })
  const [dist, setDist] = useState<{ id: string; params: number[]; fn: 'pdf' | 'cdf' | 'sf' | 'inv'; x: string }>({ id: 'normal', params: [0, 1], fn: 'cdf', x: '1.96' })
  const [distOut, setDistOut] = useState<{ value?: number; mean?: number; var?: number; curve?: { x: number[]; y: (number | null)[]; discrete: boolean }; error?: string } | null>(null)
  const [test, setTest] = useState({ id: 't1', a: 'L1' as ListName, b: 'L2' as ListName, mu0: '0', sigma: '1', alt: 'two-sided', level: '0.95', pooled: false, successes: '45', n: '100', p0: '0.5', table: ['L1', 'L2'] as ListName[] })
  const [testOut, setTestOut] = useState<Record<string, unknown> | null>(null)

  const rowsShown = Math.max(14, ...LIST_NAMES.map((n) => lists[n].length + 1))

  const commit = (n: ListName, i: number, text: string) => {
    const t = text.trim()
    const v = t === '' ? null : Number(t.replace(',', '.'))
    const col = [...lists[n]]
    while (col.length <= i) col.push(null)
    col[i] = v === null || Number.isFinite(v) ? v : col[i]
    while (col.length && col[col.length - 1] === null) col.pop()
    setLists({ ...lists, [n]: col })
  }

  const paste = (n: ListName, i: number, e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!/[\n\t]/.test(text.trim())) return
    e.preventDefault()
    const rows = text.trim().split(/\r?\n/).map((r) => r.split(/\t|;|,(?=\s*[-\d.])/))
    const next = { ...lists }
    const c0 = LIST_NAMES.indexOf(n)
    rows.forEach((r, ri) =>
      r.forEach((cell, ci) => {
        const name = LIST_NAMES[c0 + ci]
        if (!name) return
        const col = [...next[name]]
        while (col.length <= i + ri) col.push(null)
        const v = Number(cell.trim())
        col[i + ri] = cell.trim() === '' || !Number.isFinite(v) ? null : v
        next[name] = col
      }),
    )
    setLists(next)
  }

  const fillFormula = async (n: ListName) => {
    const f = await os.dialog.prompt(`A formula of the other lists, row by row (e.g. L1^2 or 2*L1 + 1), or a sequence: seq(k^2, k, 1, 10).`, {
      title: `Fill ${n}`, defaultValue: n === 'L1' ? 'seq(k, k, 1, 10)' : 'L1^2',
    })
    if (!f?.trim()) return
    const m = /^\s*seq\((.*),\s*([A-Za-z]\w*)\s*,\s*([^,]+),\s*([^,]+?)(?:,\s*([^,]+))?\)\s*$/.exec(f)
    const args = m
      ? { expr: m[1], var: m[2], start: Number(m[3]), stop: Number(m[4]), step: m[5] ? Number(m[5]) : 1 }
      : { expr: f }
    if (m && ![args.start, args.stop, args.step].every((v) => Number.isFinite(v))) return void os.notify({ title: 'kCalc', body: 'seq needs numbers for its start, stop and step.' })
    try {
      const r = await bridge.call<{ ok: boolean; values?: (number | null)[]; error?: string }>('fill', { ...args, settings: engineSettings(settings) })
      if (!r.ok || !r.values) return void os.notify({ title: 'kCalc', body: r.error ?? 'The formula gave no values.' })
      setLists({ ...lists, [n]: r.values })
    } catch (e) {
      os.notify({ title: 'kCalc', body: e instanceof Error ? e.message : String(e) })
    }
  }

  // ------------------------------------------------------------ analyses

  const oneRes = useMemo((): { s: ReturnType<typeof oneVar>; xs: number[] } | { error: string } | null => {
    try {
      const xs = nums(lists[one.list])
      if (!xs.length) return null
      const freq = one.freq ? lists[one.freq].slice(0, lists[one.list].length).map((v) => v ?? 1) : undefined
      return { s: oneVar(xs, freq), xs }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }, [lists, one])

  const regRes = useMemo((): { fit: Fit; X: number[]; Y: number[] } | { error: string } | null => {
    const [X, Y] = pairs(lists[reg.x], lists[reg.y])
    if (!X.length) return null
    try {
      return { fit: regression(X, Y, reg.model), X, Y }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }, [lists, reg.x, reg.y, reg.model])

  useEffect(() => {
    if (sub !== 'dist') return
    const t = setTimeout(() => {
      const x = Number(dist.x)
      if (!Number.isFinite(x)) return setDistOut({ error: 'x must be a number' })
      bridge
        .call<{ ok: boolean; error?: string; value?: number; mean?: number; var?: number; curve?: { x: number[]; y: (number | null)[]; discrete: boolean } }>('dist', {
          name: dist.id, fn: dist.fn, x, params: dist.params,
        })
        .then((r) => setDistOut(r.ok ? r : { error: r.error }))
        .catch(() => {})
    }, 120)
    return () => clearTimeout(t)
  }, [dist, sub, bridge])

  const runTest = async () => {
    const t = TESTS.find((x) => x.id === test.id)!
    const data: Record<string, unknown> = { a: nums(lists[test.a]), b: nums(lists[test.b]) }
    if (t.needs.includes('table')) data.table = test.table.map((n) => nums(lists[n]))
    const r = await bridge.call<Record<string, unknown>>('test', {
      kind: test.id, data,
      opts: { mu0: Number(test.mu0), sigma: Number(test.sigma), alternative: test.alt, level: Number(test.level), pooled: test.pooled, successes: Number(test.successes), n: Number(test.n), p0: Number(test.p0) },
    })
    setTestOut(r)
  }

  // --------------------------------------------------------------- plot

  const plot = useMemo((): { layers: PlotLayer[]; view: View } | null => {
    const pad = (lo: number, hi: number) => {
      const m = (hi - lo || Math.abs(hi) || 1) * 0.08
      return [lo - m, hi + m]
    }
    if (sub === '1var' && oneRes && 's' in oneRes && oneRes.xs.length) {
      const h = histogram(oneRes.xs)
      const [x0, x1] = pad(h.edges[0], h.edges[h.edges.length - 1])
      return { layers: [{ kind: 'bars', edges: h.edges, heights: h.counts, color: '#22b357' }], view: { xmin: x0, xmax: x1, ymin: -Math.max(...h.counts) * 0.06, ymax: Math.max(...h.counts) * 1.15 } }
    }
    if ((sub === 'reg' || sub === 'test') && regRes && 'fit' in regRes) {
      const { X, Y, fit } = regRes
      const [x0, x1] = pad(Math.min(...X), Math.max(...X))
      const xs = linspace(x0, x1, 300)
      const ys = xs.map((x) => {
        const v = fit.predict(x)
        return Number.isFinite(v) ? v : null
      })
      const [y0, y1] = pad(Math.min(...Y), Math.max(...Y))
      return {
        layers: [{ kind: 'line', xs, ys, color: '#3b82f6', width: 2 }, { kind: 'scatter', xs: X, ys: Y, color: '#22b357' }],
        view: { xmin: x0, xmax: x1, ymin: y0, ymax: y1 },
      }
    }
    if (sub === 'dist' && distOut?.curve) {
      const c = distOut.curve
      const ysn = c.y.map((v) => v ?? 0)
      const ymax = Math.max(...ysn) * 1.15 || 1
      const [x0, x1] = pad(Math.min(...c.x), Math.max(...c.x))
      const x = dist.fn === 'inv' ? distOut.value ?? 0 : Number(dist.x)
      const layers: PlotLayer[] = []
      const lo = dist.fn === 'sf' ? x : -Infinity
      const hi = dist.fn === 'sf' ? Infinity : x
      if (c.discrete) {
        layers.push({ kind: 'stems', xs: c.x, ys: ysn, color: '#22b357', highlight: dist.fn === 'pdf' ? (k) => k === x : (k) => k >= lo && k <= hi })
      } else {
        if (dist.fn !== 'pdf') layers.push({ kind: 'area', xs: c.x, ys: c.y, color: '#22b357', from: lo, to: hi })
        layers.push({ kind: 'line', xs: c.x, ys: c.y, color: '#22b357', width: 2 })
      }
      return { layers, view: { xmin: x0, xmax: x1, ymin: -ymax * 0.05, ymax } }
    }
    return null
  }, [sub, oneRes, regRes, distOut, dist.fn, dist.x])

  const d = DISTS.find((x) => x.id === dist.id)!
  const tdef = TESTS.find((x) => x.id === test.id)!
  const listSel = (value: string, set: (v: ListName) => void, allowNone = false) => (
    <select className="k-input kc-small-select" value={value} onChange={(e) => set(e.target.value as ListName)}>
      {allowNone && <option value="">—</option>}
      {LIST_NAMES.map((n) => <option key={n} value={n}>{n} ({nums(lists[n]).length})</option>)}
    </select>
  )

  return (
    <div className="kc-stats">
      <div className="kc-lists">
        <table className="kc-table kc-list-table">
          <thead>
            <tr>
              <th className="kc-rownum">#</th>
              {LIST_NAMES.map((n) => (
                <th key={n}>
                  <span>{n}</span>
                  <button className="k-icon-btn kc-th-btn" title={`Fill ${n} with a formula`} onClick={() => void fillFormula(n)}><FunctionSquare size={12} /></button>
                  <button className="k-icon-btn kc-th-btn" title={`Clear ${n}`} onClick={() => setLists({ ...lists, [n]: [] })}><Eraser size={12} /></button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowsShown }, (_, i) => (
              <tr key={i}>
                <td className="kc-rownum">{i + 1}</td>
                {LIST_NAMES.map((n) => {
                  const key = `${n}:${i}`
                  const v = lists[n][i]
                  return (
                    <td key={n}>
                      <input
                        className="kc-cell"
                        value={editing[key] ?? (v === null || v === undefined ? '' : String(v))}
                        onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                        onBlur={() => {
                          if (key in editing) {
                            commit(n, i, editing[key])
                            const { [key]: _, ...rest } = editing
                            void _
                            setEditing(rest)
                          }
                        }}
                        onPaste={(e) => paste(n, i, e)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                            e.preventDefault()
                            const td = e.currentTarget.closest('tr')
                            const row = e.key === 'ArrowUp' ? td?.previousElementSibling : td?.nextElementSibling
                            const col = LIST_NAMES.indexOf(n) + 1
                            ;(row?.children[col]?.querySelector('input') as HTMLInputElement | null)?.focus()
                          }
                        }}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="kc-stats-right">
        <div className="kc-subtabs">
          {([['1var', 'One variable'], ['reg', 'Regression'], ['dist', 'Distributions'], ['test', 'Tests']] as [Sub, string][]).map(([id, label]) => (
            <button key={id} className={sub === id ? 'active' : ''} onClick={() => setSub(id)}>{label}</button>
          ))}
        </div>
        <div className="kc-stats-body">
          {sub === '1var' && (
            <>
              <div className="kc-btnrow">
                <label className="kc-inline">List {listSel(one.list, (v) => setOne({ ...one, list: v }))}</label>
                <label className="kc-inline">Frequencies {listSel(one.freq, (v) => setOne({ ...one, freq: v }), true)}</label>
              </div>
              {oneRes && 'error' in oneRes && <div className="kc-error">{oneRes.error}</div>}
              {oneRes && 's' in oneRes && (
                <table className="kc-kv">
                  <tbody>
                    {([
                      ['n', oneRes.s.n], ['x̄ (mean)', oneRes.s.mean], ['Σx', oneRes.s.sum], ['Σx²', oneRes.s.sum2], ['sx (sample sd)', oneRes.s.sx],
                      ['σx (population sd)', oneRes.s.sigma], ['s² (variance)', oneRes.s.variance], ['SE of mean', oneRes.s.sem], ['min', oneRes.s.min],
                      ['Q1', oneRes.s.q1], ['median', oneRes.s.median], ['Q3', oneRes.s.q3], ['max', oneRes.s.max], ['range', oneRes.s.range],
                      ['IQR', oneRes.s.iqr], ['skewness', oneRes.s.skewness], ['excess kurtosis', oneRes.s.kurtosis], ['CV', oneRes.s.cv],
                    ] as [string, number][]).map(([k, v]) => (
                      <tr key={k}><td>{k}</td><td className="kc-mono">{fmt(v, 10)}</td></tr>
                    ))}
                    <tr><td>mode</td><td className="kc-mono">{oneRes.s.mode.length ? oneRes.s.mode.map((m) => fmt(m, 10)).join(', ') : 'none'}</td></tr>
                  </tbody>
                </table>
              )}
              {!oneRes && <div className="k-muted kc-pad">Type or paste numbers in a list.</div>}
            </>
          )}
          {sub === 'reg' && (
            <>
              <div className="kc-btnrow">
                <label className="kc-inline">x {listSel(reg.x, (v) => setReg({ ...reg, x: v }))}</label>
                <label className="kc-inline">y {listSel(reg.y, (v) => setReg({ ...reg, y: v }))}</label>
                <select className="k-input kc-small-select" value={reg.model} onChange={(e) => setReg({ ...reg, model: e.target.value as Model })}>
                  {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}: {m.form}</option>)}
                </select>
              </div>
              {regRes && 'error' in regRes && <div className="kc-error">{regRes.error}</div>}
              {regRes && 'fit' in regRes && (
                <>
                  <div className="kc-fit"><Tex tex={regRes.fit.latex} display /></div>
                  <table className="kc-kv">
                    <tbody>
                      {regRes.fit.coeffs.map((c, i) => (
                        <tr key={i}><td>{['a', 'b', 'c', 'd', 'e'][i]}</td><td className="kc-mono">{fmt(c, 12)}</td></tr>
                      ))}
                      <tr><td>R²</td><td className="kc-mono">{fmt(regRes.fit.r2, 10)}</td></tr>
                      {regRes.fit.r !== null && <tr><td>r {reg.model === 'linear' ? '' : '(linearised)'}</td><td className="kc-mono">{fmt(regRes.fit.r, 10)}</td></tr>}
                      <tr><td>n</td><td className="kc-mono">{regRes.X.length}</td></tr>
                    </tbody>
                  </table>
                  <div className="kc-btnrow">
                    <button className="k-btn small" onClick={() => addGraph(regRes.fit.expr)}><LineChart size={13} /> Graph it</button>
                    <input className="k-input kc-num" value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value.replace(/[^\w]/g, '') })} />
                    <button className="k-btn small" onClick={() => void evaluate(`${reg.name || 'freg'}(x) := ${regRes.fit.expr}`)}><Save size={13} /> Store as {reg.name || 'freg'}(x)</button>
                  </div>
                </>
              )}
              {!regRes && <div className="k-muted kc-pad">Put x values in one list and y values in another.</div>}
            </>
          )}
          {sub === 'dist' && (
            <>
              <div className="kc-btnrow">
                <select className="k-input kc-small-select" value={dist.id} onChange={(e) => {
                  const nd = DISTS.find((x) => x.id === e.target.value)!
                  setDist({ ...dist, id: nd.id, params: nd.params.map(([, v]) => v), x: nd.discrete ? '3' : dist.x })
                }}>
                  {DISTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
                {d.params.map(([label], i) => (
                  <label key={label} className="kc-inline">
                    {label}
                    <input className="k-input kc-num" value={String(dist.params[i] ?? '')} onChange={(e) => {
                      const ps = [...dist.params]
                      ps[i] = Number(e.target.value)
                      setDist({ ...dist, params: ps })
                    }} />
                  </label>
                ))}
              </div>
              <div className="kc-btnrow">
                <select className="k-input kc-small-select" value={dist.fn} onChange={(e) => setDist({ ...dist, fn: e.target.value as typeof dist.fn })}>
                  <option value="pdf">{d.discrete ? 'P(X = x)' : 'density f(x)'}</option>
                  <option value="cdf">P(X ≤ x)</option>
                  <option value="sf">P(X &gt; x)</option>
                  <option value="inv">quantile: x with P(X ≤ x) = p</option>
                </select>
                <label className="kc-inline">{dist.fn === 'inv' ? 'p' : 'x'} <input className="k-input kc-num" value={dist.x} onChange={(e) => setDist({ ...dist, x: e.target.value })} /></label>
              </div>
              {distOut?.error && <div className="kc-error">{distOut.error}</div>}
              {distOut && !distOut.error && (
                <table className="kc-kv">
                  <tbody>
                    <tr><td>{dist.fn === 'inv' ? 'x' : dist.fn === 'pdf' ? (d.discrete ? 'P(X = x)' : 'f(x)') : dist.fn === 'cdf' ? 'P(X ≤ x)' : 'P(X > x)'}</td><td className="kc-mono kc-big">{fmt(distOut.value, 12)}</td></tr>
                    <tr><td>mean</td><td className="kc-mono">{fmt(distOut.mean, 10)}</td></tr>
                    <tr><td>variance</td><td className="kc-mono">{fmt(distOut.var, 10)}</td></tr>
                  </tbody>
                </table>
              )}
            </>
          )}
          {sub === 'test' && (
            <>
              <div className="kc-btnrow">
                <select className="k-input kc-small-select" value={test.id} onChange={(e) => { setTest({ ...test, id: e.target.value }); setTestOut(null) }}>
                  {TESTS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <div className="kc-btnrow kc-wrap">
                {tdef.needs.includes('a') && <label className="kc-inline">{test.id === 'linreg' ? 'x' : test.id === 'chi2gof' ? 'observed' : 'data'} {listSel(test.a, (v) => setTest({ ...test, a: v }))}</label>}
                {tdef.needs.includes('b') && <label className="kc-inline">{test.id === 'linreg' ? 'y' : test.id === 'chi2gof' ? 'expected' : 'second'} {listSel(test.b, (v) => setTest({ ...test, b: v }))}</label>}
                {tdef.needs.includes('mu0') && <label className="kc-inline">μ₀ <input className="k-input kc-num" value={test.mu0} onChange={(e) => setTest({ ...test, mu0: e.target.value })} /></label>}
                {tdef.needs.includes('sigma') && <label className="kc-inline">σ <input className="k-input kc-num" value={test.sigma} onChange={(e) => setTest({ ...test, sigma: e.target.value })} /></label>}
                {tdef.needs.includes('pooled') && <label className="kc-inline"><input type="checkbox" checked={test.pooled} onChange={(e) => setTest({ ...test, pooled: e.target.checked })} /> equal variances</label>}
                {tdef.needs.includes('prop') && (
                  <>
                    <label className="kc-inline">successes <input className="k-input kc-num" value={test.successes} onChange={(e) => setTest({ ...test, successes: e.target.value })} /></label>
                    <label className="kc-inline">n <input className="k-input kc-num" value={test.n} onChange={(e) => setTest({ ...test, n: e.target.value })} /></label>
                    <label className="kc-inline">p₀ <input className="k-input kc-num" value={test.p0} onChange={(e) => setTest({ ...test, p0: e.target.value })} /></label>
                  </>
                )}
                {tdef.needs.includes('table') && (
                  <span className="kc-inline">
                    {LIST_NAMES.map((n) => (
                      <label key={n} className="kc-inline">
                        <input type="checkbox" checked={test.table.includes(n)} onChange={(e) => setTest({ ...test, table: e.target.checked ? [...test.table, n] : test.table.filter((x) => x !== n) })} />
                        {n}
                      </label>
                    ))}
                  </span>
                )}
                {!['chi2gof', 'chi2ind', 'anova', 'normality'].includes(test.id) && (
                  <select className="k-input kc-small-select" value={test.alt} onChange={(e) => setTest({ ...test, alt: e.target.value })}>
                    <option value="two-sided">H₁: ≠</option>
                    <option value="less">H₁: &lt;</option>
                    <option value="greater">H₁: &gt;</option>
                  </select>
                )}
                <label className="kc-inline">level <input className="k-input kc-num" value={test.level} onChange={(e) => setTest({ ...test, level: e.target.value })} /></label>
                <button className="k-btn primary small" onClick={() => void runTest()}>Run test</button>
              </div>
              {testOut && (testOut.ok === false ? <div className="kc-error">{String(testOut.error)}</div> : (
                <table className="kc-kv">
                  <tbody>
                    {Object.entries(testOut).filter(([k]) => k !== 'ok').map(([k, v]) => (
                      <tr key={k}><td>{LABELS[k] ?? k}</td><td className="kc-mono">{Array.isArray(v) ? `[${v.map((x) => fmt(x as number, 8)).join(', ')}]` : typeof v === 'number' ? fmt(v, 10) : String(v)}</td></tr>
                    ))}
                    {typeof testOut.p === 'number' && (
                      <tr>
                        <td>verdict</td>
                        <td className={(testOut.p as number) < 1 - Number(test.level) ? 'kc-reject' : ''}>
                          {(testOut.p as number) < 1 - Number(test.level) ? `Reject H₀ at α = ${fmt(1 - Number(test.level), 4)}` : `Do not reject H₀ at α = ${fmt(1 - Number(test.level), 4)}`}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ))}
            </>
          )}
        </div>
        <div className="kc-stats-plot">
          {plot ? <Plot view={plot.view} layers={plot.layers} /> : <div className="k-muted kc-pad">The plot appears here.</div>}
        </div>
      </div>
    </div>
  )
}

const LABELS: Record<string, string> = {
  statistic: 'test statistic', df: 'degrees of freedom', p: 'p-value', ci: 'confidence interval', mean: 'mean', sd: 'sample sd', n: 'n',
  mean_a: 'mean (first)', mean_b: 'mean (second)', mean_diff: 'mean difference', phat: 'p̂', slope: 'slope', intercept: 'intercept', r: 'r', stderr: 'slope std. error',
}
