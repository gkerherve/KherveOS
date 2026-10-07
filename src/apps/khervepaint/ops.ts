// Editing operations: pure functions from a document (or item) to a new one.
// They follow the desktop's canvas.py and handles.py, with two fixes: when an
// edit moves an item's centre (its rotation origin), the item is shifted so
// nothing jumps; and ungrouping a rotated group keeps every child in place.

import type { Doc, GroupItem, ImageItem, Item, LineItem, Mat, PathCmd, Pt, Rect } from './model'
import { cloneItem, hasBrush, newId } from './model'
import {
  IDENTITY, apply, applyVec, boundsIn, center, invert, mapCmds, matrixOf, mul, normRect, originOf, outlineOf, qtRect,
  rectOf, rotateM, scaleM, translateM, union,
} from './geom'

// ------------------------------------------------------------ basics

export const isRotated = (it: Item) => it.type !== 'image' && (Math.abs(it.rotation) > 1e-12 || it.scale !== 1 || (it.type === 'group' && !!it.matrix))

/**
 * `next` is `old` with new geometry. Its centre (the rotation origin) may have
 * moved: shift it so the drawing stays where it was on the page.
 * p ↦ P + M(o + RS(p − o)) is unchanged when P' = P + L((o − o') − RS(o − o')).
 */
export function keepPlace<T extends Item>(old: T, next: T): T {
  if (!isRotated(old) || next.type === 'image') return next
  const o1 = originOf(old)
  const o2 = originOf(next)
  const d = { x: o1.x - o2.x, y: o1.y - o2.y }
  if (Math.abs(d.x) < 1e-12 && Math.abs(d.y) < 1e-12) return next
  const rs = mul(rotateM(old.rotation), scaleM(old.scale))
  const rd = applyVec(rs, d)
  let v = { x: d.x - rd.x, y: d.y - rd.y }
  if (old.type === 'group' && old.matrix) v = applyVec(old.matrix, v)
  return { ...next, pos: { x: next.pos.x + v.x, y: next.pos.y + v.y } }
}

/** The item moved by (dx, dy) in its parent's coordinates. */
export function translateItem<T extends Item>(it: T, dx: number, dy: number): T {
  if (it.type === 'image') {
    const m = it.matrix
    return { ...it, matrix: [m[0], m[1], m[2], m[3], m[4] + dx, m[5] + dy], pos: { x: m[4] + dx, y: m[5] + dy } }
  }
  return { ...it, pos: { x: it.pos.x + dx, y: it.pos.y + dy } }
}

/** Place the item's position (pos, or an image's translation) at `p`. */
export function setPos<T extends Item>(it: T, p: Pt): T {
  const cur = it.type === 'image' ? { x: it.matrix[4], y: it.matrix[5] } : it.pos
  return translateItem(it, p.x - cur.x, p.y - cur.y)
}

export const posOf = (it: Item): Pt => (it.type === 'image' ? { x: it.matrix[4], y: it.matrix[5] } : it.pos)

export function mapTop(doc: Doc, ids: Set<number>, fn: (it: Item) => Item): Doc {
  let changed = false
  const items = doc.items.map((it) => {
    if (!ids.has(it._id)) return it
    const next = fn(it)
    if (next !== it) changed = true
    return next
  })
  return changed ? { ...doc, items } : doc
}

/** Tight bounds of items on the page. */
export function itemsBounds(items: Item[]): Rect | null {
  let r: Rect | null = null
  for (const it of items) r = union(r, boundsIn(it))
  return r
}

// ------------------------------------------------------------- handles

