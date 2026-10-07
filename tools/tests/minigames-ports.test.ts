// The KherveFitting mini-game ports (Meteor Smash, Flappy Khervey,
// Solitaire, Electron Game, Material Lab): their rules, without a browser.
// Run:  node --test tools/tests/minigames-ports.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Asteroids, BULLET_LIFE, H as AH, INITIAL_ROCKS, SAFE_DISTANCE, START_LIVES, W as AW, collides, rockPoints, wrap,
  type Rock,
} from '../../src/apps/minigames/asteroidsRules.ts'
import {
  BIRD_H, BIRD_X, DIFFICULTIES, Flappy, GROUND_Y, H as FH, PIPE_W, POINTS as FPOINTS, SHOOT_DELAY, STAGES, overlaps, skyColor, sunPosition, moonPosition,
} from '../../src/apps/minigames/flappyRules.ts'
import {
  POINTS as SPOINTS, Solitaire, fitsFoundation, fitsTableau, newDeck, winBonus, type Card, type Suit,
} from '../../src/apps/minigames/solitaireRules.ts'
import {
  Electrons, MAX_ELECTRONS, MIN_ELECTRONS, centreOf, pointsPerSecond, stabilityOf, stepElectrons, type Electron,
} from '../../src/apps/minigames/electronsRules.ts'
import {
  MaterialLab, POINTS as LPOINTS, REACTIONS, START_UNLOCKED, fuelFor,
} from '../../src/apps/minigames/materialLabRules.ts'

/** A repeatable random number generator. */
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

// ------------------------------------------------------------------ Meteor Smash

function rockAt(g: Asteroids, x: number, y: number, size: 1 | 2 | 3): Rock {
  const r = g.makeRock(x, y, size)
  r.vx = r.vy = r.spin = 0
  return r
}

test('asteroids: circles collide when closer than their radii', () => {
  assert.equal(collides({ x: 0, y: 0, radius: 10 }, { x: 19, y: 0, radius: 10 }), true)
  assert.equal(collides({ x: 0, y: 0, radius: 10 }, { x: 20, y: 0, radius: 10 }), false)
  assert.equal(wrap(-5, 800), 795)
  assert.equal(wrap(805, 800), 5)
})

test('asteroids: points by size, and big rocks split in two smaller ones', () => {
  assert.deepEqual([rockPoints(3), rockPoints(2), rockPoints(1)], [20, 40, 60])
  const g = new Asteroids(seeded(1))
  const big = g.split(rockAt(g, 100, 100, 3))
  assert.equal(big.length, 2)
  assert.ok(big.every((r) => r.size === 2 && r.radius === 30))
  assert.equal(g.split(rockAt(g, 100, 100, 1)).length, 0)
})

test('asteroids: a wave of 5 + score/1000 rocks, never near the ship', () => {
  const g = new Asteroids(seeded(2))
  assert.equal(g.rocks.length, INITIAL_ROCKS)
  assert.equal(g.wave, 1)
  for (const r of g.rocks) assert.ok(Math.hypot(r.x - AW / 2, r.y - AH / 2) > SAFE_DISTANCE)
  g.score = 2500
  g.rocks = []
  g.update()
  assert.equal(g.wave, 2)
  assert.equal(g.rocks.length, INITIAL_ROCKS + 2)
})

test('asteroids: a bullet breaks a rock, scores and splits it', () => {
  const g = new Asteroids(seeded(3))
  g.ship.angle = 0 // pointing right
  g.rocks = [rockAt(g, AW / 2 + 60, AH / 2, 3)]
  g.shoot()
  for (let i = 0; i < 6; i++) g.update()
  assert.equal(g.score, 20)
  assert.equal(g.bullets.length, 0)
  assert.equal(g.rocks.length, 2)
  assert.ok(g.rocks.every((r) => r.size === 2))
})

test('asteroids: bullets wrap and expire after a second', () => {
  const g = new Asteroids(seeded(4))
  g.rocks = [rockAt(g, 10, 10, 1)]
  g.ship.angle = -90
  g.ship.y = 595
  g.shoot()
  g.update()
  assert.ok(g.bullets[0].y > 500, 'wrapped round from the top to the bottom')
  for (let i = 1; i < BULLET_LIFE; i++) g.update()
  assert.equal(g.bullets.length, 0)
})

