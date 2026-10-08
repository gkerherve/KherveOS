// User preferences, remembered in this browser.

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface SettingsState {
  /** "Auto" follows the system light/dark setting; otherwise a theme name. */
  theme: string
  /** The wallpaper's id (see src/shell/wallpapers.ts): 'ktools-lab', 'graphene', 'molecules'… */
  wallpaper: string
  /** How strongly the wallpaper shows over the theme's desktop colour (0.1–1). */
  wallpaperOpacity: number
  /** How the wallpaper fits the screen: cover it (cropping), show it whole, or at its own size in the middle. */
  wallpaperFit: WallpaperFit
  /** Interface size, like macOS display scaling: 1 = 100% (0.75–2). Scales the menu bar, Dock, windows and desktop. */
  uiScale: number
  /** App shortcuts on the desktop (the Dock already has them). */
  desktopIcons: boolean
  /** App icon look: classic Ktools tiles, or the same in deeper colours. */
  iconStyle: 'classic' | 'deep'
  /** Apps that keep a light theme while the OS is dark. */
  lightApps: string[]
  /** The light theme those apps use. */
  lightTheme: string
  /** Apps kept in the Dock. */
  dock: string[]
  /** Dock magnification: how big an icon grows under the pointer, in px (48 = off, 128 = maximum). */
  dockZoom: number
  /** Show files whose names start with "." (hidden, like on macOS). */
  showHidden: boolean
  browserHome: string
  set(patch: Partial<Omit<SettingsState, 'set'>>): void
}

export type WallpaperFit = 'fill' | 'fit' | 'centre'

/** The interface sizes offered in Settings › Appearance › Desktop. */
export const UI_SCALES = [0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
export const clampUiScale = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(2, Math.max(0.6, v)) : 1

export const DEFAULT_DOCK = ['files', 'browser', 'terminal', 'khervebook', 'kherveai', 'notepad', 'messages', 'email', 'settings']

const safeStorage = createJSONStorage(() => {
  try {
    const probe = '__kherveos_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return localStorage
  } catch {
    const mem = new Map<string, string>()
    return {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    }
  }
})

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'Kherve Green',
      wallpaper: 'ktools-lab',
      wallpaperOpacity: 1,
      wallpaperFit: 'fill',
      uiScale: 1,
      desktopIcons: false,
      iconStyle: 'classic',
      lightApps: [],
      lightTheme: 'Kherve Light',
      dock: DEFAULT_DOCK,
      dockZoom: 160,
      showHidden: false,
      browserHome: 'https://khervetools.com',
      set: (patch) => set(patch),
    }),
    {
      name: 'kherveos.settings',
      storage: safeStorage,
      version: 14,
      migrate: (old, version) => {
        let s = { ...((old ?? {}) as Partial<SettingsState>) }
        // Version 1 had a blue/Auto look: move early installs to the dark look.
        if (version < 2) {
          s = {
            ...s,
            theme: 'Kherve Red',
            wallpaper: s.wallpaper?.startsWith('file:') ? s.wallpaper : 'ktool',
            desktopIcons: false,
            lightApps: ['khervebook', 'email'],
            lightTheme: 'Kherve Paper',
            dock: DEFAULT_DOCK,
          }
        }
        // Version 3: the green fist became the default wallpaper (a chosen one is kept).
        if (version < 3 && (!s.wallpaper || s.wallpaper === 'ktool')) s.wallpaper = 'ktool-green'
        // Version 5: back to the classic Ktools icons by default.
        if (version < 5) s.iconStyle = 'classic'
        // Version 6: one look for everyone — black and green, every app dark.
        if (version < 6) {
          s.theme = 'Kherve Green'
          s.lightApps = []
          s.iconStyle = 'classic'
        }
        // Version 7: KherveAI joins the Dock.
        if (version < 7 && s.dock && !s.dock.includes('kherveai')) {
          const i = s.dock.indexOf('khervebook')
          s.dock = [...s.dock.slice(0, i + 1), 'kherveai', ...s.dock.slice(i + 1)]
        }
        // Version 8: one wallpaper for everyone, the Ktools Advanced Tech Lab.
        if (version < 8) s.wallpaper = 'ktools-lab'
        // Version 9: shown in full (the 50% visibility was for the brighter fist picture).
        if (version < 9) s.wallpaperOpacity = 1
        // Version 10: apps can be chosen Light again (Settings › Appearance), in light green.
        if (version < 10) s.lightTheme = 'Kherve Light'
        // Version 11: interface size (display scaling) and how the wallpaper fits.
        if (version < 11) {
          s.uiScale = 1
          s.wallpaperFit = 'fill'
        }
        // Version 12: the Browser opens on khervetools.com (unless another home page was chosen).
        if (version < 12 && (!s.browserHome || s.browserHome === 'kherve:start')) s.browserHome = 'https://khervetools.com'
        // Version 13: several wallpapers; the chosen one is kept (the lab picture when none was).
        if (version < 13 && !s.wallpaper) s.wallpaper = 'ktools-lab'
        // Version 14: the Dock magnifies further (up to 192 px); the old 128 px maximum moves up.
        if (version < 14 && (s.dockZoom === undefined || s.dockZoom >= 128)) s.dockZoom = 160
        return s as SettingsState
      },
    },
  ),
)
