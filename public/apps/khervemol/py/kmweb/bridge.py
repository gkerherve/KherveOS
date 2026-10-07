"""KherveMol in KherveOS: the web front-end's door into the desktop engine.

The desktop app's own modules (``khervemol``, copied unchanged by
tools/export_khervemol.py) run here in Pyodide. The browser keeps the view
(selection, orbit, the 2D sketch) and asks this module to do the chemistry:
build library entries, edit the 3D structure, stack and tilt crystals,
place molecules on surfaces, balance reactions, read and write files.

One structure is live at a time (``S.mol``, the desktop Viewer3D's
``mol``). Every request is ``{"op", "args"}``; every answer is a dict with
``ok`` plus the op's fields, and ``mol`` (the whole structure, see
`mol_state`) whenever the structure changed. The answers of a batch are
printed as JSON between two markers (see bridge.ts).

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""

import base64
import json
import math
import os
import sys
import tempfile
import traceback

os.environ.setdefault("KHERVEMOL_STATE_DIR", "/home/user/.khervemol")

from khervemol import (adsorbates, chem, chemexport, document,  # noqa: E402
                       elements, entries, lattices, library, mcp_library,
                       meshexport, model, nano, polymers, properties,
                       reactions, shelf, smiles, supercell, surface,
                       svgexport, crystal_library, molcolor, __version__)
from khervemol.crystal import BuildError  # noqa: E402
from khervemol.smiles import SmilesError  # noqa: E402

START = "\x02KM-JSON\x03"
END = "\x02/KM-JSON\x03"
WHEELS = os.environ.get("KHERVEMOL_WHEELS", "/kherveos/khervemol/wheels")


class _State:
    mol = model.Molecule(name="empty")


S = _State()


class Refused(Exception):
    """A request that cannot be done, with the reason for the user."""


# ------------------------------------------------------------------ state
def _pt(p):
    return [float(p[0]), float(p[1]), float(p[2])]


def _note(n):
    out = {}
    for k, v in n.items():
        out[k] = _pt(v) if k in ("pos", "p1", "p2") else v
    return out


def mol_state(mol):
    """Everything the browser needs to draw and edit *mol*."""
    edges = None
    if mol.edges:
        edges = [[_pt(e[0]), _pt(e[1]), e[2] if len(e) > 2 else "solid"]
                 for e in mol.edges]
    stacked = bool(mol.stacked)
    out = {
        "name": str(mol.name), "label": mol.label or str(mol.name),
        "crystal": bool(mol.crystal),
        "atoms": [[a[0], float(a[1]), float(a[2]), float(a[3])]
                  + ([a[4]] if len(a) > 4 and a[4] else [])
                  for a in mol.atoms],
        "bonds": [[int(b[0]), int(b[1]), int(b[2])] for b in mol.bonds],
        "edges": edges,
        "cell_visible": bool(mol.cell_visible),
        "notes": [_note(n) for n in mol.notes] if mol.notes else None,
        "az": float(mol.az), "el": float(mol.el),
        "bond": float(mol.bond if mol.bond is not None else 1.0),
        "rscale": float(mol.rscale),
        "cells": list(mol.cells),
        "tilts": {k: list(v) for k, v in mol.tilts.items()},
        "colors": dict(mol.colors),
        "poly": bool(mol.poly),
        "groups": [dict(g) for g in mol.groups],
        "can_stack": bool(mol.can_stack),
        "stacked": stacked,
        "owners": list(mol.owners) if stacked else None,
        "members": ({k: list(v) for k, v in mol.members.items()}
                    if stacked else None),
        "has_animation": getattr(mol, "anim", None) is not None,
        "reaction": mol.reaction,
        "formula": mol.formula(),
        "params": lattices.param_text(mol.name),
        "anchor_base": _anchor_base(mol),
    }
    return out


def _anchor_base(mol):
    """The untilted base of a stacked crystal with tilted cells: the classic
    layout's `Molecule._frozen_fit` and (for the classic library models
    only, ``gl``) glview.tilt_anchor are computed from it in the browser."""
    if not (mol.stacked and mol.tilts and mol.crystal):
        return None
    edges, rs, gl = [], float(mol.rscale), False
    try:
        if str(mol.name).startswith("crystal:"):
            atoms = chem.crystal_stack(mol.name[len("crystal:"):],
                                       mol.cells)[0]
        elif mol.name in library.LABELS:
            atoms, _b, edges, rs = library.model_data(mol.name, mol.cells)
            gl = True
        else:
            return None
    except Exception:                                   # noqa: BLE001
        return None
    return {"atoms": [[a[0], float(a[1]), float(a[2]), float(a[3])]
                      for a in atoms],
            "edges": [[_pt(e[0]), _pt(e[1])] for e in (edges or [])],
            "rscale": float(rs), "gl": gl}


def _mol_from(d):
    """A `Molecule` from a browser-side state dict (document's format)."""
    return document.mol_from_dict(d)


def _changed(**extra):
    out = {"mol": mol_state(S.mol)}
    out.update(extra)
    return out


def _message(exc):
    return str(exc.args[0]) if getattr(exc, "args", None) else str(exc)


# --------------------------------------------------------------- library
def op_boot(a):
    return {"version": __version__, "ase": _ase_ready()}


def op_load_entry(a):
    """MainWindow.load_entry: build a library entry into the 3D view."""
    mol = entries.build(a["kind"], a["value"], a.get("label"))
    S.mol = mol
    return _changed()


def op_build_detached(a):
    """A library entry built without showing it (2D drops, previews)."""
    mol = entries.build(a["kind"], a["value"], a.get("label"))
    return {"built": mol_state(mol)}


def op_merge_entry(a):
    """Viewer3D.add_molecule: a library drop on the 3D view."""
    try:
        mol = entries.build(a["kind"], a["value"])
    except (BuildError, KeyError, ValueError, SmilesError) as exc:
        raise Refused(_message(exc))
    cur = S.mol
    merging = bool(cur.atoms) and not cur.crystal and not mol.crystal
    if cur.crystal or mol.crystal or not cur.atoms:
        S.mol = mol
        return _changed(merged=False, replaced=True, label=mol.label)
    base = model.merge(cur.atoms, cur.bonds, mol.atoms, mol.bonds)
    cur.name = "custom"
    cur.label = f"{cur.label} + {mol.label}"
    return _changed(merged=merging, replaced=False, base=base,
                    label=mol.label)


def op_new(a):
    S.mol = model.Molecule(atoms=[["C", 0.0, 0.0, 0.0]], name="custom",
                           label="New molecule")
    return _changed()


def op_smiles_of(a):
    return {"smiles": entries.smiles_of(a["kind"], a["value"])}


def op_search(a):
    return {"found": mcp_library.search(a["text"], a.get("kind") or None,
                                       int(a.get("limit") or 25))}


# ------------------------------------------------------------------ files
def op_open_kmol(a):
    path = os.path.join(tempfile.gettempdir(), "open.kmol")
    with open(path, "w", encoding="utf-8") as f:
        f.write(a["text"])
    mol, sk_atoms, sk_bonds = document.load(path)
    S.mol = mol
    return _changed(sketch={"atoms": sk_atoms, "bonds": sk_bonds})


def op_save_kmol(a):
    path = os.path.join(tempfile.gettempdir(), "save.kmol")
    sk = a.get("sketch") or {}
    document.save(path, S.mol, sk.get("atoms", []), sk.get("bonds", []))
    with open(path, "r", encoding="utf-8") as f:
        return {"text": f.read()}


async def _load_ase():
    """ASE (for CIF files, as the desktop's symmetry.py) — the wheel served
    with KherveOS, plus numpy/scipy from Pyodide."""
    if _ase_ready():
        return
    import pyodide_js  # noqa: F401  (Pyodide only)
    await pyodide_js.loadPackage(["numpy", "scipy", "typing-extensions"])
    import zipfile
    import importlib
    for name in sorted(os.listdir(WHEELS)) if os.path.isdir(WHEELS) else []:
        if name.startswith("ase-") and name.endswith(".whl"):
            site = os.path.join(os.path.dirname(WHEELS), "site")
            os.makedirs(site, exist_ok=True)
            zipfile.ZipFile(os.path.join(WHEELS, name)).extractall(site)
            if site not in sys.path:
                sys.path.insert(1, site)
            importlib.invalidate_caches()


def _ase_ready():
    try:
        import ase  # noqa: F401
        return True
    except ImportError:
        return False


async def op_import(a):
    """Molecule ▸ Import structure file (MOL/SDF/PDB/CIF): the desktop
    reads MOL/SDF/PDB with RDKit (not in Pyodide) — the readers in
    `kmweb.readers` keep the file's own coordinates the same way — and
    CIF with ASE."""
    from . import readers
    name = a["name"]
    low = name.lower()
    data = a["text"]
    if low.endswith(".cif"):
        from khervemol import symmetry
        await _load_ase()
        path = os.path.join(tempfile.gettempdir(), os.path.basename(name))
        with open(path, "w", encoding="utf-8") as f:
            f.write(data)
        mol = chem.crystal_model(symmetry.read_cif(path))
    else:
        try:
            mol = readers.read(name, data)
        except readers.NeedsEmbedding as exc:
            return {"embed": True, "message": _message(exc)}
    S.mol = mol
    return _changed()


def op_specs(a):
    """Shape specs of the current view (the classic renderer, PNG/SVG
    export): `Viewer3D.render_specs` / `export_specs`."""
    w, h = float(a.get("w", 400)), float(a.get("h", 400))
    frozen = a.get("frozen")
    specs = S.mol.specs(w, h, tag_atoms=bool(a.get("tag")), frozen=frozen,
                        labels=bool(a.get("labels")))
    if a.get("legend"):
        ent = molcolor.legend_entries(S.mol.atoms, S.mol.colors)
        specs = specs + molcolor.legend_specs(ent, x=w * 1.02, y=h * 0.06,
                                              r=max(6.0, w * 0.022))
    return {"specs": _clean(specs)}


def op_fit_params(a):
    """model.fit_params of the current structure (the classic view's drag
    freezes the layout with it)."""
    m = S.mol
    w, h = float(a.get("w", 400)), float(a.get("h", 400))
    fp = model.fit_params(m.atoms, m.bonds, w, h, m.az, m.el, m.bond,
                          m.rscale)
    return {"frozen": {"scale": fp["scale"], "origin": list(fp["origin"]),
                       "centroid": list(fp["centroid"])}}


def _clean(specs):
    out = []
    for s in specs:
        d = {}
        for k, v in s.items():
            d[k] = list(v) if isinstance(v, tuple) else v
        out.append(d)
    return out


def op_svg(a):
    """File ▸ Export SVG (KhervePaint): 3D specs or the 2D sketch's."""
    if a.get("sketch") is not None:
        sk = a["sketch"]
        specs = svgexport.sketch_specs(sk["atoms"], sk["bonds"],
                                       bool(a.get("labels")),
                                       a.get("mode") or "skeletal")
    else:
        specs = S.mol.specs(1000, 800, labels=bool(a.get("labels")))
        if a.get("legend"):
            ent = molcolor.legend_entries(S.mol.atoms, S.mol.colors)
            specs += molcolor.legend_specs(ent, x=1000 * 1.02, y=800 * 0.06,
                                           r=max(6.0, 1000 * 0.022))
    specs, w, h = svgexport.normalize(specs)
    path = os.path.join(tempfile.gettempdir(), "export.svg")
    svgexport.save_specs(path, specs, w, h)
    with open(path, "r", encoding="utf-8") as f:
        return {"text": f.read()}


def op_chem_export(a):
    fmt = a["fmt"]
    path = os.path.join(tempfile.gettempdir(), "export." + fmt)
    res = chemexport.export(S.mol, path, fmt)
    with open(res["path"], "r", encoding="utf-8") as f:
        return {"text": f.read(), "atoms": res["atoms"]}


def op_mesh_export(a):
    fmt = a["fmt"]
    opts = dict(a.get("options") or {})
    folder = tempfile.mkdtemp()
    path = os.path.join(folder, "model." + fmt)
    res = meshexport.export(S.mol, path, fmt, **opts)
    files = {}
    for name in os.listdir(folder):
        with open(os.path.join(folder, name), "rb") as f:
            files[name] = base64.b64encode(f.read()).decode("ascii")
    return {"files": files, "triangles": res["triangles"],
            "colours": res["colours"]}


def op_mesh_extent(a):
    """exports_ui._extent_mm: the size a mesh export would have."""
    mol, style, scale = S.mol, a["style"], float(a["scale"])
    if not mol.atoms:
        return {"size": [0, 0, 0], "atoms": 0}
    factor = 1.0 if style == "space_filling" else float(mol.bond or 1.0)
    rad = [meshexport.ball_radius(at[0], style, mol.rscale)
           for at in mol.atoms]
    out = []
    for d in (1, 2, 3):
        lo = min(at[d] * factor - r for at, r in zip(mol.atoms, rad))
        hi = max(at[d] * factor + r for at, r in zip(mol.atoms, rad))
        out.append((hi - lo) * scale)
    return {"size": out, "atoms": len(mol.atoms)}


# ---------------------------------------------------------- 3D editing
def _editable():
    if S.mol.crystal:
        raise Refused("This structure is a fixed lattice or scene.")


def op_set_view(a):
    return {}


def op_set_atoms(a):
    """After a drag in the browser (model.drag_atom / adsorbates.drag run
    there for a smooth drag): the moved atoms."""
    atoms = a["atoms"]
    if len(atoms) != len(S.mol.atoms):
        raise Refused("The structure changed during the drag.")
    for cur, new in zip(S.mol.atoms, atoms):
        cur[1], cur[2], cur[3] = float(new[1]), float(new[2]), float(new[3])
    return _changed()


def op_add_bonded(a):
    _editable()
    i = model.add_bonded_atom(S.mol.atoms, S.mol.bonds, int(a["anchor"]),
                              a["element"], int(a.get("order", 1)))
    return _changed(index=i)


def op_place_free(a):
    """Viewer3D.add_element with nothing to bond to / _place_free."""
    _editable()
    atoms = S.mol.atoms
    el = a["element"]
    if a.get("first") or not atoms:
        atoms.append([el, 0.0, 0.0, 0.0])
    else:
        n = len(atoms)
        cx = sum(x[1] for x in atoms) / n + 3.0
        cy = sum(x[2] for x in atoms) / n
        cz = sum(x[3] for x in atoms) / n
        atoms.append([el, cx, cy, cz])
    return _changed(index=len(atoms) - 1)


def op_delete_atom(a):
    _editable()
    if len(S.mol.atoms) <= 1:
        raise Refused("A structure keeps at least one atom.")
    model.delete_atom(S.mol.atoms, S.mol.bonds, int(a["index"]))
    return _changed()


def op_add_bond(a):
    _editable()
    ok = model.add_bond(S.mol.atoms, S.mol.bonds, int(a["i"]), int(a["j"]),
                        int(a.get("order", 1)))
    return _changed(done=bool(ok))


def op_set_bond_order(a):
    _editable()
    bi = int(a["bond"])
    if bi >= len(S.mol.bonds):
        raise Refused("No such bond.")
    ok = model.set_bond_order(S.mol.atoms, S.mol.bonds, bi,
                              int(a["order"]))
    return _changed(done=bool(ok))


def op_delete_bond(a):
    _editable()
    bi = int(a["bond"])
    if bi >= len(S.mol.bonds):
        raise Refused("No such bond.")
    model.delete_bond(S.mol.bonds, bi)
    return _changed()


def op_reattach(a):
    _editable()
    atom, anchor = int(a["atom"]), int(a["anchor"])
    parent = a.get("parent")
    old = None if parent is None else model.bond_between(
        S.mol.bonds, atom, int(parent))
    ok = model.reattach(S.mol.atoms, S.mol.bonds, atom, old, anchor,
                        int(a.get("order", 1)))
    return _changed(done=bool(ok))


def op_fill_hydrogens(a):
    """Cap every free valence with hydrogen (the MCP fill_hydrogens)."""
    _editable()
    m = S.mol
    added = 0
    for idx in range(len(m.atoms)):
        if m.atoms[idx][0] == "H":
            continue
        while model.free_valence(m.atoms, m.bonds, idx) > 0:
            model.add_bonded_atom(m.atoms, m.bonds, idx, "H", 1)
            added += 1
    return _changed(added=added)


# ----------------------------------------------- colours, cells, tilts
def op_set_color(a):
    key = molcolor.set_color(S.mol.atoms, S.mol.colors, int(a["index"]),
                             a["color"], not S.mol.crystal)
    return _changed(key=key)


def op_reset_colors(a):
    molcolor.clear_colors(S.mol.atoms, S.mol.colors)
    if S.mol.crystal:
        S.mol.rebuild()
    return _changed()


def op_set_cell_visible(a):
    S.mol.cell_visible = bool(a["on"])
    return _changed()


def op_set_poly(a):
    S.mol.poly = bool(a["on"])
    return _changed()


def op_set_bond_spread(a):
    S.mol.bond = float(a["bond"])
    return {}


def op_set_cells(a):
    m = S.mol
    m.cells = supercell.clamp(tuple(int(x) for x in a["cells"]))
    m.prune_tilts()
    m.rebuild()
    return _changed()


def op_set_tilt(a):
    m = S.mol
    key, angles = a["cell"], [int(v) for v in a["angles"]]
    if any(angles):
        m.tilts[key] = angles
    else:
        m.tilts.pop(key, None)
    m.rebuild()
    return _changed()


def op_reset_tilts(a):
    S.mol.tilts = {}
    S.mol.rebuild()
    return _changed()


# ---------------------------------------------------- surfaces / groups
def _adsorbate(a):
    """builders_ui._AdsorbateRows.adsorbate: the molecule to place."""
    src = a.get("source")
    if src == "drawn":
        d = a.get("drawn")
        if not d:
            raise Refused("Draw or load a molecule first.")
        return _mol_from(d)
    if src == "kept":
        return entries.build("mine", a.get("kept") or "")
    if src == "smiles":
        return entries.build_smiles((a.get("smiles") or "").strip())
    return None


def _placement(a):
    p = a.get("placement") or {}
    return dict(height=float(p.get("height", 2.4)),
                dx=float(p.get("dx", 0.0)), dy=float(p.get("dy", 0.0)),
                mode=p.get("mode", "flat"), spin=float(p.get("spin", 0.0)),
                auto=bool(p.get("auto", False)))


def op_surface_build(a):
    """MainWindow.open_surface_builder after OK."""
    ads = _adsorbate(a)
    if ads is None:
        S.mol = entries.build("surface", a["value"], a.get("label"))
        return _changed(placed=None)
    base = entries.build("surface", a["value"], a.get("label"))
    S.mol = chem.add_adsorbate(base, ads, **_placement(a))
    return _changed(placed=ads.label)


def op_add_group(a):
    """MainWindow.add_molecule_to_surface after OK."""
    if not str(S.mol.name).startswith("surface:"):
        raise Refused("Build a surface first (Crystal ▸ Surface builder…), "
                      "then add molecules to it.")
    ads = _adsorbate(a)
    gi = adsorbates.add(S.mol, ads, **_placement(a))
    return _changed(index=gi, label=ads.label)


def op_nudge_group(a):
    gi = int(a["gi"])
    step = float(a["step"])
    axis = int(a["axis"])
    if a.get("mode") == "turn":
        angles = [0.0, 0.0, 0.0]
        angles[axis] = step
        adsorbates.rotate(S.mol, gi, *angles)
    else:
        d = [0.0, 0.0, 0.0]
        d[axis] = step
        adsorbates.translate(S.mol, gi, *d)
    return _changed()


def op_place_group(a):
    adsorbates.place(S.mol, int(a["gi"]), a.get("x"), a.get("y"),
                     a.get("height"))
    return _changed()


def op_remove_group(a):
    adsorbates.remove(S.mol, int(a["gi"]))
    return _changed()


# ------------------------------------------------------------ reactions
def op_animation(a):
    """The reaction film's data (rxanim.Animation): the browser plays it."""
    m = S.mol
    if m.reaction and m.anim is None:
        reactions.attach_animation(m)
    an = m.anim
    if an is None:
        return {"film": None}
    from khervemol import rxanim
    if an._static is None:
        an.bind(m)
    return {"film": {
        "title": an.title,
        "elements": list(an.reac.elements),
        "reac_spread": [_pt(p) for p in an.reac.spread],
        "reac_packed": [_pt(p) for p in an.reac.packed],
        "prod_spread": [_pt(p) for p in an.prod.spread],
        "prod_packed": [_pt(p) for p in an.prod.packed],
        "prod_mols": list(an.prod.mols),
        "pi": list(an.pi), "rbonds": an.rbonds, "pbonds": an.pbonds,
        "top": an.top, "bottom": an.bottom, "left": an.left,
        "right": an.right,
        "phases": list(rxanim.PHASES), "break": rxanim.BREAK,
        "form": rxanim.FORM, "arc": rxanim.ARC,
        "duration": rxanim.DURATION,
    }}


# ------------------------------------------------------------ properties
def op_properties(a):
    """Molecule ▸ Properties: `properties.compute`, with the RDKit
    descriptors the browser's RDKit (MinimalLib) worked out, if any."""
    from khervemol import rdkit_io
    desc = a.get("descriptors")
    saved = rdkit_io.descriptors_from_structure, rdkit_io._RDKIT
    try:
        if desc is not None:
            rdkit_io.descriptors_from_structure = lambda *_x: desc or None
            rdkit_io._RDKIT = True
        rows = properties.compute(S.mol)
    finally:
        rdkit_io.descriptors_from_structure, rdkit_io._RDKIT = saved
    return {"rows": [[str(k), str(v)] for k, v in rows]}


# ------------------------------------------------------- builder dialogs
def op_crystal_summary(a):
    """builders_ui.CrystalDialog._update."""
    c = crystal_library.LIBRARY[a["key"]]
    n = int(a["nx"]) * int(a["ny"]) * int(a["nz"])
    ang = "" if (c.alpha, c.beta, c.gamma) == (90.0, 90.0, 90.0) else \
        f", α {c.alpha:g}° β {c.beta:g}° γ {c.gamma:g}°"
    dope = a.get("dope") or ""
    text = (f"{c.formula} — {c.system}, {c.space_group}. a = {c.a:.4g} Å, "
            f"b = {c.b:.4g} Å, c = {c.c:.4g} Å{ang}. {len(c.atoms)} atoms per "
            f"cell, {c.computed_density():.3g} g/cm³. About "
            f"{len(c.atoms) * n} atoms shown."
            + (" Doped blocks show the true cell contents." if dope else "")
            + _dope_hint(dope))
    return {"text": text}


def _dope_hint(query):
    """_DopeRow.dope_hint for a ``&dope=…&seed=…`` query."""
    if not query:
        return ""
    try:
        chem.parse_dope(query.split("=")[1].split("&")[0])
    except BuildError as exc:
        return f"  ⚠ {exc}"
    return ""


def op_surface_summary(a):
    """builders_ui.SurfaceDialog._update (the text and whether OK is on)."""
    try:
        hkl = surface.parse_miller(a["miller"])
        c = crystal_library.LIBRARY[a["key"]]
        text = (f"{surface.label(c, hkl)} — bulk-terminated slab, top "
                "surface facing up (no relaxation or reconstruction).")
        text += _dope_hint(a.get("dope") or "")
        hkl_text = "".join(f"-{-n}" if n < 0 else str(n) for n in hkl)
        return {"text": text, "valid": True, "polyhedra": bool(c.polyhedra),
                "hkl": hkl_text}
    except BuildError as exc:
        return {"text": f"⚠ {exc}", "valid": False, "polyhedra": False,
                "hkl": ""}


def op_nano_summary(a):
    n, m = int(a["n"]), int(a["m"])
    d = nano.diameter(n, m)
    return {"text": f"({n},{m}) — {nano.tube_kind(n, m)}, "
                    f"diameter {d:.2f} nm."}


def op_polymer_summary(a):
    """builders_ui.PolymerDialog._update."""
    unit, head, tail = a["unit"].strip(), a["head"].strip(), a["tail"].strip()
    try:
        text = polymers.chain_smiles(unit, int(a["n"]), head, tail)
        atoms, bonds = smiles.parse_smiles(text)
        atoms, bonds = smiles.add_hydrogens(atoms, bonds)
        if len(atoms) > smiles.MAX_ATOMS:
            raise polymers.PolymerError(
                f"{len(atoms)} atoms is more than the builder takes "
                f"({smiles.MAX_ATOMS}) — at most "
                f"{polymers.max_units(unit, head, tail)} units.")
        return {"text": f"{smiles.formula_of(text)} — {len(atoms)} atoms, "
                        f"{int(a['n'])} × {unit}", "valid": True}
    except (polymers.PolymerError, SmilesError, ValueError,
            KeyError) as exc:
        return {"text": f"⚠ {exc}", "valid": False}


def op_reaction_report(a):
    """builders_ui.ReactionDialog._update."""
    try:
        rx = reactions.solve(a["text"], bool(a.get("balance", True)))
    except (BuildError, ValueError, ZeroDivisionError) as exc:
        return {"text": f"⚠ {exc}", "valid": False}
    lines = [rx.equation, ""]
    lines.append("Balanced: atoms and charge agree on both sides."
                 if rx.balanced else "NOT balanced — check the table:")
    for el, (x, y) in rx.table.items():
        mark = "" if x == y else "   ← differs"
        lines.append(f"  {el:>7}: {x:g} → {y:g}{mark}")
    return {"text": "\n".join(lines), "valid": True}


def op_reaction_entry(a):
    """ReactionDialog.entry: the balanced equation, when it balances."""
    eq = a["text"].strip()
    if a.get("balance", True):
        try:
            eq = reactions.solve(eq, True).source
        except (BuildError, ValueError):
            pass
    return {"equation": eq}


def op_preview(a):
    """explorer.MoleculeExplorer._on_select."""
    kind, value, name = a["kind"], a["value"], a.get("name") or ""
    mol = entries.build(kind, value, name)
    specs = mol.specs(300, 260)
    smi = entries.smiles_of(kind, value)
    formula = mol.formula() if not mol.notes else ""
    return {"specs": _clean(specs), "formula": formula,
            "atoms": len(mol.atoms), "bonds": len(mol.bonds),
            "smiles": smi}


# ------------------------------------------------------------- the shelf
def _shelf():
    return shelf.default()


def op_shelf_list(a):
    sh = _shelf()
    sh.load()
    return {"items": [{"name": n, "formula": sh.formula(n),
                       "token": shelf.token(n)} for n in sh.names()],
            "next": sh.next_name()}


def op_shelf_add(a):
    sh = _shelf()
    used = sh.add(_mol_from(a["mol"]), a["name"])
    return {"name": used, "token": shelf.token(used)}


def op_shelf_rename(a):
    _shelf().rename(a["old"], a["new"])
    return {}


def op_shelf_remove(a):
    _shelf().remove(a["name"])
    return {}


def op_shelf_move(a):
    _shelf().move(a["name"], int(a["delta"]))
    return {}


# ------------------------------------------------------------------ run
OPS = {k[3:]: v for k, v in dict(globals()).items() if k.startswith("op_")}


async def _one(req):
    op = OPS.get(req.get("op"))
    if op is None:
        return {"ok": False, "error": f"Unknown request {req.get('op')!r}."}
    args = req.get("args") or {}
    view = args.get("view")
    if view:
        S.mol.az = float(view.get("az", S.mol.az))
        S.mol.el = float(view.get("el", S.mol.el))
    try:
        out = op(args)
        if hasattr(out, "__await__"):
            out = await out
        out = dict(out or {})
        out["ok"] = True
        return out
    except Refused as exc:
        return {"ok": False, "error": _message(exc), "rejected": True}
    except (BuildError, KeyError, ValueError, SmilesError) as exc:
        return {"ok": False, "error": _message(exc)}
    except Exception as exc:                            # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}",
                "trace": traceback.format_exc()}


async def run(requests_json):
    answers = []
    for req in json.loads(requests_json):
        answers.append(await _one(req))
    sys.stdout.write(START + json.dumps(answers, allow_nan=False,
                                        default=_default) + END)
    sys.stdout.flush()


def _default(o):
    if isinstance(o, (set, frozenset, tuple)):
        return list(o)
    if isinstance(o, float) and not math.isfinite(o):
        return None
    return str(o)
