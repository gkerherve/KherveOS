// Where the desktop icons sit, like the macOS Finder desktop: icons can be
// dragged anywhere, snap to a grid (on by default), and "Clean Up" / "Sort By"
// put them back in tidy columns filling from the top-right corner.
//
// Positions are measured from the icon area's top-RIGHT corner (x = distance
// from the right edge, y = from the top), so icons stay by the right edge when
// the screen gets wider or narrower. Pure functions only (tested with node --test).

export interface Pos {
  x: number
  y: number
}

export interface Area {
  w: number
  h: number
}

/** One grid cell: an icon (92 × 100) plus the gap. */
export const CELL_W = 96
export const CELL_H = 104
export const ICON_W = 92
export const ICON_H = 100
/** The icon area's padding: icons start this far from its top and right edges. */
export const PAD_X = 14
export const PAD_Y = 12

export const cellPos = (col: number, row: number): Pos => ({ x: PAD_X + col * CELL_W, y: PAD_Y + row * CELL_H })

/** How many rows and columns fit in the area (at least one of each). */
export function gridSize(area: Area): { cols: number; rows: number } {
  return {
    cols: Math.max(1, Math.floor((area.w - PAD_X * 2 + (CELL_W - ICON_W)) / CELL_W)),
    rows: Math.max(1, Math.floor((area.h - PAD_Y * 2 + (CELL_H - ICON_H)) / CELL_H)),
  }
}

const cellKey = (c: number, r: number) => `${c},${r}`

/** The grid cell nearest to a position (may lie outside the area). */
export function nearestCell(p: Pos): { col: number; row: number } {
  return { col: Math.max(0, Math.round((p.x - PAD_X) / CELL_W)), row: Math.max(0, Math.round((p.y - PAD_Y) / CELL_H)) }
}

/** Cells in reading order for the desktop: down each column, columns from the right. */
function* cellsInOrder(rows: number): Generator<{ col: number; row: number }> {
  for (let col = 0; ; col++) for (let row = 0; row < rows; row++) yield { col, row }
}

/** The free cell closest to (col, row), searching outwards ring by ring. */
export function nearestFree(col: number, row: number, taken: Set<string>, grid: { cols: number; rows: number }) {
  const cols = Math.max(grid.cols, col + 1)
  const rows = grid.rows
  row = Math.min(row, rows - 1)
  let best: { col: number; row: number } | null = null
  let bestD = Infinity
  for (let ring = 0; ring <= cols + rows; ring++) {
    for (let c = Math.max(0, col - ring); c <= col + ring; c++) {
      for (let r = Math.max(0, row - ring); r <= Math.min(rows - 1, row + ring); r++) {
        if (Math.max(Math.abs(c - col), Math.abs(r - row)) !== ring || taken.has(cellKey(c, r))) continue
        const d = (c - col) ** 2 + (r - row) ** 2
        if (d < bestD) {
          bestD = d
          best = { col: c, row: r }
        }
      }
    }
    if (best) return best
  }
  // Every cell in the area is taken: carry on in new columns to the left.
  for (const cell of cellsInOrder(rows)) if (!taken.has(cellKey(cell.col, cell.row))) return cell
  return { col: 0, row: 0 }
}

/** Keep a position inside the area (an icon never ends up off screen). */
export function clampPos(p: Pos, area: Area): Pos {
  return {
    x: Math.round(Math.min(Math.max(p.x, 0), Math.max(0, area.w - ICON_W))),
    y: Math.round(Math.min(Math.max(p.y, 0), Math.max(0, area.h - ICON_H))),
  }
}

/**
 * Where every icon goes: icons with a saved position keep it (kept inside the
 * area); new ones take the first free cells, column by column from the top right.
 */
export function layout(keys: string[], saved: Record<string, Pos>, area: Area): Record<string, Pos> {
  const grid = gridSize(area)
  const out: Record<string, Pos> = {}
  const taken = new Set<string>()
  for (const k of keys) {
    const p = saved[k]
    if (!p) continue
    out[k] = clampPos(p, area)
    const c = nearestCell(out[k])
    taken.add(cellKey(c.col, c.row))
  }
  const cells = cellsInOrder(grid.rows)
  for (const k of keys) {
    if (out[k]) continue
    let cell = cells.next().value!
    while (taken.has(cellKey(cell.col, cell.row))) cell = cells.next().value!
    taken.add(cellKey(cell.col, cell.row))
    out[k] = cellPos(cell.col, cell.row)
  }
  return out
}

