// RDKit in the browser: the RDKit project's own MinimalLib (npm @rdkit/rdkit,
// WebAssembly) standing in for the desktop's optional RDKit (rdkit_io.py):
// SMILES of a structure (Copy SMILES, Build 3D from 2D sketch), the 2D
// depiction of a molecule (the sketch mirror), and the descriptors of
// Molecule ▸ Properties. MinimalLib has no 3D embedding, so 3D structures
// come from the desktop's own built-in builder, as on a desktop without RDKit.

import type { Atom2D, Bond } from './types'
import type { MainModule, Mol as RDMol } from '@rdkit/rdkit'

type Graph = readonly (readonly [string, ...unknown[]])[]

let loading: Promise<MainModule | null> | null = null
let ready: MainModule | null = null

/** Start loading (once); resolves to null when it cannot run here. */
export function loadRDKit(): Promise<MainModule | null> {
  loading ??= (async () => {
    try {
      const [{ default: init }, { default: wasmUrl }] = await Promise.all([import('@rdkit/rdkit'), import('@rdkit/rdkit/RDKit_minimal.wasm?url')])
      const mod = await (init as unknown as (o: unknown) => Promise<MainModule>)({ locateFile: () => wasmUrl })
      ready = mod
      return mod
    } catch (e) {
      console.warn('[khervemol] RDKit (MinimalLib) is unavailable', e)
      return null
    }
  })()
  return loading
}

export function rdkitAvailable(): boolean {
  return ready !== null
}

/** A V2000 molfile of a built graph — every atom explicit and no coordinates,
 *  as rdkit_io._rwmol_from_structure builds an RWMol (so no stereo is read from geometry). */
export function molblock(atoms: Graph, bonds: readonly Bond[]): string {
  const lines = ['', '  KherveMol', '', `${String(atoms.length).padStart(3)}${String(bonds.length).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`]
  for (const a of atoms) lines.push(`${'0.0000'.padStart(10)}${'0.0000'.padStart(10)}${'0.0000'.padStart(10)} ${a[0].padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`)
  for (const [i, j, o] of bonds) lines.push(`${String(i + 1).padStart(3)}${String(j + 1).padStart(3)}${String(Math.max(1, Math.min(3, o))).padStart(3)}  0`)
  lines.push('M  END')
  return lines.join('\n')
}

function withMol<T>(input: string, fn: (m: RDMol) => T, details?: Record<string, unknown>): T | null {
  if (!ready) return null
  let m: RDMol | null = null
  try {
    m = details ? ready.get_mol(input, JSON.stringify(details)) : ready.get_mol(input)
    if (!m || !m.is_valid()) return null
    return fn(m)
  } catch {
    return null
  } finally {
    m?.delete()
  }
}

/** rdkit_io.smiles_from_structure: canonical SMILES of a graph, or null when RDKit cannot make sense of it. */
export function smilesFromStructure(atoms: Graph, bonds: readonly Bond[]): string | null {
  if (!atoms.length) return null
  return withMol(molblock(atoms, bonds), (m) => m.get_smiles() || null, { removeHs: true })
}

/** rdkit_io.sketch_from_smiles: a flat 2D depiction in sketch pixels (heavy atoms; y grows down). */
export function sketchFromSmiles(smiles: string): { atoms: Atom2D[]; bonds: Bond[] } | null {
  return withMol(smiles, (m) => {
    m.set_new_coords()
    try {
      m.convert_to_kekule_form()
    } catch {
      /* already Kekulé */
    }
    return parseMolblock2D(m.get_molblock())
  })
}

/** The atoms (x, y scaled by 46, y flipped) and bonds of a V2000 molblock. */
export function parseMolblock2D(block: string): { atoms: Atom2D[]; bonds: Bond[] } | null {
  const lines = block.split(/\r?\n/)
  const counts = lines[3] ?? ''
  const na = parseInt(counts.slice(0, 3), 10), nb = parseInt(counts.slice(3, 6), 10)
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return null
  const atoms: Atom2D[] = []
  for (let k = 0; k < na; k++) {
    const ln = lines[4 + k]
    atoms.push([ln.slice(31, 34).trim(), parseFloat(ln.slice(0, 10)) * 46, -parseFloat(ln.slice(10, 20)) * 46])
  }
  const bonds: Bond[] = []
  for (let k = 0; k < nb; k++) {
    const ln = lines[4 + na + k]
    const o = parseInt(ln.slice(6, 9), 10)
    bonds.push([parseInt(ln.slice(0, 3), 10) - 1, parseInt(ln.slice(3, 6), 10) - 1, o === 4 ? 1 : Math.max(1, Math.min(3, o))])
  }
  return { atoms, bonds }
}

/** SMILES of a MOL / SDF record (a 2D drawing to embed with the built-in builder). */
export function smilesFromMolfile(text: string): string | null {
  const record = text.split(/^\$\$\$\$/m)[0]
  return withMol(record, (m) => m.get_smiles() || null, { removeHs: false })
}

/** rdkit_io.descriptors_from_structure (keys as the desktop's _descriptors). */
export function descriptorsFromStructure(atoms: Graph, bonds: readonly Bond[]): Record<string, unknown> | null {
  if (!ready || !atoms.length) return null
  const mod = ready
  return withMol(molblock(atoms, bonds), (m) => {
    const d = JSON.parse(m.get_descriptors()) as Record<string, number>
    const out: Record<string, unknown> = {}
    const put = (key: string, v: unknown) => v !== undefined && v !== null && v !== '' && (out[key] = v)
    put('MolWt', d.amw)
    put('ExactMW', d.exactmw)
    put('HeavyAtoms', d.NumHeavyAtoms)
    put('Heteroatoms', d.NumHeteroatoms)
    put('LogP', d.CrippenClogP)
    put('TPSA', d.tpsa)
    put('HBD', d.NumHBD)
    put('HBA', d.NumHBA)
    put('RotatableBonds', d.NumRotatableBonds)
    put('Rings', d.NumRings)
    put('AromaticRings', d.NumAromaticRings)
    put('FractionCSP3', d.FractionCSP3)
    try {
      put('SMILES', m.get_smiles())
    } catch {
      /* no SMILES */
    }
    try {
      const inchi = m.get_inchi()
      put('InChI', inchi)
      if (inchi) put('InChIKey', mod.get_inchikey_for_inchi(inchi))
    } catch {
      /* no InChI support */
    }
    return out
  }, { removeHs: true })
}
