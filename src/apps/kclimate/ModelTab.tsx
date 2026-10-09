// The energy-balance model: the temperature response to a CO2 scenario (with a climate-sensitivity slider, an ocean
// that takes up heat and an optional ice–albedo feedback), the hysteresis loop of the ice–albedo model, and the
// 255 K no-greenhouse Earth. A teaching model, not a forecast.

import { useMemo } from 'react'
import { Plus, X } from 'lucide-react'
import { analyseModel } from './analysis'
import type { Env } from './env'
import { blackbodyFigure, hysteresisFigure, modelFigure, scenarioFigure, type Palette } from './figures'
import { blackbodyTemperature, DEFAULT_EBM, heatCapacity, hysteresis, PRESET_LABELS, preindustrial, SIGMA, type ScenarioPreset } from './ebm'
import type { ModelView } from './project'
import { Card, Check, ChartFrame, Field, Notice, NumInput, Segmented, SeriesPicker, Slider, Split, Stat, fmt, signed } from './ui'

const K0 = 273.15

export default function ModelTab({ env }: { env: Env }) {
  const m = env.project.model
  const set = (fn: (mv: ModelView) => void) => env.update((p) => fn(p.model))
  const controls = (
    <>
      <div className="cl-group">
        <h4>Experiment</h4>
        <Segmented<ModelView['tool']> value={m.tool} label="Experiment" options={[['response', 'CO₂ response'], ['hysteresis', 'Ice–albedo loop'], ['blackbody', 'No greenhouse']]} onChange={(t) => set((mv) => { mv.tool = t })} />
      </div>
      {m.tool === 'response' && <ResponseControls env={env} />}
      {m.tool === 'hysteresis' && <HysteresisControls env={env} />}
      {m.tool === 'blackbody' && <BlackbodyControls env={env} />}
      <div className="cl-group">
        <button type="button" className="k-btn small" onClick={() => set((mv) => { mv.params = { ...DEFAULT_EBM } })}>Reset the physical parameters</button>
      </div>
    </>
  )
  return (
    <Split env={env} controls={controls}>
      <Notice>A zero-dimensional energy-balance model: one temperature for the whole Earth. It teaches how feedbacks, heat capacity and sensitivity work; it is not a projection.</Notice>
      {m.tool === 'response' && <ResponseResults env={env} />}
      {m.tool === 'hysteresis' && <HysteresisResults env={env} />}
      {m.tool === 'blackbody' && <BlackbodyResults env={env} />}
    </Split>
  )
}

// ------------------------------------------------------------------------------------------- response

