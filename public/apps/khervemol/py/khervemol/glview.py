"""OpenGL 3D viewer widget: lit sphere / cylinder impostors, MSAA, halos.

`GLView` is a drop-in replacement for `viewer3d._View` (the QPainter
viewer): same signals, same mouse semantics, same projection (`model._proj`
— so the orientation buttons and saved views agree), but the picture is
drawn by the GPU. Atoms are one camera-facing quad each and bonds one
quad per stick; the fragment shaders solve the exact sphere / cylinder
under every pixel (see `glshaders`), so the balls are perfectly round at
any zoom, shaded with a key + fill light, specular highlights, a fresnel
rim and depth-cue fog, and intersect their sticks correctly. Selection is
a soft coloured halo; unit-cell edges are thin (dashed) cylinders.

Only PyQt5 is needed — GL 2.1 functions come from
``QOpenGLContext.versionFunctions`` and shaders from `QOpenGLShaderProgram`
— so it runs on macOS's legacy profile and on Windows / Linux alike. The
scene (positions, radii, colours, hit-testing) is built on the CPU by
`Scene`, independent of GL, so it can be unit-tested offscreen; the GPU
buffers are rebuilt only when the structure changes, and orbiting just
updates uniforms.

If GL cannot start (no context, a shader that will not compile) the widget
emits `failed(str)` and `Viewer3D` swaps back to the classic view.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

import math
import os
from array import array

from PyQt5.QtCore import QEvent, QPointF, Qt, QTimer, pyqtSignal
from PyQt5.QtGui import (QBrush, QColor, QFont, QFontMetricsF, QGuiApplication,
                         QImage, QPainter, QPainterPath, QPen, QRadialGradient,
                         QSurfaceFormat)
from PyQt5.QtWidgets import QWidget

try:
    from PyQt5.QtWidgets import QOpenGLWidget
    HAVE_QT_GL = True
except ImportError:                                   # pragma: no cover
    QOpenGLWidget = QWidget
    HAVE_QT_GL = False

from . import dnd, elements, glshaders, model, molcolor

_HALF = math.pi / 2.0
SEL_COLOR = "#159c74"                    # the primary (last-clicked) atom
CO_SEL_COLOR = "#7fbf3f"                 # other Ctrl-selected atoms
CELL_COLOR = "#d98324"                   # the cell a tilt would rotate

STYLES = ("ball_and_stick", "space_filling", "sticks")
STYLE_LABELS = {"ball_and_stick": "Ball & stick",
                "space_filling": "Space filling", "sticks": "Sticks"}

#: van der Waals radii (Å) for the space-filling style; others fall back to
#: 1.5 × the covalent radius.
_VDW = {"H": 1.20, "He": 1.40, "Li": 1.82, "Be": 1.53, "B": 1.92, "C": 1.70,
        "N": 1.55, "O": 1.52, "F": 1.47, "Ne": 1.54, "Na": 2.27, "Mg": 1.73,
        "Al": 1.84, "Si": 2.10, "P": 1.80, "S": 1.80, "Cl": 1.75, "Ar": 1.88,
        "K": 2.75, "Ca": 2.31, "Fe": 2.04, "Co": 2.00, "Ni": 1.63,
        "Cu": 1.40, "Zn": 1.39, "Br": 1.85, "Kr": 2.02, "I": 1.98,
        "Xe": 2.16, "Cs": 3.43, "Au": 1.66, "Ag": 1.72, "Pt": 1.75,
        "Pb": 2.02, "Ti": 2.00}

STICK_RADIUS = {"ball_and_stick": 0.10, "space_filling": 0.0, "sticks": 0.13}
STICK_BALL = 0.16                        # ball radius in the sticks style

#: Default vertical background gradient (light; see `set_background`).
POLY_ALPHA = 0.32                        # polyhedron face opacity (as classic)
BG_TOP = "#fdfdfe"
BG_BOTTOM = "#d5dde8"

_QUAD = ((-1.0, -1.0), (1.0, -1.0), (1.0, 1.0),
         (-1.0, -1.0), (1.0, 1.0), (-1.0, 1.0))
_CQUAD = ((0.0, -1.0), (1.0, -1.0), (1.0, 1.0),
          (0.0, -1.0), (1.0, 1.0), (0.0, 1.0))


def gl_available():
    """True when a hardware GL viewer is worth trying: not the offscreen /
    minimal platforms (tests, CI) and not disabled by
    ``KHERVEMOL_RENDERER=classic``."""
    if not HAVE_QT_GL:
        return False
    if os.environ.get("KHERVEMOL_RENDERER", "").lower() == "classic":
        return False
    return QGuiApplication.platformName() not in ("offscreen", "minimal", "")


# ---------------------------------------------------------------- geometry
_RGB = {}


def rgb(color):
    """``#rrggbb`` / QColor / name -> (r, g, b) floats in 0..1 (cached)."""
    key = color.name() if isinstance(color, QColor) else str(color)
    got = _RGB.get(key)
    if got is None:
        c = color if isinstance(color, QColor) else QColor(key)
        got = _RGB[key] = (c.redF(), c.greenF(), c.blueF())
    return got


def ball_radius(element, style, rscale=1.0):
    """Sphere radius (Å) of *element* in *style*."""
    if style == "space_filling":
        return _VDW.get(element, 1.5 * elements.covalent_radius(element))
    if style == "sticks":
        return STICK_BALL
    return elements.radius(element) * rscale


def spread_factor(mol, style):
    """The bond-spread factor actually applied: space-filling shows the true
    geometry (touching spheres), so the bond slider does not apply."""
    if style == "space_filling":
        return 1.0
    return 1.0 if mol.bond is None else float(mol.bond)


def view_basis(az, el):
    """(right, up, toward-viewer) unit vectors of the isometric camera —
    exactly the axes `model._proj` projects onto (screen y there points
    down, so *up* is its negation)."""
    ca, sa = math.cos(az), math.sin(az)
    ce, se = math.cos(el), math.sin(el)
    return ((ca, -sa, 0.0), (-sa * se, -ca * se, ce), (sa * ce, ca * ce, se))


