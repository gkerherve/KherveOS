// AI tools of kFEA (the manifest is src/os/ai/manifests/kfea.ts): get_state, solve, load_example, add. Written against
// a small set of hooks the window provides, so that the logic can be tested without a browser. Numbers the AI gives
// and receives are in the model's display units (the file stays SI).

import type { useAppTools } from '@/os/ai/appTools'
import {
  addMemberLoad, addNode, addMember, addPlateLoad, addPlateSupport, edit, setNodeLoad, setSupport, supportKind, useMaterial, useSection, type SupportKind,
} from './editor.ts'
import { EXAMPLES, exampleById } from './examples.ts'
import { checkModel, cleanModel, emptyPlate, isPlate, normalizePlate, type LoadDir, type Model, type Pt, type Target } from './model.ts'
import { meshStats } from './mesh.ts'
import { extremes, PLATE_FIELDS, plateField } from './post.ts'
import { measure, solveModel, summaryLines, type AnyResult } from './solve.ts'
import { SolveError } from './linalg.ts'
import { fromSI, label, toSI, type Quantity } from './units.ts'

type Tools = Parameters<typeof useAppTools>[1]

export interface Hooks {
  state(): { model: Model; result: AnyResult | null; stale: boolean; dirty: boolean; path: string | null }
  /** Replaces the model (one undo step). */
  apply(model: Model, what: string): void
  /** Solves the open model and shows the result in the window. */
  solve(): Promise<AnyResult>
  /** Opens a model in the window (asks about unsaved changes); false when the user said no. */
  openModel(model: Model, name: string): Promise<boolean>
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

const q = (m: Model, v: number, quantity: Quantity, digits = 6): number => Number(fromSI(v, quantity, m.units).toPrecision(digits))

/** What the AI sees of a model. */
export function describeModel(m: Model) {
  const problems = checkModel(m).map((p) => ({ level: p.level, message: p.message }))
  const units = { length: m.units.length, force: m.units.force, stress: label('stress', m.units), moment: label('moment', m.units) }
  if (m.plate) {
    const p = m.plate
    return {
      name: m.name, analysis: m.analysis, units, problems,
      plate: {
        thickness: q(m, p.thickness, 'length'), material: p.material, outline: p.outline.map((pt) => [q(m, pt.x, 'length'), q(m, pt.y, 'length')]),
        holes: p.holes.length, supports: p.supports.length, loads: p.loads.length, mesh: { size: q(m, p.mesh.size, 'length'), type: p.mesh.type, structured: p.mesh.structured },
      },
    }
  }
  return {
    name: m.name, analysis: m.analysis, study: m.study, units, problems,
    nodes: m.nodes.map((n) => ({ id: n.id, x: q(m, n.x, 'length'), y: q(m, n.y, 'length') })),
    members: m.members.map((x) => ({ id: x.id, from: x.n1, to: x.n2, section: x.section, material: x.material, ...(x.releaseStart ? { hingeStart: true } : {}), ...(x.releaseEnd ? { hingeEnd: true } : {}) })),
    supports: m.supports.map((s) => ({ node: s.node, type: supportKind(s) })),
    loads: [
      ...m.nodeLoads.map((l) => ({ node: l.node, fx: q(m, l.fx, 'force'), fy: q(m, l.fy, 'force'), mz: q(m, l.mz, 'moment') })),
      ...m.memberLoads.map((l) => (l.type === 'dist' ? { member: l.member, type: 'distributed', dir: l.dir, w1: q(m, l.w1, 'lineLoad'), w2: q(m, l.w2, 'lineLoad') } : l.type === 'point' ? { member: l.member, type: 'point', dir: l.dir, p: q(m, l.p, 'force'), at: q(m, l.a, 'length') } : { member: l.member, type: 'thermal', dT: l.dT, dTg: l.dTg })),
    ],
    gravity: m.gravity,
    sections: m.sections.map((s) => s.id),
    materials: m.materials.map((x) => x.id),
  }
}

/** The numbers of a result, in display units, in the form the AI reads. */
export function describeResult(m: Model, r: AnyResult) {
  const units = { length: m.units.length, force: m.units.force, stress: label('stress', m.units), moment: label('moment', m.units) }
  const checks = m.expected
    ? Object.entries(m.expected).flatMap(([key, value]) => {
        try { const got = measure(m, r, key); return [{ quantity: key, expectedSI: value, computedSI: got, differencePercent: value !== 0 ? Number(((got / value - 1) * 100).toFixed(4)) : null }] } catch { return [] }
      })
    : []
  if (r.kind === 'frame') {
    return {
      units,
      maxDisplacement: { value: q(m, r.maxDisp, 'length'), at: r.maxDispAt },
      reactions: r.reactions.map((x) => ({ node: x.node, rx: q(m, x.rx, 'force'), ry: q(m, x.ry, 'force'), mz: q(m, x.mz, 'moment') })),
      displacements: r.nodeIds.map((id, i) => ({ node: id, ux: q(m, r.u[3 * i], 'length'), uy: q(m, r.u[3 * i + 1], 'length'), rz: Number(r.u[3 * i + 2].toPrecision(6)) })),
      members: r.members.map((x) => ({ id: x.id, N_start: q(m, x.N1, 'force'), N_end: q(m, x.N2, 'force'), V_max: q(m, x.maxV, 'force'), M_max: q(m, x.maxM, 'moment'), maxStress: q(m, x.maxStress, 'stress'), safetyFactor: Number.isFinite(x.safety) ? Number(x.safety.toPrecision(5)) : null })),
      maxStress: { value: q(m, r.maxStress, 'stress'), member: r.maxStressMember },
      safetyFactor: Number.isFinite(r.safety) ? Number(r.safety.toPrecision(5)) : null,
      equilibriumError: r.equilibrium.error,
      warnings: r.warnings,
      ...(checks.length ? { checksVsExpected: checks } : {}),
    }
  }
  if (r.kind === 'plane') {
    const ext = Object.fromEntries(PLATE_FIELDS.filter((f) => ['vm', 'sx', 'sy', 'txy', 'p1', 'p2'].includes(f.id)).map((f) => { const e = extremes(plateField(r, f.id, 'nodal')); return [f.id, { min: q(m, e.min, 'stress'), max: q(m, e.max, 'stress') }] }))
    let rx = 0, ry = 0
    for (let i = 0; i < r.mesh.nNodes; i++) { rx += r.reactions[2 * i]; ry += r.reactions[2 * i + 1] }
    const st = meshStats(r.mesh)
    return {
      units,
      mesh: { elements: st.elements, nodes: st.nodes, type: st.type, minAngle: Number(st.minAngle.toFixed(1)), meanQuality: Number(st.meanQuality.toFixed(3)) },
      maxDisplacement: q(m, r.maxDisp, 'length'),
      maxVonMises: q(m, r.maxVm, 'stress'),
      stress: ext,
      safetyFactor: Number.isFinite(r.safety) ? Number(r.safety.toPrecision(5)) : null,
      totalReaction: { x: q(m, rx, 'force'), y: q(m, ry, 'force') },
      strainEnergy: r.strainEnergy,
      equilibriumError: r.equilibrium.error,
      warnings: r.warnings,
      ...(checks.length ? { checksVsExpected: checks } : {}),
    }
  }
  if (r.kind === 'modal') return { units, modes: r.modes.map((x, i) => ({ mode: i + 1, omega_rad_s: Number(x.omega.toPrecision(7)), frequency_Hz: Number(x.frequency.toPrecision(7)) })), ...(checks.length ? { checksVsExpected: checks } : {}) }
  return { units, note: 'Load factors multiply the applied loads to give the critical loads.', modes: r.modes.map((x, i) => ({ mode: i + 1, loadFactor: Number(x.factor.toPrecision(7)) })), ...(checks.length ? { checksVsExpected: checks } : {}) }
}

// ---------------------------------------------------------------------------- the add tool

const num = (v: unknown, what: string): number => {
  const x = typeof v === 'string' ? Number(v.replace(',', '.')) : (v as number)
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`${what}: a number is expected.`)
  return x
}
const opt = (v: unknown, what: string): number | undefined => (v === undefined || v === null || v === '' ? undefined : num(v, what))
const list = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>) : [])

