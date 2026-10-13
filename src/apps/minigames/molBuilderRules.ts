// Molecule Builder: each level gives a formula (C₂H₆O) and how many isomers
// it has; build them all before the clock runs out. Place carbon, nitrogen
// and oxygen atoms on a grid and join them with bonds: clicking a bond again
// makes it double, then triple, then takes it away. Hydrogens fill in by
// themselves (a carbon has four bonds, nitrogen three, oxygen two), so the
// puzzle is the skeleton and where the double bonds go. When the atoms match
// the formula and the structure is new, it is named and kept, and the board
// clears for the next one.
//
// Isomers are told apart by an exact canonical form of the heavy-atom graph
// (every ordering within groups of alike atoms is tried), so a molecule drawn
// two ways counts once. Cis/trans isomers are not told apart. Plain logic
// with no DOM, so it can be tested on its own.

export const STEP = 1 / 60
export const GRID_COLS = 8
export const GRID_ROWS = 6
/** Two atoms can bond when they are this close (in grid steps): neighbours and diagonals. */
export const BOND_REACH = 1.5
export const MAX_ORDER = 3

export type El = 'C' | 'N' | 'O'
export const ELEMENTS: El[] = ['C', 'N', 'O']
export const VALENCE: Record<El, number> = { C: 4, N: 3, O: 2 }

export interface Atom {
  id: number
  el: El
  /** Grid position. */
  x: number
  y: number
}

export interface Bond {
  a: number
  b: number
  order: number
}

export interface Mol {
  atoms: Atom[]
  bonds: Bond[]
}

export interface Isomer {
  name: string
  smiles: string
}

export interface Level {
  formula: string
  /** Every constitutional isomer made of C, N, O and H with normal valences. */
  isomers: Isomer[]
  hint: string
}

export const LEVELS: Level[] = [
  { formula: 'CH4', isomers: [{ name: 'methane', smiles: 'C' }], hint: 'One carbon: its four hydrogens appear by themselves.' },
  { formula: 'C2H6', isomers: [{ name: 'ethane', smiles: 'CC' }], hint: 'Two carbons joined by a single bond.' },
  { formula: 'C2H4', isomers: [{ name: 'ethene', smiles: 'C=C' }], hint: 'Click a bond again to make it double.' },
  { formula: 'C2H2', isomers: [{ name: 'ethyne', smiles: 'C#C' }], hint: 'A third click makes a triple bond.' },
  { formula: 'CH2O', isomers: [{ name: 'formaldehyde', smiles: 'C=O' }], hint: 'Oxygen takes two bonds.' },
  { formula: 'CO2', isomers: [{ name: 'carbon dioxide', smiles: 'O=C=O' }], hint: 'No hydrogen at all: every bond is double.' },
  { formula: 'CH5N', isomers: [{ name: 'methylamine', smiles: 'CN' }], hint: 'Nitrogen takes three bonds.' },
  { formula: 'CHN', isomers: [{ name: 'hydrogen cyanide', smiles: 'C#N' }], hint: 'Carbon and nitrogen share a triple bond.' },
  {
    formula: 'C2H6O',
    isomers: [{ name: 'ethanol', smiles: 'CCO' }, { name: 'dimethyl ether', smiles: 'COC' }],
    hint: 'The oxygen can be at the end or in the middle.',
  },
  {
    formula: 'C2H7N',
    isomers: [{ name: 'ethylamine', smiles: 'CCN' }, { name: 'dimethylamine', smiles: 'CNC' }],
    hint: 'Like ethanol and dimethyl ether, with nitrogen.',
  },
  {
    formula: 'C3H6',
    isomers: [{ name: 'propene', smiles: 'C=CC' }, { name: 'cyclopropane', smiles: 'C1CC1' }],
    hint: 'One double bond, or one ring (use a diagonal bond).',
  },
  {
    formula: 'C3H4',
    isomers: [{ name: 'propyne', smiles: 'C#CC' }, { name: 'allene', smiles: 'C=C=C' }, { name: 'cyclopropene', smiles: 'C1=CC1' }],
    hint: 'Two bonds’ worth of unsaturation: a triple, two doubles, or a ring and a double.',
  },
  {
    formula: 'C3H8O',
    isomers: [{ name: 'propan-1-ol', smiles: 'CCCO' }, { name: 'propan-2-ol', smiles: 'CC(O)C' }, { name: 'methoxyethane', smiles: 'COCC' }],
    hint: 'Two alcohols and an ether.',
  },
  {
    formula: 'C2H4O',
    isomers: [{ name: 'acetaldehyde', smiles: 'CC=O' }, { name: 'ethenol', smiles: 'C=CO' }, { name: 'oxirane', smiles: 'C1CO1' }],
    hint: 'A C=O, a C=C, or a three-membered ring with the oxygen in it.',
  },
  {
    formula: 'C4H10',
    isomers: [{ name: 'butane', smiles: 'CCCC' }, { name: 'isobutane', smiles: 'CC(C)C' }],
    hint: 'A chain, or a branch.',
  },
  {
    formula: 'C3H9N',
    isomers: [
      { name: 'propylamine', smiles: 'CCCN' },
      { name: 'isopropylamine', smiles: 'CC(N)C' },
      { name: 'ethylmethylamine', smiles: 'CCNC' },
      { name: 'trimethylamine', smiles: 'CN(C)C' },
    ],
    hint: 'Nitrogen can carry one, two or three carbons.',
  },
  {
    formula: 'C4H8',
    isomers: [
      { name: 'but-1-ene', smiles: 'C=CCC' },
      { name: 'but-2-ene', smiles: 'CC=CC' },
      { name: 'isobutene', smiles: 'C=C(C)C' },
      { name: 'cyclobutane', smiles: 'C1CCC1' },
      { name: 'methylcyclopropane', smiles: 'CC1CC1' },
    ],
    hint: 'Three alkenes and two rings.',
  },
  {
    formula: 'C4H10O',
    isomers: [
      { name: 'butan-1-ol', smiles: 'CCCCO' },
      { name: 'butan-2-ol', smiles: 'CCC(O)C' },
      { name: '2-methylpropan-1-ol', smiles: 'CC(C)CO' },
      { name: 'tert-butanol', smiles: 'CC(C)(C)O' },
      { name: 'diethyl ether', smiles: 'CCOCC' },
      { name: 'methyl propyl ether', smiles: 'CCCOC' },
      { name: 'methyl isopropyl ether', smiles: 'CC(C)OC' },
    ],
    hint: 'Four alcohols and three ethers.',
  },
]

