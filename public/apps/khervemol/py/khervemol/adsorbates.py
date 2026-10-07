"""Molecules lying on a surface (Qt-free): place, move, turn, add, remove.

A surface scene keeps its adsorbates as *groups* — ``mol.groups`` is a list
of ``{"name", "start", "count"}``, the atoms ``start … start+count-1`` of
the scene. A group moves as a rigid body: `translate` shifts it, `rotate`
turns it about its own centre, `drag` follows a mouse drag (in the surface
plane, or up and down), and `add` puts another molecule on the slab at the
first free spot. Nothing here bonds an adsorbate to the surface.

Heights are measured from the **top layer**: the highest atom that is not
part of any group.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

import math

from .crystal import BuildError

MODES = ("flat", "upright", "as drawn")
#: closest a new molecule may sit to one already on the slab (Å)
CLEARANCE = 2.2


def _grouped(mol):
    out = set()
    for g in mol.groups:
        out.update(range(g["start"], g["start"] + g["count"]))
    return out


def surface_indices(mol):
    """Indices of the atoms that are the slab (not in any group)."""
    grouped = _grouped(mol)
    return [i for i in range(len(mol.atoms)) if i not in grouped]


def top_layer(mol):
    """z of the highest slab atom."""
    idx = surface_indices(mol)
    if not idx:
        raise BuildError("There is no surface to place a molecule on.")
    return max(mol.atoms[i][3] for i in idx)


def group_of(mol, atom):
    """Index in ``mol.groups`` of the group holding *atom*, or None."""
    if atom is None:
        return None
    for gi, g in enumerate(mol.groups):
        if g["start"] <= atom < g["start"] + g["count"]:
            return gi
    return None


def members(mol, gi):
    g = mol.groups[gi]
    return range(g["start"], g["start"] + g["count"])


def centroid(mol, gi):
    idx = list(members(mol, gi))
    return tuple(sum(mol.atoms[i][d] for i in idx) / len(idx)
                 for d in (1, 2, 3))


def pose(mol, gi):
    """Where a group is: ``{"x", "y", "height"}`` — the centre in x, y and
    the lowest atom's height above the top layer (Å)."""
    idx = list(members(mol, gi))
    cx, cy, _cz = centroid(mol, gi)
    return {"x": cx, "y": cy,
            "height": min(mol.atoms[i][3] for i in idx) - top_layer(mol)}


def translate(mol, gi, dx=0.0, dy=0.0, dz=0.0):
    for i in members(mol, gi):
        a = mol.atoms[i]
        a[1] += dx
        a[2] += dy
        a[3] += dz


