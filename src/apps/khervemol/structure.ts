// The molecule as a connectivity outline — the pure part of the desktop's
// structure_tree.py: the spanning-tree walk, its root, and which child
// carries each chain on at the same indent.

import type { Atom, Bond } from './types.ts'

export interface WalkRow {
  atom: number
  parent: number | null
  grand: number | null
  order: number
  ring: boolean
}

function heavyAdjacency(atoms: readonly Atom[], bonds: readonly Bond[]): Map<number, number[]> {
  const adj = new Map<number, number[]>()
  atoms.forEach((a, i) => a[0] !== 'H' && adj.set(i, []))
  for (const [i, j] of bonds) {
    if (adj.has(i) && adj.has(j)) {
      adj.get(i)!.push(j)
      adj.get(j)!.push(i)
    }
  }
  return adj
}

function farthest(adj: Map<number, number[]>, start: number): number {
  const seen = new Map<number, number>([[start, 0]])
  const queue = [start]
  while (queue.length) {
    const cur = queue.shift()!
    for (const k of adj.get(cur)!) {
      if (!seen.has(k)) {
        seen.set(k, seen.get(cur)! + 1)
        queue.push(k)
      }
    }
  }
  // max(sorted(seen), key=dist): the lowest index among the farthest
  let best = -1, bestD = -1
  for (const i of [...seen.keys()].sort((a, b) => a - b)) {
    if (seen.get(i)! > bestD) {
      best = i
      bestD = seen.get(i)!
    }
  }
  return best
}

/** One end of the heavy-atom diameter (so a chain is walked end to end). */
export function rootAtom(atoms: readonly Atom[], bonds: readonly Bond[]): number | null {
  if (!atoms.length) return null
  const adj = heavyAdjacency(atoms, bonds)
  if (!adj.size) return 0
  let seed = -1, deg = -1
  for (const i of [...adj.keys()].sort((a, b) => a - b)) {
    if (adj.get(i)!.length > deg) {
      seed = i
      deg = adj.get(i)!.length
    }
  }
  return farthest(adj, farthest(adj, seed))
}

/** Depth-first spanning tree; ring closures come out as leaves. */
export function walk(atoms: readonly Atom[], bonds: readonly Bond[], root: number | null = null): WalkRow[] {
  const out: WalkRow[] = []
  if (!atoms.length) return out
  const adjacency: [number, number, number][][] = atoms.map(() => [])
  bonds.forEach(([i, j, o], bi) => {
    adjacency[i].push([j, o, bi])
    adjacency[j].push([i, o, bi])
  })
  const first = root ?? rootAtom(atoms, bonds) ?? 0
  const seen = new Set<number>()
  const doneRings = new Set<number>()
  const starts = [first, ...atoms.map((_a, i) => i).filter((i) => i !== first)]
  for (const start of starts) {
    if (seen.has(start)) continue
    seen.add(start)
    const stack: [number, number | null, number | null, number][] = [[start, null, null, 0]]
    while (stack.length) {
      const [atom, parent, grand, order] = stack.pop()!
      out.push({ atom, parent, grand, order, ring: false })
      const kids = [...adjacency[atom]].sort((p, q) => {
        const hp = atoms[p[0]][0] === 'H' ? 1 : 0, hq = atoms[q[0]][0] === 'H' ? 1 : 0
        return hp - hq || q[1] - p[1] || p[0] - q[0]
      })
      for (const [k, o, bi] of kids.reverse()) {
        if (seen.has(k)) {
          if (!doneRings.has(bi) && k !== parent) {
            doneRings.add(bi)
            out.push({ atom: k, parent: atom, grand: parent, order: o, ring: true })
          }
          continue
        }
        seen.add(k)
        stack.push([k, atom, parent, o])
      }
    }
  }
  return out
}

/** For each atom, the child that carries its chain on (the biggest heavy branch). */
export function continuations(atoms: readonly Atom[], rows: readonly WalkRow[]): Map<number, number> {
  const children = new Map<number, number[]>()
  for (const r of rows) {
    if (!r.ring && r.parent !== null) {
      if (!children.has(r.parent)) children.set(r.parent, [])
      children.get(r.parent)!.push(r.atom)
    }
  }
  const size = new Map<number, number>()
  for (let n = rows.length - 1; n >= 0; n--) {
    const r = rows[n]
    if (!r.ring) size.set(r.atom, 1 + (children.get(r.atom) ?? []).reduce((s, c) => s + (size.get(c) ?? 0), 0))
  }
  const out = new Map<number, number>()
  for (const [parent, kids] of children) {
    const heavy = kids.filter((k) => atoms[k][0] !== 'H')
    if (!heavy.length) continue
    let best = heavy[0]
    for (const k of heavy) {
      const sk = size.get(k)!, sb = size.get(best)!
      if (sk > sb || (sk === sb && -k > -best)) best = k
    }
    out.set(parent, best)
  }
  return out
}

export interface TreeNode {
  atom: number
  parent: number | null
  grand: number | null
  order: number
  ring: boolean
  children: TreeNode[]
}

/** StructureTree.rebuild's nesting: backbone continuations stay at their parent's level. */
export function buildTree(atoms: readonly Atom[], bonds: readonly Bond[]): { roots: TreeNode[]; parentOf: Map<number, number | null> } {
  const rows = walk(atoms, bonds)
  const keepGoing = continuations(atoms, rows)
  const roots: TreeNode[] = []
  const nodes = new Map<number, TreeNode>()
  const holder = new Map<number, TreeNode[]>()
  const parentOf = new Map<number, number | null>()
  for (const r of rows) {
    const node: TreeNode = { atom: r.atom, parent: r.parent, grand: r.grand, order: r.order, ring: r.ring, children: [] }
    if (r.ring) {
      ;(r.parent !== null && nodes.has(r.parent) ? nodes.get(r.parent)!.children : roots).push(node)
      continue
    }
    parentOf.set(r.atom, r.parent)
    let under: TreeNode[]
    if (r.parent === null) under = roots
    else if (keepGoing.get(r.parent) === r.atom) under = holder.get(r.parent)!
    else under = nodes.get(r.parent)!.children
    under.push(node)
    nodes.set(r.atom, node)
    holder.set(r.atom, under)
  }
  return { roots, parentOf }
}