export type BoxRole = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const BOX_ROLES: BoxRole[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export function boxAnchor(r: Rect, role: BoxRole): Pt {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const x = role.includes('w') ? r.x : role.includes('e') ? r.x + r.w : cx
  const y = role.includes('n') ? r.y : role.includes('s') ? r.y + r.h : cy
  return { x, y }
}

const OPPOSITE: Record<BoxRole, BoxRole> = { nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e' }

/** Move one edge or corner of `r` to the local point `q` (handles._drag_box). */
export function dragRect(r0: Rect, role: BoxRole, q: Pt): Rect {
  let x0 = r0.x
  let y0 = r0.y
  let x1 = r0.x + r0.w
  let y1 = r0.y + r0.h
  if (role.includes('n')) y0 = q.y
  if (role.includes('s')) y1 = q.y
  if (role.includes('w')) x0 = q.x
  if (role.includes('e')) x1 = q.x
  const r = normRect(rectOf(x0, y0, x1 - x0, y1 - y0))
  return { x: r.x, y: r.y, w: Math.max(r.w, 1), h: Math.max(r.h, 1) }
}

/** Resize a rect-defined shape's box. */
export function resizeBox<T extends Item & { x: number; y: number; w: number; h: number }>(it0: T, role: BoxRole, q: Pt): T {
  const r = dragRect(normRect(rectOf(it0.x, it0.y, it0.w, it0.h)), role, q)
  return keepPlace(it0, { ...it0, x: r.x, y: r.y, w: r.w, h: r.h })
}

/** Move a line's end (or its bend handle: the curve then passes through q). */
export function dragLine<T extends Item & { x1: number; y1: number; x2: number; y2: number }>(it0: T, role: 'p1' | 'p2' | 'mid', q: Pt): T {
  if (role === 'mid') {
    if (it0.type === 'dimension') return it0
    const mid = { x: (it0.x1 + it0.x2) / 2, y: (it0.y1 + it0.y2) / 2 }
    const dx = it0.x2 - it0.x1
    const dy = it0.y2 - it0.y1
    const len = Math.hypot(dx, dy)
    const off = len > 1e-6 ? Math.abs(dx * (q.y - it0.y1) - dy * (q.x - it0.x1)) / len : Math.hypot(q.x - mid.x, q.y - mid.y)
    const next = { ...it0 } as T & LineItem
    if (off < 2) delete next.bend
    else next.bend = [q.x * 2 - mid.x, q.y * 2 - mid.y]
    return keepPlace(it0, next as T)
  }
  return keepPlace(it0, role === 'p1' ? { ...it0, x1: q.x, y1: q.y } : { ...it0, x2: q.x, y2: q.y })
}

/** The point a bent line passes through at its middle (the bend handle). */
export function bendHandle(it: LineItem): Pt {
  const mid = { x: (it.x1 + it.x2) / 2, y: (it.y1 + it.y2) / 2 }
  return it.bend ? { x: (mid.x + it.bend[0]) / 2, y: (mid.y + it.bend[1]) / 2 } : mid
}

export function dragVertex<T extends Item & { points: [number, number][] }>(it0: T, index: number, q: Pt): T {
  const points = it0.points.map((p, i) => (i === index ? ([q.x, q.y] as [number, number]) : p))
  return keepPlace(it0, { ...it0, points })
}

/** Resize a picture in its own frame: the opposite edge stays put. */
export function resizeImage(it0: ImageItem, role: BoxRole, q: Pt): ImageItem {
  const r = dragRect(rectOf(0, 0, it0.iw, it0.ih), role, q)
  const m = mul(it0.matrix, mul(translateM(r.x, r.y), scaleM(r.w / it0.iw, r.h / it0.ih)))
  return { ...it0, matrix: m, pos: { x: m[4], y: m[5] } }
}

/**
 * Resize a group along X, Y or both about the opposite handle (handles._resize_gbox).
 * The scale is applied in the group's own frame, so it also works when the group is turned.
 */
export function resizeGroup(g0: GroupItem, role: BoxRole, q: Pt, frame: Rect): GroupItem {
  const anchor = boxAnchor(frame, OPPOSITE[role])
  const moving = boxAnchor(frame, role)
  let sx = 1
  let sy = 1
  if (role.includes('e') || role.includes('w')) {
    const d = moving.x - anchor.x
    if (Math.abs(d) > 1e-6) sx = (q.x - anchor.x) / d
  }
  if (role.includes('n') || role.includes('s')) {
    const d = moving.y - anchor.y
    if (Math.abs(d) > 1e-6) sy = (q.y - anchor.y) / d
  }
  sx = sx >= 0 ? Math.max(sx, 0.05) : Math.min(sx, -0.05)
  sy = sy >= 0 ? Math.max(sy, 0.05) : Math.min(sy, -0.05)
  const local = mul(translateM(anchor.x, anchor.y), mul(scaleM(sx, sy), translateM(-anchor.x, -anchor.y)))
  // p ↦ P + M·T(o)RS·T(−o)·local(p): fold `local` into M by conjugating with the rotation.
  const o = originOf(g0)
  const rot = mul(translateM(o.x, o.y), mul(rotateM(g0.rotation), mul(scaleM(g0.scale), translateM(-o.x, -o.y))))
  const inv = invert(rot) ?? IDENTITY
  const matrix = mul(g0.matrix ?? IDENTITY, mul(rot, mul(local, inv)))
  return { ...g0, matrix }
}

/** Scale a path or text uniformly about the corner opposite `role` (handles._scale). */
export function scaleAbout(it0: Item, anchorLocal: Pt, factor: number): Item {
  const s = Math.max(it0.scale * factor, 0.05)
  const m0 = matrixOf(it0)
  const anchorScene = apply(m0, anchorLocal)
  const o = originOf(it0)
  const lin = mul(rotateM(it0.rotation), scaleM(s))
  const vec = applyVec(lin, { x: anchorLocal.x - o.x, y: anchorLocal.y - o.y })
  return { ...it0, scale: s, pos: { x: anchorScene.x - o.x - vec.x, y: anchorScene.y - o.y - vec.y } }
}

/** Turn an item to an absolute angle about its centre. */
export function setRotation(it: Item, deg: number): Item {
  if (it.type === 'image') {
    const cur = (Math.atan2(it.matrix[1], it.matrix[0]) * 180) / Math.PI
    const c = apply(it.matrix, { x: it.iw / 2, y: it.ih / 2 })
    const m = mul(translateM(c.x, c.y), mul(rotateM(deg - cur), mul(translateM(-c.x, -c.y), it.matrix)))
    return { ...it, matrix: m, pos: { x: m[4], y: m[5] } }
  }
  return { ...it, rotation: deg }
}

export const rotationOf = (it: Item) => (it.type === 'image' ? (Math.atan2(it.matrix[1], it.matrix[0]) * 180) / Math.PI : it.rotation)

// ------------------------------------------------------- group / ungroup

/** Group the top-level items `ids`; the group takes the place of the topmost one. */
export function groupItems(doc: Doc, ids: Set<number>): { doc: Doc; id: number | null } {
  const chosen = doc.items.filter((it) => ids.has(it._id))
  if (chosen.length < 2) return { doc, id: null }
  const g: GroupItem = {
    _id: newId(), type: 'group', pos: { x: 0, y: 0 }, opacity: 1, rotation: 0, z: 0, scale: 1,
    children: chosen.map((c, i) => ({ ...c, z: i })),
  }
  const top = Math.max(...chosen.map((c) => doc.items.indexOf(c)))
  const items: Item[] = []
  doc.items.forEach((it, i) => {
    if (i === top) items.push(g)
    else if (!ids.has(it._id)) items.push(it)
  })
  return { doc: { ...doc, items }, id: g._id }
}

const isSimilarity = (m: Mat) => Math.abs(m[0] - m[3]) < 1e-9 && Math.abs(m[1] + m[2]) < 1e-9 && m[0] * m[3] - m[1] * m[2] > 0

/** The child as a top-level item, its parent's transform `g` folded in. */
export function bakeInto(child: Item, g: Mat): Item {
  const full = mul(g, matrixOf(child))
  if (child.type === 'image') return { ...child, matrix: full, pos: { x: full[4], y: full[5] } }
  if (child.type === 'group') return { ...child, pos: { x: 0, y: 0 }, rotation: 0, scale: 1, matrix: full }
  if (isSimilarity(full)) {
    // Rotation + uniform scale: native fields, pos = full(o) − o.
    const s = Math.hypot(full[0], full[1])
    const deg = (Math.atan2(full[1], full[0]) * 180) / Math.PI
    const o = originOf(child)
    const fo = apply(full, o)
    return { ...child, rotation: Math.abs(deg) < 1e-9 ? 0 : deg, scale: Math.abs(s - 1) < 1e-12 ? 1 : s, pos: { x: fo.x - o.x, y: fo.y - o.y } }
  }
  // Sheared or stretched: bake the transform into the geometry.
  const base = { ...child, pos: { x: 0, y: 0 }, rotation: 0, scale: 1 }
  const P = (x: number, y: number) => apply(full, { x, y })
  switch (child.type) {
    case 'line':
    case 'arrow':
    case 'dimension': {
      const a = P(child.x1, child.y1)
      const b = P(child.x2, child.y2)
      const out = { ...base, x1: a.x, y1: a.y, x2: b.x, y2: b.y } as typeof child
      if ((child.type === 'line' || child.type === 'arrow') && child.bend) {
        const c = P(child.bend[0], child.bend[1])
        ;(out as LineItem).bend = [c.x, c.y]
      }
      return out
    }
    case 'rect':
      if (Math.abs(full[1]) < 1e-9 && Math.abs(full[2]) < 1e-9) {
        const r = normRect(rectOf(full[0] * child.x + full[4], full[3] * child.y + full[5], full[0] * child.w, full[3] * child.h))
        return { ...base, ...r } as typeof child
      }
      break
    case 'polygon':
      return { ...base, points: child.points.map(([x, y]) => { const p = P(x, y); return [p.x, p.y] as [number, number] }) } as typeof child
    case 'path':
      return { ...base, cmds: mapCmds(full, child.cmds) } as typeof child
    case 'text': {
      // Text cannot shear: keep the nearest turn and size, centred where it was.
      const s = Math.sqrt(Math.abs(full[0] * full[3] - full[1] * full[2]))
      const deg = (Math.atan2(full[1], full[0]) * 180) / Math.PI
      const o = originOf(child)
      const fo = apply(full, o)
      return { ...child, rotation: deg, scale: s, pos: { x: fo.x - o.x, y: fo.y - o.y } }
    }
  }
  // Turned rects, ellipses, rounded rects and arcs become paths of their outline.
  const cmds = outlineOf(child)
  if (!cmds || !hasBrush(child)) return child
  const path: Item = {
    _id: child._id, type: 'path', pos: { x: 0, y: 0 }, opacity: child.opacity, rotation: 0, z: child.z, scale: 1,
    pen: child.pen, brush: child.brush, cmds: mapCmds(full, cmds),
  }
  if (child.symbol) path.symbol = child.symbol
  return path
}

/** Ungroup the top-level groups in `ids`; returns the freed children's ids. */
export function ungroupItems(doc: Doc, ids: Set<number>): { doc: Doc; freed: number[] } {
  const freed: number[] = []
  const items: Item[] = []
  for (const it of doc.items) {
    if (ids.has(it._id) && it.type === 'group') {
      const m = matrixOf(it)
      for (const c of it.children) {
        const baked = bakeInto(c, m)
        const withOpacity = it.opacity < 1 ? { ...baked, opacity: baked.opacity * it.opacity } : baked
        items.push(withOpacity)
        freed.push(c._id)
      }
    } else items.push(it)
  }
  return freed.length ? { doc: { ...doc, items }, freed } : { doc, freed }
}

// ----------------------------------------------------------- stacking

/** Restack the top-level items `ids`: to the front/back, or one step. */
export function reorder(doc: Doc, ids: Set<number>, where: 'front' | 'back' | 'forward' | 'backward'): Doc {
  const items = [...doc.items]
  const chosen = items.filter((it) => ids.has(it._id))
  if (!chosen.length) return doc
  if (where === 'front') return { ...doc, items: [...items.filter((it) => !ids.has(it._id)), ...chosen] }
  if (where === 'back') return { ...doc, items: [...chosen, ...items.filter((it) => !ids.has(it._id))] }
  if (where === 'forward') {
    for (let i = items.length - 2; i >= 0; i--) {
      if (ids.has(items[i]._id) && !ids.has(items[i + 1]._id)) [items[i], items[i + 1]] = [items[i + 1], items[i]]
    }
  } else {
    for (let i = 1; i < items.length; i++) {
      if (ids.has(items[i]._id) && !ids.has(items[i - 1]._id)) [items[i], items[i - 1]] = [items[i - 1], items[i]]
    }
  }
  return { ...doc, items }
}

// ------------------------------------------------------ align / distribute

export type Align = 'left' | 'center_x' | 'right' | 'top' | 'center_y' | 'bottom' | 'distribute_x' | 'distribute_y'

/** Align or spread the items (mcp_tools align_items), by their visible bounds. */
export function alignItems(doc: Doc, ids: Set<number>, how: Align, page?: Rect): Doc {
  const items = doc.items.filter((it) => ids.has(it._id))
  if (!items.length || (items.length < 2 && !page)) return doc
  const rects = new Map(items.map((it) => [it._id, boundsIn(it)!]))
  const all = items.length < 2 && page ? page : itemsBounds(items)!
  const moves = new Map<number, Pt>()
  const cx = (r: Rect) => r.x + r.w / 2
  const cy = (r: Rect) => r.y + r.h / 2
  for (const it of items) {
    const r = rects.get(it._id)!
    let d: Pt = { x: 0, y: 0 }
    if (how === 'left') d = { x: all.x - r.x, y: 0 }
    else if (how === 'right') d = { x: all.x + all.w - (r.x + r.w), y: 0 }
    else if (how === 'top') d = { x: 0, y: all.y - r.y }
    else if (how === 'bottom') d = { x: 0, y: all.y + all.h - (r.y + r.h) }
    else if (how === 'center_x') d = { x: cx(all) - cx(r), y: 0 }
    else if (how === 'center_y') d = { x: 0, y: cy(all) - cy(r) }
    moves.set(it._id, d)
  }
  if (how === 'distribute_x' || how === 'distribute_y') {
    const key = (it: Item) => (how === 'distribute_x' ? cx(rects.get(it._id)!) : cy(rects.get(it._id)!))
    const ordered = [...items].sort((a, b) => key(a) - key(b))
    if (ordered.length < 3) return doc
    const first = key(ordered[0])
    const step = (key(ordered[ordered.length - 1]) - first) / (ordered.length - 1)
    ordered.forEach((it, i) => {
      const delta = first + i * step - key(it)
      moves.set(it._id, how === 'distribute_x' ? { x: delta, y: 0 } : { x: 0, y: delta })
    })
  }
  return mapTop(doc, ids, (it) => {
    const d = moves.get(it._id)
    return d && (d.x || d.y) ? translateItem(it, d.x, d.y) : it
  })
}

// ------------------------------------------------------------- mirror

/** Flip an item in place about its centre, by flipping its geometry (canvas._mirror_item). */
export function mirrorItem(it: Item, horizontal: boolean): Item {
  if (it.type === 'group') {
    const c = center(qtRect(it))
    const children = it.children.map((ch) => {
      const f = mirrorItem(ch, horizontal)
      const cc = apply(matrixOf(f), center(qtRect(f)))
      return horizontal ? translateItem(f, 2 * (c.x - cc.x), 0) : translateItem(f, 0, 2 * (c.y - cc.y))
    })
    return { ...it, children }
  }
  if (it.type === 'arc') return horizontal ? { ...it, flipH: !it.flipH } : { ...it, flipV: !it.flipV }
  if (it.type === 'image') {
    const flip = horizontal ? mul(translateM(it.iw, 0), scaleM(-1, 1)) : mul(translateM(0, it.ih), scaleM(1, -1))
    const m = mul(it.matrix, flip)
    return { ...it, matrix: m, pos: { x: m[4], y: m[5] } }
  }
  const c = center(qtRect(it))
  const t = mul(translateM(c.x, c.y), mul(scaleM(horizontal ? -1 : 1, horizontal ? 1 : -1), translateM(-c.x, -c.y)))
  const P = (x: number, y: number) => apply(t, { x, y })
  switch (it.type) {
    case 'polygon':
      return { ...it, points: it.points.map(([x, y]) => { const p = P(x, y); return [p.x, p.y] as [number, number] }) }
    case 'line':
    case 'arrow':
    case 'dimension': {
      const a = P(it.x1, it.y1)
      const b = P(it.x2, it.y2)
      const out = { ...it, x1: a.x, y1: a.y, x2: b.x, y2: b.y }
      if (it.type !== 'dimension' && it.bend) {
        const q = P(it.bend[0], it.bend[1])
        ;(out as LineItem).bend = [q.x, q.y]
      }
      return out
    }
    case 'path':
      return { ...it, cmds: mapCmds(t, it.cmds) }
  }
  return it // rect, ellipse, rounded rect and text are symmetric
}

// ------------------------------------------------------------- explode

/** Break a shape's outline into its edges: lines and curve pieces, on the page (canvas._explode_item). */
export function explodeItem(it: Item): Item[] | null {
  if (!['polygon', 'rect', 'ellipse', 'roundrect', 'arc', 'path'].includes(it.type)) return null
  const local = outlineOf(it)
  if (!local || local.length < 2) return null
  const cmds = mapCmds(matrixOf(it), local)
  const pen = { ...(it as Extract<Item, { pen: unknown }>).pen }
  const out: Item[] = []
  let cur: Pt | null = null
  const common = () => ({ _id: newId(), pos: { x: 0, y: 0 }, opacity: it.opacity, rotation: 0, z: 0, scale: 1 })
  for (const c of cmds) {
    if (c[0] === 'M') cur = { x: c[1], y: c[2] }
    else if (c[0] === 'L') {
      const end = { x: c[1], y: c[2] }
      if (cur) out.push({ ...common(), type: 'line', pen, x1: cur.x, y1: cur.y, x2: end.x, y2: end.y })
      cur = end
    } else {
      const start = cur ?? { x: c[1], y: c[2] }
      const seg: PathCmd[] = [['M', start.x, start.y], c]
      out.push({ ...common(), type: 'path', pen, brush: null, cmds: seg })
      cur = { x: c[5], y: c[6] }
    }
  }
  return out.length ? out : null
}

// ----------------------------------------------------------- duplicate

/** Copies of `items` moved by (dx, dy), with fresh ids. */
export const copiesOf = (items: Item[], dx: number, dy: number) => items.map((it) => translateItem(cloneItem(it), dx, dy))

// -------------------------------------------------------------- canvas

/** Resize the page keeping everything where it is; the raster is padded or cut at the right and bottom. */
export function resizeCanvas(doc: Doc, w: number, h: number, dpi = doc.dpi): Doc {
  return { ...doc, width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)), dpi }
}

