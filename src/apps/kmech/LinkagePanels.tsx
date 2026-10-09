// The side panel of the Linkages workbench: edit, analysis, coupler curves, engine, forces and dynamics, synthesis.

import { useMemo, useState } from 'react'
import { Play, Plus, Trash2, X } from 'lucide-react'
import { os } from '@/os'
import { describeOutput, findCusps, fourBarOf, staticTorqueCurve, type Cycle, type OutputSpec, type PointLoad } from './analysis'
import type { LinkageDoc } from './doc'
import type { DynResult } from './dynamics'
import { deletePick, linkSpans, setDriverOnLink, setLinkLength, updatePoint, updateSlider, type Pick } from './edit'
import { DEFAULT_ENGINE, meanPistonSpeed, runEngine, type EngineSpec } from './engine'
import { fourBarFromDesign, fourBarDoc } from './examples'
import { classifyFourBar, crankRockerTransmission, fourBarPose, fourBarRockerLimits, sliderStroke } from './fourbar'
import type { LLink, LPoint } from './linkage'
import { deg, fmt, rad, type Pt } from './math'
import type { CanvasHandle } from './MechCanvas'
import type { PlotKind } from './LinkageBench'
import type { Shell } from './shell'
import { functionGenerator, threePositionSynthesis, twoPositionSynthesis, placeOn, type CouplerPos } from './synthesis'
import { Check, f4, Kv, NumField, Note, Section, Seg, TextField } from './ui'

export type SideTab = 'edit' | 'analysis' | 'coupler' | 'engine' | 'forces' | 'synthesis'

export interface PanelApi {
  m: LinkageDoc
  shell: Shell<LinkageDoc>
  pick: Pick | null
  setPick(p: Pick | null): void
  cycle: Cycle
  fresh: boolean
  plot: PlotKind
  setPlot(p: PlotKind): void
  dyn: DynResult | null
  setDyn(d: DynResult | null): void
  tab: SideTab
  atlasLink: string
  setAtlasLink(id: string): void
  showAtlas: boolean
  setShowAtlas(b: boolean): void
  canvas: React.RefObject<CanvasHandle | null>
  setTool(t: never): void
  theta: number
  openDock(): void
}

const TABS: Array<{ id: SideTab; label: string }> = [
  { id: 'edit', label: 'Edit' }, { id: 'analysis', label: 'Analysis' }, { id: 'coupler', label: 'Coupler' }, { id: 'engine', label: 'Engine' }, { id: 'forces', label: 'Forces' }, { id: 'synthesis', label: 'Synthesis' },
]

export function LinkagePanels({ api, tab, setTab, onClose }: { api: PanelApi; tab: SideTab; setTab(t: SideTab): void; onClose(): void }) {
  return (
    <aside className="mc-side" aria-label="Mechanism panels">
      <div className="mc-side-tabs" role="tablist">
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
        <button className="k-icon-btn" style={{ marginLeft: 'auto', alignSelf: 'center' }} aria-label="Close the side panel" title="Close" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="mc-side-body">
        {tab === 'edit' && <EditPanel api={api} />}
        {tab === 'analysis' && <AnalysisPanel api={api} />}
        {tab === 'coupler' && <CouplerPanel api={api} />}
        {tab === 'engine' && <EnginePanel api={api} />}
        {tab === 'forces' && <ForcesPanel api={api} />}
        {tab === 'synthesis' && <SynthesisPanel api={api} />}
      </div>
    </aside>
  )
}

const name = (m: LinkageDoc, id: string) => m.points.find((p) => p.id === id)?.label || id

// ------------------------------------------------------------------------------ outputs

export function outputChoices(m: LinkageDoc): Array<{ key: string; label: string; spec: OutputSpec | null | undefined }> {
  const out: Array<{ key: string; label: string; spec: OutputSpec | null | undefined }> = [{ key: 'auto', label: 'Automatic', spec: undefined }]
  for (const s of m.sliders) if (s.line.kind === 'ground') out.push({ key: `s:${s.point}`, label: `Slide of ${name(m, s.point)}`, spec: { kind: 'slider', point: s.point } })
  for (const l of m.links) {
    if (l.pts.length < 2) continue
    out.push({ key: `l:${l.pts[0]}:${l.pts[1]}`, label: `Angle of ${l.label || l.id} (${name(m, l.pts[0])}→${name(m, l.pts[1])})`, spec: { kind: 'link', from: l.pts[0], to: l.pts[1] } })
  }
  for (const p of m.points) if (!p.ground) {
    out.push({ key: `px:${p.id}`, label: `x of ${name(m, p.id)}`, spec: { kind: 'point', point: p.id, axis: 'x' } })
    out.push({ key: `py:${p.id}`, label: `y of ${name(m, p.id)}`, spec: { kind: 'point', point: p.id, axis: 'y' } })
  }
  return out
}

const outputKey = (o: OutputSpec | null | undefined): string => (o === undefined ? 'auto' : o === null ? 'auto' : o.kind === 'slider' ? `s:${o.point}` : o.kind === 'link' ? `l:${o.from}:${o.to}` : `p${o.axis}:${o.point}`)

// ------------------------------------------------------------------------------ edit

