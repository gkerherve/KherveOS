// Builds a schematic from code: place parts, connect pins with routed wires (checked so that a wire never
// touches something it should not), fall back to net labels where a clean route does not exist. Used by the
// examples, "expression → circuit", the state machine's flip-flop implementation and the tests.
// It remembers what was meant to be connected, so that tests can check the drawing against the intention.

import { emptyDoc, newId, newPart, nextRef, partBounds, pinPositions, shapeOf, snap, onSegment, type Doc, type Kind, type Part, type Rot } from './model.ts'
import { outward, splitWires } from './editor.ts'

type Pt = [number, number]

export interface AddOptions { rot?: Rot; mirror?: boolean; ref?: string }
export interface LinkOptions {
  /** x of the vertical run of a H-V-H route */
  midX?: number
  /** y of the horizontal run of a V-H-V route */
  midY?: number
  /** never use labels: throw when no route exists */
  strict?: boolean
  /** force a net label instead of a wire */
  label?: string | boolean
}

export class Builder {
  doc: Doc = emptyDoc()
  /** pairs of pins that were meant to be on one net */
  links: [string, string][] = []
  /** pins tied to a net name by a label */
  tied: { pin: string; net: string }[] = []
  /** the number of connections that had to use labels */
  labelled = 0
  private nets = 0

  add(kind: Kind, x: number, y: number, props: Record<string, string> = {}, opt: AddOptions = {}): string {
    const part = newPart(this.doc, kind, x, y, { rot: opt.rot ?? 0, mirror: opt.mirror ?? false, ...(opt.ref ? { ref: opt.ref } : {}), props })
    // newPart gave an automatic signal name; an explicit empty name keeps the part unnamed
    if (props.name === '') part.props.name = ''
    this.doc.parts.push(part)
    return part.ref
  }

  part(ref: string): Part {
    const p = this.doc.parts.find((q) => q.ref === ref)
    if (!p) throw new Error(`No part ${ref}.`)
    return p
  }

  pin(rp: string): { x: number; y: number; part: Part; pin: string } {
    const [ref, pin] = rp.split('.')
    const part = this.part(ref)
    const pp = pinPositions(part).find((q) => q.name === pin)
    if (!pp) throw new Error(`${ref} has no pin ${pin}: ${pinPositions(part).map((q) => q.name).join(', ')}.`)
    return { x: pp.x, y: pp.y, part, pin }
  }

  note(x: number, y: number, text: string) { this.doc.notes.push({ id: newId('n'), text, x, y }) }

  label(x: number, y: number, name: string, flip = false) { this.doc.labels.push({ id: newId('l'), name, x, y, flip }) }

  freshNet(prefix = 'n'): string { this.nets++; return `${prefix}${this.nets}` }

