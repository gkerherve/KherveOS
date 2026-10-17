// Kherve Grand Prix: the circuits, the car and the sessions, without a browser.
// A simple driver (pure pursuit on the racing line at a share of the speed
// profile) sits in the player's car.
// Run:  node --test tools/tests/grandprix.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TRACKS, buildTrack, locate, pointAt, sampleAt, surfaceAt, type Track } from '../../src/apps/minigames/f1Track.ts'
import { CarBody, speedProfile, steerLock, tyreGrip, newTyres } from '../../src/apps/minigames/f1Physics.ts'
import { Session, TEAMS, setRaceSeries, teamsOf } from '../../src/apps/minigames/f1Race.ts'
import { EngineDSP, ENGINES, type EngineKind } from '../../src/apps/minigames/f1EngineDSP.ts'
import { engineOf, workletSource } from '../../src/apps/minigames/f1Audio.ts'
import { localCar, multiLineup, packCar, unpackCar, type RaceStart } from '../../src/apps/minigames/f1Net.ts'

const built = TRACKS.map((d) => {
  const t = buildTrack(d)
  return { t, prof: speedProfile(t) }
})

/** Steer the player's car along the racing line at `pace` of the profile. */
function drive(s: Session, t: Track, v: Float32Array, pace: number) {
  const b = s.body
  const q = locate(t, b.x, b.z, s.player.hint)
  const look = 12 + b.speed * 0.5
  const tgt = pointAt(t, q.s + look, sampleAt(t, t.line, q.s + look))
  const ang = Math.atan2(tgt.z - b.z, tgt.x - b.x) - b.h
  const a = Math.atan2(Math.sin(ang), Math.cos(ang))
  const lock = steerLock(b.vx)
  const err = sampleAt(t, v, q.s + b.speed * 0.15) * pace - b.speed
  const brake = err < -0.5 ? Math.min(1, -err * 0.3) : 0
  // a tidy driver: no full lock while braking hard (that is how a drift is started)
  const max = brake > 0.5 ? 0.55 : 1
  s.input = {
    throttle: s.phase === 'lights' ? 0 : err > 0 ? Math.min(1, err * 0.5) : 0,
    brake,
    // pure pursuit, a pull back towards the racing line when the car is off it, and some damping of the yaw
    steer: Math.max(-max, Math.min(max, (Math.atan((7.2 * Math.sin(a)) / look) - 0.015 * (q.d - sampleAt(t, t.line, q.s)) - 0.03 * (b.r - (b.vx * Math.tan(b.steer)) / 3.6)) / lock)),
    analog: true,
  }
}

test('both circuits close, stay finite, and have a pit lane, sectors and a DRS zone', () => {
  for (const { t, prof } of built) {
    assert.ok(t.len > 3000 && t.len < 6000, `${t.def.name}: ${t.len.toFixed(0)} m`)
    for (let i = 0; i < t.n; i++) {
      assert.ok(Number.isFinite(t.x[i]) && Number.isFinite(t.line[i]) && Number.isFinite(prof.v[i]), `${t.def.name}: sample ${i}`)
      assert.ok(Math.abs(t.line[i]) < t.width / 2, 'the racing line stays between the white lines')
      assert.ok(t.runL[i] > t.width / 2 && t.runR[i] > t.width / 2, 'the barriers are beyond the track')
    }
    // closed: the last sample is next to the first
    assert.ok(Math.hypot(t.x[0] - t.x[t.n - 1], t.z[0] - t.z[t.n - 1]) < t.ds * 1.5)
    assert.ok(t.drs.length >= 1, 'a DRS zone')
    assert.equal(t.pit.boxes.length, 6, 'a box per team')
    assert.ok(prof.lapTime > 50 && prof.lapTime < 100, `${t.def.name}: profile lap ${prof.lapTime.toFixed(1)} s`)
    assert.equal(surfaceAt(t, 10, 0), 'asphalt')
    assert.ok(['grass', 'gravel'].includes(surfaceAt(t, 600, t.width / 2 + 9)), 'off the asphalt: grass or gravel')
  }
})

