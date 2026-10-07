// The KherveOS PDF service, for every app that shows or edits PDFs.
//
//   import { openPdf } from '@/os/services/pdf'
//   const pdf = await openPdf(await fs.readBytes(path))
//   const bitmap = await pdf.renderPage(0, 2)        // 2 device pixels per PDF point
//   const text = await pdf.pageText(0)
//   ...
//   pdf.close()
//
// MuPDF (AGPL, like the PyMuPDF the desktop Kherve apps use) runs in one shared
// Web Worker that is only started when the first PDF is opened. Geometry is in
// PDF points in the page's display space: origin at the top-left of the page as
// shown (rotation applied), y going down.

import type { HistoryResult, OpenResult, PdfEngineOps } from './pdf.engine'

// ------------------------------------------------------------------- types

export interface PdfMetadata {
  title?: string
  author?: string
  subject?: string
  keywords?: string
  creator?: string
  producer?: string
  creationDate?: string
}

export type PdfPoint = [number, number]
/** [x0, y0, x1, y1] in PDF points, display space. */
export type PdfRect = [number, number, number, number]

export interface PdfPageInfo {
  /** Size in PDF points, as displayed (rotation applied). */
  width: number
  height: number
  /** Top-left of the page box (usually 0, 0). */
  x: number
  y: number
  /** /Rotate of the page: 0, 90, 180 or 270. */
  rotation: number
  /** The page label ("iv", "12"…), or its number. */
  label: string
}

export interface PdfSearchHit {
  page: number
  rects: { x: number; y: number; w: number; h: number }[]
}

export interface PdfWord {
  text: string
  rect: PdfRect
  /** Words with the same number are on the same line (counted from the top of the page, in reading order). */
  line: number
}

export interface PdfLink {
  rect: PdfRect
  uri: string
  /** For links inside the document: the target page. */
  page?: number
}

export interface PdfOutlineItem {
  title: string
  /** 0-based target page, or null (external link / no target). */
  page: number | null
  uri?: string
  open?: boolean
  children?: PdfOutlineItem[]
}

export type PdfAnnotKind =
  | 'ink' | 'highlight' | 'underline' | 'strikeout' | 'squiggly' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'note' | 'text' | 'redact'
  | 'image'

/**
 * An annotation as editors see it (display space, PDF points). Which fields are
 * used depends on `kind`:
 *  - ink: `strokes`;  highlight/underline/strikeout/squiggly: `rects` (one per line);
 *  - rect/ellipse: `rect` (+ `fill`);  line/arrow: `line` (arrow head at the end);
 *  - note: `rect` (icon) + `text`;  text: `rect` + `text` + `fontSize` (+ `font`);
 *  - redact: `rect` (an area to black out when redactions are applied);
 *  - image: `rect` + `image` (PNG/JPEG bytes) — becomes part of the page when saved.
 */
export interface PdfAnnot {
  id: string
  kind: PdfAnnotKind
  page: number
  /** '#rrggbb' — stroke, mark or text colour. */
  color: string
  /** 0…1 */
  opacity: number
  /** Line width in points. */
  width: number
  fill?: string | null
  rect?: PdfRect
  rects?: PdfRect[]
  strokes?: PdfPoint[][]
  line?: [PdfPoint, PdfPoint]
  text?: string
  fontSize?: number
  /** PDF base-14 short name: 'Helv' (default), 'TiRo', 'Cour'. */
  font?: string
  image?: Uint8Array
  author?: string
  /** Object number of the annotation this came from (set by detachAnnotations; keep it). */
  orig?: number
}

export type PdfFieldType = 'text' | 'checkbox' | 'radiobutton' | 'combobox' | 'listbox' | 'button' | 'signature'

/** A form field widget on a page. */
export interface PdfWidget {
  /** Stable id (the widget's object number). */
  id: number
  page: number
  type: PdfFieldType
  name: string
  label: string
  rect: PdfRect
  /** Text, the chosen option, or the on-state name / 'Off' for buttons. */
  value: string
  options: string[]
  multiline: boolean
  password: boolean
  comb: boolean
  maxLen: number
  readOnly: boolean
  /** Font size from the field's appearance (0 = automatic). */
  fontSize: number
  /** Check boxes and radio buttons: the value when switched on. */
  onState?: string
}

export interface PdfOpenOptions {
  password?: string
}

