// The Indicator chooser: for the curve of the current titration, which indicators change colour inside the
// steep part and what titration error each makes.

import { useEffect, useMemo, useState, type MutableRefObject } from 'react'
import { Check, X } from 'lucide-react'
import { marks, type Suitability } from './acidbase'
import { rankIndicators } from './chooser'
import { Chart, usePalette } from './Chart'
import { INDICATORS, REDOX_INDICATORS, indicatorById } from './data/indicators'
import { titrationFigure, type Figure, type Palette } from './figures'
import { fixed } from './format'
import { precipEndpoint, type PrecipSpec } from './precip'
import type { Project } from './project'
import { indicatorBand, type TitrationResult } from './result'
import { redoxEndpoint } from './redox'
import { Empty, IndicatorBar, Notice, Seg, Swatch } from './ui'

const VERDICT: Record<Suitability, string> = { excellent: 'Excellent', good: 'Good', poor: 'Poor', unsuitable: 'Unsuitable' }

export function IndicatorTab({
  project, result, update, exportRef, compact, onUse,
}: {
  project: Project
  result: TitrationResult
  update: (fn: (p: Project) => Project, key?: string) => void
  exportRef: MutableRefObject<null | ((pal: Palette) => Figure | null)>
  compact: boolean
  onUse: () => void
}) {
  const pal = usePalette()
  const [eqIndex, setEqIndex] = useState<number | null>(null)
  const [all, setAll] = useState(false)
  const spec = project.acidbase
  const isAB = project.mode === 'acidbase'
  const eqs = useMemo(() => { try { return isAB && !result.invalid ? marks(spec).eq : [] } catch { return [] } }, [isAB, spec, result.invalid])
  // the first equivalence point with a clear jump
  const auto = Math.max(0, eqs.findIndex((e) => e.resolved))
  const idx = Math.max(0, Math.min(eqIndex ?? auto, eqs.length - 1))
  const ranking = useMemo(() => { try { return isAB && eqs.length ? rankIndicators(spec, idx + 1) : null } catch { return null } }, [isAB, eqs.length, spec, idx])
  const chosen = indicatorById(spec.indicator)

  const figure = useMemo<Figure | null>(() => {
    if (result.invalid) return null
    return titrationFigure(chosen ? { ...result, band: indicatorBand(chosen) } : result, pal, { marks: true, buffers: false, band: true })
  }, [result, chosen, pal])
  useEffect(() => {
    exportRef.current = (p) => (result.invalid ? null : titrationFigure(chosen ? { ...result, band: indicatorBand(chosen) } : result, p, { marks: true, buffers: false, band: true }))
    return () => { exportRef.current = null }
  }, [exportRef, result, chosen])

  return (
    <div className="ti-split" data-compact={compact || undefined}>
      <main className="ti-main ti-wide">
        {result.invalid ? <Empty>{result.invalid}</Empty> : (
          <>
            <div className="ti-chartbar">
              <strong>{result.title}</strong>
              <span className="ti-spacer" />
              {isAB && eqs.length > 1 && (
                <Seg label="Equivalence point" value={String(idx)} options={eqs.map((e, i) => ({ id: String(i), label: `EP${i + 1} (${fixed(e.V, 1)} mL)`, title: e.resolved ? 'A clear jump' : 'A weak jump' }))} onChange={(v) => setEqIndex(Number(v))} />
              )}
            </div>
            <div className="ti-plot short">{figure && <Chart figure={figure} label="Titration curve with the indicator's colour range" />}</div>
            <div className="ti-results">
              {isAB && ranking && (
                <>
                  <div className="ti-hint">
                    The pH changes from <b>{fixed(ranking.jump[0], 2)}</b> to <b>{fixed(ranking.jump[1], 2)}</b> within 0.1 % of the equivalence volume ({fixed(ranking.Veq, 3)} mL). An indicator whose colour midpoint lies in that range changes within 0.1 % of the end point. Click “Use” to put an indicator in the flask.
                    {!eqs[idx]?.resolved && ' This jump is weak: no indicator will be sharp here.'}
                  </div>
                  <table className="ti-table indicators">
                    <thead><tr><th>Indicator</th><th>Colours, pH 0–14</th><th>Changes at</th><th>Error</th><th>Verdict</th><th /></tr></thead>
                    <tbody>
                      {(all ? ranking.list : ranking.list.slice(0, 10)).map((r) => (
                        <tr key={r.ind.id} className={spec.indicator === r.ind.id ? 'on' : ''}>
                          <th scope="row">{r.ind.name}<div className="ti-sub">{r.ind.acidName} → {r.ind.baseName}, pH {r.ind.lo}–{r.ind.hi}</div></th>
                          <td className="ti-barcell"><IndicatorBar ind={r.ind} jump={ranking.jump} compact /></td>
                          <td>{r.V === null ? '–' : `${fixed(r.V, 2)} mL`}</td>
                          <td className={r.errorPercent !== null && Math.abs(r.errorPercent) <= 0.5 ? 'ti-ok' : ''}>{r.errorPercent === null ? '–' : `${r.errorPercent >= 0 ? '+' : ''}${fixed(r.errorPercent, 2)} %`}</td>
                          <td><span className={`ti-chip ${r.verdict}`}>{r.verdict === 'excellent' || r.verdict === 'good' ? <Check size={11} /> : r.verdict === 'unsuitable' ? <X size={11} /> : null} {VERDICT[r.verdict]}</span></td>
                          <td><button type="button" className="k-btn small" onClick={() => { update((p) => ({ ...p, acidbase: { ...p.acidbase, indicator: r.ind.id } }), 'ind'); onUse() }}>Use</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {ranking.list.length > 10 && <button type="button" className="k-btn small" onClick={() => setAll((a) => !a)}>{all ? 'Show the best 10' : `Show all ${ranking.list.length}`}</button>}
                  <div className="ti-hint">Indicators are sorted by the size of their titration error. {INDICATORS.length - ranking.list.length} multicolour indicators (universal, cabbage) are left out: they give a reading, not an end point.</div>
                </>
              )}
              {isAB && !ranking && <Notice>The flask has no equivalence point to judge indicators by.</Notice>}
              {project.mode === 'redox' && <RedoxIndicators project={project} update={update} onUse={onUse} />}
              {project.mode === 'edta' && (
                <>
                  <Notice>Metal indicators change colour at pM = log K′ of their complex with the metal. The error is in the results of the Titration tab.</Notice>
                  <table className="ti-table"><tbody>{result.facts.map(([k, v], i) => <tr key={i}><th scope="row">{k}</th><td>{v}</td></tr>)}</tbody></table>
                  {result.band?.note && <div className="ti-hint">{result.band.note}</div>}
                </>
              )}
              {project.mode === 'precip' && <PrecipEndpoints spec={project.precip} />}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function RedoxIndicators({ project, update, onUse }: { project: Project; update: (fn: (p: Project) => Project, key?: string) => void; onUse: () => void }) {
  const list = REDOX_INDICATORS.map((ind) => ({ ind, ep: redoxEndpoint(project.redox, ind.id) })).sort((a, b) => Math.abs(a.ep.errorPercent ?? 1e9) - Math.abs(b.ep.errorPercent ?? 1e9))
  return (
    <table className="ti-table indicators">
      <thead><tr><th>Redox indicator</th><th>Colours</th><th>Transition E</th><th>Changes at</th><th>Error</th><th /></tr></thead>
      <tbody>
        {list.map(({ ind, ep }) => (
          <tr key={ind.id} className={project.redox.indicator === ind.id ? 'on' : ''}>
            <th scope="row">{ind.name}</th>
            <td><Swatch color={ind.red} /> {ind.redName} <span className="ti-muted">→</span> <Swatch color={ind.ox} /> {ind.oxName}</td>
            <td>{fixed(ind.E0, 2)} V</td>
            <td>{ep.V === null ? '–' : `${fixed(ep.V, 2)} mL`}</td>
            <td>{ep.errorPercent === null ? '–' : `${ep.errorPercent >= 0 ? '+' : ''}${fixed(ep.errorPercent, 2)} %`}</td>
            <td><button type="button" className="k-btn small" onClick={() => { update((p) => ({ ...p, redox: { ...p.redox, indicator: ind.id } }), 'ind'); onUse() }}>Use</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function PrecipEndpoints({ spec }: { spec: PrecipSpec }) {
  const rows = (spec.mode === 'silver-titrant' ? [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05] : [0.001, 0.005, 0.01, 0.05, 0.1]).map((c) => {
    const s: PrecipSpec = spec.mode === 'silver-titrant' ? { ...spec, indicator: 'mohr', chromate: c } : { ...spec, indicator: 'volhard', iron: c }
    return { c, ep: precipEndpoint(s) }
  })
  return (
    <>
      <div className="ti-hint">{spec.mode === 'silver-titrant' ? 'Mohr: the end point error against the chromate concentration in the flask. Too much chromate gives an early red colour; too little a late one. The best compromise is about 2–5 mM.' : 'Volhard: the end point error against the iron(III) concentration in the flask.'}</div>
      <table className="ti-table">
        <thead><tr><th>{spec.mode === 'silver-titrant' ? 'Chromate' : 'Iron(III)'}</th><th>End point at</th><th>Error</th></tr></thead>
        <tbody>
          {rows.map(({ c, ep }) => <tr key={c} className={(spec.mode === 'silver-titrant' ? spec.chromate : spec.iron) === c ? 'on' : ''}><th scope="row">{c * 1000} mM</th><td>{ep.V === null ? '–' : `${fixed(ep.V, 3)} mL`}</td><td>{ep.errorPercent === null ? '–' : `${ep.errorPercent >= 0 ? '+' : ''}${fixed(ep.errorPercent, 2)} %`}</td></tr>)}
        </tbody>
      </table>
    </>
  )
}

