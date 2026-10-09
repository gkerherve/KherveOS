// Editing the rigid-body sandbox: a tool bar (select, draw boxes, circles and polygons, join them with joints, delete,
// grab and throw), the pointer logic of those tools and the inspector of the selected body or joint. The scene itself
// is plain data (scenes/sandbox.ts); every edit hands a new SandboxSpec to the window, which restarts the simulation.

import { useRef, useState } from 'react'
import { Circle, Hand, MousePointer2, Pentagon, Square, Trash2 } from 'lucide-react'
import { COLORS } from './common'
import {
  JOINT_NAMES, addBox, addCircle, addJoint, addPolygon, bodyCorners, hitBody, hitJoint, moveBody, removeBody, removeJoint, updateBody, updateJoint,
  type JointKind, type SBody, type SJoint, type SandboxSpec,
} from './scenes/sandbox'
import type { Shape } from './types'

export type SandboxTool = 'grab' | 'select' | 'box' | 'circle' | 'poly' | 'delete' | JointKind

export interface Selected { kind: 'body' | 'joint'; id: string }

const JOINTS: JointKind[] = ['revolute', 'prismatic', 'distance', 'rope', 'pulley', 'weld', 'wheel']

const HINTS: Record<SandboxTool, string> = {
  grab: 'Drag a body with the mouse to throw it. Drag the background to pan.',
  select: 'Click a body or a joint to edit it; drag a body to move it.',
  box: 'Drag out a box.',
  circle: 'Drag out a circle from its centre.',
  poly: 'Click the corners (up to 8, the convex hull is kept); double-click or press Enter to finish.',
  delete: 'Click a body or joint to delete it.',
  revolute: 'Click the first body (or empty space for the ground), then the second: they pivot about the first click.',
  prismatic: 'Click the first body (or the ground), then the second: the slider axis is horizontal; change it in the inspector.',
  distance: 'Click the first body at its anchor, then the second body at its anchor: a rigid rod, or a spring if you give it a frequency.',
  rope: 'Click two anchors on two bodies: they cannot move farther apart than they started.',
  pulley: 'Click two bodies: a rope over two fixed pulleys 2 m above their anchors.',
  weld: 'Click two bodies: they are glued together at the first click.',
  wheel: 'Click a chassis and then a wheel: a wheel joint with suspension; add a motor in the inspector.',
}

const snapV = (v: number, on: boolean) => (on ? Math.round(v / 0.25) * 0.25 : v)

