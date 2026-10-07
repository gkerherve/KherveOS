// The 2D Sketch tab — the desktop's Editor2D (editor2d.py): a skeletal
// formula editor on a ±2000 sheet with scroll bars and wheel zoom. Tools:
// Draw (drag atom→atom or atom→empty for a bonded atom snapped to 30°; click
// empty space for a lone atom; click a bond to cycle its order), Move (drag a
// whole fragment), Atom (re-label), Erase. Valence is enforced. Show as:
// skeletal / structural / Lewis / condensed.

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { color as cpk, valence, PALETTE } from './elements'
import { ElementChip } from './icons'
import { darker, dotPositions, hillFormula, lightnessF, MODES, MODE_LABELS, showsAllLabels, type Mode } from './molrepr'
import { paintSpecs, renderSpecsImage, type Spec } from './specs'
import type { MolApp, Tool } from './app'
import type { Atom2D, Bond, Sketch } from './types'
import { DND_MIME } from './Viewer3D'
import { sketchMenu } from './contextMenus'

const HIT = 15
const BOND_LEN = 46
const BOND_LW = 2.3
const MULTI_GAP = 4.5
const LABEL_R = 10
const DOT_R = 1.6
const DOT_SPREAD = 2.6
const SHEET = 2000

function degree(bonds: readonly Bond[], idx: number) {
  return bonds.reduce((n, [i, j]) => n + (i === idx || j === idx ? 1 : 0), 0)
}

function labeled(sk: Sketch, idx: number, showAll: boolean): boolean {
  const el = sk.atoms[idx][0]
  if (showAll) return true
  if (el === 'C' || el === 'H') return degree(sk.bonds, idx) === 0
  return true
}

/** Editor2D._Canvas.redraw as shape specs (also what PNG export rasterises). */
export function sketchSpecs(sk: Sketch, mode: Mode, showLabels: boolean): Spec[] {
  const { atoms, bonds } = sk
  if (mode === 'condensed') {
    if (!atoms.length) return []
    return [{ shape: 'text', text: hillFormula(atoms, bonds), x: 0, y: 0, size: 28, bold: true, anchor: 'center', stroke: '#1a1a1a' }]
  }
  const showAll = showLabels || showsAllLabels(mode)
  const out: Spec[] = []
  for (const [i, j, order] of bonds) {
    if (!showAll && (atoms[i][0] === 'H' || atoms[j][0] === 'H')) continue
    const a = atoms[i], b = atoms[j]
    const gi = labeled(sk, i, showAll) ? LABEL_R + 3 : 0
    const gj = labeled(sk, j, showAll) ? LABEL_R + 3 : 0
    const dx = b[1] - a[1], dy = b[2] - a[2]
    const length = Math.hypot(dx, dy) || 1
    const ux = dx / length, uy = dy / length
    const px = -uy, py = ux
    const sx = a[1] + ux * gi, sy = a[2] + uy * gi, ex = b[1] - ux * gj, ey = b[2] - uy * gj
    const offs = ({ 1: [0], 2: [-1, 1], 3: [-1, 0, 1] } as Record<number, number[]>)[order] ?? [0]
    for (const o of offs) {
      const ox = px * o * MULTI_GAP, oy = py * o * MULTI_GAP
      out.push({ shape: 'line', x1: sx + ox, y1: sy + oy, x2: ex + ox, y2: ey + oy, stroke: '#1b1b1b', width: BOND_LW })
    }
  }
  const halos: Spec[] = [], texts: Spec[] = [], dots: Spec[] = []
  atoms.forEach(([el, x, y], idx) => {
    if (!showAll && el === 'H' && degree(bonds, idx) > 0) return
    if (labeled(sk, idx, showAll)) {
      halos.push({ shape: 'circle', x: x - LABEL_R, y: y - LABEL_R, w: 2 * LABEL_R, h: 2 * LABEL_R, fill: '#ffffff', stroke: 'none' })
      const c = cpk(el)
      texts.push({ shape: 'text', text: el, x, y, size: 12, bold: true, anchor: 'center', stroke: lightnessF(c) < 0.75 ? c : darker(c, 160) })
    }
    if (mode === 'lewis') {
      for (const [dx, dy] of dotPositions(idx, atoms, bonds, LABEL_R + DOT_R * 2.2, DOT_SPREAD))
        dots.push({ shape: 'circle', x: dx - DOT_R, y: dy - DOT_R, w: 2 * DOT_R, h: 2 * DOT_R, fill: '#1a1a1a', stroke: 'none' })
    }
  })
  return [...out, ...halos, ...texts, ...dots]
}

function pointSegDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1)
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