/** The page fitted round the drawing (or the selection) with a margin: returns the shift applied. */
export function fitToContent(doc: Doc, only: Item[] | null, margin = 10): { doc: Doc; dx: number; dy: number } | null {
  const r = itemsBounds(only?.length ? only : doc.items)
  if (!r) return null
  const dx = Math.round(margin - r.x)
  const dy = Math.round(margin - r.y)
  const w = Math.ceil(r.w) + 2 * margin
  const h = Math.ceil(r.h) + 2 * margin
  return { doc: { ...doc, width: w, height: h, items: doc.items.map((it) => translateItem(it, dx, dy)) }, dx, dy }
}


// ------------------------------------------------------------- styling

/** Apply `fn` to the item and, for groups, to everything inside. */
export function mapDeep(it: Item, fn: (leaf: Item) => Item): Item {
  if (it.type === 'group') return { ...it, children: it.children.map((c) => mapDeep(c, fn)) }
  return fn(it)
}

/** Reverse a line or arrow (its head moves to the other end). */
export function reverseLine<T extends LineItem>(it: T): T {
  return keepPlace(it, { ...it, x1: it.x2, y1: it.y2, x2: it.x1, y2: it.y1 })
}

export type Heads = 'none' | 'end' | 'both'

export const headsOf = (it: LineItem): Heads => (it.type !== 'arrow' ? 'none' : it.head1 ? 'both' : 'end')

