// The .kmech document: what the three workbenches keep, and reading/writing it (pure).
//
//   { "format": "kmech", "version": 1, "workbench": "linkage" | "cam" | "gear", "model": { … } }

import type { OutputSpec, PointLoad } from './analysis.ts'
import { DEFAULT_CAM, riseDwellReturn, type CamSegment, type CamSpec, type LawId, type MotionProgram } from './cam.ts'
import { DEFAULT_ENGINE, type EngineSpec } from './engine.ts'
import { DEFAULT_GEAR, type GearSpec, type Member, type TrainStage } from './gear.ts'
import { compile, emptyLinkage, type Linkage, type LLink, type LPoint, type LSlider } from './linkage.ts'

export type Workbench = 'linkage' | 'cam' | 'gear'

export const WORKBENCHES: Array<{ id: Workbench; name: string }> = [
  { id: 'linkage', name: 'Linkages' },
  { id: 'cam', name: 'Cams' },
  { id: 'gear', name: 'Gears' },
]

// ------------------------------------------------------------------------------ linkage

export interface LinkageDoc extends Linkage {
  /** Present for a slider-crank engine: the gas pressure and flywheel analysis. */
  engine?: EngineSpec
  /** The output the plots are about (default: chosen automatically). */
  output?: OutputSpec | null
  /** External loads for the static (virtual-work) analysis. */
  loads?: PointLoad[]
}

// ------------------------------------------------------------------------------ cam

export interface CamDoc extends CamSpec {
  name: string
  notes?: string
  /** A second motion program drawn over the first in the diagrams (and as a second profile). */
  compare?: { label: string; program: MotionProgram }
}

// ------------------------------------------------------------------------------ gear

export type GearView = 'pair' | 'train' | 'planetary' | 'helical' | 'belt'

export interface GearDoc {
  name: string
  notes?: string
  view: GearView
  pair: { g1: GearSpec; g2: GearSpec; /** working centre distance override, mm */ centre?: number; rpm: number; torque: number }
  train: { stages: TrainStage[]; rpm: number; torque: number; eff: number }
  planetary: { Zs: number; Zr: number; n: number; module: number; fixed: Member; input: Member; speed: number }
  helical: { mn: number; z1: number; z2: number; beta: number; alphaN: number; width: number }
  belt: { kind: 'belt' | 'chain'; D: number; d: number; C: number; rpm: number; crossed: boolean; N1: number; N2: number; pitch: number }
}

export function defaultGearDoc(name = 'Untitled gears'): GearDoc {
  return {
    name,
    view: 'pair',
    pair: { g1: { ...DEFAULT_GEAR, z: 20 }, g2: { ...DEFAULT_GEAR, z: 40 }, rpm: 1200, torque: 10 },
    train: { stages: [{ driver: 18, driven: 54 }, { driver: 20, driven: 60 }], rpm: 1800, torque: 5, eff: 0.98 },
    planetary: { Zs: 24, Zr: 72, n: 3, module: 1.5, fixed: 'ring', input: 'sun', speed: 1000 },
    helical: { mn: 2, z1: 24, z2: 48, beta: 15, alphaN: 20, width: 30 },
    belt: { kind: 'belt', D: 200, d: 80, C: 400, rpm: 1450, crossed: false, N1: 17, N2: 41, pitch: 12.7 },
  }
}

export function defaultCamDoc(name = 'Untitled cam'): CamDoc {
  return { name, ...DEFAULT_CAM }
}

export function defaultLinkageDoc(name = 'Untitled linkage'): LinkageDoc {
  return emptyLinkage(name)
}

export type KMechDoc =
  | { workbench: 'linkage'; model: LinkageDoc }
  | { workbench: 'cam'; model: CamDoc }
  | { workbench: 'gear'; model: GearDoc }

export function emptyDoc(workbench: Workbench): KMechDoc {
  if (workbench === 'cam') return { workbench, model: defaultCamDoc() }
  if (workbench === 'gear') return { workbench, model: defaultGearDoc() }
  return { workbench, model: defaultLinkageDoc() }
}

export const docName = (d: KMechDoc): string => d.model.name || 'Untitled'

// ------------------------------------------------------------------------------ file

export function serializeKMech(doc: KMechDoc): string {
  // the model goes through the reader's cleaning so that the keys are always in the same order
  const raw = doc.model as unknown as Record<string, unknown>
  const model = doc.workbench === 'linkage' ? cleanLinkage(raw) : doc.workbench === 'cam' ? cleanCam(raw) : cleanGear(raw)
  return JSON.stringify({ format: 'kmech', version: 1, workbench: doc.workbench, model }, null, 2) + '\n'
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback)