function EditPanel({ api }: { api: PanelApi }) {
  const { m, shell, pick } = api
  const pt = pick?.kind === 'point' ? m.points.find((p) => p.id === pick.id) : undefined
  const link = pick?.kind === 'link' ? m.links.find((l) => l.id === pick.id) : undefined
  const slider = pick?.kind === 'slider' ? m.sliders.find((s) => s.id === pick.id) : undefined
  const setPoint = (patch: Partial<LPoint>) => pt && shell.commit(updatePoint(m, pt.id, patch))
  const setLink = (patch: Partial<LLink>) => link && shell.commit({ ...m, links: m.links.map((l) => (l.id === link.id ? { ...l, ...patch } : l)) })
  if (pt) {
    const sl = m.sliders.find((s) => s.point === pt.id)
    return (
      <>
        <Section title={`Joint ${pt.label || pt.id}`}>
          <NumField label="x" unit="mm" value={pt.x} onChange={(v) => setPoint({ x: v })} />
          <NumField label="y" unit="mm" value={pt.y} onChange={(v) => setPoint({ y: v })} />
          <TextField label="Name" value={pt.label ?? ''} placeholder={pt.id} onChange={(v) => setPoint({ label: v || undefined })} />
          <Check label="Ground pin (fixed to the frame)" checked={!!pt.ground} onChange={(v) => setPoint({ ground: v ? true : undefined })} />
          <Check label="Trace its path" checked={!!pt.tracer} onChange={(v) => setPoint({ tracer: v ? true : undefined })} />
          {sl && <Note>This joint slides on a {sl.line.kind === 'ground' ? `line at ${fmt(sl.line.angle, 4)}°` : 'link'}. Select the slider block to change that.</Note>}
        </Section>
        <div className="mc-actions"><button className="k-btn danger" onClick={() => { shell.commit(deletePick(m, pick!)); api.setPick(null) }}><Trash2 size={13} /> Delete joint</button></div>
      </>
    )
  }
  if (link) {
    const spans = linkSpans(m, link)
    const hasGround = link.pts.some((id) => m.points.find((p) => p.id === id)?.ground)
    const isDriver = !!m.driver && link.pts.includes(m.driver.from) && link.pts.includes(m.driver.to)
    return (
      <>
        <Section title={`Link ${link.label || link.id}`}>
          <TextField label="Name" value={link.label ?? ''} placeholder={link.id} onChange={(v) => setLink({ label: v || undefined })} />
          <NumField label={`Length ${name(m, link.pts[0])}–${name(m, link.pts[1])}`} unit="mm" min={0.001} value={spans[0] ?? 0} onChange={(v) => shell.commit(setLinkLength(m, link.id, v))} title="Moves the second joint along the bar" />
          {spans.slice(1).map((s, i) => <div key={i} className="mc-hint">{name(m, link.pts[i + 1])}–{name(m, link.pts[i + 2])}: {fmt(s, 5)} mm</div>)}
          <div className="mc-hint">Joints: {link.pts.map((id) => name(m, id)).join(', ')}</div>
          <Seg label="Shape" value={link.shape ?? 'bar'} options={[{ id: 'bar', label: 'Bar' }, { id: 'plate', label: 'Plate', title: 'Filled polygon through the joints (3 or more)' }, { id: 'star', label: 'Star', title: 'Spokes from the first joint' }]} onChange={(v) => setLink({ shape: v === 'bar' ? undefined : v })} />
        </Section>
        <div className="mc-actions">
          <button className="k-btn" disabled={!hasGround || isDriver} title={hasGround ? 'Turn this link with the motor' : 'Needs a ground pin'} onClick={() => shell.commit(setDriverOnLink(m, link.id))}>{isDriver ? 'This is the driver' : 'Make it the driver'}</button>
          <button className="k-btn danger" onClick={() => { shell.commit(deletePick(m, pick!)); api.setPick(null) }}><Trash2 size={13} /> Delete link</button>
        </div>
      </>
    )
  }
  if (slider) {
    return (
      <>
        <Section title={`Slider on ${name(m, slider.point)}`}>
          <Seg label="Slides on" value={slider.line.kind} options={[{ id: 'ground', label: 'A line on the frame' }, { id: 'link', label: 'A link (slot)' }]} onChange={(v) => {
            if (v === 'ground') {
              const p = m.points.find((q) => q.id === slider.point)!
              shell.commit(updateSlider(m, slider.id, { line: { kind: 'ground', x: p.x, y: p.y, angle: 0 } }))
            } else {
              const l = m.links.find((q) => q.pts.length >= 2 && !q.pts.includes(slider.point))
              if (!l) { shell.say('Draw another link first: the slot is cut in a link.'); return }
              shell.commit(updateSlider(m, slider.id, { line: { kind: 'link', a: l.pts[0], b: l.pts[1] } }))
            }
          }} />
          {slider.line.kind === 'ground' ? (
            <NumField label="Angle" unit="°" value={slider.line.angle} onChange={(v) => { const p = m.points.find((q) => q.id === slider.point)!; shell.commit(updateSlider(m, slider.id, { line: { kind: 'ground', x: p.x, y: p.y, angle: v } })) }} />
          ) : (
            <label className="mc-field"><span>Slot in</span>
              <select className="k-input" value={`${slider.line.a}|${slider.line.b}`} onChange={(e) => { const [a, b] = e.target.value.split('|'); shell.commit(updateSlider(m, slider.id, { line: { kind: 'link', a, b } })) }}>
                {m.links.filter((l) => l.pts.length >= 2 && !l.pts.includes(slider.point)).map((l) => <option key={l.id} value={`${l.pts[0]}|${l.pts[1]}`}>{l.label || l.id} ({name(m, l.pts[0])}→{name(m, l.pts[1])})</option>)}
              </select>
            </label>
          )}
          <NumField label="Block mass" unit="kg" min={0.001} value={slider.mass ?? 0.1} onChange={(v) => shell.commit(updateSlider(m, slider.id, { mass: v }))} title="Used by the dynamic model" />
        </Section>
        <div className="mc-actions"><button className="k-btn danger" onClick={() => { shell.commit(deletePick(m, pick!)); api.setPick(null) }}><Trash2 size={13} /> Delete slider</button></div>
      </>
    )
  }
  const mat = m.material ?? { density: 7850, width: 12, thickness: 6 }
  const choices = outputChoices(m)
  return (
    <>
      <Section title="This mechanism">
        <TextField label="Name" value={m.name} onChange={(v) => shell.commit({ ...m, name: v || 'Untitled' })} />
        {m.driver
          ? <NumField label={`Driver ${name(m, m.driver.from)}→${name(m, m.driver.to)}`} unit="rpm" value={m.driver.rpm} onChange={(v) => shell.commit({ ...m, driver: { ...m.driver!, rpm: v } })} />
          : <Note kind="warn">No driver yet: use the Driver tool (D) on a bar that has a ground pin.</Note>}
        <label className="mc-field"><span>Output</span>
          <select className="k-input" value={outputKey(m.output)} onChange={(e) => { const c = choices.find((x) => x.key === e.target.value); shell.commit({ ...m, output: c?.spec }) }}>
            {choices.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <div className="mc-hint">{m.points.length} joints · {m.links.length} links · {m.sliders.length} sliders. Click an item on the sheet to edit it.</div>
        {m.limits && <div className="mc-hint">Valid input range {fmt(m.limits.min, 4)}° to {fmt(m.limits.max, 4)}°{m.dwell ? ' (the driven parts rest outside it)' : ''}.</div>}
      </Section>
      <Section title="Material (dynamic model)">
        <NumField label="Density" unit="kg/m³" value={mat.density} min={1} onChange={(v) => shell.commit({ ...m, material: { ...mat, density: v } })} />
        <NumField label="Bar width" unit="mm" value={mat.width} min={0.1} onChange={(v) => shell.commit({ ...m, material: { ...mat, width: v } })} />
        <NumField label="Thickness" unit="mm" value={mat.thickness} min={0.1} onChange={(v) => shell.commit({ ...m, material: { ...mat, thickness: v } })} />
      </Section>
      <Section title="Notes">
        <TextField label="" rows={5} value={m.notes ?? ''} onChange={(v) => shell.commit({ ...m, notes: v || undefined })} />
      </Section>
    </>
  )
}

// ------------------------------------------------------------------------------ analysis

function AnalysisPanel({ api }: { api: PanelApi }) {
  const { m, cycle, fresh } = api
  if (!fresh) return <div className="mc-hint">Updating the analysis…</div>
  if (!cycle.ok) {
    return (
      <>
        <Note kind="error">{cycle.message ?? 'The mechanism could not be analysed.'}</Note>
        <div className="mc-hint">Unknowns: {cycle.solver.sys.free.length * 2} coordinates, equations: {cycle.solver.sys.cons.length}. A one-input mechanism needs exactly as many equations as unknowns (counting the driver). Mobility without the driver: {cycle.mobility}.</div>
        {cycle.solver.sys.warnings.map((w, i) => <Note key={i} kind="warn">{w}</Note>)}
      </>
    )
  }
  const s = cycle.summary
  const fb = fourBarOf(m)
  const g = fb ? classifyFourBar(fb) : null
  const unit = cycle.outputUnit === 'deg' ? '°' : ' mm'
  const choose = (spec: OutputSpec | null | undefined) => api.shell.commit({ ...m, output: spec })
  const crt = fb && g?.kind === 'crank-rocker' && g.inputFullTurn ? crankRockerTransmission(fb) : null
  const lim = fb && g?.kind === 'crank-rocker' && g.inputFullTurn ? fourBarRockerLimits(fb, true) : null
  return (
    <>
      <Section title="Classification">
        <Kv rows={[
          ['Mobility', 'one degree of freedom, set by the driver'],
          ...(g ? [['Four-bar', <b key="k">{g.label}</b>] as [string, React.ReactNode]] : []),
          ...(fb ? [
            ['Links (input, coupler, output, frame)', `${f4(fb.a)}, ${f4(fb.b)}, ${f4(fb.c)}, ${f4(fb.d)} mm`] as [string, React.ReactNode],
            ['s + l − (p + q)', `${f4(g!.margin)} mm ${g!.condition === 'grashof' ? '(< 0: Grashof)' : g!.condition === 'change-point' ? '(= 0: change point)' : '(> 0: not Grashof)'}`] as [string, React.ReactNode],
          ] : []),
          ['Input range', cycle.range.full ? 'full turn' : `${f4(deg(cycle.range.min), 5)}° … ${f4(deg(cycle.range.max), 5)}°`],
          ['Driver speed', `${f4(cycle.rpm)} rpm`],
        ]} />
        {!cycle.range.full && !m.limits && <Note kind="warn">The input cannot turn all the way round: the mechanism locks up at the ends of this range.</Note>}
        {g?.kind === 'change-point' && <Note kind="warn">A change-point linkage can fold into a different shape at the aligned position; kMech follows the branch it was drawn on.</Note>}
      </Section>
      <Section title="Output">
        <label className="mc-field"><span>Measured</span>
          <select className="k-input" value={outputKey(m.output)} onChange={(e) => choose(outputChoices(m).find((c) => c.key === e.target.value)?.spec)}>
            {outputChoices(m).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        {cycle.output ? (
          <Kv rows={[
            ['Output', describeOutput(m, cycle.output)],
            ['Minimum', `${f4(s.outMin)}${unit}`], ['Maximum', `${f4(s.outMax)}${unit}`], ['Range of motion', `${f4(s.span)}${unit}`],
            ['Peak velocity', `${f4(s.peakVel)} ${cycle.outputUnit === 'deg' ? '°' : 'mm'}/s`], ['Peak acceleration', `${f4(s.peakAcc)} ${cycle.outputUnit === 'deg' ? '°' : 'mm'}/s²`],
            ...(s.quickReturn ? [['Quick-return ratio', <b key="q">{f4(s.quickReturn.ratio, 5)}</b>] as [string, React.ReactNode], ['Forward / return stroke', `${f4(s.quickReturn.forwardDeg, 5)}° / ${f4(s.quickReturn.returnDeg, 5)}°`] as [string, React.ReactNode]] : []),
            ...(cycle.output.kind === 'slider' && fb === null ? [['Stroke', `${f4(s.span)} mm`] as [string, React.ReactNode]] : []),
          ]} />
        ) : <div className="mc-hint">Nothing to measure: add a slider or choose an output.</div>}
      </Section>
      {s.muMin !== null && (
        <Section title="Transmission">
          <Kv rows={[
            ['Transmission angle', `${f4(s.muMin, 4)}° to ${f4(s.muMax, 4)}°`],
            ['Within 40°–140°', `${f4((s.muGoodShare ?? 0) * 100, 3)} % of the cycle`],
            ...(crt ? [['Closed form (crank-rocker)', `${f4(deg(crt.min), 4)}° to ${f4(deg(crt.max), 4)}°`] as [string, React.ReactNode]] : []),
            ...(lim ? [['Rocker limits', `${f4(deg(Math.min(lim.extended.th4, lim.folded.th4)), 5)}° … ${f4(deg(Math.max(lim.extended.th4, lim.folded.th4)), 5)}°`] as [string, React.ReactNode]] : []),
            ['Dead centres', s.deadCentres.length ? s.deadCentres.slice(0, 4).map((d) => `${f4(d, 4)}°`).join(', ') : 'none'],
          ]} />
          {(s.muMin ?? 90) < 40 && <Note kind="warn">The transmission angle falls to {f4(s.muMin, 3)}°: below 40° the mechanism can jam under load. Lengthen the coupler or reduce the offset.</Note>}
        </Section>
      )}
      <div className="mc-actions">
        <button className="k-btn" onClick={() => { api.setPlot('motion'); api.openDock() }}>Output plot</button>
        <button className="k-btn" onClick={() => { api.setPlot('transmission'); api.openDock() }}>Transmission plot</button>
      </div>
      <Section title="Table (every 30° of input)">
        <div style={{ maxHeight: 240, overflow: 'auto' }}>
          <table className="mc-table">
            <thead><tr><th>input°</th><th>out</th><th>vel</th><th>μ°</th></tr></thead>
            <tbody>
              {cycle.theta.filter((_, i) => i % Math.max(1, Math.round(30 / Math.max(1e-9, (cycle.theta[cycle.theta.length - 1] - cycle.theta[0]) / (cycle.theta.length - 1)))) === 0).map((t) => {
                const i = cycle.theta.indexOf(t)
                return <tr key={i}><td>{f4(t, 4)}</td><td>{f4(cycle.pos[i], 4)}</td><td>{f4(cycle.vel[i], 3)}</td><td>{f4(cycle.mu[i], 3)}</td></tr>
              })}
            </tbody>
          </table>
        </div>
      </Section>
      {cycle.solver.sys.warnings.map((w, i) => <Note key={i} kind="warn">{w}</Note>)}
    </>
  )
}

// ------------------------------------------------------------------------------ coupler

function CouplerPanel({ api }: { api: PanelApi }) {
  const { m, cycle, fresh } = api
  const tracers = m.points.filter((p) => p.tracer)
  const plates = m.links.filter((l) => l.pts.length >= 2)
  const cusps = useMemo(() => (fresh && cycle.ok ? Object.fromEntries(tracers.map((p) => [p.id, findCusps(cycle, p.id)])) : {}), [fresh, cycle, tracers.length]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <Section title="Traced points">
        {tracers.length === 0 && <div className="mc-hint">No point is traced. Use the Tracer tool (T) on a joint, or tick “Trace its path” for a point in the Edit tab.</div>}
        {tracers.map((p) => (
          <div key={p.id} className="mc-hint">
            <b>{p.label || p.id}</b>: {fresh && cycle.ok ? `${(cusps[p.id] ?? []).length} cusp${(cusps[p.id] ?? []).length === 1 ? '' : 's'}${(cusps[p.id] ?? []).length ? ` at ${(cusps[p.id] ?? []).slice(0, 4).map((c) => `${f4(c.theta, 4)}°`).join(', ')}` : ''}` : '…'}
          </div>
        ))}
        <div className="mc-actions"><button className="k-btn" disabled={!cycle.ok} onClick={() => { api.setPlot('coupler'); api.openDock() }}>Show the curves</button></div>
      </Section>
      <Section title="Coupler-curve atlas">
        <div className="mc-hint">Draws the paths of a grid of points attached to one link (a from −0.5 to 1.5 along the link, b from −1 to 1 across it). Curves with cusps are orange.</div>
        <label className="mc-field"><span>Link</span>
          <select className="k-input" value={api.atlasLink} onChange={(e) => api.setAtlasLink(e.target.value)}>
            <option value="">Automatic (the coupler)</option>
            {plates.map((l) => <option key={l.id} value={l.id}>{l.label || l.id}</option>)}
          </select>
        </label>
        <Check label="Show the atlas on the sheet" checked={api.showAtlas} onChange={(v) => { api.setShowAtlas(v); if (v) { api.setPlot('atlas'); api.openDock() } }} />
      </Section>
    </>
  )
}

// ------------------------------------------------------------------------------ engine

function engineFromGeometry(m: LinkageDoc): EngineSpec {
  const s = m.sliders.find((x) => x.line.kind === 'ground')
  const out = { ...DEFAULT_ENGINE }
  if (!s) return out
  const rod = m.links.find((l) => l.pts.includes(s.point) && l.pts.length === 2)
  if (!rod) return out
  const A = rod.pts.find((id) => id !== s.point)!
  const crank = m.links.find((l) => l !== rod && l.pts.includes(A) && l.pts.length === 2)
  const O = crank?.pts.find((id) => id !== A)
  const pa = m.points.find((p) => p.id === A); const pb = m.points.find((p) => p.id === s.point); const po = m.points.find((p) => p.id === O)
  if (pa && pb && po) { out.rod = Math.hypot(pb.x - pa.x, pb.y - pa.y); out.stroke = 2 * Math.hypot(pa.x - po.x, pa.y - po.y) }
  out.rpm = m.driver?.rpm ?? out.rpm
  return out
}

function EnginePanel({ api }: { api: PanelApi }) {
  const { m, shell } = api
  const [tableText, setTableText] = useState('')
  const e = m.engine
  const set = (patch: Partial<EngineSpec>) => e && shell.commit({ ...m, engine: { ...e, ...patch } })
  const res = useMemo(() => (e ? runEngine(e) : null), [e])
  if (!e || !res) {
    const ok = m.sliders.some((s) => s.line.kind === 'ground')
    return (
      <>
        <Section title="Engine mode">
          <div className="mc-hint">For a slider-crank (a crank, a connecting rod and a piston on a ground slider) kMech can add a gas-pressure curve, the indicated torque, the inertia torque and the flywheel energy fluctuation.</div>
          <div className="mc-actions"><button className="k-btn primary" disabled={!ok} onClick={() => { shell.commit({ ...m, engine: engineFromGeometry(m) }); api.setPlot('enginetorque'); api.openDock() }}>Treat this as an engine</button></div>
          {!ok && <Note kind="warn">Add a piston: a joint on a ground slider (Slider tool, S).</Note>}
        </Section>
      </>
    )
  }
  const parseTable = (): Array<[number, number]> | null => {
    const rows = tableText.split(/\r?\n/).map((l) => l.trim().split(/[\s,;\t]+/).map(Number)).filter((r) => r.length >= 2 && r.every((v) => Number.isFinite(v))).map((r) => [r[0], r[1]] as [number, number])
    return rows.length >= 2 ? rows : null
  }
  return (
    <>
      <Section title="Geometry and speed">
        <NumField label="Bore" unit="mm" min={1} value={e.bore} onChange={(v) => set({ bore: v })} />
        <div className="mc-hint">Stroke {fmt(e.stroke, 5)} mm and rod {fmt(e.rod, 5)} mm follow the drawing; sliding stroke of the drawn crank: {fmt(sliderStroke({ r: e.stroke / 2, l: e.rod }), 5)} mm.</div>
        <NumField label="Compression" unit=": 1" min={2} value={e.cr} onChange={(v) => set({ cr: v })} />
        <NumField label="Cylinders" integer min={1} max={12} value={e.cylinders} onChange={(v) => set({ cylinders: v })} title="In-line, evenly spaced firing" />
        <NumField label="Speed" unit="rpm" min={1} value={e.rpm} onChange={(v) => { set({ rpm: v }); if (m.driver) shell.commit({ ...m, engine: { ...e, rpm: v }, driver: { ...m.driver, rpm: v } }) }} />
        <NumField label="Reciprocating mass" unit="kg" min={0} value={e.mRec} onChange={(v) => set({ mRec: v })} title="Piston, rings, pin and the small end of the rod, per cylinder" />
      </Section>
      <Section title="Gas pressure">
        <NumField label="Heat release" unit="J" min={0} value={e.heat} onChange={(v) => set({ heat: v })} title="Per cylinder per cycle" />
        <NumField label="Burn starts" unit="° BTDC" value={e.burnAdvance} onChange={(v) => set({ burnAdvance: v })} />
        <NumField label="Burn lasts" unit="°" min={5} value={e.burnDuration} onChange={(v) => set({ burnDuration: v })} />
        <NumField label="γ" min={1.05} max={1.67} value={e.gamma} onChange={(v) => set({ gamma: v })} />
        <NumField label="Intake" unit="kPa" min={10} value={e.pIntake} onChange={(v) => set({ pIntake: v })} />
        <NumField label="Exhaust" unit="kPa" min={10} value={e.pExhaust} onChange={(v) => set({ pExhaust: v })} />
        <div className="mc-hint">{e.table ? `Using your pressure table (${e.table.length} points) instead of the model.` : 'Pressure from adiabatic compression and expansion with a Wiebe burn. Paste crank angle (0–720°, 0 = TDC at the start of intake) and absolute pressure in kPa to use a measured curve:'}</div>
        <textarea className="k-input" rows={3} style={{ width: '100%', font: 'var(--k-mono)', fontSize: 11 }} placeholder={'0 100\n360 4000\n720 100'} value={tableText} onChange={(ev) => setTableText(ev.target.value)} aria-label="Pressure table" />
        <div className="mc-actions">
          <button className="k-btn" onClick={() => { const t = parseTable(); if (!t) { shell.say('Give at least two lines of “angle pressure”.'); return } set({ table: t }) }}>Use the table</button>
          <button className="k-btn" disabled={!e.table} onClick={() => shell.commit({ ...m, engine: { ...e, table: undefined } })}>Back to the model</button>
        </div>
      </Section>
      <Section title="Flywheel">
        <NumField label="Speed fluctuation" unit="Cs" min={0.0005} max={0.5} step={0.005} value={e.cs} onChange={(v) => set({ cs: v })} title="(ωmax − ωmin)/ω" />
      </Section>
      <Section title="Results">
        <Kv rows={[
          ['Swept volume', `${f4(res.swept)} cm³`], ['Peak pressure', `${f4(res.peakPressure / 1000)} MPa`], ['Mean piston speed', `${f4(meanPistonSpeed(e))} m/s`],
          ['Work per cycle', `${f4(res.workPerCycle)} J`], ['IMEP', `${f4(res.imep)} kPa`], ['Mean torque', `${f4(res.meanTorque)} N·m`], ['Indicated power', `${f4(res.power)} kW`],
          ['Peak / min torque', `${f4(res.peakTorque)} / ${f4(res.minTorque)} N·m`], ['Energy fluctuation', `${f4(res.deltaE)} J`], ['Flywheel inertia', `${f4(res.flywheelI, 4)} kg·m²`],
        ]} />
        <div className="mc-actions">
          <button className="k-btn" onClick={() => { api.setPlot('pressure'); api.openDock() }}>Pressure plot</button>
          <button className="k-btn" onClick={() => { api.setPlot('enginetorque'); api.openDock() }}>Torque and flywheel</button>
          <button className="k-btn danger" onClick={() => shell.commit({ ...m, engine: undefined })}>Remove engine mode</button>
        </div>
      </Section>
    </>
  )
}

// ------------------------------------------------------------------------------ forces and dynamics

function ForcesPanel({ api }: { api: PanelApi }) {
  const { m, shell, cycle, fresh, dyn } = api
  const loads = m.loads ?? []
  const free = m.points.filter((p) => !p.ground)
  const setLoads = (l: PointLoad[]) => shell.commit({ ...m, loads: l.length ? l : undefined })
  const peak = useMemo(() => (fresh && cycle.ok && loads.length ? Math.max(...staticTorqueCurve(cycle, loads).map((v) => Math.abs(v ?? 0))) / 1000 : 0), [fresh, cycle, loads])
  const [mode, setMode] = useState<'speed' | 'torque'>('speed')
  const [value, setValue] = useState(m.driver?.rpm ?? 60)
  const [torque, setTorque] = useState(1)
  const [revs, setRevs] = useState(2)
  const [gravity, setGravity] = useState(false)
  const [flywheel, setFlywheel] = useState(0)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const { runDynamics } = await import('./dynamics')
      await new Promise((r) => setTimeout(r, 20))
      const d = runDynamics(m, { revs, mode, value: mode === 'speed' ? value : torque, rpm0: value, gravity, flywheel, output: m.output })
      api.setDyn(d)
      if (d.ok) { api.setPlot('dynamics'); api.openDock() } else shell.say(d.message ?? 'The dynamic model could not run.')
    } catch (e) {
      await os.dialog.alert(e instanceof Error ? e.message : String(e), { title: 'Dynamics' })
    } finally { setBusy(false) }
  }
  return (
    <>
      <Section title="Static forces (virtual work)">
        <div className="mc-hint">External forces on joints; kMech finds the input torque that balances them in every pose: T·δθ + ΣF·δp = 0.</div>
        {loads.map((l, i) => (
          <div key={i} className="mc-hint" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 22px', gap: 3, alignItems: 'center' }}>
            <select className="k-input" style={{ height: 24 }} value={l.point} aria-label="Joint" onChange={(e) => setLoads(loads.map((x, k) => (k === i ? { ...x, point: e.target.value } : x)))}>
              {free.map((p) => <option key={p.id} value={p.id}>{p.label || p.id}</option>)}
            </select>
            <NumField value={l.fx} onChange={(v) => setLoads(loads.map((x, k) => (k === i ? { ...x, fx: v } : x)))} unit="Fx" />
            <NumField value={l.fy} onChange={(v) => setLoads(loads.map((x, k) => (k === i ? { ...x, fy: v } : x)))} unit="Fy" />
            <button className="k-icon-btn" aria-label="Remove the load" onClick={() => setLoads(loads.filter((_, k) => k !== i))}><X size={12} /></button>
          </div>
        ))}
        <div className="mc-actions">
          <button className="k-btn" disabled={!free.length} onClick={() => setLoads([...loads, { point: (m.output && m.output.kind !== 'link' ? m.output.point : free[free.length - 1].id), fx: 0, fy: -100 }])}><Plus size={13} /> Add a load (N)</button>
          <button className="k-btn" disabled={!loads.length || !cycle.ok} onClick={() => { api.setPlot('static'); api.openDock() }}>Show the torque</button>
        </div>
        {loads.length > 0 && cycle.ok && <Kv rows={[['Peak input torque', `${f4(peak)} N·m`]]} />}
      </Section>
      <Section title="Dynamic model (planck rigid bodies)">
        <div className="mc-hint">The same mechanism built from bars and sliders with masses from the geometry and material, revolute and prismatic joints, a motor at the driver and optional gravity. It shows motion with inertia, the motor torque and the joint reaction forces.</div>
        <Seg label="Motor" value={mode} options={[{ id: 'speed', label: 'Constant speed' }, { id: 'torque', label: 'Constant torque' }]} onChange={(v) => setMode(v as 'speed' | 'torque')} />
        {mode === 'speed'
          ? <NumField label="Speed" unit="rpm" value={value} onChange={setValue} />
          : <><NumField label="Torque" unit="N·m" value={torque} onChange={setTorque} /><NumField label="Start speed" unit="rpm" value={value} onChange={setValue} /></>}
        <NumField label="Revolutions" min={0.25} max={20} value={revs} onChange={setRevs} />
        <NumField label="Flywheel" unit="kg·m²" min={0} value={flywheel} onChange={setFlywheel} title="Extra inertia on the driver shaft" />
        <Check label="Gravity (acts down the sheet)" checked={gravity} onChange={setGravity} />
        <div className="mc-actions"><button className="k-btn primary" disabled={busy || !m.driver} onClick={() => void run()}><Play size={13} /> {busy ? 'Running…' : 'Run'}</button></div>
        {dyn && !dyn.ok && <Note kind="error">{dyn.message}</Note>}
        {dyn?.ok && (
          <>
            <Kv rows={[
              ['Total mass', `${f4(dyn.totalMass)} kg`],
              ['Motor torque', `${f4(Math.min(...dyn.motorTorque))} … ${f4(Math.max(...dyn.motorTorque))} N·m`],
              ['Mean motor torque', `${f4(dyn.motorTorque.reduce((a, b) => a + b, 0) / dyn.motorTorque.length)} N·m`],
              ['Driver speed', `${f4(Math.min(...dyn.rpm))} … ${f4(Math.max(...dyn.rpm))} rpm`],
              ['Largest joint force', (() => { const j = [...dyn.joints].sort((a, b) => b.peak - a.peak)[0]; return j ? `${f4(j.peak)} N at ${j.name}` : '–' })()],
            ]} />
            <div className="mc-actions">
              <button className="k-btn" onClick={() => { api.setPlot('dynamics'); api.openDock() }}>Motion and torque</button>
              <button className="k-btn" onClick={() => { api.setPlot('joints'); api.openDock() }}>Joint forces</button>
            </div>
          </>
        )}
      </Section>
    </>
  )
}

