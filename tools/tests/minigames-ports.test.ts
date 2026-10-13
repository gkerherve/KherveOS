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
  COLS as RC_COLS, MAX_ATOMS, MOLECULES, ROWS as RC_ROWS, ReactionChain, atomCount, dropTime, elementsAt, findReaction, moleculesAt, pointsFor,
  type El,
} from '../../src/apps/minigames/reactionChainRules.ts'
import {
  LEVELS as MB_LEVELS, MolBuilder, VALENCE, canonical, check, formulaOf, parseSmiles, type El as MbEl, type Mol,
} from '../../src/apps/minigames/molBuilderRules.ts'
import {
  ANALYTES, INDICATORS, TitrationRush, accuracyPoints, equivalence, goodIndicator, phAt, type Setup,
} from '../../src/apps/minigames/titrationRules.ts'
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

// ------------------------------------------------------------ Reaction Chain

const tile = (el: El, id = 0) => ({ el, id, off: 0 })
const rack = (...cols: El[][]) => Array.from({ length: RC_COLS }, (_, c) => (cols[c] ?? []).map((e) => tile(e)))

test('reaction chain: water forms from touching atoms only', () => {
  const water = MOLECULES.find((m) => m.formula === 'H₂O')!
  assert.equal(findReaction(rack(['H', 'O', 'H']), moleculesAt(1), null)?.molecule, water)
  assert.equal(findReaction(rack(['H'], ['O'], ['H']), moleculesAt(1), null)?.molecule, water)
  // H, gap column, O, H: the first H does not touch
  assert.equal(findReaction(rack(['H'], [], ['O'], ['O']), moleculesAt(1), null), null)
  assert.equal(findReaction(rack(['H', 'H']), moleculesAt(1), null), null)
})

test('reaction chain: the biggest molecule wins (CO₂ before CO), CH₄ is found', () => {
  assert.equal(findReaction(rack(['O', 'C', 'O']), moleculesAt(2), null)?.molecule.formula, 'CO₂')
  // C with only three H round it: no methane
  assert.notEqual(findReaction(rack(['H', 'C', 'H'], ['N', 'H'], ['N', 'N']), moleculesAt(2), null)?.molecule.formula, 'CH₄')
  // the fourth H touches the third one: methane (5 atoms) beats water
  assert.equal(findReaction(rack(['H', 'C', 'H'], ['O', 'H', 'O'], ['O', 'H']), moleculesAt(2), null)?.molecule.formula, 'CH₄')
})

test('reaction chain: a drop reacts, scores and the atoms above fall into a chain', () => {
  const g = new ReactionChain(() => 0.99)
  g.cols = rack(['O', 'H', 'O'], ['H', 'H'])
  g.target = MOLECULES.find((m) => m.formula === 'H₂O₂')!
  g.current = 'H'
  g.moveTo(2)
  // H at (2,0) touches H at (1,0): H(1,0) H(1,1) H(2,0)… needs O: O(0,0) touches H(1,0)
  assert.equal(g.drop(), true)
  const made = g.settle()
  assert.ok(made.length >= 1)
  assert.equal(made[0].chain, 1)
  assert.equal(g.score, made.reduce((a, r) => a + r.points, 0))
  assert.equal(made[0].points, pointsFor(atomCount(made[0].molecule), 1, made[0].target))
  for (let i = 1; i < made.length; i++) assert.equal(made[i].chain, i + 1)
})

test('reaction chain: a full column refuses a drop, an auto-drop into it ends the game', () => {
  const g = new ReactionChain(() => 0)
  g.cols[0] = Array.from({ length: RC_ROWS }, (_, i) => tile(i % 2 ? 'O' : 'O', i))
  g.moveTo(0)
  assert.equal(g.drop(), false)
  assert.equal(g.state, 'play')
  g.timer = 0.001
  g.update(1 / 60)
  assert.equal(g.state, 'over')
})

