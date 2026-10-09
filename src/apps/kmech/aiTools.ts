// AI tools of kMech (the manifest is src/os/ai/manifests/kmech.ts). Written against a small set of hooks the
// window provides, so the logic can be tested without a browser.

import type { AppToolContext, useAppTools } from '@/os/ai/appTools'
import { analyseCycle, defaultOutput, describeOutput, fourBarOf, type Cycle } from './analysis.ts'
import { camProfile, optimiseBaseRadius, programLevels, programTable } from './cam.ts'
import { defaultGearDoc, docName, parseKMech, serializeKMech, type GearDoc, type KMechDoc, type LinkageDoc } from './doc.ts'
import { classifyFourBar, type FourBarLengths } from './fourbar.ts'
import {
  beltDrive, chainDrive, DEFAULT_GEAR, gearTrain, helicalContact, helicalGear, pairGeometry, planetary, planetarySpeeds, planetaryTable, rackPinion, wormGear, bevelPair, moduleFromDP,
  type GearSpec, type Member, type TrainStage,
} from './gear.ts'
import { EXAMPLES, fourBarDoc, sliderCrankDoc } from './examples.ts'
import { fmt, deg } from './math.ts'

type Tools = Parameters<typeof useAppTools>[1]

export interface Hooks {
  state(): { doc: KMechDoc; dirty: boolean; path: string | null }
  /** Replace the open document with this one (it is shown right away). */
  load(doc: KMechDoc, path?: string | null): void
}

const num = (v: unknown, name: string, fallback?: number): number => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if ((n === undefined || n === null || n === '') && fallback !== undefined) return fallback
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`${name} must be a number.`)
  return n
}
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const r = (v: number, d = 4): number => (Number.isFinite(v) ? Number(v.toPrecision(d + 2)) : v)

/** The cycle as the rows the AI reads: every `stepDeg` degrees of input. */
export function cycleTable(c: Cycle, stepDeg: number) {
  const out: Array<Record<string, number | null>> = []
  if (!c.ok || c.theta.length < 2) return out
  const span = c.theta[c.theta.length - 1] - c.theta[0]
  const every = Math.max(1, Math.round((stepDeg / Math.max(1e-9, span)) * (c.theta.length - 1)))
  for (let i = 0; i < c.theta.length; i += every) {
    out.push({
      input_deg: r(c.theta[i], 4), output: r(c.pos[i]), velocity: r(c.vel[i]), acceleration: r(c.acc[i]), transmission_deg: c.mu[i] === null ? null : r(c.mu[i] as number, 3),
      mechanical_advantage: Number.isFinite(c.ma[i]) ? r(c.ma[i], 3) : null,
    })
  }
  return out
}

/** What the AI sees of a cycle analysis. */
export function describeCycle(doc: LinkageDoc, c: Cycle, stepDeg = 15) {
  const fb = fourBarOf(doc)
  const g = fb ? classifyFourBar(fb) : null
  if (!c.ok) return { ok: false, message: c.message ?? 'The mechanism could not be analysed.', degrees_of_freedom: c.dof }
  const s = c.summary
  return {
    ok: true,
    name: doc.name,
    four_bar: fb ? { ...fb, class: g!.label, kind: g!.kind, margin: r(g!.margin), input_full_turn: g!.inputFullTurn, output_full_turn: g!.outputFullTurn } : undefined,
    degrees_of_freedom: c.dof,
    input_range: c.range.full ? 'full turn' : { min_deg: r(deg(c.range.min), 5), max_deg: r(deg(c.range.max), 5) },
    rpm: c.rpm,
    output: c.output ? { what: describeOutput(doc, c.output), unit: c.outputUnit === 'deg' ? 'degrees (velocity deg/s)' : 'mm (velocity mm/s)', min: r(s.outMin), max: r(s.outMax), range_of_motion: r(s.span) } : null,
    peak_velocity: r(s.peakVel),
    peak_acceleration: r(s.peakAcc),
    transmission_angle_deg: s.muMin === null ? null : { min: r(s.muMin, 3), max: r(s.muMax ?? 0, 3), share_within_40_140: s.muGoodShare === null ? null : r(s.muGoodShare, 3) },
    quick_return: s.quickReturn ? { ratio: r(s.quickReturn.ratio, 5), forward_deg: r(s.quickReturn.forwardDeg, 5), return_deg: r(s.quickReturn.returnDeg, 5) } : null,
    dead_centres_deg: s.deadCentres.slice(0, 6).map((d) => r(d, 4)),
    table: cycleTable(c, stepDeg),
  }
}

