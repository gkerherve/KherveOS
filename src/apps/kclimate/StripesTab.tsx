// Warming stripes, decadal bars, the record years, a comparison of two periods' histograms, and the "how far above
// pre-industrial" gauges.

import { useMemo } from 'react'
import { analyseStripes, isFailure, preindustrialGauges } from './analysis'
import type { Env } from './env'
import { decadalFigure, histogramPairFigure, stripesFigure, type Palette } from './figures'
import Gauge from './Gauge'
import type { StripesView } from './project'
import { Card, ChartFrame, EmptyState, Field, Notice, Segmented, SeriesPicker, Split, BaselineSelect, YearInput, fmt, signed } from './ui'

export default function StripesTab({ env }: { env: Env }) {
  const v = env.project.stripes
  const a = useMemo(() => analyseStripes(env.lib, v), [env.lib, env.version, v])
  const ok = !isFailure(a) ? a : null
  const g = useMemo(() => preindustrialGauges(env.lib), [env.lib, env.version])
  const buildStripes = useMemo(() => (ok ? (pal: Palette) => stripesFigure(ok, pal) : () => null), [ok])
  const buildDec = useMemo(() => (ok ? (pal: Palette) => decadalFigure(ok, pal) : () => null), [ok])
  const la = `${v.periodA[0]}–${v.periodA[1]}`
  const lb = `${v.periodB[0]}–${v.periodB[1]}`
  const buildHist = useMemo(() => (ok ? (pal: Palette) => histogramPairFigure(ok, { a: la, b: lb }, pal) : () => null), [ok, la, lb])

  const controls = (
    <>
      <div className="cl-group">
        <h4>Series</h4>
        <SeriesPicker env={env} label="Series" value={v.series} allowMonth onChange={(ref) => env.update((p) => { p.stripes.series = ref })} />
        <Field label="From year"><YearInput label="From year" value={v.from} onChange={(y) => env.update((p) => { p.stripes.from = y })} /></Field>
        <Field label="To year"><YearInput label="To year" value={v.to} onChange={(y) => env.update((p) => { p.stripes.to = y })} /></Field>
        <Field label="Baseline" hint="The colour scale is symmetric around the baseline mean.">
          <BaselineSelect label="Baseline" native value={v.baseline} onChange={(b) => env.update((p) => { p.stripes.baseline = b })} />
        </Field>
      </div>
      <div className="cl-group">
        <h4>Also show</h4>
        <Segmented<StripesView['kind']> value={v.kind} label="View" options={[['stripes', 'Stripes only'], ['decadal', 'Decades'], ['histogram', 'Histograms'], ['records', 'Records']]} onChange={(k) => env.update((p) => { p.stripes.kind = k })} />
        {v.kind === 'histogram' && (
          <>
            <Field label="Period A">
              <span className="cl-row"><YearInput label="Period A from" value={v.periodA[0]} onChange={(y) => y !== null && env.update((p) => { p.stripes.periodA[0] = y })} /><span className="k-muted">to</span><YearInput label="Period A to" value={v.periodA[1]} onChange={(y) => y !== null && env.update((p) => { p.stripes.periodA[1] = y })} /></span>
            </Field>
            <Field label="Period B">
              <span className="cl-row"><YearInput label="Period B from" value={v.periodB[0]} onChange={(y) => y !== null && env.update((p) => { p.stripes.periodB[0] = y })} /><span className="k-muted">to</span><YearInput label="Period B to" value={v.periodB[1]} onChange={(y) => y !== null && env.update((p) => { p.stripes.periodB[1] = y })} /></span>
            </Field>
          </>
        )}
      </div>
    </>
  )

  return (
    <Split env={env} controls={controls}>
      {isFailure(a) && <EmptyState title="No stripes to draw">{a.error}</EmptyState>}
      {ok && (
        <>
          {ok.notes.map((n) => <Notice key={n} kind="warn">{n}</Notice>)}
          <ChartFrame env={env} primary title={`Warming stripes: ${ok.source.name}`} name="warming-stripes" build={buildStripes} height={190}
            caption={`${ok.annual.t.length} years, one stripe each: blue below the ${v.baseline === 'native' ? 'published' : v.baseline.replace('-', '–')} average, red above it (±${fmt(ok.limit, 2)} ${ok.source.unit} at the darkest).`} />
          {v.kind === 'decadal' && <ChartFrame env={env} title="Average of each decade" name="decadal-means" build={buildDec} height={300} caption="Decades with fewer than 10 years of data say how many years they have." />}
          {v.kind === 'histogram' && (
            <>
              <ChartFrame env={env} title="Distribution of annual values" name="histogram" build={buildHist} height={300} caption={`Warmer years pile up on the right: mean ${fmt(ok.histA.mean, 3)} in ${la} against ${fmt(ok.histB.mean, 3)} in ${lb} (${signed(ok.histB.mean - ok.histA.mean, 3)} ${ok.source.unit}). Standard deviation ${fmt(ok.histA.sd, 3)} and ${fmt(ok.histB.sd, 3)}.`} />
              {ok.histB.values.length === 0 && <Notice kind="warn">Period B has no data for this series.</Notice>}
            </>
          )}
          {v.kind === 'records' && (
            <div className="cl-two">
              <Card title="Warmest years">
                <Records rows={ok.warmest} unit={ok.source.unit} />
              </Card>
              <Card title="Coldest years">
                <Records rows={ok.coldest} unit={ok.source.unit} />
              </Card>
            </div>
          )}
        </>
      )}
      <Card title="Where are we?">
        <div className="cl-gauges">
          {g.warming ? (
            <Gauge
              value={g.warming.value} min={0} max={2.5} label="Warming above pre-industrial" center={`+${g.warming.value.toFixed(2)} °C`}
              caption={`above ${g.warming.baseline} (${g.warming.source}); ${g.warming.pctOf15.toFixed(0)} % of the 1.5 °C level, ${g.warming.pctOf2.toFixed(0)} % of 2 °C. ${g.warming.label}.`}
              zones={[{ from: 0, to: 1, color: '--k-success' }, { from: 1, to: 1.5, color: '--k-warning' }, { from: 1.5, to: 2.5, color: '--k-danger' }]}
              ticks={[{ value: 0, label: '0' }, { value: 1, label: '1' }, { value: 1.5, label: '1.5' }, { value: 2, label: '2' }]}
            />
          ) : <p className="k-muted">The warming gauge needs the HadCRUT5 or GISTEMP dataset. <button type="button" className="k-link-btn" onClick={() => env.toggleDataset('hadcrut5', true)}>Add HadCRUT5</button></p>}
          {g.co2 ? (
            <Gauge
              value={g.co2.value} min={250} max={600} label="CO2 above pre-industrial" center={`${g.co2.value.toFixed(0)} ppm`}
              caption={`${g.co2.pctAbove.toFixed(0)} % above the pre-industrial ${g.co2.preindustrial} ppm (Mauna Loa, ${g.co2.label}). Doubling would be 560.`}
              zones={[{ from: 250, to: 350, color: '--k-success' }, { from: 350, to: 450, color: '--k-warning' }, { from: 450, to: 600, color: '--k-danger' }]}
              ticks={[{ value: 280, label: '280' }, { value: 350, label: '350' }, { value: 420, label: '420' }, { value: 560, label: '560' }]}
            />
          ) : <p className="k-muted">The CO₂ gauge needs the Mauna Loa dataset. <button type="button" className="k-link-btn" onClick={() => env.toggleDataset('co2_mlo', true)}>Add Mauna Loa CO₂</button></p>}
        </div>
        {g.notes.map((n) => <p key={n} className="cl-small k-muted">{n}</p>)}
      </Card>
    </Split>
  )
}

function Records({ rows, unit }: { rows: Array<{ rank: number; year: number; value: number }>; unit: string }) {
  return (
    <div className="cl-tablewrap">
      <table className="cl-table">
        <thead><tr><th>#</th><th>Year</th><th>Value ({unit || 'units'})</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.year}><td>{r.rank}</td><td>{r.year}</td><td>{signed(r.value, 3)}</td></tr>)}</tbody>
      </table>
    </div>
  )
}
