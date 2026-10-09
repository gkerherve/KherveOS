// The side panels: Properties (what is selected: supports, loads, sections, plate edges), Model (analysis, units,
// materials, sections, mesh) and Results (view options, tables, checks, convergence study).

import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  deleteVertex, edit, moveVertex, removeLoad, setMemberProps, setNodeLoad, setNodePos, setSupport, supportKind, updateSupport, useMaterial, useSection, SUPPORT_NAMES, type SupportKind,
} from './editor'
import { MATERIAL_LIBRARY } from './materials'
import { ANALYSIS_NAMES, checkModel, isPlate, materialOf, memberLength, nextId, plateArea, sectionOf, type AnalysisType, type LoadDir, type MemberLoad, type Model, type PlateLoad, type Target } from './model'
import { SECTION_LIBRARY, SHAPE_NAMES, SHAPE_PARAMS, PARAM_NAMES, makeSection, customSection, type SectionShape } from './sections'
import { Check, Collapse, LineChart, NumField, Row, Select, type ChartPoint } from './Fields'
import { COLORMAPS, PLATE_FIELDS, extremes, plateField, type ColorMapName, type PlateField } from './post'
import type { MemberProbe, PlateProbe } from './post'
import { DEFAULT_RESULT, type ResultOptions } from './scene'
import { measure, type AnyResult } from './solve'
import { meshStats, type Mesh } from './mesh'
import { type StudyPoint, type StudyQuantity } from './plane'
import { FORCE_UNITS, LENGTH_UNITS, fmt, fromSI, label, show, type ForceUnit, type LengthUnit, type Quantity } from './units'

export type EditFn = (fn: (m: Model) => Model, what: string) => void

// ---------------------------------------------------------------------------- Properties

interface PropsPanel {
  model: Model
  sel: ReadonlySet<string>
  edit: EditFn
  onDelete(): void
}

const DIRS: Array<{ value: LoadDir; label: string }> = [
  { value: 'y', label: 'Global Y (up)' }, { value: 'x', label: 'Global X' }, { value: 'ly', label: 'Across the member' }, { value: 'lx', label: 'Along the member' },
]

const SUPPORT_OPTIONS = (Object.keys(SUPPORT_NAMES) as SupportKind[]).map((k) => ({ value: k, label: SUPPORT_NAMES[k] }))

export function PropertiesPanel({ model, sel, edit: change, onDelete }: PropsPanel) {
  const u = model.units
  if (model.plate) return <PlateProperties model={model} sel={sel} edit={change} onDelete={onDelete} />
  const nodes = model.nodes.filter((n) => sel.has(n.id))
  const members = model.members.filter((m) => sel.has(m.id))
  const problems = checkModel(model)
  if (!nodes.length && !members.length) {
    return (
      <div className="fe-body">
        <h3>{model.name}</h3>
        <p className="k-muted">{ANALYSIS_NAMES[model.analysis]}: {model.nodes.length} nodes, {model.members.length} members, {model.supports.length} supports, {model.nodeLoads.length + model.memberLoads.length} loads.</p>
        {problems.length ? (
          <ul className="fe-problems">{problems.map((p, i) => <li key={i} className={p.level}>{p.message}</li>)}</ul>
        ) : <p className="fe-ok">The model is complete: press Solve.</p>}
        <p className="k-muted fe-hint">Select a node or a member to edit its coordinates, support, loads, section and hinges. Double-click is not needed: click the Node tool to draw, the Member tool to join two nodes.</p>
      </div>
    )
  }
  const single = nodes.length === 1 && !members.length ? nodes[0] : null
  const sup = single ? model.supports.find((s) => s.node === single.id) : undefined
  const load = single ? model.nodeLoads.find((l) => l.node === single.id) : undefined
  return (
    <div className="fe-body">
      {nodes.length > 0 && (
        <>
          <div className="fe-head"><h3>{nodes.length === 1 ? `Node ${nodes[0].id}` : `${nodes.length} nodes`}</h3><button className="k-icon-btn" title="Delete (Del)" aria-label="Delete" onClick={onDelete}><Trash2 size={15} /></button></div>
          {single && (
            <>
              <Row label="x"><NumField value={single.x} q="length" units={u} onCommit={(v) => change((m) => setNodePos(m, single.id, v, single.y), 'Move node')} /></Row>
              <Row label="y"><NumField value={single.y} q="length" units={u} onCommit={(v) => change((m) => setNodePos(m, single.id, single.x, v), 'Move node')} /></Row>
            </>
          )}
          <Row label="Support">
            <Select value={supportKind(sup)} options={SUPPORT_OPTIONS} onChange={(k) => change((m) => nodes.reduce((acc, n) => setSupport(acc, n.id, k, sup?.ky), m), 'Support')} />
          </Row>
          {single && sup && (sup.ky || sup.kx || sup.kr) ? (
            <>
              {sup.ky !== undefined || (!sup.kx && !sup.kr) ? <Row label="Spring ky"><NumField value={sup.ky ?? 0} q="stiffness" units={u} onCommit={(v) => change((m) => updateSupport(m, single.id, { ky: v }), 'Spring')} /></Row> : null}
              <Row label="Spring kx"><NumField value={sup.kx ?? 0} q="stiffness" units={u} onCommit={(v) => change((m) => updateSupport(m, single.id, { kx: v }), 'Spring')} /></Row>
              <Row label="Spring kr"><NumField value={sup.kr ?? 0} q="rotStiffness" units={u} onCommit={(v) => change((m) => updateSupport(m, single.id, { kr: v }), 'Spring')} /></Row>
            </>
          ) : null}
          {single && sup && (sup.ux || sup.uy || sup.rz) ? (
            <Collapse title="Settlement" open={!!(sup.dx || sup.dy || sup.drz)}>
              {sup.ux ? <Row label="dx"><NumField value={sup.dx ?? 0} q="length" units={u} onCommit={(v) => change((m) => updateSupport(m, single.id, { dx: v }), 'Settlement')} /></Row> : null}
              {sup.uy ? <Row label="dy"><NumField value={sup.dy ?? 0} q="length" units={u} onCommit={(v) => change((m) => updateSupport(m, single.id, { dy: v }), 'Settlement')} /></Row> : null}
              {sup.rz ? <Row label="rotation"><NumField raw value={sup.drz ?? 0} q="angle" units={u} onCommit={(v) => change((m) => updateSupport(m, single.id, { drz: v }), 'Settlement')} /> <em>rad</em></Row> : null}
            </Collapse>
          ) : null}
          {single && (
            <Collapse title="Load on the node">
              <Row label="Fx"><NumField value={load?.fx ?? 0} q="force" units={u} onCommit={(v) => change((m) => setNodeLoad(m, single.id, v, load?.fy ?? 0, load?.mz ?? 0), 'Load')} /></Row>
              <Row label="Fy"><NumField value={load?.fy ?? 0} q="force" units={u} onCommit={(v) => change((m) => setNodeLoad(m, single.id, load?.fx ?? 0, v, load?.mz ?? 0), 'Load')} /></Row>
              <Row label="Mz"><NumField value={load?.mz ?? 0} q="moment" units={u} onCommit={(v) => change((m) => setNodeLoad(m, single.id, load?.fx ?? 0, load?.fy ?? 0, v), 'Load')} /></Row>
              <small className="k-muted">Fy is positive up: a weight is negative. Mz is positive counter-clockwise.</small>
            </Collapse>
          )}
        </>
      )}
      {members.length > 0 && <MemberProperties model={model} ids={members.map((m) => m.id)} edit={change} onDelete={onDelete} />}
    </div>
  )
}

