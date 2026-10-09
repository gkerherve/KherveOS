// Markdown reports of the three workbenches (pure).

import { analyseCycle, describeOutput, fourBarOf, type Cycle } from './analysis.ts'
import { camProfile, LAWS, lawPeaks, optimiseBaseRadius, programLevels, programTable } from './cam.ts'
import { runEngine, meanPistonSpeed } from './engine.ts'
import { classifyFourBar } from './fourbar.ts'
import {
  beltDrive, chainDrive, gearGeometry, gearTrain, helicalContact, helicalGear, pairGeometry, planetary, planetarySpeeds, planetaryTable, planetaryTorques,
} from './gear.ts'
import { fmt } from './math.ts'
import type { CamDoc, GearDoc, KMechDoc, LinkageDoc } from './doc.ts'
import { compile } from './linkage.ts'

const f = (v: number, d = 4) => fmt(v, d)
const table = (head: string[], rows: Array<Array<string | number>>): string =>
  [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map((c) => (typeof c === 'number' ? f(c) : c)).join(' | ')} |`)].join('\n')

export function linkageReport(m: LinkageDoc, c: Cycle = analyseCycle(m, { output: m.output })): string {
  const sys = compile(m)
  const out: string[] = [`# ${m.name}`, '', '*Linkage analysis made with kMech.*', '']
  if (m.notes) out.push(m.notes, '')
  out.push('## Mechanism', '', `- ${m.points.length} points (${m.points.filter((p) => p.ground).length} ground pins), ${m.links.length} links, ${m.sliders.length} sliders`)
  out.push(`- Unknown coordinates ${sys.free.length * 2}, equations ${sys.cons.length}: ${c.ok ? 'one degree of freedom, set by the driver' : 'not analysable'}`)
  if (m.driver) out.push(`- Driver: ${m.driver.from} → ${m.driver.to} at ${m.driver.rpm} rpm`)
  const fb = fourBarOf(m)
  if (fb) {
    const g = classifyFourBar(fb)
    out.push(`- Four-bar: input ${f(fb.a)}, coupler ${f(fb.b)}, output ${f(fb.c)}, frame ${f(fb.d)} mm: **${g.label}** (s + l − (p + q) = ${f(g.margin)})`)
  }
  if (!c.ok) {
    out.push('', `> ${c.message ?? 'The mechanism could not be analysed.'}`)
    return out.join('\n') + '\n'
  }
  const s = c.summary
  const un = c.outputUnit === 'deg' ? '°' : ' mm'
  out.push('', '## Kinematics', '')
  out.push(`- Input range: ${c.range.full ? 'full turn' : `${f(c.range.min * 180 / Math.PI, 5)}° to ${f(c.range.max * 180 / Math.PI, 5)}° (the mechanism locks up beyond)`}`)
  if (c.output) {
    out.push(`- Output: ${describeOutput(m, c.output)}: from ${f(s.outMin)}${un} to ${f(s.outMax)}${un}, range of motion ${f(s.span)}${un}`)
    out.push(`- Peak velocity ${f(s.peakVel)} ${c.outputUnit === 'deg' ? '°' : 'mm'}/s and acceleration ${f(s.peakAcc)} ${c.outputUnit === 'deg' ? '°' : 'mm'}/s² at ${f(c.rpm)} rpm`)
    if (s.muMin !== null && s.muMax !== null) out.push(`- Transmission angle ${f(s.muMin, 3)}° to ${f(s.muMax, 3)}°; ${f((s.muGoodShare ?? 0) * 100, 3)} % of the cycle within the 40°–140° band`)
    if (s.deadCentres.length) out.push(`- Dead centres near input angles: ${s.deadCentres.slice(0, 6).map((d) => `${f(d, 4)}°`).join(', ')}`)
    if (s.quickReturn) out.push(`- Quick-return: forward ${f(s.quickReturn.forwardDeg, 5)}° / return ${f(s.quickReturn.returnDeg, 5)}° → time ratio **${f(s.quickReturn.ratio, 5)}**`)
  }
  const step = Math.max(1, Math.round((c.theta.length - 1) / 24))
  const rows: Array<Array<string | number>> = []
  for (let i = 0; i < c.theta.length; i += step) rows.push([f(c.theta[i], 5), f(c.pos[i]), f(c.vel[i]), f(c.acc[i]), c.mu[i] === null ? '–' : f(c.mu[i] as number, 4)])
  out.push('', table(['input (°)', `output (${c.outputUnit || '-'})`, 'velocity', 'acceleration', 'μ (°)'], rows))
  const tr = Object.keys(c.tracers)
  if (tr.length) out.push('', `Tracer points: ${tr.map((id) => m.points.find((p) => p.id === id)?.label ?? id).join(', ')}.`)
  if (m.engine) {
    const e = runEngine(m.engine)
    out.push('', '## Engine', '')
    out.push(`- Bore ${m.engine.bore} mm × stroke ${m.engine.stroke} mm, rod ${m.engine.rod} mm, ${m.engine.cylinders} cylinder(s), compression ratio ${m.engine.cr}, ${m.engine.rpm} rpm`)
    out.push(`- Swept volume ${f(e.swept)} cm³, peak pressure ${f(e.peakPressure / 1000)} MPa, mean piston speed ${f(meanPistonSpeed(m.engine))} m/s`)
    out.push(`- Indicated work ${f(e.workPerCycle)} J per cycle, IMEP ${f(e.imep)} kPa, mean torque ${f(e.meanTorque)} N·m, power ${f(e.power)} kW`)
    out.push(`- Torque peaks ${f(e.peakTorque)} N·m and ${f(e.minTorque)} N·m; energy fluctuation ${f(e.deltaE)} J → flywheel inertia ${f(e.flywheelI, 3)} kg·m² for a speed fluctuation of ${f(m.engine.cs * 100)} %`)
  }
  return out.join('\n') + '\n'
}

