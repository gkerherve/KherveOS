"""Molecular geometry engine — 3D coordinates → 2D ball-and-stick specs.

A molecule (or crystal) is described by its atoms' 3D coordinates and a
bond list. `_model` projects that with an isometric camera and returns a
list of *shape-spec* dicts (circles for lit spheres, lines for sticks,
dashed lines for cell diagonals). `render.py` turns the specs into Qt
graphics items, so everything stays plain, editable, exportable vectors.
This is the classic renderer and the source of the SVG / fallback export;
the default on-screen view is the OpenGL `glview.GLView`, which shares this
module's projection and geometry operations.

The engine also holds the interactive-builder operations (add a bonded
atom respecting valence, delete, drag an atom in the view plane) and a
small `Molecule` container that pairs atoms/bonds with a view.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

import math

from PyQt5.QtGui import QColor

from . import elements

_BOND_COLOR = "#6b6f76"
_FRAME_COLOR = "#202020"         # solid unit-cell cube edges (thick, dark)
_EDGE_COLOR = "#555555"          # dashed body/face diagonals


# ------------------------------------------------------------ colour helpers
def _mix(a, b, t):
    """Blend hex colour *a* toward *b* by fraction *t* (0..1)."""
    ca, cb = QColor(a), QColor(b)
    r = round(ca.red() + (cb.red() - ca.red()) * t)
    g = round(ca.green() + (cb.green() - ca.green()) * t)
    bl = round(ca.blue() + (cb.blue() - ca.blue()) * t)
    return "#%02x%02x%02x" % (r, g, bl)


def atom_specs(cx, cy, r, element, label=False, color=None):
    """A single lit-sphere spec for *element* centred at (cx, cy), radius r.

    The sphere is a circle filled with a `sun` gradient: a near-white
    highlight at the top-left fading to a darkened rim, so it reads as a
    3D ball in the element's CPK colour. *color* overrides that body
    colour — a custom atom colour or a lattice-site tint (`molcolor`)."""
    body = color or elements.color(element)
    hi = _mix(body, "#ffffff", 0.62)
    rim = _mix(body, "#000000", 0.40)
    stroke = _mix(body, "#000000", 0.52)
    spec = {"shape": "circle", "x": cx - r, "y": cy - r,
            "w": 2 * r, "h": 2 * r, "stroke": stroke,
            "width": max(0.8, r * 0.10),
            "fill": {"kind": "sun", "c1": rim, "c2": hi}}
    if not label:
        return [spec]
    # The symbol goes on top of the ball, in whichever of black/white reads
    # against the body colour.
    luma = (0.299 * QColor(body).red() + 0.587 * QColor(body).green()
            + 0.114 * QColor(body).blue()) / 255.0
    ink = "#161616" if luma > 0.6 else "#ffffff"
    return [spec, {"shape": "text", "text": element, "x": cx, "y": cy,
                   "anchor": "center", "size": max(6, int(r * 0.85)),
                   "stroke": ink}]


def bond_specs(p1, p2, order=1, width=6.0, color=_BOND_COLOR):
    """Stick spec(s) between 2D points *p1* and *p2*.

    Single/double/triple bonds are one/two/three parallel lines offset
    perpendicular to the bond; multi-bond lines are drawn thinner."""
    (x1, y1), (x2, y2) = p1, p2
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy)
    if length < 1e-6:
        return []
    px, py = -dy / length, dx / length          # unit perpendicular
    if order <= 1:
        rows, lw, sep = [0.0], width, 0.0
    elif order == 2:
        rows, lw, sep = [-1.0, 1.0], width * 0.62, width * 0.85
    else:
        rows, lw, sep = [-1.0, 0.0, 1.0], width * 0.52, width * 1.0
    out = []
    for o in rows:
        ox, oy = px * o * sep, py * o * sep
        out.append({"shape": "line", "x1": x1 + ox, "y1": y1 + oy,
                    "x2": x2 + ox, "y2": y2 + oy,
                    "stroke": color, "width": lw})
    return out


# ------------------------------------------------------- isometric projection
_AZ = math.radians(28.0)
_EL = math.radians(20.0)
DEFAULT_AZ = _AZ
DEFAULT_EL = _EL


def _proj(x, y, z, az=_AZ, el=_EL):
    """Project a 3D point to (screen_x, screen_y, depth) at view (az, el).

    Rotate about the vertical axis by *az*, tilt by *el*, then project
    orthographically. *depth* grows toward the viewer, so sorting atoms by
    it draws far spheres before near ones."""
    ca, sa = math.cos(az), math.sin(az)
    ce, se = math.cos(el), math.sin(el)
    xr = x * ca - y * sa
    yr = x * sa + y * ca
    sx = xr
    sy = yr * se - z * ce            # screen y (grows downward)
    depth = yr * ce + z * se         # toward the viewer
    return sx, sy, depth


def _dashed_line(p1, p2, color, width, dash=6.0, gap=4.0):
    """A dashed segment as a run of short solid line specs (so the dashes
    are geometry that survives export)."""
    (x1, y1), (x2, y2) = p1, p2
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy) or 1.0
    ux, uy = dx / length, dy / length
    out = []
    pos = 0.0
    while pos < length:
        end = min(pos + dash, length)
        out.append({"shape": "line", "x1": x1 + ux * pos, "y1": y1 + uy * pos,
                    "x2": x1 + ux * end, "y2": y1 + uy * end,
                    "stroke": color, "width": width})
        pos = end + gap
    return out


def _centroid(atoms):
    n = len(atoms) or 1
    return (sum(a[1] for a in atoms) / n, sum(a[2] for a in atoms) / n,
            sum(a[3] for a in atoms) / n)


def _spread(atoms, edges, factor, centroid=None):
    """Move atoms (and cell edges) apart from their centroid by *factor*,
    lengthening the bonds relative to the spheres."""
    if factor == 1.0 or not atoms:
        return atoms, edges
    cx, cy, cz = centroid if centroid is not None else _centroid(atoms)

    def sc(p):
        return (cx + (p[0] - cx) * factor, cy + (p[1] - cy) * factor,
                cz + (p[2] - cz) * factor)
    at = [(a[0], *sc((a[1], a[2], a[3])), *a[4:]) for a in atoms]
    ed = None
    if edges:
        ed = [(sc(e[0]), sc(e[1]), e[2] if len(e) > 2 else "solid")
              for e in edges]
    return at, ed


def _spread_notes(notes, factor, centroid):
    """Scene annotations move apart with the atoms so they stay put."""
    cx, cy, cz = centroid
    out = []
    for n in notes:
        n = dict(n)
        for key in ("pos", "p1", "p2"):
            if key in n:
                p = n[key]
                n[key] = (cx + (p[0] - cx) * factor,
                          cy + (p[1] - cy) * factor,
                          cz + (p[2] - cz) * factor)
        out.append(n)
    return out


def _model(atoms, bonds, w, h, edges=None, rscale=1.0, labels=False,
           margin=0.12, az=_AZ, el=_EL, bond_scale=1.0, tag_atoms=False,
           frozen=None, poly=False, colors=None, notes=None):
    """Lay out a 3D model into the (w, h) box and return its shape specs.

    *atoms* is a list of ``(element, x, y, z)`` — with an optional 5th
    slot, a per-atom colour override (`molcolor`); *bonds* a list of
    ``(i, j, order)`` index pairs; *edges* an optional list of
    ``(p1, p2)`` or ``(p1, p2, style)`` unit-cell segments where *style*
    is ``"solid"`` or ``"dash"``. *bond_scale* spreads the atoms apart to
    lengthen the bonds. The projected model is scaled uniformly (spheres
    stay round) to fit the box, then drawn back-to-front: edges, bonds,
    spheres. With *poly*, translucent coordination-polyhedron faces join
    the same depth sort as the spheres, so a centre atom shows through its
    own front faces. *colors* is an element/site colour override map for
    regenerated structures (crystals). Passing *frozen* (from `fit_params`)
    reuses a captured scale/origin/centroid so dragging one atom doesn't
    rescale the rest."""
    if colors:
        from . import molcolor
        atoms = molcolor.apply_colors(atoms, colors)
    fc = frozen.get("centroid") if frozen else None
    if notes and bond_scale != 1.0 and atoms:
        notes = _spread_notes(notes, bond_scale, fc or _centroid(atoms))
    atoms, edges = _spread(atoms, edges, bond_scale, fc)
    proj = [_proj(a[1], a[2], a[3], az, el) for a in atoms]
    rad = [elements.radius(a[0]) * rscale for a in atoms]

    xs_lo = [proj[i][0] - rad[i] for i in range(len(atoms))]
    xs_hi = [proj[i][0] + rad[i] for i in range(len(atoms))]
    ys_lo = [proj[i][1] - rad[i] for i in range(len(atoms))]
    ys_hi = [proj[i][1] + rad[i] for i in range(len(atoms))]
    pedges = []
    if edges:
        for e in edges:
            style = e[2] if len(e) > 2 else "solid"
            pa = _proj(*e[0], az, el)
            pb = _proj(*e[1], az, el)
            pedges.append((pa, pb, style))
            for px, py, _ in (pa, pb):
                xs_lo.append(px)
                xs_hi.append(px)
                ys_lo.append(py)
                ys_hi.append(py)

    pnotes = []
    for n in (notes or ()):
        pts = [n[k] for k in ("pos", "p1", "p2") if k in n]
        proj_pts = [_proj(*p, az, el) for p in pts]
        pnotes.append((n, proj_pts))
        half = float(n.get("size", 1.0))
        for i, (px, py, _d) in enumerate(proj_pts):
            if n.get("kind") == "text":
                span = 0.3 * half * max(1, len(str(n.get("text", ""))))
                xs_lo.append(px - span)
                xs_hi.append(px + span)
                ys_lo.append(py - half)
                ys_hi.append(py + half)
            else:
                xs_lo.append(px)
                xs_hi.append(px)
                ys_lo.append(py)
                ys_hi.append(py)

    if not xs_lo:                       # empty model
        return []
    minx, maxx = min(xs_lo), max(xs_hi)
    miny, maxy = min(ys_lo), max(ys_hi)
    spanx = (maxx - minx) or 1.0
    spany = (maxy - miny) or 1.0
    if frozen and frozen.get("scale"):
        s = frozen["scale"]
        ox, oy = frozen["origin"]
    else:
        m = margin * min(w, h)
        s = min((w - 2 * m) / spanx, (h - 2 * m) / spany)
        ox = (w - s * spanx) / 2.0 - s * minx
        oy = (h - s * spany) / 2.0 - s * miny

    def T(px, py):
        return ox + s * px, oy + s * py

    specs = []
    ew = max(2.2, s * 0.062)
    for pa, pb, style in pedges:
        p1, p2 = T(pa[0], pa[1]), T(pb[0], pb[1])
        if style == "dash":
            specs += _dashed_line(p1, p2, _EDGE_COLOR, max(1.0, s * 0.028),
                                  dash=s * 0.10, gap=s * 0.07)
        else:
            specs.append({"shape": "line", "x1": p1[0], "y1": p1[1],
                          "x2": p2[0], "y2": p2[1], "stroke": _FRAME_COLOR,
                          "width": ew})
    bw = max(2.0, s * 0.11)
    for bi, (i, j, order) in enumerate(bonds):
        sticks = bond_specs(T(proj[i][0], proj[i][1]),
                            T(proj[j][0], proj[j][1]), order, width=bw)
        if tag_atoms:
            for stick in sticks:
                stick["_bond"] = bi          # for builder hit-testing
        specs += sticks
    drawables = [(proj[i][2], 1, i) for i in range(len(atoms))]
    if poly:
        from . import molcolor
        for face, color in molcolor.coordination_polyhedra(atoms, bonds):
            pf = [_proj(p[0], p[1], p[2], az, el) for p in face]
            depth = sum(q[2] for q in pf) / len(pf)
            drawables.append((depth, 0, (pf, color)))
    for _depth, kind, payload in sorted(drawables, key=lambda t: (t[0], t[1])):
        if kind == 0:
            pf, color = payload
            specs.append({"shape": "polygon",
                          "points": [list(T(q[0], q[1])) for q in pf],
                          "fill": color, "opacity": 0.32,
                          "stroke": _mix(color, "#000000", 0.35),
                          "width": max(1.0, s * 0.02)})
            continue
        idx = payload
        cx, cy = T(proj[idx][0], proj[idx][1])
        atom = atoms[idx]
        a_specs = atom_specs(cx, cy, rad[idx] * s, atom[0], label=labels,
                             color=(atom[4] if len(atom) > 4 else None))
        if tag_atoms and a_specs:
            a_specs[0]["_atom"] = idx        # for builder hit-testing
        specs += a_specs
    for n, pts in pnotes:
        specs += note_specs(n, [T(p[0], p[1]) for p in pts], s)
    return specs


def note_specs(note, pts, s):
    """Shape specs for one scene annotation, given its projected points
    and the pixels-per-ångström scale *s*."""
    color = note.get("color", "#22303c")
    if note.get("kind") == "text":
        px = max(6.0, float(note.get("size", 1.0)) * s)
        text = str(note.get("text", ""))
        x, y = pts[0]
        return [{"shape": "text", "text": text, "x": x, "y": y,
                 "size": px * 0.8, "stroke": color, "anchor": "center",
                 "bold": bool(note.get("bold", True))}]
    if note.get("kind") == "arrow":
        (x1, y1), (x2, y2) = pts[0], pts[1]
        dx, dy = x2 - x1, y2 - y1
        length = math.hypot(dx, dy) or 1.0
        px, py = -dy / length, dx / length
        w = max(2.0, float(note.get("size", 1.0)) * s * 0.10)
        head = min(length * 0.35, w * 5)
        offsets = [-w * 1.3, w * 1.3] if note.get("double") else [0.0]
        out = []
        for k, off in enumerate(offsets):
            a = (x1 + px * off, y1 + py * off)
            b = (x2 + px * off, y2 + py * off)
            if k == 1:                       # the return arrow points back
                a, b = b, a
            ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
            out.append({"shape": "line", "x1": a[0], "y1": a[1], "x2": b[0],
                        "y2": b[1], "stroke": color, "width": w})
            for sgn in (-1, 1):
                out.append({"shape": "line", "x1": b[0], "y1": b[1],
                            "x2": b[0] - ux * head - sgn * uy * head * 0.55,
                            "y2": b[1] - uy * head + sgn * ux * head * 0.55,
                            "stroke": color, "width": w})
        return out
    return []


# ------------------------------------------------------- layout / drag helpers
def fit_params(atoms, bonds, w, h, az, el, bond, rscale=0.92):
    """Capture the current layout's scale / origin / centroid, so the
    builder can drag one atom without the rest rescaling or recentring."""
    centroid = _centroid(atoms)
    at, _ = _spread(atoms, None, bond, centroid)
    proj = [_proj(a[1], a[2], a[3], az, el) for a in at]
    rad = [elements.radius(a[0]) * rscale for a in at]
    xs_lo = [proj[i][0] - rad[i] for i in range(len(at))]
    xs_hi = [proj[i][0] + rad[i] for i in range(len(at))]
    ys_lo = [proj[i][1] - rad[i] for i in range(len(at))]
    ys_hi = [proj[i][1] + rad[i] for i in range(len(at))]
    minx, maxx = min(xs_lo), max(xs_hi)
    miny, maxy = min(ys_lo), max(ys_hi)
    spanx = (maxx - minx) or 1.0
    spany = (maxy - miny) or 1.0
    m = 0.12 * min(w, h)
    s = min((w - 2 * m) / spanx, (h - 2 * m) / spany)
    ox = (w - s * spanx) / 2.0 - s * minx
    oy = (h - s * spany) / 2.0 - s * miny
    return {"scale": s, "origin": (ox, oy), "centroid": centroid}


def drag_atom(atoms, index, dsx, dsy, az, el, bond, scale, bonds=None):
    """Move atom *index* by a screen delta (dsx, dsy) in the current view.

    Passing *bonds* keeps the atom's bond lengths at their chemical values:
    the drag then swings the bond around rather than stretching it."""
    ca, sa = math.cos(az), math.sin(az)
    ce, se = math.cos(el), math.sin(el)
    r = (ca, -sa, 0.0)                     # world axis that moves screen-x
    g = (sa * se, ca * se, -ce)            # world axis that moves screen-y
    k = 1.0 / (scale * (bond or 1.0))
    atoms[index][1] += (dsx * r[0] + dsy * g[0]) * k
    atoms[index][2] += (dsx * r[1] + dsy * g[1]) * k
    atoms[index][3] += (dsx * r[2] + dsy * g[2]) * k
    if bonds is not None:
        constrain_atom(atoms, bonds, index)


def specs_from_atoms(atoms, bonds, w, h, az=None, el=None, bond=1.0,
                     rscale=0.92, tag_atoms=False, frozen=None, labels=False,
                     poly=False, colors=None):
    """Shape specs for a custom (atoms, bonds) model."""
    return _model(atoms, bonds, w, h, rscale=rscale,
                  az=DEFAULT_AZ if az is None else az,
                  el=DEFAULT_EL if el is None else el, bond_scale=bond,
                  tag_atoms=tag_atoms, frozen=frozen, labels=labels,
                  poly=poly, colors=colors)


# ------------------------------------------------------- generic 3D vectors
_INV3 = 1.0 / math.sqrt(3.0)
#: The four sp3 tetrahedral directions (unit vectors).
TETRA = [(_INV3, _INV3, _INV3), (_INV3, -_INV3, -_INV3),
         (-_INV3, _INV3, -_INV3), (-_INV3, -_INV3, _INV3)]


def add(atoms, el, p):
    atoms.append((el, p[0], p[1], p[2]))
    return len(atoms) - 1


def scale(v, k):
    return (v[0] * k, v[1] * k, v[2] * k)


def plus(p, v):
    return (p[0] + v[0], p[1] + v[1], p[2] + v[2])


def _norm(v):
    return math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])


def _unit(v):
    n = _norm(v) or 1.0
    return (v[0] / n, v[1] / n, v[2] / n)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def _perp(v):
    ref = (0.0, 0.0, 1.0) if abs(v[2]) < 0.9 else (0.0, 1.0, 0.0)
    return _unit(_cross(v, ref))


def minus(p, q):
    return (p[0] - q[0], p[1] - q[1], p[2] - q[2])


#: Public aliases, for structure builders that need to place sp2 centres or
#: rings by hand (the sp3 case is `add_bonded_atom`).
unit, cross, perp = _unit, _cross, _perp


# ------------------------------------------------------- interactive builder
_COS_TET = 1.0 / 3.0                # |cos(109.47°)|
_SIN_TET = math.sqrt(8.0) / 3.0    # sin(109.47°)


def single_atom(element="C"):
    """A fresh one-atom structure to start building from."""
    return [[element, 0.0, 0.0, 0.0]], []


def _bond_length(a, b, order=1):
    """Equilibrium A–B length (Å) for a bond of *order* — the real chemistry,
    so C–O (1.43) and C=O (1.23) differ."""
    return elements.bond_length(a, b, order)


def bond_length_of(atoms, bonds, bond_index):
    """Ideal length of the bond at *bond_index*."""
    i, j, order = bonds[bond_index]
    return _bond_length(atoms[i][0], atoms[j][0], order)


def distance(atoms, i, j):
    """Current centre-to-centre distance (Å) between two atoms."""
    return _norm((atoms[j][1] - atoms[i][1], atoms[j][2] - atoms[i][2],
                  atoms[j][3] - atoms[i][3]))


def angle(atoms, i, j, k):
    """The i–j–k bond angle in degrees, measured at the middle atom *j*."""
    u = _unit((atoms[i][1] - atoms[j][1], atoms[i][2] - atoms[j][2],
               atoms[i][3] - atoms[j][3]))
    v = _unit((atoms[k][1] - atoms[j][1], atoms[k][2] - atoms[j][2],
               atoms[k][3] - atoms[j][3]))
    dot = max(-1.0, min(1.0, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))
    return math.degrees(math.acos(dot))


def bond_between(bonds, i, j):
    """Index of the bond joining *i* and *j*, or None."""
    for bi, (a, b, _o) in enumerate(bonds):
        if {a, b} == {i, j}:
            return bi
    return None


def used_valence(bonds, index):
    """Bonds already on atom *index* (summing bond orders)."""
    return sum(o for i, j, o in bonds if index in (i, j))


def free_valence(atoms, bonds, index):
    """How many more bonds atom *index* can take."""
    return elements.valence(atoms[index][0]) - used_valence(bonds, index)


def _neighbor_dirs(atoms, bonds, anchor):
    ax, ay, az = atoms[anchor][1], atoms[anchor][2], atoms[anchor][3]
    out = []
    for i, j, _o in bonds:
        k = j if i == anchor else (i if j == anchor else None)
        if k is not None:
            out.append((k, _unit((atoms[k][1] - ax, atoms[k][2] - ay,
                                  atoms[k][3] - az))))
    return out


def _chain_direction(atoms, bonds, anchor, neigh_k, neigh_dir):
    """Direction to extend a chain at *anchor* (one heavy neighbour), as a
    trans (anti-periplanar) zig-zag so a chain stays straight."""
    forward = (-neigh_dir[0], -neigh_dir[1], -neigh_dir[2])
    prev = [d for k, d in _neighbor_dirs(atoms, bonds, neigh_k) if k != anchor]
    normal = _cross(prev[0], neigh_dir) if prev else (0.0, 0.0, 1.0)
    if _norm(normal) < 1e-6:
        normal = (0.0, 0.0, 1.0)
    normal = _unit(normal)
    side = _unit(_cross(normal, forward))
    sign = 1.0
    if prev:
        s_prev = (prev[0][0] * side[0] + prev[0][1] * side[1]
                  + prev[0][2] * side[2])
        sign = -1.0 if s_prev > 0 else 1.0
    return _unit((forward[0] * _COS_TET + side[0] * _SIN_TET * sign,
                  forward[1] * _COS_TET + side[1] * _SIN_TET * sign,
                  forward[2] * _COS_TET + side[2] * _SIN_TET * sign))


def _free_direction(atoms, bonds, anchor):
    """A tetrahedral direction at *anchor* not already occupied by a bond."""
    dirs = [d for _k, d in _neighbor_dirs(atoms, bonds, anchor)]
    if not dirs:
        return (1.0, 0.0, 0.0)
    if len(dirs) == 1:
        n0 = dirs[0]
        p = _perp(n0)
        return _unit((-n0[0] * _COS_TET + p[0] * _SIN_TET,
                      -n0[1] * _COS_TET + p[1] * _SIN_TET,
                      -n0[2] * _COS_TET + p[2] * _SIN_TET))
    if len(dirs) == 2:
        bis = _unit((-(dirs[0][0] + dirs[1][0]), -(dirs[0][1] + dirs[1][1]),
                     -(dirs[0][2] + dirs[1][2])))
        normal = _cross(dirs[0], dirs[1])
        normal = _perp(dirs[0]) if _norm(normal) < 1e-6 else _unit(normal)
        for sign in (1.0, -1.0):
            cand = _unit((bis[0] * 0.577 + normal[0] * 0.816 * sign,
                          bis[1] * 0.577 + normal[1] * 0.816 * sign,
                          bis[2] * 0.577 + normal[2] * 0.816 * sign))
            if all(cand[0] * d[0] + cand[1] * d[1] + cand[2] * d[2] < 0.6
                   for d in dirs):
                return cand
        return bis
    s = (sum(d[0] for d in dirs), sum(d[1] for d in dirs),
         sum(d[2] for d in dirs))
    return _perp(dirs[0]) if _norm(s) < 1e-6 else _unit((-s[0], -s[1], -s[2]))


def add_bonded_atom(atoms, bonds, anchor, element, order=1):
    """Add an *element* atom bonded to atom *anchor*. Mutates the lists;
    returns the new atom's index."""
    ax, ay, az = atoms[anchor][1], atoms[anchor][2], atoms[anchor][3]
    neigh = _neighbor_dirs(atoms, bonds, anchor)
    if len(neigh) == 1:
        d = _chain_direction(atoms, bonds, anchor, neigh[0][0], neigh[0][1])
    else:
        d = _free_direction(atoms, bonds, anchor)
    length = _bond_length(element, atoms[anchor][0], order)
    atoms.append([element, ax + d[0] * length, ay + d[1] * length,
                  az + d[2] * length])
    idx = len(atoms) - 1
    bonds.append([anchor, idx, order])
    return idx


