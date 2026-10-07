// How big the periodic table's tiles can be in the main column. Kept apart
// from the component so a plain Node script can check it.

export interface TableLayout {
  /** Tile width and height, px. */
  tw: number
  th: number
  /** Tiles too small for the small labels: symbol only. */
  dense: boolean
  /** A low window: the search bar drops its labels (the boxes keep placeholders). */
  short: boolean
  /** A narrow main column: shorter button labels. */
  narrow: boolean
}

// The main column's geometry, in px (kept in step with khervedb.css).
const MAIN_PAD = 10
const SECTION_GAP = 8
const PT_PAD = 7 // the periodic table's padding + border
const PT_GAP = 2
const PT_SEP = 8 // the gap above the lanthanides

/**
 * Tile size for the room the main column has (its client size, padding
 * included): wide windows get wider tiles, and the height is shared so the
 * results table keeps about a third of it.
 */
export function tableLayout(clientW: number, clientH: number): TableLayout {
  if (!clientW || !clientH) return { tw: 40, th: 40, dense: false, short: false, narrow: false }
  const w = clientW - 2 * MAIN_PAD - 1 // a pixel spare, so rounding never brings a scroll bar
  const h = clientH - 2 * MAIN_PAD
  const short = h < 540
  const searchH = short ? 50 : 67
  const free = h - searchH - 2 * SECTION_GAP
  const resultsMin = Math.max(140, Math.round(free * 0.36))
  const byH = (free - resultsMin - 2 * PT_PAD - 9 * PT_GAP - PT_SEP) / 9
  const byW = (w - 2 * PT_PAD - 17 * PT_GAP) / 18
  const th = Math.max(18, Math.min(60, Math.floor(Math.min(byH, byW))))
  const tw = Math.max(th, Math.min(Math.floor(byW), Math.round(th * 1.3), 72))
  return { tw, th, dense: th < 36, short, narrow: w < 840 }
}
