// Runs headless_test.py: the desktop KherveCAD window (khervecad.zip) on the
// headless Qt (kcweb), driven the way the web side drives it. Needs python3
// with numpy (skipped otherwise).
// Run: node --test src/apps/khervecad/tests/python.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./headless_test.py', import.meta.url))
const probe = spawnSync('python3', ['-c', 'import numpy'], { encoding: 'utf8' })

test('the desktop window runs headless (headless_test.py)', { skip: probe.status !== 0 && 'python3 with numpy not found', timeout: 600_000 }, () => {
  const r = spawnSync('python3', ['-W', 'ignore', script], { encoding: 'utf8', timeout: 600_000 })
  const out = `${r.stdout}\n${r.stderr}`
  assert.equal(r.status, 0, out.slice(-4000))
  assert.match(out, /\nOK\b/)
})
