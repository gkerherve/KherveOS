// One open PDF (one tab): the document in the PDF service, the annotations
// the user is editing (they live here until saved, as in the desktop app),
// undo/redo, selections, search, and caches of page text, links and fields.

import { useSyncExternalStore } from 'react'
import type {
  PdfAnnot, PdfDocument, PdfLink, PdfOutlineItem, PdfPageInfo, PdfSearchHit, PdfWidget, PdfWord,
} from '@/os/services/pdf'

export interface WordRef {
  page: number
  index: number
}

export interface TextSel {
  anchor: WordRef
  focus: WordRef
}

export interface ViewState {
  /** CSS pixels per PDF point. */
  zoom: number
  fit: 'width' | 'page' | null
  scrollTop: number
  scrollLeft: number
  /** The page in view. */
  page: number
}

export interface SearchState {
  query: string
  hits: PdfSearchHit[]
  index: number
  busy: boolean
}

interface Entry {
  id: number
  label: string
  annots: PdfAnnot[]
  /** The step also changed the document (undone through the PDF service). */
  doc: boolean
}

let entryIds = 1
let annotIds = 1
let tabIds = 1

export const newAnnotId = () => `k${annotIds++}`

const UNDO_LIMIT = 100

export class PdfTab {
  readonly key = `t${tabIds++}`
  path: string | null
  name: string
  readonly pdf: PdfDocument
  annots: PdfAnnot[]
  selected: ReadonlySet<string> = new Set()
  textSel: TextSel | null = null
  view: ViewState = { zoom: 1, fit: 'width', scrollTop: 0, scrollLeft: 0, page: 0 }
  search: SearchState | null = null
  /** Bumped when page content changes (re-render). */
  docVersion = 0
  /** Bumped on every change (React re-render). */
  version = 0
  /** Where the user last clicked on a page (pasted text goes there). */
  lastClick: { page: number; x: number; y: number } | null = null
  /** A long operation is running (shown in the status bar). */
  busy: string | null = null
  /** The outline (or detected headings) for the page layout `pages` it was read with. */
  outlineCache: { items: PdfOutlineItem[]; detected: boolean; pages: readonly PdfPageInfo[] } | null = null

  private undoStack: Entry[] = []
  private redoStack: Entry[] = []
  private savedMark = 0
  private chain: Promise<unknown> = Promise.resolve()
  private listeners = new Set<() => void>()
  private words = new Map<number, PdfWord[]>()
  private links = new Map<number, PdfLink[]>()
  private widgets = new Map<number, PdfWidget[]>()
  private loading = new Set<string>()
  private unsubscribeDoc: () => void

  constructor(pdf: PdfDocument, annots: PdfAnnot[], path: string | null, name: string) {
    this.pdf = pdf
    this.annots = annots
    this.path = path
    this.name = name
    this.unsubscribeDoc = pdf.onChange(() => this.contentChanged())
  }

  // ------------------------------------------------------------- React

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  getVersion = () => this.version

  emit() {
    this.version++
    for (const l of [...this.listeners]) l()
  }

  // ------------------------------------------------------------- state

  get dirty() {
    const top = this.undoStack[this.undoStack.length - 1]
    return (top?.id ?? 0) !== this.savedMark
  }

  get canUndo() {
    return this.undoStack.length > 0
  }

  get canRedo() {
    return this.redoStack.length > 0
  }

  get undoLabel() {
    return this.undoStack[this.undoStack.length - 1]?.label ?? ''
  }

  get redoLabel() {
    return this.redoStack[this.redoStack.length - 1]?.label ?? ''
  }

  private contentChanged() {
    this.docVersion++
    this.words.clear()
    this.links.clear()
    this.widgets.clear()
    this.textSel = null
  }

  private push(label: string, doc: boolean) {
    this.undoStack.push({ id: entryIds++, label, annots: this.annots, doc })
    if (this.undoStack.length > UNDO_LIMIT) {
      // The oldest step falls off; a document step can then no longer be undone,
      // which is fine — MuPDF simply keeps it.
      this.undoStack.shift()
    }
    this.redoStack = []
  }