test('the car is stable with the assists: a steering flick dies away', () => {
  for (const v0 of [30, 55, 80]) {
    const b = new CarBody()
    b.place(0, 0, 0, v0)
    for (let n = 0; n < 240; n++) b.step(1 / 60, { throttle: 0.6, brake: 0, steer: n < 24 ? 1 : 0 }, { grip: 1, drag: 0, assists: true })
    assert.ok(Math.abs(b.r) < 0.02 && Math.abs(b.vy) < 0.3, `${v0} m/s: yaw ${b.r.toFixed(3)}, slide ${b.vy.toFixed(2)}`)
  }
})

test('tyres: softs are fastest new, wear costs grip, cold ones grip less', () => {
  assert.ok(tyreGrip({ ...newTyres('soft'), temp: 1 }) > tyreGrip({ ...newTyres('medium'), temp: 1 }))
  assert.ok(tyreGrip({ ...newTyres('medium'), temp: 1 }) > tyreGrip({ ...newTyres('hard'), temp: 1 }))
  assert.ok(tyreGrip({ compound: 'soft', wear: 1, temp: 1 }) < tyreGrip({ compound: 'soft', wear: 0, temp: 1 }))
  assert.ok(tyreGrip({ compound: 'soft', wear: 0, temp: 0.3 }) < tyreGrip({ compound: 'soft', wear: 0, temp: 1 }))
})

test('qualifying sets the grid from the best laps, then a race runs to the flag with one stop each', () => {
  for (const { t, prof } of built) {
    const q = new Session({ track: t, profile: prof.v, profileLap: prof.lapTime, kind: 'qualifying', laps: 5, minutes: 4, difficulty: 'medium', assists: true, playerName: 'Test', seed: 5, damage: false })
    q.leaveGarage(q.player)
    for (let n = 0; n < 60 * 60 * 8 && q.phase !== 'done'; n++) {
      if (q.player.pit === 'none') drive(q, t, prof.v, 0.93)
      q.step(1 / 60)
    }
    assert.equal(q.phase, 'done', `${t.def.name}: qualifying ends`)
    const grid = q.results()
    assert.equal(grid.length, 12)
    for (let k = 1; k < grid.length; k++) assert.ok(grid[k].best >= grid[k - 1].best, 'the grid is in lap-time order')
    assert.ok(Number.isFinite(grid.find((r) => r.player)!.best), `${t.def.name}: the player set a time (${q.events.map((e) => `${e.t.toFixed(0)} ${e.text}`).join(' | ')})`)

    const r = new Session({ track: t, profile: prof.v, profileLap: prof.lapTime, kind: 'race', laps: 3, minutes: 0, difficulty: 'medium', assists: true, playerName: 'Test', grid: grid.map((g) => g.car), compound: 'soft', seed: 9, damage: false })
    let boxed = false
    for (let n = 0; n < 60 * 60 * 10 && r.phase !== 'done'; n++) {
      if (r.player.pit === 'none') drive(r, t, prof.v, 0.93)
      if (!boxed && r.player.laps === 1) {
        r.compound = 'medium'
        r.boxRequest = boxed = true
      }
      r.step(1 / 60)
      for (const c of r.cars) assert.ok(Number.isFinite(c.x) && Number.isFinite(c.dist), `car ${c.i} stays finite`)
    }
    assert.equal(r.phase, 'done', `${t.def.name}: the race ends`)
    const res = r.results()
    const me = res.find((x) => x.player)!
    assert.equal(me.laps, 3, 'the player did exactly the race distance')
    assert.equal(me.stops, 1)
    assert.equal(me.penalty, 0, 'no jump start, two compounds used')
    for (const x of res) assert.ok(x.stops >= 1 && x.penalty === 0, `${x.code}: one stop, no penalty`)
    for (let k = 1; k < res.length; k++) assert.ok(res[k].laps < res[k - 1].laps || res[k].time >= res[k - 1].time, 'classified in order')
  }
})