def delete_atom(atoms, bonds, index):
    """Remove atom *index* and any bonds to it, re-indexing the rest."""
    atoms.pop(index)
    kept = []
    for i, j, o in bonds:
        if i == index or j == index:
            continue
        kept.append([i - (i > index), j - (j > index), o])
    bonds[:] = kept


# ------------------------------------------------------- geometry constraints
def constrain_atom(atoms, bonds, index, iterations=24):
    """Pull atom *index* back onto every ideal bond length to its neighbours.

    Only that atom moves — the rest of the model stays put. With one
    neighbour this is exact in a single pass: the atom lands on the sphere of
    correct radius, so a drag swings the bond around instead of stretching
    it. With several neighbours each sweep projects onto each neighbour's
    sphere in turn (alternating projections), which settles in well under a
    dozen sweeps."""
    links = [(j if i == index else i, o)
             for i, j, o in bonds if index in (i, j)]
    if not links:
        return
    for _ in range(iterations):
        worst = 0.0
        for k, order in links:
            target = _bond_length(atoms[index][0], atoms[k][0], order)
            v = (atoms[index][1] - atoms[k][1], atoms[index][2] - atoms[k][2],
                 atoms[index][3] - atoms[k][3])
            d = _norm(v)
            if d < 1e-9:                    # coincident — push off arbitrarily
                v, d = (1.0, 0.0, 0.0), 1.0
            error = target - d
            worst = max(worst, abs(error))
            atoms[index][1] += v[0] / d * error
            atoms[index][2] += v[1] / d * error
            atoms[index][3] += v[2] / d * error
        if worst < 1e-6:
            break


