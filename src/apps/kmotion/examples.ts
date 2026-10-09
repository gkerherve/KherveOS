// The built-in experiments of kMotion as .kmotion documents (pure). The files in public/examples/kmotion/ are written
// from this list by tools/export_kmotion_examples.ts; tools/tests/kmotion.test.ts runs every one headless and checks
// the numbers quoted in the descriptions against the closed forms.

import { cleanParams } from './registry.ts'
import { DEG, G_EARTH, G_MOON } from './common.ts'
import { SANDBOX_WORLDS } from './scenes/sandbox.ts'
import { optimalAngle, projectileVacuum } from './scenes/projectile.ts'
import { pendulumPeriodExact } from './elliptic.ts'
import { hohmann } from './gravity.ts'
import type { Method } from './integrators.ts'
import type { KMotionDoc, Params, SceneId } from './types.ts'

export interface MotionExample {
  /** Stable id (the AI tool's load_example takes it). */
  id: string
  title: string
  description: string
  group: string
  doc: KMotionDoc
}

function make(id: string, group: string, title: string, description: string, scene: SceneId, mode: string, params: Params, method?: Method): MotionExample {
  const doc: KMotionDoc = {
    format: 'kmotion', version: 1, scene, title, description, ...(method ? { method } : {}),
    params: cleanParams(scene, { mode, ...params }),
  }
  return { id, title, description, group, doc }
}

const P = 'Projectiles'
const PE = 'Pendulums'
const OS = 'Oscillators & friction'
const CO = 'Collisions'
const OR = 'Orbits & gravity'
const RB = 'Rigid bodies'
const CM = 'Circular motion'

