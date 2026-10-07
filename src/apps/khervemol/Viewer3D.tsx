// The 3D View tab — the desktop's Viewer3D (viewer3d.py) with both of its
// renderers: the OpenGL view (glview.GLView, here WebGL 2 with the same
// shaders) and the classic vector view (viewer3d._View). Drag the background
// to orbit, the wheel to zoom, click an atom to select it (Ctrl/⌘+click adds
// it), drag an atom to bend its bonds (lengths held when locked), drag a
// molecule lying on a surface to slide it (Shift+drag lifts it), Tab steps
// through the atoms, Esc cancels picking, Delete removes the selection.

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type WheelEvent } from 'react'
import { useStore } from 'zustand'
import { color as cpk, name as elName, textColor, PALETTE } from './elements'
import { GLRenderer, GLUnavailable } from './glrender'
import { ViewCubeIcon } from './icons'
import { dragGroup } from './film'
import { legendEntries } from './molcolor'
import { cloneAtoms, dragAtom } from './model'
import { legendLayout, paintOverlay, type LegendLayout } from './overlay'
import { Scene, STYLES, STYLE_LABELS, SEL_COLOR, CO_SEL_COLOR, CELL_COLOR, type Frozen, type Style } from './scene'
import { fitParams, fitTransform, legendSpecs, molSpecs, paintSpecs, renderSpecsImage, specsBounds, type FitParams, type Spec } from './specs'
import { MAX_CELLS, STANDARD_VIEWS, type MolApp } from './app'
import type { Atom, Mol } from './types'
import { viewerMenu } from './contextMenus'

export const DND_MIME = 'application/x-khervemol-compound'
const W = 400 // the classic view's model box (viewer3d._W)

interface Drag {
  mode: 'orbit' | 'drag' | 'group' | null
  x: number
  y: number
  sx: number
  sy: number
  atom: number | null
  group: number | null
  atoms: Atom[] | null
  frozen: Frozen | null
  classic: FitParams | null
  ppa: number
}

/** The scene the GL view draws: built again only when the geometry changes. */
function useScene(mol: Mol, style: Style, override: { atoms: Atom[]; frozen: Frozen | null } | null): Scene {
  const base = useMemo(
    () => new Scene(mol, style),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mol.atoms, mol.bonds, mol.edges, mol.cell_visible, mol.colors, mol.notes, mol.poly, mol.bond, mol.rscale, mol.anchor_base, style],
  )
  return useMemo(() => (override ? new Scene({ ...mol, atoms: override.atoms }, style, override.frozen) : base), [override, base, mol, style])
}