def fragment(bonds, start, skip_bond):
    """Atom indices reachable from *start* without crossing bond *skip_bond*.

    Returns the whole connected side of that bond — or, in a ring, every atom
    on the cycle (so callers can tell a ring bond from a rotatable one)."""
    seen = {start}
    stack = [start]
    while stack:
        cur = stack.pop()
        for bi, (i, j, _o) in enumerate(bonds):
            if bi == skip_bond:
                continue
            k = j if i == cur else (i if j == cur else None)
            if k is not None and k not in seen:
                seen.add(k)
                stack.append(k)
    return seen


def relax_bond(atoms, bonds, bond_index):
    """Restore bond *bond_index* to its ideal length by sliding the smaller
    side along the bond axis. A ring bond is left alone (nothing can move
    without breaking the cycle)."""
    i, j, _o = bonds[bond_index]
    target = bond_length_of(atoms, bonds, bond_index)
    v = (atoms[j][1] - atoms[i][1], atoms[j][2] - atoms[i][2],
         atoms[j][3] - atoms[i][3])
    d = _norm(v)
    if d < 1e-9:
        v, d = (1.0, 0.0, 0.0), 1.0
    delta = target - d
    if abs(delta) < 1e-6:
        return
    side = fragment(bonds, j, bond_index)
    if i in side:                       # ring bond — no free side to slide
        return
    other = fragment(bonds, i, bond_index)
    if len(side) > len(other):          # move whichever side is smaller
        side, sign = other, -1.0
    else:
        sign = 1.0
    for k in side:
        atoms[k][1] += v[0] / d * delta * sign
        atoms[k][2] += v[1] / d * delta * sign
        atoms[k][3] += v[2] / d * delta * sign


