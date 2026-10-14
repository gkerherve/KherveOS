// Rune Keep levels (src/apps/minigames/rkMaps.ts): every thing stands in an
// open cell, and a player walking (steps of at most STEP, any drop, lifts,
// doors once their key is held) can collect every key and reach the exit.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LEVELS, STEP, type Cell, type MapDef } from '../../src/apps/minigames/rkMaps.ts'

function reach(m: MapDef, keys: Set<string>): Set<number> {
  const start = m.ents.find((e) => e.kind === 'start')!
  const first = Math.floor(start.z) * m.w + Math.floor(start.x)
  const seen = new Set([first])
  const queue = [first]
  const top = (c: Cell) => (c.lift !== undefined ? m.lifts[c.lift].high : c.f)
  while (queue.length) {
    const i = queue.shift()!
    const a = m.cells[i]
    const x = i % m.w
    const z = Math.floor(i / m.w)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = (z + dz) * m.w + x + dx
      const b = m.cells[j]
      if (!b || b.solid || b.tree || seen.has(j)) continue
      if (b.door !== undefined && m.doors[b.door].key && !keys.has(m.doors[b.door].key!)) continue
      if (b.f > top(a) + STEP + 1e-6) continue
      if (Math.min(b.c, a.c) - Math.max(b.f, a.f) < 1.8) continue
      seen.add(j)
      queue.push(j)
    }
  }
  return seen
}

for (const make of LEVELS) {
  const m = make()
  test(`${m.name}: things stand in open cells`, () => {
    for (const e of m.ents) {
      const c = m.cells[Math.floor(e.z) * m.w + Math.floor(e.x)]
      assert.ok(c && !c.solid && !c.tree, `${e.kind} at ${e.x},${e.z}`)
    }
    assert.equal(m.ents.filter((e) => e.kind === 'start').length, 1)
    assert.equal(m.ents.filter((e) => e.kind === 'exit').length, 1)
  })
  test(`${m.name}: has open country with trees, and the hills can be walked`, () => {
    const land = m.cells.filter((c) => c.terrain)
    assert.ok(land.length > 500, 'outdoors')
    assert.ok(land.filter((c) => c.tree).length > 20, 'trees')
  })
  test(`${m.name}: every key, then the exit, can be reached`, () => {
    const keys = new Set<string>()
    for (let round = 0; round < 4; round++) {
      const seen = reach(m, keys)
      for (const e of m.ents)
        if (e.kind.startsWith('key_') && seen.has(Math.floor(e.z) * m.w + Math.floor(e.x))) keys.add(e.kind.slice(4))
    }
    const seen = reach(m, keys)
    const exit = m.ents.find((e) => e.kind === 'exit')!
    assert.ok(seen.has(Math.floor(exit.z) * m.w + Math.floor(exit.x)), `exit reachable (keys: ${[...keys]})`)
    for (const d of m.doors) if (d.key) assert.ok(keys.has(d.key), `the ${d.key} key can be found`)
  })
}
