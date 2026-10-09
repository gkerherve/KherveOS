// What the window gives each workbench (types only; KMech.tsx implements it).

import type { MenuBarMenu, MenuItem, WindowApi } from '@/os'
import type { KMechDoc } from './doc'

export interface Shell<M> {
  win: WindowApi
  /** the model of this workbench's document */
  model: M
  name: string
  path: string | null
  dirty: boolean
  /** One change, one undo step. */
  commit(model: M): void
  /** A gesture: begin(), preview() as often as needed, end() (one undo step). */
  begin(): void
  preview(model: M): void
  end(): void
  /** Replace the whole document (a different example, a new one), asking about unsaved work first. */
  replace(doc: KMechDoc): Promise<void>
  /** A short message in the status bar. */
  say(msg: string): void
  /** Changes when a different document is loaded (new, opened, example): the workbench resets its view. */
  docId: number
  /** Changes whenever the File/Edit menus would look different. */
  version: number
  /** The menus every workbench shows; the workbench adds its own between Edit and Help. */
  fileMenu(exports: MenuItem[]): MenuBarMenu
  editMenu(extra: MenuItem[]): MenuBarMenu
  helpMenu(shortcuts: string, how: string): MenuBarMenu
  /** Writes a text or binary file chosen with the save dialog. */
  saveFile(defaultName: string, ext: string, data: string | Uint8Array): Promise<string | null>
  /** Open a table in kPlot. */
  openInKplot(text: string, name: string): void
  /** Compact layout (narrow window). */
  compact: boolean
}
