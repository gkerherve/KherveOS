// Builds a schematic from a compact description (parts at positions + nets as lists of pins): the
// wires are routed automatically, orthogonally and around other parts. Used by the example library.

import { splitWires } from './editor.ts'
import { GRID, defOf, emptyDoc, newId, newPart, onSegment, partBounds, pinPositions, snap, type Doc, type Part, type PartKind, type Rot } from './model.ts'

export interface PartSpec {
  ref: string
  kind: PartKind
  x: number
  y: number
  value?: string
  rot?: Rot
  mirror?: boolean
  props?: Record<string, string>
}

export interface LayoutSpec {
  parts: PartSpec[]
  /**
   * Nets: name → pins ("R1.2"). "_x" nets are unnamed; "@x" nets are joined by a label at every pin
   * instead of wires; "0" is ground. Any other name is shown as a label on the net.
   */
  nets: Record<string, string[]>
  /** put a named net's label on this pin instead of on a wire: net → pin */
  labelAt?: Record<string, string>
  /** extra labelled stubs: a pin that joins a wired net by name (the net must carry that name or be "0") */
  taps?: { name: string; pin: string }[]
  notes?: { text: string; x: number; y: number }[]
}

interface Seg { x1: number; y1: number; x2: number; y2: number }
type Pt = [number, number]

const seg = (a: Pt, b: Pt): Seg => ({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] })

function overlaps(a: Seg, b: Seg): boolean {
  // collinear overlap with positive length
  if (a.y1 === a.y2 && b.y1 === b.y2 && a.y1 === b.y1) return Math.min(Math.max(a.x1, a.x2), Math.max(b.x1, b.x2)) - Math.max(Math.min(a.x1, a.x2), Math.min(b.x1, b.x2)) > 0
  if (a.x1 === a.x2 && b.x1 === b.x2 && a.x1 === b.x1) return Math.min(Math.max(a.y1, a.y2), Math.max(b.y1, b.y2)) - Math.max(Math.min(a.y1, a.y2), Math.min(b.y1, b.y2)) > 0
  return false
}

