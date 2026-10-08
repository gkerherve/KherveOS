// Widget nodes from Python arrive as changes: a subtree the web side already
// has comes as {id, same: 1}. `resolve` swaps those for the cached node (the
// very same object, so React can skip redrawing it) and caches the new ones.

import type { LayoutNode, MainNode, Node } from './types'

export type NodeCache = Map<number, Node>

const isLayout = (x: unknown): x is LayoutNode => !!x && typeof x === 'object' && 'k' in (x as object) && !('id' in (x as object))

function resolveAny(x: Node | LayoutNode | null | undefined, cache: NodeCache): Node | LayoutNode | null {
  if (!x) return null
  if (isLayout(x)) return resolveLayout(x, cache)
  return resolve(x as Node, cache)
}

export function resolveLayout(l: LayoutNode, cache: NodeCache): LayoutNode {
  const out: LayoutNode = { ...l }
  if (l.items) out.items = l.items.map((i) => resolveAny(i, cache))
  if (l.rows) out.rows = l.rows.map(([a, b]) => [resolveAny(a, cache), resolveAny(b, cache)])
  if (l.cells) out.cells = l.cells.map(([r, c, rs, cs, n]) => [r, c, rs, cs, resolveAny(n, cache)])
  return out
}

/** *n* with every `same` reference replaced by the cached node. */
export function resolve(n: Node, cache: NodeCache): Node {
  if (n.same) {
    const hit = cache.get(n.id)
    if (hit) return n.str && hit.str !== n.str ? { ...hit, str: n.str } : hit
    // the web side lost it (should not happen): an empty placeholder
    return { id: n.id, t: 'w' }
  }
  const out: Node = { ...n }
  if (n.l) out.l = resolveLayout(n.l, cache)
  if (n.kids) out.kids = n.kids.map((k) => resolve(k, cache))
  if (n.page) out.page = resolve(n.page, cache)
  if (n.w) out.w = resolve(n.w, cache)
  if (n.widgets) out.widgets = n.widgets.map(([r, c, w]) => [r, c, resolve(w, cache)])
  if (n.overlays) out.overlays = n.overlays.map((o) => resolve(o, cache))
  // a tool bar's widgets (group buttons, spin boxes…) are nodes too; its
  // plain actions are not (no `t`, no `same`)
  if (n.t === 'toolbar' && Array.isArray(n.items))
    out.items = (n.items as Node[]).map((it) => (it && (it.same || it.t) ? resolve(it, cache) : it))
  if (n.t === 'status' && Array.isArray(n.items))
    out.items = (n.items as [Node, number][]).map(([w, p]) => [resolve(w, cache), p])
  if (n.t === 'mainwin') {
    // another main window (the Blueprint): its bars, centre, docks, status
    const m = n as Node & { toolbars?: [number, Node][]; central?: Node; status?: Node | null; docks?: [number, number, string, Node][] }
    const o = out as typeof m
    o.toolbars = (m.toolbars ?? []).map(([a, t]) => [a, resolve(t, cache)])
    if (m.central) o.central = resolve(m.central, cache)
    if (m.status) o.status = resolve(m.status, cache)
    o.docks = (m.docks ?? []).map(([a, id, title, d]) => [a, id, title, resolve(d, cache)])
  }
  const stored = { ...out }
  delete stored.str            // the stretch belongs to the place in a layout
  cache.set(n.id, stored)
  return out
}

export function resolveMain(m: MainNode, cache: NodeCache): MainNode {
  return {
    toolbars: m.toolbars.map(([area, n]) => [area, resolve(n, cache)]),
    central: resolve(m.central, cache),
    status: resolve(m.status, cache),
    docks: m.docks.map(([area, id, title, shown, n]) => [area, id, title, shown, n ? resolve(n, cache) : null]),
  }
}

/** Qt's "&File" → "File" ("&&" stays one "&"). */
export function plainText(text: string | undefined): string {
  return (text ?? '').replace(/&&/g, '\u0000').replace(/&/g, '').replace(/\u0000/g, '&')
}

/** "Cu&t\tCtrl+X" → ["Cut", "Ctrl+X"]. */
export function splitShortcut(text: string | undefined): [string, string | undefined] {
  const t = text ?? ''
  const tab = t.indexOf('\t')
  return tab >= 0 ? [plainText(t.slice(0, tab)), t.slice(tab + 1)] : [plainText(t), undefined]
}
