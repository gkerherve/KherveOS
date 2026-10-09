// A small base class for the scenes' simulations (pure): the fields every Sim has.

import type { Method } from './integrators.ts'
import type { Bounds, Channel, Energy, Frame, Params, PlotSpec, Readout, SceneId, Sim } from './types.ts'

export abstract class SimBase implements Sim {
  abstract readonly scene: SceneId
  abstract readonly mode: string
  t = 0
  params: Params
  method: Method
  dt = 1 / 240
  timeUnit = 's'
  lengthUnit = 'm'
  realtime = 1
  sampleDt = 0.02
  abstract channels: Channel[]
  abstract plots: PlotSpec[]
  methods: Method[] = ['euler', 'semi', 'verlet', 'rk4', 'rk45']
  conservative = false
  finished = false

  constructor(params: Params, method: Method) {
    this.params = { ...params }
    this.method = method
  }

  abstract step(dt: number): void
  abstract frame(): Frame
  abstract sample(): Record<string, number>
  abstract energy(): Energy | null
  abstract readouts(): Readout[]
  abstract bounds(): Bounds
}

/** Bounds that contain the points, with a margin (fraction of the size) and a minimum size. */
export function boundsOf(pts: ArrayLike<number>[], margin = 0.12, minSize = 1): Bounds {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0]
    if (p[0] > x1) x1 = p[0]
    if (p[1] < y0) y0 = p[1]
    if (p[1] > y1) y1 = p[1]
  }
  if (!Number.isFinite(x0)) return { x0: -1, y0: -1, x1: 1, y1: 1 }
  const w = Math.max(x1 - x0, minSize)
  const h = Math.max(y1 - y0, minSize)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return { x0: cx - w * (0.5 + margin), x1: cx + w * (0.5 + margin), y0: cy - h * (0.5 + margin), y1: cy + h * (0.5 + margin) }
}
