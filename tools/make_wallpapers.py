"""Draws KherveOS's green science wallpapers (public/wallpapers/*.webp), 2560 × 1440.

    python3 tools/make_wallpapers.py            (needs Pillow and numpy)

Every picture is drawn here, with code: a graphene lattice, a molecule, the periodic
table, equations with a curve, and a DNA helix. The palette is the Kherve Green one.
"""
import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent.parent / "public" / "wallpapers"
W, H = 2560, 1440
S = 2  # drawn at 2× and reduced: smooth lines and circles
GREEN = (110, 240, 150)
DIM = (60, 150, 90)
FONT = "/System/Library/Fonts/Supplemental/Times New Roman.ttf"
SANS = "/System/Library/Fonts/Supplemental/Arial.ttf"
MATH = "/System/Library/Fonts/Supplemental/Times New Roman.ttf"


def font(path, size):
    for p in (path, "/System/Library/Fonts/Helvetica.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(p, size * S)
        except OSError:
            continue
    return ImageFont.load_default()


def background(seed_tint=(0, 1.0, 0.45)):
    """Near-black green with a soft light in the middle, darker at the corners."""
    yy, xx = np.mgrid[0:H * S, 0:W * S].astype(np.float32)
    cx, cy = W * S * 0.5, H * S * 0.45
    d = np.sqrt(((xx - cx) / (W * S)) ** 2 + ((yy - cy) / (H * S)) ** 2)
    light = np.clip(1 - d * 1.6, 0, 1) ** 1.6
    base = np.stack([
        4 + 14 * light * seed_tint[0],
        7 + 52 * light * seed_tint[1],
        5 + 22 * light * seed_tint[2],
    ], axis=-1)
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB")


def glow_on(base, layer, radius, strength=1.0):
    """Add a blurred copy of `layer` onto `base` (screen-like light)."""
    blur = layer.filter(ImageFilter.GaussianBlur(radius * S))
    if strength != 1.0:
        blur = blur.point(lambda v: min(255, int(v * strength)))
    return ImageChops.add(base, blur.convert("RGB"))


def finish(img, name):
    img = img.resize((W, H), Image.LANCZOS)
    # A gentle vignette, so the edges stay dark where the menu bar and Dock are.
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    v = 1 - 0.35 * (((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2) / 2
    arr = np.asarray(img).astype(np.float32) * np.clip(v, 0.55, 1)[..., None]
    out = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    out.save(OUT / f"{name}.webp", "WEBP", quality=88, method=6)
    print("wrote", name)


# ------------------------------------------------------------------ graphene
def graphene():
    base = background((0.0, 1.0, 0.5))
    lines = Image.new("L", (W * S, H * S), 0)
    nodes = Image.new("L", (W * S, H * S), 0)
    ld, nd = ImageDraw.Draw(lines), ImageDraw.Draw(nodes)
    a = 92 * S  # bond length
    dx, dy = a * math.sqrt(3), a * 1.5
    rng = random.Random(7)
    for row in range(-2, int(H * S / dy) + 3):
        for col in range(-2, int(W * S / dx) + 3):
            x = col * dx + (row % 2) * dx / 2
            y = row * dy + H * S * 0.42
            # A sheet that curves up toward the top: a sine wave in height, drawn as a bend.
            bend = 60 * S * math.sin((x / (W * S)) * math.pi * 1.2) * (1 - (y / (H * S)))
            py = y - bend
            pts = []
            for k in range(6):
                ang = math.radians(60 * k + 30)
                pts.append((x + a * math.cos(ang) * 0.95 * (1 if True else 0), py + a * math.sin(ang) * 0.95))
            for k in range(6):
                p, q = pts[k], pts[(k + 1) % 6]
                if rng.random() > 0.08:
                    ld.line([p, q], fill=255, width=5 * S)
            for p in pts:
                if 0 < p[0] < W * S and 0 < p[1] < H * S and rng.random() > 0.15:
                    r = (7 if rng.random() > 0.8 else 5) * S
                    nd.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=255)
    img = base
    img = glow_on(img, lines, 6, 1.1)
    img = Image.composite(Image.new("RGB", img.size, (120, 255, 165)), img, lines.point(lambda v: int(v * 0.85)))
    img = glow_on(img, nodes, 10, 1.4)
    img = Image.composite(Image.new("RGB", img.size, (200, 255, 215)), img, nodes.point(lambda v: int(v * 0.9)))
    finish(img, "graphene")


# ------------------------------------------------------------------ molecules
def molecule():
    base = background((0.0, 0.9, 0.4))
    rng = random.Random(11)
    atoms = []
    for _ in range(64):
        # Atoms in a loose cluster on the right, with depth (z) for the shading.
        x = rng.gauss(0.68, 0.16) * W * S
        y = rng.gauss(0.5, 0.2) * H * S
        z = rng.uniform(-1, 1)
        r = rng.choice([22, 28, 34, 44]) * S
        atoms.append((x, y, z, r))
    layer = Image.new("L", (W * S, H * S), 0)
    ld = ImageDraw.Draw(layer)
    for i, (x1, y1, z1, _) in enumerate(atoms):
        for j, (x2, y2, z2, _) in enumerate(atoms):
            if j <= i:
                continue
            if math.hypot(x1 - x2, y1 - y2) < 190 * S:
                ld.line([(x1, y1), (x2, y2)], fill=int(120 + 80 * (z1 + z2) / 2), width=7 * S)
    img = glow_on(base, layer, 4, 1.0)
    img = Image.composite(Image.new("RGB", img.size, (90, 220, 130)), img, layer)
    spheres = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    for x, y, z, r in sorted(atoms, key=lambda t: t[2]):
        shade = 0.55 + 0.45 * (z + 1) / 2
        ball = Image.new("RGBA", (int(2 * r), int(2 * r)), (0, 0, 0, 0))
        bd = ImageDraw.Draw(ball)
        for k in range(12, 0, -1):
            t = k / 12
            c = tuple(int(v * shade * (0.25 + 0.75 * (1 - t))) for v in (70, 230, 130))
            off = (1 - t) * r * 0.35
            bd.ellipse([r - r * t - off * 0.2 + off * 0.3, r - r * t - off * 0.2, r + r * t - off * 0.2 + off * 0.3, r + r * t - off * 0.2], fill=c + (255,))
        spheres.alpha_composite(ball, (int(x - r), int(y - r)))
    img = img.convert("RGBA")
    img.alpha_composite(spheres)
    finish(img.convert("RGB"), "molecules")


# ------------------------------------------------------------------ periodic table
# Z, symbol, name, standard atomic weight (a bracketed one: the most stable isotope's mass number)
_DATA = """
H Hydrogen 1.008|He Helium 4.0026|Li Lithium 6.94|Be Beryllium 9.0122|B Boron 10.81|C Carbon 12.011|N Nitrogen 14.007
O Oxygen 15.999|F Fluorine 18.998|Ne Neon 20.180|Na Sodium 22.990|Mg Magnesium 24.305|Al Aluminium 26.982
Si Silicon 28.085|P Phosphorus 30.974|S Sulfur 32.06|Cl Chlorine 35.45|Ar Argon 39.948|K Potassium 39.098
Ca Calcium 40.078|Sc Scandium 44.956|Ti Titanium 47.867|V Vanadium 50.942|Cr Chromium 51.996|Mn Manganese 54.938
Fe Iron 55.845|Co Cobalt 58.933|Ni Nickel 58.693|Cu Copper 63.546|Zn Zinc 65.38|Ga Gallium 69.723
Ge Germanium 72.630|As Arsenic 74.922|Se Selenium 78.971|Br Bromine 79.904|Kr Krypton 83.798|Rb Rubidium 85.468
Sr Strontium 87.62|Y Yttrium 88.906|Zr Zirconium 91.224|Nb Niobium 92.906|Mo Molybdenum 95.95|Tc Technetium [98]
Ru Ruthenium 101.07|Rh Rhodium 102.91|Pd Palladium 106.42|Ag Silver 107.87|Cd Cadmium 112.41|In Indium 114.82
Sn Tin 118.71|Sb Antimony 121.76|Te Tellurium 127.60|I Iodine 126.90|Xe Xenon 131.29|Cs Caesium 132.91
Ba Barium 137.33|La Lanthanum 138.91|Ce Cerium 140.12|Pr Praseodymium 140.91|Nd Neodymium 144.24
Pm Promethium [145]|Sm Samarium 150.36|Eu Europium 151.96|Gd Gadolinium 157.25|Tb Terbium 158.93
Dy Dysprosium 162.50|Ho Holmium 164.93|Er Erbium 167.26|Tm Thulium 168.93|Yb Ytterbium 173.05|Lu Lutetium 174.97
Hf Hafnium 178.49|Ta Tantalum 180.95|W Tungsten 183.84|Re Rhenium 186.21|Os Osmium 190.23|Ir Iridium 192.22
Pt Platinum 195.08|Au Gold 196.97|Hg Mercury 200.59|Tl Thallium 204.38|Pb Lead 207.2|Bi Bismuth 208.98
Po Polonium [209]|At Astatine [210]|Rn Radon [222]|Fr Francium [223]|Ra Radium [226]|Ac Actinium [227]
Th Thorium 232.04|Pa Protactinium 231.04|U Uranium 238.03|Np Neptunium [237]|Pu Plutonium [244]
Am Americium [243]|Cm Curium [247]|Bk Berkelium [247]|Cf Californium [251]|Es Einsteinium [252]
Fm Fermium [257]|Md Mendelevium [258]|No Nobelium [259]|Lr Lawrencium [266]|Rf Rutherfordium [267]
Db Dubnium [268]|Sg Seaborgium [269]|Bh Bohrium [270]|Hs Hassium [277]|Mt Meitnerium [278]
Ds Darmstadtium [281]|Rg Roentgenium [282]|Cn Copernicium [285]|Nh Nihonium [286]|Fl Flerovium [289]
Mc Moscovium [290]|Lv Livermorium [293]|Ts Tennessine [294]|Og Oganesson [294]
"""
ELEMENTS = {}
for _i, _item in enumerate(_DATA.replace("\n", "|").split("|"), start=1):
    if _item.strip():
        _sym, _name, _mass = _item.split()
        ELEMENTS[len(ELEMENTS) + 1] = (_sym, _name, _mass)
assert len(ELEMENTS) == 118


_ORDER = "1s 2s 2p 3s 3p 4s 3d 4p 5s 4d 5p 6s 4f 5d 6p 7s 5f 6d 7p".split()
_CAP = {"s": 2, "p": 6, "d": 10, "f": 14}
# Ground states that break the filling order (changed orbitals only)
_EXCEPT = {
    24: {"4s": 1, "3d": 5}, 29: {"4s": 1, "3d": 10}, 41: {"5s": 1, "4d": 4}, 42: {"5s": 1, "4d": 5},
    44: {"5s": 1, "4d": 7}, 45: {"5s": 1, "4d": 8}, 46: {"5s": 0, "4d": 10}, 47: {"5s": 1, "4d": 10},
    57: {"4f": 0, "5d": 1}, 58: {"4f": 1, "5d": 1}, 64: {"4f": 7, "5d": 1}, 78: {"6s": 1, "5d": 9},
    79: {"6s": 1, "5d": 10}, 89: {"5f": 0, "6d": 1}, 90: {"5f": 0, "6d": 2}, 91: {"5f": 2, "6d": 1},
    92: {"5f": 3, "6d": 1}, 93: {"5f": 4, "6d": 1}, 96: {"5f": 7, "6d": 1}, 103: {"6d": 0, "7p": 1},
}
_NOBLE = {2: "He", 10: "Ne", 18: "Ar", 36: "Kr", 54: "Xe", 86: "Rn"}


def config(z):
    """Electron configuration as [(orbital, electrons)], behind a noble-gas core: ('[Ar]', None), ('3d', 5)..."""
    occ, left = {}, z
    for o in _ORDER:
        occ[o] = min(_CAP[o[1]], left)
        left -= occ[o]
    occ.update(_EXCEPT.get(z, {}))
    core = max([n for n in _NOBLE if n < z], default=0)
    out = [("[%s]" % _NOBLE[core], None)] if core else []
    skip = 0
    if core:  # drop the orbitals of the core (they hold exactly `core` electrons)
        for o in _ORDER:
            skip += _CAP[o[1]]
            occ[o] = 0 if skip <= core else occ[o]
            if skip >= core:
                break
    for o in sorted((o for o in occ if occ[o]), key=lambda o: (int(o[0]), "spdf".index(o[1]))):
        out.append((o, occ[o]))
    return out


def draw_config(td, cx, y, z, width, fill):
    """Centre the configuration at (cx, y) with superscript electron counts, shrunk to fit `width`."""
    parts = config(z)
    size = 15
    while True:
        fn, fs = font(SANS, size), font(SANS, max(6, round(size * 0.65)))
        segs = []
        for o, n in parts:
            segs.append((o, fn, 0))
            if n is not None:
                segs.append((str(n), fs, -size * 0.45 * S))
            segs.append((" ", fn, 0))
        total = sum(td.textlength(t, font=f) for t, f, _ in segs[:-1])
        if total <= width or size <= 7:
            break
        size -= 1
    x = cx - total / 2
    for t, f, dy in segs[:-1]:
        td.text((x, y + dy), t, font=f, fill=fill, anchor="ls")
        x += td.textlength(t, font=f)


def _position(z):
    """(row, column) of element z: columns 0-17 are the groups; rows 0-6 the periods, 7 and 8 the f-block."""
    if z == 1:
        return 0, 0
    if z == 2:
        return 0, 17
    if z <= 18:  # periods 2 and 3: two s columns, then groups 13-18
        first = 3 if z <= 10 else 11
        k = z - first
        return (1 if z <= 10 else 2), (k if k < 2 else k + 10)
    if z <= 54:  # periods 4 and 5: all eighteen groups
        return (3 if z <= 36 else 4), (z - 19 if z <= 36 else z - 37)
    if 57 <= z <= 71:
        return 7, z - 55  # lanthanides, under groups 3-17
    if 89 <= z <= 103:
        return 8, z - 87  # actinides
    if z <= 86:  # period 6 without the f-block: Cs, Ba, then Hf ... Rn
        return 5, (z - 55 if z <= 56 else z - 69)
    return 6, (z - 87 if z <= 88 else z - 101)  # period 7


def periodic():
    base = background((0.0, 1.0, 0.35))
    lines = Image.new("L", (W * S, H * S), 0)
    text = Image.new("L", (W * S, H * S), 0)
    ld, td = ImageDraw.Draw(lines), ImageDraw.Draw(text)
    cell = 98 * S
    gap = 6 * S
    pitch = cell + gap
    x0 = W * S * 0.5 - (18 * pitch - gap) / 2
    y0 = H * S * 0.5 - (9.5 * pitch - gap) / 2 - 24 * S  # a little above the middle: the Dock is below
    f_sym, f_num, f_name, f_mass = font(SANS, 38), font(SANS, 16), font(SANS, 14), font(SANS, 13)

    def box(col, y):
        return x0 + col * pitch, y

    def row_y(row):
        return y0 + row * pitch + (0.5 * pitch if row >= 7 else 0)  # a gap before the f-block rows

    for z, (sym, name, mass) in ELEMENTS.items():
        row, col = _position(z)
        x, y = box(col, row_y(row))
        ld.rectangle([x, y, x + cell, y + cell], outline=255, width=3 * S)
        cx = x + cell / 2
        td.text((x + 8 * S, y + 5 * S), str(z), font=f_num, fill=160)
        td.text((cx, y + cell * 0.39), sym, font=f_sym, fill=255, anchor="mm")  # centred in the box
        draw_config(td, cx, y + cell * 0.70, z, cell - 8 * S, 190)
        td.text((cx, y + cell * 0.865), mass, font=f_mass, fill=140, anchor="mm")
    # Markers where the f-block belongs: "57-71" and "89-103" in group 3 of periods 6 and 7.
    for row, label in ((5, "57\u201371"), (6, "89\u2013103")):
        x, y = box(2, row_y(row))
        ld.rectangle([x, y, x + cell, y + cell], outline=255, width=3 * S)
        td.text((x + cell / 2, y + cell * 0.5), label, font=font(SANS, 24), fill=200, anchor="mm")
    img = glow_on(base, lines, 3, 0.9)
    img = Image.composite(Image.new("RGB", img.size, (100, 240, 140)), img, lines.point(lambda v: int(v * 0.55)))
    img = glow_on(img, text, 2, 0.8)
    img = Image.composite(Image.new("RGB", img.size, (150, 255, 180)), img, text.point(lambda v: int(v * 0.8)))
    finish(img, "periodic")


# ------------------------------------------------------------------ equations
def formulas():
    base = background((0.0, 0.85, 0.35))
    layer = Image.new("L", (W * S, H * S), 0)
    d = ImageDraw.Draw(layer)
    f_big, f_mid = font(MATH, 120), font(MATH, 58)
    items = [
        ("E = mc²", 0.12, 0.2, f_big), ("ΔG = ΔH − TΔS", 0.55, 0.14, f_mid), ("pV = nRT", 0.6, 0.33, f_big),
        ("λ = h / p", 0.1, 0.55, f_mid), ("d²ψ/dx² + k²ψ = 0", 0.08, 0.78, f_mid), ("CO2 + H2O -> H2CO3", 0.46, 0.9, f_mid),
        ("∫∫∫ ρ dV", 0.82, 0.62, f_mid),
    ]
    for s, x, y, f in items:
        d.text((x * W * S, y * H * S), s, font=f, fill=255)
    # A normal curve, with its axes.
    x0, y0, w, h = 0.35 * W * S, 0.55 * H * S, 0.36 * W * S, 0.34 * H * S
    d.line([(x0, y0 + h), (x0 + w, y0 + h)], fill=255, width=4 * S)
    d.line([(x0, y0 + h), (x0, y0)], fill=255, width=4 * S)
    pts = []
    for i in range(241):
        t = (i / 240) * 8 - 4
        pts.append((x0 + (t + 4) / 8 * w, y0 + h - math.exp(-t * t / 2) * h * 0.9))
    d.line(pts, fill=255, width=6 * S, joint="curve")
    img = glow_on(base, layer, 5, 1.1)
    img = Image.composite(Image.new("RGB", img.size, (120, 245, 160)), img, layer.point(lambda v: int(v * 0.8)))
    finish(img, "formulas")


# ------------------------------------------------------------------ DNA
def dna():
    base = background((0.0, 1.0, 0.45))
    strands = Image.new("L", (W * S, H * S), 0)
    rungs = Image.new("L", (W * S, H * S), 0)
    nodes = Image.new("L", (W * S, H * S), 0)
    sd, rd, nd = ImageDraw.Draw(strands), ImageDraw.Draw(rungs), ImageDraw.Draw(nodes)
    cx, amp, period = 0.5 * W * S, 260 * S, 760 * S
    for step in range(0, int(H * S) + 40 * S, 14 * S):
        t = step / period * 2 * math.pi
        y = step
        xa, za = cx + amp * math.cos(t), math.sin(t)
        xb, zb = cx + amp * math.cos(t + math.pi), math.sin(t + math.pi)
        if step % (56 * S) == 0:
            rd.line([(xa, y), (xb, y)], fill=int(90 + 60 * (za + zb) / 2 + 60), width=5 * S)
        for x, z in ((xa, za), (xb, zb)):
            r = (7 + 4 * (z + 1) / 2) * S
            nd.ellipse([x - r, y - r, x + r, y + r], fill=int(160 + 80 * (z + 1) / 2))
    for k in (0, 1):
        pts = []
        for step in range(0, int(H * S) + 40 * S, 6 * S):
            t = step / period * 2 * math.pi + k * math.pi
            pts.append((cx + amp * math.cos(t), step))
        sd.line(pts, fill=255, width=7 * S, joint="curve")
    img = glow_on(base, strands, 6, 1.0)
    img = glow_on(img, rungs, 4, 0.9)
    img = Image.composite(Image.new("RGB", img.size, (110, 240, 150)), img, rungs.point(lambda v: int(v * 0.7)))
    img = glow_on(img, nodes, 6, 1.2)
    img = Image.composite(Image.new("RGB", img.size, (170, 255, 190)), img, nodes.point(lambda v: int(v * 0.85)))
    finish(img, "dna")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    graphene()
    molecule()
    periodic()
    formulas()
    dna()
