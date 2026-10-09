// The Analyse tab: paste or import measured V/pH data, find the equivalence points with the smoothed
// derivatives, draw Gran plots, and fit the full titration model (Levenberg–Marquardt) for the analyte
// concentration and the pKa values with standard errors, residuals and a report.

import { useEffect, useMemo, useState, type MutableRefObject } from 'react'
import { ClipboardPaste, Download, FileText, FolderOpen, Trash2, Wand2 } from 'lucide-react'
import { curve } from './acidbase'
import { analysisReport, dataCsv } from './report'
import { detectEquivalence, granAnalysis, parseData, smoothDerivatives } from './analyse'
import { Chart, usePalette } from './Chart'
import { dataFigure, granFigure, residualFigure, smoothedFigure, type Figure, type Palette } from './figures'
import { ANALYTE_KINDS, effectiveSetup, modelSpec, setupForKind, type FitResult, type FitSetup } from './fit'
import { fixed, sig } from './format'
import type { Project } from './project'
import { Check, Empty, Notice, NumField, Row, Sel, Seg, Section } from './ui'

type View = Project['analyse']['view']

/** Which analyte kind (if any) matches a setup. */
function kindOf(s: FitSetup): string {
  const k = ANALYTE_KINDS.find((x) => x.z0(s.npk) === s.z0 && x.form(s.npk) === s.form && x.titrant === s.titrant)
  return k?.id ?? 'custom'
}