def extent_of(pos, radii, edges=(), notes=()):
    """(centre, bounding-sphere radius) of atoms (with their radii), cell
    edges and annotations — the box the camera fits."""
    pts = list(zip(pos, radii))
    for e in edges:
        pts += [(e[0], 0.0), (e[1], 0.0)]
    for n in notes:
        if n["kind"] == "text":
            size = float(n.get("size", 1.0))
            pts.append((n["pos"], 0.32 * size * len(str(n.get("text", "")))
                        + 0.4 * size))
        else:
            pts += [(n["p1"], 0.0), (n["p2"], 0.0)]
    if not pts:
        return (0.0, 0.0, 0.0), 1.0
    lo = [min(p[k] - r for p, r in pts) for k in range(3)]
    hi = [max(p[k] + r for p, r in pts) for k in range(3)]
    c = tuple((lo[k] + hi[k]) / 2.0 for k in range(3))
    bound = 0.0
    for p, r in pts:
        d = math.sqrt(sum((p[k] - c[k]) ** 2 for k in range(3))) + r
        bound = max(bound, d)
    return c, bound


_BASE = {}                               # (name, cells) -> untilted base


def tilt_anchor(mol, style, factor):
    """Layout anchor for a stacked crystal with tilted cells: the fit and
    the spread centre come from the **untilted** geometry, so tilting one
    cell does not rescale or shift the rest (`Molecule._frozen_fit`'s
    intent). None when there is nothing to anchor."""
    if not (getattr(mol, "stacked", False) and getattr(mol, "tilts", None)
            and mol.crystal):
        return None
    key = (mol.name, tuple(mol.cells))
    try:
        base = _BASE.get(key)
        if base is None:
            from . import library
            if mol.name not in library.LABELS:
                return None
            atoms, _b, edges, rs = library.model_data(mol.name, mol.cells)
            if len(_BASE) >= 4:
                _BASE.clear()
            base = _BASE[key] = (atoms, edges, rs)
        atoms, edges, rs = base
        c0 = model._centroid(atoms)
        at, ed = model._spread(atoms, edges, factor, c0)
        pos = [(a[1], a[2], a[3]) for a in at]
        radii = [ball_radius(a[0], style, rs) for a in at]
        center, bound = extent_of(pos, radii, ed or ())
        return {"centroid": c0, "center": center, "bound": bound}
    except Exception:
        return None


