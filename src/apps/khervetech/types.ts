// What the technique engine (public/apps/khervetech/py/ktech/bridge.py) sends:
// the recorded matplotlib figures (shims/matplotlib/_rec.py), the headless wx
// widget trees (shims/wx), and the window state around them. No browser or OS
// imports: Node tests load this file.

// ------------------------------------------------------------------ figures

export interface TextStyle {
  color?: string | null
  size?: number
  bold?: boolean
  italic?: boolean
  ha?: string
  va?: string
  rotation?: number
  family?: string
  bbox?: { fc: string | null; ec: string | null; alpha: number; pad: number }
}

export interface ArtistJ extends TextStyle {
  k: 'line' | 'axline' | 'scatter' | 'fill' | 'text' | 'annotation' | 'patch' | 'table' | 'error' | string
  id: number
  label?: string
  hidden?: boolean
  z?: number
  alpha?: number
  tags?: Record<string, string | number | boolean>
  /** Transform: 'data' (default), 'axes', 'figure', or 'x|y' blended ('data|axes'). */
  tr?: string
  // line
  x?: string | number | null
  y?: string | number | null
  color?: string | null
  lw?: number
  ls?: string
  marker?: string
  ms?: number
  mfc?: string | null
  mec?: string | null
  drawstyle?: string
  // axline
  dir?: 'v' | 'h'
  at?: number | null
  span?: [number, number]
  // scatter
  s?: number
  ec?: string | null
  cvals?: string
  cmap?: string
  // fill
  y1?: string
  y2?: string
  fc?: string | null
  hatch?: string
  horizontal?: boolean
  // text / annotation
  text?: string
  xy?: [number | null, number | null]
  xycoords?: string | string[]
  xytext?: [number | null, number | null]
  textcoords?: string
  arrow?: { color: string | null; style: string; lw: number }
  // patch
  shape?: string
  geom?: Record<string, unknown>
  // table
  cells?: ({ t: string; fc: string | null; ec: string | null } & TextStyle | null)[][]
  fontsize?: number
  yscale?: number
  align?: string
}

export interface TickParams {
  color?: string | null
  size?: number
  [k: string]: unknown
}

export interface Spine {
  visible: boolean
  color: string | null
  outward: number
  lw: number | null
}

export interface LegendItem {
  label: string
  h: 'line' | 'scatter' | 'patch' | 'none'
  color?: string | null
  lw?: number
  ls?: string
  marker?: string | null
  alpha?: number
}

export interface LegendJ {
  loc: string
  items: LegendItem[]
  frameon: boolean
  framealpha: number
  edgecolor: string | null
  fontsize?: number
  ncol?: number
  title?: string
  hidden?: boolean
}

export interface AxesJ {
  id: number
  pos: [number, number, number, number]
  xlim: [number | null, number | null]
  ylim: [number | null, number | null]
  xlabel: string
  ylabel: string
  xlabelStyle: TextStyle
  ylabelStyle: TextStyle
  title: string
  titleStyle: TextStyle
  artists: ArtistJ[]
  z: number
  visible: boolean
  axisOn: boolean
  xaxisVisible: boolean
  yaxisVisible: boolean
  xticks: number[] | null
  yticks: number[] | null
  xticklabels: string[] | null
  yticklabels: string[] | null
  xtickp: TickParams
  ytickp: TickParams
  xformat: 'plain' | 'sci' | 'auto'
  yformat: 'plain' | 'sci' | 'auto'
  xscale: string
  yscale: string
  patchVisible: boolean
  facecolor: string | null
  spines: Record<'top' | 'bottom' | 'left' | 'right', Spine>
  ySide: string
  aspect: string
  twinOf?: number
  legend?: LegendJ
  children?: AxesJ[]
}

export interface Fig {
  axes: AxesJ[]
  texts: ArtistJ[]
  facecolor: string | null
  version: number
}

export type Arrays = Map<string, (number | null)[]>

// ------------------------------------------------------------------ wx widgets

