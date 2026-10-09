// kPCB's pure code (no browser): geometry, the footprint library, placement transforms, netlists,
// the ratsnest, the design-rule check, zone fill, the auto-router, Gerber / Excellon / BOM / SVG
// export, editing operations and the .kpcb file. Run:
//   node --test tools/tests/kpcb.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unzipSync, strFromU8 } from 'fflate'
import { coreDist, convexOverlap, pointInPoly, polyArea, rectPoly, rot, roundedRectPoly, segSegDist, shapeDist, simplifyRing } from '../../src/apps/kpcb/geom.ts'
import { FOOTPRINTS, FOOTPRINT_ALIASES, getFootprint, searchFootprints } from '../../src/apps/kpcb/footprints.ts'
import { netOfPad, newDesign, padShape, partBox, rectOutline, toLocal, toWorld, uid, worldPads } from '../../src/apps/kpcb/board.ts'
import { History } from '../../src/apps/kpcb/history.ts'
import {
  OUTLINE_PRESETS, addHole, addPart, addTrackPath, addVia, addZone, adoptNets, alignParts, applyOutlinePreset, assignPad, boardZone, connectedTrack, copyItems, createNet, deleteItems,
  deleteNet, deleteNetCopper, distributeParts, dragTrack, flipParts, moveOutlineVertex, moveParts, moveVia, pasteClipboard, pickAt, pickInBox, renameNet, rotateParts, setNetClass,
  setOutlineRect, setPartProps,
} from '../../src/apps/kpcb/ops.ts'
import { copperAt, nextPoints, previewSegments, routeClash } from '../../src/apps/kpcb/route.ts'
import { kpcbTools } from '../../src/apps/kpcb/aiTools.ts'
import type { Hooks } from '../../src/apps/kpcb/aiTools.ts'
import { KPCB_TOOL_SET } from '../../src/os/ai/manifests/kpcb.ts'
import type { AppToolContext } from '../../src/os/ai/appToolsCore.ts'
import { DEFAULT_APPEARANCE, drawScene, gridStep } from '../../src/apps/kpcb/draw.ts'
import { layerPrims, viewItems } from '../../src/apps/kpcb/layers.ts'
import { applyNetlist, defaultFootprint, parseNetlist, parseTextNetlist, toTextNetlist, padFor } from '../../src/apps/kpcb/netlist.ts'
import type { KNetlist } from '../../src/apps/kpcb/netlist.ts'
import { analyze, ratsnest } from '../../src/apps/kpcb/analysis.ts'
import { runDrc } from '../../src/apps/kpcb/drc.ts'
import { fillZone, fillZones } from '../../src/apps/kpcb/zones.ts'
import { autoroute, unroute } from '../../src/apps/kpcb/autoroute.ts'
import { EXAMPLES, routedExample } from '../../src/apps/kpcb/examples.ts'
import { exportGerbers } from '../../src/apps/kpcb/export/gerber.ts'
import { bom, bomCsv, bomMarkdown, pickAndPlaceCsv } from '../../src/apps/kpcb/export/bom.ts'
import { renderSvg } from '../../src/apps/kpcb/export/svg.ts'
import { boardSummary } from '../../src/apps/kpcb/export/summary.ts'
import { gerberZip } from '../../src/apps/kpcb/export/zip.ts'
import { parseDesign, serializeDesign } from '../../src/apps/kpcb/file.ts'
import { arrangeParts, suggestBoardSize } from '../../src/apps/kpcb/arrange.ts'
import { textStrokes, textWidth } from '../../src/apps/kpcb/font.ts'
import { DEFAULT_RULES } from '../../src/apps/kpcb/types.ts'
import type { Design, Part, Track, Via } from '../../src/apps/kpcb/types.ts'

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b} (±${tol})`)

function part(ref: string, fp: string, x: number, y: number, rotDeg = 0, side: 'F' | 'B' = 'F', value = ''): Part {
  return { id: uid('p'), ref, value, fp, x, y, rot: rotDeg, side }
}
function track(net: string, layer: 'F.Cu' | 'B.Cu', w: number, x1: number, y1: number, x2: number, y2: number): Track {
  return { id: uid('t'), net, layer, w, x1, y1, x2, y2 }
}
function via(net: string, x: number, y: number, d = 0.8, drill = 0.4): Via {
  return { id: uid('v'), net, x, y, d, drill }
}
/** A blank board with an outline and the given parts / nets. */
function board(parts: Part[], nets: Record<string, string[]> = {}, w = 40, h = 30): Design {
  const d = newDesign('test')
  return {
    ...d,
    outline: rectOutline(0, 0, w, h, 0),
    parts,
    nets: Object.entries(nets).map(([name, pins]) => ({ name, cls: 'Default', pins: pins.map((p) => ({ ref: p.split('.')[0], pin: p.split('.')[1] })) })),
  }
}

// ------------------------------------------------------------------ geometry

test('geometry: rotation, distances, polygons', () => {
  const r = rot({ x: 1, y: 0 }, 90)
  near(r.x, 0)
  near(r.y, -1) // counter-clockwise on a screen with y down
  const r45 = rot({ x: 1, y: 0 }, 45)
  near(r45.x, Math.SQRT1_2)
  near(r45.y, -Math.SQRT1_2)
  near(segSegDist({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }), 1)
  near(segSegDist({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 }), 0)
  assert.ok(pointInPoly(1, 1, rectPoly(1, 1, 2, 2)))
  assert.ok(!pointInPoly(3, 1, rectPoly(1, 1, 2, 2)))
  near(polyArea(rectPoly(0, 0, 4, 2)), 8)
  // a round pad (point + r) and a rectangle
  near(shapeDist({ core: [{ x: 0, y: 0 }], r: 0.5 }, { core: rectPoly(3, 0, 1, 1), r: 0 }), 2.5 - 0.5)
  near(coreDist(rectPoly(0, 0, 2, 2), rectPoly(0.5, 0.5, 2, 2)), 0)
  near(coreDist(rectPoly(0, 0, 2, 2), rectPoly(0, 0, 0.5, 0.5)), 0)
  assert.ok(convexOverlap(rectPoly(0, 0, 2, 2), rectPoly(1, 1, 2, 2)))
  assert.ok(!convexOverlap(rectPoly(0, 0, 2, 2), rectPoly(2, 0, 2, 2)), 'touching is not overlapping')
  const rr = roundedRectPoly(0, 0, 10, 6, 2, 8)
  assert.equal(rr.length, 36)
  assert.deepEqual(simplifyRing([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }]).length, 4)
})

test('stroke font: glyphs, width, mirror', () => {
  const s = textStrokes('R12', 0, 0, 1)
  assert.ok(s.length > 5)
  near(textWidth('R12', 1), (3 * 5 - 1) / 6)
  const m = textStrokes('R12', 0, 0, 1, true)
  assert.equal(m.length, s.length)
  near(m[0][0].x, -s[0][0].x)
})

// ------------------------------------------------------------------ footprints

test('the library has the parts a board needs, with unique names and sane pads', () => {
  assert.ok(FOOTPRINTS.length >= 45, `${FOOTPRINTS.length} footprints`)
  const names = FOOTPRINTS.map((f) => f.name)
  assert.equal(new Set(names).size, names.length)
  for (const must of [
    'R_0402', 'R_0603', 'R_0805', 'R_1206', 'C_0603', 'C_0805', 'C_1206', 'D_SOD-123', 'D_SMA', 'D_DO-35', 'D_DO-41', 'LED_0603', 'LED_0805', 'LED_1206',
    'LED_3mm', 'LED_5mm', 'SOT-23', 'SOT-223', 'TO-92', 'TO-220', 'DIP-8', 'DIP-14', 'DIP-16', 'DIP-28', 'SOIC-8', 'SOIC-14', 'SOIC-16', 'TSSOP-14', 'TSSOP-20',
    'QFP-32', 'QFP-44', 'PinHeader_1x02', 'PinHeader_1x10', 'PinHeader_2x05', 'PinHeader_2x10', 'USB_Micro-B', 'USB_C', 'ESP32-WROOM-32', 'Arduino_Nano',
    'OLED_SSD1306_I2C', 'MountingHole_M3', 'R_Axial_THT', 'C_Radial_THT', 'CP_Radial_THT', 'L_Axial_THT', 'C_Disc_THT', 'CP_Radial_D8.0mm', 'Crystal_HC49-U',
    'Crystal_SMD_3225-4Pin', 'SW_Push_6mm', 'Buzzer_12mm', 'Potentiometer_3296W', 'TestPoint_Pad_D1.5mm', 'BarrelJack_DC-005', 'TerminalBlock_2x5.08', 'TerminalBlock_3x5.08',
  ]) assert.ok(getFootprint(must), `${must} exists`)
  for (const alias of Object.keys(FOOTPRINT_ALIASES)) assert.ok(getFootprint(alias), `alias ${alias} resolves`)
  for (const f of FOOTPRINTS) {
    assert.ok(f.pads.length > 0, f.name)
    assert.ok(f.court.x1 > f.court.x0 && f.court.y1 > f.court.y0, `${f.name} courtyard`)
    for (const p of f.pads) {
      assert.ok(p.w > 0 && p.h > 0, `${f.name} pad size`)
      if (p.drill !== undefined) assert.ok(p.drill < Math.min(p.w, p.h) || p.plated === false, `${f.name}: drill ${p.drill} inside pad ${p.w}x${p.h}`)
    }
  }
  assert.ok(searchFootprints('soic').length === 3)
  assert.ok(searchFootprints('dip 14').some((f) => f.name === 'DIP-14'))
})

test('footprint pitches follow the datasheets', () => {
  const dip = getFootprint('DIP-8')!
  const pad = (fp: typeof dip, n: string) => fp.pads.filter((p) => p.n === n)[0]
  near(pad(dip, '2').y - pad(dip, '1').y, 2.54)
  near(pad(dip, '8').x - pad(dip, '1').x, 7.62)
  near(pad(dip, '5').y, pad(dip, '4').y)
  near(pad(dip, '5').x, 7.62)
  assert.equal(dip.pads.length, 8)
  assert.equal(getFootprint('DIP-28')!.pads.length, 28)
  near(pad(getFootprint('DIP-28')!, '14').y, 13 * 2.54)

  const soic = getFootprint('SOIC-8')!
  near(pad(soic, '2').y - pad(soic, '1').y, 1.27)
  near(Math.abs(pad(soic, '5').x - pad(soic, '1').x), 5.4)
  near(pad(soic, '1').y, -1.905)
  near(pad(soic, '5').y, 1.905)
  assert.equal(getFootprint('SOIC-16')!.pads.length, 16)

  const r0805 = getFootprint('R_0805')!
  near(pad(r0805, '2').x - pad(r0805, '1').x, 1.825)
  near(pad(r0805, '1').w, 0.975)
  near(pad(r0805, '1').h, 1.4)
  near(pad(getFootprint('R_0603')!, '2').x - pad(getFootprint('R_0603')!, '1').x, 1.65)
  near(pad(getFootprint('R_1206')!, '2').x - pad(getFootprint('R_1206')!, '1').x, 2.95)

  const tssop = getFootprint('TSSOP-14')!
  near(pad(tssop, '2').y - pad(tssop, '1').y, 0.65)
  assert.equal(getFootprint('TSSOP-20')!.pads.length, 20)

  for (const [name, n, side] of [['QFP-32', 32, 8], ['QFP-44', 44, 11]] as const) {
    const q = getFootprint(name)!
    assert.equal(q.pads.length, n)
    near(pad(q, '2').y - pad(q, '1').y, 0.8)
    near(pad(q, String(side + 2)).x - pad(q, String(side + 1)).x, 0.8)
    // pin 1 is top left on the left side; pin n/4+1 is on the bottom
    assert.ok(pad(q, '1').x < 0 && pad(q, '1').y < 0)
    assert.ok(pad(q, String(side + 1)).y > 0)
  }

  const h = getFootprint('PinHeader_1x10')!
  assert.equal(h.pads.length, 10)
  near(pad(h, '10').y, 9 * 2.54)
  const h2 = getFootprint('PinHeader_2x05')!
  assert.equal(h2.pads.length, 10)
  near(pad(h2, '2').x, 2.54)
  near(pad(h2, '3').y, 2.54)
  near(pad(getFootprint('TerminalBlock_3x5.08')!, '3').x, 10.16)
  near(pad(getFootprint('TO-220')!, '3').x, 5.08)
  near(pad(getFootprint('TO-92')!, '3').x - pad(getFootprint('TO-92')!, '1').x, 2.54)
  near(pad(getFootprint('R_Axial_THT_P7.62' as string)!, '2').x, 7.62)
  near(pad(getFootprint('R_Axial_THT')!, '2').x, 10.16)
  near(pad(getFootprint('Crystal_HC49-U')!, '2').x, 4.88)
  near(pad(getFootprint('LED_5mm')!, '2').x, 2.54)
  near(pad(getFootprint('Arduino_Nano')!, '16').x, 15.24)
  assert.equal(getFootprint('Arduino_Nano')!.pads.length, 30)
  const esp = getFootprint('ESP32-WROOM-32')!
  assert.equal(esp.pads.length, 39)
  near(pad(esp, '2').y - pad(esp, '1').y, 1.27)
  const usb = getFootprint('USB_C')!
  assert.equal(usb.pads.length, 16)
  assert.equal(usb.pads.filter((p) => p.n === 'S').length, 4)
  assert.equal(getFootprint('MountingHole_M3')!.pads[0].plated, false)
})

test('every footprint on its own passes the DRC (no pad too close to another net, no silk over pads)', () => {
  for (const f of FOOTPRINTS) {
    const d = board([part('X1', f.name, 0, 0)], {})
    const nums = [...new Set(f.pads.map((p) => p.n))].filter((n) => n !== '')
    const nets = nums.map((n) => ({ name: `N${n}`, cls: 'Default', pins: [{ ref: 'X1', pin: n }] }))
    const v = runDrc({ ...d, outline: { pts: [] }, nets }).filter((x) => x.rule !== 'outline' && x.rule !== 'unconnected')
    assert.deepEqual(v.map((x) => x.message), [], f.name)
  }
})

// ------------------------------------------------------------------ placement transforms

test('rotation and flip move pads the way a footprint does', () => {
  const p = part('U1', 'DIP-8', 10, 20)
  const pads = (q: Part) => worldPads(q)
  const at = (q: Part, n: string) => pads(q).find((w) => w.n === n)!
  near(at(p, '1').x, 10)
  near(at(p, '4').y, 20 + 7.62)
  // rotated 90° counter-clockwise: pin 4 (below pin 1) ends up to its right
  const r90 = { ...p, rot: 90 }
  near(at(r90, '4').x, 10 + 7.62)
  near(at(r90, '4').y, 20)
  near(at(r90, '8').y, 20 - 7.62)
  // flipped to the bottom: mirrored about the vertical axis through the origin
  const fl = { ...p, side: 'B' as const }
  near(at(fl, '8').x, 10 - 7.62)
  near(at(fl, '1').x, 10)
  assert.deepEqual(at(fl, '1').layers, ['F.Cu', 'B.Cu'], 'a through-hole pad is on both sides')
  const smd = part('R1', 'R_0805', 5, 5)
  assert.deepEqual(worldPads(smd)[0].layers, ['F.Cu'])
  assert.deepEqual(worldPads({ ...smd, side: 'B' })[0].layers, ['B.Cu'])
  near(worldPads({ ...smd, side: 'B' })[0].x, 5 + 0.9125, 1e-9) // pad 1 mirrored to the right
  // a 90° part: pad shapes turn too
  const rr = { ...smd, rot: 90 }
  const s = padShape(worldPads(rr)[0])!
  assert.equal(s.core.length, 4)
  const bx = s.core.map((c) => c.x)
  near(Math.max(...bx) - Math.min(...bx), 1.4 - 2 * 0.25 * 0.975 + 0, 0.5) // the 1.4 mm side is now vertical
  // local / world are inverses
  for (const q of [p, r90, fl, { ...p, rot: 33, side: 'B' as const }]) {
    const w = toWorld(q, { x: 1.5, y: -2 })
    const l = toLocal(q, w)
    near(l.x, 1.5)
    near(l.y, -2)
  }
})

// ------------------------------------------------------------------ netlists

const KELEC: KNetlist = {
  format: 'knetlist',
  version: 1,
  name: 'amp',
  components: [
    { ref: 'R1', kind: 'resistor', value: '10k', pins: ['1', '2'] },
    { ref: 'C1', kind: 'capacitor', value: '100n', pins: ['1', '2'] },
    { ref: 'C2', kind: 'electrolytic', value: '10u', pins: ['1', '2'] },
    { ref: 'D1', kind: 'diode', value: '1N4148', pins: ['A', 'K'] },
    { ref: 'D2', kind: 'led', value: 'red', footprint: 'LED_5mm', pins: ['A', 'K'] },
    { ref: 'Q1', kind: 'npn', value: '2N3904', pins: ['B', 'C', 'E'] },
    { ref: 'Q2', kind: 'nmos', value: 'BS170', pins: ['G', 'D', 'S'] },
    { ref: 'U1', kind: 'opamp', value: 'LM741', pins: ['IN+', 'IN-', 'OUT', 'V+', 'V-'] },
    { ref: 'J1', kind: 'connector', value: 'in', pins: ['1', '2', '3'] },
    { ref: 'L1', kind: 'inductor', value: '10u', pins: ['1', '2'] },
    { ref: 'X1', kind: 'ic', value: 'logic', footprint: 'DIP-14', pins: Array.from({ length: 14 }, (_, i) => String(i + 1)) },
    { ref: 'S1', kind: 'switch', value: '', pins: ['1', '2'] },
  ],
  nets: [
    { name: 'GND', pins: [{ ref: 'R1', pin: '2' }, { ref: 'C1', pin: '2' }, { ref: 'Q1', pin: 'E' }, { ref: 'U1', pin: 'V-' }, { ref: 'J1', pin: '3' }, { ref: 'D1', pin: 'K' }] },
    { name: 'VCC', pins: [{ ref: 'R1', pin: '1' }, { ref: 'U1', pin: 'V+' }, { ref: 'Q2', pin: 'D' }, { ref: 'D2', pin: 'A' }, { ref: 'J1', pin: '1' }] },
    { name: 'SIG', pins: [{ ref: 'Q1', pin: 'B' }, { ref: 'U1', pin: 'IN+' }, { ref: 'Q2', pin: 'G' }, { ref: 'J1', pin: '2' }, { ref: 'D1', pin: 'A' }, { ref: 'Q1', pin: 'C' }, { ref: 'U1', pin: 'OUT' }, { ref: 'U1', pin: 'IN-' }] },
  ],
}

test('a kElec netlist is imported with default footprints and pin mapping', () => {
  assert.equal(defaultFootprint('resistor'), 'R_0805')
  assert.equal(defaultFootprint('capacitor'), 'C_0805')
  assert.equal(defaultFootprint('electrolytic'), 'CP_Radial_THT')
  assert.equal(defaultFootprint('diode'), 'D_SOD-123')
  assert.equal(defaultFootprint('led'), 'LED_0805')
  assert.equal(defaultFootprint('npn'), 'TO-92')
  assert.equal(defaultFootprint('nmos'), 'SOT-23')
  assert.equal(defaultFootprint('opamp'), 'DIP-8')
  assert.equal(defaultFootprint('connector', 2), 'PinHeader_1x02')
  assert.equal(defaultFootprint('connector', 3), 'PinHeader_1x03')
  assert.equal(defaultFootprint('connector', 4), 'PinHeader_1x04')
  const imp = parseNetlist(KELEC)
  const fp = Object.fromEntries(imp.parts.map((p) => [p.ref, p.fp]))
  assert.equal(fp.R1, 'R_0805')
  assert.equal(fp.C1, 'C_0805')
  assert.equal(fp.C2, 'CP_Radial_D6.3mm_P2.50mm', 'CP_Radial_THT is an alias of the 6.3 mm capacitor')
  assert.equal(fp.D1, 'D_SOD-123')
  assert.equal(fp.D2, 'LED_5mm', 'the netlist can choose the footprint')
  assert.equal(fp.Q1, 'TO-92')
  assert.equal(fp.Q2, 'SOT-23')
  assert.equal(fp.U1, 'DIP-8')
  assert.equal(fp.J1, 'PinHeader_1x03')
  assert.equal(fp.L1, 'L_Axial_THT_P10.16')
  assert.equal(fp.X1, 'DIP-14')
  const pins = (net: string) => imp.nets.find((n) => n.name === net)!.pins.map((p) => `${p.ref}.${p.pin}`).sort()
  assert.deepEqual(pins('GND'), ['C1.2', 'D1.2', 'J1.3', 'Q1.3', 'R1.2', 'U1.4'])
  assert.deepEqual(pins('VCC'), ['D2.1', 'J1.1', 'Q2.3', 'R1.1', 'U1.7'])
  assert.deepEqual(pins('SIG'), ['D1.1', 'J1.2', 'Q1.1', 'Q1.2', 'Q2.1', 'U1.2', 'U1.3', 'U1.6'])
  assert.deepEqual(imp.warnings, [])
  assert.equal(imp.nets.find((n) => n.name === 'VCC')!.cls, 'Power')
  assert.equal(imp.nets.find((n) => n.name === 'SIG')!.cls, 'Default')
  // a SOT-23 transistor follows its datasheet (1 = B, 2 = E, 3 = C)
  assert.equal(padFor('npn', 'SOT-23', 'E', ['B', 'C', 'E']), '2')
  assert.equal(padFor('npn', 'TO-92', 'E', ['B', 'C', 'E']), '3')
  assert.equal(padFor('led', 'LED_0805', 'K', ['A', 'K']), '2')
  // an unknown footprint falls back with a warning
  const odd = parseNetlist({ ...KELEC, components: [{ ref: 'R1', kind: 'resistor', value: '1k', footprint: 'Fancy-9', pins: ['1', '2'] }], nets: [] })
  assert.equal(odd.parts[0].fp, 'R_0805')
  assert.match(odd.warnings[0], /Fancy-9/)
})

test('the text and KiCad netlist formats', () => {
  const text = `# a 555 blinker
