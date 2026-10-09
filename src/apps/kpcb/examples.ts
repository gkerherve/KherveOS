// Example boards (pure data, built by a few lines each). They are loaded unrouted-plus-routed:
// `buildExample` gives the placed parts, nets, outline and zones; `routedExample` also runs the
// auto-router so the board opens finished and DRC-clean.

import { guessClass, newDesign, rectOutline, uid } from './board.ts'
import { autoroute } from './autoroute.ts'
import { fillZones } from './zones.ts'
import { analyze, ratsnest } from './analysis.ts'
import { arrangeParts } from './arrange.ts'
import type { Design, Net, Part } from './types.ts'

export interface ExampleInfo {
  id: string
  title: string
  description: string
  build: () => Design
}

/** x and y may be null: the part is then put in place by "Place all parts" (the arranger) once the nets are known. */
type PartSpec = [ref: string, value: string, fp: string, x: number | null, y: number | null, rot?: number, side?: 'F' | 'B', extra?: { refAt?: [number, number]; hideRef?: boolean }]

interface Spec {
  name: string
  w: number
  h: number
  r?: number
  holes?: Array<[number, number, number]>
  parts: PartSpec[]
  /** net name → "REF.PAD" pins */
  nets: Record<string, string[]>
  zones?: Array<{ net: string; layer: 'F.Cu' | 'B.Cu'; inset?: number; thermal?: boolean }>
}

function build(s: Spec): Design {
  let d = newDesign(s.name)
  d = { ...d, outline: rectOutline(0, 0, s.w, s.h, s.r ?? 0), holes: (s.holes ?? []).map(([x, y, dia]) => ({ id: uid('h'), x, y, d: dia })) }
  const parts: Part[] = s.parts.map(([ref, value, fp, x, y, rot = 0, side = 'F', extra]) => ({
    id: uid('p'), ref, value, fp, x: x ?? 0, y: y ?? 0, rot, side, ...(extra?.hideRef ? { hideRef: true } : {}), ...(extra?.refAt ? { refAt: { x: extra.refAt[0], y: extra.refAt[1] } } : {}),
  }))
  const nets: Net[] = Object.entries(s.nets).map(([name, pins]) => ({
    name, cls: guessClass(name), pins: pins.map((p) => {
      const i = p.indexOf('.')
      return { ref: p.slice(0, i), pin: p.slice(i + 1) }
    }),
  }))
  d = { ...d, parts, nets }
  const free = s.parts.filter((p) => p[3] === null || p[4] === null).map((p) => p[0])
  if (free.length) d = arrangeParts(d, { refs: free })
  for (const z of s.zones ?? []) {
    const k = z.inset ?? 0.5
    d = {
      ...d,
      zones: [...d.zones, {
        id: uid('z'), net: z.net, layer: z.layer, clearance: d.rules.clearance, ...(z.thermal ? { thermal: true } : {}),
        pts: [{ x: k, y: k }, { x: s.w - k, y: k }, { x: s.w - k, y: s.h - k }, { x: k, y: s.h - k }],
      }],
    }
  }
  return d
}

// ------------------------------------------------------------ 555 blinker

const BLINKER: Spec = {
  name: '555-blinker',
  w: 46,
  h: 30,
  r: 2,
  holes: [[3.5, 3.5, 3.2], [42.5, 3.5, 3.2], [3.5, 26.5, 3.2], [42.5, 26.5, 3.2]],
  parts: [
    ['J1', 'Battery', 'PinHeader_1x02', 10, 11],
    ['U1', 'NE555', 'DIP-8', 18, 8],
    ['R1', '1k', 'R_0805', 31.5, 8.5],
    ['R2', '47k', 'R_0805', 31.5, 14],
    ['C1', '10u', 'CP_Radial_D6.3mm_P2.50mm', 32, 22],
    ['C2', '10n', 'C_0805', 22.5, 21],
    ['R3', '470', 'R_0805', 12, 19],
    ['D1', 'LED', 'LED_5mm', 6, 24],
  ],
  nets: {
    VCC: ['J1.1', 'U1.8', 'U1.4', 'R1.1'],
    GND: ['J1.2', 'U1.1', 'C1.2', 'C2.2', 'D1.2'],
    DIS: ['R1.2', 'R2.1', 'U1.7'],
    TRIG: ['R2.2', 'U1.6', 'U1.2', 'C1.1'],
    CTRL: ['U1.5', 'C2.1'],
    OUT: ['U1.3', 'R3.1'],
    LED: ['R3.2', 'D1.1'],
  },
  zones: [{ net: 'GND', layer: 'B.Cu', inset: 0.6 }],
}

