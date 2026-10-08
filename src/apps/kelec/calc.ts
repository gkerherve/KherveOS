// The calculators tab: pure functions (each tested) plus a registry that describes the form of every
// calculator, so the window draws them all with one component.

import { formatValue, parseValue } from './sim/units.ts'

// ------------------------------------------------------------------------------ types

export interface Field {
  key: string
  label: string
  unit?: string
  default: string
  /** a menu instead of a number */
  options?: { value: string; label: string }[]
  hint?: string
  /** may be left empty */
  optional?: boolean
  /** only shown when another field has one of these values */
  showWhen?: { key: string; values: string[] }
}

export interface CalcRow { label: string; value: string; main?: boolean }
export type CalcDraw =
  | { kind: 'bands'; colors: string[] }
  | { kind: 'phasor'; vectors: { label: string; re: number; im: number }[] }
export interface CalcOutput { rows: CalcRow[]; notes?: string[]; draw?: CalcDraw }
export interface Calculator {
  id: string
  name: string
  group: string
  description: string
  fields: Field[]
  compute(v: Record<string, string>): CalcOutput
}

const fv = (v: number, unit = '', digits = 4): string => formatValue(v, digits, unit)
const row = (label: string, value: string, main = false): CalcRow => ({ label, value, main })

function num(v: Record<string, string>, key: string, what: string): number {
  const x = parseValue(v[key])
  if (x === null) throw new Error(`${what}: enter a number (4.7k, 10u, 1meg…).`)
  return x
}
function optNum(v: Record<string, string>, key: string, what: string): number | null {
  const t = (v[key] ?? '').trim()
  if (t === '') return null
  return num(v, key, what)
}
function posNum(v: Record<string, string>, key: string, what: string): number {
  const x = num(v, key, what)
  if (!(x > 0)) throw new Error(`${what} must be above zero.`)
  return x
}

// ------------------------------------------------------------------------------ Ohm's law

export interface Ohm { v: number; i: number; r: number; p: number }

/** Any two of voltage, current, resistance and power give the other two. */
export function ohm(v: number | null, i: number | null, r: number | null, p: number | null): Ohm {
  const known = [v, i, r, p].filter((x) => x !== null).length
  if (known < 2) throw new Error('Fill in two of the four values; the other two are calculated.')
  if (v !== null && i !== null) { r ??= v / i; p ??= v * i }
  else if (v !== null && r !== null) { i = v / r; p = (v * v) / r }
  else if (v !== null && p !== null) { i = p / v; r = (v * v) / p }
  else if (i !== null && r !== null) { v = i * r; p = i * i * r }
  else if (i !== null && p !== null) { v = p / i; r = p / (i * i) }
  else if (r !== null && p !== null) { v = Math.sqrt(p * r); i = Math.sqrt(p / r) }
  return { v: v!, i: i!, r: r!, p: p! }
}

// ------------------------------------------------------------------------------ resistor colour code

export const COLOR_NAMES = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white', 'gold', 'silver', 'none'] as const
export type BandColor = (typeof COLOR_NAMES)[number]
export const COLOR_HEX: Record<string, string> = {
  black: '#1a1a1a', brown: '#7a4a21', red: '#d62828', orange: '#f77f00', yellow: '#fcd116', green: '#2a9d4b', blue: '#1d5fd1', violet: '#8e44ad',
  grey: '#8d99a6', white: '#f4f4f4', gold: '#c9a227', silver: '#b8bcc2', none: 'transparent',
}
const DIGIT: BandColor[] = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white']
const TOLERANCE: Partial<Record<BandColor, number>> = { brown: 1, red: 2, green: 0.5, blue: 0.25, violet: 0.1, grey: 0.05, gold: 5, silver: 10, none: 20 }
const TEMPCO: Partial<Record<BandColor, number>> = { black: 250, brown: 100, red: 50, orange: 15, yellow: 25, green: 20, blue: 10, violet: 5, grey: 1 }

export function multiplierColor(exp: number): BandColor {
  if (exp === -1) return 'gold'
  if (exp === -2) return 'silver'
  if (exp >= 0 && exp <= 9) return DIGIT[exp]
  throw new Error('That value is outside what the colour code can express.')
}

/** The bands of a resistor: 4 (2 digits), 5 or 6 (3 digits; the 6th is the temperature coefficient in ppm/K). */
export function colorBands(value: number, tolerancePct = 5, bands: 4 | 5 | 6 = 4, tempco = 100): BandColor[] {
  if (!(value > 0)) throw new Error('The resistance must be above zero.')
  const digits = bands === 4 ? 2 : 3
  let exp = Math.floor(Math.log10(value)) - (digits - 1)
  let mant = Math.round(value / Math.pow(10, exp))
  if (mant >= Math.pow(10, digits)) { mant = Math.round(mant / 10); exp += 1 }
  const ds = String(mant).padStart(digits, '0').split('').map((c) => DIGIT[Number(c)])
  const tol = (Object.entries(TOLERANCE).find(([, t]) => t === tolerancePct)?.[0] ?? 'gold') as BandColor
  const out: BandColor[] = [...ds, multiplierColor(exp), tol]
  if (bands === 6) {
    const tc = (Object.entries(TEMPCO).find(([, t]) => t === tempco)?.[0] ?? 'brown') as BandColor
    out.push(tc)
  }
  return out
}

/** Reads the bands (4, 5 or 6) back into a value, tolerance in % and optional tempco in ppm/K. */
export function valueFromBands(colors: string[]): { value: number; tolerance: number; tempco?: number } {
  const n = colors.length
  if (n < 4 || n > 6) throw new Error('A resistor has 4, 5 or 6 bands.')
  const d = (c: string) => {
    const k = DIGIT.indexOf(c as BandColor)
    if (k < 0) throw new Error(`“${c}” cannot be a digit band.`)
    return k
  }
  const digits = n === 4 ? 2 : 3
  let mant = 0
  for (let i = 0; i < digits; i++) mant = mant * 10 + d(colors[i])
  const mc = colors[digits]
  const exp = mc === 'gold' ? -1 : mc === 'silver' ? -2 : d(mc)
  const tol = TOLERANCE[colors[digits + 1] as BandColor]
  if (tol === undefined) throw new Error(`“${colors[digits + 1]}” is not a tolerance colour.`)
  const out: { value: number; tolerance: number; tempco?: number } = { value: mant * Math.pow(10, exp), tolerance: tol }
  if (n === 6) {
    const tc = TEMPCO[colors[5] as BandColor]
    if (tc === undefined) throw new Error(`“${colors[5]}” is not a temperature-coefficient colour.`)
    out.tempco = tc
  }
  return out
}

