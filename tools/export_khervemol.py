#!/usr/bin/env python3
"""Bring the desktop KherveMol's engine and data into KherveOS.

    python3 tools/export_khervemol.py --src <KherveMol source tree>

<src> is a plain copy of the desktop app (e.g. ``git -C ../KherveMol archive
origin/dev | tar -x -C /tmp/km``) — this script never touches a checkout.
It needs PyQt5 locally (only QColor is used) and writes:

* public/apps/khervemol/py/khervemol/   the desktop's Qt-free modules, run
                                        unchanged in Pyodide (with the
                                        PyQt5 stand-in next to them)
* public/apps/khervemol/catalog.json    the library tree / menus, builder
                                        lists, guide, AI settings
* src/apps/khervemol/elementsData.ts    per-element data for the UI
* public/examples/khervemol/            example .kmol and chemistry files
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY_OUT = os.path.join(ROOT, "public", "apps", "khervemol", "py", "khervemol")
CATALOG = os.path.join(ROOT, "public", "apps", "khervemol", "catalog.json")
ELEMENTS_TS = os.path.join(ROOT, "src", "apps", "khervemol", "elementsData.ts")
EXAMPLES = os.path.join(ROOT, "public", "examples", "khervemol")

#: modules the browser engine imports (everything Qt-free, plus the few that
#: only need QColor or import widget names they never use here)
MODULES = [
    "__init__", "adsorbates", "catalog", "chem", "chemexport", "compounds",
    "compounds_extra", "compounds_more", "crystal", "crystal_library", "dnd",
    "document", "elements", "entries", "glshaders", "glview", "lattices",
    "library", "mcp_library", "mcp_schema", "meshexport", "model", "molcolor",
    "molrepr", "nano", "polymers", "properties", "rdkit_io", "reactions",
    "render", "rxanim", "shelf", "smiles", "supercell", "surface",
    "svgexport", "symmetry",
]


def version_of(src):
    """0.1.<commits>+<sha> as the desktop's _version.py derives it."""
    repo = os.environ.get("KHERVEMOL_REPO",
                          os.path.join(os.path.dirname(ROOT), "KherveMol"))
    ref = os.environ.get("KHERVEMOL_REF", "origin/dev")
    try:
        count = subprocess.check_output(["git", "-C", repo, "rev-list",
                                         "--count", ref]).decode().strip()
        sha = subprocess.check_output(["git", "-C", repo, "rev-parse",
                                       "--short", ref]).decode().strip()
        return f"0.1.{count}+{sha}"
    except Exception:                                   # noqa: BLE001
        return "0.1.0"


def copy_modules(src, version):
    if os.path.isdir(PY_OUT):
        shutil.rmtree(PY_OUT)
    os.makedirs(PY_OUT)
    for name in MODULES:
        shutil.copy(os.path.join(src, "khervemol", name + ".py"),
                    os.path.join(PY_OUT, name + ".py"))
    with open(os.path.join(PY_OUT, "_version.py"), "w") as f:
        f.write('"""Version of the desktop KherveMol this engine was taken '
                'from (tools/export_khervemol.py)."""\n\n\n'
                f'def get_version() -> str:\n    return "{version}"\n')
    with open(os.path.join(PY_OUT, "..", "files.json"), "w") as f:
        json.dump(sorted(["khervemol/" + n + ".py"
                          for n in MODULES + ["_version"]]), f, indent=1)


