// KherveBook documents: the .kbook format shared with the desktop app, and
// Jupyter .ipynb import/export (the desktop's lossless metadata scheme).
//
//   .kbook = {"format": "kbook", "version": 7, "cells": [{"type", "source",
//             optional "title", "collapsed", "column", "height", "width"}]}
//
// Cell types: the desktop's eleven (code, markdown, note, latex, sheet, svg,
// js, file, kfit, ktex, mol). A type this version doesn't know is kept as an
// "other" cell and written back exactly as read. Unknown keys (top level and
// per cell) are kept too, so a desktop file survives a round trip.

import { workbookMarkdown } from './sheet'

export type CellType = 'code' | 'markdown' | 'note' | 'latex' | 'sheet' | 'svg' | 'js' | 'file' | 'kfit' | 'ktex' | 'mol'
/** 'other': a cell type from the desktop app this version cannot show yet. */
export type CellKind = CellType | 'other'

/** The toolbar's cell-type selector (desktop MainWindow.CELL_TYPES), in its order. */
export const CELL_TYPES: readonly { type: CellType; label: string; convert: string }[] = [
  { type: 'code', label: 'Code', convert: 'Code' },
  { type: 'markdown', label: 'Markdown', convert: 'Markdown' },
  { type: 'note', label: 'Note', convert: 'Note' },
  { type: 'latex', label: 'LaTeX', convert: 'LaTeX' },
  { type: 'sheet', label: 'Sheet', convert: 'Sheet' },
  { type: 'svg', label: 'SVG', convert: 'SVG' },
  { type: 'js', label: 'JavaScript', convert: 'JavaScript' },
  { type: 'file', label: 'File', convert: 'File' },
  { type: 'kfit', label: 'KFit', convert: 'KFit' },
  { type: 'ktex', label: 'kTeX Doc', convert: 'kTeX Document' },
  { type: 'mol', label: 'Molecule', convert: 'Molecule' },
]

/** Cells whose source is a JSON document edited through their own view, not as text. */
export const isJsonCell = (t: CellKind) => t === 'note' || t === 'file' || t === 'kfit' || t === 'ktex' || t === 'mol'

export const isCellType = (v: unknown): v is CellType => CELL_TYPES.some((t) => t.type === v)

export const typeLabel = (c: { type: CellKind; rawType?: string }): string =>
  c.type === 'other' ? (c.rawType ?? 'other') : (CELL_TYPES.find((t) => t.type === c.type)?.label ?? c.type)

export type StreamName = 'stdout' | 'stderr'

export type Output =
  | { kind: 'stream'; name: StreamName; text: string }
  | { kind: 'result'; text: string; count: number | null }
  /** `data` is base64, except for SVG where it is the SVG text. */
  | { kind: 'image'; mime: string; data: string }
  | { kind: 'error'; ename: string; evalue: string; traceback: string }

/** Per-cell layout saved in the .kbook (desktop format v2–v4). */
export interface CellLayout {
  /** A heading shown at the top of the cell ("" = none). */
  title: string
  /** Minimised to its title or a one-line summary. */
  collapsed: boolean
  /** Sits beside the previous cell, in the same row. */
  column: boolean
  /** Body height cap in px (the content scrolls); null = fit the content. */
  height: number | null
  /** Fixed width in px; null = fill the row. */
  width: number | null
}

/** Computed results of a sheet cell (from Python), not saved. */
export interface SheetResult {
  /** Per sheet: display text of the formula cells, by A1 ref. */
  display: Record<string, string>[]
  /** Plots produced by formulas (base64 PNG). */
  plots: string[]
}

export interface Cell extends CellLayout {
  id: string
  type: CellKind
  /** For 'other' cells: the type written in the file. */
  rawType?: string
  source: string
  /** Properties of the .kbook cell this version doesn't know, written back unchanged. */
  extra?: Record<string, unknown>
  // --- runtime only ---
  /** Execution count shown as In [n] (code cells). */
  count: number | null
  state: 'idle' | 'queued' | 'running'
  outputs: Output[]
  /** What Python is doing for this cell right now ("Loading numpy"…). */
  note: string | null
  /** Markdown / LaTeX / SVG: showing the source editor instead of the rendered view. */
  editing: boolean
  /** Bumped each time the cell is run or rendered (JavaScript cells reload their page). */
  runs: number
  /** Sheet cells: formula values and plots computed by Python. */
  sheet: SheetResult | null
}