class Scene:
    """A structure laid out for drawing: spread atom positions, radii,
    colours (per-atom / per-site overrides applied), sticks, cell edges,
    coordination polyhedra and annotations — plus the CPU projection used
    for hit-testing and labels. No GL in here.

    *frozen* (``{"centroid", "center", "bound"}``, from a previous scene's
    `freeze`) keeps the layout still while one atom is dragged; a tilted
    supercell anchors itself to its untilted base (`tilt_anchor`)."""

    def __init__(self, mol, style="ball_and_stick", frozen=None):
        self.style = style if style in STYLES else "ball_and_stick"
        self.factor = spread_factor(mol, self.style)
        raw = mol.atoms
        cmap = getattr(mol, "colors", None)
        if cmap:
            raw = molcolor.apply_colors(raw, cmap)
        if frozen is None:
            frozen = tilt_anchor(mol, self.style, self.factor)
        cen = frozen["centroid"] if frozen else None
        atoms, edges = model._spread(raw, mol.shown_edges, self.factor, cen)
        self.centroid = cen if cen is not None else model._centroid(raw)
        self.atoms = atoms
        self.pos = [(a[1], a[2], a[3]) for a in atoms]
        self.elems = [a[0] for a in atoms]
        rs = mol.rscale
        self.radii = [ball_radius(e, self.style, rs) for e in self.elems]
        self.colors = [rgb(a[4] if len(a) > 4 and a[4]
                           else elements.color(a[0])) for a in atoms]
        self.bonds = [(b[0], b[1], b[2]) for b in mol.bonds
                      if b[0] < len(self.pos) and b[1] < len(self.pos)]
        self.stick = STICK_RADIUS[self.style]
        self.edges = edges or []
        self.poly = bool(getattr(mol, "poly", False))
        self._faces = None
        notes = getattr(mol, "notes", None)
        if notes and atoms and self.factor != 1.0:
            notes = model._spread_notes(notes, self.factor, self.centroid)
        self.notes = [n for n in (notes or ())
                      if n.get("kind") in ("text", "arrow")]
        self.tight = bool(self.notes)      # wide scenes: fit the projection
        if frozen:
            self.center, self.bound = frozen["center"], frozen["bound"]
        else:
            self.center, self.bound = extent_of(self.pos, self.radii,
                                                self.edges, self.notes)
        self._cache = None

    def freeze(self):
        return {"centroid": self.centroid, "center": self.center,
                "bound": self.bound}

    # ------------------------------------------------------------ camera
    def fit_ppa(self, w, h, az=None, el=None, margin=0.04):
        """Logical pixels per ångström that fit the whole model in a (w, h)
        box at zoom 1. Ordinary structures fit their bounding sphere, so
        orbiting never rescales the picture; annotated scenes (wide
        reactions) fit the projected extent for the given view instead."""
        if self.tight and az is not None:
            hx, hy = self._view(az, el)[2]
            hx, hy = max(hx, 0.5), max(hy, 0.5)
            return min(w * (0.5 - margin) / hx, h * (0.5 - margin) / hy)
        bound = max(self.bound, 1.5)
        return 0.5 * min(w, h) * (1.0 - 2.0 * margin) / bound

    def _rel_view(self, p, az, el):
        r, u, f = view_basis(az, el)
        d = [p[k] - self.center[k] for k in range(3)]
        return (sum(d[k] * r[k] for k in range(3)),
                sum(d[k] * u[k] for k in range(3)),
                sum(d[k] * f[k] for k in range(3)))

    def _view(self, az, el):
        """(coords, pan, half-extent) for a view: atom view-space
        coordinates with the (tight-fit) pan already removed."""
        key = (az, el)
        if self._cache is not None and self._cache[0] == key:
            return self._cache[1]
        coords = [self._rel_view(p, az, el) for p in self.pos]
        pan, half = (0.0, 0.0), (0.0, 0.0)
        if self.tight:
            xs, ys = [], []
            for (x, y, _z), r in zip(coords, self.radii):
                xs += [x - r, x + r]
                ys += [y - r, y + r]
            for e in self.edges:
                for q in (e[0], e[1]):
                    v = self._rel_view(q, az, el)
                    xs.append(v[0])
                    ys.append(v[1])
            for n in self.notes:
                for x, y in self.note_box(n, az, el):
                    xs.append(x)
                    ys.append(y)
            if xs:
                pan = ((min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0)
                half = ((max(xs) - min(xs)) / 2.0, (max(ys) - min(ys)) / 2.0)
        coords = [(x - pan[0], y - pan[1], z) for x, y, z in coords]
        out = (coords, pan, half)
        self._cache = (key, out)
        return out

    def note_box(self, note, az, el):
        """View-space (x, y) points bounding an annotation (pan not applied)."""
        if note["kind"] == "arrow":
            return [self._rel_view(note[k], az, el)[:2] for k in ("p1", "p2")]
        x, y, _ = self._rel_view(note["pos"], az, el)
        size = float(note.get("size", 1.0))
        hw = 0.32 * size * len(str(note.get("text", "")))
        hh = 0.62 * size
        return [(x - hw, y - hh), (x + hw, y + hh)]

    def view_coords(self, az, el):
        """View-space (x right, y up, z toward viewer) of every atom, in Å
        relative to the scene centre (and the fit pan)."""
        return self._view(az, el)[0]

    def screen(self, az, el, ppa, w, h):
        """[(sx, sy, depth)] in widget pixels (y down)."""
        return [(w / 2.0 + x * ppa, h / 2.0 - y * ppa, z)
                for x, y, z in self.view_coords(az, el)]

    def screen_point(self, p, az, el, ppa, w, h):
        """Widget pixels (sx, sy) of an arbitrary world point."""
        pan = self._view(az, el)[1]
        x, y, _ = self._rel_view(p, az, el)
        return w / 2.0 + (x - pan[0]) * ppa, h / 2.0 - (y - pan[1]) * ppa

    # -------------------------------------------------------- hit testing
    def pick_atom(self, sx, sy, az, el, ppa, w, h):
        """Index of the front-most atom whose disc contains the pixel."""
        best, best_z = None, -1e30
        for i, (x, y, z) in enumerate(self.screen(az, el, ppa, w, h)):
            rp = self.radii[i] * ppa
            d2 = (sx - x) ** 2 + (sy - y) ** 2
            if d2 <= rp * rp:
                front = z + math.sqrt(max(rp * rp - d2, 0.0)) / ppa
                if front > best_z:
                    best, best_z = i, front
        return best

    def pick_bond(self, sx, sy, az, el, ppa, w, h, slack=4.0):
        """Index of the bond whose projected stick passes within a few
        pixels of the point (the caller checks no atom is on top)."""
        pts = self.screen(az, el, ppa, w, h)
        tol = max(slack, self.stick * 2.6 * ppa)
        best, best_d = None, tol
        for bi, (i, j, _o) in enumerate(self.bonds):
            x1, y1, _ = pts[i]
            x2, y2, _ = pts[j]
            dx, dy = x2 - x1, y2 - y1
            ln = dx * dx + dy * dy
            t = 0.0 if ln < 1e-9 else max(
                0.0, min(1.0, ((sx - x1) * dx + (sy - y1) * dy) / ln))
            d = math.hypot(sx - (x1 + t * dx), sy - (y1 + t * dy))
            if d <= best_d:
                best, best_d = bi, d
        return best

    # ---------------------------------------------------- vertex arrays
    def sphere_data(self):
        """Per-vertex ``center(3) corner(2) radius(1) colour(3)``, six
        vertices per atom."""
        out = array("f")
        ext = out.extend
        for (x, y, z), r, c in zip(self.pos, self.radii, self.colors):
            for cx, cy in _QUAD:
                ext((x, y, z, cx, cy, r, c[0], c[1], c[2]))
        return out

    def faces(self):
        """Coordination-polyhedron faces ``[(points, (r, g, b))]`` (empty
        unless the polyhedra display is on)."""
        if not self.poly:
            return []
        if self._faces is None:
            self._faces = [(face, rgb(color)) for face, color in
                           molcolor.coordination_polyhedra(self.atoms,
                                                           self.bonds)]
        return self._faces

    def poly_data(self):
        """Per-vertex ``pos(3) normal(3) colour(3)`` triangles (each face
        fanned from its first vertex)."""
        out = array("f")
        ext = out.extend
        for face, c in self.faces():
            if len(face) < 3:
                continue
            a = face[0]
            for k in range(1, len(face) - 1):
                b, d = face[k], face[k + 1]
                u = [b[i] - a[i] for i in range(3)]
                v = [d[i] - a[i] for i in range(3)]
                n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2],
                     u[0] * v[1] - u[1] * v[0])
                ln = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2) or 1.0
                n = (n[0] / ln, n[1] / ln, n[2] / ln)
                for q in (a, b, d):
                    ext((q[0], q[1], q[2], n[0], n[1], n[2], c[0], c[1], c[2]))
        return out

    def _poly_edges(self, out):
        """Thin darker outlines of the polyhedron faces (each edge once)."""
        seen = set()
        for face, c in self.faces():
            dark = (c[0] * 0.65, c[1] * 0.65, c[2] * 0.65)
            n = len(face)
            for k in range(n):
                p, q = face[k], face[(k + 1) % n]
                key = tuple(sorted((tuple(round(x, 4) for x in p),
                                    tuple(round(x, 4) for x in q))))
                if key in seen:
                    continue
                seen.add(key)
                self._segment(out, p, q, -0.02, 0.0, dark)

    def halo_data(self, selection, primary, color=None):
        """Sphere-format quads for the selection halos (or, with *color*,
        the tilt-cell ring)."""
        out = array("f")
        for i in selection:
            if not 0 <= i < len(self.pos):
                continue
            x, y, z = self.pos[i]
            c = rgb(color or (SEL_COLOR if i == primary else CO_SEL_COLOR))
            r = self.radii[i]
            for cx, cy in _QUAD:
                out.extend((x, y, z, cx, cy, r, c[0], c[1], c[2]))
        return out

    def _segment(self, out, p0, p1, radius, off, color):
        ext = out.extend
        for u, v in _CQUAD:
            ext((p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], u, v, radius, off,
                 color[0], color[1], color[2]))

    def cylinder_data(self):
        """Per-vertex ``p0(3) p1(3) corner(2) radius(1) offset(1) colour(3)``:
        sticks (two halves in each atom's colour, 1–3 parallel tubes for
        single / double / triple bonds) and the cell edges."""
        out = array("f")
        rb = self.stick
        if rb > 0:
            for i, j, order in self.bonds:
                p, q = self.pos[i], self.pos[j]
                if p == q:
                    continue
                mid = tuple((p[k] + q[k]) / 2.0 for k in range(3))
                ci, cj = self.colors[i], self.colors[j]
                if order <= 1:
                    tubes = [(0.0, rb)]
                elif order == 2:
                    t = rb * 0.68
                    tubes = [(-1.15 * t, t), (1.15 * t, t)]
                else:
                    t = rb * 0.58
                    tubes = [(-2.2 * t, t), (0.0, t), (2.2 * t, t)]
                for off, rad in tubes:
                    if ci == cj:
                        self._segment(out, p, q, rad, off, ci)
                    else:
                        self._segment(out, p, mid, rad, off, ci)
                        self._segment(out, mid, q, rad, off, cj)
        for e in self.edges:
            p, q = e[0], e[1]
            style = e[2] if len(e) > 2 else "solid"
            if style == "dash":
                self._dashes(out, p, q)
            else:
                self._segment(out, p, q, -0.034, 0.0, (0.13, 0.15, 0.19))
        self._poly_edges(out)
        return out

    def _dashes(self, out, p, q, dash=0.17, gap=0.13):
        length = math.dist(p, q)
        if length < 1e-6:
            return
        step = max(dash + gap, length / 240.0)      # cap the dash count
        dash = dash * step / (dash + gap) if step > dash + gap else dash
        u = tuple((q[k] - p[k]) / length for k in range(3))
        col = (0.36, 0.39, 0.45)
        pos = 0.0
        while pos < length:
            end = min(pos + dash, length)
            a = tuple(p[k] + u[k] * pos for k in range(3))
            b = tuple(p[k] + u[k] * end for k in range(3))
            self._segment(out, a, b, -0.02, 0.0, col)
            pos += step