// ------------------------------------------------------------------------------ synthesis

const FUNCTIONS: Array<{ id: string; label: string; f: (x: number) => number; x0: number; xn: number }> = [
  { id: 'sq', label: 'y = x²', f: (x) => x * x, x0: 1, xn: 2 },
  { id: 'sqrt', label: 'y = √x', f: Math.sqrt, x0: 1, xn: 4 },
  { id: 'inv', label: 'y = 1/x', f: (x) => 1 / x, x0: 1, xn: 2 },
  { id: 'log', label: 'y = ln x', f: Math.log, x0: 1, xn: 3 },
  { id: 'sin', label: 'y = sin x (x in °)', f: (x) => Math.sin(rad(x)), x0: 10, xn: 80 },
]

function SynthesisPanel({ api }: { api: PanelApi }) {
  const { shell } = api
  const [mode, setMode] = useState<'2' | '3' | 'fn'>('3')
  const [pos, setPos] = useState<CouplerPos[]>([{ x: 20, y: 80, angle: rad(10) }, { x: 70, y: 100, angle: rad(30) }, { x: 120, y: 90, angle: rad(55) }])
  const [aLoc, setALoc] = useState<Pt>({ x: 0, y: 0 })
  const [bLoc, setBLoc] = useState<Pt>({ x: 60, y: 0 })
  const [tA, setTA] = useState(0)
  const [tB, setTB] = useState(0)
  const [fnId, setFnId] = useState('sq')
  const [fnr, setFnr] = useState({ x0: 1, xn: 2, th0: 50, ths: 60, ph0: 60, phs: 90 })
  const set = (i: number, patch: Partial<CouplerPos>) => setPos((p) => p.map((q, k) => (k === i ? { ...q, ...patch } : q)))
  const design = useMemo(() => {
    if (mode === '2') return twoPositionSynthesis(pos[0], pos[1], aLoc, bLoc, tA, tB)
    if (mode === '3') return threePositionSynthesis([pos[0], pos[1], pos[2]], aLoc, bLoc)
    return null
  }, [mode, pos, aLoc, bLoc, tA, tB])
  const fn = FUNCTIONS.find((x) => x.id === fnId)!
  const gen = useMemo(() => (mode === 'fn' ? functionGenerator(fn.f, fnr.x0, fnr.xn, fnr.th0, fnr.ths, fnr.ph0, fnr.phs, 100) : null), [mode, fn, fnr])
  const make = async (doc: LinkageDoc) => { await shell.replace({ workbench: 'linkage', model: doc }) }
  const createFromDesign = () => {
    if (!design) return
    const ref = placeOn(pos[0], { x: 0, y: 0 })
    void make(fourBarFromDesign(design, mode === '2' ? 'Two-position four-bar' : 'Three-position four-bar', ref))
  }
  const createFromFunction = () => {
    if (!gen) return
    const th = rad(fnr.th0)
    const poses = [0, 1].map((b) => fourBarPose(gen.lengths, th, b as 0 | 1))
    const target = rad(fnr.ph0)
    const best = poses.map((p, i) => ({ p, i })).filter((x) => x.p).sort((a, b) => Math.abs(a.p!.th4 - target) - Math.abs(b.p!.th4 - target))[0]
    const up = best ? (poses[best.i]!.B.y >= (poses[1 - best.i]?.B.y ?? -Infinity)) : true
    void make(fourBarDoc(`Function generator ${fn.label}`, gen.lengths, fnr.th0, { up, coupler: [0.5, 0.4] }))
  }
  return (
    <>
      <Seg label="Kind of synthesis" value={mode} options={[{ id: '2', label: '2 positions' }, { id: '3', label: '3 positions' }, { id: 'fn', label: 'Function' }]} onChange={(v) => setMode(v as '2' | '3' | 'fn')} />
      {mode !== 'fn' ? (
        <>
          <div className="mc-hint">{mode === '2' ? 'Two coupler positions: each fixed pivot lies on the perpendicular bisector of the path of its moving pivot; slide it with the offsets.' : 'Three coupler positions: the fixed pivots are the centres of the circles through the three positions of each moving pivot (Burmester points).'}</div>
          <Section title="Coupler positions (reference point and angle)">
            {pos.slice(0, mode === '2' ? 2 : 3).map((p, i) => (
              <div key={i} className="mc-hint" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
                <NumField value={p.x} unit="x" onChange={(v) => set(i, { x: v })} />
                <NumField value={p.y} unit="y" onChange={(v) => set(i, { y: v })} />
                <NumField value={deg(p.angle)} unit="°" onChange={(v) => set(i, { angle: rad(v) })} />
              </div>
            ))}
          </Section>
          <Section title="Moving pivots on the coupler (in its own frame)">
            <div className="mc-hint" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
              <NumField value={aLoc.x} unit="Ax" onChange={(v) => setALoc({ ...aLoc, x: v })} /><NumField value={aLoc.y} unit="Ay" onChange={(v) => setALoc({ ...aLoc, y: v })} />
              <NumField value={bLoc.x} unit="Bx" onChange={(v) => setBLoc({ ...bLoc, x: v })} /><NumField value={bLoc.y} unit="By" onChange={(v) => setBLoc({ ...bLoc, y: v })} />
            </div>
            {mode === '2' && <><NumField label="Pivot O2 offset" unit="mm" value={tA} onChange={setTA} /><NumField label="Pivot O4 offset" unit="mm" value={tB} onChange={setTB} /></>}
          </Section>
          {design ? (
            <Section title="Result">
              <Kv rows={[
                ['Fixed pivots', `O2 (${f4(design.O2.x)}, ${f4(design.O2.y)})  O4 (${f4(design.O4.x)}, ${f4(design.O4.y)})`],
                ['Crank, coupler, output, frame', `${f4(design.lengths.a)}, ${f4(design.lengths.b)}, ${f4(design.lengths.c)}, ${f4(design.lengths.d)} mm`],
                ['Type', design.grashof.label],
                ['Transmission angle at the positions', design.mu.map((v) => `${f4(v, 3)}°`).join(', ')],
                ['Same assembly in every position', design.sameBranch ? <span className="mc-good" key="g">yes</span> : <span className="mc-badtxt" key="b">no (branch defect)</span>],
              ]} />
              {!design.sameBranch && <Note kind="warn">The positions are reached on different assembly circuits: the linkage would have to be taken apart to move between them. Try other pivot points.</Note>}
              <div className="mc-actions"><button className="k-btn primary" onClick={createFromDesign}>Create the mechanism</button></div>
            </Section>
          ) : <Note kind="warn">No four-bar from these inputs (coincident positions or collinear points).</Note>}
        </>
      ) : (
        <>
          <div className="mc-hint">Function generation by Freudenstein’s equation K1 cos φ − K2 cos θ + K3 = cos(θ − φ) at three Chebyshev precision points: the output angle φ follows y = f(x) while the input angle θ follows x.</div>
          <label className="mc-field"><span>Function</span>
            <select className="k-input" value={fnId} onChange={(e) => { const f = FUNCTIONS.find((x) => x.id === e.target.value)!; setFnId(f.id); setFnr((r) => ({ ...r, x0: f.x0, xn: f.xn })) }}>
              {FUNCTIONS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
          <NumField label="x from" value={fnr.x0} onChange={(v) => setFnr({ ...fnr, x0: v })} /><NumField label="x to" value={fnr.xn} onChange={(v) => setFnr({ ...fnr, xn: v })} />
          <NumField label="Input θ starts" unit="°" value={fnr.th0} onChange={(v) => setFnr({ ...fnr, th0: v })} /><NumField label="Input swing" unit="°" value={fnr.ths} onChange={(v) => setFnr({ ...fnr, ths: v })} />
          <NumField label="Output φ starts" unit="°" value={fnr.ph0} onChange={(v) => setFnr({ ...fnr, ph0: v })} /><NumField label="Output swing" unit="°" value={fnr.phs} onChange={(v) => setFnr({ ...fnr, phs: v })} />
          {gen ? (
            <Section title="Result (frame = 100 mm)">
              <Kv rows={[
                ['Input, coupler, output, frame', `${f4(gen.lengths.a)}, ${f4(gen.lengths.b)}, ${f4(gen.lengths.c)}, ${f4(gen.lengths.d)} mm`],
                ['Type', gen.grashof.label],
                ['Precision points x', gen.points.map((p) => f4(p.x, 4)).join(', ')],
                ['Largest error (structural)', `${f4(gen.maxError, 3)} in y (${f4((100 * gen.maxError) / Math.abs(fn.f(fnr.xn) - fn.f(fnr.x0)), 3)} % of its range)`],
              ]} />
              <div className="mc-actions"><button className="k-btn primary" onClick={createFromFunction}>Create the mechanism</button></div>
            </Section>
          ) : <Note kind="warn">These angle ranges make no four-bar (a K constant is not positive or a link would be imaginary). Try other ranges.</Note>}
        </>
      )}
    </>
  )
}