def can_bond(atoms, bonds, i, j, order=1):
    """True if atoms *i* and *j* may be joined by a bond of *order* — they
    are distinct, not already bonded, and both have the free valence."""
    if i == j or bond_between(bonds, i, j) is not None:
        return False
    return all(free_valence(atoms, bonds, k) >= order for k in (i, j))


def add_bond(atoms, bonds, i, j, order=1):
    """Bond two *existing* atoms, then pull them to the right length.

    Joining two separate fragments slides the smaller one along the new bond
    axis; closing a ring leaves the geometry alone. Returns success."""
    if not can_bond(atoms, bonds, i, j, order):
        return False
    bonds.append([i, j, order])
    relax_bond(atoms, bonds, len(bonds) - 1)
    return True


def can_set_bond_order(atoms, bonds, bond_index, order):
    """True if raising bond *bond_index* to *order* fits both atoms' valence."""
    i, j, old = bonds[bond_index]
    delta = order - old
    if delta <= 0:
        return order >= 1
    return all(free_valence(atoms, bonds, k) >= delta for k in (i, j))


def set_bond_order(atoms, bonds, bond_index, order):
    """Change a bond's order and re-length it (C–O 1.43 Å → C=O 1.23 Å).

    Refuses orders the two atoms' valences cannot carry; returns success."""
    order = max(1, min(3, int(order)))
    if not can_set_bond_order(atoms, bonds, bond_index, order):
        return False
    bonds[bond_index][2] = order
    relax_bond(atoms, bonds, bond_index)
    return True