/** Arrowheads: a plain line, an arrow (head at the end), or both ends (a web addition). */
export function setHeads(it: LineItem, heads: Heads): LineItem {
  const out: LineItem = { ...it, type: heads === 'none' ? 'line' : 'arrow' }
  if (heads === 'both') out.head1 = true
  else delete out.head1
  return keepPlace(it, out)
}

/** A labelled scale bar whose bar is `lengthMm` long on paper (canvas.place_scale_bar), grouped. */
export function scaleBar(lengthMm: number, label: string, at: Pt, dpi: number, fontSize: (px: number) => number): GroupItem | null {
  const length = (lengthMm / 25.4) * Math.max(dpi, 1)
  if (!(length > 0)) return null
  const thick = Math.max(length * 0.04, 2.5)
  const tick = thick * 2.2
  const x0 = -length / 2
  const ink = '#ff111111'
  const common = () => ({ _id: newId(), pos: { x: 0, y: 0 }, opacity: 1, rotation: 0, z: 0, scale: 1 })
  const parts: Item[] = [
    { ...common(), type: 'rect', pen: { color: ink, width: 1 }, brush: { color: ink }, x: x0, y: 0, w: length, h: thick },
  ]
  for (const xx of [x0, x0 + length]) {
    parts.push({ ...common(), type: 'line', pen: { color: ink, width: Math.max(thick * 0.5, 1) }, x1: xx, y1: -tick + thick, x2: xx, y2: thick })
  }
  const cap: Item = { ...common(), type: 'text', text: label, color: ink, family: 'Segoe UI', size: fontSize(Math.max(Math.trunc(length * 0.2), 12)), bold: false, italic: false }
  const cb = qtRect(cap)
  parts.push({ ...cap, pos: { x: -cb.w / 2, y: thick + tick * 0.2 } })
  const g: GroupItem = { ...common(), type: 'group', children: parts.map((p, i) => ({ ...p, z: i })) }
  const c = center(qtRect(g))
  return { ...g, pos: { x: at.x - c.x, y: at.y - c.y } }
}