def catalog(km, version):
    from khervemol import (ai_assistant, ai_providers, chemexport, entries,
                           crystal_library, glview, help as help_mod, library,
                           meshexport, molrepr, polymers, reactions, viewer3d)
    sections = []
    for title, groups in entries.sections():
        out_groups = []
        for group, rows in groups:
            out_rows = []
            for label, (kind, value) in rows:
                row = {"label": label, "kind": kind, "value": value}
                tip = entries.smiles_of(kind, value)
                if tip:
                    row["smiles"] = tip
                out_rows.append(row)
            out_groups.append({"title": group, "rows": out_rows})
        sections.append({"title": title, "groups": out_groups})
    classic = [{"title": t, "keys": [{"key": k, "label": library.label(k)}
                                     for k in keys]}
               for t, keys in library.CATEGORIES]
    crystals = []
    for cat in crystal_library.CATEGORIES:
        for c in crystal_library.LIBRARY.values():
            if c.category == cat:
                crystals.append({"key": c.key, "name": c.name,
                                 "category": cat,
                                 "polyhedra": bool(c.polyhedra)})
    poly = []
    for cat in polymers.CATEGORIES:
        for k, v in polymers.PRESETS.items():
            if v[3] == cat:
                poly.append({"key": k, "name": v[0], "unit": v[1], "n": v[2],
                             "category": cat, "head": v[4][0],
                             "tail": v[4][1]})
    return {
        "version": version,
        "sections": sections,
        "classic": classic,
        "crystals": crystals,
        "polymers": poly,
        "reactions": [{"name": n, "equation": e}
                      for n, e in reactions.EXAMPLES.items()],
        "views": [[t, az, el] for t, az, el in viewer3d.STANDARD_VIEWS],
        "styles": [[k, glview.STYLE_LABELS[k]] for k in glview.STYLES],
        "reprModes": [[k, molrepr.MODE_LABELS[k]] for k in molrepr.MODES],
        "meshFormats": [[k, n, t] for k, (n, t) in meshexport.FORMATS.items()],
        "meshStyles": list(meshexport.STYLES),
        "chemFormats": [[k, n, t] for k, (n, t) in chemexport.FORMATS.items()],
        "guide": help_mod._GUIDE,
        "ai": {
            "systemPrompt": ai_assistant.SYSTEM_PROMPT,
            "providers": list(ai_providers.PROVIDERS),
            "names": ai_providers.DISPLAY_NAMES,
            "models": ai_providers.DEFAULT_MODELS,
            "help": ai_providers.PROVIDER_HELP,
            "needsKey": sorted(ai_providers.NEEDS_KEY),
            "bases": ai_providers.DEFAULT_BASE,
        },
    }


def elements_ts():
    from khervemol import elements as E, glview, molrepr
    syms = list(E.SYMBOLS)
    data = {
        "SYMBOLS": syms,
        "NAMES": [E.name(s) for s in syms],
        "WEIGHTS": [E.weight(s) for s in syms],
        "COLORS": [E.color(s) for s in syms],
        "RADII": [E.radius(s) for s in syms],
        "VALENCE": [E.valence(s) for s in syms],
        "KNOWN_VALENCE": dict(E.VALENCE),
        "COVALENT": [E.covalent_radius(s) for s in syms],
        "TEXT_COLOR": [E.text_color(s) for s in syms],
        "BOND_LENGTHS": [[a, b, o, v] for (a, b, o), v in
                         sorted(E._BOND_LENGTHS.items())],
        "ORDER_SHRINK": [E._ORDER_SHRINK[1], E._ORDER_SHRINK[2],
                         E._ORDER_SHRINK[3]],
        "DEFAULT_RADIUS": E._DEFAULT_RADIUS,
        "DEFAULT_COVALENT": E._DEFAULT_COVALENT,
        "PALETTE": list(E.PALETTE),
        "TABLE": [list(t) for t in E.table_cells()],
        "VDW": dict(glview._VDW),
        "VALENCE_E": dict(molrepr.VALENCE_E),
    }
    lines = ["// Generated by tools/export_khervemol.py from the desktop "
             "KherveMol's elements.py — do not edit.", ""]
    for key, value in data.items():
        lines.append(f"export const {key} = {json.dumps(value)} as const")
    os.makedirs(os.path.dirname(ELEMENTS_TS), exist_ok=True)
    with open(ELEMENTS_TS, "w") as f:
        f.write("\n".join(lines) + "\n")


