// Node tests for KherveCAD's web-side logic (no browser, no Python).
// Run: node --test src/apps/khervecad/tests/logic.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bounds, floatsFromBase64, floatsToBase64, fromBase64, parseOff, parseStl, toBase64, u16FromBase64 } from '../meshio.ts'
import { qtKey, showShortcut, MOD_CTRL, MOD_SHIFT, MOD_META, MOD_ALT } from '../keys.ts'
import { plainText, resolve, resolveMain, splitShortcut } from '../nodes.ts'
import { enqueue, extractReply, filterExtensions, flatten, nextJob } from '../logic.ts'
import { focal, fovFor, grouped, lightVector, niceLength, orbit, orientation, pan, readable, scaleBar, sketchBar, tidy, zoom, eyeOf } from '../view3dmath.ts'

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

// ------------------------------------------------------------------ meshes

test('OFF faces are fan-triangulated, as engine._parse_off does', () => {
  const off = 'OFF\n# a unit square and a triangle\n5 2 0\n0 0 0\n1 0 0\n1 1 0\n0 1 0\n0 0 1\n4 0 1 2 3\n3 0 1 4\n'
  const t = parseOff(off)
  assert.equal(t.length, 3 * 9)
  assert.deepEqual([...t.slice(0, 9)], [0, 0, 0, 1, 0, 0, 1, 1, 0])
  assert.deepEqual([...t.slice(9, 18)], [0, 0, 0, 1, 1, 0, 0, 1, 0])
  assert.equal(parseOff('').length, 0)
})