export function AnalyseTab({
  project, update, fit, fitStale, onFit, exportRef, compact, onImport, onPaste, onSaveText, onCopy, onKplot, fitting,
}: {
  project: Project
  update: (fn: (p: Project) => Project, key?: string) => void
  fit: FitResult | null
  fitStale: boolean
  onFit: () => void
  exportRef: MutableRefObject<null | ((pal: Palette) => Figure | null)>
  compact: boolean
  onImport: () => void
  onPaste: () => void
  onSaveText: (defaultName: string, ext: string, text: string) => void
  onCopy: (text: string, what: string) => void
  onKplot: (text: string, name: string) => void
  fitting: boolean
}) {
  const pal = usePalette()
  const a = project.analyse
  const s = a.setup
  const [view, setViewState] = useState<'setup' | 'chart'>('chart')
  const [before, setBefore] = useState<[number, number]>([0.3, 0.9])
  const [after, setAfter] = useState<[number, number]>([1.1, 1.6])
  const [smoothing, setSmoothing] = useState(2)
  const setA = (patch: Partial<Project['analyse']>) => update((p) => ({ ...p, analyse: { ...p.analyse, ...patch } }), 'an')
  const setS = (patch: Partial<FitSetup>) => setA({ setup: { ...s, ...patch } })

  const parsed = useMemo(() => parseData(a.text), [a.text])
  const d = parsed.data
  const hasData = d.V.length >= 3
  const eq = useMemo(() => (hasData ? detectEquivalence(d) : []), [hasData, d])
  const smooth = useMemo(() => (hasData ? smoothDerivatives(d.V, d.pH, smoothing) : null), [hasData, d, smoothing])
  const temperature = effectiveSetup(d, s).temperature
  const gran = useMemo(
    () => (hasData && eq.length ? granAnalysis(d, { V0: s.V0, Ct: s.Ct, aliquot: s.aliquot, titrant: s.titrant, kind: a.gran, Veq: eq[0].V, before, after, temperature }) : null),
    [hasData, eq, d, s.V0, s.Ct, s.aliquot, s.titrant, temperature, a.gran, before, after],
  )
  const fitCurve = useMemo(() => {
    if (!fit?.ok || !hasData) return null
    try {
      const spec = modelSpec(effectiveSetup(d, s), fit.Ca, fit.pKa, fit.Ct)
      const vmax = Math.max(...d.V) - fit.dV
      const c = curve(spec, { vmax: Math.max(vmax, 1), n: 240 })
      return { V: c.V.map((v) => v + fit.dV), y: c.pH }
    } catch {
      return null
    }
  }, [fit, hasData, s, d])

  const figures = useMemo(() => {
    if (!hasData) return { main: null as Figure | null, sub: null as Figure | null }
    const eqPts = eq.map((e) => ({ V: e.V, pH: e.pH }))
    switch (a.view) {
      case 'curve': return { main: dataFigure(d.V, d.pH, pal, { eq: eqPts }), sub: null }
      case 'derivative': return { main: smoothed(smooth, eq, pal), sub: null }
      case 'gran': return { main: gran ? granFigure(gran, pal) : null, sub: null }
      case 'fit': return { main: dataFigure(d.V, d.pH, pal, { fit: fitCurve }), sub: fit?.ok ? residualFigure(d.V, fit.residuals, pal) : null }
    }
  }, [hasData, a.view, d, eq, pal, smooth, gran, fitCurve, fit])

  useEffect(() => {
    exportRef.current = (p) => {
      if (!hasData) return null
      switch (a.view) {
        case 'curve': return dataFigure(d.V, d.pH, p, { eq: eq.map((e) => ({ V: e.V, pH: e.pH })) })
        case 'derivative': return smoothed(smooth, eq, p)
        case 'gran': return gran ? granFigure(gran, p) : null
        case 'fit': return dataFigure(d.V, d.pH, p, { fit: fitCurve })
      }
    }
    return () => { exportRef.current = null }
  }, [exportRef, hasData, a.view, d, eq, smooth, gran, fitCurve])

  const kind = kindOf(s)
  const report = () => analysisReport(project.name, d, eq, s, gran, fit?.ok ? fit : null, a.source)
  const kplotText = () => `V (mL)\tpH${fit?.ok ? '\tpH fitted' : ''}\n` + d.V.map((v, i) => `${v}\t${d.pH[i]}${fit?.ok ? `\t${fit.fitted[i].toFixed(4)}` : ''}`).join('\n')

  const setView = (v: View) => setA({ view: v })

  return (
    <div className="ti-split" data-compact={compact || undefined}>
      {compact && <div className="ti-viewbar"><Seg label="Panel" value={view} options={[{ id: 'setup', label: 'Data and model' }, { id: 'chart', label: 'Results' }]} onChange={setViewState} /></div>}
      <div className="ti-split-body">
        {(!compact || view === 'setup') && (
          <aside className="ti-setup" aria-label="Data and model">
            <Section title="Measured data" id="an-data" actions={
              <>
                <button type="button" className="k-btn small" onClick={onPaste} title="Paste two or three columns from the clipboard"><ClipboardPaste size={12} /> Paste</button>
                <button type="button" className="k-btn small" onClick={onImport} title="Open a text or CSV file"><FolderOpen size={12} /> Import</button>
                <button type="button" className="k-icon-btn" aria-label="Clear the data" title="Clear" onClick={() => setA({ text: '' })} disabled={!a.text}><Trash2 size={14} /></button>
              </>
            }>
              <textarea
                className="k-input ti-textarea" spellCheck={false} rows={9} value={a.text} aria-label="Titration data: volume in mL, pH, and optionally temperature"
                placeholder={'Volume (mL)  pH   [temperature]\n0.00   2.88\n5.00   4.20\n10.00  4.76\n…'}
                onChange={(e) => setA({ text: e.target.value })}
              />
              <div className="ti-hint">
                {hasData ? `${d.V.length} points, ${fixed(d.V[0], 2)}–${fixed(d.V[d.V.length - 1], 2)} mL, pH ${fixed(Math.min(...d.pH), 2)}–${fixed(Math.max(...d.pH), 2)}${d.T ? ', with temperature' : ''}.` : 'Paste volumes (mL) and pH values, one pair per line; tabs, spaces, commas or semicolons separate them.'}
                {parsed.skipped > 0 && ` ${parsed.skipped} line${parsed.skipped === 1 ? '' : 's'} skipped (headers or text).`}
                {d.T && ` Temperature column found: its mean, ${fixed(temperature, 1)} °C, is used for Kw and the pKa values.`}
              </div>
              {parsed.warnings.slice(0, 3).map((w, i) => <Notice key={i} kind="warn">{w}</Notice>)}
              <Row label="Source" wide><input className="k-input ti-input" value={a.source} aria-label="Where the data came from" placeholder="e.g. lab 3, 12 March, electrode calibrated" onChange={(e) => setA({ source: e.target.value })} /></Row>
            </Section>
            <Section title="The titration" id="an-titration">
              <Row label="Analyte"><Sel label="Kind of analyte" value={kind} width={210} options={[...ANALYTE_KINDS.map((k) => ({ id: k.id, label: k.label })), ...(kind === 'custom' ? [{ id: 'custom', label: 'Custom charges' }] : [])]} onChange={(k) => k !== 'custom' && setA({ setup: setupForKind(k, s.npk, s) })} /></Row>
              <Row label="pKa steps"><Seg label="Number of pKa steps" value={String(s.npk)} options={[1, 2, 3, 4].map((v) => ({ id: String(v), label: String(v) }))} onChange={(v) => setA({ setup: setupForKind(kind === 'custom' ? 'acid' : kind, Number(v), s) })} /></Row>
              <Row label="Sample volume"><NumField label="Sample volume" value={s.aliquot} min={0} onChange={(v) => setS({ aliquot: v, V0: Math.max(s.V0, v) })} unit="mL" /></Row>
              <Row label="Flask volume" hint="Sample plus the water added before titrating."><NumField label="Total volume in the flask before titrating" value={s.V0} min={0} onChange={(v) => setS({ V0: v })} unit="mL" /></Row>
              <Row label="Titrant"><NumField label="Titrant concentration" value={s.Ct} min={0} onChange={(v) => setS({ Ct: v })} unit="M" /></Row>
              <Row label="Temperature"><NumField label="Temperature" value={s.temperature} min={0} max={100} onChange={(v) => setS({ temperature: v })} unit="°C" /></Row>
              <Row label="Activities"><Sel label="Activity model" value={s.activity} width={190} options={[{ id: 'none', label: 'Ideal' }, { id: 'davies', label: 'Davies equation' }, { id: 'edh', label: 'Extended Debye–Hückel' }]} onChange={(v) => setS({ activity: v })} /></Row>
              {s.activity !== 'none' && <Row label="Background salt"><NumField label="Background electrolyte" value={s.background} min={0} onChange={(v) => setS({ background: v })} unit="M" /></Row>}
            </Section>
            <Section title="Model fit" id="an-fit">
              {s.pKa.map((p, i) => (
                <Row key={i} label={`pKa${s.npk > 1 ? i + 1 : ''}`}>
                  <NumField label={`pKa ${i + 1} starting value`} value={p.value} digits={4} onChange={(v) => setS({ pKa: s.pKa.map((x, k) => (k === i ? { ...x, value: v } : x)) })} />
                  <Check checked={p.fit} onChange={(f) => setS({ pKa: s.pKa.map((x, k) => (k === i ? { ...x, fit: f } : x)) })} title="Unticked: this value is kept fixed">fit</Check>
                </Row>
              ))}
              <Row label="Concentration" hint="Starting value; empty = from the equivalence volume."><NumField label="Starting concentration of the analyte" value={s.guessC} placeholder="auto" allowEmpty={{ onEmpty: () => setS({ guessC: null }) }} onChange={(v) => setS({ guessC: v > 0 ? v : null })} unit="M" /></Row>
              <div className="ti-checks">
                <Check checked={s.fitCt} onChange={(v) => setS({ fitCt: v })} title="Also fit the concentration of the titrant">Fit the titrant concentration</Check>
                <Check checked={s.fitDV} onChange={(v) => setS({ fitDV: v })} title="A volume offset (burette zero error)">Fit a volume offset</Check>
                <Check checked={s.sigmaV > 0} onChange={(v) => setS({ sigmaV: v ? 0.02 : 0 })} title="Weights points by the slope: the steep part is less certain in pH">Weight by the volume uncertainty</Check>
              </div>
              {s.sigmaV > 0 && <Row label="Volume uncertainty"><NumField label="Volume uncertainty" value={s.sigmaV} min={0} onChange={(v) => setS({ sigmaV: v })} unit="mL" /></Row>}
              <button type="button" className="k-btn primary" onClick={onFit} disabled={!hasData || fitting}><Wand2 size={13} /> {fitting ? 'Fitting…' : 'Fit the model'}</button>
              <div className="ti-hint">Levenberg–Marquardt on the exact charge-balance model with dilution; the standard errors come from the covariance matrix.</div>
            </Section>
            <Section title="Gran plot" id="an-gran" defaultOpen={false}>
              <Row label="Analyte"><Seg label="Strong or weak analyte" value={a.gran} options={[{ id: 'strong', label: 'Strong' }, { id: 'weak', label: 'Weak' }]} onChange={(v) => setA({ gran: v })} /></Row>
              <Row label="Before the end">
                <NumField label="Start of the region before equivalence, fraction of V" value={before[0]} digits={3} min={0} max={1} width={60} onChange={(v) => setBefore([v, before[1]])} />
                <NumField label="End of the region before equivalence, fraction of V" value={before[1]} digits={3} min={0} max={1} width={60} onChange={(v) => setBefore([before[0], v])} />
              </Row>
              <Row label="After the end">
                <NumField label="Start of the region after equivalence, fraction of V" value={after[0]} digits={3} min={1} width={60} onChange={(v) => setAfter([v, after[1]])} />
                <NumField label="End of the region after equivalence, fraction of V" value={after[1]} digits={3} min={1} width={60} onChange={(v) => setAfter([after[0], v])} />
              </Row>
              <Row label="Smoothing"><Seg label="Derivative smoothing window" value={String(smoothing)} options={[1, 2, 3, 4].map((v) => ({ id: String(v), label: `±${v}` }))} onChange={(v) => setSmoothing(Number(v))} /></Row>
            </Section>
          </aside>
        )}
        {(!compact || view === 'chart') && (
          <main className="ti-main">
            {!hasData ? (
              <Empty icon={<FileText size={28} />}>
                <p>Paste or import your titration data (volume in mL and pH) to find the equivalence points, make a Gran plot and fit the model.</p>
                <p className="ti-hint">File › Open Example has two synthetic data sets to try, labelled as such.</p>
              </Empty>
            ) : (
              <>
                <div className="ti-chartbar">
                  <Seg label="View" value={a.view} options={[{ id: 'curve', label: 'Curve' }, { id: 'derivative', label: 'Derivatives' }, { id: 'gran', label: 'Gran' }, { id: 'fit', label: 'Model fit' }]} onChange={setView} />
                  <span className="ti-spacer" />
                  <button type="button" className="k-btn small" onClick={() => onCopy(report(), 'Report')}>Copy report</button>
                  <button type="button" className="k-btn small" onClick={() => onSaveText(`${project.name || 'titration'} analysis`, '.md', report())}><Download size={12} /> Report…</button>
                  <button type="button" className="k-btn small" onClick={() => onSaveText(`${project.name || 'titration'} data`, '.csv', dataCsv(d, fit?.ok ? fit : null))}><Download size={12} /> CSV…</button>
                  <button type="button" className="k-btn small" onClick={() => onKplot(kplotText(), project.name || 'Titration data')}>Open in kPlot</button>
                </div>
                <div className={`ti-plot${figures.sub ? ' split' : ''}`}>{figures.main ? <Chart figure={figures.main} label="Titration data" /> : <Empty>{a.view === 'gran' ? 'No equivalence point found to centre the Gran plot on.' : 'Nothing to draw.'}</Empty>}</div>
                {figures.sub && <div className="ti-plot deriv"><Chart figure={figures.sub} label="Residuals of the fit" /></div>}
                <div className="ti-results">
                  {a.view === 'curve' || a.view === 'derivative' ? <EqTable eq={eq} s={s} /> : null}
                  {a.view === 'gran' && (gran ? <GranTable g={gran} kind={a.gran} /> : <Notice kind="warn">No equivalence point was found in the data, so the Gran regions cannot be placed.</Notice>)}
                  {a.view === 'fit' && <FitTable fit={fit} stale={fitStale} s={s} />}
                </div>
              </>
            )}
          </main>
        )}
      </div>
    </div>
  )
}

