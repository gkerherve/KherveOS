"""2D chemical representations of a molecular graph.

The same atoms and bonds that back the skeletal sketch also read as the
other diagrams a chemistry figure uses:

* ``skeletal`` — the default drawing: bond lines, carbons as implicit
  vertices, heteroatoms lettered, hydrogens implied.
* ``structural`` — every atom lettered, hydrogens included.
* ``lewis`` — the structural drawing plus lone-pair dots, placed on the
  sides of each atom that no bond is using.
* ``condensed`` — just the molecular formula, in Hill notation.

The **implicit hydrogens** matter here: a skeletal sketch of ethanol has
no H atoms on the canvas at all, so counting the drawn atoms would report
C₂O. `implicit_hydrogens` fills in what each atom's free valence implies,
and `hill_formula` uses it — so the formula in the status bar and the
condensed drawing agree with the chemistry rather than with the picture.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

import math

from . import elements

#: The representation modes, in menu order.
MODES = ["skeletal", "structural", "lewis", "condensed"]
MODE_LABELS = {"skeletal": "Skeletal", "structural": "Structural formula",
               "lewis": "Lewis structure", "condensed": "Condensed formula"}

#: Valence electrons per element, for counting lone pairs. Main-group only:
#: an element that isn't here simply gets no dots rather than a wrong count.
VALENCE_E = {"H": 1, "Li": 1, "Be": 2, "B": 3, "C": 4, "N": 5, "O": 6, "F": 7,
             "Na": 1, "Mg": 2, "Al": 3, "Si": 4, "P": 5, "S": 6, "Cl": 7,
             "K": 1, "Ca": 2, "Ga": 3, "Ge": 4, "As": 5, "Se": 6, "Br": 7,
             "Sn": 4, "Sb": 5, "Te": 6, "I": 7}

_SUBSCRIPT = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")


def subscript(n):
    """*n* as Unicode subscript digits (1 renders as nothing)."""
    return "" if n == 1 else str(n).translate(_SUBSCRIPT)


def bond_orders(atoms, bonds):
    """Total bond order at each atom."""
    total = [0] * len(atoms)
    for bond in bonds:
        i, j, order = bond[0], bond[1], bond[2]
        total[i] += order
        total[j] += order
    return total


def implicit_hydrogens(atoms, bonds):
    """How many hydrogens each atom implies — its free valence, for the
    elements whose valence is known. An explicit H already in the graph
    fills a valence, so it isn't counted twice."""
    used = bond_orders(atoms, bonds)
    out = []
    for idx, atom in enumerate(atoms):
        el = atom[0]
        valence = elements.VALENCE.get(el)
        out.append(max(0, valence - used[idx]) if valence else 0)
    return out


def hill_formula(atoms, bonds=None, implicit=True, unicode_subscripts=True):
    """Hill-notation molecular formula: carbon first, hydrogen second, the
    rest alphabetical. With *implicit* (and a bond list), each atom's free
    valence is counted as hydrogen — what a skeletal drawing means."""
    counts = {}
    for atom in atoms:
        counts[atom[0]] = counts.get(atom[0], 0) + 1
    if implicit and bonds is not None:
        extra = sum(implicit_hydrogens(atoms, bonds))
        if extra:
            counts["H"] = counts.get("H", 0) + extra
    order = []
    if "C" in counts:
        order.append("C")
    if "H" in counts:
        order.append("H")
    order += sorted(e for e in counts if e not in ("C", "H"))
    sub = subscript if unicode_subscripts else \
        (lambda n: "" if n == 1 else str(n))
    return "".join(el + sub(counts[el]) for el in order)


def lone_pairs(element, used_order, implicit_h=0):
    """Lone pairs left on *element* after its bonds (and the hydrogens a
    skeletal drawing implies) have taken their share of the valence
    electrons. Unknown elements get none rather than a guess."""
    ve = VALENCE_E.get(element)
    if ve is None:
        return 0
    return max(0, (ve - used_order - implicit_h) // 2)


def _bond_angles(idx, atoms, bonds):
    """The screen directions of every bond at atom *idx*, in radians."""
    cx, cy = atoms[idx][1], atoms[idx][2]
    out = []
    for bond in bonds:
        i, j = bond[0], bond[1]
        k = j if i == idx else (i if j == idx else None)
        if k is not None:
            out.append(math.atan2(atoms[k][2] - cy, atoms[k][1] - cx))
    return out


def dot_positions(idx, atoms, bonds, radius, spacing, pairs=None):
    """Where to draw atom *idx*'s lone-pair dots: two dots per pair, on the
    directions farthest from any bond so the dots never sit on a bond line.
    Returns a flat list of ``(x, y)`` dot centres."""
    if pairs is None:
        used_order = bond_orders(atoms, bonds)[idx]
        h = implicit_hydrogens(atoms, bonds)[idx]
        pairs = lone_pairs(atoms[idx][0], used_order, h)
    if pairs <= 0:
        return []
    cx, cy = atoms[idx][1], atoms[idx][2]
    used = _bond_angles(idx, atoms, bonds)

    def clearance(a):
        if not used:
            return math.pi
        return min(abs((a - u + math.pi) % (2 * math.pi) - math.pi)
                   for u in used)

    cands = sorted((math.radians(a) for a in range(0, 360, 30)),
                   key=clearance, reverse=True)
    # Keep the chosen directions apart, so two pairs don't overlap.
    chosen = []
    for a in cands:
        if all(abs((a - b + math.pi) % (2 * math.pi) - math.pi)
               > math.radians(50) for b in chosen):
            chosen.append(a)
        if len(chosen) == pairs:
            break
    for a in cands:                        # crowded atom: take what's left
        if len(chosen) >= pairs:
            break
        if a not in chosen:
            chosen.append(a)
    out = []
    for a in chosen[:pairs]:
        bx, by = cx + math.cos(a) * radius, cy + math.sin(a) * radius
        tx, ty = -math.sin(a), math.cos(a)
        for sign in (-1.0, 1.0):
            out.append((bx + tx * spacing * sign, by + ty * spacing * sign))
    return out


def label_color(element):
    """A readable letter colour on a white page: carbon and hydrogen are
    black (the usual convention), heteroatoms keep their CPK colour but the
    pale ones are darkened so they don't vanish."""
    from PyQt5.QtGui import QColor
    from .model import _mix
    if element in ("C", "H"):
        return "#1a1a1a"
    cpk = elements.color(element)
    return _mix(cpk, "#000000", 0.45) if QColor(cpk).lightnessF() > 0.5 else cpk


def shows_all_labels(mode):
    """Whether *mode* letters every atom (hydrogens included)."""
    return mode in ("structural", "lewis")