function cleanLinkage(raw: Record<string, unknown>): LinkageDoc {
  const points: LPoint[] = arr(raw.points).map((p, i) => {
    const o = obj(p)
    const out: LPoint = { id: str(o.id, `P${i + 1}`), x: num(o.x, 0), y: num(o.y, 0) }
    if (o.ground === true) out.ground = true
    if (typeof o.label === 'string') out.label = o.label
    if (o.tracer === true) out.tracer = true
    return out
  })
  const links: LLink[] = arr(raw.links).map((l, i) => {
    const o = obj(l)
    const out: LLink = { id: str(o.id, `L${i + 1}`), pts: arr(o.pts).filter((x): x is string => typeof x === 'string') }
    if (typeof o.label === 'string') out.label = o.label
    if (o.shape === 'bar' || o.shape === 'plate' || o.shape === 'star') out.shape = o.shape
    return out
  })
  const sliders: LSlider[] = arr(raw.sliders).map((s, i) => {
    const o = obj(s)
    const ln = obj(o.line)
    const out: LSlider = {
      id: str(o.id, `S${i + 1}`), point: str(o.point),
      line: ln.kind === 'link' ? { kind: 'link', a: str(ln.a), b: str(ln.b) } : { kind: 'ground', x: num(ln.x, 0), y: num(ln.y, 0), angle: num(ln.angle, 0) },
    }
    if (typeof o.label === 'string') out.label = o.label
    if (typeof o.mass === 'number' && Number.isFinite(o.mass)) out.mass = o.mass
    return out
  })
  const d = obj(raw.driver)
  const m: LinkageDoc = { name: str(raw.name, 'Untitled linkage'), points, links, sliders, driver: raw.driver && typeof d.from === 'string' && typeof d.to === 'string' ? { from: d.from, to: d.to, rpm: num(d.rpm, 60) } : null }
  const lim = obj(raw.limits)
  if (typeof lim.min === 'number' && typeof lim.max === 'number') m.limits = { min: lim.min, max: lim.max }
  if (raw.dwell === true) m.dwell = true
  const mat = obj(raw.material)
  if (raw.material) m.material = { density: num(mat.density, 7850), width: num(mat.width, 12), thickness: num(mat.thickness, 6) }
  if (typeof raw.notes === 'string') m.notes = raw.notes
  if (raw.engine) {
    const e = obj(raw.engine)
    const eng: EngineSpec = { ...DEFAULT_ENGINE }
    for (const k of Object.keys(DEFAULT_ENGINE) as Array<keyof EngineSpec>) {
      if (k === 'table') continue
      if (typeof e[k] === 'number' && Number.isFinite(e[k])) (eng as unknown as Record<string, number>)[k] = e[k] as number
    }
    const t = arr(e.table).map((r) => (Array.isArray(r) && r.length >= 2 ? ([num(r[0], 0), num(r[1], 0)] as [number, number]) : null)).filter((r): r is [number, number] => r !== null)
    if (t.length >= 2) eng.table = t
    m.engine = eng
  }
  if (raw.output === null) m.output = null
  else if (raw.output) {
    const o = obj(raw.output)
    if (o.kind === 'link') m.output = { kind: 'link', from: str(o.from), to: str(o.to) }
    else if (o.kind === 'slider') m.output = { kind: 'slider', point: str(o.point) }
    else if (o.kind === 'point') m.output = { kind: 'point', point: str(o.point), axis: o.axis === 'y' ? 'y' : 'x' }
  }
  const loads = arr(raw.loads).map((l) => { const o = obj(l); return { point: str(o.point), fx: num(o.fx, 0), fy: num(o.fy, 0) } }).filter((l) => l.point)
  if (loads.length) m.loads = loads
  return m
}

function cleanProgram(raw: unknown): MotionProgram {
  const laws: LawId[] = ['uniform', 'harmonic', 'cycloidal', 'trapezoid', 'poly345', 'poly4567']
  const segs: CamSegment[] = arr(obj(raw).segments).map((s) => {
    const o = obj(s)
    return { kind: oneOf(o.kind, ['dwell', 'rise', 'return'] as const, 'dwell'), beta: num(o.beta, 60), lift: num(o.lift, 0), law: oneOf(o.law, laws, 'cycloidal') }
  })
  return segs.length ? { segments: segs } : riseDwellReturn(20, 120, 40, 120)
}

function cleanCam(raw: Record<string, unknown>): CamDoc {
  const d = defaultCamDoc()
  const m: CamDoc = {
    ...d,
    name: str(raw.name, 'Untitled cam'),
    program: cleanProgram(raw.program),
    follower: oneOf(raw.follower, ['knife', 'roller', 'flat'] as const, d.follower),
    motion: oneOf(raw.motion, ['translating', 'swing'] as const, d.motion),
    baseRadius: num(raw.baseRadius, d.baseRadius),
    rollerRadius: num(raw.rollerRadius, d.rollerRadius),
    offset: num(raw.offset, 0),
    pivotDistance: num(raw.pivotDistance, d.pivotDistance),
    armLength: num(raw.armLength, d.armLength),
    direction: raw.direction === 'cw' ? 'cw' : 'ccw',
    bore: num(raw.bore, d.bore),
    maxPressure: num(raw.maxPressure, d.maxPressure),
  }
  if (typeof raw.notes === 'string') m.notes = raw.notes
  if (raw.compare) { const c = obj(raw.compare); m.compare = { label: str(c.label, 'Comparison'), program: cleanProgram(c.program) } }
  return m
}

