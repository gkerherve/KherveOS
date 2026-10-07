// KhervePaint's AI tools (khervepaint_get_drawing, _add_shape, _delete_items,
// _save): names, arguments and descriptions are in src/os/ai/appManifest.ts;
// KhervePaint.tsx registers these with useAppTools. Each change is one undo
// step in the window's store.

import { fs, path } from '@/os'
import { drivePath } from '@/os/ai/tools'
import type { AppTools } from '@/os/ai/appTools'
import { base, describe, DEFAULT_FONT, type Item } from './model'
import type { PaintStore } from './store'

export interface PaintAiHost {
  store: PaintStore
  /** Write the drawing to `target` (.svg or .kpaint); false when it failed. */
  writeTo(target: string): Promise<boolean>
}

const r1 = (n: number) => Math.round(n * 10) / 10

/** "#rrggbb" / "#aarrggbb" / "red"-less input → the store's #aarrggbb. */
export function paintColor(c: unknown, fallback: string): string {
  if (typeof c !== 'string' || !c.trim()) return fallback
  const s = c.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(s)) return `#ff${s.slice(1)}`
  if (/^#[0-9a-f]{8}$/.test(s)) return s
  if (/^#[0-9a-f]{3}$/.test(s)) return `#ff${[...s.slice(1)].map((x) => x + x).join('')}`
  throw new Error(`"${c}" is not a colour: use "#rrggbb".`)
}

function where(it: Item): Record<string, number> {
  const dx = it.pos.x
  const dy = it.pos.y
  switch (it.type) {
    case 'line':
    case 'arrow':
    case 'dimension':
      return { x1: r1(it.x1 + dx), y1: r1(it.y1 + dy), x2: r1(it.x2 + dx), y2: r1(it.y2 + dy) }
    case 'rect':
    case 'ellipse':
    case 'roundrect':
    case 'arc':
      return { x: r1(it.x + dx), y: r1(it.y + dy), w: r1(it.w), h: r1(it.h) }
    default:
      return { x: r1(dx), y: r1(dy) }
  }
}

export function khervepaintAiTools(host: PaintAiHost): AppTools {
  const { store } = host
  return {
    async get_drawing() {
      const d = store.doc
      return {
        path: store.path ? path.pretty(store.path) : null,
        unsaved_changes: store.dirty,
        width: d.width,
        height: d.height,
        items: d.items.slice(0, 300).map((it) => ({
          id: it._id,
          kind: describe(it),
          ...where(it),
          ...(it.type === 'text' && { text: it.text }),
          ...('label' in it && it.label ? { label: it.label } : {}),
        })),
        ...(d.items.length > 300 && { more_items: d.items.length - 300 }),
      }
    },

    async add_shape(a) {
      const shape = String(a.shape ?? '')
      const box = Array.isArray(a.box) ? a.box.map(Number) : []
      if (box.some((n) => !Number.isFinite(n))) throw new Error('"box" must hold numbers.')
      const stroke = paintColor(a.color, '#ff1a1a1a')
      const fill = typeof a.fill === 'string' && a.fill.trim() ? { color: paintColor(a.fill, '#ff4aa3ff') } : null
      const width = typeof a.width === 'number' && a.width > 0 ? a.width : null
      const label = typeof a.text === 'string' ? a.text : ''
      let it: Item
      if (shape === 'text') {
        if (box.length < 2) throw new Error('Text needs box [x, y].')
        if (!label) throw new Error('Text needs "text".')
        it = { ...base(), type: 'text', text: label, color: stroke, family: DEFAULT_FONT, size: width ?? 14, bold: false, italic: false, pos: { x: box[0], y: box[1] } }
      } else if (shape === 'line' || shape === 'arrow') {
        if (box.length < 4) throw new Error(`A ${shape} needs box [x1, y1, x2, y2].`)
        it = { ...base(), type: shape, pen: { color: stroke, width: width ?? 2 }, x1: box[0], y1: box[1], x2: box[2], y2: box[3] }
      } else if (shape === 'rect' || shape === 'ellipse' || shape === 'roundrect') {
        if (box.length < 4 || box[2] <= 0 || box[3] <= 0) throw new Error(`A ${shape} needs box [x, y, w, h] with w, h > 0.`)
        const common = { ...base(), pen: { color: stroke, width: width ?? 2 }, brush: fill, x: box[0], y: box[1], w: box[2], h: box[3], ...(label && { label }) }
        it = shape === 'roundrect' ? { ...common, type: 'roundrect', radius: Math.min(12, box[2] / 4, box[3] / 4) } : { ...common, type: shape }
      } else throw new Error('"shape" must be rect, roundrect, ellipse, line, arrow or text.')
      store.commit({ ...store.doc, items: [...store.doc.items, it] }, [it._id])
      return { added: it._id, kind: describe(it), items: store.doc.items.length }
    },

    async delete_items(a) {
      const ids = new Set((Array.isArray(a.ids) ? a.ids : []).map(Number))
      if (!ids.size) throw new Error('"ids" is empty.')
      const items = store.doc.items.filter((it) => !ids.has(it._id))
      const removed = store.doc.items.length - items.length
      if (!removed) throw new Error('None of these ids are in the drawing (khervepaint_get_drawing lists them).')
      store.commit({ ...store.doc, items }, [])
      return { removed, items: items.length }
    },

    async save(a, ctx) {
      const given = typeof a.path === 'string' && a.path.trim() ? a.path.trim() : null
      if (!given && !store.path) throw new Error('This drawing has never been saved: give "path", e.g. "~/Documents/figure.svg".')
      let p = given ? drivePath(given) : store.path!
      if (given && !/\.(svg|kpaint)$/i.test(p)) p += '.svg'
      if (fs.isDir(p)) throw new Error(`${path.pretty(p)} is a folder.`)
      if (p !== store.path && fs.exists(p) && !(await ctx.confirm(`replace ${path.pretty(p)}`, 'What is in it now will be lost.'))) {
        throw new Error(`The user did not allow replacing ${path.pretty(p)}.`)
      }
      if (!(await host.writeTo(p))) throw new Error('The drawing was not saved.')
      return { saved: path.pretty(p) }
    },
  }
}