  /** A stub with a net label at a pin (as long as it must be to stay clear of everything else). */
  tie(rp: string, net: string, length = 20): void {
    const p = this.pin(rp)
    const out = outward(p.part, p)
    const flip = out.dx < 0
    let len = length
    const own = this.ownWires([p.x, p.y])
    for (const l of [length, length + 10, length + 20, length + 30, length + 50, length + 80]) {
      const end: Pt = [p.x + out.dx * l, p.y + out.dy * l]
      if (this.pathOk([[p.x, p.y], end], [p.x, p.y], [p.x, p.y], own) && this.flagOk(end, net, flip, own)) { len = l; break }
    }
    let ox = out.dx, oy = out.dy
    let fl = flip
    const clear = (dx: number, dy: number, l: number) => {
      const end: Pt = [p.x + dx * l, p.y + dy * l]
      return this.pathOk([[p.x, p.y], end], [p.x, p.y], [p.x, p.y], own) && this.flagOk(end, net, dx < 0, own)
    }
    if (!clear(ox, oy, len)) {
      // no room straight out: leave the pin sideways instead
      const side = out.dx !== 0 ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]]
      let found = false
      for (const [dx, dy] of side) for (const l of [20, 30, 40, 60]) if (!found && clear(dx, dy, l)) { ox = dx; oy = dy; len = l; fl = dx < 0; found = true }
    }
    const ex = p.x + ox * len
    const ey = p.y + oy * len
    this.doc.wires.push({ id: newId('w'), x1: p.x, y1: p.y, x2: ex, y2: ey })
    this.doc.labels.push({ id: newId('l'), name: net, x: ex, y: ey, flip: fl })
    this.tied.push({ pin: rp, net })
  }

  /** A label on a stub that starts at a point of the net (a corner of a hand-routed wire) instead of at a pin. */
  tieAt(rp: string, at: Pt, dir: Pt, net: string, length = 20): void {
    const end: Pt = [at[0] + dir[0] * length, at[1] + dir[1] * length]
    this.doc.wires.push({ id: newId('w'), x1: at[0], y1: at[1], x2: end[0], y2: end[1] })
    this.doc.labels.push({ id: newId('l'), name: net, x: end[0], y: end[1], flip: dir[0] < 0 })
    this.tied.push({ pin: rp, net })
  }

  /** Is there room for a label flag at this point (no part body, wire or other flag under it)? */
  private flagOk(at: Pt, name: string, flip: boolean, own: ReadonlySet<string> = new Set()): boolean {
    const w = 12 + name.length * 6.5
    const r = flip ? { x1: at[0] - w, x2: at[0], y1: at[1] - 8, y2: at[1] + 8 } : { x1: at[0], x2: at[0] + w, y1: at[1] - 8, y2: at[1] + 8 }
    for (const o of this.obstacles()) if (r.x2 >= o.box.x1 && r.x1 <= o.box.x2 && r.y2 >= o.box.y1 && r.y1 <= o.box.y2) return false
    for (const wire of this.doc.wires) {
      if (own.has(wire.id)) continue
      const x1 = Math.min(wire.x1, wire.x2), x2 = Math.max(wire.x1, wire.x2), y1 = Math.min(wire.y1, wire.y2), y2 = Math.max(wire.y1, wire.y2)
      if (x2 >= r.x1 && x1 <= r.x2 && y2 >= r.y1 && y1 <= r.y2) return false
    }
    for (const l of this.doc.labels) {
      const lw = 12 + l.name.length * 6.5
      const q = l.flip ? { x1: l.x - lw, x2: l.x } : { x1: l.x, x2: l.x + lw }
      if (q.x2 >= r.x1 && q.x1 <= r.x2 && Math.abs(l.y - at[1]) < 16) return false
    }
    return true
  }

  // ---- checking a route

  private obstacles() {
    return this.doc.parts.map((p) => ({ part: p, box: partBounds(p) }))
  }

  /** The wires already connected (through wire ends and junctions) to any of the points: their net, which new wires may touch. */
  private ownWires(...points: Pt[]): Set<string> {
    const own = new Set<string>()
    const pts = [...points]
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i]
      for (const w of this.doc.wires) {
        if (own.has(w.id) || !onSegment(x, y, w.x1, w.y1, w.x2, w.y2)) continue
        own.add(w.id)
        pts.push([w.x1, w.y1], [w.x2, w.y2])
      }
      // wires that end on a wire of the net
      for (const w of this.doc.wires) {
        if (own.has(w.id)) continue
        for (const id of own) {
          const o = this.doc.wires.find((q) => q.id === id)!
          if (onSegment(w.x1, w.y1, o.x1, o.y1, o.x2, o.y2) || onSegment(w.x2, w.y2, o.x1, o.y1, o.x2, o.y2)) { own.add(w.id); pts.push([w.x1, w.y1], [w.x2, w.y2]); break }
        }
      }
    }
    return own
  }

  private pathOk(pts: Pt[], a: Pt, b: Pt, own: ReadonlySet<string> = new Set()): boolean {
    const obstacles = this.obstacles()
    const pins: Pt[] = []
    for (const p of this.doc.parts) for (const pp of pinPositions(p)) pins.push([pp.x, pp.y])
    const wires: [Pt, Pt][] = this.doc.wires.filter((w) => !own.has(w.id)).map((w): [Pt, Pt] => [[w.x1, w.y1], [w.x2, w.y2]])
    const flags = this.doc.labels.map((l) => {
      const w = 12 + l.name.length * 6.5
      return l.flip ? { x1: l.x - w, x2: l.x, y1: l.y - 8, y2: l.y + 8 } : { x1: l.x, x2: l.x + w, y1: l.y - 8, y2: l.y + 8 }
    })
    const same = (p: Pt, q: Pt) => p[0] === q[0] && p[1] === q[1]
    for (let i = 0; i + 1 < pts.length; i++) {
      const [p, q] = [pts[i], pts[i + 1]]
      if (same(p, q)) continue
      const x1 = Math.min(p[0], q[0]), x2 = Math.max(p[0], q[0]), y1 = Math.min(p[1], q[1]), y2 = Math.max(p[1], q[1])
      for (const o of obstacles) {
        const bx = o.box
        if (x2 >= bx.x1 && x1 <= bx.x2 && y2 >= bx.y1 && y1 <= bx.y2) return false
      }
      for (const pin of pins) {
        if (same(pin, a) || same(pin, b)) continue
        if (onSegment(pin[0], pin[1], p[0], p[1], q[0], q[1])) return false
      }
      for (const l of flags) {
        // the label flag is a box beside its point
        if (x2 >= l.x1 && x1 <= l.x2 && y2 >= l.y1 && y1 <= l.y2) return false
      }
      for (const [w1, w2] of wires) {
        const wx1 = Math.min(w1[0], w2[0]), wx2 = Math.max(w1[0], w2[0]), wy1 = Math.min(w1[1], w2[1]), wy2 = Math.max(w1[1], w2[1])
        const horizontal = p[1] === q[1]
        const wHorizontal = w1[1] === w2[1]
        if (horizontal === wHorizontal) {
          // parallel: any shared stretch (even a touching end) joins the nets
          if (horizontal ? p[1] === w1[1] && x2 >= wx1 && x1 <= wx2 : p[0] === w1[0] && y2 >= wy1 && y1 <= wy2) return false
        } else {
          // perpendicular: crossing is fine, ending on the other wire is not
          const cross: Pt = horizontal ? [w1[0], p[1]] : [p[0], w1[1]]
          const onNew = onSegment(cross[0], cross[1], p[0], p[1], q[0], q[1])
          const onOld = onSegment(cross[0], cross[1], w1[0], w1[1], w2[0], w2[1])
          if (onNew && onOld) {
            const endNew = same(cross, p) || same(cross, q)
            const endOld = same(cross, w1) || same(cross, w2)
            if ((endNew && !(same(cross, a) || same(cross, b))) || endOld) return false
            if (endNew && (same(cross, a) || same(cross, b)) && !endOld) continue
          }
        }
      }
    }
    return true
  }

  private candidates(a: Pt, b: Pt, da: { dx: number; dy: number }, db: { dx: number; dy: number }, opt: LinkOptions): Pt[][] {
    const out: Pt[][] = []
    const add = (pts: Pt[]) => {
      // drop repeated points and collinear middle points
      const clean: Pt[] = []
      for (const p of pts) if (!clean.length || clean[clean.length - 1][0] !== p[0] || clean[clean.length - 1][1] !== p[1]) clean.push(p)
      for (let i = clean.length - 2; i > 0; i--) {
        const [p, q, r] = [clean[i - 1], clean[i], clean[i + 1]]
        if ((p[0] === q[0] && q[0] === r[0]) || (p[1] === q[1] && q[1] === r[1])) clean.splice(i, 1)
      }
      if (clean.length >= 2) out.push(clean)
    }
    const startAx: 'h' | 'v' = da.dx !== 0 ? 'h' : 'v'
    const endAx: 'h' | 'v' = db.dx !== 0 ? 'h' : 'v'
    const [ax, ay] = a
    const [bx, by] = b
    if (ax === bx || ay === by) add([a, b])
    if (startAx === 'h' && endAx === 'h') {
      const mid = opt.midX !== undefined ? [opt.midX] : [snap((ax + bx) / 2), ...[10, -10, 20, -20, 30, -30, 40, -40, 60, -60, 80, -80, 120, -120].map((d) => snap((ax + bx) / 2) + d)]
      for (const m of mid) add([a, [m, ay], [m, by], b])
    } else if (startAx === 'v' && endAx === 'v') {
      const mid = opt.midY !== undefined ? [opt.midY] : [snap((ay + by) / 2), ...[10, -10, 20, -20, 30, -30, 40, -40, 60, -60, 80, -80, 120, -120].map((d) => snap((ay + by) / 2) + d)]
      for (const m of mid) add([a, [ax, m], [bx, m], b])
    } else if (startAx === 'h' && endAx === 'v') {
      add([a, [bx, ay], b])
      for (const d of [20, 30, 40, 60]) { add([a, [ax + da.dx * d, ay], [ax + da.dx * d, by - db.dy * d], [bx, by - db.dy * d], b]) }
    } else {
      add([a, [ax, by], b])
      for (const d of [20, 30, 40, 60]) { add([a, [ax, ay + da.dy * d], [bx - db.dx * d, ay + da.dy * d], [bx - db.dx * d, by], b]) }
    }
    return out
  }

  private cost(pts: Pt[]): number {
    let len = 0
    for (let i = 0; i + 1 < pts.length; i++) len += Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1])
    return len + 40 * (pts.length - 2)
  }

  private leavesPin(pts: Pt[], d: { dx: number; dy: number }): boolean {
    const dx = Math.sign(pts[1][0] - pts[0][0])
    const dy = Math.sign(pts[1][1] - pts[0][1])
    return dx === d.dx && dy === d.dy
  }

  private addPath(pts: Pt[]) {
    for (let i = 0; i + 1 < pts.length; i++) {
      if (pts[i][0] === pts[i + 1][0] && pts[i][1] === pts[i + 1][1]) continue
      this.doc.wires.push({ id: newId('w'), x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1] })
    }
  }

  /** A wire along points you choose, from one pin through `via` to another (not checked: use it for feedback loops and crossings). */
  route(from: string, to: string, via: Pt[] = []): void {
    this.links.push([from, to])
    const A = this.pin(from)
    const B = this.pin(to)
    this.addPath([[A.x, A.y], ...via, [B.x, B.y]])
  }

  /** Connects two pins: a clean orthogonal wire if there is one, otherwise a net label on both. */
  link(from: string, to: string, opt: LinkOptions = {}): void {
    this.links.push([from, to])
    if (opt.label) {
      this.labelPair(from, to, typeof opt.label === 'string' ? opt.label : undefined)
      return
    }
    const A = this.pin(from)
    const B = this.pin(to)
    const da = outward(A.part, A)
    const db = outward(B.part, B)
    const a: Pt = [A.x, A.y]
    const b: Pt = [B.x, B.y]
    const own = this.ownWires(a, b)
    let best: Pt[] | null = null
    let bestCost = Infinity
    for (const pts of this.candidates(a, b, da, db, opt)) {
      if (!this.leavesPin(pts, da)) continue
      const last = pts[pts.length - 1]
      const prev = pts[pts.length - 2]
      if (Math.sign(prev[0] - last[0]) !== db.dx || Math.sign(prev[1] - last[1]) !== db.dy) continue
      if (!this.pathOk(pts, a, b, own)) continue
      const c = this.cost(pts)
      if (c < bestCost) { best = pts; bestCost = c }
    }
    if (best) { this.addPath(best); return }
    if (opt.strict) throw new Error(`No clean route from ${from} to ${to}.`)
    this.labelPair(from, to)
  }

  private labelPair(from: string, to: string, net?: string) {
    this.labelled++
    const name = net ?? this.existingNet(from) ?? this.existingNet(to) ?? this.freshNet()
    if (!this.tied.some((t) => t.pin === from && t.net === name)) this.tie(from, name)
    if (!this.tied.some((t) => t.pin === to && t.net === name)) this.tie(to, name)
  }

  private existingNet(rp: string): string | undefined {
    return this.tied.find((t) => t.pin === rp)?.net
  }

  /** One driver to several pins with a vertical trunk (junction dots where the branches leave). */
  fan(from: string, to: string[], opt: { spine?: number } = {}): void {
    if (to.length === 0) return
    if (to.length === 1) { this.link(from, to[0]); return }
    for (const t of to) this.links.push([from, t])
    const A = this.pin(from)
    const da = outward(A.part, A)
    const sinks = to.map((t) => this.pin(t))
    const dbs = sinks.map((s) => outward(s.part, s))
    const horizontal = da.dx !== 0 && dbs.every((d) => d.dx === -da.dx)
    const vertical = da.dy !== 0 && dbs.every((d) => d.dy === -da.dy)
    const links = this.links
    const fallback = () => {
      const keep = links.length
      for (const t of to) this.link(from, t)
      links.length = keep // the pairs were recorded already
    }
    if (!horizontal && !vertical) { fallback(); return }
    const axis = horizontal ? 0 : 1
    const other = 1 - axis
    const sign = horizontal ? da.dx : da.dy
    const a: Pt = [A.x, A.y]
    const lo = sign > 0 ? a[axis] + 10 : Math.max(...sinks.map((s) => (axis ? s.y : s.x))) + 10
    const hi = sign > 0 ? Math.min(...sinks.map((s) => (axis ? s.y : s.x))) - 10 : a[axis] - 10
    if (hi < lo) { fallback(); return }
    const mid = snap((lo + hi) / 2)
    const spines = opt.spine !== undefined ? [opt.spine] : [mid, ...[10, -10, 20, -20, 30, -30, 40, -40, 60, -60].map((d) => mid + d)].filter((s) => s >= lo && s <= hi)
    const own = this.ownWires(a, ...sinks.map((q): Pt => [q.x, q.y]))
    const mk = (s: number, p: Pt): Pt => (axis === 0 ? [s, p[1]] : [p[0], s])
    for (const s of spines) {
      const pieces: Pt[][] = []
      const trunkAt = mk(s, a)
      pieces.push([a, trunkAt])
      const coords = [a[other], ...sinks.map((q) => (other === 0 ? q.x : q.y))]
      const c0 = Math.min(...coords), c1 = Math.max(...coords)
      const trunkA: Pt = axis === 0 ? [s, c0] : [c0, s]
      const trunkB: Pt = axis === 0 ? [s, c1] : [c1, s]
      pieces.push([trunkA, trunkB])
      for (const q of sinks) pieces.push([mk(s, [q.x, q.y]), [q.x, q.y]])
      // check all pieces together
      let ok = true
      for (const pc of pieces) {
        if (pc[0][0] === pc[1][0] && pc[0][1] === pc[1][1]) continue
        // the pieces belong to one net, so they may touch each other; each is checked against everything else
        if (!this.pathOk(pc, pc[0], pc[1], own)) { ok = false; break }
      }
      if (!ok) continue
      for (const pc of pieces) this.addPath(pc)
      return
    }
    fallback()
  }

  /** Fan-out when `from` has a net label already, or a plain list of pins to join (all on one net). */
  join(pins: string[], net?: string): void {
    const name = net ?? this.freshNet()
    for (let i = 1; i < pins.length; i++) this.links.push([pins[0], pins[i]])
    for (const p of pins) this.tie(p, name)
    this.labelled++
  }

  build(): Doc {
    return splitWires(this.doc)
  }
}

/** The pins that the builder meant to be connected, as groups (union of links and label ties). */
export function intendedGroups(b: Builder): string[][] {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x)
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    return r
  }
  const union = (x: string, y: string) => { const a = find(x); const c = find(y); if (a !== c) parent.set(a, c) }
  for (const [a, c] of b.links) union(a, c)
  const byNet = new Map<string, string>()
  for (const t of b.tied) {
    find(t.pin)
    const have = byNet.get(t.net)
    if (have) union(have, t.pin); else byNet.set(t.net, t.pin)
  }
  const groups = new Map<string, string[]>()
  for (const x of parent.keys()) { const r = find(x); groups.set(r, [...(groups.get(r) ?? []), x]) }
  return [...groups.values()].map((g) => g.sort()).filter((g) => g.length > 1).sort((a, c) => a[0].localeCompare(c[0]))
}

export { nextRef, shapeOf }