export interface PdfRenderOptions {
  /** Only render this part of the page (page points). */
  clip?: PdfRect
  /** Draw annotations and form fields (default true). */
  annotations?: boolean
  priority?: 'high' | 'normal' | 'low'
  /** Cancels the request if it has not started yet. */
  signal?: AbortSignal
}

export interface PdfSaveOptions {
  /** Editors: the annotations to write into the saved file (the open document is not changed). */
  annotations?: PdfAnnot[]
  /** Smaller file: deduplicate objects, compress fonts and images, object streams. */
  compact?: boolean
  /** Password-protect (AES-256); empty passwords remove the protection. */
  encrypt?: { userPassword?: string; ownerPassword?: string }
}

export interface PdfExportImagesOptions {
  dpi?: number
  format?: 'png' | 'jpeg'
  quality?: number
  clip?: PdfRect
  annotations?: PdfAnnot[]
}

export interface PdfStampTextOptions {
  /** `{n}` and `{total}` are replaced by the page number and the page count. */
  text: string
  pages?: number[]
  position: 'diagonal' | 'top' | 'bottom'
  size?: number
  color?: string
  opacity?: number
  margin?: number
}

export interface PdfDocument {
  readonly pageCount: number
  readonly metadata: PdfMetadata
  pageSize(index: number): Promise<{ width: number; height: number }> // in PDF points
  renderPage(index: number, scale: number, options?: PdfRenderOptions): Promise<ImageBitmap>
  pageText(index: number): Promise<string>
  search(text: string): Promise<{ page: number; rects: { x: number; y: number; w: number; h: number }[] }[]>
  save(options?: PdfSaveOptions): Promise<Uint8Array>
  close(): void

  /** Page sizes, rotations and labels (kept up to date after page operations). */
  readonly pages: readonly PdfPageInfo[]
  readonly encrypted: boolean
  /** The document has fillable form fields. */
  readonly hasForms: boolean
  readonly closed: boolean
  /** Called after the pages change (page operations, undo/redo). Returns an unsubscribe function. */
  onChange(listener: () => void): () => void

  pageWords(index: number): Promise<PdfWord[]>
  pageLinks(index: number): Promise<PdfLink[]>
  outline(): Promise<PdfOutlineItem[]>
  /** Headings guessed from font sizes, for PDFs without an outline. */
  detectHeadings(): Promise<PdfOutlineItem[]>
  setOutline(items: PdfOutlineItem[]): Promise<void>
  setMetadata(meta: PdfMetadata): Promise<void>

  /** Annotations in the document, without changing it. */
  annotations(index?: number): Promise<PdfAnnot[]>
  /** Editors: take the editable annotations out of the document (all pages, or some); save() writes them back. */
  detachAnnotations(pages?: number[]): Promise<PdfAnnot[]>
  /** Viewers that edit in place: add annotations to the document. Returns them with their new ids. */
  addAnnotations(annots: PdfAnnot[]): Promise<PdfAnnot[]>
  removeAnnotations(ids: string[]): Promise<void>

  insertBlankPage(at: number, size?: { width: number; height: number }): Promise<void>
  deletePages(indices: number[]): Promise<void>
  rotatePages(indices: number[], degrees: number): Promise<void>
  /** `order[i]` = the current index of the page that should end up at i. */
  rearrangePages(order: number[]): Promise<void>
  movePage(from: number, to: number): Promise<void>
  /** Insert another PDF's pages at `at` (-1 = end); returns how many. With `detach`, also its annotations. */
  insertPdf(data: Uint8Array, at: number, options?: { password?: string; detach?: boolean }): Promise<{ count: number; annotations: PdfAnnot[] }>
  /** New PDFs made of page groups (one file per group), optionally with annotations written in. */
  extractPages(groups: number[][], options?: { annotations?: PdfAnnot[] }): Promise<Uint8Array[]>
  exportImages(pages: number[], options?: PdfExportImagesOptions): Promise<Uint8Array[]>
  stampText(options: PdfStampTextOptions): Promise<void>

  widgets(index: number): Promise<PdfWidget[]>
  /** Fill in a field: text for text/choice fields, true/false for check boxes and radio buttons. Returns the page's widgets. */
  setFieldValue(index: number, widgetId: number, value: string | boolean): Promise<PdfWidget[]>