def delete_bond(bonds, bond_index):
    """Remove a bond, leaving both atoms in place."""
    bonds.pop(bond_index)


# ------------------------------------------------------- merging / reattaching
def merge(atoms, bonds, new_atoms, new_bonds, gap=2.0):
    """Append another structure as a separate fragment, clear of this one.

    The incoming atoms are shifted so their bounding box sits *gap* ångström
    to the right of the existing one. Returns the new atoms' index offset."""
    base = len(atoms)
    dx = dy = dz = 0.0
    if atoms and new_atoms:
        dx = (max(a[1] for a in atoms) - min(a[1] for a in new_atoms)) + gap
        dy = (_centroid(atoms)[1]
              - sum(a[2] for a in new_atoms) / len(new_atoms))
        dz = (_centroid(atoms)[2]
              - sum(a[3] for a in new_atoms) / len(new_atoms))
    for a in new_atoms:
        atoms.append([a[0], a[1] + dx, a[2] + dy, a[3] + dz])
    for i, j, o in new_bonds:
        bonds.append([i + base, j + base, o])
    return base


def translate(atoms, indices, delta):
    for k in indices:
        atoms[k][1] += delta[0]
        atoms[k][2] += delta[1]
        atoms[k][3] += delta[2]


def moving_fragment(bonds, atom, old_bond):
    """The atoms that would travel with *atom* if bond *old_bond* were cut."""
    return fragment(bonds, atom, -1 if old_bond is None else old_bond)