test('asteroids: a crash costs a ship, the new one is shielded, the last ends the game', () => {
  const g = new Asteroids(seeded(5))
  g.rocks = [rockAt(g, AW / 2 + 5, AH / 2, 2)]
  g.update()
  assert.equal(g.lives, START_LIVES - 1)
  assert.equal(g.state, 'respawn')
  for (let i = 0; i < 80; i++) g.update()
  assert.equal(g.state, 'play')
  assert.ok(g.shield > 0)
  g.update()
  assert.equal(g.lives, START_LIVES - 1, 'the shield protects the new ship')
  g.shield = 0
  g.lives = 1
  g.update()
  assert.equal(g.state, 'dead')
  assert.equal(g.over, false)
  for (let i = 0; i < 100; i++) g.update()
  assert.equal(g.over, true)
})

test('asteroids: thrust accelerates the way the ship points, friction slows it', () => {
  const g = new Asteroids(seeded(6))
  g.rocks = []
  g.shield = 99
  g.ship.angle = 0
  g.input.thrust = true
  g.rocks = [rockAt(g, 10, 10, 1)]
  g.update()
  assert.ok(Math.abs(g.ship.vx - 0.3 * 0.99) < 1e-9)
  assert.ok(Math.abs(g.ship.vy) < 1e-9)
  g.input.thrust = false
  const v = g.ship.vx
  g.update()
  assert.ok(g.ship.vx < v)
})

// ------------------------------------------------------------------ Flappy Khervey

test('flappy: rectangles overlap like pygame (touching edges do not)', () => {
  assert.equal(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 }), true)
  assert.equal(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 }), false)
})

test('flappy: pipe gaps follow the difficulty', () => {
  for (const d of ['easy', 'medium', 'hard'] as const) {
    const g = new Flappy(seeded(7), d)
    for (let i = 0; i < 50; i++) {
      const p = g.newPipe(400)
      assert.equal(p.gap, DIFFICULTIES[d].pipeGap)
      assert.ok(p.gapY >= 150 && p.gapY <= FH - p.gap - 150)
    }
  }
})

test('flappy: gravity, flaps, and the ground ends the game', () => {
  const g = new Flappy(seeded(8))
  g.pipes = []
  g.update()
  assert.ok(Math.abs(g.bird.vy - 0.4) < 1e-9)
  g.flap()
  assert.equal(g.bird.vy, -7)
  g.bird.y = GROUND_Y - BIRD_H - 1
  g.bird.vy = 5
  g.update()
  assert.equal(g.state, 'dead')
  assert.ok(g.events.some((e) => e.type === 'crash' && e.what === 'ground'))
})

test('flappy: passing a pipe scores a point; stages at 20, 40…', () => {
  const g = new Flappy(seeded(9), 'easy')
  g.pipes = [{ ...g.newPipe(0), x: BIRD_X - PIPE_W + 1, px: 0, gapY: 150, gap: 220 }]
  g.bird.y = 250
  g.score = STAGES[0] - 1
  g.update()
  assert.equal(g.score, STAGES[0])
  assert.equal(g.stage, 2)
  assert.ok(g.events.some((e) => e.type === 'stage' && e.stage === 2))
})

test('flappy: hitting a pipe knocks Khervey down, then the game ends', () => {
  const g = new Flappy(seeded(10))
  g.pipes = [{ ...g.newPipe(0), x: BIRD_X + 10, px: 0, gapY: 150, gap: 180 }]
  g.bird.y = 100 // in the top pipe
  g.update()
  assert.equal(g.state, 'falling')
  for (let i = 0; i < 200 && g.state === 'falling'; i++) g.update()
  assert.equal(g.state, 'dead')
})

