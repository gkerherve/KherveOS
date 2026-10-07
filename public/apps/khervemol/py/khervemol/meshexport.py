"""3D mesh export (Qt-free): STL, 3MF, OBJ, PLY and GLB.

A structure becomes a triangle mesh — a UV sphere per atom, a cylinder per
bond (two halves, each in its own atom's colour; double and triple bonds as
two or three parallel tubes) and, if asked, the unit-cell outline as thin
rods. Positions are scaled to millimetres (``scale`` mm per ångström) and
the view's spread, style, colours and cell outline are honoured, so the file
looks like the screen. Bonds are made at least ``min_stick_mm`` thick so a
print is not made of threads.

* **STL** — binary, geometry only: the format every slicer takes.
* **3MF** — the modern printing format: millimetres and one material per
  colour, so a multi-colour printer keeps the element colours.
* **OBJ** (+ ``.mtl``) — colour materials; Blender, Fusion, CAD tools.
* **PLY** — per-vertex colours; MeshLab and point-cloud tools.
* **GLB** — binary glTF 2.0: browsers, AR viewers, game engines.

Spheres and rods overlap where they meet; that is fine for slicers (they
union overlapping shells) and for viewers.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

import json
import math
import os
import struct
import zipfile
from xml.sax.saxutils import escape

from . import elements, model, molcolor
from .crystal import BuildError

FORMATS = {
    "stl": ("STL", "3D printing — binary, geometry only"),
    "3mf": ("3MF", "3D printing with one material per colour"),
    "obj": ("OBJ", "Wavefront OBJ + MTL colours (Blender, CAD)"),
    "ply": ("PLY", "Polygon file with vertex colours (MeshLab)"),
    "glb": ("GLB", "glTF 2.0 binary (browsers, AR, game engines)"),
}
STYLES = ("ball_and_stick", "space_filling", "sticks")
#: sphere longitudes for each quality; latitudes are half of it
QUALITY = {"low": 10, "medium": 16, "high": 28}
#: refuse meshes past this many triangles (a slicer or viewer chokes)
MAX_TRIANGLES = 3_000_000
#: Bondi van der Waals radii (Å) for the space-filling style
_VDW = {"H": 1.20, "He": 1.40, "Li": 1.82, "Be": 1.53, "B": 1.92, "C": 1.70,
        "N": 1.55, "O": 1.52, "F": 1.47, "Ne": 1.54, "Na": 2.27, "Mg": 1.73,
        "Al": 1.84, "Si": 2.10, "P": 1.80, "S": 1.80, "Cl": 1.75, "Ar": 1.88,
        "K": 2.75, "Ca": 2.31, "Fe": 2.04, "Co": 2.00, "Ni": 1.63,
        "Cu": 1.40, "Zn": 1.39, "Br": 1.85, "Kr": 2.02, "I": 1.98,
        "Xe": 2.16, "Cs": 3.43, "Au": 1.66, "Ag": 1.72, "Pt": 1.75,
        "Pb": 2.02, "Ti": 2.00}
STICK_RADIUS = {"ball_and_stick": 0.10, "space_filling": 0.0, "sticks": 0.13}
STICK_BALL = 0.16
CELL_COLOR = "#3a3f46"


# --------------------------------------------------------------- the mesh
class Mesh:
    """Vertices (mm), triangles (vertex index triples) and a colour per
    triangle drawn from a small palette of ``#rrggbb`` strings."""

    def __init__(self):
        self.verts = []
        self.tris = []
        self.tri_color = []
        self.palette = []
        self._pal = {}
        self._sphere = {}

    def colour(self, hexstr):
        key = str(hexstr).lower()
        if key not in self._pal:
            self._pal[key] = len(self.palette)
            self.palette.append(key)
        return self._pal[key]

    def _add(self, verts, tris, color):
        base = len(self.verts)
        self.verts.extend(verts)
        c = self.colour(color)
        for a, b, d in tris:
            self.tris.append((a + base, b + base, d + base))
            self.tri_color.append(c)

    def _unit_sphere(self, seg):
        got = self._sphere.get(seg)
        if got is None:
            nlon, nlat = seg, max(3, seg // 2)
            verts = [(0.0, 0.0, 1.0)]
            for i in range(1, nlat):
                th = math.pi * i / nlat
                for j in range(nlon):
                    ph = 2 * math.pi * j / nlon
                    verts.append((math.sin(th) * math.cos(ph),
                                  math.sin(th) * math.sin(ph), math.cos(th)))
            verts.append((0.0, 0.0, -1.0))
            tris = []
            south = len(verts) - 1
            for j in range(nlon):                      # top cap
                tris.append((0, 1 + j, 1 + (j + 1) % nlon))
            for i in range(nlat - 2):                  # bands
                r0, r1 = 1 + i * nlon, 1 + (i + 1) * nlon
                for j in range(nlon):
                    a, b = r0 + j, r0 + (j + 1) % nlon
                    c, d = r1 + j, r1 + (j + 1) % nlon
                    tris += [(a, c, b), (b, c, d)]
            last = 1 + (nlat - 2) * nlon
            for j in range(nlon):                      # bottom cap
                tris.append((south, last + (j + 1) % nlon, last + j))
            got = self._sphere[seg] = (verts, tris)
        return got

    def add_sphere(self, centre, radius, color, seg):
        unit, tris = self._unit_sphere(seg)
        cx, cy, cz = centre
        self._add([(cx + radius * x, cy + radius * y, cz + radius * z)
                   for x, y, z in unit], tris, color)

    def add_cylinder(self, p, q, radius, color, seg):
        """A closed tube from *p* to *q*."""
        axis = [q[i] - p[i] for i in range(3)]
        length = math.sqrt(sum(v * v for v in axis))
        if length < 1e-9:
            return
        w = [v / length for v in axis]
        ref = (1.0, 0.0, 0.0) if abs(w[0]) < 0.9 else (0.0, 1.0, 0.0)
        u = _cross(w, ref)
        n = math.sqrt(sum(v * v for v in u))
        u = [v / n for v in u]
        v_ = _cross(w, u)
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            ring.append([math.cos(a) * u[i] + math.sin(a) * v_[i]
                         for i in range(3)])
        verts = [tuple(p[i] + radius * r[i] for i in range(3)) for r in ring]
        verts += [tuple(q[i] + radius * r[i] for i in range(3)) for r in ring]
        verts += [tuple(p), tuple(q)]
        pc, qc = 2 * seg, 2 * seg + 1
        tris = []
        for k in range(seg):
            k2 = (k + 1) % seg
            tris += [(k, k2, k + seg), (k2, k2 + seg, k + seg),
                     (pc, k2, k), (qc, k + seg, k2 + seg)]
        self._add(verts, tris, color)

    def normals(self):
        """Smooth per-vertex unit normals (for GLB / PLY viewers)."""
        acc = [[0.0, 0.0, 0.0] for _ in self.verts]
        for a, b, c in self.tris:
            n = _face_normal(self.verts[a], self.verts[b], self.verts[c],
                             unit=False)
            for i in (a, b, c):
                for d in range(3):
                    acc[i][d] += n[d]
        out = []
        for n in acc:
            ln = math.sqrt(sum(v * v for v in n)) or 1.0
            out.append((n[0] / ln, n[1] / ln, n[2] / ln))
        return out


def _cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]]