test('reaction chain: levels add elements and molecules, drops speed up', () => {
  assert.deepEqual(elementsAt(1), ['H', 'O'])
  assert.deepEqual(elementsAt(3), ['H', 'O', 'C', 'N'])
  assert.ok(moleculesAt(1).every((m) => m.level === 1))
  assert.ok(dropTime(5) < dropTime(1))
  for (const m of MOLECULES) {
    assert.ok(atomCount(m) <= MAX_ATOMS, m.formula)
    for (const e of Object.keys(m.atoms)) assert.ok(elementsAt(m.level).includes(e as El), `${m.formula} uses ${e}`)
  }
})

// ------------------------------------------------------------ Molecule Builder

/** Every connected molecule with these heavy atoms and hydrogen count, by canonical form (brute force over bond orders). */
function enumerateIsomers(els: MbEl[], h: number): Set<string> {
  const n = els.length
  const pairs: [number, number][] = []
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j])
  const out = new Set<string>()
  const orders = new Array(pairs.length).fill(0)
  const total = 4 ** pairs.length
  for (let k = 0; k < total; k++) {
    let x = k
    for (let p = 0; p < pairs.length; p++) {
      orders[p] = x % 4
      x = Math.floor(x / 4)
    }
    const m: Mol = { atoms: els.map((el, i) => ({ id: i, el, x: 0, y: 0 })), bonds: [] }
    pairs.forEach(([a, b], p) => orders[p] && m.bonds.push({ a, b, order: orders[p] }))
    const c = check(m, { formula: formulaOf(m), isomers: [], hint: '' })
    if (!c.ok) continue
    const hs = m.atoms.reduce((s, a) => s + VALENCE[a.el] - m.bonds.reduce((t, b) => t + (b.a === a.id || b.b === a.id ? b.order : 0), 0), 0)
    if (hs === h) out.add(canonical(m))
  }
  return out
}

test('molbuilder: the SMILES of each level give its formula, and its isomers are all different', () => {
  for (const l of MB_LEVELS) {
    const keys = new Set<string>()
    for (const i of l.isomers) {
      const m = parseSmiles(i.smiles)
      assert.equal(formulaOf(m), l.formula, `${i.name} is ${l.formula}`)
      keys.add(canonical(m))
    }
    assert.equal(keys.size, l.isomers.length, `${l.formula}: isomers are distinct`)
  }
})

test('molbuilder: every level up to four heavy atoms lists all its isomers', () => {
  for (const l of MB_LEVELS) {
    const m = parseSmiles(l.isomers[0].smiles)
    if (m.atoms.length > 4) continue
    const h = Number(/H(\d*)/.exec(l.formula)?.[1] || (l.formula.includes('H') ? 1 : 0))
    const all = enumerateIsomers(m.atoms.map((a) => a.el), h)
    assert.equal(all.size, l.isomers.length, `${l.formula} has ${all.size} isomers`)
  }
})

test('molbuilder: the same molecule drawn two ways has one canonical form', () => {
  assert.equal(canonical(parseSmiles('OCC')), canonical(parseSmiles('CCO')))
  assert.equal(canonical(parseSmiles('C(C)(C)C')), canonical(parseSmiles('CC(C)C')))
  assert.notEqual(canonical(parseSmiles('CCCC')), canonical(parseSmiles('CC(C)C')))
})

test('molbuilder: clicks place atoms and cycle bonds; a finished isomer scores and the level moves on', () => {
  const g = new MolBuilder()
  g.click(1, 1) // C, picked
  assert.equal(formulaOf(g.mol), 'CH4')
  assert.equal(g.found.length, 1)
  assert.equal(g.score, 100)
  for (let i = 0; i < 200 && g.level === 0; i++) g.update(1 / 60)
  assert.equal(g.level, 1)
  assert.equal(g.mol.atoms.length, 0)
  // ethane: a C, then a C next to it bonds straight away
  g.click(1, 1)
  g.click(2, 1)
  assert.equal(g.found.at(-1)?.name, 'ethane')
  for (let i = 0; i < 200 && g.level === 1; i++) g.update(1 / 60)
  // ethene: the second click on the pair makes the bond double
  g.click(1, 1)
  g.click(2, 1) // ethane: wrong level, nothing found
  assert.equal(g.found.length, 0)
  g.click(1, 1)
  assert.equal(g.found.at(-1)?.name, 'ethene')
})

