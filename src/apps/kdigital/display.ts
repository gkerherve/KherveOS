// What a part looks like while the circuit runs (LEDs lit, segments on, digits, switch positions) as extra
// drawing primitives, shared by the canvas and the SVG export; wire colours by value. Pure.

import { HEX_SEGMENTS, SEGMENT_NAMES, defOf, segmentPath, shapeOf, signalName, type Part, type Prim } from './model.ts'
import { numberOf, vchar, vparse, type V } from './logic.ts'
import { busText } from './wave.ts'
import type { Simulator } from './sim.ts'

/** The class a value gives to a wire or pin. */
export const valueClass = (v: V): string => (v === 1 ? 'v1' : v === 0 ? 'v0' : v === 2 ? 'vx' : 'vz')

/** Prims drawn over the static symbol. `sim` null = the circuit is not running: inputs show their initial value. */
export function livePrims(part: Part, sim: Simulator | null): Prim[] {
  const out: Prim[] = []
  const pin = (name: string): V => (sim ? sim.pinValue(part.ref, name) : 2)
  switch (part.kind) {
    case 'led': {
      const v = sim ? pin('A') : (2 as V)
      if (!sim) return out
      const color = part.props.color || 'red'
      out.push({ t: 'circle', cx: 0, cy: 0, r: 10, fill: true, cls: v === 1 ? `led-on led-${color}` : v === 0 ? 'led-off' : v === 2 ? 'led-x' : 'led-z' })
      break
    }
    case 'seg7': {
      const low = part.props.active === 'low'
      for (const s of SEGMENT_NAMES) {
        const v = sim ? pin(s) : (0 as V)
        const lit = low ? v === 0 : v === 1
        const unknown = v === 2 && sim !== null
        out.push({ t: 'path', d: segmentPath(s), cls: lit ? 'seg-on' : unknown ? 'seg-x' : 'seg-off2', width: 6 })
      }
      break
    }
    case 'hex': {
      if (!sim) { out.push({ t: 'text', x: 10, y: 20, s: '–', size: 58, anchor: 'middle', cls: 'digit-off' }); break }
      const bits = ['D3', 'D2', 'D1', 'D0'].map(pin)
      const n = numberOf([...bits].reverse())
      out.push({ t: 'text', x: 10, y: 20, s: n === null ? (bits.every((b) => b === 3) ? '–' : '?') : n.toString(16).toUpperCase(), size: 58, anchor: 'middle', cls: n === null ? 'digit-x' : 'digit-on' })
      break
    }
    case 'probe': {
      const n = shapeOf(part).pins.length
      const bits = shapeOf(part).pins.map((p) => pin(p.name))
      const radix = part.props.radix === 'decimal' ? 'decimal' : part.props.radix === 'binary' ? 'binary' : 'hex'
      let s: string
      if (!sim) s = '?'
      else if (part.props.radix === 'signed') {
        const v = numberOf([...bits].reverse())
        s = v === null ? busText(bits, 'binary') : String(v >= 2 ** (n - 1) ? v - 2 ** n : v)
      } else s = busText(bits, radix)
      out.push({ t: 'text', x: 5, y: 4, s, size: n > 8 ? 11 : 14, anchor: 'middle', cls: 'probe-text', bold: true })
      break
    }
    case 'switch': {
      const on = switchLevel(part, sim) === 1
      const x = on ? 9 : -9
      out.push({ t: 'circle', cx: x, cy: 0, r: 8, fill: true, cls: on ? 'knob-on' : 'knob-off' })
      break
    }
    case 'button': {
      const lvl = switchLevel(part, sim)
      const rest = vparse(part.props.value ?? '0')
      if (lvl !== rest) out.push({ t: 'circle', cx: 0, cy: 0, r: 5, fill: true, cls: 'knob-on' })
      break
    }
    case 'clock': {
      if (sim) {
        const v = sim.comps.find((c) => c.part.ref === part.ref)?.drv[0]
        if (v === 1) out.push({ t: 'circle', cx: 14, cy: -8, r: 3, fill: true, cls: 'led-on led-green' })
      }
      break
    }
    case 'counter': case 'register': case 'shift': case 'dff': case 'jkff': case 'tff': case 'dlatch': {
      if (!sim) break
      const q = sim.stored(part.ref)
      if (q === undefined) break
      const [, y1, , y2] = shapeOf(part).box
      if (y2 - y1 < 90 && part.kind !== 'dff') break
      const bitsN = part.kind === 'counter' || part.kind === 'register' || part.kind === 'shift' ? Math.max(1, Math.min(8, Number(part.props.bits) || 4)) : 1
      const text = q === null ? 'X' : bitsN === 1 ? String(q) : q.toString(16).toUpperCase()
      if (y2 - y1 >= 90) out.push({ t: 'text', x: 0, y: 28, s: `= ${text}`, size: 12, anchor: 'middle', cls: 'stored-text', bold: true })
      break
    }
    default: break
  }
  return out
}

function switchLevel(part: Part, sim: Simulator | null): V {
  if (sim) {
    const n = signalName(part) || part.ref
    const v = sim.inputValue(n)
    if (v !== null) return v
  }
  return vparse(part.props.value ?? '0')
}

/** Text shown for a net value under the pointer: "1", "0", "X", "Z". */
export const valueText = vchar

/** All the prims of a part: the symbol and the live overlay. */
export function partPrims(part: Part, sim: Simulator | null): Prim[] {
  return [...shapeOf(part).prims, ...livePrims(part, sim)]
}

export { defOf }
void HEX_SEGMENTS
