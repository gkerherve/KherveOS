"""Crystal lattice geometry: the seven systems, cell vectors, tilts.

The cubic family lives in `library` (SC / BCC / FCC / diamond / NaCl …);
this module covers the **rest of the crystal systems**, which are defined
by their lattice parameters (a, b, c, α, β, γ) rather than a cube edge:

* `lattice_vectors` turns those six numbers into the three cell vectors,
  using the standard crystallographic convention (**a** along x, **b** in
  the xy-plane at γ to **a**);
* `cell` builds the parallelepiped unit cell — 8 corner atoms plus the 12
  wireframe edges — from them;
* `LATTICE_VECTORS` lets `supercell.tile` stack these cells along their
  true lattice vectors, so a hexagonal or monoclinic supercell meets
  face-to-face in the crystallographically correct orientation rather
  than on an orthogonal grid;
* `rotation` is the tilt used to rotate one cell inside a supercell, and
  `coordination_faces` the convex hull of a coordination shell (the
  VESTA-style polyhedra drawn by `molcolor`).

The builders are named ``_xtal_*`` so `library.is_crystal` /
`supercell.can_stack` recognise them, which gives them non-editable
lattice handling, true spacing and stacking for free.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

import itertools
import math

#: Fractional corner coordinates and the 12 edges of a parallelepiped, in
#: the same order as the cube tables in `library`.
CORNERS = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0),
           (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)]
EDGE_PAIRS = [(0, 1), (1, 2), (2, 3), (3, 0), (4, 5), (5, 6), (6, 7), (7, 4),
              (0, 4), (1, 5), (2, 6), (3, 7)]


def lattice_vectors(a, b, c, alpha, beta, gamma):
    """The three cell vectors for lattice parameters (lengths in model
    units, angles in degrees)."""
    al, be, ga = (math.radians(v) for v in (alpha, beta, gamma))
    sg = math.sin(ga) or 1.0
    va = (a, 0.0, 0.0)
    vb = (b * math.cos(ga), b * math.sin(ga), 0.0)
    cx = c * math.cos(be)
    cy = c * (math.cos(al) - math.cos(be) * math.cos(ga)) / sg
    cz = math.sqrt(max(c * c - cx * cx - cy * cy, 0.0))
    return va, vb, (cx, cy, cz)


def rotation(rx, ry, rz):
    """A 3D rotation for tilt angles in **degrees** about the x, y then z
    axes; returns a point -> rotated-point function. Used to tilt a single
    unit cell inside a supercell about its own centre."""
    ax, ay, az = (math.radians(v) for v in (rx, ry, rz))
    cx, sx = math.cos(ax), math.sin(ax)
    cy, sy = math.cos(ay), math.sin(ay)
    cz, sz = math.cos(az), math.sin(az)
    m = (                                       # R = Rz · Ry · Rx
        (cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx),
        (sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx),
        (-sy, cy * sx, cy * cx),
    )

    def apply(p):
        return (m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2],
                m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2],
                m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2])
    return apply


def coordination_faces(pts, eps=1e-6):
    """Faces of the convex hull of a small 3D point set — a coordination
    shell around a centre atom. Each face is an ordered vertex list on one
    supporting plane: 8 triangles for an octahedron, 4 for a tetrahedron,
    6 squares for a cube. Brute force over point triples; fine for the ≤12
    neighbours a coordination shell has."""
    n = len(pts)
    if n < 3:
        return []
    faces, seen = [], set()
    for i, j, k in itertools.combinations(range(n), 3):
        a, b, c = pts[i], pts[j], pts[k]
        u = tuple(b[d] - a[d] for d in range(3))
        v = tuple(c[d] - a[d] for d in range(3))
        nrm = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2],
               u[0] * v[1] - u[1] * v[0])
        ln = math.sqrt(sum(x * x for x in nrm))
        if ln < eps:
            continue
        nrm = tuple(x / ln for x in nrm)
        d0 = sum(nrm[d] * a[d] for d in range(3))
        sides = [sum(nrm[d] * p[d] for d in range(3)) - d0 for p in pts]
        if max(sides) > eps and min(sides) < -eps:
            continue                              # not a supporting plane
        on = tuple(sorted(m for m, s in enumerate(sides) if abs(s) <= eps))
        if on in seen:                            # a square face is found by
            continue                              # several triples — once only
        seen.add(on)
        fpts = [pts[m] for m in on]
        fc = tuple(sum(p[d] for p in fpts) / len(fpts) for d in range(3))
        ref = tuple(fpts[0][d] - fc[d] for d in range(3))
        rl = math.sqrt(sum(x * x for x in ref)) or 1.0
        ref = tuple(x / rl for x in ref)
        side = (nrm[1] * ref[2] - nrm[2] * ref[1],
                nrm[2] * ref[0] - nrm[0] * ref[2],
                nrm[0] * ref[1] - nrm[1] * ref[0])

        def ang(p, fc=fc, side=side, ref=ref):
            w = tuple(p[d] - fc[d] for d in range(3))
            return math.atan2(sum(w[d] * side[d] for d in range(3)),
                              sum(w[d] * ref[d] for d in range(3)))
        faces.append(sorted(fpts, key=ang))
    return faces


def corner(f, va, vb, vc):
    """The Cartesian point at fractional coordinate *f* in the cell."""
    return tuple(f[0] * va[k] + f[1] * vb[k] + f[2] * vc[k] for k in range(3))


def cell(element, va, vb, vc, extra=()):
    """A primitive (P) unit cell: one *element* atom at each corner of the
    parallelepiped spanned by the cell vectors, with solid wireframe edges.
    *extra* adds ``(element, fractional_coord)`` interior/centring sites."""
    corners = [corner(f, va, vb, vc) for f in CORNERS]
    atoms = [(element, p[0], p[1], p[2]) for p in corners]
    for el, frac in extra:
        p = corner(frac, va, vb, vc)
        atoms.append((el, p[0], p[1], p[2]))
    edges = [(corners[i], corners[j], "solid") for i, j in EDGE_PAIRS]
    return atoms, [], edges


#: name -> (element, a, b, c, alpha, beta, gamma). The element just picks a
#: distinct, recognisable sphere colour per system (Zn really is hexagonal,
#: B rhombohedral…); the lengths/angles are illustrative, not measured.
PARAMS = {
    "tetragonal": ("Ti", 2.6, 2.6, 3.8, 90, 90, 90),
    "orthorhombic": ("S", 2.2, 3.0, 3.8, 90, 90, 90),
    "hexagonal": ("Zn", 2.7, 2.7, 3.6, 90, 90, 120),
    "rhombohedral": ("B", 3.0, 3.0, 3.0, 75, 75, 75),
    "monoclinic": ("Fe", 2.4, 3.0, 3.4, 90, 70, 90),
    "triclinic": ("Cu", 2.2, 2.8, 3.2, 80, 70, 85),
}

#: Cell vectors per lattice — `supercell.tile` stacks along these, so tiled
#: cells sit in the lattice's own (possibly skewed) orientations.
LATTICE_VECTORS = {name: lattice_vectors(*p[1:]) for name, p in PARAMS.items()}

LABELS = {
    "tetragonal": "Tetragonal", "orthorhombic": "Orthorhombic",
    "hexagonal": "Hexagonal", "rhombohedral": "Rhombohedral (trigonal)",
    "monoclinic": "Monoclinic", "triclinic": "Triclinic",
}
#: Lattice parameters, for the crystal panel's read-out.
PARAM_TEXT = {
    name: "a=%.3g  b=%.3g  c=%.3g   α=%g°  β=%g°  γ=%g°" % p[1:]
    for name, p in PARAMS.items()
}


def param_text(name):
    """The lattice read-out for a structure name: a lattice system's
    illustrative parameters, or a library crystal (``crystal:key``) with
    its real cell and space group. None for anything else."""
    text = PARAM_TEXT.get(name)
    if text is None and str(name).startswith(("crystal:", "cell:")):
        from . import crystal_library
        c = crystal_library.LIBRARY.get(name.split(":", 1)[1])
        if c is not None:
            text = ("a=%.4g  b=%.4g  c=%.4g   α=%g°  β=%g°  γ=%g°   %s"
                    % (c.a, c.b, c.c, c.alpha, c.beta, c.gamma,
                       c.space_group))
    return text


def _make_builder(name):
    element = PARAMS[name][0]
    va, vb, vc = LATTICE_VECTORS[name]

    def build():
        return cell(element, va, vb, vc)
    # library.is_crystal / supercell.can_stack key off the `_xtal_` prefix
    build.__name__ = f"_xtal_{name}"
    return build


MODELS = {name: (_make_builder(name), 0.55) for name in PARAMS}
CATEGORY = ("Lattice systems", list(PARAMS))
