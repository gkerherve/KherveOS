// The technique engine in the real Pyodide, as the page installs and drives it
// (engine.core.ts): shared by the engine tests of every technique app.
//
//   KHERVEOS_PYODIDE=/path/to/node_modules/pyodide/pyodide.mjs node --test src/apps/khervetech/tests/*.test.mjs
//
// Without Pyodide 314.0.7 (npm i pyodide@314.0.7 somewhere, then
// KHERVEOS_PYODIDE pointing at its pyodide.mjs, or resolvable as 'pyodide'),
// the tests are skipped.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WHEELS_DIR, filesFor, installCode, parseAnswers, runCode } from '../engine.core.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const PY = path.join(ROOT, 'public/apps/khervetech/py')

async function loadPyodideModule() {
  const where = process.env.KHERVEOS_PYODIDE
  try {
    return where ? await import(where) : await import('pyodide')
  } catch {
    return null
  }
}

const mod = await loadPyodideModule()
export const skip = mod ? false : 'Pyodide not installed (set KHERVEOS_PYODIDE)'

/**
 * A fresh worker for one technique, installed as the page does it (engine.core.ts): the common files
 * and the technique's own, KherveFitting's wheels, the Pyodide packages. Pyodide's package cache is its
 * own folder (node_modules/pyodide), never the repository.
 */
export async function engine(tech) {
  const index = JSON.parse(fs.readFileSync(path.join(PY, 'files.json'), 'utf8'))
  const want = filesFor(index, tech)
  const files = Object.fromEntries(want.files.map((rel) => [rel, fs.readFileSync(path.join(PY, rel), 'utf8')]))
  const wheels = Object.fromEntries(want.wheels.map((w) => [w, fs.readFileSync(path.join(ROOT, 'public', WHEELS_DIR, w)).toString('base64')]))
  const py = await mod.loadPyodide({ env: { HOME: '/home/user' } })
  let out = ''
  const dec = new TextDecoder()
  py.setStdout({ write: (b) => { out += dec.decode(b, { stream: true }); return b.length }, isatty: false })
  py.setStderr({ write: (b) => b.length, isatty: false })
  py.FS.mkdirTree('/home/user/Documents')
  py.runPython("import os; os.chdir('/home/user')")
  await py.loadPackage([...want.packages, 'h5py'])
  await py.runPythonAsync(installCode(files, wheels))
  /** The answer as it comes, failed or not (exploring). */
  const raw = async (op, args = {}) => {
    out = ''
    await py.runPythonAsync(runCode([{ op, args }]))
    const a = parseAnswers(out)
    if (!a) throw new Error(`no answer to ${op}: ${out.slice(-2000)}`)
    a[0].stdout = out.slice(0, out.indexOf('\x02KT-JSON'))
    return a[0]
  }
  const call = async (op, args = {}) => {
    out = ''
    await py.runPythonAsync(runCode([{ op, args }]))
    const a = parseAnswers(out)
    assert.ok(a, `answer to ${op}`)
    assert.ok(a[0].ok, `${op}: ${a[0].error}\n${a[0].trace ?? ''}`)
    assert.ok(!a[0].stateError, a[0].stateError)
    return a[0]
  }
  const copyExamples = (app, dir) => {
    py.FS.mkdirTree(dir)
    const src = path.join(ROOT, 'public/examples', app)
    for (const f of fs.readdirSync(src)) py.FS.writeFile(`${dir}/${f}`, fs.readFileSync(path.join(src, f)))
  }
  return { py, call, raw, copyExamples }
}

/** Every node of a serialised wx tree, with the notebook pages it is on. */
export function nodes(frame) {
  const out = []
  const walk = (n, pages) => {
    if (!n || typeof n !== 'object') return
    if (n.t) out.push({ n, pages })
    if (n.sizer) walk(n.sizer, pages)
    for (const it of n.items ?? []) walk(it.n, pages)
    for (const p of n.pages ?? []) walk(p.n, [...pages, p.title])
  }
  walk(frame, [])
  return out
}
export const byLabel = (frame, t, label, page) => nodes(frame).find(({ n, pages }) => n.t === t && n.label === label && (!page || pages.includes(page)))?.n

