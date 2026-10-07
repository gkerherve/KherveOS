"""The library as one list of ``(kind, value)`` entries.

Every leaf of the library tree, the Explorer and a drag-and-drop payload
is a ``(kind, value)`` pair; `build` turns one into a viewer `Molecule`
and `sections` lists them all for the tree.

========== ============================================ ==============
kind       value                                        built by
========== ============================================ ==============
model      a classic hand-placed model key              `library.make`
compound   a `compounds` key                            `chem`
smiles     a SMILES string                              RDKit, else `chem`
crystal    ``key`` or ``key?cells=2,2,2&dope=Ti:Zr:0.1``  `chem`
surface    ``key:hkl`` or ``key:hkl?repeat=6,6&layers=4``  `chem`
           (+ ``&complete=1`` whole polyhedra, ``&dope=Nb:Mo:0.1&seed=7``)
nano       ``graphene?width=3&layers=2`` …              `chem`
polymer    ``key?n=8`` or ``custom?unit=CC(Cl)&n=6``    `polymers`
reaction   an equation, ``2 H2 + O2 -> 2 H2O``          `reactions`
mine       a name on the shelf of kept molecules        `shelf`
========== ============================================ ==============

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from urllib.parse import parse_qs

from . import (chem, compounds, crystal_library, library, polymers, rdkit_io,
               reactions, shelf, surface)
from .crystal import BuildError
from .smiles import SmilesError

#: kinds whose result is a fixed lattice / scene rather than an editable
#: molecule
KINDS = ("model", "compound", "smiles", "crystal", "surface", "nano",
         "polymer", "reaction", "mine")


def _split(value):
    """('key', {param: value}) from ``key?a=1&b=2``."""
    head, _, query = value.partition("?")
    params = {k: v[-1] for k, v in parse_qs(query).items()}
    return head, params


def _floats(text, default):
    try:
        return tuple(float(x) for x in text.split(","))
    except (AttributeError, ValueError):
        return default


def _ints(text, default):
    try:
        return tuple(int(x) for x in text.split(","))
    except (AttributeError, ValueError):
        return default


def build(kind, value, label=None):
    """The viewer `Molecule` for a library entry. Raises `BuildError` (or
    `KeyError`, `SmilesError`) with a readable reason."""
    if kind == "model":
        return library.make(value)
    if kind == "compound":
        mol = chem.compound_model(value)
        return mol
    if kind == "smiles":
        return build_smiles(value, label)
    if kind == "crystal":
        key, p = _split(value)
        reps = _ints(p.get("cells"), (1, 1, 1))
        return chem.crystal_model(key, reps,
                                  boundary=p.get("boundary", "1") != "0",
                                  dope=p.get("dope"),
                                  seed=int(p.get("seed", 7)))
    if kind == "surface":
        head, p = _split(value)
        key, _, hkl = head.partition(":")
        repeat = _ints(p.get("repeat"), None)
        return chem.surface_model(key, hkl or "111", repeat,
                                  int(p.get("layers", 3)),
                                  float(p["termination"])
                                  if "termination" in p else None,
                                  dope=p.get("dope"),
                                  seed=int(p.get("seed", 7)),
                                  complete=p.get("complete", "0")
                                  not in ("0", "false", "False"))
    if kind == "nano":
        head, p = _split(value)
        kw = {}
        for k, v in p.items():
            if k in ("width", "depth", "length", "twist", "diameter",
                     "nitrogen"):
                kw[k] = float(v)
            elif k in ("layers", "walls", "n", "m"):
                kw[k] = int(v)
            elif k in ("hydrogen", "step"):
                kw[k] = v not in ("0", "false", "False")
            else:
                kw[k] = v
        return chem.nano_model(head, **kw)
    if kind == "polymer":
        return build_polymer(value)
    if kind == "reaction":
        return reactions.reaction_model(value)[0]
    if kind == "mine":
        try:
            return shelf.default().model(value)
        except KeyError as exc:
            raise BuildError(str(exc.args[0]))
    raise BuildError(f"Unknown entry kind '{kind}'.")


def build_polymer(value):
    """A polymer chain: a preset key (``pvc?n=6``) or a custom repeat unit
    (``custom?unit=CC(Cl)&n=6&head=&tail=``)."""
    key, p = _split(value)
    try:
        if key == "custom":
            unit, head, tail = p.get("unit", ""), p.get("head", ""), \
                p.get("tail", "")
            name = "Custom polymer"
            n = int(p.get("n", 4))
        else:
            name, unit, n0, _cat, (head, tail) = polymers.preset(key)
            n = int(p.get("n", n0))
        comp = polymers.build_chain(unit, n, head, tail)
    except KeyError:
        raise BuildError(f"No polymer '{key}'.")
    except ValueError as exc:
        raise BuildError(str(exc))
    short = name.split(" (")[0]
    mol = chem.to_model(comp, name=f"polymer:{key}",
                        label=f"{short} — {n} repeat units", rscale=0.8,
                        bond=1.4)
    return mol


def build_smiles(text, label=None):
    """A molecule from SMILES: RDKit's embedding (with a force-field
    cleanup) when installed, otherwise the built-in pure-Python builder."""
    if rdkit_io.available():
        try:
            return rdkit_io.molecule_from_smiles(text, label=label)
        except Exception:                           # noqa: BLE001
            pass                                    # fall back below
    try:
        return chem.smiles_model(text, name=label or "")
    except SmilesError as exc:
        raise BuildError(f"SMILES '{text}': {exc}")


def smiles_of(kind, value):
    """SMILES text for kinds that have one (compound / smiles), else None."""
    if kind == "smiles":
        return value
    if kind == "compound" and value in compounds.COMPOUNDS:
        return compounds.COMPOUNDS[value][1]
    return None


# ------------------------------------------------------------- tree data
_SURFACES = (
    ("Metal surfaces", (
        ("cu", "111"), ("cu", "100"), ("cu", "110"), ("au", "111"),
        ("au", "100"), ("ag", "111"), ("pt", "111"), ("pt", "100"),
        ("ni", "111"), ("ni", "100"), ("al", "111"), ("pd", "111"),
        ("rh", "111"), ("ir", "111"), ("fe", "110"), ("fe", "100"),
        ("w", "110"), ("mo", "110"), ("cr", "110"), ("ti", "0001"),
        ("zn", "0001"), ("co", "0001"), ("ru", "0001"), ("mg", "0001"))),
    ("Semiconductor surfaces", (
        ("si", "111"), ("si", "100"), ("si", "110"), ("ge", "111"),
        ("ge", "100"), ("gaas", "110"), ("gaas", "100"), ("inp", "110"),
        ("gan", "0001"), ("gan", "10-10"), ("sic", "111"),
        ("diamond", "111"), ("diamond", "100"), ("zns", "110"))),
    ("Oxide & salt surfaces", (
        ("rutile", "110"), ("rutile", "100"), ("rutile", "001"),
        ("anatase", "101"), ("anatase", "001"), ("mgo", "100"),
        ("nacl", "100"), ("caf2", "111"), ("quartz", "0001"),
        ("corundum", "0001"), ("srtio3", "100"), ("ceo2", "111"),
        ("cu2o", "111"), ("nio", "100"), ("zno", "0001"), ("zno", "10-10"),
        ("batio3", "100"), ("zro2", "111"))),
    ("Layered materials", (
        ("graphite", "0001"), ("hbn", "0001"), ("mos2", "0001"),
        ("ws2", "0001"))),
)

_NANO = (
    ("Graphene & graphite", (
        ("Graphene sheet", "graphene?width=3&depth=3"),
        ("Graphene sheet, large (5 × 5 nm)", "graphene?width=5&depth=5"),
        ("Bilayer graphene (AB, Bernal)",
         "graphene?width=3&depth=3&layers=2&stacking=AB"),
        ("Bilayer graphene (AA)",
         "graphene?width=3&depth=3&layers=2&stacking=AA"),
        ("Trilayer graphene (ABC, rhombohedral)",
         "graphene?width=3&depth=3&layers=3&stacking=ABC"),
        ("Trilayer graphene (ABA)",
         "graphene?width=3&depth=3&layers=3&stacking=ABA"),
        ("Twisted bilayer graphene (5°)",
         "graphene?width=4&depth=4&layers=2&twist=5"),
        ("Twisted bilayer graphene (13°)",
         "graphene?width=3&depth=3&layers=2&twist=13"),
        ("Graphene, hydrogen-edged", "graphene?width=2&depth=2&hydrogen=1"),
        ("Graphene with a vacancy", "defect?kind=vacancy"),
        ("Nitrogen-doped graphene", "defect?kind=nitrogen"),
        ("Graphene quantum dot", "dot?diameter=2"),
        ("Armchair graphene nanoribbon", "ribbon?edge=armchair&width=1.2"),
        ("Zigzag graphene nanoribbon", "ribbon?edge=zigzag&width=1.2"),
        ("Graphite (0001) surface", "graphite?layers=4"),
        ("Graphite surface with a step", "graphite?layers=4&step=1"))),
    ("Carbon nanotubes", (
        ("Nanotube (5,5) armchair", "nanotube?n=5&m=5&length=3"),
        ("Nanotube (10,10) armchair", "nanotube?n=10&m=10&length=3"),
        ("Nanotube (9,0) zigzag", "nanotube?n=9&m=0&length=3"),
        ("Nanotube (12,0) zigzag", "nanotube?n=12&m=0&length=3"),
        ("Nanotube (6,4) chiral", "nanotube?n=6&m=4&length=3"),
        ("Nanotube (10,5) chiral", "nanotube?n=10&m=5&length=3"),
        ("Double-walled nanotube (5,5)@(10,10)",
         "nanotube?n=5&m=5&length=3&walls=2"),
        ("Nanotube (5,5), hydrogen-capped",
         "nanotube?n=5&m=5&length=2&hydrogen=1"))),
    ("Fullerenes", (
        ("Fullerene C20 (dodecahedron)", "fullerene?kind=c20"),
        ("Buckminsterfullerene C60", "fullerene?kind=c60"),
        ("Fullerene C70", "fullerene?kind=c70"),
        ("Fullerene C80", "fullerene?kind=c80"),
        ("Fullerene C120 (capped tube)", "fullerene?kind=c120"),
        ("Fullerene C200 (capped tube)", "fullerene?kind=c200"))),
)


def surface_entries():
    """[(group, [(label, ('surface', value))])] for the tree."""
    out = []
    for group, faces in _SURFACES:
        rows = []
        for key, hkl in faces:
            crystal = crystal_library.get(key)
            rows.append((surface.label(crystal, surface.parse_miller(hkl)),
                         ("surface", f"{key}:{hkl}")))
        out.append((group, rows))
    return out


def sections():
    """The whole library as ``[(section title, [(group title, [(label,
    (kind, value)), ...]), ...]), ...]`` — the tree and the Explorer both
    walk it."""
    out = []
    # molecules, by family
    groups = []
    for cat in compounds.CATEGORIES:
        rows = [(v[0], ("compound", k)) for k, v in compounds.COMPOUNDS.items()
                if v[2] == cat]
        if rows:
            groups.append((cat, rows))
    total = sum(len(g[1]) for g in groups)
    out.append((f"Molecules — {total}", groups))
    # crystals
    groups = []
    for cat in crystal_library.CATEGORIES:
        rows = [(c.name, ("crystal", c.key))
                for c in crystal_library.LIBRARY.values() if c.category == cat]
        if rows:
            groups.append((cat, rows))
    total = sum(len(g[1]) for g in groups)
    out.append((f"Crystals — {total}", groups))
    # surfaces
    groups = surface_entries()
    total = sum(len(g[1]) for g in groups)
    out.append((f"Surfaces — {total}", groups))
    # carbon and 2D
    groups = [(g, [(label, ("nano", value)) for label, value in rows])
              for g, rows in _NANO]
    total = sum(len(g[1]) for g in groups)
    out.append((f"Graphene, nanotubes & fullerenes — {total}", groups))
    # polymers
    groups = []
    for cat in polymers.CATEGORIES:
        rows = [(v[0], ("polymer", k)) for k, v in polymers.PRESETS.items()
                if v[3] == cat]
        if rows:
            groups.append((cat, rows))
    total = sum(len(g[1]) for g in groups)
    out.append((f"Polymers — {total}", groups))
    # reactions
    rows = [(name, ("reaction", eq)) for name, eq in reactions.EXAMPLES.items()]
    out.append((f"Reactions — {len(rows)}", [("Classic reactions", rows)]))
    # the original hand-placed models
    groups = [(title, [(library.label(k), ("model", k)) for k in keys])
              for title, keys in library.CATEGORIES]
    out.append(("Classic 3D models", groups))
    return out