test('a jump start costs five seconds', () => {
  const { t, prof } = built[0]
  const r = new Session({ track: t, profile: prof.v, profileLap: prof.lapTime, kind: 'race', laps: 3, minutes: 0, difficulty: 'easy', assists: true, playerName: 'Test', seed: 1 })
  for (let n = 0; n < 60 * 3; n++) {
    r.input = { throttle: 1, brake: 0, steer: 0, analog: false }
    r.step(1 / 60)
  }
  assert.equal(r.player.penalty, 5)
})

test('the classics: slower coupés, no DRS, the player\'s chosen car, a race to the flag', () => {
  setRaceSeries('classic', 3)
  try {
    assert.equal(TEAMS[0].name, 'Bavaria Sport', 'the player races the car they chose')
    assert.equal(TEAMS[0].model, 'bavaria')
    assert.equal(new Set(TEAMS.map((t) => t.name)).size, 6, 'every team still races')
    assert.ok(TEAMS.every((t) => t.model), 'every classic team has a coupé')
    const t = built[0].t
    const prof = speedProfile(t)
    assert.ok(prof.lapTime > built[0].prof.lapTime * 1.3, `slower than the single-seaters (${prof.lapTime.toFixed(1)} s)`)
    const r = new Session({ track: t, profile: prof.v, profileLap: prof.lapTime, kind: 'race', laps: 3, minutes: 0, difficulty: 'medium', assists: true, playerName: 'Test', compound: 'soft', seed: 4 })
    let boxed = false
    let drs = false
    for (let n = 0; n < 60 * 60 * 12 && r.phase !== 'done'; n++) {
      if (r.player.pit === 'none') drive(r, t, prof.v, 0.93)
      if (!boxed && r.player.laps === 1) {
        r.compound = 'medium'
        r.boxRequest = boxed = true
      }
      r.step(1 / 60)
      if (r.cars.some((c) => c.drs)) drs = true
    }
    assert.equal(r.phase, 'done', 'the classic race ends')
    assert.equal(drs, false, 'no DRS in the classics')
    assert.equal(r.results().find((x) => x.player)!.laps, 3)
  } finally {
    setRaceSeries('modern')
  }
})

test('damage: a crash into the wall breaks the front wing and costs grip; with damage off nothing breaks', () => {
  const { t, prof } = built[0]
  const r = new Session({ track: t, profile: prof.v, profileLap: prof.lapTime, kind: 'race', laps: 5, minutes: 0, difficulty: 'easy', assists: true, playerName: 'Test', compound: 'soft', seed: 2 })
  // through the lights, then straight on at the first corner into the barrier
  let n = 0
  while (r.phase === 'lights' && n++ < 60 * 20) r.step(1 / 60)
  for (let k = 0; k < 60 * 25 && r.player.damage.fw < 0.25; k++) {
    r.input = { throttle: 1, brake: 0, steer: 0, analog: true }
    r.step(1 / 60)
  }
  const d = r.player.damage
  assert.ok(d.fw >= 0.25, `the nose took the blow (front wing ${d.fw.toFixed(2)}, rear ${d.rw.toFixed(2)}, suspension ${d.susp.toFixed(2)})`)
  assert.ok(r.events.some((e) => /Front wing/.test(e.text)), 'the player is told')
  assert.ok(r.impacts.some((i) => i.part === 'fw'), 'the engine is given the blow to show')
  // a damaged car is slower in a corner: less grip at the front
  const corner = (damage: typeof d) => {
    const b = new CarBody()
    b.place(0, 0, 0, 55)
    for (let k = 0; k < 120; k++) b.step(1 / 60, { throttle: 0.5, brake: 0, steer: 0.5 }, { grip: 1, drag: 0, assists: true, damage })
    return Math.abs(b.h)
  }
  assert.ok(corner({ ...d }) < corner({ fw: 0, rw: 0, susp: 0, side: 1 }), 'a broken front wing turns less')
  // with damage off nothing breaks
  const safe = new Session({ track: t, profile: prof.v, profileLap: prof.lapTime, kind: 'race', laps: 5, minutes: 0, difficulty: 'easy', assists: true, playerName: 'Test', seed: 2, damage: false })
  n = 0
  while (safe.phase === 'lights' && n++ < 60 * 20) safe.step(1 / 60)
  for (let k = 0; k < 60 * 25; k++) {
    safe.input = { throttle: 1, brake: 0, steer: 0, analog: true }
    safe.step(1 / 60)
  }
  assert.equal(safe.player.damage.fw + safe.player.damage.rw + safe.player.damage.susp, 0)
})

