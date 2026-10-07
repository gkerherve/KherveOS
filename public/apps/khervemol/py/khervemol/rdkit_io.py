"""Optional RDKit bridge — SMILES / structure files → KherveMol models.

RDKit is a full cheminformatics toolkit with a native Python API (no
Jupyter required). If it is installed, this module unlocks:

* **SMILES → 3D** — parse a SMILES string, add explicit hydrogens, embed a
  real 3D conformer (ETKDG) and clean it up with a force field, then hand
  back a `model.Molecule` with genuine coordinates.
* **SMILES → 2D** — a flat depiction (`Compute2DCoords`) for the sketcher.
* **File import** — ``.mol`` / ``.sdf`` / ``.pdb`` via RDKit's readers.
* **Structure → SMILES** — best-effort canonical SMILES for a built model.

Everything is guarded: `available()` reports whether RDKit is importable,
and the app degrades gracefully (the menu items explain how to enable it)
when it is not. Install with ``pip install rdkit``.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from . import model

try:                                            # pragma: no cover - optional
    from rdkit import Chem
    from rdkit.Chem import AllChem
    _RDKIT = True
except Exception:                               # pragma: no cover
    Chem = None
    AllChem = None
    _RDKIT = False


def available() -> bool:
    return _RDKIT


def _require():
    if not _RDKIT:
        raise RuntimeError(
            "RDKit is not installed. Run 'pip install rdkit' to enable "
            "SMILES parsing and structure-file import.")


def _order(bond):
    """RDKit bond → integer order (aromatic already Kekulised to 1/2)."""
    d = bond.GetBondTypeAsDouble()
    if d >= 2.5:
        return 3
    if d >= 1.5:
        return 2
    return 1


def _atoms_bonds_from_rdmol(m, dim):
    """Extract ``(atoms, bonds)`` from an RDKit mol that already has a
    conformer. *dim* is 3 for (x,y,z) or 2 for (x,y)."""
    try:
        Chem.Kekulize(m, clearAromaticFlags=True)
    except Exception:                           # pragma: no cover
        pass
    conf = m.GetConformer()
    atoms = []
    for atom in m.GetAtoms():
        p = conf.GetAtomPosition(atom.GetIdx())
        if dim == 3:
            atoms.append([atom.GetSymbol(), p.x, p.y, p.z])
        else:
            atoms.append([atom.GetSymbol(), p.x, p.y])
    bonds = [[b.GetBeginAtomIdx(), b.GetEndAtomIdx(), _order(b)]
             for b in m.GetBonds()]
    return atoms, bonds


def _embed3d(m):
    """Add Hs and embed a cleaned 3D conformer in place; returns the mol."""
    m = Chem.AddHs(m)
    params = AllChem.ETKDGv3()
    params.randomSeed = 0xf00d
    if AllChem.EmbedMolecule(m, params) != 0:
        # distance-geometry fallback for awkward inputs
        if AllChem.EmbedMolecule(m, useRandomCoords=True) != 0:
            raise RuntimeError("RDKit could not generate 3D coordinates.")
    try:
        AllChem.MMFFOptimizeMolecule(m)
    except Exception:                           # pragma: no cover
        try:
            AllChem.UFFOptimizeMolecule(m)
        except Exception:
            pass
    return m


def _center(atoms):
    n = len(atoms) or 1
    cx = sum(a[1] for a in atoms) / n
    cy = sum(a[2] for a in atoms) / n
    cz = sum(a[3] for a in atoms) / n if len(atoms[0]) > 3 else 0.0
    for a in atoms:
        a[1] -= cx
        a[2] -= cy
        if len(a) > 3:
            a[3] -= cz


def molecule_from_smiles(smiles, label=None):
    """Build a 3D `model.Molecule` from a SMILES string."""
    _require()
    m = Chem.MolFromSmiles(smiles)
    if m is None:
        raise ValueError(f"Not a valid SMILES string: {smiles!r}")
    m = _embed3d(m)
    atoms, bonds = _atoms_bonds_from_rdmol(m, dim=3)
    _center(atoms)
    return model.Molecule(atoms=atoms, bonds=bonds, name="smiles",
                          label=label or smiles, bond=1.35, rscale=0.9)


def sketch_from_smiles(smiles, with_h=False):
    """Flat 2D depiction of *smiles* → ``(atoms2d, bonds2d)`` in sketch px.

    Heavy atoms only by default (skeletal); *with_h* keeps hydrogens."""
    _require()
    m = Chem.MolFromSmiles(smiles)
    if m is None:
        raise ValueError(f"Not a valid SMILES string: {smiles!r}")
    if with_h:
        m = Chem.AddHs(m)
    AllChem.Compute2DCoords(m)
    atoms, bonds = _atoms_bonds_from_rdmol(m, dim=2)
    scale = 46.0
    for a in atoms:                              # screen y grows downward
        a[1] *= scale
        a[2] *= -scale
    return atoms, bonds


def molecule_from_file(path, label=None):
    """Import a ``.mol`` / ``.sdf`` / ``.pdb`` structure as a 3D Molecule.

    Uses the file's own 3D coordinates when present, else embeds them."""
    _require()
    low = path.lower()
    if low.endswith(".sdf"):
        supplier = Chem.SDMolSupplier(path, removeHs=False)
        m = next((x for x in supplier if x is not None), None)
    elif low.endswith(".pdb"):
        m = Chem.MolFromPDBFile(path, removeHs=False)
    else:
        m = Chem.MolFromMolFile(path, removeHs=False)
    if m is None:
        raise ValueError(f"RDKit could not read a molecule from {path}")
    if m.GetNumConformers() == 0 or not m.GetConformer().Is3D():
        m = _embed3d(m)
    atoms, bonds = _atoms_bonds_from_rdmol(m, dim=3)
    _center(atoms)
    import os
    return model.Molecule(atoms=atoms, bonds=bonds, name="import",
                          label=label or os.path.basename(path),
                          bond=1.35, rscale=0.9)


