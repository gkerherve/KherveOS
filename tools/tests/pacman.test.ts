// Pac-Man's rules (src/apps/minigames/pacmanRules.ts) played headless.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COLS, ROWS, TOTAL_DOTS, TUNNEL_ROW, WALL, Pacman, passable, type Dir } from '../../src/apps/minigames/pacmanRules.ts'

const DT = 1 / 120

function run(g: Pacman, seconds: number) {
  for (let t = 0; t < seconds; t += DT) g.update(DT)
}
function start(g = new Pacman()) {
  run(g, 3) // past READY!
  assert.equal(g.phase, 'run')
  return g
}

test('the maze is closed and every open tile can be reached from Pac-Man', () => {
  const seen = new Set<string>()
  const todo: [number, number][] = [[9, 15]]
  while (todo.length) {
    const [x, y] = todo.pop()!
    const wx = ((x + COLS) % COLS)
    const key = `${wx},${y}`
    if (seen.has(key) || !passable(x, y)) continue
    if (y < 0 || y >= ROWS) continue
    seen.add(key)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx
      if (y === TUNNEL_ROW && (nx < 0 || nx >= COLS)) todo.push([(nx + COLS) % COLS, y])
      else todo.push([nx, y + dy])
    }
  }
  // No dot is walled off.
  const g = new Pacman()
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (g.dots[y * COLS + x]) assert.ok(seen.has(`${x},${y}`), `dot at ${x},${y} unreachable`)
  // The outer ring is wall except the tunnel.
  for (let x = 0; x < COLS; x++) assert.ok(WALL[0][x] && WALL[ROWS - 1][x])
  assert.equal(g.dotsLeft, TOTAL_DOTS)
})

test('Pac-Man eats dots, scores, and stops at a wall', () => {
  const g = start()
  run(g, 1) // starts heading left along the bottom corridor
  assert.ok(g.score >= 10 && g.score % 10 === 0)
  assert.ok(g.dotsLeft < TOTAL_DOTS)
  g.press('U' as Dir)
  run(g, 0.5)
  assert.ok(g.pac.y < 15 || g.phase !== 'run')
})

test('ghosts leave the house and hunt', () => {
  const g = start()
  run(g, 6)
  if (g.phase === 'run') for (const gh of g.ghosts.slice(0, 2)) assert.notEqual(gh.state, 'house', gh.name)
  for (const gh of g.ghosts) assert.ok(passable(Math.round(gh.x), Math.round(gh.y)) || gh.state === 'house' || gh.state === 'leaving' || gh.state === 'entering')
})

test('a ghost that catches a still Pac-Man costs a life, then the game goes on', () => {
  const g = start()
  const lives = g.lives
  // Hold still facing a wall while the ghosts come.
  g.want = 'D'
  g.pac.dx = g.pac.dy = 0
  g.pac.x = 9
  g.pac.y = 19
  g.ghosts[0].x = 9
  g.ghosts[0].y = 19
  g.update(DT)
  assert.equal(g.phase, 'dying')
  run(g, 2)
  assert.equal(g.lives, lives - 1)
  assert.equal(g.phase, 'ready')
  assert.equal(g.pac.x, 9)
})

test('a power pellet frightens the ghosts and eating one scores 200 then 400', () => {
  const g = start()
  g.dots[15 * COLS + 1] = 2
  g.pac.x = 2
  g.pac.y = 15
  g.pac.dx = -1
  g.pac.dy = 0
  const before = g.score
  run(g, 0.3)
  assert.ok(g.score - before >= 50)
  assert.ok(g.fright > 0)
  assert.ok(g.ghosts.every((x) => x.frightened))
  const gh = g.ghosts[0]
  gh.state = 'normal'
  gh.x = g.pac.x
  gh.y = g.pac.y
  const s = g.score
  g.update(DT)
  assert.equal(g.score - s, 200)
  assert.equal(gh.state, 'eyes')
  g.freeze = 0
  const gh2 = g.ghosts[1]
  gh2.state = 'normal'
  gh2.frightened = true
  gh2.x = g.pac.x
  gh2.y = g.pac.y
  const s2 = g.score
  g.update(DT)
  assert.equal(g.score - s2, 400)
})

test('eaten ghosts go home as eyes and come out again', () => {
  const g = start()
  const gh = g.ghosts[0]
  gh.state = 'eyes'
  gh.frightened = false
  run(g, 4)
  assert.notEqual(gh.state, 'eyes')
})

test('the tunnel wraps Pac-Man to the other side', () => {
  const g = start()
  g.pac.x = 3
  g.pac.y = TUNNEL_ROW
  g.pac.dx = -1
  g.pac.dy = 0
  g.want = 'L'
  for (let i = 0; i < 600 && g.pac.x < 15; i++) g.update(DT)
  assert.ok(g.pac.x > 15, `x=${g.pac.x}`)
})

test('eating the last dot clears the level and the next is harder', () => {
  const g = start()
  g.dots.fill(0)
  g.dots[15 * COLS + 8] = 1
  g.dotsLeft = 1
  g.pac.x = 9
  g.pac.y = 15
  g.pac.dx = -1
  g.pac.dy = 0
  run(g, 0.3)
  assert.equal(g.phase, 'clear')
  run(g, 2.4)
  assert.equal(g.level, 2)
  assert.equal(g.phase, 'ready')
  assert.equal(g.dotsLeft, TOTAL_DOTS)
})

test('losing every life ends the game', () => {
  const g = start()
  for (let i = 0; i < 3; i++) {
    run(g, 3)
    g.ghosts[0].state = 'normal'
    g.ghosts[0].frightened = false
    g.ghosts[0].x = g.pac.x
    g.ghosts[0].y = g.pac.y
    g.update(DT)
    run(g, 4)
  }
  assert.ok(g.over)
  assert.equal(g.lives, 0)
})

test('a random player survives the simulation without errors', () => {
  const g = start()
  const dirs: Dir[] = ['U', 'L', 'D', 'R']
  for (let i = 0; i < 120 * 120 && !g.over; i++) {
    if (i % 40 === 0) g.press(dirs[Math.floor(Math.random() * 4)])
    g.update(DT)
    g.events.length = 0
    assert.ok(Number.isFinite(g.pac.x) && Number.isFinite(g.pac.y))
    for (const gh of g.ghosts) assert.ok(Number.isFinite(gh.x) && Number.isFinite(gh.y) && gh.x >= -1 && gh.x <= COLS, `${gh.name} x=${gh.x}`)
  }
})
