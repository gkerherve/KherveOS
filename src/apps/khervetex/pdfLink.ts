// The link between a KherveTeX main window and its PDF window.
//
// As on the desktop, the compiled PDF lives in its own window beside the
// editor ("PDF in its own window", the default) — another KherveOS window of
// this app, opened with { pdfOf: <main window id> }. Both windows run in the
// same page, so they share this small store: the main window publishes the
// PDF, the zoom of its status bar and its menus; the PDF window shows them.

import { create } from 'zustand'
import type { MenuBarMenu } from '@/os'

export interface PdfLink {
  /** The PDF window's id, once opened. */
  pdfWinId: string | null
  /** The compiled PDF (a new object for every compile). */
  pdf: { bytes: Uint8Array; version: number } | null
  /** "Not compiled…" and the like, shown over the pages. */
  notice: string | null
  compiling: boolean
  /** PDF zoom in percent (the "PDF:" slider of the main window's status bar). */
  zoom: number
  /** Fit page width (the status bar's fit-width button, View ▸ Fit page width). */
  fit: boolean
  /** Window title of the main window; the PDF window adds " — PDF". */
  title: string
  /** The main window's menus: the menu bar shows them over the PDF window too. */
  menus: MenuBarMenu[] | null
  /** Set by the main window when the PDF window must close (layout changed, main window closed). */
  closing: boolean
  /** "Show in PDF" from the editor. */
  reveal: { text: string; seq: number } | null
  /** The user closed the PDF window: the main window docks the PDF back beside the editor. */
  onUserClose: () => void
  /** Zoom reported by fit-to-width, so the status bar follows it. */
  onFitZoom: (pct: number) => void
  /** Right-click "Show in Visual" / "Show in Code" from a PDF page. */
  showIn: (where: 'visual' | 'code', pageText: string) => void
}

interface Links {
  links: Record<string, PdfLink>
}

export const usePdfLinks = create<Links>(() => ({ links: {} }))

const blank = (): PdfLink => ({
  pdfWinId: null, pdf: null, notice: null, compiling: false, zoom: 100, fit: true, title: 'kTeX', menus: null,
  closing: false, reveal: null, onUserClose: () => {}, onFitZoom: () => {}, showIn: () => {},
})

export function getLink(mainId: string): PdfLink | undefined {
  return usePdfLinks.getState().links[mainId]
}

export function updateLink(mainId: string, patch: Partial<PdfLink>) {
  usePdfLinks.setState((s) => {
    const old = s.links[mainId] ?? blank()
    let same = true
    for (const k of Object.keys(patch) as (keyof PdfLink)[]) if (old[k] !== patch[k]) same = false
    if (same && s.links[mainId]) return s
    return { links: { ...s.links, [mainId]: { ...old, ...patch } } }
  })
}

export function dropLink(mainId: string) {
  usePdfLinks.setState((s) => {
    if (!(mainId in s.links)) return s
    const next = { ...s.links }
    delete next[mainId]
    return { links: next }
  })
}