def _face_normal(a, b, c, unit=True):
    u = [b[i] - a[i] for i in range(3)]
    v = [c[i] - a[i] for i in range(3)]
    n = _cross(u, v)
    if unit:
        ln = math.sqrt(sum(x * x for x in n)) or 1.0
        n = [x / ln for x in n]
    return n


# ------------------------------------------------------------ the builder
def ball_radius(element, style, rscale):
    if style == "space_filling":
        return _VDW.get(element, 1.5 * elements.covalent_radius(element))
    if style == "sticks":
        return STICK_BALL
    return elements.radius(element) * rscale


def build_mesh(mol, style="ball_and_stick", scale=10.0, quality="medium",
               cell=False, min_stick_mm=1.6):
    """The `Mesh` of *mol*. *scale* is millimetres per ångström; *cell*
    adds the unit-cell outline; *min_stick_mm* is the thinnest bond."""
    if not mol.atoms:
        raise BuildError("There is nothing to export: the structure is empty.")
    if style not in STYLES:
        raise BuildError(f"style is one of {', '.join(STYLES)}.")
    if not 0.05 <= scale <= 1000:
        raise BuildError("scale runs from 0.05 to 1000 mm per ångström.")
    seg = QUALITY.get(quality) or int(quality)
    factor = 1.0 if style == "space_filling" else float(mol.bond or 1.0)
    coloured = molcolor.apply_colors(mol.atoms, mol.colors)
    edges = mol.shown_edges if cell else None
    atoms, edges = model._spread(coloured, edges, factor, None)
    per_sphere = 2 * seg * max(3, seg // 2)
    est = len(atoms) * per_sphere + len(mol.bonds) * 4 * seg * 2
    if est > MAX_TRIANGLES:
        raise BuildError(
            f"About {est:,} triangles is too many for one file: use lower "
            "quality, a smaller structure, or the sticks style.")
    mesh = Mesh()
    # centre on the x, y middle and stand it on z = 0: ready for a print bed
    xs = [a[1] for a in atoms]
    ys = [a[2] for a in atoms]
    rad = [ball_radius(a[0], style, mol.rscale) for a in atoms]
    zlo = min(a[3] - r for a, r in zip(atoms, rad))
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2

    def P(x, y, z):
        return ((x - cx) * scale, (y - cy) * scale, (z - zlo) * scale)

    pos = [P(a[1], a[2], a[3]) for a in atoms]
    cols = [molcolor.atom_color(a, None) for a in atoms]
    stick = STICK_RADIUS[style]
    r_stick = max(stick * scale, min_stick_mm / 2) if stick else 0.0
    for a, p, r, c in zip(atoms, pos, rad, cols):
        if style == "space_filling" or r > 0:
            mesh.add_sphere(p, max(r * scale, 0.05), c, seg)
    if r_stick:
        for i, j, order in mol.bonds:
            _bond(mesh, pos[i], pos[j], cols[i], cols[j], order, r_stick, seg)
    if edges:
        rod = max(0.12 * scale * 0.3, min_stick_mm / 3)
        for e in edges:
            a, b = P(*e[0]), P(*e[1])
            mesh.add_cylinder(a, b, rod, CELL_COLOR, max(6, seg // 2))
    return mesh


def _bond(mesh, p, q, c1, c2, order, r, seg):
    """One bond: 1-3 parallel tubes, each in two halves."""
    axis = [q[i] - p[i] for i in range(3)]
    ln = math.sqrt(sum(v * v for v in axis))
    if ln < 1e-9:
        return
    w = [v / ln for v in axis]
    ref = (0.0, 0.0, 1.0) if abs(w[2]) < 0.9 else (1.0, 0.0, 0.0)
    off = _cross(w, ref)
    n = math.sqrt(sum(v * v for v in off)) or 1.0
    off = [v / n for v in off]
    if order <= 1:
        offsets, rr = [0.0], r
    elif order == 2:
        offsets, rr = [-r * 0.85, r * 0.85], r * 0.62
    else:
        offsets, rr = [-r * 1.05, 0.0, r * 1.05], r * 0.52
    mid = tuple((p[i] + q[i]) / 2 for i in range(3))
    for d in offsets:
        sh = [d * off[i] for i in range(3)]
        a = tuple(p[i] + sh[i] for i in range(3))
        m = tuple(mid[i] + sh[i] for i in range(3))
        b = tuple(q[i] + sh[i] for i in range(3))
        sides = max(6, seg // 2 + 2)
        mesh.add_cylinder(a, m, rr, c1, sides)
        mesh.add_cylinder(m, b, rr, c2, sides)


# --------------------------------------------------------------- writers
def _rgb(hexstr):
    h = hexstr.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def write_stl(path, mesh, ascii_=False, name="KherveMol"):
    if ascii_:
        with open(path, "w", encoding="ascii") as f:
            f.write(f"solid {name}\n")
            for a, b, c in mesh.tris:
                n = _face_normal(mesh.verts[a], mesh.verts[b], mesh.verts[c])
                f.write(f"facet normal {n[0]:.6e} {n[1]:.6e} {n[2]:.6e}\n"
                        " outer loop\n")
                for i in (a, b, c):
                    v = mesh.verts[i]
                    f.write(f"  vertex {v[0]:.6e} {v[1]:.6e} {v[2]:.6e}\n")
                f.write(" endloop\nendfacet\n")
            f.write(f"endsolid {name}\n")
        return
    with open(path, "wb") as f:
        f.write(struct.pack("<80s", b"KherveMol binary STL (mm)"))
        f.write(struct.pack("<I", len(mesh.tris)))
        for a, b, c in mesh.tris:
            va, vb, vc = mesh.verts[a], mesh.verts[b], mesh.verts[c]
            n = _face_normal(va, vb, vc)
            f.write(struct.pack("<12fH", *n, *va, *vb, *vc, 0))


def write_obj(path, mesh, name="KherveMol"):
    base = os.path.splitext(path)[0]
    mtl = base + ".mtl"
    with open(mtl, "w", encoding="ascii") as f:
        for k, col in enumerate(mesh.palette):
            r, g, b = (x / 255 for x in _rgb(col))
            f.write(f"newmtl m{k}\nKd {r:.4f} {g:.4f} {b:.4f}\n"
                    f"Ka {r * .3:.4f} {g * .3:.4f} {b * .3:.4f}\n"
                    "Ks 0.35 0.35 0.35\nNs 60\n\n")
    with open(path, "w", encoding="ascii") as f:
        f.write(f"# {name} (units: mm)\nmtllib {os.path.basename(mtl)}\n"
                f"o {name}\n")
        for v in mesh.verts:
            f.write(f"v {v[0]:.5f} {v[1]:.5f} {v[2]:.5f}\n")
        order = sorted(range(len(mesh.tris)), key=lambda t: mesh.tri_color[t])
        current = None
        for t in order:
            if mesh.tri_color[t] != current:
                current = mesh.tri_color[t]
                f.write(f"usemtl m{current}\n")
            a, b, c = mesh.tris[t]
            f.write(f"f {a + 1} {b + 1} {c + 1}\n")
    return mtl


def write_ply(path, mesh):
    """ASCII PLY with a colour on every vertex (each triangle owns its
    three vertices, so colours do not bleed across the palette)."""
    verts, cols, faces = [], [], []
    for (a, b, c), ci in zip(mesh.tris, mesh.tri_color):
        rgb = _rgb(mesh.palette[ci])
        base = len(verts)
        for i in (a, b, c):
            verts.append(mesh.verts[i])
            cols.append(rgb)
        faces.append((base, base + 1, base + 2))
    with open(path, "w", encoding="ascii") as f:
        f.write("ply\nformat ascii 1.0\ncomment KherveMol (units: mm)\n"
                f"element vertex {len(verts)}\nproperty float x\n"
                "property float y\nproperty float z\nproperty uchar red\n"
                "property uchar green\nproperty uchar blue\n"
                f"element face {len(faces)}\n"
                "property list uchar int vertex_indices\nend_header\n")
        for v, c in zip(verts, cols):
            f.write(f"{v[0]:.5f} {v[1]:.5f} {v[2]:.5f} {c[0]} {c[1]} {c[2]}\n")
        for a, b, c in faces:
            f.write(f"3 {a} {b} {c}\n")


def write_3mf(path, mesh, name="KherveMol"):
    """3MF core spec: one object, millimetres, a base material per colour
    and a material index on every triangle."""
    rows = [f'<base name="c{k}" displaycolor="{col.upper()}FF"/>'
            for k, col in enumerate(mesh.palette)]
    verts = "".join(f'<vertex x="{v[0]:.5f}" y="{v[1]:.5f}" z="{v[2]:.5f}"/>'
                    for v in mesh.verts)
    tris = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}" p1="{ci}"/>'
                   for (a, b, c), ci in zip(mesh.tris, mesh.tri_color))
    model_xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<model unit="millimeter" xml:lang="en-US" '
        'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
        f'<metadata name="Title">{escape(name)}</metadata>'
        '<metadata name="Application">KherveMol</metadata>'
        f'<resources><basematerials id="1">{"".join(rows)}</basematerials>'
        f'<object id="2" type="model" pid="1" pindex="0"><mesh>'
        f'<vertices>{verts}</vertices><triangles>{tris}</triangles>'
        '</mesh></object></resources>'
        '<build><item objectid="2"/></build></model>')
    content_types = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/'
        'content-types"><Default Extension="rels" ContentType="application/'
        'vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="model" ContentType="application/vnd.ms-package.'
        '3dmanufacturing-3dmodel+xml"/></Types>')
    rels = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/'
        '2006/relationships"><Relationship Target="/3D/3dmodel.model" '
        'Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/'
        '01/3dmodel"/></Relationships>')
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", rels)
        z.writestr("3D/3dmodel.model", model_xml)


