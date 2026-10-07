// The grid: a canvas showing only the visible cells, under native
// scrollbars (a sticky stage inside a spacer the size of the sheet), with
// the floating objects and the in-cell editor in a layer that moves with
// the scroll. Mouse: select, drag ranges, resize rows and columns, the fill
// handle, point at cells while typing a formula. Keyboard: Excel's keys.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useStore } from 'zustand'
import { os, type MenuItem } from '@/os'
import type { Book } from './book'
import { getClip } from './clip'
import { adaptFill } from './colors'
import { CellEditor, pointAt, pointing } from './CellEditor'
import { cellFont, drawGrid, headerWidth, measure, type Theme } from './draw'
import { Floating, type FloatActions } from './Floating'
import { refTokens } from './formula'
import { a1, columnLabels, expandMerges, inSelection, key, mergeAt, mergeRange, normRange, usedExtent, type Pos, type Range } from './model'
import { dropdownOf, isCheckbox, linkOf, noteText, toggleCheckbox, CHART_TYPES, insertChart } from './objects'
import {
  autoFill, autoFitCols, clearContents, copySelection, deleteCols, deleteRows, fillDownRight, fillRange, fillTarget, insertCols,
  insertRows, pasteText, quickSort, restoreLayout, selectedCols, selectedRows, snapLayout, toggleFlag,
} from './ops'

export interface GridActions extends FloatActions {
  formatCells: () => void
  editNote: (r: number, c: number) => void
  showPython: (r: number, c: number) => void
  colWidth: () => void
  rowHeight: () => void
  link: () => void
  filterMenu: (col: number, at: { clientX: number; clientY: number }) => void
}

const HH = 22
const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent)

