// Node tests for the technique apps' TypeScript (no browser, no Python):
// figure geometry and mathtext, the wx wildcard, the app table, the slim
// toolbar, and that every AI action names controls and handlers that exist in
// the desktop's analysis windows.
//
//   node --test src/apps/khervetech/tests/logic.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { axesBox, axisTicks, dashArray, legendPlace, makeScale, mathRuns, nearestLine, plainText, zOf } from '../figmath.ts'
import { wildcardExtensions } from '../types.ts'
import { TECH_APPS, XPS_ONLY_TOOLS, TECH_TOOL_AFTER, appForSheets, techApp } from '../spec.ts'
import { installedPath, parseAnswers, START, END } from '../engine.core.ts'
import { MAIN_TOOLBAR } from '../../khervefitting/toolbarSpec.ts'
import { TGA_ACTIONS } from '../../khervetga/actions.ts'
import { BET_ACTIONS } from '../../khervebet/actions.ts'
import { KHERVETGA_TOOL_SET } from '../../../os/ai/manifests/khervetga.ts'
import { KHERVEBET_TOOL_SET } from '../../../os/ai/manifests/khervebet.ts'

const PY = new URL('../../../../public/apps/khervetech/py/', import.meta.url)
const desktop = (rel) => fs.readFileSync(new URL(`desktop/${rel}`, PY), 'utf8')

test('axes boxes, scales and ticks follow matplotlib', () => {
  const b = axesBox([0.1, 0.1, 0.85, 0.85], 1000, 500)
  assert.deepEqual(b, { x0: 100, x1: 950, y0: 25, y1: 450 })
  const fwd = makeScale([0, 100], 100, 900)
  assert.equal(fwd.to(50), 500)
  assert.equal(fwd.from(900), 100)
  const rev = makeScale([100, 0], 100, 900)
  assert.equal(rev.to(100), 100)
  assert.equal(rev.lo, 0)
  const log = makeScale([1, 1000], 0, 300, true)
  assert.ok(Math.abs(log.to(10) - 100) < 1e-9)
  // a plain axis never shows ×10ⁿ; an auto one does from 10⁶
  const plain = axisTicks([0, 2e6], 400, 11, 'y', 'plain')
  assert.equal(plain.corner, '')
  assert.ok(plain.labels.every((l) => !l.includes('e')))
  const auto = axisTicks([0, 2e6], 400, 11, 'y', 'auto')
  assert.match(auto.corner, /×10⁶/)
  const temps = axisTicks([30, 1000], 700, 11, 'x', 'plain', null, null, 5)
  assert.ok(temps.major.length >= 4)
  assert.ok(temps.minor.length > temps.major.length)
  const fixed = axisTicks([0, 1], 300, 11, 'x', 'plain', [], null)
  assert.deepEqual(fixed.major, [])
})

test('mathtext labels: super / subscripts, Greek, minus', () => {
  assert.deepEqual(mathRuns('Wavenumber (cm$^{-1}$)'), [{ t: 'Wavenumber (cm' }, { t: '−1', s: 'sup' }, { t: ')' }])
  assert.equal(plainText('Relative pressure (P/P$_0$)'), 'Relative pressure (P/P0)')
  assert.deepEqual(mathRuns('P/P$_0$')[1], { t: '0', s: 'sub' })
  assert.equal(plainText('$\\Psi$ (°)'), 'Ψ (°)')
  assert.equal(plainText('ln k  (k in min$^{-1}$)'), 'ln k  (k in min−1)')
  assert.equal(plainText('1000/T  (K$^{-1}$)'), '1000/T  (K−1)')
  assert.equal(plainText('Mass (mg)'), 'Mass (mg)')
})

test('legends, dashes, z-order, the nearer red line', () => {
  const box = { x0: 100, x1: 900, y0: 20, y1: 420 }
  const ul = legendPlace('upper left', box, 120, 40, 14)
  assert.deepEqual([ul.x, ul.y], [107, 27])
  const lr = legendPlace('lower right', box, 120, 40, 14)
  assert.deepEqual([lr.x, lr.y], [900 - 7 - 120, 420 - 7 - 40])
  assert.ok(dashArray('--', 1))
  assert.equal(dashArray('-', 1), undefined)
  assert.ok(zOf('text') > zOf('line') && zOf('line') > zOf('fill'))
  assert.equal(nearestLine(40, { 1: 37.9, 2: 113.9 }), 1)
  assert.equal(nearestLine(100, { 1: 37.9, 2: 113.9 }), 2)
})

test('wx wildcards become the file dialog\'s extensions', () => {
  assert.deepEqual(wildcardExtensions('TGA files (*.csv;*.txt;*.dat)|*.csv;*.CSV;*.txt;*.TXT;*.dat;*.DAT|All files (*.*)|*.*'), ['.csv', '.txt', '.dat'])
  assert.deepEqual(wildcardExtensions('KherveFitting HDF5 files (*.kfit)|*.kfit'), ['.kfit'])
  assert.equal(wildcardExtensions('All files (*.*)|*.*'), undefined)
  assert.equal(wildcardExtensions(undefined), undefined)
})