test('engine sound: every engine fires, gets louder with the throttle, rises in pitch with the revs, and ships to the worklet', () => {
  const sr = 48000
  const render = (kind: EngineKind, rpm: number, throttle: number) => {
    const d = new EngineDSP(sr)
    d.configure(ENGINES[kind])
    d.idle = kind === 'v10' ? 4200 : 2600
    d.redline = kind === 'v10' ? 12400 : 7900
    const out = new Float32Array(128 * 188)
    const blk = new Float32Array(128)
    for (let i = 0; i < out.length; i += 128) {
      d.process(blk, rpm, rpm, throttle)
      out.set(blk, i)
    }
    return out.subarray(128 * 94)
  }
  const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length)
  // zero crossings of the low-passed signal: a rough measure of the pitch
  const pitch = (x: Float32Array) => {
    let lp = 0
    let prev = 0
    let n = 0
    for (const v of x) {
      lp += (v - lp) * 0.08
      if ((lp > 0) !== (prev > 0)) n++
      prev = lp
    }
    return n
  }
  for (const kind of Object.keys(ENGINES) as EngineKind[]) {
    const idle = render(kind, kind === 'v10' ? 4200 : 2600, 0)
    const full = render(kind, kind === 'v10' ? 11000 : 7000, 1)
    assert.ok(full.every((v) => Number.isFinite(v) && Math.abs(v) < 1), `${kind}: finite, no clipping`)
    assert.ok(rms(idle) > 0.005, `${kind}: idles`)
    assert.ok(rms(full) > rms(idle) * 2, `${kind}: louder on full throttle`)
    assert.ok(pitch(full) > pitch(idle), `${kind}: higher with the revs`)
  }
  assert.equal(engineOf('modern'), 'v10')
  assert.deepEqual(['stoccarda', 'dieppe', 'bavaria'].map((m) => engineOf('classic', m)), ['flat6', 'inline4', 'inline6'])
  // the worklet module is valid JavaScript (compiled, not run: there is no AudioWorkletGlobalScope here)
  assert.doesNotThrow(() => new Function(workletSource()))
})