export function motionExamples(): MotionExample[] {
  const vac = projectileVacuum(20, 45, 0, G_EARTH)
  const dragBest = optimalAngle({ ...cleanParams('projectile', { mode: 'flight', v0: 40, h0: 0, drag: 'quadratic', kq: 0.01 }) })
  const dragAngle = Math.round(dragBest.angle * 10) / 10
  const T80 = pendulumPeriodExact(1, G_EARTH, 80 * DEG)
  const H = hohmann(4 * Math.PI * Math.PI, 1, 1.524)
  const jumpEarth = projectileVacuum(3.5, 60, 1, G_EARTH)
  const jumpMoon = projectileVacuum(3.5, 60, 1, G_MOON)
  const f = (x: number, d = 2) => x.toFixed(d)

  return [
    // ------------------------------------------------------------------ projectiles
    make('projectile-vacuum', P, 'Projectile in vacuum', `20 m/s at 45° on level ground: the range is v² sin 2θ / g = ${f(vac.range)} m and the flight lasts ${f(vac.tof)} s. The dashed parabola is the closed form; the simulation sits on it.`, 'projectile', 'flight', { v0: 20, angle: 45, h0: 0, drag: 'none' }),
    make('projectile-drag', P, 'Projectile with quadratic air drag', 'A baseball-like ball (c = 0.006 /m) thrown at 40 m/s and 35°. Compare with the vacuum parabola: the drag shortens the range a lot and makes the descent steeper than the climb.', 'projectile', 'flight', { v0: 40, angle: 35, h0: 1, drag: 'quadratic', kq: 0.006 }),
    make('projectile-best-angle', P, 'Maximum-range angle with drag', `With quadratic drag (c = 0.01 /m) the best angle for 40 m/s is ${f(dragAngle, 1)}°, below the vacuum 45°. The readout searches for it numerically.`, 'projectile', 'flight', { v0: 40, angle: dragAngle, h0: 0, drag: 'quadratic', kq: 0.01 }),
    make('projectile-angle-fan', P, 'Fan of angles from a cliff', 'Five launch angles from a 30 m cliff at 20 m/s. From a height the farthest shot is flatter than 45°: atan(v / √(v² + 2 g h)).', 'projectile', 'fan', { v0: 20, h0: 30, drag: 'none' }),
    make('jump-earth', P, 'Jump on Earth', `A 3.5 m/s take-off at 60° from a standing height of 1 m: the jump lasts ${f(jumpEarth.tof)} s and covers ${f(jumpEarth.range)} m.`, 'projectile', 'flight', { v0: 3.5, angle: 60, h0: 1, gravity: 'earth' }),
    make('jump-moon', P, 'Jump on the Moon', `The same take-off with the Moon's gravity (1.62 m/s²): ${f(jumpMoon.tof)} s in the air and ${f(jumpMoon.range)} m, about ${f(jumpMoon.range / jumpEarth.range, 1)} times as far.`, 'projectile', 'flight', { v0: 3.5, angle: 60, h0: 1, gravity: 'moon' }),
    // ------------------------------------------------------------------ pendulums
    make('pendulum-large-angle', PE, 'Simple pendulum: exact against small-angle', `L = 1 m released at 80°. The small-angle cosine (pink) drifts out of step; the exact elliptic-function solution (green) stays on the simulation. The period is ${f(T80, 4)} s instead of 2π√(L/g) = 2.0061 s.`, 'pendulum', 'simple', { L: 1, theta0: 80, omega0: 0 }),
    make('pendulum-damped', PE, 'Damped pendulum', 'Friction at the pivot: the swing decays as e^(−c t/2) and the phase portrait spirals into the origin.', 'pendulum', 'damped', { L: 1, theta0: 50, c: 0.3 }),
    make('pendulum-resonance', PE, 'Driven damped pendulum: resonance', 'A pendulum with natural frequency 3.13 rad/s driven at 3.0 rad/s: the amplitude builds up to the steady value A / (c ω₀) and then settles. Run the resonance sweep in the Plots tab.', 'pendulum', 'driven', { L: 1, c: 0.4, A: 0.6, Om: 3.0, theta0: 0 }),
    make('pendulum-double', PE, 'Double pendulum: chaos', 'Two pendulums started 0.01° apart. For a few seconds they move together, then they separate exponentially (Lyapunov exponent in the readout) while the energy stays constant.', 'pendulum', 'double', { th1: 120, th2: -10, twin: true, eps: 0.01 }),
    make('pendulum-physical', PE, 'Physical pendulum: a rod on a nail', 'A uniform rod swinging about its end behaves like a simple pendulum of length 2L/3. Move the pivot toward the centre to see the period pass through a minimum at L/√12 from the centre.', 'pendulum', 'compound', { shape: 'rod', size: 1, pivot: 0.5, theta0: 30 }),
    // ------------------------------------------------------------------ oscillators
    make('oscillator-under', OS, 'Damped oscillator: underdamped', 'ζ = 0.11: the mass rings down inside the envelope ±A e^(−c t/2m). The closed form lies on the simulation.', 'oscillator', 'spring', { m: 1, k: 20, c: 1, x0: 1 }),
    make('oscillator-critical', OS, 'Damped oscillator: critical damping', 'c = 2√(km): the fastest return to rest without overshooting.', 'oscillator', 'spring', { m: 1, k: 20, c: 8.944, x0: 1 }),
    make('oscillator-over', OS, 'Damped oscillator: overdamped', 'ζ > 1: no oscillation, a slow creep back to equilibrium.', 'oscillator', 'spring', { m: 1, k: 20, c: 20, x0: 1 }),
    make('oscillator-resonance', OS, 'Driven oscillator at resonance', 'Driven at its natural frequency √(k/m) = 4.47 rad/s. The amplitude F₀ / (c ω₀) is reached after about 2m/c seconds; the phase lag is 90°.', 'oscillator', 'driven', { m: 1, k: 20, c: 0.8, F0: 4, Om: 4.47 }),
    make('coupled-pendulums', OS, 'Coupled pendulums: normal modes and beats', 'Two pendulums joined by a spring. Pull one and the energy swaps back and forth (beats); start in mode 1 or mode 2 and it stays a pure sine at ω = √(g/L) or √(g/L + 2k/m).', 'oscillator', 'coupled', { form: 'pendulums', N: 2, L: 1, m: 1, kc: 2, init: 'pluck', a0: 0.4 }),
    make('coupled-chain', OS, 'Five coupled oscillators', 'Five masses in a chain: five normal modes with different frequencies. Mode 2 is shown; the plot of modal amplitudes shows only that mode is excited.', 'oscillator', 'coupled', { form: 'springs', N: 5, k: 20, kc: 10, init: 'mode2', a0: 0.4 }),
    make('atwood', OS, 'Atwood machine', 'Masses 3 kg and 2 kg over an ideal pulley: a = (m₁ − m₂) g / (m₁ + m₂) = 1.96 m/s², tension 23.5 N. Add a pulley mass and a drops.', 'oscillator', 'atwood', { m1: 3, m2: 2, M: 0 }),
    make('incline-friction', OS, 'Block on an incline with friction', 'θ = 35°, μs = 0.5, μk = 0.3: tan 35° = 0.70 > μs so the block slides with a = g (sin θ − μk cos θ) = 3.2 m/s². Lower the angle below 26.6° (arctan 0.5) and it stays put.', 'oscillator', 'incline', { object: 'block', theta: 35, mus: 0.5, muk: 0.3, slen: 6 }),
    make('incline-rolling', OS, 'Rolling race down an incline', 'A block, a ring, a cylinder and two spheres released together. Rolling objects are slower than the sliding block by 1 + I/mr²; the solid sphere wins and the ring comes last, whatever their masses and radii.', 'oscillator', 'incline', { object: 'race', theta: 25, mus: 0.9, muk: 0.6, slen: 6 }),
    // ------------------------------------------------------------------ collisions
    make('collision-elastic', CO, 'Elastic collision in 1-D', 'A 2 kg cart at 3 m/s hits a 1 kg cart at −1 m/s with e = 1. Momentum and kinetic energy are both conserved: the velocities after are 0.33 and 4.33 m/s.', 'collision', 'oned', { m1: 2, m2: 1, v1: 3, v2: -1, e: 1 }),
    make('collision-inelastic', CO, 'Perfectly inelastic collision', 'Same carts with e = 0: they move together at the centre-of-mass velocity and kinetic energy is lost: ½ μ (1 − e²) v_rel².', 'collision', 'oned', { m1: 2, m2: 1, v1: 3, v2: -1, e: 0 }),
    make('collision-billiard', CO, 'Billiard collision at right angles', 'A cue ball hits an equal ball at rest off-centre. With equal masses and e = 1 the two balls leave at exactly 90° to each other.', 'collision', 'twod', { layout: 'oblique', speed: 4, offset: 0.5, mc: 1, mt: 1, e: 1, ew: 1 }),
    make('billiard-break', CO, 'Breaking a billiard rack', 'The cue ball hits fifteen balls in a triangle. Event-driven physics: each collision is resolved at its exact time. Momentum is conserved until the cushions are hit.', 'collision', 'twod', { layout: 'rack', speed: 4, e: 0.96, ew: 0.9, decay: 0.15 }),
    make('newtons-cradle', CO, "Newton's cradle (planck)", 'Five steel balls on strings, rigid-body physics with planck: one ball in, one ball out. Lift two or three balls with the parameter panel.', 'collision', 'cradle', { balls: 5, lift: 1, liftAngle: 35, restitution: 1, length: 1 }),
    make('ballistic-pendulum', CO, 'Ballistic pendulum', 'A 10 g bullet at 300 m/s embeds in a 1 kg block on a 1.5 m string. Momentum gives V = m v / (m + M) = 2.97 m/s; energy gives the rise h = V²/2g = 0.45 m and the swing angle 45.6°. Only 1% of the kinetic energy survives the impact.', 'collision', 'ballistic', { mb: 10, MB: 1, vb: 300, Lb: 1.5 }),
    // ------------------------------------------------------------------ orbits
    make('orbit-circular', OR, 'Circular orbit', 'A planet at 1 AU around a one solar-mass star: period 1 yr and speed 2π AU/yr (29.8 km/s). Kepler III: T²/a³ = 1.', 'orbit', 'kepler', { M: 1, q: 0.000003, rp: 1, ecc: 0 }),
    make('orbit-elliptical', OR, "Elliptical orbit: Kepler's laws", "e = 0.6, perihelion 1 AU (a = 2.5 AU): the wedges swept in equal times have equal areas (II), r + r′ = 2a for the empty focus (I) and T²/a³ = 1 (III), all checked live.", 'orbit', 'kepler', { M: 1, q: 0.000003, rp: 1, ecc: 0.6 }),
    make('orbit-binary', OR, 'Binary star', 'Two equal masses orbiting their common centre of mass.', 'orbit', 'kepler', { M: 1, q: 1, rp: 1, ecc: 0.3 }),
    make('orbit-escape', OR, 'Escape speed', 'Fire a probe straight up from 1 AU at 90% of the escape speed: it climbs to 5.3 AU and falls back. At 100% it just escapes (a parabola). The escape speed is √2 times the circular speed.', 'orbit', 'escape', { M: 1, r0: 1, f: 0.9, launch: 90 }),
    make('orbit-hohmann', OR, 'Hohmann transfer: Earth to Mars', `Two burns: Δv₁ = ${f(H.dv1 * 4.74047, 2)} km/s at departure, Δv₂ = ${f(H.dv2 * 4.74047, 2)} km/s at arrival, ${f(H.time * 365.25, 0)} days of flight. Mars must lead Earth by ${f(H.lead / DEG, 1)}° at launch.`, 'orbit', 'hohmann', { M: 1, r1: 1, r2: 1.524, dv1: 100, burn2: true }),
    make('orbit-slingshot', OR, 'Gravity assist at Jupiter', 'A probe passes behind Jupiter: in the planet frame its speed is unchanged but its direction turns, and in the Sun frame it leaves much faster, with the energy taken from Jupiter\'s orbital motion.', 'orbit', 'slingshot', { pm: 1, U: 2.76, u: 2, b: 0.006, side: 'behind', frame: 'planet' }),
    make('orbit-arenstorf', OR, 'Restricted three-body: the Arenstorf orbit', 'A light spacecraft in the rotating Earth-Moon frame follows a periodic orbit (period 17.065) that visits the Moon twice per lap. The Jacobi constant stays fixed.', 'orbit', 'restricted3', { ic: 'arenstorf' }, 'rk45'),
    make('orbit-trojans', OR, 'Tadpole orbit around L4', 'A body just inside the Lagrange point L4 of the Earth-Moon system circles it in a small, stable tadpole orbit (L4 is stable for μ < 0.0385). The Jacobi constant stays fixed.', 'orbit', 'restricted3', { ic: 'l4', off: -0.02, mu: 0.0121505856 }, 'rk45'),
    make('orbit-jupiter-trojans', OR, 'Trojan asteroids of Jupiter', 'The Sun-Jupiter problem (μ = 0.000954): an asteroid on a slightly wider orbit than L4 librates along a long tadpole that reaches towards Jupiter, as the Trojans do. Switch on the inertial frame to see the bodies circle.', 'orbit', 'restricted3', { ic: 'l4', off: 0.02, mu: 0.000954 }, 'rk45'),
    make('orbit-figure8', OR, 'Figure-eight three-body', 'Three equal masses follow the same eight-shaped curve, one third of a period apart (Chenciner–Montgomery, 2000). The period is 6.32591398 in units where G = m = 1.', 'orbit', 'figure8', { perturb: 0 }, 'rk45'),
    make('orbit-solar', OR, 'Inner solar system', 'Sun, Mercury, Venus, Earth and Mars from real orbital elements (J2000), integrated as an N-body problem with velocity-Verlet. The periods come out as 87.97, 224.7, 365.2 and 687 days.', 'orbit', 'solar', { outer: false }, 'verlet'),
    make('orbit-galaxy', OR, 'Disc galaxy', '120 light bodies on circular orbits around a heavy centre, with softened gravity. Switch on Barnes–Hut and the 3-D view.', 'orbit', 'nbody', { layout: 'disc', N: 120, soft: 0.02, bh: false }, 'verlet'),
    // ------------------------------------------------------------------ rigid bodies
    ...Object.entries(SANDBOX_WORLDS).map(([key, w]) => make(`sandbox-${key}`, RB, w.name, `${w.name}: a rigid-body world (planck). Press Play, drag a body with the mouse to throw it, or edit it in the Sandbox tools.`, 'sandbox', 'world', { world: w.spec as unknown as Record<string, unknown> })),
    // ------------------------------------------------------------------ circular motion
    make('circular-centripetal', CM, 'Centripetal force', 'A 1 kg mass on a 2 m string at 6 m/s: a = v²/R = 18 m/s² towards the centre, tension 18 N. Tick “Cut the string” and it leaves along the tangent.', 'circular', 'centripetal', { m: 1, R: 2, v: 6 }),
    make('circular-banked', CM, 'Banked curve', 'A 60 m curve banked at 15°: the ideal speed is √(R g tan θ) = 12.6 m/s; with μ = 0.3 the car may go as fast as 19.1 m/s before it skids out.', 'circular', 'banked', { Rb: 60, bank: 15, mu: 0.3, vb: 18 }),
    make('circular-conical', CM, 'Conical pendulum', 'L = 1.2 m at 35°: the bob circles with period 2π√(L cos θ / g) = 1.99 s. Change the speed ratio and the cone breathes.', 'circular', 'conical', { L: 1.2, th0: 35, spin: 1 }),
    make('circular-coriolis', CM, 'Coriolis force on a turntable', 'A ball rolls from the centre of a disc turning at 0.8 rad/s. On the ground it moves in a straight line; on the disc it curves. Switch the view to see both.', 'circular', 'coriolis', { Om: 0.8, u: 3, ang: 0, r0: 0, Rd: 5 }),
    make('circular-gyro', CM, 'Spinning top', 'A fast top (150 rad/s) precesses slowly at m g d / (I₃ ω₃) = 3.9 rad/s while it nutates at about I₃ω₃/I₁ = 100 rad/s.', 'circular', 'gyro', { m: 0.4, d: 0.06, I3: 0.0004, I1: 0.0006, w3: 150, tilt: 30, start: 'rest' }),
  ]
}

export function exampleById(id: string): MotionExample | undefined {
  return motionExamples().find((e) => e.id === id)
}