def write_glb(path, mesh, name="KherveMol"):
    """Binary glTF 2.0: one primitive per palette colour (metres, so the
    millimetre mesh is scaled by 0.001)."""
    normals = mesh.normals()
    pos_bytes, nrm_bytes, idx_bytes = bytearray(), bytearray(), bytearray()
    for v in mesh.verts:
        pos_bytes += struct.pack("<3f", v[0] * 1e-3, v[2] * 1e-3, -v[1] * 1e-3)
    for n in normals:                       # glTF is y-up: (x, y, z) -> (x, z, -y)
        nrm_bytes += struct.pack("<3f", n[0], n[2], -n[1])
    groups = {}
    for t, ci in zip(mesh.tris, mesh.tri_color):
        groups.setdefault(ci, []).append(t)
    views, accessors, prims, mats = [], [], [], []
    xs = [v[0] * 1e-3 for v in mesh.verts]
    ys = [v[2] * 1e-3 for v in mesh.verts]
    zs = [-v[1] * 1e-3 for v in mesh.verts]
    views.append({"buffer": 0, "byteOffset": 0, "byteLength": len(pos_bytes),
                  "target": 34962})
    accessors.append({"bufferView": 0, "componentType": 5126,
                      "count": len(mesh.verts), "type": "VEC3",
                      "min": [min(xs), min(ys), min(zs)],
                      "max": [max(xs), max(ys), max(zs)]})
    views.append({"buffer": 0, "byteOffset": len(pos_bytes),
                  "byteLength": len(nrm_bytes), "target": 34962})
    accessors.append({"bufferView": 1, "componentType": 5126,
                      "count": len(mesh.verts), "type": "VEC3"})
    offset = len(pos_bytes) + len(nrm_bytes)
    for ci, tris in sorted(groups.items()):
        raw = b"".join(struct.pack("<3I", a, c, b) for a, b, c in tris)
        views.append({"buffer": 0, "byteOffset": offset + len(idx_bytes),
                      "byteLength": len(raw), "target": 34963})
        accessors.append({"bufferView": len(views) - 1, "componentType": 5125,
                          "count": len(tris) * 3, "type": "SCALAR"})
        idx_bytes += raw
        r, g, b = (x / 255 for x in _rgb(mesh.palette[ci]))
        mats.append({"pbrMetallicRoughness": {
            "baseColorFactor": [r, g, b, 1.0], "metallicFactor": 0.05,
            "roughnessFactor": 0.45}})
        prims.append({"attributes": {"POSITION": 0, "NORMAL": 1},
                      "indices": len(accessors) - 1,
                      "material": len(mats) - 1})
    blob = bytes(pos_bytes) + bytes(nrm_bytes) + bytes(idx_bytes)
    blob += b"\0" * (-len(blob) % 4)
    doc = {"asset": {"version": "2.0", "generator": "KherveMol"},
           "scene": 0, "scenes": [{"nodes": [0]}],
           "nodes": [{"mesh": 0, "name": name}],
           "meshes": [{"name": name, "primitives": prims}],
           "materials": mats, "accessors": accessors, "bufferViews": views,
           "buffers": [{"byteLength": len(blob)}]}
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + 8
                            + len(blob)))
        f.write(struct.pack("<I4s", len(js), b"JSON") + js)
        f.write(struct.pack("<I4s", len(blob), b"BIN\0") + blob)


def export(mol, path, fmt=None, **options):
    """Write *mol* as a mesh; the format comes from *fmt* or the extension.
    Returns ``{"path", "format", "triangles", "vertices", "colours"}``."""
    ext = (fmt or os.path.splitext(path)[1].lstrip(".")).lower()
    if ext not in FORMATS:
        raise BuildError(f"Unknown 3D format '{ext}': "
                         + ", ".join(FORMATS) + ".")
    ascii_ = options.pop("ascii", False)
    mesh = build_mesh(mol, **options)
    if not path.lower().endswith("." + ext):
        path += "." + ext
    try:
        if ext == "stl":
            write_stl(path, mesh, ascii_=ascii_)
        elif ext == "3mf":
            write_3mf(path, mesh)
        elif ext == "obj":
            write_obj(path, mesh)
        elif ext == "ply":
            write_ply(path, mesh)
        else:
            write_glb(path, mesh)
    except OSError as exc:
        raise BuildError(f"Cannot write {path}: {exc.strerror or exc}")
    return {"path": path, "format": ext, "triangles": len(mesh.tris),
            "vertices": len(mesh.verts), "colours": len(mesh.palette)}