// ------------------------------------------------------------------------------ preferred values

export const E6 = [10, 15, 22, 33, 47, 68]
export const E12 = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82]
export const E24 = [10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91]
export const E96 = [
  100, 102, 105, 107, 110, 113, 115, 118, 121, 124, 127, 130, 133, 137, 140, 143, 147, 150, 154, 158, 162, 165, 169, 174, 178, 182, 187, 191, 196, 200, 205, 210,
  215, 221, 226, 232, 237, 243, 249, 255, 261, 267, 274, 280, 287, 294, 301, 309, 316, 324, 332, 340, 348, 357, 365, 374, 383, 392, 402, 412, 422, 432, 442, 453,
  464, 475, 487, 499, 511, 523, 536, 549, 562, 576, 590, 604, 619, 634, 649, 665, 681, 698, 715, 732, 750, 768, 787, 806, 825, 845, 866, 887, 909, 931, 953, 976,
]
export const SERIES: Record<string, number[]> = { E6, E12, E24, E96 }

/** The series' values (mantissas 1.00–9.99) across decades. */
function seriesValues(series: string, lowExp: number, highExp: number): number[] {
  const base = SERIES[series] ?? E24
  const scale = base === E96 ? 100 : 10
  const out: number[] = []
  for (let e = lowExp; e <= highExp; e++) for (const m of base) out.push((m / scale) * Math.pow(10, e))
  return out
}

export interface Nearest { value: number; below: number; above: number; errorPct: number }

export function nearestE(target: number, series = 'E24'): Nearest {
  if (!(target > 0)) throw new Error('The value must be above zero.')
  const e = Math.floor(Math.log10(target))
  const vals = seriesValues(series, e - 1, e + 1).sort((a, b) => a - b)
  let below = vals[0]
  let above = vals[vals.length - 1]
  for (const v of vals) { if (v <= target * (1 + 1e-9)) below = v; else { above = v; break } }
  const value = Math.abs(Math.log(target / below)) <= Math.abs(Math.log(above / target)) ? below : above
  return { value, below, above, errorPct: ((value - target) / target) * 100 }
}

export interface Combo { a: number; b: number; how: 'series' | 'parallel'; value: number; errorPct: number }

/** The best pairs of preferred values, in series or in parallel, that make the target. */
export function bestPairs(target: number, series = 'E24', count = 5): Combo[] {
  const e = Math.floor(Math.log10(target))
  const vals = seriesValues(series, e - 2, e + 2)
  const out: Combo[] = []
  for (let i = 0; i < vals.length; i++) {
    for (let j = i; j < vals.length; j++) {
      const a = vals[i]
      const b = vals[j]
      const s = a + b
      const p = (a * b) / (a + b)
      out.push({ a, b, how: 'series', value: s, errorPct: ((s - target) / target) * 100 })
      out.push({ a, b, how: 'parallel', value: p, errorPct: ((p - target) / target) * 100 })
    }
  }
  const seen = new Set<string>()
  return out
    .sort((x, y) => Math.abs(x.errorPct) - Math.abs(y.errorPct) || Math.abs(x.a - x.b) - Math.abs(y.a - y.b))
    .filter((c) => { const k = `${c.how}${c.a.toPrecision(4)}${c.b.toPrecision(4)}`; if (seen.has(k)) return false; seen.add(k); return true })
    .slice(0, count)
}

export const seriesOf = (vals: number[]): number => vals.reduce((a, b) => a + b, 0)
export const parallelOf = (vals: number[]): number => 1 / vals.reduce((a, b) => a + 1 / b, 0)

// ------------------------------------------------------------------------------ dividers, LEDs, RC…

export function divider(vin: number, r1: number, r2: number, rl = Infinity): { unloaded: number; loaded: number; current: number; p1: number; p2: number } {
  const r2eff = Number.isFinite(rl) ? (r2 * rl) / (r2 + rl) : r2
  const unloaded = (vin * r2) / (r1 + r2)
  const loaded = (vin * r2eff) / (r1 + r2eff)
  const current = vin / (r1 + r2eff)
  return { unloaded, loaded, current, p1: current * current * r1, p2: (loaded * loaded) / r2 }
}

export function ledResistor(vs: number, vf: number, i: number): { r: number; power: number; headroom: number } {
  if (!(vs > vf)) throw new Error('The supply voltage must be above the LED’s forward voltage.')
  const r = (vs - vf) / i
  return { r, power: (vs - vf) * i, headroom: vs - vf }
}

/** Voltage on a charging (or discharging) RC after t, and the time to reach a target. */
export function rcCharge(vs: number, r: number, c: number, t: number): number { return vs * (1 - Math.exp(-t / (r * c))) }
export function rcTimeTo(vs: number, v0: number, vt: number, r: number, c: number): number {
  const ratio = (vt - vs) / (v0 - vs)
  if (!(ratio > 0 && ratio < 1)) throw new Error('That voltage is never reached: it must lie between the start voltage and the supply.')
  return -r * c * Math.log(ratio)
}

export function rlcSeries(r: number, l: number, c: number): { f0: number; q: number; zeta: number; kind: string; wd: number } {
  const w0 = 1 / Math.sqrt(l * c)
  const zeta = r / 2 * Math.sqrt(c / l)
  const kind = Math.abs(zeta - 1) < 1e-9 ? 'critically damped' : zeta < 1 ? 'under-damped (rings)' : 'over-damped'
  return { f0: w0 / (2 * Math.PI), q: 1 / (2 * zeta), zeta, kind, wd: zeta < 1 ? w0 * Math.sqrt(1 - zeta * zeta) : 0 }
}

/** Butterworth ladder prototype values g1…gn. */
export const butterworthG = (n: number): number[] => Array.from({ length: n }, (_, k) => 2 * Math.sin(((2 * (k + 1) - 1) * Math.PI) / (2 * n)))

export interface LadderPart { name: string; kind: 'C' | 'L'; value: number; position: 'shunt' | 'series' }

/** LC ladder: low-pass or high-pass Butterworth of order n for a source/load of r0 and cutoff fc. */
export function butterworthLadder(n: number, fc: number, r0: number, type: 'lowpass' | 'highpass', startShunt = true): LadderPart[] {
  const g = butterworthG(n)
  const w = 2 * Math.PI * fc
  return g.map((gk, k) => {
    const shunt = startShunt ? k % 2 === 0 : k % 2 === 1
    if (type === 'lowpass') {
      return shunt ? { name: `C${k + 1}`, kind: 'C', value: gk / (w * r0), position: 'shunt' } : { name: `L${k + 1}`, kind: 'L', value: (gk * r0) / w, position: 'series' }
    }
    return shunt ? { name: `L${k + 1}`, kind: 'L', value: r0 / (gk * w), position: 'shunt' } : { name: `C${k + 1}`, kind: 'C', value: 1 / (gk * w * r0), position: 'series' }
  })
}

