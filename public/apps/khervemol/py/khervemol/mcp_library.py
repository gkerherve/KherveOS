"""Library lookups for the MCP tools -- listing, searching, resolving.

Everything here reads the chemistry data (`compounds`,
`crystal_library`, `polymers`, `reactions`, `entries`) and returns plain
JSON-able values, so the read-only tools cost nothing to run, cannot
touch the window and are testable without one.

Errors are `khervemol.crystal.BuildError` with a compact message that
names close matches, never the whole library (the compound table alone
has about 490 keys).

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from __future__ import annotations

import difflib
import math
import re

from . import (compounds, crystal_library, elements, entries, library,
               polymers, reactions, shelf)
from .crystal import BuildError


def _norm(text) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(text).strip().lower()).strip("_")


def _page(rows, limit, offset):
    limit = 50 if limit is None else limit
    offset = offset or 0
    return rows[offset:offset + limit], {"total": len(rows), "offset": offset,
                                         "returned": min(limit, max(
                                             0, len(rows) - offset))}


def _close(query, candidates, n=5):
    return difflib.get_close_matches(_norm(query), list(candidates), n=n,
                                     cutoff=0.5)


def _words(text):
    return [w for w in re.split(r"[\s,]+", str(text).strip().lower()) if w]


def _matches(text, haystack):
    """Every word of *text* occurs in *haystack* (lower-case)."""
    return all(w in haystack for w in _words(text))


# -- Compounds -------------------------------------------------------------

def compound_key(name):
    """The `compounds.COMPOUNDS` key for a key / name / alias / formula,
    or None."""
    text = str(name).strip()
    k = compounds.ALIASES.get(_norm(text), _norm(text))
    if k in compounds.COMPOUNDS:
        return k
    lowered = text.lower()
    for key, row in compounds.COMPOUNDS.items():
        if row[0].lower() == lowered:
            return key
    found = compounds.by_formula(text) if text[:1].isupper() else []
    return found[0] if found else None


def compound_row(key):
    name, smi, cat, formula = compounds.COMPOUNDS[key]
    return {"key": key, "name": name, "formula": formula, "smiles": smi,
            "category": cat}


def list_molecules(category=None, search=None, compound=None, limit=None,
                   offset=None):
    if compound:
        return compound_detail(compound)
    rows = []
    for key, (name, smi, cat, formula) in compounds.COMPOUNDS.items():
        if category and category.lower() not in cat.lower():
            continue
        if search and not _matches(search,
                                  f"{key} {name} {formula} {cat}".lower()):
            continue
        rows.append(compound_row(key))
    cats = {}
    for row in compounds.COMPOUNDS.values():
        cats[row[2]] = cats.get(row[2], 0) + 1
    page, meta = _page(rows, limit, offset)
    out = dict(meta, molecules=page)
    kept = shelf_rows(search) if not category else []
    if kept:
        out["my_molecules"] = kept
    if not (category or search):
        out["categories"] = [{"name": c, "count": cats[c]}
                             for c in compounds.CATEGORIES if c in cats]
    if not category:
        out["classic_models"] = [
            {"key": k, "label": library.label(k)} for k in library.names()
            if not library.is_crystal(k)
            and (not search or _matches(
                search, f"{k} {library.label(k)}".lower()))][:60]
    if not page:
        out["hint"] = ("No compound matches. Try search_library, or build "
                       "it from SMILES with build_molecule(smiles=...).")
    return out


def shelf_rows(search=None):
    """The molecules the user kept on the 'My molecules' shelf."""
    box = shelf.default()
    rows = []
    for name in box.names():
        if search and not _matches(search, name.lower()):
            continue
        rows.append({"name": name, "formula": box.formula(name),
                     "token": shelf.token(name),
                     "atoms": len(box.get(name)["atoms"])})
    return rows


def shelf_name(name):
    """The shelf entry *name* refers to (``@Molecule_1`` or a plain name),
    or None."""
    box = shelf.default()
    return name.lstrip("@") if name and name in box else None


def compound_detail(name):
    key = compound_key(name)
    if key is None:
        raise BuildError(_no_compound(name))
    from . import chem                   # heavy: load lazily
    mol = chem.compound_model(key)
    weight = sum(elements.weight(a[0]) for a in mol.atoms)
    row = compound_row(key)
    row.update({
        "molecular_weight": round(weight, 3),
        "atoms": [[a[0]] + [round(v, 4) for v in a[1:4]]
                  for a in mol.atoms],
        "bonds": [list(b) for b in mol.bonds],
        "unit": "angstrom",
    })
    return row


def _no_compound(name):
    keys = list(compounds.COMPOUNDS)
    names = {v[0].lower(): k for k, v in compounds.COMPOUNDS.items()}
    close = _close(name, keys) + [names[n] for n in difflib.get_close_matches(
        str(name).lower(), list(names), n=3, cutoff=0.6)]
    seen = []
    for k in close:
        if k not in seen:
            seen.append(k)
    hint = f" Did you mean: {', '.join(seen[:6])}?" if seen else ""
    return (f"No library compound '{name}'.{hint} Use search_library to "
            "look, or pass a SMILES string to build_molecule.")


# -- Crystals ----------------------------------------------------------------

def crystal_by_name(name):
    """The `Crystal` for a key / name / formula; BuildError with close
    matches otherwise."""
    text = str(name).strip()
    lib = crystal_library.LIBRARY
    key = _norm(text)
    if key in lib:
        return lib[key]
    for c in lib.values():
        if c.name.lower() == text.lower() or c.formula.lower() == text.lower():
            return c
    hits = [c for c in lib.values()
            if _matches(text, f"{c.key} {c.name} {c.formula}".lower())]
    if len(hits) == 1:
        return hits[0]
    pool = hits or [lib[k] for k in _close(text, lib)]
    hint = (f" Did you mean: {', '.join(c.key for c in pool[:6])}?"
            if pool else "")
    raise BuildError(f"No library crystal '{name}'.{hint} list_crystals "
                     "shows them all.")


_SURFACE_MAP = {}


def _surfaces_of(key):
    """The Miller planes the library offers for crystal *key*."""
    if not _SURFACE_MAP:
        for _group, rows in entries.surface_entries():
            for _label, (_kind, value) in rows:
                k, _, hkl = value.partition(":")
                _SURFACE_MAP.setdefault(k, []).append(hkl)
    return list(_SURFACE_MAP.get(key, ()))


def crystal_row(c):
    return {"key": c.key, "name": c.name, "formula": c.formula,
            "category": c.category, "system": c.system,
            "space_group": c.space_group,
            "cell": {"a": round(c.a, 4), "b": round(c.b, 4),
                     "c": round(c.c, 4), "alpha": c.alpha, "beta": c.beta,
                     "gamma": c.gamma},
            "atoms_per_cell": len(c.atoms),
            "density_g_cm3": (round(c.density, 3) if c.density
                              else round(c.computed_density(), 3)),
            "surfaces": _surfaces_of(c.key)}


def list_crystals(key=None, category=None, search=None, limit=None,
                  offset=None):
    if key:
        c = crystal_by_name(key)
        out = crystal_row(c)
        out.update({
            "volume_A3": round(c.volume(), 3),
            "computed_density_g_cm3": round(c.computed_density(), 3),
            "composition": c.composition(),
            "atoms": [[el, round(fx, 5), round(fy, 5), round(fz, 5)]
                      for el, fx, fy, fz in c.atoms],
            "atoms_are": "fractional coordinates of the conventional cell",
            "nearest_neighbours": [[a, b, round(d, 3)]
                                   for a, b, d in c.bonds],
            "polyhedra": c.polyhedra and {k: v for k, v in
                                          c.polyhedra.items()
                                          if k != "sites"},
            "source": c.source,
        })
        return out
    rows = []
    for c in crystal_library.LIBRARY.values():
        if category and category.lower() not in c.category.lower():
            continue
        if search and not _matches(
                search, f"{c.key} {c.name} {c.formula} {c.system}".lower()):
            continue
        rows.append(crystal_row(c))
    page, meta = _page(rows, limit, offset)
    return {"categories": list(crystal_library.CATEGORIES), **meta,
            "crystals": page}


# -- Polymers & reactions ----------------------------------------------------

def polymer_by_key(key):
    k = _norm(key)
    if k in polymers.PRESETS:
        return k
    for pk, row in polymers.PRESETS.items():
        if row[0].lower() == str(key).strip().lower():
            return pk
    close = _close(key, polymers.PRESETS)
    hint = f" Did you mean: {', '.join(close)}?" if close else ""
    raise BuildError(f"No polymer preset '{key}'.{hint} list_polymers shows "
                     "them, or pass a repeat-unit SMILES as `unit`.")


def list_polymers(search=None, category=None):
    rows = []
    for key, (name, unit, n, cat, (head, tail)) in polymers.PRESETS.items():
        if category and category.lower() not in cat.lower():
            continue
        if search and not _matches(search, f"{key} {name} {cat}".lower()):
            continue
        rows.append({"key": key, "name": name, "unit": unit,
                     "default_n": n, "category": cat, "head": head,
                     "tail": tail})
    return {"total": len(rows), "polymers": rows,
            "categories": list(polymers.CATEGORIES)}


def reaction_report(rx):
    n = len(rx.left)
    return {
        "equation": rx.equation,
        "source": rx.source,
        "balanced": bool(rx.balanced),
        "reversible": bool(rx.reversible),
        "coefficients": [float(c) if c != int(c) else int(c)
                         for c in rx.coefs],
        "reactants": [t.label for t in rx.left],
        "products": [t.label for t in rx.right],
        "atom_balance": {k: {"left": a, "right": b}
                         for k, (a, b) in rx.table.items()},
        "warning": None if rx.balanced else (
            "Atoms or charge do NOT balance: "
            + ", ".join(k for k, (a, b) in rx.table.items()
                        if not math.isclose(a, b))),
        "species_count": n + len(rx.right),
    }


def list_reactions(search=None, equation=None):
    if equation:
        try:
            return reaction_report(reactions.solve(equation))
        except (BuildError, ValueError, KeyError) as exc:
            raise BuildError(str(exc.args[0] if exc.args else exc))
    rows = [{"name": n, "equation": eq}
            for n, eq in reactions.EXAMPLES.items()
            if not search or _matches(search, f"{n} {eq}".lower())]
    return {"total": len(rows), "reactions": rows,
            "note": "build_reaction takes any equation; species are "
                    "library formulas or names, 'smiles:...' or ions."}


# -- Free-text search over the whole library ----------------------------------

_KIND_TOOL = {"mine": "build_molecule", "compound": "build_molecule", "smiles": "build_molecule",
              "model": "build_molecule", "crystal": "build_crystal",
              "surface": "build_surface", "nano": "build_nano",
              "polymer": "build_polymer", "reaction": "build_reaction"}


def _score(words, text):
    """Lower is better; None when a word is missing."""
    if not all(w in text for w in words):
        return None
    joined = " ".join(words)
    if text == joined:
        return 0
    if text.startswith(joined):
        return 1
    return 2 + (len(text) - len(joined)) / 1000.0


def search(text, kind=None, limit=25):
    words = _words(text)
    if not words:
        raise BuildError("search_library needs some text to look for.")
    raw = str(text).strip()
    found = []                                   # (score, row)
    seen = set()

    def add(score, row):
        ident = (row["kind"], row["value"])
        if score is None or ident in seen:
            return
        if kind and row["kind"] != kind:
            return
        seen.add(ident)
        row["build_with"] = _KIND_TOOL.get(row["kind"])
        found.append((score, row))

    # exact SMILES of a library compound
    for key, (name, smi, cat, formula) in compounds.COMPOUNDS.items():
        if smi == raw:
            add(-1, {"kind": "compound", "value": key, "label": name,
                     "formula": formula, "smiles": smi})
    # formula
    if raw[:1].isupper() and " " not in raw:
        try:
            for key in compounds.by_formula(raw):
                add(-0.5, {"kind": "compound", "value": key,
                           "label": compounds.COMPOUNDS[key][0],
                           "formula": compounds.COMPOUNDS[key][3],
                           "smiles": compounds.COMPOUNDS[key][1]})
        except Exception:                        # noqa: BLE001
            pass
    for section, groups in entries.sections():
        for group, rows in groups:
            for label, (k, value) in rows:
                hay = f"{label} {value} {group}".lower()
                row = {"kind": k, "value": value, "label": label,
                       "group": group, "section": section.split(" —")[0]}
                if k == "compound":
                    _n, smi, _c, formula = compounds.COMPOUNDS[value]
                    row.update(formula=formula, smiles=smi)
                    hay += f" {formula.lower()}"
                s = _score(words, label.lower())
                if s is None and all(w in hay for w in words):
                    s = 3
                add(s, row)
    found.sort(key=lambda t: t[0])
    limit = 25 if limit is None else limit
    rows = [r for _s, r in found[:limit]]
    out = {"query": raw, "total": len(found), "results": rows}
    if not rows:
        out["hint"] = ("Nothing in the library. If it is a molecule, build "
                       "it from SMILES with build_molecule(smiles=...).")
    elif len(found) > limit:
        out["hint"] = "More matches exist: narrow the text or pass `kind`."
    return out


_NANO_WORDS = ("graphene", "graphite", "nanotube", "nanoribbon",
               "quantum_dot", "fullerene", "nanoribbon")


def molecule_kind(mol) -> str:
    """molecule / crystal / surface / surface+adsorbate / nanostructure /
    polymer / reaction for the structure on screen."""
    name = str(mol.name)
    if mol.notes or mol.reaction:
        return "reaction"
    if name.endswith("+ads"):
        return "surface+adsorbate"
    if name.startswith("surface:"):
        return "surface"
    if name.startswith("polymer:"):
        return "polymer"
    if name.startswith("crystal:"):
        return "crystal"
    low = name.lower()
    if re.fullmatch(r"c\d+", low) or any(w in low for w in _NANO_WORDS) \
            or "graphene" in str(mol.label).lower() \
            or "nanotube" in str(mol.label).lower():
        return "nanostructure"
    return "crystal" if mol.crystal else "molecule"
