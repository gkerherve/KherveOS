// Small ANSI and text-width helpers shared by the shell, the line editor and
// the session. No DOM here.

export const RESET = '\x1b[0m'

const wrap = (open: string) => (s: string) => (s ? `\x1b[${open}m${s}${RESET}` : s)

/** Colours are ANSI palette entries, so they follow the theme when it changes. */
export const style = {
  bold: wrap('1'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  magenta: wrap('35'),
  cyan: wrap('36'),
  /** "Bright black", which the terminal maps to the theme's muted text colour. */
  muted: wrap('90'),
  boldRed: wrap('1;31'),
  boldGreen: wrap('1;32'),
  boldBlue: wrap('1;34'),
}

const ANSI_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

// ------------------------------------------------------------------ widths
// Mirrors xterm.js's default Unicode 6 width rules (UnicodeV6.ts, MIT), so
// the line editor and the terminal agree on where every character lands.

const BMP_COMBINING: [number, number][] = [
  [0x0300, 0x036f], [0x0483, 0x0486], [0x0488, 0x0489], [0x0591, 0x05bd], [0x05bf, 0x05bf], [0x05c1, 0x05c2],
  [0x05c4, 0x05c5], [0x05c7, 0x05c7], [0x0600, 0x0603], [0x0610, 0x0615], [0x064b, 0x065e], [0x0670, 0x0670],
  [0x06d6, 0x06e4], [0x06e7, 0x06e8], [0x06ea, 0x06ed], [0x070f, 0x070f], [0x0711, 0x0711], [0x0730, 0x074a],
  [0x07a6, 0x07b0], [0x07eb, 0x07f3], [0x0901, 0x0902], [0x093c, 0x093c], [0x0941, 0x0948], [0x094d, 0x094d],
  [0x0951, 0x0954], [0x0962, 0x0963], [0x0981, 0x0981], [0x09bc, 0x09bc], [0x09c1, 0x09c4], [0x09cd, 0x09cd],
  [0x09e2, 0x09e3], [0x0a01, 0x0a02], [0x0a3c, 0x0a3c], [0x0a41, 0x0a42], [0x0a47, 0x0a48], [0x0a4b, 0x0a4d],
  [0x0a70, 0x0a71], [0x0a81, 0x0a82], [0x0abc, 0x0abc], [0x0ac1, 0x0ac5], [0x0ac7, 0x0ac8], [0x0acd, 0x0acd],
  [0x0ae2, 0x0ae3], [0x0b01, 0x0b01], [0x0b3c, 0x0b3c], [0x0b3f, 0x0b3f], [0x0b41, 0x0b43], [0x0b4d, 0x0b4d],
  [0x0b56, 0x0b56], [0x0b82, 0x0b82], [0x0bc0, 0x0bc0], [0x0bcd, 0x0bcd], [0x0c3e, 0x0c40], [0x0c46, 0x0c48],
  [0x0c4a, 0x0c4d], [0x0c55, 0x0c56], [0x0cbc, 0x0cbc], [0x0cbf, 0x0cbf], [0x0cc6, 0x0cc6], [0x0ccc, 0x0ccd],
  [0x0ce2, 0x0ce3], [0x0d41, 0x0d43], [0x0d4d, 0x0d4d], [0x0dca, 0x0dca], [0x0dd2, 0x0dd4], [0x0dd6, 0x0dd6],
  [0x0e31, 0x0e31], [0x0e34, 0x0e3a], [0x0e47, 0x0e4e], [0x0eb1, 0x0eb1], [0x0eb4, 0x0eb9], [0x0ebb, 0x0ebc],
  [0x0ec8, 0x0ecd], [0x0f18, 0x0f19], [0x0f35, 0x0f35], [0x0f37, 0x0f37], [0x0f39, 0x0f39], [0x0f71, 0x0f7e],
  [0x0f80, 0x0f84], [0x0f86, 0x0f87], [0x0f90, 0x0f97], [0x0f99, 0x0fbc], [0x0fc6, 0x0fc6], [0x102d, 0x1030],
  [0x1032, 0x1032], [0x1036, 0x1037], [0x1039, 0x1039], [0x1058, 0x1059], [0x1160, 0x11ff], [0x135f, 0x135f],
  [0x1712, 0x1714], [0x1732, 0x1734], [0x1752, 0x1753], [0x1772, 0x1773], [0x17b4, 0x17b5], [0x17b7, 0x17bd],
  [0x17c6, 0x17c6], [0x17c9, 0x17d3], [0x17dd, 0x17dd], [0x180b, 0x180d], [0x18a9, 0x18a9], [0x1920, 0x1922],
  [0x1927, 0x1928], [0x1932, 0x1932], [0x1939, 0x193b], [0x1a17, 0x1a18], [0x1b00, 0x1b03], [0x1b34, 0x1b34],
  [0x1b36, 0x1b3a], [0x1b3c, 0x1b3c], [0x1b42, 0x1b42], [0x1b6b, 0x1b73], [0x1dc0, 0x1dca], [0x1dfe, 0x1dff],
  [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2063], [0x206a, 0x206f], [0x20d0, 0x20ef], [0x302a, 0x302f],
  [0x3099, 0x309a], [0xa806, 0xa806], [0xa80b, 0xa80b], [0xa825, 0xa826], [0xfb1e, 0xfb1e], [0xfe00, 0xfe0f],
  [0xfe20, 0xfe23], [0xfeff, 0xfeff], [0xfff9, 0xfffb],
]
const HIGH_COMBINING: [number, number][] = [
  [0x10a01, 0x10a03], [0x10a05, 0x10a06], [0x10a0c, 0x10a0f], [0x10a38, 0x10a3a], [0x10a3f, 0x10a3f],
  [0x1d167, 0x1d169], [0x1d173, 0x1d182], [0x1d185, 0x1d18b], [0x1d1aa, 0x1d1ad], [0x1d242, 0x1d244],
  [0xe0001, 0xe0001], [0xe0020, 0xe007f], [0xe0100, 0xe01ef],
]

function inRanges(cp: number, ranges: [number, number][]): boolean {
  let lo = 0
  let hi = ranges.length - 1
  if (cp < ranges[0][0] || cp > ranges[hi][1]) return false
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cp > ranges[mid][1]) lo = mid + 1
    else if (cp < ranges[mid][0]) hi = mid - 1
    else return true
  }
  return false
}

