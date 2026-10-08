// The result panels of kStats: Describe, Fit, Compare models, Tests and Correlation.

import { useMemo, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, MinusCircle } from 'lucide-react'
import { columnValues, usableColumns, type Data } from './data'
import { MODELS, predict, type CompareRow, type FitResult } from './fits'
import { boxFigure, fitFigure, heatmapFigure, histogramFigure, residualFigure, type Palette } from './figures'
import { describe, fixed, fmt, fmtP, outliers } from './math'
import PlotlyChart from './PlotlyChart'
import { TEST_KINDS, type TestConfig, type TestKind } from './run'
import type { CorrMatrix, TestResult } from './tests'
import { toNumber } from '@/os/table'

export function Segmented<T extends string>({ value, options, onChange }: {
  value: T
  options: [T, string][]
  onChange(v: T): void
}) {
  return (
    <div className="ks-seg" role="tablist">
      {options.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={value === id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>{label}</button>
      ))}
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="ks-note k-muted">{children}</div>
}

/** Options for a column picker: the columns that hold numbers. */
export function numericColumns(data: Data): number[] {
  return data.table.headers.map((_, i) => i).filter((i) => data.table.rows.some((r) => Number.isFinite(toNumber(r[i]))))
}

function ColumnSelect({ label, value, options, headers, onChange, none }: {
  label: string
  value: number
  options: number[]
  headers: string[]
  onChange(v: number): void
  none?: string
}) {
  return (
    <label className="ks-field">{label}
      <select className="k-input" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {none && <option value={-1}>{none}</option>}
        {options.map((i) => <option key={i} value={i}>{headers[i]}</option>)}
      </select>
    </label>
  )
}

// ---------------------------------------------------------------- Describe