test('flappy: held fire shoots every 10 frames; enemies and bees score 5 and 3', () => {
  const g = new Flappy(seeded(11))
  g.pipes = []
  g.input.fire = true
  let shots = 0
  for (let i = 0; i < SHOOT_DELAY * 3; i++) {
    g.bird.y = 250
    g.bird.vy = 0
    g.update()
    shots += g.events.filter((e) => e.type === 'shoot').length
    g.events = []
  }
  assert.equal(shots, 3)

  const h = new Flappy(seeded(12))
  h.pipes = []
  h.enemies = [{ x: 200, y: 300, px: 200, py: 300, vy: 0, color: '#f00', wing: 0 }]
  h.bees = [{ x: 260, y: 400, px: 260, py: 400, hover: 0, wing: 0 }]
  h.shots = [{ x: 190, y: 310, px: 190 }, { x: 250, y: 405, px: 250 }]
  h.bird.y = 250
  h.update()
  assert.equal(h.score, FPOINTS.enemy + FPOINTS.bee)
  assert.equal(h.enemies.length + h.bees.length, 0)
})

test('flappy: enemy birds fly against Khervey', () => {
  const g = new Flappy(seeded(13))
  g.pipes = []
  g.enemies = [{ x: 300, y: 300, px: 300, py: 300, vy: 0, color: '#f00', wing: 0 }]
  g.bird.y = 100
  g.bird.vy = 2 // falling
  g.update()
  assert.ok(g.enemies[0].y < 300, 'goes up while he falls')
})

test('flappy: the sky goes from night to dawn to day', () => {
  assert.deepEqual(skyColor(600), [135, 206, 235])
  assert.deepEqual(skyColor(0), [25, 25, 60])
  assert.deepEqual(skyColor(300 + 60), [195, 173, 147])
  assert.equal(sunPosition(200), null)
  assert.ok(sunPosition(720)!.y < 10)
  assert.ok(moonPosition(0) !== null && moonPosition(720) === null)
})

// ------------------------------------------------------------------ Solitaire

const card = (suit: Suit, rank: number, up = true, id = rank + 13 * ['diamonds', 'spades', 'hearts', 'clubs'].indexOf(suit)): Card => ({ id, suit, rank, up })

test('solitaire: a fresh deal has 7 columns of 1..7, tops face up, and 24 in the stock', () => {
  const g = new Solitaire(seeded(20))
  assert.deepEqual(g.tableau.map((p) => p.length), [1, 2, 3, 4, 5, 6, 7])
  for (const p of g.tableau) {
    assert.equal(p[p.length - 1].up, true)
    assert.ok(p.slice(0, -1).every((c) => !c.up))
  }
  assert.equal(g.stock.length, 24)
  const ids = new Set([...g.stock, ...g.tableau.flat()].map((c) => c.id))
  assert.equal(ids.size, 52)
  assert.equal(newDeck(seeded(1)).length, 52)
})

test('solitaire: foundation and tableau rules', () => {
  assert.equal(fitsFoundation(card('hearts', 1), null), true)
  assert.equal(fitsFoundation(card('hearts', 2), null), false)
  assert.equal(fitsFoundation(card('hearts', 2), card('hearts', 1)), true)
  assert.equal(fitsFoundation(card('diamonds', 2), card('hearts', 1)), false)
  assert.equal(fitsTableau(card('spades', 13), null), true)
  assert.equal(fitsTableau(card('spades', 12), null), false)
  assert.equal(fitsTableau(card('hearts', 6), card('spades', 7)), true)
  assert.equal(fitsTableau(card('diamonds', 6), card('hearts', 7)), false, 'same colour')
  assert.equal(fitsTableau(card('hearts', 5), card('spades', 7)), false, 'not one lower')
})

/** An empty table to set up by hand. */
function table(): Solitaire {
  const g = new Solitaire(seeded(21))
  g.stock = []
  g.waste = []
  g.foundations = [[], [], [], []]
  g.tableau = [[], [], [], [], [], [], []]
  g.events = []
  return g
}

test('solitaire: moving a run of cards, turning up the card under it, scoring', () => {
  const g = table()
  g.tableau[0] = [card('clubs', 3, false), card('spades', 9), card('hearts', 8)]
  g.tableau[1] = [card('diamonds', 10)]
  g.tableau[2] = [card('clubs', 10)]
  // 9♠ (with 8♥) onto 10♦.
  assert.equal(g.canMove({ kind: 'tableau', index: 0, row: 1 }, { kind: 'tableau', index: 1 }), true)
  assert.equal(g.canMove({ kind: 'tableau', index: 0, row: 1 }, { kind: 'tableau', index: 2 }), false, '9♠ on 10♣: same colour')
  assert.equal(g.canMove({ kind: 'tableau', index: 0, row: 0 }, { kind: 'tableau', index: 1 }), false, 'face-down cards stay')
  assert.equal(g.move({ kind: 'tableau', index: 0, row: 1 }, { kind: 'tableau', index: 1 }), true)
  assert.deepEqual(g.tableau[1].map((c) => c.rank), [10, 9, 8])
  assert.equal(g.tableau[0][0].up, true, 'the 3♣ turned up')
  assert.equal(g.score, SPOINTS.flip)
})

