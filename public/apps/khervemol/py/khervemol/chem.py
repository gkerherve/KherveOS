"""Turn the Qt-free chemistry data into viewer `model.Molecule`s.

The libraries (`compounds`, `crystal_library`, `nano`, `surface`) know
atoms and bonds in ångström but nothing about the viewer. This module is
the bridge:

* `compound_model` / `smiles_model` — a library compound or any SMILES,
  built by the pure-Python embedder in `smiles` (no RDKit), with aromatic
  bonds Kekulé-fied so every order reads as 1 / 2 / 3;
* `crystal_model` — a crystal's unit cell repeated ``nx × ny × nz``
  times, atoms on the cell faces drawn in every cell they touch so the
  block looks complete, the cell outline as edges, and bonds found from
  the crystal's nearest-neighbour distances;
* `surface_model` — a slab cut along any (hkl) plane;
* `nano_model` — graphene, ribbons, nanotubes, fullerenes.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

import math
import random

from . import compounds, crystal_library, elements, nano, smiles, surface
from .crystal import BuildError
from .model import DEFAULT_AZ, DEFAULT_EL, Molecule

#: most atoms a crystal / surface block may hold (the GL viewer copes,
#: the structure tree and bond search need a ceiling)
MAX_ATOMS = 12000
#: bond spread for molecules, so the sticks read (crystals stay 1.0)
MOLECULE_BOND = 1.6

_NORMAL_VALENCE = {"B": 3, "C": 4, "N": 3, "O": 2, "P": 3, "S": 2,
                   "Se": 2, "As": 3}


# --------------------------------------------------------------- Kekulé
def _target_valence(element, charge):
    base = _NORMAL_VALENCE.get(element, 0)
    if element in ("N", "P", "As", "O", "S", "Se"):
        return base + charge
    if element == "B":
        return base - charge
    return base - abs(charge)


def kekulize(atoms, bonds, charges=None):
    """Bond orders (1, 2, 3) with the 1.5 aromatic bonds given alternating
    single / double assignments; a bond list of ``[i, j, order]``.

    Aromatic atoms that still lack a valence (a pyridine N, a benzene C)
    take one double bond each; ring atoms already saturated (pyrrole NH,
    furan O) take none. Where no perfect assignment exists the leftovers
    stay single."""
    charges = charges or [0] * len(atoms)
    order = [[i, j, o] for i, j, o in bonds]
    total = [0.0] * len(atoms)
    aromatic = []
    for b, (i, j, o) in enumerate(order):
        w = 1.0 if o == 1.5 else float(o)
        total[i] += w
        total[j] += w
        if o == 1.5:
            aromatic.append(b)
    if not aromatic:
        return [[i, j, int(o)] for i, j, o in order]
    el = [a[0] for a in atoms]
    need = {}
    nbrs = {}
    for b in aromatic:
        i, j, _o = order[b]
        for a in (i, j):
            nbrs.setdefault(a, []).append((b, j if a == i else i))
    for a in nbrs:
        if _target_valence(el[a], charges[a]) - total[a] >= 0.5:
            need[a] = True
    matched = {}                        # atom -> partner via a double bond
    doubled = set()

    def solve(free):
        free = [a for a in free if a not in matched]
        if not free:
            return True
        # the most constrained atom first
        cand = {a: [(b, n) for b, n in nbrs[a]
                    if n in need and n not in matched] for a in free}
        a = min(free, key=lambda x: len(cand[x]))
        for b, n in cand[a]:
            matched[a], matched[n] = n, a
            doubled.add(b)
            if solve([x for x in free if x not in matched]):
                return True
            del matched[a], matched[n]
            doubled.discard(b)
        return False

    for comp in _components(need, nbrs):
        if not solve(comp):
            # no perfect match: keep what a greedy pass can do
            for a in comp:
                if a in matched:
                    continue
                for b, n in nbrs[a]:
                    if n in need and n not in matched:
                        matched[a], matched[n] = n, a
                        doubled.add(b)
                        break
    out = []
    for b, (i, j, o) in enumerate(order):
        if o == 1.5:
            out.append([i, j, 2 if b in doubled else 1])
        else:
            out.append([i, j, int(round(o))])
    return out


def _components(need, nbrs):
    seen, out = set(), []
    for a in need:
        if a in seen:
            continue
        stack, comp = [a], []
        seen.add(a)
        while stack:
            x = stack.pop()
            comp.append(x)
            for _b, n in nbrs.get(x, ()):
                if n in need and n not in seen:
                    seen.add(n)
                    stack.append(n)
        out.append(comp)
    return out


# ------------------------------------------------------------ orientation
def orient(atoms):
    """Coordinates of a molecule turned so its longest axis lies along x,
    the next along z (up on screen) and the shortest along y (depth): a
    flat molecule then faces the viewer instead of showing its edge.
    Returns new centred (x, y, z) rows."""
    n = len(atoms)
    if n < 3:
        pts = [(a[1], a[2], a[3]) for a in atoms]
        if n == 2:                       # a diatomic lies along x
            d = [pts[1][i] - pts[0][i] for i in range(3)]
            length = math.sqrt(sum(v * v for v in d)) or 1.0
            return [(-length / 2, 0.0, 0.0), (length / 2, 0.0, 0.0)]
        return [(0.0, 0.0, 0.0)] * n
    cx = [sum(a[1 + i] for a in atoms) / n for i in range(3)]
    p = [[a[1 + i] - cx[i] for i in range(3)] for a in atoms]
    cov = [[sum(q[i] * q[j] for q in p) / n for j in range(3)]
           for i in range(3)]
    axes = _eigen(cov)                   # largest first
    return [(sum(q[i] * axes[0][i] for i in range(3)),
             sum(q[i] * axes[2][i] for i in range(3)),
             sum(q[i] * axes[1][i] for i in range(3))) for q in p]


def _eigen(m, sweeps=60):
    """Eigenvectors of a symmetric 3x3 (Jacobi), largest eigenvalue first,
    as a right-handed orthonormal set."""
    a = [row[:] for row in m]
    v = [[1.0 if i == j else 0.0 for j in range(3)] for i in range(3)]
    for _ in range(sweeps):
        p, q = max(((0, 1), (0, 2), (1, 2)), key=lambda t: abs(a[t[0]][t[1]]))
        if abs(a[p][q]) < 1e-12:
            break
        th = 0.5 * math.atan2(2 * a[p][q], a[q][q] - a[p][p])
        c, s = math.cos(th), math.sin(th)
        for k in range(3):
            akp, akq = a[k][p], a[k][q]
            a[k][p], a[k][q] = c * akp - s * akq, s * akp + c * akq
        for k in range(3):
            apk, aqk = a[p][k], a[q][k]
            a[p][k], a[q][k] = c * apk - s * aqk, s * apk + c * aqk
        for k in range(3):
            vkp, vkq = v[k][p], v[k][q]
            v[k][p], v[k][q] = c * vkp - s * vkq, s * vkp + c * vkq
    order = sorted(range(3), key=lambda i: -a[i][i])
    vecs = [[v[k][i] for k in range(3)] for i in order]
    x, y = vecs[0], vecs[1]
    z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2],
         x[0] * y[1] - x[1] * y[0]]
    return [x, y, z]



# ------------------------------------------------------------- compounds
def to_model(compound, name=None, label=None, rscale=0.9, bond=MOLECULE_BOND,
             crystal=False, edges=None):
    """A viewer `Molecule` from a `smiles.Compound`."""
    bonds = kekulize(compound.atoms, compound.bonds, compound.charges)
    atoms = [list(a) for a in compound.atoms]
    if not crystal and len(atoms) >= 3:
        for a, p in zip(atoms, orient(atoms)):
            a[1:] = p
    return Molecule(atoms, bonds,
                    name=name or compound.key or compound.name,
                    label=label or compound.name, az=DEFAULT_AZ, el=DEFAULT_EL,
                    bond=bond, rscale=rscale, crystal=crystal, edges=edges)


def smiles_model(text, name="", key=""):
    """3D viewer molecule from SMILES with the built-in embedder; raises
    `smiles.SmilesError` for input it cannot read."""
    c = smiles.from_smiles(text, name=name or text, key=key)
    return to_model(c, name=key or "smiles", label=name or text)


def compound_model(key):
    """A library compound (see `compounds.COMPOUNDS`) or a nano structure
    by key/name."""
    c = compounds.get(key)
    return to_model(c)


def compound_keys():
    return list(compounds.COMPOUNDS)


# --------------------------------------------------------------- crystals
def _pair_cutoffs(crystal, slack=1.12):
    """{(el1, el2) sorted: max bond length Å} from the crystal's nearest
    distances."""
    out = {}
    for e1, e2, d in crystal.bonds:
        out[tuple(sorted((e1, e2)))] = d * slack
    out.update(getattr(crystal, "cutoffs", None) or {})
    return out


# ---------------------------------------------------------------- doping
def parse_dope(value):
    """``[(host, dopant, fraction)]`` from a list of triples or text such
    as ``"Nb:Mo:0.1, Ti:Zr:0.05"``; BuildError when it cannot be read."""
    if not value:
        return []
    if isinstance(value, str):
        value = [part.split(":") for part in value.replace(";", ",")
                 .split(",") if part.strip()]
    out = []
    for row in value:
        try:
            host, dop, frac = row
            host = str(host).strip().capitalize()
            dop = str(dop).strip().capitalize()
            frac = float(frac)
        except (TypeError, ValueError):
            raise BuildError("dope is host:dopant:fraction, e.g. "
                             "Nb:Mo:0.1.")
        if not (elements.NUMBERS.get(host) and elements.NUMBERS.get(dop)):
            raise BuildError(f"Unknown element in dope {host}:{dop}.")
        if not 0 <= frac <= 1:
            raise BuildError("A dopant fraction runs from 0 to 1.")
        out.append((host, dop, frac))
    return out


def substitute(elems, rules, seed=7):
    """*elems* (a list of element symbols, changed in place and returned)
    with ``round(n x fraction)`` randomly chosen host atoms of each
    ``(host, dopant, fraction)`` rule substituted — the same choice for
    the same *seed*."""
    rng = random.Random(seed)
    for host, dop, frac in parse_dope(rules):
        idx = [i for i, e in enumerate(elems) if e == host]
        for i in sorted(rng.sample(idx, round(len(idx) * frac))):
            elems[i] = dop
    return elems


def _dope_cutoffs(cutoffs, rules):
    """A dopant bonds like the host it replaces."""
    out = dict(cutoffs)
    for host, dop, _f in parse_dope(rules):
        for (e1, e2), d in cutoffs.items():
            if e1 == host:
                out.setdefault(tuple(sorted((dop, e2))), d)
            if e2 == host:
                out.setdefault(tuple(sorted((e1, dop))), d)
            if e1 == e2 == host:
                out.setdefault((dop, dop), d)
    return out


# ------------------------------------------------------ whole polyhedra
def complete_polyhedra(els, pts, pool, poly):
    """Whole polyhedra at a cut: every centre of *els*/*pts* gets all its
    ligands within ``poly['cutoff']`` — taken from the atoms themselves or
    from *pool* (``[(el, xyz)]``, the bulk around them: periodic images and
    the layers beyond the cut) — and ligands bonded to no centre are
    dropped, so a slab of isolated polyhedra (scheelite NbO4) stays
    stoichiometric; shared ligands (rutile) are kept once. Returns new
    ``(els, pts)``."""
    centre, ligand, cut = poly["centre"], poly["ligand"], poly["cutoff"]
    cands = [p for e, p in zip(els, pts) if e == ligand]
    cands += [p for e, p in pool if e == ligand]
    grid = {}
    for p in cands:
        grid.setdefault(tuple(int(math.floor(x / cut)) for x in p),
                        []).append(p)
    keep, seen = [], set()
    for e, p in zip(els, pts):
        if e != centre:
            continue
        g = tuple(int(math.floor(x / cut)) for x in p)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for q in grid.get((g[0] + dx, g[1] + dy, g[2] + dz), ()):
                        k = tuple(round(x, 3) for x in q)
                        if k not in seen and 1e-6 < math.dist(p, q) <= cut:
                            seen.add(k)
                            keep.append(q)
    out_e = [e for e in els if e != ligand]
    out_p = [p for e, p in zip(els, pts) if e != ligand]
    return out_e + [ligand] * len(keep), out_p + keep


def _nn(crystal):
    """The shortest bond length Å (2.5 when the crystal names none)."""
    ds = [d for _a, _b, d in crystal.bonds]
    ds += [d / 1.12 for d in (getattr(crystal, "cutoffs", None) or {})
           .values()]
    return min(ds, default=2.5)


def find_bonds(points, elems, cutoffs):
    """[i, j, 1] for every pair whose distance is under its element
    pair's cutoff — a hash grid, so thousands of atoms stay quick."""
    if not cutoffs:
        return []
    cell = max(cutoffs.values())
    grid = {}
    for k, p in enumerate(points):
        grid.setdefault((int(math.floor(p[0] / cell)),
                         int(math.floor(p[1] / cell)),
                         int(math.floor(p[2] / cell))), []).append(k)
    out = []
    for (gx, gy, gz), members in grid.items():
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    other = grid.get((gx + dx, gy + dy, gz + dz))
                    if not other:
                        continue
                    for i in members:
                        for j in other:
                            if j <= i:
                                continue
                            cut = cutoffs.get(
                                tuple(sorted((elems[i], elems[j]))))
                            if cut and math.dist(points[i], points[j]) <= cut:
                                out.append([i, j, 1])
    return out


def _ball_scale(crystal_or_elems, nn):
    """Radius scale so a crystal's spheres read as balls on sticks: a ball
    about a quarter of the shortest bond, whatever the element mix."""
    els = list(crystal_or_elems)
    mean = sum(elements.radius(e) for e in els) / len(els)
    return max(0.25, min(0.9, 0.27 * nn / mean))


def _wire_box(origin, a, b, c):
    """The 12 edges of the parallelepiped (origin; a, b, c)."""
    def add(*vs):
        return tuple(sum(v[i] for v in vs) for i in range(3))
    corners = {}
    for i in (0, 1):
        for j in (0, 1):
            for k in (0, 1):
                corners[(i, j, k)] = add(origin,
                                         tuple(i * x for x in a),
                                         tuple(j * x for x in b),
                                         tuple(k * x for x in c))
    edges = []
    for key, p in corners.items():
        for axis in range(3):
            if key[axis] == 0:
                q = list(key)
                q[axis] = 1
                edges.append((p, corners[tuple(q)], "solid"))
    return edges


def _shift_edges(edges, mid):
    return [(tuple(p[i] - mid[i] for i in range(3)),
             tuple(q[i] - mid[i] for i in range(3)), s)
            for p, q, s in edges]


def crystal_cell_atoms(crystal):
    """The closed conventional cell: every atom of the cell, plus the copies
    of the atoms on its faces / edges / corners that the neighbouring cells
    share (``[element, x, y, z]`` in ångström, origin at a corner)."""
    eps, seen, out = 1e-6, set(), []
    for el, *f in crystal.atoms:
        for i in (0, 1):
            for j in (0, 1):
                for k in (0, 1):
                    p = (f[0] + i, f[1] + j, f[2] + k)
                    if max(p) > 1 + eps:
                        continue
                    key = (el,) + tuple(round(x, 4) for x in p)
                    if key not in seen:
                        seen.add(key)
                        out.append([el, *crystal.cart(p)])
    return out


def crystal_stack(crystal, cells=(1, 1, 1), tilts=None, owners=None,
                  members=None):
    """``(atoms, bonds, edges, rscale, label)`` of *crystal* tiled into a
    supercell with `supercell.tile` — the same engine (and the same
    tilt-as-a-defect behaviour) as the classic lattice models.

    The bonds are found on the UNTILTED supercell and applied by index, so
    a tilted cell drags its atoms and the bonds follow them. Positions are
    centred on the untilted block."""
    from . import supercell
    if isinstance(crystal, str):
        crystal = crystal_library.get(crystal)
    cells = tuple(int(n) for n in cells)
    if not all(1 <= n <= supercell.MAX_CELLS for n in cells):
        raise BuildError(f"Repeat each direction between 1 and "
                         f"{supercell.MAX_CELLS} cells.")
    a1, a2, a3 = crystal.vectors()
    unit = crystal_cell_atoms(crystal)
    edges = _wire_box((0.0, 0.0, 0.0), a1, a2, a3)
    stacked = cells != (1, 1, 1)
    if stacked:
        if len(unit) * cells[0] * cells[1] * cells[2] > 4 * MAX_ATOMS:
            raise BuildError("Too many atoms: fewer cells.")
        flat, _b, flat_edges = supercell.tile(
            unit, [], edges, *cells, vectors=(a1, a2, a3))
    else:
        flat, flat_edges = unit, edges
    if len(flat) > MAX_ATOMS:
        raise BuildError(f"{len(flat)} atoms is more than the viewer takes "
                         f"({MAX_ATOMS}): fewer cells.")
    bonds = find_bonds([a[1:4] for a in flat], [a[0] for a in flat],
                       _pair_cutoffs(crystal))
    if stacked and any(any(t) for t in (tilts or {}).values()):
        atoms, _b, edges_out = supercell.tile(
            unit, [], edges, *cells, vectors=(a1, a2, a3), tilts=tilts,
            owners=owners, members=members)
    elif stacked:
        atoms, edges_out = flat, flat_edges
        supercell.tile(unit, [], edges, *cells, vectors=(a1, a2, a3),
                       owners=owners, members=members)
    else:
        atoms, edges_out = unit, edges
        if owners is not None:
            owners.extend(["0,0,0"] * len(atoms))
        if members is not None:
            members["0,0,0"] = list(range(len(atoms)))
    mid = [(cells[0] * a1[i] + cells[1] * a2[i] + cells[2] * a3[i]) / 2
           for i in range(3)]
    atoms = [[a[0], a[1] - mid[0], a[2] - mid[1], a[3] - mid[2]]
             for a in atoms]
    edges_out = _shift_edges(edges_out, mid)
    nn = _nn(crystal)
    label = crystal.name if not stacked else \
        f"{crystal.name} ({cells[0]}×{cells[1]}×{cells[2]} cells)"
    return (atoms, bonds, edges_out, _ball_scale({a[0] for a in atoms}, nn),
            label)


def crystal_model(crystal, reps=(1, 1, 1), boundary=True, dope=None,
                  seed=7):
    """A block of *crystal*: its conventional cell repeated ``reps``
    times. With *boundary*, atoms sitting on a cell face are drawn in every
    cell that shares it (a complete-looking cube) and the block is a
    stackable lattice — the crystal panel can change the cell counts and
    tilt a cell as a defect; without, only the atoms inside the half-open
    cell (the true contents), as a fixed block. *dope* (``[(host, dopant,
    fraction)]``, see `substitute`) substitutes random host atoms reproducibly
    for *seed*; a doped block, or a crystal not in the library (custom,
    CIF), is always a fixed block."""
    if isinstance(crystal, str):
        crystal = crystal_library.get(crystal)
    nx, ny, nz = (int(n) for n in reps)
    rules = parse_dope(dope)
    if crystal_library.LIBRARY.get(crystal.key) is not crystal or rules:
        boundary = False
    if boundary:
        mol = Molecule([], [], name=f"crystal:{crystal.key}", az=DEFAULT_AZ,
                       el=DEFAULT_EL, bond=1.0, crystal=True,
                       cells=(nx, ny, nz))
        mol.rebuild()
        return mol
    if not all(1 <= n <= 30 for n in (nx, ny, nz)):
        raise BuildError("Repeat each direction between 1 and 30 cells.")
    eps = 1e-6
    frac = []
    for el, fx, fy, fz in crystal.atoms:
        for i in range(nx + 1):
            for j in range(ny + 1):
                for k in range(nz + 1):
                    p = (fx + i, fy + j, fz + k)
                    if p[0] < nx - eps and p[1] < ny - eps \
                            and p[2] < nz - eps:
                        frac.append((el, p))
    if len(frac) > MAX_ATOMS:
        raise BuildError(f"{len(frac)} atoms is more than the viewer takes "
                         f"({MAX_ATOMS}): fewer cells.")
    seen, pts, els = set(), [], []
    for el, p in frac:
        key = (el,) + tuple(round(x, 4) for x in p)
        if key in seen:
            continue
        seen.add(key)
        pts.append(crystal.cart(p))
        els.append(el)
    a1, a2, a3 = crystal.vectors()
    edges = _wire_box((0.0, 0.0, 0.0), tuple(nx * x for x in a1),
                      tuple(ny * x for x in a2), tuple(nz * x for x in a3))
    substitute(els, rules, seed)
    bonds = find_bonds(pts, els, _dope_cutoffs(_pair_cutoffs(crystal), rules))
    mid = [(nx * a1[i] + ny * a2[i] + nz * a3[i]) / 2 for i in range(3)]
    atoms = [[el, p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]]
             for el, p in zip(els, pts)]
    nn = _nn(crystal)
    label = f"{crystal.name} — cell contents ({nx}×{ny}×{nz})"
    return Molecule(atoms, bonds, name=f"cell:{crystal.key}", label=label,
                    az=DEFAULT_AZ, el=DEFAULT_EL, bond=1.0,
                    rscale=_ball_scale(set(els), nn), crystal=True,
                    edges=_shift_edges(edges, mid))


def crystal_keys():
    return list(crystal_library.LIBRARY)


# -------------------------------------------------------------- surfaces
def surface_model(crystal, miller="111", repeat=None, layers=3,
                  termination=None, dope=None, seed=7, complete=False):
    """A slab of *crystal* cut along (hkl), bulk-terminated: top surface at
    z = 0 (facing +z), ``repeat`` surface cells across (None: about 15 Å),
    ``layers`` interplanar spacings deep.

    *complete* (for a crystal with ``polyhedra``) keeps every polyhedron
    whole: each centre in the slab gets all its ligands — from the layers
    beyond the cut or across the in-plane periodic edge — and ligands with
    no centre are dropped (isolated polyhedra stay stoichiometric). *dope*
    (``[(host, dopant, fraction)]``) then substitutes random host atoms,
    the same ones for the same *seed*."""
    if isinstance(crystal, str):
        crystal = crystal_library.get(crystal)
    hkl = surface.parse_miller(miller)
    rules = parse_dope(dope)
    poly = crystal.polyhedra if complete else None
    if complete and not poly:
        raise BuildError(f"{crystal.name} has no polyhedra to complete.")
    spec = surface.SurfaceSpec(crystal, hkl, (1, 1), int(layers), termination)
    spec.check()
    cell = surface.surface_cell(spec)
    if poly:
        pad = max(1, math.ceil(poly["cutoff"] / max(cell["d"], 0.1)))
        cell = surface.surface_cell(spec, pad=pad)
    if repeat is None:                   # a slab about 15 Å across
        def reach(v):
            return max(1, min(10, round(15.0 / (math.hypot(v[0], v[1])
                                               or 1.0))))
        repeat = (reach(cell["U"]), reach(cell["V"]))
        # a flat unit cell in a big slab: keep the atom count sane
        while (len(cell["atoms"]) * repeat[0] * repeat[1] > MAX_ATOMS
               and max(repeat) > 1):
            repeat = tuple(max(1, r - 1) for r in repeat)
    spec.repeat = tuple(int(n) for n in repeat)
    spec.check()
    nx, ny = spec.repeat
    U, V = cell["U"], cell["V"]
    n_atoms = len(cell["atoms"]) * nx * ny
    if n_atoms > MAX_ATOMS:
        raise BuildError(f"{n_atoms} atoms is more than the viewer takes "
                         f"({MAX_ATOMS}): fewer repeats or layers.")

    def tiles(atoms, ri, rj):
        for i in ri:
            for j in rj:
                ox, oy = i * U[0] + j * V[0], i * U[1] + j * V[1]
                for el, p in atoms:
                    yield el, (p[0] + ox, p[1] + oy, p[2])
    els, pts = [], []
    for el, p in tiles(cell["atoms"], range(nx), range(ny)):
        els.append(el)
        pts.append(p)
    if poly:
        m = 1 + math.ceil(poly["cutoff"] / max(
            min(math.hypot(*U[:2]), math.hypot(*V[:2])), 0.1))
        ri, rj = range(-m, nx + m), range(-m, ny + m)
        pool = [(el, p) for el, p in tiles(cell["pad_atoms"], ri, rj)]
        pool += [(el, p) for (i, j) in ((i, j) for i in ri for j in rj
                                        if not (0 <= i < nx and 0 <= j < ny))
                 for el, p in tiles(cell["atoms"], (i,), (j,))]
        els, pts = complete_polyhedra(els, pts, pool, poly)
    substitute(els, rules, seed)
    bonds = find_bonds(pts, els, _dope_cutoffs(_pair_cutoffs(crystal), rules))
    depth = cell["depth"]
    edges = _wire_box((0.0, 0.0, -depth), tuple(nx * x for x in U),
                      tuple(ny * x for x in V), (0.0, 0.0, depth))
    mid = [(nx * U[0] + ny * V[0]) / 2, (nx * U[1] + ny * V[1]) / 2,
           -depth / 2]
    atoms = [[el, p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]]
             for el, p in zip(els, pts)]
    nn = _nn(crystal)
    label = f"{surface.label(crystal, hkl)} — {nx}×{ny}, {layers} layers"
    if rules:
        label += ", " + ", ".join(f"{frac:g} {dop} for {host}"
                                  for host, dop, frac in rules)
    # look down onto the surface at a slant
    return Molecule(atoms, bonds, name=f"surface:{crystal.key}:{miller}",
                    label=label, az=DEFAULT_AZ, el=math.radians(38.0),
                    bond=1.0, rscale=_ball_scale(set(els), nn), crystal=True,
                    edges=_shift_edges(edges, mid))


# ----------------------------------------------------------- nanostructures
FULLERENES = ("c20", "c60", "c70", "c80")


def nano_model(structure, **kw):
    """Carbon nanostructures: ``graphene`` (width, depth in nm, layers,
    stacking, twist), ``ribbon``, ``dot``, ``nanotube`` (n, m, length,
    walls), ``fullerene`` (kind 'c60' …), ``graphite``, ``defect``."""
    kind = structure.lower()
    try:
        if kind == "graphene":
            c = nano.graphene(**kw)
        elif kind in ("ribbon", "nanoribbon"):
            c = nano.nanoribbon(**kw)
        elif kind in ("dot", "quantum_dot"):
            c = nano.quantum_dot(**kw)
        elif kind == "graphite":
            c = nano.graphite_surface(**kw)
        elif kind == "nanotube":
            c = nano.nanotube(**kw)
        elif kind == "defect":
            c = nano.defect_sheet(**kw)
        elif kind == "fullerene" or kind in FULLERENES:
            c = nano.fullerene(kw.get("kind", kind) if kind == "fullerene"
                               else kind)
        else:
            raise BuildError(f"Unknown nanostructure '{kind}'.")
    except nano.CarbonError as exc:
        raise BuildError(str(exc))
    if len(c.atoms) > MAX_ATOMS:
        raise BuildError(f"{len(c.atoms)} atoms is more than the viewer "
                         f"takes ({MAX_ATOMS}): make it smaller.")
    cage = kind == "fullerene" or kind in FULLERENES
    return to_model(c, rscale=0.8 if cage else 0.55, bond=1.3 if cage else 1.0,
                    crystal=not cage)


# ------------------------------------------------------------- adsorbates
ADSORB_MODES = ("flat", "upright", "as drawn")


def _principal_frame(points):
    """Unit axes of a point set, longest spread first: (e1, e2, e3)."""
    n = len(points)
    c = [sum(p[i] for p in points) / n for i in range(3)]
    q = [[p[i] - c[i] for i in range(3)] for p in points]
    cov = [[sum(v[i] * v[j] for v in q) / n for j in range(3)]
           for i in range(3)]
    return _eigen(cov)


def _orient_points(pts, mode):
    """Centred points turned by *mode* (see `add_adsorbate`): the flattest
    side down, the longest axis up, or as they are."""
    n = len(pts)
    if mode == "as drawn" or n < 2:
        return pts
    if n == 2:
        # a diatomic has one axis: along x when flat, up (z) when upright
        d = [pts[1][i] - pts[0][i] for i in range(3)]
        ln = math.sqrt(sum(v * v for v in d)) or 1.0
        e1 = [v / ln for v in d]
        helper = (0.0, 0.0, 1.0) if abs(e1[2]) < 0.9 else (1.0, 0.0, 0.0)
        e2 = [e1[1] * helper[2] - e1[2] * helper[1],
              e1[2] * helper[0] - e1[0] * helper[2],
              e1[0] * helper[1] - e1[1] * helper[0]]
        n2 = math.sqrt(sum(v * v for v in e2)) or 1.0
        e2 = [v / n2 for v in e2]
        e3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2],
              e1[0] * e2[1] - e1[1] * e2[0]]
    else:
        e1, e2, e3 = _principal_frame(pts)
    # flat: longest along x, middle along y, shortest up (z);
    # upright: shortest along x, middle along y, longest up
    axes = (e1, e2, e3) if mode == "flat" else (e3, e2, e1)
    return [tuple(sum(p[i] * ax[i] for i in range(3)) for ax in axes)
            for p in pts]


def add_adsorbate(base, molecule, height=2.4, dx=0.0, dy=0.0, mode="flat",
                  spin=0.0, auto=False, name=None):
    """A copy of the surface *base* with *molecule* placed above it.

    *molecule* is a viewer `Molecule` (any drawn or built structure). It is
    turned by *mode* — ``"flat"`` lays its flattest side down, ``"upright"``
    stands its longest axis up, ``"as drawn"`` keeps the orientation it has
    now — spun *spin* degrees about the surface normal, centred over the
    slab (plus *dx*, *dy* ångström; with *auto*, at the first free spot) and
    lowered until its lowest atom is *height* Å above the top layer. It is
    not bonded to the surface, and it becomes a *group* the viewer can move
    (see `adsorbates`). Raises `BuildError` for an empty molecule or a
    crystal."""
    from . import adsorbates
    if not molecule.atoms:
        raise BuildError("There is no molecule to place on the surface.")
    if molecule.crystal:
        raise BuildError("Only a molecule can be placed on a surface, not "
                         "another crystal or scene.")
    if mode not in ADSORB_MODES:
        raise BuildError(f"mode is one of {', '.join(ADSORB_MODES)}.")
    if len(base.atoms) + len(molecule.atoms) > MAX_ATOMS:
        raise BuildError("Too many atoms: shrink the slab or the molecule.")
    out = Molecule(base.atoms, base.bonds, name=f"{base.name}+ads",
                   label=base.label, az=base.az, el=base.el, bond=base.bond,
                   rscale=base.rscale, crystal=True, edges=base.edges)
    out.groups = [dict(g) for g in base.groups]
    adsorbates.add(out, molecule, name=name, height=height, dx=dx, dy=dy,
                   mode=mode, spin=spin, auto=auto)
    out.label = f"{base.label} + {molecule.label}"
    return out
