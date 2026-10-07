// Node tests for Shut Down…'s window sequence (no browser).
// Run: node --test src/os/tests/shutdown.test.mjs   (Node ≥ 23.6 loads the .ts directly)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { closeAllWindows } from '../shutdownSequence.ts'

/** A window manager whose close() runs each window's guard, like src/os/windows.ts. */
function fakeWm(wins) {
  let list = wins.map((w) => ({ minimized: false, ...w }))
  const asked = []
  return {
    asked,
    windows: () => list,
    close: async (id) => {
      asked.push(id)
      const w = list.find((x) => x.id === id)
      if (w.guard && !(await w.guard())) return
      list = list.filter((x) => x.id !== id)
    },
  }
}
const save = async () => true
const cancel = async () => false

test('closes every window front to back, minimised ones last', async () => {
  const wm = fakeWm([{ id: 'a', z: 1 }, { id: 'b', z: 5, minimized: true }, { id: 'c', z: 3, guard: save }, { id: 'd', z: 9 }])
  assert.equal(await closeAllWindows(wm), true)
  assert.deepEqual(wm.asked, ['d', 'c', 'a', 'b'])
  assert.equal(wm.windows().length, 0)
})

test('stops at the first Cancel and leaves the rest open', async () => {
  const wm = fakeWm([{ id: 'a', z: 1 }, { id: 'b', z: 2, guard: cancel }, { id: 'c', z: 3 }])
  assert.equal(await closeAllWindows(wm), false)
  assert.deepEqual(wm.asked, ['c', 'b'])
  assert.deepEqual(wm.windows().map((w) => w.id), ['a', 'b'])
})

test('a window opened while closing is closed too', async () => {
  const wm = fakeWm([{ id: 'a', z: 1 }])
  const close = wm.close
  let opened = false
  wm.close = async (id) => {
    await close(id)
    if (!opened) {
      opened = true
      wm.windows().push({ id: 'late', z: 2, minimized: false })
    }
  }
  assert.equal(await closeAllWindows(wm), true)
})

test('nothing open: done at once', async () => {
  assert.equal(await closeAllWindows(fakeWm([])), true)
})