test('molbuilder: buildSmiles finds isomers once and ignores the wrong formula', () => {
  const g = new MolBuilder()
  while (g.current.formula !== 'C2H6O') {
    if (g.levelDone) g.update(2)
    else g.buildSmiles(g.current.isomers.find((i) => !g.found.some((f) => f.name === i.name))!.smiles)
  }
  const before = g.score
  assert.equal(g.buildSmiles('CC').ok, false)
  const first = g.buildSmiles('OCC')
  assert.equal(first.ok && first.name, 'ethanol')
  g.update(2)
  g.buildSmiles('CCO') // the same molecule written the other way round
  assert.equal(g.found.length, 1)
  assert.equal(g.score, before + 300)
  g.buildSmiles('COC')
  g.update(2)
  assert.equal(g.current.formula, 'C2H7N')
})

// ------------------------------------------------------------ Titration Rush

const setup = (formula: string, conc = 0.1, titrant = 0.1, volume = 25): Setup => ({
  analyte: ANALYTES.find((a) => a.formula === formula)!, volume, conc, titrant, indicator: INDICATORS[3],
})

test('titration: textbook pH values', () => {
  const close = (a: number, b: number, tol = 0.03) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`)
  close(phAt(setup('HCl'), 0), 1)
  close(phAt(setup('HCl'), 25), 7)
  close(phAt(setup('CH₃COOH'), 0), 2.88)
  close(phAt(setup('CH₃COOH'), 12.5), 4.76)
  close(phAt(setup('CH₃COOH'), 25), 8.73)
  close(phAt(setup('NH₃'), 12.5), 9.25)
  close(phAt(setup('NH₃'), 25), 5.28)
  assert.equal(equivalence(setup('H₂C₂O₄', 0.05)), 25)
})

test('titration: phenolphthalein suits a weak acid, methyl red a weak base, methyl orange neither', () => {
  const ind = (n: string) => INDICATORS.find((i) => i.name === n)!
  assert.ok(goodIndicator(setup('CH₃COOH'), ind('phenolphthalein')))
  assert.ok(!goodIndicator(setup('CH₃COOH'), ind('methyl orange')))
  assert.ok(goodIndicator(setup('NH₃'), ind('methyl red')))
  assert.ok(!goodIndicator(setup('NH₃'), ind('phenolphthalein')))
})

test('titration: every round has a good indicator and an end point inside the burette', () => {
  const g = new TitrationRush(seeded(3))
  for (let r = 1; r <= 10; r++)
    for (let k = 0; k < 20; k++) {
      const s = g.makeSetup(r)
      const eq = equivalence(s)
      assert.ok(eq > 5 && eq < 45, `${s.analyte.name}: ${eq} mL`)
      assert.ok(INDICATORS.some((i) => goodIndicator(s, i)), s.analyte.name)
    }
})

test('titration: calling the end point scores by the error, timing out scores nothing', () => {
  assert.equal(accuracyPoints(0), 1000)
  assert.equal(accuracyPoints(0.5), 500)
  assert.equal(accuracyPoints(2), 0)
  const g = new TitrationRush(seeded(5))
  assert.equal(g.phase, 'titrate')
  g.add(equivalence(g.setup))
  const r = g.callEndpoint()!
  assert.ok(r.error < 1e-9)
  assert.equal(r.points, 1000)
  assert.equal(g.score, 1000 + r.timeBonus)
  g.next()
  g.update(60)
  assert.equal(g.results[1].timedOut, true)
  assert.equal(g.results[1].points, 0)
  while (g.phase !== 'over') {
    if (g.phase === 'result') g.next()
    else if (g.phase === 'choose') g.choose(3)
    else g.callEndpoint()
  }
  assert.equal(g.results.length, 10)
})