function ResponseControls({ env }: { env: Env }) {
  const m = env.project.model
  const e = m.params
  const sc = m.scenario
  const setP = (fn: (p: typeof e) => void) => env.update((p) => fn(p.model.params))
  const setS = (fn: (s: typeof sc) => void) => env.update((p) => fn(p.model.scenario))
  const presets: ScenarioPreset[] = ['constant', 'growth', 'peak', 'netzero', 'custom']
  const unit = sc.mode === 'emissions' ? 'Gt CO₂/yr' : 'ppm'
  return (
    <>
      <div className="cl-group">
        <h4>Climate</h4>
        <Slider label="Climate sensitivity" value={e.ecs} min={1} max={8} step={0.1} unit="K per doubling" onChange={(v) => setP((p) => { p.ecs = v })} format={(v) => v.toFixed(1)} />
        <p className="cl-small k-muted">1.1 K is the answer with no feedbacks at all; the usual range is 2.5 to 4 K.</p>
        <Slider label="Ocean mixed layer" value={e.mixedDepth} min={10} max={1000} step={10} unit="m" onChange={(v) => setP((p) => { p.mixedDepth = v })} />
        <Check checked={e.deepOcean} onChange={(c) => setP((p) => { p.deepOcean = c })} label="Deep ocean takes up heat" title="A second, slow layer: the warming lags more, and keeps going for centuries" />
        <Check checked={e.ice} onChange={(c) => setP((p) => { p.ice = c })} label="Ice–albedo feedback" title="Colder means more ice, which reflects more sunlight" />
        <details className="cl-details">
          <summary>More physical parameters</summary>
          <Field label="Solar constant (W/m²)"><NumInput label="Solar constant" value={e.solar} min={500} max={3000} onChange={(v) => setP((p) => { p.solar = v })} /></Field>
          <Field label="Albedo (ice-free)"><NumInput label="Albedo" value={e.albedo} min={0} max={0.95} onChange={(v) => setP((p) => { p.albedo = v })} /></Field>
          <Field label="Effective emissivity ε" hint="1 = no greenhouse effect"><NumInput label="Emissivity" value={e.emissivity} min={0.2} max={1} onChange={(v) => setP((p) => { p.emissivity = v })} /></Field>
          <Field label="Pre-industrial CO₂ (ppm)"><NumInput label="Pre-industrial CO2" value={e.c0} min={100} max={1000} onChange={(v) => setP((p) => { p.c0 = v })} /></Field>
          {e.deepOcean && <Field label="Deep ocean depth (m)"><NumInput label="Deep ocean depth" value={e.deepDepth} min={100} max={5000} onChange={(v) => setP((p) => { p.deepDepth = v })} /></Field>}
          {e.deepOcean && <Field label="Heat exchange (W/m²/K)"><NumInput label="Heat exchange" value={e.exchange} min={0} max={5} onChange={(v) => setP((p) => { p.exchange = v })} /></Field>}
        </details>
      </div>
      <div className="cl-group">
        <h4>Scenario</h4>
        <Segmented<ModelView['scenario']['mode']> value={sc.mode} label="Driver" options={[['emissions', 'Emissions'], ['concentration', 'CO₂ concentration']]} onChange={(v) => setS((s) => { s.mode = v })} />
        <Field label="Path">
          <select className="k-input" aria-label="Scenario path" value={sc.preset} onChange={(ev) => setS((s) => { s.preset = ev.target.value as ScenarioPreset })}>
            {presets.map((k) => <option key={k} value={k}>{PRESET_LABELS[k]}</option>)}
          </select>
        </Field>
        <Field label="Scenario starts in" hint="Before this year: the history."><NumInput label="Start year" value={sc.startYear} min={1850} max={2090} onChange={(v) => setS((s) => { s.startYear = Math.round(v) })} /></Field>
        {(sc.preset === 'growth' || sc.preset === 'peak') && <Field label={`Growth (% per year)`}><NumInput label="Growth per year" value={sc.growthPct} min={-10} max={10} onChange={(v) => setS((s) => { s.growthPct = v })} /></Field>}
        {sc.preset === 'peak' && (
          <>
            <Field label="Peak year"><NumInput label="Peak year" value={sc.peakYear} min={sc.startYear} max={2100} onChange={(v) => setS((s) => { s.peakYear = Math.round(v) })} /></Field>
            <Field label="Years to decline"><NumInput label="Years to decline" value={sc.declineYears} min={1} max={300} onChange={(v) => setS((s) => { s.declineYears = v })} /></Field>
          </>
        )}
        {sc.preset === 'netzero' && <Field label={sc.mode === 'emissions' ? 'Net zero in' : 'Stops rising in'}><NumInput label="Net-zero year" value={sc.zeroYear} min={sc.startYear + 1} max={2100} onChange={(v) => setS((s) => { s.zeroYear = Math.round(v) })} /></Field>}
        {sc.preset === 'custom' && (
          <div className="cl-points">
            <span className="cl-label">Points after the start ({unit})</span>
            {sc.points.map((pt, i) => (
              <div key={i} className="cl-row">
                <NumInput label={`Point ${i + 1} year`} value={pt[0]} min={sc.startYear} max={2100} width={64} onChange={(v) => setS((s) => { s.points[i][0] = Math.round(v); s.points.sort((a, b) => a[0] - b[0]) })} />
                <NumInput label={`Point ${i + 1} value`} value={pt[1]} min={0} max={5000} width={72} onChange={(v) => setS((s) => { s.points[i][1] = v })} />
                <button type="button" className="k-icon-btn" aria-label={`Remove point ${i + 1}`} onClick={() => setS((s) => { s.points.splice(i, 1) })}><X size={14} /></button>
              </div>
            ))}
            <button type="button" className="k-btn small" onClick={() => setS((s) => { const last = s.points[s.points.length - 1]; s.points.push(last ? [Math.min(2100, last[0] + 10), last[1]] : [sc.startYear + 10, sc.mode === 'emissions' ? 20 : 450]) })}><Plus size={12} /> Add a point</button>
          </div>
        )}
      </div>
      <div className="cl-group">
        <h4>Compare with observations</h4>
        <SeriesPicker env={env} label="Observed temperature" value={m.observed || 'hadcrut5.anomaly'} onChange={(ref) => env.update((p) => { p.model.observed = ref })} />
        <Check checked={!!m.observed} onChange={(c) => env.update((p) => { p.model.observed = c ? 'hadcrut5.anomaly' : '' })} label="Show the observed series" />
      </div>
    </>
  )
}

