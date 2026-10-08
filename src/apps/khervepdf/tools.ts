// The KhervePDF tools in the desktop's toolbar order (MainWindow._build_toolbar),
// their tooltips, per-tool settings (pdftab.TOOL_DEFAULTS) and the colour grid
// of the options popup (_PALETTE_GRID).

import type { Glyph } from './icons'

export type ToolId =
  | 'hand' | 'select' | 'select_text' | 'snapshot' | 'pen' | 'highlight' | 'underline' | 'strikeout' | 'text' | 'edit_text'
  | 'move_text' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'note' | 'signature' | 'erase' | 'redact'

export interface ToolDef {
  id: ToolId
  /** Name in the Tools menu. */
  label: string
  icon: Glyph
  tip: string
  /** On the toolbar (Redact is only in the Tools menu, as on the desktop). */
  toolbar: boolean
}

export const TOOLS: ToolDef[] = [
  { id: 'hand', label: 'Hand', icon: 'hand', toolbar: true, tip: 'Hand — pan the document; drag over text to select it (Ctrl+C copies, right-click to edit / delete / highlight)' },
  { id: 'select', label: 'Select', icon: 'select', toolbar: true, tip: 'Select — click an annotation (Delete removes it), or drag over text to select it (Ctrl+C copies, right-click to edit / delete / highlight)' },
  { id: 'select_text', label: 'Select Text', icon: 'select_text', toolbar: true, tip: 'Select Text — drag over text, then Ctrl+C (or right-click) to copy it' },
  { id: 'snapshot', label: 'Snapshot', icon: 'snapshot', toolbar: true, tip: 'Snapshot — drag a box to copy that page area to the clipboard as an image' },
  { id: 'pen', label: 'Pen', icon: 'pen', toolbar: true, tip: 'Pen' },
  { id: 'highlight', label: 'Highlight', icon: 'highlight', toolbar: true, tip: 'Highlight — swipe over text' },
  { id: 'underline', label: 'Underline', icon: 'underline', toolbar: true, tip: 'Underline — swipe over text to underline it' },
  { id: 'strikeout', label: 'Strikethrough', icon: 'strikeout', toolbar: true, tip: 'Strikethrough — swipe over text to strike it through' },
  { id: 'text', label: 'Text', icon: 'text', toolbar: true, tip: 'Text (add new)' },
  { id: 'edit_text', label: 'Edit Text', icon: 'edit_text', toolbar: true, tip: 'Edit existing text' },
  { id: 'move_text', label: 'Move Text', icon: 'move_text', toolbar: true, tip: 'Move a paragraph — drag to reposition' },
  { id: 'line', label: 'Line', icon: 'line', toolbar: true, tip: 'Line' },
  { id: 'arrow', label: 'Arrow', icon: 'arrow', toolbar: true, tip: 'Arrow' },
  { id: 'rect', label: 'Rectangle', icon: 'rect', toolbar: true, tip: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse', icon: 'ellipse', toolbar: true, tip: 'Ellipse' },
  { id: 'note', label: 'Sticky Note', icon: 'note', toolbar: true, tip: 'Sticky Note' },
  { id: 'signature', label: 'Signature', icon: 'signature', toolbar: true, tip: 'Signature' },
  { id: 'erase', label: 'Eraser', icon: 'erase', toolbar: true, tip: 'Eraser — click an annotation to delete it' },
  { id: 'redact', label: 'Redact', icon: 'redact', toolbar: false, tip: 'Redact — mark areas to black out, then Apply Redactions' },
]

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<ToolId, ToolDef>

/** MainWindow.OPTIONS_TOOLS: the tools with a dropdown arrow (the options popup). */
export const OPTIONS_TOOLS = new Set<ToolId>(['pen', 'highlight', 'underline', 'strikeout', 'line', 'arrow', 'rect', 'ellipse', 'text', 'edit_text'])

/** The status-bar name of a tool: name.replace("_", " ").capitalize(). */
export function toolStatusName(id: string): string {
  const s = id.replace('_', ' ')
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

export interface ToolSetting {
  color: string
  /** Stroke width in points (font size for the text tools). */
  width: number
  /** 0–100 */
  opacity: number
  filled?: boolean
  fill?: string | null
}

export type ToolSettings = Record<ToolId, ToolSetting>

const DEFAULTS: ToolSettings = {
  hand: { color: '#000000', width: 1, opacity: 100 },
  pen: { color: '#1976d2', width: 2, opacity: 100 },
  highlight: { color: '#fbc02d', width: 14, opacity: 35 },
  underline: { color: '#1976d2', width: 1, opacity: 100 },
  strikeout: { color: '#c62828', width: 1, opacity: 100 },
  snapshot: { color: '#1976d2', width: 1, opacity: 100 },
  rect: { color: '#388e3c', width: 2, opacity: 100, filled: false, fill: null },
  ellipse: { color: '#7b1fa2', width: 2, opacity: 100, filled: false, fill: null },
  line: { color: '#212121', width: 2, opacity: 100 },
  arrow: { color: '#212121', width: 2, opacity: 100 },
  text: { color: '#000000', width: 11, opacity: 100 },
  erase: { color: '#000000', width: 1, opacity: 100 },
  select: { color: '#000000', width: 1, opacity: 100 },
  select_text: { color: '#000000', width: 1, opacity: 100 },
  edit_text: { color: '#000000', width: 11, opacity: 100 },
  move_text: { color: '#000000', width: 1, opacity: 100 },
  note: { color: '#fbc02d', width: 1, opacity: 100 },
  signature: { color: '#0d47a1', width: 1, opacity: 100 },
  redact: { color: '#000000', width: 1, opacity: 100 },
}

const KEY = 'khervepdf.tools'

export function loadToolSettings(): ToolSettings {
  const out = structuredClone(DEFAULTS)
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<ToolId, Partial<ToolSetting>>>
    for (const id of Object.keys(out) as ToolId[]) Object.assign(out[id], saved[id] ?? {})
  } catch {
    /* defaults */
  }
  return out
}

export function saveToolSettings(s: ToolSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* private mode */
  }
}

/** The desktop app's Office-style grid: a grey ramp, vivid colours, deep and pale shades. */
export const PALETTE: string[][] = [
  ['#000000', '#262626', '#404040', '#595959', '#7f7f7f', '#a6a6a6', '#bfbfbf', '#d9d9d9', '#f2f2f2', '#ffffff'],
  ['#c00000', '#ff0000', '#ff6600', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#7030a0'],
  ['#7f1414', '#a6324e', '#a66232', '#a68f2f', '#638f1a', '#1f8f4d', '#1f718f', '#2a4d8f', '#3a2a8f', '#582d7e'],
  ['#f2d7d7', '#fad7e0', '#fae5d7', '#faf6d7', '#e7fad7', '#d7fae0', '#d7f0fa', '#d7e7fa', '#d7ddfa', '#e6d7fa'],
]

/** Tools that draw by dragging across the page. */
export const DRAW_TOOLS = new Set<ToolId>(['pen', 'line', 'arrow', 'rect', 'ellipse', 'highlight', 'underline', 'strikeout', 'signature', 'redact', 'snapshot'])
/** Tools under which the page shows a text cursor (pdftab._apply_drag_mode: I-beam). */
export const TEXT_TOOLS = new Set<ToolId>(['text', 'edit_text', 'select_text', 'underline', 'strikeout'])