function readTheme(el: HTMLElement): Theme {
  const s = getComputedStyle(el)
  const v = (name: string, d: string) => s.getPropertyValue(name).trim() || d
  return {
    bg: v('--k-bg', '#0d0f0e'),
    surface: v('--k-surface', '#121514'),
    chrome: v('--k-chrome', '#171b19'),
    text: v('--k-text', '#e9f1ec'),
    muted: v('--k-muted', '#8b998f'),
    accent: v('--k-accent', '#22b357'),
    border: v('--k-border', '#252b28'),
    danger: v('--k-danger', '#ff6b6b'),
    link: v('--k-link', '#5fdc8c'),
    font: v('--k-font', 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif'),
  }
}

type Drag =
  | { kind: 'select'; anchor: Pos; add: boolean }
  | { kind: 'cols'; anchor: number; add: boolean }
  | { kind: 'rows'; anchor: number; add: boolean }
  | { kind: 'colsize'; col: number; x0: number; w0: number; cols: number[]; before: ReturnType<typeof snapLayout> }
  | { kind: 'rowsize'; row: number; y0: number; h0: number; rows: number[]; before: ReturnType<typeof snapLayout> }
  | { kind: 'fill'; src: Range; target: Range }
  | { kind: 'point'; anchor: Pos }

export function Grid({ book, actions }: { book: Book; actions: GridActions }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const themeRef = useRef<Theme | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const lastPointer = useRef<{ x: number; y: number } | null>(null)
  const autoScroll = useRef<ReturnType<typeof setInterval> | null>(null)
  const frame = useRef(0)
  const antsPhase = useRef(0)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [fillPreview, setFillPreview] = useState<Range | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const version = useStore(book.store, (s) => s.version)
  const active = useStore(book.store, (s) => s.active)
  const sel = useStore(book.store, (s) => s.sel)
  const edit = useStore(book.store, (s) => s.edit)
  const view = useStore(book.store, (s) => s.view)
  const ants = useStore(book.store, (s) => s.ants)
  const object = useStore(book.store, (s) => s.object)
  const sh = book.sheet(active)
  const zoom = view.zoom
  const { rows, cols } = book.geometry(sh)
  const hw = view.headings ? headerWidth(sh.rows - 1) : 0
  const hh = view.headings ? HH : 0
  const FH = rows.pos(Math.min(sh.freeze[0], sh.rows))
  const FW = cols.pos(Math.min(sh.freeze[1], sh.cols))

  // ------------------------------------------------------------ geometry

  const scroll = () => {
    const el = scrollerRef.current
    return { x: (el?.scrollLeft ?? 0) / zoom, y: (el?.scrollTop ?? 0) / zoom }
  }
  /** Screen (logical) x of a column's left edge. */
  const colX = (c: number, sx = scroll().x) => (c < sh.freeze[1] ? hw + cols.pos(c) : hw + cols.pos(c) - sx)
  const rowY = (r: number, sy = scroll().y) => (r < sh.freeze[0] ? hh + rows.pos(r) : hh + rows.pos(r) - sy)
  const colAt = (lx: number) => {
    const s = scroll()
    if (sh.freeze[1] > 0 && lx - hw < FW) return cols.at(Math.max(0, lx - hw))
    return cols.at(Math.max(0, lx - hw + s.x))
  }
  const rowAt = (ly: number) => {
    const s = scroll()
    if (sh.freeze[0] > 0 && ly - hh < FH) return rows.at(Math.max(0, ly - hh))
    return rows.at(Math.max(0, ly - hh + s.y))
  }
  const local = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { lx: (clientX - r.left) / zoom, ly: (clientY - r.top) / zoom }
  }

  // ------------------------------------------------------------- drawing

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const el = scrollerRef.current
    if (!canvas || !el || !size.w || !size.h) return
    themeRef.current ??= readTheme(hostRef.current ?? el)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const st = book.state
    const sheet = book.sheet(st.active)
    const g = book.geometry(sheet)
    const sx = el.scrollLeft / st.view.zoom
    const sy = el.scrollTop / st.view.zoom
    const e = st.edit
    const refs = e ? refTokens(e.text) : []
    const ops = sheet.insertOps
    drawGrid(
      ctx,
      sheet,
      g.rows,
      g.cols,
      { width: size.w, height: size.h, scrollX: sx, scrollY: sy, zoom: st.view.zoom, dpr: window.devicePixelRatio || 1, hw: st.view.headings ? headerWidth(sheet.rows - 1) : 0, hh: st.view.headings ? HH : 0 },
      themeRef.current,
      {
        sel: sheet.sel,
        edit: e && e.sheet === sheet.id ? { r: e.r, c: e.c } : null,
        refs: e && (e.sheet === sheet.id || refs.some((t) => t.sheet)) ? refs.filter((t) => (t.sheet ? true : e.sheet === sheet.id)) : [],
        ants: st.ants && st.ants.sheet === sheet.id ? st.ants.range : null,
        antsPhase: antsPhase.current,
        fill: fillPreview,
        formulas: st.view.formulas,
        gridlines: st.view.gridlines,
        headings: st.view.headings,
        colLabel: columnLabels(sheet.designations, Math.min(sheet.cols, 2000)),
        sheetName: sheet.name.toLowerCase(),
        notes: new Set(Object.keys(ops.notes ?? {})),
        checks: new Set(Object.keys(ops.checkboxes ?? {})),
        drops: new Set(Object.keys(ops.dropdowns ?? {})),
        links: new Set(Object.keys(ops.links ?? {})),
      },
    )
    const layer = layerRef.current
    if (layer) layer.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px) scale(${st.view.zoom})`
  }, [book, size, fillPreview])

  const schedule = useCallback(() => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      draw()
    })
  }, [draw])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  // The canvas follows the scroller's size (and the screen's pixel ratio).
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(size.w * dpr))
    canvas.height = Math.max(1, Math.round(size.h * dpr))
    draw()
  }, [size, draw])

  useLayoutEffect(() => {
    draw()
  }, [draw, version, sel, edit, view, ants, active, object])

  // Each sheet keeps its scroll position.
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollLeft = sh.scroll.x
    el.scrollTop = sh.scroll.y
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Marching ants around the copied range.
  useEffect(() => {
    if (!ants) return
    const t = setInterval(() => {
      antsPhase.current = (antsPhase.current + 1) % 14
      schedule()
    }, 120)
    return () => clearInterval(t)
  }, [ants, schedule])

  // Ctrl + wheel zooms (needs a non-passive listener).
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const z = book.state.view.zoom
      const next = Math.min(4, Math.max(0.25, Math.round((z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)) * 100) / 100))
      if (next !== z) book.setView({ zoom: next })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [book])

  // A new window takes the keyboard at once.
  useEffect(() => {
    scrollerRef.current?.focus({ preventScroll: true })
  }, [])

  // The grid gets the keyboard back after dialogs and menus.
  useEffect(() => {
    book.refocus = () =>
      requestAnimationFrame(() => {
        if (!book.state.edit) scrollerRef.current?.focus({ preventScroll: true })
      })
    book.measure = (text, font) => {
      const ctx = canvasRef.current?.getContext('2d')
      return ctx ? measure(ctx, text, font) : text.length * 7
    }
  }, [book])

  const onScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    sh.scroll = { x: el.scrollLeft, y: el.scrollTop }
    draw()
    setTip(null)
  }

  // ------------------------------------------------- keeping cells in view

  const ensureVisible = useCallback(
    (r: number, c: number) => {
      const el = scrollerRef.current
      if (!el) return
      const z = book.state.view.zoom
      const s = { x: el.scrollLeft / z, y: el.scrollTop / z }
      const W = el.clientWidth / z
      const H = el.clientHeight / z
      if (c >= sh.freeze[1]) {
        const left = cols.pos(c)
        const right = cols.pos(c + 1)
        if (left - FW < s.x) el.scrollLeft = (left - FW) * z
        else if (right > s.x + W - hw) el.scrollLeft = Math.min(left - FW, right - (W - hw)) * z
      }
      if (r >= sh.freeze[0]) {
        const top = rows.pos(r)
        const bottom = rows.pos(r + 1)
        if (top - FH < s.y) el.scrollTop = (top - FH) * z
        else if (bottom > s.y + H - hh) el.scrollTop = Math.min(top - FH, bottom - (H - hh)) * z
      }
    },
    [book, sh, rows, cols, FW, FH, hw, hh],
  )

  // Keyboard moves keep the moving corner on screen.
  const lastSel = useRef(sel)
  useLayoutEffect(() => {
    const prev = lastSel.current
    lastSel.current = sel
    if (prev === sel || dragRef.current) return
    const g = sel.ranges[sel.ranges.length - 1]
    const r = sel.anchor.r === g.r1 ? g.r2 : g.r1
    const c = sel.anchor.c === g.c1 ? g.c2 : g.c1
    if (g.r2 - g.r1 > 5000 || g.c2 - g.c1 > 1000) return
    ensureVisible(sel.ranges.length === 1 && g.r1 === g.r2 && g.c1 === g.c2 ? sel.active.r : r, sel.ranges.length === 1 && g.r1 === g.r2 && g.c1 === g.c2 ? sel.active.c : c)
  }, [sel, ensureVisible])

  // ---------------------------------------------------------------- mouse

  const cellUnder = (lx: number, ly: number): Pos => ({ r: rowAt(ly), c: colAt(lx) })

  const dragTo = (clientX: number, clientY: number) => {
    const d = dragRef.current
    if (!d) return
    const { lx, ly } = local(clientX, clientY)
    if (d.kind === 'select') {
      const at = cellUnder(Math.max(hw, lx), Math.max(hh, ly))
      const g = expandMerges(normRange(d.anchor.r, d.anchor.c, at.r, at.c), sh.merges)
      const keep = d.add ? sh.sel.ranges.slice(0, -1) : []
      book.select({ ranges: [...keep, g], active: sh.sel.active, anchor: d.anchor })
    } else if (d.kind === 'cols') {
      const c = colAt(Math.max(hw, lx))
      const g = normRange(0, d.anchor, sh.rows - 1, c)
      const keep = d.add ? sh.sel.ranges.slice(0, -1) : []
      book.select({ ranges: [...keep, g], active: { r: 0, c: Math.min(d.anchor, c) }, anchor: { r: 0, c: d.anchor } })
    } else if (d.kind === 'rows') {
      const r = rowAt(Math.max(hh, ly))
      const g = normRange(d.anchor, 0, r, sh.cols - 1)
      const keep = d.add ? sh.sel.ranges.slice(0, -1) : []
      book.select({ ranges: [...keep, g], active: { r: Math.min(d.anchor, r), c: 0 }, anchor: { r: d.anchor, c: 0 } })
    } else if (d.kind === 'colsize') {
      const w = Math.max(0, Math.round(d.w0 + lx - d.x0))
      for (const c of d.cols) {
        if (w === 80) sh.colW.delete(c)
        else sh.colW.set(c, w)
      }
      sh.geomV++
      book.bump()
    } else if (d.kind === 'rowsize') {
      const h = Math.max(0, Math.round(d.h0 + ly - d.y0))
      for (const r of d.rows) {
        if (h === 20) sh.rowH.delete(r)
        else sh.rowH.set(r, h)
      }
      sh.geomV++
      book.bump()
    } else if (d.kind === 'fill') {
      const at = cellUnder(Math.max(hw, lx), Math.max(hh, ly))
      const t = fillTarget(sh, d.src, at.r, at.c)
      d.target = t
      setFillPreview(t.r1 === d.src.r1 && t.r2 === d.src.r2 && t.c1 === d.src.c1 && t.c2 === d.src.c2 ? null : t)
    } else if (d.kind === 'point') {
      const at = cellUnder(Math.max(hw, lx), Math.max(hh, ly))
      pointAt(book, d.anchor.r, d.anchor.c, at.r, at.c)
    }
  }

  const stopAutoScroll = () => {
    if (autoScroll.current) clearInterval(autoScroll.current)
    autoScroll.current = null
  }

  /** Scroll while a drag goes past the grid's edge. */
  const edgeScroll = (clientX: number, clientY: number) => {
    const el = scrollerRef.current
    const d = dragRef.current
    if (!el || !d || d.kind === 'colsize' || d.kind === 'rowsize') return
    const r = el.getBoundingClientRect()
    const dx = clientX < r.left + hw * zoom ? clientX - (r.left + hw * zoom) : clientX > r.right ? clientX - r.right : 0
    const dy = clientY < r.top + hh * zoom ? clientY - (r.top + hh * zoom) : clientY > r.bottom ? clientY - r.bottom : 0
    if (!dx && !dy) {
      stopAutoScroll()
      return
    }
    if (autoScroll.current) return
    autoScroll.current = setInterval(() => {
      const p = lastPointer.current
      if (!p || !dragRef.current) return stopAutoScroll()
      const rr = el.getBoundingClientRect()
      const ddx = p.x < rr.left + hw * zoom ? p.x - (rr.left + hw * zoom) : p.x > rr.right ? p.x - rr.right : 0
      const ddy = p.y < rr.top + hh * zoom ? p.y - (rr.top + hh * zoom) : p.y > rr.bottom ? p.y - rr.bottom : 0
      if (!ddx && !ddy) return stopAutoScroll()
      el.scrollLeft += Math.sign(ddx) * Math.min(60, Math.abs(ddx) * 0.6 + 6)
      el.scrollTop += Math.sign(ddy) * Math.min(60, Math.abs(ddy) * 0.6 + 6)
      dragTo(p.x, p.y)
    }, 40)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    setTip(null)
    if (e.button === 2) return
    if (e.button !== 0) return
    const { lx, ly } = local(e.clientX, e.clientY)
    const shift = e.shiftKey
    const add = MAC ? e.metaKey : e.ctrlKey
    const s = scroll()
    const st = book.state
    if (st.object) book.set({ object: null })
    const capture = () => {
      e.currentTarget.setPointerCapture(e.pointerId)
      lastPointer.current = { x: e.clientX, y: e.clientY }
    }
    // Corner: select everything.
    if (lx < hw && ly < hh) {
      if (st.edit) book.commitEdit()
      book.selectAll()
      return
    }
    // Column headers: resize at an edge, else select columns.
    if (ly < hh) {
      const c = colAt(lx)
      const right = colX(c + 1, s.x)
      const left = colX(c, s.x)
      const edgeCol = Math.abs(lx - right) <= 4 ? c : Math.abs(lx - left) <= 4 && c > 0 ? c - 1 : -1
      if (edgeCol >= 0) {
        const chosen = inSelection(sh.sel, 0, edgeCol) && sh.sel.ranges.some((g) => g.r1 === 0 && g.r2 >= sh.rows - 1) ? selectedCols(book) : [edgeCol]
        dragRef.current = { kind: 'colsize', col: edgeCol, x0: lx, w0: cols.size(edgeCol), cols: chosen, before: snapLayout(sh) }
        capture()
        return
      }
      if (st.edit) book.commitEdit()
      if (shift) book.selectCols(sh.sel.anchor.c, c)
      else book.selectCols(c, c, add)
      dragRef.current = { kind: 'cols', anchor: shift ? sh.sel.anchor.c : c, add }
      capture()
      return
    }
    if (lx < hw) {
      const r = rowAt(ly)
      const bottom = rowY(r + 1, s.y)
      const top = rowY(r, s.y)
      const edgeRow = Math.abs(ly - bottom) <= 3 ? r : Math.abs(ly - top) <= 3 && r > 0 ? r - 1 : -1
      if (edgeRow >= 0) {
        const chosen = inSelection(sh.sel, edgeRow, 0) && sh.sel.ranges.some((g) => g.c1 === 0 && g.c2 >= sh.cols - 1) ? selectedRows(book) : [edgeRow]
        dragRef.current = { kind: 'rowsize', row: edgeRow, y0: ly, h0: rows.size(edgeRow), rows: chosen, before: snapLayout(sh) }
        capture()
        return
      }
      if (st.edit) book.commitEdit()
      if (shift) book.selectRows(sh.sel.anchor.r, r)
      else book.selectRows(r, r, add)
      dragRef.current = { kind: 'rows', anchor: shift ? sh.sel.anchor.r : r, add }
      capture()
      return
    }
    const at = cellUnder(lx, ly)
    // Typing a formula: a click inserts the cell's reference.
    if (st.edit && pointing(book) && !(st.edit.sheet === sh.id && at.r === st.edit.r && at.c === st.edit.c)) {
      e.preventDefault()
      pointAt(book, at.r, at.c)
      dragRef.current = { kind: 'point', anchor: at }
      capture()
      return
    }
    if (st.edit) book.commitEdit()
    // The fill handle.
    const last = sh.sel.ranges[sh.sel.ranges.length - 1]
    const hx = colX(last.c2 + 1, s.x)
    const hy = rowY(last.r2 + 1, s.y)
    if (Math.abs(lx - hx) <= 5 && Math.abs(ly - hy) <= 5) {
      dragRef.current = { kind: 'fill', src: last, target: last }
      capture()
      return
    }
    // Filter buttons, checkboxes, drop-downs, links.
    const f = sh.filter
    if (f && at.r === f.range.r1 && at.c >= f.range.c1 && at.c <= f.range.c2 && lx >= colX(at.c + 1, s.x) - 20) {
      book.selectCell(at.r, at.c)
      actions.filterMenu(at.c, e)
      return
    }
    if (isCheckbox(sh, at.r, at.c) && lx - colX(at.c, s.x) <= 20 && !shift && !add) {
      book.selectCell(at.r, at.c)
      void toggleCheckbox(book, at.r, at.c)
      return
    }
    const items = dropdownOf(sh, at.r, at.c)
    if (items && lx >= colX(at.c + 1, s.x) - 16 && !shift && !add) {
      book.selectCell(at.r, at.c)
      os.contextMenu(e, items.map((v) => ({ label: v || '(empty)', onClick: () => void book.setCells(sh, [[at.r, at.c, v]], 'Dropdown') })))
      return
    }
    const url = linkOf(sh, at.r, at.c)
    if (url && (e.metaKey || e.ctrlKey)) {
      os.open('browser', { url })
      return
    }
    if (shift) book.selectCell(at.r, at.c, true)
    else if (add) {
      const m = mergeAt(sh.merges, at.r, at.c)
      const g = m ? mergeRange(m) : { r1: at.r, c1: at.c, r2: at.r, c2: at.c }
      book.select({ ranges: [...sh.sel.ranges, g], active: at, anchor: at })
    } else book.selectCell(at.r, at.c)
    dragRef.current = { kind: 'select', anchor: shift ? sh.sel.anchor : { r: sh.sel.active.r, c: sh.sel.active.c }, add }
    capture()
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (dragRef.current) {
      lastPointer.current = { x: e.clientX, y: e.clientY }
      dragTo(e.clientX, e.clientY)
      edgeScroll(e.clientX, e.clientY)
      return
    }
    // Cursor and note tooltips.
    const { lx, ly } = local(e.clientX, e.clientY)
    const s = scroll()
    let cursor = 'cell'
    if (ly < hh && lx >= hw) {
      const c = colAt(lx)
      cursor = Math.abs(lx - colX(c + 1, s.x)) <= 4 || (Math.abs(lx - colX(c, s.x)) <= 4 && c > 0) ? 'col-resize' : 's-resize'
    } else if (lx < hw && ly >= hh) {
      const r = rowAt(ly)
      cursor = Math.abs(ly - rowY(r + 1, s.y)) <= 3 || (Math.abs(ly - rowY(r, s.y)) <= 3 && r > 0) ? 'row-resize' : 'e-resize'
    } else if (lx >= hw && ly >= hh) {
      const last = sh.sel.ranges[sh.sel.ranges.length - 1]
      if (Math.abs(lx - colX(last.c2 + 1, s.x)) <= 5 && Math.abs(ly - rowY(last.r2 + 1, s.y)) <= 5) cursor = 'crosshair'
      const at = cellUnder(lx, ly)
      if (linkOf(sh, at.r, at.c)) cursor = 'pointer'
      const note = noteText(sh, at.r, at.c)
      if (tipTimer.current) clearTimeout(tipTimer.current)
      if (note) {
        const x = colX(at.c + 1, s.x) * zoom + 4
        const y = rowY(at.r, s.y) * zoom
        tipTimer.current = setTimeout(() => setTip({ x, y, text: note }), 350)
      } else if (tip) setTip(null)
    } else cursor = 'default'
    canvas.style.cursor = cursor
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current
    dragRef.current = null
    stopAutoScroll()
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!d) return
    if (d.kind === 'colsize' || d.kind === 'rowsize') {
      const before = d.before
      const after = snapLayout(sh)
      const changed = d.kind === 'colsize' ? cols.size(d.col) !== d.w0 : rows.size(d.row) !== d.h0
      if (changed)
        book.record({
          label: d.kind === 'colsize' ? 'Column Width' : 'Row Height',
          sheet: sh.id,
          selBefore: sh.sel,
          selAfter: sh.sel,
          undo: async () => restoreLayout(book, sh, before),
          redo: async () => restoreLayout(book, sh, after),
        })
    } else if (d.kind === 'fill') {
      setFillPreview(null)
      const t = d.target
      if (t.r1 !== d.src.r1 || t.r2 !== d.src.r2 || t.c1 !== d.src.c1 || t.c2 !== d.src.c2) void fillRange(book, d.src, t)
    } else if (d.kind === 'point') {
      // Keep typing the formula.
      return
    }
    book.refocus()
  }

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { lx, ly } = local(e.clientX, e.clientY)
    const s = scroll()
    if (ly < hh && lx >= hw) {
      const c = colAt(lx)
      const edgeCol = Math.abs(lx - colX(c + 1, s.x)) <= 4 ? c : Math.abs(lx - colX(c, s.x)) <= 4 && c > 0 ? c - 1 : -1
      if (edgeCol >= 0) {
        // Undo the two clicks' resize step if one was recorded, then fit.
        autoFitCols(book, inSelection(sh.sel, 0, edgeCol) ? selectedCols(book) : [edgeCol], (sheet, k) => cellFont(sheet.formats.get(k), themeRef.current?.font ?? 'sans-serif'))
      }
      return
    }
    if (lx < hw || ly < hh) return
    const last = sh.sel.ranges[sh.sel.ranges.length - 1]
    if (Math.abs(lx - colX(last.c2 + 1, s.x)) <= 5 && Math.abs(ly - rowY(last.r2 + 1, s.y)) <= 5) {
      autoFill(book)
      return
    }
    const at = cellUnder(lx, ly)
    if (isCheckbox(sh, at.r, at.c)) return
    book.selectCell(at.r, at.c)
    book.startEdit()
  }

  // --------------------------------------------------------- context menus

  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const { lx, ly } = local(e.clientX, e.clientY)
    if (book.state.edit) book.commitEdit()
    const mod = MAC ? '⌘' : 'Ctrl+'
    const clipboard: MenuItem[] = [
      { label: 'Cut', shortcut: `${mod}X`, onClick: () => cutToClipboard() },
      { label: 'Copy', shortcut: `${mod}C`, onClick: () => copyToClipboard() },
      { label: 'Paste', shortcut: `${mod}V`, onClick: () => void pasteFromClipboard(false) },
      { label: 'Paste Values Only', onClick: () => void pasteFromClipboard(true) },
    ]
    if (ly < hh && lx >= hw) {
      const c = colAt(lx)
      if (!inSelection(sh.sel, 0, c) || !sh.sel.ranges.some((g) => g.r1 === 0 && g.r2 >= sh.rows - 1)) book.selectCols(c, c)
      os.contextMenu(e, [
        ...clipboard,
        '-',
        { label: 'Insert Columns Left', onClick: () => insertCols(book) },
        { label: 'Insert Columns Right', onClick: () => insertCols(book, true) },
        { label: 'Delete Columns', onClick: () => deleteCols(book) },
        { label: 'Clear Contents', onClick: () => void clearContents(book) },
        '-',
        { label: 'Column Width…', onClick: actions.colWidth },
        { label: 'AutoFit Column Width', onClick: () => autoFitCols(book, selectedCols(book), (sheet, k) => cellFont(sheet.formats.get(k), themeRef.current?.font ?? 'sans-serif')) },
        '-',
        { label: 'Sort A → Z', onClick: () => quickSort(book, true) },
        { label: 'Sort Z → A', onClick: () => quickSort(book, false) },
      ])
      return
    }
    if (lx < hw && ly >= hh) {
      const r = rowAt(ly)
      if (!inSelection(sh.sel, r, 0) || !sh.sel.ranges.some((g) => g.c1 === 0 && g.c2 >= sh.cols - 1)) book.selectRows(r, r)
      os.contextMenu(e, [
        ...clipboard,
        '-',
        { label: 'Insert Rows Above', onClick: () => insertRows(book) },
        { label: 'Insert Rows Below', onClick: () => insertRows(book, true) },
        { label: 'Delete Rows', onClick: () => deleteRows(book) },
        { label: 'Clear Contents', onClick: () => void clearContents(book) },
        '-',
        { label: 'Row Height…', onClick: actions.rowHeight },
      ])
      return
    }
    if (lx < hw || ly < hh) return
    const at = cellUnder(lx, ly)
    if (!inSelection(sh.sel, at.r, at.c)) book.selectCell(at.r, at.c)
    const cell = sh.cells.get(key(at.r, at.c))
    const note = noteText(sh, at.r, at.c)
    const py = sh.py.get(key(at.r, at.c))
    const items: MenuItem[] = [
      ...clipboard,
      '-',
      {
        label: 'Insert',
        submenu: [
          { label: 'Rows Above', onClick: () => insertRows(book) },
          { label: 'Rows Below', onClick: () => insertRows(book, true) },
          { label: 'Columns Left', onClick: () => insertCols(book) },
          { label: 'Columns Right', onClick: () => insertCols(book, true) },
        ],
      },
      {
        label: 'Delete',
        submenu: [
          { label: 'Rows', onClick: () => deleteRows(book) },
          { label: 'Columns', onClick: () => deleteCols(book) },
        ],
      },
      { label: 'Clear Contents', shortcut: 'Del', onClick: () => void clearContents(book) },
      '-',
      { label: 'Format Cells…', shortcut: `${mod}1`, onClick: actions.formatCells },
      { label: note ? 'Edit Note…' : 'Insert Note…', onClick: () => actions.editNote(at.r, at.c) },
      { label: 'Link…', onClick: actions.link },
      '-',
      { label: 'Sort A → Z', onClick: () => quickSort(book, true) },
      { label: 'Sort Z → A', onClick: () => quickSort(book, false) },
      { label: 'Insert Chart', submenu: CHART_TYPES.map((t) => ({ label: t, onClick: () => insertChart(book, t) })) },
    ]
    if (cell && /^\s*=PY(\s|$)/i.test(cell.s)) {
      items.push('-', { label: 'Python Output…', disabled: !py?.err && !py?.out, onClick: () => actions.showPython(at.r, at.c) })
      items.push({ label: 'Run This Cell Again', onClick: () => void book.recalc([sh.name, at.r, at.c]) })
    }
    os.contextMenu(e, items)
  }

  // ------------------------------------------------------------- clipboard

  const copyToClipboard = () => {
    const text = copySelection(book)
    if (text !== null) void navigator.clipboard?.writeText(text).catch(() => {})
  }
  const cutToClipboard = () => {
    const text = copySelection(book, true)
    if (text !== null) void navigator.clipboard?.writeText(text).catch(() => {})
  }
  const pasteFromClipboard = async (values: boolean) => {
    let text: string | null = null
    try {
      text = await navigator.clipboard.readText()
    } catch {
      text = getClip()?.text ?? null
    }
    if (text) await pasteText(book, text, values)
  }

  // --------------------------------------------------------------- keyboard

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (book.state.edit) return
    const mod = e.metaKey || e.ctrlKey
    const k = e.key
    const run = (fn: () => void) => {
      e.preventDefault()
      e.stopPropagation()
      fn()
    }
    const obj = book.state.object
    if (obj) {
      if (k === 'Delete' || k === 'Backspace') return run(() => actions.objectMenu(obj, { clientX: -1, clientY: -1 }))
      if (k === 'Escape') return run(() => book.set({ object: null }))
    }
    const st = book.state
    const pageRows = Math.max(1, Math.floor((scrollerRef.current?.clientHeight ?? 400) / zoom / 20) - 2)
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (arrows[k] && !e.altKey) {
      const [dr, dc] = arrows[k]
      return run(() => (mod ? book.jump(dr, dc, e.shiftKey) : book.move(dr, dc, e.shiftKey)))
    }
    if (k === 'Enter' && !mod) return run(() => book.move(e.shiftKey ? -1 : 1, 0))
    if (k === 'Tab') return run(() => book.move(0, e.shiftKey ? -1 : 1))
    if (k === 'PageDown' || k === 'PageUp') return run(() => book.move(k === 'PageDown' ? pageRows : -pageRows, 0, e.shiftKey))
    if (k === 'Home') {
      return run(() => {
        if (mod) book.selectCell(0, 0, e.shiftKey)
        else book.selectCell(sh.sel.active.r, 0, e.shiftKey)
      })
    }
    if (k === 'End' && mod) {
      return run(() => {
        const u = usedExtent(sh)
        book.selectCell(Math.max(0, u.rows), Math.max(0, u.cols), e.shiftKey)
      })
    }
    if (k === 'F2') return run(() => book.startEdit())
    if (k === 'Delete' || k === 'Backspace') return run(() => void clearContents(book))
    if (k === 'Escape') return run(() => st.ants && book.set({ ants: null }))
    if (k === 'F9') return run(() => void book.recalc(true))
    if (k === ' ' && mod && !e.shiftKey) return run(() => book.selectCols(sh.sel.ranges[0].c1, sh.sel.ranges[0].c2))
    if (k === ' ' && e.shiftKey && !mod) return run(() => book.selectRows(sh.sel.ranges[0].r1, sh.sel.ranges[0].r2))
    if (mod && !e.altKey) {
      const lower = k.toLowerCase()
      const plain: Record<string, () => void> = {
        a: () => book.selectAll(),
        b: () => toggleFlag(book, 'bold', 'Bold'),
        i: () => toggleFlag(book, 'italic', 'Italic'),
        u: () => toggleFlag(book, 'underline', 'Underline'),
        d: () => fillDownRight(book, true),
        r: () => fillDownRight(book, false),
        '1': actions.formatCells,
        '`': () => book.setView({ formulas: !book.state.view.formulas }),
      }
      if (!e.shiftKey && plain[lower]) return run(plain[lower])
    }
    if (k.length === 1 && !mod && !e.altKey) {
      e.preventDefault()
      e.stopPropagation()
      book.startEdit(k)
    }
  }

  // ------------------------------------------------------------ the editor

  const e = edit && edit.sheet === sh.id ? edit : null
  let editorRect: { left: number; top: number; width: number; height: number } | null = null
  let editorFont = ''
  let editorBg = ''
  if (e) {
    const m = mergeAt(sh.merges, e.r, e.c)
    const g = m ? mergeRange(m) : { r1: e.r, c1: e.c, r2: e.r, c2: e.c }
    editorRect = { left: cols.pos(g.c1), top: rows.pos(g.r1), width: cols.pos(g.c2 + 1) - cols.pos(g.c1), height: rows.pos(g.r2 + 1) - rows.pos(g.r1) }
    const f = sh.formats.get(key(e.r, e.c))
    const th = themeRef.current
    editorFont = cellFont(f, th?.font ?? 'sans-serif')
    editorBg = adaptFill(f?.bg) ?? th?.bg ?? '#0d0f0e'
  }

  const totalW = (hw + cols.total()) * zoom
  const totalH = (hh + rows.total()) * zoom

  return (
    <div className="ks-grid" ref={hostRef}>
      <div
        className="ks-scroller"
        ref={scrollerRef}
        tabIndex={0}
        role="grid"
        aria-label={`Sheet ${sh.name}, cell ${a1(sel.active.r, sel.active.c)}`}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        onCopy={(ev) => {
          if (book.state.edit) return
          const text = copySelection(book)
          if (text === null) return
          ev.preventDefault()
          ev.clipboardData.setData('text/plain', text)
        }}
        onCut={(ev) => {
          if (book.state.edit) return
          const text = copySelection(book, true)
          if (text === null) return
          ev.preventDefault()
          ev.clipboardData.setData('text/plain', text)
        }}
        onPaste={(ev) => {
          if (book.state.edit) return
          ev.preventDefault()
          const text = ev.clipboardData.getData('text/plain')
          if (text) void pasteText(book, text)
        }}
      >
        <div className="ks-spacer" style={{ width: Math.max(totalW, size.w), height: Math.max(totalH, size.h) }}>
          <div className="ks-stage" style={{ width: size.w, height: size.h }}>
            <canvas
              ref={canvasRef}
              className="ks-canvas"
              style={{ width: size.w, height: size.h }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => {
                if (tipTimer.current) clearTimeout(tipTimer.current)
              }}
              onDoubleClick={onDoubleClick}
              onContextMenu={onContextMenu}
            />
            <div className="ks-layer-clip" style={{ left: hw * zoom, top: hh * zoom }}>
              <div className="ks-layer" ref={layerRef}>
                <Floating book={book} sheet={sh} rows={rows} cols={cols} zoom={zoom} selected={object} actions={actions} />
                {e && editorRect && (
                  <CellEditor book={book} rect={editorRect} font={editorFont} color={themeRef.current?.text ?? '#fff'} background={editorBg} zoom={zoom} />
                )}
              </div>
            </div>
            {tip && (
              <div className="ks-note-tip" style={{ left: tip.x, top: tip.y }}>
                {tip.text}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
