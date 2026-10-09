// Karnaugh maps for 2–5 variables: the layout (Gray-coded rows and columns, two layers for five variables),
// the groups of a cover as rectangles (with the wrap-around pieces), and the static-1 hazard check of a cover. Pure.

import { implicantBits, minimize, type Implicant, type MinResult } from './qmc.ts'
import type { Cell } from './truth.ts'

const GRAY: Record<number, number[]> = { 0: [0], 1: [0, 1], 2: [0, 1, 3, 2] }

export interface KmapLayout {
  n: number
  vars: string[]
  layerVars: string[]
  rowVars: string[]
  colVars: string[]
  layers: number
  rows: number
  cols: number
  /** Gray-coded values of the row / column variables, in drawing order. */
  rowCodes: number[]
  colCodes: number[]
  /** "01" style labels */
  rowLabels: string[]
  colLabels: string[]
  /** minterm index of (layer, row, col) */
  cell(layer: number, row: number, col: number): number
  /** inverse of cell */
  where(m: number): { layer: number; row: number; col: number }
}

const bin = (x: number, bits: number): string => (bits === 0 ? '' : x.toString(2).padStart(bits, '0'))

export function kmapLayout(vars: readonly string[]): KmapLayout {
  const n = vars.length
  if (n < 2 || n > 5) throw new Error('Karnaugh maps are drawn for 2 to 5 variables.')
  const layerBits = n === 5 ? 1 : 0
  const rowBits = n === 2 ? 1 : n === 3 ? 1 : n === 4 ? 2 : 2
  const colBits = n - layerBits - rowBits
  const rowCodes = GRAY[rowBits]
  const colCodes = GRAY[colBits]
  const cell = (layer: number, row: number, col: number) => (layer << (rowBits + colBits)) | (rowCodes[row] << colBits) | colCodes[col]
  const where = (m: number) => {
    const layer = m >> (rowBits + colBits)
    const rc = (m >> colBits) & ((1 << rowBits) - 1)
    const cc = m & ((1 << colBits) - 1)
    return { layer, row: rowCodes.indexOf(rc), col: colCodes.indexOf(cc) }
  }
  return {
    n, vars: [...vars],
    layerVars: vars.slice(0, layerBits), rowVars: vars.slice(layerBits, layerBits + rowBits), colVars: vars.slice(layerBits + rowBits),
    layers: 1 << layerBits, rows: 1 << rowBits, cols: 1 << colBits, rowCodes, colCodes,
    rowLabels: rowCodes.map((c) => bin(c, rowBits)), colLabels: colCodes.map((c) => bin(c, colBits)), cell, where,
  }
}

export interface GroupRect {
  layer: number
  r0: number
  r1: number
  c0: number
  c1: number
  /** Which borders are left open because the group continues on the opposite edge of the map. */
  openTop: boolean
  openBottom: boolean
  openLeft: boolean
  openRight: boolean
}

/** A cyclic interval of a ring of `size` positions covering exactly the sorted indices, as at most two pieces. */
function ringPieces(indices: number[], size: number): { a: number; b: number; openStart: boolean; openEnd: boolean }[] {
  if (indices.length >= size) return [{ a: 0, b: size - 1, openStart: false, openEnd: false }]
  const set = new Set(indices)
  let start = indices[0]
  for (const i of indices) if (!set.has((i - 1 + size) % size)) { start = i; break }
  const len = indices.length
  if (start + len <= size) return [{ a: start, b: start + len - 1, openStart: false, openEnd: false }]
  return [
    { a: start, b: size - 1, openStart: false, openEnd: true },
    { a: 0, b: start + len - 1 - size, openStart: true, openEnd: false },
  ]
}

/** The rectangles that draw an implicant's group on the map. */
export function groupRects(imp: Implicant, layout: KmapLayout): GroupRect[] {
  const out: GroupRect[] = []
  const byLayer = new Map<number, Set<number>>()
  for (const m of imp.minterms) {
    const w = layout.where(m)
    if (!byLayer.has(w.layer)) byLayer.set(w.layer, new Set())
    byLayer.get(w.layer)!.add(w.row * 16 + w.col)
  }
  for (const [layer, cells] of byLayer) {
    const rows = [...new Set([...cells].map((c) => Math.floor(c / 16)))].sort((a, b) => a - b)
    const cols = [...new Set([...cells].map((c) => c % 16))].sort((a, b) => a - b)
    for (const rp of ringPieces(rows, layout.rows)) {
      for (const cp of ringPieces(cols, layout.cols)) {
        out.push({ layer, r0: rp.a, r1: rp.b, c0: cp.a, c1: cp.b, openTop: rp.openStart, openBottom: rp.openEnd, openLeft: cp.openStart, openRight: cp.openEnd })
      }
    }
  }
  return out
}

