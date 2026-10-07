// The desktop's panel themes (View > Theme / Style > Panel Theme) and grid
// colour (> Grid Colour), from KherveFittingPro dev-AI KherveFitting.py,
// ThemedToolBar.THEME_COLOURS and ThemeColours.GREEN_SHADES. The factory
// default (default_config.json) is "Simple Darker" with grid colour "Green 5".

export const PANEL_THEMES = ['None', 'Simple', 'Simple Dark', 'Simple Darker', 'Simple Very Dark', 'Raised', 'Sunken'] as const
export type PanelTheme = (typeof PANEL_THEMES)[number]

/** Panel / toolbar / status bar / grid-label colour of a theme (Windows button face for the light ones). */
export function panelColour(theme: PanelTheme): [number, number, number] {
  if (theme === 'Simple Dark') return [200, 203, 205]
  if (theme === 'Simple Darker') return [165, 165, 168]
  if (theme === 'Simple Very Dark') return [140, 140, 142]
  return [240, 240, 240]
}

const interp = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as [number, number, number]
const LIGHT_GREEN = [200, 245, 228]
const KHERVE_GREEN = [79, 190, 159]

/** Ten shades from the light default to the KherveFitting green #4FBE9F. */
export const GREEN_SHADES: { label: string; rgb: [number, number, number] }[] = Array.from({ length: 10 }, (_, i) => ({
  label: i === 0 ? 'Light Green (default)' : i === 9 ? 'KherveFitting Green' : `Green ${i + 1}`,
  rgb: interp(LIGHT_GREEN, KHERVE_GREEN, i / 9),
}))

export const FACTORY_THEME: PanelTheme = 'Simple Darker'
export const FACTORY_GRID_RGB: [number, number, number] = [146, 221, 197]

export const rgb = (c: readonly number[]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`
export const shade = (c: readonly number[], d: number) => rgb(c.map((v) => Math.max(0, Math.min(255, v + d))))

/** CSS variables for the app root. */
export function themeVars(theme: PanelTheme, grid: readonly number[]): Record<string, string> {
  const p = panelColour(theme)
  return {
    '--kf-panel': rgb(p),
    '--kf-panel-line': shade(p, -45),
    '--kf-hover': shade(p, -28),
    '--kf-press': shade(p, -50),
    '--kf-cons': rgb(grid),
    '--kf-green': '#4FBE9F',
  }
}