/** Icons in the order they are read on the desktop: by column from the right, then top to bottom. */
export function readingOrder(keys: string[], pos: Record<string, Pos>): string[] {
  const at = (k: string) => nearestCell(pos[k] ?? { x: 0, y: 0 })
  return [...keys].sort((a, b) => {
    const ca = at(a)
    const cb = at(b)
    return ca.col - cb.col || ca.row - cb.row || (pos[a]?.x ?? 0) - (pos[b]?.x ?? 0) || (pos[a]?.y ?? 0) - (pos[b]?.y ?? 0)
  })
}

/** Clean Up: every icon moves to the nearest free grid cell (those closest to the grid first). */
export function cleanUp(keys: string[], pos: Record<string, Pos>, area: Area): Record<string, Pos> {
  const grid = gridSize(area)
  const off = (k: string) => {
    const p = pos[k]
    const c = nearestCell(p)
    const g = cellPos(c.col, c.row)
    return Math.hypot(p.x - g.x, p.y - g.y)
  }
  const taken = new Set<string>()
  const out: Record<string, Pos> = {}
  for (const k of [...keys].filter((k) => pos[k]).sort((a, b) => off(a) - off(b))) {
    const want = nearestCell(pos[k])
    const c = nearestFree(want.col, want.row, taken, grid)
    taken.add(cellKey(c.col, c.row))
    out[k] = cellPos(c.col, c.row)
  }
  return out
}

/** Sort By: the icons in this order fill the grid column by column from the top right. */
export function arrangeInOrder(keys: string[], area: Area): Record<string, Pos> {
  const { rows } = gridSize(area)
  const out: Record<string, Pos> = {}
  keys.forEach((k, i) => (out[k] = cellPos(Math.floor(i / rows), i % rows)))
  return out
}

/**
 * Move dragged icons by (dx, dy) — dx positive to the right, in screen terms —
 * keeping their arrangement. With snap, each lands on the nearest free cell
 * (cells of the icons that stay put are not free).
 */
export function moveIcons(
  moved: string[],
  dx: number,
  dy: number,
  pos: Record<string, Pos>,
  area: Area,
  snap: boolean,
): Record<string, Pos> {
  const out = { ...pos }
  const set = new Set(moved.filter((k) => pos[k]))
  if (!snap) {
    for (const k of set) out[k] = clampPos({ x: pos[k].x - dx, y: pos[k].y + dy }, area)
    return out
  }
  const grid = gridSize(area)
  const taken = new Set<string>()
  for (const [k, p] of Object.entries(pos)) {
    if (set.has(k)) continue
    const c = nearestCell(p)
    taken.add(cellKey(c.col, c.row))
  }
  for (const k of set) {
    const want = nearestCell(clampPos({ x: pos[k].x - dx, y: pos[k].y + dy }, area))
    const c = nearestFree(Math.min(want.col, grid.cols - 1), want.row, taken, grid)
    taken.add(cellKey(c.col, c.row))
    out[k] = cellPos(c.col, c.row)
  }
  return out
}

export type SortKey = 'name' | 'kind' | 'date'

export interface SortItem {
  key: string
  name: string
  /** "Application", "Folder", or the file's extension. */
  kind: string
  /** Last modified (ms); apps have none. */
  date: number
}

/** Order for Sort By, like the Finder: Name A→Z; Kind (then name); Date newest first. */
export function sortItems(items: SortItem[], by: SortKey): string[] {
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  const byName = (a: SortItem, b: SortItem) => coll.compare(a.name, b.name)
  const cmp =
    by === 'name'
      ? byName
      : by === 'kind'
        ? (a: SortItem, b: SortItem) => coll.compare(a.kind, b.kind) || byName(a, b)
        : (a: SortItem, b: SortItem) => b.date - a.date || byName(a, b)
  return [...items].sort(cmp).map((i) => i.key)
}