interface Draft {
  kind: 'box' | 'circle'
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface SandboxEditor {
  tool: SandboxTool
  setTool(t: SandboxTool): void
  selected: Selected | null
  setSelected(s: Selected | null): void
  onPointer(kind: 'down' | 'move' | 'up', x: number, y: number): boolean
  onDoubleClick(): boolean
  onKey(e: KeyboardEvent | React.KeyboardEvent): boolean
  ghost: Shape[]
  selection: Shape[]
  hint: string
}

/** The editor's state and pointer logic. `grab` forwards to the simulation's own mouse joint. */
export function useSandboxEditor(spec: SandboxSpec, snap: boolean, fresh: Partial<SBody>, edit: (s: SandboxSpec, history: 'push' | 'coalesce') => void, sim: { pointer?: (k: 'down' | 'move' | 'up', x: number, y: number) => boolean } | null, canvasScale: () => number, note: (m: string) => void): SandboxEditor {
  const [tool, setToolState] = useState<SandboxTool>('select')
  const [selected, setSelected] = useState<Selected | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [poly, setPoly] = useState<number[][]>([])
  const [jdraft, setJdraft] = useState<{ a: string | null; ax: number; ay: number } | null>(null)
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const drag = useRef<{ id: string; x: number; y: number; base: SandboxSpec } | null>(null)
  const grabbing = useRef(false)

  const setTool = (t: SandboxTool) => {
    setToolState(t)
    setDraft(null)
    setPoly([])
    setJdraft(null)
  }

  const finishPoly = () => {
    if (poly.length >= 3) {
      const next = addPolygon(spec, poly, fresh)
      if (next) {
        edit(next, 'push')
        setSelected({ kind: 'body', id: next.bodies[next.bodies.length - 1].id })
      } else note('Those corners do not make a polygon with an area.')
    }
    setPoly([])
  }

  const onPointer = (kind: 'down' | 'move' | 'up', rx: number, ry: number): boolean => {
    const x = snapV(rx, snap)
    const y = snapV(ry, snap)
    setCursor([x, y])
    if (tool === 'grab') {
      if (kind === 'down') { grabbing.current = !!sim?.pointer?.('down', rx, ry); return grabbing.current }
      if (!grabbing.current) return false
      sim?.pointer?.(kind, rx, ry)
      if (kind === 'up') grabbing.current = false
      return true
    }
    if (tool === 'select') {
      if (kind === 'down') {
        const b = hitBody(spec, rx, ry)
        if (b) {
          setSelected({ kind: 'body', id: b.id })
          drag.current = { id: b.id, x: rx, y: ry, base: spec }
          return true
        }
        const j = hitJoint(spec, rx, ry, 10 / Math.max(canvasScale(), 1e-9))
        setSelected(j ? { kind: 'joint', id: j.id } : null)
        return false
      }
      const d = drag.current
      if (!d) return false
      if (kind === 'move') {
        const dx = snapV(rx - d.x, snap)
        const dy = snapV(ry - d.y, snap)
        if (dx !== 0 || dy !== 0) edit(moveBody(d.base, d.id, dx, dy), 'coalesce')
      } else {
        drag.current = null
      }
      return true
    }
    if (tool === 'box' || tool === 'circle') {
      if (kind === 'down') { setDraft({ kind: tool, x0: x, y0: y, x1: x, y1: y }); return true }
      if (!draft) return false
      if (kind === 'move') { setDraft({ ...draft, x1: x, y1: y }); return true }
      const d = { ...draft, x1: x, y1: y }
      setDraft(null)
      let next: SandboxSpec
      if (d.kind === 'box') {
        const w = Math.abs(d.x1 - d.x0)
        const h = Math.abs(d.y1 - d.y0)
        next = w < 0.1 || h < 0.1 ? addBox(spec, d.x0, d.y0, 1, 1, fresh) : addBox(spec, (d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, w, h, fresh)
      } else {
        const r = Math.hypot(d.x1 - d.x0, d.y1 - d.y0)
        next = addCircle(spec, d.x0, d.y0, r < 0.05 ? 0.5 : r, fresh)
      }
      edit(next, 'push')
      setSelected({ kind: 'body', id: next.bodies[next.bodies.length - 1].id })
      return true
    }
    if (tool === 'poly') {
      if (kind === 'down') {
        if (poly.length >= 3 && Math.hypot(x - poly[0][0], y - poly[0][1]) * canvasScale() < 10) { finishPoly(); return true }
        setPoly([...poly, [x, y]].slice(0, 8))
        return true
      }
      return poly.length > 0
    }
    if (tool === 'delete') {
      if (kind !== 'down') return false
      const b = hitBody(spec, rx, ry)
      if (b) { edit(removeBody(spec, b.id), 'push'); setSelected(null); return true }
      const j = hitJoint(spec, rx, ry, 10 / Math.max(canvasScale(), 1e-9))
      if (j) { edit(removeJoint(spec, j.id), 'push'); setSelected(null); return true }
      return false
    }
    // joints
    if (kind !== 'down') return false
    const hit = hitBody(spec, rx, ry)
    if (!jdraft) {
      if (!hit && (tool === 'pulley' || tool === 'rope' || tool === 'distance')) { note('Start on a body.'); return true }
      setJdraft({ a: hit ? hit.id : null, ax: x, ay: y })
      return true
    }
    if (!hit || hit.id === jdraft.a) { note('Click a second, different body.'); return true }
    const base: Omit<SJoint, 'id'> = { kind: tool, a: jdraft.a, b: hit.id, ax: jdraft.ax, ay: jdraft.ay }
    if (tool === 'distance' || tool === 'rope' || tool === 'pulley') { base.bx = x; base.by = y }
    if (tool === 'prismatic') { base.axisX = 1; base.axisY = 0 }
    if (tool === 'wheel') { base.axisX = 0; base.axisY = 1; base.freq = 4; base.damping = 0.7; base.motor = false; base.speed = -10; base.maxForce = 30 }
    if (tool === 'distance') base.freq = 0
    if (tool === 'pulley') { base.gax = jdraft.ax; base.gay = jdraft.ay + 2; base.gbx = x; base.gby = y + 2; base.ratio = 1 }
    const next = addJoint(spec, base)
    edit(next, 'push')
    setSelected({ kind: 'joint', id: next.joints[next.joints.length - 1].id })
    setJdraft(null)
    return true
  }

  const onKey = (e: KeyboardEvent | React.KeyboardEvent): boolean => {
    if (e.key === 'Enter' && tool === 'poly') { finishPoly(); return true }
    if (e.key === 'Escape') {
      if (draft || poly.length || jdraft) { setDraft(null); setPoly([]); setJdraft(null); return true }
      if (selected) { setSelected(null); return true }
      return false
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      edit(selected.kind === 'body' ? removeBody(spec, selected.id) : removeJoint(spec, selected.id), 'push')
      setSelected(null)
      return true
    }
    return false
  }

  const ghost: Shape[] = []
  if (draft) {
    if (draft.kind === 'box') ghost.push({ t: 'rect', x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1), w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0), fill: COLORS.a, stroke: COLORS.a, alpha: 0.4 })
    else ghost.push({ t: 'circle', x: draft.x0, y: draft.y0, r: Math.hypot(draft.x1 - draft.x0, draft.y1 - draft.y0), fill: COLORS.a, stroke: COLORS.a, alpha: 0.4 })
  }
  if (poly.length) {
    const pts = cursor ? [...poly, cursor] : poly
    ghost.push({ t: 'poly', pts, stroke: COLORS.a, fill: COLORS.a, closed: false, w: 2, alpha: 0.8 })
    for (const p of poly) ghost.push({ t: 'circle', x: p[0], y: p[1], r: 0.05, fill: COLORS.a })
  }
  if (jdraft) {
    ghost.push({ t: 'circle', x: jdraft.ax, y: jdraft.ay, r: 0.08, fill: COLORS.d })
    if (cursor) ghost.push({ t: 'line', x1: jdraft.ax, y1: jdraft.ay, x2: cursor[0], y2: cursor[1], color: COLORS.d, dash: true, w: 1.5 })
  }