const SUPPORT_WORDS: Record<string, SupportKind> = {
  pinned: 'pinned', pin: 'pinned', hinge: 'pinned', roller: 'roller', 'roller-x': 'roller-x', rollerx: 'roller-x', 'roller-y': 'roller', fixed: 'fixed', clamped: 'fixed', encastre: 'fixed', spring: 'spring', free: 'free', none: 'free',
}

function pt(v: unknown, what: string): Pt {
  if (Array.isArray(v)) return { x: num(v[0], what), y: num(v[1], what) }
  const o = (v ?? {}) as Record<string, unknown>
  return { x: num(o.x, what), y: num(o.y, what) }
}

function targetOf(v: unknown, m: Model): Target {
  const o = (v ?? {}) as Record<string, unknown>
  const L = (x: unknown, what: string) => toSI(num(x, what), 'length', m.units)
  if (o.edge !== undefined) return { kind: 'edge', loop: o.loop === undefined ? 0 : num(o.loop, 'loop'), edge: num(o.edge, 'edge') }
  if (o.vertex !== undefined) return { kind: 'vertex', loop: o.loop === undefined ? 0 : num(o.loop, 'loop'), vertex: num(o.vertex, 'vertex') }
  if (o.line !== undefined) { const l = o.line as number[]; return { kind: 'line', x1: L(l[0], 'line'), y1: L(l[1], 'line'), x2: L(l[2], 'line'), y2: L(l[3], 'line') } }
  if (o.circle !== undefined) { const c = o.circle as number[]; return { kind: 'circle', cx: L(c[0], 'circle'), cy: L(c[1], 'circle'), r: L(c[2], 'circle') } }
  if (o.point !== undefined) { const p = o.point as number[]; return { kind: 'point', x: L(p[0], 'point'), y: L(p[1], 'point') } }
  if (o.loop !== undefined) return { kind: 'loop', loop: num(o.loop, 'loop') }
  throw new Error('A plate support or load needs a place: {edge: 0}, {line: [x1,y1,x2,y2]}, {circle: [cx,cy,r]}, {vertex: 2} or {point: [x,y]} (edge numbers count from the first outline point).')
}

