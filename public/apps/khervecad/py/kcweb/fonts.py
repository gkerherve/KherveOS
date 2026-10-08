"""Glyph outlines for the built-in preview's text (QtGui shim).

The desktop lays text out with Qt; here the same Liberation fonts the
OpenSCAD engine renders with are read by fontTools (a Pyodide package)
and each glyph's contours are flattened to polylines, in font units with
y up. Faces are cached.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""

import os

FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "data", "fonts")

FILES = {
    ("sans", False, False): "LiberationSans-Regular.ttf",
    ("sans", True, False): "LiberationSans-Bold.ttf",
    ("sans", False, True): "LiberationSans-Italic.ttf",
    ("sans", True, True): "LiberationSans-BoldItalic.ttf",
    ("serif", False, False): "LiberationSerif-Regular.ttf",
    ("serif", True, False): "LiberationSerif-Bold.ttf",
    ("serif", False, True): "LiberationSerif-Italic.ttf",
    ("serif", True, True): "LiberationSerif-BoldItalic.ttf",
    ("mono", False, False): "LiberationMono-Regular.ttf",
    ("mono", True, False): "LiberationMono-Bold.ttf",
    ("mono", False, True): "LiberationMono-Italic.ttf",
    ("mono", True, True): "LiberationMono-BoldItalic.ttf",
}

#: curve flattening: segments per quadratic / cubic piece
STEPS = 8


def kind_of(family: str) -> str:
    f = (family or "").lower()
    if any(k in f for k in ("mono", "courier", "consolas", "typewriter")):
        return "mono"
    if any(k in f for k in ("serif", "times", "georgia", "roman")) and \
            "sans" not in f:
        return "serif"
    return "sans"


class _Face:
    def __init__(self, path):
        from fontTools.ttLib import TTFont
        self.font = TTFont(path, lazy=True)
        self.glyphs = self.font.getGlyphSet()
        self.cmap = self.font.getBestCmap() or {}
        head = self.font["head"]
        hhea = self.font["hhea"]
        self.units_per_em = float(head.unitsPerEm)
        self.ascent = float(hhea.ascent)
        self.descent = float(hhea.descent)
        self._contours = {}
        self._adv = {}

    def _name(self, ch):
        return self.cmap.get(ord(ch)) or self.cmap.get(ord("?")) or ".notdef"

    def advance(self, ch):
        if ch not in self._adv:
            name = self._name(ch)
            try:
                self._adv[ch] = float(self.font["hmtx"][name][0])
            except KeyError:
                self._adv[ch] = self.units_per_em * 0.5
        return self._adv[ch]

    def contours(self, ch):
        if ch not in self._contours:
            from fontTools.pens.basePen import BasePen

            out = []

            class Flatten(BasePen):
                def _moveTo(self, pt):
                    out.append([pt])

                def _lineTo(self, pt):
                    out[-1].append(pt)

                def _qCurveToOne(self, p1, p2):
                    p0 = out[-1][-1]
                    for i in range(1, STEPS + 1):
                        t = i / STEPS
                        a, b, c = (1 - t) ** 2, 2 * (1 - t) * t, t * t
                        out[-1].append((a * p0[0] + b * p1[0] + c * p2[0],
                                        a * p0[1] + b * p1[1] + c * p2[1]))

                def _curveToOne(self, p1, p2, p3):
                    p0 = out[-1][-1]
                    for i in range(1, STEPS + 1):
                        t = i / STEPS
                        a = (1 - t) ** 3
                        b = 3 * (1 - t) ** 2 * t
                        c = 3 * (1 - t) * t * t
                        d = t ** 3
                        out[-1].append(
                            (a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
                             a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))

                def _closePath(self):
                    if out and out[-1] and out[-1][0] != out[-1][-1]:
                        out[-1].append(out[-1][0])

            name = self._name(ch)
            if name in self.glyphs:
                self.glyphs[name].draw(Flatten(self.glyphs))
            self._contours[ch] = [c for c in out if len(c) >= 3]
        return self._contours[ch]


_FACES = {}


def face(family="", bold=False, italic=False):
    key = (kind_of(family), bool(bold), bool(italic))
    if key not in _FACES:
        path = os.path.join(FONT_DIR, FILES[key])
        if not os.path.exists(path):
            from kcweb.bridge import fetch_font
            path = fetch_font(FILES[key])
        _FACES[key] = _Face(path)
    return _FACES[key]