function ResponseResults({ env }: { env: Env }) {
  const m = env.project.model
  const a = useMemo(() => analyseModel(env.lib, m), [env.lib, env.version, m])
  const build = useMemo(() => (pal: Palette) => modelFigure(a, pal), [a])
  const buildSc = useMemo(() => (pal: Palette) => scenarioFigure(a, pal), [a])
  const d = a.doubling
  const e = m.params
  const tau = heatCapacity(e) / (d.lambda)
  const peak = Math.max(...a.modelDT.y.filter(Number.isFinite))
  return (
    <>
      {a.notes.map((n) => <Notice key={n} kind="warn">{n}</Notice>)}
      <div className="cl-stats">
        <Stat label="Doubling CO₂, no feedbacks" value={<>{fmt(d.noFeedback)} <small>K</small></>} sub={`forcing ${fmt(d.forcing)} W/m² ÷ Planck response ${fmt(d.planck)} W/m²/K`} />
        <Stat label="Doubling CO₂, with feedbacks" value={<>{fmt(d.equilibrium)} <small>K</small></>} sub={`net feedback ${fmt(d.lambda)} W/m²/K`} tone="warn" />
        <Stat label={`Warming in ${a.end.year}`} value={<>{signed(a.end.warming, 3)} <small>°C</small></>} sub={`above ${a.rebased ? '1850–1900' : 'the pre-industrial equilibrium'}; peak ${fmt(peak, 3)}`} />
        <Stat label="Response time" value={<>{fmt(tau, 3)} <small>yr</small></>} sub={e.deepOcean ? 'mixed layer; the deep ocean adds centuries' : 'heat capacity ÷ feedback'} />
      </div>
      <ChartFrame env={env} primary title={a.rebased ? 'Warming above 1850–1900' : 'Warming above the pre-industrial equilibrium'} name="energy-balance-warming" build={build} height={380}
        caption={`${a.observed ? `Blue: observed (${a.observed.name}). ` : ''}Orange: the model. Dotted (click the legend to show): the warming the CO₂ of each year would eventually cause, to see how far behind the climate lags.`} />
      <ChartFrame env={env} title="The CO₂ scenario" name="energy-balance-scenario" build={buildSc} height={280}
        caption={a.path.history === 'observed'
          ? `Before ${m.scenario.startYear}: Mauna Loa observations from 1959 (and the emissions with an airborne fraction of ${fmt(a.path.fitted?.early ?? 0, 2)} before); the later emissions keep ${fmt(a.path.carbon.airborne, 2)} of each year’s CO₂ in the air (fitted, RMSE ${fmt(a.path.fitted?.rmse ?? 0, 2)} ppm).`
          : a.path.history === 'emissions' ? 'Built from the emissions with a fixed airborne fraction.' : 'Idealised history: not data.'} />
    </>
  )
}

// ------------------------------------------------------------------------------------------- hysteresis

function HysteresisControls({ env }: { env: Env }) {
  const e = env.project.model.params
  const setP = (fn: (p: typeof e) => void) => env.update((p) => fn(p.model.params))
  return (
    <div className="cl-group">
      <h4>Ice–albedo feedback</h4>
      <Slider label="Albedo of ice-free Earth" value={e.albedo} min={0.15} max={0.45} step={0.01} onChange={(v) => setP((p) => { p.albedo = v })} format={(v) => v.toFixed(2)} />
      <Slider label="Albedo of ice-covered Earth" value={e.iceAlbedo} min={0.45} max={0.8} step={0.01} onChange={(v) => setP((p) => { p.iceAlbedo = v })} format={(v) => v.toFixed(2)} />
      <Slider label="Fully frozen below" value={e.tCold} min={220} max={270} step={1} unit="K" onChange={(v) => setP((p) => { p.tCold = Math.min(v, p.tWarm - 5) })} />
      <Slider label="Ice-free above" value={e.tWarm} min={255} max={300} step={1} unit="K" onChange={(v) => setP((p) => { p.tWarm = Math.max(v, p.tCold + 5) })} />
      <Slider label="Effective emissivity ε" value={e.emissivity} min={0.4} max={0.9} step={0.01} onChange={(v) => setP((p) => { p.emissivity = v })} format={(v) => v.toFixed(2)} />
      <p className="cl-small k-muted">The loop is always drawn with the ice–albedo feedback on.</p>
    </div>
  )
}