/** The add tool: builds on the open model, in display units. Returns the new model and what was created. */
export function applyAdd(m0: Model, a: Record<string, unknown>): { model: Model; created: Record<string, unknown> } {
  let m = m0
  const U = m.units
  const L = (v: unknown, what: string) => toSI(num(v, what), 'length', U)
  const F = (v: unknown, what: string) => toSI(num(v, what), 'force', U)
  const created: Record<string, string[]> = { nodes: [], members: [], supports: [], loads: [] }
  if (a.plate !== undefined && a.plate !== null) {
    if (!isPlate(m.analysis)) throw new Error('This model is a frame: open a new model with the plane stress or plane strain analysis to add a plate (or pass a whole model to solve).')
    const p = a.plate as Record<string, unknown>
    m = edit(m, (c) => {
      if (!c.plate) c.plate = emptyPlate()
      const plate = c.plate
      if (p.outline !== undefined) {
        const o = (p.outline as unknown[]).map((v) => ({ x: L(pt(v, 'outline').x, 'outline'), y: L(pt(v, 'outline').y, 'outline') }))
        if (o.length < 3) throw new Error('The outline needs at least three points.')
        plate.outline = o
        plate.supports = []
        plate.loads = []
      }
      if (p.holes !== undefined) plate.holes = (p.holes as unknown[][]).map((h) => h.map((v) => ({ x: L(pt(v, 'hole').x, 'hole'), y: L(pt(v, 'hole').y, 'hole') })))
      if (p.thickness !== undefined) plate.thickness = L(p.thickness, 'thickness')
      if (p.material !== undefined) plate.material = useMaterial(c, String(p.material))
      if (p.meshSize !== undefined) plate.mesh.size = L(p.meshSize, 'meshSize')
      if (p.elements === 'quad' || p.elements === 'tri') plate.mesh.type = p.elements
      if (p.structured !== undefined) plate.mesh.structured = !!p.structured
    })
    // signed area: the outline is stored counter-clockwise (edge numbers follow the points as given when they already are)
    for (const s of list(p.supports)) {
      const ux = s.ux === undefined ? true : !!s.ux
      const uy = s.uy === undefined ? true : !!s.uy
      m = addPlateSupport(m, targetOf(s, m), ux, uy)
      created.supports.push('plate support')
    }
    for (const l of list(p.loads)) {
      const t = l.type ? String(l.type) : l.pressure !== undefined ? 'pressure' : l.dT !== undefined ? 'thermal' : l.force !== undefined ? 'edge-force' : 'traction'
      if (t === 'thermal') m = addPlateLoad(m, { type: 'thermal', dT: num(l.dT, 'dT') })
      else if (t === 'pressure') m = addPlateLoad(m, { type: 'pressure', target: targetOf(l, m), p: toSI(num(l.pressure ?? l.p, 'pressure'), 'stress', U) })
      else if (t === 'traction') m = addPlateLoad(m, { type: 'traction', target: targetOf(l, m), tx: toSI(num(l.tx ?? 0, 'tx'), 'stress', U), ty: toSI(num(l.ty ?? 0, 'ty'), 'stress', U) })
      else {
        const f = (l.force ?? l) as Record<string, unknown>
        m = addPlateLoad(m, { type: t === 'point' ? 'point' : 'edge-force', target: targetOf(l, m), fx: F(f.fx ?? 0, 'fx'), fy: F(f.fy ?? 0, 'fy') } as never)
      }
      created.loads.push(t)
    }
    // the outline may have been listed clockwise: it is turned round, and the edge numbers with it
    m = edit(m, (c) => { if (c.plate) normalizePlate(c.plate) })
    return { model: m, created }
  }
  if (isPlate(m.analysis)) throw new Error('This model is a plate: use the plate argument (outline, holes, thickness, material, supports, loads).')
  const defaultSection = a.section ? String(a.section) : undefined
  for (const n of list(a.nodes)) {
    const r = addNode(m, L(n.x, 'node x'), L(n.y, 'node y'), n.id !== undefined ? String(n.id) : undefined)
    m = r.model
    created.nodes.push(r.id)
  }
  const nodeRef = (v: unknown): string => {
    if (typeof v === 'string' || typeof v === 'number') {
      const id = String(v)
      if (!m.nodes.some((n) => n.id === id)) throw new Error(`There is no node “${id}”. Nodes: ${m.nodes.map((n) => n.id).join(', ') || 'none'}.`)
      return id
    }
    const p = pt(v, 'member end')
    const r = addNode(m, L(p.x, 'x'), L(p.y, 'y'))
    m = r.model
    if (!created.nodes.includes(r.id)) created.nodes.push(r.id)
    return r.id
  }
  for (const x of list(a.members)) {
    const from = nodeRef(x.from)
    const to = nodeRef(x.to)
    const r = addMember(m, from, to, {
      section: x.section ? String(x.section) : defaultSection, material: x.material ? String(x.material) : undefined,
      releaseStart: !!(x.hingeStart ?? x.releaseStart), releaseEnd: !!(x.hingeEnd ?? x.releaseEnd),
    }, x.id !== undefined ? String(x.id) : undefined)
    m = r.model
    created.members.push(r.id)
  }
  for (const s of list(a.supports)) {
    const id = nodeRef(s.node)
    const kind = SUPPORT_WORDS[String(s.type ?? 'pinned').toLowerCase()]
    if (!kind) throw new Error(`Support type “${String(s.type)}” is unknown: pinned, roller, roller-x, fixed, spring or free.`)
    m = setSupport(m, id, kind, s.k !== undefined ? toSI(num(s.k, 'k'), 'stiffness', U) : undefined)
    created.supports.push(`${id}: ${kind}`)
  }
  for (const l of list(a.loads)) {
    if (l.node !== undefined) {
      const id = nodeRef(l.node)
      const prev = m.nodeLoads.find((x) => x.node === id)
      m = setNodeLoad(m, id, F(l.fx ?? 0, 'fx') + (prev?.fx ?? 0), F(l.fy ?? 0, 'fy') + (prev?.fy ?? 0), toSI(num(l.mz ?? 0, 'mz'), 'moment', U) + (prev?.mz ?? 0))
      created.loads.push(`node ${id}`)
      continue
    }
    if (l.member === undefined) throw new Error('A load needs a node or a member.')
    const member = String(l.member)
    if (!m.members.some((x) => x.id === member)) throw new Error(`There is no member “${member}”. Members: ${m.members.map((x) => x.id).join(', ') || 'none'}.`)
    const dir = (l.dir ? String(l.dir) : 'y') as LoadDir
    if (!['x', 'y', 'lx', 'ly'].includes(dir)) throw new Error('dir: x, y (global) or lx, ly (along / across the member).')
    const kind = String(l.kind ?? (l.dT !== undefined || l.dTg !== undefined ? 'thermal' : l.p !== undefined ? 'point' : 'udl'))
    if (kind === 'thermal') m = addMemberLoad(m, { member, type: 'thermal', dT: num(l.dT ?? 0, 'dT'), dTg: num(l.dTg ?? 0, 'dTg') })
    else if (kind === 'point') m = addMemberLoad(m, { member, type: 'point', dir, p: F(l.p, 'p'), a: L(l.at ?? 0, 'at') })
    else {
      const w1 = toSI(num(l.w1 ?? l.w, 'w'), 'lineLoad', U)
      const w2 = l.w2 !== undefined ? toSI(num(l.w2, 'w2'), 'lineLoad', U) : w1
      const ld: Omit<Extract<(typeof m.memberLoads)[number], { type: 'dist' }>, 'id'> = { member, type: 'dist', dir, w1, w2 }
      const from = opt(l.from, 'from')
      const to = opt(l.to, 'to')
      if (from !== undefined) ld.a = toSI(from, 'length', U)
      if (to !== undefined) ld.b = toSI(to, 'length', U)
      m = addMemberLoad(m, ld)
    }
    created.loads.push(`${kind} on ${member}`)
  }
  if (defaultSection) m = edit(m, (c) => { useSection(c, defaultSection) })
  return { model: m, created }
}

