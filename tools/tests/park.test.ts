// Wobbleland (src/apps/minigames/parkRules.ts) played headless by a simple
// player: full plunges, and a flip whenever a ball comes down onto a flipper.
// Run:  node --test tools/tests/park.test.ts

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BALL_R, LANE_X0, Park, TRACK, TRACK_LENGTH, TW, trackAt, type ParkEvent } from '../../src/apps/minigames/parkRules.ts'

const DT = 1 / 240

function seeded(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

/** Plays up to `seconds`; returns every event. */
function play(g: Park, seconds: number, rng: () => number): ParkEvent[] {
  const seen: ParkEvent[] = []
  let plunge = 0
  let hold = [0, 0]
  for (let t = 0; t < seconds && !g.over; t += DT) {
    if (g.plungerBall(0) && !g.charging && g.autoLaunch === 0 && (plunge += DT) > 0.3) {
      g.setPlunger(true)
      plunge = 0
    }
    if (g.charging && g.charge >= 0.75 + rng() * 0.25) g.setPlunger(false)
    for (const [i, f] of g.flippers.entries()) {
      const near = g.balls.some((b) => b.mode === 'free' && b.vy > -50 && Math.hypot(b.x - (f.px + (i ? -40 : 40)), b.y - f.py) < 60)
      if (near && hold[i] <= 0) hold[i] = 0.18 + rng() * 0.1
      hold[i] -= DT
      g.setFlipper(i ? 'R' : 'L', hold[i] > 0)
    }
    g.update(DT)
    seen.push(...g.events)
    g.events.length = 0
    for (const b of g.balls) {
      assert.ok(b.x > 0 && b.x < TW && b.y > -40, `ball off the table at ${b.x.toFixed(0)},${b.y.toFixed(0)}`)
      if (b.mode === 'free' && b.x < LANE_X0) assert.ok(b.x >= 20 - 1, `ball inside the left wall: ${b.x}`)
    }
  }
  return seen
}

test('the coaster track runs from the mouth to the left inlane', () => {
  assert.ok(TRACK_LENGTH > 600, `track ${TRACK_LENGTH}`)
  const end = trackAt(TRACK_LENGTH)
  assert.ok(end.x > 52 + BALL_R && end.x < 92 && end.dy > 0, `ends at ${end.x},${end.y}`)
  assert.ok(TRACK.length > 50)
})

test('a full game plays through: rides, scoring, three balls, game over', () => {
  const counts = new Map<string, number>()
  let games = 0
  for (let seed = 1; seed <= 6; seed++) {
    const rng = seeded(seed)
    const g = new Park(rng)
    const ev = play(g, 900, rng)
    for (const e of ev) counts.set(e.type, (counts.get(e.type) ?? 0) + 1)
    assert.ok(g.score > 0)
    if (g.over) games++
  }
  assert.ok(games >= 4, `only ${games} games ended`)
  for (const t of ['launch', 'bumper', 'sling', 'lane', 'drain', 'gameover']) assert.ok(counts.get(t), `no ${t} event`)
  assert.ok((counts.get('rampEnd') ?? 0) + (counts.get('scoop') ?? 0) + (counts.get('duck') ?? 0) > 0, 'no shot reached a ride')
})