/** The mechanism a call asks about: its own spec, or the open one. */
export function linkageFromArgs(a: Record<string, unknown>, open: KMechDoc): LinkageDoc {
  if (a.example !== undefined && a.example !== null && String(a.example) !== '') {
    const e = EXAMPLES.find((x) => x.id === String(a.example))
    if (!e || e.doc.workbench !== 'linkage') throw new Error(`No linkage example "${String(a.example)}". Examples: ${EXAMPLES.filter((x) => x.doc.workbench === 'linkage').map((x) => x.id).join(', ')}.`)
    return e.doc.model
  }
  if (a.four_bar && typeof a.four_bar === 'object') {
    const f = obj(a.four_bar)
    const g: FourBarLengths = { a: num(f.input ?? f.a, 'four_bar.input'), b: num(f.coupler ?? f.b, 'four_bar.coupler'), c: num(f.output ?? f.c, 'four_bar.output'), d: num(f.ground ?? f.d, 'four_bar.ground') }
    const k = classifyFourBar(g)
    if (k.kind === 'invalid') throw new Error(k.problem ?? 'These lengths cannot make a four-bar.')
    const cp = Array.isArray(f.coupler_point) ? ([num(f.coupler_point[0], 'coupler_point[0]'), num(f.coupler_point[1], 'coupler_point[1]')] as [number, number]) : undefined
    const start = num(f.start_deg, 'start_deg', 45)
    // start at an input angle the linkage can reach: try a few
    for (const th of [start, 30, 60, 90, 120, 150, 10]) {
      try {
        const doc = fourBarDoc('Four-bar', g, th, { coupler: cp, rpm: num(f.rpm, 'four_bar.rpm', 30) })
        return doc
      } catch { /* try the next angle */ }
    }
    throw new Error('This four-bar cannot be assembled at any of the usual start angles.')
  }
  if (a.slider_crank && typeof a.slider_crank === 'object') {
    const s = obj(a.slider_crank)
    const rr = num(s.crank ?? s.r, 'slider_crank.crank')
    const l = num(s.rod ?? s.l, 'slider_crank.rod')
    if (!(l > rr)) throw new Error('The rod must be longer than the crank.')
    return sliderCrankDoc('Slider-crank', rr, l, 40, num(s.rpm, 'slider_crank.rpm', 60))
  }
  if (a.linkage && typeof a.linkage === 'object') {
    const d = parseKMech(JSON.stringify({ format: 'kmech', version: 1, workbench: 'linkage', model: a.linkage }))
    if (d.workbench !== 'linkage') throw new Error('Not a linkage.')
    return d.model
  }
  if (open.workbench !== 'linkage') throw new Error('The open document is not a linkage: give four_bar, slider_crank, linkage or example, or open a linkage first.')
  return open.model
}

const GEAR_KINDS = ['spur_pair', 'train', 'planetary', 'helical', 'belt', 'chain', 'rack', 'worm', 'bevel'] as const