/** Seconds for a level: a minute plus 30 s per isomer. */
export const levelTime = (l: Level) => 60 + 30 * l.isomers.length
/** Points for an isomer: 100 per heavy atom. */
export const isomerPoints = (heavy: number) => 100 * heavy
export const TIME_BONUS = 5
export const HINT_COST = 150

// ------------------------------------------------------------ chemistry

export const bondSum = (m: Mol, id: number) => m.bonds.reduce((s, b) => s + (b.a === id || b.b === id ? b.order : 0), 0)

/** Hydrogens on an atom (negative = too many bonds). */
export const hydrogens = (m: Mol, a: Atom) => VALENCE[a.el] - bondSum(m, a.id)

export const overbonded = (m: Mol) => m.atoms.filter((a) => hydrogens(m, a) < 0)

export function isConnected(m: Mol): boolean {
  if (!m.atoms.length) return false
  const seen = new Set([m.atoms[0].id])
  const todo = [m.atoms[0].id]
  while (todo.length) {
    const id = todo.pop()!
    for (const b of m.bonds) {
      const o = b.a === id ? b.b : b.b === id ? b.a : null
      if (o !== null && !seen.has(o)) {
        seen.add(o)
        todo.push(o)
      }
    }
  }
  return seen.size === m.atoms.length
}

/** Atom counts, hydrogens included. */
export function countsOf(m: Mol): Record<string, number> {
  const n: Record<string, number> = {}
  for (const a of m.atoms) {
    n[a.el] = (n[a.el] ?? 0) + 1
    n.H = (n.H ?? 0) + Math.max(0, hydrogens(m, a))
  }
  return n
}

/** Hill order: C, H, then the rest alphabetically; "CH4", "C2H6O". */
export function formulaOf(m: Mol): string {
  return hill(countsOf(m))
}

function hill(n: Record<string, number>): string {
  const part = (e: string) => (n[e] ? e + (n[e] > 1 ? n[e] : '') : '')
  const rest = Object.keys(n).filter((e) => e !== 'C' && e !== 'H').sort()
  return n.C ? part('C') + part('H') + rest.map(part).join('') : ['H', ...rest].sort().map(part).join('')
}