test('binary and ASCII STL read the same triangle', () => {
  const buf = new ArrayBuffer(84 + 50)
  const dv = new DataView(buf)
  dv.setUint32(80, 1, true)
  const v = [0, 0, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9]
  v.forEach((x, i) => dv.setFloat32(84 + i * 4, x, true))
  assert.deepEqual([...parseStl(new Uint8Array(buf))], [1, 2, 3, 4, 5, 6, 7, 8, 9])
  const ascii = 'solid x\nfacet normal 0 0 1\nouter loop\nvertex 1 2 3\nvertex 4 5 6\nvertex 7 8 9\nendloop\nendfacet\nendsolid x\n'
  assert.deepEqual([...parseStl(new TextEncoder().encode(ascii))], [1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('base64 round trips (floats for Python, u16 colour indices)', () => {
  const f = new Float32Array([1.5, -2, 3.25e6])
  assert.deepEqual([...floatsFromBase64(floatsToBase64(f))], [...f])
  const bytes = new Uint8Array([0, 255, 7, 128])
  assert.deepEqual([...fromBase64(toBase64(bytes))], [...bytes])
  assert.deepEqual([...u16FromBase64(toBase64(new Uint8Array(new Uint16Array([3, 65535]).buffer)))], [3, 65535])
  assert.deepEqual(bounds(new Float32Array([0, 1, 2, -1, 5, 3, 4, 0, -2])), [-1, 0, -2, 4, 5, 3])
  assert.equal(bounds(new Float32Array()), null)
})

// ------------------------------------------------------------------ keys

const key = (k, code, mods = {}) => ({ key: k, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })

test("keys in Qt's terms: Cmd is Ctrl on a Mac, Ctrl elsewhere", () => {
  assert.equal(qtKey(key('s', 'KeyS', { metaKey: true }), true).text, 'Ctrl+S')
  assert.equal(qtKey(key('s', 'KeyS', { ctrlKey: true }), false).text, 'Ctrl+S')
  assert.equal(qtKey(key('S', 'KeyS', { ctrlKey: true, shiftKey: true }), false).text, 'Ctrl+Shift+S')
  assert.equal(qtKey(key('s', 'KeyS', { ctrlKey: true }), true).text, 'Meta+S')
  const v = qtKey(key('v', 'KeyV'), false)
  assert.equal(v.text, 'V')
  assert.equal(v.key, 0x56)
  assert.equal(v.mods, 0)
  assert.equal(qtKey(key('Delete', 'Delete'), false).text, 'Del')
  assert.equal(qtKey(key('F5', 'F5'), false).text, 'F5')
  assert.equal(qtKey(key('F5', 'F5'), false).key, 0x01000034)
  assert.equal(qtKey(key('Tab', 'Tab', { shiftKey: true }), false).key, 0x01000002)
  assert.equal(qtKey(key('ArrowUp', 'ArrowUp', { ctrlKey: true }), false).text, 'Ctrl+Up')
  // punctuation by the physical key: Ctrl+' (grid) and Ctrl+Shift+' (snap)
  assert.equal(qtKey(key("'", 'Quote', { ctrlKey: true }), false).text, "Ctrl+'")
  assert.equal(qtKey(key('"', 'Quote', { ctrlKey: true, shiftKey: true }), false).text, "Ctrl+Shift+'")
  // zoom: Ctrl+= is also tried as Qt's "Ctrl++"
  const z = qtKey(key('=', 'Equal', { ctrlKey: true }), false)
  assert.equal(z.text, 'Ctrl+=')
  assert.ok(z.alt.includes('Ctrl++'))
  const opt = qtKey(key('ß', 'KeyS', { altKey: true }), true)
  assert.equal(opt.text, 'Alt+S')
  assert.equal(opt.mods, MOD_ALT)
  assert.equal(qtKey(key('a', 'KeyA', { metaKey: true, shiftKey: true }), true).mods, MOD_CTRL | MOD_SHIFT)
  assert.equal(qtKey(key('a', 'KeyA', { ctrlKey: true }), true).mods, MOD_META)
})

test('menu shortcuts read the Mac way on a Mac', () => {
  assert.equal(showShortcut('Ctrl+Shift+S', true), '⌘⇧S')
  assert.equal(showShortcut('Ctrl+Alt+E', true), '⌘⌥E')
  assert.equal(showShortcut('Ctrl+S', false), 'Ctrl+S')
  assert.equal(showShortcut(undefined, true), undefined)
})

// ----------------------------------------------------------------- nodes

test('"same" nodes come from the cache, unchanged objects stay the same', () => {
  const cache = new Map()
  const first = resolve({ id: 1, t: 'w', l: { k: 'v', items: [{ id: 2, t: 'label', text: 'a' }, { k: 'stretch', n: 1 }] } }, cache)
  assert.equal(first.l.items[0].text, 'a')
  const again = resolve({ id: 1, t: 'w', l: { k: 'v', items: [{ id: 2, same: 1 }, { id: 3, t: 'label', text: 'b' }] } }, cache)
  assert.equal(again.l.items[0], cache.get(2))
  assert.equal(again.l.items[1].text, 'b')
  assert.equal(resolve({ id: 1, same: 1 }, cache).t, 'w')
  // a stretch belongs to the layout slot, not the cached widget
  const withStretch = resolve({ id: 2, same: 1, str: 3 }, cache)
  assert.equal(withStretch.str, 3)
  assert.equal(cache.get(2).str, undefined)
  const main = resolveMain({ toolbars: [[4, { id: 9, t: 'toolbar', items: [] }]], central: { id: 1, same: 1 }, status: { id: 5, t: 'status', items: [[{ id: 6, t: 'label', text: 'x' }, 0]] }, docks: [] }, cache)
  assert.equal(main.central.t, 'w')
  assert.equal(main.status.items[0][0].text, 'x')
})

test("a tool bar's widgets come back from the cache, its actions stay as they are", () => {
  const cache = new Map()
  const group = { id: 20, t: 'tbutton', icon: 'mdi.group', act: 7, popup: 1, menu: [{ id: 7, text: 'Group (union)' }] }
  resolve({ id: 10, t: 'toolbar', o: 1, items: [{ id: 1, text: 'New', icon: 'mdi.file-outline' }, group] }, cache)
  const again = resolve({ id: 10, t: 'toolbar', o: 1, items: [{ id: 1, text: 'New', icon: 'mdi.file-outline' }, { id: 20, same: 1 }] }, cache)
  assert.equal(again.items[1].t, 'tbutton')
  assert.equal(again.items[1].menu.length, 1)
  assert.equal(again.items[0].text, 'New')
})

test("Qt's & accelerators and tab-separated shortcuts", () => {
  assert.equal(plainText('&File'), 'File')
  assert.equal(plainText('Fasteners && brackets'), 'Fasteners & brackets')
  assert.deepEqual(splitShortcut('Cu&t\tCtrl+X'), ['Cut', 'Ctrl+X'])
  assert.deepEqual(splitShortcut('Save &As...'), ['Save As...', undefined])
})

// ----------------------------------------------------------------- logic

test('a mouse move replaces the unsent one, other input keeps its order', () => {
  let q = []
  q = enqueue(q, { op: 'sk_move', x: 1 })
  q = enqueue(q, { op: 'sk_move', x: 2 })
  assert.equal(q.length, 1)
  assert.equal(q[0].x, 2)
  q = enqueue(q, { op: 'sk_press', x: 2 })
  q = enqueue(q, { op: 'sk_move', x: 3 })
  assert.deepEqual(q.map((e) => e.op), ['sk_move', 'sk_press', 'sk_move'])
  q = enqueue(q, { op: 'trigger', id: 4 })
  q = enqueue(q, { op: 'trigger', id: 4 })
  assert.equal(q.filter((e) => e.op === 'trigger').length, 2)
})

test('the reply is read between the markers, after any printed text', () => {
  const out = 'hello\n\x02KC-JSON\x03{"title":"a"}\x02/KC-JSON\x03\n\x02KC-JSON\x03{"title":"b"}\x02/KC-JSON\x03\n'
  assert.equal(extractReply(out).title, 'b')
  assert.equal(extractReply('no reply'), null)
})

test('tree rows flatten to what is expanded and visible', () => {
  const rows = [
    { i: 1, text: 'A', exp: 1, kids: [{ i: 2, text: 'A1' }, { i: 3, text: 'A2', hid: 1 }, { i: 4, text: 'A3', kids: [{ i: 5, text: 'x' }] }] },
    { i: 6, text: 'B' },
  ]
  const flat = flatten(rows)
  assert.deepEqual(flat.map((f) => f.row.i), [1, 2, 4, 6])
  assert.deepEqual(flat.map((f) => f.depth), [0, 1, 1, 0])
  assert.deepEqual(flat[1].cont, [true, true])
  assert.deepEqual(flat[2].cont, [true, false])
})

test("Qt file filters give the file dialog's extensions", () => {
  assert.deepEqual(filterExtensions('Mesh (*.stl *.obj *.OFF);;STL (*.stl)'), ['.stl', '.obj', '.off'])
  assert.deepEqual(filterExtensions('KherveCAD document (*.kcad)'), ['.kcad'])
  assert.deepEqual(filterExtensions(''), [])
})

test('parts render first, then only the newest whole render', () => {
  const jobs = [{ id: 1, kind: 'render' }, { id: 2, kind: 'part' }, { id: 3, kind: 'render' }, { id: 4, kind: 'part' }]
  assert.equal(nextJob(jobs).id, 2)
  assert.equal(nextJob(jobs.filter((j) => j.kind === 'render')).id, 3)
  assert.equal(nextJob([]), null)
})

// ---------------------------------------------------------------- camera

test("the desktop's camera: basis, eye, focal length", () => {
  const { right, up, forward } = orientation(-65, 35)
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  for (const v of [right, up, forward]) assert.ok(close(dot(v, v), 1))
  assert.ok(close(dot(right, up), 0) && close(dot(right, forward), 0) && close(dot(up, forward), 0))
  assert.ok(up[2] > 0, 'world +Z is screen up')
  // the Top preset looks straight down
  assert.ok(orientation(-90, 89).forward[2] < -0.99)
  const eye = eyeOf(0, 0, 100, [0, 0, 0])
  assert.ok(close(eye[0], 100) && close(eye[1], 0))
  assert.equal(focal(800, 600), 720)
  assert.ok(close(fovFor(800, 600), (2 * Math.atan(300 / 720) * 180) / Math.PI))
})

test('mouse: orbit half a degree a pixel (pitch wraps), pan, wheel zoom', () => {
  assert.deepEqual(orbit(35, 22, 10, 4), [30, 24])
  assert.deepEqual(orbit(1, 179, 4, 4), [359, -179])
  const t = pan(0, 0, 600, [0, 0, 0], 10, 0)
  assert.ok(close(t[1], -10) && close(t[0], 0))
  assert.ok(close(zoom(100, -1), 87))
  assert.ok(close(zoom(100, 1), 115))
  assert.equal(zoom(2.1, -1), 2)
  assert.equal(zoom(9e5, 1), 1e6)
})

test('scale bars: round lengths, readable units, the real thing at 1:N', () => {
  assert.equal(niceLength(4), 20)
  assert.equal(niceLength(1), 100)
  assert.equal(niceLength(0), null)
  assert.deepEqual(readable(200000, 'mm'), [200, 'm'])
  assert.deepEqual(readable(5e9, 'mm'), [5000, 'km'])
  assert.deepEqual(readable(250, 'mm'), [250, 'mm'])
  assert.deepEqual(readable(5, 'in'), [5, 'in'])
  assert.deepEqual(readable(0.5, 'um'), [0.5, 'µm'])
  assert.deepEqual(scaleBar(4, 'mm'), ['20 mm', 80])
  const planet = scaleBar(4, 'mm', 212600000)
  assert.ok(planet[0].endsWith('km'))
  assert.equal(sketchBar(4), 20)
  assert.equal(tidy(30.5), '30.5')
  assert.equal(tidy(30), '30')
  assert.equal(grouped(212600000), '212 600 000')
})

test('the light turns and rises with the sliders', () => {
  const l = lightVector(0, 0)
  assert.ok(close(Math.hypot(...l), 1))
  assert.ok(l[2] > 0.6)
  assert.ok(lightVector(0, 1)[2] > l[2])
  assert.ok(lightVector(0, -1)[2] < l[2])
  const turned = lightVector(1, 0)
  assert.ok(close(turned[0], -l[0]) && close(turned[1], -l[1]))
})
