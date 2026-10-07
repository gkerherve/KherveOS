// Cell colours on the dark grid.
//
// Workbooks are coloured for white paper (the desktop draws white cells):
// black text, pale fills, dark grey borders. On KherveOS's black grid each
// colour is adapted when drawn, the way dark-mode spreadsheets do it: pale
// fills turn deep (same hue), and text and borders are brightened only as
// much as they need to stay readable on what is under them. The file keeps
// the original colours.

type Rgb = [number, number, number]

function parse(color: string): Rgb | null {
  let s = color.trim().toLowerCase()
  if (s.startsWith('#')) s = s.slice(1)
  if (/^[0-9a-f]{3}$/.test(s)) s = s.split('').map((ch) => ch + ch).join('')
  if (/^[0-9a-f]{8}$/.test(s)) s = s.slice(2) // AARRGGBB from Excel
  if (!/^[0-9a-f]{6}$/.test(s)) return NAMED[s] ?? null
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}

const NAMED: Record<string, Rgb> = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255],
  yellow: [255, 255, 0], gray: [128, 128, 128], grey: [128, 128, 128], orange: [255, 165, 0],
}

const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  h /= 6
  return [h, s, l]
}

function fromHsl(h: number, s: number, l: number): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]
}

function luminance([r, g, b]: Rgb): number {
  const ch = (v: number) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const cache = new Map<string, string | null>()

function memo(id: string, make: () => string | null): string | null {
  let v = cache.get(id)
  if (v === undefined) {
    v = make()
    if (cache.size > 4000) cache.clear()
    cache.set(id, v)
  }
  return v
}

/**
 * A cell fill for the dark grid: null for white (paper, no fill), pale
 * colours made deep with the same hue, dark fills kept.
 */
export function adaptFill(color: string | undefined): string | null {
  if (!color) return null
  return memo(`f${color}`, () => {
    const rgb = parse(color)
    if (!rgb) return null
    const [h, s, l] = toHsl(rgb)
    if (l >= 0.97 && s < 0.5) return null
    if (l <= 0.45) return hex(rgb)
    const dark = Math.min(0.42, Math.max(0.12, 1 - l))
    return hex(fromHsl(h, Math.min(s, 0.85), dark))
  })
}

/** Lighten (or darken) `color` until it reads on `bg` with at least `ratio`. */
function readable(rgb: Rgb, bg: Rgb, ratio: number): Rgb {
  if (contrast(rgb, bg) >= ratio) return rgb
  const [h, s, l0] = toHsl(rgb)
  const up = luminance(bg) < 0.4
  for (let i = 1; i <= 40; i++) {
    const l = up ? l0 + ((1 - l0) * i) / 40 : l0 - (l0 * i) / 40
    const c = fromHsl(h, s, l)
    if (contrast(c, bg) >= ratio) return c
  }
  return up ? [255, 255, 255] : [0, 0, 0]
}

/** Text colour on a cell background (both as drawn). */
export function adaptText(color: string | undefined, bg: string, fallback: string): string {
  if (!color) return fallback
  return memo(`t${color}|${bg}`, () => {
    const rgb = parse(color)
    const back = parse(bg)
    if (!rgb || !back) return fallback
    return hex(readable(rgb, back, 4.6))
  }) ?? fallback
}

/** A border colour that still shows on the cell background. */
export function adaptBorder(color: string | undefined, bg: string): string {
  const c = color || '#000000'
  return memo(`b${c}|${bg}`, () => {
    const rgb = parse(c)
    const back = parse(bg)
    if (!rgb || !back) return c
    return hex(readable(rgb, back, 2.6))
  }) ?? c
}

/** An rgba() of a colour (selection tints, highlights). */
export function withAlpha(color: string, alpha: number): string {
  const rgb = parse(color)
  if (!rgb) return color
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}

/** The palette offered by the fill / font colour buttons (the desktop's, Office-like). */
export const PALETTE: string[][] = [
  ['#ffffff', '#000000', '#e7e6e6', '#44546a', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'],
  ['#f2f2f2', '#7f7f7f', '#d0cece', '#d6dce4', '#d9e2f3', '#fbe5d5', '#ededed', '#fff2cc', '#deebf6', '#e2efd9'],
  ['#d8d8d8', '#595959', '#aeabab', '#adb9ca', '#b4c6e7', '#f7cbac', '#dbdbdb', '#fee599', '#bdd7ee', '#c5e0b3'],
  ['#bfbfbf', '#3f3f3f', '#757070', '#8496b0', '#8eaadb', '#f4b183', '#c9c9c9', '#ffd965', '#9cc3e5', '#a8d08d'],
  ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'],
]
