"""Space groups and CIF files through ASE — an OPTIONAL dependency (Qt-free).

* `expand` — an asymmetric unit + a space group (number or Hermann-Mauguin
  symbol, origin choice 1 or 2) -> every atom of the conventional cell;
* `read_cif` — a CIF file -> a `crystal.Crystal` (bonds guessed from the
  covalent radii, as for any crystal given without them).

ASE (``pip install ase``) is imported lazily, only when one of these is
called; without it they raise ValueError saying how to install it or how
to do without (give every atom of the cell). Everything else in KherveMol
runs without ASE.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from __future__ import annotations

import os

NO_ASE = ("Space groups and CIF files need ASE: install ase (pip install "
          "ase) or give every atom of the cell as 'atoms'.")


def available() -> bool:
    try:
        import ase  # noqa: F401
    except ImportError:
        return False
    return True


def _ase():
    try:
        import ase.spacegroup  # noqa: F401
        import ase.io  # noqa: F401
    except ImportError:
        raise ValueError(NO_ASE)
    import ase
    return ase


def expand(space_group, basis, cellpar, setting=1):
    """Every atom of the conventional cell, ``[(el, fx, fy, fz)]``, from the
    asymmetric unit *basis* ``[(el, fx, fy, fz)]`` and *space_group* (a
    number 1-230 or a symbol such as ``'I 41/a'``); *cellpar* is
    ``(a, b, c, alpha, beta, gamma)``. Raises ValueError."""
    ase = _ase()
    if setting not in (1, 2):
        raise ValueError("setting is 1 or 2 (the origin choice).")
    try:
        sg = int(space_group)
    except (TypeError, ValueError):
        sg = str(space_group).strip()
    if not basis:
        raise ValueError("The basis (asymmetric unit) is empty.")
    try:
        atoms = ase.spacegroup.crystal(
            [row[0] for row in basis],
            basis=[tuple(float(x) for x in row[1:4]) for row in basis],
            spacegroup=sg, setting=setting, cellpar=list(cellpar))
    except Exception as exc:                          # noqa: BLE001
        raise ValueError(f"Cannot expand space group {space_group!r}: "
                         f"{exc}")
    return [(el, *(float(x) % 1.0 for x in f))
            for el, f in zip(atoms.get_chemical_symbols(),
                             atoms.get_scaled_positions(wrap=True))]


def read_cif(path):
    """A `crystal.Crystal` from the CIF at *path* (its first structure).
    Raises ValueError with the reason."""
    from . import crystal as cr
    ase = _ase()
    try:
        atoms = ase.io.read(path, format="cif")
    except Exception as exc:                          # noqa: BLE001
        raise ValueError(f"Cannot read {os.path.basename(path)}: {exc}")
    if not len(atoms):
        raise ValueError(f"{os.path.basename(path)} holds no atoms.")
    a, b, c, al, be, ga = (float(x) for x in atoms.cell.cellpar())
    name = os.path.splitext(os.path.basename(path))[0]
    formula = atoms.get_chemical_formula(mode="hill", empirical=True)
    sg = atoms.info.get("spacegroup")
    sg = getattr(sg, "symbol", None) or "?"
    crystal = cr.Crystal(
        key="cif", name=f"{name} ({formula})", formula=formula,
        category="CIF", system="from CIF", space_group=str(sg),
        a=a, b=b, c=c, alpha=al, beta=be, gamma=ga,
        atoms=[(el, *(float(x) % 1.0 for x in f))
               for el, f in zip(atoms.get_chemical_symbols(),
                                atoms.get_scaled_positions(wrap=True))],
        source=os.path.basename(path))
    cr.auto_bonds(crystal)
    return crystal
