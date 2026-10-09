// Gears (pure): involute spur-gear geometry and outlines, pairs (centre distance, contact ratio, interference),
// helical basics, gear trains, planetary (epicyclic) sets with the Willis equation, rack and pinion, bevel and
// worm ratios, belt and chain drives.

import { deg, rad, TAU, wrapPi, type Pt } from './math.ts'

// ------------------------------------------------------------------------------ involute

/** inv α = tan α − α (radians) */
export const inv = (a: number): number => Math.tan(a) - a

/** The angle whose involute is v (Newton's method). */
export function invInverse(v: number): number {
  if (v <= 0) return 0
  let a = Math.cbrt(3 * v) // a good start for small values
  if (a > 1.4) a = 1.4
  for (let i = 0; i < 60; i++) {
    const f = Math.tan(a) - a - v
    const df = Math.tan(a) ** 2
    if (df < 1e-14) break
    const step = f / df
    a -= step
    if (Math.abs(step) < 1e-15) break
  }
  return a
}

export interface GearSpec {
  /** number of teeth (positive); use `internal` for ring gears */
  z: number
  /** module, mm (diametral pitch 25.4/m) */
  module: number
  /** pressure angle, degrees (14.5, 20 or 25) */
  alpha: number
  /** addendum coefficient (1 for full depth, 0.8 stub) */
  ha: number
  /** dedendum coefficient; default ha + c* with c* = 0.25 */
  hf?: number
  /** profile shift coefficient x (addendum modification) */
  x: number
  /** circumferential backlash of the pair, mm; each gear's tooth is thinned by half of it at the pitch circle */
  backlash: number
  /** root fillet radius, in modules (0.38 is the standard tool radius) */
  fillet: number
}

export const DEFAULT_GEAR: GearSpec = { z: 20, module: 2, alpha: 20, ha: 1, x: 0, backlash: 0, fillet: 0.38 }

/** Diametral pitch (teeth per inch) to module. */
export const moduleFromDP = (dp: number): number => 25.4 / dp
export const dpFromModule = (m: number): number => 25.4 / m

export interface GearGeometry {
  spec: GearSpec
  m: number
  z: number
  alpha: number
  /** pitch (reference) diameter */
  d: number
  db: number
  da: number
  df: number
  rb: number
  ra: number
  rf: number
  /** circular pitch π·m */
  p: number
  /** base pitch π·m·cos α */
  pb: number
  /** tooth thickness at the pitch circle (after backlash), mm */
  s: number
  /** tooth thickness at the tip, mm (≤ 0: pointed) */
  sa: number
  /** whole depth */
  h: number
  /** minimum number of teeth without undercut at this addendum and pressure angle (2·ha/sin²α) */
  zMin: number
  /** smallest profile shift without undercut */
  xMin: number
  undercut: boolean
  pointed: boolean
  /** fillet radius, mm (reduced when the base circle leaves no room) */
  filletRadius: number
  /** the involute starts at this radius (max of base and root circles), mm */
  rStart: number
}

export function gearGeometry(spec: GearSpec): GearGeometry {
  const a = rad(spec.alpha)
  const m = spec.module
  const z = spec.z
  const d = m * z
  const r = d / 2
  const hf = spec.hf ?? spec.ha + 0.25
  const rb = r * Math.cos(a)
  const ra = r + (spec.ha + spec.x) * m
  const rf = r - (hf - spec.x) * m
  const s = m * (Math.PI / 2 + 2 * spec.x * Math.tan(a)) - spec.backlash / 2
  const aa = ra > rb ? Math.acos(rb / ra) : 0
  const sa = 2 * ra * (s / d + inv(a) - inv(aa))
  const zMin = (2 * spec.ha) / Math.sin(a) ** 2
  const xMin = spec.ha - (z * Math.sin(a) ** 2) / 2
  let fr = spec.fillet * m
  if (rb > rf && rf > 0) fr = Math.min(fr, (rb * rb - rf * rf) / (2 * rf))
  if (rb <= rf) fr = 0
  return {
    spec, m, z, alpha: a, d, db: 2 * rb, da: 2 * ra, df: 2 * rf, rb, ra, rf, p: Math.PI * m, pb: Math.PI * m * Math.cos(a), s, sa, h: ra - rf,
    zMin, xMin, undercut: spec.x < xMin - 1e-9, pointed: sa <= 1e-9, filletRadius: Math.max(0, fr), rStart: Math.max(rb, rf),
  }
}

