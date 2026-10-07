"""Crystal structures (Qt-free): a lattice plus every atom of its cell.

A `Crystal` is a lattice — a, b, c in ångström and α, β, γ in degrees,
any of the seven crystal systems — plus EVERY atom of its conventional
cell as fractional coordinates. Writing the cell out atom by atom,
instead of an asymmetric unit plus a space-group table, keeps each
entry checkable by eye and needs no symmetry engine; the library's
tests pin every entry to its published density and nearest-neighbour
distance, which catches a missing atom or a slipped coordinate at once.

The lattice follows the crystallographic convention: a along x, b in
the xy plane, c completing a right-handed cell. Lengths are ÅNGSTRÖM,
KherveMol's own unit.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from . import elements

#: g/mol per Å^3 -> g/cm^3 is 1 / (N_A x 1e-24 cm^3) = 1 / 0.602214076
AVOGADRO_CM3 = 0.602214076

#: ligand count -> the polyhedron's name
SHAPE_NAMES = {3: "triangles", 4: "tetrahedra", 5: "bipyramids",
               6: "octahedra", 8: "cubes", 12: "cuboctahedra"}


def radius(element: str) -> float:
    """Covalent radius, Å."""
    return elements.covalent_radius(element)


def colour(element: str) -> str:
    return elements.color(element)


def _clean(value: float) -> float:
    """cos 90° is 6e-17, not 0 — and a zero keeps the program short."""
    return 0.0 if abs(value) < 1e-12 else value


class BuildError(ValueError):
    """A structure that cannot be built; says what to change."""


@dataclass
class Crystal:
    """One crystal structure (lengths in Å, angles in degrees)."""
    key: str
    name: str
    formula: str
    category: str
    system: str
    space_group: str
    a: float
    b: float
    c: float
    alpha: float = 90.0
    beta: float = 90.0
    gamma: float = 90.0
    #: every atom of the conventional cell: (element, fx, fy, fz)
    atoms: list = field(default_factory=list)
    #: {"centre", "ligand", "cutoff" (Å), "sites" (atom indices) or None}
    polyhedra: dict | None = None
    #: reference density g/cm^3 and nearest distances [(el, el, Å)]
    density: float | None = None
    bonds: list = field(default_factory=list)
    source: str = ""
    #: explicit bond cutoffs {(el, el) sorted: max length Å}, used as they
    #: are (the ``bonds`` distances get a 12 % slack instead)
    cutoffs: dict = field(default_factory=dict)

    # ------------------------------------------------------- geometry
    def vectors(self):
        """Lattice vectors a1, a2, a3 in Å."""
        al, be, ga = (math.radians(x) for x in (self.alpha, self.beta,
                                                self.gamma))
        ca, cb = _clean(math.cos(al)), _clean(math.cos(be))
        cg, sg = _clean(math.cos(ga)), math.sin(ga)
        x3 = self.c * cb
        y3 = _clean(self.c * (ca - cb * cg) / sg)
        z3 = math.sqrt(max(self.c ** 2 - x3 * x3 - y3 * y3, 0.0))
        return ((self.a, 0.0, 0.0),
                (_clean(self.b * cg), self.b * sg, 0.0),
                (_clean(x3), y3, z3))

    def cart(self, f):
        """Fractional -> Cartesian (Å)."""
        v1, v2, v3 = self.vectors()
        return tuple(f[0] * v1[i] + f[1] * v2[i] + f[2] * v3[i]
                     for i in range(3))

    def volume(self) -> float:
        v1, v2, v3 = self.vectors()
        cx = (v2[1] * v3[2] - v2[2] * v3[1], v2[2] * v3[0] - v2[0] * v3[2],
              v2[0] * v3[1] - v2[1] * v3[0])
        return abs(v1[0] * cx[0] + v1[1] * cx[1] + v1[2] * cx[2])

    def mass(self) -> float:
        """g/mol of one conventional cell."""
        return sum(elements.weight(el) for el, *_f in self.atoms)

    def computed_density(self) -> float:
        return self.mass() / (self.volume() * AVOGADRO_CM3)

    def composition(self) -> dict:
        counts = {}
        for el, *_f in self.atoms:
            counts[el] = counts.get(el, 0) + 1
        return counts

    def _images(self, f, reach):
        r = range(-reach, reach + 1)
        for i in r:
            for j in r:
                for k in r:
                    yield self.cart((f[0] + i, f[1] + j, f[2] + k))

    def nearest(self, el1: str, el2: str) -> float:
        """Shortest el1-el2 distance through the periodic images, Å."""
        best = math.inf
        for e1, *f1 in self.atoms:
            if e1 != el1:
                continue
            p = self.cart(f1)
            for e2, *f2 in self.atoms:
                if e2 != el2:
                    continue
                for q in self._images(f2, 1):
                    d = math.dist(p, q)
                    if 1e-6 < d < best:
                        best = d
        return best

    # ------------------------------------------------------ polyhedra
    def polyhedra_sites(self):
        """[(atom index, centre xyz, [ligand xyz])] for every centre in
        the cell; ligands may lie in neighbouring cells (Å)."""
        spec = self.polyhedra
        if not spec:
            return []
        sites = spec.get("sites")
        out = []
        for idx, (el, *f) in enumerate(self.atoms):
            if el != spec["centre"] or (sites is not None
                                        and idx not in sites):
                continue
            p = self.cart(f)
            ligands = [q for e, *g in self.atoms if e == spec["ligand"]
                       for q in self._images(g, 2)
                       if 1e-6 < math.dist(p, q) <= spec["cutoff"]]
            out.append((idx, p, ligands))
        return out

    def polyhedra_label(self) -> str:
        """"SiO4 tetrahedra" — or "" when the crystal has none."""
        sites = self.polyhedra_sites()
        if not sites:
            return ""
        n = len(sites[0][2])
        spec = self.polyhedra
        return (f"{spec['centre']}{spec['ligand']}{n} "
                f"{SHAPE_NAMES.get(n, 'polyhedra')}")

    # -------------------------------------------------------- listing
    def summary(self) -> dict:
        """What list_crystals reports — lengths in nm."""
        return {
            "key": self.key, "name": self.name, "formula": self.formula,
            "category": self.category, "system": self.system,
            "space_group": self.space_group,
            "a_nm": round(self.a / 10, 5), "b_nm": round(self.b / 10, 5),
            "c_nm": round(self.c / 10, 5), "alpha": self.alpha,
            "beta": self.beta, "gamma": self.gamma,
            "atoms_per_cell": len(self.atoms),
            "composition": self.composition(),
            "density_g_cm3": round(self.computed_density(), 3),
            "polyhedra": self.polyhedra_label() or None,
            "source": self.source,
        }


def custom(spec: dict) -> Crystal:
    """A crystal from a plain dict — what an assistant passes when the
    library lacks one: ``{"name", "a", "b", "c", "alpha", "beta",
    "gamma", "atoms": [[el, fx, fy, fz], ...], "polyhedra": {"centre",
    "ligand", "cutoff"}, "bonds": [[el, el, max_length], ...], "units":
    "angstrom" | "nm"}``.

    Instead of ``atoms`` (every atom of the cell) it may give ``"space_group"``
    (number or Hermann-Mauguin symbol), ``"setting"`` (1 or 2, the origin
    choice) and ``"basis"`` (the asymmetric unit, ``[[el, fx, fy, fz],
    ...]``), expanded by `symmetry.expand` — that needs ASE. Without
    ``bonds`` or ``polyhedra`` every element pair closer than 1.25 x the
    sum of covalent radii is bonded. Raises ValueError with the reason."""
    if not isinstance(spec, dict):
        raise ValueError("A custom crystal is an object with a, b, c, "
                         "angles and atoms.")
    units = str(spec.get("units", "angstrom")).lower()
    if units not in ("angstrom", "a", "å", "nm", "nanometre", "nanometer"):
        raise ValueError("custom units are 'angstrom' or 'nm'.")
    to_a = 10.0 if units.startswith("n") else 1.0
    try:
        a = float(spec["a"]) * to_a
        b = float(spec.get("b", spec["a"])) * to_a
        c = float(spec.get("c", spec["a"])) * to_a
        angles = [float(spec.get(k, 90.0))
                  for k in ("alpha", "beta", "gamma")]
    except (KeyError, TypeError, ValueError):
        raise ValueError("A custom crystal needs a number 'a' (and 'b', "
                         "'c' if they differ).")
    if min(a, b, c) <= 0 or not all(0 < x < 180 for x in angles):
        raise ValueError("Cell lengths must be positive and angles "
                         "between 0 and 180 degrees.")
    sg = spec.get("space_group")
    expand = spec.get("basis") is not None and not spec.get("atoms")
    rows = _rows(spec.get("basis") if expand else spec.get("atoms"))
    if expand:
        if sg in (None, ""):
            raise ValueError("A 'basis' (asymmetric unit) needs a "
                             "'space_group' to expand it.")
        from . import symmetry
        rows = symmetry.expand(sg, rows, (a, b, c, *angles),
                               int(spec.get("setting", 1)))
    atoms = [(el, *(x % 1.0 for x in f)) for el, *f in rows]
    if not atoms:
        raise ValueError("A custom crystal needs at least one atom "
                         "('atoms', or 'space_group' + 'basis').")
    poly = spec.get("polyhedra")
    if poly:
        try:
            poly = {"centre": str(poly["centre"]).capitalize(),
                    "ligand": str(poly["ligand"]).capitalize(),
                    "cutoff": float(poly["cutoff"]) * to_a,
                    "sites": None}
        except (KeyError, TypeError, ValueError):
            raise ValueError("polyhedra is {centre, ligand, cutoff}.")
    cutoffs = {}
    for row in spec.get("bonds") or []:
        try:
            e1, e2, d = (str(row[0]).capitalize(), str(row[1]).capitalize(),
                         float(row[2]) * to_a)
        except (IndexError, TypeError, ValueError):
            raise ValueError("Each bond is [element, element, max length].")
        cutoffs[tuple(sorted((e1, e2)))] = d
    if poly:
        cutoffs.setdefault(tuple(sorted((poly["centre"], poly["ligand"]))),
                           poly["cutoff"])
    name = str(spec.get("name") or "Custom crystal")
    crystal = Crystal(
        key="custom", name=name, formula=str(spec.get("formula") or name),
        category="Custom", system=str(spec.get("system") or "custom"),
        space_group=str(sg if sg not in (None, "") else "?"),
        a=a, b=b, c=c, alpha=angles[0], beta=angles[1], gamma=angles[2],
        atoms=atoms, polyhedra=poly or None, cutoffs=cutoffs,
        source=str(spec.get("source") or "given by the user"))
    if crystal.volume() < 1e-6:
        raise ValueError("Those angles give a flat cell.")
    if not cutoffs:
        auto_bonds(crystal)
    return crystal


def _rows(rows):
    """[(el, fx, fy, fz)] checked from ``[[el, fx, fy, fz], ...]``."""
    out = []
    for row in rows or []:
        if not isinstance(row, (list, tuple)) or len(row) != 4:
            raise ValueError("Each atom is [element, fx, fy, fz] "
                             "(fractional coordinates).")
        el = str(row[0]).strip().capitalize()
        if el not in elements.NUMBERS:
            raise ValueError(f"Unknown element '{row[0]}'.")
        try:
            out.append((el, *(float(x) for x in row[1:])))
        except (TypeError, ValueError):
            raise ValueError(f"Coordinates of {el} must be numbers.")
    return out


def auto_bonds(crystal, slack=1.25):
    """Fill ``crystal.bonds`` with the nearest distance of every element
    pair closer than *slack* x the sum of their covalent radii — the bond
    guess for a crystal given without bonds (a CIF, a custom cell)."""
    best = {}
    pts = [(el, crystal.cart(f)) for el, *f in crystal.atoms]
    for i, (e1, p) in enumerate(pts):
        for e2, *f2 in crystal.atoms[i:]:
            key = tuple(sorted((e1, e2)))
            for q in crystal._images(f2, 1):
                d = math.dist(p, q)
                if 1e-6 < d < best.get(key, math.inf):
                    best[key] = d
    found = [(e1, e2, round(d, 3)) for (e1, e2), d in sorted(best.items())
             if d < slack * (radius(e1) + radius(e2))]
    crystal.bonds = found
    return found
