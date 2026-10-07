// The link between a KherveSlide main window and its PDF window.
//
// On the desktop the PDF panel (PDF | Overview tabs) is a widget the main
// window owns; in "Visual + PDF in its own window" it is reparented into a
// second top-level window. In KherveOS that second window is a window of its
// own (os.open('kherveslide', { pdfFor: <main window id> })), rendering the
// same panel from what the main window publishes here: the compiled PDF, the
// page to show, the presentation for the Overview, and the actions to call
// back. Both windows run in the same page, so this is a plain shared store.

import { create } from 'zustand'
import type { MenuBarMenu } from '@/os'
import type { Deck } from './model'
import type { Look } from './look'
import type { Media } from './media'

export type RightTab = 'pdf' | 'overview'

export interface PdfLinkActions {
  /** A click in the Overview: that slide comes up in the editor. */
  goto(index: number): void
  /** A double-click in the Overview: edit that slide (back to the Normal view). */
  open(index: number): void
  /** Overview drag: the new order of the slides. */
  reorder(order: number[]): void
  /** Right-click on a mini page: the slide menu. */
  slideMenu(e: React.MouseEvent, index: number): void
  /** The PDF | Overview tab picked by hand. */
  tab(tab: RightTab): void
  /** The user closed the PDF window: dock the panel back beside the Visual editor. */
  dock(): void
}

export interface PdfLink {
  /** The main window's title; the PDF window is "<title> — PDF". */
  title: string
  pdf: Uint8Array | null
  busy: boolean
  /** The PDF page to bring into view, and a counter so the same page can be asked for again. */
  page: number
  pageTick: number
  tab: RightTab
  deck: Deck
  look: Look
  media: Media
  backdrop: (string | null)[] | null
  current: number
  menus: MenuBarMenu[] | null
  /** The PDF window's id, while it is open. */
  windowId: string | null
  actions: PdfLinkActions
}

interface LinkStore {
  links: Record<string, PdfLink>
  put(mainId: string, link: Partial<PdfLink>): void
  drop(mainId: string): void
}

export const useLinks = create<LinkStore>((set, get) => ({
  links: {},
  put(mainId, link) {
    const old = get().links[mainId]
    set({ links: { ...get().links, [mainId]: { ...(old as PdfLink), ...link } } })
  },
  drop(mainId) {
    const rest = { ...get().links }
    delete rest[mainId]
    set({ links: rest })
  },
}))