  /** Permanently black out areas (text, images and drawings underneath are removed). */
  applyRedactions(areas: { page: number; rect: PdfRect }[]): Promise<void>

  /** Undo / redo the document changes made through this API (pages, forms, redaction, outline…). */
  undo(): Promise<void>
  redo(): Promise<void>
}

/** openPdf() rejects with this when the PDF is encrypted and the password is missing or wrong. */
export class PdfPasswordError extends Error {
  readonly wrongPassword: boolean
  constructor(wrongPassword: boolean) {
    super(wrongPassword ? 'The password is not correct.' : 'This PDF is protected by a password.')
    this.name = 'PdfPasswordError'
    this.wrongPassword = wrongPassword
  }
}

// ------------------------------------------------------------------ worker

type Ops = PdfEngineOps
type OpName = keyof Ops
type OpArgs<K extends OpName> = Ops[K] extends (...args: infer A) => unknown ? A : never
type OpResult<K extends OpName> = K extends 'render' ? ImageBitmap : Ops[K] extends (...args: never[]) => infer R ? R : never

interface Job {
  id: number
  op: OpName
  args: unknown[]
  transfer: Transferable[]
  priority: number
  epoch: number
  seq: number
  signal?: AbortSignal
  resolve: (v: unknown) => void
  reject: (e: unknown) => void
  onAbort?: () => void
}

type Reply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string; name?: string; fatal?: boolean }

const PRIORITY = { high: 2, normal: 1, low: 0 } as const
/** Requests handed to the worker at once; the rest wait here so urgent ones can jump the queue. */
const IN_FLIGHT = 2
const IDLE_MS = 60_000

function abortError() {
  return new DOMException('The request was cancelled.', 'AbortError')
}

class PdfWorkerClient {
  private worker: Worker | null = null
  /** Bumped when the worker is replaced: documents of an older generation are gone. */
  generation = 0
  private waiting: Job[] = []
  private running = new Map<number, Job>()
  private nextId = 1
  private seq = 0
  private epoch = 0
  private openDocs = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  private ensure(): Worker {
    if (this.worker) return this.worker
    const w = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module', name: 'pdf' })
    w.onmessage = (e: MessageEvent<Reply>) => this.onReply(e.data)
    w.onerror = (e) => {
      e.preventDefault()
      this.crash(new Error(e.message || 'The PDF engine stopped unexpectedly.'))
    }
    this.worker = w
    this.generation++
    return w
  }

  private crash(err: Error) {
    this.worker?.terminate()
    this.worker = null
    this.openDocs = 0
    const all = [...this.running.values(), ...this.waiting]
    this.running.clear()
    this.waiting = []
    for (const j of all) {
      j.signal?.removeEventListener('abort', j.onAbort!)
      j.reject(err)
    }
  }

