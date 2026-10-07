// Turns the theme palettes into the CSS variables the whole OS is styled with.
// Apps should only ever use these variables:
//
//   --k-bg          window content background       --k-text     body text
//   --k-surface     sidebars, panels                 --k-muted    secondary text
//   --k-chrome      title bars, menu bars, toolbars  --k-accent   accent / primary buttons
//   --k-border      hairlines                        --k-accent-text  text on accent
//   --k-button      button fill                      --k-selection    selected rows / menu hover
//   --k-button-hover                                  --k-link, --k-danger, --k-success, --k-warning
//   --k-alt         alternate rows, code background  --k-desk     desktop base colour
//
// The variables are set on <html>; a window can override them for itself
// (apps that stay light in dark mode — see useWindowTheme).

import { useEffect, useMemo, type CSSProperties } from 'react'
import { useSettings } from './settings'
import { KHERVE_THEMES } from './themes.data'
import { KHERVEOS_THEMES } from './themes.extra'

export const ALL_THEMES: Record<string, Record<string, string>> = { ...KHERVEOS_THEMES, ...KHERVE_THEMES }
export const THEME_NAMES = Object.keys(ALL_THEMES)
export const KHERVEOS_THEME_NAMES = Object.keys(KHERVEOS_THEMES)

/** KherveOS has one look: black and green. */
export const THEME = 'Kherve Green'
export const DEFAULT_DARK = THEME
export const DEFAULT_LIGHT = 'Kherve Light'
/** "Auto" follows the system: these two. */
export const AUTO_DARK = DEFAULT_DARK
export const AUTO_LIGHT = DEFAULT_LIGHT

export function isDarkTheme(name: string): boolean {
  return ALL_THEMES[name]?.dark === '1'
}

/** The CSS variables of a theme, ready for `style` or setProperty. */
export function themeVars(name: string): Record<string, string> {
  const t = ALL_THEMES[name] ?? ALL_THEMES[DEFAULT_DARK]
  const dark = t.dark === '1'
  const mix = (a: string, pct: number, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`
  return {
    '--k-bg': t.base,
    '--k-surface': t.surface,
    '--k-chrome': t.chrome ?? t.surface,
    '--k-text': t.text,
    '--k-muted': t.text_muted,
    '--k-accent': t.accent,
    '--k-accent-text': t.highlight_text ?? '#ffffff',
    '--k-link': t.link ?? t.accent,
    '--k-border': t.border ?? mix(t.text, dark ? 18 : 14, t.base),
    '--k-button': t.button ?? t.alt_base ?? mix(t.text, 8, t.base),
    '--k-button-hover': t.button_hover ?? t.tab_hover ?? mix(t.text, 14, t.base),
    '--k-selection': t.menu_sel ?? mix(t.accent, dark ? 35 : 20, t.base),
    '--k-alt': t.alt_base ?? mix(t.text, 5, t.base),
    '--k-desk': t.desk_bg ?? t.surface,
    '--k-placeholder': t.placeholder ?? t.text_muted,
    '--k-danger': dark ? '#ff6b6b' : '#d33a3a',
    '--k-success': dark ? '#4ade80' : '#15803d',
    '--k-warning': dark ? '#fbbf24' : '#b45309',
  }
}

/** The theme in use — always the KherveOS black-and-green. */
export function useResolvedTheme(): string {
  return THEME
}

export function applyTheme(name: string) {
  const root = document.documentElement
  for (const [k, v] of Object.entries(themeVars(name))) root.style.setProperty(k, v)
  const dark = isDarkTheme(name)
  root.dataset.dark = dark ? '1' : '0'
  root.style.colorScheme = dark ? 'dark' : 'light'
}

/** Keeps the document's CSS variables in step with the chosen theme. */
export function useThemeEffect(): string {
  const name = useResolvedTheme()
  useEffect(() => applyTheme(name), [name])
  return name
}

/**
 * Per-window theme: apps chosen as Light in Settings › Appearance get the light
 * green theme's variables on their window; every other app stays dark.
 */
export function useWindowTheme(appId: string): { style: CSSProperties; dark: '0' } | null {
  const light = useSettings((s) => s.lightApps.includes(appId))
  return useMemo(() => (light ? { style: themeVars(DEFAULT_LIGHT) as CSSProperties, dark: '0' } : null), [light])
}

/** A few colours of a theme, for previews in Settings. */
export function swatch(name: string) {
  const t = themeVars(name)
  return { bg: t['--k-bg'], surface: t['--k-surface'], chrome: t['--k-chrome'], text: t['--k-text'], accent: t['--k-accent'] }
}