title: blink
U1 NE555 DIP-8 | GND:1 TRIG:2 OUT:3 VCC:4 VCC:8
R1 10k R_0805 | VCC:1 TRIG:2
C1 - | TRIG:1 GND:2
J1 Batt PinHeader_1x02 | VCC:1 GND:2
`
  const imp = parseTextNetlist(text)
  assert.equal(imp.name, 'blink')
  assert.equal(imp.parts.length, 4)
  assert.equal(imp.parts.find((p) => p.ref === 'C1')!.fp, 'C_0805', 'no footprint: chosen by the reference letters')
  assert.equal(imp.parts.find((p) => p.ref === 'C1')!.value, '')
  assert.equal(imp.nets.find((n) => n.name === 'VCC')!.pins.length, 4)
  assert.deepEqual(imp.warnings, [])
  assert.equal(parseNetlist(text).parts.length, 4)
  // bad lines are reported, not fatal
  assert.ok(parseTextNetlist('R1 10k R_0805 | VCC1').warnings.length > 0)
  assert.ok(parseTextNetlist('R1 10k R_0805 | VCC:7').warnings.some((w) => /no pad "7"/.test(w)))
  // KiCad
  const kicad = `(export (version D)
    (design (source "/tmp/blink.sch"))
    (components
      (comp (ref R1) (value 10k) (footprint Resistor_SMD:R_0805_2012Metric))
      (comp (ref "U1") (value NE555) (footprint Package_DIP:DIP-8_W7.62mm))
      (comp (ref J1) (value Conn) (footprint Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical)))
    (nets
      (net (code 1) (name "VCC") (node (ref R1) (pin 1)) (node (ref U1) (pin 8)) (node (ref J1) (pin 1)))
      (net (code 2) (name "/OUT") (node (ref R1) (pin 2)) (node (ref U1) (pin 3)))))`
  const k = parseNetlist(kicad)
  assert.equal(k.name, 'blink')
  assert.deepEqual(k.parts.map((p) => p.fp), ['R_0805', 'DIP-8', 'PinHeader_1x02'])
  assert.deepEqual(k.nets.map((n) => n.name), ['VCC', '/OUT'])
  assert.throws(() => parseNetlist('(foo)'), /KiCad/)
  // the design's own netlist survives the text format
  const d = applyNetlist(newDesign('x'), imp, 'replace').design
  const back = parseTextNetlist(toTextNetlist(d))
  assert.deepEqual(back.parts.map((p) => [p.ref, p.fp]), imp.parts.map((p) => [p.ref, p.fp]))
  assert.equal(back.nets.length, imp.nets.length)
})

test('updating from a netlist keeps placed parts, adds new ones and flags removed ones', () => {
  const imp = parseNetlist(KELEC)
  const first = applyNetlist(newDesign('amp'), imp, 'replace')
  assert.equal(first.report.added.length, 12)
  let d = first.design
  d = { ...d, parts: d.parts.map((p) => (p.ref === 'R1' ? { ...p, x: 12, y: 8 } : p)), tracks: [track('GND', 'F.Cu', 0.25, 0, 0, 5, 5)] }
  // the next version of the netlist: R1 became 1206, C1 is gone, R9 is new
  const next = {
    ...imp,
    parts: [...imp.parts.filter((p) => p.ref !== 'C1').map((p) => (p.ref === 'R1' ? { ...p, fp: 'R_1206' } : p)), { ref: 'R9', value: '1k', fp: 'R_0805' }],
    nets: imp.nets.map((n) => ({ ...n, pins: n.pins.filter((p) => p.ref !== 'C1') })),
  }
  const up = applyNetlist(d, next, 'update')
  assert.deepEqual(up.report.added, ['R9'])
  assert.deepEqual(up.report.removed, ['C1'])
  assert.deepEqual(up.report.changed, ['R1'])
  const r1 = up.design.parts.find((p) => p.ref === 'R1')!
  assert.equal(r1.fp, 'R_1206')
  assert.equal(r1.x, 12)
  assert.equal(up.design.parts.find((p) => p.ref === 'C1')!.stale, true)
  assert.equal(up.design.tracks.length, 1)
  assert.ok(runDrc(up.design).some((v) => v.rule === 'netlist' && /C1/.test(v.message)))
})

// ------------------------------------------------------------------ ratsnest

test('ratsnest: a minimum spanning tree of the pads still apart', () => {
  // four 1x02 headers in a row, 10 mm apart, all on one net
  const parts = [0, 1, 2, 3].map((i) => part(`J${i + 1}`, 'PinHeader_1x02', 5 + i * 10, 5))
  const d = board(parts, { N: ['J1.1', 'J2.1', 'J3.1', 'J4.1'] })
  const rl = ratsnest(d, analyze(d))
  assert.equal(rl.length, 3)
  near(rl.reduce((s, r) => s + r.len, 0), 30)
  // a track from J1.1 to J2.1 joins them: two lines are left
  const joined = { ...d, tracks: [track('N', 'F.Cu', 0.25, 5, 5, 15, 5)] }
  const r2 = ratsnest(joined, analyze(joined))
  assert.equal(r2.length, 2)
  near(r2.reduce((s, r) => s + r.len, 0), 20)
  // a track that only touches one pad changes nothing
  const stub = { ...d, tracks: [track('N', 'F.Cu', 0.25, 5, 5, 8, 5)] }
  assert.equal(ratsnest(stub, analyze(stub)).length, 3)
  // through-hole pads are on both layers: a track on the bottom joins them too
  const bottom = { ...d, tracks: [track('N', 'B.Cu', 0.25, 5, 5, 15, 5), track('N', 'B.Cu', 0.25, 15, 5, 25, 5), track('N', 'B.Cu', 0.25, 25, 5, 35, 5)] }
  assert.equal(ratsnest(bottom, analyze(bottom)).length, 0)
  // a via links the layers for surface-mount pads on both sides
  const two = board([part('R1', 'R_0805', 10, 10), part('R2', 'R_0805', 20, 10, 0, 'B')], { A: ['R1.2', 'R2.2'] })
  assert.equal(ratsnest(two, analyze(two)).length, 1)
  const wired = { ...two, tracks: [track('A', 'F.Cu', 0.25, 10.9125, 10, 12, 10), track('A', 'B.Cu', 0.25, 12, 10, 19.0875, 10)], vias: [via('A', 12, 10)] }
  assert.equal(ratsnest(wired, analyze(wired)).length, 0)
  // pins with the same number (a button's two legs) are one node
  const sw = board([part('SW1', 'SW_Push_6mm', 10, 10), part('J1', 'PinHeader_1x02', 25, 10)], { A: ['SW1.1', 'J1.1'] })
  assert.equal(ratsnest(sw, analyze(sw)).length, 1)
})

// ------------------------------------------------------------------ design rules

test('DRC catches too-close copper, shorts, thin tracks and small rings; clean boards pass', () => {
  const two = board([part('J1', 'PinHeader_1x02', 10, 10), part('J2', 'PinHeader_1x02', 25, 10)], { A: ['J1.1', 'J2.1'], B: ['J1.2', 'J2.2'] })
  const clean = { ...two, tracks: [track('A', 'F.Cu', 0.25, 10, 10, 25, 10), track('B', 'F.Cu', 0.25, 10, 12.54, 25, 12.54)] }
  assert.deepEqual(runDrc(clean).map((v) => v.message), [])

  // two tracks of different nets 0.1 mm apart (edge to edge)
  const close = {
    ...board([], {}),
    tracks: [track('A', 'F.Cu', 0.25, 5, 5, 20, 5), track('B', 'F.Cu', 0.25, 5, 5.35, 20, 5.35)],
  }
  const v = runDrc(close)
  const clr = v.filter((x) => x.rule === 'clearance')
  assert.equal(clr.length, 1)
  assert.match(clr[0].message, /0\.100 mm < 0\.2 mm/)
  near(clr[0].y, 5.175, 0.01)
  // exactly at the rule is fine
  const ok = { ...close, tracks: [close.tracks[0], track('B', 'F.Cu', 0.25, 5, 5.45, 20, 5.45)] }
  assert.equal(runDrc(ok).filter((x) => x.rule === 'clearance').length, 0)
  // the same net may touch itself; different layers do not interact
  const same = { ...close, tracks: [track('A', 'F.Cu', 0.25, 5, 5, 20, 5), track('A', 'F.Cu', 0.25, 5, 5.2, 20, 5.2)] }
  assert.equal(runDrc(same).filter((x) => x.rule === 'clearance').length, 0)
  const layers = { ...close, tracks: [close.tracks[0], { ...close.tracks[1], layer: 'B.Cu' as const }] }
  assert.equal(runDrc(layers).filter((x) => x.rule === 'clearance').length, 0)

  // a short: a track of net A running over a pad of net B
  const short = { ...two, tracks: [track('A', 'F.Cu', 0.25, 10, 10, 10, 12.54)] }
  const sv = runDrc(short).filter((x) => x.rule === 'short')
  assert.ok(sv.length >= 1)
  assert.match(sv[0].message, /Short circuit between A and B/)
  // a track without a net joining two nets is a short too
  const bridge = { ...two, tracks: [track('', 'F.Cu', 0.25, 10, 10, 10, 12.54)] }
  assert.ok(runDrc(bridge).some((x) => x.rule === 'short'))

  // thin track
  const thin = { ...two, tracks: [track('A', 'F.Cu', 0.15, 10, 10, 25, 10)] }
  assert.equal(runDrc(thin).filter((x) => x.rule === 'track-width').length, 1)
  // small annular ring and drill
  const rings = { ...board([], {}), vias: [via('', 20, 15, 0.5, 0.4), via('', 25, 15, 0.8, 0.2)] }
  const rv = runDrc(rings)
  assert.ok(rv.some((x) => x.rule === 'annular' && /0\.050/.test(x.message)))
  assert.ok(rv.some((x) => x.rule === 'via-drill'))
  // hole to hole
  const holes = { ...board([], {}), vias: [via('', 20, 15, 0.8, 0.4), via('', 20.5, 15, 0.8, 0.4)] }
  assert.ok(runDrc(holes).some((x) => x.rule === 'hole-to-hole'))
  // copper near the board edge, and outside it
  const edge = { ...board([], {}), tracks: [track('', 'F.Cu', 0.25, 0.3, 5, 10, 5), track('', 'F.Cu', 0.25, 5, 29.8, 10, 29.8), track('', 'F.Cu', 0.25, 45, 5, 50, 5)] }
  assert.equal(runDrc(edge).filter((x) => x.rule === 'edge').length, 3)
  // a pad of another net next to a pad
  const pads = board([part('J1', 'PinHeader_1x02', 10, 10), part('J2', 'PinHeader_1x02', 11.8, 10)], { A: ['J1.1'], B: ['J2.1'] })
  assert.ok(runDrc(pads).some((x) => x.rule === 'clearance'))
  // overlapping courtyards
  const court = board([part('R1', 'R_0805', 10, 10), part('R2', 'R_0805', 11, 10)], {})
  assert.ok(runDrc(court).some((x) => x.rule === 'courtyard'))
  assert.equal(runDrc(board([part('R1', 'R_0805', 10, 10), part('R2', 'R_0805', 20, 10)], {})).filter((x) => x.rule === 'courtyard').length, 0)
  // a dangling track end
  const dangle = { ...two, tracks: [track('A', 'F.Cu', 0.25, 10, 10, 18, 10)] }
  const dv = runDrc(dangle).filter((x) => x.rule === 'dangling')
  assert.equal(dv.length, 1)
  near(dv[0].x, 18)
  // silk over a pad: a part sitting on top of the other's silk
  assert.ok(runDrc(board([part('J1', 'PinHeader_1x02', 10, 10), part('R1', 'R_0805', 11.9, 10)], {})).some((x) => x.rule === 'silk'))
  // unconnected pads show up as errors
  const un = runDrc(two).filter((x) => x.rule === 'unconnected')
  assert.equal(un.length, 2)
  // rules can be loosened
  const loose = { ...close, rules: { ...close.rules, clearance: 0.05 } }
  assert.equal(runDrc(loose).filter((x) => x.rule === 'clearance').length, 0)
  assert.deepEqual(Object.keys(DEFAULT_RULES).sort(), Object.keys(close.rules).sort())
  // no outline: a warning
  assert.ok(runDrc({ ...two, outline: { pts: [] } }).some((x) => x.rule === 'outline'))
})

test('DRC geometry is exact for oval and rotated pads', () => {
  // DIP pads (round) 2.54 apart, 1.6 wide: gap 0.94. A 0.7 mm track fits through with 0.12 each side: too tight.
  const d = board([part('U1', 'DIP-8', 10, 10)], { A: ['U1.1'], B: ['U1.2'], C: ['U1.3'] })
  const pass = { ...d, tracks: [track('C', 'F.Cu', 0.25, 10, 10, 10, 10.5)] }
  assert.ok(runDrc(pass).some((x) => x.rule === 'clearance' || x.rule === 'short'))
  // rotated 90°: the same footprint, same answers
  const r = { ...d, parts: [part('U1', 'DIP-8', 10, 10, 90)] }
  assert.deepEqual(runDrc(r).filter((x) => x.rule === 'clearance').length, 0)
  // an oval pad (TO-92) against a track beside it: the gap is measured to the rounded end
  const q = board([part('Q1', 'TO-92', 15, 15)], { A: ['Q1.1'], B: ['Q1.2'], C: ['Q1.3'] })
  const gap = 1.27 - 1.05 // pad to pad
  near(shapeDist(padShape(worldPads(q.parts[0])[0])!, padShape(worldPads(q.parts[0])[1])!), gap, 1e-9)
  assert.equal(runDrc(q).filter((x) => x.rule === 'clearance').length, 0)
})

// ------------------------------------------------------------------ zones

test('zone fill keeps its clearance to other nets, joins its own net and drops islands', () => {
  const d0 = board([part('J1', 'PinHeader_1x02', 10, 15), part('J2', 'PinHeader_1x02', 30, 15)], { GND: ['J1.1', 'J2.1'], SIG: ['J1.2', 'J2.2'] })
  const d: Design = {
    ...d0,
    tracks: [track('SIG', 'B.Cu', 0.3, 10, 17.54, 30, 17.54)],
    zones: [{ id: 'z1', net: 'GND', layer: 'B.Cu', pts: [{ x: 1, y: 1 }, { x: 39, y: 1 }, { x: 39, y: 29 }, { x: 1, y: 29 }], clearance: 0.3 }],
  }
  const fill = fillZone(d, d.zones[0])
  assert.equal(fill.length, 1, 'one connected island')
  // sample the copper: it is never closer than 0.3 mm to the SIG track or pads, nor than the edge clearance to the outline
  let samples = 0
  const obstacles = [
    { core: [{ x: 10, y: 17.54 }, { x: 30, y: 17.54 }], r: 0.15 },
    ...[worldPads(d.parts[0])[1], worldPads(d.parts[1])[1]].map((p) => padShape(p)!),
  ]
  const poly = fill[0]
  for (let x = 1; x < 39; x += 0.37) {
    for (let y = 1; y < 29; y += 0.37) {
      const inside = pointInPoly(x, y, poly.outer) && !poly.holes.some((h) => pointInPoly(x, y, h))
      if (!inside) continue
      samples++
      for (const o of obstacles) assert.ok(shapeDist({ core: [{ x, y }], r: 0 }, o) >= 0.3 - 1e-9, `copper at ${x.toFixed(2)},${y.toFixed(2)} is too close`)
      assert.ok(x >= 0.3 - 1e-9 && x <= 39.7 && y >= 0.3 && y <= 29.7)
    }
  }
  assert.ok(samples > 500, `${samples} samples`)
  // the GND pads (through hole) lie in the copper: connected without a track
  const fills = { z1: fill }
  const rl = ratsnest(d, analyze(d, fills))
  assert.equal(rl.filter((r) => r.net === 'GND').length, 0)
  assert.equal(rl.filter((r) => r.net === 'SIG').length, 0, 'SIG is joined by its track')
  assert.deepEqual(runDrc(d, fills).filter((v) => v.severity === 'error'), [])
  // no GND anywhere: everything is an island and is removed
  const empty = fillZone({ ...d, nets: d.nets.filter((n) => n.name !== 'GND') }, d.zones[0])
  assert.equal(empty.length, 0)
  // a wall of another net splits the zone: the island with no GND pad goes
  const wall: Design = { ...d, tracks: [track('SIG', 'B.Cu', 0.3, 20, 0, 20, 30)] }
  const split = fillZone(wall, d.zones[0])
  assert.ok(split.length >= 1)
  const area = (f: typeof fill) => f.reduce((s, p) => s + polyArea(p.outer) + p.holes.reduce((a, h) => a + polyArea(h), 0), 0)
  assert.ok(area(split) < area(fill))
  // the pours have holes where other-net pads are, and outer rings with positive area
  assert.ok(poly.holes.length >= 1)
  assert.ok(polyArea(poly.outer) > 0 && poly.holes.every((h) => polyArea(h) < 0))
  // thermal reliefs: a spoke leaves the pad, the gap does not
  const th: Design = { ...d, tracks: [], zones: [{ ...d.zones[0], thermal: true }] }
  const tf = fillZone(th, th.zones[0])
  const pad = worldPads(th.parts[0])[0] // J1.1 at (10, 15), GND
  const inCopper = (x: number, y: number) => tf.some((p) => pointInPoly(x, y, p.outer) && !p.holes.some((h) => pointInPoly(x, y, h)))
  assert.ok(inCopper(pad.x, pad.y), 'the pad itself')
  assert.ok(inCopper(pad.x + 1.0, pad.y), 'a spoke to the right')
  assert.ok(!inCopper(pad.x + 0.9, pad.y + 0.9), 'a gap on the diagonal')
  assert.ok(fillZones(th)['z1'].length >= 1)
})

// ------------------------------------------------------------------ auto-router

test('the auto-router completes the bundled examples at 100 % and leaves them DRC-clean', () => {
  for (const e of EXAMPLES) {
    const d = e.build()
    assert.ok(ratsnest(d, analyze(d, fillZones(d))).length > 0, `${e.id} starts unrouted`)
    const r = autoroute(d)
    assert.equal(r.completion, 100, `${e.id}: ${r.remaining} left, failed ${r.failedNets.join(',')}`)
    assert.equal(r.remaining, 0)
    assert.ok(r.tracksAdded > 0)
    const fills = fillZones(r.design)
    const v = runDrc(r.design, fills)
    assert.deepEqual(v.map((x) => `${x.rule}: ${x.message}`), [], `${e.id} is DRC-clean`)
    assert.ok(r.design.tracks.every((t) => t.auto), 'router tracks are flagged')
    // undo routing removes what it made
    const back = unroute(r.design)
    assert.equal(back.tracks.length, 0)
    assert.equal(back.vias.length, 0)
    // routedExample is the same thing
    const again = routedExample(e.id)
    assert.equal(ratsnest(again, analyze(again, fillZones(again))).length, 0)
  }
})

test('the router uses a via to cross, respects other nets, and reports what it cannot do', () => {
  // two nets that must cross: A runs left-right, B top-bottom, through-hole pads, no room around them
  const d = board(
    [part('J1', 'PinHeader_1x02', 8, 14, 90), part('J2', 'PinHeader_1x02', 28, 14, 90), part('J3', 'PinHeader_1x02', 18, 6), part('J4', 'PinHeader_1x02', 18, 22)],
    { A: ['J1.1', 'J2.1'], B: ['J3.2', 'J4.1'] }, 36, 30,
  )
  const r = autoroute(d)
  assert.equal(r.completion, 100)
  assert.deepEqual(runDrc(r.design, fillZones(r.design)).filter((v) => v.severity === 'error').map((v) => v.message), [])
  // a net walled in: an outline too small to leave room
  const walled = board([part('R1', 'R_0805', 5, 5), part('R2', 'R_0805', 25, 5)], { A: ['R1.2', 'R2.1'] }, 30, 10)
  const wall = { ...walled, tracks: [track('W', 'F.Cu', 0.5, 15, 0, 15, 10), track('W', 'B.Cu', 0.5, 15, 0, 15, 10)] }
  const w = autoroute(wall, { passes: 1 })
  assert.ok(w.completion < 100)
  assert.deepEqual(w.failedNets, ['A'])
  // only the listed nets are routed
  const both = board([part('R1', 'R_0805', 5, 5), part('R2', 'R_0805', 15, 5), part('R3', 'R_0805', 5, 15), part('R4', 'R_0805', 15, 15)], { A: ['R1.2', 'R2.1'], B: ['R3.2', 'R4.1'] })
  const only = autoroute(both, { nets: ['A'] })
  assert.ok(only.design.tracks.every((t) => t.net === 'A'))
  assert.equal(only.completion, 100)
  // a net with wider tracks (Power) uses its class width
  const pw0 = board([part('J1', 'PinHeader_1x02', 5, 5, 90), part('J2', 'PinHeader_1x02', 25, 5, 90)], { VCC: ['J1.1', 'J2.1'] })
  const pw = { ...pw0, nets: pw0.nets.map((n) => ({ ...n, cls: 'Power' })) }
  const pr = autoroute(pw)
  assert.ok(pr.design.tracks.length > 0 && pr.design.tracks.every((t) => Math.abs(t.w - 0.5) < 1e-9))
})

// ------------------------------------------------------------------ Gerber and Excellon

interface Parsed {
  apertures: Map<number, string>
  macros: string[]
  flashes: Array<{ x: number; y: number; ap: number }>
  draws: number
  regions: number
  clearRegions: number
  units: string
  format: string
  ended: boolean
}

/** A small RS-274X reader, enough to check what kPCB writes. */
function parseGerber(text: string): Parsed {
  const out: Parsed = { apertures: new Map(), macros: [], flashes: [], draws: 0, regions: 0, clearRegions: 0, units: '', format: '', ended: false }
  let cur = 0
  let inRegion = false
  let clear = false
  let x = 0
  let y = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('G04')) continue
    let m: RegExpExecArray | null
    if ((m = /^%AM(\w+)\*/.exec(line))) out.macros.push(m[1])
    else if ((m = /^%ADD(\d+)(.+)\*%$/.exec(line))) out.apertures.set(Number(m[1]), m[2])
    else if ((m = /^%FSLAX(\d\d)Y(\d\d)\*%$/.exec(line))) out.format = m[1]
    else if (line === '%MOMM*%') out.units = 'mm'
    else if (line === '%LPC*%') clear = true
    else if (line === '%LPD*%') clear = false
    else if (line === 'G36*') {
      inRegion = true
      out.regions++
      if (clear) out.clearRegions++
    } else if (line === 'G37*') inRegion = false
    else if (line === 'M02*') out.ended = true
    else if ((m = /^D(\d+)\*$/.exec(line))) cur = Number(m[1])
    else if ((m = /^X(-?\d+)Y(-?\d+)D0([123])\*$/.exec(line))) {
      x = Number(m[1]) / 1e6
      y = Number(m[2]) / 1e6
      if (m[3] === '3') {
        assert.ok(!inRegion, 'no flash inside a region')
        out.flashes.push({ x, y, ap: cur })
      } else if (m[3] === '1' && !inRegion) out.draws++
    }
  }
  return out
}

test('Gerber files: apertures, coordinates and counts match the board', () => {
  const d = routedExample('555-blinker')
  const fills = fillZones(d)
  const files = exportGerbers(d, fills)
  const names = files.map((f) => f.name)
  for (const l of ['F_Cu', 'B_Cu', 'F_Silk', 'B_Silk', 'F_Mask', 'B_Mask', 'F_Paste', 'Edge_Cuts']) assert.ok(names.some((n) => n.endsWith(`-${l}.gbr`)), l)
  assert.ok(names.includes('555-blinker-PTH.drl') && names.includes('555-blinker-NPTH.drl'))
  const by = (suffix: string) => files.find((f) => f.name.endsWith(suffix))!
  const pads = d.parts.flatMap((p) => worldPads(p))
  for (const f of files) {
    if (!f.name.endsWith('.gbr')) continue
    const p = parseGerber(f.text)
    assert.equal(p.units, 'mm')
    assert.equal(p.format, '46')
    assert.ok(p.ended, `${f.name} ends with M02`)
    assert.ok(f.text.includes('%TF.FileFunction'), 'file function attribute')
    // every aperture used is defined
    for (const m of f.text.matchAll(/^D(\d+)\*$/gm)) assert.ok(p.apertures.has(Number(m[1])), `${f.name}: D${m[1]} defined`)
    assert.equal(p.flashes.length, f.flashes)
    assert.equal(p.draws, f.draws)
    assert.equal(p.regions, f.regions)
  }
  // copper: pad and via flashes, track draws, zone regions
  const top = parseGerber(by('-F_Cu.gbr').text)
  assert.equal(top.flashes.length, pads.filter((p) => p.layers.includes('F.Cu')).length + d.vias.length)
  assert.equal(top.draws, d.tracks.filter((t) => t.layer === 'F.Cu').length)
  const bottom = parseGerber(by('-B_Cu.gbr').text)
  assert.equal(bottom.draws, d.tracks.filter((t) => t.layer === 'B.Cu').length)
  const zoneRegions = fills[d.zones[0].id].reduce((n, p) => n + 1 + p.holes.length, 0)
  assert.equal(bottom.regions, zoneRegions)
  assert.equal(bottom.clearRegions, fills[d.zones[0].id].reduce((n, p) => n + p.holes.length, 0))
  assert.equal(top.regions, 0)
  // a known flash: J1 pin 1 at (10, 11) on a 46 x 30 board: x = 10, y = 30 - 11 = 19
  const j1 = pads.find((p) => p.label === 'J1.1')!
  assert.ok(top.flashes.some((f) => Math.abs(f.x - (j1.x - 0)) < 1e-6 && Math.abs(f.y - (30 - j1.y)) < 1e-6), 'J1.1 flash position')
  assert.ok(by('-F_Cu.gbr').text.includes(`X${Math.round(j1.x * 1e6)}Y${Math.round((30 - j1.y) * 1e6)}D03*`))
  // the outline is four sides plus rounded corners: closed loop of draws
  const edge = parseGerber(by('-Edge_Cuts.gbr').text)
  assert.equal(edge.draws, d.outline.pts.length)
  // the mask has an opening per pad, bigger than the pad; the paste only the surface-mount pads
  const mask = parseGerber(by('-F_Mask.gbr').text)
  assert.equal(mask.flashes.length, pads.filter((p) => p.layers.includes('F.Cu')).length)
  const paste = parseGerber(by('-F_Paste.gbr').text)
  assert.equal(paste.flashes.length, pads.filter((p) => p.def.drill === undefined && p.part.side === 'F').length)
  // rounded and rotated pads use macros
  const esp = routedExample('esp32-breakout')
  const espTop = parseGerber(exportGerbers(esp, fillZones(esp)).find((f) => f.name.endsWith('-F_Cu.gbr'))!.text)
  assert.ok(espTop.macros.length >= 1)
  assert.ok([...espTop.apertures.values()].some((a) => a.startsWith('RRECT') || a.startsWith('R,')))
  // silkscreen strokes exist
  assert.ok(parseGerber(by('-F_Silk.gbr').text).draws > 20)
})

test('Excellon: tool table, hit counts and plated / non-plated split', () => {
  const d = routedExample('555-blinker')
  const files = exportGerbers(d, fillZones(d))
  const pth = files.find((f) => f.name.endsWith('-PTH.drl'))!
  const npth = files.find((f) => f.name.endsWith('-NPTH.drl'))!
  const lines = pth.text.split('\n')
  assert.equal(lines[0], 'M48')
  assert.ok(lines.includes('METRIC,TZ'))
  assert.ok(lines.includes('%'))
  assert.equal(lines.filter((l) => l.length).at(-1), 'M30')
  const tools = lines.filter((l) => /^T\d+C[\d.]+$/.test(l)).map((l) => Number(l.split('C')[1]))
  assert.deepEqual(tools, [...tools].sort((a, b) => a - b))
  const holes = d.parts.flatMap((p) => worldPads(p)).filter((p) => p.drill > 0 && p.plated)
  const hits = lines.filter((l) => /^X[\d.]+Y[\d.]+$/.test(l)).length
  assert.equal(hits, holes.length + d.vias.length)
  const diam = new Set([...holes.map((h) => h.drill), ...d.vias.map((v) => v.drill)].map((x) => x.toFixed(3)))
  assert.deepEqual(new Set(tools.map((t) => t.toFixed(3))), diam)
  assert.equal(npth.text.split('\n').filter((l) => /^X[\d.]+Y[\d.]+$/.test(l)).length, 4, 'the four mounting holes')
  assert.ok(npth.text.includes('T1C3.200'))
  // the first plated hit: J1 pin 1 at (10, 11) → X10.000Y19.000
  assert.ok(pth.text.includes('X10.000Y19.000'))
  // a design without plated holes has no PTH file
  const smd = board([part('R1', 'R_0805', 10, 10)], {})
  assert.ok(!exportGerbers(smd).some((f) => f.name.endsWith('-PTH.drl')))
})

test('the Gerber zip holds every file', () => {
  const d = routedExample('uno-shield')
  const zip = unzipSync(gerberZip(d, fillZones(d)))
  const names = Object.keys(zip)
  assert.ok(names.includes('uno-shield-F_Cu.gbr'))
  assert.ok(names.includes('uno-shield-PTH.drl'))
  assert.ok(names.includes('uno-shield-README.txt'))
  assert.ok(strFromU8(zip['uno-shield-Edge_Cuts.gbr']).endsWith('M02*\n'))
})

// ------------------------------------------------------------------ BOM, pick and place, SVG, summary

test('BOM groups by value and footprint with natural reference order', () => {
  const d = board([
    part('R10', 'R_0805', 1, 1, 0, 'F', '10k'), part('R2', 'R_0805', 2, 1, 0, 'F', '10k'), part('R1', 'R_0805', 3, 1, 0, 'F', '10k'),
    part('R3', 'R_0805', 4, 1, 0, 'F', '1k'), part('R4', 'R_0603', 5, 1, 0, 'F', '10k'), part('C1', 'C_0805', 6, 1, 0, 'F', '100n'),
    part('H1', 'MountingHole_M3', 7, 1), part('J1', 'PinHeader_1x02', 8, 1, 0, 'B', 'Pwr'),
  ])
  const lines = bom(d)
  assert.equal(lines.length, 5)
  const rr = lines.find((l) => l.value === '10k' && l.footprint === 'R_0805')!
  assert.deepEqual(rr.refs, ['R1', 'R2', 'R10'])
  assert.equal(rr.qty, 3)
  assert.ok(!lines.some((l) => l.footprint.startsWith('MountingHole')))
  const csv = bomCsv(d).split('\n')
  assert.equal(csv[0], 'Qty,References,Value,Footprint')
  assert.ok(csv.includes('3,R1 R2 R10,10k,R_0805'))
  assert.match(bomMarkdown(d), /\| 3 \| R1, R2, R10 \| 10k \| R_0805 \|/)
  const pnp = pickAndPlaceCsv(d).split('\n')
  assert.equal(pnp[0], 'Ref,Val,Package,PosX,PosY,Rot,Side')
  assert.ok(pnp.includes('R1,10k,R_0805,3.000,29.000,0,top'), 'y is measured up from the lower left corner')
  assert.ok(pnp.includes('J1,Pwr,PinHeader_1x02,8.000,29.000,0,bottom'))
  assert.ok(!pickAndPlaceCsv(d, true).includes('J1,'), 'smd only')
})

test('SVG images: top and bottom, board and black-and-white', () => {
  const d = routedExample('uno-shield')
  const fills = fillZones(d)
  const top = renderSvg(d, fills, { side: 'F', scheme: 'board' })
  assert.match(top, /^<svg xmlns=/)
  assert.ok(top.includes('<title>uno-shield (top)</title>'))
  assert.ok(top.includes('width="71.58mm"'))
  assert.ok(!top.includes('matrix(-1 0 0 1'))
  const bottom = renderSvg(d, fills, { side: 'B', scheme: 'board' })
  assert.ok(bottom.includes('matrix(-1 0 0 1'))
  assert.ok(bottom.includes('fill-rule="evenodd"'), 'the ground pour')
  const bw = renderSvg(d, fills, { side: 'F', scheme: 'bw' })
  assert.ok(bw.includes('fill="#ffffff"') && bw.includes('#000000'))
  assert.notEqual(top, bw)
  assert.equal((top.match(/<circle/g) ?? []).length > 10, true)
})

test('the board summary counts what is on the board', () => {
  const d = routedExample('555-blinker')
  const s = boardSummary(d, fillZones(d))
  assert.equal(s.widthMm, 46)
  assert.equal(s.heightMm, 30)
  assert.equal(s.parts, 8)
  assert.equal(s.vias, d.vias.length)
  assert.equal(s.tracks, d.tracks.length)
  assert.equal(s.holes, 4)
  assert.equal(s.unconnected, 0)
  near(s.trackLengthMm, s.trackLengthByLayer['F.Cu'] + s.trackLengthByLayer['B.Cu'], 0.002)
  assert.ok(s.areaMm2 < 46 * 30 && s.areaMm2 > 46 * 30 - 4 * 0.9 * 4)
})

// ------------------------------------------------------------------ placement

test('"place all parts" puts every part inside the board without overlaps', () => {
  const imp = parseNetlist(KELEC)
  let d = applyNetlist(newDesign('amp'), imp, 'replace').design
  d = { ...d, outline: rectOutline(0, 0, 70, 50, 0) }
  const placed = arrangeParts(d)
  assert.equal(placed.parts.length, d.parts.length)
  const v = runDrc(placed).filter((x) => x.rule === 'courtyard' || x.rule === 'edge')
  assert.deepEqual(v.map((x) => x.message), [])
  // strongly connected parts end up near each other: Q1 and U1 share the SIG net
  const at = (ref: string) => placed.parts.find((p) => p.ref === ref)!
  assert.ok(Math.hypot(at('Q1').x - at('U1').x, at('Q1').y - at('U1').y) < 60)
  // too many parts for the board: the rest go below it, still without overlaps
  const small = { ...placed, outline: rectOutline(0, 0, 20, 14, 0) }
  const s2 = arrangeParts(small)
  assert.ok(s2.parts.some((p) => p.y > 14))
  assert.equal(runDrc(s2).filter((x) => x.rule === 'courtyard').length, 0)
  // locked parts stay
  const locked = arrangeParts({ ...d, parts: d.parts.map((p) => (p.ref === 'R1' ? { ...p, x: 33, y: 22, locked: true } : p)) })
  assert.equal(locked.parts.find((p) => p.ref === 'R1')!.x, 33)
  // only the listed parts move
  const some = arrangeParts(placed, { refs: ['R1'] })
  assert.equal(some.parts.find((p) => p.ref === 'C1')!.x, at('C1').x)
})

// ------------------------------------------------------------------ the file

test('the .kpcb file round-trips the whole design', () => {
  const d = routedExample('esp32-breakout')
  const text = serializeDesign(d)
  const json = JSON.parse(text)
  assert.equal(json.format, 'kpcb')
  assert.equal(json.version, 1)
  const back = parseDesign(text)
  assert.equal(serializeDesign(back), text)
  assert.equal(back.parts.length, d.parts.length)
  assert.equal(back.tracks.length, d.tracks.length)
  assert.equal(back.zones.length, 1)
  assert.deepEqual(back.rules, d.rules)
  assert.deepEqual(back.outline.rect, d.outline.rect)
  assert.equal(back.outline.pts.length, d.outline.pts.length)
  assert.ok(back.parts.every((p) => p.id) && new Set(back.parts.map((p) => p.id)).size === back.parts.length)
  assert.throws(() => parseDesign('nope'), /not a kPCB file/)
  assert.throws(() => parseDesign('{"format":"kbook"}'), /not a kPCB file/)
  assert.throws(() => parseDesign('{"format":"kpcb","version":9}'), /newer/)
  // missing pieces get defaults
  const min = parseDesign('{"format":"kpcb","version":1,"name":"m","outline":{"rect":{"x":0,"y":0,"w":10,"h":5,"r":0}}}')
  assert.equal(min.outline.pts.length, 4)
  assert.equal(min.rules.clearance, 0.2)
  assert.equal(min.classes.Power.track, 0.5)
  // a design with every kind of thing
  const full: Design = {
    ...d,
    parts: d.parts.map((p, i) => (i === 0 ? { ...p, locked: true, side: 'B' as const, rot: 45, refAt: { x: 1, y: 2 } } : p)),
  }
  const rt = parseDesign(serializeDesign(full))
  assert.equal(rt.parts[0].locked, true)
  assert.equal(rt.parts[0].side, 'B')
  assert.equal(rt.parts[0].rot, 45)
  assert.deepEqual(rt.parts[0].refAt, { x: 1, y: 2 })
})

// ------------------------------------------------------------------ editing: history, operations, picking

test('undo / redo, with gestures as one step', () => {
  const h = new History(newDesign('a'))
  const d1 = { ...h.design, name: 'b' }
  const d2 = { ...h.design, name: 'c' }
  h.commit(d1)
  h.commit(d2)
  assert.equal(h.design.name, 'c')
  assert.ok(h.undo())
  assert.equal(h.design.name, 'b')
  assert.ok(h.redo())
  assert.equal(h.design.name, 'c')
  assert.ok(h.undo() && h.undo())
  assert.equal(h.design.name, 'a')
  assert.ok(!h.undo(), 'nothing left to undo')
  assert.ok(h.redo())
  // a drag: many previews, one step
  h.begin()
  for (let i = 0; i < 5; i++) h.preview({ ...h.design, name: `drag${i}` })
  assert.ok(h.end())
  assert.equal(h.design.name, 'drag4')
  assert.ok(h.undo())
  assert.equal(h.design.name, 'b')
  // a cancelled gesture leaves nothing
  h.begin()
  h.preview({ ...h.design, name: 'oops' })
  h.cancel()
  assert.equal(h.design.name, 'b')
  assert.ok(!h.end())
  // a new change forgets the redo stack
  h.commit({ ...h.design, name: 'z' })
  assert.ok(!h.canRedo)
})

test('operations: parts, selection, alignment, deleting, pasting', () => {
  let d = board([], {})
  let r = addPart(d, 'R_0805', 10, 10)
  d = r.design
  assert.equal(r.part.ref, 'R1')
  assert.equal(r.part.value, '10k')
  d = addPart(d, 'R_0805', 20, 12).design
  d = addPart(d, 'C_0805', 30, 14).design
  d = addPart(d, 'DIP-8', 12, 20).design
  d = addPart(d, 'LED_5mm', 30, 22).design
  assert.deepEqual(d.parts.map((p) => p.ref), ['R1', 'R2', 'C1', 'U1', 'D1'])
  assert.equal(addPart(d, 'DIP-8', 1, 1, { ref: 'U9' }).part.ref, 'U9')
  assert.throws(() => addPart(d, 'nope', 0, 0), /Unknown footprint/)
  const ids = d.parts.map((p) => p.id)
  // rotate a group about its middle, flip, lock
  const rot90 = rotateParts(d, [ids[0], ids[1]], 90, true)
  assert.equal(rot90.parts[0].rot, 90)
  near(rot90.parts[0].x, 15 + (12 - 10) * 0 + 0, 5)
  assert.equal(flipParts(d, [ids[0]]).parts[0].side, 'B')
  const locked = { ...d, parts: d.parts.map((p, i) => (i === 0 ? { ...p, locked: true } : p)) }
  assert.equal(moveParts(locked, [ids[0]], 5, 5).parts[0].x, 10, 'a locked part stays')
  // align and distribute
  const left = alignParts(d, [ids[0], ids[1], ids[2]], 'left')
  const boxes = left.parts.slice(0, 3).map((p) => partBox(p).x0)
  near(Math.max(...boxes) - Math.min(...boxes), 0, 1e-9)
  const top = alignParts(d, [ids[0], ids[1], ids[2]], 'top')
  const tops = top.parts.slice(0, 3).map((p) => partBox(p).y0)
  near(Math.max(...tops) - Math.min(...tops), 0, 1e-9)
  const spread = distributeParts({ ...d, parts: d.parts.map((p, i) => (i === 1 ? { ...p, x: 12 } : p)) }, [ids[0], ids[1], ids[2]], 'h')
  const cx = spread.parts.slice(0, 3).map((p) => (partBox(p).x0 + partBox(p).x1) / 2)
  near(cx[1] - cx[0], cx[2] - cx[1], 1e-6)
  // properties: references stay unique and nets follow a rename
  let n = { ...d, nets: [{ name: 'A', cls: 'Default', pins: [{ ref: 'R1', pin: '1' }, { ref: 'R2', pin: '1' }] }] }
  n = setPartProps(n, ids[0], { ref: 'R7' })
  assert.deepEqual(n.nets[0].pins.map((p) => p.ref), ['R7', 'R2'])
  assert.throws(() => setPartProps(n, ids[0], { ref: 'R2' }), /already used/)
  assert.throws(() => setPartProps(n, ids[0], { ref: '1x' }), /valid reference/)
  assert.throws(() => setPartProps(n, ids[0], { fp: 'zzz' }), /Unknown footprint/)
  assert.equal(setPartProps(n, ids[0], { fp: 'r_1206' }).parts[0].fp, 'R_1206')
  // deleting a part takes it out of the nets (and drops nets left empty)
  const del = deleteItems(n, [{ kind: 'part', id: ids[1] }])
  assert.equal(del.parts.length, 4)
  assert.deepEqual(del.nets[0].pins.map((p) => p.ref), ['R7'])
  assert.equal(deleteItems(del, [{ kind: 'part', id: ids[0] }]).nets.length, 0)
  // copy and paste: new references, moved
  const clip = copyItems(d, [{ kind: 'part', id: ids[0] }, { kind: 'part', id: ids[2] }])!
  const pasted = pasteClipboard(d, clip, { x: 40, y: 5 })
  assert.equal(pasted.design.parts.length, 7)
  assert.deepEqual(pasted.design.parts.slice(5).map((p) => p.ref), ['R3', 'C2'])
  near(partBox(pasted.design.parts[5]).x0, 40, 1e-6)
  assert.equal(pasted.items.length, 2)
  assert.equal(copyItems(d, []), null)
  // nets: create, rename, assign, class
  let m = createNet(d, 'GND')
  assert.throws(() => createNet(m, 'GND'), /exists/)
  m = assignPad(m, 'GND', 'R1', '2')
  m = assignPad(m, 'GND', 'C1', '1')
  assert.equal(netOfPad(m, 'R1', '2'), 'GND')
  m = assignPad(m, 'VCC', 'R1', '2')
  assert.equal(netOfPad(m, 'R1', '2'), 'VCC', 'a pad is on one net')
  assert.equal(m.nets.find((x) => x.name === 'VCC')!.cls, 'Power')
  m = renameNet({ ...m, tracks: [track('VCC', 'F.Cu', 0.25, 0, 0, 1, 1)] }, 'VCC', 'V5')
  assert.equal(m.tracks[0].net, 'V5')
  assert.equal(setNetClass(m, 'V5', 'Signal').nets.find((x) => x.name === 'V5')!.cls, 'Signal')
  assert.equal(deleteNet(m, 'V5').tracks[0].net, '')
  assert.equal(assignPad(m, '', 'R1', '2').nets.find((x) => x.name === 'V5'), undefined, 'a net with no pads is dropped when a pad leaves it')
})

test('operations: tracks, vias, outline, holes and zones', () => {
  const d0 = board([part('J1', 'PinHeader_1x02', 10, 10), part('J2', 'PinHeader_1x02', 30, 10)], { A: ['J1.1', 'J2.1'] })
  // a path of tracks, zero-length pieces dropped
  const p = addTrackPath(d0, [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }], 'F.Cu', 0.25, 'A')
  assert.equal(p.ids.length, 2)
  const d1 = p.design
  // dragging the middle corner: both neighbours follow
  const d2 = dragTrack(d1, d1.tracks[0].id, 0, 3)
  const t0 = d2.tracks.find((t) => t.id === d1.tracks[0].id)!
  near(t0.y2, 13)
  // the end on the pad stays; a short connector keeps it joined
  assert.ok(d2.tracks.length >= 3)
  assert.equal(ratsnest(d2, analyze(d2)).length, 1 - (ratsnest(d2, analyze(d2)).length === 0 ? 1 : 0))
  // vias bring track ends with them
  const v = addVia(d1, 20, 10, 'A')
  assert.equal(v.via.d, 0.8)
  const mv = moveVia(v.design, v.via.id, 20, 15)
  assert.ok(mv.tracks.some((t) => t.x2 === 20 && t.y2 === 15))
  // connected runs and a whole net
  assert.equal(connectedTrack(d1, d1.tracks[0].id).length, 2)
  assert.equal(deleteNetCopper(v.design, 'A').tracks.length, 0)
  // nets are adopted from what a track touches
  const free = { ...d0, tracks: [track('', 'F.Cu', 0.25, 10, 10, 30, 10)] }
  assert.equal(adoptNets(free).tracks[0].net, 'A')
  // outlines
  const o = setOutlineRect(d0, 0, 0, 40, 20, 3)
  assert.equal(o.outline.rect!.r, 3)
  assert.ok(o.outline.pts.length > 8)
  const uno = applyOutlinePreset(d0, 'uno')
  assert.equal(uno.holes.length, 4)
  near(uno.outline.rect!.w, 68.58)
  assert.equal(applyOutlinePreset(uno, 'rpi-hat').holes.length, 4, 'a preset replaces the earlier preset holes')
  assert.equal(OUTLINE_PRESETS.length, 4)
  assert.throws(() => applyOutlinePreset(d0, 'zz'), /No outline preset/)
  assert.ok(runDrc({ ...uno, parts: [] }).every((x) => x.rule !== 'hole-to-hole' && x.rule !== 'edge'), 'the preset holes are legal')
  // the tight outline vertex
  assert.deepEqual(moveOutlineVertex(d0, 0, { x: 1, y: 2 }).outline.pts[0], { x: 1, y: 2 })
  assert.equal(addHole(d0, 5, 5).design.holes[0].d, 3.2)
  // a zone over the board
  const z = boardZone(d0, 'A', 'B.Cu', 1)
  assert.equal(z.zones.length, 1)
  assert.equal(z.zones[0].net, 'A')
  assert.ok(addZone(d0, [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }], 'A', 'F.Cu').design.zones[0].clearance === 0.2)
})

test('picking: pads select parts, tracks and vias win by layer, boxes select what they hold', () => {
  const d0 = board([part('R1', 'R_0805', 10, 10), part('J1', 'PinHeader_1x02', 25, 10)], { A: ['R1.2', 'J1.1'] })
  const d: Design = { ...d0, tracks: [track('A', 'F.Cu', 0.4, 10.9, 10, 25, 10), track('A', 'B.Cu', 0.4, 18, 5, 18, 15)], vias: [via('A', 18, 10)], holes: [{ id: 'h1', x: 5, y: 25, d: 3.2 }] }
  const pick = (x: number, y: number, active: 'F.Cu' | 'B.Cu' = 'F.Cu') => pickAt(d, { x, y }, { tol: 0.5, active })
  assert.equal(pick(10.9125, 10)?.kind, 'part', 'on a pad')
  assert.equal(pick(14, 10)?.kind, 'track')
  assert.equal(pick(18, 10)?.kind, 'via')
  assert.equal(pick(18, 6, 'B.Cu')?.kind, 'track')
  assert.equal(pick(5, 25)?.kind, 'hole')
  assert.equal(pick(10, 10.9)?.kind, 'part', 'inside the courtyard')
  assert.equal(pick(35, 25), null)
  assert.equal(pickAt(d, { x: 0, y: 5 }, { tol: 0.5 })?.kind, 'outline', 'the board edge')
  assert.equal(pickAt(d, { x: 14, y: 10 }, { tol: 0.5, visible: new Set(['B.Cu']) })?.kind !== 'track', true, 'hidden layers cannot be picked')
  const inBox = pickInBox(d, { x0: 5, y0: 5, x1: 30, y1: 15 })
  assert.ok(inBox.some((i) => i.kind === 'part') && inBox.some((i) => i.kind === 'track') && inBox.some((i) => i.kind === 'via'))
  assert.ok(!inBox.some((i) => i.kind === 'hole'))
})

// ------------------------------------------------------------------ interactive routing

test('routing helpers: corners at 45° and 90°, snapping and the clearance preview', () => {
  const a = { x: 0, y: 0 }
  assert.deepEqual(nextPoints(a, { x: 10, y: 4 }, '90', false), [{ x: 10, y: 0 }, { x: 10, y: 4 }])
  assert.deepEqual(nextPoints(a, { x: 10, y: 4 }, '90', true), [{ x: 0, y: 4 }, { x: 10, y: 4 }])
  assert.deepEqual(nextPoints(a, { x: 10, y: 4 }, '45', false), [{ x: 6, y: 0 }, { x: 10, y: 4 }])
  assert.deepEqual(nextPoints(a, { x: 10, y: 4 }, '45', true), [{ x: 4, y: 4 }, { x: 10, y: 4 }])
  assert.deepEqual(nextPoints(a, { x: 4, y: -10 }, '45', false), [{ x: 0, y: -6 }, { x: 4, y: -10 }])
  assert.deepEqual(nextPoints(a, { x: 5, y: 5 }, '45', false), [{ x: 5, y: 5 }])
  assert.deepEqual(nextPoints(a, { x: 10, y: 0 }, '90', false), [{ x: 10, y: 0 }])
  assert.deepEqual(nextPoints(a, { x: 7, y: 3 }, 'free', false), [{ x: 7, y: 3 }])
  for (const [dx, dy] of [[10, 3], [-7, 12], [3, -20]]) {
    const pts = [a, ...nextPoints(a, { x: dx, y: dy }, '45', false)]
    for (let i = 0; i + 1 < pts.length; i++) {
      const ang = Math.abs(Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x) * 180 / Math.PI) % 45
      assert.ok(ang < 1e-9 || Math.abs(ang - 45) < 1e-9, 'multiples of 45°')
    }
  }
  const d = board([part('R1', 'R_0805', 10, 10), part('R2', 'R_0805', 20, 10), part('R3', 'R_0805', 15, 14)], { A: ['R1.2', 'R2.1'], B: ['R3.1'], C: ['R3.2'] })
  const s = copperAt(d, { x: 10.95, y: 10.1 }, 0.5, 'F.Cu')!
  assert.equal(s.kind, 'pad')
  assert.equal(s.net, 'A')
  near(s.p.x, 10.9125)
  assert.equal(copperAt(d, { x: 10.95, y: 10.1 }, 0.5, 'B.Cu'), null, 'a surface-mount pad is not on the other layer')
  assert.equal(copperAt(d, { x: 15, y: 20 }, 0.5, 'F.Cu'), null)
  // clear path, then one through the pad of another net
  const clear = routeClash(d, [[{ x: 11, y: 10 }, { x: 19, y: 10 }]], 'F.Cu', 0.25, 'A')
  assert.equal(clear, null)
  const bad = routeClash(d, [[{ x: 11, y: 10 }, { x: 15, y: 10 }], [{ x: 15, y: 10 }, { x: 14.3, y: 12 }], [{ x: 14.3, y: 12 }, { x: 14.3, y: 14 }]], 'F.Cu', 0.25, 'A')
  assert.ok(bad && /R3/.test(bad.what))
  // 0.15 mm from a pad of another net is a clash; on the other layer it is not
  assert.ok(routeClash(d, [[{ x: 13, y: 13.2 }, { x: 18, y: 13.2 }]], 'F.Cu', 0.25, 'A'))
  assert.equal(routeClash(d, [[{ x: 13, y: 13.2 }, { x: 18, y: 13.2 }]], 'B.Cu', 0.25, 'A'), null)
  assert.ok(routeClash(d, [[{ x: 1, y: 10 }, { x: 0.1, y: 10 }]], 'F.Cu', 0.25, 'A'), 'too close to the board edge')
  const rs = { net: 'A', layer: 'F.Cu' as const, width: 0.25, pts: [{ x: 0, y: 0 }], mode: '45' as const, flip: false }
  assert.equal(previewSegments(rs, { x: 10, y: 4 }).length, 2)
  assert.equal(previewSegments(rs, { x: 0, y: 0 }).length, 0)
})

// ------------------------------------------------------------------ the AI tools

test('AI tools: board summary, placing, importing, routing, checking, exporting', async () => {
  let d = newDesign('ai')
  const written = new Map<string, string | Uint8Array>()
  const h: Hooks = {
    get: () => d,
    fills: () => fillZones(d),
    commit: (x) => { d = x },
    load: async (id) => { d = routedExample(id); return { title: id } },
    importNetlist: (input, mode) => {
      const r = applyNetlist(d, parseNetlist(input), mode)
      d = arrangeParts(r.design, { refs: r.report.added })
      return r.report
    },
    drc: () => runDrc(d, fillZones(d)),
    route: (nets) => { const r = autoroute(d, nets ? { nets } : {}); d = r.design; return r },
    write: async (p, data) => { written.set(p, data) },
    png: async () => new Uint8Array([137, 80, 78, 71]),
  }
  const tools = kpcbTools(h) as Record<string, (a: Record<string, unknown>, ctx: AppToolContext) => Promise<any>>
  const ctx = (ok: boolean): AppToolContext => ({ caller: 'test', windowId: 'w', confirm: async () => ok, allowPython: async () => true })
  const call = (name: string, a: Record<string, unknown> = {}, ok = true) => tools[name](a, ctx(ok))
  // the manifest and the code agree
  assert.deepEqual(Object.keys(tools).sort(), KPCB_TOOL_SET.tools.map((t) => t.action).sort())
  assert.ok(KPCB_TOOL_SET.tools.length <= 8)

  assert.deepEqual((await call('set_outline', {})).presets.map((p: { id: string }) => p.id), ['uno', 'nano', '50x50', 'rpi-hat'])
  assert.equal((await call('set_outline', { width: 40, height: 30, corner_radius: 2 })).w, 40)
  assert.equal((await call('set_outline', { preset: 'uno' })).w, 68.58)
  await assert.rejects(call('set_outline', { preset: 'zz' }), /No preset/)

  const p1 = await call('place', { footprint: 'DIP-8', x: 20, y: 20 })
  assert.equal(p1.ref, 'U1')
  const p2 = await call('place', { footprint: 'R_0805', x: 40, y: 30, rotation: 90, side: 'bottom' })
  assert.equal(p2.ref, 'R1')
  assert.equal(p2.side, 'B')
  assert.equal(p2.rotation, 90)
  const moved = await call('place', { ref: 'R1', x: 41, y: 31 })
  assert.equal(moved.moved, true)
  assert.equal(d.parts.find((p) => p.ref === 'R1')!.x, 41)
  await assert.rejects(call('place', { footprint: 'DIP-9' }), /No footprint/)
  await assert.rejects(call('place', { ref: 'X9' }), /footprint/)

  // a kElec netlist replaces the parts
  const imp = await call('import_netlist', { netlist: KELEC, mode: 'replace' })
  assert.equal(imp.parts, 12)
  assert.deepEqual(imp.warnings, [])
  assert.equal(d.nets.length, 3)
  await assert.rejects(call('import_netlist', {}), /netlist is needed/)

  const ex = await call('load_example', { id: '555-blinker' })
  assert.equal(ex.loaded, '555-blinker')
  assert.equal(ex.unconnected_connections, 0)
  assert.equal((await call('load_example', {})).examples.length, EXAMPLES.length)
  assert.equal(EXAMPLES.length, 8, 'the 3 original boards and 5 new ones')
  await assert.rejects(call('load_example', { id: 'zz' }), /No example/)
  const board1 = await call('get_board')
  assert.equal(board1.parts.length, 8)
  assert.equal(board1.drc.errors, 0)
  assert.ok(board1.nets.some((n: { name: string }) => n.name === 'GND'))

  // rip up and route again
  d = unroute(d, true)
  assert.ok((await call('get_board')).unconnected_connections > 0)
  const routed = await call('route', { net: 'OUT', mode: 'auto' })
  assert.equal(routed.routed_percent, 100)
  const rest = await call('route', { net: 'all' })
  assert.equal(rest.connections_left, 0)
  await assert.rejects(call('route', { net: 'NOPE', mode: 'auto' }), /No net/)
  const drc = await call('run_drc')
  assert.equal(drc.errors, 0)
  assert.equal(drc.clean, true)

  // a manual track with a via
  d = unroute(d, true)
  const man = await call('route', { net: 'OUT', mode: 'manual-points', layer: 'F.Cu', points: [{ x: 10, y: 10 }, { x: 15, y: 10 }, { x: 15, y: 15, via: true }, { x: 20, y: 15 }] })
  assert.equal(man.vias_added, 1)
  assert.equal(man.tracks_added, 3)
  assert.equal(man.ending_layer, 'B.Cu')
  assert.equal(d.tracks[d.tracks.length - 1].layer, 'B.Cu')
  await assert.rejects(call('route', { net: 'OUT', mode: 'manual-points', points: [{ x: 1, y: 1 }] }), /at least two/)
  const zone = await call('route', { net: 'GND', mode: 'zone', layer: 'F.Cu' })
  assert.equal(zone.zone.layer, 'F.Cu')
  assert.equal(d.zones.length, 2)

  // exports ask first and write where told
  await assert.rejects(call('export', { what: 'gerber', path: '/tmp/x' }, false), /did not allow/)
  assert.equal(written.size, 0)
  assert.equal((await call('export', { what: 'gerber', path: '/home/user/out' })).written, '/home/user/out/555-blinker-gerbers.zip')
  await call('export', { what: 'svg', path: '/home/user/out/board.svg', side: 'bottom', scheme: 'bw' })
  await call('export', { what: 'png', path: '/home/user/out' })
  await call('export', { what: 'bom', path: '/home/user/out/parts.md' })
  await call('export', { what: 'pnp', path: '/home/user/out' })
  assert.deepEqual([...written.keys()].sort(), [
    '/home/user/out/555-blinker-gerbers.zip', '/home/user/out/555-blinker-pnp.csv', '/home/user/out/555-blinker-top.png', '/home/user/out/board.svg', '/home/user/out/parts.md',
  ])
  assert.match(String(written.get('/home/user/out/board.svg')), /\(bottom\)/)
  assert.match(String(written.get('/home/user/out/parts.md')), /Bill of materials/)
  assert.ok(written.get('/home/user/out/555-blinker-gerbers.zip') instanceof Uint8Array)
  await assert.rejects(call('export', { what: 'dxf', path: '/x' }), /what is/)
})

// ------------------------------------------------------------------ drawing and exports with odd shapes

/** A 2D context that accepts everything and counts calls. */
function fakeContext() {
  const calls: Record<string, number> = {}
  const state: Record<string, unknown> = {}
  const ctx = new Proxy({}, {
    get(_t, prop: string) {
      if (prop in state) return state[prop]
      if (prop === 'measureText') return () => ({ width: 40 })
      return (...a: unknown[]) => { calls[prop] = (calls[prop] ?? 0) + 1; void a }
    },
    set(_t, prop: string, v) { state[prop] = v; return true },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

test('the board drawing runs over every example in every mode', () => {
  for (const e of EXAMPLES) {
    const d = routedExample(e.id)
    const fills = fillZones(d)
    const an = analyze(d, fills)
    const sel = new Set([`part:${d.parts[0].id}`, `track:${d.tracks[0].id}`, `via:${d.vias[0]?.id}`, 'outline:outline'])
    for (const flip of [false, true]) {
      for (const dim of [false, true]) {
        const { ctx, calls } = fakeContext()
        drawScene(ctx, 900, 600, 2, { cx: 20, cy: 15, scale: flip ? 60 : 12, flip }, {
          design: d, fills, sel, hoverNet: 'GND', ratsnest: ratsnest(d, an), markers: [{ id: 'v1', severity: 'error', rule: 'x', message: 'm', x: 10, y: 10 }],
          active: 'B.Cu', grid: 0.5, unit: 'mil',
        }, { ...DEFAULT_APPEARANCE, dim, visible: { ...DEFAULT_APPEARANCE.visible, Courtyard: true, 'F.Mask': true, 'F.Paste': true } }, {
          cursor: { x: 5, y: 5 }, ghost: { id: 'g', ref: '', value: '', fp: 'DIP-8', x: 5, y: 5, rot: 90, side: 'B' },
          route: { segs: [[{ x: 1, y: 1 }, { x: 5, y: 5 }]], layer: 'F.Cu', width: 0.25, bad: true, from: { x: 1, y: 1 } },
          draft: { pts: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], color: '#fff' }, measure: { a: { x: 0, y: 0 }, b: { x: 3, y: 4 } },
          box: { x0: 0, y0: 0, x1: 4, y1: 4 }, handles: d.outline.pts, selectedMarker: 'v1',
        })
        assert.ok((calls.fill ?? 0) > 3 && (calls.stroke ?? 0) > 3, `${e.id}: something was drawn`)
      }
    }
  }
  assert.equal(gridStep(0.5, 2), 5, 'a coarser grid when zoomed out')
  assert.equal(gridStep(0.5, 100), 0.5)
})

test('rotated and rounded pads become macros in the Gerber output, and all layer artwork is consistent', () => {
  const d = routedExample('esp32-breakout')
  const rotated: Design = { ...d, parts: d.parts.map((p) => (p.ref === 'U1' ? { ...p, rot: 30 } : p)) }
  const top = exportGerbers(rotated, fillZones(rotated)).find((f) => f.name.endsWith('-F_Cu.gbr'))!.text
  assert.match(top, /%AMRRECT\*/)
  assert.match(top, /%ADD\d+RRECT,/)
  assert.match(top, /%ADD\d+ROTRECT,/)
  assert.match(top, /ROTRECT,[\d.]+X[\d.]+X30\*%/, 'the part turned 30° counter-clockwise: the pad macros carry 30')
  // every layer has prims for the right side only
  for (const l of ['F.Silk', 'B.Silk'] as const) {
    const sides = new Set(d.parts.filter((p) => layerPrims(d, l).length).map((p) => p.side))
    assert.ok(sides.size <= 2)
  }
  const bottomPart: Design = { ...d, parts: d.parts.map((p) => (p.ref === 'C2' ? { ...p, side: 'B' as const } : p)) }
  assert.ok(layerPrims(bottomPart, 'B.Silk').length > 0, 'a part on the bottom has bottom silk')
  assert.equal(layerPrims(bottomPart, 'B.Paste').length, 2, 'and bottom paste for its two pads')
  assert.equal(layerPrims(d, 'B.Paste').length, 0)
  assert.equal(viewItems(d, undefined, 'B', 'bw').length, 6)
})

// ------------------------------------------------------------------ 3D

test('the 3D model is built from the board: slab, textures, tracks, vias and bodies', async () => {
  // a canvas that records nothing: the textures only need to exist
  const { ctx } = fakeContext()
  const g = globalThis as unknown as { document?: unknown }
  const before = g.document
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
  try {
    const { buildModel } = await import('../../src/apps/kpcb/scene3d.ts')
    for (const e of EXAMPLES) {
      const d = routedExample(e.id)
      const { group, centre, radius } = buildModel(d, fillZones(d))
      let meshes = 0
      let instanced = 0
      group.traverse((n: { isMesh?: boolean; isInstancedMesh?: boolean }) => {
        if (n.isInstancedMesh) instanced++
        else if (n.isMesh) meshes++
      })
      assert.ok(meshes >= 3 + d.parts.length, `${e.id}: slab, two faces and a body per part (${meshes})`)
      assert.ok(instanced >= 1, 'tracks are instanced boxes')
      near(centre.x, (d.outline.rect!.x + d.outline.rect!.w / 2), 1e-6)
      near(centre.z, (d.outline.rect!.y + d.outline.rect!.h / 2), 1e-6)
      assert.ok(radius >= 30)
      // the slab is 1.6 mm thick hanging below y = 0
      const slab = group.children[0] as unknown as { geometry: { boundingBox: { min: { y: number }; max: { y: number } } | null; computeBoundingBox(): void } }
      slab.geometry.computeBoundingBox()
      near(slab.geometry.boundingBox!.max.y, 0, 1e-6)
      near(slab.geometry.boundingBox!.min.y, -1.6, 1e-6)
    }
  } finally {
    g.document = before
  }
})

test('a board size is suggested from the parts', () => {
  const imp = parseNetlist(KELEC)
  const d = applyNetlist(newDesign('amp'), imp, 'replace').design
  const s = suggestBoardSize(d)
  assert.ok(s.w % 5 === 0 && s.h % 5 === 0 && s.w >= 30 && s.h >= 20)
  const placed = arrangeParts({ ...d, outline: rectOutline(0, 0, s.w, s.h, 0) })
  const v = runDrc(placed).filter((x) => x.rule === 'courtyard' || x.rule === 'edge')
  assert.deepEqual(v.map((x) => x.message), [], 'all the parts fit in the suggested board')
  assert.deepEqual(suggestBoardSize(newDesign('empty')), { w: 30, h: 20 })
})