test('solitaire: only kings go into an empty column; waste and foundation moves score', () => {
  const g = table()
  g.waste = [card('hearts', 12)]
  assert.equal(g.canMove({ kind: 'waste' }, { kind: 'tableau', index: 0 }), false)
  g.waste = [card('hearts', 13)]
  assert.equal(g.move({ kind: 'waste' }, { kind: 'tableau', index: 0 }), true)
  assert.equal(g.score, SPOINTS.wasteToTableau)
  g.waste = [card('spades', 1)]
  assert.equal(g.move({ kind: 'waste' }, { kind: 'foundation', index: 2 }), true, 'any ace in any empty foundation')
  assert.equal(g.score, SPOINTS.wasteToTableau + SPOINTS.toFoundation)
  g.tableau[1] = [card('spades', 2), card('diamonds', 5)]
  assert.equal(g.canMove({ kind: 'tableau', index: 1, row: 0 }, { kind: 'foundation', index: 2 }), false, 'one card at a time to a foundation')
})

test('solitaire: the stock draws one card, then turns the waste back over in order', () => {
  const g = table()
  g.stock = [card('clubs', 5, false), card('clubs', 6, false), card('clubs', 7, false)]
  g.draw()
  g.draw()
  assert.deepEqual(g.waste.map((c) => c.rank), [7, 6])
  assert.ok(g.waste.every((c) => c.up))
  g.draw()
  g.draw() // recycle
  assert.equal(g.waste.length, 0)
  assert.equal(g.stock.length, 3)
  assert.ok(g.stock.every((c) => !c.up))
  g.draw()
  assert.equal(g.waste[0].rank, 7, 'the first card drawn comes first again')
})

test('solitaire: undo puts everything back', () => {
  const g = table()
  g.tableau[0] = [card('clubs', 3, false), card('hearts', 1)]
  g.stock = [card('spades', 9, false)] // so the game doesn't finish by itself
  const before = JSON.stringify(g.tableau)
  assert.equal(g.autoMove(), true)
  assert.equal(g.foundations[0].length, 1)
  assert.ok(g.score > 0)
  assert.equal(g.undo(), true)
  assert.equal(JSON.stringify(g.tableau), before)
  assert.equal(g.score, 0)
  assert.equal(g.foundations[0].length, 0)
})

test('solitaire: a click sends a card to a foundation first, else to a column', () => {
  const g = table()
  g.foundations[0] = [card('hearts', 1)]
  g.tableau[0] = [card('hearts', 2)]
  g.tableau[1] = [card('spades', 3)]
  assert.deepEqual(g.bestTarget({ kind: 'tableau', index: 0, row: 0 }), { kind: 'foundation', index: 0 })
  g.foundations[0] = []
  assert.deepEqual(g.bestTarget({ kind: 'tableau', index: 0, row: 0 }), { kind: 'tableau', index: 1 })
})

test('solitaire: no more moves is detected, and stays quiet while one exists', () => {
  const g = table()
  g.tableau[0] = [card('clubs', 2, false), card('hearts', 9)]
  g.tableau[1] = [card('diamonds', 4)]
  g.stock = [card('spades', 6, false)]
  assert.equal(g.hasUsefulMove(), false)
  g.stock.push(card('spades', 10, false)) // fits nowhere either
  assert.equal(g.hasUsefulMove(), false)
  g.stock.push(card('clubs', 8, false)) // the 8♣ goes on the 9♥
  assert.equal(g.hasUsefulMove(), true)
})

