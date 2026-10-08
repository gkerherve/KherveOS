"""Draw KherveCalc's app icon in the classic Ktools style.

A rounded tile with a soft top-to-bottom gradient and gloss, the short name
"KCalc" in bold white at the top and a white pictogram below: a calculator
with a Kherve-green display showing an integral sign, and its keys.

Usage:  python3 tools/make_khervecalc_icon.py   (Pillow)
Writes public/icons/apps/khervecalc.png (256 x 256).
"""

import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons", "apps", "khervecalc.png")
S = 1024  # drawn at 4x, then scaled down
TOP = (61, 68, 77)  # graphite
BOTTOM = (19, 22, 26)  # near black
GREEN = (61, 220, 132)
GREEN_DEEP = (34, 179, 87)
WHITE = (255, 255, 255)


def font(size, names=("Arial Bold.ttf", "Arial Rounded Bold.ttf")):
    for n in names:
        for d in ("/System/Library/Fonts/Supplemental", "/Library/Fonts", "/usr/share/fonts/truetype/dejavu"):
            p = os.path.join(d, n)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def gradient(w, h, top, bottom):
    g = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / (h - 1)
        g.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return g.resize((w, h))


def main():
    margin = 40
    radius = 200
    tile = (margin, margin, S - margin, S - margin)

    # shadow
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((tile[0], tile[1] + 18, tile[2], tile[3] + 18), radius, fill=(0, 0, 0, 120))
    img = shadow.filter(ImageFilter.GaussianBlur(22))

    # tile with gradient
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(tile, radius, fill=255)
    img.paste(gradient(S, S, TOP, BOTTOM), (0, 0), mask)

    # a green glow at the bottom, like the KherveOS look
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((150, 760, 874, 1120), fill=GREEN_DEEP + (110,))
    glow = glow.filter(ImageFilter.GaussianBlur(90))
    glow_masked = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    glow_masked.paste(glow, (0, 0), Image.composite(glow.split()[3], Image.new("L", (S, S), 0), mask))
    img = Image.alpha_composite(img, glow_masked)

    # gloss on the upper half
    gloss = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gloss)
    for i in range(380):
        a = round(46 * (1 - i / 380) ** 1.6)
        gd.line((tile[0], tile[1] + i, tile[2], tile[1] + i), fill=(255, 255, 255, a))
    gloss_mask = Image.composite(mask, Image.new("L", (S, S), 0), mask)
    img = Image.alpha_composite(img, Image.composite(gloss, Image.new("RGBA", (S, S), (0, 0, 0, 0)), gloss_mask))

    # thin bright rim
    rim = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(rim).rounded_rectangle(tile, radius, outline=(255, 255, 255, 46), width=6)
    img = Image.alpha_composite(img, rim)

    d = ImageDraw.Draw(img)

    # the name
    f = font(206)
    label = "KCalc"
    w = d.textlength(label, font=f)
    d.text(((S - w) / 2 + 3, 128 + 5), label, font=f, fill=(0, 0, 0, 90))
    d.text(((S - w) / 2, 128), label, font=f, fill=WHITE)

    # the pictogram: a calculator
    bx0, by0, bx1, by1 = 330, 420, 694, 900
    d.rounded_rectangle((bx0, by0, bx1, by1), 46, outline=WHITE, width=26)
    # display
    sx0, sy0, sx1, sy1 = bx0 + 50, by0 + 50, bx1 - 50, by0 + 170
    d.rounded_rectangle((sx0, sy0, sx1, sy1), 16, fill=GREEN)
    sf = font(110, ("Arial Unicode.ttf", "Arial Bold.ttf"))
    sym = "∫"
    sw = d.textlength(sym, font=sf)
    d.text((sx1 - sw - 26, sy0 - 6), sym, font=sf, fill=(10, 40, 22))
    d.text((sx0 + 22, sy0 + 26), "π", font=font(80), fill=(10, 40, 22))
    # keys: 3 columns x 3 rows, the bottom-right one green (EXE)
    kx0, ky0 = bx0 + 56, sy1 + 44
    kw, kh, gx, gy = 66, 50, 30, 28
    for r in range(3):
        for c in range(3):
            x = kx0 + c * (kw + gx)
            y = ky0 + r * (kh + gy)
            fill = GREEN if (r, c) == (2, 2) else WHITE
            d.rounded_rectangle((x, y, x + kw, y + kh), 12, fill=fill)

    out = img.resize((256, 256), Image.LANCZOS)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    out.save(OUT)
    print("wrote", os.path.normpath(OUT))


if __name__ == "__main__":
    main()
