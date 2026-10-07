"""Per-atom / per-site colours, coordination polyhedra and the legend.

Two colour mechanisms, matching how each kind of structure is stored:

* An **editable molecule** owns its atoms, so a custom colour rides on the
  atom itself — an optional 5th slot on ``[el, x, y, z, tint]``, already
  understood by `model._model` / `model.atom_specs`.
* A **crystal** is regenerated from its builder on every draw (a supercell
  is rebuilt from scratch whenever the cell count or a tilt changes), so a
  colour can't ride on an atom. It lives in a mapping keyed by `color_key`
  — the element symbol, suffixed with the site tint where the lattice
  distinguishes sites (``"Fe"`` vs ``"Fe@#2f6fed"`` for a BCC body centre).
  `apply_colors` re-applies that map to freshly built atoms.

`SITE_COLORS` are the built-in site tints: a body- or face-centre atom of
the same element as the corners would otherwise be invisible against them,
so the lattice builders tint them.

`coordination_polyhedra` turns each ≥4-coordinate atom's neighbour shell
into convex-hull faces — the translucent VESTA-style octahedra/tetrahedra
the viewer can overlay on a crystal.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from . import elements, lattices

#: Tints for lattice sites that would otherwise vanish against identical
#: corner atoms of the same element.
SITE_COLORS = {
    "body": "#2f6fed",      # BCC body centre
    "face": "#e0705a",      # FCC / diamond face centres
    "inner": "#8e63d6",     # diamond / zinc-blende interior sites
    "mid": "#43a047",       # HCP middle layer
}

#: Lattice-site descriptions, keyed by the site tint colour.
SITE_LABELS = {
    SITE_COLORS["body"]: "body centre",
    SITE_COLORS["face"]: "face centre",
    SITE_COLORS["inner"]: "interior site",
    SITE_COLORS["mid"]: "middle layer",
}


def tint(atom):
    """The site tint carried by *atom*, or None."""
    return atom[4] if len(atom) > 4 and atom[4] else None


def color_key(atom):
    """The colour-map key for *atom* ``[el, x, y, z, tint]``: recolouring
    one sphere recolours every atom of the same element **and** site."""
    t = tint(atom)
    return f"{atom[0]}@{t}" if t else str(atom[0])


def atom_color(atom, colors=None):
    """The colour *atom* is currently drawn in (override > tint > CPK)."""
    over = (colors or {}).get(color_key(atom))
    if over:
        return over
    return tint(atom) or elements.color(atom[0])


def apply_colors(atoms, colors):
    """Freshly built *atoms* with the *colors* override map applied (the
    override lands in the atom's tint slot, which drives the sphere)."""
    if not colors:
        return atoms
    out = []
    for a in atoms:
        over = colors.get(color_key(a))
        out.append([a[0], a[1], a[2], a[3], over] if over else list(a))
    return out


def set_color(atoms, colors, index, color, editable):
    """Recolour atom *index*. An editable molecule stores the colour on the
    atom; a crystal stores an element/site override in *colors* (which is
    mutated in place). Returns the key that was recoloured."""
    atom = atoms[index]
    if editable:
        while len(atom) <= 4:
            atom.append(None)
        atom[4] = color
        return str(atom[0])
    key = color_key(atom)
    colors[key] = color
    return key


def clear_colors(atoms, colors):
    """Drop every custom colour: the per-atom slots and the override map."""
    for atom in atoms:
        if len(atom) > 4:
            del atom[4:]
    colors.clear()


def coordination_polyhedra(atoms, bonds, colors=None):
    """Coordination polyhedra for a structure: for every atom bonded to ≥4
    neighbours (a B-site cation, a tetrahedral carbon…), the convex-hull
    faces spanned by those neighbours, tinted in the centre atom's drawn
    colour. Returns ``[(face_points_3d, color), …]``."""
    neigh = {}
    for bond in bonds:
        i, j = bond[0], bond[1]
        neigh.setdefault(i, set()).add(j)
        neigh.setdefault(j, set()).add(i)
    out = []
    for centre, ns in neigh.items():
        if len(ns) < 4:
            continue
        pts = [(atoms[k][1], atoms[k][2], atoms[k][3]) for k in sorted(ns)]
        color = atom_color(atoms[centre], colors)
        for face in lattices.coordination_faces(pts):
            out.append((face, color))
    return out


def has_polyhedra(atoms, bonds):
    """Whether this structure has any atom with ≥4 bonded neighbours — i.e.
    whether coordination polyhedra would draw anything."""
    count = {}
    for bond in bonds:
        for k in (bond[0], bond[1]):
            count[k] = count.get(k, 0) + 1
    return any(v >= 4 for v in count.values())


def legend_entries(atoms, colors=None):
    """Ordered unique ``(element, label, color)`` rows for a legend — one
    per distinct colour actually drawn."""
    entries, seen = [], set()
    for a in atoms:
        over = (colors or {}).get(color_key(a))
        color = atom_color(a, colors)
        if (a[0], color) in seen:
            continue
        seen.add((a[0], color))
        label = f"{a[0]} — {elements.name(a[0])}"
        site = SITE_LABELS.get(tint(a)) if not over else None
        if site:
            label += f" ({site})"
        entries.append((a[0], label, color))
    return entries


def legend_specs(entries, x=0.0, y=0.0, r=10.0):
    """Shape specs for a legend column at (x, y): a lit sphere plus a text
    label per row, with sphere radius *r* setting the overall scale."""
    from . import model
    specs = []
    gap = r * 2.8
    for i, (el, label, color) in enumerate(entries):
        cy = y + r + i * gap
        specs += model.atom_specs(x + r, cy, r, el, color=color)
        specs.append({"shape": "text", "text": label, "x": x + r * 2.6,
                      "y": cy - r * 1.05, "size": max(int(r * 1.3), 8),
                      "stroke": "#1a1a1a"})
    return specs