/** "C2H6O" → "C₂H₆O". */
export const pretty = (f: string) => f.replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)])

/** Every ordering of a list. */
function permutations<T>(list: T[]): T[][] {
  if (list.length <= 1) return [list]
  const out: T[][] = []
  list.forEach((x, i) => {
    for (const p of permutations([...list.slice(0, i), ...list.slice(i + 1)])) out.push([x, ...p])
  })
  return out
}

/**
 * An exact canonical form: the atoms are grouped by element, hydrogens and
 * number of neighbours, and every ordering within the groups is tried; the
 * smallest description wins. Equal for two drawings of the same molecule.
 */
export function canonical(m: Mol): string {
  const atoms = m.atoms
  const idx = new Map(atoms.map((a, i) => [a.id, i]))
  const n = atoms.length
  const adj: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (const b of m.bonds) {
    const i = idx.get(b.a)!
    const j = idx.get(b.b)!
    adj[i][j] = adj[j][i] = b.order
  }
  const label = (i: number) => `${atoms[i].el}${hydrogens(m, atoms[i])}:${adj[i].filter((o) => o > 0).length}`
  const groups = new Map<string, number[]>()
  for (let i = 0; i < n; i++) {
    const l = label(i)
    groups.set(l, [...(groups.get(l) ?? []), i])
  }
  const keys = [...groups.keys()].sort()
  const head = keys.map((k) => `${k}x${groups.get(k)!.length}`).join(',')
  let best: string | null = null
  const choose = (g: number, order: number[]) => {
    if (g === keys.length) {
      let s = ''
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) s += adj[order[i]][order[j]]
      if (best === null || s < best) best = s
      return
    }
    for (const p of permutations(groups.get(keys[g])!)) choose(g + 1, [...order, ...p])
  }
  choose(0, [])
  return `${head}|${best ?? ''}`
}

/** A small SMILES reader: C, N, O; = and # bonds; branches; ring digits. Atoms get no positions. */
export function parseSmiles(smiles: string): Mol {
  const atoms: Atom[] = []
  const bonds: Bond[] = []
  const stack: number[] = []
  const rings = new Map<string, { atom: number; order: number }>()
  let prev: number | null = null
  let order = 1
  for (const ch of smiles) {
    if (ch === '=') order = 2
    else if (ch === '#') order = 3
    else if (ch === '(') stack.push(prev!)
    else if (ch === ')') prev = stack.pop()!
    else if (/\d/.test(ch)) {
      const open = rings.get(ch)
      if (open) {
        bonds.push({ a: open.atom, b: prev!, order: Math.max(open.order, order) })
        rings.delete(ch)
      } else rings.set(ch, { atom: prev!, order })
      order = 1
    } else if (ch === 'C' || ch === 'N' || ch === 'O') {
      const id = atoms.length
      atoms.push({ id, el: ch, x: 0, y: 0 })
      if (prev !== null) bonds.push({ a: prev, b: id, order })
      prev = id
      order = 1
    } else throw new Error(`Unsupported character "${ch}" in "${smiles}".`)
  }
  return { atoms, bonds }
}

/** Canonical forms of a level's isomers, by name. */
export function isomerKeys(level: Level): Map<string, string> {
  return new Map(level.isomers.map((i) => [canonical(parseSmiles(i.smiles)), i.name]))
}

export type Check =
  | { ok: false; why: 'empty' | 'overbonded' | 'disconnected' | 'formula'; formula: string }
  | { ok: true; name: string; known: boolean; key: string; formula: string }

/** Is the board a molecule of the level's formula? */
export function check(m: Mol, level: Level): Check {
  const formula = formulaOf(m)
  if (!m.atoms.length) return { ok: false, why: 'empty', formula }
  if (overbonded(m).length) return { ok: false, why: 'overbonded', formula }
  if (!isConnected(m)) return { ok: false, why: 'disconnected', formula }
  if (formula !== level.formula) return { ok: false, why: 'formula', formula }
  const key = canonical(m)
  const name = isomerKeys(level).get(key)
  return { ok: true, name: name ?? 'an unlisted isomer', known: !!name, key, formula }
}