/** A room drawn as four solid wall bars with an empty square at each corner (canvas._finish_room). */
export function roomWalls(r: Rect): GroupItem | null {
  if (r.w < 2 || r.h < 2) return null
  const { x, y, w, h } = r
  const t = Math.max(Math.min(w, h) * 0.02, 2)
  const common = () => ({ _id: newId(), pos: { x: 0, y: 0 }, opacity: 1, rotation: 0, z: 0, scale: 1 })
  const parts: Item[] = []
  for (const b of [rectOf(x + t, y, w - 2 * t, t), rectOf(x + t, y + h - t, w - 2 * t, t), rectOf(x, y + t, t, h - 2 * t), rectOf(x + w - t, y + t, t, h - 2 * t)]) {
    parts.push({ ...common(), type: 'rect', pen: { color: '#ff222222', width: 1 }, brush: { color: '#ff222222' }, ...b })
  }
  for (const b of [rectOf(x, y, t, t), rectOf(x + w - t, y, t, t), rectOf(x, y + h - t, t, t), rectOf(x + w - t, y + h - t, t, t)]) {
    parts.push({ ...common(), type: 'rect', pen: { color: '#ff333333', width: 2 }, brush: null, ...b })
  }
  return { ...common(), type: 'group', children: parts.map((p, i) => ({ ...p, z: i })) }
}