/** Terminal columns taken by one code point: 0, 1 or 2. */
export function wcwidth(cp: number): number {
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0
  if (cp < 0x300) return 1
  if (cp < 0x10000) {
    if (inRanges(cp, BMP_COMBINING)) return 0
    if (
      (cp >= 0x1100 && cp < 0x1160) ||
      cp === 0x2329 || cp === 0x232a ||
      (cp >= 0x2e80 && cp < 0xa4d0 && cp !== 0x303f) ||
      (cp >= 0xac00 && cp < 0xd7a4) ||
      (cp >= 0xf900 && cp < 0xfb00) ||
      (cp >= 0xfe10 && cp < 0xfe1a) ||
      (cp >= 0xfe30 && cp < 0xfe70) ||
      (cp >= 0xff00 && cp < 0xff61) ||
      (cp >= 0xffe0 && cp < 0xffe7)
    ) return 2
    return 1
  }
  if (inRanges(cp, HIGH_COMBINING)) return 0
  if ((cp >= 0x20000 && cp <= 0x2fffd) || (cp >= 0x30000 && cp <= 0x3fffd)) return 2
  return 1
}

/** Columns taken by a string without escape sequences. */
export function strWidth(s: string): number {
  let w = 0
  for (const ch of s) w += wcwidth(ch.codePointAt(0)!)
  return w
}

/** Visible width of a string that may contain colour codes. */
export const visibleWidth = (s: string) => strWidth(stripAnsi(s))

/** Pad (possibly coloured) text with spaces to `width` columns. */
export function padEnd(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - visibleWidth(s)))
}

export function padStart(s: string, width: number): string {
  return ' '.repeat(Math.max(0, width - visibleWidth(s))) + s
}

/**
 * Lay items out in columns, top to bottom then left to right, like `ls`.
 * Items may contain colour codes. Returns lines ending with "\n".
 */
export function columns(items: string[], width: number, gap = 2): string {
  if (!items.length) return ''
  const widths = items.map(visibleWidth)
  let layout = { cols: 1, rows: items.length, colWidths: [Math.max(...widths)] }
  const narrowest = Math.min(...widths)
  for (let c = Math.min(items.length, Math.floor((width + gap) / (narrowest + gap))); c > 1; c--) {
    const rows = Math.ceil(items.length / c)
    const used = Math.ceil(items.length / rows)
    const colWidths: number[] = []
    for (let k = 0; k < used; k++) colWidths.push(Math.max(...widths.slice(k * rows, (k + 1) * rows)))
    if (colWidths.reduce((a, b) => a + b, 0) + gap * (used - 1) <= width) {
      layout = { cols: used, rows, colWidths }
      break
    }
  }
  const lines: string[] = []
  for (let r = 0; r < layout.rows; r++) {
    let line = ''
    for (let k = 0; k < layout.cols; k++) {
      const i = k * layout.rows + r
      if (i >= items.length) break
      const last = k === layout.cols - 1 || (k + 1) * layout.rows + r >= items.length
      line += last ? items[i] : items[i] + ' '.repeat(layout.colWidths[k] - widths[i] + gap)
    }
    lines.push(line)
  }
  return lines.join('\n') + '\n'
}
