"""Draws the icons of the technique apps (KherveTGA, KherveBET, KherveUVVis, KherveFTIR,
KherveRaman) as SVG tiles in public/icons/apps/. Each tile has its own glyph: the
technique's signature curve.

    python3 tools/make_technique_icons.py
"""
import math
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "icons" / "apps"


def gauss(x, c, w):
    return math.exp(-((x - c) / w) ** 2)


def lorentz(x, c, w):
    return 1 / (1 + ((x - c) / w) ** 2)


def path_of(points):
    return "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in points)


def tile(c1, c2, glyph, uid):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <linearGradient id="g{uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{c1}"/>
      <stop offset="1" stop-color="{c2}"/>
    </linearGradient>
    <linearGradient id="h{uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".22"/>
      <stop offset=".5" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="240" height="240" rx="56" fill="url(#g{uid})"/>
  <rect x="8" y="8" width="240" height="120" rx="56" fill="url(#h{uid})"/>
  <rect x="9" y="9" width="238" height="238" rx="55" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="2"/>
  {glyph}
</svg>
'''


def line(d, width=12, color="#fff", opacity=1, dash=None):
    extra = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<path d="{d}" fill="none" stroke="{color}" stroke-opacity="{opacity}" stroke-width="{width}" '
            f'stroke-linecap="round" stroke-linejoin="round"{extra}/>')


def tga():
    # Mass falls in three steps while the temperature ramp climbs (dashed).
    steps = "M46 78 H94 L106 118 H150 L162 158 H210"
    ramp = "M46 206 L210 58"
    return line(ramp, 6, opacity=.45, dash="10 10") + line(steps, 13)


def bet():
    # A type IV isotherm: the adsorption curve and, above it, the hysteresis loop.
    pts = []
    for i in range(60):
        p = i / 59
        x = 48 + 160 * p
        y = 196 - 128 * (p ** 3.2 * 0.6 + p ** 9 * 0.4)
        pts.append((x, y))
    desorb = []
    for i in range(60):
        p = 1 - i / 59
        x = 48 + 160 * p
        y = 196 - 128 * (p ** 3.2 * 0.6 + p ** 9 * 0.4) - 14 * math.sin(math.pi * min(1, max(0, (p - 0.2) / 0.8))) ** 2
        desorb.append((x, y))
    return line(path_of(pts), 12) + line(path_of(desorb), 7, opacity=.7)


def uvvis():
    # Absorbance bands, filled, with a spectrum strip (violet → red) under them.
    xs = [x / 2 for x in range(96, 414, 2)]
    ys = []
    for x in xs:
        a = 1.0 * gauss(x, 96 + 40, 12) + 0.7 * gauss(x, 96 + 88, 18) + 0.35 * gauss(x, 96 + 150, 20)
        ys.append((x, 190 - 110 * a))
    fill = path_of(ys + [(xs[-1], 196), (xs[0], 196)]) + " Z"
    band = f'<path d="{fill}" fill="#fff" fill-opacity=".22"/>' + line(path_of(ys), 10)
    colours = ["#7c3aed", "#2563eb", "#22c55e", "#eab308", "#f97316", "#dc2626"]
    strip = "".join(
        f'<rect x="{56 + i * 27}" y="206" width="27" height="10" fill="{c}"/>' for i, c in enumerate(colours))
    return band + strip


def ftir():
    # Transmittance: the baseline sits high, the bands dip down.
    xs = [x / 2 for x in range(96, 416, 2)]
    pts = []
    for x in xs:
        dip = 0.6 * gauss(x, 120, 9) + 0.8 * gauss(x, 176, 10) + 0.45 * gauss(x, 232, 8) + 0.25 * gauss(x, 150, 6)
        pts.append((x, 84 + 112 * dip))
    return line(path_of(pts), 11) + line("M48 84 H208", 4, opacity=.35, dash="6 8")


def raman():
    # Sharp Raman lines on a dark baseline, with the laser beam coming in from the top left.
    xs = [x / 2 for x in range(96, 420, 1)]
    pts = []
    for x in xs:
        a = 1.0 * lorentz(x, 128, 5) + 0.7 * lorentz(x, 178, 4) + 0.9 * lorentz(x, 212, 6)
        pts.append((x, 196 - 128 * a * 0.9))
    beam = line("M30 36 L112 118", 9, color="#d9ffe6", opacity=.85, dash="2 14")
    return beam + line(path_of(pts), 8)


ICONS = {
    "khervetga": ("#f59e4b", "#b8561a", tga),
    "khervebet": ("#4fbe9f", "#1d6f5b", bet),
    "kherveuvvis": ("#8b6cf6", "#4a2fb4", uvvis),
    "kherveftir": ("#38bdf8", "#1765a0", ftir),
    "kherveraman": ("#4ade80", "#15803d", raman),
}

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (c1, c2, glyph) in ICONS.items():
        (OUT / f"{name}.svg").write_text(tile(c1, c2, glyph(), name), encoding="utf-8")
        print("wrote", name)
