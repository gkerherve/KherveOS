// Which pins a sketch uses, found by reading the code (pure: no React, no "@/" imports),
// and the pin facts of the Uno / Nano and Mega 2560 for the Wiring panel.
// The detection is heuristic: it follows `#define`s, `const int` pins, pin arrays and
// simple for-loops, and ignores what it cannot resolve.

import type { Family } from './boards.ts'

export type PinRole = 'out' | 'in' | 'pwm' | 'analog' | 'int' | 'bus'

export interface PinUse {
  /** "D13" or "A0". */
  pin: string
  roles: PinRole[]
  /** Lines (1-based) where the pin is used. */
  lines: number[]
}

export interface PinReport {
  pins: PinUse[]
  warnings: string[]
}

export interface PinSpec {
  id: string
  label: string
  tags: string[]
  pwm: boolean
}
export interface PinGroup {
  title: string
  pins: PinSpec[]
}

/** PWM pins (analogWrite). */
export const PWM_PINS: Record<Family, number[]> = {
  uno: [3, 5, 6, 9, 10, 11],
  mega: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 44, 45, 46],
  other: [],
}
/** Pins with an external interrupt (attachInterrupt). */
export const INT_PINS: Record<Family, number[]> = { uno: [2, 3], mega: [2, 3, 18, 19, 20, 21], other: [] }
const DIGITAL: Record<Family, number> = { uno: 14, mega: 54, other: 0 }
const ANALOG: Record<Family, number> = { uno: 6, mega: 16, other: 0 }
/** I2C and SPI pins by family. */
const WIRE: Record<Family, string[]> = { uno: ['A4', 'A5'], mega: ['D20', 'D21'], other: [] }
const SPI_PINS: Record<Family, string[]> = { uno: ['D10', 'D11', 'D12', 'D13'], mega: ['D50', 'D51', 'D52', 'D53'], other: [] }

// ------------------------------------------------------------------ reading code

/** The code with comments and string contents blanked (newlines kept, so line numbers stay). */
export function stripCode(code: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ')
  return code
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank)
    .replace(/"(?:\\.|[^"\\\n])*"/g, (s) => `"${blank(s.slice(1, -1))}"`)
    .replace(/'(?:\\.|[^'\\\n])*'/g, (s) => `'${blank(s.slice(1, -1))}'`)
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length

type Value = string | number

class Scope {
  consts = new Map<string, Value>()
  arrays = new Map<string, Value[]>()
  ranges = new Map<string, Value[]>()

  scalar(raw: string): Value | undefined {
    const s = raw.trim()
    if (/^\d+$/.test(s)) return Number(s)
    if (/^A\d+$/.test(s)) return s
    if (s === 'LED_BUILTIN') return 13
    if (this.consts.has(s)) return this.consts.get(s)
    return undefined
  }

  /** An expression -> the pins it can be (an array index or a loop variable gives several). */
  resolve(raw: string): Value[] {
    const s = raw.trim().replace(/^\(\s*(?:int|byte|uint8_t)\s*\)\s*/, '')
    if (this.ranges.has(s)) return this.ranges.get(s)!
    const one = this.scalar(s)
    if (one !== undefined) return [one]
    const idx = /^(\w+)\s*\[[^\]]*\]$/.exec(s)
    if (idx && this.arrays.has(idx[1])) return this.arrays.get(idx[1])!
    return []
  }
}

const INT_TYPE = '(?:int|byte|uint8_t|short|long|unsigned\\s+int|unsigned\\s+char|unsigned\\s+long|const\\s+int)'