export interface PairGeometry {
  g1: GearGeometry
  g2: GearGeometry
  ratio: number
  /** standard centre distance m (z1 + z2)/2 */
  a0: number
  /** working centre distance */
  aw: number
  /** working pressure angle, radians */
  alphaW: number
  /** transverse contact ratio */
  epsilon: number
  /** length of the path of contact, mm */
  pathOfContact: number
  /** circumferential backlash at the working pitch circles, mm */
  backlash: number
  /** the tip of one gear cuts into the root of the other */
  interference: boolean
  warnings: string[]
}

/** A meshing pair on the centre distance given (or the one the profile shifts imply). */
export function pairGeometry(s1: GearSpec, s2: GearSpec, centre?: number): PairGeometry {
  const g1 = gearGeometry(s1)
  const g2 = gearGeometry(s2)
  const warnings: string[] = []
  if (Math.abs(s1.module - s2.module) > 1e-9) warnings.push('The two gears must have the same module to mesh.')
  if (Math.abs(s1.alpha - s2.alpha) > 1e-9) warnings.push('The two gears must have the same pressure angle to mesh.')
  const a = g1.alpha
  const m = g1.m
  const a0 = (m * (g1.z + g2.z)) / 2
  let aw: number
  let alphaW: number
  if (centre && centre > 0) {
    aw = centre
    alphaW = Math.acos(Math.min(1, (a0 * Math.cos(a)) / aw))
  } else {
    alphaW = invInverse(inv(a) + (2 * (s1.x + s2.x) * Math.tan(a)) / (g1.z + g2.z))
    aw = (a0 * Math.cos(a)) / Math.cos(alphaW)
  }
  const t1 = Math.sqrt(Math.max(0, g1.ra ** 2 - g1.rb ** 2))
  const t2 = Math.sqrt(Math.max(0, g2.ra ** 2 - g2.rb ** 2))
  const path = t1 + t2 - aw * Math.sin(alphaW)
  const epsilon = path / g1.pb
  // tooth thickness at the working pitch circles
  const rw1 = g1.rb / Math.cos(alphaW)
  const rw2 = g2.rb / Math.cos(alphaW)
  const sw = (g: GearGeometry, rw: number) => g.s * (rw / (g.d / 2)) - 2 * rw * (inv(alphaW) - inv(g.alpha))
  const pw = (TAU * rw1) / g1.z
  const backlash = pw - sw(g1, rw1) - sw(g2, rw2)
  // interference: the other gear's tip passes beyond the tangent point of the base circle
  const lim1 = aw * Math.sin(alphaW) // distance from T1 to T2 along the line of action
  const interference = t2 > lim1 + 1e-9 || t1 > lim1 + 1e-9
  if (interference) warnings.push('Tip interference: a gear’s tip reaches beyond the tangent point of the other base circle. Use fewer-tooth shifts (profile shift) or shorter addendums.')
  if (epsilon < 1.2) warnings.push(`The contact ratio is ${epsilon.toFixed(2)}: below 1.2 the meshing is rough; aim for 1.4 or more.`)
  if (g1.undercut) warnings.push(`Gear 1 (${g1.z} teeth) is undercut: needs at least ${Math.ceil(g1.zMin)} teeth, or a profile shift of ${g1.xMin.toFixed(2)}.`)
  if (g2.undercut) warnings.push(`Gear 2 (${g2.z} teeth) is undercut: needs at least ${Math.ceil(g2.zMin)} teeth, or a profile shift of ${g2.xMin.toFixed(2)}.`)
  if (g1.pointed || g2.pointed) warnings.push('A tooth is pointed at the tip: reduce the profile shift or the addendum.')
  if (backlash < -1e-6) warnings.push('Negative backlash: the teeth are jammed at this centre distance.')
  return { g1, g2, ratio: g2.z / g1.z, a0, aw, alphaW, epsilon, pathOfContact: path, backlash, interference, warnings }
}

// ------------------------------------------------------------------------------ outlines

/** Half the angular thickness of a tooth at radius r (radians). */
function halfAngle(g: GearGeometry, r: number): number {
  const ar = r > g.rb ? Math.acos(g.rb / r) : 0
  return g.s / g.d + inv(g.alpha) - inv(ar)
}