function MemberProperties({ model, ids, edit: change, onDelete }: { model: Model; ids: string[]; edit: EditFn; onDelete(): void }) {
  const u = model.units
  const set = new Set(ids)
  const mem = model.members.find((m) => m.id === ids[0])!
  const sec = sectionOf(model, mem.section)
  const mat = materialOf(model, mem.material)
  const same = (f: (m: typeof mem) => unknown) => model.members.filter((m) => set.has(m.id)).every((m) => f(m) === f(mem))
  const single = ids.length === 1
  const truss = model.analysis === 'truss'
  const sectionOptions = useMemo(() => [
    ...model.sections.map((s) => ({ value: s.id, label: s.name, group: 'In this model' })),
    ...SECTION_LIBRARY.filter((s) => !model.sections.some((x) => x.id === s.id)).map((s) => ({ value: s.id, label: s.name, group: 'Library' })),
  ], [model.sections])
  const matOptions = useMemo(() => [
    ...model.materials.map((s) => ({ value: s.id, label: s.name, group: 'In this model' })),
    ...MATERIAL_LIBRARY.filter((s) => !model.materials.some((x) => x.id === s.id)).map((s) => ({ value: s.id, label: s.name, group: 'Library' })),
  ], [model.materials])
  const loads = model.memberLoads.filter((l) => l.member === mem.id)
  const addLoad = (type: MemberLoad['type']) => change((m) => edit(m, (c) => {
    const id = nextId('q', c.memberLoads.map((x) => x.id))
    const w = -defaultLine(u.force)
    if (type === 'dist') c.memberLoads.push({ id, member: mem.id, type: 'dist', dir: 'y', w1: w, w2: w })
    else if (type === 'point') c.memberLoads.push({ id, member: mem.id, type: 'point', dir: 'y', p: -defaultForce(u.force), a: memberLength(c, mem) / 2 })
    else c.memberLoads.push({ id, member: mem.id, type: 'thermal', dT: 20, dTg: 0 })
  }), 'Member load')
  return (
    <>
      <div className="fe-head"><h3>{single ? `Member ${mem.id}` : `${ids.length} members`}</h3><button className="k-icon-btn" title="Delete (Del)" aria-label="Delete" onClick={onDelete}><Trash2 size={15} /></button></div>
      {single && <p className="k-muted fe-line">{mem.n1} → {mem.n2}, length {show(memberLength(model, mem), 'length', u)}</p>}
      <Row label="Section"><Select value={same((m) => m.section) ? mem.section : ''} options={same((m) => m.section) ? sectionOptions : [{ value: '', label: '(mixed)' }, ...sectionOptions]} onChange={(v) => v && change((m) => setMemberProps(m, set, { section: v }), 'Section')} /></Row>
      {sec && single ? <p className="k-muted fe-line">A = {fmt(fromSI(sec.A, 'area', u), 4)} {label('area', u)}, I = {fmt(fromSI(sec.I, 'inertia', u), 4)} {label('inertia', u)}, Z = {fmt(sec.Z * fromSI(1, 'length', u) ** 3, 4)} {u.length}³</p> : null}
      <Row label="Material"><Select value={same((m) => m.material) ? mem.material : ''} options={same((m) => m.material) ? matOptions : [{ value: '', label: '(mixed)' }, ...matOptions]} onChange={(v) => v && change((m) => setMemberProps(m, set, { material: v }), 'Material')} /></Row>
      {mat && single ? <p className="k-muted fe-line">E = {show(mat.E, 'stress', u)}, yield {show(mat.sy, 'stress', u)}</p> : null}
      {!truss && (
        <>
          <Check checked={same((m) => !!m.releaseStart) && !!mem.releaseStart} onChange={(v) => change((m) => setMemberProps(m, set, { releaseStart: v }), 'Hinge')}>Hinge (moment released) at the start</Check>
          <Check checked={same((m) => !!m.releaseEnd) && !!mem.releaseEnd} onChange={(v) => change((m) => setMemberProps(m, set, { releaseEnd: v }), 'Hinge')}>Hinge (moment released) at the end</Check>
        </>
      )}
      {single && (
        <Collapse title="Loads on the member" extra={<span className="fe-adds"><button className="k-btn small" onClick={() => addLoad('dist')}><Plus size={12} /> Uniform</button><button className="k-btn small" onClick={() => addLoad('point')}><Plus size={12} /> Point</button><button className="k-btn small" onClick={() => addLoad('thermal')}><Plus size={12} /> Thermal</button></span>}>
          {loads.length === 0 ? <small className="k-muted">No load on this member.</small> : null}
          {loads.map((l) => <MemberLoadRow key={l.id} model={model} load={l} edit={change} />)}
        </Collapse>
      )}
    </>
  )
}

const defaultForce = (f: ForceUnit): number => (f === 'kip' ? 5000 : f === 'kN' ? 10000 : f === 'N' ? 1000 : 4448)
const defaultLine = (f: ForceUnit): number => defaultForce(f)