export function Editor2D({ app }: { app: MolApp }) {
  const s = useStore(
    app.store,
    useShallow((st) => ({
      sketch: st.sketch, mode: st.mode, showLabels2d: st.showLabels2d, tool: st.tool, element2d: st.element2d, sketchStatus: st.sketchStatus,
      sketchSerial: st.sketchSerial, tab: st.tab,
    })),
  )
  const sk = s.sketch
  const editable = s.mode === 'skeletal' || s.mode === 'structural'
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [k, setK] = useState(1)
  const [view, setView] = useState({ w: 400, h: 300, sl: 0, st: 0 })
  const [preview, setPreview] = useState<[number, number, number, number] | null>(null)
  const press = useRef<{ x: number; y: number; dragFrom: number | null; moving: number | null; comp: Set<number>; last: [number, number] } | null>(null)
  const working = useRef<Sketch | null>(null)

  const specs = useMemo(() => sketchSpecs(sk, s.mode, s.showLabels2d), [sk, s.mode, s.showLabels2d])

  // ---------------------------------------------------- sheet geometry
  const sheet = 2 * SHEET * k
  const offX = Math.max(0, (view.w - sheet) / 2), offY = Math.max(0, (view.h - sheet) / 2)
  const toScreen = useCallback((x: number, y: number) => [(x + SHEET) * k + offX - view.sl, (y + SHEET) * k + offY - view.st] as const, [k, offX, offY, view])
  const toScene = useCallback((sx: number, sy: number) => [(sx + view.sl - offX) / k - SHEET, (sy + view.st - offY) / k - SHEET] as const, [k, offX, offY, view])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => setView({ w: el.clientWidth, h: el.clientHeight, sl: el.scrollLeft, st: el.scrollTop })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    el.addEventListener('scroll', update)
    update()
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [])

  /** centerOn(scene point). */
  const centerOn = useCallback(
    (x: number, y: number, kk = k) => {
      const el = scrollRef.current
      if (!el) return
      const sh = 2 * SHEET * kk
      const ox = Math.max(0, (el.clientWidth - sh) / 2), oy = Math.max(0, (el.clientHeight - sh) / 2)
      el.scrollLeft = (x + SHEET) * kk + ox - el.clientWidth / 2
      el.scrollTop = (y + SHEET) * kk + oy - el.clientHeight / 2
    },
    [k],
  )

  /** center_on_content: scroll to whatever is drawn (on load, on a change to/from condensed). */
  useEffect(() => {
    const el = scrollRef.current
    const cv = canvasRef.current
    if (!el || !cv) return
    const id = requestAnimationFrame(() => {
      const items = sketchSpecs(app.get().sketch, app.get().mode, app.get().showLabels2d)
      if (!items.length) return
      const ctx = cv.getContext('2d')!
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const sp of items) {
        const pts = sp.shape === 'line' ? [[sp.x1!, sp.y1!], [sp.x2!, sp.y2!]] : sp.shape === 'circle' ? [[sp.x!, sp.y!], [sp.x! + sp.w!, sp.y! + sp.h!]] : [[sp.x!, sp.y!]]
        for (const [px, py] of pts) {
          x0 = Math.min(x0, px)
          y0 = Math.min(y0, py)
          x1 = Math.max(x1, px)
          y1 = Math.max(y1, py)
        }
      }
      void ctx
      centerOn((x0 + x1) / 2, (y0 + y1) / 2)
    })
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.sketchSerial, s.tab])

  // ------------------------------------------------------------- paint
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(view.w * dpr)
    cv.height = Math.round(view.h * dpr)
    cv.style.width = `${view.w}px`
    cv.style.height = `${view.h}px`
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, view.w, view.h)
    const [ox, oy] = toScreen(0, 0)
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy)
    paintSpecs(ctx, specs)
    if (preview) {
      ctx.setLineDash([6, 6])
      ctx.strokeStyle = '#9aa0a6'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(preview[0], preview[1])
      ctx.lineTo(preview[2], preview[3])
      ctx.stroke()
      ctx.setLineDash([])
    }
  }, [specs, view, k, toScreen, preview])

  useEffect(() => {
    app.sketchImage = (w, h) => renderSpecsImage(sketchSpecs(app.get().sketch, app.get().mode, app.get().showLabels2d), w, h)
    return () => {
      app.sketchImage = null
    }
  }, [app])

  // ------------------------------------------------------------- tools
  const atomAt = (g: Sketch, x: number, y: number): number | null => {
    let best: number | null = null, bd = HIT
    g.atoms.forEach((a, i) => {
      const d = Math.hypot(a[1] - x, a[2] - y)
      if (d < bd) {
        best = i
        bd = d
      }
    })
    return best
  }
  const bondAt = (g: Sketch, x: number, y: number): number | null => {
    let best: number | null = null, bd = 8
    g.bonds.forEach(([i, j], bi) => {
      const d = pointSegDist(x, y, g.atoms[i][1], g.atoms[i][2], g.atoms[j][1], g.atoms[j][2])
      if (d < bd) {
        best = bi
        bd = d
      }
    })
    return best
  }
  const used = (g: Sketch, idx: number) => g.bonds.reduce((n, [a, b, o]) => n + (a === idx || b === idx ? o : 0), 0)
  const free = (g: Sketch, idx: number) => valence(g.atoms[idx][0]) - used(g, idx)
  const capacity = (g: Sketch, i: number, j: number, current: number) =>
    Math.max(1, Math.min(3, valence(g.atoms[i][0]) - (used(g, i) - current), valence(g.atoms[j][0]) - (used(g, j) - current)))
  const note = (g: Sketch, idx: number) => {
    const el = g.atoms[idx][0]
    app.set({ sketchStatus: `${el} is already at its maximum bonds (valence ${valence(el)}) — bond not allowed.` })
  }
  const component = (g: Sketch, idx: number): Set<number> => {
    const comp = new Set([idx]), stack = [idx]
    while (stack.length) {
      const c = stack.pop()!
      for (const [a, b] of g.bonds) {
        const n = a === c ? b : b === c ? a : null
        if (n !== null && !comp.has(n)) {
          comp.add(n)
          stack.push(n)
        }
      }
    }
    return comp
  }
  const clone = (g: Sketch): Sketch => ({ atoms: g.atoms.map((a) => [...a] as Atom2D), bonds: g.bonds.map((b) => [...b] as Bond) })

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || !editable) return
    const r = e.currentTarget.getBoundingClientRect()
    const [x, y] = toScene(e.clientX - r.left, e.clientY - r.top)
    e.currentTarget.setPointerCapture(e.pointerId)
    const g = clone(app.get().sketch)
    const tool: Tool = app.get().tool
    const ai = atomAt(g, x, y)
    press.current = { x, y, dragFrom: null, moving: null, comp: new Set(), last: [x, y] }
    if (tool === 'move') {
      press.current.moving = ai
      press.current.comp = ai !== null ? component(g, ai) : new Set()
      working.current = g
    } else if (tool === 'atom') {
      if (ai !== null) g.atoms[ai][0] = app.get().element2d
      else g.atoms.push([app.get().element2d, x, y])
      app.editSketch(g)
      press.current = null
    } else if (tool === 'erase') {
      if (ai !== null) {
        g.atoms.splice(ai, 1)
        g.bonds = g.bonds.filter(([i, j]) => i !== ai && j !== ai).map(([i, j, o]) => [i - (i > ai ? 1 : 0), j - (j > ai ? 1 : 0), o])
        app.editSketch(g)
      } else {
        const bi = bondAt(g, x, y)
        if (bi !== null) {
          g.bonds.splice(bi, 1)
          app.editSketch(g)
        }
      }
      press.current = null
    } else if (tool === 'draw') {
      if (ai !== null) press.current.dragFrom = ai
      else {
        g.atoms.push([app.get().element2d, x, y])
        press.current.dragFrom = g.atoms.length - 1
        app.set({ sketch: g })
      }
      working.current = g
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = press.current
    if (!p) return
    const r = e.currentTarget.getBoundingClientRect()
    const [x, y] = toScene(e.clientX - r.left, e.clientY - r.top)
    const g = working.current
    if (!g) return
    if (p.moving !== null) {
      const dx = x - p.last[0], dy = y - p.last[1]
      for (const i of p.comp) {
        g.atoms[i][1] += dx
        g.atoms[i][2] += dy
      }
      p.last = [x, y]
      app.set({ sketch: clone(g) })
    } else if (p.dragFrom !== null) {
      const a = g.atoms[p.dragFrom]
      setPreview([a[1], a[2], x, y])
    }
  }

  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = press.current
    press.current = null
    setPreview(null)
    const g = working.current
    working.current = null
    if (!p || !g) return
    const r = e.currentTarget.getBoundingClientRect()
    const [x, y] = toScene(e.clientX - r.left, e.clientY - r.top)
    if (p.moving !== null) {
      app.editSketch(g)
      return
    }
    if (p.dragFrom === null) return
    const src = p.dragFrom
    let tgt = atomAt(g, x, y)
    const moved = Math.abs(x - p.x) + Math.abs(y - p.y) > 6
    if (tgt === null && moved) {
      if (free(g, src) >= 1) {
        const a = g.atoms[src]
        const dx = x - a[1], dy = y - a[2]
        let ang = dx || dy ? Math.atan2(dy, dx) : 0
        const step = Math.PI / 6
        ang = Math.round(ang / step) * step
        g.atoms.push([app.get().element2d, a[1] + BOND_LEN * Math.cos(ang), a[2] + BOND_LEN * Math.sin(ang)])
        tgt = g.atoms.length - 1
      } else note(g, src)
    }
    if (tgt !== null && tgt !== src) {
      const existing = g.bonds.find((b) => (b[0] === src && b[1] === tgt) || (b[0] === tgt && b[1] === src))
      if (existing) {
        const cap = capacity(g, src, tgt, existing[2])
        existing[2] = existing[2] < cap ? existing[2] + 1 : 1
      } else if (free(g, src) >= 1 && free(g, tgt) >= 1) g.bonds.push([src, tgt, 1])
      else note(g, free(g, src) < 1 ? src : tgt)
    } else if (tgt === src && !moved) {
      const bi = bondAt(g, x, y)
      if (bi !== null) {
        const b = g.bonds[bi]
        const cap = capacity(g, b[0], b[1], b[2])
        b[2] = b[2] < cap ? b[2] + 1 : 1
      }
    }
    const status = app.get().sketchStatus
    app.editSketch(g)
    if (status.includes('maximum bonds')) app.set({ sketchStatus: status })
  }

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = scrollRef.current!
    const [cx, cy] = toScene(el.clientWidth / 2, el.clientHeight / 2)
    const nk = Math.max(0.05, Math.min(40, k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
    setK(nk)
    requestAnimationFrame(() => centerOn(cx, cy, nk))
  }
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const block = (ev: globalThis.WheelEvent) => ev.preventDefault()
    el.addEventListener('wheel', block, { passive: false })
    return () => el.removeEventListener('wheel', block)
  }, [])

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    sketchMenu(app, e.clientX, e.clientY)
  }

  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(DND_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }
  const onDrop = (e: DragEvent) => {
    const raw = e.dataTransfer.getData(DND_MIME)
    if (!raw) return
    e.preventDefault()
    const r = scrollRef.current!.getBoundingClientRect()
    const [x, y] = toScene(e.clientX - r.left, e.clientY - r.top)
    const [kind, ...rest] = raw.split('|')
    void app.dropMolecule2d(kind, rest.join('|'), x, y)
  }

  const tools: [Tool, string][] = [['draw', 'Draw'], ['move', 'Move'], ['atom', 'Atom'], ['erase', 'Erase']]
  const elements = PALETTE.includes(s.element2d) ? PALETTE : [...PALETTE, s.element2d]

  return (
    <div className="km-sketch">
      <div className="km-row">
        {tools.map(([key, label]) => (
          <button key={key} className={`km-flat km-toggle${s.tool === key ? ' on' : ''}`} disabled={!editable} onClick={() => app.set({ tool: key })}>
            {label}
          </button>
        ))}
        <span className="km-gap" />
        <span className="km-label">Element:</span>
        <ElementCombo value={s.element2d} items={elements} disabled={!editable} onChange={(el) => app.set({ element2d: el })} />
        <button className={`km-flat km-toggle${s.showLabels2d ? ' on' : ''}`} onClick={() => app.set({ showLabels2d: !s.showLabels2d })}>
          All labels
        </button>
        <span className="km-gap" />
        <span className="km-label">Show as:</span>
        <select
          className="km-combo"
          value={s.mode}
          title="How to draw the structure — skeletal, every atom lettered, a Lewis structure with lone pairs, or just the formula"
          onChange={(e) => app.setMode(e.target.value as Mode)}
        >
          {MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_LABELS[m]}
            </option>
          ))}
        </select>
        <button className="k-btn small" onClick={() => app.clearSketch()}>
          Clear
        </button>
      </div>
      <div ref={scrollRef} className="km-sheet" onWheel={onWheel} onContextMenu={onContextMenu} onDragOver={onDragOver} onDrop={onDrop}>
        <div style={{ width: Math.max(sheet, view.w), height: Math.max(sheet, view.h) }} />
        <canvas
          ref={canvasRef}
          className="km-sheet-canvas"
          style={{ left: view.sl, top: view.st }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
      <div className="km-vstatus">{s.sketchStatus}</div>
    </div>
  )
}

/** A QComboBox of elements with their colour chips. */
export function ElementCombo({ value, items, onChange, disabled, title }: { value: string; items: readonly string[]; onChange: (el: string) => void; disabled?: boolean; title?: string }) {
  return (
    <span className="km-elcombo" title={title}>
      <ElementChip color={cpk(value)} size={16} />
      <select className="km-combo" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {items.map((el) => (
          <option key={el} value={el}>
            {el}
          </option>
        ))}
      </select>
    </span>
  )
}