/** A cell as read from a file. */
export interface CellData extends Partial<CellLayout> {
  type: CellKind
  rawType?: string
  source: string
  extra?: Record<string, unknown>
  /** Only for imported Jupyter notebooks. */
  outputs?: Output[]
  count?: number | null
}

export interface NotebookDoc {
  kind: 'kbook' | 'ipynb'
  cells: CellData[]
  /** Top-level .kbook fields other than format / version / cells. */
  extra: Record<string, unknown>
  version: number
}

/** The desktop's current format version (v7: ktex and mol cells). */
export const FORMAT_VERSION = 7

let seq = 0
/** Ids are only used while the notebook is open (and as nbformat cell ids on export). */
export function newId(): string {
  return `c${(++seq).toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

const NO_LAYOUT: CellLayout = { title: '', collapsed: false, column: false, height: null, width: null }

export function makeCell(type: CellKind, source = '', editing = type === 'markdown' || type === 'latex'): Cell {
  return {
    id: newId(), type, source, ...NO_LAYOUT,
    count: null, state: 'idle', outputs: [], note: null, editing, runs: 0, sheet: null,
  }
}

/** A cell made from file data (layout and unknown keys kept). */
export function cellFromData(d: CellData, editing = false): Cell {
  const c = makeCell(d.type, d.source, editing)
  return {
    ...c,
    rawType: d.rawType,
    extra: d.extra,
    title: d.title ?? '',
    collapsed: !!d.collapsed,
    column: !!d.column,
    height: d.height ?? null,
    width: d.width ?? null,
    outputs: d.outputs ?? [],
    count: d.count ?? null,
  }
}

/** The part of a cell that is saved (and copied / undone). */
export function cellData(c: Cell): CellData {
  return {
    type: c.type, rawType: c.rawType, source: c.source, extra: c.extra,
    title: c.title, collapsed: c.collapsed, column: c.column, height: c.height, width: c.width,
  }
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** Jupyter stores text either as a string or as a list of lines. */
function joinText(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : String(x ?? ''))).join('')
  return typeof v === 'string' ? v : ''
}

function omit(o: Obj, keys: readonly string[]): Obj {
  const out: Obj = {}
  for (const [k, v] of Object.entries(o)) if (!keys.includes(k)) out[k] = v
  return out
}

const LAYOUT_KEYS = ['title', 'collapsed', 'column', 'height', 'width'] as const
const posNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null)

function layoutOf(o: Obj): Partial<CellLayout> {
  return {
    title: typeof o.title === 'string' ? o.title : '',
    collapsed: o.collapsed === true,
    column: o.column === true,
    height: posNum(o.height),
    width: posNum(o.width),
  }
}

/** The type a file names, split into what this version knows and the raw name. */
function kindOf(t: unknown): { type: CellKind; rawType?: string } {
  const name = typeof t === 'string' && t ? t : 'code' // the desktop's default
  return isCellType(name) ? { type: name } : { type: 'other', rawType: name }
}

// ------------------------------------------------------------------ reading

/** Parse a .kbook or a Jupyter .ipynb (recognised by its content, not its name). */
export function parseNotebook(text: string): NotebookDoc {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    throw new Error('The file is not valid JSON, so it is not a notebook.')
  }
  if (!isObj(doc)) throw new Error('The file is not a notebook.')
  if ('nbformat' in doc || 'worksheets' in doc) {
    return { kind: 'ipynb', cells: fromIpynb(doc), extra: {}, version: FORMAT_VERSION }
  }
  if (!Array.isArray(doc.cells)) throw new Error('The file has no cells, so it is not a kBook notebook.')
  const cells: CellData[] = doc.cells.filter(isObj).map((c) => {
    const extra = omit(c, ['type', 'source', ...LAYOUT_KEYS])
    return {
      ...kindOf(c.type),
      source: joinText(c.source),
      ...layoutOf(c),
      extra: Object.keys(extra).length ? extra : undefined,
    }
  })
  const version = typeof doc.version === 'number' && doc.version > 0 ? doc.version : 1
  return { kind: 'kbook', cells, extra: omit(doc, ['format', 'version', 'cells']), version }
}

// ------------------------------------------------------------------ writing

function cellJson(c: CellData): Obj {
  const d: Obj = { type: c.type === 'other' ? (c.rawType ?? 'code') : c.type, source: c.source }
  if (c.title) d.title = c.title
  if (c.collapsed) d.collapsed = true
  if (c.column) d.column = true
  if (c.height) d.height = c.height
  if (c.width) d.width = c.width
  return { ...d, ...c.extra }
}

export function serializeKbook(cells: readonly CellData[], extra: Obj = {}, version = FORMAT_VERSION): string {
  const doc = { format: 'kbook', version: Math.max(version, FORMAT_VERSION), cells: cells.map(cellJson), ...extra }
  return JSON.stringify(doc, null, 1)
}

/** A single cell as .kbook JSON text (for the system clipboard). */
export function cellsToJson(cells: readonly CellData[]): string {
  return JSON.stringify({ format: 'kbook', version: FORMAT_VERSION, cells: cells.map(cellJson) })
}

// ---------------------------------------------------------- Jupyter import

const KB_TYPES = ['latex', 'sheet', 'note', 'svg', 'js', 'file', 'kfit', 'ktex', 'mol']

function fromIpynb(nb: Obj): CellData[] {
  const raw: unknown[] = Array.isArray(nb.cells)
    ? nb.cells
    : Array.isArray(nb.worksheets) // nbformat 3
      ? nb.worksheets.flatMap((w) => (isObj(w) && Array.isArray(w.cells) ? w.cells : []))
      : []
  const out: CellData[] = []
  for (const c of raw) {
    if (!isObj(c)) continue
    const meta = isObj(c.metadata) ? c.metadata : {}
    const kb = isObj(meta.khervebook) ? meta.khervebook : {}
    const layout = layoutOf(kb)
    // A KherveBook export: the original cell travels in the metadata (lossless).
    if (typeof kb.type === 'string' && KB_TYPES.includes(kb.type) && typeof kb.source === 'string') {
      out.push({ ...kindOf(kb.type), source: kb.source, ...layout })
      continue
    }
    const kind = c.cell_type
    if (kind === 'code') {
      const count = c.execution_count ?? c.prompt_number
      out.push({
        type: 'code',
        source: joinText(c.source ?? c.input),
        count: typeof count === 'number' ? count : null,
        outputs: ipynbOutputs(c.outputs),
        ...layout,
      })
    } else if (kind === 'heading') {
      // nbformat 3
      const level = typeof c.level === 'number' ? Math.min(6, Math.max(1, c.level)) : 1
      out.push({ type: 'markdown', source: `${'#'.repeat(level)} ${joinText(c.source)}` })
    } else {
      // markdown and raw (and anything unknown) become Markdown
      const source = inlineAttachments(joinText(c.source), c.attachments)
      // A cell that is nothing but $$…$$ is an equation: make it a LaTeX cell.
      const eq = /^\s*\$\$([\s\S]+?)\$\$\s*$/.exec(source)
      if (kind === 'markdown' && eq && !eq[1].includes('$$')) out.push({ type: 'latex', source: eq[1].trim(), ...layout })
      else out.push({ type: 'markdown', source, ...layout })
    }
  }
  return out.length ? out : [{ type: 'code', source: '' }]
}

/** Markdown cells may embed pasted images as `attachment:name`: turn them into data: URLs. */
function inlineAttachments(src: string, attachments: unknown): string {
  if (!isObj(attachments) || !src.includes('attachment:')) return src
  return src.replace(/attachment:([^\s)"'>]+)/g, (m, name: string) => {
    let key = name
    try {
      key = decodeURIComponent(name)
    } catch {
      /* keep the raw name */
    }
    const bundle = attachments[key] ?? attachments[name]
    if (!isObj(bundle)) return m
    for (const [mime, data] of Object.entries(bundle)) {
      if (!mime.startsWith('image/')) continue
      return mime === 'image/svg+xml'
        ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(joinText(data))}`
        : `data:${mime};base64,${joinText(data).replace(/\s+/g, '')}`
    }
    return m
  })
}

