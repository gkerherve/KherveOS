// The desktop's keyboard and plot-limit rules (KherveFitting-AI dev-AI):
// libraries/On_Key_Defs.py (KeyEventHandlers.on_key_press_global and its
// helpers), PlotConfig.adjust_plot_limits / x_axis_step / intensity_step,
// the Fitting window's Up / Down digit stepping (FittingWindow.on_key_down)
// and the Shift+click background offset (On_Mouse_Defs.on_click). Pure
// functions, no browser or OS imports, so Node tests can load this file.

export interface Limits {
  xmin: number
  xmax: number
  ymin: number
  ymax: number
}

/** PlotConfig.x_axis_step: a zoom / pan / edge step scaled to what is on screen. */
export function xAxisStep(l: Limits, fraction = 0.02, minimum = 0.2): number {
  const span = Math.abs(l.xmax - l.xmin)
  return Number.isFinite(span) ? Math.max(span * fraction, minimum) : minimum
}

/** PlotConfig.intensity_step: a fraction of the tallest point (or of the y span when that is not positive). */
export function intensityStep(ys: readonly (number | null)[], l: Limits, fraction: number): number {
  let peak = -Infinity
  for (const v of ys) if (v !== null && Number.isFinite(v)) peak = Math.max(peak, v)
  if (!Number.isFinite(peak) || peak <= 0) peak = Math.abs(l.ymax - l.ymin)
  if (!Number.isFinite(peak) || peak <= 0) peak = 1
  return fraction * peak
}

export type EdgeAxis = 'high_be' | 'low_be' | 'high_int' | 'low_int'

/**
 * PlotConfig.adjust_plot_limits (single plot): the vertical toolbar's eight
 * arrows and Shift+Left / Shift+Right. `forward` is false for the reversed
 * binding-energy axis (XPS), true for Raman / XAS…
 */
export function adjustLimits(l: Limits, axis: EdgeAxis, direction: 'increase' | 'decrease', ys: readonly (number | null)[], forward = false): Limits {
  const n = { ...l }
  if (axis === 'high_be' || axis === 'low_be') {
    let inc = xAxisStep(l)
    if (!forward) inc = -inc
    if (axis === 'high_be') n.xmax += direction === 'increase' ? inc : -inc
    else n.xmin -= direction === 'increase' ? inc : -inc
    return n
  }
  const step = intensityStep(ys, l, axis === 'high_int' ? 0.05 : 0.02)
  if (axis === 'high_int') n.ymax = direction === 'decrease' ? Math.max(l.ymax - step, l.ymin) : l.ymax + step
  else n.ymin = direction === 'decrease' ? l.ymin - step : Math.min(l.ymin + step, l.ymax)
  return n
}

/** _handle_zoom_keys: Ctrl+= / Ctrl++ zoom in, Ctrl+- zoom out (both edges by one x step). */
export function zoomKey(l: Limits, out: boolean): Limits {
  const f = xAxisStep(l)
  return out ? { ...l, xmin: l.xmin - f, xmax: l.xmax + f } : { ...l, xmin: l.xmin + f, xmax: l.xmax - f }
}

/** _handle_ctrl_arrow_keys: Ctrl+Left lowers both limits, Ctrl+Right raises them (1 % of the span, at least 0.1). */
export function panKey(l: Limits, left: boolean): Limits {
  const m = xAxisStep(l, 0.01, 0.1)
  return left ? { ...l, xmin: l.xmin - m, xmax: l.xmax - m } : { ...l, xmin: l.xmin + m, xmax: l.xmax + m }
}

/** _handle_ctrl_up_down_keys: Ctrl+Up raises the top of the intensity axis by 5 % of the tallest point, Ctrl+Down lowers it. */
export function intensityKey(l: Limits, up: boolean, ys: readonly (number | null)[]): Limits {
  const step = intensityStep(ys, l, 0.05)
  return { ...l, ymax: up ? l.ymax + step : Math.max(l.ymax - step, l.ymin) }
}

