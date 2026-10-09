// What every tab of kClimate gets from the window: the project, the series library and a few commands.

import type { RefObject } from 'react'
import type { Library, Manifest, RefInfo } from './catalog'
import type { Project, TabId } from './project'
import type { ChartHandle } from './PlotlyChart'

export type LoadState = 'loading' | 'ready' | 'error'

export interface Env {
  project: Project
  /** Changes the project as one undoable step (the draft is edited in place). */
  update(change: (p: Project) => void): void
  lib: Library
  /** Bumped whenever the library gains or loses series (use it in memo dependencies). */
  version: number
  manifest: Manifest | null
  manifestError: string | null
  /** Every series that can be chosen: the shipped catalog and the imports. */
  refs: RefInfo[]
  status: Record<string, LoadState>
  errors: Record<string, string>
  datasetTitle(id: string): string
  /** Loads (and adds to the project) the dataset behind a series id. */
  ensureRef(ref: string): void
  toggleDataset(id: string, on: boolean): void
  removeImport(id: string): void
  openImport(text?: string): void
  narrow: boolean
  /** The settings panel is shown (View › Settings Panel). */
  settings: boolean
  flash(message: string): void
  /** Saves a chart as PNG or SVG (asks where). */
  saveImage(chart: ChartHandle | null, format: 'png' | 'svg', name: string, title?: string): void
  /** The tab's main chart, for File › Export. */
  chartRef: RefObject<ChartHandle | null>
  setTab(tab: TabId): void
}