def _rwmol_from_structure(atoms, bonds):
    """A sanitised RDKit mol from a built (atoms, bonds) model, or None."""
    try:
        rw = Chem.RWMol()
        for a in atoms:
            rw.AddAtom(Chem.Atom(a[0]))
        bt = {1: Chem.BondType.SINGLE, 2: Chem.BondType.DOUBLE,
              3: Chem.BondType.TRIPLE}
        for i, j, o in bonds:
            rw.AddBond(int(i), int(j), bt.get(int(o), Chem.BondType.SINGLE))
        m = rw.GetMol()
        Chem.SanitizeMol(m)
        return m
    except Exception:
        return None


def smiles_from_structure(atoms, bonds):
    """Best-effort canonical SMILES for a built (atoms, bonds) model, or
    None if RDKit can't make chemical sense of it."""
    if not _RDKIT:
        return None
    m = _rwmol_from_structure(atoms, bonds)
    return Chem.MolToSmiles(m) if m is not None else None


def _descriptors(m):
    """Compute a labelled dict of descriptors for an RDKit mol *m*."""
    from rdkit.Chem import Descriptors, rdMolDescriptors
    out = {}

    def _try(key, fn):
        try:
            out[key] = fn()
        except Exception:                           # pragma: no cover
            pass

    _try("Formula", lambda: rdMolDescriptors.CalcMolFormula(m))
    _try("MolWt", lambda: Descriptors.MolWt(m))
    _try("ExactMW", lambda: Descriptors.ExactMolWt(m))
    _try("HeavyAtoms", lambda: Descriptors.HeavyAtomCount(m))
    _try("Heteroatoms", lambda: Descriptors.NumHeteroatoms(m))
    _try("LogP", lambda: Descriptors.MolLogP(m))
    _try("TPSA", lambda: Descriptors.TPSA(m))
    _try("HBD", lambda: Descriptors.NumHDonors(m))
    _try("HBA", lambda: Descriptors.NumHAcceptors(m))
    _try("RotatableBonds", lambda: Descriptors.NumRotatableBonds(m))
    _try("Rings", lambda: rdMolDescriptors.CalcNumRings(m))
    _try("AromaticRings", lambda: rdMolDescriptors.CalcNumAromaticRings(m))
    _try("FractionCSP3", lambda: Descriptors.FractionCSP3(m))
    _try("SMILES", lambda: Chem.MolToSmiles(m))
    _try("InChI", lambda: Chem.MolToInchi(m))
    _try("InChIKey", lambda: Chem.InchiToInchiKey(Chem.MolToInchi(m)))
    return out


def descriptors_from_structure(atoms, bonds):
    """RDKit descriptor dict for a built model, or None if unavailable /
    not interpretable (e.g. a crystal lattice)."""
    if not _RDKIT:
        return None
    m = _rwmol_from_structure(atoms, bonds)
    return _descriptors(m) if m is not None else None


def descriptors_from_smiles(smiles):
    """RDKit descriptor dict for a SMILES string, or None."""
    if not _RDKIT:
        return None
    m = Chem.MolFromSmiles(smiles)
    return _descriptors(m) if m is not None else None
