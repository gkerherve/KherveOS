// User preferences, remembered in this browser.

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface SettingsState {
  /** "Auto" follows the system light/dark setting; otherwise a theme name. */
  theme: string
  /** The wallpaper's id: KherveOS has one, 'ktools-lab'. */
  wallpaper: string
  /** How strongly the wallpaper shows over the theme's desktop colour (0.1–1). */
  wallpaperOpacity: number
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
      desktopIcons: false,
      iconStyle: 'classic',
      lightApps: [],
      lightTheme: 'Kherve Light',
      dock: DEFAULT_DOCK,
      dockZoom: 128,
      showHidden: false,
      browserHome: 'kherve:start',
      set: (patch) => set(patch),
    }),
    {
      name: 'kherveos.settings',
      storage: safeStorage,
      version: 10,
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
        return s as SettingsState
      },
    },
  ),
)
