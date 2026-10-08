// The interchange object kElec sends to kPCB:  { format: 'knetlist', version: 1, name, components, nets }.
// Pin names: R, C, L, switches: '1','2'; diodes, LEDs, Zeners: '1' = anode (A), '2' = cathode (K);
// electrolytic capacitor: '1' = +, '2' = −; BJT: B, C, E; MOSFET: G, D, S; op-amp: IN+, IN-, OUT, V+, V-;
// potentiometer: '1', '2', 'W'; sources: '+', '-'; logic gates: A, B, Y (A, Y for NOT).

import { PART_DEFS, partLabel, type Doc, type Part, type PartKind } from './model.ts'
import { extractNets } from './netlist.ts'

export type KComponentKind =
  | 'resistor' | 'capacitor' | 'electrolytic' | 'inductor' | 'diode' | 'led' | 'zener' | 'npn' | 'pnp' | 'nmos' | 'pmos' | 'opamp'
  | 'connector' | 'ic' | 'switch' | 'potentiometer' | 'source' | 'other'

export interface KComponent {
  ref: string
  kind: KComponentKind
  value: string
  footprint?: string
  pins: string[]
}

export interface KNet { name: string; pins: { ref: string; pin: string }[] }

export interface KNetlist {
  format: 'knetlist'
  version: 1
  name: string
  components: KComponent[]
  nets: KNet[]
}

const KIND: Partial<Record<PartKind, KComponentKind>> = {
  resistor: 'resistor', potentiometer: 'potentiometer', capacitor: 'capacitor', electrolytic: 'electrolytic', inductor: 'inductor', transformer: 'other',
  battery: 'source', vsine: 'source', vpulse: 'source', isource: 'source', diode: 'diode', schottky: 'diode', zener: 'zener', led: 'led',
  npn: 'npn', pnp: 'pnp', nmos: 'nmos', pmos: 'pmos', opamp: 'opamp', opamp1: 'opamp', vcvs: 'other', vccs: 'other', switch: 'switch', switch_timed: 'switch',
  and: 'ic', or: 'ic', not: 'ic', nand: 'ic', nor: 'ic', xor: 'ic', xnor: 'ic',
}

/** Footprints from the list kPCB provides. */
export function footprintFor(p: Part): string | undefined {
  switch (p.kind) {
    case 'resistor': return 'R_0805'
    case 'potentiometer': return 'PinHeader_1x03'
    case 'capacitor': return 'C_0805'
    case 'electrolytic': return 'CP_Radial_THT'
    case 'inductor': return 'L_Axial_THT'
    case 'transformer': return 'PinHeader_1x04'
    case 'diode': return p.value === '1N4007' ? 'D_DO-35' : 'D_SOD-123'
    case 'schottky': case 'zener': return 'D_SOD-123'
    case 'led': return 'LED_0805'
    case 'npn': case 'pnp': return /^2N|^BC/i.test(p.value) ? 'TO-92' : 'SOT-23'
    case 'nmos': case 'pmos': return /^2N7000|^BS/i.test(p.value) ? 'TO-92' : 'SOT-23'
    case 'opamp': case 'opamp1': return 'DIP-8'
    case 'switch': case 'switch_timed': case 'battery': case 'vsine': case 'vpulse': case 'isource': return 'PinHeader_1x02'
    case 'and': case 'or': case 'not': case 'nand': case 'nor': case 'xor': case 'xnor': return 'DIP-8'
    default: return undefined
  }
}

function valueText(p: Part): string {
  const l = partLabel(p).value
  if (l) return l
  return p.value || PART_DEFS[p.kind].name
}

const SKIP: PartKind[] = ['ground', 'voltmeter', 'ammeter']

export function toKNetlist(doc: Doc, name = 'kElec circuit'): KNetlist {
  const ex = extractNets(doc)
  const parts = doc.parts.filter((p) => !SKIP.includes(p.kind) && p.ref.trim())
  const refs = new Set(parts.map((p) => p.ref))
  const components: KComponent[] = parts.map((p) => {
    const pins = p.kind === 'opamp' || p.kind === 'opamp1' ? ['IN+', 'IN-', 'OUT', 'V+', 'V-'] : PART_DEFS[p.kind].pins.map((d) => d.name)
    const c: KComponent = { ref: p.ref, kind: KIND[p.kind] ?? 'other', value: valueText(p), pins }
    const fp = footprintFor(p)
    if (fp) c.footprint = fp
    return c
  })
  const nets: KNet[] = []
  for (const n of ex.nets) {
    const pins = n.pins.filter((q) => refs.has(q.ref))
    if (pins.length === 0) continue
    if (pins.length < 2 && !n.labelled && !n.ground) continue
    nets.push({ name: n.name === '0' ? 'GND' : n.name, pins })
  }
  // two nets can come out with the same name (GND from a label and from the symbol): merge them
  const merged = new Map<string, KNet>()
  for (const n of nets) {
    const have = merged.get(n.name)
    if (have) have.pins.push(...n.pins)
    else merged.set(n.name, { name: n.name, pins: [...n.pins] })
  }
  return { format: 'knetlist', version: 1, name, components, nets: [...merged.values()] }
}