export function gearCalculation(kind: string, p: Record<string, unknown>) {
  const spec = (z: number, x: number): GearSpec => ({
    ...DEFAULT_GEAR, z: Math.round(z), module: p.module !== undefined ? num(p.module, 'module') : p.diametral_pitch !== undefined ? moduleFromDP(num(p.diametral_pitch, 'diametral_pitch')) : 2,
    alpha: num(p.alpha, 'alpha', 20), x, backlash: num(p.backlash, 'backlash', 0), ha: num(p.addendum, 'addendum', 1),
  })
  switch (kind) {
    case 'spur_pair': {
      const g = pairGeometry(spec(num(p.z1, 'z1', 20), num(p.x1, 'x1', 0)), spec(num(p.z2, 'z2', 40), num(p.x2, 'x2', 0)), p.centre !== undefined ? num(p.centre, 'centre') : undefined)
      const one = (q: typeof g.g1) => ({ teeth: q.z, pitch_diameter: r(q.d), base_diameter: r(q.db), tip_diameter: r(q.da), root_diameter: r(q.df), tooth_thickness_at_pitch: r(q.s), top_land: r(q.sa), min_teeth_no_undercut: r(q.zMin, 3), undercut: q.undercut })
      return {
        module: g.g1.m, pressure_angle: g.g1.spec.alpha, ratio: r(g.ratio), centre_distance_standard: r(g.a0), centre_distance_working: r(g.aw), working_pressure_angle_deg: r(deg(g.alphaW)),
        contact_ratio: r(g.epsilon), backlash: r(g.backlash), interference: g.interference, gear1: one(g.g1), gear2: one(g.g2), warnings: g.warnings,
      }
    }
    case 'train': {
      const raw = Array.isArray(p.stages) ? p.stages : []
      if (!raw.length) throw new Error('train needs stages: a list of [driver teeth, driven teeth] pairs, e.g. [[18,54],[20,60]].')
      const stages: TrainStage[] = raw.map((s, i) => {
        if (Array.isArray(s)) return { driver: num(s[0], `stages[${i}][0]`), driven: num(s[1], `stages[${i}][1]`) }
        const o = obj(s)
        return { driver: num(o.driver, `stages[${i}].driver`), driven: num(o.driven, `stages[${i}].driven`), ...(o.mesh === 'internal' || o.mesh === 'worm' || o.mesh === 'bevel' ? { mesh: o.mesh } : {}), ...(o.shared === true ? { shared: true } : {}) }
      })
      const t = gearTrain(stages, num(p.rpm, 'rpm', 1000), num(p.torque, 'torque', 1), num(p.efficiency, 'efficiency', 0.98))
      return { ratio: r(t.ratio), reduction: r(t.reduction), efficiency: r(t.efficiency), shafts: t.rows.map((x) => ({ shaft: x.shaft, gears: x.teeth, rpm: r(x.rpm), torque_Nm: r(x.torque), power_W: r(x.power) })) }
    }
    case 'planetary': {
      const pl = planetary(Math.round(num(p.sun, 'sun', 24)), Math.round(num(p.ring, 'ring', 72)), Math.round(num(p.planets, 'planets', 3)))
      const members = ['sun', 'ring', 'carrier'] as const
      const fixed = (members.includes(p.fixed as Member) ? p.fixed : 'ring') as Member
      const input = (members.includes(p.input as Member) ? p.input : 'sun') as Member
      const sp = planetarySpeeds(pl, fixed, input, num(p.speed, 'speed', 1000))
      return {
        sun_teeth: pl.Zs, ring_teeth: pl.Zr, planet_teeth: pl.integerPlanet ? pl.Zp : null, assembles: pl.assembles, planets_clear: pl.neighbours, problems: pl.messages,
        fixed, input, speeds_rpm: sp ? { sun: r(sp.sun), ring: r(sp.ring), carrier: r(sp.carrier), planet: r(sp.planet) } : null,
        ratios: planetaryTable(pl).map((x) => ({ fixed: x.fixed, input: x.input, output: x.output, ratio: Number.isFinite(x.ratio) ? r(x.ratio) : null })),
      }
    }
    case 'helical': {
      const mn = num(p.module, 'module', 2); const b = num(p.helix_deg, 'helix_deg', 15); const an = num(p.alpha, 'alpha', 20)
      const z1 = Math.round(num(p.z1, 'z1', 24)); const z2 = Math.round(num(p.z2, 'z2', 48))
      const h1 = helicalGear(mn, z1, b, an); const h2 = helicalGear(mn, z2, b, an)
      const c = helicalContact(z1, z2, mn, b, an, num(p.width, 'width', 30))
      return { transverse_module: r(h1.mt), transverse_pressure_angle_deg: r(deg(h1.alphaT)), pitch_diameters: [r(h1.d), r(h2.d)], centre_distance: r(c.centre), virtual_teeth: [r(h1.zv, 3), r(h2.zv, 3)], contact_ratio: { transverse: r(c.epsAlpha), face: r(c.epsBeta), total: r(c.total) } }
    }
    case 'belt': {
      const b = beltDrive(num(p.large_diameter, 'large_diameter', 200), num(p.small_diameter, 'small_diameter', 80), num(p.centre, 'centre', 400), num(p.rpm_small, 'rpm_small', 1450), p.crossed === true)
      if (!b) throw new Error('These pulleys cannot be joined by a belt on that centre distance.')
      return { ratio: r(b.ratio), belt_length: r(b.length), wrap_small_deg: r(b.wrapSmall), belt_speed_ms: r(b.speed) }
    }
    case 'chain': {
      const c = chainDrive(Math.round(num(p.teeth1, 'teeth1', 17)), Math.round(num(p.teeth2, 'teeth2', 41)), num(p.pitch, 'pitch', 12.7), num(p.centre, 'centre', 400), num(p.rpm1, 'rpm1', 1000))
      if (!c) throw new Error('Check the sprocket teeth (at least 6), the pitch and the centre distance.')
      return { ratio: r(c.ratio), links: c.links, centre_distance: r(c.centre), chain_speed_ms: r(c.speed) }
    }
    case 'rack': {
      const k = rackPinion(num(p.module, 'module', 2), Math.round(num(p.z, 'z', 20)), num(p.rpm, 'rpm', 60))
      return { travel_per_revolution: r(k.travelPerRev), speed_mm_s: r(k.speed), pinion_pitch_radius: r(k.pitchRadius) }
    }
    case 'worm': {
      const w = wormGear(Math.round(num(p.starts, 'starts', 1)), Math.round(num(p.wheel_teeth, 'wheel_teeth', 40)), num(p.module, 'module', 2), num(p.worm_diameter, 'worm_diameter', 28), num(p.alpha, 'alpha', 20), num(p.friction, 'friction', 0.05))
      return { ratio: r(w.ratio), lead_angle_deg: r(w.leadAngle), efficiency: r(w.efficiency), self_locking: w.selfLocking, centre_distance: r(w.centre), lead: r(w.lead) }
    }
    case 'bevel': {
      const b = bevelPair(Math.round(num(p.z1, 'z1', 20)), Math.round(num(p.z2, 'z2', 40)), num(p.shaft_angle_deg, 'shaft_angle_deg', 90))
      return { ratio: r(b.ratio), pitch_cone_angles_deg: [r(b.delta1), r(b.delta2)] }
    }
    default:
      throw new Error(`kind must be one of ${GEAR_KINDS.join(', ')}.`)
  }
}