// ------------------------------------------------------------ the game

export interface Found {
  key: string
  name: string
  mol: Mol
}

export type BuilderEvent =
  | { type: 'place'; x: number; y: number; el: El }
  | { type: 'remove'; x: number; y: number }
  | { type: 'bond'; a: Atom; b: Atom; order: number }
  | { type: 'select' }
  | { type: 'nope'; why: string }
  | { type: 'found'; name: string; points: number; formula: string }
  | { type: 'again'; name: string }
  | { type: 'level'; level: number; bonus: number }
  | { type: 'hint'; name: string }
  | { type: 'win' }
  | { type: 'timeup' }

export type State = 'play' | 'won' | 'timeup'

export class MolBuilder {
  level = 0
  mol: Mol = { atoms: [], bonds: [] }
  element: El = 'C'
  /** The atom picked first when making a bond. */
  selected: number | null = null
  found: Found[] = []
  timeLeft = levelTime(LEVELS[0])
  score = 0
  isomersFound = 0
  hintsUsed = 0
  /** A missing isomer's name, after a hint. */
  hint: string | null = null
  state: State = 'play'
  stateTime = 0
  /** Seconds the last finished structure stays on the board before it clears. */
  showing = 0
  events: BuilderEvent[] = []
  private ids = 0

  constructor() {
    this.reset()
  }

  get over(): boolean {
    return this.state !== 'play' && this.stateTime >= 1.6
  }

  get current(): Level {
    return LEVELS[this.level]
  }

  reset() {
    this.level = 0
    this.score = 0
    this.isomersFound = 0
    this.hintsUsed = 0
    this.state = 'play'
    this.stateTime = 0
    this.events = []
    this.startLevel()
  }

  private startLevel() {
    this.clear()
    this.found = []
    this.hint = null
    this.timeLeft = levelTime(this.current)
  }

  clear() {
    this.mol = { atoms: [], bonds: [] }
    this.selected = null
    this.showing = 0
  }

  atomAt(x: number, y: number): Atom | undefined {
    return this.mol.atoms.find((a) => a.x === x && a.y === y)
  }

  setElement(el: El) {
    this.element = el
  }

  /** A click on a grid point: place an atom, select one, or bond the selected one to it. */
  click(x: number, y: number) {
    if (this.state !== 'play' || this.showing > 0) return
    if (x < 0 || y < 0 || x >= GRID_COLS || y >= GRID_ROWS) return
    const atom = this.atomAt(x, y)
    if (!atom) {
      const from = this.selected !== null ? this.mol.atoms.find((a) => a.id === this.selected) : undefined
      const placed = this.place(x, y)
      // Placing next to a selected atom bonds them straight away.
      if (from && placed && Math.hypot(from.x - x, from.y - y) <= BOND_REACH) this.bond(from.id, placed.id)
      this.selected = placed ? placed.id : null
      this.afterChange()
      return
    }
    if (this.selected === null || this.selected === atom.id) {
      this.selected = this.selected === atom.id ? null : atom.id
      this.events.push({ type: 'select' })
      return
    }
    const from = this.mol.atoms.find((a) => a.id === this.selected)!
    if (Math.hypot(from.x - atom.x, from.y - atom.y) > BOND_REACH) {
      this.selected = atom.id
      this.events.push({ type: 'select' })
      return
    }
    this.bond(from.id, atom.id)
    this.selected = atom.id
    this.afterChange()
  }

  place(x: number, y: number, el: El = this.element): Atom | null {
    if (this.atomAt(x, y)) return null
    const a: Atom = { id: ++this.ids, el, x, y }
    this.mol.atoms.push(a)
    this.events.push({ type: 'place', x, y, el })
    return a
  }

  /** Raises the bond between two atoms one order (single → double → triple → none). */
  bond(a: number, b: number) {
    const m = this.mol
    const i = m.bonds.findIndex((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))
    let order = 1
    if (i >= 0) {
      order = m.bonds[i].order + 1
      if (order > MAX_ORDER) {
        m.bonds.splice(i, 1)
        order = 0
      } else m.bonds[i].order = order
    } else m.bonds.push({ a, b, order })
    this.events.push({ type: 'bond', a: m.atoms.find((x) => x.id === a)!, b: m.atoms.find((x) => x.id === b)!, order })
  }