export function Viewer3D({ app }: { app: MolApp }) {
  const s = useStore(app.store)
  const mol = s.mol
  const editable = !mol.crystal
  const boxRef = useRef<HTMLDivElement>(null)
  const glRef = useRef<HTMLCanvasElement>(null)
  const ovRef = useRef<HTMLCanvasElement>(null)
  const clRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<GLRenderer | null>(null)
  const [size, setSize] = useState({ w: 400, h: 320 })
  const [live, setLive] = useState<{ atoms: Atom[]; frozen: Frozen | null; classic: FitParams | null } | null>(null)
  const drag = useRef<Drag | null>(null)
  const classicT = useRef<{ k: number; tx: number; ty: number } | null>(null)
  const classicSpecs = useRef<Spec[]>([])
  const gl = s.renderer === 'gl' && s.glOk

  const scene = useScene(mol, s.style, live ? { atoms: live.atoms, frozen: live.frozen } : null)
  const entries = useMemo(() => legendEntries(mol.atoms, mol.colors), [mol.atoms, mol.colors])

  // ------------------------------------------------------------- sizing
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: Math.max(1, el.clientWidth), h: Math.max(1, el.clientHeight) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // --------------------------------------------------------- GL lifecycle
  useEffect(() => {
    if (!gl || !glRef.current) return
    try {
      rendererRef.current = new GLRenderer(glRef.current)
    } catch (e) {
      app.glFailed(e instanceof GLUnavailable ? e.message : String(e))
      return
    }
    const canvas = glRef.current
    const lost = (ev: Event) => {
      ev.preventDefault()
      app.glFailed('the WebGL context was lost')
    }
    canvas.addEventListener('webglcontextlost', lost)
    return () => {
      canvas.removeEventListener('webglcontextlost', lost)
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [gl, app])

  const legendFor = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number): LegendLayout | null => legendLayout(ctx, entries, s.legend, w, h),
    [entries, s.legend],
  )

  /** Pixels per Å and the model box for a (w, h) view. */
  const layout = useCallback(
    (w: number, h: number, ctx: CanvasRenderingContext2D) => {
      const lg = legendFor(ctx, w, h)
      const bw = lg ? w - lg.width : w
      const d = drag.current
      const ppa = d && d.frozen && (d.mode === 'drag' || d.mode === 'group') ? d.ppa : scene.fitPpa(bw, h, mol.az, mol.el) * s.zoom
      return { lg, bw, ppa }
    },
    [legendFor, scene, mol.az, mol.el, s.zoom],
  )

  const selection = s.selection
  const primary = selection.length ? selection[selection.length - 1] : null
  const cellAtoms = useMemo(() => {
    if (!mol.stacked) return []
    const picked = new Set(selection)
    return app.tiltCellAtoms().filter((i) => !picked.has(i))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mol, selection, app])

  // -------------------------------------------------------------- paint
  const paintGL = useCallback(() => {
    const r = rendererRef.current, cv = glRef.current, ov = ovRef.current
    if (!r || !cv || !ov) return
    const dpr = window.devicePixelRatio || 1
    const { w, h } = size
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
    }
    if (ov.width !== Math.round(w * dpr) || ov.height !== Math.round(h * dpr)) {
      ov.width = Math.round(w * dpr)
      ov.height = Math.round(h * dpr)
    }
    const ctx = ov.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const { lg, ppa } = layout(w, h, ctx)
    r.setScene(scene)
    r.render({ az: mol.az, el: mol.el, ppa, dpr, legend: lg ? lg.width : 0, selection, primary, cell: cellAtoms })
    if (s.labels || scene.notes.length || lg) paintOverlay(ctx, scene, { az: mol.az, el: mol.el, ppa, w, h, labels: s.labels, legend: lg })
  }, [size, layout, scene, mol.az, mol.el, selection, primary, cellAtoms, s.labels])

  const paintClassic = useCallback(() => {
    const cv = clRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    const { w, h } = size
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(h * dpr)
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    const m: Mol = live ? { ...mol, atoms: live.atoms } : mol
    let specs = molSpecs(m, W, W, { tag: true, labels: s.labels, frozen: live?.classic ?? null })
    if (s.legend) specs = specs.concat(legendSpecs(entries, W * 1.02, W * 0.06, Math.max(6, W * 0.022)))
    classicSpecs.current = specs
    if (!live || !classicT.current) {
      const box = specsBounds(ctx, specs)
      const b = box ? { x: box.x - 10, y: box.y - 10, w: box.w + 20, h: box.h + 20 } : { x: 0, y: 0, w: W, h: W }
      const t = fitTransform(b, w, h)
      const k = t.k * s.zoom
      classicT.current = { k, tx: w / 2 - (b.x + b.w / 2) * k, ty: h / 2 - (b.y + b.h / 2) * k }
    }
    const t = classicT.current
    ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.tx, dpr * t.ty)
    paintSpecs(ctx, specs)
    // selection rings (and the dashed ring of the cell a tilt would turn)
    const sel = new Set(selection), cell = new Set(cellAtoms)
    for (const sp of specs) {
      if (sp._atom === undefined) continue
      const idx = sp._atom
      const inSel = sel.has(idx)
      if (!inSel && !cell.has(idx)) continue
      const pad = (Number(sp.width ?? 1) || 0) / 2 + (inSel ? 3 : 2)
      ctx.beginPath()
      ctx.ellipse(sp.x! + sp.w! / 2, sp.y! + sp.h! / 2, sp.w! / 2 + pad, sp.h! / 2 + pad, 0, 0, Math.PI * 2)
      ctx.setLineDash(inSel ? [] : [6 / t.k, 4 / t.k])
      ctx.lineWidth = (inSel ? (idx === primary ? 3 : 2) : 2) / t.k
      ctx.strokeStyle = inSel ? (idx === primary ? SEL_COLOR : CO_SEL_COLOR) : CELL_COLOR
      ctx.stroke()
      ctx.setLineDash([])
    }
  }, [size, mol, live, s.labels, s.legend, s.zoom, entries, selection, cellAtoms, primary])

  useEffect(() => {
    const id = requestAnimationFrame(() => (gl ? paintGL() : paintClassic()))
    return () => cancelAnimationFrame(id)
  }, [gl, paintGL, paintClassic])

  // ---------------------------------------------------------- hit testing
  const atomAt = useCallback(
    (x: number, y: number): number | null => {
      if (!mol.atoms.length) return null
      if (gl) {
        const ctx = ovRef.current?.getContext('2d')
        if (!ctx) return null
        const { bw, ppa } = layout(size.w, size.h, ctx)
        return scene.pickAtom(x, y, mol.az, mol.el, ppa, bw, size.h)
      }
      const t = classicT.current
      if (!t) return null
      const px = (x - t.tx) / t.k, py = (y - t.ty) / t.k
      const specs = classicSpecs.current
      for (let i = specs.length - 1; i >= 0; i--) {
        const sp = specs[i]
        if (sp._atom === undefined) continue
        const cx = sp.x! + sp.w! / 2, cy = sp.y! + sp.h! / 2, r = sp.w! / 2 + (Number(sp.width ?? 0) || 0) / 2
        if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) return sp._atom
      }
      return null
    },
    [mol, gl, layout, size, scene],
  )

  const bondAt = useCallback(
    (x: number, y: number): number | null => {
      if (!mol.atoms.length || atomAt(x, y) !== null) return null
      if (gl) {
        const ctx = ovRef.current?.getContext('2d')
        if (!ctx) return null
        const { bw, ppa } = layout(size.w, size.h, ctx)
        return scene.pickBond(x, y, mol.az, mol.el, ppa, bw, size.h)
      }
      const t = classicT.current
      if (!t) return null
      const px = (x - t.tx) / t.k, py = (y - t.ty) / t.k
      const specs = classicSpecs.current
      for (let i = specs.length - 1; i >= 0; i--) {
        const sp = specs[i]
        if (sp._bond === undefined) continue
        const dx = sp.x2! - sp.x1!, dy = sp.y2! - sp.y1!
        const ln = dx * dx + dy * dy
        const tt = ln < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - sp.x1!) * dx + (py - sp.y1!) * dy) / ln))
        const d = Math.hypot(px - (sp.x1! + tt * dx), py - (sp.y1! + tt * dy))
        if (d <= (Number(sp.width ?? 2) || 2) / 2 + 2 / t.k) return sp._bond
      }
      return null
    },
    [mol, gl, layout, size, scene, atomAt],
  )

  // --------------------------------------------------------------- mouse
  const local = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as const
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    boxRef.current?.focus()
    const [x, y] = local(e)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { mode: null, x, y, sx: x, sy: y, atom: atomAt(x, y), group: null, atoms: null, frozen: null, classic: null, ppa: 1 }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const [x, y] = local(e)
    const dx = x - d.x, dy = y - d.y
    if (d.mode === null) {
      if (Math.abs(x - d.sx) + Math.abs(y - d.sy) < 4) return
      const ctx = ovRef.current?.getContext('2d') ?? clRef.current?.getContext('2d')
      const ppa = ctx && gl ? layout(size.w, size.h, ctx).ppa : 1
      const gi = app.groupAt(d.atom)
      if (d.atom !== null && editable) {
        d.mode = 'drag'
      } else if (gi !== null) {
        d.mode = 'group'
        d.group = gi
        app.selectGroup(gi)
      } else d.mode = 'orbit'
      if (d.mode !== 'orbit') {
        d.ppa = ppa
        d.frozen = scene.freeze()
        d.atoms = cloneAtoms(mol.atoms)
        d.classic = gl ? null : fitParams(mol.atoms, W, W, mol.az, mol.el, mol.bond, mol.rscale)
        app.dragging = true
        setLive({ atoms: d.atoms, frozen: d.frozen, classic: d.classic })
      }
    }
    d.x = x
    d.y = y
    if (d.mode === 'orbit') {
      app.orbit(dx, dy)
      return
    }
    // classic: deltas in scene units and the frozen layout's scale; GL: pixels and px/Å
    const t = classicT.current
    const sdx = gl ? dx : dx / (t?.k ?? 1), sdy = gl ? dy : dy / (t?.k ?? 1)
    const scale = gl ? d.ppa : d.classic?.scale ?? 1
    const atoms = cloneAtoms(d.atoms!)
    if (d.mode === 'group' && d.group !== null) {
      dragGroup(atoms, mol.groups[d.group], sdx, sdy, mol.az, mol.el, mol.bond, scale, e.shiftKey)
      d.atoms = atoms
      setLive({ atoms, frozen: d.frozen, classic: d.classic })
      app.showGroupPose(atoms)
    } else if (d.mode === 'drag' && d.atom !== null) {
      dragAtom(atoms, d.atom, sdx, sdy, mol.az, mol.el, gl ? scene.factor : mol.bond, scale, s.lock ? mol.bonds : null)
      d.atoms = atoms
      setLive({ atoms, frozen: d.frozen, classic: d.classic })
      app.showGeometry(d.atom, atoms)
    }
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if ((d.mode === 'drag' || d.mode === 'group') && d.atoms) {
      const atoms = d.atoms
      classicT.current = null
      setLive(null)
      void app.commitDrag(atoms, d.mode === 'group')
    } else if (d.mode === null) {
      app.onAtomClicked(d.atom ?? -1, e.ctrlKey || e.metaKey)
    }
  }

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    app.zoomBy(e.deltaY < 0)
  }

  // stop the page from scrolling under the wheel
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const block = (ev: globalThis.WheelEvent) => ev.preventDefault()
    el.addEventListener('wheel', block, { passive: false })
    return () => el.removeEventListener('wheel', block)
  }, [])

  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const [x, y] = local(e)
    const atom = atomAt(x, y)
    if (atom !== null) {
      app.set({ hit: ['atom', atom] })
      if (app.get().selection.includes(atom)) app.makePrimary(atom)
      else app.selectAtom(atom)
    } else {
      const bond = bondAt(x, y)
      app.set({ hit: bond !== null ? ['bond', bond] : [null, -1] })
    }
    viewerMenu(app, e.clientX, e.clientY)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      app.stepSelection(e.shiftKey ? -1 : 1)
    } else if (e.key === 'Escape') app.cancelPick()
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      void app.deleteSelected()
    }
  }

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes(DND_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const raw = e.dataTransfer.getData(DND_MIME)
    if (!raw) return
    e.preventDefault()
    const [kind, ...rest] = raw.split('|')
    void app.dropCompound3d(kind, rest.join('|'))
  }

  // ------------------------------------------------------------ export
  useEffect(() => {
    app.renderImage = async (w, h) => {
      const st = app.get()
      const m = st.mol
      if (st.renderer === 'gl' && st.glOk) {
        const sc = new Scene(m, st.style)
        const out = document.createElement('canvas')
        out.width = w
        out.height = h
        const ctx = out.getContext('2d')!
        const lg = legendLayout(ctx, legendEntries(m.atoms, m.colors), st.legend, w, h)
        const bw = lg ? w - lg.width : w
        const ppa = sc.fitPpa(bw, h, m.az, m.el) * st.zoom
        const glc = document.createElement('canvas')
        glc.width = w
        glc.height = h
        let r: GLRenderer | null = null
        try {
          r = new GLRenderer(glc, { preserve: true })
          r.setScene(sc)
          r.render({ az: m.az, el: m.el, ppa, dpr: 1, legend: lg ? lg.width : 0, selection: [], primary: null, cell: [] })
          ctx.drawImage(glc, 0, 0)
        } catch {
          r = null
        } finally {
          r?.dispose()
        }
        if (r) {
          if (st.labels || sc.notes.length || lg) paintOverlay(ctx, sc, { az: m.az, el: m.el, ppa, w, h, labels: st.labels, legend: lg })
          return out
        }
      }
      let specs = molSpecs(m, w, h, { labels: st.labels })
      if (st.legend) specs = specs.concat(legendSpecs(legendEntries(m.atoms, m.colors), w * 1.02, h * 0.06, Math.max(6, w * 0.022)))
      return renderSpecsImage(specs, w, h)
    }
    return () => {
      app.renderImage = null
    }
  }, [app])

  // ------------------------------------------------------------- the rows
  const bondValue = Math.round(mol.bond * 100)
  const film = s.film
  const showFilm = !!mol.has_animation
  const showGroups = mol.name.startsWith('surface:') && s.animP === null
  const hasGroups = mol.groups.length > 0
  const turn = s.groupMode === 'turn'
  const canStack = mol.can_stack
  const canBondSel = app.canBondSelected(s.order)
  const polyOn = app.polyEnabled()

  return (
    <div className="km-viewer">
      <div className="km-viewrow">
        <span className="km-label">View:</span>
        {STANDARD_VIEWS.map(([title, az, el]) => (
          <button key={title} className="km-cube" title={`View from ${title.toLowerCase()}`} onClick={() => app.setView(az, el)}>
            <ViewCubeIcon view={title.toLowerCase()} size={24} />
            <span>{title}</span>
          </button>
        ))}
        <span className="km-stretch" />
        <button className="km-flat" onClick={() => app.resetZoom()}>
          Reset zoom
        </button>
      </div>
      <div
        ref={boxRef}
        className={`km-view${s.picking ? ' picking' : ''}`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {gl ? (
          <>
            <canvas ref={glRef} className="km-canvas" style={{ width: size.w, height: size.h }} />
            <canvas ref={ovRef} className="km-canvas km-overlay" style={{ width: size.w, height: size.h }} />
          </>
        ) : (
          <canvas ref={clRef} className="km-canvas" style={{ width: size.w, height: size.h }} />
        )}
      </div>
      <div className="km-vstatus" title={s.viewStatus}>
        {s.viewStatus}
      </div>
      <div className="km-row">
        <span className={`km-label${''}`}>{editable ? 'Bond length:' : 'Atom spacing:'}</span>
        <input
          className="km-slider km-grow"
          type="range"
          min={editable ? 80 : 0}
          max={300}
          value={bondValue}
          onChange={(e) => app.setBondSpread(Number(e.target.value))}
        />
        <span className="km-label">Style:</span>
        <select className="km-combo" value={s.style} disabled={!gl} title="Ball & stick, space filling or sticks (OpenGL renderer)" onChange={(e) => app.setStyle(e.target.value as Style)}>
          {STYLES.map((k) => (
            <option key={k} value={k}>
              {STYLE_LABELS[k]}
            </option>
          ))}
        </select>
        <button className={`km-flat km-toggle${s.labels ? ' on' : ''}`} onClick={() => app.set({ labels: !s.labels })}>
          Labels
        </button>
        <button
          className={`km-flat km-toggle${s.lock ? ' on' : ''}`}
          title="Hold every bond at its real length (C–O 1.43 Å, C=O 1.23 Å …) while you drag an atom — the bond swings instead of stretching"
          onClick={() => app.set({ lock: !s.lock })}
        >
          Lock lengths
        </button>
      </div>
      <div className="km-row">
        <span className="km-label">Add atom:</span>
        {PALETTE.map((el) => (
          <button
            key={el}
            className="km-elbtn"
            disabled={!editable}
            style={{ background: cpk(el), color: textColor(el) }}
            title={`Bond a ${elName(el)} atom onto the selected atom`}
            onClick={() => void app.addElement(el)}
          >
            {el}
          </button>
        ))}
        <button
          className="km-elbtn km-table"
          style={{ background: cpk(s.activeElement), color: textColor(s.activeElement) }}
          title={`Open the periodic table — pick any of the 118 elements. The active element is ${elName(s.activeElement)} (${s.activeElement}): the toolbar's Add atom button and the right-click menu add it (Ctrl+T)`}
          onClick={() => app.showPeriodicTable()}
        >
          Table · {s.activeElement}
        </button>
        <span className="km-gap" />
        <span className="km-label">Bond:</span>
        <select className="km-combo" value={s.order} disabled={!editable} onChange={(e) => { app.set({ order: Number(e.target.value) as 1 | 2 | 3 }); app.updateStatus() }}>
          <option value={1}>single</option>
          <option value={2}>double</option>
          <option value={3}>triple</option>
        </select>
        <button className="k-btn small" disabled={!editable || !canBondSel} title="Bond the two selected atoms (Ctrl+click a second atom, or Tab to step the selection)" onClick={() => app.bondSelected(s.order)}>
          Bond selected
        </button>
        <button className="k-btn small" disabled={!editable} onClick={() => void app.deleteSelected()}>
          Delete atom
        </button>
      </div>
      <div className="km-row">
        <span className="km-label">Colour:</span>
        <button
          className="k-btn small"
          title="Recolour the selected atom. On a crystal this recolours every atom of that element and lattice site, since the lattice is regenerated on every draw."
          onClick={() => pickColour(app)}
        >
          Atom colour…
        </button>
        <button className="k-btn small" title="Restore the standard CPK and lattice-site colours" onClick={() => void app.resetColors()}>
          Reset colours
        </button>
        <button
          className={`km-flat km-toggle${s.legend ? ' on' : ''}`}
          title="Show a colour key beside the structure — one lit sphere per element and lattice site (included in PNG / SVG export)"
          onClick={() => app.setLegend(!s.legend)}
        >
          Legend
        </button>
        <button
          className={`km-flat km-toggle${mol.poly ? ' on' : ''}`}
          disabled={!polyOn}
          title="Draw translucent coordination polyhedra — the faces spanned by each ≥4-coordinate atom's bonded neighbours (VESTA style)"
          onClick={() => void app.setPoly(!mol.poly)}
        >
          Polyhedra
        </button>
        <button
          className={`km-flat km-toggle${mol.cell_visible ? ' on' : ''}`}
          disabled={!mol.edges}
          title="Show or hide the box drawn around the unit cell, supercell or surface slab"
          onClick={() => void app.setCellVisible(!mol.cell_visible)}
        >
          Cell outline
        </button>
      </div>
      {canStack && (
        <div className="km-row">
          <span className="km-label">Supercell:</span>
          {[0, 1, 2].map((axis) => (
            <span key={axis} className="km-inline">
              <SpinBox
                value={mol.cells[axis]}
                min={1}
                max={MAX_CELLS}
                title={`Unit cells along ${'abc'[axis]} (up to ${MAX_CELLS})`}
                onCommit={(v) => {
                  const c = [...mol.cells] as [number, number, number]
                  c[axis] = v
                  void app.setCells(...c)
                }}
              />
              {axis < 2 && <span className="km-label">×</span>}
            </span>
          ))}
          <span className="km-gap" />
          <span className="km-label">Tilt cell:</span>
          {(['x', 'y', 'z'] as const).map((axis, k) => (
            <SpinBox
              key={axis}
              value={s.tiltShown[k]}
              min={-180}
              max={180}
              step={5}
              suffix="°"
              title={`Rotate the selected atom's unit cell about ${axis} — its neighbours deform to follow, as a defect`}
              onCommit={(v) => {
                const t = [...s.tiltShown] as [number, number, number]
                t[k] = v
                app.onTilt(t)
              }}
            />
          ))}
          <button className="k-btn small" onClick={() => void app.resetTilts()}>
            Reset tilts
          </button>
        </div>
      )}
      {showFilm && (
        <div className="km-row">
          <button className="k-btn small" title="Watch the atoms rearrange: reactants approach, bonds break and form, products separate" onClick={() => app.toggleAnimation()}>
            {s.playing ? '⏸ Pause' : '▶ Animate'}
          </button>
          <button className="k-btn small" title="Back to the equation with its arrow" onClick={() => app.stopAnimation()}>
            ■ Equation
          </button>
          <input
            className="km-slider km-grow"
            type="range"
            min={0}
            max={1000}
            title="Scrub through the reaction"
            value={Math.round((s.animP ?? 0) * 1000)}
            disabled={!film}
            onChange={(e) => app.setProgress(Number(e.target.value) / 1000, true)}
          />
          <select className="km-combo" value={s.speed} onChange={(e) => app.set({ speed: Number(e.target.value) })}>
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </select>
          <button className={`km-flat km-toggle${s.loop ? ' on' : ''}`} onClick={() => app.set({ loop: !s.loop })}>
            Loop
          </button>
        </div>
      )}
      {showGroups && (
        <div className="km-row">
          <span className="km-label">On the surface:</span>
          <select
            className="km-combo km-groupcombo"
            disabled={!hasGroups}
            value={hasGroups ? Math.min(s.groupIndex, mol.groups.length - 1) : ''}
            title="The molecule to move. Clicking one of its atoms picks it, and dragging one slides it over the surface (Shift+drag lifts it)"
            onChange={(e) => app.selectGroup(Number(e.target.value))}
          >
            {mol.groups.map((g, gi) => (
              <option key={gi} value={gi}>
                {g.name}
              </option>
            ))}
          </select>
          <select className="km-combo" disabled={!hasGroups} value={s.groupMode} title="What the buttons do: slide the molecule or turn it about its own centre" onChange={(e) => app.setGroupMode(e.target.value as 'move' | 'turn')}>
            <option value="move">Move (Å)</option>
            <option value="turn">Turn (°)</option>
          </select>
          <input
            className="k-input km-num"
            type="number"
            min={0.05}
            max={90}
            step={0.05}
            disabled={!hasGroups}
            value={s.groupStep}
            title="How far each button click moves or turns"
            onChange={(e) => app.set({ groupStep: Math.max(0.05, Math.min(90, Number(e.target.value) || 0.05)) })}
          />
          {(
            [
              [0, -1, 'along −x (x is along the first surface vector)'],
              [0, 1, 'along +x'],
              [1, -1, 'along −y'],
              [1, 1, 'along +y'],
              [2, -1, 'down, toward the surface'],
              [2, 1, 'up, away from the surface'],
            ] as const
          ).map(([axis, sign, tip]) => (
            <button key={`${axis}${sign}`} className={`k-btn small km-nudge${turn ? ' turn' : ''}`} disabled={!hasGroups} title={tip} onClick={() => void app.nudgeGroup(axis, sign)}>
              {(turn ? ['Roll', 'Tilt', 'Turn'][axis] : 'XYZ'[axis]) + (sign < 0 ? '−' : '+')}
            </button>
          ))}
          <button className="k-btn small" title="Put another molecule on the surface" onClick={() => void app.addMoleculeToSurface()}>
            Add molecule…
          </button>
          <button className="k-btn small" disabled={!hasGroups} title="Take the chosen molecule off the surface" onClick={() => void app.removeCurrentGroup()}>
            Remove
          </button>
        </div>
      )}
    </div>
  )
}

