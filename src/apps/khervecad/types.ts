// The JSON the desktop window (kcweb, in Python) and this web side exchange.
// See public/apps/khervecad/py/kcweb/ui.py for how each node is made.

/** A QAction: a menu entry or toolbar button. */
export interface ActionNode {
  id: number
  text?: string
  icon?: string
  /** Shortcuts in Qt's form ("Ctrl+Shift+S"). */
  sc?: string[]
  ck?: 1
  chk?: 1
  dis?: 1
  hid?: 1
  tip?: string
  st?: string
  key?: string | number
  sep?: 1
  menu?: ActionNode[]
  /** Toolbar: text beside the icon. */
  beside?: 1
}

export interface MenuNode {
  id: number
  title: string
  items: ActionNode[]
}

/** A layout (box, form, grid) or a spacer inside one. */
export interface LayoutNode {
  k: 'v' | 'h' | 'form' | 'grid' | 'stretch' | 'space'
  items?: (Node | LayoutNode | null)[]
  rows?: [(Node | LayoutNode | null), (Node | LayoutNode | null)][]
  cells?: [number, number, number, number, Node | LayoutNode | null][]
  cs?: Record<string, number>
  m?: number[]
  s?: number
  n?: number
}

export interface TreeRow {
  i: number
  text: string
  icon?: string
  fg?: string
  tip?: string
  it?: 1
  b?: 1
  sel?: 1
  exp?: 1
  hid?: 1
  tag?: string
  ne?: 1
  ph?: 1
  cols?: string[]
  cs?: number
  kids?: TreeRow[]
}

export interface TableCell {
  text: string
  fg?: string
  bg?: string
  tip?: string
  ro?: 1
  sel?: 1
  it?: 1
  b?: 1
}

export interface ListRow {
  text: string
  icon?: string
  sel?: 1
  fg?: string
  tip?: string
  hid?: 1
  dis?: 1
  cs?: number
}

/** A widget. `same` means: the one you already have with this id. */
export interface Node {
  id: number
  same?: 1
  t?: string
  hid?: 1
  dis?: 1
  tip?: string
  name?: string
  /** fixed / minimum / maximum width and height */
  fw?: number
  fh?: number
  mw?: number
  mh?: number
  xw?: number
  xh?: number
  /** stretch in its box layout */
  str?: number
  l?: LayoutNode
  kids?: Node[]
  // label / buttons
  text?: string
  rich?: 1
  wrap?: 1
  al?: number
  icon?: string | null
  ck?: 1
  chk?: 1
  def?: 1
  css?: string
  act?: number
  sc?: string[]
  menu?: ActionNode[]
  popup?: number
  style?: number
  rep?: 1
  // inputs
  ph?: string
  ro?: 1
  pw?: 1
  html?: 1
  nowrap?: 1
  cmd?: [string, number]
  value?: number
  min?: number
  max?: number
  step?: number
  dec?: number
  suf?: string
  pre?: string
  int?: 1
  special?: string
  o?: number | string
  items?: unknown[]
  idx?: number
  edit?: 1 | number
  etext?: string
  // containers
  title?: string
  tabs?: { label: string; tip?: string; icon?: string; dis?: 1; hid?: 1 }[]
  page?: Node | null
  w?: Node | null
  sizes?: number[]
  // views
  rows?: TreeRow[] | number
  hdr?: string[]
  multi?: 1
  cur?: number | [number, number]
  scroll?: number
  ind?: number
  cols?: number
  cells?: [number, number, TableCell][]
  widgets?: [number, number, Node][]
  hl?: string[]
  vl?: string[]
  novh?: 1
  cw?: Record<string, number>
  msg?: string
  overlays?: Node[]
}

export interface WindowNode {
  id: number
  title: string
  node: Node
  modal: 0 | 1
  w: number
  h: number
  cls: string
}

/** A modal question a desktop action stopped at (QFileDialog, QMessageBox…). */
export interface AskSpec {
  kind: 'question' | 'message' | 'text' | 'double' | 'int' | 'item' | 'color' | 'open' | 'open_many' | 'save' | 'folder' | 'openscad'
  title?: string
  text?: string
  label?: string
  info?: string
  detail?: string
  icon?: number
  buttons?: string[]
  default?: number
  checkbox?: string | null
  value?: unknown
  min?: number
  max?: number
  decimals?: number
  items?: string[]
  current?: number
  editable?: boolean
  multiline?: boolean
  alpha?: number
  with_alpha?: boolean
  start?: string
  filter?: string
  code?: string
  format?: string
  defines?: Record<string, string>
  /** a new number for every question (the same question asked again is a new one) */
  seq?: number
}