/** What the AI sees of the open document. */
export function describeDoc(doc: KMechDoc, dirty: boolean, path: string | null) {
  const base = { workbench: doc.workbench, name: docName(doc), unsaved_changes: dirty, file: path }
  if (doc.workbench === 'linkage') {
    const m = doc.model
    const c = analyseCycle(m, { steps: 90, output: m.output })
    const fb = fourBarOf(m)
    return {
      ...base,
      points: m.points.map((p) => ({ id: p.id, x: r(p.x), y: r(p.y), ...(p.ground ? { ground: true } : {}), ...(p.tracer ? { tracer: true } : {}) })),
      links: m.links.map((l) => ({ id: l.id, points: l.pts })),
      sliders: m.sliders.map((s) => ({ id: s.id, point: s.point, line: s.line })),
      driver: m.driver,
      four_bar: fb ? { ...fb, class: classifyFourBar(fb).label } : undefined,
      engine: m.engine ? { bore: m.engine.bore, stroke: m.engine.stroke, rpm: m.engine.rpm, cylinders: m.engine.cylinders } : undefined,
      analysis: c.ok ? { input_range: c.range.full ? 'full turn' : `${fmt(deg(c.range.min), 5)}° … ${fmt(deg(c.range.max), 5)}°`, output: c.output ? describeOutput(m, c.output) : (defaultOutput(m) ? describeOutput(m, defaultOutput(m)!) : null), range_of_motion: r(c.summary.span) } : { problem: c.message },
      notes: m.notes,
    }
  }
  if (doc.workbench === 'cam') {
    const m = doc.model
    const p = camProfile(m, 360)
    const t = programTable(m.program, 360)
    return {
      ...base,
      follower: `${m.follower} ${m.motion}`, base_radius: m.baseRadius, roller_radius: m.follower === 'roller' ? m.rollerRadius : undefined, offset: m.offset,
      segments: m.program.segments, total_angle: programLevels(m.program).total,
      peaks: { lift: r(t.peakS), velocity_per_rad: r(t.peakV), acceleration_per_rad2: r(t.peakA), jerk_per_rad3: r(t.peakJ) },
      max_pressure_angle_deg: r(p.stats.maxPressure, 3), min_radius_of_curvature: Number.isFinite(p.stats.minRho) ? r(p.stats.minRho) : null,
      smallest_base_circle: r(optimiseBaseRadius(m).baseRadius),
      warnings: p.warnings.map((w) => w.message),
    }
  }
  const m = doc.model
  return { ...base, view: m.view, ...(m.view === 'pair' ? { pair: gearCalculation('spur_pair', { z1: m.pair.g1.z, z2: m.pair.g2.z, module: m.pair.g1.module, alpha: m.pair.g1.alpha, x1: m.pair.g1.x, x2: m.pair.g2.x }) } : {}), notes: m.notes }
}