test('solitaire: winning ends the game with a time bonus; auto-finish plays the rest', () => {
  const g = table()
  const suits: Suit[] = ['diamonds', 'spades', 'hearts', 'clubs']
  suits.forEach((s, i) => (g.foundations[i] = Array.from({ length: 12 }, (_, r) => card(s, r + 1))))
  g.tableau[0] = [card('diamonds', 13)]
  g.tableau[1] = [card('spades', 13)]
  g.tableau[2] = [card('hearts', 13)]
  g.tableau[3] = [card('clubs', 13)]
  g.elapsed = 100
  g.move({ kind: 'tableau', index: 0, row: 0 }, { kind: 'foundation', index: 0 })
  assert.equal(g.finishing, true)
  for (let i = 0; i < 60 && g.state === 'play'; i++) g.update(1 / 60)
  assert.equal(g.state, 'won')
  assert.ok(g.events.some((e) => e.type === 'won'))
  assert.equal(winBonus(100), SPOINTS.win + 1000)
  assert.ok(g.score >= SPOINTS.win)
})

test('solitaire: giving up ends the game with the points so far', () => {
  const g = new Solitaire(seeded(22))
  g.score = 35
  assert.equal(g.resign(), true)
  assert.equal(g.draw(), false)
  for (let i = 0; i < 60; i++) g.update(1 / 60)
  assert.equal(g.over, true)
  assert.equal(g.score, 35)
})

// ------------------------------------------------------------------ Electron Game

const electron = (x: number, y: number): Electron => ({ x, y, vx: 0, vy: 0, ax: 0, ay: 0, tail: [] })

test('electrons: two electrons pull towards each other', () => {
  const list = [electron(100, 200), electron(300, 200)]
  // Forces first set the acceleration, then the speed, then the position.
  for (let i = 0; i < 3; i++) stepElectrons(list)
  assert.ok(list[0].x > 100 && list[1].x < 300)
  assert.ok(Math.abs(list[0].y - 200) < 1e-9)
  assert.deepEqual(centreOf([electron(0, 0), electron(10, 20)]), { x: 5, y: 10 })
})

test('electrons: stability thresholds and points', () => {
  assert.equal(stabilityOf(0.3), 'Very Stable')
  assert.equal(stabilityOf(0.5), 'Stable')
  assert.equal(stabilityOf(0.51), 'Unstable')
  assert.equal(pointsPerSecond(4, 'Stable'), 16)
  assert.equal(pointsPerSecond(4, 'Very Stable'), 32)
  assert.equal(pointsPerSecond(4, 'Unstable'), 0)
})

test('electrons: add up to the maximum, remove down to two', () => {
  const g = new Electrons(seeded(30))
  assert.equal(g.electrons.length, 3)
  while (g.electrons.length < MAX_ELECTRONS) assert.equal(g.add(100, 100), true)
  assert.equal(g.add(100, 100), false)
  while (g.electrons.length > MIN_ELECTRONS) assert.equal(g.remove(), true)
  assert.equal(g.remove(), false)
  assert.equal(g.mostElectrons, MAX_ELECTRONS)
})

test('electrons: a stable atom scores, an unstable one decays and ends the game', () => {
  const g = new Electrons(seeded(31))
  let scoredWhileUnstable = 0
  let scoredWhileStable = 0
  for (let i = 0; i < 1200 && g.state === 'play'; i++) {
    const before = g.score
    g.update(1 / 60)
    if (g.stability === 'Unstable') scoredWhileUnstable += g.score - before
    else scoredWhileStable += g.score - before
  }
  assert.equal(scoredWhileUnstable, 0)
  assert.ok(scoredWhileStable > 0)
  const h = new Electrons(seeded(32))
  let t = 0
  while (h.state === 'play' && t < 200) {
    h.update(1 / 60)
    t += 1 / 60
  }
  assert.ok(h.state === 'decayed' || h.state === 'timeup')
  assert.ok(t <= 120 + 1 / 30, `ended after ${t} s`)
  for (let i = 0; i < 120; i++) h.update(1 / 60)
  assert.equal(h.over, true)
})

test('electrons: the decay meter fills while unstable', () => {
  const g = new Electrons(seeded(33))
  // Throw a far electron in: the nucleus jumps, the atom goes unstable.
  g.add(5000, 5000)
  for (let i = 0; i < 30; i++) g.update(1 / 60)
  assert.equal(g.stability, 'Unstable')
  assert.ok(g.decay > 0)
  assert.equal(g.stableTime, 0)
})