function pickImage(data: Obj): Output | null {
  for (const [mime, key3] of [['image/png', 'png'], ['image/jpeg', 'jpeg'], ['image/gif', 'gif'], ['image/svg+xml', 'svg']] as const) {
    const v = data[mime] ?? data[key3]
    if (v === undefined) continue
    const text = joinText(v)
    if (!text) continue
    return { kind: 'image', mime, data: mime === 'image/svg+xml' ? text : text.replace(/\s+/g, '') }
  }
  return null
}

function ipynbOutputs(list: unknown): Output[] {
  if (!Array.isArray(list)) return []
  const out: Output[] = []
  for (const o of list) {
    if (!isObj(o)) continue
    switch (o.output_type) {
      case 'stream': {
        const name = o.name === 'stderr' ? 'stderr' : 'stdout'
        const text = joinText(o.text)
        const last = out[out.length - 1]
        if (last?.kind === 'stream' && last.name === name) last.text += text
        else if (text) out.push({ kind: 'stream', name, text })
        break
      }
      case 'execute_result':
      case 'display_data':
      case 'pyout': {
        // nbformat 4 keeps the mime bundle in `data`; nbformat 3 puts it on the output itself
        const data = isObj(o.data) ? o.data : o
        const image = pickImage(data)
        if (image) {
          out.push(image)
          break
        }
        const text = joinText(data['text/plain'] ?? data.text)
        if (!text) break
        if (o.output_type === 'display_data') out.push({ kind: 'stream', name: 'stdout', text: text.endsWith('\n') ? text : text + '\n' })
        else {
          const n = o.execution_count ?? o.prompt_number
          out.push({ kind: 'result', text, count: typeof n === 'number' ? n : null })
        }
        break
      }
      case 'error':
      case 'pyerr': {
        const ename = typeof o.ename === 'string' ? o.ename : 'Error'
        const evalue = typeof o.evalue === 'string' ? o.evalue : ''
        const tb = Array.isArray(o.traceback) ? o.traceback.map(String).join('\n') : ''
        out.push({ kind: 'error', ename, evalue, traceback: tb || `${ename}: ${evalue}` })
        break
      }
    }
  }
  return out
}