  const selection: Shape[] = []
  if (selected?.kind === 'body') {
    const b = spec.bodies.find((x) => x.id === selected.id)
    if (b) {
      if (b.kind === 'circle') selection.push({ t: 'circle', x: b.x, y: b.y, r: (b.r ?? 0.5) * 1.12, fill: COLORS.theory, stroke: COLORS.theory, alpha: 0.12, ring: true })
      else selection.push({ t: 'poly', pts: bodyCorners(b), stroke: COLORS.theory, closed: true, w: 2.5, alpha: 1 })
    }
  } else if (selected?.kind === 'joint') {
    const j = spec.joints.find((x) => x.id === selected.id)
    if (j) selection.push({ t: 'circle', x: j.ax, y: j.ay, r: 0.18, fill: COLORS.theory, stroke: COLORS.theory, ring: true })
  }

  return { tool, setTool, selected, setSelected, onPointer, onDoubleClick: () => { if (tool === 'poly' && poly.length >= 3) { finishPoly(); return true } return false }, onKey, ghost, selection, hint: HINTS[tool] }
}

// ------------------------------------------------------------------------------------------ the tool bar

const TOOL_LABEL: Record<string, string> = { revolute: 'Hinge', prismatic: 'Slider', distance: 'Rod', rope: 'Rope', pulley: 'Pulley', weld: 'Weld', wheel: 'Wheel' }

export function SandboxBar({ ed }: { ed: SandboxEditor }) {
  const btn = (t: SandboxTool, icon: React.ReactNode, label: string, title?: string) => (
    <button key={t} className={`k-btn small ${ed.tool === t ? 'on' : ''}`} aria-pressed={ed.tool === t} title={title ?? label} onClick={() => ed.setTool(t)}>{icon}{label}</button>
  )
  return (
    <div className="mo-tools" role="toolbar" aria-label="Sandbox tools">
      {btn('grab', <Hand size={13} />, 'Throw', 'Grab and throw bodies while it runs')}
      {btn('select', <MousePointer2 size={13} />, 'Select')}
      {btn('box', <Square size={13} />, 'Box')}
      {btn('circle', <Circle size={13} />, 'Circle')}
      {btn('poly', <Pentagon size={13} />, 'Polygon')}
      <span className="k-sep" style={{ width: 1, height: 18, background: 'var(--k-border)', margin: '0 4px' }} />
      {JOINTS.map((j) => btn(j, null, TOOL_LABEL[j], JOINT_NAMES[j]))}
      <span className="k-sep" style={{ width: 1, height: 18, background: 'var(--k-border)', margin: '0 4px' }} />
      {btn('delete', <Trash2 size={13} />, 'Delete')}
      <span className="mo-hint">{ed.hint}</span>
    </div>
  )
}