# --------------------------------------------------------------- GL plumbing
GL_FLOAT = 0x1406
GL_TRIANGLES = 0x0004
GL_TRIANGLE_STRIP = 0x0005
GL_DEPTH_TEST = 0x0B71
GL_BLEND = 0x0BE2
GL_LESS = 0x0201
GL_SRC_ALPHA = 0x0302
GL_ONE_MINUS_SRC_ALPHA = 0x0303
GL_ONE = 1
GL_COLOR_BUFFER_BIT = 0x4000
GL_DEPTH_BUFFER_BIT = 0x0100
GL_MULTISAMPLE = 0x809D
GL_SAMPLE_ALPHA_TO_COVERAGE = 0x809E
GL_SAMPLES = 0x80A9


def _surface_format():
    fmt = QSurfaceFormat()
    fmt.setVersion(2, 1)
    fmt.setProfile(QSurfaceFormat.NoProfile)
    fmt.setDepthBufferSize(24)
    fmt.setSamples(4)
    return fmt


# ------------------------------------------------- input shared with _View
class InputMixin:
    """Library drops, Tab / Shift+Tab stepping and Esc — identical for the
    classic and the GL view (mixed in ahead of the Qt base class; needs
    ``self._o``, the owning `Viewer3D`)."""

    def _init_input(self):
        self.setFocusPolicy(Qt.StrongFocus)     # so Tab reaches keyPressEvent
        self.setAcceptDrops(True)               # drop compounds from the library

    def dragEnterEvent(self, event):
        if event.mimeData().hasFormat(dnd.MIME_COMPOUND):
            event.acceptProposedAction()

    def dragMoveEvent(self, event):
        if event.mimeData().hasFormat(dnd.MIME_COMPOUND):
            event.acceptProposedAction()

    def dropEvent(self, event):
        if not event.mimeData().hasFormat(dnd.MIME_COMPOUND):
            return
        kind, value = dnd.decode(event.mimeData().data(dnd.MIME_COMPOUND))
        self._o.compound_dropped.emit(kind, value)
        event.acceptProposedAction()

    def event(self, e):
        """Tab normally moves focus out of the view — claim it instead, so it
        can step the selection from atom to atom."""
        if e.type() == QEvent.KeyPress and e.key() in (Qt.Key_Tab,
                                                       Qt.Key_Backtab):
            back = (e.key() == Qt.Key_Backtab
                    or e.modifiers() & Qt.ShiftModifier)
            self._o.step_selection(-1 if back else 1)
            return True
        return super().event(e)

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Escape:
            self._o.cancel_pick()
        else:
            super().keyPressEvent(event)