export function buildLayout(spec: LayoutSpec): Doc {
  const doc = emptyDoc()
  const byRef = new Map<string, Part>()
  for (const s of spec.parts) {
    const part = newPart(doc, s.kind, s.x, s.y, { ref: s.ref, rot: s.rot ?? 0, mirror: s.mirror ?? false })
    if (s.value !== undefined) part.value = s.value
    if (s.props) Object.assign(part.props, s.props)
    doc.parts.push(part)
    byRef.set(s.ref, part)
  }
  const pinAt = (name: string): { x: number; y: number; part: Part } => {
    const [ref, pin] = name.split('.')
    const part = byRef.get(ref)
    if (!part) throw new Error(`Layout: no part ${ref}`)
    const pp = pinPositions(part).find((q) => q.name === pin)
    if (!pp) throw new Error(`Layout: ${ref} has no pin ${pin} (${defOf(part).pins.map((d) => d.name).join(', ')})`)
    return { x: pp.x, y: pp.y, part }
  }
  const netOfPin = new Map<string, string>()
  for (const [net, pins] of Object.entries(spec.nets)) for (const p of pins) netOfPin.set(p, net)
  const allPins: { x: number; y: number; net: string }[] = []
  for (const sp of spec.parts) for (const pp of pinPositions(byRef.get(sp.ref)!)) allPins.push({ x: pp.x, y: pp.y, net: netOfPin.get(`${sp.ref}.${pp.name}`) ?? '' })
  const bounds = spec.parts.map((s) => ({ ref: s.ref, b: partBounds(byRef.get(s.ref)!) }))
  const routed: { net: string; seg: Seg }[] = []

  const cost = (net: string, path: Pt[]): number => {
    let c = 0
    for (let i = 0; i + 1 < path.length; i++) {
      const sg = seg(path[i], path[i + 1])
      // foreign pins on the path
      for (const q of allPins) if (q.net !== net && onSegment(q.x, q.y, sg.x1, sg.y1, sg.x2, sg.y2)) c += 100
      // collinear overlap with other nets' wires
      for (const r of routed) if (r.net !== net && overlaps(sg, r.seg)) c += 100
      // through the body of a part
      for (const bd of bounds) {
        const b = bd.b
        const lx = Math.min(sg.x1, sg.x2), hx = Math.max(sg.x1, sg.x2), ly = Math.min(sg.y1, sg.y2), hy = Math.max(sg.y1, sg.y2)
        if (hx > b.x1 + 3 && lx < b.x2 - 3 && hy > b.y1 + 3 && ly < b.y2 - 3) c += 40
      }
    }
    return c + (path.length - 2) * 2 + path.slice(1).reduce((s, p, i) => s + Math.abs(p[0] - path[i][0]) + Math.abs(p[1] - path[i][1]), 0) * 0.01
  }

  const candidates = (a: Pt, b: Pt): Pt[][] => {
    const out: Pt[][] = []
    if (a[0] === b[0] || a[1] === b[1]) {
      out.push([a, b])
      for (const d of [-20, 20, -40, 40, -60, 60]) {
        if (a[0] === b[0]) out.push([a, [a[0] + d, a[1]], [b[0] + d, b[1]], b])
        else out.push([a, [a[0], a[1] + d], [b[0], b[1] + d], b])
      }
      return out
    }
    out.push([a, [b[0], a[1]], b], [a, [a[0], b[1]], b])
    const mx = snap((a[0] + b[0]) / 2)
    const my = snap((a[1] + b[1]) / 2)
    out.push([a, [mx, a[1]], [mx, b[1]], b], [a, [a[0], my], [b[0], my], b])
    for (const d of [-40, -20, 20, 40, 60]) {
      out.push([a, [a[0], a[1] + d], [b[0], a[1] + d], b])
      out.push([a, [a[0] + d, a[1]], [a[0] + d, b[1]], b])
    }
    return out
  }

  for (const [name, pins] of Object.entries(spec.nets)) {
    if (pins.length === 0) continue
    if (name.startsWith('@')) {
      const label = name.slice(1)
      for (const p of pins) {
        const q = pinAt(p)
        const dx = q.x - q.part.x
        const dy = q.y - q.part.y
        const horiz = Math.abs(dx) > Math.abs(dy)
        const ex = horiz ? q.x + Math.sign(dx || 1) * 2 * GRID : q.x
        const ey = horiz ? q.y : q.y + Math.sign(dy || 1) * 2 * GRID
        doc.wires.push({ id: newId('w'), x1: q.x, y1: q.y, x2: ex, y2: ey })
        doc.labels.push({ id: newId('l'), name: label, x: ex, y: ey, flip: horiz && dx < 0 })
        routed.push({ net: name, seg: seg([q.x, q.y], [ex, ey]) })
      }
      continue
    }
    const tree: Seg[] = []
    const pts: Pt[] = []
    const pos = pins.map((p) => { const q = pinAt(p); return [q.x, q.y] as Pt })
    const uniq = pos.filter((p, i) => pos.findIndex((q) => q[0] === p[0] && q[1] === p[1]) === i)
    pts.push(uniq[0])
    const remaining = uniq.slice(1)
    while (remaining.length) {
      // the closest (pin, attachment point) pair
      let best: { i: number; target: Pt; d: number } | null = null
      remaining.forEach((p, i) => {
        const targets: Pt[] = [...pts]
        for (const s of tree) {
          const tx = Math.min(Math.max(p[0], Math.min(s.x1, s.x2)), Math.max(s.x1, s.x2))
          const ty = Math.min(Math.max(p[1], Math.min(s.y1, s.y2)), Math.max(s.y1, s.y2))
          targets.push([tx, ty])
        }
        for (const t of targets) {
          const d = Math.abs(t[0] - p[0]) + Math.abs(t[1] - p[1])
          if (!best || d < best.d) best = { i, target: t, d }
        }
      })
      const pick = best!
      const from = remaining.splice(pick.i, 1)[0]
      let bestPath: Pt[] | null = null
      let bc = Infinity
      for (const path of candidates(from, pick.target)) {
        const c = cost(name, path)
        if (c < bc) { bc = c; bestPath = path }
      }
      const path = bestPath!
      for (let k = 0; k + 1 < path.length; k++) {
        const s = seg(path[k], path[k + 1])
        if (s.x1 === s.x2 && s.y1 === s.y2) continue
        tree.push(s)
        routed.push({ net: name, seg: s })
        doc.wires.push({ id: newId('w'), ...s })
      }
      pts.push(from, ...path.slice(1))
    }
    if (!name.startsWith('_') && name !== '0') {
      // a label at the middle of the longest wire, or on the pin when there is no wire
      let at: Pt = uniq[0]
      const pinned = spec.labelAt?.[name]
      if (pinned) { const q = pinAt(pinned); at = [q.x, q.y] } else if (tree.length) {
        const longest = tree.reduce((a, b) => (Math.abs(b.x2 - b.x1) + Math.abs(b.y2 - b.y1) > Math.abs(a.x2 - a.x1) + Math.abs(a.y2 - a.y1) ? b : a))
        const mx = snap((longest.x1 + longest.x2) / 2)
        const my = snap((longest.y1 + longest.y2) / 2)
        at = onSegment(mx, my, longest.x1, longest.y1, longest.x2, longest.y2) ? [mx, my] : [longest.x1, longest.y1]
      }
      doc.labels.push({ id: newId('l'), name, x: at[0], y: at[1] })
    }
  }
  for (const t of spec.taps ?? []) {
    const q = pinAt(t.pin)
    const dx = q.x - q.part.x
    const dy = q.y - q.part.y
    const horiz = Math.abs(dx) > Math.abs(dy)
    const ex = horiz ? q.x + Math.sign(dx || 1) * 2 * GRID : q.x
    const ey = horiz ? q.y : q.y + Math.sign(dy || 1) * 2 * GRID
    doc.wires.push({ id: newId('w'), x1: q.x, y1: q.y, x2: ex, y2: ey })
    doc.labels.push({ id: newId('l'), name: t.name, x: ex, y: ey, flip: horiz && dx < 0 })
  }
  for (const n of spec.notes ?? []) doc.notes.push({ id: newId('n'), text: n.text, x: n.x, y: n.y })
  return splitWires(doc)
}