function readScope(text: string): Scope {
  const sc = new Scope()
  for (const m of text.matchAll(/^[ \t]*#define\s+(\w+)\s+(A\d+|\d+|LED_BUILTIN)\b/gm)) {
    const v = sc.scalar(m[2])
    if (v !== undefined) sc.consts.set(m[1], v)
  }
  const decl = new RegExp(`\\b(?:static\\s+)?(?:const(?:expr)?\\s+)?${INT_TYPE}\\s+(\\w+)\\s*=\\s*(A\\d+|\\d+|LED_BUILTIN|\\w+)\\s*[;,]`, 'g')
  for (const m of text.matchAll(decl)) {
    const v = sc.scalar(m[2])
    if (v !== undefined) sc.consts.set(m[1], v)
  }
  const arr = new RegExp(`\\b(?:static\\s+)?(?:const(?:expr)?\\s+)?${INT_TYPE}\\s+(\\w+)\\s*\\[[^\\]]*\\]\\s*=\\s*\\{([^}]*)\\}`, 'g')
  for (const m of text.matchAll(arr)) {
    const items = m[2].split(',').map((x) => sc.scalar(x)).filter((x): x is Value => x !== undefined)
    if (items.length) sc.arrays.set(m[1], items)
  }
  const loop = /for\s*\(\s*(?:(?:int|byte|uint8_t|unsigned\s+int)\s+)?(\w+)\s*=\s*(\w+)\s*;\s*\1\s*(<=|<)\s*(\w+)\s*;/g
  for (const m of text.matchAll(loop)) {
    const a = sc.scalar(m[2])
    const b = sc.scalar(m[4])
    if (typeof a === 'number' && typeof b === 'number') {
      const end = m[3] === '<' ? b - 1 : b
      if (end >= a && end - a <= 70) sc.ranges.set(m[1], Array.from({ length: end - a + 1 }, (_, i) => a + i))
    }
  }
  return sc
}

/** The pin id ("D7", "A0") for a value on a family, or null when the board has no such pin. */
export function pinId(v: Value, family: Family, analog = false): string | null {
  if (typeof v === 'string') {
    const n = Number(v.slice(1))
    return n < ANALOG[family] || family === 'other' ? v : null
  }
  if (analog && v < ANALOG[family]) return `A${v}`
  if (family === 'other') return `D${v}`
  if (v >= DIGITAL[family]) {
    const a = v - DIGITAL[family]
    return a < ANALOG[family] ? `A${a}` : null
  }
  return `D${v}`
}

const ORDER = (id: string) => (id[0] === 'D' ? 0 : 1000) + Number(id.slice(1))

interface Call {
  re: RegExp
  /** Group of the pin expression. */
  arg: number
  role: PinRole | ((m: RegExpExecArray) => PinRole)
  analog?: boolean
}

const MODE_ROLE = (m: RegExpExecArray): PinRole => (m[2] === 'OUTPUT' ? 'out' : 'in')

const CALLS: Call[] = [
  { re: /\bpinMode\s*\(\s*([^,()]+(?:\[[^\]]*\])?)\s*,\s*(\w+)/g, arg: 1, role: MODE_ROLE },
  { re: /\bdigitalWrite\s*\(\s*([^,()]+(?:\[[^\]]*\])?)\s*,/g, arg: 1, role: 'out' },
  { re: /\bdigitalRead\s*\(\s*([^,()]+(?:\[[^\]]*\])?)\s*\)/g, arg: 1, role: 'in' },
  { re: /\banalogWrite\s*\(\s*([^,()]+(?:\[[^\]]*\])?)\s*,/g, arg: 1, role: 'pwm' },
  { re: /\banalogRead\s*\(\s*([^,()]+(?:\[[^\]]*\])?)\s*\)/g, arg: 1, role: 'analog', analog: true },
  { re: /\b(?:tone|noTone)\s*\(\s*([^,()]+(?:\[[^\]]*\])?)\s*[,)]/g, arg: 1, role: 'out' },
  { re: /\bpulseIn\s*\(\s*([^,()]+(?:\[[^\]]*\])?)\s*,/g, arg: 1, role: 'in' },
  { re: /\battachInterrupt\s*\(\s*digitalPinToInterrupt\s*\(\s*([^()]+)\)/g, arg: 1, role: 'int' },
  { re: /\b\w+\.attach\s*\(\s*([^,()]+)\s*[,)]/g, arg: 1, role: 'out' },
]

/** Constructors that take pins: class -> argument positions. */
const CONSTRUCTORS: Record<string, number[]> = {
  DHT: [0],
  Adafruit_NeoPixel: [1],
  Stepper: [1, 2, 3, 4],
  SoftwareSerial: [0, 1],
  LiquidCrystal: [0, 1, 2, 3, 4, 5],
}

