"""Stacking a unit cell into a supercell, with per-cell tilts.

A single unit cell says what the lattice *is*; a supercell shows what a
crystal *looks like*. `tile` repeats a cell ``nx × ny × nz`` times along
its lattice vectors, de-duplicating the atoms, bonds and wireframe edges
that neighbouring cells share, so corners aren't drawn on top of each
other and the wireframe reads as a grid rather than a pile of cubes.

**Tilting** one cell models a *defect*, not a detached grain. Atoms are
laid out on a single node table keyed by the *untilted* position, and each
node is then displaced by the average rotation of the tilted cells that
own it (untilted owners contribute nothing). A tilted cell therefore drags
the corner/face atoms it shares with its neighbours — they deform to
follow, no atom is duplicated — while an isolated tilt stays rigid.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from . import lattices

#: Most cells per axis. Tiling is O(cells × atoms) and every rebuild
#: re-adds every sphere and edge to the scene, so a 12³ BCC supercell
#: (≈4000 atoms, 13000 edges) already takes seconds — past that the viewer
#: stops being interactive, which is worse than not offering it.
MAX_CELLS = 12

#: Crystals that don't tile on their own lattice vectors. The HCP model is
#: drawn as a full hexagonal prism (three cells' worth), so stacking it
#: would interleave rather than repeat.
NO_STACK = {"hcp"}


def can_stack(name, crystal=True):
    """Whether crystal *name* tiles into a supercell."""
    return bool(crystal) and name not in NO_STACK


def clamp(cells):
    """*cells* limited to the supported range."""
    return tuple(max(1, min(MAX_CELLS, int(n))) for n in cells)


def stack_factor(cells):
    """How much to magnify the drawing box for a stacked supercell, so the
    drawn spheres keep a constant size as the cell count grows."""
    return max(cells) if cells else 1


def cell_keys(cells):
    """Every ``"i,j,k"`` cell key in an ``nx × ny × nz`` supercell."""
    nx, ny, nz = cells
    return ["%d,%d,%d" % (i, j, k)
            for i in range(nx) for j in range(ny) for k in range(nz)]


def in_range(key, cells):
    """Whether a ``"i,j,k"`` cell key is inside an *cells* supercell."""
    try:
        i, j, k = (int(v) for v in str(key).split(","))
    except ValueError:
        return False
    return 0 <= i < cells[0] and 0 <= j < cells[1] and 0 <= k < cells[2]


def tile(atoms, bonds, edges, nx, ny, nz, vectors=None, tilts=None,
         owners=None, members=None):
    """Tile a unit cell into an ``nx × ny × nz`` supercell.

    Cells translate along *vectors* — the lattice's three cell vectors —
    when given, so skewed (hexagonal / monoclinic / triclinic…) cells
    stack face-to-face in their crystallographically correct orientations.
    The cubic family passes no vectors and falls back to the wireframe's
    extent along x/y/z (the cube edge length).

    *tilts* maps ``"i,j,k"`` cell keys to ``(rx, ry, rz)`` degrees (see the
    module docstring for what a tilt means).

    Two views of cell membership come back when a list / dict is passed in:
    *owners* gets the ``"i,j,k"`` cell that **first created** each output
    atom — one cell per atom, which is what the UI needs to answer "click
    an atom, which cell is that?" — while *members* maps each cell key to
    **every** atom index in it, shared corners included, so the whole cell
    can be highlighted or measured. An atom appears once in *owners* and in
    as many *members* lists as there are cells touching it.

    The output ordering does **not** depend on *tilts*: atoms are keyed by
    their untilted position, so a tilt moves atoms without renumbering
    them, and a selection survives one. Changing the cell counts does
    renumber.

    Returns ``(atoms, bonds, edges)`` for the whole supercell."""
    edges = list(edges or [])
    bonds = list(bonds or [])
    pts = [p for e in edges for p in (e[0], e[1])] or \
        [(a[1], a[2], a[3]) for a in atoms]
    if not pts:
        return list(atoms), bonds, edges
    lo = [min(p[d] for p in pts) for d in range(3)]
    hi = [max(p[d] for p in pts) for d in range(3)]
    if vectors:
        va, vb, vc = vectors
    else:
        va = ((hi[0] - lo[0]) or 1.0, 0.0, 0.0)
        vb = (0.0, (hi[1] - lo[1]) or 1.0, 0.0)
        vc = (0.0, 0.0, (hi[2] - lo[2]) or 1.0)
    #: tilt pivot: the base cell's centre (bounding midpoint — exact for a
    #: parallelepiped spanned from the origin)
    centre = [(lo[d] + hi[d]) / 2.0 for d in range(3)]

    def key(x, y, z):
        return (round(x, 3), round(y, 3), round(z, 3))

    rots = {ck: lattices.rotation(*t)
            for ck, t in (tilts or {}).items() if any(t)}

    def base(x, y, z, i, j, k):
        """Untilted position of local coord (x, y, z) in cell (i, j, k)."""
        return (x + i * va[0] + j * vb[0] + k * vc[0],
                y + i * va[1] + j * vb[1] + k * vc[1],
                z + i * va[2] + j * vb[2] + k * vc[2])

    # ---- pass 1: build the shared node table + tilt displacement field.
    # A "node" is any atom position or edge endpoint. Shared corners map to
    # one node; its displacement accumulates only the *tilted* owners, so a
    # corner shared with an untilted neighbour still follows the tilt (the
    # neighbour deforms) while a corner between two tilted cells averages.
    node = {}          # nkey -> untilted (x, y, z)
    disp = {}          # nkey -> [Σdx, Σdy, Σdz] over tilted owners
    ndisp = {}         # nkey -> number of tilted owners
    owner = {}         # nkey -> first "i,j,k" that touched the node
    counted = set()    # (nkey, ck) already folded into the average

    def touch(x, y, z, i, j, k, ck, rot):
        bx, by, bz = base(x, y, z, i, j, k)
        nk = key(bx, by, bz)
        if nk not in node:
            node[nk] = (bx, by, bz)
            disp[nk] = [0.0, 0.0, 0.0]
            ndisp[nk] = 0
            owner[nk] = ck
        if rot is not None and (nk, ck) not in counted:
            counted.add((nk, ck))
            rx, ry, rz = rot((x - centre[0], y - centre[1], z - centre[2]))
            tx, ty, tz = base(rx + centre[0], ry + centre[1], rz + centre[2],
                              i, j, k)
            disp[nk][0] += tx - bx
            disp[nk][1] += ty - by
            disp[nk][2] += tz - bz
            ndisp[nk] += 1
        return nk

    for i in range(nx):
        for j in range(ny):
            for k in range(nz):
                ck = "%d,%d,%d" % (i, j, k)
                rot = rots.get(ck)
                for atom in atoms:
                    touch(atom[1], atom[2], atom[3], i, j, k, ck, rot)
                for e in edges:
                    touch(e[0][0], e[0][1], e[0][2], i, j, k, ck, rot)
                    touch(e[1][0], e[1][1], e[1][2], i, j, k, ck, rot)

    def final(nk):
        p, d, n = node[nk], disp[nk], ndisp[nk]
        if not n:
            return p
        return (p[0] + d[0] / n, p[1] + d[1] / n, p[2] + d[2] / n)

    # ---- pass 2: emit atoms/bonds/edges from the deformed node positions.
    new_atoms, new_bonds, new_edges = [], [], []
    seen_atom, seen_bond, seen_edge = {}, set(), set()
    for i in range(nx):
        for j in range(ny):
            for k in range(nz):
                remap = {}
                for oi, atom in enumerate(atoms):
                    nk = key(*base(atom[1], atom[2], atom[3], i, j, k))
                    if nk not in seen_atom:
                        seen_atom[nk] = len(new_atoms)
                        fx, fy, fz = final(nk)
                        new_atoms.append([atom[0], fx, fy, fz]
                                         + list(atom[4:]))
                        if owners is not None:
                            owners.append(owner[nk])
                    remap[oi] = seen_atom[nk]
                if members is not None:
                    members["%d,%d,%d" % (i, j, k)] = sorted(set(remap.values()))
                for bond in bonds:
                    bi, bj, bo = bond[0], bond[1], bond[2]
                    a, b = remap[bi], remap[bj]
                    bk = (min(a, b), max(a, b), bo)
                    if bk not in seen_bond:
                        seen_bond.add(bk)
                        new_bonds.append([a, b, bo])
                for e in edges:
                    style = e[2] if len(e) > 2 else "solid"
                    n1 = key(*base(e[0][0], e[0][1], e[0][2], i, j, k))
                    n2 = key(*base(e[1][0], e[1][1], e[1][2], i, j, k))
                    ek = (frozenset((n1, n2)), style)
                    if ek not in seen_edge:
                        seen_edge.add(ek)
                        new_edges.append((final(n1), final(n2), style))
    return new_atoms, new_bonds, new_edges