// ---------------------------------------------------------- Jupyter export

/** "a\nb" → ["a\n", "b"], the way Jupyter stores multi-line strings. */
function lines(s: string): string[] {
  return s ? s.split(/(?<=\n)/) : ['']
}

/** Prose LaTeX (sections, \textbf…) rather than one equation. */
export function isLatexDocument(tex: string): boolean {
  return [
    '\\documentclass', '\\usepackage', '\\section', '\\subsection', '\\paragraph', '\\textbf', '\\textit', '\\emph',
    '\\underline', '\\texttt', '\\textsc', '\\begin{itemize}', '\\begin{enumerate}', '\\begin{document}',
  ].some((s) => tex.includes(s))
}

function jsonOf(src: string): Obj | null {
  try {
    const v = JSON.parse(src) as unknown
    return isObj(v) ? v : null
  } catch {
    return null
  }
}

/** A Note cell's HTML (desktop ipynb._note_markdown). */
function noteMarkdown(src: string): string {
  const d = jsonOf(src)
  return d && 'html' in d ? String(d.html ?? '') : src
}

/** desktop ipynb._file_markdown */
function fileMarkdown(src: string): string {
  const d = jsonOf(src)
  let names: string[] = []
  if (d && Array.isArray(d.files)) names = d.files.filter(isObj).map((f) => String(f.name ?? '')).filter(Boolean)
  else if (d && typeof d.name === 'string' && d.name) names = [d.name]
  return names.length ? `📎 **Attached files:** ${names.map((n) => `\`${n}\``).join(', ')}` : '📎 Attached files'
}

/** desktop ipynb._ktex_markdown */
function ktexMarkdown(src: string): string {
  const d = jsonOf(src)
  const name = d && isObj(d.file) ? String(d.file.name ?? '') : ''
  return name ? `📄 **KherveTeX document:** \`${name}\`` : '📄 kTeX document'
}

