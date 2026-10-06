"""Recolour a wallpaper by turning its hues, e.g. the red fist into green.

    python3 -m pip install pillow numpy
    python3 tools/recolor_wallpaper.py public/wallpapers/ktool-fist.webp public/wallpapers/ktool-fist-green.webp 140 0.92

Arguments: source, destination, hue turn in degrees (red → green ≈ 120–140,
red → blue ≈ 220), and an optional saturation factor.
"""

import sys

import numpy as np
from PIL import Image


def main() -> None:
    src, dst, degrees = sys.argv[1], sys.argv[2], float(sys.argv[3])
    saturation = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
    img = Image.open(src).convert("RGB")
    h, s, v = (np.asarray(c, dtype=np.float32) for c in img.convert("HSV").split())
    h = (h + degrees / 360 * 256) % 256
    s = np.clip(s * saturation, 0, 255)
    out = Image.merge("HSV", [Image.fromarray(x.astype(np.uint8), "L") for x in (h, s, v)]).convert("RGB")
    out.save(dst, "WEBP", quality=90, method=6)
    print("wrote", dst, out.size)


if __name__ == "__main__":
    main()