export interface WxNode {
  t: string
  id?: number
  en?: boolean
  tip?: string
  bg?: string
  fg?: string
  font?: { size?: number; mono?: boolean; bold?: boolean; italic?: boolean }
  w?: number
  h?: number
  minw?: number
  minh?: number
  /** The wx events bound to it (EVT_BUTTON, EVT_KILL_FOCUS…): only those are sent at once. */
  ev?: string[]
  label?: string
  value?: string | number | boolean
  // sizers
  o?: 'h' | 'v' | 'g'
  items?: WxItem[]
  box?: string
  wrap?: boolean | number
  cols?: number | string[]
  vgap?: number
  hgap?: number
  growCols?: Record<string, number>
  growRows?: Record<string, number>
  uniform?: boolean
  // panels
  sizer?: WxNode
  scroll?: boolean
  // text
  align?: string
  multi?: boolean
  ro?: boolean | number[][]
  nowrap?: boolean
  hint?: string
  password?: boolean
  // spin
  min?: number
  max?: number
  inc?: number
  digits?: number
  float?: boolean
  // choice-like
  sel?: number
  editable?: boolean
  checked?: number[]
  group?: number
  // notebook
  pages?: { title: string; n: WxNode | null }[]
  // grid
  widths?: number[]
  rows?: string[][]
  rowLabelW?: number
  colLabelH?: number
  cursor?: [number, number]
  selRows?: number[]
  rowLabels?: Record<string, string>
  bgs?: [number, number, string][]
  fgs?: [number, number, string][]
  // canvas
  fig?: Fig
  // misc
  src?: string
  icon?: string
  url?: string
  vertical?: boolean
  range?: number
  a?: WxNode | null
  b?: WxNode | null
  pos?: number
}

export interface WxItem {
  n: WxNode | null
  /** proportion */
  p?: number
  /** wx flags */
  f?: number
  /** border */
  b?: number
  /** spacer size */
  sw?: number
  sh?: number
  pos?: [number, number]
  span?: [number, number]
}

export interface WxFrame extends Omit<WxNode, 'min'> {
  title: string
  shown: boolean
  size: [number, number]
  min: [number, number]
  modalKind?: string
}

// wx flag bits (shims/wx/__init__.py)
export const WX = {
  TOP: 0x40,
  BOTTOM: 0x80,
  LEFT: 0x10,
  RIGHT: 0x20,
  EXPAND: 0x2000,
  ALIGN_CENTER_HORIZONTAL: 0x100,
  ALIGN_RIGHT: 0x200,
  ALIGN_BOTTOM: 0x400,
  ALIGN_CENTER_VERTICAL: 0x800,
  ID_OK: 5100,
  ID_CANCEL: 5101,
  ID_YES: 5103,
  ID_NO: 5104,
} as const

// ------------------------------------------------------------------ the engine's state

export interface TechInfo {
  key: string
  sections: { key: string; short: string; full: string; help: string }[]
  icon: string
  help: string
  noneIcon: string
  noneHelp: string
  imports: ({ label: string; id: string } | '-')[]
  menuLabel: string
  toolsLabel: string
  exts: string[]
}

export interface Effect {
  /** 'tip': MyFrame.show_popup_message2's balloon; 'message': a wx.MessageBox. */
  kind: 'tip' | 'message' | 'clipboard' | 'opened' | 'raise' | 'closed' | 'endmodal' | 'menu' | string
  title?: string
  message?: string
  icon?: string
  text?: string
  path?: string
  frame?: number
}

export interface TechState {
  main?: Fig
  vlines: Record<string, number>
  rangeActive: boolean
  sheets: string[]
  sheet: string
  file: string
  technique: { key: string; icon: string; help: string } | null
  right?: WxNode
  open: number[]
  frames: WxFrame[]
  canUndo: boolean
  canRedo: boolean
  status: string
  arrays: Record<string, (number | null)[]>
  effects: Effect[]
}

/** A modal dialog the engine reached (wx ShowModal): ask, then send the request again with the answer. */
export interface ModalSpec {
  kind: 'message' | 'text' | 'choice' | 'multichoice' | 'file' | 'dir' | 'dialog'
  index: number
  title?: string
  message?: string
  buttons?: [string, number][]
  icon?: string
  value?: string
  multiline?: boolean
  choices?: string[]
  sel?: number
  sels?: number[]
  save?: boolean
  multiple?: boolean
  dir?: string
  file?: string
  wildcard?: string
  frame?: WxFrame
  ids?: number[]
}

export interface ModalAnswer {
  id: number
  value?: string
  sel?: number
  sels?: number[]
  paths?: string[]
  path?: string
  values?: Record<string, unknown>
}

/** The extensions of a wx wildcard's first filter ("TGA files (*.csv;*.txt)|*.csv;*.CSV;…|All files (*.*)|*.*"). */
export function wildcardExtensions(wildcard: string | undefined): string[] | undefined {
  if (!wildcard) return undefined
  const parts = wildcard.split('|')
  const patterns = (parts.length > 1 ? parts[1] : parts[0]).split(';').map((p) => p.trim().toLowerCase())
  if (patterns.some((p) => p === '*.*' || p === '*')) return undefined
  const exts = [...new Set(patterns.filter((p) => p.startsWith('*.')).map((p) => p.slice(1)))]
  return exts.length ? exts : undefined
}
