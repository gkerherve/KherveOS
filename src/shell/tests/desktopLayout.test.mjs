// Node tests for arranging the desktop icons (no browser).
// Run: node --test src/shell/tests/desktopLayout.test.mjs   (Node ≥ 23.6 loads the .ts directly)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CELL_H, CELL_W, ICON_H, ICON_W, PAD_X, PAD_Y, arrangeInOrder, cellPos, cleanUp, gridSize, layout, moveIcons, nearestCell, sortItems,
} from '../desktopLayout.ts'

// 3 rows (12 + 3 × 120 ≤ 380) and plenty of columns.
const area = { w: 1000, h: 380 }

test('grid size', () => {
  assert.deepEqual(gridSize(area), { cols: 10, rows: 3 })
  assert.deepEqual(gridSize({ w: 0, h: 0 }), { cols: 1, rows: 1 })
})

test('new icons fill columns from the top right, saved ones keep their place', () => {
  const pos = layout(['a', 'b', 'c', 'd'], { b: cellPos(0, 0) }, area)
  assert.deepEqual(pos.b, cellPos(0, 0))
  assert.deepEqual(pos.a, cellPos(0, 1))
  assert.deepEqual(pos.c, cellPos(0, 2))
  assert.deepEqual(pos.d, cellPos(1, 0))
})

test('a saved position off screen is brought back inside', () => {
  const pos = layout(['a'], { a: { x: 5000, y: 5000 } }, area)
  assert.ok(pos.a.x <= area.w - ICON_W && pos.a.y <= area.h - ICON_H)
})

test('dragging snaps to the nearest free cell', () => {
  const start = layout(['a', 'b'], {}, area) // a (0,0), b (0,1)
  // Move a one cell left and a bit down: lands at column 1, row 0.
  let pos = moveIcons(['a'], -CELL_W - 10, 20, start, area, true)
  assert.deepEqual(pos.a, cellPos(1, 0))
  // Drop a onto b's cell: b stays, a takes the nearest free one.
  pos = moveIcons(['a'], CELL_W, CELL_H, pos, area, true)
  assert.deepEqual(pos.b, cellPos(0, 1))
  assert.notDeepEqual(pos.a, cellPos(0, 1))
  assert.equal(Math.abs(nearestCell(pos.a).row - 1) + Math.abs(nearestCell(pos.a).col), 1)
})

test('without snap icons move freely; Clean Up puts them back on the grid', () => {
  const start = layout(['a', 'b'], {}, area)
  const free = moveIcons(['a', 'b'], -37, 11, start, area, false)
  assert.deepEqual(free.a, { x: PAD_X + 37, y: PAD_Y + 11 })
  assert.deepEqual(free.b, { x: PAD_X + 37, y: PAD_Y + CELL_H + 11 })
  const tidy = cleanUp(['a', 'b'], free, area)
  assert.deepEqual(tidy, { a: cellPos(0, 0), b: cellPos(0, 1) })
})

test('Clean Up separates icons stacked on one cell', () => {
  const p = { x: PAD_X + 2 * CELL_W, y: PAD_Y + CELL_H }
  const tidy = cleanUp(['a', 'b', 'c'], { a: p, b: p, c: p }, area)
  const cells = new Set(Object.values(tidy).map((q) => `${q.x},${q.y}`))
  assert.equal(cells.size, 3)
})

test('Sort By orders the icons down the columns', () => {
  const items = [
    { key: 'f2', name: 'file10.txt', kind: '.txt', date: 300 },
    { key: 'app:x', name: 'Zed', kind: 'Application', date: 0 },
    { key: 'f1', name: 'file2.txt', kind: '.txt', date: 100 },
    { key: 'd', name: 'Album', kind: 'Folder', date: 200 },
  ]
  assert.deepEqual(sortItems(items, 'name'), ['d', 'f1', 'f2', 'app:x'])
  assert.deepEqual(sortItems(items, 'kind'), ['f1', 'f2', 'app:x', 'd'])
  assert.deepEqual(sortItems(items, 'date'), ['f2', 'd', 'f1', 'app:x'])
  const pos = arrangeInOrder(['d', 'f1', 'f2', 'app:x'], area)
  assert.deepEqual(pos['app:x'], cellPos(1, 0))
})
