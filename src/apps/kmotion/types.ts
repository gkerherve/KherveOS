// The shared vocabulary of kMotion (pure, no React): parameters, the simulation interface every scene
// implements, what a scene draws (shapes in world coordinates, y up) and what it can plot.

import type { Method } from './integrators.ts'

export type SceneId = 'projectile' | 'pendulum' | 'oscillator' | 'collision' | 'orbit' | 'sandbox' | 'circular'

export type ParamValue = number | string | boolean | null | Record<string, unknown> | unknown[]
export type Params = Record<string, ParamValue>

// ------------------------------------------------------------------------------------------ parameters

interface ParamBase {
  key: string
  label: string
  /** Only for these modes (all modes when absent). */
  modes?: string[]
  /** Only shown when this is true for the current parameters. */
  when?: (p: Params) => boolean
  /** Can change while the simulation runs (otherwise the scene restarts). */
  live?: boolean
  hint?: string
}
export interface NumberParam extends ParamBase {
  kind: 'number'
  unit?: string
  min: number
  max: number
  step?: number
  /** Slider mapping. */
  scale?: 'lin' | 'log'
  value: number
  digits?: number
}
export interface ChoiceParam extends ParamBase {
  kind: 'choice'
  options: { value: string; label: string }[]
  value: string
}
export interface BoolParam extends ParamBase {
  kind: 'bool'
  value: boolean
}
export type ParamDef = NumberParam | ChoiceParam | BoolParam

export interface Preset {
  name: string
  /** Parameters to set (the mode included when it differs). */
  params: Params
}

export interface ModeDef {
  id: string
  label: string
  blurb: string
}

// ------------------------------------------------------------------------------------------ drawing

export type Shape =
  | { t: 'circle'; x: number; y: number; r: number; fill: string; stroke?: string; alpha?: number; label?: string; ring?: boolean }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; w?: number; dash?: boolean; alpha?: number }
  | { t: 'rect'; x: number; y: number; w: number; h: number; angle?: number; fill?: string; stroke?: string; alpha?: number }
  | { t: 'poly'; pts: number[][]; fill?: string; stroke?: string; closed?: boolean; alpha?: number; w?: number }
  | { t: 'path'; pts: number[][]; color: string; dash?: boolean; w?: number; alpha?: number }
  | { t: 'spring'; x1: number; y1: number; x2: number; y2: number; coils: number; amp: number; color: string }
  | { t: 'text'; x: number; y: number; text: string; color?: string; size?: number; align?: 'left' | 'center' | 'right' }
  | { t: 'ground'; y: number; x1: number; x2: number }
  | { t: 'arrow'; x1: number; y1: number; x2: number; y2: number; color: string; w?: number; label?: string }

/** What the overlays (trails, vectors, centre of mass) know about a moving body. */
export interface BodyInfo {
  id: string
  x: number
  y: number
  z?: number
  vx: number
  vy: number
  vz?: number
  ax: number
  ay: number
  /** Mass (weights the centre of mass and turns the acceleration into a force). */
  m: number
  color: string
  /** Radius in world units, for the 3-D view (the shapes carry their own). */
  r?: number
  name?: string
  /** Leaves a trail (default true). */
  trail?: boolean
}

export interface Frame {
  shapes: Shape[]
  bodies: BodyInfo[]
  /** Keep this point at the centre of the canvas ("follow"). */
  focus?: { x: number; y: number }
  /** A short line drawn in the corner (a status such as "Hit!"). */
  banner?: string
}

export interface Bounds {
  x0: number
  y0: number
  x1: number
  y1: number
}

// ------------------------------------------------------------------------------------------ data

export interface Channel {
  key: string
  label: string
  unit?: string
  /** A closed-form curve rather than a simulated quantity. */
  analytic?: boolean
}

export interface Energy {
  ke: number
  pe: number
  total: number
}

export interface Readout {
  label: string
  value: string
  /** The analytic value, shown beside the measured one. */
  theory?: string
  tone?: 'ok' | 'warn' | 'info'
}

export interface Series {
  key: string
  label?: string
  dash?: boolean
  /** A series drawn with markers only (Poincaré points). */
  markers?: boolean
  /** Its own x channel (default: the plot's). */
  x?: string
}

export interface PlotSpec {
  id: string
  title: string
  /** time / xy: lines of the recorded channels; extra: only the scene's point clouds. */
  kind: 'time' | 'xy' | 'extra'
  /** The x channel (time/xy). */
  x?: string
  series: Series[]
  xLabel: string
  yLabel: string
  /** Equal axes (trajectories, orbits). */
  equal?: boolean
  logY?: boolean
  /** Point clouds of the scene (`Sim.extra`) drawn as well: Poincaré points, background contours. NaN points break a line. */
  clouds?: { key: string; label: string; markers?: boolean; dash?: boolean }[]
}

export interface Sim {
  readonly scene: SceneId
  readonly mode: string
  t: number
  /** Live-editable parameters (the scene reads the `live` ones every step). */
  params: Params
  method: Method
  /** Fixed step, in time units. */
  dt: number
  timeUnit: string
  lengthUnit: string
  /** Time units per real second at speed x1. */
  realtime: number
  /** Default data-recording interval, in time units. */
  sampleDt: number
  channels: Channel[]
  plots: PlotSpec[]
  /** Methods that make sense here (events and closed forms ignore the choice). */
  methods: Method[]
  /** Energy is conserved (the integrator comparison applies). */
  conservative: boolean
  finished: boolean
  step(dt: number): void
  frame(): Frame
  sample(): Record<string, number>
  energy(): Energy | null
  readouts(): Readout[]
  bounds(): Bounds
  /** Point clouds for the "extra" plots (Poincaré sections, background contours). */
  extra?(): Record<string, number[][]>
  /** Interaction with the canvas (sandbox): grab, drag, release; returns true when it handled the event. */
  pointer?(kind: 'down' | 'move' | 'up', x: number, y: number): boolean
  /** Does the scene have a 3-D position for every body (the 3-D view is offered). */
  threeD?: boolean
  /** Scene specific text under the canvas. */
  status?(): string | null
}

export interface Sweep {
  title: string
  xLabel: string
  yLabel: string
  x: number[]
  /** Measured response (amplitude) and the closed form, when there is one. */
  measured: number[]
  theory?: number[]
  phase?: number[]
  phaseTheory?: number[]
  /** The current drive frequency, to mark. */
  mark?: number
}

export interface SceneDef {
  id: SceneId
  name: string
  blurb: string
  modes: ModeDef[]
  params: ParamDef[]
  /** The complete parameter set of a mode. */
  defaults(mode: string): Params
  presets(mode: string): Preset[]
  create(params: Params, method?: Method): Sim
  /** Measured resonance curve for the driven modes. */
  sweep?(params: Params, method?: Method): Sweep | null
}

// ------------------------------------------------------------------------------------------ file

export interface View {
  cx: number
  cy: number
  /** Pixels per world unit. */
  scale: number
}

export interface KMotionDoc {
  format: 'kmotion'
  version: 1
  scene: SceneId
  params: Params
  view?: View
  method?: Method
  title?: string
  description?: string
}