function smoothed(s: ReturnType<typeof smoothDerivatives> | null, eq: Array<{ V: number }>, pal: Palette): Figure | null {
  return s ? smoothedFigure(s, pal, eq) : null
}

function EqTable({ eq, s }: { eq: ReturnType<typeof detectEquivalence>; s: FitSetup }) {
  if (!eq.length) return <Notice kind="warn">No clear equivalence point: the curve has no steep region. Check that the columns are volume then pH, and that the titration passes the end point.</Notice>
  return (
    <>
      <table className="ti-table">
        <caption>Equivalence points from the derivatives</caption>
        <thead><tr><th>#</th><th>V, 1st derivative max</th><th>V, 2nd derivative zero</th><th>pH there</th><th>max |ΔpH/ΔV|</th><th>Concentration if the step takes k protons per molecule</th></tr></thead>
        <tbody>
          {eq.map((e, i) => <tr key={i}><td>{i + 1}</td><td>{fixed(e.V1, 3)} mL</td><td>{e.V2 === null ? '–' : `${fixed(e.V2, 3)} mL`}</td><td>{fixed(e.pH, 2)}</td><td>{fixed(e.slope, 2)} /mL</td><td>{sig((s.Ct * e.V) / (s.aliquot * (i + 1)), 4)} M (k = {i + 1})</td></tr>)}
        </tbody>
      </table>
      <div className="ti-hint">Both estimates use the divided differences of your points; they are exact to about half the spacing of the readings around the jump, so add points near the end point for more precision.</div>
    </>
  )
}

