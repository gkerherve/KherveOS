// Trend fitting: linear, quadratic or exponential, the slope per decade with a 95 % interval that allows for AR(1)
// autocorrelation, a breakpoint (two-segment) trend, and a comparison of periods.

import { useMemo } from 'react'
import { Plus, X } from 'lucide-react'
import { analyseTrend, isFailure } from './analysis'
import type { Env } from './env'
import { periodTrendsFigure, trendFigure, type Palette } from './figures'
import { TREND_LABELS, type TrendModel } from './stats'
import { BaselineSelect, Card, ChartFrame, EmptyState, Field, Check, Notice, SeriesPicker, Split, Stat, YearInput, fmt, pText, signed } from './ui'

export default function TrendTab({ env }: { env: Env }) {
  const v = env.project.trend
  const a = useMemo(() => analyseTrend(env.lib, v), [env.lib, env.version, v])
  const ok = !isFailure(a) ? a : null
  const unit = ok?.source.unit ?? ''
  const build = useMemo(() => (ok ? (pal: Palette) => trendFigure(ok, pal) : () => null), [ok])
  const buildPeriods = useMemo(() => (ok ? (pal: Palette) => periodTrendsFigure(ok.periods, unit, pal) : () => null), [ok, unit])
  const t = ok?.trend ?? null

  const controls = (
    <>
      <div className="cl-group">
        <h4>Series</h4>
        <SeriesPicker env={env} label="Series to fit" value={v.series} allowMonth onChange={(ref) => env.update((p) => { p.trend.series = ref })} />
        <Field label="From year"><YearInput label="From year" value={v.from} onChange={(y) => env.update((p) => { p.trend.from = y })} /></Field>
        <Field label="To year"><YearInput label="To year" value={v.to} onChange={(y) => env.update((p) => { p.trend.to = y })} /></Field>
        <Field label="Baseline" hint="Changes the numbers, not the slope.">
          <BaselineSelect label="Baseline" value={v.baseline} onChange={(b) => env.update((p) => { p.trend.baseline = b })} />
        </Field>
      </div>
      <div className="cl-group">
        <h4>Model</h4>
        <Field label="Trend model">
          <select className="k-input" aria-label="Trend model" value={v.model} onChange={(e) => env.update((p) => { p.trend.model = e.target.value as TrendModel })}>
            {(['linear', 'quadratic', 'exponential'] as const).map((m) => <option key={m} value={m}>{TREND_LABELS[m]}</option>)}
          </select>
        </Field>
        <Check checked={v.annual} onChange={(c) => env.update((p) => { p.trend.annual = c })} label="Fit annual means" title="Use one value per year (at least 10 months of data) instead of every month" />
        <Check checked={v.ar1} onChange={(c) => env.update((p) => { p.trend.ar1 = c })} label="Allow for AR(1) autocorrelation" title="Widens the confidence interval when neighbouring values are alike" />
        <Check checked={v.breakpoint} onChange={(c) => env.update((p) => { p.trend.breakpoint = c })} label="Find a breakpoint (two segments)" />
      </div>
      <div className="cl-group">
        <h4>Compare periods</h4>
        {v.periods.map(([a0, b0], i) => (
          <div key={i} className="cl-row">
            <YearInput label={`Period ${i + 1} from`} value={a0} onChange={(y) => y !== null && env.update((p) => { p.trend.periods[i][0] = y })} />
            <span className="k-muted">to</span>
            <YearInput label={`Period ${i + 1} to`} value={b0} onChange={(y) => y !== null && env.update((p) => { p.trend.periods[i][1] = y })} />
            <button type="button" className="k-icon-btn" aria-label={`Remove period ${i + 1}`} onClick={() => env.update((p) => { p.trend.periods.splice(i, 1) })}><X size={14} /></button>
          </div>
        ))}
        <button type="button" className="k-btn small" onClick={() => env.update((p) => { const last = p.trend.periods[p.trend.periods.length - 1]; p.trend.periods.push(last ? [last[1] + 1, last[1] + 20] : [1980, 2000]) })}><Plus size={12} /> Add a period</button>
      </div>
    </>
  )

  return (
    <Split env={env} controls={controls}>
      {isFailure(a) && <EmptyState title="Cannot fit a trend">{a.error}</EmptyState>}
      {ok && t && (
        <>
          {ok.notes.map((n) => <Notice key={n} kind="warn">{n}</Notice>)}
          <div className="cl-stats">
            <Stat label="Trend per decade" value={<>{signed(t.perDecade)} <small>{unit}</small></>} sub={`95 % CI ${signed(t.ciDecade[0])} to ${signed(t.ciDecade[1])}`} tone={t.ciDecade[0] > 0 ? 'bad' : t.ciDecade[1] < 0 ? 'good' : undefined} />
            <Stat label="Significance" value={pText(t.p)} sub={`R² ${fmt(t.r2, 3)}`} />
            <Stat label="Data" value={`${t.n} values`} sub={`effective n ${fmt(t.nEff, 3)}, lag-1 r ${fmt(t.r1, 2)}`} />
            {t.growthPct !== undefined && <Stat label="Growth" value={`${fmt(t.growthPct)} % / yr`} />}
            {t.acceleration !== undefined && <Stat label="Curvature" value={`${signed(t.acceleration)} ${unit}/yr²`} />}
          </div>
          <ChartFrame env={env} primary title={`${ok.source.name}: ${TREND_LABELS[t.model]} trend`} name="trend" build={build} height={380}
            caption={<>{t.equation}. {t.ar1 ? `The interval is corrected for autocorrelation: without it, it would be ${signed(t.ciDecadeNaive[0])} to ${signed(t.ciDecadeNaive[1])} (too narrow when neighbouring values are alike).` : 'No autocorrelation correction: the interval is the textbook one.'}</>} />
          {ok.breakpoint && (
            <Card title="Two-segment trend">
              <p>
                Best break in <strong>{ok.breakpoint.breakYear}</strong>: <strong>{signed(ok.breakpoint.slope1)}</strong> {unit} per decade before (95 % CI {signed(ok.breakpoint.ci1[0])} to {signed(ok.breakpoint.ci1[1])})
                and <strong>{signed(ok.breakpoint.slope2)}</strong> after ({signed(ok.breakpoint.ci2[0])} to {signed(ok.breakpoint.ci2[1])}).
              </p>
              <p className="k-muted cl-small">
                AIC {fmt(ok.breakpoint.aic, 5)} against {fmt(ok.breakpoint.aicLinear, 5)} for one straight line (lower is better). The break time is searched in the data, so the p-value ({pText(ok.breakpoint.p)}) is approximate and flatters the two-segment model.
              </p>
            </Card>
          )}
          <Card title="Trend of different periods">
            <ChartFrame env={env} title="Trend per decade by period" name="trend-periods" build={buildPeriods} height={240} empty="No period has enough values." />
            <div className="cl-tablewrap">
              <table className="cl-table">
                <thead><tr><th>Period</th><th>Per decade ({unit || 'units'})</th><th>95 % CI</th><th>Values</th></tr></thead>
                <tbody>
                  {ok.periods.map((q) => (
                    <tr key={`${q.from}-${q.to}`}><td>{q.from}–{q.to}</td><td>{q.trend ? signed(q.trend.perDecade) : '–'}</td><td>{q.trend ? `${signed(q.trend.ciDecade[0])} to ${signed(q.trend.ciDecade[1])}` : 'too few values'}</td><td>{q.trend?.n ?? 0}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </Split>
  )
}
