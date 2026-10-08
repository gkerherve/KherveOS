// The two views' data, outside React's tree: the window's widgets are
// memoised by node, so the 3D and 2D views read their (frequently changing)
// data from here instead of from props.

import { create } from 'zustand'
import type { View3DData } from './View3D'
import type { SketchView } from './Sketch'
import type { SketchState, UiEvent } from './types'

export interface ViewsState {
  v3: View3DData
  sketch: SketchState
  sketchView: { v: SketchView; rev: number }
  send: (ev: UiEvent) => void
}

export const createViews = () =>
  create<ViewsState>(() => ({
    v3: { mesh: null, hi: null, cam: null, camRev: 0, look: null, markers: [] },
    sketch: {},
    sketchView: { v: { sx: 4, sy: -4, cx: 30, cy: 20 }, rev: 0 },
    send: () => {},
  }))

export type ViewsStore = ReturnType<typeof createViews>