// ------------------------------------------------------------------ Material Lab

function labWith(...atoms: string[]): MaterialLab {
  const g = new MaterialLab()
  for (const s of atoms) g.unlocked.add(s)
  for (const s of atoms) g.add(s)
  g.events = []
  return g
}

test('material lab: starts with eight elements; locked ones can not go in', () => {
  const g = new MaterialLab()
  assert.deepEqual([...g.unlocked].sort(), [...START_UNLOCKED].sort())
  assert.equal(g.add('S'), false)
  assert.equal(g.add('H'), true)
  assert.equal(REACTIONS.length, 44)
})

test('material lab: water at room temperature, a discovery that unlocks F and Li', () => {
  const g = labWith('H', 'H', 'O')
  const r = g.react()
  assert.equal(r.kind, 'new')
  assert.equal(r.reaction?.product, 'H2O')
  assert.equal(g.score, LPOINTS.discovery)
  assert.ok(g.unlocked.has('F') && g.unlocked.has('Li'))
  assert.equal(g.atoms, 0)
})

test('material lab: a known compound scores 10 the first three times, then nothing', () => {
  const g = labWith('H', 'H', 'O')
  g.react()
  const scores = []
  for (let i = 0; i < 4; i++) {
    g.add('H')
    g.add('H')
    g.add('O')
    scores.push(g.react().points)
  }
  assert.deepEqual(scores, [10, 10, 10, 0])
  assert.equal(g.score, LPOINTS.discovery + 3 * LPOINTS.repeat)
})

test('material lab: the furnace sets the temperature; too cold and too hot are reported', () => {
  const g = labWith('Fe', 'S')
  assert.equal(g.react().kind, 'cold')
  assert.equal(g.toggleFurnace(), false, 'no fuel, no fire')
  g.setFuel(fuelFor(600))
  assert.equal(g.fuel, 6)
  assert.equal(g.toggleFurnace(), true)
  assert.equal(g.targetTemp, 625)
  g.update(0.5)
  assert.ok(g.temperature > 25 && g.temperature < 625, 'warms up gradually')
  g.update(5)
  assert.equal(g.temperature, 625)
  assert.equal(g.react().kind, 'new')
  g.add('Fe')
  g.add('S')
  g.setFuel(10)
  g.update(5)
  assert.equal(g.react().kind, 'hot')
  g.setFuel(0)
  assert.equal(g.furnaceOn, false, 'an empty furnace goes out')
})

test('material lab: the right reaction for the atoms and the heat (CO₂ or CO)', () => {
  const g = labWith('C', 'O', 'O')
  g.setFuel(5)
  g.toggleFurnace()
  g.update(5) // 525 °C: both fit, CO₂ uses exactly what is there
  assert.equal(g.react().reaction?.product, 'CO2')
  const h = labWith('C', 'O', 'O')
  h.setFuel(7)
  h.toggleFurnace()
  h.update(5) // 725 °C: too hot for CO₂, fine for CO, one O left over
  const r = h.react()
  assert.equal(r.reaction?.product, 'CO')
  assert.deepEqual([...h.contents], [['O', 1]])
})

test('material lab: no reaction, and finishing the session', () => {
  const g = labWith('Na', 'Na', 'C')
  assert.equal(g.react().kind, 'none')
  assert.equal(new MaterialLab().react().kind, 'empty')
  assert.equal(g.finish(), true)
  g.update(1)
  assert.equal(g.over, true)
})

test('material lab: every recipe works at its temperature, and all 44 complete the lab', () => {
  const g = new MaterialLab()
  for (const r of REACTIONS) {
    for (const s of Object.keys(r.reactants)) g.unlocked.add(s)
    for (const [s, n] of Object.entries(r.reactants)) for (let i = 0; i < n; i++) g.add(s)
    const fuel = fuelFor(r.minTemp)
    g.setFuel(fuel)
    if (fuel && !g.furnaceOn) g.toggleFurnace()
    g.update(10)
    const res = g.react()
    assert.equal(res.kind, 'new', `${r.name}: ${res.message}`)
    g.clear()
  }
  assert.equal(g.state, 'complete')
  assert.equal(g.score, REACTIONS.length * LPOINTS.discovery + LPOINTS.complete)
})
