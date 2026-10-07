"""PyQt5.QtGui stand-in (see PyQt5/__init__.py): a working ``QColor`` —
parsing, channels, ``name()``, ``lighter``/``darker`` and HSL lightness,
following Qt's own arithmetic — and inert placeholders for the rest.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""

import colorsys

from ._stub import module_getattr

_NAMED = {
    "black": (0, 0, 0), "white": (255, 255, 255), "red": (255, 0, 0),
    "green": (0, 128, 0), "blue": (0, 0, 255), "yellow": (255, 255, 0),
    "gray": (160, 160, 164), "grey": (160, 160, 164),
    "darkgray": (169, 169, 169), "lightgray": (211, 211, 211),
    "orange": (255, 165, 0), "transparent": (0, 0, 0),
}


def _clamp(v):
    return max(0, min(255, int(round(v))))


class QColor:
    def __init__(self, *args):
        self._valid = True
        self._rgba = (0, 0, 0, 255)
        if not args:
            self._valid = False
            return
        a = args[0]
        if isinstance(a, QColor):
            self._rgba, self._valid = a._rgba, a._valid
        elif isinstance(a, str):
            self._parse(a)
        elif len(args) >= 3:
            alpha = args[3] if len(args) > 3 else 255
            self._rgba = tuple(_clamp(x) for x in (args[0], args[1], args[2],
                                                   alpha))
        elif isinstance(a, (tuple, list)) and len(a) >= 3:
            self._rgba = (_clamp(a[0]), _clamp(a[1]), _clamp(a[2]),
                          _clamp(a[3]) if len(a) > 3 else 255)
        else:
            self._valid = False

    def _parse(self, text):
        s = text.strip()
        low = s.lower()
        if low in _NAMED:
            r, g, b = _NAMED[low]
            self._rgba = (r, g, b, 0 if low == "transparent" else 255)
            return
        if s.startswith("#"):
            h = s[1:]
            try:
                if len(h) == 3:
                    self._rgba = tuple(int(c * 2, 16) for c in h) + (255,)
                    return
                if len(h) == 6:
                    self._rgba = (int(h[0:2], 16), int(h[2:4], 16),
                                  int(h[4:6], 16), 255)
                    return
                if len(h) == 8:                    # #aarrggbb (Qt order)
                    self._rgba = (int(h[2:4], 16), int(h[4:6], 16),
                                  int(h[6:8], 16), int(h[0:2], 16))
                    return
            except ValueError:
                pass
        self._valid = False

    # ---------------------------------------------------------- channels
    def isValid(self):
        return self._valid

    def red(self):
        return self._rgba[0]

    def green(self):
        return self._rgba[1]

    def blue(self):
        return self._rgba[2]

    def alpha(self):
        return self._rgba[3]

    def setAlpha(self, a):
        self._rgba = self._rgba[:3] + (_clamp(a),)

    def redF(self):
        return self._rgba[0] / 255.0

    def greenF(self):
        return self._rgba[1] / 255.0

    def blueF(self):
        return self._rgba[2] / 255.0

    def alphaF(self):
        return self._rgba[3] / 255.0

    def getRgb(self):
        return self._rgba

    def name(self, *args):
        r, g, b, _a = self._rgba
        return f"#{r:02x}{g:02x}{b:02x}"

    # --------------------------------------------------------- lightness
    def lightness(self):
        r, g, b, _a = self._rgba
        return (max(r, g, b) + min(r, g, b)) // 2

    def lightnessF(self):
        r, g, b, _a = self._rgba
        return (max(r, g, b) + min(r, g, b)) / 2.0 / 255.0

    def _from_hsv(self, h, s, v):
        r, g, b = colorsys.hsv_to_rgb(h, s, v)
        out = QColor(r * 255.0, g * 255.0, b * 255.0, self._rgba[3])
        return out

    def lighter(self, factor=150):
        if factor <= 0:
            return QColor(self)
        if factor < 100:
            return self.darker(10000 / factor)
        r, g, b, _a = self._rgba
        h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
        v = v * factor / 100.0
        if v > 1.0:
            s = max(0.0, s - (v - 1.0))
            v = 1.0
        return self._from_hsv(h, s, v)

    def darker(self, factor=200):
        if factor <= 0:
            return QColor(self)
        if factor < 100:
            return self.lighter(10000 / factor)
        r, g, b, _a = self._rgba
        h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
        return self._from_hsv(h, s, v * 100.0 / factor)

    def __eq__(self, other):
        return isinstance(other, QColor) and other._rgba == self._rgba

    def __hash__(self):
        return hash(self._rgba)

    def __repr__(self):
        return f"QColor({self.name()})"


def __getattr__(name):
    return module_getattr(name)