export function DescribePanel({ data, selCol, setSelCol, chart, setChart, standardise, setStandardise, pal }: {
  data: Data
  selCol: number
  setSelCol(i: number): void
  chart: 'hist' | 'box'
  setChart(c: 'hist' | 'box'): void
  standardise: boolean
  setStandardise(v: boolean): void
  pal: Palette
}) {
  const cols = useMemo(() => usableColumns(data), [data])
  const stats = useMemo(
    () => cols.map((ci) => {
      const { values, rows } = columnValues(data.table, ci)
      return { ci, values, rows, d: describe(values), out: outliers(values) }
    }),
    [cols, data],
  )
  const sel = stats.find((s) => s.ci === selCol) ?? stats[0]
  const figure = useMemo(() => {
    if (!sel) return null
    return chart === 'hist'
      ? histogramFigure(sel.values, data.table.headers[sel.ci], pal)
      : boxFigure(stats.map((s) => ({ name: data.table.headers[s.ci], values: s.values })), standardise, pal)
  }, [sel, stats, chart, standardise, pal, data.table.headers])

  if (!stats.length) return <Empty>No numeric columns to describe. Type or paste numbers into the table, or open a file.</Empty>
  const h = data.table.headers
  return (
    <div className="ks-panel">
      <div className="ks-scroll">
        <table className="ks-table">
          <thead>
            <tr>
              <th>column</th><th>n</th><th>mean</th><th>sd</th><th>sem</th><th title="95 % confidence interval of the mean">95 % CI of mean</th>
              <th>median</th><th>Q1</th><th>Q3</th><th>IQR</th><th>min</th><th>max</th><th>skew</th><th>kurt</th><th title="Values beyond 1.5 × IQR from the quartiles">outliers</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => s.d && (
              <tr key={s.ci} className={s === sel ? 'on' : ''} onClick={() => setSelCol(s.ci)}>
                <td>{h[s.ci]}</td><td>{s.d.n}</td><td>{fmt(s.d.mean)}</td><td>{fmt(s.d.sd)}</td><td>{fmt(s.d.sem)}</td>
                <td>{fmt(s.d.ciLo)} – {fmt(s.d.ciHi)}</td><td>{fmt(s.d.median)}</td><td>{fmt(s.d.q1)}</td><td>{fmt(s.d.q3)}</td><td>{fmt(s.d.iqr)}</td>
                <td>{fmt(s.d.min)}</td><td>{fmt(s.d.max)}</td><td>{fixed(s.d.skew, 2)}</td><td>{fixed(s.d.kurt, 2)}</td>
                <td className={s.out.iqr.length ? 'warn' : ''}>{s.out.iqr.length || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sel?.d && (
        <div className="ks-card">
          <b>{h[sel.ci]}</b>: {sel.d.n} values, mean {fmt(sel.d.mean)} (95 % CI {fmt(sel.d.ciLo)} to {fmt(sel.d.ciHi)}), median {fmt(sel.d.median)}.
          {sel.out.iqr.length > 0 ? (
            <div className="ks-warnline">
              <AlertTriangle size={13} /> Outside the 1.5 × IQR fences ({fmt(sel.out.fenceLo)} to {fmt(sel.out.fenceHi)}):{' '}
              {sel.out.iqr.slice(0, 8).map((k) => `${fmt(sel.values[k])} (row ${sel.rows[k] + 1})`).join(', ')}
              {sel.out.iqr.length > 8 ? ` and ${sel.out.iqr.length - 8} more` : ''}.
            </div>
          ) : <div className="ks-okline"><CheckCircle2 size={13} /> No values outside the 1.5 × IQR fences.</div>}
          {sel.out.grubbs && (
            <div className={sel.out.grubbs.outlier ? 'ks-warnline' : 'ks-okline'}>
              {sel.out.grubbs.outlier ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}{' '}
              Grubbs test: the most extreme value, {fmt(sel.out.grubbs.value)} (row {sel.rows[sel.out.grubbs.index] + 1}), is {sel.out.grubbs.outlier ? 'an outlier' : 'not an outlier'}
              {' '}(G = {fixed(sel.out.grubbs.g, 2)}, critical {fixed(sel.out.grubbs.critical, 2)}, p = {fmtP(sel.out.grubbs.p)}).
            </div>
          )}
        </div>
      )}

      <div className="ks-chartbar">
        <Segmented value={chart} options={[['hist', 'Histogram'], ['box', 'Box plot']]} onChange={setChart} />
        {chart === 'box' && (
          <label className="ks-check"><input type="checkbox" checked={standardise} onChange={(e) => setStandardise(e.target.checked)} /> compare shapes (z-scores)</label>
        )}
        {chart === 'hist' && <span className="k-muted ks-small">of {h[sel.ci]}: click a row above to change the column</span>}
      </div>
      <PlotlyChart figure={figure} height={300} />
    </div>
  )
}

// --------------------------------------------------------------------- Fit

export interface FitPanelProps {
  data: Data
  xi: number
  yi: number
  si: number
  setXi(i: number): void
  setYi(i: number): void
  setSi(i: number): void
  weighted: boolean
  setWeighted(v: boolean): void
  modelId: string
  setModelId(id: string): void
  fit: FitResult | null
  error: string | null
  used: number
  total: number
  x: number[]
  y: number[]
  sigma?: number[]
  chart: 'fit' | 'resid'
  setChart(c: 'fit' | 'resid'): void
  band: 'conf' | 'pred'
  predAt: string
  setPredAt(v: string): void
  pal: Palette
}

export function FitPanel(p: FitPanelProps) {
  const { data, fit } = p
  const h = data.table.headers
  const nums = numericColumns(data)
  const figure = useMemo(() => {
    if (p.chart === 'resid') return fit ? residualFigure(p.x, fit, p.pal) : null
    return p.x.length ? fitFigure({ x: p.x, y: p.y, sigma: p.sigma, fit, xLabel: h[p.xi] ?? 'x', yLabel: h[p.yi] ?? 'y', prediction: p.band === 'pred' }, p.pal) : null
  }, [p.chart, p.x, p.y, p.sigma, fit, p.xi, p.yi, p.band, p.pal, h.join('|')])

  const at = fit && p.predAt.trim() !== '' && Number.isFinite(Number(p.predAt)) ? predict(fit, Number(p.predAt)) : null
  const lacks = nums.length < 2

  return (
    <div className="ks-panel">
      <div className="ks-controls">
        <ColumnSelect label="x" value={p.xi} options={nums} headers={h} onChange={p.setXi} />
        <ColumnSelect label="y" value={p.yi} options={nums} headers={h} onChange={p.setYi} />
        <ColumnSelect label="uncertainty" value={p.weighted ? p.si : -1} options={nums} headers={h} none="none" onChange={(i) => { p.setSi(i); p.setWeighted(i >= 0) }} />
        <label className="ks-field">model
          <select className="k-input" value={p.modelId} onChange={(e) => p.setModelId(e.target.value)}>
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
      </div>

      {lacks ? <Empty>The fit needs two columns of numbers (x and y).</Empty> : (
        <>
          <div className="ks-note k-muted">
            {p.used} of {p.total} rows used{p.total - p.used > 0 ? ` (${p.total - p.used} left out: a missing or non-numeric value in x, y${p.weighted ? ' or the uncertainty' : ''})` : ''}.
            {p.weighted && ' Weighted by 1/σ².'}
          </div>
          {p.error && <div className="ks-warnline"><AlertTriangle size={13} /> {p.error}</div>}
          {fit && (
            <>
              <div className="ks-eq">{fit.equation}</div>
              {!fit.converged && <div className="ks-warnline"><AlertTriangle size={13} /> The iteration stopped before converging: check the curve by eye, or try another model.</div>}
              <div className="ks-metrics">
                <Metric label="R²" value={fixed(fit.r2, 4)} />
                <Metric label="adjusted R²" value={fixed(fit.adjR2, 4)} />
                <Metric label="RMSE" value={fmt(fit.rmse)} />
                <Metric label="residual sd" value={fmt(fit.residualSd)} />
                <Metric label="AIC" value={fixed(fit.aic, 2)} />
                {fit.chi2red !== null && <Metric label="reduced χ²" value={fmt(fit.chi2red)} />}
                <Metric label="points" value={`${fit.n} (${fit.dof} dof)`} />
              </div>
              <div className="ks-scroll">
                <table className="ks-table">
                  <thead><tr><th>parameter</th><th>estimate</th><th>std. error</th><th>95 % CI</th><th>t</th><th>p</th></tr></thead>
                  <tbody>
                    {fit.params.map((q) => (
                      <tr key={q.name}>
                        <td>{q.name}</td><td>{fmt(q.value)}</td><td>{fmt(q.se)}</td><td>{fmt(q.lo)} to {fmt(q.hi)}</td><td>{fixed(q.t, 2)}</td><td>{fmtP(q.p)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="ks-chartbar">
            <Segmented value={p.chart} options={[['fit', 'Data and fit'], ['resid', 'Residuals']]} onChange={p.setChart} />
            {p.chart === 'fit' && fit && <span className="k-muted ks-small">shaded: 95 % {p.band === 'pred' ? 'prediction' : 'confidence'} band</span>}
          </div>
          <PlotlyChart figure={figure} height={320} />
          {fit && (
            <div className="ks-predict">
              <label className="ks-field">predict y at x =
                <input className="k-input" value={p.predAt} onChange={(e) => p.setPredAt(e.target.value)} placeholder="a number" inputMode="decimal" />
              </label>
              {at && (
                <span>
                  y = <b>{fmt(at.y)}</b> <span className="k-muted">· curve 95 % CI {fmt(at.lo)} to {fmt(at.hi)} · a new measurement would fall in {fmt(at.plo)} to {fmt(at.phi)}</span>
                  {(Number(p.predAt) < Math.min(...p.x) || Number(p.predAt) > Math.max(...p.x)) && <span className="warn"> · outside the data: extrapolating</span>}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="ks-metric"><span>{label}</span><b>{value}</b></div>
}

// ----------------------------------------------------------------- Compare

export function ComparePanel({ rows, used, total, current, onPick }: {
  rows: CompareRow[] | null
  used: number
  total: number
  current: string
  onPick(model: string): void
}) {
  if (!rows) return <Empty>Pick x and y columns with numbers in the Fit tab first.</Empty>
  const ok = rows.filter((r) => r.fit)
  return (
    <div className="ks-panel">
      <div className="ks-note k-muted">
        Every model is fitted to the same {used} of {total} rows and ranked by AIC (lower is better; the corrected AICc is used for small samples).
        The weight is the chance, among these models, that this one is the best. Click a row to open that model in the Fit tab.
      </div>
      <div className="ks-scroll">
        <table className="ks-table">
          <thead><tr><th>#</th><th>model</th><th>parameters</th><th>R²</th><th>adj. R²</th><th>RMSE</th><th>AIC</th><th>ΔAIC</th><th>weight</th></tr></thead>
          <tbody>
            {rows.map((r, i) => r.fit ? (
              <tr key={r.model} className={`click${r.model === current ? ' on' : ''}`} onClick={() => onPick(r.model)}>
                <td>{i + 1}</td>
                <td>{r.label}{i === 0 && ok.length > 1 && <span className="ks-badge">best</span>}</td>
                <td>{r.fit.k}</td><td>{fixed(r.fit.r2, 4)}</td><td>{fixed(r.fit.adjR2, 4)}</td><td>{fmt(r.fit.rmse)}</td>
                <td>{fixed(r.fit.aic, 2)}</td><td>{fixed(r.deltaAic, 2)}</td>
                <td><span className="ks-bar"><i style={{ width: `${Math.round(r.weight * 100)}%` }} /></span> {fixed(r.weight, 3)}</td>
              </tr>
            ) : (
              <tr key={r.model} className="off"><td>–</td><td>{r.label}</td><td colSpan={7} className="k-muted">{r.error}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {ok.length > 1 && ok[1].deltaAic < 2 && (
        <div className="ks-warnline"><AlertTriangle size={13} /> {ok[0].label} and {ok[1].label} are within 2 AIC units: the data cannot tell them apart; prefer the simpler one.</div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------- Tests

export function TestsPanel({ data, cfg, setCfg, result }: {
  data: Data
  cfg: TestConfig
  setCfg(c: TestConfig): void
  result: TestResult | string
}) {
  const h = data.table.headers
  const nums = numericColumns(data)
  const info = TEST_KINDS.find((k) => k.id === cfg.kind)!
  const set = (patch: Partial<TestConfig>) => setCfg({ ...cfg, ...patch })
  const setKind = (kind: TestKind) => {
    const i = TEST_KINDS.find((k) => k.id === kind)!
    const defaults = nums.length ? nums : [0]
    const cols = i.columns === 'many' ? usableColumns(data).filter((c) => defaults.includes(c)).slice(0, 8) : defaults.slice(0, i.columns)
    setCfg({ ...cfg, kind, cols: cols.length ? cols : defaults.slice(0, 2) })
  }
  const colAt = (k: number) => (cfg.cols[k] !== undefined && nums.includes(cfg.cols[k]) ? cfg.cols[k] : (nums[k] ?? nums[0] ?? 0))
  return (
    <div className="ks-panel">
      <div className="ks-controls">
        <label className="ks-field">test
          <select className="k-input" value={cfg.kind} onChange={(e) => setKind(e.target.value as TestKind)}>
            {TEST_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </label>
        {info.columns !== 'many' && (
          <>
            <ColumnSelect label={info.columns === 1 ? 'column' : 'first'} value={colAt(0)} options={nums} headers={h} onChange={(c) => set({ cols: info.columns === 1 ? [c] : [c, colAt(1)] })} />
            {info.columns === 2 && <ColumnSelect label="second" value={colAt(1)} options={nums} headers={h} onChange={(c) => set({ cols: [colAt(0), c] })} />}
          </>
        )}
        {info.mu && (
          <label className="ks-field">compare the mean with
            <input className="k-input ks-narrow-in" value={String(cfg.mu)} inputMode="decimal" onChange={(e) => set({ mu: Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : cfg.mu })} />
          </label>
        )}
        <label className="ks-field">significance level
          <select className="k-input" value={cfg.alpha} onChange={(e) => set({ alpha: Number(e.target.value) })}>
            <option value={0.1}>0.10</option><option value={0.05}>0.05</option><option value={0.01}>0.01</option>
          </select>
        </label>
      </div>
      {info.columns === 'many' && (
        <div className="ks-groups">
          <span className="k-muted">Groups (one per column):</span>
          {nums.map((c) => (
            <label key={c} className="ks-check">
              <input type="checkbox" checked={cfg.cols.includes(c)} onChange={(e) => set({ cols: e.target.checked ? [...cfg.cols, c].sort((a, b) => a - b) : cfg.cols.filter((v) => v !== c) })} /> {h[c]}
            </label>
          ))}
        </div>
      )}
      <div className="ks-note k-muted">{info.hint}</div>

      {typeof result === 'string' ? (
        <div className="ks-warnline"><AlertTriangle size={13} /> {result}</div>
      ) : (
        <div className="ks-result">
          <div className={`ks-verdict ${result.significant ? 'sig' : 'ns'}`}>
            {result.significant ? <CheckCircle2 size={18} /> : <MinusCircle size={18} />}
            <span>{result.summary}</span>
          </div>
          <div className="ks-metrics">
            <Metric label={result.statistic.label} value={fixed(result.statistic.value, 3)} />
            <Metric label="p-value" value={fmtP(result.p)} />
            <Metric label="level" value={String(result.alpha)} />
          </div>
          <table className="ks-table ks-kv">
            <tbody>{result.rows.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody>
          </table>
          {result.notes.map((n, i) => <div key={i} className="ks-note k-muted">{n}</div>)}
          <div className="ks-note k-muted">A small p-value says the difference is unlikely to be chance alone; it does not say the difference is large or important.</div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------- Correlation

function heat(r: number): string {
  if (!Number.isFinite(r)) return 'transparent'
  const pct = Math.round(Math.min(1, Math.abs(r)) * 75)
  return `color-mix(in srgb, ${r >= 0 ? 'var(--k-accent)' : 'var(--k-danger)'} ${pct}%, transparent)`
}

export function CorrPanel({ matrix, method, setMethod, view, setView, onPick, pal }: {
  matrix: CorrMatrix | null
  method: 'pearson' | 'spearman'
  setMethod(m: 'pearson' | 'spearman'): void
  view: 'table' | 'chart'
  setView(v: 'table' | 'chart'): void
  onPick(i: number, j: number): void
  pal: Palette
}) {
  const figure = useMemo(() => (matrix && view === 'chart' ? heatmapFigure(matrix, pal) : null), [matrix, view, pal])
  if (!matrix || matrix.names.length < 2) return <Empty>The correlation matrix needs at least two columns of numbers that are not ignored.</Empty>
  return (
    <div className="ks-panel">
      <div className="ks-chartbar">
        <Segmented value={method} options={[['pearson', 'Pearson r'], ['spearman', 'Spearman ρ']]} onChange={setMethod} />
        <Segmented value={view} options={[['table', 'Table'], ['chart', 'Heat-map']]} onChange={setView} />
        <span className="k-muted ks-small">uses the rows where both values are numbers · * p &lt; 0.05, ** p &lt; 0.01 · click a cell to fit that pair</span>
      </div>
      {view === 'table' ? (
        <div className="ks-scroll">
          <table className="ks-table ks-heat">
            <thead><tr><th />{matrix.names.map((n) => <th key={n}>{n}</th>)}</tr></thead>
            <tbody>
              {matrix.names.map((a, i) => (
                <tr key={a}>
                  <th>{a}</th>
                  {matrix.names.map((b, j) => {
                    const r = matrix.r[i][j]
                    const p = matrix.p[i][j]
                    return (
                      <td
                        key={b}
                        style={{ background: heat(r) }}
                        className={i !== j ? 'click' : ''}
                        title={i === j ? a : `${a} vs ${b}: r = ${fixed(r, 4)}, p = ${fmtP(p)}, n = ${matrix.n[i][j]}`}
                        onClick={() => i !== j && onPick(j, i)}
                      >
                        {Number.isFinite(r) ? fixed(r, 2) : '–'}{i !== j && p < 0.01 ? '**' : i !== j && p < 0.05 ? '*' : ''}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <PlotlyChart figure={figure} height={Math.max(300, matrix.names.length * 56 + 80)} />
      )}
    </div>
  )
}
