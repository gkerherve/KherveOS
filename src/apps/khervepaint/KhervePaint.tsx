// KhervePaint: hybrid raster + vector drawing — the KherveOS edition of the
// desktop KhervePaint (PyQt5). One canvas mixes a raster layer at the bottom
// (open a PNG, paint, fill) with editable vector items on top. Documents are
// the desktop's editable SVG (the default) or its .kpaint JSON, read and
// written the same way, so files go back and forth between the two apps.

import { useEffect, useRef, useState } from 'react'
import {
  BookOpen, ClipboardPaste, Copy, Download, FilePlus, FileImage, FolderOpen, ImagePlus, Info, Keyboard, Redo2, Save, Scissors, Trash2, Undo2,
  ZoomIn, ZoomOut,
} from 'lucide-react'
import { os, fs, path, HOME, type AppProps, type MenuBarMenu, type MenuItem } from '@/os'
import { DRAG_MIME } from '@/os/fileActions'
import type { DashStyle, Doc, Item, Pt } from './model'
import { base, blankRaster, cloneItem, hasBrush, hasPen, newDoc, newRasterKey, PT } from './model'
import { apply, boundsIn, matrixOf } from './geom'
import {
  alignItems, copiesOf, explodeItem, fitToContent, groupItems, itemsBounds, mapDeep, mirrorItem, reorder, resizeCanvas, scaleBar, translateItem,
  ungroupItems, type Align,
} from './ops'
import { parseKpaint, serializeKpaint } from './kpaint'
import { parseSvg, writeSvg } from './svgio'
import { Canvas, type CanvasApi } from './Canvas'
import { Inspector, LibraryPanel, symbolLabel } from './Panels'
import { DIRECT_TOOLS, OptionsBar, SHAPE_GROUPS, ToolColumn, ALIGN_ITEMS, chemMenu, type BarActions } from './Bars'
import { DrawingSizeDialog, ScaleBarDialog, type ScaleBarSpec, type SizeResult } from './Dialogs'
import { Live, PaintStore, useLive, useStore, type Tool } from './store'
import { EXAMPLE_PAGE, EXAMPLES, PALETTES, paletteById } from './palettes'
import { buildSymbol, specsToItems } from './spec'
import { canvasMeasurer, setMeasurer } from './text'
import { canvasToBlob, clearBackground, newCanvas, pictureToPng, pngToCanvas, blobToBase64, rasterBase64, rasterSource, renderPage, withDpi } from './raster'
import { base64ToBytes } from './png'
import { pdfFromCanvas } from './pdf'
import { LIBRARY_DIR, listObjects, loadObject, saveObject } from './library'
import { HelpDialog } from './Help'
import { useAppTools } from '@/os/ai/appTools'
import { khervepaintAiTools } from './aiTools'
import './khervepaint.css'

// Text is measured with the browser's own fonts.
setMeasurer(canvasMeasurer())