  /** Replace the annotations as one undoable step. */
  setAnnots(next: PdfAnnot[], label: string) {
    this.push(label, false)
    this.annots = next
    const ids = new Set(next.map((a) => a.id))
    if ([...this.selected].some((id) => !ids.has(id))) this.selected = new Set([...this.selected].filter((id) => ids.has(id)))
    this.emit()
  }

  updateAnnots(fn: (annots: PdfAnnot[]) => PdfAnnot[], label: string) {
    const next = fn(this.annots)
    if (next !== this.annots) this.setAnnots(next, label)
  }

  /** Where the page view should scroll to next (handled and cleared by the view). */
  scrollRequest: { page: number; rect?: [number, number, number, number]; center?: boolean } | null = null

  setZoom(zoom: number, fit: ViewState['fit'] = null) {
    const z = Math.max(0.1, Math.min(8, zoom))
    if (Math.abs(z - this.view.zoom) < 1e-4 && fit === this.view.fit) return
    this.view.zoom = z
    this.view.fit = fit
    this.emit()
  }

  /** Scroll to a page (and optionally bring a rectangle on it into view). */
  goto(page: number, rect?: [number, number, number, number], center = false) {
    if (!(page >= 0 && page < this.pdf.pageCount)) return
    this.scrollRequest = { page, rect, center }
    this.emit()
  }

  setCurrentPage(page: number) {
    if (page === this.view.page) return
    this.view.page = page
    this.emit()
  }

  select(ids: Iterable<string>) {
    this.selected = new Set(ids)
    this.emit()
  }

  setTextSel(sel: TextSel | null) {
    this.textSel = sel
    this.emit()
  }

