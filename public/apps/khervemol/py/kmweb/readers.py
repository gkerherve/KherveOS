"""Structure-file readers for KherveMol in the browser.

The desktop imports ``.mol`` / ``.sdf`` / ``.pdb`` with RDKit
(`rdkit_io.molecule_from_file`), which Pyodide does not ship. These
readers do what that function does with a file's own 3D coordinates —
explicit atoms only, bond orders kept (aromatic bonds Kekulé-fied), the
structure centred, ``name="import"``, ``bond=1.35``, ``rscale=0.9`` —
in plain Python. ``.xyz`` (which the desktop writes) is read too, with
bonds from the covalent radii.

A molfile whose coordinates are flat (a 2D drawing) needs a 3D embedding:
`NeedsEmbedding` tells the browser to make a SMILES of it with its RDKit
and build that, as the desktop would embed it with RDKit.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""

import math
import os

from khervemol import chem, elements, model
from khervemol.crystal import BuildError


class NeedsEmbedding(BuildError):
    """The file has no 3D coordinates."""


def _symbol(text):
    s = "".join(ch for ch in str(text).strip() if ch.isalpha())
    if not s:
        return None
    s = s[0].upper() + s[1:].lower()
    if s in elements.NUMBERS:
        return s
    if s[:1] in elements.NUMBERS:
        return s[:1]
    return None


def _center(atoms):
    n = len(atoms) or 1
    c = [sum(a[k] for a in atoms) / n for k in (1, 2, 3)]
    for a in atoms:
        for k in (1, 2, 3):
            a[k] -= c[k - 1]


def _molecule(atoms, bonds, label):
    if not atoms:
        raise BuildError(f"No atoms found in {label}.")
    _center(atoms)
    return model.Molecule(atoms=atoms, bonds=bonds, name="import",
                          label=label, bond=1.35, rscale=0.9)


def _guess_bonds(atoms, slack=1.15):
    """Single bonds wherever two atoms sit closer than their covalent radii
    allow (the way RDKit and viewers bond an .xyz)."""
    out = []
    n = len(atoms)
    rad = [elements.covalent_radius(a[0]) for a in atoms]
    for i in range(n):
        xi, yi, zi = atoms[i][1:4]
        for j in range(i + 1, n):
            d = math.dist((xi, yi, zi), atoms[j][1:4])
            if 0.4 < d <= (rad[i] + rad[j]) * slack:
                out.append([i, j, 1])
    return out


# --------------------------------------------------------------- molfile
def _molblock(lines, label):
    if len(lines) < 4:
        raise BuildError(f"{label} is not a molfile.")
    counts = lines[3]
    if "V3000" in counts:
        return _v3000(lines, label)
    try:
        na, nb = int(counts[0:3]), int(counts[3:6])
    except ValueError:
        raise BuildError(f"{label}: unreadable counts line.")
    atoms, bonds = [], []
    for k in range(na):
        ln = lines[4 + k]
        try:
            x, y, z = float(ln[0:10]), float(ln[10:20]), float(ln[20:30])
        except (ValueError, IndexError):
            parts = ln.split()
            x, y, z = (float(v) for v in parts[0:3])
        el = _symbol(ln[31:34]) or _symbol(ln.split()[3]) or "C"
        atoms.append([el, x, y, z])
    for k in range(nb):
        ln = lines[4 + na + k]
        try:
            i, j, o = int(ln[0:3]), int(ln[3:6]), int(ln[6:9])
        except ValueError:
            i, j, o = (int(v) for v in ln.split()[0:3])
        bonds.append([i - 1, j - 1, 1.5 if o == 4 else max(1, min(3, o))])
    return atoms, bonds


def _v3000(lines, label):
    atoms, bonds, mode = [], [], None
    index = {}
    for raw in lines:
        ln = raw.strip()
        if not ln.startswith("M  V30"):
            continue
        body = ln[6:].strip()
        if body.startswith("BEGIN ATOM"):
            mode = "atom"
        elif body.startswith("BEGIN BOND"):
            mode = "bond"
        elif body.startswith("END"):
            mode = None
        elif mode == "atom":
            p = body.split()
            index[int(p[0])] = len(atoms)
            atoms.append([_symbol(p[1]) or "C", float(p[2]), float(p[3]),
                          float(p[4])])
        elif mode == "bond":
            p = body.split()
            o = int(p[1])
            bonds.append([index[int(p[2])], index[int(p[3])],
                          1.5 if o == 4 else max(1, min(3, o))])
    if not atoms:
        raise BuildError(f"{label}: no atoms in the V3000 block.")
    return atoms, bonds


def read_molfile(text, label):
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    # an SDF holds several records: take the first (SDMolSupplier's first)
    end = next((k for k, ln in enumerate(lines) if ln.startswith("$$$$")),
               len(lines))
    lines = lines[:end]
    atoms, bonds = _molblock(lines, label)
    if atoms and all(abs(a[3]) < 1e-4 for a in atoms):
        raise NeedsEmbedding(f"{label} is a 2D drawing.")
    bonds = chem.kekulize(atoms, bonds)
    return _molecule(atoms, bonds, label)


# ------------------------------------------------------------------- PDB
def read_pdb(text, label):
    atoms, serial = [], {}
    conect = {}
    for ln in text.splitlines():
        rec = ln[0:6].strip().upper()
        if rec in ("ATOM", "HETATM"):
            try:
                x, y, z = float(ln[30:38]), float(ln[38:46]), float(ln[46:54])
            except ValueError:
                continue
            el = _symbol(ln[76:78]) if len(ln) >= 77 else None
            el = el or _symbol(ln[12:16].strip()[:2]) or \
                _symbol(ln[12:16].strip()[:1]) or "C"
            try:
                serial[int(ln[6:11])] = len(atoms)
            except ValueError:
                pass
            atoms.append([el, x, y, z])
        elif rec == "CONECT":
            nums = []
            for k in range(6, len(ln.rstrip()), 5):
                try:
                    nums.append(int(ln[k:k + 5]))
                except ValueError:
                    pass
            if nums:
                conect.setdefault(nums[0], []).extend(nums[1:])
        elif rec in ("ENDMDL", "END") and atoms:
            break
    if conect:
        count = {}
        for a, partners in conect.items():
            for b in partners:
                if a in serial and b in serial and a != b:
                    key = tuple(sorted((serial[a], serial[b])))
                    count[key] = count.get(key, 0) + 1
        # a CONECT line repeats a partner for a double / triple bond, and
        # the bond is listed from both ends
        bonds = [[i, j, max(1, min(3, (n + 1) // 2))]
                 for (i, j), n in sorted(count.items())]
    else:
        bonds = _guess_bonds(atoms)
    return _molecule(atoms, bonds, label)


# ------------------------------------------------------------------- XYZ
def read_xyz(text, label):
    lines = text.splitlines()
    atoms = []
    try:
        n = int(lines[0].split()[0])
        body = lines[2:2 + n]
    except (ValueError, IndexError):
        body = lines
    for ln in body:
        p = ln.split()
        if len(p) < 4:
            continue
        el = _symbol(p[0])
        try:
            x, y, z = float(p[1]), float(p[2]), float(p[3])
        except ValueError:
            continue
        if el:
            atoms.append([el, x, y, z])
    return _molecule(atoms, _guess_bonds(atoms), label)


def read(name, text):
    label = os.path.basename(name)
    low = name.lower()
    if low.endswith(".pdb") or low.endswith(".ent"):
        return read_pdb(text, label)
    if low.endswith(".xyz"):
        return read_xyz(text, label)
    return read_molfile(text, label)