const RECENT_KEY = 'khervepaint.recent'
const OPEN_TYPES = ['.svg', '.kpaint', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']
const PICTURE_TYPES = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']

/** Copied items, shared by every KhervePaint window. */
let clipboard: Item[] = []

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function loadRecent(): string[] {
  try {
    const r = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function pushRecent(p: string) {
  const list = [p, ...loadRecent().filter((x) => x !== p)].slice(0, 10)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    // private mode
  }
}

/** The dpi a PNG carries in its pHYs chunk, if any. */
function pngDpi(bytes: Uint8Array): number | null {
  let i = 8
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  while (i + 12 <= bytes.length) {
    const len = dv.getUint32(i)
    const type = String.fromCharCode(...bytes.subarray(i + 4, i + 8))
    if (type === 'pHYs' && len >= 9 && bytes[i + 16] === 1) return Math.round(dv.getUint32(i + 8) * 0.0254)
    if (type === 'IDAT' || type === 'IEND') return null
    i += 12 + len
  }
  return null
}

/** Pictures read from SVG in another format than PNG become PNG (the files always hold PNG). */
async function normaliseImages(doc: Doc): Promise<Doc> {
  const fix = async (it: Item): Promise<Item> => {
    if (it.type === 'group') return { ...it, children: await Promise.all(it.children.map(fix)) }
    if (it.type !== 'image' || !it.mime) return it
    try {
      const png = await pictureToPng(base64ToBytes(it.image), it.mime)
      // An image read before its size was known was scaled for a 1 × 1 picture.
      const sx = it.iw === 1 && it.ih === 1 ? 1 / png.w : it.iw / png.w
      const sy = it.iw === 1 && it.ih === 1 ? 1 / png.h : it.ih / png.h
      const m = it.matrix
      const matrix: typeof m = [m[0] * sx, m[1] * sx, m[2] * sy, m[3] * sy, m[4], m[5]]
      const out = { ...it, image: png.b64, iw: png.w, ih: png.h, matrix }
      delete out.mime
      return out
    } catch {
      return it
    }
  }
  const items = await Promise.all(doc.items.map(fix))
  return items.every((x, i) => x === doc.items[i]) ? doc : { ...doc, items }
}

export default function KhervePaint({ win, args }: AppProps) {
  const [store] = useState(() => new PaintStore())
  useStore(store)
  const canvas = useRef<CanvasApi>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [panel, setPanel] = useState<'props' | 'library' | null>(() => (localStorage.getItem('khervepaint.panel') as 'props' | 'library' | null) ?? 'props')
  const [cursor] = useState(() => new Live<Pt | null>(null))
  const [zoom] = useState(() => new Live(1))
  const [sizeDialog, setSizeDialog] = useState(false)
  const [scaleDialog, setScaleDialog] = useState(false)
  const [help, setHelp] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const doc = store.doc
  const name = store.path ? path.basename(store.path) : 'Untitled'

  const showPanel = (p: 'props' | 'library' | null) => {
    setPanel(p)
    try {
      localStorage.setItem('khervepaint.panel', p ?? '')
    } catch {
      // private mode
    }
  }

  const fail = (what: string, e: unknown) => void os.dialog.alert(`${what}: ${errText(e)}`, { title: 'KhervePaint' })
  const say = (m: string) => store.say(m)

  // ------------------------------------------------------------ title

  useEffect(() => {
    win.setTitle(`${store.dirty ? '• ' : ''}${name} — KhervePaint`)
  })
  useEffect(() => win.setDocumentPath(store.path), [win, store.path])

  // Follow renames of the open file.
  useEffect(
    () =>
      fs.watch((ev) => {
        const p = store.path
        if (ev.type === 'rename' && p && path.isInside(p, ev.oldPath)) {
          store.path = ev.path + p.slice(ev.oldPath.length)
          store.emit()
        }
      }),
    [store],
  )

  // ------------------------------------------------------------- files

  const confirmDiscard = async (): Promise<boolean> => {
    if (!store.dirty) return true
    const choice = await os.dialog.choose(`Save the changes to “${name}” first?`, [
      { label: 'Cancel', value: 'cancel' },
      { label: "Don't save", value: 'discard', danger: true },
      { label: 'Save', value: 'save', primary: true },
    ], { title: 'Unsaved changes' })
    if (choice === 'save') return save()
    return choice === 'discard'
  }

  const openPath = async (p: string, ask = true) => {
    if (ask && !(await confirmDiscard())) return
    const ext = path.extname(p)
    setBusy(`Opening ${path.basename(p)}…`)
    try {
      let d: Doc
      let keepPath: string | null = p
      if (ext === '.kpaint') d = parseKpaint(await fs.readText(p))
      else if (ext === '.svg') d = await normaliseImages(parseSvg(await fs.readText(p)))
      else if (PICTURE_TYPES.includes(ext)) {
        // A picture opens as a new document with it as the raster layer.
        const bytes = await fs.readBytes(p)
        const png = await pictureToPng(bytes)
        d = newDoc(png.w, png.h, (ext === '.png' && pngDpi(bytes)) || 96)
        d = { ...d, raster: { w: png.w, h: png.h, src: png.b64, key: newRasterKey() } }
        keepPath = null
      } else throw new Error('KhervePaint opens .svg, .kpaint and pictures.')
      store.load(d, keepPath)
      pushRecent(p)
      say(`Opened ${path.pretty(p)}`)
    } catch (e) {
      fail(`Could not open ${path.basename(p)}`, e)
    } finally {
      setBusy(null)
    }
  }

  const openDialog = async () => {
    const p = await os.dialog.openFile({
      title: 'Open', startDir: store.path ? path.dirname(store.path) : `${HOME}/Documents`, extensions: OPEN_TYPES,
    })
    if (p) await openPath(p)
  }

  const serialize = async (target: string, d: Doc) => {
    canvas.current?.finishPending()
    const raster = await rasterBase64(d.raster)
    return path.extname(target) === '.kpaint' ? serializeKpaint(d, raster) : writeSvg(d, { raster })
  }

  const writeTo = async (target: string): Promise<boolean> => {
    canvas.current?.finishPending()
    const d = store.doc
    try {
      setBusy(`Saving ${path.basename(target)}…`)
      await fs.writeText(target, await serialize(target, d))
      store.markSaved(target, d)
      pushRecent(target)
      say(`Saved ${path.pretty(target)}`)
      return true
    } catch (e) {
      fail('Could not save', e)
      return false
    } finally {
      setBusy(null)
    }
  }

  // AI tools (khervepaint_get_drawing, _add_shape…: src/os/ai/appManifest.ts).
  useAppTools(win, khervepaintAiTools({ store, writeTo }))

  const saveAs = async (): Promise<boolean> => {
    const stem = store.path ? path.basename(store.path).replace(/\.[^.]+$/, '') : 'Untitled'
    const target = await os.dialog.saveFile({
      title: 'Save As',
      defaultName: `${store.path ? path.dirname(store.path) : `${HOME}/Documents`}/${stem}${store.path && path.extname(store.path) === '.kpaint' ? '.kpaint' : '.svg'}`,
      extensions: ['.svg', '.kpaint'],
    })
    if (!target) return false
    return writeTo(target)
  }

  async function save(): Promise<boolean> {
    const p = store.path
    if (!p || !fs.exists(path.dirname(p))) return saveAs()
    return writeTo(p)
  }

  const newDocument = async () => {
    if (!(await confirmDiscard())) return
    store.load(newDoc(), null)
  }

  /** The page as PNG bytes (with its dpi), or a PDF at print resolution. */
  const exportBytes = async (kind: 'png' | 'pdf'): Promise<Uint8Array> => {
    canvas.current?.finishPending()
    const d = store.doc
    if (kind === 'png') {
      const c = await renderPage(d, 1)
      return withDpi(new Uint8Array(await (await canvasToBlob(c)).arrayBuffer()), d.dpi)
    }
    // Print resolution: at least 300 dpi, within a sane pixel budget.
    let scale = Math.max(1, 300 / d.dpi)
    while (d.width * d.height * scale * scale > 40e6 && scale > 0.5) scale *= 0.8
    const c = await renderPage(d, scale)
    return pdfFromCanvas(c, (d.width * 72) / d.dpi, (d.height * 72) / d.dpi)
  }

  const exportFile = async (kind: 'png' | 'pdf') => {
    const stem = store.path ? path.basename(store.path).replace(/\.[^.]+$/, '') : 'Untitled'
    const target = await os.dialog.saveFile({
      title: `Export ${kind.toUpperCase()}`,
      defaultName: `${store.path ? path.dirname(store.path) : `${HOME}/Documents`}/${stem}.${kind}`,
      extensions: [`.${kind}`],
    })
    if (!target) return
    try {
      setBusy(`Exporting ${path.basename(target)}…`)
      await fs.writeBytes(target, await exportBytes(kind))
      say(`Exported ${path.pretty(target)}`)
    } catch (e) {
      fail('Could not export', e)
    } finally {
      setBusy(null)
    }
  }

  const download = async (kind: 'svg' | 'kpaint' | 'png' | 'pdf') => {
    const stem = store.path ? path.basename(store.path).replace(/\.[^.]+$/, '') : 'Untitled'
    try {
      setBusy('Preparing the download…')
      if (kind === 'svg' || kind === 'kpaint') {
        const text = await serialize(`x.${kind}`, store.doc)
        os.downloadBlob(`${stem}.${kind}`, new Blob([text], { type: kind === 'svg' ? 'image/svg+xml' : 'application/json' }))
      } else {
        const bytes = await exportBytes(kind)
        os.downloadBlob(`${stem}.${kind}`, new Blob([bytes as BlobPart], { type: kind === 'png' ? 'image/png' : 'application/pdf' }))
      }
    } catch (e) {
      fail('Could not prepare the download', e)
    } finally {
      setBusy(null)
    }
  }

  // Open the file the window was started with (and any handed to it later: asks first if needed).
  useEffect(() => {
    if (typeof args.path === 'string' && args.path) void openPath(args.path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args])

  // Ask before closing with unsaved changes.
  useEffect(() => {
    win.setCloseGuard(async () => {
      if (!store.dirty) return true
      return confirmDiscard()
    })
    return () => win.setCloseGuard(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win])

  // ----------------------------------------------------------- editing

  const selIds = () => new Set(store.sel)
  const sel = store.selected
  /** The selection now (actions can run before a re-render). */
  const cur = () => store.selected

  const center = () => canvas.current?.viewCenter() ?? { x: doc.width / 2, y: doc.height / 2 }

  /** Add items, placed so their middle lands on `at`, and select them. */
  const dropItems = (items: Item[], at: Pt | null) => {
    if (!items.length) return
    let placed = items
    const b = itemsBounds(items)
    if (at && b) placed = items.map((it) => translateItem(it, at.x - (b.x + b.w / 2), at.y - (b.y + b.h / 2)))
    store.commit({ ...store.doc, items: [...store.doc.items, ...placed] }, placed.map((i) => i._id))
  }

  const copy = () => {
    if (!cur().length) return
    clipboard = cur().map(cloneItem)
    say(`Copied ${cur().length} item${cur().length === 1 ? '' : 's'}`)
  }
  const cut = () => {
    copy()
    remove()
  }
  const paste = () => {
    if (!clipboard.length) return say('Nothing to paste')
    // Like the desktop: pasted copies sit 20 px down and right of the originals.
    const items = copiesOf(clipboard, 20, 20)
    clipboard = items.map(cloneItem)
    store.commit({ ...store.doc, items: [...store.doc.items, ...items] }, items.map((i) => i._id))
  }
  const duplicate = () => {
    if (!cur().length) return
    const items = copiesOf(cur(), 20, 20)
    store.commit({ ...store.doc, items: [...store.doc.items, ...items] }, items.map((i) => i._id))
  }
  function remove() {
    if (!cur().length) return
    const ids = selIds()
    store.commit({ ...store.doc, items: store.doc.items.filter((it) => !ids.has(it._id)) }, [])
  }
  const selectAll = () => store.select(store.doc.items.map((i) => i._id))
  const group = () => {
    const { doc: d, id } = groupItems(store.doc, selIds())
    if (id != null) store.commit(d, [id])
  }
  const ungroup = () => {
    const { doc: d, freed } = ungroupItems(store.doc, selIds())
    if (freed.length) store.commit(d, [...store.sel.filter((id) => d.items.some((it) => it._id === id)), ...freed])
  }
  const flip = (horizontal: boolean) => {
    if (!cur().length) return
    const ids = selIds()
    store.commit({ ...store.doc, items: store.doc.items.map((it) => (ids.has(it._id) ? mirrorItem(it, horizontal) : it)) })
  }
  const order = (where: 'front' | 'forward' | 'backward' | 'back') => cur().length && store.commit(reorder(store.doc, selIds(), where))
  const align = (how: string) => {
    if (!cur().length) return
    const page = { x: 0, y: 0, w: store.doc.width, h: store.doc.height }
    store.commit(alignItems(store.doc, selIds(), how as Align, page))
  }
  const explode = () => {
    // Each shape is replaced, where it stood, by its edges (left selected).
    const pieces = new Map<number, Item[]>()
    for (const it of cur()) {
      const parts = explodeItem(it)
      if (parts) pieces.set(it._id, parts)
    }
    if (!pieces.size) return say('Only shapes and paths can be exploded')
    const items = store.doc.items.flatMap((it) => pieces.get(it._id) ?? [it])
    store.commit({ ...store.doc, items }, [...pieces.values()].flat().map((o) => o._id))
  }
  const nudge = (dx: number, dy: number) => {
    if (!cur().length) return
    const ids = selIds()
    store.commit({ ...store.doc, items: store.doc.items.map((it) => (ids.has(it._id) ? translateItem(it, dx, dy) : it)) })
  }

  const applyStroke = (patch: { color?: string; width?: number; dash?: DashStyle }) => {
    if (!cur().length) return
    const ids = selIds()
    store.commit({
      ...store.doc,
      items: store.doc.items.map((it) => (ids.has(it._id) ? mapDeep(it, (x) => {
        if (!hasPen(x)) return x
        const pen = { ...x.pen, ...patch }
        if (pen.dash === 'solid') delete pen.dash
        return { ...x, pen } as Item
      }) : it)),
    })
  }
  const applyFill = () => {
    if (!cur().length) return
    const s = store.settings
    const brush = !s.fillOn ? null : s.fillStyle === 'solid' ? { color: s.fill } : { gradient: { kind: s.fillStyle, c1: s.fill, c2: s.fill2, angle: s.fillAngle } }
    const ids = selIds()
    store.commit({ ...store.doc, items: store.doc.items.map((it) => (ids.has(it._id) ? mapDeep(it, (x) => (hasBrush(x) ? ({ ...x, brush } as Item) : x)) : it)) })
  }

  const insertPicture = async (bytes: Uint8Array, at: Pt | null, mime = '') => {
    const png = await pictureToPng(bytes, mime)
    const c = at ?? center()
    const m: [number, number, number, number, number, number] = [1, 0, 0, 1, c.x - png.w / 2, c.y - png.h / 2]
    const it: Item = { ...base(), type: 'image', image: png.b64, iw: png.w, ih: png.h, matrix: m, pos: { x: m[4], y: m[5] } }
    store.commit({ ...store.doc, items: [...store.doc.items, it] }, [it._id])
  }

  const insertPictureDialog = async () => {
    const p = await os.dialog.openFile({ title: 'Insert picture', startDir: `${HOME}/Pictures`, extensions: PICTURE_TYPES })
    if (!p) return
    try {
      await insertPicture(await fs.readBytes(p), null)
    } catch (e) {
      fail('Could not insert the picture', e)
    }
  }

  const openRasterDialog = async () => {
    const p = await os.dialog.openFile({ title: 'Open picture as the raster layer', startDir: `${HOME}/Pictures`, extensions: PICTURE_TYPES })
    if (!p) return
    try {
      const png = await pictureToPng(await fs.readBytes(p))
      // set_raster_pixmap: the page takes the picture's size.
      store.commit({ ...store.doc, width: png.w, height: png.h, raster: { w: png.w, h: png.h, src: png.b64, key: newRasterKey() } })
      canvas.current?.fit()
    } catch (e) {
      fail('Could not read the picture', e)
    }
  }

  const clearRaster = () => store.commit({ ...store.doc, raster: blankRaster(store.doc.width, store.doc.height) })

  const resizeRaster = async (d: Doc, w: number, h: number, dx = 0, dy = 0): Promise<Doc> => {
    // The raster keeps its content at the top-left (shifted by dx, dy), padded white.
    const c = newCanvas(w, h)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    if (d.raster.src) {
      const src = await rasterSource(d.raster)
      if (src) ctx.drawImage(src, dx, dy)
      return { ...d, raster: { w, h, src: await canvasToBlob(c), key: newRasterKey() } }
    }
    return { ...d, raster: blankRaster(w, h) }
  }

  const onSize = async (r: SizeResult | null) => {
    setSizeDialog(false)
    if (!r) return
    if (r.kind === 'fit') {
      const fitted = fitToContent(store.doc, r.selectionOnly ? cur() : null)
      if (!fitted) return say('Nothing to fit to')
      store.commit(await resizeRaster(fitted.doc, fitted.doc.width, fitted.doc.height, fitted.dx, fitted.dy))
    } else {
      store.commit(await resizeRaster(resizeCanvas(store.doc, r.w, r.h, r.dpi), r.w, r.h))
    }
    canvas.current?.fit()
  }

  const onScaleBar = (r: ScaleBarSpec | null) => {
    setScaleDialog(false)
    if (!r) return
    const factor = { nm: 1e-6, 'µm': 1e-3, mm: 1, cm: 10 }[r.unit]
    const g = scaleBar(r.length * factor, `${+r.length.toPrecision(6)} ${r.unit}`, center(), store.doc.dpi, (px) => Math.max(1, Math.round(px / PT)))
    if (g) store.commit({ ...store.doc, items: [...store.doc.items, g] }, [g._id])
  }

  const removeBackground = async () => {
    const img = cur().find((i) => i.type === 'image')
    if (!img || img.type !== 'image') return say('Select a picture first')
    const c = await pngToCanvas(img.image)
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    const data = ctx.getImageData(0, 0, c.width, c.height)
    if (!clearBackground(data.data, c.width, c.height)) return say('No background found along the picture’s edges')
    ctx.putImageData(data, 0, 0)
    const b64 = await blobToBase64(await canvasToBlob(c))
    store.commit({ ...store.doc, items: store.doc.items.map((it) => (it._id === img._id ? { ...img, image: b64 } : it)) })
    say('Background removed — now transparent')
  }

  const saveSelectionAsObject = async () => {
    if (!cur().length) return void os.dialog.alert('Select one or more items first, then save them as an object.', { title: 'Save object' })
    const n = await os.dialog.prompt('Object name (use Folder/Name to file it in a sub-folder):', { title: 'Save object', placeholder: 'e.g. Walls/brick' })
    if (!n?.trim()) return
    try {
      const file = await saveObject(cur(), n, store.doc.dpi)
      say(`Saved object “${path.basename(file).replace(/\.svg$/, '')}” in ${path.pretty(LIBRARY_DIR)}`)
    } catch (e) {
      fail('Could not save the object', e)
    }
  }

  const insertObject = async (file: string, at?: Pt) => {
    try {
      dropItems(await loadObject(file), at ?? center())
    } catch (e) {
      fail('Could not load the object', e)
    }
  }

  const placeSymbol = (key: string, at: Pt) => {
    const [pid, nm] = key.split(':')
    const p = paletteById(pid)
    const it = p && buildSymbol(p, nm, at, store.doc.width)
    if (it) store.commit({ ...store.doc, items: [...store.doc.items, it] }, [it._id])
  }

  const armSymbol = (key: string) => {
    store.set({ tool: 'place', place: key })
    say(`Click on the drawing to place “${symbolLabel(key)}”`)
  }

  const loadExample = async (i: number) => {
    if (!(await confirmDiscard())) return
    const ex = EXAMPLES[i]
    try {
      const items = specsToItems(ex.build()).map((it, z) => ({ ...it, z }))
      store.load({ ...newDoc(EXAMPLE_PAGE.width, EXAMPLE_PAGE.height, EXAMPLE_PAGE.dpi), items }, null)
      say(`${ex.name}: every part is an ordinary editable item`)
    } catch (e) {
      fail('Could not build the example', e)
    }
  }

  const onDropData = async (dt: DataTransfer, at: Pt, snapped: Pt) => {
    const sym = dt.getData('application/x-khervepaint-symbol')
    if (sym) {
      if (sym.startsWith('object:')) return void insertObject(sym.slice(7), snapped)
      return placeSymbol(sym, snapped)
    }
    const raw = dt.getData(DRAG_MIME)
    const paths: string[] = []
    if (raw) {
      try {
        paths.push(...(JSON.parse(raw) as string[]))
      } catch {
        // not ours
      }
    }
    const docs = paths.filter((p) => ['.svg', '.kpaint'].includes(path.extname(p)))
    if (docs.length) return void openPath(docs[0])
    let pos = at
    for (const p of paths.filter((x) => PICTURE_TYPES.includes(path.extname(x)))) {
      await insertPicture(await fs.readBytes(p), pos)
      pos = { x: pos.x + 20, y: pos.y + 20 }
    }
    for (const f of [...dt.files]) {
      const ext = path.extname(f.name)
      if (ext === '.svg' || ext === '.kpaint') {
        if (!(await confirmDiscard())) return
        const text = await f.text()
        try {
          const d = ext === '.svg' ? await normaliseImages(parseSvg(text)) : parseKpaint(text)
          store.load(d, null)
        } catch (e) {
          fail(`Could not open ${f.name}`, e)
        }
        return
      }
      if (f.type.startsWith('image/')) {
        try {
          await insertPicture(new Uint8Array(await f.arrayBuffer()), pos, f.type)
          pos = { x: pos.x + 20, y: pos.y + 20 }
        } catch (e) {
          fail(`Could not insert ${f.name}`, e)
        }
      }
    }
  }

  // Pictures pasted from the computer's clipboard.
  const onPaste = async (e: React.ClipboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    e.preventDefault()
    if (files.length) {
      for (const f of files) await insertPicture(new Uint8Array(await f.arrayBuffer()), null, f.type)
      return
    }
    const text = e.clipboardData.getData('text/plain')
    if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(text)) {
      try {
        dropItems((await normaliseImages(parseSvg(text))).items.map(cloneItem), center())
        return
      } catch {
        // not usable SVG: fall through to our own clipboard
      }
    }
    paste()
  }

  // ------------------------------------------------------------ tools

  const setTool = (tool: Tool) => {
    store.set({ tool })
    if (tool !== 'pointer') store.select([])
  }

  const actions: BarActions = {
    undo: () => store.undo(),
    redo: () => store.redo(),
    group,
    ungroup,
    flip,
    order,
    align,
    remove,
    fit: () => canvas.current?.fit(),
    applyStroke,
    applyFill,
    togglePanel: () => showPanel(panel ? null : 'props'),
  }

  // --------------------------------------------------------- keyboard

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    let done = true
    if (mod) {
      if (k === 'z' && !e.shiftKey) store.undo()
      else if ((k === 'z' && e.shiftKey) || k === 'y') store.redo()
      else if (k === 's') void (e.shiftKey ? saveAs() : save())
      else if (k === 'o') void openDialog()
      else if (k === 'n' && !e.shiftKey) void newDocument()
      else if (k === 'p' && e.shiftKey) setSizeDialog(true)
      else if (k === 'e' && e.shiftKey) explode()
      else if (k === 'e') void exportFile('png')
      else if (k === 'c') copy()
      else if (k === 'x') cut()
      else if (k === 'v') done = false // the paste event handles it
      else if (k === 'd') duplicate()
      else if (k === 'a') selectAll()
      else if (k === 'g' && e.shiftKey) ungroup()
      else if (k === 'g') group()
      else if (k === 'h' && e.shiftKey) flip(true)
      else if (k === 'j' && e.shiftKey) flip(false)
      else if (e.key === ']' || e.key === '}') order(e.shiftKey ? 'front' : 'forward')
      else if (e.key === '[' || e.key === '{') order(e.shiftKey ? 'back' : 'backward')
      else if (e.key === "'" || e.key === '"') {
        const g = store.doc.grid
        store.commit({ ...store.doc, grid: e.shiftKey ? { ...g, snap: !g.snap } : { ...g, show: !g.show } })
      } else if (k === '0') canvas.current?.fit()
      else if (k === '1') canvas.current?.setZoom(1)
      else if (k === '=' || k === '+') canvas.current?.zoomBy(1.25)
      else if (k === '-') canvas.current?.zoomBy(1 / 1.25)
      else done = false
    } else if (e.key === 'Delete' || e.key === 'Backspace') remove()
    else if (e.key === 'Escape') {
      if (store.settings.tool !== 'pointer') setTool('pointer')
      else store.select([])
    } else if (e.key.startsWith('Arrow') && sel.length) {
      const g = store.doc.grid.snap ? (store.doc.grid.mm / 25.4) * store.doc.dpi : 1
      const step = e.shiftKey ? g * 10 : g
      nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0)
    } else if (e.key === 'F1') setHelp(true)
    else if (!e.altKey && k.length === 1) {
      const direct = DIRECT_TOOLS.find(([, , , key]) => key.toLowerCase() === k)
      if (direct) setTool(direct[0])
      else if (k === 'r') setTool('rect')
      else if (k === 'c') setTool('circle')
      else if (k === 'e') setTool('ellipse')
      else done = false
    } else done = false
    if (done) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  // ------------------------------------------------------------ menus

  const itemMenu = (e: React.MouseEvent, item: Item | null, at: Pt) => {
    let items: MenuItem[]
    if (!item) {
      // Empty canvas: every tool and every library, dropped where you clicked.
      items = [
        { label: 'Paste', icon: ClipboardPaste, disabled: !clipboard.length, onClick: paste },
        '-',
        { label: 'Tools', submenu: [
          ...DIRECT_TOOLS.map(([tool, icon, label]) => ({ label: label.split(' — ')[0], icon, onClick: () => setTool(tool) })),
          '-',
          ...SHAPE_GROUPS.map((g) => ({ label: g.title, submenu: g.shapes.map(([t, label]) => ({ label, onClick: () => setTool(t) })) })),
          { label: 'Chemistry', submenu: chemMenu(store) },
        ] },
        ...PALETTES.map((p) => ({
          label: p.title,
          icon: p.icon,
          submenu: p.categories.map(([title, names]) => ({
            label: title,
            submenu: names.map((nm) => ({ label: p.labels[nm] ?? nm, onClick: () => placeSymbol(`${p.id}:${nm}`, at) })),
          })),
        })),
      ]
    } else {
      const explodable = ['polygon', 'rect', 'ellipse', 'roundrect', 'arc', 'path'].includes(item.type)
      items = [
        ...(item.type === 'text' ? [{ label: 'Edit text', onClick: () => canvas.current?.editText(item._id) }] : []),
        ...(['rect', 'ellipse', 'roundrect', 'arc', 'polygon'].includes(item.type) ? [{ label: 'Edit label', onClick: () => canvas.current?.editText(item._id) }] : []),
        { label: 'Properties', onClick: () => showPanel('props') },
        ...(item.type === 'image' ? ['-' as const, { label: 'Remove background', onClick: () => void removeBackground() }] : []),
        '-',
        { label: 'Duplicate', icon: Copy, shortcut: '⌘D', onClick: duplicate },
        { label: 'Delete', icon: Trash2, shortcut: '⌫', onClick: remove },
        '-',
        { label: 'Flip horizontal', shortcut: '⇧⌘H', onClick: () => flip(true) },
        { label: 'Flip vertical', shortcut: '⇧⌘J', onClick: () => flip(false) },
        { label: 'Bring to front', shortcut: '⇧⌘]', onClick: () => order('front') },
        { label: 'Bring forward', shortcut: '⌘]', onClick: () => order('forward') },
        { label: 'Send backward', shortcut: '⌘[', onClick: () => order('backward') },
        { label: 'Send to back', shortcut: '⇧⌘[', onClick: () => order('back') },
        '-',
        ...(item.type === 'group' ? [{ label: 'Ungroup', shortcut: '⇧⌘G', onClick: ungroup }] : []),
        ...(store.sel.length > 1 ? [{ label: 'Group selection', shortcut: '⌘G', onClick: group }] : []),
        ...(explodable ? [{ label: 'Explode shape', shortcut: '⇧⌘E', onClick: explode }] : []),
        { label: 'Save as object…', onClick: () => void saveSelectionAsObject() },
      ]
    }
    os.contextMenu(e, items)
  }

  useEffect(() => {
    const recent = loadRecent()
    const objects = listObjects()
    const objectMenu: MenuItem[] = [
      { label: 'Save Selection as Object…', disabled: !sel.length, onClick: () => void saveSelectionAsObject() },
      { label: 'Show Library Folder', onClick: async () => {
        await fs.mkdir(LIBRARY_DIR, { recursive: true })
        os.open('files', { path: LIBRARY_DIR })
      } },
      '-',
      ...(objects.length
        ? objects.map((o) => ({ label: [...o.folder, o.name].join(' / '), onClick: () => void insertObject(o.path) }))
        : [{ label: '(no saved objects yet)', disabled: true }]),
    ]
    const hasSel = sel.length > 0
    const menus: MenuBarMenu[] = [
      {
        label: 'File',
        items: [
          { label: 'New', icon: FilePlus, shortcut: '⌘N', onClick: () => void newDocument() },
          { label: 'New Window', onClick: () => os.open('khervepaint', { _new: Date.now() }) },
          { label: 'Open…', icon: FolderOpen, shortcut: '⌘O', onClick: () => void openDialog() },
          {
            label: 'Open Recent',
            submenu: recent.length
              ? recent.map((p) => ({ label: path.basename(p), onClick: () => void openPath(p) }))
              : [{ label: 'No recent files', disabled: true }],
          },
          '-',
          { label: 'Save', icon: Save, shortcut: '⌘S', onClick: () => void save() },
          { label: 'Save As…', shortcut: '⇧⌘S', onClick: () => void saveAs() },
          '-',
          { label: 'Drawing Size…', shortcut: '⇧⌘P', onClick: () => setSizeDialog(true) },
          { label: 'Export PNG…', icon: FileImage, shortcut: '⌘E', onClick: () => void exportFile('png') },
          { label: 'Export PDF…', onClick: () => void exportFile('pdf') },
          {
            label: 'Download to Computer',
            icon: Download,
            submenu: [
              { label: 'SVG (editable)', onClick: () => void download('svg') },
              { label: 'KhervePaint .kpaint', onClick: () => void download('kpaint') },
              { label: 'PNG picture', onClick: () => void download('png') },
              { label: 'PDF', onClick: () => void download('pdf') },
            ],
          },
          '-',
          { label: 'Close', onClick: () => win.close() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', icon: Undo2, shortcut: '⌘Z', disabled: !store.past.length, onClick: () => store.undo() },
          { label: 'Redo', icon: Redo2, shortcut: '⇧⌘Z', disabled: !store.future.length, onClick: () => store.redo() },
          '-',
          { label: 'Cut', icon: Scissors, shortcut: '⌘X', disabled: !hasSel, onClick: cut },
          { label: 'Copy', icon: Copy, shortcut: '⌘C', disabled: !hasSel, onClick: copy },
          { label: 'Paste', icon: ClipboardPaste, shortcut: '⌘V', disabled: !clipboard.length, onClick: paste },
          { label: 'Duplicate', shortcut: '⌘D', disabled: !hasSel, onClick: duplicate },
          { label: 'Delete', icon: Trash2, shortcut: '⌫', disabled: !hasSel, onClick: remove },
          '-',
          { label: 'Select All', shortcut: '⌘A', onClick: selectAll },
          { label: 'Select None', disabled: !hasSel, onClick: () => store.select([]) },
          '-',
          { label: 'Save Selection as Object…', disabled: !hasSel, onClick: () => void saveSelectionAsObject() },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Show Grid', shortcut: "⌘'", checked: doc.grid.show, onClick: () => store.commit({ ...store.doc, grid: { ...store.doc.grid, show: !store.doc.grid.show } }) },
          { label: 'Snap to Grid', shortcut: "⇧⌘'", checked: doc.grid.snap, onClick: () => store.commit({ ...store.doc, grid: { ...store.doc.grid, snap: !store.doc.grid.snap } }) },
          { label: 'Infinite Paper', checked: doc.grid.infinite, onClick: () => store.commit({ ...store.doc, grid: { ...store.doc.grid, infinite: !store.doc.grid.infinite } }) },
          '-',
          { label: 'Zoom In', icon: ZoomIn, shortcut: '⌘+', onClick: () => canvas.current?.zoomBy(1.25) },
          { label: 'Zoom Out', icon: ZoomOut, shortcut: '⌘−', onClick: () => canvas.current?.zoomBy(1 / 1.25) },
          { label: 'Fit Page', shortcut: '⌘0', onClick: () => canvas.current?.fit() },
          { label: 'Actual Size', shortcut: '⌘1', onClick: () => canvas.current?.setZoom(1) },
          '-',
          { label: 'Properties Panel', checked: panel === 'props', onClick: () => showPanel(panel === 'props' ? null : 'props') },
          { label: 'Library Panel', checked: panel === 'library', onClick: () => showPanel(panel === 'library' ? null : 'library') },
        ],
      },
      {
        label: 'Insert',
        items: [
          { label: 'Picture…', icon: ImagePlus, onClick: () => void insertPictureDialog() },
          { label: 'Text', onClick: () => setTool('text') },
          { label: 'Line', onClick: () => setTool('line') },
          { label: 'Arrow', onClick: () => setTool('arrow') },
          {
            label: 'Measure',
            submenu: [
              { label: 'Dimension (ruler)', shortcut: 'M', onClick: () => setTool('dimension') },
              { label: 'Protractor (angle)', onClick: () => {
                setTool('protractor')
                say('Protractor: click the vertex, then the end of each arm (Esc cancels)')
              } },
              { label: 'Scale Bar…', onClick: () => setScaleDialog(true) },
            ],
          },
          { label: 'Chemistry', submenu: chemMenu(store) },
          { label: 'Room (walls)', onClick: () => {
            setTool('room')
            say('Drag out the room: it is drawn with solid walls and open corners')
          } },
          '-',
          ...SHAPE_GROUPS.map((g) => ({ label: g.title, submenu: g.shapes.map(([t, label]) => ({ label, onClick: () => setTool(t) })) })),
        ],
      },
      {
        label: 'Library',
        items: [
          ...PALETTES.map((p) => ({
            label: p.title,
            icon: p.icon,
            submenu: p.categories.map(([title, names]) => ({
              label: title,
              submenu: names.map((nm) => ({ label: p.labels[nm] ?? nm, onClick: () => armSymbol(`${p.id}:${nm}`) })),
            })),
          })),
          '-',
          { label: 'Objects', submenu: objectMenu },
          { label: 'Show Library Panel', icon: BookOpen, onClick: () => showPanel('library') },
        ],
      },
      {
        label: 'Arrange',
        items: [
          { label: 'Group', shortcut: '⌘G', disabled: sel.length < 2, onClick: group },
          { label: 'Ungroup', shortcut: '⇧⌘G', disabled: !sel.some((i) => i.type === 'group'), onClick: ungroup },
          { label: 'Explode Shape', shortcut: '⇧⌘E', disabled: !hasSel, onClick: explode },
          '-',
          { label: 'Flip Horizontal', shortcut: '⇧⌘H', disabled: !hasSel, onClick: () => flip(true) },
          { label: 'Flip Vertical', shortcut: '⇧⌘J', disabled: !hasSel, onClick: () => flip(false) },
          '-',
          { label: 'Bring to Front', shortcut: '⇧⌘]', disabled: !hasSel, onClick: () => order('front') },
          { label: 'Bring Forward', shortcut: '⌘]', disabled: !hasSel, onClick: () => order('forward') },
          { label: 'Send Backward', shortcut: '⌘[', disabled: !hasSel, onClick: () => order('backward') },
          { label: 'Send to Back', shortcut: '⇧⌘[', disabled: !hasSel, onClick: () => order('back') },
          '-',
          {
            label: 'Align',
            submenu: ALIGN_ITEMS.map(([how, label, icon]) => (how === '-' ? '-' : { label, icon, disabled: !hasSel, onClick: () => align(how) })),
          },
        ],
      },
      {
        label: 'Image',
        items: [
          { label: 'Drawing Size…', shortcut: '⇧⌘P', onClick: () => setSizeDialog(true) },
          { label: 'Fit Page to Drawing', onClick: () => void onSize({ kind: 'fit', selectionOnly: false }) },
          '-',
          { label: 'Open Picture as Raster Layer…', onClick: () => void openRasterDialog() },
          { label: 'Clear Raster Layer', onClick: clearRaster },
          '-',
          { label: 'Insert Picture…', icon: ImagePlus, onClick: () => void insertPictureDialog() },
          { label: 'Remove Background', disabled: !sel.some((i) => i.type === 'image'), onClick: () => void removeBackground() },
        ],
      },
      {
        label: 'Examples',
        items: groupExamples(loadExample),
      },
      {
        label: 'Help',
        items: [
          { label: 'KhervePaint Guide', icon: BookOpen, shortcut: 'F1', onClick: () => setHelp(true) },
          { label: 'Keyboard Shortcuts', icon: Keyboard, onClick: () => setHelp(true) },
          '-',
          {
            label: 'About KhervePaint',
            icon: Info,
            onClick: () =>
              void os.dialog.alert(
                'KhervePaint — hybrid raster + vector drawing. The KherveOS edition of the desktop KhervePaint: same editable SVG and .kpaint files, same symbol libraries. Free software (GPL-3.0).',
                { title: 'About KhervePaint' },
              ),
          },
        ],
      },
    ]
    win.setMenus(menus)
  })
  useEffect(() => () => win.setMenus(null), [win])

  // ------------------------------------------------------------ status

  const sizeReadout = (() => {
    const one = sel.length === 1 ? sel[0] : null
    if (!one) return sel.length ? `${sel.length} selected` : ''
    const mm = (px: number) => ((px / doc.dpi) * 25.4).toFixed(1)
    if (one.type === 'line' || one.type === 'arrow' || one.type === 'dimension') {
      const m = matrixOf(one)
      const a = apply(m, { x: one.x1, y: one.y1 })
      const b = apply(m, { x: one.x2, y: one.y2 })
      return `length ${mm(Math.hypot(b.x - a.x, b.y - a.y))} mm`
    }
    const b = boundsIn(one)
    return b ? `${mm(b.w)} × ${mm(b.h)} mm` : ''
  })()

  return (
    <div
      ref={rootRef}
      className="k-app kp-paint"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPaste={(e) => void onPaste(e)}
    >
      <OptionsBar store={store} actions={actions} panelOpen={!!panel} />
      <div className="kp-workarea">
        <ToolColumn store={store} onLibrary={() => showPanel('library')} />
        <div className="kp-canvas-wrap">
          <Canvas
            ref={canvas}
            store={store}
            onContextMenu={itemMenu}
            onCursor={(p) => cursor.set(p)}
            onZoom={(z) => zoom.set(z)}
            onDropData={(dt, at, snapped) => void onDropData(dt, at, snapped)}
            onPicked={(c, fill) => {
              store.set(fill ? { fill: c, fillOn: true } : { stroke: c })
              say(`Picked ${c.slice(3)} into the ${fill ? 'fill' : 'stroke'} colour`)
            }}
          />
          {busy && <div className="kp-busy">{busy}</div>}
        </div>
        {panel && (
          <aside className="kp-side">
            <div className="kp-paneltabs">
              <button className={panel === 'props' ? 'active' : ''} onClick={() => showPanel('props')}>Properties</button>
              <button className={panel === 'library' ? 'active' : ''} onClick={() => showPanel('library')}>Library</button>
            </div>
            {panel === 'props' ? (
              <Inspector store={store} onDrawingSize={() => setSizeDialog(true)} />
            ) : (
              <LibraryPanel store={store} onInsertObject={(p) => void insertObject(p)} onSaveObject={() => void saveSelectionAsObject()} />
            )}
          </aside>
        )}
      </div>
      <div className="k-statusbar kp-statusline">
        <CursorReadout live={cursor} />
        <span>{sizeReadout}</span>
        <span className="kp-statusmsg">{store.message || (store.settings.tool === 'place' && store.settings.place ? `Placing “${symbolLabel(store.settings.place)}” — Esc to stop` : '')}</span>
        <span className="k-spacer" />
        <span>{doc.width} × {doc.height} px · {doc.dpi} dpi</span>
        <button className="kp-zoom-btn" title="Zoom out" onClick={() => canvas.current?.zoomBy(1 / 1.25)}>−</button>
        <button className="kp-zoom-btn kp-zoom-pct" title="Fit the page (⌘0)" onClick={() => canvas.current?.fit()}><ZoomReadout live={zoom} /></button>
        <button className="kp-zoom-btn" title="Zoom in" onClick={() => canvas.current?.zoomBy(1.25)}>+</button>
      </div>
      {sizeDialog && <DrawingSizeDialog width={doc.width} height={doc.height} dpi={doc.dpi} hasSelection={sel.length > 0} onDone={(r) => void onSize(r)} />}
      {scaleDialog && <ScaleBarDialog onDone={onScaleBar} />}
      {help && <HelpDialog onClose={() => setHelp(false)} />}
    </div>
  )
}

function CursorReadout({ live }: { live: Live<Pt | null> }) {
  const p = useLive(live)
  return <span className="kp-statuspos">{p ? `x: ${Math.round(p.x)}  y: ${Math.round(p.y)}` : ''}</span>
}

function ZoomReadout({ live }: { live: Live<number> }) {
  return <>{Math.round(useLive(live) * 100)}%</>
}

function groupExamples(load: (i: number) => void): MenuItem[] {
  const out: MenuItem[] = []
  const byCat = new Map<string, MenuItem[]>()
  EXAMPLES.forEach((ex, i) => {
    let list = byCat.get(ex.category)
    if (!list) {
      list = []
      byCat.set(ex.category, list)
      out.push({ label: ex.category, submenu: list })
    }
    list.push({ label: ex.name, onClick: () => void load(i) })
  })
  return out
}