/** The measured angle at `v` between v→a and v→b: two arms, an arc and a degree label (canvas._finish_angle). */
export function angleMeasure(v: Pt, a: Pt, b: Pt, pen: { color: string; width: number }, fontSize = 14): GroupItem | null {
  const la = Math.hypot(a.x - v.x, a.y - v.y)
  const lb = Math.hypot(b.x - v.x, b.y - v.y)
  if (la < 1 || lb < 1) return null
  const aa = Math.atan2(a.y - v.y, a.x - v.x)
  const ab = Math.atan2(b.y - v.y, b.x - v.x)
  let delta = ab - aa
  while (delta <= -Math.PI) delta += 2 * Math.PI
  while (delta > Math.PI) delta -= 2 * Math.PI
  const deg = Math.abs((delta * 180) / Math.PI)
  const r = Math.max(Math.min(Math.min(la, lb) * 0.4, 60), 12)
  const common = () => ({ _id: newId(), pos: { x: 0, y: 0 }, opacity: 1, rotation: 0, z: 0, scale: 1 })
  const parts: Item[] = [a, b].map((end) => ({ ...common(), type: 'line' as const, pen: { ...pen }, x1: v.x, y1: v.y, x2: end.x, y2: end.y }))
  const steps = Math.max(Math.trunc(Math.abs(delta) / (Math.PI / 36)) + 1, 2)
  const cmds: PathCmd[] = []
  for (let i = 0; i <= steps; i++) {
    const ang = aa + (delta * i) / steps
    cmds.push([i === 0 ? 'M' : 'L', v.x + r * Math.cos(ang), v.y + r * Math.sin(ang)] as PathCmd)
  }
  parts.push({ ...common(), type: 'path', pen: { ...pen }, brush: null, cmds })
  const mid = aa + delta / 2
  const label: Item = { ...common(), type: 'text', text: `${deg.toFixed(1)}°`, color: pen.color, family: 'Segoe UI', size: fontSize, bold: false, italic: false }
  const lbox = qtRect(label)
  parts.push({ ...label, pos: { x: v.x + (r + 14) * Math.cos(mid) - lbox.w / 2, y: v.y + (r + 14) * Math.sin(mid) - lbox.h / 2 } })
  return { ...common(), type: 'group', children: parts.map((p, i) => ({ ...p, z: i })) }
}
