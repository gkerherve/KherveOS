// The Other Databases & Properties window, between KherveDB windows.
//
// On the desktop (KherveDB-React 5.0, src-tauri/src/references.rs) it is a
// window of its own with one built-in browser per database, following the
// element selected in the main window. Here it is a KherveOS window too
// (KherveDB opened with { references: true }); the main windows tell it which
// element is selected through this store. Links elsewhere open in the KherveOS
// Browser (os.openUrl), never in a new browser tab.

import { create } from 'zustand'
import { os, type WindowApi } from '@/os'

interface RefsState {
  /** The element the main window has selected. */
  element: string | null
  /** The tab asked for by the last openReferences (null: keep the current one). */
  tab: string | null
  /** Bumped by every openReferences, so asking for the same tab again still switches to it. */
  asked: number
  /** The open references window, if any. */
  win: WindowApi | null
}

export const useRefs = create<RefsState>(() => ({ element: null, tab: null, asked: 0, win: null }))

/** The main window selected an element: the references window (if open) follows. */
export function followElement(el: string): void {
  if (useRefs.getState().element !== el) useRefs.setState({ element: el })
}

/** Open (or bring forward) the references window on an element, optionally on one tab. */
export function openReferences(el: string, tab?: string): void {
  const s = useRefs.getState()
  useRefs.setState({ element: el, tab: tab ?? null, asked: s.asked + 1 })
  if (s.win) s.win.focus()
  else os.open('khervedb', { references: true, element: el, _n: Date.now() })
}

export function closeReferences(): void {
  useRefs.getState().win?.close()
}

/** A web page, in the KherveOS Browser. */
export function openInBrowser(url: string): void {
  os.openUrl(url)
}
