// Terminal colours from the KherveOS theme. Background, text, cursor and
// selection come from the theme's CSS variables; the 16 ANSI colours are a
// palette tuned for light or dark backgrounds, with "bright black" set to
// the theme's muted text so dimmed output always matches the theme.

import type { ITheme } from '@xterm/xterm'

type Rgba = [number, number, number, number]

// One Dark–like colours for dark themes, GitHub-like ones for light themes.
const DARK_ANSI: ITheme = {
  black: '#3f4451',
  red: '#ef6b73',
  green: '#8cc97a',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#dcdfe4',
  brightRed: '#ff8a91',
  brightGreen: '#a5e08f',
  brightYellow: '#f0d08a',
  brightBlue: '#8ac6ff',
  brightMagenta: '#d99bf0',
  brightCyan: '#7fd1db',
  brightWhite: '#ffffff',
}

const LIGHT_ANSI: ITheme = {
  black: '#24292f',
  red: '#c4262e',
  green: '#1a7f37',
  yellow: '#9a6700',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightRed: '#a40e26',
  brightGreen: '#116329',
  brightYellow: '#7d4e00',
  brightBlue: '#0550ae',
  brightMagenta: '#6639ba',
  brightCyan: '#136061',
  brightWhite: '#57606a',
}

const num = (s: string, pct: string | undefined, scale: number) => (pct ? (parseFloat(s) / 100) * scale : parseFloat(s))

/** Parse the colour forms browsers hand back: #hex, rgb()/rgba() and color(srgb …). */
function parseColor(value: string): Rgba | null {
  const s = value.trim().toLowerCase()
  let m = /^#([0-9a-f]{3,8})$/.exec(s)
  if (m) {
    const h = m[1]
    if (h.length === 3 || h.length === 4) {
      const v = [...h].map((c) => parseInt(c + c, 16))
      return [v[0], v[1], v[2], h.length === 4 ? v[3] / 255 : 1]
    }
    if (h.length === 6 || h.length === 8) {
      const v = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2) || 'ff', 16))
      return [v[0], v[1], v[2], v[3] / 255]
    }
    return null
  }
  m = /^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)\s*(?:[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(s)
  if (m) {
    return [num(m[1], m[2], 255), num(m[3], m[4], 255), num(m[5], m[6], 255), m[7] === undefined ? 1 : num(m[7], m[8], 1)]
  }
  m = /^color\(srgb\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/.exec(s)
  if (m) {
    return [parseFloat(m[1]) * 255, parseFloat(m[2]) * 255, parseFloat(m[3]) * 255, m[4] === undefined ? 1 : num(m[4], m[5], 1)]
  }
  return null
}

let probe: HTMLSpanElement | null = null

/** Let the browser resolve what we cannot parse ourselves (color-mix(), names…). */
function computedColor(value: string): string {
  if (!probe) {
    probe = document.createElement('span')
    probe.style.display = 'none'
    document.body.appendChild(probe)
  }
  probe.style.color = ''
  probe.style.color = value
  return probe.style.color ? getComputedStyle(probe).color : ''
}

function resolveColor(value: string): Rgba | null {
  if (!value) return null
  return parseColor(value) ?? parseColor(computedColor(value))
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
const hex = (c: Rgba) => '#' + c.slice(0, 3).map((v) => clamp(v).toString(16).padStart(2, '0')).join('')
const withAlpha = (c: Rgba, a: number) => `rgba(${clamp(c[0])}, ${clamp(c[1])}, ${clamp(c[2])}, ${a})`

/**
 * The xterm.js theme for the current KherveOS theme (call after the theme's
 * variables are applied). The variables are read from `el` so a window that
 * overrides them (an app kept light in dark mode) gets its own colours; with
 * no override they are the ones on <html>.
 */
export function terminalTheme(dark: boolean, el: Element = document.documentElement): ITheme {
  const root = getComputedStyle(el)
  const read = (name: string, fallback: string): Rgba =>
    resolveColor(root.getPropertyValue(name).trim()) ?? parseColor(fallback)!
  const bg = read('--k-bg', dark ? '#1e1e22' : '#ffffff')
  const fg = read('--k-text', dark ? '#d4d4d4' : '#1c1c1c')
  const accent = read('--k-accent', dark ? '#4488cc' : '#1f63c6')
  const selection = read('--k-selection', dark ? '#2a5588' : '#c4d9f3')
  const muted = read('--k-muted', dark ? '#8090a8' : '#666666')
  return {
    ...(dark ? DARK_ANSI : LIGHT_ANSI),
    // Transparent: the Terminal's window is see-through (allowTransparency).
    background: 'rgba(0, 0, 0, 0)',
    foreground: hex(fg),
    cursor: hex(accent),
    cursorAccent: hex(bg),
    selectionBackground: hex(selection),
    selectionInactiveBackground: withAlpha(selection, 0.6),
    brightBlack: hex(muted),
    scrollbarSliderBackground: withAlpha(fg, 0.18),
    scrollbarSliderHoverBackground: withAlpha(fg, 0.32),
    scrollbarSliderActiveBackground: withAlpha(fg, 0.42),
  }
}

/** The OS monospace font stack (--k-mono). */
export function monoFont(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--k-mono').trim() || 'Menlo, Consolas, monospace'
}