export function camReport(m: CamDoc): string {
  const p = camProfile(m)
  const t = programTable(m.program, 720)
  const lv = programLevels(m.program)
  const out: string[] = [`# ${m.name}`, '', '*Cam design made with kMech.*', '']
  if (m.notes) out.push(m.notes, '')
  out.push('## Motion program', '', table(['#', 'segment', 'angle (°)', 'lift', 'law'], m.program.segments.map((s, i) => [i + 1, s.kind, s.beta, s.kind === 'dwell' ? '–' : s.lift, LAWS.find((l) => l.id === s.law)?.name ?? s.law])))
  const unit = m.motion === 'swing' ? '°' : ' mm'
  out.push('', `Total ${f(lv.total)}°; peak lift ${f(t.peakS)}${unit}; peak velocity ${f(t.peakV)}${unit}/rad, acceleration ${f(t.peakA)}${unit}/rad², jerk ${f(t.peakJ)}${unit}/rad³.`)
  out.push('', '## Cam', '', `- Follower: ${m.follower}${m.follower === 'roller' ? ` (roller radius ${m.rollerRadius} mm)` : ''}, ${m.motion}${m.motion === 'translating' && m.follower !== 'flat' ? `, offset ${m.offset} mm` : ''}${m.motion === 'swing' ? `, arm ${m.armLength} mm on a pivot ${m.pivotDistance} mm from the cam centre` : ''}`)
  out.push(`- Base circle ${m.baseRadius} mm, prime circle ${f(p.stats.primeRadius)} mm, largest radius ${f(p.stats.outerRadius)} mm, rotation ${m.direction === 'ccw' ? 'counter-clockwise' : 'clockwise'}`)
  if (m.follower !== 'flat') out.push(`- Maximum pressure angle ${f(p.stats.maxPressure, 3)}° at ${f(p.stats.maxPressureAt, 4)}° (limit ${m.maxPressure}°)`)
  else out.push(`- A flat face needs a half-width of at least ${f(p.stats.faceHalfWidth)} mm`)
  out.push(`- Smallest radius of curvature ${Number.isFinite(p.stats.minRho) ? f(p.stats.minRho) : '–'} mm at ${f(p.stats.minRhoAt, 4)}°`)
  const opt = optimiseBaseRadius(m)
  out.push(`- Smallest base circle meeting the pressure and curvature limits: ${f(opt.baseRadius)} mm (limited by ${opt.limitedBy})`)
  out.push('', '## Checks', '', ...(p.warnings.length ? p.warnings.map((w) => `- ${w.level === 'error' ? '**Error**' : 'Warning'}: ${w.message}`) : ['- No problems found.']))
  for (const s of m.program.segments) void lawPeaks(s.law)
  return out.join('\n') + '\n'
}

