"""Upscale the wallpaper's source picture with Real-ESRGAN x4plus (AI super-resolution).

    <python with onnxruntime, numpy, Pillow> tools/upscale_wallpaper.py <model.onnx> <picture> <out.png> [scale]

The model is Qualcomm AI Hub's ONNX export of Real-ESRGAN-x4plus (BSD-3), not kept
in this repo: real_esrgan_x4plus-onnx-float.zip from
https://huggingface.co/qualcomm/Real-ESRGAN-x4plus (release_assets.json).
It takes 128×128 tiles and returns them 4× larger; tiles overlap and are
feathered together. The 4× result is resized to `scale` (default 3) with
Lanczos. Then build the wallpaper with:  tools/make_wallpaper.py <out.png> … --upscaled
"""
import sys
import time

import numpy as np
import onnxruntime as ort
from PIL import Image

model_path, src_path, out_path = sys.argv[1:4]
scale = float(sys.argv[4]) if len(sys.argv) > 4 else 3.0
TILE, PAD, UP = 128, 16, 4          # model tile, overlap on each side, model factor
STEP = TILE - 2 * PAD

providers = [p for p in ("CoreMLExecutionProvider", "CPUExecutionProvider") if p in ort.get_available_providers()]
session = ort.InferenceSession(model_path, providers=providers)
name = session.get_inputs()[0].name

img = np.asarray(Image.open(src_path).convert("RGB"), dtype=np.float32) / 255.0
H, W, _ = img.shape
# Reflect-pad so every tile is whole and edges get context.
ny, nx = -(-H // STEP), -(-W // STEP)
padded = np.pad(img, ((PAD, ny * STEP - H + PAD), (PAD, nx * STEP - W + PAD), (0, 0)), mode="reflect")
out = np.zeros(((ny * STEP + 2 * PAD) * UP, (nx * STEP + 2 * PAD) * UP, 3), np.float32)
weight = np.zeros(out.shape[:2] + (1,), np.float32)
# Feathering: full weight in the middle, a linear ramp across the overlaps.
ramp = np.minimum(np.arange(TILE * UP) + 0.5, TILE * UP - np.arange(TILE * UP) - 0.5) / (2 * PAD * UP)
ramp = np.clip(ramp, 0.02, 1.0)
mask = (ramp[:, None] * ramp[None, :])[..., None].astype(np.float32)

t0 = time.time()
for j in range(ny):
    for i in range(nx):
        y, x = j * STEP, i * STEP
        tile = padded[y:y + TILE, x:x + TILE].transpose(2, 0, 1)[None]
        res = session.run(None, {name: np.ascontiguousarray(tile)})[0][0].transpose(1, 2, 0)
        out[y * UP:(y + TILE) * UP, x * UP:(x + TILE) * UP] += res * mask
        weight[y * UP:(y + TILE) * UP, x * UP:(x + TILE) * UP] += mask
    print(f"row {j + 1}/{ny}  {time.time() - t0:.0f}s", flush=True)
out = out / np.maximum(weight, 1e-6)
out = out[PAD * UP:(PAD + H) * UP, PAD * UP:(PAD + W) * UP]
big = Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8))
if scale != UP:
    big = big.resize((round(W * scale), round(H * scale)), Image.LANCZOS)
big.save(out_path)
print("saved", big.size, f"in {time.time() - t0:.0f}s")