function HysteresisResults({ env }: { env: Env }) {
  const e = env.project.model.params
  const h = useMemo(() => hysteresis({ ...e, ice: true }, 0.6, 1.6, 81), [e])
  const build = useMemo(() => (pal: Palette) => hysteresisFigure(h, pal), [h])
  const i1 = h.factor.reduce((best, f, i) => (Math.abs(f - 1) < Math.abs(h.factor[best] - 1) ? i : best), 0)
  const eq1 = h.equilibria[i1].filter((q) => q.stable).map((q) => q.T)
  return (
    <>
      <div className="cl-stats">
        <Stat label="Stable climates today" value={String(h.stableAtOne)} sub={eq1.map((t) => `${t.toFixed(1)} K (${(t - K0).toFixed(0)} °C)`).join(' and ')} tone={h.stableAtOne > 1 ? 'warn' : undefined} />
        <Stat label="Sun dims by" value={Number.isFinite(h.freezeAt) ? `${((1 - h.freezeAt) * 100).toFixed(1)} %` : '–'} sub="and the warm Earth freezes over" />
        <Stat label="Sun must brighten by" value={Number.isFinite(h.thawAt) ? `${((h.thawAt - 1) * 100).toFixed(1)} %` : '–'} sub="to thaw a frozen Earth" />
      </div>
      <ChartFrame env={env} primary title="Hysteresis of the ice–albedo model" name="ice-albedo-hysteresis" build={build} height={400}
        caption="Slowly lower the solar constant (red, dashed) and the Earth stays warm until it suddenly freezes; raise it again (blue) and it stays frozen until the sun is far brighter than when it froze. Open circles: the unstable middle state that separates the two." />
      {h.stableAtOne < 2 && <Notice kind="warn">With these numbers the Earth has only one stable climate at today’s sunshine, so there is no loop at 1.0. Try a larger gap between the ice and ice-free albedos.</Notice>}
    </>
  )
}

// ------------------------------------------------------------------------------------------- blackbody

function BlackbodyControls({ env }: { env: Env }) {
  const e = env.project.model.params
  const setP = (fn: (p: typeof e) => void) => env.update((p) => fn(p.model.params))
  return (
    <div className="cl-group">
      <h4>Planet</h4>
      <Slider label="Solar constant" value={e.solar} min={900} max={1800} step={1} unit="W/m²" onChange={(v) => setP((p) => { p.solar = v })} />
      <Slider label="Albedo" value={e.albedo} min={0} max={0.9} step={0.01} onChange={(v) => setP((p) => { p.albedo = v })} format={(v) => v.toFixed(2)} />
      <Slider label="Effective emissivity ε" value={e.emissivity} min={0.3} max={1} step={0.01} onChange={(v) => setP((p) => { p.emissivity = v })} format={(v) => v.toFixed(2)} />
    </div>
  )
}

function BlackbodyResults({ env }: { env: Env }) {
  const e = env.project.model.params
  const bb = blackbodyTemperature(e.solar, e.albedo, 1)
  const withGreenhouse = preindustrial({ ...e, ice: false })
  const absorbed = (e.solar / 4) * (1 - e.albedo)
  const build = useMemo(() => (pal: Palette) => blackbodyFigure(e.solar, e.albedo, e.emissivity, pal), [e.solar, e.albedo, e.emissivity])
  return (
    <>
      <div className="cl-stats">
        <Stat label="With no greenhouse effect" value={<>{bb.toFixed(1)} <small>K</small></>} sub={`${(bb - K0).toFixed(1)} °C`} tone="bad" />
        <Stat label={`With effective emissivity ${e.emissivity}`} value={<>{Number.isFinite(withGreenhouse) ? withGreenhouse.toFixed(1) : '–'} <small>K</small></>} sub={`${(withGreenhouse - K0).toFixed(1)} °C`} tone="good" />
        <Stat label="The natural greenhouse effect" value={<>{(withGreenhouse - bb).toFixed(1)} <small>K</small></>} sub="the difference between the two" />
      </div>
      <Card title="How it works">
        <p>
          The Earth absorbs sunlight, S (1 − α) / 4 = <strong>{absorbed.toFixed(1)} W/m²</strong> averaged over its whole surface (the 4 is the ratio of a sphere’s area to its shadow’s). It stays in balance by radiating the same amount: σT⁴ with σ = {SIGMA.toExponential(3)} W/m²/K⁴.
        </p>
        <p className="cl-equation">T = [ S (1 − α) / (4 ε σ) ]<sup>¼</sup> = [ {e.solar} × {(1 - e.albedo).toFixed(2)} / (4 × ε × σ) ]<sup>¼</sup></p>
        <p>With ε = 1 (a perfect radiator, no greenhouse effect) this gives {bb.toFixed(1)} K. The real surface is warmer because greenhouse gases and clouds absorb the heat the surface radiates and send part of it back: seen from space the Earth radiates like a body with an effective emissivity of about 0.61, from a surface at 288 K.</p>
      </Card>
      <ChartFrame env={env} primary title="Equilibrium temperature against albedo" name="no-greenhouse-earth" build={build} height={320} caption="Brighter planets are colder. The red dot is the albedo chosen on the left." />
    </>
  )
}