def can_reattach(atoms, bonds, atom, old_bond, anchor, order=1):
    """True if *atom* (with the fragment hanging off it) can be unhooked from
    bond *old_bond* and re-bonded to *anchor* instead."""
    if atom == anchor or not 0 <= anchor < len(atoms):
        return False
    if old_bond is not None and anchor in bonds[old_bond][:2]:
        return False                    # that is the bond we are replacing
    # The anchor must not travel with the atom: it would be bonding a
    # fragment to itself. (A second bond between the two — a ring — leaves
    # the anchor reachable without crossing *old_bond*, so this catches it.)
    if anchor in moving_fragment(bonds, atom, old_bond):
        return False
    freed = bonds[old_bond][2] if old_bond is not None else 0
    return (free_valence(atoms, bonds, atom) + freed >= order
            and free_valence(atoms, bonds, anchor) >= order)


def reattach(atoms, bonds, atom, old_bond, anchor, order=1):
    """Move *atom* — and everything hanging off it — onto a new *anchor*.

    Breaks bond *old_bond* (the one to its current parent), then swings the
    whole fragment so *atom* lands on a free tetrahedral direction of the
    anchor, at the right bond length. Returns success."""
    if not can_reattach(atoms, bonds, atom, old_bond, anchor, order):
        return False
    moving = moving_fragment(bonds, atom, old_bond)
    if old_bond is not None:
        bonds.pop(old_bond)
    d = _free_direction(atoms, bonds, anchor)
    length = _bond_length(atoms[anchor][0], atoms[atom][0], order)
    target = (atoms[anchor][1] + d[0] * length,
              atoms[anchor][2] + d[1] * length,
              atoms[anchor][3] + d[2] * length)
    translate(atoms, moving, (target[0] - atoms[atom][1],
                              target[1] - atoms[atom][2],
                              target[2] - atoms[atom][3]))
    bonds.append([anchor, atom, order])
    return True