export interface RenderJob {
  id: number
  kind: 'render' | 'part'
  code: string
  gen: number
  key?: string
  /** OpenSCAD -D variables ($t while animating) */
  defines?: Record<string, string>
}

export interface MeshPayload {
  pos: string
  n: number
  pal?: [string | number[], number, string][]
  idx?: string
}

export interface ViewLook {
  style: string
  bg: string
  bgc: [string, string]
  stage: boolean
  cavity: boolean
  edges: boolean
  smooth: boolean
  grid: boolean
  scale_bar: boolean
  overlay: boolean
  unit: string
  real_scale: number
  source: string
  light: [number, number, number, number]
  flash: string
  banner: string
  pick: 0 | 1
  edit: 0 | 1
  cut: { axis: string; position: number; flip: boolean; offset: number } | null
  user_moved: boolean
  cursor: number
  /** the theme's selection colour (the default face colour comes from it) */
  base?: string
  border?: string
  text?: string
  /** "1 : 250 000 000" under the scale bar of a scale model */
  ratio?: string
  hover?: { label: string; kind: string; pos: number[]; tris: string | null }
}

export interface Camera {
  yaw: number
  pitch: number
  distance: number
  target: number[]
  projection: string
}

export interface V3State {
  mesh?: MeshPayload
  hi?: MeshPayload
  cam?: Camera
  look?: ViewLook
  markers?: { pos: number[]; dir: number[]; name: string; kind: string }[]
  refs?: Record<string, unknown>[]
}

export interface SketchItem {
  i: number
  x: number
  y: number
  cls: string
  k: 'line' | 'rect' | 'ellipse' | 'poly' | 'path' | 'text' | 'none'
  g?: number[]
  z?: number
  hid?: 1
  sel?: 1
  ign?: 1
  mov?: 1
  cur?: number
  op?: number
  pen?: [string | null, number, 0 | 1, number, number]
  br?: string
  path?: { pts: string; lens: number[]; rule: number }
  faces?: { pts: string; idx: number[]; pal: string[] }
  label?: string
  lc?: string
  lp?: [number, number]
  lh?: number
  text?: string
  kids?: SketchItem[]
}

export interface SketchState {
  items?: SketchItem[]
  plane?: string
  grid?: boolean
  gs?: number
  dims?: boolean
  tool?: string
  unit?: string
  ma?: [number, number] | null
  mb?: [number, number] | null
  placed?: { a: number[]; b: number[]; plane: string }[]
  band?: number[] | null
  tok?: Record<string, string>
  view?: { sx: number; sy: number; cx: number; cy: number; rev: number }
  cursor?: number
}

export interface MainNode {
  toolbars: [number, Node][]
  central: Node
  status: Node
  docks: [number, number, string, 0 | 1, Node | null][]
}

/** What Python answers to every request. */
export interface Reply {
  title: string
  /** the menu bar: its menus in order, and those that changed */
  menubar?: { order: number[]; menus: MenuNode[] }
  main: MainNode
  windows: WindowNode[]
  ask?: AskSpec
  popups?: { id: number; items: ActionNode[]; pos: [number, number] | null }[]
  messages?: [string, string, string][]
  jobs?: RenderJob[]
  v3?: V3State
  sketch?: SketchState
  settings?: Record<string, unknown>
  clipboard?: string
  dirty: boolean
  path: string | null
  errors?: string[]
  tick?: number
  fatal?: string
  trace?: string
  /** answers to AI tool calls (desktop MCP tools) */
  mcp?: { req: number; result: unknown }[]
  /** the answer to closing the window with unsaved changes */
  close_ok?: boolean
  /** what the desktop asked of the system: another window, close, show a file, a web page */
  os?: { op: 'new_window' | 'close' | 'reveal' | 'url'; path?: string; url?: string }[]
}

/** One input event for Python (see kcweb/ui.py dispatch and app.py). */
export interface UiEvent {
  op: string
  id?: number
  [field: string]: unknown
}