/** The closed outline of a gear centred on the origin, tooth 0 centred on the +x axis, counter-clockwise. */
export function gearOutline(g: GearGeometry, nInvolute = 12, nFillet = 5, nRoot = 4): Pt[] {
  const z = g.z
  const step = TAU / z
  // flank from the tip down to the root: points as (radius, half-angle) pairs, left side (angle = centre + ψ)
  const left: Array<[number, number]> = []
  for (let k = 0; k <= nInvolute; k++) {
    const r = g.ra + ((g.rStart - g.ra) * k) / nInvolute
    left.push([r, halfAngle(g, r)])
  }
  let rootAngle = halfAngle(g, g.rStart)
  if (g.rb > g.rf && g.filletRadius > 1e-9) {
    const rho = g.filletRadius
    const psiB = halfAngle(g, g.rb)
    const rc = g.rf + rho
    const delta = Math.asin(Math.min(1, rho / rc))
    const rT = rc * Math.cos(delta)
    // polar → xy for the left side (angle ψ from the tooth centre line)
    const toXY = (r: number, ang: number): Pt => ({ x: r * Math.cos(ang), y: r * Math.sin(ang) })
    const C = toXY(rc, psiB + delta)
    const T1 = toXY(rT, psiB)
    const T2 = toXY(g.rf, psiB + delta)
    const a1 = Math.atan2(T1.y - C.y, T1.x - C.x)
    const a2 = Math.atan2(T2.y - C.y, T2.x - C.x)
    const da = wrapPi(a2 - a1)
    for (let k = 0; k <= nFillet; k++) {
      const an = a1 + (da * k) / nFillet
      const p = { x: C.x + rho * Math.cos(an), y: C.y + rho * Math.sin(an) }
      left.push([Math.hypot(p.x, p.y), Math.atan2(p.y, p.x)])
    }
    rootAngle = psiB + delta
  } else if (g.rb > g.rf) {
    // no fillet: straight down the radial line to the root circle
    left.push([g.rf, halfAngle(g, g.rb)])
    rootAngle = halfAngle(g, g.rb)
  }
  const out: Pt[] = []
  for (let i = 0; i < z; i++) {
    const c = i * step
    // right flank, root to tip (mirror of the left list, reversed)
    for (let k = left.length - 1; k >= 0; k--) {
      const [r, psi] = left[k]
      out.push({ x: r * Math.cos(c - psi), y: r * Math.sin(c - psi) })
    }
    // left flank, tip to root
    for (let k = 0; k < left.length; k++) {
      const [r, psi] = left[k]
      out.push({ x: r * Math.cos(c + psi), y: r * Math.sin(c + psi) })
    }
    // the root arc to the next tooth
    const a0 = c + rootAngle
    const a1 = c + step - rootAngle
    if (a1 > a0 + 1e-9) {
      for (let k = 1; k < nRoot; k++) {
        const an = a0 + ((a1 - a0) * k) / nRoot
        out.push({ x: g.rf * Math.cos(an), y: g.rf * Math.sin(an) })
      }
    }
  }
  // the tip land is a straight chord between the two tip points (the arc is short)
  return out
}

/** Rotate points about the origin and move them. */
export function placePoints(pts: readonly Pt[], angle: number, at: Pt = { x: 0, y: 0 }): Pt[] {
  const c = Math.cos(angle); const s = Math.sin(angle)
  return pts.map((p) => ({ x: at.x + c * p.x - s * p.y, y: at.y + s * p.x + c * p.y }))
}

/** Gear rotation angles (radians) for a meshing animation: gear 1 at the origin turned by `phi1`, gear 2 on the +x axis. */
export function meshAngles(g1: GearGeometry, g2: GearGeometry, phi1: number): { phi1: number; phi2: number } {
  return { phi1, phi2: Math.PI + Math.PI / g2.z - (g1.z / g2.z) * phi1 }
}

// ------------------------------------------------------------------------------ helical

export interface HelicalGear {
  mn: number
  mt: number
  z: number
  beta: number
  alphaN: number
  alphaT: number
  d: number
  db: number
  da: number
  df: number
  /** axial pitch */
  px: number
  /** lead */
  lead: number
  /** virtual number of teeth z / cos³β (for strength and undercut) */
  zv: number
  /** minimum teeth without undercut in the transverse plane */
  zMin: number
}