/** The gear document that shows a calculation: the open gears with this kind's inputs filled in. */
export function showGear(kind: string, p: Record<string, unknown>, base: GearDoc): GearDoc {
  const d: GearDoc = JSON.parse(JSON.stringify(base)) as GearDoc
  const spec = (z: number, x: number): GearSpec => ({
    ...DEFAULT_GEAR, z: Math.round(z), module: p.module !== undefined ? num(p.module, 'module') : 2, alpha: num(p.alpha, 'alpha', 20), x, backlash: num(p.backlash, 'backlash', 0), ha: num(p.addendum, 'addendum', 1),
  })
  switch (kind) {
    case 'spur_pair':
      d.view = 'pair'
      d.pair.g1 = spec(num(p.z1, 'z1', 20), num(p.x1, 'x1', 0)); d.pair.g2 = spec(num(p.z2, 'z2', 40), num(p.x2, 'x2', 0))
      if (p.centre !== undefined) d.pair.centre = num(p.centre, 'centre'); else delete d.pair.centre
      break
    case 'train':
      d.view = 'train'
      d.train.stages = (Array.isArray(p.stages) ? p.stages : []).map((x, i) => (Array.isArray(x) ? { driver: num(x[0], `stages[${i}][0]`), driven: num(x[1], `stages[${i}][1]`) } : { driver: num(obj(x).driver, 'driver'), driven: num(obj(x).driven, 'driven') }))
      if (!d.train.stages.length) throw new Error('train needs stages.')
      d.train.rpm = num(p.rpm, 'rpm', d.train.rpm); d.train.torque = num(p.torque, 'torque', d.train.torque)
      break
    case 'planetary':
      d.view = 'planetary'
      d.planetary.Zs = Math.round(num(p.sun, 'sun', 24)); d.planetary.Zr = Math.round(num(p.ring, 'ring', 72)); d.planetary.n = Math.round(num(p.planets, 'planets', 3)); d.planetary.speed = num(p.speed, 'speed', 1000)
      if (p.fixed === 'sun' || p.fixed === 'ring' || p.fixed === 'carrier') d.planetary.fixed = p.fixed
      if (p.input === 'sun' || p.input === 'ring' || p.input === 'carrier') d.planetary.input = p.input
      break
    case 'helical':
      d.view = 'helical'
      d.helical = { mn: num(p.module, 'module', 2), z1: Math.round(num(p.z1, 'z1', 24)), z2: Math.round(num(p.z2, 'z2', 48)), beta: num(p.helix_deg, 'helix_deg', 15), alphaN: num(p.alpha, 'alpha', 20), width: num(p.width, 'width', 30) }
      break
    case 'belt': case 'chain':
      d.view = 'belt'
      d.belt = { ...d.belt, kind: kind === 'chain' ? 'chain' : 'belt', D: num(p.large_diameter, 'large_diameter', d.belt.D), d: num(p.small_diameter, 'small_diameter', d.belt.d), C: num(p.centre, 'centre', d.belt.C), crossed: p.crossed === true,
        N1: Math.round(num(p.teeth1, 'teeth1', d.belt.N1)), N2: Math.round(num(p.teeth2, 'teeth2', d.belt.N2)), pitch: num(p.pitch, 'pitch', d.belt.pitch) }
      break
    default:
      throw new Error('Only spur_pair, train, planetary, helical, belt and chain can be shown in the Gears workbench.')
  }
  return d
}

