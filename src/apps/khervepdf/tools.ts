// The KhervePDF tools, their per-tool settings (colour, width, opacity, fill,
// text size — the desktop app's defaults) and the colour palette.

import {
  Circle, Eraser, EyeOff, Hand, Highlighter, Minus, MousePointer2, MoveUpRight, Pen, Scan, Signature, Square, StickyNote,
  Strikethrough, TextCursor, Type, Underline,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type ToolId =
  | 'hand' | 'select' | 'select_text' | 'pen' | 'highlight' | 'underline' | 'strikeout' | 'text' | 'line' | 'arrow' | 'rect'
  | 'ellipse' | 'note' | 'signature' | 'redact' | 'erase' | 'snapshot'

export interface ToolDef {
  id: ToolId
  label: string
  icon: LucideIcon
  tip: string
  /** Which settings the options popover shows. */
  options?: { width?: boolean; opacity?: boolean; fill?: boolean; size?: boolean; color?: boolean }
}

export const TOOLS: ToolDef[] = [
  { id: 'hand', label: 'Hand', icon: Hand, tip: 'Hand — drag to move around; drag over text to select it' },
  { id: 'select', label: 'Select', icon: MousePointer2, tip: 'Select — click an annotation to select, move or delete it' },
  { id: 'select_text', label: 'Select Text', icon: TextCursor, tip: 'Select Text — drag over text, then copy it (⌘C)' },
  { id: 'pen', label: 'Pen', icon: Pen, tip: 'Pen', options: { color: true, width: true, opacity: true } },
  { id: 'highlight', label: 'Highlight', icon: Highlighter, tip: 'Highlight — swipe over text', options: { color: true, opacity: true } },
  { id: 'underline', label: 'Underline', icon: Underline, tip: 'Underline — swipe over text', options: { color: true, opacity: true } },
  { id: 'strikeout', label: 'Strikethrough', icon: Strikethrough, tip: 'Strikethrough — swipe over text', options: { color: true, opacity: true } },
  { id: 'text', label: 'Text', icon: Type, tip: 'Text — click to type on the page', options: { color: true, size: true } },
  { id: 'line', label: 'Line', icon: Minus, tip: 'Line', options: { color: true, width: true, opacity: true } },
  { id: 'arrow', label: 'Arrow', icon: MoveUpRight, tip: 'Arrow', options: { color: true, width: true, opacity: true } },
  { id: 'rect', label: 'Rectangle', icon: Square, tip: 'Rectangle', options: { color: true, width: true, opacity: true, fill: true } },
  { id: 'ellipse', label: 'Ellipse', icon: Circle, tip: 'Ellipse', options: { color: true, width: true, opacity: true, fill: true } },
  { id: 'note', label: 'Sticky Note', icon: StickyNote, tip: 'Sticky note — click to add a note', options: { color: true } },
  { id: 'signature', label: 'Signature', icon: Signature, tip: 'Signature — drag a box, then sign with the mouse', options: { color: true } },
  { id: 'redact', label: 'Redact', icon: EyeOff, tip: 'Redact — mark areas to black out (Tools › Apply Redactions)' },
  { id: 'erase', label: 'Eraser', icon: Eraser, tip: 'Eraser — click or swipe over annotations to delete them' },
  { id: 'snapshot', label: 'Snapshot', icon: Scan, tip: 'Snapshot — drag a box to copy that area as a picture' },
]

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<ToolId, ToolDef>

export interface ToolSetting {
  color: string
  /** Stroke width in points (font size for the Text tool). */
  width: number
  /** 0–100 */
  opacity: number
  filled?: boolean
  fill?: string | null
}

export type ToolSettings = Record<ToolId, ToolSetting>

const DEFAULTS: ToolSettings = {
  hand: { color: '#000000', width: 1, opacity: 100 },
  select: { color: '#000000', width: 1, opacity: 100 },
  select_text: { color: '#000000', width: 1, opacity: 100 },
  pen: { color: '#1976d2', width: 2, opacity: 100 },
  highlight: { color: '#fbc02d', width: 14, opacity: 35 },
  underline: { color: '#1976d2', width: 1, opacity: 100 },
  strikeout: { color: '#c62828', width: 1, opacity: 100 },
  text: { color: '#000000', width: 11, opacity: 100 },
  line: { color: '#212121', width: 2, opacity: 100 },
  arrow: { color: '#212121', width: 2, opacity: 100 },
  rect: { color: '#388e3c', width: 2, opacity: 100, filled: false, fill: null },
  ellipse: { color: '#7b1fa2', width: 2, opacity: 100, filled: false, fill: null },
  note: { color: '#fbc02d', width: 1, opacity: 100 },
  signature: { color: '#0d47a1', width: 1, opacity: 100 },
  redact: { color: '#000000', width: 1, opacity: 100 },
  erase: { color: '#000000', width: 1, opacity: 100 },
  snapshot: { color: '#1976d2', width: 1, opacity: 100 },
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
/** Tools under which the page shows a text cursor. */
export const TEXT_TOOLS = new Set<ToolId>(['select_text', 'highlight', 'underline', 'strikeout', 'text'])