// ------------------------------------------------------------------------------------------ the inspector

function MiniNum({ label, value, onChange, unit, step = 0.1, min, max }: { label: string; value: number; onChange(v: number): void; unit?: string; step?: number; min?: number; max?: number }) {
  const [text, setText] = useState<string | null>(null)
  const show = text ?? String(Number(value.toPrecision(5)))
  const commit = () => {
    const n = Number((text ?? '').replace(',', '.'))
    setText(null)
    if (Number.isFinite(n)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)))
  }
  return (
    <div className="mo-field">
      <label><span>{label}</span>{unit && <em>{unit}</em>}</label>
      <input
        className="k-input" style={{ width: '100%', textAlign: 'left' }} inputMode="decimal" aria-label={label} value={show}
        onFocus={() => setText(show)} onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Number((value + (e.key === 'ArrowUp' ? step : -step)).toFixed(8))); setText(null) }
        }}
      />
    </div>
  )
}

export function SandboxInspector({ spec, selected, edit }: { spec: SandboxSpec; selected: Selected | null; edit(s: SandboxSpec, h: 'push' | 'coalesce'): void }) {
  if (!selected) {
    return (
      <div className="mo-inspector">
        <h5>Nothing selected</h5>
        <p className="mo-blurb">Use Select and click a body or a joint to edit its mass density, friction, restitution, motor and more.</p>
      </div>
    )
  }
  if (selected.kind === 'body') {
    const b = spec.bodies.find((x) => x.id === selected.id)
    if (!b) return null
    const up = (p: Partial<SBody>, h: 'push' | 'coalesce' = 'push') => edit(updateBody(spec, b.id, p), h)
    return (
      <div className="mo-inspector">
        <h5>{b.id}: {b.kind === 'circle' ? 'circle' : b.kind === 'box' ? 'box' : 'polygon'}</h5>
        <div className="mo-seg" role="radiogroup" aria-label="Body type">
          {(['dynamic', 'static'] as const).map((t) => <button key={t} role="radio" aria-checked={b.type === t} className={b.type === t ? 'on' : ''} onClick={() => up({ type: t })}>{t}</button>)}
        </div>
        {b.kind === 'box' && <><MiniNum label="Width" unit="m" value={b.w ?? 1} min={0.05} onChange={(v) => up({ w: v })} /><MiniNum label="Height" unit="m" value={b.h ?? 1} min={0.05} onChange={(v) => up({ h: v })} /></>}
        {b.kind === 'circle' && <MiniNum label="Radius" unit="m" value={b.r ?? 0.5} min={0.05} onChange={(v) => up({ r: v })} />}
        <MiniNum label="x" unit="m" value={b.x} onChange={(v) => up({ x: v })} />
        <MiniNum label="y" unit="m" value={b.y} onChange={(v) => up({ y: v })} />
        <MiniNum label="Angle" unit="°" step={5} value={b.angle} onChange={(v) => up({ angle: v })} />
        <MiniNum label="Density" unit="kg/m²" step={0.1} min={0.01} value={b.density} onChange={(v) => up({ density: v })} />
        <MiniNum label="Friction" step={0.05} min={0} max={5} value={b.friction} onChange={(v) => up({ friction: v })} />
        <MiniNum label="Restitution" step={0.05} min={0} max={1} value={b.restitution} onChange={(v) => up({ restitution: v })} />
        <MiniNum label="Initial vx" unit="m/s" value={b.vx ?? 0} onChange={(v) => up({ vx: v })} />
        <MiniNum label="Initial vy" unit="m/s" value={b.vy ?? 0} onChange={(v) => up({ vy: v })} />
        <label className="mo-check"><input type="checkbox" checked={b.fixedRotation === true} onChange={(e) => up({ fixedRotation: e.target.checked || undefined })} /><span>Fixed rotation</span></label>
        <div className="mo-row">
          <button className="k-btn small" onClick={() => edit(removeBody(spec, b.id), 'push')}><Trash2 size={13} /> Delete</button>
          <button className="k-btn small" onClick={() => edit(addBoxCopy(spec, b), 'push')}>Duplicate</button>
        </div>
      </div>
    )
  }
  const j = spec.joints.find((x) => x.id === selected.id)
  if (!j) return null
  const up = (p: Partial<SJoint>) => edit(updateJoint(spec, j.id, p), 'push')
  const motorKinds: JointKind[] = ['revolute', 'prismatic', 'wheel']
  return (
    <div className="mo-inspector">
      <h5>{j.id}: {JOINT_NAMES[j.kind]}</h5>
      <p className="mo-blurb">{j.a ?? 'ground'} → {j.b}</p>
      {motorKinds.includes(j.kind) && (
        <>
          <label className="mo-check"><input type="checkbox" checked={j.motor === true} onChange={(e) => up({ motor: e.target.checked })} /><span>Motor</span></label>
          {j.motor && <>
            <MiniNum label="Motor speed" unit={j.kind === 'prismatic' ? 'm/s' : 'rad/s'} step={1} value={j.speed ?? 0} onChange={(v) => up({ speed: v })} />
            <MiniNum label="Maximum torque / force" unit={j.kind === 'prismatic' ? 'N' : 'N·m'} step={5} min={0} value={j.maxForce ?? 100} onChange={(v) => up({ maxForce: v })} />
          </>}
        </>
      )}
      {(j.kind === 'revolute' || j.kind === 'prismatic') && (
        <>
          <label className="mo-check"><input type="checkbox" checked={j.limit === true} onChange={(e) => up({ limit: e.target.checked })} /><span>Limits</span></label>
          {j.limit && <><MiniNum label="Lower" unit={j.kind === 'prismatic' ? 'm' : '°'} value={j.lower ?? (j.kind === 'prismatic' ? -2 : -90)} onChange={(v) => up({ lower: v })} /><MiniNum label="Upper" unit={j.kind === 'prismatic' ? 'm' : '°'} value={j.upper ?? (j.kind === 'prismatic' ? 2 : 90)} onChange={(v) => up({ upper: v })} /></>}
        </>
      )}
      {(j.kind === 'prismatic' || j.kind === 'wheel') && (
        <MiniNum label="Axis direction" unit="°" step={15} value={Math.round((Math.atan2(j.axisY ?? 1, j.axisX ?? 0) * 180) / Math.PI * 10) / 10} onChange={(v) => up({ axisX: Math.cos((v * Math.PI) / 180), axisY: Math.sin((v * Math.PI) / 180) })} />
      )}
      {(j.kind === 'distance' || j.kind === 'rope') && <MiniNum label={j.kind === 'rope' ? 'Maximum length' : 'Length'} unit="m" min={0.05} value={j.length ?? Math.hypot((j.bx ?? j.ax) - j.ax, (j.by ?? j.ay) - j.ay)} onChange={(v) => up({ length: v })} />}
      {(j.kind === 'distance' || j.kind === 'weld' || j.kind === 'wheel') && (
        <>
          <MiniNum label="Spring frequency (0 = rigid)" unit="Hz" step={0.5} min={0} value={j.freq ?? 0} onChange={(v) => up({ freq: v })} />
          <MiniNum label="Damping ratio" step={0.05} min={0} max={1} value={j.damping ?? 0.5} onChange={(v) => up({ damping: v })} />
        </>
      )}
      {j.kind === 'pulley' && <MiniNum label="Ratio" step={0.5} min={0.1} value={j.ratio ?? 1} onChange={(v) => up({ ratio: v })} />}
      <div className="mo-row"><button className="k-btn small" onClick={() => edit(removeJoint(spec, j.id), 'push')}><Trash2 size={13} /> Delete</button></div>
    </div>
  )
}

/** The physical properties worth copying to a duplicate. */
const phys = (b: SBody): Partial<SBody> => ({ type: b.type, density: b.density, friction: b.friction, restitution: b.restitution, color: b.color, fixedRotation: b.fixedRotation, angle: b.angle })

function addBoxCopy(spec: SandboxSpec, b: SBody): SandboxSpec {
  if (b.kind === 'circle') return addCircle(spec, b.x + 0.5, b.y + 0.5, b.r ?? 0.5, phys(b))
  if (b.kind === 'box') return addBox(spec, b.x + 0.5, b.y + 0.5, b.w ?? 1, b.h ?? 1, phys(b))
  const { angle, ...rest } = phys(b)
  void angle // the corners below already carry the rotation
  return addPolygon(spec, bodyCorners(b).map((p) => [p[0] + 0.5, p[1] + 0.5]), rest) ?? spec
}
