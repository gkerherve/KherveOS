// Everything kReaction asks of RDKit, written against the module object only (no bundler imports), so that the
// tests can run it in Node: validity and canonical SMILES, the atoms of a molecule, SVG depictions, descriptors
// and the reaction engine (reaction SMARTS) behind "Predict products". The loader is rdkit.ts.

import type { MainModule, Mol } from '@rdkit/rdkit'
import { ATOMIC_WEIGHTS, type Counts } from './formula.ts'
import type { Template } from './templates.ts'

type RD = MainModule

const SYMBOLS = Object.keys(ATOMIC_WEIGHTS)

/** Atom symbols by atomic number − 1 (the table is in order of Z). */
export function symbolOf(z: number): string {
  return SYMBOLS[z - 1] ?? `Z${z}`
}

function withMol<T>(rd: RD, input: string, fn: (m: Mol) => T): T | null {
  let m: Mol | null = null
  try {
    m = rd.get_mol(input)
    if (!m || !m.is_valid()) return null
    return fn(m)
  } catch {
    return null
  } finally {
    m?.delete()
  }
}

export function isValidSmiles(rd: RD, smiles: string): boolean {
  return withMol(rd, smiles, () => true) === true
}

export function canonicalSmiles(rd: RD, smiles: string): string | null {
  return withMol(rd, smiles, (m) => m.get_smiles())
}

/** Atoms (with implicit hydrogens) and net charge from RDKit's JSON of a molecule. */
export function compositionFromJson(json: string): { atoms: Counts; charge: number } {
  const doc = JSON.parse(json) as {
    defaults?: { atom?: { z?: number; impHs?: number; chg?: number } }
    molecules: { atoms: { z?: number; impHs?: number; chg?: number }[] }[]
  }
  const d = doc.defaults?.atom ?? {}
  const atoms: Counts = {}
  let charge = 0
  for (const mol of doc.molecules) {
    for (const a of mol.atoms) {
      const sym = symbolOf(a.z ?? d.z ?? 6)
      atoms[sym] = (atoms[sym] ?? 0) + 1
      const h = a.impHs ?? d.impHs ?? 0
      if (h) atoms.H = (atoms.H ?? 0) + h
      charge += a.chg ?? d.chg ?? 0
    }
  }
  return { atoms, charge }
}

export function molComposition(rd: RD, smiles: string): { atoms: Counts; charge: number } | null {
  return withMol(rd, smiles, (m) => compositionFromJson(m.get_json()))
}

export interface DepictOptions {
  width?: number
  height?: number
  /** Extra MolDraw options (e.g. highlighted atoms). */
  extra?: Record<string, unknown>
}

/** An SVG drawing (RDKit's own colours; see svgtheme.ts), or null when the SMILES is invalid. */
export function depict(rd: RD, smiles: string, opts: DepictOptions = {}): string | null {
  const details = JSON.stringify({
    width: opts.width ?? 220, height: opts.height ?? 160, clearBackground: false, bondLineWidth: 2, padding: 0.08, ...opts.extra,
  })
  return withMol(rd, smiles, (m) => m.get_svg_with_highlights(details))
}

export interface Descriptors {
  amw?: number
  exactmw?: number
  logp?: number
  tpsa?: number
  hbd?: number
  hba?: number
  rotatable?: number
  rings?: number
  heavy?: number
  inchi?: string
  inchikey?: string
}

export function descriptors(rd: RD, smiles: string): Descriptors | null {
  return withMol(rd, smiles, (m) => {
    const d = JSON.parse(m.get_descriptors()) as Record<string, number>
    const out: Descriptors = {
      amw: d.amw, exactmw: d.exactmw, logp: d.CrippenClogP, tpsa: d.tpsa, hbd: d.NumHBD, hba: d.NumHBA,
      rotatable: d.NumRotatableBonds, rings: d.NumRings, heavy: d.NumHeavyAtoms,
    }
    try {
      const inchi = m.get_inchi()
      if (inchi) {
        out.inchi = inchi
        out.inchikey = rd.get_inchikey_for_inchi(inchi)
      }
    } catch {
      /* this build has no InChI */
    }
    return out
  })
}

// ------------------------------------------------------------------ the reaction engine

export interface Prediction {
  template: Template
  /** Canonical SMILES of the products of one outcome. */
  products: string[]
  /** Indices into the reactants given, in template order. */
  from: number[]
  /** The reactants of this outcome (canonical SMILES), in template order. */
  reactants: string[]
}

/** Index tuples of length n chosen from `count` reactants (distinct when there are enough, else with repeats). */
export function assignments(count: number, n: number): number[][] {
  if (count === 0) return []
  const out: number[][] = []
  const distinct = count >= n
  const rec = (cur: number[]) => {
    if (cur.length === n) {
      out.push(cur.slice())
      return
    }
    for (let i = 0; i < count; i++) {
      if (distinct && cur.includes(i)) continue
      cur.push(i)
      rec(cur)
      cur.pop()
    }
  }
  rec([])
  return out
}

/** Number of reactant templates in a reaction SMARTS. */
export function reactantCount(smarts: string): number {
  return smarts.split('>>')[0].split('.').length
}

/** Runs one template on the reactants (all ways of matching them) and returns the distinct outcomes. */
export function runTemplate(rd: RD, tpl: Template, reactants: string[], maxOutcomes = 40): Prediction[] {
  const seen = new Set<string>()
  const out: Prediction[] = []
  for (const smarts of tpl.smarts) {
    let rxn: ReturnType<RD['get_rxn']> = null
    try {
      rxn = rd.get_rxn(smarts)
    } catch {
      rxn = null
    }
    if (!rxn) continue
    try {
      for (const pick of assignments(reactants.length, reactantCount(smarts))) {
        const mols: Mol[] = []
        const list = new rd.MolList()
        try {
          for (const i of pick) {
            const m = rd.get_mol(reactants[i])
            if (!m || !m.is_valid()) throw new Error('invalid reactant')
            mols.push(m)
            list.append(m)
          }
          const sets = rxn.run_reactants(list, 60)
          try {
            for (let a = 0; a < sets.size(); a++) {
              const ml = sets.get(a)
              if (!ml) continue
              const prods: string[] = []
              let ok = true
              for (let b = 0; b < ml.size(); b++) {
                const p = ml.at(b)
                if (!p) {
                  ok = false
                  continue
                }
                // products come back unsanitised: round-trip through SMILES to canonicalise and validate
                const smi = canonicalSmiles(rd, p.get_smiles())
                if (smi === null) ok = false
                else prods.push(smi)
                p.delete()
              }
              ml.delete()
              if (!ok || prods.length === 0) continue
              const key = prods.slice().sort().join('.')
              if (seen.has(key) || out.length >= maxOutcomes) continue
              seen.add(key)
              out.push({ template: tpl, products: prods, from: pick, reactants: pick.map((i) => reactants[i]) })
            }
          } finally {
            sets.delete()
          }
        } catch {
          /* these reactants do not fit the template in this order */
        } finally {
          list.delete()
          for (const m of mols) m.delete()
        }
      }
    } finally {
      rxn.delete()
    }
  }
  return out
}

/** Every template applied to the reactants; templates that produce nothing are left out. */
export function predictAll(rd: RD, templates: readonly Template[], reactants: string[]): Prediction[] {
  const canon = reactants.map((r) => canonicalSmiles(rd, r)).filter((x): x is string => x !== null)
  const out: Prediction[] = []
  for (const t of templates) {
    for (const p of runTemplate(rd, t, canon)) out.push(p)
  }
  return out
}
