// The structure as the Python engine sends it (kmweb/bridge.py mol_state) —
// the desktop's model.Molecule, plus a few read-outs.

/** [element, x, y, z] with an optional 5th slot: the atom's colour / lattice-site tint. */
export type Atom = [string, number, number, number] | [string, number, number, number, string]
/** [i, j, order] */
export type Bond = [number, number, number]
export type Vec3 = [number, number, number]
/** [p1, p2, "solid" | "dash"] */
export type Edge = [Vec3, Vec3, string]

export interface Note {
  kind: 'text' | 'arrow' | string
  text?: string
  pos?: Vec3
  p1?: Vec3
  p2?: Vec3
  size?: number
  color?: string
  bold?: boolean
  double?: boolean
}

export interface Group {
  name: string
  start: number
  count: number
}

export interface Mol {
  name: string
  label: string
  crystal: boolean
  atoms: Atom[]
  bonds: Bond[]
  edges: Edge[] | null
  cell_visible: boolean
  notes: Note[] | null
  az: number
  el: number
  bond: number
  rscale: number
  cells: [number, number, number]
  tilts: Record<string, [number, number, number]>
  colors: Record<string, string>
  poly: boolean
  groups: Group[]
  can_stack: boolean
  stacked: boolean
  owners: string[] | null
  members: Record<string, number[]> | null
  has_animation: boolean
  reaction: string | null
  formula: string
  params: string | null
  anchor_base: { atoms: Atom[]; edges: [Vec3, Vec3][]; rscale: number; gl: boolean } | null
}

/** A 2D sketch: atoms [el, x, y], bonds [i, j, order]. */
export type Atom2D = [string, number, number]
export interface Sketch {
  atoms: Atom2D[]
  bonds: Bond[]
}

/** model.Molecule(name="empty"): what the viewer holds before anything is loaded. */
export function emptyMol(): Mol {
  return {
    name: 'empty', label: 'empty', crystal: false, atoms: [], bonds: [], edges: null, cell_visible: true, notes: null,
    az: (28 * Math.PI) / 180, el: (20 * Math.PI) / 180, bond: 1.6, rscale: 0.92, cells: [1, 1, 1], tilts: {}, colors: {},
    poly: false, groups: [], can_stack: false, stacked: false, owners: null, members: null, has_animation: false,
    reaction: null, formula: '', params: null, anchor_base: null,
  }
}

/** document.mol_to_dict of a state (what the engine reads back, e.g. "the molecule I drew"). */
export function molToDict(m: Mol): Record<string, unknown> {
  return {
    name: m.name, label: m.label, az: m.az, el: m.el, bond: m.bond, rscale: m.rscale, crystal: m.crystal,
    atoms: m.atoms, bonds: m.bonds, edges: m.edges, notes: m.notes, reaction: m.reaction, cell_visible: m.cell_visible,
    groups: m.groups, cells: m.cells, tilts: m.tilts, colors: m.colors, poly: m.poly,
  }
}
