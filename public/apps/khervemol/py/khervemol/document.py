"""Document persistence: the ``.kmol`` JSON format and PNG export.

A ``.kmol`` file stores both the 3D model (atoms/bonds/edges + view) and
the 2D sketch, so a document round-trips completely:

    {"format": "khervemol", "version": 2,
     "mol3d": {"name","label","az","el","bond","rscale","crystal",
               "atoms": [[el,x,y,z[,color]]...], "bonds": [[i,j,order]...],
               "edges": [[[x,y,z],[x,y,z],style]...] | null,
               "cells": [nx,ny,nz], "tilts": {"i,j,k": [rx,ry,rz]},
               "colors": {"El@tint": "#rrggbb"}, "poly": bool},
     "sketch2d": {"atoms": [[el,x,y]...], "bonds": [[i,j,order]...]}}

Version 2 added the lattice state (``cells``/``tilts``/``colors``/``poly``)
and the optional per-atom colour slot; a version-1 file still loads, it
simply has no lattice state to restore.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

import json

from . import model, render

FORMAT_VERSION = 5               # 5: adsorbate groups; 4: cell outline; 3: notes


def mol_to_dict(mol):
    edges = None
    if mol.edges:
        edges = [[list(e[0]), list(e[1]), (e[2] if len(e) > 2 else "solid")]
                 for e in mol.edges]
    return {
        "name": mol.name, "label": mol.label,
        "az": mol.az, "el": mol.el, "bond": mol.bond,
        "rscale": mol.rscale, "crystal": mol.crystal,
        "atoms": [list(a) for a in mol.atoms],
        "bonds": [list(b) for b in mol.bonds],
        "edges": edges,
        "notes": [_note_to_dict(n) for n in mol.notes] if mol.notes else None,
        "reaction": mol.reaction,
        "cell_visible": bool(mol.cell_visible),
        "groups": [dict(g) for g in mol.groups],
        "cells": list(mol.cells),
        "tilts": {k: list(v) for k, v in mol.tilts.items()},
        "colors": dict(mol.colors),
        "poly": bool(mol.poly),
    }


def _note_to_dict(note):
    return {k: (list(v) if k in _NOTE_POINTS else v) for k, v in note.items()}


def _note_from_dict(d):
    return {k: (tuple(v) if k in _NOTE_POINTS else v) for k, v in d.items()}


_NOTE_POINTS = ("pos", "p1", "p2")


def mol_from_dict(d):
    edges = None
    if d.get("edges"):
        edges = [(tuple(e[0]), tuple(e[1]), e[2]) for e in d["edges"]]
    mol = model.Molecule(
        atoms=d.get("atoms", []), bonds=d.get("bonds", []),
        name=d.get("name", "custom"), label=d.get("label"),
        az=d.get("az"), el=d.get("el"), bond=d.get("bond"),
        rscale=d.get("rscale", 0.92), crystal=d.get("crystal", False),
        edges=edges, cells=d.get("cells"), tilts=d.get("tilts"),
        colors=d.get("colors"), poly=d.get("poly", False),
        notes=[_note_from_dict(n) for n in d["notes"]] if d.get("notes")
        else None)
    mol.reaction = d.get("reaction")
    mol.cell_visible = bool(d.get("cell_visible", True))
    mol.groups = [dict(g) for g in d.get("groups", [])]
    return mol


def save(path, mol, sketch_atoms, sketch_bonds):
    data = {
        "format": "khervemol", "version": FORMAT_VERSION,
        "mol3d": mol_to_dict(mol),
        "sketch2d": {"atoms": [list(a) for a in sketch_atoms],
                     "bonds": [list(b) for b in sketch_bonds]},
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)


def load(path):
    """Return ``(Molecule, sketch_atoms, sketch_bonds)``."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    mol = mol_from_dict(data.get("mol3d", {}))
    # A stacked/tilted crystal is regenerated rather than trusted from the
    # file, so `owners` (which cell each atom belongs to) comes back too.
    if mol.crystal:
        mol.rebuild()
    sk = data.get("sketch2d", {})
    return mol, sk.get("atoms", []), sk.get("bonds", [])


def export_png(path, specs, width=1200, height=1000, transparent=False):
    img = render.render_image(specs, width, height, transparent=transparent)
    img.save(path, "PNG")
