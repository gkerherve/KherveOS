// Kherve Grand Prix: the circuits, the car and the sessions, without a browser.
// A simple driver (pure pursuit on the racing line at a share of the speed
// profile) sits in the player's car.
// Run:  node --test tools/tests/grandprix.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TRACKS, buildTrack, locate, pointAt, sampleAt, surfaceAt, type Track } from '../../src/apps/minigames/f1Track.ts'
import { CarBody, speedProfile, steerLock, tyreGrip, newTyres } from '../../src/apps/minigames/f1Physics.ts'
import { Session, TEAMS, setRaceSeries } from '../../src/apps/minigames/f1Race.ts'

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
  setRaceSeries('classic', 'bavaria')
  try {
    assert.equal(TEAMS[0].model, 'bavaria', 'the player races the coupé they chose')
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