export function ne555Astable(r1: number, r2: number, c: number): { freq: number; period: number; high: number; low: number; duty: number } {
  const high = Math.LN2 * (r1 + r2) * c
  const low = Math.LN2 * r2 * c
  return { freq: 1 / (high + low), period: high + low, high, low, duty: high / (high + low) }
}
export const ne555Monostable = (r: number, c: number): number => 1.0986 * r * c

// ------------------------------------------------------------------------------ impedance, power

export interface Cx { re: number; im: number }
export const cmul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re })
export const cdiv = (a: Cx, b: Cx): Cx => { const d = b.re * b.re + b.im * b.im; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d } }
export const cabs = (a: Cx): number => Math.hypot(a.re, a.im)
export const cphase = (a: Cx): number => (Math.atan2(a.im, a.re) * 180) / Math.PI

export function impedance(f: number, r: number, l: number, c: number): { xl: number; xc: number; series: Cx; parallel: Cx; f0: number } {
  const w = 2 * Math.PI * f
  const xl = w * l
  const xc = c > 0 && w > 0 ? 1 / (w * c) : 0
  const series = { re: r, im: xl - xc }
  // parallel: Y = 1/R + 1/(jωL) − jωC·(−1)…  admittance of L is −j/(ωL), of C is +jωC
  const y: Cx = { re: r > 0 ? 1 / r : 0, im: (c > 0 ? w * c : 0) - (l > 0 && w > 0 ? 1 / (w * l) : 0) }
  const parallel = cdiv({ re: 1, im: 0 }, y)
  return { xl, xc, series, parallel, f0: l > 0 && c > 0 ? 1 / (2 * Math.PI * Math.sqrt(l * c)) : 0 }
}

export function powerFactor(p: number, pf: number, v: number, f: number, target: number): { s: number; q: number; i: number; phi: number; capacitor: number | null; newI: number } {
  const s = p / pf
  const phi = Math.acos(pf)
  const q = Math.sqrt(Math.max(0, s * s - p * p))
  const i = s / v
  const phi2 = Math.acos(target)
  const capacitor = target > pf ? (p * (Math.tan(phi) - Math.tan(phi2))) / (2 * Math.PI * f * v * v) : null
  return { s, q, i, phi: (phi * 180) / Math.PI, capacitor, newI: p / target / v }
}

// ------------------------------------------------------------------------------ wire, batteries, decibels

export function awg(n: number): { diameter: number; area: number; ohmPerM: number; chassisAmps: number } {
  const diameter = 0.127 * Math.pow(92, (36 - n) / 39) // mm
  const area = (Math.PI / 4) * diameter * diameter // mm²
  const ohmPerM = 1.724e-8 / (area * 1e-6)
  const table: Record<number, number> = { 30: 0.86, 28: 1.4, 26: 2.2, 24: 3.5, 22: 7, 20: 11, 18: 16, 16: 22, 14: 32, 12: 41, 10: 55, 8: 73, 6: 101, 4: 135, 2: 181, 0: 245 }
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b)
  let amps = NaN
  if (n in table) amps = table[n]
  else {
    // log-interpolate between neighbours
    const lo = [...keys].reverse().find((k) => k < n)
    const hi = keys.find((k) => k > n)
    if (lo !== undefined && hi !== undefined) amps = Math.exp(Math.log(table[lo]) + ((Math.log(table[hi]) - Math.log(table[lo])) * (n - lo)) / (hi - lo))
    else amps = n > 30 ? 0.86 * Math.pow(area / awg(30).area, 0.9) : table[0]
  }
  return { diameter, area, ohmPerM, chassisAmps: amps }
}

export function batteryHours(capacityMah: number, activeMa: number, sleepMa: number, dutyPct: number, usablePct: number): { avgMa: number; hours: number } {
  const avgMa = activeMa * (dutyPct / 100) + sleepMa * (1 - dutyPct / 100)
  return { avgMa, hours: (capacityMah * (usablePct / 100)) / avgMa }
}

export function decibels(mode: string, x: number): { label: string; value: string }[] {
  switch (mode) {
    case 'vratio': return [{ label: 'Decibels (voltage)', value: `${(20 * Math.log10(x)).toFixed(3)} dB` }, { label: 'Same as a power ratio of', value: String(Number((x * x).toPrecision(5))) }]
    case 'pratio': return [{ label: 'Decibels (power)', value: `${(10 * Math.log10(x)).toFixed(3)} dB` }, { label: 'Same as a voltage ratio of', value: String(Number(Math.sqrt(x).toPrecision(5))) }]
    case 'db_v': return [{ label: 'Voltage ratio', value: String(Number(Math.pow(10, x / 20).toPrecision(6))) }, { label: 'Power ratio', value: String(Number(Math.pow(10, x / 10).toPrecision(6))) }]
    case 'dbm_w': return [{ label: 'Power', value: fv(1e-3 * Math.pow(10, x / 10), 'W', 5) }, { label: 'Voltage across 50 Ω', value: fv(Math.sqrt(1e-3 * Math.pow(10, x / 10) * 50), 'V', 4) }]
    case 'w_dbm': return [{ label: 'Level', value: `${(10 * Math.log10(x / 1e-3)).toFixed(3)} dBm` }, { label: 'Level', value: `${(10 * Math.log10(x)).toFixed(3)} dBW` }]
    case 'dbv_v': return [{ label: 'Voltage', value: fv(Math.pow(10, x / 20), 'V', 5) }, { label: 'Level in dBu', value: `${(x + 2.2185).toFixed(3)} dBu` }]
    case 'v_dbv': return [{ label: 'Level', value: `${(20 * Math.log10(x)).toFixed(3)} dBV` }, { label: 'Level', value: `${(20 * Math.log10(x / 0.7745967)).toFixed(3)} dBu` }]
    default: throw new Error('Unknown conversion.')
  }
}

export function thevenin(vth: number | null, rth: number | null, isc: number | null): { vth: number; rth: number; isc: number } {
  if (vth !== null && rth !== null) isc = vth / rth
  else if (vth !== null && isc !== null) rth = vth / isc
  else if (rth !== null && isc !== null) vth = rth * isc
  else throw new Error('Fill in two of the three values.')
  return { vth: vth!, rth: rth!, isc: isc! }
}

