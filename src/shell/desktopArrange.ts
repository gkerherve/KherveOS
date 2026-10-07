// The desktop icons' positions and the Snap to Grid choice, remembered in this browser.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Pos } from './desktopLayout'

interface DesktopArrangeState {
  /** Icon positions by key ("app:<id>" for app shortcuts, else the file's path). */
  positions: Record<string, Pos>
  /** Dropped icons land on the grid (like the Finder's "Snap to Grid"). */
  snap: boolean
  setPositions(p: Record<string, Pos>): void
  setSnap(on: boolean): void
}

export const useDesktopArrange = create<DesktopArrangeState>()(
  persist(
    (set) => ({
      positions: {},
      snap: true,
      setPositions: (p) => set((s) => ({ positions: { ...s.positions, ...p } })),
      setSnap: (snap) => set({ snap }),
    }),
    {
      name: 'kherveos.desktop-icons',
      version: 1,
      partialize: (s) => ({ positions: s.positions, snap: s.snap }),
    },
  ),
)

/** Forget positions of desktop files that are gone (app shortcuts keep theirs while hidden). */
export function prunePositions(keep: Set<string>) {
  const { positions } = useDesktopArrange.getState()
  const left = Object.fromEntries(Object.entries(positions).filter(([k]) => k.startsWith('app:') || keep.has(k)))
  if (Object.keys(left).length !== Object.keys(positions).length) useDesktopArrange.setState({ positions: left })
}

/** A renamed desktop file keeps its place. */
export function renamePosition(oldKey: string, newKey: string) {
  const { positions } = useDesktopArrange.getState()
  const p = positions[oldKey]
  if (!p) return
  const next = { ...positions, [newKey]: p }
  delete next[oldKey]
  useDesktopArrange.setState({ positions: next })
}