  /** Removes the atom at a point (and its bonds). */
  remove(x: number, y: number) {
    if (this.state !== 'play' || this.showing > 0) return
    const atom = this.atomAt(x, y)
    if (!atom) return
    this.mol.atoms = this.mol.atoms.filter((a) => a !== atom)
    this.mol.bonds = this.mol.bonds.filter((b) => b.a !== atom.id && b.b !== atom.id)
    if (this.selected === atom.id) this.selected = null
    this.events.push({ type: 'remove', x, y })
    this.afterChange()
  }

  /** Changes the element of the atom at a point. */
  setAtom(x: number, y: number, el: El) {
    const atom = this.atomAt(x, y)
    if (!atom || this.showing > 0) return
    atom.el = el
    this.events.push({ type: 'place', x, y, el })
    this.afterChange()
  }

  /** After every change: has the player built a new isomer? */
  afterChange(): Check {
    const c = check(this.mol, this.current)
    if (!c.ok) return c
    if (this.found.some((f) => f.key === c.key)) {
      this.events.push({ type: 'again', name: c.name })
      return c
    }
    const points = isomerPoints(this.mol.atoms.length)
    this.found.push({ key: c.key, name: c.name, mol: structuredClone(this.mol) })
    this.score += points
    this.isomersFound++
    if (this.hint === c.name) this.hint = null
    this.events.push({ type: 'found', name: c.name, points, formula: c.formula })
    this.showing = 1.4
    this.selected = null
    return c
  }

  /** The name of an isomer still to find, for HINT_COST points. */
  useHint(): string | null {
    if (this.state !== 'play') return null
    const have = new Set(this.found.map((f) => f.name))
    const missing = this.current.isomers.find((i) => !have.has(i.name))
    if (!missing) return null
    this.hint = missing.name
    this.hintsUsed++
    this.score = Math.max(0, this.score - HINT_COST)
    this.events.push({ type: 'hint', name: missing.name })
    return missing.name
  }

  /** All the listed isomers found. */
  get levelDone(): boolean {
    const have = new Set(this.found.map((f) => f.name))
    return this.current.isomers.every((i) => have.has(i.name))
  }

  update(dt = STEP) {
    this.stateTime += dt
    if (this.state !== 'play') return
    if (this.showing > 0) {
      this.showing -= dt
      if (this.showing <= 0) {
        this.clear()
        if (this.levelDone) this.nextLevel()
      }
      return
    }
    this.timeLeft = Math.max(0, this.timeLeft - dt)
    if (this.timeLeft <= 0) {
      this.state = 'timeup'
      this.stateTime = 0
      this.events.push({ type: 'timeup' })
    }
  }

  private nextLevel() {
    const bonus = Math.round(this.timeLeft * TIME_BONUS)
    this.score += bonus
    if (this.level >= LEVELS.length - 1) {
      this.state = 'won'
      this.stateTime = 0
      this.events.push({ type: 'level', level: this.level + 1, bonus })
      this.events.push({ type: 'win' })
      return
    }
    this.level++
    this.events.push({ type: 'level', level: this.level, bonus })
    this.startLevel()
  }

  /** Builds a whole structure from SMILES on the board (for the AI) and checks it. */
  buildSmiles(smiles: string): Check {
    if (this.state !== 'play') throw new Error('The game is over.')
    if (this.showing > 0) {
      this.showing = 0
      this.clear()
      if (this.levelDone) this.nextLevel()
    }
    const parsed = parseSmiles(smiles)
    if (parsed.atoms.length > GRID_COLS * GRID_ROWS) throw new Error('Too many atoms for the board.')
    this.clear()
    // Lay the atoms out along a snake of the grid; positions are for show only.
    const ids = new Map<number, number>()
    parsed.atoms.forEach((a, i) => {
      const row = Math.floor(i / GRID_COLS)
      const col = row % 2 ? GRID_COLS - 1 - (i % GRID_COLS) : i % GRID_COLS
      const atom: Atom = { id: ++this.ids, el: a.el, x: col, y: row + 1 }
      this.mol.atoms.push(atom)
      ids.set(a.id, atom.id)
    })
    for (const b of parsed.bonds) this.mol.bonds.push({ a: ids.get(b.a)!, b: ids.get(b.b)!, order: b.order })
    return this.afterChange()
  }
}