  docOpened() {
    this.openDocs++
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  docClosed() {
    this.openDocs = Math.max(0, this.openDocs - 1)
    this.scheduleIdle()
  }

  /** Stop the worker (and free MuPDF's memory) a while after the last PDF closed. */
  scheduleIdle() {
    if (this.openDocs === 0 && !this.idleTimer) {
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null
        if (this.openDocs === 0 && !this.running.size && !this.waiting.length) {
          this.worker?.terminate()
          this.worker = null
        }
      }, IDLE_MS)
    }
  }

  call<K extends OpName>(
    op: K,
    args: OpArgs<K>,
    opts: { priority?: keyof typeof PRIORITY; signal?: AbortSignal; transfer?: Transferable[]; barrier?: boolean } = {},
  ): Promise<OpResult<K>> {
    if (opts.signal?.aborted) return Promise.reject(abortError())
    this.ensure()
    return new Promise<OpResult<K>>((resolve, reject) => {
      let epoch = this.epoch
      if (opts.barrier) {
        epoch = ++this.epoch
        this.epoch++
      }
      const job: Job = {
        id: this.nextId++, op, args, transfer: opts.transfer ?? [], priority: PRIORITY[opts.priority ?? 'normal'], epoch, seq: this.seq++,
        signal: opts.signal, resolve: resolve as (v: unknown) => void, reject,
      }
      if (opts.signal) {
        job.onAbort = () => {
          const i = this.waiting.indexOf(job)
          if (i >= 0) {
            this.waiting.splice(i, 1)
            reject(abortError())
          }
        }
        opts.signal.addEventListener('abort', job.onAbort, { once: true })
      }
      this.waiting.push(job)
      this.pump()
    })
  }

  private pump() {
    while (this.running.size < IN_FLIGHT && this.waiting.length) {
      let best = 0
      for (let i = 1; i < this.waiting.length; i++) {
        const a = this.waiting[i]
        const b = this.waiting[best]
        if (a.epoch < b.epoch || (a.epoch === b.epoch && (a.priority > b.priority || (a.priority === b.priority && a.seq < b.seq)))) best = i
      }
      const job = this.waiting.splice(best, 1)[0]
      this.running.set(job.id, job)
      try {
        this.ensure().postMessage({ id: job.id, op: job.op, args: job.args }, job.transfer)
      } catch (e) {
        this.running.delete(job.id)
        job.reject(e)
      }
    }
  }

  private onReply(r: Reply) {
    const job = this.running.get(r.id)
    if (!job) return
    this.running.delete(r.id)
    if (job.onAbort) job.signal?.removeEventListener('abort', job.onAbort)
    if (r.ok) {
      const raw = r.result as { kind?: string; width: number; height: number; pixels: Uint8ClampedArray<ArrayBuffer> } | null
      if (raw && typeof raw === 'object' && raw.kind === 'raw-image') {
        // The worker could not make the bitmap itself.
        createImageBitmap(new ImageData(raw.pixels, raw.width, raw.height)).then(job.resolve, job.reject)
      } else if (job.signal?.aborted) {
        if (r.result instanceof ImageBitmap) r.result.close()
        job.reject(abortError())
      } else job.resolve(r.result)
    } else {
      const err = new Error(r.error)
      if (r.name) err.name = r.name
      job.reject(err)
      if (r.fatal) {
        this.crash(new Error(`The PDF engine stopped: ${r.error}`))
        return
      }
    }
    this.pump()
  }
}

let client: PdfWorkerClient | null = null
const getClient = () => (client ??= new PdfWorkerClient())

// Development only, never runs: lets Vite's dependency scanner see MuPDF (which
// only the worker imports) at startup, so opening the first PDF does not make
// Vite re-optimise its dependencies and reload the page. Removed from builds.
if (import.meta.env?.DEV && (globalThis as { __kherveosNever?: boolean }).__kherveosNever) void import('mupdf')

// ---------------------------------------------------------------- document

class WorkerPdf implements PdfDocument {
  private c: PdfWorkerClient
  private id: number
  private gen: number
  private listeners = new Set<() => void>()
  pages: PdfPageInfo[]
  metadata: PdfMetadata
  encrypted: boolean
  hasForms: boolean
  closed = false

  constructor(c: PdfWorkerClient, r: OpenResult) {
    this.c = c
    this.id = r.id
    this.gen = c.generation
    this.pages = r.pages
    this.metadata = r.metadata
    this.encrypted = r.encrypted
    this.hasForms = r.hasForms
  }

  get pageCount() {
    return this.pages.length
  }