/** QColorDialog.getColor: the browser's colour picker, starting from the atom's colour. */
export function pickColour(app: MolApp) {
  const idx = app.selected
  const m = app.get().mol
  if (idx === null || idx >= m.atoms.length) {
    void app.pickColor(null)
    return
  }
  const a = m.atoms[idx]
  const over = m.colors[a.length > 4 && a[4] ? `${a[0]}@${a[4]}` : a[0]]
  const current = over || (a.length > 4 && a[4] ? (a[4] as string) : cpk(a[0]))
  const input = document.createElement('input')
  input.type = 'color'
  input.value = /^#[0-9a-f]{6}$/i.test(current) ? current : '#888888'
  input.style.position = 'fixed'
  input.style.left = '-100px'
  document.body.appendChild(input)
  input.addEventListener('change', () => {
    void app.pickColor(input.value)
    input.remove()
  })
  input.addEventListener('blur', () => setTimeout(() => input.remove(), 1000))
  input.click()
}

/** A QSpinBox that applies on Enter, on leaving it, or on its arrows (setKeyboardTracking(False)). */
export function SpinBox({ value, min, max, step = 1, suffix, title, onCommit, disabled }: { value: number; min: number; max: number; step?: number; suffix?: string; title?: string; disabled?: boolean; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = (raw: string) => {
    const v = Math.max(min, Math.min(max, Math.round(Number(raw))))
    if (!Number.isFinite(v)) {
      setText(String(value))
      return
    }
    setText(String(v))
    if (v !== value) onCommit(v)
  }
  return (
    <span className="km-spin" title={title}>
      <input
        className="k-input km-num"
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value)
          // the arrows / wheel change the value without typing: apply them at once
          const ne = e.nativeEvent as InputEvent
          if (!ne.inputType) commit(e.target.value)
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
        }}
      />
      {suffix && <span className="km-suffix">{suffix}</span>}
    </span>
  )
}