  /** Run operations one after another (the document's undo history must stay in step). */
  private queue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.catch(() => {})
    return run
  }

  /**
   * A change to the document itself (pages, forms, redaction…), done by `run`
   * through the PDF service. `adjust` updates the annotations to match.
   */
  docOp<T>(label: string, run: () => Promise<T>, adjust?: (annots: PdfAnnot[], result: T) => PdfAnnot[]): Promise<T> {
    return this.queue(async () => {
      this.busy = label
      this.emit()
      try {
        const result = await run()
        this.push(label, true)
        if (adjust) this.annots = adjust(this.annots, result)
        this.contentChanged()
        this.selected = new Set()
        return result
      } finally {
        this.busy = null
        this.emit()
      }
    })
  }

  undo(): Promise<void> {
    return this.queue(async () => {
      const e = this.undoStack.pop()
      if (!e) return
      if (e.doc) await this.pdf.undo()
      this.redoStack.push({ ...e, annots: this.annots })
      this.annots = e.annots
      this.selected = new Set()
      if (e.doc) this.contentChanged()
      this.emit()
    })
  }

  redo(): Promise<void> {
    return this.queue(async () => {
      const e = this.redoStack.pop()
      if (!e) return
      if (e.doc) await this.pdf.redo()
      this.undoStack.push({ ...e, annots: this.annots })
      this.annots = e.annots
      this.selected = new Set()
      if (e.doc) this.contentChanged()
      this.emit()
    })
  }

  /** The PDF with the annotations written in. */
  bytes(options: { compact?: boolean; encrypt?: { userPassword?: string; ownerPassword?: string } } = {}): Promise<Uint8Array> {
    return this.queue(() => this.pdf.save({ annotations: this.annots, ...options }))
  }

  /** Remember that what is in memory now is what is on the drive at `path`. */
  markSaved(path: string, name: string) {
    this.path = path
    this.name = name
    this.savedMark = this.undoStack[this.undoStack.length - 1]?.id ?? 0
    this.emit()
  }

  close() {
    this.unsubscribeDoc()
    this.listeners.clear()
    this.pdf.close()
  }

  // ---------------------------------------------------- page data caches

  private load<T>(key: string, map: Map<number, T>, page: number, fetch: () => Promise<T>) {
    if (map.has(page) || this.loading.has(`${key}:${page}`) || this.pdf.closed) return
    const tag = `${key}:${page}`
    const version = this.docVersion
    this.loading.add(tag)
    fetch()
      .then((v) => {
        if (this.docVersion !== version) return
        map.set(page, v)
        this.emit()
      })
      .catch(() => {})
      .finally(() => this.loading.delete(tag))
  }

  wordsOf(page: number): PdfWord[] | undefined {
    this.load('w', this.words, page, () => this.pdf.pageWords(page))
    return this.words.get(page)
  }

  linksOf(page: number): PdfLink[] | undefined {
    this.load('l', this.links, page, () => this.pdf.pageLinks(page))
    return this.links.get(page)
  }

  widgetsOf(page: number): PdfWidget[] | undefined {
    if (!this.pdf.hasForms) return undefined
    this.load('f', this.widgets, page, () => this.pdf.widgets(page))
    return this.widgets.get(page)
  }

  async wordsAsync(page: number): Promise<PdfWord[]> {
    const have = this.words.get(page)
    if (have) return have
    const w = await this.pdf.pageWords(page)
    this.words.set(page, w)
    return w
  }

  /** Fill in a form field (undoable). */
  setField(widget: PdfWidget, value: string | boolean): Promise<void> {
    return this.docOp(`Fill in “${widget.label || widget.name}”`, async () => {
      const ws = await this.pdf.setFieldValue(widget.page, widget.id, value)
      return ws
    }).then((ws) => {
      this.widgets.set(widget.page, ws)
      this.emit()
    })
  }

  // ------------------------------------------------------ text selection

  /** Word ranges [page, from, to] covered by the selection (pages without loaded words are skipped). */
  selSpans(sel: TextSel | null = this.textSel): [number, number, number][] {
    if (!sel) return []
    let a = sel.anchor
    let b = sel.focus
    if (b.page < a.page || (b.page === a.page && b.index < a.index)) [a, b] = [b, a]
    const spans: [number, number, number][] = []
    for (let p = a.page; p <= b.page; p++) {
      const words = this.words.get(p)
      if (!words?.length) continue
      const from = p === a.page ? a.index : 0
      const to = p === b.page ? b.index : words.length - 1
      if (from <= to) spans.push([p, Math.max(0, from), Math.min(words.length - 1, to)])
    }
    return spans
  }

  /** The selected text (loads the words of pages in between). */
  async selectedText(): Promise<string> {
    const sel = this.textSel
    if (!sel) return ''
    const lo = Math.min(sel.anchor.page, sel.focus.page)
    const hi = Math.max(sel.anchor.page, sel.focus.page)
    for (let p = lo; p <= hi; p++) await this.wordsAsync(p)
    return this.selSpans(sel)
      .map(([p, from, to]) => {
        const words = this.words.get(p)!.slice(from, to + 1)
        let out = ''
        words.forEach((w, i) => {
          if (i) out += w.line !== words[i - 1].line ? '\n' : ' '
          out += w.text
        })
        return out
      })
      .join('\n\n')
  }

  /** The selection as one rectangle per line, per page. */
  selLineRects(page: number): [number, number, number, number][] {
    const out: [number, number, number, number][] = []
    for (const [p, from, to] of this.selSpans()) {
      if (p !== page) continue
      const words = this.words.get(p)!.slice(from, to + 1)
      let cur: [number, number, number, number] | null = null
      let line = -1
      for (const w of words) {
        if (cur && w.line === line) {
          cur[0] = Math.min(cur[0], w.rect[0])
          cur[1] = Math.min(cur[1], w.rect[1])
          cur[2] = Math.max(cur[2], w.rect[2])
          cur[3] = Math.max(cur[3], w.rect[3])
        } else {
          if (cur) out.push(cur)
          cur = [...w.rect]
          line = w.line
        }
      }
      if (cur) out.push(cur)
    }
    return out
  }
}

/** Re-render when the tab changes. */
export function useTab(tab: PdfTab | null): number {
  return useSyncExternalStore(tab?.subscribe ?? noop, tab?.getVersion ?? zero)
}
const noop = () => () => {}
const zero = () => 0
