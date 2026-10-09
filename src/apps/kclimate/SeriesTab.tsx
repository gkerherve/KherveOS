// Time-series plot: several series, two axes, anomalies against a chosen baseline, smoothing and a trend overlay.

import { useMemo } from 'react'
import { Plus, X } from 'lucide-react'
import { prepareLines } from './analysis'
import type { Env } from './env'
import { seriesFigure } from './figures'
import { baselineText } from './analysis'
import { describe } from './series'
import { TREND_LABELS } from './stats'
import { BaselineSelect, Card, ChartFrame, EmptyState, Field, Notice, Segmented, SeriesPicker, SmoothSelect, Split, YearInput, fmt, signed } from './ui'

export default function SeriesTab({ env }: { env: Env }) {
  const v = env.project.series
  const data = useMemo(() => prepareLines(env.lib, v), [env.lib, env.version, v])
  const build = useMemo(() => (data.lines.length ? (pal: Parameters<typeof seriesFigure>[1]) => seriesFigure(data, pal) : () => null), [data])
  const units = new Set(data.lines.filter((l) => l.axis === 'left').map((l) => l.series.unit))
  const mixedLeft = units.size > 1
  const add = () => env.update((p) => { p.series.lines.push({ ref: env.refs.find((r) => !p.series.lines.some((l) => l.ref === r.ref))?.ref ?? 'hadcrut5.anomaly', axis: p.series.lines.length ? 'right' : 'left' }) })

  const controls = (
    <>
      <div className="cl-group">
        <h4>Series</h4>
        {v.lines.map((l, i) => (
          <div key={i} className="cl-line">
            <SeriesPicker env={env} label={`Series ${i + 1}`} value={l.ref} allowMonth onChange={(ref) => env.update((p) => { p.series.lines[i].ref = ref })} />
            <div className="cl-row">
              <Segmented value={l.axis} label="Axis" options={[['left', 'Left axis'], ['right', 'Right axis']]} onChange={(a) => env.update((p) => { p.series.lines[i].axis = a })} />
              <button type="button" className="k-icon-btn" title="Remove this series" aria-label={`Remove series ${i + 1}`} onClick={() => env.update((p) => { p.series.lines.splice(i, 1) })}><X size={14} /></button>
            </div>
            <BaselineSelect label={`Baseline of series ${i + 1}`} value={l.baseline ?? ''} inherit={baselineText(v.baseline)} onChange={(b) => env.update((p) => { if (b) p.series.lines[i].baseline = b; else delete p.series.lines[i].baseline })} />
          </div>
        ))}
        <button type="button" className="k-btn small" onClick={add}><Plus size={12} /> Add a series</button>
      </div>
      <div className="cl-group">
        <h4>Period and baseline</h4>
        <Field label="From year"><YearInput label="From year" value={v.from} onChange={(y) => env.update((p) => { p.series.from = y })} /></Field>
        <Field label="To year"><YearInput label="To year" value={v.to} onChange={(y) => env.update((p) => { p.series.to = y })} /></Field>
        <Field label="Baseline" hint="Anomalies are recomputed against the mean of this period. A series without data there cannot use it.">
          <BaselineSelect label="Baseline" value={v.baseline} onChange={(b) => env.update((p) => { p.series.baseline = b })} />
        </Field>
      </div>
      <div className="cl-group">
        <h4>Smoothing and trend</h4>
        <Field label="Smoothing"><SmoothSelect value={v.smooth} onChange={(s) => env.update((p) => { p.series.smooth = s })} /></Field>
        <Field label="Trend line on the first series">
          <select className="k-input" aria-label="Trend line" value={v.trendLine} onChange={(e) => env.update((p) => { p.series.trendLine = e.target.value as typeof v.trendLine })}>
            <option value="none">None</option>
            {(['linear', 'quadratic', 'exponential'] as const).map((m) => <option key={m} value={m}>{TREND_LABELS[m]}</option>)}
          </select>
        </Field>
      </div>
    </>
  )

  return (
    <Split env={env} controls={controls}>
      {data.errors.map((e) => <Notice key={e} kind="error">{e}</Notice>)}
      {data.lines.flatMap((l) => l.notes).map((n) => <Notice key={n} kind="warn">{n}</Notice>)}
      {mixedLeft && <Notice kind="warn">The left axis mixes different units ({[...units].join(', ')}). Put one of the series on the right axis.</Notice>}
      {v.lines.length === 0 ? (
        <EmptyState title="Nothing to plot" action={<button type="button" className="k-btn primary" onClick={add}><Plus size={14} /> Add a series</button>}>Add a series from a dataset to see it here.</EmptyState>
      ) : (
        <ChartFrame env={env} primary title="Time series" name="time-series" build={build} height={400} empty="None of the chosen series is loaded yet." caption={data.trend ? `Dashed: ${TREND_LABELS[data.trend.model].toLowerCase()} trend of the first series, ${signed(data.trend.perDecade)} ${data.lines[0].series.unit} per decade, with its 95 % band.` : undefined} />
      )}
      {data.lines.length > 0 && (
        <Card title="Summary of the plotted values">
          <div className="cl-tablewrap">
            <table className="cl-table">
              <thead><tr><th>Series</th><th>Unit</th><th>Mean</th><th>Min</th><th>Max</th><th>Last value</th></tr></thead>
              <tbody>
                {data.lines.map((l) => {
                  const s = describe(l.series)
                  const last = l.series.y.filter(Number.isFinite).pop()
                  return <tr key={l.ref + l.series.name}><td>{l.series.name}</td><td>{l.series.unit || '–'}</td><td>{fmt(s?.mean)}</td><td>{fmt(s?.min)}</td><td>{fmt(s?.max)}</td><td>{fmt(last)}</td></tr>
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </Split>
  )
}