export function detectPins(code: string, family: Family = 'uno'): PinReport {
  const text = stripCode(code)
  const sc = readScope(text)
  const uses = new Map<string, PinUse>()
  const warnings: string[] = []
  const warn = (w: string) => { if (!warnings.includes(w)) warnings.push(w) }

  const add = (pin: string, role: PinRole, line: number) => {
    const u = uses.get(pin) ?? { pin, roles: [], lines: [] }
    if (!u.roles.includes(role)) u.roles.push(role)
    if (!u.lines.includes(line) && u.lines.length < 8) u.lines.push(line)
    uses.set(pin, u)
  }
  const record = (value: Value, role: PinRole, line: number, analog: boolean) => {
    const id = pinId(value, family, analog)
    if (id === null) {
      warn(`Pin ${value} does not exist on this board.`)
      return
    }
    add(id, role, line)
    const n = Number(id.slice(1))
    if (id[0] === 'D' && family !== 'other') {
      if (role === 'pwm' && !PWM_PINS[family].includes(n)) warn(`analogWrite on pin ${n}: it is not a PWM pin (PWM pins: ${PWM_PINS[family].join(', ')}).`)
      if (role === 'int' && !INT_PINS[family].includes(n)) warn(`attachInterrupt on pin ${n}: only pins ${INT_PINS[family].join(', ')} have an external interrupt.`)
      if (role === 'analog') warn(`analogRead on digital pin ${n}: the analog inputs are A0–A${ANALOG[family] - 1}.`)
    }
  }

  for (const call of CALLS) {
    for (const m of text.matchAll(call.re)) {
      const role = typeof call.role === 'function' ? call.role(m as RegExpExecArray) : call.role
      const line = lineOf(text, m.index!)
      for (const v of sc.resolve(m[call.arg])) record(v, role, line, !!call.analog)
    }
  }
  for (const [cls, positions] of Object.entries(CONSTRUCTORS)) {
    for (const m of text.matchAll(new RegExp(`\\b${cls}\\s+\\w+\\s*\\(([^)]*)\\)`, 'g'))) {
      const args = m[1].split(',')
      const line = lineOf(text, m.index!)
      for (const p of positions) {
        for (const v of args[p] !== undefined ? sc.resolve(args[p]) : []) record(v, 'out', line, false)
      }
    }
  }

  if (/\bSerial\.begin\s*\(/.test(text) && family !== 'other') {
    add('D0', 'bus', lineOf(text, text.search(/\bSerial\.begin/)))
    add('D1', 'bus', lineOf(text, text.search(/\bSerial\.begin/)))
    for (const pin of ['D0', 'D1']) {
      if (uses.get(pin)?.roles.some((r) => r !== 'bus')) warn(`Pins 0 and 1 are the USB serial port (Serial.begin is used): avoid pin ${pin.slice(1)}.`)
    }
  }
  if (/\bWire\.begin\s*\(/.test(text) || /#include\s*<Wire\.h>/.test(text)) for (const p of WIRE[family]) add(p, 'bus', lineOf(text, text.search(/Wire/)))
  if (/\bSPI\.begin\s*\(/.test(text)) for (const p of SPI_PINS[family]) add(p, 'bus', lineOf(text, text.search(/SPI\.begin/)))

  const pins = [...uses.values()].sort((a, b) => ORDER(a.pin) - ORDER(b.pin))
  return { pins, warnings }
}

// ------------------------------------------------------------------- pin facts

const TAGS: Record<'uno' | 'mega', Record<number, string[]>> = {
  uno: {
    0: ['RX'], 1: ['TX'], 2: ['INT0'], 3: ['INT1'], 10: ['SS'], 11: ['MOSI'], 12: ['MISO'], 13: ['SCK', 'LED'],
  },
  mega: {
    0: ['RX0'], 1: ['TX0'], 13: ['LED'], 14: ['TX3'], 15: ['RX3'], 16: ['TX2'], 17: ['RX2'], 18: ['TX1', 'INT3'], 19: ['RX1', 'INT2'],
    20: ['SDA', 'INT1'], 21: ['SCL', 'INT0'], 2: ['INT4'], 3: ['INT5'], 50: ['MISO'], 51: ['MOSI'], 52: ['SCK'], 53: ['SS'],
  },
}

function digitalSpec(family: 'uno' | 'mega', n: number): PinSpec {
  const pwm = PWM_PINS[family].includes(n)
  return { id: `D${n}`, label: String(n), tags: [...(pwm ? ['PWM'] : []), ...(TAGS[family][n] ?? [])], pwm }
}

function analogSpec(family: 'uno' | 'mega', n: number): PinSpec {
  const tags = family === 'uno' ? (n === 4 ? ['SDA'] : n === 5 ? ['SCL'] : []) : []
  return { id: `A${n}`, label: `A${n}`, tags, pwm: false }
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

/** The pins of a board, grouped for drawing. [] for boards without a drawing. */
export function pinoutOf(family: Family): PinGroup[] {
  if (family === 'uno') {
    return [
      { title: 'Digital', pins: range(0, 13).map((n) => digitalSpec('uno', n)) },
      { title: 'Analog in', pins: range(0, 5).map((n) => analogSpec('uno', n)) },
    ]
  }
  if (family === 'mega') {
    return [
      { title: 'Digital 0–13', pins: range(0, 13).map((n) => digitalSpec('mega', n)) },
      { title: 'Communication 14–21', pins: range(14, 21).map((n) => digitalSpec('mega', n)) },
      { title: 'Digital 22–53', pins: range(22, 53).map((n) => digitalSpec('mega', n)) },
      { title: 'Analog in', pins: range(0, 15).map((n) => analogSpec('mega', n)) },
    ]
  }
  return []
}

export const ROLE_NAMES: Record<PinRole, string> = {
  out: 'output', in: 'input', pwm: 'PWM output', analog: 'analog input', int: 'interrupt', bus: 'bus (Serial, I2C, SPI)',
}
