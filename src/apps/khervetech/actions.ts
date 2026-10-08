// The `run` actions of a technique app's AI tools: which controls of the
// desktop's analysis window to set and which handler to call — the same
// handler the button runs (ktech/project.py `drive`). No browser or OS
// imports: Node tests load this file.

export interface RunArgs {
  low?: number
  high?: number
  options: Record<string, unknown>
}

export interface ActionDef {
  /** The handler of the window (e.g. "on_fit_bet"), or which one for these arguments; none: only read. */
  call?: string | ((a: RunArgs) => string)
  /** low / high are the red range lines (the sheet's Bkg Low / Bkg High). */
  range?: boolean
  /** The window's controls to set first, by attribute name. */
  set?: (a: RunArgs) => Record<string, unknown>
  /** Controls to read back (result boxes, tables). */
  read: string[]
}

export type ActionTable = Record<string, ActionDef>

/** A number option, or undefined. */
export function optNum(o: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  }
  return undefined
}

/** A text option, or undefined. */
export function optStr(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return undefined
}

/** Only the entries that are set. */
export function defined(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
}

/** A list option ("310, 480" or [310, 480]) as the comma text the desktop's boxes take. */
export function optList(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key]
  if (Array.isArray(v)) return v.join(', ')
  return optStr(o, key)
}