test('the technique apps and their registry entries', () => {
  assert.deepEqual(TECH_APPS.map((t) => t.name), ['KherveTGA', 'KherveBET'])
  assert.equal(techApp('khervebet').tech, 'BET')
  assert.equal(appForSheets(['BET', 'BET~Plot'])?.appId, 'khervebet')
  assert.equal(appForSheets(['TGA~Mass'])?.appId, 'khervetga')
  assert.equal(appForSheets(['C1s']), null)
  const reg = fs.readFileSync(new URL('../../../os/registry.ts', import.meta.url), 'utf8')
  for (const t of TECH_APPS) {
    assert.match(reg, new RegExp(`id: '${t.appId}'`), `${t.appId} registered`)
    assert.ok(fs.existsSync(new URL(`../../../../public/icons/apps/${t.appId}.png`, import.meta.url)), `${t.appId} Dock icon`)
    const idx = JSON.parse(fs.readFileSync(new URL(`../../../../public/examples/${t.examples}/index.json`, import.meta.url), 'utf8'))
    assert.ok(idx.examples.length >= 3, `${t.appId} examples`)
    for (const e of idx.examples) assert.ok(fs.existsSync(new URL(`../../../../public/examples/${t.examples}/${e.file}`, import.meta.url)), e.file)
    assert.ok(fs.existsSync(new URL(`../../../../public/apps/khervetech/icons/Tech-${t.tech}-3.png`, import.meta.url)), 'toolbar icon')
  }
  assert.match(reg, /group: 'Science'/)
})

test('the slim technique toolbar: the desktop\'s XPS-only tools, the technique button after them', () => {
  const ids = new Set(MAIN_TOOLBAR.filter((t) => t.id).map((t) => t.id))
  for (const id of XPS_ONLY_TOOLS) if (id !== 'be') assert.ok(ids.has(id), `${id} is a KherveFitting tool`)
  assert.ok(MAIN_TOOLBAR.some((t) => t.control === 'be'))
  assert.ok(ids.has(TECH_TOOL_AFTER))
  const kept = MAIN_TOOLBAR.filter((t) => t.id && !XPS_ONLY_TOOLS.has(t.id)).map((t) => t.id)
  assert.deepEqual(kept, ['open', 'quickSave', 'exportExcel', 'exportAll', 'undo', 'redo', 'sort', 'sampleManager', 'refresh', 'deleteSheet', 'renameSheet', 'crop', 'settings'])
})

test('the engine protocol', () => {
  assert.equal(installedPath('desktop/libraries/FileMenu/TGA_Import.py'), 'libraries/FileMenu/TGA_Import.py')
  assert.equal(installedPath('shims/wx/__init__.py'), 'wx/__init__.py')
  assert.equal(installedPath('ktech/bridge.py'), 'ktech/bridge.py')
  assert.deepEqual(parseAnswers(`noise${START}[{"ok":true}]${END}\n`), [{ ok: true }])
  assert.equal(parseAnswers('no markers'), null)
  const list = JSON.parse(fs.readFileSync(new URL('files.json', PY), 'utf8')).files
  for (const rel of list) assert.ok(fs.existsSync(new URL(rel, PY)), rel)
  for (const need of ['desktop/libraries/ToolsMenu/TGA_Analysis.py', 'desktop/libraries/ToolsMenu/BET_Analysis.py', 'shims/wx/__init__.py', 'shims/matplotlib/_rec.py', 'ktech/bridge.py'])
    assert.ok(list.includes(need), need)
})

/** The attribute names a desktop window class sets (self.<name> =) and its methods. */
function members(src) {
  const attrs = new Set([...src.matchAll(/self\.([A-Za-z_]\w*)\s*=/g)].map((m) => m[1]))
  const methods = new Set([...src.matchAll(/^\s+def ([A-Za-z_]\w*)\(/gm)].map((m) => m[1]))
  return { attrs, methods }
}

function checkActions(actions, src, toolSet) {
  const { attrs, methods } = members(src)
  for (const [name, def] of Object.entries(actions)) {
    const calls = typeof def.call === 'function' ? [def.call({ options: {} }), def.call({ options: { model: 'all' } })] : def.call ? [def.call] : []
    for (const c of calls) assert.ok(methods.has(c), `${name}: ${c} is a handler of the window`)
    for (const r of def.read) assert.ok(attrs.has(r), `${name}: reads ${r}`)
    const set = def.set ? def.set({ low: 1, high: 2, options: { initial_mass: 10, normalisation: '% of initial mass', name: 'x', edges_over: 5, method: 'Gaussian', width: 9, basis: 'Raw', dry_mass: 1, molar_mass: 2, mode: 'dm/dT', sensitivity: 5, baseline: 'Straight', poly_order: 2, anchors: [1, 2], tolerance: 5, model: 'Avrami (JMAK)', mass: 5, dh_ref: 100, formula: 'CaO', delta_initial: 0, sites: 3, mass_change: -1, host: 'CaCO3', species: 'CO2', n: 1, branch: 'adsorption' } }) : {}
    for (const k of Object.keys(set)) assert.ok(attrs.has(k), `${name}: sets ${k}`)
  }
  const run = toolSet.tools.find((t) => t.action === 'run')
  assert.deepEqual([...run.inputSchema.properties.action.enum].sort(), Object.keys(actions).sort(), 'manifest lists the same actions')
  for (const t of toolSet.tools) assert.ok(Object.keys(t.inputSchema.properties ?? {}).length <= 6, `${t.action}: ≤ 6 arguments`)
}

test('KherveTGA AI actions name the TGA / DSC Analysis window\'s own controls and handlers', () => {
  checkActions(TGA_ACTIONS, desktop('libraries/ToolsMenu/TGA_Analysis.py'), KHERVETGA_TOOL_SET)
})

test('KherveBET AI actions name the BET / Physisorption Analysis window\'s own controls and handlers', () => {
  checkActions(BET_ACTIONS, desktop('libraries/ToolsMenu/BET_Analysis.py'), KHERVEBET_TOOL_SET)
})