function GranTable({ g, kind }: { g: ReturnType<typeof granAnalysis>; kind: 'strong' | 'weak' }) {
  const row = (name: string, b: typeof g.before) => (
    <tr><th scope="row">{name}</th><td>{b.used.length}</td><td>{b.fit ? sig(b.fit.slope, 4) : '–'}</td><td>{b.fit ? fixed(b.fit.r2, 5) : '–'}</td><td>{b.Ve !== null && b.fit ? `${fixed(b.Ve, 3)} ± ${fixed(b.fit.seXIntercept, 3)} mL` : '–'}</td></tr>
  )
  return (
    <>
      <table className="ti-table">
        <caption>Gran plot ({kind === 'weak' ? 'weak analyte: V·[H⁺] against V' : 'strong analyte: (V₀ + V)·[H⁺] against V'})</caption>
        <thead><tr><th /><th>points</th><th>slope</th><th>R²</th><th>equivalence volume (x-intercept ± s.e.)</th></tr></thead>
        <tbody>{row('Before', g.before)}{row('After', g.after)}</tbody>
      </table>
      <div className="ti-resline">
        {g.Ve !== null && <span>Mean equivalence volume <b>{fixed(g.Ve, 3)} mL</b></span>}
        {g.conc !== null && <span>Analyte concentration <b>{sig(g.conc, 4)} M</b></span>}
        {g.pKa !== null && <span>pKa from the slope <b>{fixed(g.pKa, 2)}</b></span>}
      </div>
      <div className="ti-hint">The two lines should meet the axis at the same volume. Points near the jump are left out because the pH there is least reliable; the Gran functions use [H⁺] directly, ignoring activity coefficients.</div>
    </>
  )
}