export function gearReport(m: GearDoc): string {
  const out: string[] = [`# ${m.name}`, '', '*Gear calculations made with kMech.*', '']
  if (m.notes) out.push(m.notes, '')
  const { pair, train, planetary: pl, helical, belt } = m
  const pg = pairGeometry(pair.g1, pair.g2, pair.centre)
  out.push('## Spur gear pair', '')
  out.push(table(['', 'gear 1', 'gear 2'], [
    ['teeth z', pair.g1.z, pair.g2.z], ['module (mm)', pair.g1.module, pair.g2.module], ['pressure angle (°)', pair.g1.alpha, pair.g2.alpha], ['profile shift x', pair.g1.x, pair.g2.x],
    ['pitch diameter d (mm)', pg.g1.d, pg.g2.d], ['base diameter db (mm)', pg.g1.db, pg.g2.db], ['tip diameter da (mm)', pg.g1.da, pg.g2.da], ['root diameter df (mm)', pg.g1.df, pg.g2.df],
    ['tooth thickness at pitch circle (mm)', pg.g1.s, pg.g2.s], ['tip land (mm)', pg.g1.sa, pg.g2.sa], ['undercut', pg.g1.undercut ? 'yes' : 'no', pg.g2.undercut ? 'yes' : 'no'],
  ]))
  out.push('', `Ratio ${f(pg.ratio)}:1, standard centre distance ${f(pg.a0)} mm, working centre distance ${f(pg.aw)} mm, working pressure angle ${f(pg.alphaW * 180 / Math.PI)}°, transverse contact ratio **${f(pg.epsilon)}**, backlash ${f(pg.backlash)} mm.`)
  for (const w of pg.warnings) out.push('', `> ${w}`)
  const tr = gearTrain(train.stages, train.rpm, train.torque, train.eff)
  out.push('', '## Gear train', '', `Overall ratio ${f(tr.ratio)} (reduction ${f(tr.reduction)}:1), efficiency ${f(tr.efficiency * 100)} %.`, '')
  out.push(table(['shaft', 'gears', 'speed (rpm)', 'torque (N·m)', 'power (W)'], tr.rows.map((r) => [r.shaft, r.teeth, r.rpm, r.torque, r.power])))
  const ps = planetary(pl.Zs, pl.Zr, pl.n)
  out.push('', '## Planetary set', '', `Sun ${pl.Zs}, ring ${pl.Zr}, planets ${Number.isFinite(ps.Zp) ? ps.Zp : '?'} × ${pl.n}.`)
  for (const msg of ps.messages) out.push('', `> ${msg}`)
  const label = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)
  out.push('', table(['fixed', 'input', 'output', 'ratio input/output'], planetaryTable(pl).map((r) => [label(r.fixed), label(r.input), label(r.output), Number.isFinite(r.ratio) ? r.ratio : '∞'])))
  const sp = planetarySpeeds(pl, pl.fixed, pl.input, pl.speed)
  if (sp) {
    const T = planetaryTorques(pl, 1)
    out.push('', `With the ${pl.fixed} fixed and the ${pl.input} at ${pl.speed} rpm: sun ${f(sp.sun)}, ring ${f(sp.ring)}, carrier ${f(sp.carrier)}, planet ${f(sp.planet)} rpm. Torque shares (sun : ring : carrier) = ${f(T.sun)} : ${f(T.ring)} : ${f(T.carrier)}.`)
  }
  const h1 = helicalGear(helical.mn, helical.z1, helical.beta, helical.alphaN)
  const hc = helicalContact(helical.z1, helical.z2, helical.mn, helical.beta, helical.alphaN, helical.width)
  out.push('', '## Helical pair', '', `Normal module ${helical.mn} mm → transverse module ${f(h1.mt)} mm, transverse pressure angle ${f(h1.alphaT * 180 / Math.PI)}°; pinion pitch diameter ${f(h1.d)} mm, virtual teeth ${f(h1.zv)}. Contact ratios: transverse ${f(hc.epsAlpha)}, face ${f(hc.epsBeta)}, total ${f(hc.total)}.`)
  out.push('', '## Belt and chain', '')
  const bd = beltDrive(belt.D, belt.d, belt.C, belt.rpm, belt.crossed)
  if (bd) out.push(`- ${belt.crossed ? 'Crossed' : 'Open'} belt: ratio ${f(bd.ratio)}, length ${f(bd.length)} mm, wrap on the small pulley ${f(bd.wrapSmall)}°, belt speed ${f(bd.speed)} m/s`)
  const cd = chainDrive(belt.N1, belt.N2, belt.pitch, belt.C, belt.rpm)
  if (cd) out.push(`- Chain: ratio ${f(cd.ratio)}, ${cd.links} links, centre distance ${f(cd.centre)} mm, chain speed ${f(cd.speed)} m/s`)
  void gearGeometry
  return out.join('\n') + '\n'
}

export function buildReport(doc: KMechDoc): string {
  if (doc.workbench === 'linkage') return linkageReport(doc.model)
  if (doc.workbench === 'cam') return camReport(doc.model)
  return gearReport(doc.model)
}