export interface KmapGroup {
  implicant: Implicant
  bits: string
  rects: GroupRect[]
  /** only the on-set cells of the group */
  size: number
}

export function kmapGroups(cover: readonly Implicant[], layout: KmapLayout): KmapGroup[] {
  return cover.map((implicant) => ({ implicant, bits: implicantBits(implicant, layout.n), rects: groupRects(implicant, layout), size: implicant.minterms.length }))
}

// ------------------------------------------------------------------------------ hazards

export interface Hazard {
  /** two adjacent on-set minterms that no single term of the cover contains */
  a: number
  b: number
  /** the variable that changes between them */
  variable: string
  /** a prime implicant that covers both (the consensus term that removes the hazard) */
  fix: Implicant | null
}

const covers = (i: Implicant, m: number) => (m & ~i.mask) === i.value

/** Static-1 hazards of a two-level AND-OR realisation of `cover`: pairs of neighbouring 1s that sit in different terms. */
export function staticOneHazards(res: MinResult, vars: readonly string[], cover: readonly Implicant[] = res.cover): Hazard[] {
  const out: Hazard[] = []
  const n = res.n
  for (const a of res.on) {
    for (let bit = 0; bit < n; bit++) {
      const b = a ^ (1 << bit)
      if (b < a || !res.on.includes(b)) continue
      if (cover.some((i) => covers(i, a) && covers(i, b))) continue
      const fix = res.primes.find((p) => covers(p, a) && covers(p, b)) ?? null
      out.push({ a: Math.min(a, b), b: Math.max(a, b), variable: vars[n - 1 - bit], fix })
    }
  }
  return out
}

/** The cover plus the consensus terms that remove every static-1 hazard. */
export function hazardFreeCover(res: MinResult, vars: readonly string[]): { cover: Implicant[]; added: Implicant[]; hazards: Hazard[] } {
  const hazards = staticOneHazards(res, vars)
  const cover = [...res.cover]
  const added: Implicant[] = []
  for (const h of hazards) {
    if (h.fix && !cover.includes(h.fix) && !cover.some((i) => i.mask === h.fix!.mask && i.value === h.fix!.value)) { cover.push(h.fix); added.push(h.fix) }
  }
  return { cover, added, hazards }
}

/** A plain-language note about hazards for the minimal cover. */
export function hazardNote(res: MinResult, vars: readonly string[], termText: (i: Implicant) => string): string {
  const h = staticOneHazards(res, vars)
  if (res.on.length === 0 || res.cover.length === 0) return 'The function is constant: there is nothing to glitch.'
  if (h.length === 0) return 'This cover is free of static-1 hazards: every pair of neighbouring 1s shares a term.'
  const added = hazardFreeCover(res, vars).added
  const first = h[0]
  return `Static-1 hazard: when ${first.variable} changes between minterms ${first.a} and ${first.b}, no single term holds the output at 1. ` +
    `Add the redundant (consensus) term${added.length > 1 ? 's' : ''} ${added.map(termText).join(', ')} to make the cover hazard-free.`
}

// ------------------------------------------------------------------------------ whole map

export interface KmapCells {
  layout: KmapLayout
  /** cells[layer][row][col] */
  cells: { m: number; v: Cell }[][][]
}

export function kmapCells(vars: readonly string[], values: readonly Cell[]): KmapCells {
  const layout = kmapLayout(vars)
  const cells: KmapCells['cells'] = []
  for (let l = 0; l < layout.layers; l++) {
    const grid: { m: number; v: Cell }[][] = []
    for (let r = 0; r < layout.rows; r++) {
      const row: { m: number; v: Cell }[] = []
      for (let c = 0; c < layout.cols; c++) { const m = layout.cell(l, r, c); row.push({ m, v: values[m] ?? 0 }) }
      grid.push(row)
    }
    cells.push(grid)
  }
  return { layout, cells }
}

/** Minimise straight from a table column (convenience for the tab and the tests). */
export function minimizeValues(n: number, values: readonly Cell[]): MinResult {
  return minimize(n, values.flatMap((x, i) => (x === 1 ? [i] : [])), values.flatMap((x, i) => (x === 2 ? [i] : [])))
}