export function helicalGear(mn: number, z: number, betaDeg: number, alphaNDeg = 20): HelicalGear {
  const b = rad(betaDeg)
  const an = rad(alphaNDeg)
  const mt = mn / Math.cos(b)
  const at = Math.atan(Math.tan(an) / Math.cos(b))
  const d = mt * z
  return {
    mn, mt, z, beta: b, alphaN: an, alphaT: at, d, db: d * Math.cos(at), da: d + 2 * mn, df: d - 2.5 * mn, px: Math.abs(b) < 1e-12 ? Infinity : (Math.PI * mt) / Math.tan(b),
    lead: Math.abs(b) < 1e-12 ? Infinity : (Math.PI * d) / Math.tan(b), zv: z / Math.cos(b) ** 3, zMin: (2 * Math.cos(b)) / Math.sin(at) ** 2,
  }
}

/** Contact ratios of a helical pair of width b: transverse, face (overlap) and total. */
export function helicalContact(z1: number, z2: number, mn: number, betaDeg: number, alphaNDeg: number, widthMm: number): { epsAlpha: number; epsBeta: number; total: number; centre: number } {
  const g1 = helicalGear(mn, z1, betaDeg, alphaNDeg)
  const g2 = helicalGear(mn, z2, betaDeg, alphaNDeg)
  const aw = (g1.d + g2.d) / 2
  const t1 = Math.sqrt(g1.da ** 2 / 4 - g1.db ** 2 / 4)
  const t2 = Math.sqrt(g2.da ** 2 / 4 - g2.db ** 2 / 4)
  const pbt = Math.PI * g1.mt * Math.cos(g1.alphaT)
  const epsAlpha = (t1 + t2 - aw * Math.sin(g1.alphaT)) / pbt
  const epsBeta = (widthMm * Math.sin(Math.abs(g1.beta))) / (Math.PI * mn)
  return { epsAlpha, epsBeta, total: epsAlpha + epsBeta, centre: aw }
}

// ------------------------------------------------------------------------------ trains

export interface TrainStage {
  /** teeth of the driving gear */
  driver: number
  /** teeth of the driven gear */
  driven: number
  /** external (default), internal (ring) or bevel / worm (ratio only) */
  mesh?: 'external' | 'internal' | 'bevel' | 'worm'
  /** worm: threads (starts) of the worm, taken as `driver` */
  /** the driven gear is also the driver of the next stage (an idler / same gear), not a compound pair on one shaft */
  shared?: boolean
}

export interface TrainRow {
  /** shaft number, 0 = input */
  shaft: number
  teeth: string
  /** rpm, signed (negative = opposite sense to the input) */
  rpm: number
  /** N·m, ideal minus mesh losses */
  torque: number
  /** W */
  power: number
}

export interface TrainResult {
  /** ω_out / ω_in, signed */
  ratio: number
  /** magnitude as a reduction ratio, n_in / n_out (> 1 slows down) */
  reduction: number
  rows: TrainRow[]
  /** efficiency of the whole train */
  efficiency: number
  meshes: number
}

export function stageRatio(s: TrainStage): number {
  const mag = s.driver / s.driven
  switch (s.mesh ?? 'external') {
    case 'internal': return mag
    case 'worm': return mag
    default: return -mag
  }
}

/** Speed, torque and power of every shaft of a train. `eff` is the efficiency of one mesh (default 0.98). */
export function gearTrain(stages: readonly TrainStage[], inputRpm: number, inputTorque: number, eff = 0.98): TrainResult {
  const rows: TrainRow[] = []
  let w = inputRpm
  let T = inputTorque
  const omega = (rpm: number) => (rpm * TAU) / 60
  rows.push({ shaft: 0, teeth: stages.length ? String(stages[0].driver) : '', rpm: w, torque: T, power: T * omega(w) })
  let ratio = 1
  let meshes = 0
  stages.forEach((s, i) => {
    const r = stageRatio(s)
    ratio *= r
    meshes++
    w *= r
    T = T * (1 / Math.abs(r)) * eff
    const next = stages[i + 1]
    rows.push({ shaft: rows.length, teeth: s.shared && next ? `${s.driven} (idler)` : next && !s.shared ? `${s.driven}+${next.driver}` : String(s.driven), rpm: w, torque: T, power: T * omega(w) })
  })
  return { ratio, reduction: ratio === 0 ? Infinity : 1 / Math.abs(ratio), rows, efficiency: Math.pow(eff, meshes), meshes }
}

