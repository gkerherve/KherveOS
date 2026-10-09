// Seasonal-cycle analysis of a monthly series: harmonic regression with a polynomial trend (the Keeling-curve
// decomposition), the mean seasonal cycle and the size of the cycle over time.

import { useMemo } from 'react'
import { analyseSeasonal, isFailure } from './analysis'
import type { Env } from './env'
import { amplitudeFigure, cycleFigure, decompositionFigure, type Palette } from './figures'
import { MONTHS } from './series'
import { Card, ChartFrame, EmptyState, Field, NumInput, Notice, SeriesPicker, Split, Stat, YearInput, fmt, signed } from './ui'

const monthAt = (m: number): string => MONTHS[Math.min(11, Math.max(0, Math.floor(m - 1)))]

export default function SeasonalTab({ env }: { env: Env }) {
  const v = env.project.seasonal
  const a = useMemo(() => analyseSeasonal(env.lib, v), [env.lib, env.version, v])
  const ok = !isFailure(a) ? a : null
  const unit = ok?.source.unit ?? ''
  const buildDec = useMemo(() => (ok ? (pal: Palette) => decompositionFigure(ok, pal) : () => null), [ok])
  const buildCycle = useMemo(() => (ok ? (pal: Palette) => cycleFigure(ok, pal) : () => null), [ok])
  const buildAmp = useMemo(() => (ok ? (pal: Palette) => amplitudeFigure(ok, pal) : () => null), [ok])
  const f = ok?.decomposition.fit
  const at = ok?.amplitude.trend

  const controls = (
    <>
      <div className="cl-group">
        <h4>Series</h4>
        <SeriesPicker env={env} label="Monthly series" value={v.series} monthlyOnly onChange={(ref) => env.update((p) => { p.seasonal.series = ref })} />
        <Field label="From year"><YearInput label="From year" value={v.from} onChange={(y) => env.update((p) => { p.seasonal.from = y })} /></Field>
        <Field label="To year"><YearInput label="To year" value={v.to} onChange={(y) => env.update((p) => { p.seasonal.to = y })} /></Field>
      </div>
      <div className="cl-group">
        <h4>Decomposition</h4>
        <Field label="Harmonics" hint="Sines and cosines of the year: 1 is a plain wave, 4 follows a lopsided cycle.">
          <NumInput label="Harmonics" value={v.harmonics} min={1} max={6} onChange={(n) => env.update((p) => { p.seasonal.harmonics = Math.round(n) })} />
        </Field>
        <Field label="Trend polynomial degree" hint="1 straight line, 2 curving (the Mauna Loa standard).">
          <NumInput label="Polynomial degree" value={v.degree} min={1} max={3} onChange={(n) => env.update((p) => { p.seasonal.degree = Math.round(n) })} />
        </Field>
        <Field label="Amplitude window (years)" hint="The cycle’s size is fitted in a sliding window of this many years.">
          <NumInput label="Window in years" value={v.windowYears} min={3} max={15} onChange={(n) => env.update((p) => { p.seasonal.windowYears = Math.round(n) })} />
        </Field>
      </div>
    </>
  )

  return (
    <Split env={env} controls={controls}>
      {isFailure(a) && <EmptyState title="Cannot analyse the seasonal cycle">{a.error}</EmptyState>}
      {ok && f && (
        <>
          <div className="cl-stats">
            <Stat label="Seasonal cycle size" value={<>{fmt(f.amplitude)} <small>{unit}</small></>} sub="peak to peak" />
            <Stat label="Maximum / minimum" value={`${monthAt(f.peakMonth)} / ${monthAt(f.troughMonth)}`} sub="of the fitted cycle" />
            <Stat label="Growth of the trend now" value={<>{signed(ok.endRate)} <small>{unit}/yr</small></>} sub="at the end of the record" />
            {at && <Stat label="Cycle size trend" value={<>{signed(at.perDecade)} <small>{unit}/decade</small></>} sub={`95 % CI ${signed(at.ciDecade[0])} to ${signed(at.ciDecade[1])}`} tone={at.ciDecade[0] > 0 ? 'warn' : undefined} />}
          </div>
          <ChartFrame env={env} primary title={`${ok.source.name}: trend, seasonal cycle and residual`} name="seasonal-decomposition" build={buildDec} height={460}
            caption={`Polynomial of degree ${f.degree} plus ${f.harmonics} harmonic${f.harmonics > 1 ? 's' : ''}; the residual has a standard deviation of ${fmt(f.rmse)} ${unit} (R² ${fmt(f.r2, 5)}).`} />
          <div className="cl-two">
            <ChartFrame env={env} title="Mean seasonal cycle" name="seasonal-cycle" build={buildCycle} height={280} caption="Average departure of each calendar month from its year’s mean; bars show one standard deviation across years." />
            <ChartFrame env={env} title="Size of the seasonal cycle over time" name="seasonal-amplitude" build={buildAmp} height={280}
              caption={at ? `The cycle is ${at.perDecade >= 0 ? 'growing' : 'shrinking'} by ${fmt(Math.abs(at.perDecade))} ${unit} per decade.` : undefined} />
          </div>
          {ok.amplitude.skipped > 0 && <Notice kind="warn">{ok.amplitude.skipped} years had too few values for the amplitude fit and were left out.</Notice>}
          <Card title="Mean seasonal cycle (table)">
            <div className="cl-tablewrap">
              <table className="cl-table">
                <thead><tr><th>Month</th>{ok.cycle.map((c) => <th key={c.month}>{MONTHS[c.month - 1]}</th>)}</tr></thead>
                <tbody><tr><td>Departure ({unit})</td>{ok.cycle.map((c) => <td key={c.month}>{signed(c.mean, 3)}</td>)}</tr></tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </Split>
  )
}