test('multiplayer: every game sees the same grid, names and cars; the host drives the AI, guests show it', () => {
  // each game puts its own car first: the mapping is a permutation, and the player's car is 0
  for (let mine = 0; mine < 12; mine++) {
    const seen = new Set(Array.from({ length: 12 }, (_, c) => localCar(c, mine)))
    assert.equal(seen.size, 12)
    assert.equal(localCar(mine, mine), 0)
  }
  const t = TRACKS[0]
  const track = buildTrack(t)
  const prof = speedProfile(track)
  const humans = [
    { car: 4, id: 11, name: 'Ann', human: true },
    { car: 9, id: 12, name: 'Bob', human: true },
  ]
  const start: RaceStart = {
    settings: { track: 'park', series: 'modern', laps: 2, ai: true },
    seed: 99,
    lineup: Array.from({ length: 12 }, (_, c) => humans.find((h) => h.car === c) ?? { car: c, id: 0, name: '', human: false }),
  }
  const game = (you: number, host: boolean) => {
    const v = multiLineup(start, you, host)
    setRaceSeries('modern', v.team)
    const s = new Session({
      track, profile: prof.v, profileLap: prof.lapTime, kind: 'race', laps: 2, minutes: 0, difficulty: 'medium', assists: true, playerName: 'x',
      grid: v.grid, compound: 'medium', seed: start.seed, names: v.names, remote: v.remote, out: v.out, damage: false,
    })
    // the team each car shows, by its grid car
    const teams = Array.from({ length: 12 }, (_, c) => TEAMS[s.cars[v.toLocal.get(c)!].team].name)
    return { v, s, teams }
  }
  const ann = game(11, true)
  const bob = game(12, false)
  assert.equal(ann.s.player.driver.name, 'Ann')
  assert.equal(bob.s.player.driver.name, 'Bob')
  for (let c = 0; c < 12; c++) {
    const a = ann.s.cars[ann.v.toLocal.get(c)!]
    const b = bob.s.cars[bob.v.toLocal.get(c)!]
    // same driver, same team colours, same grid slot on both games
    assert.equal(a.driver.name, b.driver.name)
    assert.equal(ann.teams[c], teamsOf('modern')[c >> 1].name)
    assert.equal(bob.teams[c], ann.teams[c])
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.01, `car ${c} on the same grid slot`)
    // the host drives the AI and itself; Bob's game drives only Bob
    assert.equal(a.remote, c === 9)
    assert.equal(b.remote, c !== 9)
  }
  // the players start at the front, in the order they joined
  const first = [...ann.s.cars].sort((p, q) => q.dist - p.dist)
  assert.deepEqual(first.slice(0, 2).map((c) => c.driver.name), ['Ann', 'Bob'])
  // the same seed: the lights go out at the same moment on both games
  let ta = 0
  let tb = 0
  for (let k = 0; k < 60 * 10 && (ann.s.phase === 'lights' || bob.s.phase === 'lights'); k++) {
    if (ann.s.phase === 'lights') ann.s.step(1 / 60), (ta = k)
    if (bob.s.phase === 'lights') bob.s.step(1 / 60), (tb = k)
  }
  assert.equal(ann.s.phase, 'green')
  assert.ok(Math.abs(ta - tb) <= 1, 'lights out together')
  // a car's state survives the trip; Bob's game leaves the AI to the host's messages
  const aiCars = ann.s.cars.filter((c) => !c.player && !c.remote)
  const from = aiCars.map((c) => c.dist)
  for (let k = 0; k < 60 * 6; k++) ann.s.step(1 / 60)
  // (the two players sit still on the front row in this test, so some AI cars behind them are boxed in)
  assert.ok(Math.max(...aiCars.map((c, k) => c.dist - from[k])) > 50, 'the host drives the AI')
  const ai = ann.s.cars[ann.v.toLocal.get(0)!]
  const u = unpackCar(packCar(0, ai))!
  assert.equal(u[0], 0)
  assert.ok(Math.abs(u[1].x - ai.x) < 0.01 && Math.abs(u[1].dist - ai.dist) < 0.01)
  const bAi = bob.s.cars[bob.v.toLocal.get(0)!]
  const before = bAi.dist
  for (let k = 0; k < 60; k++) bob.s.step(1 / 60)
  assert.equal(bAi.dist, before, 'guests do not drive the AI themselves')
  // players only: the AI cars stay in their garages and out of the order
  const solo = multiLineup({ ...start, lineup: humans }, 11, true)
  assert.equal(solo.out.length, 10)
  setRaceSeries('modern', solo.team)
  const s2 = new Session({
    track, profile: prof.v, profileLap: prof.lapTime, kind: 'race', laps: 2, minutes: 0, difficulty: 'medium', assists: true, playerName: 'x',
    grid: solo.grid, seed: 1, names: solo.names, remote: solo.remote, out: solo.out, damage: false,
  })
  assert.equal(s2.order().length, 2)
  assert.equal(s2.results().length, 2)
  setRaceSeries('modern', 0)
})