function FitTable({ fit, stale, s }: { fit: FitResult | null; stale: boolean; s: FitSetup }) {
  if (!fit) return <Notice>Press “Fit the model” to fit the full titration curve to the data.</Notice>
  if (!fit.ok) return <Notice kind="error">{fit.message}</Notice>
  return (
    <>
      {stale && <Notice kind="warn">The data or the model changed since this fit. Press “Fit the model” again.</Notice>}
      <table className="ti-table">
        <caption>Fitted parameters</caption>
        <thead><tr><th>Parameter</th><th>Value</th><th>Standard error</th><th>95 % interval</th></tr></thead>
        <tbody>
          {fit.params.map((p) => (
            <tr key={p.name}><th scope="row">{p.name === 'Ca' ? 'Concentration of the analyte (M)' : p.name === 'Ct' ? 'Titrant concentration (M)' : p.name === 'ΔV' ? 'Volume offset (mL)' : p.name}{p.fixed ? ' (fixed)' : ''}</th><td>{sig(p.value, 5)}</td><td>{p.fixed ? '–' : sig(p.se, 2)}</td><td>{p.fixed ? '–' : `± ${sig(p.ci95, 2)}`}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="ti-resline">
        <span>RMSE <b>{sig(fit.rmse, 3)}</b> pH units</span>
        <span>R² <b>{fit.r2.toFixed(5)}</b></span>
        <span>{fit.dof} degrees of freedom</span>
        <span>{fit.iterations} iterations, {fit.converged ? 'converged' : 'not converged'}</span>
      </div>
      {fit.eq.length > 0 && <div className="ti-hint">Equivalence volumes of the fitted model: {fit.eq.map((v) => `${fixed(v, 3)} mL`).join(', ')} (with {sig(s.Ct, 4)} M titrant and {fixed(s.aliquot, 2)} mL of sample).</div>}
      {fit.correlation.length > 1 && fit.params.filter((p) => !p.fixed).length > 1 && (
        <details className="ti-details"><summary>Correlation between the parameters</summary>
          <table className="ti-table compact"><tbody>
            {fit.correlation.map((row, i) => <tr key={i}><th scope="row">{fit.params.filter((p) => !p.fixed)[i]?.name}</th>{row.map((v, j) => <td key={j}>{fixed(v, 3)}</td>)}</tr>)}
          </tbody></table>
        </details>
      )}
      <div className="ti-hint">The residuals below should scatter around zero. A pattern means the model is missing something: carbonate in the base, a wrong flask volume, a miscalibrated electrode, a second acid.</div>
    </>
  )
}