// ------------------------------------------------------------------------------ the registry

const opt = (...pairs: [string, string][]): Field['options'] => pairs.map(([value, label]) => ({ value, label }))
const SERIES_OPTS = opt(['E6', 'E6 (20 %)'], ['E12', 'E12 (10 %)'], ['E24', 'E24 (5 %)'], ['E96', 'E96 (1 %)'])
const TOL_OPTS = opt(['1', '1 %'], ['2', '2 %'], ['5', '5 %'], ['10', '10 %'], ['0.5', '0.5 %'], ['0.25', '0.25 %'], ['0.1', '0.1 %'])

export const CALCULATORS: Calculator[] = [
  {
    id: 'ohm', name: 'Ohm’s law and power', group: 'Basics', description: 'Fill in any two of V, I, R and P; the other two are found.',
    fields: [
      { key: 'v', label: 'Voltage', unit: 'V', default: '5', optional: true }, { key: 'i', label: 'Current', unit: 'A', default: '', optional: true },
      { key: 'r', label: 'Resistance', unit: 'Ω', default: '1k', optional: true }, { key: 'p', label: 'Power', unit: 'W', default: '', optional: true },
    ],
    compute: (v) => {
      const r = ohm(optNum(v, 'v', 'Voltage'), optNum(v, 'i', 'Current'), optNum(v, 'r', 'Resistance'), optNum(v, 'p', 'Power'))
      return { rows: [row('Voltage', fv(r.v, 'V'), true), row('Current', fv(r.i, 'A'), true), row('Resistance', fv(r.r, 'Ω'), true), row('Power', fv(r.p, 'W'), true)] }
    },
  },
  {
    id: 'colorcode', name: 'Resistor colour code', group: 'Basics', description: 'From a value to the coloured bands, or read the bands back.',
    fields: [
      { key: 'mode', label: 'Direction', default: 'toBands', options: opt(['toBands', 'Value → bands'], ['toValue', 'Bands → value']) },
      { key: 'value', label: 'Resistance', unit: 'Ω', default: '4.7k', showWhen: { key: 'mode', values: ['toBands'] } },
      { key: 'bands', label: 'Number of bands', default: '4', options: opt(['4', '4 bands'], ['5', '5 bands'], ['6', '6 bands']), showWhen: { key: 'mode', values: ['toBands'] } },
      { key: 'tol', label: 'Tolerance', default: '5', options: TOL_OPTS, showWhen: { key: 'mode', values: ['toBands'] } },
      { key: 'colors', label: 'Colours, left to right', default: 'yellow violet red gold', hint: 'e.g. yellow violet red gold', showWhen: { key: 'mode', values: ['toValue'] } },
    ],
    compute: (v) => {
      if (v.mode === 'toValue') {
        const colors = (v.colors ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean)
        const r = valueFromBands(colors)
        return {
          rows: [row('Resistance', fv(r.value, 'Ω'), true), row('Tolerance', `±${r.tolerance} %`), ...(r.tempco ? [row('Temperature coefficient', `${r.tempco} ppm/K`)] : []),
            row('Range', `${fv(r.value * (1 - r.tolerance / 100), 'Ω')} … ${fv(r.value * (1 + r.tolerance / 100), 'Ω')}`)],
          draw: { kind: 'bands', colors },
        }
      }
      const bands = Number(v.bands) as 4 | 5 | 6
      const colors = colorBands(posNum(v, 'value', 'Resistance'), Number(v.tol), bands)
      const back = valueFromBands(colors)
      return { rows: [row('Bands', colors.join(', '), true), row('Reads as', fv(back.value, 'Ω'))], draw: { kind: 'bands', colors }, notes: back.value !== posNum(v, 'value', 'Resistance') ? ['The value was rounded to what the bands can show.'] : undefined }
    },
  },
  {
    id: 'eseries', name: 'Preferred values (E-series)', group: 'Basics', description: 'The nearest standard resistor, and the best two-resistor combinations.',
    fields: [
      { key: 'target', label: 'Wanted value', unit: 'Ω', default: '3.3k' },
      { key: 'series', label: 'Series', default: 'E24', options: SERIES_OPTS },
    ],
    compute: (v) => {
      const t = posNum(v, 'target', 'Wanted value')
      const n = nearestE(t, v.series)
      const combos = bestPairs(t, v.series, 5)
      return {
        rows: [
          row('Nearest', `${fv(n.value, 'Ω')}  (${n.errorPct >= 0 ? '+' : ''}${n.errorPct.toFixed(2)} %)`, true), row('Next below', fv(n.below, 'Ω')), row('Next above', fv(n.above, 'Ω')),
          ...combos.map((c) => row(c.how === 'series' ? 'Series pair' : 'Parallel pair', `${fv(c.a, 'Ω')} ${c.how === 'series' ? '+' : '‖'} ${fv(c.b, 'Ω')} = ${fv(c.value, 'Ω', 5)}  (${c.errorPct >= 0 ? '+' : ''}${c.errorPct.toFixed(3)} %)`)),
        ],
      }
    },
  },
  {
    id: 'seriesparallel', name: 'Series and parallel', group: 'Basics', description: 'Combine resistors, inductors (like resistors) or capacitors (the other way round).',
    fields: [
      { key: 'values', label: 'Values (separated by spaces)', default: '1k 2.2k 4.7k', hint: 'e.g. 1k 2.2k 4.7k' },
      { key: 'kind', label: 'For', default: 'r', options: opt(['r', 'Resistors / inductors'], ['c', 'Capacitors']) },
    ],
    compute: (v) => {
      const vals = (v.values ?? '').split(/[\s,;]+/).filter(Boolean).map((t) => { const x = parseValue(t); if (x === null || !(x > 0)) throw new Error(`“${t}” is not a positive number.`); return x })
      if (vals.length < 2) throw new Error('Enter at least two values.')
      const unit = v.kind === 'c' ? 'F' : 'Ω'
      const s = v.kind === 'c' ? parallelOf(vals) : seriesOf(vals)
      const p = v.kind === 'c' ? seriesOf(vals) : parallelOf(vals)
      return { rows: [row('In series', fv(s, unit, 5), true), row('In parallel', fv(p, unit, 5), true)] }
    },
  },
  {
    id: 'divider', name: 'Voltage divider', group: 'Basics', description: 'The output of two resistors, with the effect of a load.',
    fields: [
      { key: 'vin', label: 'Input voltage', unit: 'V', default: '12' }, { key: 'r1', label: 'R1 (top)', unit: 'Ω', default: '10k' }, { key: 'r2', label: 'R2 (bottom)', unit: 'Ω', default: '4.7k' },
      { key: 'rl', label: 'Load (empty = none)', unit: 'Ω', default: '', optional: true },
    ],
    compute: (v) => {
      const rl = optNum(v, 'rl', 'Load')
      const d = divider(num(v, 'vin', 'Input voltage'), posNum(v, 'r1', 'R1'), posNum(v, 'r2', 'R2'), rl ?? Infinity)
      return {
        rows: [row(rl === null ? 'Output' : 'Output with load', fv(rl === null ? d.unloaded : d.loaded, 'V', 5), true), ...(rl === null ? [] : [row('Output without load', fv(d.unloaded, 'V', 5))]),
          row('Current from the source', fv(d.current, 'A')), row('Power in R1', fv(d.p1, 'W')), row('Power in R2', fv(d.p2, 'W'))],
      }
    },
  },
  {
    id: 'led', name: 'LED series resistor', group: 'Basics', description: 'The resistor that sets an LED’s current.',
    fields: [
      { key: 'vs', label: 'Supply', unit: 'V', default: '5' }, { key: 'vf', label: 'LED forward voltage', unit: 'V', default: '2', hint: 'red ≈ 1.9, green ≈ 2.1, blue/white ≈ 3.1' },
      { key: 'i', label: 'LED current', unit: 'A', default: '10m' },
    ],
    compute: (v) => {
      const vs = num(v, 'vs', 'Supply')
      const r = ledResistor(vs, num(v, 'vf', 'Forward voltage'), posNum(v, 'i', 'LED current'))
      const e = nearestE(r.r, 'E24')
      const safe = e.value >= r.r ? e.value : e.above
      const iActual = (vs - num(v, 'vf', 'Forward voltage')) / safe
      return {
        rows: [row('Resistor', fv(r.r, 'Ω', 4), true), row('Use (E24, not below)', fv(safe, 'Ω'), true), row('Resulting current', fv(iActual, 'A')), row('Power in the resistor', fv(iActual * iActual * safe, 'W')), row('Power in the LED', fv(num(v, 'vf', 'Forward voltage') * iActual, 'W'))],
      }
    },
  },
  {
    id: 'timeconst', name: 'Time constants (RC, RL, RLC)', group: 'Time and frequency', description: 'Time constants, rise times and the damping of an RLC.',
    fields: [
      { key: 'kind', label: 'Circuit', default: 'rc', options: opt(['rc', 'RC'], ['rl', 'RL'], ['rlc', 'Series RLC']) },
      { key: 'r', label: 'Resistance', unit: 'Ω', default: '1k' },
      { key: 'c', label: 'Capacitance', unit: 'F', default: '1u', showWhen: { key: 'kind', values: ['rc', 'rlc'] } },
      { key: 'l', label: 'Inductance', unit: 'H', default: '10m', showWhen: { key: 'kind', values: ['rl', 'rlc'] } },
    ],
    compute: (v) => {
      const r = posNum(v, 'r', 'Resistance')
      if (v.kind === 'rc') {
        const tau = r * posNum(v, 'c', 'Capacitance')
        return { rows: [row('Time constant τ = RC', fv(tau, 's'), true), row('Rise time 10–90 %', fv(2.2 * tau, 's')), row('Reaches 63.2 % after', fv(tau, 's')), row('Settled (99.3 %) after 5τ', fv(5 * tau, 's')), row('Cutoff frequency', fv(1 / (2 * Math.PI * tau), 'Hz'))] }
      }
      if (v.kind === 'rl') {
        const tau = posNum(v, 'l', 'Inductance') / r
        return { rows: [row('Time constant τ = L/R', fv(tau, 's'), true), row('Rise time 10–90 %', fv(2.2 * tau, 's')), row('Settled (99.3 %) after 5τ', fv(5 * tau, 's')), row('Cutoff frequency', fv(1 / (2 * Math.PI * tau), 'Hz'))] }
      }
      const s = rlcSeries(r, posNum(v, 'l', 'Inductance'), posNum(v, 'c', 'Capacitance'))
      return {
        rows: [row('Resonant frequency', fv(s.f0, 'Hz'), true), row('Quality factor Q', s.q.toFixed(3), true), row('Damping ratio ζ', s.zeta.toFixed(4)), row('Response', s.kind), ...(s.wd ? [row('Ringing frequency', fv(s.wd / (2 * Math.PI), 'Hz'))] : []),
          row('Critical resistance 2√(L/C)', fv(2 * Math.sqrt(posNum(v, 'l', 'Inductance') / posNum(v, 'c', 'Capacitance')), 'Ω'))],
      }
    },
  },
  {
    id: 'cutoff', name: 'Cutoff and resonance', group: 'Time and frequency', description: 'The −3 dB frequency of an RC or RL filter and the resonance of an LC.',
    fields: [
      { key: 'kind', label: 'Circuit', default: 'rc', options: opt(['rc', 'RC filter'], ['rl', 'RL filter'], ['lc', 'LC resonance']) },
      { key: 'r', label: 'Resistance', unit: 'Ω', default: '1k', showWhen: { key: 'kind', values: ['rc', 'rl'] } },
      { key: 'c', label: 'Capacitance', unit: 'F', default: '100n', showWhen: { key: 'kind', values: ['rc', 'lc'] } },
      { key: 'l', label: 'Inductance', unit: 'H', default: '10m', showWhen: { key: 'kind', values: ['rl', 'lc'] } },
    ],
    compute: (v) => {
      if (v.kind === 'rc') { const f = 1 / (2 * Math.PI * posNum(v, 'r', 'Resistance') * posNum(v, 'c', 'Capacitance')); return { rows: [row('Cutoff frequency fc', fv(f, 'Hz'), true), row('Angular ω = 2πf', fv(2 * Math.PI * f, 'rad/s'))] } }
      if (v.kind === 'rl') { const f = posNum(v, 'r', 'Resistance') / (2 * Math.PI * posNum(v, 'l', 'Inductance')); return { rows: [row('Cutoff frequency fc', fv(f, 'Hz'), true), row('Angular ω = 2πf', fv(2 * Math.PI * f, 'rad/s'))] } }
      const l = posNum(v, 'l', 'Inductance')
      const c = posNum(v, 'c', 'Capacitance')
      const f = 1 / (2 * Math.PI * Math.sqrt(l * c))
      return { rows: [row('Resonant frequency f₀', fv(f, 'Hz'), true), row('Characteristic impedance √(L/C)', fv(Math.sqrt(l / c), 'Ω'))] }
    },
  },
  {
    id: 'filter', name: 'Passive filter designer', group: 'Time and frequency', description: 'Component values for RC, RLC and Butterworth LC filters.',
    fields: [
      { key: 'kind', label: 'Filter', default: 'rc_lp', options: opt(['rc_lp', 'RC low-pass'], ['rc_hp', 'CR high-pass'], ['rlc_bp', 'RLC band-pass (series)'], ['rlc_notch', 'RLC notch (series)'], ['bw_lp', 'Butterworth low-pass (LC ladder)'], ['bw_hp', 'Butterworth high-pass (LC ladder)']) },
      { key: 'f', label: 'Cutoff / centre frequency', unit: 'Hz', default: '1k' },
      { key: 'r', label: 'Resistance / source = load', unit: 'Ω', default: '1k' },
      { key: 'q', label: 'Quality factor Q', default: '5', showWhen: { key: 'kind', values: ['rlc_bp', 'rlc_notch'] } },
      { key: 'n', label: 'Order n', default: '3', showWhen: { key: 'kind', values: ['bw_lp', 'bw_hp'] } },
    ],
    compute: (v) => {
      const f = posNum(v, 'f', 'Frequency')
      const r = posNum(v, 'r', 'Resistance')
      const w = 2 * Math.PI * f
      if (v.kind === 'rc_lp' || v.kind === 'rc_hp') {
        const c = 1 / (w * r)
        return { rows: [row('Capacitor', fv(c, 'F'), true), row('Nearest E12', fv(nearestE(c, 'E12').value, 'F'))], notes: [v.kind === 'rc_lp' ? 'Resistor in series, capacitor to ground; output across the capacitor.' : 'Capacitor in series, resistor to ground; output across the resistor.'] }
      }
      if (v.kind === 'rlc_bp' || v.kind === 'rlc_notch') {
        const q = posNum(v, 'q', 'Q')
        const l = (q * r) / w
        const c = 1 / (w * w * l)
        return {
          rows: [row('Inductor', fv(l, 'H'), true), row('Capacitor', fv(c, 'F'), true), row('Bandwidth f₀/Q', fv(f / q, 'Hz'))],
          notes: [v.kind === 'rlc_bp' ? 'Source → L → C → R to ground; output across R. Peak (0 dB) at f₀.' : 'Source → R → node; L and C in series from that node to ground. Output at the node: a notch at f₀.'],
        }
      }
      const n = Math.round(posNum(v, 'n', 'Order'))
      if (n < 1 || n > 10) throw new Error('The order must be between 1 and 10.')
      const parts = butterworthLadder(n, f, r, v.kind === 'bw_lp' ? 'lowpass' : 'highpass')
      return { rows: parts.map((p) => row(`${p.name} (${p.position})`, fv(p.value, p.kind === 'C' ? 'F' : 'H'), true)), notes: [`Doubly terminated, ${n}-pole Butterworth; −3 dB at ${fv(f, 'Hz')}. Parts alternate shunt and series, starting with a shunt element at the source.`] }
    },
  },
  {
    id: 'opamp', name: 'Op-amp gain', group: 'Amplifiers', description: 'Gain and component values of the classic op-amp stages.',
    fields: [
      { key: 'kind', label: 'Stage', default: 'inv', options: opt(['inv', 'Inverting'], ['non', 'Non-inverting'], ['sum', 'Inverting summer'], ['diff', 'Difference'], ['int', 'Integrator']) },
      { key: 'rin', label: 'Rin', unit: 'Ω', default: '1k' }, { key: 'rf', label: 'Rf', unit: 'Ω', default: '10k', showWhen: { key: 'kind', values: ['inv', 'non', 'sum', 'diff'] } },
      { key: 'rins', label: 'Other input resistors', unit: 'Ω', default: '2k 5k', hint: 'separated by spaces', showWhen: { key: 'kind', values: ['sum'] } },
      { key: 'c', label: 'Feedback capacitor', unit: 'F', default: '10n', showWhen: { key: 'kind', values: ['int'] } },
    ],
    compute: (v) => {
      const rin = posNum(v, 'rin', 'Rin')
      if (v.kind === 'inv') { const g = -posNum(v, 'rf', 'Rf') / rin; return { rows: [row('Gain', g.toFixed(4), true), row('Gain in dB', `${(20 * Math.log10(Math.abs(g))).toFixed(2)} dB`), row('Input impedance', fv(rin, 'Ω'))] } }
      if (v.kind === 'non') { const g = 1 + posNum(v, 'rf', 'Rf') / rin; return { rows: [row('Gain 1 + Rf/Rin', g.toFixed(4), true), row('Gain in dB', `${(20 * Math.log10(g)).toFixed(2)} dB`)], notes: ['Rin is the resistor from the inverting input to ground.'] } }
      if (v.kind === 'diff') { const g = posNum(v, 'rf', 'Rf') / rin; return { rows: [row('Gain Rf/Rin (V2 − V1)', g.toFixed(4), true)], notes: ['Use matched pairs: R1 = R3 = Rin, R2 = R4 = Rf.'] } }
      if (v.kind === 'sum') {
        const rf = posNum(v, 'rf', 'Rf')
        const rs = [rin, ...(v.rins ?? '').split(/[\s,;]+/).filter(Boolean).map((t) => { const x = parseValue(t); if (x === null || !(x > 0)) throw new Error(`“${t}” is not a positive number.`); return x })]
        return { rows: [...rs.map((r, i) => row(`Gain of input ${i + 1}`, (-rf / r).toFixed(4), true)), row('Output', `−(${rs.map((r, i) => `${(rf / r).toPrecision(3)}·V${i + 1}`).join(' + ')})`)] }
      }
      const c = posNum(v, 'c', 'Feedback capacitor')
      const fu = 1 / (2 * Math.PI * rin * c)
      return { rows: [row('Output slope', `−Vin / (R·C) = ${fv(1 / (rin * c), 'V/s per V')}`, true), row('Unity-gain frequency 1/(2πRC)', fv(fu, 'Hz'))], notes: ['Add a large resistor in parallel with C to keep the DC gain finite.'] }
    },
  },
  {
    id: 'ne555', name: '555 timer', group: 'Amplifiers', description: 'Frequency and duty cycle of an astable, or the pulse length of a monostable.',
    fields: [
      { key: 'mode', label: 'Mode', default: 'astable', options: opt(['astable', 'Astable (oscillator)'], ['mono', 'Monostable (one pulse)']) },
      { key: 'r1', label: 'R1', unit: 'Ω', default: '1k', showWhen: { key: 'mode', values: ['astable'] } }, { key: 'r2', label: 'R2 (R for monostable)', unit: 'Ω', default: '10k' }, { key: 'c', label: 'C', unit: 'F', default: '100n' },
    ],
    compute: (v) => {
      const c = posNum(v, 'c', 'C')
      if (v.mode === 'mono') return { rows: [row('Pulse length 1.1·R·C', fv(ne555Monostable(posNum(v, 'r2', 'R'), c), 's'), true)] }
      const a = ne555Astable(posNum(v, 'r1', 'R1'), posNum(v, 'r2', 'R2'), c)
      return { rows: [row('Frequency', fv(a.freq, 'Hz'), true), row('Period', fv(a.period, 's')), row('High time', fv(a.high, 's')), row('Low time', fv(a.low, 's')), row('Duty cycle', `${(a.duty * 100).toFixed(2)} %`)] }
    },
  },
  {
    id: 'rccharge', name: 'Capacitor charge / discharge', group: 'Time and frequency', description: 'How long a capacitor takes to reach a voltage, or the voltage after a time.',
    fields: [
      { key: 'vs', label: 'Supply (final) voltage', unit: 'V', default: '5' }, { key: 'v0', label: 'Starting voltage', unit: 'V', default: '0' },
      { key: 'r', label: 'Resistance', unit: 'Ω', default: '10k' }, { key: 'c', label: 'Capacitance', unit: 'F', default: '10u' },
      { key: 'vt', label: 'Target voltage', unit: 'V', default: '3', optional: true }, { key: 't', label: 'or time', unit: 's', default: '', optional: true },
    ],
    compute: (v) => {
      const vs = num(v, 'vs', 'Supply'); const v0 = num(v, 'v0', 'Starting voltage')
      const r = posNum(v, 'r', 'Resistance'); const c = posNum(v, 'c', 'Capacitance')
      const rows: CalcRow[] = [row('Time constant', fv(r * c, 's'))]
      const vt = optNum(v, 'vt', 'Target voltage')
      const t = optNum(v, 't', 'Time')
      if (vt !== null) rows.unshift(row(`Time to reach ${fv(vt, 'V')}`, fv(rcTimeTo(vs, v0, vt, r, c), 's', 5), true))
      if (t !== null) rows.unshift(row(`Voltage after ${fv(t, 's')}`, fv(vs + (v0 - vs) * Math.exp(-t / (r * c)), 'V', 5), true))
      if (vt === null && t === null) throw new Error('Give a target voltage or a time.')
      return { rows }
    },
  },
  {
    id: 'impedance', name: 'Reactance and impedance', group: 'AC power', description: 'XL, XC and the complex impedance of R, L, C, in series and in parallel, with a phasor diagram.',
    fields: [
      { key: 'f', label: 'Frequency', unit: 'Hz', default: '1k' }, { key: 'r', label: 'Resistance', unit: 'Ω', default: '100' },
      { key: 'l', label: 'Inductance', unit: 'H', default: '10m', optional: true }, { key: 'c', label: 'Capacitance', unit: 'F', default: '1u', optional: true },
    ],
    compute: (v) => {
      const f = posNum(v, 'f', 'Frequency')
      const r = posNum(v, 'r', 'Resistance')
      const l = optNum(v, 'l', 'Inductance') ?? 0
      const c = optNum(v, 'c', 'Capacitance') ?? 0
      const z = impedance(f, r, l, c)
      const pol = (a: Cx) => `${fv(cabs(a), 'Ω')} ∠ ${cphase(a).toFixed(2)}°`
      const rect = (a: Cx) => `${fv(a.re, 'Ω')} ${a.im >= 0 ? '+' : '−'} j${fv(Math.abs(a.im), 'Ω')}`
      return {
        rows: [row('Inductive reactance XL', fv(z.xl, 'Ω')), row('Capacitive reactance XC', fv(z.xc, 'Ω')), row('Series Z', rect(z.series), true), row('Series |Z| ∠ φ', pol(z.series), true),
          row('Parallel Z', rect(z.parallel), true), row('Parallel |Z| ∠ φ', pol(z.parallel), true), ...(z.f0 ? [row('Resonance of L and C', fv(z.f0, 'Hz'))] : [])],
        draw: { kind: 'phasor', vectors: [{ label: 'R', re: r, im: 0 }, ...(l ? [{ label: 'XL', re: 0, im: z.xl }] : []), ...(c ? [{ label: 'XC', re: 0, im: -z.xc }] : []), { label: 'Z', re: z.series.re, im: z.series.im }] },
      }
    },
  },
  {
    id: 'pf', name: 'Power factor', group: 'AC power', description: 'Apparent and reactive power, and the capacitor that corrects the power factor.',
    fields: [
      { key: 'p', label: 'Real power', unit: 'W', default: '1k' }, { key: 'pf', label: 'Power factor', default: '0.7' }, { key: 'v', label: 'Voltage (RMS)', unit: 'V', default: '230' },
      { key: 'f', label: 'Frequency', unit: 'Hz', default: '50' }, { key: 'target', label: 'Wanted power factor', default: '0.95' },
    ],
    compute: (v) => {
      const pf = num(v, 'pf', 'Power factor')
      const tg = num(v, 'target', 'Wanted power factor')
      if (!(pf > 0 && pf <= 1) || !(tg > 0 && tg <= 1)) throw new Error('A power factor lies between 0 and 1.')
      const r = powerFactor(posNum(v, 'p', 'Real power'), pf, posNum(v, 'v', 'Voltage'), posNum(v, 'f', 'Frequency'), tg)
      return {
        rows: [row('Apparent power S', fv(r.s, 'VA'), true), row('Reactive power Q', fv(r.q, 'var')), row('Phase angle φ', `${r.phi.toFixed(2)}°`), row('Line current', fv(r.i, 'A')),
          ...(r.capacitor !== null ? [row('Correction capacitor (parallel)', fv(r.capacitor, 'F'), true), row('Line current afterwards', fv(r.newI, 'A'))] : [])],
      }
    },
  },
  {
    id: 'battery', name: 'Battery life', group: 'AC power', description: 'How long a battery lasts for a load, with a sleep/active duty cycle.',
    fields: [
      { key: 'cap', label: 'Capacity', unit: 'mAh', default: '2000' }, { key: 'active', label: 'Active current', unit: 'mA', default: '50' },
      { key: 'sleep', label: 'Sleep current', unit: 'mA', default: '0.05' }, { key: 'duty', label: 'Time active', unit: '%', default: '10' }, { key: 'usable', label: 'Usable capacity', unit: '%', default: '80' },
    ],
    compute: (v) => {
      const r = batteryHours(posNum(v, 'cap', 'Capacity'), num(v, 'active', 'Active current'), num(v, 'sleep', 'Sleep current'), num(v, 'duty', 'Duty'), posNum(v, 'usable', 'Usable capacity'))
      if (!(r.avgMa > 0)) throw new Error('The average current must be above zero.')
      return { rows: [row('Average current', `${r.avgMa.toPrecision(4)} mA`), row('Runtime', `${r.hours.toFixed(1)} hours`, true), row('Runtime', `${(r.hours / 24).toFixed(1)} days`, true)] }
    },
  },
  {
    id: 'awg', name: 'Wire gauge', group: 'AC power', description: 'Size, resistance and safe current of copper wire by AWG, and the voltage drop over a run.',
    fields: [
      { key: 'awg', label: 'AWG', default: '22', hint: '0–40' }, { key: 'len', label: 'Length (one way)', unit: 'm', default: '5' }, { key: 'i', label: 'Current', unit: 'A', default: '2' },
    ],
    compute: (v) => {
      const n = Math.round(num(v, 'awg', 'AWG'))
      if (n < 0 || n > 40) throw new Error('AWG sizes run from 0 to 40.')
      const w = awg(n)
      const len = posNum(v, 'len', 'Length')
      const i = num(v, 'i', 'Current')
      const rt = w.ohmPerM * len * 2
      return {
        rows: [row('Diameter', `${w.diameter.toFixed(3)} mm`), row('Cross-section', `${w.area.toFixed(3)} mm²`), row('Resistance', `${fv(w.ohmPerM, 'Ω/m')}`), row('Chassis wiring limit', `${w.chassisAmps.toPrecision(3)} A`, true),
          row('Round-trip resistance', fv(rt, 'Ω')), row('Voltage drop', fv(rt * i, 'V'), true), row('Power lost in the wire', fv(rt * i * i, 'W'))],
        notes: ['Chassis-wiring limits are for short runs in free air; for bundles or long runs use about a third of it.'],
      }
    },
  },
  {
    id: 'db', name: 'Decibels', group: 'Basics', description: 'Ratios, dB, dBm, dBV and watts.',
    fields: [
      { key: 'mode', label: 'Convert', default: 'vratio', options: opt(['vratio', 'Voltage ratio → dB'], ['pratio', 'Power ratio → dB'], ['db_v', 'dB → ratios'], ['dbm_w', 'dBm → watts'], ['w_dbm', 'Watts → dBm'], ['dbv_v', 'dBV → volts'], ['v_dbv', 'Volts → dBV']) },
      { key: 'x', label: 'Value', default: '10' },
    ],
    compute: (v) => {
      const x = num(v, 'x', 'Value')
      if (['vratio', 'pratio', 'w_dbm', 'v_dbv'].includes(v.mode) && !(x > 0)) throw new Error('The value must be above zero.')
      return { rows: decibels(v.mode, x).map((r) => row(r.label, r.value, true)) }
    },
  },
  {
    id: 'thevenin', name: 'Thevenin and Norton', group: 'Basics', description: 'The equivalent of a two-terminal network, and what it delivers to a load.',
    fields: [
      { key: 'mode', label: 'From', default: 'values', options: opt(['values', 'Two known values'], ['divider', 'A divider (source, R1 series, R2 shunt)']) },
      { key: 'vth', label: 'Open-circuit voltage Vth', unit: 'V', default: '10', optional: true, showWhen: { key: 'mode', values: ['values'] } },
      { key: 'rth', label: 'Thevenin resistance Rth', unit: 'Ω', default: '1k', optional: true, showWhen: { key: 'mode', values: ['values'] } },
      { key: 'isc', label: 'Short-circuit current In', unit: 'A', default: '', optional: true, showWhen: { key: 'mode', values: ['values'] } },
      { key: 'vs', label: 'Source voltage', unit: 'V', default: '12', showWhen: { key: 'mode', values: ['divider'] } }, { key: 'r1', label: 'R1 (series)', unit: 'Ω', default: '1k', showWhen: { key: 'mode', values: ['divider'] } },
      { key: 'r2', label: 'R2 (shunt)', unit: 'Ω', default: '2k', showWhen: { key: 'mode', values: ['divider'] } },
      { key: 'rl', label: 'Load (optional)', unit: 'Ω', default: '1k', optional: true },
    ],
    compute: (v) => {
      let t: { vth: number; rth: number; isc: number }
      if (v.mode === 'divider') {
        const vs = num(v, 'vs', 'Source'); const r1 = posNum(v, 'r1', 'R1'); const r2 = posNum(v, 'r2', 'R2')
        t = thevenin((vs * r2) / (r1 + r2), (r1 * r2) / (r1 + r2), null)
      } else t = thevenin(optNum(v, 'vth', 'Vth'), optNum(v, 'rth', 'Rth'), optNum(v, 'isc', 'In'))
      const rows = [row('Thevenin voltage Vth', fv(t.vth, 'V'), true), row('Thevenin resistance Rth', fv(t.rth, 'Ω'), true), row('Norton current In', fv(t.isc, 'A'), true), row('Maximum power transfer at RL = Rth', fv((t.vth * t.vth) / (4 * t.rth), 'W'))]
      const rl = optNum(v, 'rl', 'Load')
      if (rl !== null) {
        const il = t.vth / (t.rth + rl)
        rows.push(row('Load voltage', fv(il * rl, 'V')), row('Load current', fv(il, 'A')), row('Load power', fv(il * il * rl, 'W')))
      }
      return { rows }
    },
  },
]

export function calculatorById(id: string): Calculator | undefined {
  return CALCULATORS.find((c) => c.id === id)
}

/** Default inputs of a calculator. */
export function defaultInputs(c: Calculator): Record<string, string> {
  const o: Record<string, string> = {}
  for (const f of c.fields) o[f.key] = f.default
  return o
}

/**
 * Runs a calculator with the given inputs: a required field left out takes its default, an optional
 * one left out stays empty (so "give two of V, I, R, P" means exactly those two).
 */
export function runCalculator(id: string, inputs: Record<string, string>): CalcOutput {
  const c = calculatorById(id)
  if (!c) throw new Error(`There is no calculator “${id}”: ${CALCULATORS.map((x) => x.id).join(', ')}.`)
  const v = defaultInputs(c)
  for (const f of c.fields) if (f.optional) v[f.key] = ''
  return c.compute({ ...v, ...inputs })
}

/** Plain text of a result for the clipboard. */
export function resultText(o: CalcOutput): string {
  return [...o.rows.map((r) => `${r.label}: ${r.value}`), ...(o.notes ?? [])].join('\n')
}
