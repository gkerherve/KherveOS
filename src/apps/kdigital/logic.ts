// Four-valued logic (0, 1, X unknown, Z high impedance) used by the simulator. Pure.

/** 0, 1, 2 = X (unknown), 3 = Z (high impedance). Plain numbers so that arrays of values stay fast. */
export type V = 0 | 1 | 2 | 3
export const X: V = 2
export const Z: V = 3

export const vchar = (v: V): string => (v === 0 ? '0' : v === 1 ? '1' : v === 2 ? 'X' : 'Z')

export function vparse(c: string | number | boolean): V {
  if (c === true || c === 1 || c === '1') return 1
  if (c === false || c === 0 || c === '0') return 0
  const s = String(c).trim().toUpperCase()
  if (s === 'Z') return 3
  if (s === 'X' || s === 'U') return 2
  if (s === '1' || s === 'H' || s === 'TRUE') return 1
  if (s === '0' || s === 'L' || s === 'FALSE') return 0
  return 2
}

/** A value read by a gate: Z is seen as unknown. */
export const sense = (v: V): V => (v === 3 ? 2 : v)

export function vnot(a: V): V {
  return a === 0 ? 1 : a === 1 ? 0 : 2
}

export function vand(vs: readonly V[]): V {
  let unknown = false
  for (const v of vs) {
    if (v === 0) return 0
    if (v !== 1) unknown = true
  }
  return unknown ? 2 : 1
}

export function vor(vs: readonly V[]): V {
  let unknown = false
  for (const v of vs) {
    if (v === 1) return 1
    if (v !== 0) unknown = true
  }
  return unknown ? 2 : 0
}

export function vxor(vs: readonly V[]): V {
  let n = 0
  for (const v of vs) {
    if (v > 1) return 2
    n ^= v
  }
  return n as V
}

/** What a net shows when several outputs drive it: Z gives way, equal values agree, anything else is X. */
export function resolve(drivers: readonly V[]): V {
  let out: V = 3
  for (const v of drivers) {
    if (v === 3) continue
    if (out === 3) out = v
    else if (out !== v) return 2
  }
  return out
}

/** Bits (LSB first) of a number, as values. */
export function bitsOf(n: number, width: number): V[] {
  const out: V[] = []
  for (let i = 0; i < width; i++) out.push(((n >> i) & 1) as V)
  return out
}

/** The number a list of bits (LSB first) shows, or null when a bit is X or Z. */
export function numberOf(bits: readonly V[]): number | null {
  let n = 0
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] > 1) return null
    n += bits[i] * 2 ** i
  }
  return n
}