def _flatten(mol):
    """MainWindow._flatten_2d: the 2D sketch the desktop makes without RDKit."""
    from khervemol import model
    keep = [i for i, a in enumerate(mol.atoms)
            if not (not mol.crystal and a[0] == "H")]
    remap = {old: new for new, old in enumerate(keep)}
    out = []
    for i in keep:
        a = mol.atoms[i]
        px, py, _d = model._proj(a[1], a[2], a[3], mol.az, mol.el)
        out.append([a[0], round(px * 46, 3), round(py * 46, 3)])
    bonds = [[remap[i], remap[j], o] for i, j, o in mol.bonds
             if i in remap and j in remap]
    return out, bonds


def examples():
    from khervemol import chemexport, document, entries
    if os.path.isdir(EXAMPLES):
        shutil.rmtree(EXAMPLES)
    os.makedirs(EXAMPLES)
    # the structures the KherveMol web page shows (screenshots/tools/khervemol)
    pick = [
        ("Caffeine", "compound", "caffeine"),
        ("Aspirin", "compound", "aspirin"),
        ("Diamond", "crystal", "diamond?cells=2,2,2"),
        ("Rock salt NaCl", "crystal", "nacl?cells=2,2,2"),
        ("Perovskite SrTiO3", "crystal", "srtio3?cells=2,2,2"),
        ("Buckminsterfullerene C60", "nano", "fullerene?kind=c60"),
        ("Graphene", "nano", "graphene?width=3&depth=3"),
        ("Twisted bilayer graphene", "nano",
         "graphene?width=4&depth=4&layers=2&twist=5"),
        ("Nanotube (10,0)", "nano", "nanotube?n=10&m=0&length=3"),
        ("MoS2 (0001) surface", "surface", "mos2:0001?layers=3"),
        ("Methane combustion", "reaction", "CH4 + 2 O2 -> CO2 + 2 H2O"),
    ]
    index = []
    for title, kind, value in pick:
        mol = entries.build(kind, value, title)
        sk = ([], []) if (mol.crystal or mol.notes) else _flatten(mol)
        name = f"{title}.kmol"
        document.save(os.path.join(EXAMPLES, name), mol, *sk)
        index.append({"title": title, "file": name})
    # one file of every chemistry format the desktop reads
    caffeine = entries.build("compound", "caffeine", "Caffeine")
    for fmt in ("xyz", "mol", "sdf", "pdb"):
        name = f"Caffeine.{fmt}"
        chemexport.export(caffeine, os.path.join(EXAMPLES, name), fmt)
        index.append({"title": name, "file": name})
    rutile = entries.build("crystal", "rutile", "Rutile")
    chemexport.export(rutile, os.path.join(EXAMPLES, "Rutile TiO2.cif"),
                      "cif")
    index.append({"title": "Rutile TiO2.cif", "file": "Rutile TiO2.cif"})
    with open(os.path.join(EXAMPLES, "index.json"), "w") as f:
        json.dump({"examples": index}, f, indent=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", help="KherveMol source tree (a plain copy)")
    args = ap.parse_args()
    src = args.src
    tmp = None
    if not src:
        tmp = tempfile.mkdtemp(prefix="khervemol-")
        repo = os.path.join(os.path.dirname(ROOT), "KherveMol")
        archive = subprocess.run(["git", "-C", repo, "archive", "origin/dev"],
                                 check=True, capture_output=True).stdout
        subprocess.run(["tar", "-x", "-C", tmp], input=archive, check=True)
        src = tmp
    os.environ.setdefault("KHERVEMOL_STATE_DIR", tempfile.mkdtemp())
    os.environ.setdefault("KHERVEMOL_RENDERER", "classic")
    sys.path.insert(0, src)
    version = version_of(src)
    copy_modules(src, version)
    data = catalog(src, version)
    with open(CATALOG, "w") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    elements_ts()
    examples()
    print(f"KherveMol {version}: {len(MODULES)} modules, "
          f"{sum(len(r['rows']) for s in data['sections'] for r in s['groups'])}"
          " library entries")
    if tmp:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