// ------------------------------------------------------------ Arduino Uno shield

const SHIELD: Spec = {
  name: 'uno-shield',
  w: 68.58,
  h: 53.34,
  r: 1,
  holes: [[13.97, 50.8, 3.2], [15.24, 2.54, 3.2], [66.04, 45.72, 3.2], [66.04, 17.78, 3.2]],
  parts: [
    ['J1', 'Power', 'PinHeader_1x08', 27.94, 50.8, 90, 'F', { refAt: [2.6, 8.89] }],
    ['J2', 'Digital 8-13', 'PinHeader_1x10', 21.336, 2.54, 90, 'F', { refAt: [-2.6, 11.43] }],
    ['J3', 'Digital 0-7', 'PinHeader_1x08', 48.26, 2.54, 90, 'F', { refAt: [-2.6, 8.89] }],
    ['R1', '220', 'R_0805', 34, 10],
    ['D1', 'LED', 'LED_5mm', 38, 18],
    ['SW1', 'Button', 'SW_Push_6mm', 50, 24],
  ],
  nets: {
    D13: ['J2.5', 'R1.1'],
    LED: ['R1.2', 'D1.1'],
    D2: ['J3.6', 'SW1.2'],
    GND: ['J1.6', 'J1.7', 'J2.4', 'D1.2', 'SW1.1'],
    '5V': ['J1.5'],
  },
  zones: [{ net: 'GND', layer: 'B.Cu', inset: 0.6 }],
}

// ------------------------------------------------------------ ESP32 breakout

const ESP32: Spec = {
  name: 'esp32-breakout',
  w: 40,
  h: 48,
  r: 2,
  holes: [],
  parts: [
    ['U1', 'ESP32-WROOM-32', 'ESP32-WROOM-32', 20, 20],
    ['C1', '10u', 'C_0805', 13, 40],
    ['C2', '100n', 'C_0805', 20, 40],
    ['R1', '10k', 'R_0805', 27, 40],
    ['J1', 'Power', 'PinHeader_1x02', 6, 40],
    ['J2', 'GPIO', 'PinHeader_1x08', 3, 12],
    ['J3', 'GPIO', 'PinHeader_1x08', 37, 12],
  ],
  nets: {
    '3V3': ['U1.2', 'C1.1', 'C2.1', 'R1.1', 'J1.1'],
    GND: ['U1.1', 'U1.15', 'U1.38', 'U1.39', 'C1.2', 'C2.2', 'J1.2'],
    EN: ['U1.3', 'R1.2'],
    IO34: ['U1.6', 'J2.1'],
    IO35: ['U1.7', 'J2.2'],
    IO32: ['U1.8', 'J2.3'],
    IO33: ['U1.9', 'J2.4'],
    IO25: ['U1.10', 'J2.5'],
    IO26: ['U1.11', 'J2.6'],
    IO27: ['U1.12', 'J2.7'],
    IO14: ['U1.13', 'J2.8'],
    IO23: ['U1.37', 'J3.1'],
    IO22: ['U1.36', 'J3.2'],
    IO21: ['U1.33', 'J3.3'],
    IO19: ['U1.31', 'J3.4'],
    IO18: ['U1.30', 'J3.5'],
    IO5: ['U1.29', 'J3.6'],
    IO17: ['U1.28', 'J3.7'],
    IO16: ['U1.27', 'J3.8'],
  },
  zones: [{ net: 'GND', layer: 'B.Cu', inset: 0.6 }],
}

// ------------------------------------------------------------ 5 V power supply (LM7805)

const SUPPLY: Spec = {
  name: '5v-supply',
  w: 58,
  h: 25,
  r: 2,
  holes: [[3.5, 21.5, 3.2], [54.5, 21.5, 3.2]],
  parts: [
    ['J1', 'VIN 7-12V', 'TerminalBlock_2x5.08', 6, 10, 270],
    ['J2', '5V OUT', 'TerminalBlock_2x5.08', 52, 10, 270],
    ['D1', '1N4007', 'D_DO-41', null, null],
    ['U1', 'LM7805', 'TO-220_Vertical', null, null],
    ['C1', '470u', 'CP_Radial_D8.0mm_P3.50mm', null, null],
    ['C2', '100u', 'CP_Radial_D5.0mm_P2.00mm', null, null],
    ['R1', '1k', 'R_0805', null, null],
    ['D2', 'Power LED', 'LED_3mm', null, null],
  ],
  nets: {
    VIN: ['J1.1', 'D1.1'],
    VRAW: ['D1.2', 'U1.1', 'C1.1'],
    GND: ['J1.2', 'U1.2', 'C1.2', 'C2.2', 'D2.2', 'J2.2'],
    '5V': ['U1.3', 'C2.1', 'R1.1', 'J2.1'],
    LED: ['R1.2', 'D2.1'],
  },
  zones: [{ net: 'GND', layer: 'B.Cu', inset: 0.6 }],
}

