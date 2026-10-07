"""The tool table KherveMol offers MCP clients -- schemas only.

Deliberately Qt-free and free of app imports: this is the contract, and
`mcp_tools.py` is the implementation.  Keeping them apart means the
tool list can be inspected (and tested) without a running window, and
the stdio server never drags PyQt5 into the host's subprocess.

`check_args` is the validation layer: the executor runs every call's
arguments through it before a handler sees them, so a misspelt key, a
wrong type or an out-of-range number comes back as one readable error
that names what to change, instead of a traceback from deep inside a
builder.

Every tool answers with JSON.  ``render_view`` additionally returns a
PNG under `mcp_server.IMAGE_KEY`, which the stdio/HTTP servers turn
into a real MCP image block.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from __future__ import annotations

#: named camera presets `set_view` / `render_view` accept (the view cube)
NAMED_VIEWS = ["front", "back", "left", "right", "top", "bottom",
               "isometric"]

#: drawing styles (glview.STYLES; sticks / space filling need OpenGL)
STYLES = ["ball_and_stick", "space_filling", "sticks"]

#: renderers (Viewer3D.renderer)
RENDERERS = ["gl", "classic"]

#: how an adsorbate is turned before it is set on a surface
ADSORB_MODES = ["flat", "upright", "as drawn"]

NANO_STRUCTURES = ["graphene", "ribbon", "dot", "graphite", "defect",
                   "nanotube", "fullerene"]
STACKINGS = ["AB", "ABA", "ABC", "AA"]

#: the parameters each nanostructure takes (mirrors `chem.nano_model`)
NANO_PARAMS = {
    "graphene": ("width", "depth", "layers", "stacking", "twist",
                 "hydrogen"),
    "ribbon": ("edge", "width", "length"),
    "dot": ("diameter",),
    "graphite": ("width", "depth", "layers", "step"),
    "defect": ("kind", "width", "depth", "nitrogen"),
    "nanotube": ("n", "m", "length", "walls", "hydrogen"),
    "fullerene": ("kind",),
}

#: biggest picture render_view / export_image will make, per side
MAX_IMAGE_SIDE = 4000
DEFAULT_IMAGE_SIZE = (1000, 800)


# -- Schema helpers -------------------------------------------------------

def _obj(props: dict, required=()) -> dict:
    return {"type": "object", "properties": props,
            "required": list(required), "additionalProperties": False}


def _s(desc: str, **kw) -> dict:
    return {"type": "string", "description": desc, **kw}


def _i(desc: str, **kw) -> dict:
    return {"type": "integer", "description": desc, **kw}


def _n(desc: str, **kw) -> dict:
    return {"type": "number", "description": desc, **kw}


def _b(desc: str) -> dict:
    return {"type": "boolean", "description": desc}


def _e(desc: str, values) -> dict:
    return {"type": "string", "enum": list(values), "description": desc}


def _arr(desc: str, item: dict, **kw) -> dict:
    return {"type": "array", "items": item, "description": desc, **kw}


_LIMIT = _i("Most rows to return (default 50, at most 500).",
            minimum=1, maximum=500)
_OFFSET = _i("Rows to skip, to page through a long list.", minimum=0)

_PATH = _s("Filesystem path. '~' is expanded; a relative path is taken "
           "from the app's working directory, so prefer an absolute one.")

_SIZE_W = _i("Width in pixels (default 1000).", minimum=64,
             maximum=MAX_IMAGE_SIDE)
_SIZE_H = _i("Height in pixels (default 800).", minimum=64,
             maximum=MAX_IMAGE_SIDE)

_ADSORBATE = {
    "type": "object", "additionalProperties": False,
    "description": (
        "A molecule to set on the slab, NOT bonded to it. Give exactly "
        "one of `smiles`, `compound` (library key, name or formula, e.g. "
        "'water', 'CO2') or `current: true` (the molecule now on screen "
        "-- draw or build it first, then call build_surface)."),
    "properties": {
        "smiles": _s("SMILES of the adsorbate, e.g. 'CO'."),
        "compound": _s("Library compound key, name or formula."),
        "current": _b("Use the molecule currently shown."),
        "kept": _s("Name of a molecule kept on the shelf (keep_molecule)."),
        "height": _n("Distance in angstrom from the top atomic layer to "
                     "the lowest adsorbate atom (default 2.4).",
                     minimum=0.5, maximum=15),
        "dx": _n("Shift along x in angstrom from the slab centre "
                 "(default 0).", minimum=-100, maximum=100),
        "dy": _n("Shift along y in angstrom from the slab centre "
                 "(default 0).", minimum=-100, maximum=100),
        "mode": _e("'flat' lays the flattest side down (default), "
                   "'upright' stands the longest axis up (for a "
                   "two-atom molecule the FIRST atom of the SMILES "
                   "faces the surface, so write CO as '[C-]#[O+]' to "
                   "bind through carbon), 'as drawn' keeps the "
                   "orientation it has.", ADSORB_MODES),
        "spin": _n("Rotation in degrees about the surface normal "
                   "(default 0).", minimum=-360, maximum=360),
    },
}


_ROWS = {"type": "array", "items": {}, "minItems": 3, "maxItems": 4}

#: a crystal the library lacks (mirrors `crystal.custom`)
_CUSTOM = {
    "type": "object", "additionalProperties": False, "required": ["a"],
    "description": (
        "A crystal the library lacks. Lengths in angstrom (or nm with "
        "units:'nm'). Give EITHER `atoms` (every atom of the cell) OR "
        "`space_group` + `basis` (asymmetric unit; expanded with ASE, "
        "which must be installed). E.g. scheelite LaNbO4: {a:5.40, "
        "c:11.66, space_group:'88', setting:2, basis:[['La',0,0.25,0.625],"
        "['Nb',0,0.25,0.125],['O',0.1504,0.0085,0.2111]], polyhedra:"
        "{centre:'Nb', ligand:'O', cutoff:2.1}}."),
    "properties": {
        "name": _s("Display name."),
        "formula": _s("Formula shown in labels."),
        "a": _n("a", minimum=0.01), "b": _n("b (default a)", minimum=0.01),
        "c": _n("c (default a)", minimum=0.01),
        "alpha": _n("alpha, degrees (default 90)"),
        "beta": _n("beta, degrees (default 90)"),
        "gamma": _n("gamma, degrees (default 90)"),
        "units": _e("'angstrom' (default) or 'nm'.", ["angstrom", "nm"]),
        "atoms": _arr("Every atom of the cell: [element, fx, fy, fz].",
                      _ROWS),
        "space_group": _s("Space group as text: the number ('88') or the "
                          "Hermann-Mauguin symbol ('I 41/a'), with "
                          "`basis`."),
        "setting": _i("Origin choice 1 or 2 (default 1).", minimum=1,
                      maximum=2),
        "basis": _arr("Asymmetric unit: [element, fx, fy, fz].", _ROWS),
        "polyhedra": {"type": "object", "additionalProperties": False,
                      "description": "Coordination polyhedra to draw.",
                      "required": ["centre", "ligand", "cutoff"],
                      "properties": {
                          "centre": _s("Centre element, e.g. 'Nb'."),
                          "ligand": _s("Ligand element, e.g. 'O'."),
                          "cutoff": _n("Longest centre-ligand bond.",
                                       minimum=0.01)}},
        "bonds": _arr("Bonds to draw: [element, element, max length]. "
                      "Default: the polyhedra bond, else any pair closer "
                      "than 1.25 x the covalent radii.", _ROWS),
        "system": _s("Crystal system label, e.g. 'tetragonal'."),
        "source": _s("Where the structure comes from."),
    },
}

_CIF = _s("Path to a CIF file to build from (needs ASE installed). '~' is "
          "expanded; prefer an absolute path.")
_DOPE = _arr("Random substitution: [[host, dopant, fraction], ...], e.g. "
             "[['Nb','Mo',0.1]] swaps round(n x 0.1) randomly chosen Nb "
             "for Mo; the dopant bonds like its host.", _ROWS)
_SEED = _i("Random seed for `dope` (default 7): same seed, same atoms.",
           minimum=0)


# -- The tools ------------------------------------------------------------

TOOLS = [
    # ---- looking --------------------------------------------------------
    {
        "name": "get_document_info",
        "description": (
            "What is on screen right now: the label and Hill formula, "
            "atom / bond counts, what kind of thing it is (molecule, "
            "crystal, surface, nanostructure, polymer, reaction), whether "
            "atoms can be edited, renderer / style / view angles (degrees), "
            "the selected atoms, the reaction film state, the .kmol path "
            "and which tab is shown. Call this first. Read-only."),
        "input_schema": _obj({}),
    },
    {
        "name": "search_library",
        "description": (
            "Free-text search across the WHOLE library -- compounds, "
            "crystals, surfaces, graphene / nanotubes / fullerenes, "
            "polymers, reactions and the classic models -- by name, key, "
            "formula or exact SMILES. Every hit is {kind, value, label}: "
            "kind tells you which build tool takes it (compound / smiles "
            "-> build_molecule, crystal -> build_crystal, surface -> "
            "build_surface, nano -> build_nano, polymer -> build_polymer, "
            "reaction -> build_reaction, model / mine -> build_molecule). Use "
            "this before you model anything yourself. Read-only."),
        "input_schema": _obj({
            "text": _s("Words to look for, e.g. 'caffeine', 'C6H12O6', "
                       "'silicon 111', 'nylon'."),
            "kind": _e("Only this kind of entry.",
                       ["compound", "crystal", "surface", "nano",
                        "polymer", "reaction", "model", "mine"]),
            "limit": _i("Most hits to return (default 25, at most 100).",
                        minimum=1, maximum=100),
        }, ["text"]),
    },
    {
        "name": "list_molecules",
        "description": (
            "The compound library (about 490: gases, acids, bases and "
            "ions, salts, VSEPR shapes, hydrocarbons, alcohols, carbonyls, "
            "solvents, biomolecules, drugs, aromatics...). Without "
            "arguments it returns the family names with counts plus the "
            "first page. Filter with `category` (part of a family name) "
            "and/or `search`. With `compound` set it returns that one "
            "molecule IN FULL: SMILES, formula, weight and its 3D atoms "
            "and bonds (angstrom). Also lists the classic hand-placed "
            "models and the user's own kept molecules (`my_molecules`, "
            "the 'My molecules' shelf). Read-only."),
        "input_schema": _obj({
            "category": _s("Part of a family name, e.g. 'alcohol'."),
            "search": _s("Words to match in the name, key or formula."),
            "compound": _s("A compound key, name or formula to return "
                           "in full, including 3D coordinates."),
            "limit": _LIMIT,
            "offset": _OFFSET,
        }),
    },
    {
        "name": "list_crystals",
        "description": (
            "The crystal library: FCC / BCC / HCP metals, diamond and "
            "zinc-blende semiconductors, wurtzite, rock salt, CsCl, "
            "fluorite, rutile, anatase, perovskites, quartz, corundum, "
            "graphite, h-BN, MoS2... Each row has the formula, crystal "
            "system, space group, cell a b c (angstrom) and alpha beta "
            "gamma (degrees), atoms per cell, density (g/cm3) and the "
            "surfaces the library offers for it. With `key` it returns "
            "one crystal in full, including every atom of the cell in "
            "fractional coordinates. Read-only."),
        "input_schema": _obj({
            "key": _s("Crystal key, name or formula to return in full."),
            "category": _s("Part of a category name, e.g. 'oxide'."),
            "search": _s("Words to match in the name, key or formula."),
            "limit": _LIMIT,
            "offset": _OFFSET,
        }),
    },
    {
        "name": "list_polymers",
        "description": (
            "The polymer presets: key, name, repeat-unit SMILES, default "
            "chain length, family and end caps. Any other polymer is "
            "built by build_polymer from a custom repeat-unit SMILES. "
            "Read-only."),
        "input_schema": _obj({
            "search": _s("Words to match in the name or key."),
            "category": _s("Part of a family name, e.g. 'rubber'."),
        }),
    },
    {
        "name": "list_reactions",
        "description": (
            "The example reactions (name -> equation), each with every "
            "species in the library. With `equation` it only PARSES and "
            "balances that equation and reports the coefficients and "
            "whether atoms and charge balance -- nothing is drawn. "
            "Read-only."),
        "input_schema": _obj({
            "search": _s("Words to match in the reaction name or "
                         "equation."),
            "equation": _s("An equation to check, e.g. 'CH4 + O2 -> "
                           "CO2 + H2O'. Species are library formulas, "
                           "names, 'smiles:...' or ions like 'Fe^3+'."),
        }),
    },
    {
        "name": "get_structure",
        "description": (
            "The atoms and bonds of what is on screen as JSON: atoms "
            "[[element, x, y, z]] in angstrom (indexed from 0, the "
            "indices every editing tool uses), bonds [[i, j, order, "
            "length]], and for a crystal its cell edges. Large lattices "
            "are truncated to `max_atoms`. During a reaction film the "
            "atoms are those of the current frame. Read-only."),
        "input_schema": _obj({
            "max_atoms": _i("Most atoms to return (default 300, at most "
                            "5000).", minimum=1, maximum=5000),
            "geometry": _b("Also return bond angles in degrees (i, j, k "
                           "with the vertex at j) for molecules under "
                           "60 atoms."),
        }),
    },
    {
        "name": "properties",
        "description": (
            "The Properties dialog as data: name, formula, molecular "
            "weight, atom / bond counts; with RDKit installed also exact "
            "mass, logP, TPSA, H-bond donors / acceptors, rotatable "
            "bonds, rings, InChI. A crystal reports its cell contents and "
            "density instead. Read-only."),
        "input_schema": _obj({}),
    },
    {
        "name": "render_view",
        "description": (
            "A PNG of the 3D view, returned as an image you can look at. "
            "Do this after building or editing anything non-trivial. "
            "`az`, `el`, `orientation`, `style`, `labels` and `bond_spread` "
            "render from that camera / look and then RESTORE the user's "
            "view, so it is safe to call from any angle. `view` '2d' "
            "renders the skeletal sketch instead. Read-only."),
        "input_schema": _obj({
            "view": _e("'3d' (default) or the '2d' skeletal sketch.",
                       ["3d", "2d"]),
            "orientation": _e("A named camera, as the view cube.",
                              NAMED_VIEWS),
            "az": _n("Azimuth in degrees (turn about the vertical axis).",
                     minimum=-360, maximum=360),
            "el": _n("Elevation in degrees (+90 looks straight down).",
                     minimum=-90, maximum=90),
            "style": _e("Drawing style for this picture.", STYLES),
            "labels": _b("Print the element symbol on every atom."),
            "bond_spread": _n("Bond length / atom spacing factor "
                              "(1.0 true scale; molecules read best "
                              "around 1.6).", minimum=0.0, maximum=3.0),
            "width": _SIZE_W,
            "height": _SIZE_H,
        }),
    },
    {
        "name": "select_atoms",
        "description": (
            "Highlight atoms in the window (green ring; the last is the "
            "primary selection add_atom bonds onto by default). Changes "
            "nothing in the structure -- use it to point at what you are "
            "describing. An empty list clears the selection."),
        "input_schema": _obj({
            "atoms": _arr("Atom indices (from get_structure).",
                          {"type": "integer", "minimum": 0}),
        }, ["atoms"]),
    },
    # ---- building --------------------------------------------------------
    {
        "name": "build_molecule",
        "description": (
            "Show a molecule in the 3D view and the 2D sketch. Give `name` "
            "(a library key, name or formula: 'ethanol', 'caffeine', "
            "'C2H6O' -- see search_library; '@Molecule_1' loads a "
            "molecule the user kept on their shelf) OR `smiles` (any SMILES; "
            "RDKit's embedder when installed, else the built-in one). "
            "Geometry is real (true bond lengths and angles, aromatic "
            "rings planar). Replaces what is on screen unless mode is "
            "'add', which merges it in as a separate fragment next to the "
            "current molecule."),
        "input_schema": _obj({
            "name": _s("Library key, name or formula."),
            "smiles": _s("A SMILES string."),
            "label": _s("Title to show for a SMILES molecule."),
            "mode": _e("'replace' (default) or 'add' beside the current "
                       "molecule.", ["replace", "add"]),
        }),
    },
    {
        "name": "build_crystal",
        "description": (
            "Show a library crystal: its conventional cell repeated "
            "`cells` = [nx, ny, nz] times (each 1 to 30), with the cell "
            "outline and bonds between nearest neighbours. Atoms on a "
            "cell face are drawn in every cell that shares it unless "
            "`boundary` is false (then only the true contents of the "
            "block). Crystals rotate and zoom but atoms cannot be "
            "edited. list_crystals gives the keys. Instead of `crystal` "
            "give `custom` (any cell: every atom, or space group + "
            "asymmetric unit) or `cif` (a file); `dope` substitutes random "
            "host atoms (a doped block shows the true cell contents)."),
        "input_schema": _obj({
            "crystal": _s("Crystal key, name or formula, e.g. 'cu', "
                          "'rutile', 'nacl'."),
            "custom": _CUSTOM,
            "cif": _CIF,
            "dope": _DOPE,
            "seed": _SEED,
            "cells": _arr("Repeats along a, b, c (default [1,1,1]).",
                          {"type": "integer", "minimum": 1, "maximum": 30},
                          minItems=3, maxItems=3),
            "boundary": _b("Draw shared boundary atoms in every cell "
                           "(default true)."),
        }),
    },
    {
        "name": "build_surface",
        "description": (
            "A slab of a library crystal cut along a Miller plane, "
            "bulk-terminated, top layer at z = 0 facing +z: Si(111), "
            "Cu(100), rutile (110), quartz (0001), GaN (10-10). `repeat` "
            "is surface cells across [u, v] (default about 15 angstrom), "
            "`layers` interplanar spacings deep, `termination` (0 to "
            "just under 1 of a layer) picks which plane terminates. Add "
            "`adsorbate` to place a molecule above the slab, e.g. CO on "
            "Pt(111): {smiles:'[C-]#[O+]', height:1.9, mode:'upright'}. "
            "The adsorbate is positioned, not bonded. Instead of `crystal` "
            "give `custom` or `cif` (as build_crystal). `complete` keeps "
            "every coordination polyhedron whole at the cut (ligands "
            "added from beyond the cut and across the periodic edge, "
            "orphan ligands dropped: stoichiometric), `dope` substitutes "
            "random host atoms, e.g. LaNb0.9Mo0.1O4 (001): custom "
            "scheelite, miller '001', repeat [5,5], layers 2, complete "
            "true, dope [['Nb','Mo',0.1]]."),
        "input_schema": _obj({
            "crystal": _s("Crystal key, name or formula."),
            "custom": _CUSTOM,
            "cif": _CIF,
            "complete": _b("Whole polyhedra at the cut (the crystal "
                           "must have polyhedra; default false)."),
            "dope": _DOPE,
            "seed": _SEED,
            "miller": _s("Miller indices: '111', '1 1 0', '0001', "
                         "'10-10' (hexagonal h k i l)."),
            "repeat": _arr("Surface cells [u, v] (each 1 to 80).",
                           {"type": "integer", "minimum": 1,
                            "maximum": 80}, minItems=2, maxItems=2),
            "layers": _i("Interplanar spacings deep (default 3).",
                         minimum=1, maximum=60),
            "termination": _n("Where the cut falls, 0 to <1 of a layer.",
                              minimum=0, maximum=0.999),
            "adsorbate": _ADSORBATE,
        }, ["miller"]),
    },
    {
        "name": "add_to_surface",
        "description": (
            "Put one more molecule on the surface that is on screen "
            "(build_surface first). Give exactly one of `smiles`, "
            "`compound`, `kept` (a name from the shelf) or `current: true`. "
            "With `auto` (default true when other molecules are already "
            "there) it goes to the first free spot clear of them; "
            "otherwise it is centred plus dx, dy. It is not bonded, and "
            "move_adsorbate can move it afterwards. Returns its index and "
            "pose."),
        "input_schema": _obj({
            "smiles": _s("SMILES of the molecule."),
            "compound": _s("Library compound key, name or formula."),
            "kept": _s("Name of a kept molecule (see keep_molecule)."),
            "current": _b("Use the molecule that was on screen."),
            "height": _n("Angstrom from the top layer to the lowest atom "
                         "(default 2.4).", minimum=0.5, maximum=15),
            "dx": _n("Shift along x from the slab centre, angstrom.",
                     minimum=-100, maximum=100),
            "dy": _n("Shift along y from the slab centre, angstrom.",
                     minimum=-100, maximum=100),
            "mode": _e("flat (default), upright or as drawn.", ADSORB_MODES),
            "spin": _n("Degrees about the surface normal.", minimum=-360,
                       maximum=360),
            "auto": _b("Place at the first free spot."),
        }, []),
    },
    {
        "name": "move_adsorbate",
        "description": (
            "Move or turn a molecule lying on the surface: choose it by "
            "`index` (0 is the first added) or `name`. Absolute: x, y (its "
            "centre, angstrom, in the slab's frame) and height (lowest "
            "atom above the top layer). Relative: dx, dy, dz slide it; "
            "turn (about the surface normal), roll (about x) and tilt "
            "(about y) rotate it about its own centre, in degrees. Returns "
            "the new pose."),
        "input_schema": _obj({
            "index": _i("Which adsorbate (see get_document_info).",
                        minimum=0),
            "name": _s("Its name instead of the index."),
            "x": _n("Absolute x of its centre, angstrom."),
            "y": _n("Absolute y of its centre, angstrom."),
            "height": _n("Absolute height of its lowest atom above the "
                         "top layer, angstrom.", minimum=0.3, maximum=30),
            "dx": _n("Slide along x, angstrom."),
            "dy": _n("Slide along y, angstrom."),
            "dz": _n("Slide up (+) or down (-), angstrom."),
            "turn": _n("Rotate about the surface normal, degrees."),
            "roll": _n("Rotate about x, degrees."),
            "tilt": _n("Rotate about y, degrees."),
        }, []),
    },
    {
        "name": "remove_adsorbate",
        "description": ("Take a molecule off the surface, chosen by "
                        "`index` or `name`."),
        "input_schema": _obj({
            "index": _i("Which adsorbate.", minimum=0),
            "name": _s("Its name instead of the index."),
        }, []),
    },
    {
        "name": "build_nano",
        "description": (
            "Carbon nanostructures, exact lattice, sizes in NANOMETRES. "
            "structure 'graphene': width, depth, layers (1-12), stacking "
            "AB/ABA/ABC/AA, twist (degrees, moire angle for layer 2), "
            "hydrogen. 'ribbon': edge armchair|zigzag, width, length. "
            "'dot': diameter (graphene quantum dot, H-capped). 'graphite': "
            "width, depth, layers, step (a monatomic step). 'defect': "
            "kind vacancy|nitrogen, width, depth, nitrogen (fraction). "
            "'nanotube': n, m (chirality), length, walls, hydrogen. "
            "'fullerene': kind c20, c60, c70, c80... (C60 + 10k is a "
            "capped tube). Parameters that do not belong to the chosen "
            "structure are rejected."),
        "input_schema": _obj({
            "structure": _e("Which nanostructure.", NANO_STRUCTURES),
            "width": _n("Width in nm.", minimum=0.5, maximum=20),
            "depth": _n("Depth in nm.", minimum=0.5, maximum=20),
            "length": _n("Length in nm.", minimum=0.5, maximum=30),
            "diameter": _n("Diameter in nm (dot).", minimum=0.5,
                           maximum=20),
            "layers": _i("Number of layers.", minimum=1, maximum=12),
            "stacking": _e("Layer stacking.", STACKINGS),
            "twist": _n("Twist of the second layer in degrees.",
                        minimum=-90, maximum=90),
            "hydrogen": _b("Cap dangling bonds with hydrogen."),
            "edge": _e("Ribbon edge.", ["armchair", "zigzag"]),
            "kind": _s("defect: 'vacancy' or 'nitrogen'; fullerene: "
                       "'c60', 'c70'..."),
            "nitrogen": _n("Nitrogen fraction of the carbons (defect).",
                           minimum=0.001, maximum=0.5),
            "n": _i("Nanotube chirality index n.", minimum=1, maximum=40),
            "m": _i("Nanotube chirality index m (0 to n).", minimum=0,
                    maximum=40),
            "walls": _i("Nanotube walls (1 or 2 ...).", minimum=1,
                        maximum=4),
            "step": _b("Graphite: half of the top sheet removed."),
        }, ["structure"]),
    },
    {
        "name": "build_polymer",
        "description": (
            "A polymer chain. Give `preset` (a key from list_polymers: "
            "'pvc', 'polyethylene', 'pmma'...) OR `unit` (the repeat "
            "unit as SMILES with open ends, e.g. 'CC(Cl)' for PVC). `n` "
            "is the number of repeat units (1 to 200, capped by the "
            "atom limit); `head` / `tail` are end-cap SMILES (default "
            "none, so the chain ends carry hydrogen)."),
        "input_schema": _obj({
            "preset": _s("Polymer preset key."),
            "unit": _s("Custom repeat-unit SMILES."),
            "n": _i("Repeat units.", minimum=1, maximum=200),
            "head": _s("Head cap SMILES."),
            "tail": _s("Tail cap SMILES."),
        }),
    },
    {
        "name": "build_reaction",
        "description": (
            "Draw a chemical reaction as a scene: every species as a 3D "
            "molecule with its coefficient, plus signs and an arrow. "
            "Write it as a chemist does: '2 H2 + O2 -> 2 H2O', 'N2 + 3 "
            "H2 <=> 2 NH3'. Leave coefficients out and `balance` (default "
            "true) finds the smallest whole numbers. The result says "
            "whether atoms AND charge balance -- report a mismatch to the "
            "user. `play: true` starts the animated film. Species: "
            "formulas, library names, 'smiles:CCO', ions like 'Fe^3+', "
            "or a kept molecule '@Molecule_1' (its exact geometry is "
            "used, see keep_molecule)."),
        "input_schema": _obj({
            "equation": _s("The reaction, with -> or <=>."),
            "balance": _b("Fill in missing coefficients (default true)."),
            "play": _b("Run the animation after building (default "
                       "false)."),
        }, ["equation"]),
    },
    {
        "name": "play_reaction",
        "description": (
            "Control the reaction film of the reaction on screen: "
            "'play' (from the start, or resume), 'pause', or 'stop' "
            "(back to the equation scene). Optionally `restore_at_end` "
            "returns to the equation when the film finishes. Errors if "
            "the scene is not a reaction."),
        "input_schema": _obj({
            "action": _e("play (default), pause or stop.",
                         ["play", "pause", "stop"]),
            "restore_at_end": _b("Return to the equation scene when the "
                                 "film ends."),
        }),
    },
    {
        "name": "set_reaction_progress",
        "description": (
            "Jump the reaction film to `progress` 0..1 (0 reactants "
            "spread out, 0.25 collision, 0.5 bonds break / atoms "
            "rearrange, 0.75 new bonds, 1 products separate). Returns "
            "the stage name; follow it with render_view to look at the "
            "moment. Pauses a running film."),
        "input_schema": _obj({
            "progress": _n("Film position from 0 to 1.", minimum=0,
                           maximum=1),
        }, ["progress"]),
    },
    # ---- editing --------------------------------------------------------
    {
        "name": "add_atom",
        "description": (
            "Bond a new atom of `element` (any of the 118, e.g. 'O', "
            "'Cl') onto an existing atom, placed in a free direction at "
            "the real bond length for that pair and order (C-O 1.43 A, "
            "C=O 1.23 A). `anchor` defaults to the selected atom, else "
            "the last atom; `order` 1-3 (default 1). If the anchor has "
            "no free valence the atom is placed free (unbonded) and "
            "`bonded` is false -- delete a hydrogen from the anchor "
            "first. Returns the new atom's index. Molecules only."),
        "input_schema": _obj({
            "element": _s("Element symbol."),
            "anchor": _i("Atom index to bond onto.", minimum=0),
            "order": _i("Bond order 1, 2 or 3.", minimum=1, maximum=3),
        }, ["element"]),
    },
    {
        "name": "fill_hydrogens",
        "description": (
            "Cap every free valence of the given atoms (default: all "
            "non-hydrogen atoms) with hydrogen, using each element's "
            "normal valence. Use it after delete_atom / add_atom edits "
            "that left open bonds. Charged species get extra hydrogens "
            "up to the neutral valence, so check the formula. Molecules "
            "only."),
        "input_schema": _obj({
            "atoms": _arr("Atom indices to cap (default all heavy "
                          "atoms).", {"type": "integer", "minimum": 0}),
        }),
    },
    {
        "name": "delete_atom",
        "description": (
            "Delete atoms and their bonds. Indices SHIFT afterwards "
            "(atoms above a deleted one move down) -- call get_structure "
            "again. Several indices are deleted highest first so the "
            "numbers you give stay valid. At least one atom must remain. "
            "Molecules only."),
        "input_schema": _obj({
            "atoms": _arr("Indices of the atoms to delete.",
                          {"type": "integer", "minimum": 0}, minItems=1),
        }, ["atoms"]),
    },
    {
        "name": "bond_atoms",
        "description": (
            "Join two EXISTING atoms with a bond of `order` (1-3), then "
            "bring them to the real bond length (the smaller fragment "
            "slides; closing a ring leaves the geometry). Refused when "
            "an atom has no free valence or they are already bonded -- "
            "the error says which. Molecules only."),
        "input_schema": _obj({
            "i": _i("First atom index.", minimum=0),
            "j": _i("Second atom index.", minimum=0),
            "order": _i("Bond order 1, 2 or 3 (default 1).", minimum=1,
                        maximum=3),
        }, ["i", "j"]),
    },
    {
        "name": "set_bond_order",
        "description": (
            "Make the existing bond between atoms `i` and `j` single, "
            "double or triple and re-lengthen it (C-O 1.43 A becomes "
            "C=O 1.23 A). Raising the order needs free valence on both "
            "atoms. Molecules only."),
        "input_schema": _obj({
            "i": _i("First atom index.", minimum=0),
            "j": _i("Second atom index.", minimum=0),
            "order": _i("New bond order 1, 2 or 3.", minimum=1,
                        maximum=3),
        }, ["i", "j", "order"]),
    },
    {
        "name": "delete_bond",
        "description": (
            "Remove the bond between atoms `i` and `j`, leaving both "
            "atoms where they are (their valence is freed). Molecules "
            "only."),
        "input_schema": _obj({
            "i": _i("First atom index.", minimum=0),
            "j": _i("Second atom index.", minimum=0),
        }, ["i", "j"]),
    },
    {
        "name": "move_atom",
        "description": (
            "Move one atom to `position` [x, y, z] angstrom, or by "
            "`delta` [dx, dy, dz]. With `keep_bond_lengths` (default "
            "true) the atom is pulled back onto every neighbour's real "
            "bond length, exactly like dragging it in the window, so a "
            "bond swings instead of stretching; false places it "
            "verbatim. Molecules only."),
        "input_schema": _obj({
            "atom": _i("Atom index.", minimum=0),
            "position": _arr("New absolute position.", {"type": "number"},
                             minItems=3, maxItems=3),
            "delta": _arr("Displacement to add.", {"type": "number"},
                          minItems=3, maxItems=3),
            "keep_bond_lengths": _b("Constrain to real bond lengths "
                                    "(default true)."),
        }, ["atom"]),
    },
    {
        "name": "keep_molecule",
        "description": (
            "Keep the molecule on screen on the user's 'My molecules' "
            "shelf (saved in their user data folder) under `name` "
            "(default 'Molecule N'; an existing name is replaced). It "
            "can then be reloaded with build_molecule(name='@Name') and "
            "used as a species in build_reaction as '@Name', drawn with "
            "exactly this geometry. Molecules only."),
        "input_schema": _obj({
            "name": _s("Name to keep it under, e.g. 'My ester'."),
        }),
    },
    # ---- view -----------------------------------------------------------
    {
        "name": "set_view",
        "description": (
            "Change the USER'S view. `orientation` snaps to a named "
            "camera; `az` / `el` (degrees) set the angles directly. "
            "`style` ball_and_stick / space_filling / sticks (the latter "
            "two need the OpenGL renderer); `renderer` gl or classic "
            "(gl falls back to classic where OpenGL is unavailable -- "
            "`renderer` in the result says what is in use); `labels` "
            "prints element symbols; `bond_spread` scales bond length / "
            "atom spacing; `polyhedra` draws coordination polyhedra "
            "where an atom has 4 or more neighbours; `cell_outline` shows "
            "or hides the cell box of a crystal / surface; `tab` shows "
            "the 3D view or the 2D sketch. Only the keys you pass "
            "change."),
        "input_schema": _obj({
            "orientation": _e("Named camera.", NAMED_VIEWS),
            "az": _n("Azimuth in degrees.", minimum=-360, maximum=360),
            "el": _n("Elevation in degrees.", minimum=-90, maximum=90),
            "style": _e("Drawing style.", STYLES),
            "renderer": _e("Renderer.", RENDERERS),
            "labels": _b("Show element labels."),
            "bond_spread": _n("Bond length / atom spacing factor.",
                              minimum=0.0, maximum=3.0),
            "polyhedra": _b("Coordination polyhedra on / off."),
            "cell_outline": _b("Show or hide the unit-cell / slab "
                               "outline (crystals and surfaces)."),
            "tab": _e("Which tab to show.", ["3d", "2d"]),
        }),
    },
    # ---- files ----------------------------------------------------------
    {
        "name": "new_document",
        "description": (
            "Start an empty document: a single carbon atom to build "
            "from. The current molecule is discarded WITHOUT a prompt -- "
            "offer save_document first when the user drew it."),
        "input_schema": _obj({}),
    },
    {
        "name": "open_document",
        "description": (
            "Open a .kmol file (3D structure, view and 2D sketch). "
            "Replaces what is on screen. Needs MCP access 'Full'."),
        "input_schema": _obj({"path": _PATH}, ["path"]),
    },
    {
        "name": "save_document",
        "description": (
            "Save the document as .kmol. With no `path` it saves over the "
            "file already open (an error if there is none yet). A `path` "
            "that names an existing different file needs `overwrite: "
            "true`. Needs MCP access 'Full' when a path is given."),
        "input_schema": _obj({
            "path": _PATH,
            "overwrite": _b("Allow replacing an existing file."),
        }),
    },
    {
        "name": "export_image",
        "description": (
            "Write a PNG of the 3D view (or the 2D sketch with view "
            "'2d') to `path`, `width` x `height` pixels (default "
            "1600 x 1200). Needs MCP access 'Full'."),
        "input_schema": _obj({
            "path": _PATH,
            "view": _e("'3d' (default) or '2d'.", ["3d", "2d"]),
            "width": _SIZE_W,
            "height": _SIZE_H,
            "overwrite": _b("Allow replacing an existing file."),
        }, ["path"]),
    },
    {
        "name": "export_svg",
        "description": (
            "Write a KhervePaint-compatible SVG of the 3D view (spheres "
            "as gradient-filled ellipses, bonds as lines -- opens in "
            "KhervePaint as editable shapes) or of the 2D sketch with "
            "view '2d'. Needs MCP access 'Full'."),
        "input_schema": _obj({
            "path": _PATH,
            "view": _e("'3d' (default) or '2d'.", ["3d", "2d"]),
            "overwrite": _b("Allow replacing an existing file."),
        }, ["path"]),
    },
    {
        "name": "export_model",
        "description": (
            "Export the structure on screen as a file. 3D model formats "
            "(for 3D printing, Blender, viewers): .stl (geometry only), "
            ".3mf (one material per colour), .obj (+ .mtl), .ply (vertex "
            "colours), .glb (glTF). Chemistry formats: .xyz, .mol, .sdf, "
            ".pdb, and .cif (crystals, slabs and supercells only). The "
            "format is taken from the extension. For 3D models, "
            "scale_mm_per_angstrom sets the size (10 prints a C-C bond "
            "15 mm long); the file stands on z = 0, millimetres. Needs MCP "
            "access 'Full'."),
        "input_schema": _obj({
            "path": _PATH,
            "style": _e("Mesh style (3D formats only): ball_and_stick "
                        "(default), space_filling or sticks.",
                        ["ball_and_stick", "space_filling", "sticks"]),
            "scale_mm_per_angstrom": _n(
                "Size of a 3D model in millimetres per angstrom "
                "(default 10).", minimum=0.05, maximum=1000),
            "quality": _e("Sphere smoothness: low, medium (default) or "
                          "high.", ["low", "medium", "high"]),
            "cell_outline": _b("Include the unit-cell / slab outline as "
                               "thin rods (3D formats only)."),
            "min_bond_mm": _n("Thinnest bond in millimetres (default 1.6).",
                              minimum=0.2, maximum=10),
            "ascii": _b("Write an STL as text instead of binary."),
            "overwrite": _b("Allow replacing an existing file."),
        }, ["path"]),
    },
]

TOOL_NAMES = [t["name"] for t in TOOLS]
_BY_NAME = {t["name"]: t for t in TOOLS}


def tool_schema(name: str):
    """The schema dict of tool *name*, or None."""
    return _BY_NAME.get(name)


# -- Argument validation ---------------------------------------------------

class ArgError(ValueError):
    """Arguments that do not fit a tool's schema; the text says how to
    fix them."""


def _kind(value) -> str:
    return {bool: "a boolean", int: "an integer", float: "a number",
            str: "a string", list: "an array", dict: "an object",
            type(None): "null"}.get(type(value), type(value).__name__)


def _coerce(value, schema: dict, path: str):
    """*value* checked against *schema*; lenient about numbers and
    booleans sent as strings (models do that), strict about the rest."""
    where = f"'{path}'"
    want = schema.get("type")
    if want == "string":
        if not isinstance(value, str):
            raise ArgError(f"{where} must be a string, not {_kind(value)}.")
        out = value
    elif want in ("integer", "number"):
        noun = "an integer" if want == "integer" else "a number"
        if isinstance(value, str):
            try:
                value = float(value) if want == "number" else int(value)
            except ValueError:
                raise ArgError(f"{where} must be {noun}, not the text "
                               f"{value!r}.")
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ArgError(f"{where} must be {noun}, not {_kind(value)}.")
        if value != value or value in (float("inf"), float("-inf")):
            raise ArgError(f"{where} must be a finite number.")
        if want == "integer":
            if isinstance(value, float):
                if value != int(value):
                    raise ArgError(f"{where} must be a whole number, "
                                   f"not {value}.")
                value = int(value)
        elif isinstance(value, int):
            value = float(value)
        if "minimum" in schema and value < schema["minimum"]:
            raise ArgError(f"{where} must be at least {schema['minimum']}, "
                           f"not {value}.")
        if "maximum" in schema and value > schema["maximum"]:
            raise ArgError(f"{where} must be at most {schema['maximum']}, "
                           f"not {value}.")
        out = value
    elif want == "boolean":
        if isinstance(value, str) and value.lower() in ("true", "false"):
            value = value.lower() == "true"
        if not isinstance(value, bool):
            raise ArgError(f"{where} must be true or false, "
                           f"not {_kind(value)}.")
        out = value
    elif want == "array":
        if not isinstance(value, (list, tuple)):
            raise ArgError(f"{where} must be an array, not {_kind(value)}.")
        lo, hi = schema.get("minItems", 0), schema.get("maxItems")
        if len(value) < lo or (hi is not None and len(value) > hi):
            need = (f"exactly {lo}" if hi == lo else
                    f"at least {lo}" if hi is None else f"{lo} to {hi}")
            raise ArgError(f"{where} needs {need} items, got {len(value)}.")
        item = schema.get("items", {})
        out = [_coerce(v, item, f"{path}[{k}]") if item else v
               for k, v in enumerate(value)]
    elif want == "object":
        if not isinstance(value, dict):
            raise ArgError(f"{where} must be an object, not {_kind(value)}.")
        out = check_args(schema, value, path)
    else:
        out = value
    if "enum" in schema and out not in schema["enum"]:
        raise ArgError(f"{where} must be one of "
                       f"{', '.join(map(str, schema['enum']))}; "
                       f"got {out!r}.")
    return out


def check_args(schema: dict, args, where: str = "arguments") -> dict:
    """Validate *args* against an object *schema*; returns the cleaned
    dict (numbers coerced) or raises `ArgError`."""
    if args is None:
        args = {}
    if not isinstance(args, dict):
        raise ArgError(f"{where} must be an object, not {_kind(args)}.")
    props = schema.get("properties", {})
    unknown = [k for k in args if k not in props]
    if unknown:
        allowed = ", ".join(props) or "(none)"
        raise ArgError(f"Unknown {'parameters' if len(unknown) > 1 else 'parameter'} "
                       f"{', '.join(map(repr, unknown))} in {where}. "
                       f"Accepted: {allowed}.")
    missing = [k for k in schema.get("required", ()) if args.get(k) is None]
    if missing:
        raise ArgError(f"Missing required "
                       f"{'parameters' if len(missing) > 1 else 'parameter'} "
                       f"{', '.join(map(repr, missing))} in {where}.")
    out = {}
    for key, value in args.items():
        if value is None:               # an omitted optional
            continue
        prefix = key if where == "arguments" else f"{where}.{key}"
        out[key] = _coerce(value, props[key], prefix)
    return out