// ---------------------------------------------------------------------------- the tools

export function kfeaTools(h: Hooks): Tools {
  return {
    get_state: async (a) => {
      const s = h.state()
      const include = String(a.include ?? 'summary')
      const base = {
        file: s.path, unsavedChanges: s.dirty, ...describeModel(s.model),
        results: s.result && !s.stale ? 'available (call solve to refresh or include=results)' : s.result ? 'out of date (the model changed): call solve' : 'not solved yet',
      }
      if (include === 'model') return { ...base, kfea: JSON.parse(JSON.stringify(s.model)) }
      if (include === 'results') {
        if (!s.result) return { ...base, note: 'Not solved yet: call solve.' }
        return { ...base, solution: describeResult(s.model, s.result), ...(s.stale ? { warning: 'The model changed after this solution.' } : {}) }
      }
      return base
    },

    load_example: async (a, ctx) => {
      const id = String(a.id ?? '').trim()
      if (!id) {
        return { examples: EXAMPLES.map((e) => ({ id: e.id, title: e.title, group: e.group, expected: e.description.split('. ').slice(0, 2).join('. ') })), note: 'Call load_example with an id to open one.' }
      }
      const ex = exampleById(id)
      if (!ex) throw new Error(`No example “${id}”: call load_example without an id to list them.`)
      const s = h.state()
      if (s.dirty && !(await ctx.confirm('Replace the open model?', `“${s.model.name}” has unsaved changes; opening “${ex.title}” discards them.`))) throw new Error('The user did not allow replacing the open model.')
      const ok = await h.openModel(structuredClone(ex.model), ex.title)
      if (!ok) throw new Error('The example was not opened.')
      return { loaded: ex.title, description: ex.description, ...describeModel(ex.model), note: 'Call solve to run it; the description says what to expect.' }
    },

    solve: async (a, ctx) => {
      const given = a.model
      if (given !== undefined && given !== null && given !== '') {
        let raw: unknown = given
        if (typeof given === 'string') { try { raw = JSON.parse(given) } catch { throw new Error('model: not valid JSON.') } }
        const model = cleanModel(raw)
        if (a.study === 'modal' || a.study === 'buckling' || a.study === 'static') model.study = a.study
        const problems = checkModel(model).filter((p) => p.level === 'error')
        if (problems.length) throw new Error(problems[0].message)
        let result: AnyResult
        try { result = solveModel(model, { modes: opt(a.modes, 'modes'), divisions: opt(a.divisions, 'divisions') }) } catch (e) { throw new Error(msg(e)) }
        if (a.show) {
          const s = h.state()
          if (s.dirty && !(await ctx.confirm('Replace the open model?', `“${s.model.name}” has unsaved changes.`))) throw new Error('The user did not allow replacing the open model.')
          await h.openModel(model, model.name)
        }
        return { solved: model.name, summary: summaryLines(model, result), ...describeResult(model, result) }
      }
      const s = h.state()
      if (a.study === 'modal' || a.study === 'buckling' || a.study === 'static') h.apply(edit(s.model, (c) => { c.study = a.study as Model['study'] }), 'Change study')
      try {
        const result = await h.solve()
        const now = h.state().model
        return { solved: now.name, summary: summaryLines(now, result), ...describeResult(now, result) }
      } catch (e) {
        if (e instanceof SolveError) throw new Error(e.message)
        throw e
      }
    },

    add: async (a) => {
      const s = h.state()
      const { model, created } = applyAdd(s.model, a)
      h.apply(model, 'Add (AI)')
      const problems = checkModel(model).map((p) => `${p.level}: ${p.message}`)
      return { added: created, ...(problems.length ? { stillMissing: problems } : { ready: 'The model can be solved: call solve.' }), units: { length: s.model.units.length, force: s.model.units.force } }
    },
  }
}