// ------------------------------------------------------------ ATtiny85 breakout

const ATTINY: Spec = {
  name: 'attiny85-breakout',
  w: 42,
  h: 25,
  r: 2,
  holes: [],
  parts: [
    ['U1', 'ATtiny85', 'DIP-8', null, null],
    ['C1', '100n', 'C_0805', null, null],
    ['R1', '10k', 'R_0805', null, null],
    ['R2', '330', 'R_0805', null, null],
    ['D1', 'LED', 'LED_3mm', null, null],
    ['J1', 'Power', 'PinHeader_1x02', 4, 5],
    ['J2', 'GPIO', 'PinHeader_1x06', 14, 20.5, 90],
  ],
  nets: {
    VCC: ['J1.1', 'U1.8', 'C1.1', 'R1.1'],
    GND: ['J1.2', 'U1.4', 'C1.2', 'D1.2'],
    RESET: ['U1.1', 'R1.2', 'J2.1'],
    PB3: ['U1.2', 'J2.2'],
    PB4: ['U1.3', 'J2.3'],
    PB0: ['U1.5', 'J2.4'],
    PB1: ['U1.6', 'R2.1', 'J2.5'],
    PB2: ['U1.7', 'J2.6'],
    LED: ['R2.2', 'D1.1'],
  },
  zones: [{ net: 'GND', layer: 'B.Cu', inset: 0.6 }],
}

// ------------------------------------------------------------ LED bar graph

const BAR_SIGNALS = ['D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11']
const BARGRAPH: Spec = {
  name: 'led-bargraph',
  w: 72,
  h: 28,
  r: 2,
  holes: [[3.5, 24.5, 3.2], [68.5, 24.5, 3.2]],
  parts: [
    ['J1', 'Arduino D2-D11', 'PinHeader_1x10', 22, 24, 90, 'F', { refAt: [-2.6, 11.43] }],
    ['J2', 'GND', 'PinHeader_1x02', 54, 24, 90, 'F', { refAt: [-2.6, 1.27] }],
    ...BAR_SIGNALS.map((_, i): PartSpec => [`R${i + 1}`, '220', 'R_0805', 11 + i * 5.5, 6, 90, 'F', { hideRef: true }]),
    ...BAR_SIGNALS.map((_, i): PartSpec => [`D${i + 1}`, i < 6 ? 'green' : i < 9 ? 'yellow' : 'red', 'LED_3mm', 10.2 + i * 5.5, 14, 90, 'F', { refAt: [-2.6, 0] }]),
  ],
  nets: {
    GND: ['J2.1', 'J2.2', ...BAR_SIGNALS.map((_, i) => `D${i + 1}.2`)],
    ...Object.fromEntries(BAR_SIGNALS.map((s, i) => [s, [`J1.${i + 1}`, `R${i + 1}.1`]])),
    ...Object.fromEntries(BAR_SIGNALS.map((_, i) => [`LED${i + 1}`, [`R${i + 1}.2`, `D${i + 1}.1`]])),
  },
  zones: [{ net: 'GND', layer: 'B.Cu', inset: 0.6 }],
}

// ------------------------------------------------------------ USB-to-UART header breakout

const UART: Spec = {
  name: 'uart-breakout',
  w: 34,
  h: 22,
  r: 2,
  holes: [],
  parts: [
    ['FTDI', 'GND CTS VCC TXD RXD DTR', 'PinHeader_1x06', 4, 4.5, 0, 'F', { refAt: [3.4, 0] }],
    ['UART', 'VCC GND TX RX', 'PinHeader_1x04', 30, 4.5, 0, 'F', { refAt: [-3.4, 0] }],
    ['C1', '100n', 'C_0805', null, null],
  ],
  nets: {
    VCC: ['FTDI.3', 'UART.1', 'C1.1'],
    GND: ['FTDI.1', 'UART.2', 'C1.2'],
    TX: ['FTDI.4', 'UART.4'],
    RX: ['FTDI.5', 'UART.3'],
    DTR: ['FTDI.6'],
    CTS: ['FTDI.2'],
  },
  zones: [{ net: 'GND', layer: 'B.Cu', inset: 0.6 }],
}