function MemberLoadRow({ model, load, edit: change }: { model: Model; load: MemberLoad; edit: EditFn }) {
  const u = model.units
  const patch = (p: Partial<MemberLoad>) => change((m) => edit(m, (c) => { const l = c.memberLoads.find((x) => x.id === load.id); if (l) Object.assign(l, p) }), 'Member load')
  return (
    <div className="fe-load">
      <div className="fe-load-head">
        <strong>{load.type === 'dist' ? 'Distributed' : load.type === 'point' ? 'Point' : 'Thermal'}</strong>
        <button className="k-icon-btn" aria-label="Remove load" title="Remove" onClick={() => change((m) => removeLoad(m, load.id), 'Remove load')}><Trash2 size={13} /></button>
      </div>
      {load.type !== 'thermal' && <Row label="Direction"><Select value={load.dir} options={DIRS} onChange={(dir) => patch({ dir })} /></Row>}
      {load.type === 'dist' && (
        <>
          <Row label="Start"><NumField value={load.w1} q="lineLoad" units={u} onCommit={(w1) => patch({ w1, w2: load.w1 === load.w2 ? w1 : load.w2 })} /></Row>
          <Row label="End"><NumField value={load.w2} q="lineLoad" units={u} onCommit={(w2) => patch({ w2 })} /></Row>
          <Row label="From"><NumField value={load.a ?? 0} q="length" units={u} onCommit={(a) => patch({ a })} /></Row>
          <Row label="To" hint="blank = the whole member"><NumField value={load.b ?? memberLength(model, model.members.find((m) => m.id === load.member)!)} q="length" units={u} onCommit={(b) => patch({ b })} /></Row>
        </>
      )}
      {load.type === 'point' && (
        <>
          <Row label="Force"><NumField value={load.p} q="force" units={u} onCommit={(p) => patch({ p })} /></Row>
          <Row label="At"><NumField value={load.a} q="length" units={u} onCommit={(a) => patch({ a })} /></Row>
        </>
      )}
      {load.type === 'thermal' && (
        <>
          <Row label="ΔT uniform"><NumField raw value={load.dT} q="temperature" units={u} onCommit={(dT) => patch({ dT })} /> <em>K</em></Row>
          <Row label="Gradient" hint="top minus bottom"><NumField raw value={load.dTg} q="temperature" units={u} onCommit={(dTg) => patch({ dTg })} /> <em>K</em></Row>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------- plates

function describeTarget(t: Target, u: Model['units']): string {
  switch (t.kind) {
    case 'edge': return `${t.loop === 0 ? 'outline' : `hole ${t.loop}`}, edge ${t.edge + 1}`
    case 'loop': return t.loop === 0 ? 'whole outline' : `whole hole ${t.loop}`
    case 'line': return `line (${fmt(fromSI(t.x1, 'length', u), 3)}, ${fmt(fromSI(t.y1, 'length', u), 3)}) – (${fmt(fromSI(t.x2, 'length', u), 3)}, ${fmt(fromSI(t.y2, 'length', u), 3)})`
    case 'circle': return `circle r = ${fmt(fromSI(t.r, 'length', u), 4)}`
    case 'vertex': return `${t.loop === 0 ? 'outline' : `hole ${t.loop}`}, corner ${t.vertex + 1}`
    default: return `point (${fmt(fromSI(t.x, 'length', u), 3)}, ${fmt(fromSI(t.y, 'length', u), 3)})`
  }
}

function describeSupport(ux: boolean, uy: boolean): string {
  return ux && uy ? 'fixed' : ux ? 'held in x (free to slide in y)' : uy ? 'held in y (free to slide in x)' : 'free'
}

function PlateProperties({ model, sel, edit: change, onDelete }: PropsPanel) {
  const u = model.units
  const plate = model.plate!
  const vertex = [...sel].map((s) => s.match(/^plate:v:(\d+):(\d+)$/)).find(Boolean)
  const edgeSel = [...sel].map((s) => s.match(/^plate:e:(\d+):(\d+)$/)).find(Boolean)
  const problems = checkModel(model)
  const loops = [plate.outline, ...plate.holes]
  return (
    <div className="fe-body">
      {vertex ? (() => {
        const loop = Number(vertex[1])
        const idx = Number(vertex[2])
        const p = loops[loop]?.[idx]
        if (!p) return null
        return (
          <>
            <div className="fe-head"><h3>{loop === 0 ? 'Outline' : `Hole ${loop}`}, corner {idx + 1}</h3><button className="k-icon-btn" title="Delete the corner" aria-label="Delete the corner" onClick={onDelete}><Trash2 size={15} /></button></div>
            <Row label="x"><NumField value={p.x} q="length" units={u} onCommit={(v) => change((m) => moveVertex(m, loop, idx, v, p.y), 'Move corner')} /></Row>
            <Row label="y"><NumField value={p.y} q="length" units={u} onCommit={(v) => change((m) => moveVertex(m, loop, idx, p.x, v), 'Move corner')} /></Row>
            <div className="fe-actions">
              <button className="k-btn small" onClick={() => change((m) => edit(m, (c) => { c.plate!.supports.push({ id: nextId('ps', c.plate!.supports.map((x) => x.id)), target: { kind: 'vertex', loop, vertex: idx }, ux: true, uy: true }) }), 'Support')}>Fix this corner</button>
              <button className="k-btn small" onClick={() => change((m) => edit(m, (c) => { c.plate!.loads.push({ id: nextId('pl', c.plate!.loads.map((x) => x.id)), type: 'point', target: { kind: 'vertex', loop, vertex: idx }, fx: 0, fy: -defaultForce(u.force) }) }), 'Load')}>Force on this corner</button>
            </div>
          </>
        )
      })() : edgeSel ? (() => {
        const loop = Number(edgeSel[1])
        const idx = Number(edgeSel[2])
        const lp = loops[loop]
        if (!lp?.[idx]) return null
        const a = lp[idx]
        const b = lp[(idx + 1) % lp.length]
        const target: Target = { kind: 'edge', loop, edge: idx }
        const addSupport = (ux: boolean, uy: boolean) => change((m) => edit(m, (c) => { c.plate!.supports.push({ id: nextId('ps', c.plate!.supports.map((x) => x.id)), target, ux, uy }) }), 'Support')
        const addLoad = (load: DistOmit<PlateLoad>) => change((m) => edit(m, (c) => { c.plate!.loads.push({ ...load, id: nextId('pl', c.plate!.loads.map((x) => x.id)) } as PlateLoad) }), 'Load')
        const f = defaultForce(u.force)
        return (
          <>
            <div className="fe-head"><h3>{loop === 0 ? 'Outline' : `Hole ${loop}`}, edge {idx + 1}</h3></div>
            <p className="k-muted fe-line">length {show(Math.hypot(b.x - a.x, b.y - a.y), 'length', u)}. Double-click an edge to add a corner on it.</p>
            <h4>Supports on this edge</h4>
            <div className="fe-actions">
              <button className="k-btn small" onClick={() => addSupport(true, true)}>Fixed</button>
              <button className="k-btn small" onClick={() => addSupport(true, false)} title="Symmetry plane x = const: the edge cannot move in x">Hold x</button>
              <button className="k-btn small" onClick={() => addSupport(false, true)} title="Symmetry plane y = const: the edge cannot move in y">Hold y</button>
            </div>
            <h4>Loads on this edge</h4>
            <div className="fe-actions">
              <button className="k-btn small" onClick={() => addLoad({ type: 'pressure', target, p: 1e6 })}>Pressure</button>
              <button className="k-btn small" onClick={() => addLoad({ type: 'traction', target, tx: 0, ty: 1e6 })}>Traction</button>
              <button className="k-btn small" onClick={() => addLoad({ type: 'edge-force', target, fx: 0, fy: -f })}>Total force</button>
            </div>
          </>
        )
      })() : (
        <>
          <h3>{model.name}</h3>
          {problems.length ? <ul className="fe-problems">{problems.map((p, i) => <li key={i} className={p.level}>{p.message}</li>)}</ul> : <p className="fe-ok">The model is complete: press Mesh or Solve.</p>}
          <p className="k-muted fe-line">Area {show(plateArea(plate), 'area', u)}, {plate.holes.length} hole{plate.holes.length === 1 ? '' : 's'}.</p>
          <p className="k-muted fe-hint">Click a corner or an edge to select it. Use the Support and Load tools, then click an edge. Drag a corner to move it.</p>
        </>
      )}
      <Collapse title={`Supports (${plate.supports.length})`} open={plate.supports.length > 0}>
        {plate.supports.length === 0 ? <small className="k-muted">None yet: the plate needs at least one.</small> : null}
        {plate.supports.map((s) => (
          <div key={s.id} className="fe-load">
            <div className="fe-load-head"><strong>{describeTarget(s.target, u)}</strong><button className="k-icon-btn" aria-label="Remove support" title="Remove" onClick={() => change((m) => removeLoad(m, s.id), 'Remove support')}><Trash2 size={13} /></button></div>
            <div className="fe-inline">
              <Check checked={s.ux} onChange={(v) => change((m) => edit(m, (c) => { const x = c.plate!.supports.find((q) => q.id === s.id); if (x) x.ux = v }), 'Support')}>hold x</Check>
              <Check checked={s.uy} onChange={(v) => change((m) => edit(m, (c) => { const x = c.plate!.supports.find((q) => q.id === s.id); if (x) x.uy = v }), 'Support')}>hold y</Check>
            </div>
            <small className="k-muted">{describeSupport(s.ux, s.uy)}</small>
          </div>
        ))}
      </Collapse>
      <Collapse title={`Loads (${plate.loads.length})`} open={plate.loads.length > 0}>
        {plate.loads.length === 0 ? <small className="k-muted">None yet.</small> : null}
        {plate.loads.map((l) => <PlateLoadRow key={l.id} model={model} load={l} edit={change} />)}
        <div className="fe-actions"><button className="k-btn small" onClick={() => change((m) => edit(m, (c) => { c.plate!.loads.push({ id: nextId('pl', c.plate!.loads.map((x) => x.id)), type: 'thermal', dT: 50 }) }), 'Thermal load')}><Plus size={12} /> Temperature change</button></div>
      </Collapse>
    </div>
  )
}

type DistOmit<T> = T extends unknown ? Omit<T, 'id'> : never

function PlateLoadRow({ model, load, edit: change }: { model: Model; load: PlateLoad; edit: EditFn }) {
  const u = model.units
  const patch = (p: Record<string, number>) => change((m) => edit(m, (c) => { const l = c.plate!.loads.find((x) => x.id === load.id); if (l) Object.assign(l, p) }), 'Load')
  return (
    <div className="fe-load">
      <div className="fe-load-head">
        <strong>{load.type === 'thermal' ? 'Temperature change' : `${{ pressure: 'Pressure', traction: 'Traction', 'edge-force': 'Total force', point: 'Point force' }[load.type]} · ${describeTarget(load.target, u)}`}</strong>
        <button className="k-icon-btn" aria-label="Remove load" title="Remove" onClick={() => change((m) => removeLoad(m, load.id), 'Remove load')}><Trash2 size={13} /></button>
      </div>
      {load.type === 'pressure' && <Row label="Pressure" hint="positive pushes into the plate"><NumField value={load.p} q="stress" units={u} onCommit={(p) => patch({ p })} /></Row>}
      {load.type === 'traction' && (
        <>
          <Row label="tx"><NumField value={load.tx} q="stress" units={u} onCommit={(tx) => patch({ tx })} /></Row>
          <Row label="ty"><NumField value={load.ty} q="stress" units={u} onCommit={(ty) => patch({ ty })} /></Row>
        </>
      )}
      {(load.type === 'edge-force' || load.type === 'point') && (
        <>
          <Row label="Fx"><NumField value={load.fx} q="force" units={u} onCommit={(fx) => patch({ fx })} /></Row>
          <Row label="Fy"><NumField value={load.fy} q="force" units={u} onCommit={(fy) => patch({ fy })} /></Row>
        </>
      )}
      {load.type === 'thermal' && <Row label="ΔT"><NumField raw value={load.dT} q="temperature" units={u} onCommit={(dT) => patch({ dT })} /> <em>K</em></Row>}
    </div>
  )
}

// ---------------------------------------------------------------------------- Model

interface ModelPanelProps {
  model: Model
  edit: EditFn
  mesh: Mesh | null
  onAnalysis(a: AnalysisType): void
  onMesh(): void
  meshing: boolean
}

const ANALYSIS_OPTIONS = (Object.keys(ANALYSIS_NAMES) as AnalysisType[]).map((a) => ({ value: a, label: ANALYSIS_NAMES[a] }))

export function ModelPanel({ model, edit: change, mesh, onAnalysis, onMesh, meshing }: ModelPanelProps) {
  const u = model.units
  const [matId, setMatId] = useState(model.materials[0]?.id ?? '')
  const [secId, setSecId] = useState(model.sections[0]?.id ?? '')
  const [shape, setShape] = useState<SectionShape>('rect')
  const mat = model.materials.find((m) => m.id === matId) ?? model.materials[0]
  const sec = model.sections.find((s) => s.id === secId) ?? model.sections[0]
  const plate = model.plate
  const patchMat = (p: Partial<NonNullable<typeof mat>>) => change((m) => edit(m, (c) => { const x = c.materials.find((q) => q.id === mat.id); if (x) Object.assign(x, p) }), 'Material')
  const usedMat = (id: string) => model.members.some((x) => x.material === id) || plate?.material === id
  const usedSec = (id: string) => model.members.some((x) => x.section === id)
  return (
    <div className="fe-body">
      <Collapse title="Analysis and units">
        <Row label="Analysis"><Select value={model.analysis} options={ANALYSIS_OPTIONS} onChange={onAnalysis} /></Row>
        {!isPlate(model.analysis) && (
          <Row label="Compute">
            <Select value={model.study} options={[{ value: 'static', label: 'Static: displacements, forces' }, { value: 'modal', label: 'Natural frequencies' }, { value: 'buckling', label: 'Buckling loads' }]} onChange={(study) => change((m) => edit(m, (c) => { c.study = study }), 'Study')} />
          </Row>
        )}
        <Row label="Length"><Select value={u.length} options={LENGTH_UNITS.map((l) => ({ value: l, label: l }))} onChange={(length: LengthUnit) => change((m) => edit(m, (c) => { c.units.length = length }), 'Units')} /></Row>
        <Row label="Force"><Select value={u.force} options={FORCE_UNITS.map((f) => ({ value: f, label: f }))} onChange={(force: ForceUnit) => change((m) => edit(m, (c) => { c.units.force = force }), 'Units')} /></Row>
        <small className="k-muted">Stress is in {label('stress', u)}. The file always stores SI units, so changing units never changes the model.</small>
        <Row label="Gravity" hint="m/s², 0 = none (self weight)"><NumField raw value={model.gravity} q="none" units={u} onCommit={(g) => change((m) => edit(m, (c) => { c.gravity = Math.max(0, g) }), 'Gravity')} /></Row>
      </Collapse>
      {plate && (
        <Collapse title="Plate and mesh">
          <Row label="Thickness"><NumField value={plate.thickness} q="length" units={u} min={1e-12} onCommit={(v) => change((m) => edit(m, (c) => { c.plate!.thickness = v }), 'Thickness')} /></Row>
          <Row label="Material"><Select value={plate.material} options={[...model.materials.map((x) => ({ value: x.id, label: x.name, group: 'In this model' })), ...MATERIAL_LIBRARY.filter((x) => !model.materials.some((q) => q.id === x.id)).map((x) => ({ value: x.id, label: x.name, group: 'Library' }))]} onChange={(id) => change((m) => edit(m, (c) => { c.plate!.material = useMaterial(c, id) }), 'Material')} /></Row>
          <Row label="Element size"><NumField value={plate.mesh.size} q="length" units={u} min={1e-12} onCommit={(v) => change((m) => edit(m, (c) => { c.plate!.mesh.size = v }), 'Mesh size')} /></Row>
          <Row label="Elements"><Select value={plate.mesh.type} options={[{ value: 'tri', label: 'Triangles (CST)' }, { value: 'quad', label: 'Quadrilaterals (Q4)' }]} onChange={(t) => change((m) => edit(m, (c) => { c.plate!.mesh.type = t }), 'Element type')} /></Row>
          <Row label="Near holes" hint="size factor, 1 = same as elsewhere"><NumField raw value={plate.mesh.holeFactor} q="none" units={u} min={0.02} onCommit={(v) => change((m) => edit(m, (c) => { c.plate!.mesh.holeFactor = Math.min(1, v) }), 'Mesh')} /></Row>
          <Check checked={plate.mesh.structured} disabled={plate.outline.length !== 4 || plate.holes.length > 0} onChange={(v) => change((m) => edit(m, (c) => { c.plate!.mesh.structured = v }), 'Mesh')}>Regular grid (four-sided plate without holes)</Check>
          <Row label="Smoothing"><NumField raw value={plate.mesh.smooth} q="none" units={u} min={0} onCommit={(v) => change((m) => edit(m, (c) => { c.plate!.mesh.smooth = Math.round(Math.min(40, v)) }), 'Mesh')} /></Row>
          {plate.mesh.refine.length > 0 && (
            <>
              <h4>Refinement points</h4>
              {plate.mesh.refine.map((r, i) => (
                <div key={i} className="fe-load">
                  <div className="fe-load-head"><strong>({fmt(fromSI(r.x, 'length', u), 3)}, {fmt(fromSI(r.y, 'length', u), 3)})</strong><button className="k-icon-btn" aria-label="Remove" onClick={() => change((m) => edit(m, (c) => { c.plate!.mesh.refine.splice(i, 1) }), 'Mesh')}><Trash2 size={13} /></button></div>
                  <Row label="size"><NumField value={r.size} q="length" units={u} min={1e-12} onCommit={(v) => change((m) => edit(m, (c) => { c.plate!.mesh.refine[i].size = v }), 'Mesh')} /></Row>
                </div>
              ))}
            </>
          )}
          <div className="fe-actions"><button className="k-btn" disabled={meshing || plate.outline.length < 3} onClick={onMesh}>{mesh ? 'Mesh again' : 'Generate the mesh'}</button></div>
          {mesh && <MeshStats mesh={mesh} />}
        </Collapse>
      )}
      <Collapse title="Materials" open={!plate}>
        {model.materials.length > 0 && mat && (
          <>
            <Row label="Material"><Select value={mat.id} options={model.materials.map((x) => ({ value: x.id, label: x.name }))} onChange={setMatId} /></Row>
            <Row label="Name"><input className="k-input" value={mat.name} onChange={(e) => patchMat({ name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></Row>
            <Row label="E (Young)"><NumField value={mat.E} q="modulus" units={u} min={1} onCommit={(E) => patchMat({ E })} /></Row>
            <Row label="ν (Poisson)"><NumField raw value={mat.nu} q="none" units={u} onCommit={(nu) => nu > -1 && nu < 0.5 && patchMat({ nu })} /></Row>
            <Row label="Density"><NumField raw value={mat.rho} q="density" units={u} min={0} onCommit={(rho) => patchMat({ rho })} /> <em>kg/m³</em></Row>
            <Row label="Yield"><NumField value={mat.sy} q="stress" units={u} min={1} onCommit={(sy) => patchMat({ sy })} /></Row>
            <Row label="α expansion"><NumField raw value={mat.alpha} q="none" units={u} onCommit={(alpha) => patchMat({ alpha })} /> <em>1/K</em></Row>
            <div className="fe-actions">
              <button className="k-btn small" disabled={usedMat(mat.id) || model.materials.length < 2} title={usedMat(mat.id) ? 'In use' : ''} onClick={() => { change((m) => edit(m, (c) => { c.materials = c.materials.filter((x) => x.id !== mat.id) }), 'Remove material'); setMatId(model.materials.find((x) => x.id !== mat.id)?.id ?? '') }}>Remove</button>
              <button className="k-btn small" onClick={() => { const id = nextId('MAT', model.materials.map((x) => x.id)); change((m) => edit(m, (c) => { c.materials.push({ ...mat, id, name: `${mat.name} (copy)` }) }), 'Add material'); setMatId(id) }}>Duplicate</button>
            </div>
          </>
        )}
        <Row label="Add from library">
          <Select value="" options={[{ value: '', label: 'Choose…' }, ...MATERIAL_LIBRARY.filter((x) => !model.materials.some((q) => q.id === x.id)).map((x) => ({ value: x.id, label: x.name }))]} onChange={(id) => { if (id) { change((m) => edit(m, (c) => { useMaterial(c, id) }), 'Add material'); setMatId(id) } }} />
        </Row>
      </Collapse>
      {!plate && (
        <Collapse title="Sections" open={false}>
          {sec && (
            <>
              <Row label="Section"><Select value={sec.id} options={model.sections.map((x) => ({ value: x.id, label: x.name }))} onChange={setSecId} /></Row>
              <p className="k-muted fe-line">A = {fmt(fromSI(sec.A, 'area', u), 5)} {label('area', u)} · I = {fmt(fromSI(sec.I, 'inertia', u), 5)} {label('inertia', u)} · Z = {fmt(sec.Z * fromSI(1, 'length', u) ** 3, 5)} {u.length}³ · depth {show(sec.h, 'length', u)}</p>
              <div className="fe-actions"><button className="k-btn small" disabled={usedSec(sec.id) || model.sections.length < 2} onClick={() => { change((m) => edit(m, (c) => { c.sections = c.sections.filter((x) => x.id !== sec.id) }), 'Remove section'); setSecId(model.sections.find((x) => x.id !== sec.id)?.id ?? '') }}>Remove</button></div>
            </>
          )}
          <Row label="Add standard">
            <Select value="" options={[{ value: '', label: 'Choose…' }, ...SECTION_LIBRARY.filter((x) => !model.sections.some((q) => q.id === x.id)).map((x) => ({ value: x.id, label: x.name, group: x.id.startsWith('IPE') ? 'IPE' : x.id.startsWith('HEA') ? 'HEA' : x.id.startsWith('HEB') ? 'HEB' : x.id.startsWith('UPN') ? 'UPN channels' : x.id.startsWith('L') ? 'Angles' : 'Plain shapes' }))]} onChange={(id) => { if (id) { change((m) => edit(m, (c) => { useSection(c, id) }), 'Add section'); setSecId(id) } }} />
          </Row>
          <NewSection model={model} shape={shape} setShape={setShape} onAdd={(s) => { change((m) => edit(m, (c) => { c.sections.push(s) }), 'Add section'); setSecId(s.id) }} />
        </Collapse>
      )}
    </div>
  )
}

function NewSection({ model, shape, setShape, onAdd }: { model: Model; shape: SectionShape; setShape(s: SectionShape): void; onAdd(s: ReturnType<typeof makeSection>): void }) {
  const u = model.units
  const [vals, setVals] = useState<Record<string, number>>({})
  const names = shape === 'custom' ? ['A', 'I'] : SHAPE_PARAMS[shape]
  const get = (k: string) => vals[`${shape}.${k}`] ?? 0
  const [error, setError] = useState('')
  const add = () => {
    try {
      const id = nextId('SEC', model.sections.map((x) => x.id))
      if (shape === 'custom') onAdd(customSection(id, `Custom ${id}`, get('A'), get('I')))
      else onAdd(makeSection(id, `${SHAPE_NAMES[shape]} ${names.map((k) => fmt(fromSI(get(k), 'length', u), 3)).join('×')} ${u.length}`, shape, Object.fromEntries(names.map((k) => [k, get(k)]))))
      setError('')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  return (
    <div className="fe-newsec">
      <h4>New section</h4>
      <Row label="Shape"><Select value={shape} options={(Object.keys(SHAPE_NAMES) as SectionShape[]).map((s) => ({ value: s, label: SHAPE_NAMES[s] }))} onChange={setShape} /></Row>
      {names.map((k) => (
        <Row key={`${shape}.${k}`} label={shape === 'custom' ? (k === 'A' ? 'Area A' : 'Inertia I') : PARAM_NAMES[k] ?? k}>
          <NumField value={get(k)} q={shape === 'custom' ? (k === 'A' ? 'area' : 'inertia') : 'length'} units={u} onCommit={(v) => setVals((s) => ({ ...s, [`${shape}.${k}`]: v }))} />
        </Row>
      ))}
      {error ? <p className="k-error fe-line">{error}</p> : null}
      <div className="fe-actions"><button className="k-btn small" onClick={add}><Plus size={12} /> Add the section</button></div>
    </div>
  )
}

function MeshStats({ mesh }: { mesh: Mesh }) {
  const s = meshStats(mesh)
  const max = Math.max(1, ...s.histogram)
  return (
    <div className="fe-stats">
      <table className="fe-kv"><tbody>
        <tr><th>Elements</th><td>{s.elements} {s.type === 'tri' ? 'triangles' : 'quadrilaterals'}</td></tr>
        <tr><th>Nodes / DOFs</th><td>{s.nodes} / {s.dofs}</td></tr>
        <tr><th>Angles</th><td>{fmt(s.minAngle, 3)}° to {fmt(s.maxAngle, 3)}°</td></tr>
        <tr><th>Quality</th><td>mean {fmt(s.meanQuality, 3)}, worst {fmt(s.minQuality, 3)}</td></tr>
      </tbody></table>
      <div className="fe-hist" role="img" aria-label="Number of elements for each tenth of quality">
        {s.histogram.map((h, i) => <span key={i} title={`quality ${i / 10}–${(i + 1) / 10}: ${h}`} style={{ height: `${Math.max(2, (h / max) * 100)}%` }} />)}
      </div>
      <small className="k-muted">Element quality from 0 (flat) to 1 (perfect), in tenths.</small>
    </div>
  )
}

// ---------------------------------------------------------------------------- Results

interface ResultsProps {
  model: Model
  result: AnyResult | null
  stale: boolean
  error: string | null
  warnings: string[]
  ro: ResultOptions
  setRo(patch: Partial<ResultOptions>): void
  onSolve(): void
  probe: { plate?: PlateProbe; member?: MemberProbe } | null
  study: { points: StudyPoint[]; quantity: StudyQuantity; running: boolean } | null
  onStudy(q: StudyQuantity): void
  onCsv(): void
  onReport(kind: 'md' | 'html'): void
  onImage(kind: 'png' | 'svg'): void
  animate: boolean
  setAnimate(v: boolean): void
}

const STUDY_OPTIONS: Array<{ value: StudyQuantity; label: string }> = [
  { value: 'maxVm', label: 'Peak von Mises stress' }, { value: 'maxSx', label: 'Peak σx' }, { value: 'maxSy', label: 'Peak σy' }, { value: 'maxDisp', label: 'Maximum displacement' }, { value: 'energy', label: 'Strain energy' },
]

const CMAPS = (Object.keys(COLORMAPS) as ColorMapName[]).map((c) => ({ value: c, label: COLORMAPS[c] }))

export function ResultsPanel(p: ResultsProps) {
  const { model, result, ro } = p
  const u = model.units
  const plate = result?.kind === 'plane' ? result : null
  const frame = result?.kind === 'frame' ? result : null
  const [studyQ, setStudyQ] = useState<StudyQuantity>('maxVm')
  const checks = useMemo(() => {
    if (!result || !model.expected) return []
    const rows: Array<{ key: string; expected: number; got: number }> = []
    for (const [key, expected] of Object.entries(model.expected)) {
      try { rows.push({ key, expected, got: measure(model, result, key) }) } catch { /* not for this result */ }
    }
    return rows
  }, [model, result])
  return (
    <div className="fe-body">
      <div className="fe-actions">
        <button className="k-btn primary" onClick={p.onSolve}>{result ? 'Solve again' : 'Solve'}</button>
        {result && <button className="k-btn small" onClick={p.onCsv}>CSV</button>}
        {result && <button className="k-btn small" onClick={() => p.onReport('html')}>Report</button>}
      </div>
      {p.error && <div className="fe-error" role="alert">{p.error}</div>}
      {p.warnings.map((w, i) => <div key={i} className="fe-warn">{w}</div>)}
      {!result && !p.error && <p className="k-muted">No results yet. Press Solve (⌘R) to run the analysis.</p>}
      {result && p.stale && <div className="fe-warn">The model changed after this solution: solve again.</div>}
      {result && (
        <>
          {frame && (
            <Collapse title="Show">
              <Row label="View"><Select value={ro.kind === 'diagram' ? `diagram-${ro.diagram}` : ro.kind === 'none' ? 'deformed' : ro.kind} options={[{ value: 'deformed', label: 'Deformed shape' }, { value: 'diagram-N', label: 'Axial force N' }, { value: 'diagram-V', label: 'Shear force V' }, { value: 'diagram-M', label: 'Bending moment M' }]}
                onChange={(v) => v === 'deformed' ? p.setRo({ kind: 'deformed' }) : p.setRo({ kind: 'diagram', diagram: v.slice(-1) as 'N' | 'V' | 'M' })} /></Row>
              {ro.kind !== 'diagram' && <Row label="Scale ×" hint="displacement magnification"><NumField raw value={ro.scale} q="none" units={u} min={0} onCommit={(scale) => p.setRo({ scale })} /></Row>}
              <Check checked={ro.reactions} onChange={(reactions) => p.setRo({ reactions })}>Reaction forces</Check>
              <Check checked={ro.labels} onChange={(labels) => p.setRo({ labels })}>Values on the drawing</Check>
            </Collapse>
          )}
          {plate && (
            <Collapse title="Show">
              <Row label="View"><Select value={ro.kind === 'deformed' ? 'deformed' : 'contour'} options={[{ value: 'contour', label: 'Colour map' }, { value: 'deformed', label: 'Deformed mesh' }]} onChange={(v) => p.setRo({ kind: v })} /></Row>
              <Row label="Field"><Select value={ro.field} options={PLATE_FIELDS.map((f) => ({ value: f.id, label: f.label }))} onChange={(field: PlateField) => p.setRo({ field, kind: 'contour' })} /></Row>
              <Row label="Values"><Select value={ro.nodalMode} options={[{ value: 'nodal', label: 'Smooth (nodal average)' }, { value: 'element', label: 'Element by element' }]} onChange={(nodalMode) => p.setRo({ nodalMode })} /></Row>
              <Row label="Colours"><Select value={ro.cmap} options={CMAPS} onChange={(cmap) => p.setRo({ cmap })} /></Row>
              <Row label="Bands" hint="0 = continuous"><NumField raw value={ro.bands} q="none" units={u} min={0} onCommit={(v) => p.setRo({ bands: Math.round(Math.min(32, v)) })} /></Row>
              <Row label="Scale ×" hint="displacement magnification"><NumField raw value={ro.scale} q="none" units={u} min={0} onCommit={(scale) => p.setRo({ scale })} /></Row>
              <Check checked={ro.minmax} onChange={(minmax) => p.setRo({ minmax })}>Mark the maximum and minimum</Check>
              <Check checked={ro.principal} onChange={(principal) => p.setRo({ principal })}>Principal stress directions</Check>
              <Check checked={ro.undeformed} onChange={(undeformed) => p.setRo({ undeformed })}>Undeformed outline</Check>
            </Collapse>
          )}
          {(result.kind === 'modal' || result.kind === 'buckling') && (
            <Collapse title="Modes">
              {result.modes.map((m, i) => (
                <button key={i} className={`fe-mode${ro.modeIndex === i ? ' on' : ''}`} onClick={() => p.setRo({ modeIndex: i, kind: 'mode' })}>
                  <span>{i + 1}</span>{result.kind === 'modal' ? `${fmt((m as { frequency: number }).frequency, 5)} Hz` : `load factor ${fmt((m as { factor: number }).factor, 5)}`}
                </button>
              ))}
              <Row label="Amplitude"><NumField raw value={ro.scale} q="none" units={u} min={0} onCommit={(scale) => p.setRo({ scale })} /></Row>
              <Check checked={p.animate} onChange={p.setAnimate}>Animate</Check>
            </Collapse>
          )}
          <Collapse title="Numbers">
            <ResultNumbers model={model} result={result} />
          </Collapse>
          {p.probe && (
            <Collapse title="Probe">
              {p.probe.plate && <ProbeTable model={model} probe={p.probe.plate} />}
              {p.probe.member && (
                <table className="fe-kv"><tbody>
                  <tr><th>Member</th><td>{p.probe.member.member} at {show(p.probe.member.x, 'length', u)}</td></tr>
                  <tr><th>N</th><td>{show(p.probe.member.N, 'force', u)}</td></tr>
                  <tr><th>V</th><td>{show(p.probe.member.V, 'force', u)}</td></tr>
                  <tr><th>M</th><td>{show(p.probe.member.M, 'moment', u)}</td></tr>
                  <tr><th>Stress</th><td>{show(p.probe.member.stress, 'stress', u)}</td></tr>
                </tbody></table>
              )}
            </Collapse>
          )}
          {checks.length > 0 && (
            <Collapse title="Check against the expected values">
              <table className="fe-kv"><thead><tr><th>Quantity</th><td>expected</td><td>computed</td></tr></thead><tbody>
                {checks.map((c) => <tr key={c.key}><th>{c.key}</th><td>{fmt(c.expected, 5)}</td><td className={Math.abs(c.got / (c.expected || 1) - 1) < 0.05 || Math.abs(c.got - c.expected) < 1e-9 ? 'fe-good' : 'fe-off'}>{fmt(c.got, 5)}</td></tr>)}
              </tbody></table>
              <small className="k-muted">SI units (m, N, Pa, rad).</small>
            </Collapse>
          )}
          {plate && (
            <Collapse title="Convergence study" open={false}>
              <small className="k-muted">Solves again with smaller elements and plots a result against the number of degrees of freedom: when the curve flattens, the mesh is fine enough.</small>
              <Row label="Result"><Select<StudyQuantity> value={studyQ} options={STUDY_OPTIONS} onChange={setStudyQ} /></Row>
              <div className="fe-actions"><button className="k-btn small" disabled={p.study?.running} onClick={() => p.onStudy(studyQ)}>{p.study?.running ? 'Running…' : 'Run the study'}</button></div>
              {p.study && p.study.points.length > 0 && (() => {
                const pts: ChartPoint[] = p.study.points.map((x) => ({ x: x.dofs, y: fromSI(x.value, p.study!.quantity === 'energy' ? 'moment' : p.study!.quantity === 'maxDisp' ? 'length' : 'stress', u) }))
                return (
                  <>
                    <LineChart points={pts} xLabel="degrees of freedom" yLabel={STUDY_OPTIONS.find((o) => o.value === p.study!.quantity)?.label ?? ''} />
                    <table className="fe-kv"><thead><tr><th>Size</th><td>DOFs</td><td>Value</td></tr></thead><tbody>
                      {p.study.points.map((x, i) => <tr key={i}><th>{fmt(fromSI(x.size, 'length', u), 3)}</th><td>{x.dofs}</td><td>{fmt(pts[i].y, 5)}</td></tr>)}
                    </tbody></table>
                  </>
                )
              })()}
            </Collapse>
          )}
          <Collapse title="Export" open={false}>
            <div className="fe-actions">
              <button className="k-btn small" onClick={() => p.onImage('png')}>Picture (PNG)</button>
              <button className="k-btn small" onClick={() => p.onImage('svg')}>Picture (SVG)</button>
              <button className="k-btn small" onClick={p.onCsv}>Results (CSV)</button>
              <button className="k-btn small" onClick={() => p.onReport('md')}>Report (Markdown)</button>
              <button className="k-btn small" onClick={() => p.onReport('html')}>Report (HTML)</button>
            </div>
          </Collapse>
        </>
      )}
    </div>
  )
}

function ResultNumbers({ model, result }: { model: Model; result: AnyResult }) {
  const u = model.units
  if (result.kind === 'frame') {
    return (
      <>
        <table className="fe-kv"><tbody>
          <tr><th>Largest displacement</th><td>{show(result.maxDisp, 'length', u)}</td></tr>
          <tr><th>Largest stress</th><td>{show(result.maxStress, 'stress', u)}</td></tr>
          <tr><th>Safety factor</th><td>{Number.isFinite(result.safety) ? fmt(result.safety, 3) : '∞'}</td></tr>
          <tr><th>Solver</th><td>{result.solve.method}, residual {result.solve.residual.toExponential(0)}</td></tr>
        </tbody></table>
        <h4>Reactions</h4>
        <table className="fe-kv"><thead><tr><th>Node</th><td>Rx</td><td>Ry</td><td>M</td></tr></thead><tbody>
          {result.reactions.map((r) => <tr key={r.node}><th>{r.node}</th><td>{fmt(fromSI(r.rx, 'force', u), 4)}</td><td>{fmt(fromSI(r.ry, 'force', u), 4)}</td><td>{fmt(fromSI(r.mz, 'moment', u), 4)}</td></tr>)}
        </tbody></table>
        <small className="k-muted">{label('force', u)}, moments in {label('moment', u)}</small>
        <h4>Members</h4>
        <table className="fe-kv"><thead><tr><th>Member</th><td>N</td><td>max |M|</td><td>σ max</td><td>SF</td></tr></thead><tbody>
          {result.members.map((m) => <tr key={m.id}><th>{m.id}</th><td>{fmt(fromSI(Math.abs(m.N1) > Math.abs(m.N2) ? m.N1 : m.N2, 'force', u), 4)}</td><td>{fmt(fromSI(m.maxM, 'moment', u), 4)}</td><td>{fmt(fromSI(m.maxStress, 'stress', u), 4)}</td><td>{Number.isFinite(m.safety) ? fmt(m.safety, 3) : '∞'}</td></tr>)}
        </tbody></table>
        <small className="k-muted">N tension positive · stress in {label('stress', u)} · SF = yield / stress</small>
      </>
    )
  }
  if (result.kind === 'plane') {
    return (
      <>
        <table className="fe-kv"><tbody>
          <tr><th>Elements</th><td>{result.mesh.nElems} ({result.mesh.type === 'tri' ? 'triangles' : 'quads'})</td></tr>
          <tr><th>Largest displacement</th><td>{show(result.maxDisp, 'length', u)}</td></tr>
          <tr><th>Largest von Mises</th><td>{show(result.maxVm, 'stress', u)}</td></tr>
          <tr><th>Safety factor</th><td>{Number.isFinite(result.safety) ? fmt(result.safety, 3) : '∞'}</td></tr>
          <tr><th>Strain energy</th><td>{show(result.strainEnergy, 'moment', u)}</td></tr>
        </tbody></table>
        <h4>Extremes (nodal)</h4>
        <table className="fe-kv"><thead><tr><th>Field</th><td>min</td><td>max</td></tr></thead><tbody>
          {PLATE_FIELDS.filter((f) => ['vm', 'sx', 'sy', 'txy', 'p1', 'p2'].includes(f.id)).map((f) => { const e = extremes(plateField(result, f.id, 'nodal')); return <tr key={f.id}><th>{f.short}</th><td>{fmt(fromSI(e.min, f.quantity as Quantity, u), 4)}</td><td>{fmt(fromSI(e.max, f.quantity as Quantity, u), 4)}</td></tr> })}
        </tbody></table>
        <small className="k-muted">{label('stress', u)}</small>
      </>
    )
  }
  if (result.kind === 'modal') {
    return (
      <table className="fe-kv"><thead><tr><th>Mode</th><td>f (Hz)</td><td>ω (rad/s)</td><td>T (s)</td></tr></thead><tbody>
        {result.modes.map((m, i) => <tr key={i}><th>{i + 1}</th><td>{fmt(m.frequency, 6)}</td><td>{fmt(m.omega, 6)}</td><td>{fmt(m.period, 4)}</td></tr>)}
      </tbody></table>
    )
  }
  return (
    <>
      <table className="fe-kv"><thead><tr><th>Mode</th><td>load factor</td></tr></thead><tbody>
        {result.modes.map((m, i) => <tr key={i}><th>{i + 1}</th><td>{fmt(m.factor, 6)}</td></tr>)}
      </tbody></table>
      <small className="k-muted">The critical load is the load factor times the applied loads. The largest compression in the applied loads is {show(result.maxCompression, 'force', u)}.</small>
    </>
  )
}

function ProbeTable({ model, probe }: { model: Model; probe: PlateProbe }) {
  const u = model.units
  return (
    <table className="fe-kv"><thead><tr><th>Field</th><td>smooth</td><td>element</td></tr></thead><tbody>
      {PLATE_FIELDS.map((f) => <tr key={f.id}><th>{f.short}</th><td>{fmt(fromSI(probe.values[f.id], f.quantity as Quantity, u), 4)}</td><td>{fmt(fromSI(probe.elementValues[f.id], f.quantity as Quantity, u), 4)}</td></tr>)}
    </tbody></table>
  )
}

export { DEFAULT_RESULT, deleteVertex }
