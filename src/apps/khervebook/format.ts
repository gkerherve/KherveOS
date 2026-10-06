// KherveBook documents: the .kbook format shared with the desktop app, and
// Jupyter .ipynb import/export.
//
//   .kbook = {"format": "kbook", "version": 1, "cells": [{"type": "code"|"markdown"|"latex", "source": "…"}]}
//
// written with indent=1 like the desktop (json.dumps(doc, indent=1)). Outputs
// are not saved. Unknown fields (top level and per cell) are kept and written
// back, so a newer desktop file survives a round trip through the web app.

export type CellType = 'code' | 'markdown' | 'latex'

export type StreamName = 'stdout' | 'stderr'

export type Output =
  | { kind: 'stream'; name: StreamName; text: string }
  | { kind: 'result'; text: string; count: number | null }
  /** `data` is base64, except for SVG where it is the SVG text. */
  | { kind: 'image'; mime: string; data: string }
  | { kind: 'error'; ename: string; evalue: string; traceback: string }

export interface Cell {
  id: string
  type: CellType
  source: string
  /** Properties of the .kbook cell this version doesn't know, written back unchanged. */
  extra?: Record<string, unknown>
  /** Execution count shown as In [n] (code cells). */
  count: number | null
  state: 'idle' | 'queued' | 'running'
  outputs: Output[]
  /** What Python is doing for this cell right now ("Loading numpy"…). */
  note: string | null
  /** Markdown / LaTeX: showing the editor instead of the rendered text. */
  editing: boolean
}

/** A cell as read from a file. */
export interface CellData {
  type: CellType
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

export const FORMAT_VERSION = 1

let seq = 0
/** Ids are only used while the notebook is open (and as nbformat cell ids on export). */
export function newId(): string {
  return `c${(++seq).toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function makeCell(type: CellType, source = '', editing = type !== 'code'): Cell {
  return { id: newId(), type, source, count: null, state: 'idle', outputs: [], note: null, editing }
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** Jupyter stores text either as a string or as a list of lines. */
function joinText(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : String(x ?? ''))).join('')
  return typeof v === 'string' ? v : ''
}

function omit(o: Obj, keys: string[]): Obj {
  const out: Obj = {}
  for (const [k, v] of Object.entries(o)) if (!keys.includes(k)) out[k] = v
  return out
}

function cellType(v: unknown): CellType {
  return v === 'markdown' || v === 'latex' ? v : 'code'
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
  if (!Array.isArray(doc.cells)) throw new Error('The file has no cells, so it is not a KherveBook notebook.')
  const cells: CellData[] = doc.cells.filter(isObj).map((c) => {
    const extra = omit(c, ['type', 'source'])
    return {
      type: cellType(c.type),
      source: joinText(c.source),
      extra: Object.keys(extra).length ? extra : undefined,
    }
  })
  const version = typeof doc.version === 'number' && doc.version > 0 ? doc.version : FORMAT_VERSION
  return { kind: 'kbook', cells, extra: omit(doc, ['format', 'version', 'cells']), version }
}

// ------------------------------------------------------------------ writing

export function serializeKbook(
  cells: readonly Pick<Cell, 'type' | 'source' | 'extra'>[],
  extra: Obj = {},
  version = FORMAT_VERSION,
): string {
  const doc = {
    format: 'kbook',
    version,
    cells: cells.map((c) => ({ type: c.type, source: c.source, ...c.extra })),
    ...extra,
  }
  return JSON.stringify(doc, null, 1)
}

// ---------------------------------------------------------- Jupyter import

function fromIpynb(nb: Obj): CellData[] {
  const raw: unknown[] = Array.isArray(nb.cells)
    ? nb.cells
    : Array.isArray(nb.worksheets) // nbformat 3
      ? nb.worksheets.flatMap((w) => (isObj(w) && Array.isArray(w.cells) ? w.cells : []))
      : []
  const out: CellData[] = []
  for (const c of raw) {
    if (!isObj(c)) continue
    const kind = c.cell_type
    if (kind === 'code') {
      const count = c.execution_count ?? c.prompt_number
      out.push({
        type: 'code',
        source: joinText(c.source ?? c.input),
        count: typeof count === 'number' ? count : null,
        outputs: ipynbOutputs(c.outputs),
      })
    } else if (kind === 'heading') {
      // nbformat 3
      const level = typeof c.level === 'number' ? Math.min(6, Math.max(1, c.level)) : 1
      out.push({ type: 'markdown', source: `${'#'.repeat(level)} ${joinText(c.source)}` })
    } else {
      // markdown and raw (and anything unknown) become Markdown
      const source = inlineAttachments(joinText(c.source), c.attachments)
      // A cell that is nothing but $$…$$ is an equation: make it a LaTeX cell
      // (this is also how LaTeX cells are exported).
      const eq = /^\s*\$\$([\s\S]+?)\$\$\s*$/.exec(source)
      if (kind === 'markdown' && eq && !eq[1].includes('$$')) out.push({ type: 'latex', source: eq[1].trim() })
      else out.push({ type: 'markdown', source })
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
  return s ? s.split(/(?<=\n)/) : []
}

/** A LaTeX cell as Jupyter Markdown: wrapped in $$…$$ unless it already has its own delimiters. */
export function latexAsMarkdown(src: string): string {
  const t = src.trim()
  if (/^\$\$[\s\S]*\$\$$/.test(t) || /^\\\[[\s\S]*\\\]$/.test(t) || /^\\begin\{/.test(t)) return t
  if (/(^|[^\\])\$/.test(t)) return t // desktop-style "text $math$" — already Markdown math
  return `$$\n${t}\n$$`
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
  const nb = {
    cells: cells.map((c) =>
      c.type === 'code'
        ? {
            cell_type: 'code',
            execution_count: c.count,
            id: c.id,
            metadata: {},
            outputs: c.outputs.map(nbOutput),
            source: lines(c.source),
          }
        : { cell_type: 'markdown', id: c.id, metadata: {}, source: lines(c.type === 'latex' ? latexAsMarkdown(c.source) : c.source) },
    ),
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: {
        name: 'python',
        file_extension: '.py',
        mimetype: 'text/x-python',
        ...(pythonVersion ? { version: pythonVersion } : {}),
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  }
  return JSON.stringify(nb, null, 1) + '\n'
}
