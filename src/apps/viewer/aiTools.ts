// Viewer's AI tools (viewer_open, _show, _set_view, _get_state): names,
// arguments and descriptions are in src/os/ai/manifests/terminalViewer.ts;
// Viewer.tsx registers these with useAppTools.

import { fs } from '@/os'
import { extname, pretty } from '@/os/path'
import { drivePath } from '@/os/ai/tools'
import { waitUntil, type AppTools } from '@/os/ai/appTools'

export type Zoom = number | 'fit'

export interface ViewerState {
  file: string | null
  /** The file whose bytes are loaded (or failed to load). */
  loaded: string | null
  error: string | null
  zoom: Zoom
  rotation: number
  /** The picture's size in pixels, once shown. */
  size: { file: string; width: number; height: number } | null
  /** The pictures of the file's folder, for previous / next. */
  siblings: string[]
}

export interface ViewerDoc {
  /** The latest state (updated at once by the setters). */
  get(): ViewerState
  setFile(path: string): void
  setZoom(zoom: Zoom): void
  setRotation(degrees: number): void
}

const MIN_ZOOM = 0.1
const MAX_ZOOM = 8
const STEP = 1.25

export function viewerAiTools(doc: ViewerDoc, types: readonly string[]): AppTools {
  const isPdf = (p: string) => extname(p) === '.pdf'

  const state = () => {
    const s = doc.get()
    if (!s.file) return { file: null, note: 'Nothing is shown: viewer_open shows a file.' }
    const pdf = isPdf(s.file)
    const index = s.siblings.indexOf(s.file)
    return {
      file: pretty(s.file),
      type: pdf ? 'pdf' : 'image',
      ...(s.error && { error: s.error }),
      ...(s.size?.file === s.file && { width: s.size.width, height: s.size.height }),
      ...(!pdf && {
        zoom: s.zoom === 'fit' ? 'fit' : `${Math.round(s.zoom * 100)}%`,
        rotation: s.rotation,
        ...(index >= 0 && { position: `${index + 1} of ${s.siblings.length}` }),
      }),
    }
  }

  /** Show a file and wait until it is loaded (and, for a picture, measured). */
  const show = async (p: string, signal?: AbortSignal) => {
    doc.setFile(p)
    await waitUntil(() => {
      const s = doc.get()
      return s.loaded === p && (!!s.error || isPdf(p) || s.size?.file === p)
    }, 10_000, signal, 50)
    return state()
  }

  const picture = () => {
    const s = doc.get()
    if (!s.file) throw new Error('Nothing is shown: viewer_open shows a file first.')
    if (isPdf(s.file)) throw new Error('A PDF is shown: zoom, rotation and previous / next are for pictures (the PDF viewer has its own buttons).')
    return s
  }

  return {
    async open(a, ctx) {
      const given = String(a.path ?? '').trim()
      const p = drivePath(given)
      if (fs.isDir(p)) throw new Error(`${pretty(p)} is a folder: give a picture or a PDF in it (list_files shows them).`)
      if (!fs.isFile(p)) throw new Error(`There is no file ${pretty(p)}.`)
      if (!types.includes(extname(p))) throw new Error(`The Viewer shows pictures and PDFs (${types.join(' ')}), not ${extname(p) || 'files without an extension'}.`)
      return show(p, ctx.signal)
    },

    async show(a, ctx) {
      const s = picture()
      const which = String(a.which ?? '').trim().toLowerCase()
      const list = s.siblings
      const i = list.indexOf(s.file!)
      if (list.length < 2 || i < 0) throw new Error('This is the only picture in its folder.')
      const next: Record<string, number> = { next: (i + 1) % list.length, previous: (i - 1 + list.length) % list.length, first: 0, last: list.length - 1 }
      if (!(which in next)) throw new Error('"which" must be next, previous, first or last.')
      return show(list[next[which]], ctx.signal)
    },

    async set_view(a) {
      const s = picture()
      const has = (k: string) => a[k] !== undefined
      if (!has('zoom') && !has('percent') && !has('rotate') && !has('rotation')) throw new Error('Give "zoom", "percent", "rotate" or "rotation".')
      if (has('zoom') && has('percent')) throw new Error('Give "zoom" or "percent", not both.')
      if (has('rotate') && has('rotation')) throw new Error('Give "rotate" or "rotation", not both.')

      let zoom = s.zoom
      const current = zoom === 'fit' ? 1 : zoom
      if (has('zoom')) {
        const z = String(a.zoom).trim().toLowerCase()
        if (z === 'fit') zoom = 'fit'
        else if (z === 'actual') zoom = 1
        else if (z === 'in') zoom = Math.min(MAX_ZOOM, current * STEP)
        else if (z === 'out') zoom = Math.max(MIN_ZOOM, current / STEP)
        else throw new Error('"zoom" must be fit, in, out or actual (or give "percent").')
      }
      if (has('percent')) {
        const pc = Number(a.percent)
        if (!Number.isFinite(pc) || pc < MIN_ZOOM * 100 || pc > MAX_ZOOM * 100) throw new Error(`"percent" must be between ${MIN_ZOOM * 100} and ${MAX_ZOOM * 100}.`)
        zoom = pc / 100
      }
      let rotation = s.rotation
      const turn = has('rotate') ? Number(a.rotate) : has('rotation') ? Number(a.rotation) : null
      if (turn !== null) {
        if (!Number.isFinite(turn) || turn % 90 !== 0) throw new Error('Rotations go by quarter turns: 90, -90, 180 (or 0, 90, 180, 270 for "rotation").')
        rotation = (((has('rotate') ? rotation + turn : turn) % 360) + 360) % 360
      }
      if (zoom !== s.zoom) doc.setZoom(zoom)
      if (rotation !== s.rotation) doc.setRotation(rotation)
      return state()
    },

    async get_state() {
      return state()
    },
  }
}
