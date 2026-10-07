// Settings' AI tools (settings_get_settings, _set_appearance, _set_app_mode,
// _open_section): names, arguments and descriptions are in
// src/os/ai/manifests/system.ts; Settings.tsx registers these with useAppTools.
// They change the preferences in src/os/settings.ts, which the user can change
// back; nothing here resets the drive, signs out or touches MCP tokens.

import { UI_SCALES, useSettings, type WallpaperFit } from '@/os/settings'
import { APPS } from '@/os/registry'
import type { AppTools } from '@/os/ai/appTools'

export interface SettingsView {
  sections: readonly { id: string; name: string }[]
  /** Show a section (its id). */
  show(id: string): void
}

const FITS: WallpaperFit[] = ['fill', 'fit', 'centre']

function current() {
  const s = useSettings.getState()
  const known = new Set(APPS.map((a) => a.id))
  return {
    ui_scale: s.uiScale,
    ui_scale_choices: UI_SCALES,
    dock_magnification: s.dockZoom <= 48 ? 'off (48)' : s.dockZoom,
    wallpaper_fit: s.wallpaperFit,
    wallpaper_visibility: Math.round(s.wallpaperOpacity * 100),
    desktop_icons: s.desktopIcons,
    show_hidden_files: s.showHidden,
    light_apps: s.lightApps.filter((id) => known.has(id)),
    note: 'Apps not in light_apps are dark.',
  }
}

/** "khervesheet", "KherveSheet", "kherve sheet" → the app's id. */
function findApp(given: string) {
  const squash = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '')
  const g = squash(given)
  return APPS.find((a) => a.id === given.trim().toLowerCase()) ?? APPS.find((a) => squash(a.name) === g || squash(a.id) === g)
}

export function settingsAiTools(view: SettingsView): AppTools {
  return {
    async get_settings() {
      return current()
    },

    async set_appearance(a) {
      const patch: Parameters<ReturnType<typeof useSettings.getState>['set']>[0] = {}

      if (a.ui_scale !== undefined) {
        let v = Number(a.ui_scale)
        if (!Number.isFinite(v)) throw new Error('ui_scale must be a number, e.g. 1.25 (or 125 for 125%).')
        if (v > 2.5) v /= 100 // a percentage
        if (v < 0.75 || v > 2) throw new Error(`ui_scale ${a.ui_scale} is out of range: choose one of ${UI_SCALES.join(', ')}.`)
        patch.uiScale = UI_SCALES.reduce((best, k) => (Math.abs(k - v) < Math.abs(best - v) ? k : best), UI_SCALES[0])
      }

      if (a.dock_magnification !== undefined) {
        const v = Number(a.dock_magnification)
        if (!Number.isFinite(v)) throw new Error('dock_magnification must be a number of px from 48 (off) to 128.')
        if (v !== 0 && (v < 48 || v > 128)) throw new Error(`dock_magnification ${v} is out of range: 48 (off) to 128 px.`)
        patch.dockZoom = v === 0 ? 48 : Math.round(v / 4) * 4
      }

      if (a.wallpaper_fit !== undefined) {
        const f = String(a.wallpaper_fit).trim().toLowerCase().replace('center', 'centre') as WallpaperFit
        if (!FITS.includes(f)) throw new Error(`wallpaper_fit must be one of ${FITS.join(', ')}.`)
        patch.wallpaperFit = f
      }

      if (a.wallpaper_visibility !== undefined) {
        let v = Number(a.wallpaper_visibility)
        if (!Number.isFinite(v)) throw new Error('wallpaper_visibility must be a percentage from 10 to 100.')
        if (v > 0 && v <= 1) v *= 100 // a fraction
        if (v < 10 || v > 100) throw new Error(`wallpaper_visibility ${a.wallpaper_visibility} is out of range: 10 to 100 (percent).`)
        patch.wallpaperOpacity = Math.round(v / 5) * 5 / 100
      }

      if (a.desktop_icons !== undefined) patch.desktopIcons = a.desktop_icons === true
      if (a.show_hidden_files !== undefined) patch.showHidden = a.show_hidden_files === true

      if (!Object.keys(patch).length) {
        throw new Error('Nothing to change: give ui_scale, dock_magnification, wallpaper_fit, wallpaper_visibility, desktop_icons or show_hidden_files.')
      }
      useSettings.getState().set(patch)
      return { changed: Object.keys(patch).length, ...current() }
    },

    async set_app_mode(a) {
      const mode = String(a.mode ?? '').trim().toLowerCase()
      if (mode !== 'light' && mode !== 'dark') throw new Error('mode must be "light" or "dark" (there is no "system" mode: KherveOS is dark).')
      const given = String(a.app ?? '').trim()
      if (!given) throw new Error('Give "app": an app id or name, or "all".')
      const { lightApps, set } = useSettings.getState()
      if (given.toLowerCase() === 'all') {
        set({ lightApps: mode === 'light' ? APPS.map((x) => x.id) : [] })
        return { app: 'all', mode, light_apps: useSettings.getState().lightApps.length }
      }
      const app = findApp(given)
      if (!app) throw new Error(`There is no app "${given}". Use an id such as ${APPS.slice(0, 4).map((x) => `"${x.id}"`).join(', ')}, or "all".`)
      const rest = lightApps.filter((x) => x !== app.id)
      set({ lightApps: mode === 'light' ? [...rest, app.id] : rest })
      return { app: app.id, name: app.name, mode, note: 'Windows already open switch at once.' }
    },

    async open_section(a) {
      const want = String(a.section ?? '').trim().toLowerCase()
      const squash = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '')
      const sec =
        view.sections.find((s) => s.id === want) ??
        view.sections.find((s) => squash(s.name) === squash(want) || (squash(want).length >= 2 && squash(s.name).startsWith(squash(want))))
      if (!sec) throw new Error(`There is no Settings section "${a.section}". Sections: ${view.sections.map((s) => s.id).join(', ')}.`)
      view.show(sec.id)
      return { section: sec.id, name: sec.name }
    },
  }
}
