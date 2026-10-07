"""Build KherveOS's wallpaper from the user's Ktools Advanced Tech Lab picture.

    ../KherveBook/.venv/bin/python tools/make_wallpaper.py tools/wallpaper/ktools-tech-lab.jpg public/wallpapers/ktools-tech-lab.webp 2

(Any Python with Pillow. Pass --upscaled for a picture already enlarged elsewhere.)

The picture is enlarged (Lanczos + a light unsharp mask, unless it is already
upscaled), then gets a strip of floor below it: the floor's own fading
reflection, without the caption, so the caption sits above the Dock.
"""
import sys
from PIL import Image, ImageFilter

src_path, out_path = sys.argv[1], sys.argv[2]
scale = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0
pre_upscaled = "--upscaled" in sys.argv

src = Image.open(src_path).convert("RGB")
if pre_upscaled:
    k = src.width / 1376                   # the picture was 1376×768
else:
    src = src.resize((round(src.width * scale), round(src.height * scale)), Image.LANCZOS)
    src = src.filter(ImageFilter.UnsharpMask(radius=1.6, percent=55, threshold=2))
    k = scale
W, H = src.size
EXT = round(90 * k)                        # floor added below, so the caption clears the Dock
DESK = (5, 7, 6)                           # KherveOS's desktop colour
# Cover the caption with the floor just above it before reflecting, so it is not mirrored.
clean = src.copy()
x0, y0, x1, y1 = (round(v * k) for v in (520, 738, 830, 767))
clean.paste(src.crop((x0, 2 * y0 - y1, x1, y0)), (x0, y0))
strip = clean.crop((0, H - EXT, W, H)).transpose(Image.FLIP_TOP_BOTTOM).filter(ImageFilter.GaussianBlur(2.5 * k))
mask = Image.new("L", (W, EXT))
mask.putdata([int(235 * (1 - y / (EXT - 1)) ** 1.5) for y in range(EXT) for _ in range(W)])
floor = Image.composite(strip, Image.new("RGB", (W, EXT), DESK), mask)
out = Image.new("RGB", (W, H + EXT), DESK)
out.paste(src, (0, 0))
out.paste(floor, (0, H))
out.save(out_path, "WEBP", quality=94, method=6)
print(out.size)
