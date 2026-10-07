"""Molecular properties — formula, weight and RDKit descriptors.

`compute(molecule)` returns an ordered list of ``(label, value)`` rows.
Formula, molecular weight and atom counts are computed from the built-in
element data, so they always work. When RDKit is installed it adds the
richer descriptors (exact mass, logP, TPSA, H-bond donors/acceptors,
rotatable bonds, rings, InChI/InChIKey, canonical SMILES). Crystals are
reported as a unit-cell composition (molecular descriptors don't apply).

`PropertiesDialog` shows the rows in a copyable table.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import (QAbstractItemView, QDialog, QDialogButtonBox,
                             QHeaderView, QLabel, QTableWidget,
                             QTableWidgetItem, QVBoxLayout)

from . import elements, lattices, rdkit_io

#: Advanced descriptor key -> (row label, formatter).
_ADVANCED = [
    ("ExactMW", "Exact mass", lambda v: f"{v:.4f} g/mol"),
    ("LogP", "LogP (Crippen)", lambda v: f"{v:.2f}"),
    ("TPSA", "TPSA", lambda v: f"{v:.1f} Å²"),
    ("HBD", "H-bond donors", str),
    ("HBA", "H-bond acceptors", str),
    ("RotatableBonds", "Rotatable bonds", str),
    ("Rings", "Rings", str),
    ("AromaticRings", "Aromatic rings", str),
    ("Heteroatoms", "Heteroatoms", str),
    ("FractionCSP3", "Fraction sp³ C", lambda v: f"{v:.2f}"),
    ("SMILES", "Canonical SMILES", str),
    ("InChIKey", "InChIKey", str),
    ("InChI", "InChI", str),
]


def _composition(mol):
    counts = {}
    for a in mol.atoms:
        counts[a[0]] = counts.get(a[0], 0) + 1
    return counts


def molecular_weight(mol):
    return sum(elements.weight(e) * n for e, n in _composition(mol).items())


def _crystal_rows(mol):
    """The lattice half of a crystal's property sheet. A supercell's formula
    counts the atoms actually drawn, which is not the stoichiometric unit —
    shared corners belong to several cells at once — so say so rather than
    let the number be read as a composition."""
    rows = [("Type", "Crystal lattice")]
    params = lattices.param_text(mol.name)
    if params:
        rows.append(("Lattice parameters", params))
    if mol.stacked:
        nx, ny, nz = mol.cells
        rows.append(("Supercell", f"{nx} × {ny} × {nz} = {nx * ny * nz} "
                                  "unit cells"))
        rows.append(("Note", "Counts are for the drawn supercell: atoms "
                             "shared between cells are counted once, so the "
                             "formula is not the stoichiometric unit."))
    else:
        rows.append(("Supercell", "single unit cell"))
    if mol.tilts:
        rows.append(("Tilted cells",
                     ", ".join("(%s) %g°, %g°, %g°"
                               % ((k.replace(",", ", "),) + tuple(v))
                               for k, v in sorted(mol.tilts.items()))))
    coord = _coordination(mol)
    if coord:
        rows.append(("Coordination", coord))
    rows.append(("Descriptors", "Molecular descriptors do not apply to a "
                                "periodic lattice."))
    return rows


def _coordination(mol):
    """How many neighbours each bonded element has, e.g. "Ti 6, O 2"."""
    count = {}
    for bond in mol.bonds:
        for k in (bond[0], bond[1]):
            count[k] = count.get(k, 0) + 1
    if not count:
        return ""
    per = {}
    for idx, n in count.items():
        per.setdefault(mol.atoms[idx][0], set()).add(n)
    return ", ".join(f"{el} {'/'.join(str(n) for n in sorted(ns))}"
                     for el, ns in sorted(per.items()))


def compute(mol):
    """Ordered ``[(label, value), ...]`` property rows for *mol*."""
    counts = _composition(mol)
    heavy = sum(n for e, n in counts.items() if e != "H")
    rows = [
        ("Name", mol.label),
        ("Formula", mol.formula() or "—"),
        ("Molecular weight", f"{molecular_weight(mol):.2f} g/mol"),
        ("Atoms", str(len(mol.atoms))),
        ("Heavy atoms", str(heavy)),
        ("Bonds", str(len(mol.bonds))),
    ]
    if mol.crystal:
        if mol.notes:
            rows.append(("Type", "Reaction scene"))
            rows.append(("Note", "The formula and weight are the sum of "
                                 "every species drawn, not one molecule."))
            return rows
        # "Molecular weight" would read as a molar mass; for a lattice it is
        # just the mass of what is drawn.
        rows[2] = ("Mass drawn", rows[2][1])
        return rows[:1] + _crystal_rows(mol) + rows[1:]

    adv = rdkit_io.descriptors_from_structure(mol.atoms, mol.bonds)
    if adv:
        for key, label, fmt in _ADVANCED:
            if key in adv:
                try:
                    rows.append((label, fmt(adv[key])))
                except Exception:                   # pragma: no cover
                    rows.append((label, str(adv[key])))
    elif rdkit_io.available():
        rows.append(("Note", "RDKit could not interpret this structure for "
                             "descriptors."))
    else:
        rows.append(("Note", "Install RDKit (pip install rdkit) for logP, "
                             "TPSA, InChI, H-bond counts and more."))
    return rows


class PropertiesDialog(QDialog):
    """Show a molecule's properties in a copyable two-column table."""

    def __init__(self, mol, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Molecule properties")
        self.setMinimumSize(460, 460)
        layout = QVBoxLayout(self)

        title = QLabel(f"<b>{mol.label}</b>")
        layout.addWidget(title)

        rows = compute(mol)
        table = QTableWidget(len(rows), 2)
        table.setHorizontalHeaderLabels(["Property", "Value"])
        table.verticalHeader().setVisible(False)
        table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        table.setSelectionBehavior(QAbstractItemView.SelectRows)
        table.setWordWrap(True)
        for r, (label, value) in enumerate(rows):
            table.setItem(r, 0, QTableWidgetItem(label))
            table.setItem(r, 1, QTableWidgetItem(str(value)))
        table.horizontalHeader().setSectionResizeMode(
            0, QHeaderView.ResizeToContents)
        table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        table.resizeRowsToContents()
        layout.addWidget(table, 1)

        buttons = QDialogButtonBox(QDialogButtonBox.Close)
        buttons.rejected.connect(self.reject)
        buttons.accepted.connect(self.accept)
        layout.addWidget(buttons)