export function kmechTools(h: Hooks): Tools {
  const replace = async (doc: KMechDoc, ctx: AppToolContext, what: string) => {
    if (h.state().dirty && !(await ctx.confirm(`Replace the open kMech document with ${what}?`, 'The open document has unsaved changes that would be lost.'))) throw new Error('The user kept the open document.')
    h.load(doc, null)
  }
  return {
    get_state: async () => {
      const s = h.state()
      return describeDoc(s.doc, s.dirty, s.path)
    },

    analyse: async (a, ctx) => {
      const s = h.state()
      const m = linkageFromArgs(a, s.doc)
      const step = num(a.step_deg, 'step_deg', 15)
      if (!(step > 0)) throw new Error('step_deg must be positive.')
      const c = analyseCycle(m, { steps: 360, output: m.output })
      if (a.show === true && (a.four_bar || a.slider_crank || a.linkage || a.example)) await replace({ workbench: 'linkage', model: m }, ctx, m.name)
      return describeCycle(m, c, step)
    },

    gear: async (a, ctx) => {
      const kind = String(a.kind ?? 'spur_pair')
      const out = gearCalculation(kind, obj(a.params))
      if (a.show === true) {
        const cur = h.state().doc
        const doc = showGear(kind, obj(a.params), cur.workbench === 'gear' ? cur.model : defaultGearDoc('Gears from the AI'))
        await replace({ workbench: 'gear', model: doc }, ctx, 'these gears')
      }
      return out
    },

    load_example: async (a, ctx) => {
      const id = String(a.id ?? '').trim()
      if (!id) return { examples: EXAMPLES.map((e) => ({ id: e.id, title: e.title, workbench: e.doc.workbench, group: e.group, description: e.description })) }
      const e = EXAMPLES.find((x) => x.id === id)
      if (!e) throw new Error(`No example "${id}". Examples: ${EXAMPLES.map((x) => x.id).join(', ')}.`)
      await replace(parseKMech(serializeKMech(e.doc)), ctx, e.title)
      return { loaded: e.title, ...describeDoc(e.doc, false, null) }
    },
  }
}