/** Rack and pinion: rack travel per revolution (π m z) and speed (mm/s). */
export function rackPinion(module: number, z: number, rpm: number): { travelPerRev: number; speed: number; pitchRadius: number } {
  const travelPerRev = Math.PI * module * z
  return { travelPerRev, speed: (travelPerRev * rpm) / 60, pitchRadius: (module * z) / 2 }
}

/** Bevel gears on shafts at angle Σ (degrees): ratio and the pitch cone angles. */
export function bevelPair(z1: number, z2: number, sigmaDeg = 90): { ratio: number; delta1: number; delta2: number } {
  const S = rad(sigmaDeg)
  const d1 = Math.atan2(Math.sin(S), z2 / z1 + Math.cos(S))
  return { ratio: z2 / z1, delta1: deg(d1), delta2: deg(S - d1) }
}

/** Worm gear: ratio, lead angle, and the efficiency / self-locking for a friction coefficient μ. */
export function wormGear(starts: number, wheelTeeth: number, module: number, wormDiameter: number, alphaNDeg = 20, mu = 0.05): {
  ratio: number; leadAngle: number; efficiency: number; selfLocking: boolean; centre: number; lead: number
} {
  const lead = Math.PI * module * starts
  const lam = Math.atan(lead / (Math.PI * wormDiameter))
  const an = rad(alphaNDeg)
  const eta = (Math.cos(an) - mu * Math.tan(lam)) / (Math.cos(an) + mu / Math.tan(lam))
  return { ratio: wheelTeeth / starts, leadAngle: deg(lam), efficiency: Math.max(0, eta), selfLocking: Math.tan(lam) < mu / Math.cos(an), centre: (wormDiameter + module * wheelTeeth) / 2, lead }
}

// ------------------------------------------------------------------------------ planetary

export type Member = 'sun' | 'ring' | 'carrier'

export interface Planetary {
  Zs: number
  Zr: number
  Zp: number
  /** number of planets */
  n: number
}

export interface PlanetaryCheck {
  planet: number
  integerPlanet: boolean
  assembles: boolean
  neighbours: boolean
  messages: string[]
}

/** Zp from Zr = Zs + 2 Zp, and the assembly rules ((Zs + Zr)/N must be a whole number; the planets must not touch). */
export function planetary(Zs: number, Zr: number, n = 3): Planetary & PlanetaryCheck {
  const Zp = (Zr - Zs) / 2
  const messages: string[] = []
  const integerPlanet = Number.isInteger(Zp) && Zp > 0
  if (!integerPlanet) messages.push('Zr − Zs must be even and positive so that the planet has a whole number of teeth (Zr = Zs + 2·Zp).')
  const assembles = Number.isInteger((Zs + Zr) / n)
  if (!assembles) messages.push(`(Zs + Zr)/N = ${(Zs + Zr) / n} is not a whole number: ${n} planets cannot be assembled at equal spacing.`)
  const neighbours = integerPlanet ? (Zs + Zp) * Math.sin(Math.PI / n) > Zp + 2 : true
  if (!neighbours) messages.push('The planets touch each other: use fewer planets or a larger sun.')
  return { Zs, Zr, Zp: integerPlanet ? Zp : NaN, n, planet: Zp, integerPlanet, assembles, neighbours, messages }
}

export interface PlanetarySpeeds {
  sun: number
  ring: number
  carrier: number
  /** absolute rotation speed of a planet about its own axis */
  planet: number
  /** planet speed relative to the carrier */
  planetRel: number
}