def _rot(axis, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    if axis == 0:
        return ((1, 0, 0), (0, c, -s), (0, s, c))
    if axis == 1:
        return ((c, 0, s), (0, 1, 0), (-s, 0, c))
    return ((c, -s, 0), (s, c, 0), (0, 0, 1))


def rotate(mol, gi, rx=0.0, ry=0.0, rz=0.0):
    """Turn a group about its own centre by (rx, ry, rz) degrees about the
    world axes (z is the surface normal)."""
    cx, cy, cz = centroid(mol, gi)
    mats = [_rot(k, d) for k, d in enumerate((rx, ry, rz)) if d]
    for i in members(mol, gi):
        a = mol.atoms[i]
        p = [a[1] - cx, a[2] - cy, a[3] - cz]
        for m in mats:
            p = [sum(m[r][c] * p[c] for c in range(3)) for r in range(3)]
        a[1], a[2], a[3] = cx + p[0], cy + p[1], cz + p[2]


def place(mol, gi, x=None, y=None, height=None):
    """Put a group's centre at (x, y) and/or its lowest atom *height* Å above
    the top layer; leave unspecified values alone."""
    cx, cy, _ = centroid(mol, gi)
    p = pose(mol, gi)
    translate(mol, gi, 0.0 if x is None else x - cx,
              0.0 if y is None else y - cy,
              0.0 if height is None else height - p["height"])


def drag(mol, gi, dsx, dsy, az, el, bond, scale, vertical=False):
    """Move a group by a screen drag (dsx, dsy) — the units and the
    view maths of `model.drag_atom`. Flat on the surface by default (a
    drag of the mouse slides the molecule over the slab); *vertical*
    lifts it instead. Near a side-on view the plane is too edge-on to
    follow, so the vertical drag then lifts."""
    ca, sa = math.cos(az), math.sin(az)
    ce, se = math.cos(el), math.sin(el)
    k = 1.0 / (scale * (bond or 1.0))
    a, b = dsx * k, dsy * k
    if vertical or abs(se) < 0.15:
        dz = -b / ce if abs(ce) > 1e-6 else 0.0
        dx, dy = a * ca, -a * sa                  # sideways along screen-x
        translate(mol, gi, dx if not vertical else 0.0,
                  dy if not vertical else 0.0, dz)
        return
    u = b / se
    translate(mol, gi, ca * a + sa * u, -sa * a + ca * u, 0.0)


def _oriented(molecule, mode, spin):
    """The molecule's atoms as (element, x, y, z) turned by *mode* and *spin*
    and centred on x, y with its lowest atom at z = 0."""
    from . import chem
    pts = [tuple(a[1:4]) for a in molecule.atoms]
    n = len(pts)
    c = [sum(p[i] for p in pts) / n for i in range(3)]
    pts = [tuple(p[i] - c[i] for i in range(3)) for p in pts]
    pts = chem._orient_points(pts, mode)
    a = math.radians(spin)
    ca, sa = math.cos(a), math.sin(a)
    pts = [(p[0] * ca - p[1] * sa, p[0] * sa + p[1] * ca, p[2]) for p in pts]
    low = min(p[2] for p in pts)
    return [(at[0], p[0], p[1], p[2] - low)
            for at, p in zip(molecule.atoms, pts)]


def _free(mol, atoms, dx, dy, top, height):
    """True if *atoms* placed at offset (dx, dy) clear every adsorbate."""
    others = [mol.atoms[i] for g in range(len(mol.groups))
              for i in members(mol, g)]
    for el, x, y, z in atoms:
        px, py, pz = x + dx, y + dy, z + top + height
        for o in others:
            if (o[1] - px) ** 2 + (o[2] - py) ** 2 + (o[3] - pz) ** 2 \
                    < CLEARANCE ** 2:
                return False
    return True


def add(mol, molecule, name=None, height=2.4, dx=0.0, dy=0.0, mode="flat",
        spin=0.0, auto=False):
    """Put *molecule* (a viewer `Molecule`) on the surface scene *mol*, in
    place; returns the new group's index.

    *dx*, *dy* offset it from the centre of the slab. With *auto* it goes
    to the first free spot instead (a spiral out from the centre, clear of
    every molecule already there)."""
    if not molecule.atoms:
        raise BuildError("There is no molecule to place on the surface.")
    if molecule.crystal or getattr(molecule, "notes", None):
        raise BuildError("Only a molecule can be placed on a surface, not "
                         "another crystal or scene.")
    if mode not in MODES:
        raise BuildError(f"mode is one of {', '.join(MODES)}.")
    surf = surface_indices(mol)
    top = top_layer(mol)
    xs = [mol.atoms[i][1] for i in surf]
    ys = [mol.atoms[i][2] for i in surf]
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    atoms = _oriented(molecule, mode, spin)
    if auto and mol.groups:
        half = max(max(xs) - min(xs), max(ys) - min(ys)) / 2
        found = None
        r = 0.0
        while r <= half * 1.2 and found is None:
            steps = 1 if r == 0 else max(6, int(2 * math.pi * r / 2.0))
            for s in range(steps):
                t = 2 * math.pi * s / steps
                cand = (r * math.cos(t), r * math.sin(t))
                if _free(mol, atoms, cand[0], cand[1], top, height):
                    found = cand
                    break
            r += 2.0
        if found is not None:
            dx, dy = found
    if len(mol.atoms) + len(atoms) > 12000:
        raise BuildError("Too many atoms: shrink the slab or the molecule.")
    start = len(mol.atoms)
    for el, x, y, z in atoms:
        mol.atoms.append([el, x + cx + dx, y + cy + dy, z + top + height])
    for i, j, o in molecule.bonds:
        mol.bonds.append([i + start, j + start, o])
    label = name or getattr(molecule, "label", None) or "Molecule"
    label = _unique(mol, label)
    mol.groups.append({"name": label, "start": start, "count": len(atoms)})
    return len(mol.groups) - 1


def _unique(mol, name):
    taken = {g["name"] for g in mol.groups}
    if name not in taken:
        return name
    n = 2
    while f"{name} ({n})" in taken:
        n += 1
    return f"{name} ({n})"


def remove(mol, gi):
    """Delete a group's atoms and bonds; later groups and bond indices
    shift down."""
    g = mol.groups[gi]
    start, count = g["start"], g["count"]
    gone = set(range(start, start + count))

    def shift(i):
        return i - count if i >= start + count else i
    mol.atoms = [a for i, a in enumerate(mol.atoms) if i not in gone]
    mol.bonds = [[shift(i), shift(j), o] for i, j, o in mol.bonds
                 if i not in gone and j not in gone]
    del mol.groups[gi]
    for h in mol.groups:
        if h["start"] > start:
            h["start"] -= count
