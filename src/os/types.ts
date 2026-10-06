import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { MenuBarMenu } from './ui/Menu'

export type AppCategory = 'system' | 'kherve' | 'internet' | 'games'

/** The submenu of the Applications menu (bottom-left of the Dock) an app sits in. */
export type AppGroup = 'Office' | 'Science' | 'Development' | 'Internet' | 'Tools' | 'Games'

/** What an app is opened with. Apps read the fields they understand. */
export interface AppArgs {
  /** A file or folder in the virtual file system. */
  path?: string
  /** A web address (Browser, web games). */
  url?: string
  [key: string]: unknown
}

/** Handed to every app: its own window, and a way to talk to it. */
export interface WindowApi {
  readonly id: string
  setTitle(title: string): void
  /** Close the window. Runs the app's close guard unless `force`. */
  close(force?: boolean): void
  /** Called before the window closes; return false to keep it open. */
  setCloseGuard(guard: (() => boolean | Promise<boolean>) | null): void
  /**
   * The app's menus (File, Edit, View…), shown in the menu bar at the top of
   * the screen while this window is in front. The OS adds Window and Help.
   * Pass a new array whenever labels/checkmarks change; null removes them.
   */
  setMenus(menus: MenuBarMenu[] | null): void
  /**
   * The file this window is showing, when it changes after opening (Save As,
   * Open in place). Opening that file again then focuses this window.
   */
  setDocumentPath(path: string | null): void
  focus(): void
}

export interface AppProps {
  win: WindowApi
  args: AppArgs
}

/** How an app's icon is drawn in the Ktools style (see src/os/ui/AppIcon.tsx). */
export interface AppBrand {
  /** The short name on the tile, e.g. "KFiles". */
  label: string
  /** Gradient, top to bottom. */
  from: string
  to: string
  /** Text colour on the tile (default white). */
  fg?: string
  /** Pictogram colour (default: the text colour). */
  glyph?: string
  /** The deep (darker) gradient, top to bottom (default: `from`/`to` darkened). */
  deep?: [string, string]
  /** Pictogram colour on the deep tile (default white). */
  deepGlyph?: string
}

export interface AppManifest {
  id: string
  name: string
  /** The pictogram (and the icon used in small places: menus, notifications). */
  icon: LucideIcon
  /** The app's main colour (notifications, small dots). */
  color: string
  /** The Ktools-style tile. */
  brand?: AppBrand
  /** An official icon picture (Ktools apps that have one), instead of the drawn tile. */
  image?: string
  category: AppCategory
  /** Its submenu in the Applications menu. */
  group: AppGroup
  description: string
  load: () => Promise<{ default: ComponentType<AppProps> }>
  defaultSize?: { w: number; h: number }
  minSize?: { w: number; h: number }
  /** File extensions this app opens, e.g. ['.txt', '.md']. */
  fileTypes?: string[]
  /** Focus the existing window instead of opening a second one. */
  singleton?: boolean
  /** Shown on the desktop as a shortcut. */
  desktop?: boolean
  /** A see-through, blurred window (the Terminal). The app draws no background of its own. */
  translucent?: boolean
}