/** The Willis equation Zs(ωs − ωc) + Zr(ωr − ωc) = 0 with one member held (speed 0) and another driven. */
export function planetarySpeeds(P: { Zs: number; Zr: number }, fixed: Member, input: Member, inputSpeed: number): PlanetarySpeeds | null {
  if (fixed === input) return null
  const { Zs, Zr } = P
  const Zp = (Zr - Zs) / 2
  let ws = 0; let wr = 0; let wc = 0
  const set = (m: Member, v: number) => { if (m === 'sun') ws = v; else if (m === 'ring') wr = v; else wc = v }
  set(fixed, 0); set(input, inputSpeed)
  const free = (['sun', 'ring', 'carrier'] as Member[]).find((m) => m !== fixed && m !== input)!
  if (free === 'carrier') wc = (Zs * ws + Zr * wr) / (Zs + Zr)
  else if (free === 'sun') { if (Math.abs(Zs) < 1e-12) return null; ws = wc - (Zr * (wr - wc)) / Zs }
  else { if (Math.abs(Zr) < 1e-12) return null; wr = wc - (Zs * (ws - wc)) / Zr }
  const rel = -(Zs / Zp) * (ws - wc)
  return { sun: ws, ring: wr, carrier: wc, planet: wc + rel, planetRel: rel }
}

export interface PlanetaryRatio {
  fixed: Member
  input: Member
  output: Member
  /** ω_input / ω_output (negative = reversed) */
  ratio: number
}

/** The ratios for each fixed member (all six input/output pairs of the two others). */
export function planetaryTable(P: { Zs: number; Zr: number }): PlanetaryRatio[] {
  const members: Member[] = ['sun', 'ring', 'carrier']
  const out: PlanetaryRatio[] = []
  for (const fixed of members) {
    const others = members.filter((m) => m !== fixed)
    for (const input of others) {
      const output = others.find((m) => m !== input)!
      const sp = planetarySpeeds(P, fixed, input, 1)
      if (!sp) continue
      const wOut = sp[output]
      out.push({ fixed, input, output, ratio: Math.abs(wOut) < 1e-12 ? Infinity : 1 / wOut })
    }
  }
  return out
}

/** Torques on sun : ring : carrier for a lossless set: T_s : T_r : T_c = Zs : Zr : −(Zs + Zr). */
export function planetaryTorques(P: { Zs: number; Zr: number }, torqueOnSun: number): { sun: number; ring: number; carrier: number } {
  const k = torqueOnSun / P.Zs
  return { sun: torqueOnSun, ring: k * P.Zr, carrier: -k * (P.Zs + P.Zr) }
}

// ------------------------------------------------------------------------------ belts and chains

export interface BeltDrive {
  ratio: number
  length: number
  wrapSmall: number
  speed: number
}

/** Open or crossed belt between pulleys of diameters D (large) and d on centre distance C. */
export function beltDrive(D: number, d: number, C: number, rpmSmall: number, crossed = false): BeltDrive | null {
  if (!(C > 0) || !(D > 0) || !(d > 0)) return null
  const Dl = Math.max(D, d); const ds = Math.min(D, d)
  const arg = crossed ? (Dl + ds) / (2 * C) : (Dl - ds) / (2 * C)
  if (arg >= 1) return null
  const L = crossed ? 2 * C + (Math.PI * (Dl + ds)) / 2 + (Dl + ds) ** 2 / (4 * C) : 2 * C + (Math.PI * (Dl + ds)) / 2 + (Dl - ds) ** 2 / (4 * C)
  const wrap = crossed ? Math.PI + 2 * Math.asin(arg) : Math.PI - 2 * Math.asin(arg)
  return { ratio: Dl / ds, length: L, wrapSmall: deg(wrap), speed: (Math.PI * (ds / 1000) * rpmSmall) / 60 }
}

export interface ChainDrive {
  ratio: number
  links: number
  centre: number
  /** chain speed, m/s */
  speed: number
}

/** Chain of pitch p (mm) between sprockets of N1 and N2 teeth: the number of links (even) and the true centre distance. */
export function chainDrive(N1: number, N2: number, p: number, C: number, rpm1: number): ChainDrive | null {
  if (!(N1 >= 6) || !(N2 >= 6) || !(p > 0) || !(C > 0)) return null
  const Lp = (2 * C) / p + (N1 + N2) / 2 + ((N2 - N1) / TAU) ** 2 * (p / C)
  const links = 2 * Math.ceil(Lp / 2)
  // centre distance for the whole number of links (Shigley)
  const t = links - (N1 + N2) / 2
  const centre = (p / 4) * (t + Math.sqrt(Math.max(0, t * t - (8 * ((N2 - N1) / TAU) ** 2)))) 
  return { ratio: N2 / N1, links, centre, speed: (N1 * p * rpm1) / 60000 }
}

