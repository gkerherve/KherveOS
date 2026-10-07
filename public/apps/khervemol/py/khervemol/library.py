"""Built-in molecule and crystal library.

Each ``_mol_*`` / ``_xtal_*`` builder returns ``(atoms, bonds, edges)``
where atoms are ``(element, x, y, z)``, bonds are ``(i, j, order)`` and
edges are optional unit-cell segments. `make(name)` wraps that in a
`model.Molecule` ready for the viewer. Metadata (LABELS, CATEGORIES)
drives the library menu / tree.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

import math

from . import lattices, supercell
from .model import (Molecule, TETRA, add, add_bonded_atom, cross, free_valence,
                    minus, perp, scale, plus, unit, DEFAULT_AZ, DEFAULT_EL)
from .molcolor import SITE_COLORS

_add, _scale, _plus = add, scale, plus


def _site(atoms, el, p, site):
    """Append an atom on a **hidden lattice site** — a body/face centre or
    an interior tetrahedral hole. Same element as the corners means the
    sphere would vanish against them, so it carries the site tint (the
    optional 5th atom slot; see `molcolor`)."""
    atoms.append((el, p[0], p[1], p[2], SITE_COLORS[site]))
    return len(atoms) - 1


def _grow(atoms, bonds, anchor, element, order=1):
    """Bond a new *element* onto *anchor* at a free tetrahedral direction and
    the real bond length — the same maths the interactive builder uses.

    Always prefer this to hand-written offsets: an atom's remaining bonding
    directions depend on the bonds it already has, so a hard-coded basis is
    only right for the *first* centre of a structure."""
    return add_bonded_atom(atoms, bonds, anchor, element, order)


def _fill_h(atoms, bonds, anchor):
    """Cap every remaining valence on *anchor* with hydrogens."""
    while free_valence(atoms, bonds, anchor) > 0:
        _grow(atoms, bonds, anchor, "H")


def _sp2_dirs(back, normal):
    """The two directions 120° either side of *back*, in the plane whose
    normal is *normal* — a trigonal-planar centre (carbonyl, aromatic)."""
    side = unit(cross(normal, back))
    half, sin120 = -0.5, math.sqrt(3.0) / 2.0
    return ((back[0] * half + side[0] * sin120,
             back[1] * half + side[1] * sin120,
             back[2] * half + side[2] * sin120),
            (back[0] * half - side[0] * sin120,
             back[1] * half - side[1] * sin120,
             back[2] * half - side[2] * sin120))


# --- small molecules -------------------------------------------------------
def _mol_water():
    a = math.radians(52.25)
    atoms, bonds = [], []
    i_o = _add(atoms, "O", (0.0, 0.0, 0.0))
    for sx in (1, -1):
        h = (0.96 * math.sin(a) * sx, 0.96 * math.cos(a), 0.0)
        bonds.append((i_o, _add(atoms, "H", h), 1))
    return atoms, bonds, None


def _mol_ammonia():
    atoms, bonds = [], []
    i_n = _add(atoms, "N", (0.0, 0.0, 0.0))
    for k in range(3):
        ang = math.radians(90 + k * 120)
        h = (0.82 * math.cos(ang), 0.82 * math.sin(ang), -0.40)
        bonds.append((i_n, _add(atoms, "H", h), 1))
    return atoms, bonds, None


def _mol_methane():
    atoms, bonds = [], []
    i_c = _add(atoms, "C", (0.0, 0.0, 0.0))
    for d in TETRA:
        bonds.append((i_c, _add(atoms, "H", _scale(d, 1.09)), 1))
    return atoms, bonds, None


def _mol_carbon_dioxide():
    atoms, bonds = [], []
    i_c = _add(atoms, "C", (0.0, 0.0, 0.0))
    for sx in (1, -1):
        bonds.append((i_c, _add(atoms, "O", (1.16 * sx, 0.0, 0.0)), 2))
    return atoms, bonds, None


def _mol_water_dimer():
    return _mol_water()


def _mol_methanol():
    atoms, bonds = [], []
    i_c = _add(atoms, "C", (0.0, 0.0, 0.0))
    i_o = _grow(atoms, bonds, i_c, "O")
    _grow(atoms, bonds, i_o, "H")
    _fill_h(atoms, bonds, i_c)
    return atoms, bonds, None


def _mol_ethanol():
    atoms, bonds = [], []
    i_c1 = _add(atoms, "C", (0.0, 0.0, 0.0))
    i_c2 = _grow(atoms, bonds, i_c1, "C")
    i_o = _grow(atoms, bonds, i_c2, "O")
    _grow(atoms, bonds, i_o, "H")
    _fill_h(atoms, bonds, i_c1)
    _fill_h(atoms, bonds, i_c2)
    return atoms, bonds, None


def _mol_formaldehyde():
    atoms, bonds = [], []
    i_c = _add(atoms, "C", (0.0, 0.0, 0.0))
    bonds.append((i_c, _add(atoms, "O", (0.0, 1.21, 0.0)), 2))
    for sx in (1, -1):
        bonds.append((i_c, _add(atoms, "H", (1.0 * sx, -0.6, 0.0)), 1))
    return atoms, bonds, None


def _mol_acetic_acid():
    atoms, bonds = [], []
    i_c1 = _add(atoms, "C", (0.0, 0.0, 0.0))
    i_c2 = _grow(atoms, bonds, i_c1, "C")          # the carboxyl carbon
    c2 = tuple(atoms[i_c2][1:])
    # sp2: both oxygens 120° off the C–C bond, in one plane
    back = unit(minus(atoms[i_c1][1:], c2))
    d_dbl, d_oh = _sp2_dirs(back, perp(back))
    bonds.append((i_c2, _add(atoms, "O", _plus(c2, _scale(d_dbl, 1.23))), 2))
    i_o = _add(atoms, "O", _plus(c2, _scale(d_oh, 1.36)))
    bonds.append((i_c2, i_o, 1))
    _grow(atoms, bonds, i_o, "H")
    _fill_h(atoms, bonds, i_c1)
    return atoms, bonds, None


def _mol_ammonium():
    atoms, bonds = [], []
    i_n = _add(atoms, "N", (0.0, 0.0, 0.0))
    for d in TETRA:
        bonds.append((i_n, _add(atoms, "H", _scale(d, 1.02)), 1))
    return atoms, bonds, None


# --- rings and chains ------------------------------------------------------
def _ring_carbons(n, radius):
    pts = []
    for k in range(n):
        ang = math.radians(90 + k * 360.0 / n)
        pts.append((radius * math.cos(ang), radius * math.sin(ang), 0.0))
    return pts


def _mol_benzene():
    atoms, bonds = [], []
    ring = _ring_carbons(6, 1.39)
    idx = [_add(atoms, "C", p) for p in ring]
    for k in range(6):
        bonds.append((idx[k], idx[(k + 1) % 6], 2 if k % 2 == 0 else 1))
        p = ring[k]
        d = math.hypot(p[0], p[1]) or 1.0
        hp = (p[0] * (d + 1.09) / d, p[1] * (d + 1.09) / d, 0.0)
        bonds.append((idx[k], _add(atoms, "H", hp), 1))
    return atoms, bonds, None


def _chair_ring(n, bond, pucker):
    """A puckered n-ring whose neighbours sit exactly *bond* apart.

    Alternating ±*pucker* in z; the in-plane radius follows, because for a
    hexagon the 60° chord equals the radius."""
    chord = math.sqrt(max(bond * bond - (2 * pucker) ** 2, 0.01))
    radius = chord / (2 * math.sin(math.pi / n))
    pts = []
    for k in range(n):
        ang = math.radians(90 + k * 360.0 / n)
        z = pucker if k % 2 == 0 else -pucker
        pts.append((radius * math.cos(ang), radius * math.sin(ang), z))
    return pts


def _mol_cyclohexane():
    atoms, bonds = [], []
    ring = _chair_ring(6, 1.54, 0.25)
    idx = [_add(atoms, "C", p) for p in ring]
    for k in range(6):
        bonds.append((idx[k], idx[(k + 1) % 6], 1))
    for i in idx:                       # after the ring closes, so each C
        _fill_h(atoms, bonds, i)        # sees both its neighbours
    return atoms, bonds, None


def _mol_cyclopentane():
    atoms, bonds = [], []
    ring = _chair_ring(5, 1.54, 0.20)
    idx = [_add(atoms, "C", p) for p in ring]
    for k in range(5):
        bonds.append((idx[k], idx[(k + 1) % 5], 1))
    for i in idx:                       # after the ring closes, so each C
        _fill_h(atoms, bonds, i)        # sees both its neighbours
    return atoms, bonds, None


def _mol_glucose():
    atoms, bonds = [], []
    ring = _chair_ring(6, 1.50, 0.25)
    els = ["O", "C", "C", "C", "C", "C"]
    idx = [_add(atoms, els[k], ring[k]) for k in range(6)]
    for k in range(6):
        bonds.append((idx[k], idx[(k + 1) % 6], 1))
    # β-D-glucopyranose: OH on C1-C4, and C5 carries the exocyclic CH2OH
    # (the C6 that makes it a hexose). Ring hydrogens are capped last, once
    # every substituent is on, so each carbon sees its real neighbours.
    for k in range(1, 5):
        i_o = _grow(atoms, bonds, idx[k], "O")
        _grow(atoms, bonds, i_o, "H")
    i_c6 = _grow(atoms, bonds, idx[5], "C")
    i_o6 = _grow(atoms, bonds, i_c6, "O")
    _grow(atoms, bonds, i_o6, "H")
    for k in range(1, 6):
        _fill_h(atoms, bonds, idx[k])
    _fill_h(atoms, bonds, i_c6)
    return atoms, bonds, None


# --- hydrocarbon / polymer backbones --------------------------------------
_ZA = 1.54 * math.sin(math.radians(54.75))   # step along x
_ZB = 1.54 * math.cos(math.radians(54.75))   # up/down amplitude


def _backbone(n, x0=0.0):
    return [(x0 + k * _ZA, (_ZB if k % 2 else 0.0), 0.0) for k in range(n)]


_AROMATIC_CC = 1.39
_AROMATIC_CH = 1.09


def _phenyl(atoms, bonds, anchor):
    """A planar benzene ring bonded to *anchor* through its ipso carbon.

    The ring is a regular hexagon: its centre lies one C–C length beyond the
    ipso carbon along the anchor→ipso axis, and the ring plane contains that
    axis. Alternating bond orders leave the ipso carbon exactly full."""
    ipso = _grow(atoms, bonds, anchor, "C")
    p = tuple(atoms[ipso][1:])
    axis = unit(minus(p, atoms[anchor][1:]))
    centre = _plus(p, _scale(axis, _AROMATIC_CC))
    side = perp(axis)                       # in-plane, ⟂ to the axis
    idx = [ipso]
    for k in range(1, 6):
        ang = math.radians(60.0 * k)
        radial = (-math.cos(ang) * axis[0] + math.sin(ang) * side[0],
                  -math.cos(ang) * axis[1] + math.sin(ang) * side[1],
                  -math.cos(ang) * axis[2] + math.sin(ang) * side[2])
        idx.append(_add(atoms, "C", _plus(centre,
                                          _scale(radial, _AROMATIC_CC))))
    for k in range(6):
        bonds.append((idx[k], idx[(k + 1) % 6], 1 if k % 2 == 0 else 2))
    for i in idx[1:]:                       # H on each ring carbon, in-plane
        out = unit(minus(atoms[i][1:], centre))
        bonds.append((i, _add(atoms, "H",
                              _plus(atoms[i][1:], _scale(out, _AROMATIC_CH))),
                      1))


def _add_substituent(atoms, bonds, c_i, sub):
    if isinstance(sub, (list, tuple)):      # e.g. PTFE's two F per carbon
        for one in sub:
            _add_substituent(atoms, bonds, c_i, one)
        return
    if sub in ("F", "Cl", "Br"):
        _grow(atoms, bonds, c_i, sub)
    elif sub == "OH":
        _grow(atoms, bonds, _grow(atoms, bonds, c_i, "O"), "H")
    elif sub == "CH3":
        _fill_h(atoms, bonds, _grow(atoms, bonds, c_i, "C"))
    elif sub == "phenyl":
        _phenyl(atoms, bonds, c_i)


def _backbone_hydrogens(atoms, bonds, idx, pts, subs=None):
    """Hang each backbone carbon's substituent and then cap it with hydrogen.

    Directions come from the bonds already on the atom, so the chain ends
    (one neighbour) take three, the middles (two) take two."""
    subs = subs or {}
    for k, i in enumerate(idx):
        sub = subs.get(k)
        if sub is not None:
            _add_substituent(atoms, bonds, i, sub)
        _fill_h(atoms, bonds, i)


def _polymer_atoms(n, pattern):
    atoms, bonds = [], []
    pts = _backbone(n)
    idx = [_add(atoms, "C", p) for p in pts]
    for k in range(n - 1):
        bonds.append((idx[k], idx[k + 1], 1))
    subs = {k: pattern(k) for k in range(n) if pattern(k) is not None}
    _backbone_hydrogens(atoms, bonds, idx, pts, subs)
    return atoms, bonds, None


def _mol_ethane():
    return _polymer_atoms(2, lambda k: None)


def _mol_propane():
    return _polymer_atoms(3, lambda k: None)


def _mol_butane():
    return _polymer_atoms(4, lambda k: None)


def _mol_ethene():
    atoms, bonds = [], []
    c1, c2 = (-0.67, 0.0, 0.0), (0.67, 0.0, 0.0)
    i1, i2 = _add(atoms, "C", c1), _add(atoms, "C", c2)
    bonds.append((i1, i2, 2))
    for (ci, cp, sx) in ((i1, c1, -1), (i2, c2, 1)):
        for sy in (1, -1):
            bonds.append((ci, _add(atoms, "H",
                                   (cp[0] + sx * 0.6, sy * 0.94, 0.0)), 1))
    return atoms, bonds, None


def _mol_ethyne():
    atoms, bonds = [], []
    c1, c2 = (-0.60, 0.0, 0.0), (0.60, 0.0, 0.0)
    i1, i2 = _add(atoms, "C", c1), _add(atoms, "C", c2)
    bonds.append((i1, i2, 3))
    bonds.append((i1, _add(atoms, "H", (-1.66, 0.0, 0.0)), 1))
    bonds.append((i2, _add(atoms, "H", (1.66, 0.0, 0.0)), 1))
    return atoms, bonds, None


def _mol_pet():
    """The PET repeat unit, –C(=O)–C₆H₄–C(=O)–O–CH₂–CH₂–O–.

    Drawn as a repeat unit with its two open valences (the acyl carbon and
    the glycol oxygen), not as a closed macrocycle: bonding the two ends of
    one unit together would make a cyclic monomer, not the polymer."""
    atoms, bonds = [], []
    ring = _ring_carbons(6, _AROMATIC_CC)       # centred on the origin
    ridx = [_add(atoms, "C", p) for p in ring]
    for k in range(6):
        bonds.append((ridx[k], ridx[(k + 1) % 6], 2 if k % 2 == 0 else 1))
    for k in (1, 2, 4, 5):                      # aryl hydrogens, in-plane
        out = unit(ring[k])
        bonds.append((ridx[k], _add(atoms, "H",
                                    _plus(ring[k], _scale(out, _AROMATIC_CH))),
                      1))

    def _carbonyl(ring_i):
        """A trigonal C=O hung radially off a ring carbon, in the ring plane.
        Returns the acyl carbon and its remaining free direction."""
        p = tuple(atoms[ring_i][1:])
        out = unit(p)
        c = _plus(p, _scale(out, 1.49))
        i_c = _add(atoms, "C", c)
        bonds.append((ring_i, i_c, 1))
        d_dbl, d_free = _sp2_dirs((-out[0], -out[1], -out[2]), (0.0, 0.0, 1.0))
        bonds.append((i_c, _add(atoms, "O", _plus(c, _scale(d_dbl, 1.23))), 2))
        return i_c, c, d_free

    _carbonyl(ridx[0])                          # one open end: the acyl carbon
    i_c, c, d_free = _carbonyl(ridx[3])
    i_o = _add(atoms, "O", _plus(c, _scale(d_free, 1.34)))
    bonds.append((i_c, i_o, 1))
    ch1 = _grow(atoms, bonds, i_o, "C")         # –O–CH₂–
    ch2 = _grow(atoms, bonds, ch1, "C")         # –CH₂–
    _grow(atoms, bonds, ch2, "O")               # the other open end
    _fill_h(atoms, bonds, ch1)
    _fill_h(atoms, bonds, ch2)
    return atoms, bonds, None


# ------------------------------------------------------------ crystal cells
_CORNERS = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0),
            (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)]
_CUBE_PAIRS = [(0, 1), (1, 2), (2, 3), (3, 0), (4, 5), (5, 6), (6, 7), (7, 4),
               (0, 4), (1, 5), (2, 6), (3, 7)]


def _cube_corners(a):
    return [(x * a, y * a, z * a) for x, y, z in _CORNERS]


def _cube_edges(a):
    c = _cube_corners(a)
    return [(c[i], c[j], "solid") for i, j in _CUBE_PAIRS]


def _body_diagonals(a):
    c = _cube_corners(a)
    return [(c[0], c[6], "dash"), (c[1], c[7], "dash"),
            (c[2], c[4], "dash"), (c[3], c[5], "dash")]


def _crystal(el_at, a=2.0, extra_edges=None, bonds=None):
    atoms = [(e, p[0], p[1], p[2]) for e, p in el_at]
    edges = _cube_edges(a) + (extra_edges or [])
    return atoms, (bonds or []), edges


def _xtal_simple_cubic():
    a = 3.0
    return _crystal([("Cu", p) for p in _cube_corners(a)], a)


def _xtal_bcc():
    a = 3.0
    atoms = [("Fe", p[0], p[1], p[2]) for p in _cube_corners(a)]
    _site(atoms, "Fe", (a / 2, a / 2, a / 2), "body")
    return atoms, [], _cube_edges(a) + _body_diagonals(a)


def _xtal_fcc():
    a = 3.0
    atoms = [("Al", p[0], p[1], p[2]) for p in _cube_corners(a)]
    for p in _face_centers(a):
        _site(atoms, "Al", p, "face")
    c = _cube_corners(a)
    fdiag = [(c[0], c[2], "dash"), (c[4], c[6], "dash"),
             (c[0], c[5], "dash"), (c[3], c[6], "dash"),
             (c[0], c[7], "dash"), (c[1], c[6], "dash")]
    return atoms, [], _cube_edges(a) + fdiag


def _xtal_hcp():
    atoms, r, hz = [], 1.6, 1.6
    for z in (0.0, 2 * hz):
        _add(atoms, "Mg", (0.0, 0.0, z))
        for k in range(6):
            ang = math.radians(k * 60)
            _add(atoms, "Mg", (r * math.cos(ang), r * math.sin(ang), z))
    for k in range(3):
        ang = math.radians(30 + k * 120)
        _site(atoms, "Mg", (r * 0.58 * math.cos(ang),
                            r * 0.58 * math.sin(ang), hz), "mid")
    edges = []
    top = [(r * math.cos(math.radians(k * 60)),
            r * math.sin(math.radians(k * 60)), 0.0) for k in range(6)]
    bot = [(p[0], p[1], 2 * hz) for p in top]
    for k in range(6):
        edges.append((top[k], top[(k + 1) % 6]))
        edges.append((bot[k], bot[(k + 1) % 6]))
        edges.append((top[k], bot[k]))
    return atoms, [], edges


def _xtal_diamond():
    a = 4.0
    atoms = []
    for p in _cube_corners(a):
        _add(atoms, "C", p)
    for p in _face_centers(a):
        _site(atoms, "C", p, "face")
    inner_idx = [_site(atoms, "C", p, "inner") for p in _tetra_interior(a)]
    bonds = []
    for ii in inner_idx:
        ip = (atoms[ii][1], atoms[ii][2], atoms[ii][3])
        dists = sorted(range(len(atoms)),
                       key=lambda k: (atoms[k][1] - ip[0]) ** 2
                       + (atoms[k][2] - ip[1]) ** 2
                       + (atoms[k][3] - ip[2]) ** 2)
        for k in dists[1:5]:
            bonds.append((ii, k, 1))
    return atoms, bonds, _cube_edges(a)


def _xtal_nacl():
    atoms = []
    step = 1.6
    for i in range(3):
        for j in range(3):
            for k in range(3):
                el = "Na" if (i + j + k) % 2 == 0 else "Cl"
                _add(atoms, el, (i * step, j * step, k * step))
    return atoms, [], _cube_edges(2 * step)


def _xtal_cscl():
    a = 3.0
    pts = [("Cl", p) for p in _cube_corners(a)]
    pts.append(("Cs", (a / 2, a / 2, a / 2)))  # different element, no tint
    return _crystal(pts, a, extra_edges=_body_diagonals(a))


def _tetra_interior(a):
    """The four diamond/zinc-blende interior sites in a cube of edge *a*."""
    return [(a / 4, a / 4, a / 4), (3 * a / 4, 3 * a / 4, a / 4),
            (3 * a / 4, a / 4, 3 * a / 4), (a / 4, 3 * a / 4, 3 * a / 4)]


def _face_centers(a):
    return [(a / 2, a / 2, 0), (a / 2, a / 2, a), (a / 2, 0, a / 2),
            (a / 2, a, a / 2), (0, a / 2, a / 2), (a, a / 2, a / 2)]


def _xtal_perovskite():
    """ABX3 perovskite (CaTiO3): A (Ca) at the corners, B (Ti) at the body
    centre, X (O) at the face centres — with the central TiO6 octahedron."""
    a = 3.2
    atoms = [("Ca", p[0], p[1], p[2]) for p in _cube_corners(a)]
    ti = len(atoms)
    atoms.append(("Ti", a / 2, a / 2, a / 2))
    o0 = len(atoms)
    for p in _face_centers(a):
        atoms.append(("O", p[0], p[1], p[2]))
    bonds = [(ti, o0 + k, 1) for k in range(6)]        # TiO6 octahedron
    return list(atoms), bonds, _cube_edges(a)


def _xtal_zincblende():
    """Zinc blende (ZnS): S on an FCC lattice, Zn in four tetrahedral holes,
    each Zn bonded to its four nearest S (like diamond, two elements)."""
    a = 4.0
    atoms = []
    for p in _cube_corners(a):
        _add(atoms, "S", p)
    for p in _face_centers(a):
        _site(atoms, "S", p, "face")
    zn_idx = [_add(atoms, "Zn", p) for p in _tetra_interior(a)]
    bonds = []
    for zi in zn_idx:
        zp = (atoms[zi][1], atoms[zi][2], atoms[zi][3])
        near = sorted(range(len(atoms)),
                      key=lambda k: (atoms[k][1] - zp[0]) ** 2
                      + (atoms[k][2] - zp[1]) ** 2
                      + (atoms[k][3] - zp[2]) ** 2)
        for k in near[1:5]:
            bonds.append((zi, k, 1))
    return atoms, bonds, _cube_edges(a)


def _xtal_fluorite():
    """Fluorite (CaF2): Ca on an FCC lattice, F filling all eight
    tetrahedral holes."""
    a = 4.0
    atoms = []
    for p in _cube_corners(a):
        _add(atoms, "Ca", p)
    for p in _face_centers(a):
        _site(atoms, "Ca", p, "face")
    for x in (a / 4, 3 * a / 4):
        for y in (a / 4, 3 * a / 4):
            for z in (a / 4, 3 * a / 4):
                _add(atoms, "F", (x, y, z))
    return atoms, [], _cube_edges(a)


# ------------------------------------------------------------------- registry
#: name -> (builder returning (atoms, bonds, edges), radius scale)
_MODELS = {
    "water": (_mol_water, 0.9), "ammonia": (_mol_ammonia, 0.9),
    "ammonium": (_mol_ammonium, 0.9),
    "methane": (_mol_methane, 0.9),
    "carbon_dioxide": (_mol_carbon_dioxide, 0.9),
    "methanol": (_mol_methanol, 0.9), "ethanol": (_mol_ethanol, 0.9),
    "formaldehyde": (_mol_formaldehyde, 0.9),
    "acetic_acid": (_mol_acetic_acid, 0.88),
    "ethane": (_mol_ethane, 0.9), "propane": (_mol_propane, 0.9),
    "butane": (_mol_butane, 0.9),
    "ethene": (_mol_ethene, 0.9), "ethyne": (_mol_ethyne, 0.9),
    "benzene": (_mol_benzene, 0.9), "cyclohexane": (_mol_cyclohexane, 0.88),
    "cyclopentane": (_mol_cyclopentane, 0.88),
    "glucose": (_mol_glucose, 0.82), "pet": (_mol_pet, 0.72),
    "simple_cubic": (_xtal_simple_cubic, 0.62), "bcc": (_xtal_bcc, 0.58),
    "fcc": (_xtal_fcc, 0.52), "hcp": (_xtal_hcp, 0.5),
    "diamond": (_xtal_diamond, 0.42), "nacl": (_xtal_nacl, 0.5),
    "cscl": (_xtal_cscl, 0.6), "perovskite": (_xtal_perovskite, 0.5),
    "zincblende": (_xtal_zincblende, 0.44), "fluorite": (_xtal_fluorite, 0.44),
}

#: Polymer repeat units share the zig-zag backbone builder.
_POLYMERS = {
    "polyethylene": lambda k: None,
    "polypropylene": lambda k: "CH3" if k % 2 == 0 else None,
    "pvc": lambda k: "Cl" if k % 2 == 0 else None,
    # PTFE is (CF2)n — two fluorines per backbone carbon, not one
    "ptfe": lambda k: ("F", "F"),
    "polystyrene": lambda k: "phenyl" if k % 2 == 0 else None,
}
_POLYMER_LEN = 6

LABELS = {
    "water": "Water (H₂O)", "ammonia": "Ammonia (NH₃)",
    "ammonium": "Ammonium (NH₄⁺)",
    "methane": "Methane (CH₄)", "carbon_dioxide": "Carbon dioxide (CO₂)",
    "methanol": "Methanol", "ethanol": "Ethanol",
    "formaldehyde": "Formaldehyde", "acetic_acid": "Acetic acid",
    "ethane": "Ethane", "propane": "Propane", "butane": "Butane",
    "ethene": "Ethene", "ethyne": "Ethyne", "benzene": "Benzene",
    "cyclohexane": "Cyclohexane", "cyclopentane": "Cyclopentane",
    "glucose": "Glucose", "pet": "PET repeat unit",
    "polyethylene": "Polyethylene", "polypropylene": "Polypropylene",
    "pvc": "PVC", "ptfe": "PTFE", "polystyrene": "Polystyrene",
    "simple_cubic": "Simple cubic", "bcc": "BCC", "fcc": "FCC",
    "hcp": "HCP", "diamond": "Diamond", "nacl": "NaCl (rock salt)",
    "cscl": "CsCl", "perovskite": "Perovskite (CaTiO₃)",
    "zincblende": "Zinc blende (ZnS)", "fluorite": "Fluorite (CaF₂)",
}
CATEGORIES = [
    ("Simple molecules",
     ["water", "ammonia", "ammonium", "methane", "carbon_dioxide",
      "formaldehyde"]),
    ("Alcohols & acids",
     ["methanol", "ethanol", "acetic_acid", "glucose"]),
    ("Hydrocarbons",
     ["ethane", "propane", "butane", "ethene", "ethyne", "benzene",
      "cyclopentane", "cyclohexane"]),
    ("Polymers",
     ["polyethylene", "polypropylene", "pvc", "ptfe", "polystyrene", "pet"]),
    ("Crystal structures",
     ["simple_cubic", "bcc", "fcc", "hcp", "diamond", "nacl", "cscl",
      "zincblende", "fluorite", "perovskite"]),
    lattices.CATEGORY,
]

# The seven non-cubic crystal systems join the registry as ordinary models;
# their `_xtal_*` builder names give them crystal handling for free.
_MODELS.update(lattices.MODELS)
LABELS.update(lattices.LABELS)

#: Default bond spread for molecules (>1 so sticks read); crystals stay 1.0.
DEFAULT_BOND = 1.6


def is_crystal(name):
    return name in _MODELS and _MODELS[name][0].__name__.startswith("_xtal")


def default_bond(name):
    return 1.0 if is_crystal(name) else DEFAULT_BOND


def names():
    """All library keys, in category order."""
    out = []
    for _title, keys in CATEGORIES:
        out += keys
    return out


def can_stack(name):
    """Whether *name* is a crystal that tiles into a supercell."""
    return supercell.can_stack(name, is_crystal(name))


def lattice_vectors(name):
    """The three cell vectors *name* stacks along, or None for the cubic
    family (which falls back to its wireframe extent)."""
    return lattices.LATTICE_VECTORS.get(name)


def model_data(name, cells=None, tilts=None, owners=None, members=None):
    """Return ``(atoms, bonds, edges, rscale)`` for a named model.

    A crystal tiles into an ``nx × ny × nz`` supercell when *cells* is
    given; *tilts* rotates chosen cells about their own centre, *owners*
    (a list) collects each atom's home cell and *members* (a dict) every
    cell's full atom list — see `supercell.tile`."""
    if name in _POLYMERS:
        atoms, bonds, edges = _polymer_atoms(_POLYMER_LEN, _POLYMERS[name])
        return atoms, bonds, edges, 0.92
    builder, rscale = _MODELS[name]
    atoms, bonds, edges = builder()
    if cells and can_stack(name) and tuple(cells) != (1, 1, 1):
        atoms, bonds, edges = supercell.tile(
            atoms, bonds, edges, *cells, vectors=lattice_vectors(name),
            tilts=tilts, owners=owners, members=members)
    else:
        if owners is not None:
            owners.extend(["0,0,0"] * len(atoms))
        if members is not None:
            members["0,0,0"] = list(range(len(atoms)))
    return atoms, bonds, edges, rscale


def label(name):
    return LABELS.get(name, name.replace("_", " ").title())


def make(name):
    """Build a `model.Molecule` for library key *name*."""
    atoms, bonds, edges, rscale = model_data(name)
    return Molecule(atoms, bonds, name=name, label=label(name),
                    az=DEFAULT_AZ, el=DEFAULT_EL, bond=default_bond(name),
                    rscale=rscale, crystal=is_crystal(name), edges=edges)