/** What a key press does (KeyEventHandlers.on_key_press_global + on_key_press). */
export type KeyAction =
  | { type: 'limits'; limits: Limits }
  | { type: 'peak'; key: 'left' | 'right' | 'up' | 'down' | 'wider' | 'narrower' }
  | { type: 'sheet'; step: 1 | -1 }
  | { type: 'nextRegion' }
  | { type: 'peakStep'; step: 1 | -1 }
  | { type: 'needFittingTab' }
  | { type: 'command'; id: 'undo' | 'redo' | 'save' | 'open' | 'new' | 'exit' | 'shortcuts' | 'fitting' | 'energyScale' | 'help' | 'manual' }

export interface KeyEventLike {
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
}

export interface KeyContext {
  limits: Limits | null
  ys: readonly (number | null)[]
  forward: boolean
  /** A peak is selected (selected_peak_index is not None). */
  selected: boolean
  /** The Fitting window is open on its BKG tab (background_tab_selected). */
  bkgTab: boolean
  /** The Fitting window is open on its Fitting tab (peak_fitting_tab_selected). */
  fitTab: boolean
  /** The peak table has rows. */
  hasPeaks: boolean
  /** The focus is in a text field / editor (plain keys belong to it). */
  typing: boolean
}

/** The key's name as wx sees it: arrows, Tab, letters (upper case), digits and - = +. */
function code(key: string): string {
  if (key.startsWith('Arrow')) return key.slice(5).toLowerCase()
  if (key === 'Tab') return 'tab'
  if (key.length === 1) return key.toUpperCase()
  return key.toLowerCase()
}

export function keyAction(e: KeyEventLike, c: KeyContext): KeyAction | null {
  const k = code(e.key)
  const arrow = k === 'left' || k === 'right' || k === 'up' || k === 'down'
  // Plain keys belong to whatever is being typed in.
  if (!(e.ctrl || e.alt) && c.typing) return null

  // Alt + arrows on the selected peak (the Alt branch wins over Ctrl, as on the desktop).
  if (e.alt && c.selected) {
    if (e.shift && (k === 'left' || k === 'right')) return { type: 'peak', key: k === 'right' ? 'wider' : 'narrower' }
    if (k === 'left' || k === 'right' || k === 'up' || k === 'down') return { type: 'peak', key: k }
  } else if (e.ctrl) {
    switch (k) {
      case 'B':
        return { type: 'command', id: 'energyScale' }
      case 'Z':
        return { type: 'command', id: 'undo' }
      case 'Y':
        return { type: 'command', id: 'redo' }
      case 'S':
        return { type: 'command', id: 'save' }
      case 'O':
        return { type: 'command', id: 'open' }
      case 'N':
        return { type: 'command', id: 'new' }
      case 'Q':
        return { type: 'command', id: 'exit' }
      case 'K':
        return { type: 'command', id: 'shortcuts' }
      case 'P':
        return { type: 'command', id: 'fitting' }
      case 'H':
        return { type: 'command', id: 'help' }
      case 'M':
        return { type: 'command', id: 'manual' }
      case '[':
      case '9':
        return { type: 'sheet', step: -1 }
      case ']':
      case '0':
        return { type: 'sheet', step: 1 }
      case '-':
      case '_':
        return c.limits ? { type: 'limits', limits: zoomKey(c.limits, true) } : null
      case '=':
      case '+':
        return c.limits ? { type: 'limits', limits: zoomKey(c.limits, false) } : null
    }
    if (arrow) {
      if (!c.limits) return null
      if (k === 'left' || k === 'right') return { type: 'limits', limits: panKey(c.limits, k === 'left') }
      return { type: 'limits', limits: intensityKey(c.limits, k === 'up', c.ys) }
    }
  }

  // Shift + Left / Right: the high-BE edge.
  if (e.shift && (k === 'left' || k === 'right') && !e.ctrl) {
    if (!c.limits) return null
    return { type: 'limits', limits: adjustLimits(c.limits, 'high_be', k === 'left' ? 'increase' : 'decrease', c.ys, c.forward) }
  }

  // Tab / Q (_handle_special_keys; Shift+Tab goes back from the Fitting window).
  if (!e.ctrl && !e.alt) {
    if (k === 'tab') {
      if (c.bkgTab) return { type: 'nextRegion' }
      if (c.fitTab) return c.hasPeaks ? { type: 'peakStep', step: e.shift ? -1 : 1 } : null
      return { type: 'needFittingTab' }
    }
    if (k === 'Q') {
      if (c.fitTab) return c.hasPeaks ? { type: 'peakStep', step: -1 } : null
      if (c.bkgTab) return null
      return { type: 'needFittingTab' }
    }
  }
  return null
}