// ------------------------------------------------------------ LM358 non-inverting amplifier

const OPAMP: Spec = {
  name: 'lm358-amplifier',
  w: 44,
  h: 20,
  r: 2,
  holes: [],
  parts: [
    ['U1', 'LM358', 'DIP-8', null, null],
    ['R1', '10k', 'R_0805', null, null],
    ['R2', '1k', 'R_0805', null, null],
    ['C1', '100n', 'C_0805', null, null],
    ['J1', 'IN', 'PinHeader_1x02', 3.5, 4],
    ['J2', 'OUT', 'PinHeader_1x02', 40.5, 4],
    ['J3', 'V+ GND', 'PinHeader_1x02', 3.5, 11.5],
  ],
  nets: {
    VCC: ['J3.1', 'U1.8', 'C1.1'],
    GND: ['J3.2', 'U1.4', 'U1.5', 'R2.2', 'C1.2', 'J1.2', 'J2.2'],
    IN: ['J1.1', 'U1.3'],
    FB: ['U1.2', 'R1.2', 'R2.1'],
    OUT: ['U1.1', 'R1.1', 'J2.1'],
    OUT2: ['U1.6', 'U1.7'],
  },
  zones: [{ net: 'GND', layer: 'B.Cu', inset: 0.6 }, { net: 'GND', layer: 'F.Cu', inset: 0.6 }],
}

export const EXAMPLES: readonly ExampleInfo[] = [
  { id: '555-blinker', title: 'LED blinker with a 555', description: 'An astable NE555 flashing an LED, with a ground plane on the back. Through-hole parts, 46 x 30 mm.', build: () => build(BLINKER) },
  { id: 'uno-shield', title: 'Arduino Uno shield', description: 'A shield for the Uno (68.6 x 53.3 mm, four mounting holes): an LED on D13 with its resistor and a button on D2.', build: () => build(SHIELD) },
  { id: 'esp32-breakout', title: 'ESP32 breakout', description: 'An ESP32-WROOM-32 module with decoupling, an enable pull-up and sixteen GPIOs on two headers.', build: () => build(ESP32) },
  { id: '5v-supply', title: '5 V power supply (LM7805)', description: 'A linear 5 V supply: LM7805 in a TO-220, a reverse-polarity diode, an input and an output electrolytic, a power LED with its resistor and screw terminals, 58 x 34 mm with a ground plane.', build: () => build(SUPPLY) },
  { id: 'attiny85-breakout', title: 'ATtiny85 breakout', description: 'An ATtiny85 in a DIP-8 socket with a decoupling capacitor, a reset pull-up, an LED on PB1 and every pin on a header, 42 x 30 mm.', build: () => build(ATTINY) },
  { id: 'led-bargraph', title: 'LED bar graph (10 LEDs)', description: 'Ten LEDs in a row, each with its 220 ohm resistor, driven from one 1x10 header (Arduino pins D2 to D11) on a two-layer board with a ground plane, 72 x 34 mm.', build: () => build(BARGRAPH) },
  { id: 'uart-breakout', title: 'USB-to-UART header breakout', description: 'Moves the six-pin FTDI cable header (GND CTS VCC TXD RXD DTR) to a four-pin UART header with TX and RX crossed over and a 100 nF bypass capacitor. The reference names on the silkscreen label the headers.', build: () => build(UART) },
  { id: 'lm358-amplifier', title: 'LM358 non-inverting amplifier', description: 'One half of an LM358 (DIP-8) as a gain-of-11 amplifier: 10 k and 1 k set the gain, the second op-amp is parked as a follower, with input, output and supply headers and ground planes on both sides, 44 x 32 mm.', build: () => build(OPAMP) },
]

export const exampleInfo = (id: string): ExampleInfo | undefined => EXAMPLES.find((e) => e.id === id)

/** An example with its zones filled and everything routed. */
export function routedExample(id: string): Design {
  const info = exampleInfo(id)
  if (!info) throw new Error(`No example "${id}".`)
  const d = info.build()
  return autoroute(d).design
}

/** How many connections an example still lacks (0 once routed). */
export function missingConnections(d: Design): number {
  return ratsnest(d, analyze(d, fillZones(d))).length
}