class GLView(InputMixin, QOpenGLWidget):
    """The hardware-rendered 3D view. Same interface as `viewer3d._View`."""

    atom_clicked = pyqtSignal(int, bool)    # atom index (-1 = empty), toggle?
    rotated = pyqtSignal()
    atom_moved = pyqtSignal()
    failed = pyqtSignal(str)                # GL is unusable — use the painter

    def __init__(self, owner, parent=None):
        super().__init__(parent)
        self._o = owner
        self._zoom = 1.0
        self._press = None
        self._press_atom = None
        self._mode = None                   # None | "orbit" | "drag"
        self._frozen = None
        self._drag_ppa = 1.0
        self._scene = None
        self._top, self._bottom = rgb(BG_TOP), rgb(BG_BOTTOM)
        self._ready = False
        self._dirty = True                  # geometry buffers are stale
        self._halo_dirty = True             # selection / tilt-cell rings stale
        self._key = None                    # what the current scene was built from
        self._entries = None                # cached legend rows
        self._failed = False
        self._funcs = None
        self._progs = {}
        self._bufs = {}                     # name -> [QOpenGLBuffer, count]
        self._uloc = {}
        self._a2c = False
        self.gl_info = ""
        self.setFormat(_surface_format())
        self.setMinimumSize(360, 320)
        self._init_input()
        self._watchdog = QTimer(self)
        self._watchdog.setSingleShot(True)
        self._watchdog.timeout.connect(self._check_context)

    # ------------------------------------------------------------ public
    def set_background(self, top, bottom=None):
        """Vertical gradient behind the model (colours, hex strings)."""
        self._top = rgb(top)
        self._bottom = rgb(bottom if bottom is not None else top)
        self.update()

    def rebuild(self):
        """Re-lay-out the structure (call after any edit) and repaint.
        The (expensive) vertex arrays are rebuilt only when the geometry
        really changed; a selection or legend toggle just refreshes the
        halo rings."""
        key = self._geom_key()
        if key != self._key or self._scene is None:
            self._build_scene()
            self._key = key
            self._entries = None
            self._dirty = True
        self._halo_dirty = True
        self.update()

    def _geom_key(self):
        """A cheap fingerprint of everything the scene is built from."""
        o = self._o
        m = o.mol
        try:
            return hash((o.style, m.bond, m.rscale, bool(m.poly),
                         tuple(tuple(a) for a in m.atoms),
                         tuple(tuple(b) for b in m.bonds),
                         tuple(tuple(e) for e in (m.shown_edges or ())),
                         tuple(sorted(m.colors.items())),
                         repr(m.notes), tuple(m.cells),
                         repr(sorted(m.tilts.items()))))
        except (TypeError, AttributeError):
            return object()                 # unhashable: always rebuild

    def legend_entries(self):
        if self._entries is None:
            m = self._o.mol
            self._entries = molcolor.legend_entries(m.atoms, m.colors)
        return self._entries

    def _legend(self, w, h):
        """Layout of the colour key for a (w, h) view, or None when off:
        ``(entries, disc radius, font px, width reserved on the right)``."""
        o = self._o
        btn = getattr(o, "legend_btn", None)
        if btn is None or not btn.isChecked():
            return None
        entries = self.legend_entries()
        if not entries:
            return None
        r = max(7.0, min(18.0, min(w, h) * 0.028))
        fpx = max(9, int(r * 1.3))
        font = QFont()
        font.setPixelSize(fpx)
        fm = QFontMetricsF(font)
        tw = max(fm.horizontalAdvance(label) for _e, label, _c in entries)
        return entries, r, fpx, min(r * 2.6 + tw + 24.0, w * 0.45)

    def _box(self, w, h):
        """The part of a (w, h) view the model is fitted into — the legend,
        when shown, keeps a strip on the right to itself."""
        lg = self._legend(w, h)
        return (w - lg[3] if lg else w), h

    def reset_zoom(self):
        self._zoom = 1.0
        self.update()

    @property
    def scene(self):
        if self._scene is None:
            self._build_scene()
        return self._scene

    def _build_scene(self, frozen=None):
        o = self._o
        self._scene = Scene(o.mol, o.style, frozen=frozen)

    def _ppa(self, w=None, h=None):
        w = self.width() if w is None else w
        h = self.height() if h is None else h
        if self._frozen is not None:
            return self._drag_ppa
        o = self._o
        bw, bh = self._box(w, h)
        return self.scene.fit_ppa(bw, bh, o.mol.az, o.mol.el) * self._zoom

    # ------------------------------------------------------ hit testing
    # Atoms and sticks are hit-testable on crystals and scenes too (a click
    # picks a cell / a recolour target); only *moving* an atom is limited to
    # editable structures.
    def _atom_at(self, pos):
        o = self._o
        if not o.mol.atoms:
            return None
        bw, bh = self._box(self.width(), self.height())
        return self.scene.pick_atom(pos.x(), pos.y(), o.mol.az, o.mol.el,
                                    self._ppa(), bw, bh)

    def _bond_at(self, pos):
        o = self._o
        if not o.mol.atoms:
            return None
        if self._atom_at(pos) is not None:
            return None                     # an atom sits on top of the stick
        bw, bh = self._box(self.width(), self.height())
        return self.scene.pick_bond(pos.x(), pos.y(), o.mol.az, o.mol.el,
                                    self._ppa(), bw, bh)

    # ------------------------------------------------------------ mouse
    def contextMenuEvent(self, event):
        """Note what was right-clicked (atom, bond or background), then let
        the window build the matching menu."""
        o = self._o
        atom = self._atom_at(event.pos())
        if atom is not None:
            o.hit = ("atom", atom)
            o.make_primary(atom) if atom in o.selection else o.select_atom(atom)
        else:
            bond = self._bond_at(event.pos())
            o.hit = ("bond", bond) if bond is not None else (None, -1)
        o.context.emit(event.globalPos())

    def wheelEvent(self, event):
        factor = 1.15 if event.angleDelta().y() > 0 else 1 / 1.15
        self._zoom = max(0.2, min(8.0, self._zoom * factor))
        self.update()
        event.accept()

    def mousePressEvent(self, event):
        if event.button() != Qt.LeftButton:
            return
        self.setFocus(Qt.MouseFocusReason)
        self._press = event.pos()
        self._press_atom = self._atom_at(event.pos())
        self._mode = None

    def mouseMoveEvent(self, event):
        if self._press is None:
            return
        delta = event.pos() - self._press
        o = self._o
        if self._mode is None:
            if abs(delta.x()) + abs(delta.y()) < 4:
                return
            if self._press_atom is not None and o.editable:
                self._mode = "drag"
                self._drag_ppa = self._ppa()
                self._frozen = self.scene.freeze()
            elif o.group_at(self._press_atom) is not None:
                # a molecule lying on a surface slides as one piece
                self._mode = "group"
                self._group = o.group_at(self._press_atom)
                o.select_group(self._group)
                self._drag_ppa = self._ppa()
                self._frozen = self.scene.freeze()
            else:
                self._mode = "orbit"
        self._press = event.pos()
        if self._mode == "orbit":
            o.mol.az = (o.mol.az + delta.x() * 0.012) % (2 * math.pi)
            o.mol.el = max(-_HALF, min(_HALF, o.mol.el - delta.y() * 0.012))
            self.update()                   # rotation is a uniform — no rebuild
            self.rotated.emit()
        elif self._mode == "group":
            o.drag_group(self._group, delta.x(), delta.y(), self._drag_ppa,
                         vertical=bool(event.modifiers() & Qt.ShiftModifier))
            self._build_scene(self._frozen)
            self._key = None
            self._dirty = True
            self._halo_dirty = True
            self.update()
            o._show_group_pose()
        else:
            model.drag_atom(o.mol.atoms, self._press_atom, delta.x(),
                            delta.y(), o.mol.az, o.mol.el, self.scene.factor,
                            self._drag_ppa,
                            bonds=o.mol.bonds if o.lock_lengths else None)
            self._build_scene(self._frozen)
            self._key = None
            self._dirty = True
            self._halo_dirty = True
            self.update()
            o.show_geometry(self._press_atom)

    def mouseReleaseEvent(self, event):
        if self._mode == "group":
            self._frozen = None
            self.rebuild()
            self._o.structure_changed.emit()
        elif self._mode == "drag":
            self._frozen = None
            self.rebuild()
            self.atom_moved.emit()
        elif self._mode is None and self._press is not None:
            index = self._press_atom if self._press_atom is not None else -1
            toggle = bool(event.modifiers() & Qt.ControlModifier)
            self.atom_clicked.emit(index, toggle)
        self._press = None
        self._mode = None

    # ------------------------------------------------------ GL lifecycle
    def showEvent(self, event):
        super().showEvent(event)
        if not self._ready and not self._failed:
            self._watchdog.start(2500)

    def _check_context(self):
        if not self._ready and not self._failed:
            self._fail("OpenGL context could not be created")

    def _fail(self, message):
        if self._failed:
            return
        self._failed = True
        self._ready = False
        self.failed.emit(message)

    def initializeGL(self):
        from PyQt5.QtGui import (QOpenGLBuffer, QOpenGLShader,
                                 QOpenGLShaderProgram, QOpenGLVersionProfile)
        try:
            ctx = self.context()
            profile = QOpenGLVersionProfile()
            profile.setVersion(2, 1)
            funcs = ctx.versionFunctions(profile)
            if funcs is None:
                raise RuntimeError("OpenGL 2.1 functions are unavailable")
            funcs.initializeOpenGLFunctions()

            def program(vs, fs, attrs):
                p = QOpenGLShaderProgram()
                if not p.addShaderFromSourceCode(QOpenGLShader.Vertex, vs):
                    raise RuntimeError(f"vertex shader: {p.log()}")
                if not p.addShaderFromSourceCode(QOpenGLShader.Fragment, fs):
                    raise RuntimeError(f"fragment shader: {p.log()}")
                for i, name in enumerate(attrs):
                    p.bindAttributeLocation(name, i)
                if not p.link():
                    raise RuntimeError(f"shader link: {p.log()}")
                return p

            S, C = glshaders.SPHERE_ATTRS, glshaders.CYL_ATTRS
            self._progs = {
                "sphere": program(glshaders.SPHERE_VERTEX,
                                  glshaders.SPHERE_FRAGMENT, S),
                "halo": program(glshaders.SPHERE_VERTEX,
                                glshaders.HALO_FRAGMENT, S),
                "cyl": program(glshaders.CYL_VERTEX,
                               glshaders.CYL_FRAGMENT, C),
                "bg": program(glshaders.BG_VERTEX, glshaders.BG_FRAGMENT,
                              glshaders.BG_ATTRS),
                "poly": program(glshaders.POLY_VERTEX,
                                glshaders.POLY_FRAGMENT,
                                glshaders.POLY_ATTRS),
            }
            for name in ("sphere", "halo", "cell", "cyl", "poly", "bg"):
                buf = QOpenGLBuffer(QOpenGLBuffer.VertexBuffer)
                buf.create()
                self._bufs[name] = [buf, 0]
            quad = array("f", (-1, -1, 1, -1, -1, 1, 1, 1))
            self._upload("bg", quad)
            self._funcs = funcs
            try:
                self._a2c = int(funcs.glGetIntegerv(GL_SAMPLES)) > 0
            except Exception:
                self._a2c = self.format().samples() > 0
            try:
                self.gl_info = str(funcs.glGetString(0x1F01))
            except Exception:
                self.gl_info = ""
            ctx.aboutToBeDestroyed.connect(self._free_gl)
            self._ready = True
            self._dirty = True
        except Exception as exc:                        # any GL trouble
            self._ready = False
            QTimer.singleShot(0, lambda m=str(exc): self._fail(m))

    def _free_gl(self):
        try:
            self.makeCurrent()
            for buf, _n in self._bufs.values():
                buf.destroy()
            self._bufs, self._progs = {}, {}
            self.doneCurrent()
        except Exception:
            pass
        self._ready = False

    def _upload(self, name, data):
        buf = self._bufs[name][0]
        buf.bind()
        raw = data.tobytes()
        buf.allocate(raw, max(len(raw), 4))
        buf.release()
        return len(raw)

    def _sync_gpu(self):
        """Upload fresh vertex arrays where the structure or the rings
        changed."""
        if not (self._dirty or self._halo_dirty):
            return
        o = self._o
        sc = self.scene
        jobs = []
        if self._dirty:
            jobs += [("sphere", sc.sphere_data(), 9),
                     ("cyl", sc.cylinder_data(), 13),
                     ("poly", sc.poly_data(), 9)]
        cell = []
        if o.mol.stacked and hasattr(o, "tilt_cell_atoms"):
            picked = set(o.selection)
            cell = [i for i in o.tilt_cell_atoms() if i not in picked]
        jobs += [("halo", sc.halo_data(o.selection, o.selected), 9),
                 ("cell", sc.halo_data(cell, None, CELL_COLOR), 9)]
        for name, data, stride in jobs:
            self._upload(name, data)
            self._bufs[name][1] = len(data) // stride
        self._dirty = self._halo_dirty = False

    # ------------------------------------------------------------ paint
    def paintGL(self):
        if not self._ready:
            return
        try:
            self._sync_gpu()
            dpr = self.devicePixelRatioF()
            pw, ph = int(self.width() * dpr), int(self.height() * dpr)
            lw = self.width() - self._box(self.width(), self.height())[0]
            self._render(pw, ph, self._ppa() * dpr, int(lw * dpr))
            if (self._o.labels_btn.isChecked() or self.scene.notes
                    or self._legend(self.width(), self.height())):
                p = QPainter(self)
                self._paint_overlay(p, self.width(), self.height(),
                                    self._ppa())
                p.end()
        except Exception as exc:
            self._fail(f"render error: {exc}")

    def _set(self, prog, name, *vals):
        key = (id(prog), name)
        loc = self._uloc.get(key)
        if loc is None:
            loc = self._uloc[key] = prog.uniformLocation(name)
        if loc >= 0:
            prog.setUniformValue(loc, *vals)

    def _common(self, prog, az, el, ppa, pw, ph):
        sc = self.scene
        r, u, f = view_basis(az, el)
        zr = sc.bound * 1.3 + 1.0
        pan = sc._view(az, el)[1]
        self._set(prog, "u_origin", *sc.center)
        self._set(prog, "u_pan", *pan)
        self._set(prog, "u_right", *r)
        self._set(prog, "u_up", *u)
        self._set(prog, "u_fwd", *f)
        self._set(prog, "u_scale", ppa / (pw / 2.0), ppa / (ph / 2.0))
        self._set(prog, "u_zk", 1.0 / zr)
        self._set(prog, "u_ppa", float(ppa))

    def _shading(self, prog):
        sc = self.scene
        fog = tuple((a + b) / 2.0 for a, b in zip(self._top, self._bottom))
        self._set(prog, "u_a2c", 1.0 if self._a2c else 0.0)
        self._set(prog, "u_fog", 0.30)
        self._set(prog, "u_znear", float(sc.bound))
        self._set(prog, "u_zfar", float(-sc.bound))
        self._set(prog, "u_fogcolor", *fog)
        self._set(prog, "u_gloss", 1.0)

    def _draw(self, name, prog, count, stride_floats, attrs):
        """Bind *name*'s buffer to *prog*'s attributes and draw triangles."""
        if not count:
            return
        buf = self._bufs[name][0]
        buf.bind()
        stride = stride_floats * 4
        for loc, (off, size) in enumerate(attrs):
            prog.enableAttributeArray(loc)
            prog.setAttributeBuffer(loc, GL_FLOAT, off * 4, size, stride)
        self._funcs.glDrawArrays(GL_TRIANGLES, 0, count)
        for loc in range(len(attrs)):
            prog.disableAttributeArray(loc)
        buf.release()

    def _render(self, pw, ph, ppa, legend_px=0):
        """Draw the whole scene into the currently bound framebuffer, which
        is (pw x ph) device pixels at *ppa* device pixels per Å; the model
        is confined to the left ``pw - legend_px`` columns."""
        f = self._funcs
        o = self._o
        az, el = o.mol.az, o.mol.el
        f.glViewport(0, 0, pw, ph)
        f.glDisable(GL_DEPTH_TEST)
        f.glDisable(GL_BLEND)
        f.glDepthMask(True)
        f.glColorMask(True, True, True, True)
        f.glClearColor(*self._bottom, 1.0)
        f.glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)
        # -- gradient background
        bg = self._progs["bg"]
        bg.bind()
        self._set(bg, "u_top", *self._top)
        self._set(bg, "u_bottom", *self._bottom)
        buf = self._bufs["bg"][0]
        buf.bind()
        bg.enableAttributeArray(0)
        bg.setAttributeBuffer(0, GL_FLOAT, 0, 2, 8)
        f.glDrawArrays(GL_TRIANGLE_STRIP, 0, 4)
        bg.disableAttributeArray(0)
        buf.release()
        bg.release()
        bpw = max(pw - legend_px, 1)
        f.glViewport(0, 0, bpw, ph)
        pw = bpw
        # -- opaque impostors (alpha carries MSAA coverage; keep dest alpha)
        f.glEnable(GL_DEPTH_TEST)
        f.glDepthFunc(GL_LESS)
        f.glEnable(GL_MULTISAMPLE)
        f.glColorMask(True, True, True, False)
        if self._a2c:
            f.glEnable(GL_SAMPLE_ALPHA_TO_COVERAGE)
        n_sphere = self._bufs["sphere"][1]
        n_cyl = self._bufs["cyl"][1]
        sp = self._progs["sphere"]
        sp.bind()
        self._common(sp, az, el, ppa, pw, ph)
        self._shading(sp)
        self._set(sp, "u_mult", 1.0)
        self._set(sp, "u_zlift", 0.0)
        self._draw("sphere", sp, n_sphere, 9,
                   [(0, 3), (3, 2), (5, 1), (6, 3)])
        sp.release()
        cp = self._progs["cyl"]
        cp.bind()
        self._common(cp, az, el, ppa, pw, ph)
        self._shading(cp)
        self._draw("cyl", cp, n_cyl, 13,
                   [(0, 3), (3, 3), (6, 2), (8, 1), (9, 1), (10, 3)])
        cp.release()
        if self._a2c:
            f.glDisable(GL_SAMPLE_ALPHA_TO_COVERAGE)
        # -- translucent polyhedron faces, then the rings: blended over the
        #    opaque pass, depth-tested but never writing depth
        f.glEnable(GL_BLEND)
        f.glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
        f.glDepthMask(False)
        n_poly = self._bufs["poly"][1]
        if n_poly:
            pp = self._progs["poly"]
            pp.bind()
            self._common(pp, az, el, ppa, pw, ph)
            self._set(pp, "u_alpha", POLY_ALPHA)
            self._draw("poly", pp, n_poly, 9, [(0, 3), (3, 3), (6, 3)])
            pp.release()
        for name, mult, dash in (("halo", 1.7, 0.0), ("cell", 1.32, 1.0)):
            n_halo = self._bufs[name][1]
            if not n_halo:
                continue
            hp = self._progs["halo"]
            hp.bind()
            self._common(hp, az, el, ppa, pw, ph)
            self._set(hp, "u_mult", mult)
            self._set(hp, "u_dash", dash)
            self._set(hp, "u_zlift", 0.9)
            self._draw(name, hp, n_halo, 9,
                       [(0, 3), (3, 2), (5, 1), (6, 3)])
            hp.release()
        f.glDepthMask(True)
        f.glDisable(GL_BLEND)
        f.glColorMask(True, True, True, True)
        f.glDisable(GL_DEPTH_TEST)

    def _paint_overlay(self, painter, w, h, ppa):
        """Everything QPainter draws over the GL image, for a (w, h) target
        (the widget, or an export image) with the model at *ppa* px/Å."""
        painter.setRenderHint(QPainter.Antialiasing)
        painter.setRenderHint(QPainter.TextAntialiasing)
        bw, _bh = self._box(w, h)
        if self._o.labels_btn.isChecked():
            self._paint_labels(painter, bw, h, ppa)
        self._paint_notes(painter, bw, h, ppa)
        self._paint_legend(painter, w, h)

    def _paint_legend(self, painter, w, h):
        """The colour key: a shaded disc per element / site plus its name,
        in the strip `_box` keeps free on the right."""
        lg = self._legend(w, h)
        if not lg:
            return
        entries, r, fpx, lw = lg
        x0 = w - lw + 6.0
        y0 = h * 0.06
        font = QFont(painter.font())
        font.setPixelSize(fpx)
        painter.setFont(font)
        dark_bg = sum(self._top) / 3.0 < 0.45
        ink = QColor("#e8edf2") if dark_bg else QColor("#1a1a1a")
        for i, (el, label, color) in enumerate(entries):
            cy = y0 + r + i * r * 2.8
            if cy + r > h:
                break
            cx = x0 + r
            body = QColor(color)
            grad = QRadialGradient(QPointF(cx - r * 0.35, cy - r * 0.4), r * 1.25)
            grad.setColorAt(0.0, body.lighter(190))
            grad.setColorAt(0.45, body)
            grad.setColorAt(1.0, body.darker(190))
            painter.setPen(QPen(body.darker(230), max(0.8, r * 0.08)))
            painter.setBrush(QBrush(grad))
            painter.drawEllipse(QPointF(cx, cy), r, r)
            painter.setPen(QPen(ink))
            painter.drawText(QPointF(x0 + r * 2.6, cy + fpx * 0.35), label)

    def _paint_notes(self, painter, w, h, ppa):
        """Scene annotations (reaction labels, arrows) over the GL image:
        screen-facing text with a pale halo, and anti-aliased arrows drawn
        like `model.note_specs`."""
        sc = self.scene
        az, el = self._o.mol.az, self._o.mol.el
        for n in sc.notes:
            color = QColor(n.get("color", "#22303c"))
            if n["kind"] == "text":
                self._paint_text_note(painter, n, color, az, el, ppa, w, h)
            else:
                p1 = sc.screen_point(n["p1"], az, el, ppa, w, h)
                p2 = sc.screen_point(n["p2"], az, el, ppa, w, h)
                self._paint_arrow(painter, p1, p2, color,
                                  float(n.get("size", 1.0)) * ppa,
                                  bool(n.get("double")))

    def _paint_text_note(self, painter, n, color, az, el, ppa, w, h):
        text = str(n.get("text", ""))
        if not text:
            return
        px = max(6.0, float(n.get("size", 1.0)) * ppa)
        x, y = self.scene.screen_point(n["pos"], az, el, ppa, w, h)
        font = QFont(painter.font())
        font.setPixelSize(max(7, int(round(px * 0.9))))
        font.setBold(bool(n.get("bold", True)))
        path = QPainterPath()
        fm = QFontMetricsF(font)
        path.addText(x - fm.horizontalAdvance(text) / 2.0,
                     y + (fm.ascent() - fm.descent()) / 2.0, font, text)
        # light ink (over a dark background) gets a dark halo for legibility;
        # dark ink on the light gradient needs none, and a halo would
        # swamp thin glyphs such as "+"
        if color.lightness() >= 150:
            painter.setPen(QPen(QColor(0, 0, 0, 120), max(1.6, px * 0.07),
                                Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin))
            painter.setBrush(Qt.NoBrush)
            painter.drawPath(path)
        painter.setPen(Qt.NoPen)
        painter.setBrush(color)
        painter.drawPath(path)

    @staticmethod
    def _paint_arrow(painter, p1, p2, color, scale, double):
        (x1, y1), (x2, y2) = p1, p2
        dx, dy = x2 - x1, y2 - y1
        length = math.hypot(dx, dy) or 1.0
        px, py = -dy / length, dx / length
        w = max(2.0, scale * 0.10)
        head = min(length * 0.35, w * 5)
        offsets = [-w * 1.3, w * 1.3] if double else [0.0]
        pen = QPen(color, w, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin)
        painter.setPen(pen)
        painter.setBrush(Qt.NoBrush)
        for k, off in enumerate(offsets):
            a = (x1 + px * off, y1 + py * off)
            b = (x2 + px * off, y2 + py * off)
            if k == 1:                       # the return arrow points back
                a, b = b, a
            ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
            painter.drawLine(QPointF(*a), QPointF(*b))
            for sgn in (-1, 1):
                painter.drawLine(
                    QPointF(*b),
                    QPointF(b[0] - ux * head - sgn * uy * head * 0.55,
                            b[1] - uy * head + sgn * ux * head * 0.55))

    def _paint_labels(self, painter, w, h, ppa):
        """Element symbols over the atoms (nearest first wins; skipped for
        huge structures)."""
        sc = self.scene
        o = self._o
        n = len(sc.pos)
        if n == 0 or n > 400:
            return
        pts = sc.screen(o.mol.az, o.mol.el, ppa, w, h)
        for i in sorted(range(n), key=lambda k: pts[k][2]):
            sx, sy, _z = pts[i]
            rp = sc.radii[i] * ppa
            if rp < 5:
                continue
            hit = sc.pick_atom(sx, sy, o.mol.az, o.mol.el, ppa, w, h)
            if hit is not None and hit != i:
                continue                    # another atom is in front
            font = QFont(painter.font())
            font.setPixelSize(int(max(8, min(rp * 0.95, 26))))
            font.setBold(True)
            painter.setFont(font)
            el = sc.elems[i]
            cr, cg, cb = sc.colors[i]
            ink = QColor("#161616" if 0.299 * cr + 0.587 * cg + 0.114 * cb
                         > 0.6 else "#ffffff")
            halo = QColor(0, 0, 0, 90) if ink.lightness() > 128 \
                else QColor(255, 255, 255, 110)
            rect = painter.fontMetrics().boundingRect(el)
            x0 = sx - rect.width() / 2.0
            y0 = sy + rect.height() / 4.0
            painter.setPen(QPen(halo))
            painter.drawText(QPointF(x0 + 1, y0 + 1), el)
            painter.setPen(QPen(ink))
            painter.drawText(QPointF(x0, y0), el)

    # ------------------------------------------------------------ export
    def render_image(self, width, height):
        """Render the current view offscreen at (width, height) pixels into
        a QImage (4x MSAA framebuffer), or None if GL is unavailable."""
        from PyQt5.QtGui import (QOpenGLFramebufferObject,
                                 QOpenGLFramebufferObjectFormat)
        if not self._ready:
            return None
        width, height = max(int(width), 1), max(int(height), 1)
        self.makeCurrent()
        try:
            self._sync_gpu()
            fmt = QOpenGLFramebufferObjectFormat()
            fmt.setAttachment(QOpenGLFramebufferObject.CombinedDepthStencil)
            fmt.setSamples(4)
            fbo = QOpenGLFramebufferObject(width, height, fmt)
            if not fbo.isValid():
                return None
            fbo.bind()
            o = self._o
            bw, bh = self._box(width, height)
            ppa = (self.scene.fit_ppa(bw, bh, o.mol.az, o.mol.el)
                   * self._zoom)
            samples = fbo.format().samples()
            keep, self._a2c = self._a2c, samples > 0
            try:
                self._render(width, height, ppa, int(width - bw))
            finally:
                self._a2c = keep
            fbo.release()
            img = fbo.toImage().convertToFormat(QImage.Format_ARGB32)
            if (self._o.labels_btn.isChecked() or self.scene.notes
                    or self._legend(width, height)):
                p = QPainter(img)
                self._paint_overlay(p, width, height, ppa)
                p.end()
            return img
        finally:
            self.doneCurrent()