/** PeakManipulation.change_selected_peak. */
export function stepPeak(selected: number | null, n: number, step: 1 | -1): number | null {
  if (n <= 0) return null
  if (selected === null) return step > 0 ? 0 : n - 1
  return (((selected + step) % n) + n) % n
}

/**
 * FittingWindow.on_key_down: Up / Down change the digit right of the cursor
 * by one (10^power), keeping the number of decimals. Returns null when the
 * cursor is not on a digit (the key then does what it normally does).
 */
export function stepDigit(text: string, cursor: number, up: boolean): string | null {
  if (!text || cursor >= text.length) return null
  const value = Number(text)
  if (text.trim() === '' || !Number.isFinite(value)) return null
  const negative = value < 0
  const full = text.replace('-', '')
  let at = cursor
  if (negative) at -= 1
  if (at < 0 || at >= full.length || full[at] === '.') return null
  let power: number
  if (full.includes('.')) {
    const dot = full.indexOf('.')
    power = at < dot ? dot - 1 - at : dot - at
  } else power = full.length - 1 - at
  const next = value + (up ? 1 : -1) * 10 ** power
  if (text.includes('.')) {
    const places = text.split('.')[1].length
    return next.toFixed(places)
  }
  return String(Math.round(next))
}

/**
 * On_Mouse_Defs.on_click with Shift on the BKG tab: the line nearest the click
 * gets an offset (click height minus the data under that line, never
 * positive); the low-BE line sets Offset (Right) = offset_l, the high-BE one
 * Offset (Left) = offset_h.
 */
export function shiftOffset(x: number, y: number, lines: [number, number], xs: readonly (number | null)[], ys: readonly (number | null)[]): { side: 'h' | 'l'; value: number } | null {
  const [a, b] = lines
  const line = Math.abs(x - a) < Math.abs(x - b) ? a : b
  let best = -1
  let bd = Infinity
  xs.forEach((v, i) => {
    if (v === null) return
    const d = Math.abs(v - line)
    if (d < bd) {
      bd = d
      best = i
    }
  })
  const raw = best >= 0 ? ys[best] : null
  if (raw === null || raw === undefined) return null
  return { side: line === Math.min(a, b) ? 'l' : 'h', value: Math.min(y - raw, 0) }
}

/**
 * On_Mouse_Defs.on_click (BKG tab, no modifier): which red line the press
 * takes. Within max(some_threshold, 2 % of the data range) of a line → that
 * line; elsewhere the nearer line jumps to the click.
 */
export function pickLine(x: number, lines: [number, number]): 0 | 1 {
  return Math.abs(x - lines[0]) < Math.abs(x - lines[1]) ? 0 : 1
}

/** The text of List of Shortcuts (Ctrl+K), as the desktop's popup. */
export const SHORTCUTS_TEXT = [
  '-Tab: Select next peak',
  '-Q: Select previous peak',
  '-Ctrl+Minus (-): Zoom out',
  '-Ctrl+Equal (=): Zoom in',
  '-Ctrl+Left bracket [: Select previous core level',
  '-Ctrl+Right bracket ]: Select next core level',
  '-Ctrl+Up: Increase plot intensity',
  '-Ctrl+Down: Decrease plot intensity',
  '-Ctrl+Left: Move plot to High BE',
  '-Ctrl+Right: Move plot to Low BE',
  '-SHIFT+Left: Decrease High BE',
  '-SHIFT+Right: Increase High BE',
  '-Ctrl+Z: Undo up to 50 events',
  '-Ctrl+Y: Redo',
  '-Ctrl+S: Save. Only works on the grid and not on the figure canvas',
  '-Ctrl+P: Open peak fitting window',
  '-Ctrl+K: Show Keyboard shortcut',
  '-Alt+Up: Increase peak intensity',
  '-Alt+Down: Decrease peak intensity',
  '-Alt+Left: Move peak to High BE',
  '-Alt+Right: Move peak to Low BE',
  '-Alt+SHIFT+Left: Decrease FWHM',
  '-Alt+SHIFT+Right: Increase FWHM',
]