/** desktop ipynb._mol_markdown: "⚛ **Molecule:** label (formula)", C and H first. */
export function molMarkdown(src: string): string {
  const d = jsonOf(src)
  const mol = d && isObj(d.kmol) && isObj(d.kmol.mol3d) ? d.kmol.mol3d : null
  if (!mol) return '⚛ Molecule'
  const counts = new Map<string, number>()
  for (const a of Array.isArray(mol.atoms) ? mol.atoms : []) {
    const e = Array.isArray(a) ? String(a[0]) : ''
    if (e) counts.set(e, (counts.get(e) ?? 0) + 1)
  }
  const rank = (e: string): [number, number, string] => [e !== 'C' ? 1 : 0, e !== 'H' ? 1 : 0, e]
  const order = [...counts.keys()].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    return ra[0] - rb[0] || ra[1] - rb[1] || (ra[2] < rb[2] ? -1 : ra[2] > rb[2] ? 1 : 0)
  })
  const formula = order.map((e) => e + ((counts.get(e) ?? 0) > 1 ? String(counts.get(e)) : '')).join('')
  const label = String(mol.label || mol.name || 'Molecule')
  return `⚛ **Molecule:** ${label} (${formula})`
}

/** What Jupyter shows for a cell type it doesn't have (the desktop's _display_body). */
function displayBody(type: string, src: string): string {
  switch (type) {
    case 'latex':
      return isLatexDocument(src) ? '```latex\n' + src + '\n```' : '$$\n' + src.trim() + '\n$$'
    case 'sheet':
      return workbookMarkdown(src)
    case 'note':
      return noteMarkdown(src)
    case 'file':
      return fileMarkdown(src)
    case 'js':
      return '```javascript\n' + src + '\n```'
    case 'ktex':
      return ktexMarkdown(src)
    case 'mol':
      return molMarkdown(src)
    case 'svg':
      return src.trimStart().startsWith('<svg') ? src : '```\n' + src + '\n```'
    default:
      return '```\n' + src + '\n```'
  }
}

function nbOutput(o: Output): Obj {
  switch (o.kind) {
    case 'stream':
      return { output_type: 'stream', name: o.name, text: lines(o.text) }
    case 'result':
      return { output_type: 'execute_result', execution_count: o.count, data: { 'text/plain': lines(o.text) }, metadata: {} }
    case 'image':
      return {
        output_type: 'display_data',
        data: { [o.mime]: o.mime === 'image/svg+xml' ? lines(o.data) : o.data, 'text/plain': ['<Figure>'] },
        metadata: {},
      }
    case 'error':
      return { output_type: 'error', ename: o.ename, evalue: o.evalue, traceback: o.traceback.split('\n') }
  }
}

export function toIpynb(cells: readonly Cell[], pythonVersion: string | null): string {
  const nbCells = cells.map((c) => {
    const type = c.type === 'other' ? (c.rawType ?? 'code') : c.type
    const props: Obj = {}
    for (const k of LAYOUT_KEYS) if (c[k]) props[k] = c[k]
    const metadata: Obj = Object.keys(props).length ? { khervebook: props } : {}
    if (type === 'code') {
      return { cell_type: 'code', execution_count: c.count, id: c.id, metadata, outputs: c.outputs.map(nbOutput), source: lines(c.source) }
    }
    if (type === 'markdown') return { cell_type: 'markdown', id: c.id, metadata, source: lines(c.source) }
    // No Jupyter equivalent: a readable display, with the original kept in the metadata.
    const kb = { ...props, type, source: c.source }
    return { cell_type: 'markdown', id: c.id, metadata: { khervebook: kb }, source: lines(displayBody(type, c.source)) }
  })
  const nb = {
    cells: nbCells,
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python', ...(pythonVersion ? { version: pythonVersion } : {}) },
    },
    nbformat: 4,
    nbformat_minor: 5,
  }
  return JSON.stringify(nb, null, 1) + '\n'
}