# ----------------------------------------------------------------- container
class Molecule:
    """An editable structure plus its current 3D view.

    ``atoms`` is a list of ``[element, x, y, z]`` — with an optional 5th
    slot, a per-atom colour — and ``bonds`` a list of ``[i, j, order]``.
    ``name`` is the library key it came from (or a free label); ``crystal``
    marks fixed-lattice models (not atom-editable).

    A crystal carries its own **lattice state**: ``cells`` is the
    ``(nx, ny, nz)`` supercell it is tiled into, ``tilts`` maps a
    ``"i,j,k"`` cell key to its ``(rx, ry, rz)`` tilt in degrees,
    ``colors`` overrides the colour of an element/site (a crystal is
    regenerated from its builder, so its colours can't ride on the atoms)
    and ``poly`` draws coordination polyhedra. `rebuild` regenerates the
    atoms for the current lattice state and fills two membership tables:
    ``owners`` gives each atom one home cell (how clicking an atom picks a
    cell) and ``members`` gives each cell all of its atoms, shared corners
    included (how a whole cell is highlighted)."""

    def __init__(self, atoms=None, bonds=None, name="custom", label=None,
                 az=None, el=None, bond=None, rscale=0.92, crystal=False,
                 edges=None, cells=None, tilts=None, colors=None, poly=False,
                 notes=None):
        self.atoms = [list(a) for a in (atoms or [])]
        self.bonds = [list(b) for b in (bonds or [])]
        self.edges = list(edges) if edges else None
        #: 3D annotations drawn over the scene (a reaction's coefficients,
        #: plus signs, arrow and formulas): dicts with ``kind`` "text"
        #: (text, pos, size Å, color, bold) or "arrow" (p1, p2, color,
        #: double, size)
        self.notes = [dict(n) for n in notes] if notes else None
        #: a reaction scene's equation (persisted) and its film
        #: (`rxanim.Animation`, rebuilt from the equation, not persisted)
        self.reaction = None
        self.anim = None
        self.name = name
        self.label = label or name
        self.az = DEFAULT_AZ if az is None else az
        self.el = DEFAULT_EL if el is None else el
        self.bond = 1.6 if bond is None else bond
        self.rscale = rscale
        self.crystal = crystal
        self.cells = tuple(cells) if cells else (1, 1, 1)
        self.tilts = dict(tilts or {})
        self.colors = dict(colors or {})
        self.poly = bool(poly)
        #: draw the unit-cell / slab outline (`edges`)
        self.cell_visible = True
        #: rigid groups of atoms that can be moved as one — the molecules
        #: lying on a surface (`adsorbates`): ``{"name", "start", "count"}``
        self.groups = []
        self.owners = ["0,0,0"] * len(self.atoms)
        self.members = {"0,0,0": list(range(len(self.atoms)))}

    def clone(self):
        c = Molecule(self.atoms, self.bonds, self.name, self.label,
                     self.az, self.el, self.bond, self.rscale,
                     self.crystal, self.edges, self.cells, self.tilts,
                     self.colors, self.poly, self.notes)
        c.reaction, c.anim = self.reaction, self.anim
        c.cell_visible = self.cell_visible
        c.groups = [dict(g) for g in self.groups]
        return c

    @property
    def shown_edges(self):
        """The outline to draw: ``edges``, or None when it is switched off."""
        return self.edges if self.cell_visible else None

    # ------------------------------------------------------ lattice state
    @property
    def can_stack(self):
        """Whether this crystal tiles into a supercell."""
        from . import library
        if str(self.name).startswith("crystal:"):
            return bool(self.crystal)         # a library crystal (`chem`)
        return self.crystal and library.can_stack(self.name)

    @property
    def stacked(self):
        return self.cells != (1, 1, 1)

    def rebuild(self):
        """Regenerate a crystal's atoms/bonds/edges for the current
        ``cells``/``tilts``, refreshing ``owners``. A no-op for an editable
        molecule, whose atoms are the document."""
        from . import library
        if not self.crystal:
            return
        owners, members = [], {}
        if str(self.name).startswith("crystal:"):
            from . import chem
            atoms, bonds, edges, rscale, label = chem.crystal_stack(
                self.name[len("crystal:"):], self.cells, self.tilts,
                owners, members)
            self.label = label
        elif self.name in library.LABELS:
            atoms, bonds, edges, rscale = library.model_data(
                self.name, self.cells if self.stacked else None,
                tilts=self.tilts, owners=owners, members=members)
        else:
            return
        self.atoms = [list(a) for a in atoms]
        self.bonds = [list(b) for b in bonds]
        self.edges = list(edges) if edges else None
        self.rscale = rscale
        self.owners = owners
        self.members = members

    def cell_of(self, index):
        """The ``"i,j,k"`` cell atom *index* belongs to.

        A corner shared between cells belongs to all of them; this names
        the first, which is the one a tilt would rotate."""
        if index is not None and 0 <= index < len(self.owners):
            return self.owners[index]
        return "0,0,0"

    def cell_members(self, key):
        """Every atom index in cell *key* — the shared corners included, so
        this is the whole cell as drawn, not just the atoms it created."""
        return list(self.members.get(key, ()))

    def prune_tilts(self):
        """Drop tilts that now point outside the supercell."""
        from . import supercell
        self.tilts = {k: v for k, v in self.tilts.items()
                      if supercell.in_range(k, self.cells)}

    def _frozen_fit(self, w, h):
        """A supercell's layout is anchored to its **untilted** geometry:
        the fit would otherwise chase a tilted cell's protruding corners
        and rescale every other cell with it, so tilting one cell would
        shift the whole crystal."""
        if not (self.stacked and self.tilts):
            return None
        if str(self.name).startswith("crystal:"):
            from . import chem
            base = chem.crystal_stack(self.name[len("crystal:"):],
                                      self.cells)[0]
        else:
            from . import library
            base = library.model_data(self.name, self.cells)[0]
        return fit_params(base, [], w, h, self.az, self.el, self.bond,
                          self.rscale)

    def specs(self, w, h, tag_atoms=False, frozen=None, labels=False):
        if frozen is None:
            frozen = self._frozen_fit(w, h)
        return _model(self.atoms, self.bonds, w, h, edges=self.shown_edges,
                      rscale=self.rscale, az=self.az, el=self.el,
                      bond_scale=self.bond, tag_atoms=tag_atoms,
                      frozen=frozen, labels=labels, poly=self.poly,
                      colors=self.colors, notes=self.notes)

    def formula(self):
        """Hill-system molecular formula string (C first, H second, rest
        alphabetical)."""
        counts = {}
        for a in self.atoms:
            counts[a[0]] = counts.get(a[0], 0) + 1
        order = []
        if "C" in counts:
            order.append("C")
        if "H" in counts:
            order.append("H")
        order += sorted(e for e in counts if e not in ("C", "H"))
        out = ""
        for e in order:
            n = counts[e]
            out += e + (str(n) if n > 1 else "")
        return out