function cleanGearSpec(raw: unknown, fallback: GearSpec): GearSpec {
  const o = obj(raw)
  const g: GearSpec = {
    z: Math.max(3, Math.round(num(o.z, fallback.z))), module: num(o.module, fallback.module), alpha: num(o.alpha, fallback.alpha), ha: num(o.ha, fallback.ha), x: num(o.x, fallback.x),
    backlash: num(o.backlash, fallback.backlash), fillet: num(o.fillet, fallback.fillet),
  }
  if (typeof o.hf === 'number' && Number.isFinite(o.hf)) g.hf = o.hf
  return g
}

function cleanGear(raw: Record<string, unknown>): GearDoc {
  const d = defaultGearDoc(str(raw.name, 'Untitled gears'))
  const pair = obj(raw.pair)
  const train = obj(raw.train)
  const pl = obj(raw.planetary)
  const he = obj(raw.helical)
  const be = obj(raw.belt)
  const members = ['sun', 'ring', 'carrier'] as const
  const stages: TrainStage[] = arr(train.stages).map((s) => {
    const o = obj(s)
    const st: TrainStage = { driver: Math.max(1, Math.round(num(o.driver, 20))), driven: Math.max(1, Math.round(num(o.driven, 40))) }
    if (o.mesh === 'internal' || o.mesh === 'bevel' || o.mesh === 'worm' || o.mesh === 'external') st.mesh = o.mesh
    if (o.shared === true) st.shared = true
    return st
  })
  const out: GearDoc = {
    name: d.name,
    view: oneOf(raw.view, ['pair', 'train', 'planetary', 'helical', 'belt'] as const, 'pair'),
    pair: {
      g1: cleanGearSpec(pair.g1, d.pair.g1), g2: cleanGearSpec(pair.g2, d.pair.g2), rpm: num(pair.rpm, d.pair.rpm), torque: num(pair.torque, d.pair.torque),
      ...(typeof pair.centre === 'number' && Number.isFinite(pair.centre) ? { centre: pair.centre } : {}),
    },
    train: { stages: stages.length ? stages : d.train.stages, rpm: num(train.rpm, d.train.rpm), torque: num(train.torque, d.train.torque), eff: num(train.eff, d.train.eff) },
    planetary: {
      Zs: Math.round(num(pl.Zs, d.planetary.Zs)), Zr: Math.round(num(pl.Zr, d.planetary.Zr)), n: Math.max(2, Math.round(num(pl.n, 3))), module: num(pl.module, d.planetary.module),
      fixed: oneOf(pl.fixed, members, 'ring'), input: oneOf(pl.input, members, 'sun'), speed: num(pl.speed, d.planetary.speed),
    },
    helical: { mn: num(he.mn, 2), z1: Math.round(num(he.z1, 24)), z2: Math.round(num(he.z2, 48)), beta: num(he.beta, 15), alphaN: num(he.alphaN, 20), width: num(he.width, 30) },
    belt: {
      kind: be.kind === 'chain' ? 'chain' : 'belt', D: num(be.D, 200), d: num(be.d, 80), C: num(be.C, 400), rpm: num(be.rpm, 1450), crossed: bool(be.crossed),
      N1: Math.round(num(be.N1, 17)), N2: Math.round(num(be.N2, 41)), pitch: num(be.pitch, 12.7),
    },
  }
  if (typeof raw.notes === 'string') out.notes = raw.notes
  return out
}

export class KMechFileError extends Error {}

/** Reads a .kmech file's text. */
export function parseKMech(text: string): KMechDoc {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new KMechFileError('This is not a kMech file (the text is not valid JSON).') }
  const o = obj(raw)
  if (o.format !== 'kmech') throw new KMechFileError('This is not a kMech file (its "format" is not "kmech").')
  if (typeof o.version === 'number' && o.version > 1) throw new KMechFileError(`This file was made by a newer kMech (version ${o.version}).`)
  const model = obj(o.model)
  switch (o.workbench) {
    case 'linkage': return { workbench: 'linkage', model: cleanLinkage(model) }
    case 'cam': return { workbench: 'cam', model: cleanCam(model) }
    case 'gear': return { workbench: 'gear', model: cleanGear(model) }
    default: throw new KMechFileError('The file does not say which workbench it belongs to (linkage, cam or gear).')
  }
}

/** Problems that stop a linkage from being analysed, as friendly sentences. */
export function linkageProblems(m: Linkage): string[] {
  const s = compile(m)
  const out = [...s.errors]
  if (!m.driver && m.points.length) out.push('There is no driver: pick the crank (Driver tool) to animate and analyse.')
  return out
}
