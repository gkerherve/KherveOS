// Relationships between series: correlation, lagged correlation (ENSO against temperature) and multiple regression on
// explanatory variables (CO2, ENSO, volcanic aerosol) with the residual.

import { useMemo } from 'react'
import { Plus, X } from 'lucide-react'
import { analyseRelate, isFailure } from './analysis'
import type { Env } from './env'
import { contributionsFigure, lagFigure, regressionFigure, scatterFigure, type Palette } from './figures'
import type { RelateView } from './project'
import { Card, Check, ChartFrame, EmptyState, Field, NumInput, Notice, Segmented, SeriesPicker, Split, Stat, YearInput, fmt, pText, signed } from './ui'

export default function RelateTab({ env }: { env: Env }) {
  const v = env.project.relate
  const a = useMemo(() => analyseRelate(env.lib, v), [env.lib, env.version, v])
  const ok = !isFailure(a) ? a : null
  const buildLag = useMemo(() => (ok?.mode === 'lag' ? (pal: Palette) => lagFigure(ok, pal) : () => null), [ok])
  const buildScatter = useMemo(() => (ok?.mode === 'correlation' ? (pal: Palette) => scatterFigure(ok, pal) : () => null), [ok])
  const buildReg = useMemo(() => (ok?.mode === 'regression' ? (pal: Palette) => regressionFigure(ok, pal) : () => null), [ok])
  const buildContrib = useMemo(() => (ok?.mode === 'regression' ? (pal: Palette) => contributionsFigure(ok, pal) : () => null), [ok])
  const stepWord = v.step === 'monthly' ? 'months' : 'years'

  const controls = (
    <>
      <div className="cl-group">
        <h4>Analysis</h4>
        <Segmented<RelateView['mode']> value={v.mode} label="Analysis" options={[['lag', 'Lagged'], ['correlation', 'Correlation'], ['regression', 'Regression']]} onChange={(m) => env.update((p) => { p.relate.mode = m })} />
        <Field label="Compare values">
          <Segmented value={v.step} label="Time step" options={[['monthly', 'Month by month'], ['annual', 'Annual means']]} onChange={(s) => env.update((p) => { p.relate.step = s })} />
        </Field>
        <Field label="From year"><YearInput label="From year" value={v.from} onChange={(y) => env.update((p) => { p.relate.from = y })} /></Field>
        <Field label="To year"><YearInput label="To year" value={v.to} onChange={(y) => env.update((p) => { p.relate.to = y })} /></Field>
      </div>
      {v.mode !== 'regression' ? (
        <div className="cl-group">
          <h4>Series</h4>
          <Field label={v.mode === 'lag' ? 'Leading series (x)' : 'Series x'}>
            <SeriesPicker env={env} label="Series x" value={v.x} onChange={(ref) => env.update((p) => { p.relate.x = ref })} />
          </Field>
          <Field label={v.mode === 'lag' ? 'Following series (y)' : 'Series y'}>
            <SeriesPicker env={env} label="Series y" value={v.y} onChange={(ref) => env.update((p) => { p.relate.y = ref })} />
          </Field>
          <Check checked={v.detrend} onChange={(c) => env.update((p) => { p.relate.detrend = c })} label="Remove each series’ linear trend first" title="A shared trend makes unrelated series look correlated" />
          {v.mode === 'lag' && <Field label={`Largest lag (${stepWord})`}><NumInput label="Largest lag" value={v.maxLag} min={1} max={60} onChange={(n) => env.update((p) => { p.relate.maxLag = Math.round(n) })} /></Field>}
        </div>
      ) : (
        <div className="cl-group">
          <h4>Regression</h4>
          <Field label="Series to explain">
            <SeriesPicker env={env} label="Series to explain" value={v.target} onChange={(ref) => env.update((p) => { p.relate.target = ref })} />
          </Field>
          <h5>Explanatory variables</h5>
          {v.predictors.map((q, i) => (
            <div key={i} className="cl-line">
              <SeriesPicker env={env} label={`Variable ${i + 1}`} value={q.ref} onChange={(ref) => env.update((p) => { p.relate.predictors[i].ref = ref })} />
              <div className="cl-row">
                <select className="k-input" aria-label={`Transformation of variable ${i + 1}`} value={q.transform} onChange={(e) => env.update((p) => { p.relate.predictors[i].transform = e.target.value as typeof q.transform })}>
                  <option value="none">as is</option>
                  <option value="log2">log₂ (per doubling)</option>
                  <option value="ln">ln</option>
                </select>
                <NumInput label={`Lag of variable ${i + 1} in ${stepWord}`} value={q.lag} min={0} max={60} width={52} onChange={(n) => env.update((p) => { p.relate.predictors[i].lag = Math.round(n) })} />
                <span className="k-muted">{stepWord} earlier</span>
                <button type="button" className="k-icon-btn" aria-label={`Remove variable ${i + 1}`} onClick={() => env.update((p) => { p.relate.predictors.splice(i, 1) })}><X size={14} /></button>
              </div>
            </div>
          ))}
          <button type="button" className="k-btn small" onClick={() => env.update((p) => { p.relate.predictors.push({ ref: env.refs.find((r) => r.step === 'monthly' && !p.relate.predictors.some((q) => q.ref === r.ref))?.ref ?? 'oni.oni', transform: 'none', lag: 0 }) })}><Plus size={12} /> Add a variable</button>
          <Check checked={v.trend} onChange={(c) => env.update((p) => { p.relate.trend = c })} label="Add a linear trend in time" />
        </div>
      )}
    </>
  )

  return (
    <Split env={env} controls={controls}>
      {isFailure(a) && <EmptyState title="Cannot compare these series">{a.error}</EmptyState>}
      {ok?.mode === 'lag' && (
        <>
          <div className="cl-stats">
            <Stat label="Best lag" value={`${ok.result.best.lag} ${stepWord}`} sub={ok.result.best.lag > 0 ? `${ok.y.name} follows ${ok.x.name}` : ok.result.best.lag < 0 ? `${ok.x.name} follows ${ok.y.name}` : 'no delay'} />
            <Stat label="Correlation at that lag" value={signed(ok.result.best.r, 3)} sub={`${pText(ok.result.best.p)}; ${ok.result.best.r ** 2 > 0 ? `explains ${fmt(ok.result.best.r ** 2 * 100, 2)} % of the variance` : ''}`} tone={Math.abs(ok.result.best.r) > ok.result.rCrit ? 'good' : 'warn'} />
            <Stat label="Significance threshold" value={`|r| > ${fmt(ok.result.rCrit, 2)}`} sub={`${fmt(ok.result.best.nEff, 3)} independent values`} />
          </div>
          <ChartFrame env={env} primary title={`Correlation of ${ok.x.name} with ${ok.y.name} at each lag`} name="lagged-correlation" build={buildLag} height={380}
            caption={`Dotted lines: the 95 % significance level, which allows for the autocorrelation of both series. ${ok.result.detrended ? 'Both series were detrended first.' : 'The series were not detrended, so a shared trend adds to every lag.'}`} />
        </>
      )}
      {ok?.mode === 'correlation' && (
        <>
          <div className="cl-stats">
            <Stat label="Pearson r" value={signed(ok.result.r, 3)} sub={pText(ok.result.p)} tone={ok.result.p < 0.05 ? 'good' : 'warn'} />
            <Stat label="Spearman ρ" value={signed(ok.result.rho, 3)} sub="rank correlation" />
            <Stat label="Pairs" value={String(ok.result.n)} sub={`${fmt(ok.result.nEff, 3)} independent`} />
          </div>
          <ChartFrame env={env} primary title={`${ok.y.name} against ${ok.x.name}`} name="correlation" build={buildScatter} height={380} />
        </>
      )}
      {ok?.mode === 'regression' && (
        <>
          <div className="cl-stats">
            <Stat label="R²" value={fmt(ok.result.r2, 3)} sub={`adjusted ${fmt(ok.result.adjR2, 3)}; ${ok.result.n} ${stepWord}`} />
            <Stat label="Residual" value={<>{fmt(ok.result.rmse)} <small>{ok.target.unit}</small></>} sub={`lag-1 r ${fmt(ok.result.r1, 2)}`} />
            <Stat label="Independent values" value={fmt(ok.result.nEff, 3)} sub="used for the errors" />
          </div>
          <Card title="Coefficients">
            <div className="cl-tablewrap">
              <table className="cl-table">
                <thead><tr><th>Term</th><th>Coefficient</th><th>Unit</th><th>± 95 %</th><th>p</th><th>Lag</th></tr></thead>
                <tbody>
                  {[ok.result.intercept, ...(ok.result.trend ? [ok.result.trend] : []), ...ok.result.terms].map((t) => (
                    <tr key={t.name}><td>{t.name}</td><td>{signed(t.coef)}</td><td>{t.unit}</td><td>{fmt((t.ci[1] - t.ci[0]) / 2)}</td><td>{pText(t.p).replace('p ', '')}</td><td>{t.lag}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="cl-small k-muted">Errors allow for AR(1) residuals (Foster and Rahmstorf 2011). This is a statistical fit: it shows what moves together, not why.</p>
          </Card>
          <ChartFrame env={env} primary title="Observed, fitted and adjusted" name="regression" build={buildReg} height={340} caption="Green: the data with the contributions of the variables that are not CO₂ taken out." />
          <ChartFrame env={env} title="What each variable contributes" name="regression-contributions" build={buildContrib} height={280} />
        </>
      )}
      {ok?.mode === 'regression' && ok.predictors.some((p) => /aerosol/i.test(p.series.name)) && ok.result.t.length > 0 && Math.max(...ok.result.t) < 2013 && (
        <Notice>The volcanic aerosol record ends in 2012, which ends the period.</Notice>
      )}
    </Split>
  )
}