  onChange(listener: () => void) {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private setPages(pages: PdfPageInfo[]) {
    this.pages = pages
    for (const l of [...this.listeners]) {
      try {
        l()
      } catch (e) {
        console.error('[pdf] change listener failed', e)
      }
    }
  }

  private call<K extends OpName>(op: K, rest: unknown[], opts: Parameters<PdfWorkerClient['call']>[2] = {}): Promise<OpResult<K>> {
    if (this.closed) return Promise.reject(new Error('This PDF has been closed.'))
    if (this.gen !== this.c.generation) return Promise.reject(new Error('The PDF engine was restarted; open the file again.'))
    return this.c.call(op, [this.id, ...rest] as unknown as OpArgs<K>, opts)
  }

  private checkPage(index: number) {
    if (!(index >= 0 && index < this.pages.length)) throw new RangeError(`There is no page ${index + 1}.`)
  }

  async pageSize(index: number) {
    this.checkPage(index)
    const p = this.pages[index]
    return { width: p.width, height: p.height }
  }

  renderPage(index: number, scale: number, options: PdfRenderOptions = {}): Promise<ImageBitmap> {
    return this.call('render', [index, scale, options.clip ?? null, options.annotations !== false], {
      priority: options.priority, signal: options.signal,
    })
  }

  pageText(index: number) {
    return this.call('text', [index])
  }

  search(text: string) {
    return this.call('search', [text])
  }

  save(options: PdfSaveOptions = {}) {
    return this.call('save', [options])
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.listeners.clear()
    if (this.gen === this.c.generation) {
      void this.c.call('close', [this.id], { barrier: true }).catch(() => {})
      this.c.docClosed()
    }
  }

  pageWords(index: number) {
    return this.call('words', [index])
  }

  pageLinks(index: number) {
    return this.call('links', [index])
  }

  outline() {
    return this.call('outline', [])
  }

  detectHeadings() {
    return this.call('headings', [], { priority: 'low' })
  }

  async setOutline(items: PdfOutlineItem[]) {
    await this.call('setOutline', [items], { barrier: true })
  }

  async setMetadata(meta: PdfMetadata) {
    this.metadata = await this.call('setMetadata', [meta], { barrier: true })
  }

  annotations(index?: number) {
    return this.call('annotations', [index ?? null])
  }

  detachAnnotations(pages?: number[]) {
    return this.call('detach', [pages ?? null], { barrier: true })
  }

  addAnnotations(annots: PdfAnnot[]) {
    return this.call('addAnnotations', [annots], { barrier: true })
  }

  async removeAnnotations(ids: string[]) {
    await this.call('removeAnnotations', [ids], { barrier: true })
  }

  async insertBlankPage(at: number, size?: { width: number; height: number }) {
    this.setPages(await this.call('insertBlankPage', [at, size?.width, size?.height], { barrier: true }))
  }

  async deletePages(indices: number[]) {
    this.setPages(await this.call('deletePages', [indices], { barrier: true }))
  }

  async rotatePages(indices: number[], degrees: number) {
    this.setPages(await this.call('rotatePages', [indices, degrees], { barrier: true }))
  }

  async rearrangePages(order: number[]) {
    this.setPages(await this.call('rearrangePages', [order], { barrier: true }))
  }

  async movePage(from: number, to: number) {
    const order = this.pages.map((_, i) => i)
    const [moved] = order.splice(from, 1)
    order.splice(Math.max(0, Math.min(to, order.length)), 0, moved)
    await this.rearrangePages(order)
  }

  async insertPdf(data: Uint8Array, at: number, options: { password?: string; detach?: boolean } = {}) {
    const r = await this.call('insertPdf', [data, at, options.password ?? '', !!options.detach], { barrier: true })
    if ('needsPassword' in r) throw new PdfPasswordError(!!options.password)
    this.setPages(r.pages)
    return { count: r.count, annotations: r.annotations }
  }

  extractPages(groups: number[][], options: { annotations?: PdfAnnot[] } = {}) {
    return this.call('extractPages', [groups, options.annotations ?? null])
  }

  exportImages(pages: number[], options: PdfExportImagesOptions = {}) {
    return this.call('exportImages', [pages, options])
  }

  async stampText(options: PdfStampTextOptions) {
    this.setPages(await this.call('stampText', [options], { barrier: true }))
  }

  widgets(index: number) {
    return this.call('widgets', [index])
  }

  setFieldValue(index: number, widgetId: number, value: string | boolean) {
    return this.call('setField', [index, widgetId, value], { barrier: true })
  }

  async applyRedactions(areas: { page: number; rect: PdfRect }[]) {
    this.setPages(await this.call('redact', [areas], { barrier: true }))
  }

  async undo() {
    const r: HistoryResult = await this.call('undo', [], { barrier: true })
    this.setPages(r.pages)
  }

  async redo() {
    const r: HistoryResult = await this.call('redo', [], { barrier: true })
    this.setPages(r.pages)
  }
}

/** Open a PDF (bytes are copied). Rejects with PdfPasswordError for encrypted files without the right password. */
export async function openPdf(data: Uint8Array, options: PdfOpenOptions = {}): Promise<PdfDocument> {
  const c = getClient()
  let r: OpenResult
  try {
    r = await c.call('open', [data, options.password ?? ''], { barrier: true })
  } catch (e) {
    c.scheduleIdle()
    throw e
  }
  if (r.needsPassword) {
    c.scheduleIdle()
    throw new PdfPasswordError(!!options.password)
  }
  c.docOpened()
  return new WorkerPdf(c, r)
}
