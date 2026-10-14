"""Convert the Quaternius GLB characters into KherveCAD My Library parts.

Each character: rest pose (skinned with the skeleton's bind), metres -> mm,
glTF Y-up -> CAD Z-up (facing -Y), standing on z = 0, centred on x/y; split
into one binary STL per colour (material colour, or the texture atlas
sampled per triangle); a .kcad Object of colour nodes around stl_import
nodes, with a library block (title, description, tags).
usage: python3 -I tools/export_characters_to_khervecad.py public/models/quaternius "$HOME/Documents/KherveCAD Library/Characters & monsters"
"""

import io
import json
import os
import struct
import sys
import uuid
import datetime

import numpy as np
from PIL import Image

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

CHARACTERS = [
    # file, title, height m, description, tags
    ("soldier", "SWAT soldier", 1.8, "An armed tactical officer in helmet, visor and body armour.", ["soldier", "swat", "police", "military", "person"]),
    ("king", "King in armour", 1.9, "A crowned king in plate armour with a cape.", ["king", "knight", "medieval", "royal", "person"]),
    ("skeleton", "Skeleton warrior", 1.85, "An undead skeleton warrior with a helmet.", ["skeleton", "undead", "monster", "halloween"]),
    ("orc", "Orc", 1.95, "A green orc brute with tusks, belt and hair.", ["orc", "monster", "fantasy"]),
    ("giant", "Giant", 2.5, "A hulking stone-skinned giant.", ["giant", "monster", "fantasy"]),
    ("yeti", "Blocky yeti", 2.4, "A chunky blocky yeti with yellow fur and horns.", ["yeti", "monster", "snow", "creature"]),
    ("enemy-large", "Green monster", 2.3, "A tall green crested monster with long arms.", ["monster", "brute", "creature"]),
    ("demon", "Blocky demon", 2.2, "A blocky horned demon with fangs.", ["demon", "monster", "fantasy"]),
    ("blue-demon", "Blue demon", 2.2, "A blue horned demon with a tail.", ["demon", "monster", "fantasy"]),
    ("winged-demon", "Winged imp", 1.8, "A small red flying imp with bat wings, horns and a halo.", ["demon", "flying", "monster", "imp"]),
    ("wolf", "Wolf", 1.05, "A grey wolf standing on all fours, 2 m long.", ["wolf", "animal", "dog", "creature"]),
    ("goblin", "Goblin", 1.2, "A small green goblin.", ["goblin", "monster", "fantasy"]),
    ("ghost", "Ghost", 1.7, "A purple floating ghost with claws.", ["ghost", "spirit", "halloween", "monster"]),
    ("ghost-skull", "Ghost skull", 1.5, "A floating skull on a purple ghost body.", ["skull", "ghost", "halloween", "monster"]),
    ("dragon", "Little dragon", 1.9, "A small winged dragon.", ["dragon", "flying", "monster", "fantasy"]),
    ("zombie", "Zombie", 1.8, "A green zombie in torn shorts, arms reaching out.", ["zombie", "undead", "monster", "halloween"]),
    ("zombie2", "Zombie (blocky)", 1.8, "A chunky low-poly zombie.", ["zombie", "undead", "monster", "halloween"]),
]


def read_glb(path):
    b = open(path, "rb").read()
    assert b[:4] == b"glTF"
    n = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + n])
    off = 20 + n
    blen = struct.unpack("<I", b[off:off + 4])[0]
    return j, b[off + 8:off + 8 + blen]


def accessor(j, binb, i):
    a = j["accessors"][i]
    bv = j["bufferViews"][a["bufferView"]]
    dt = np.dtype(CT[a["componentType"]])
    nc = NC[a["type"]]
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride", 0) or dt.itemsize * nc
    count = a["count"]
    raw = np.frombuffer(binb, dtype=np.uint8, count=stride * (count - 1) + dt.itemsize * nc, offset=start)
    rows = np.lib.stride_tricks.as_strided(raw, shape=(count, dt.itemsize * nc), strides=(stride, 1))
    arr = np.frombuffer(rows.copy().tobytes(), dtype=dt).reshape(count, nc).astype(np.float64)
    if a.get("normalized"):
        arr /= float(np.iinfo(dt).max)
    return arr


def trs(node):
    if "matrix" in node:
        return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
    t = np.array(node.get("translation", [0, 0, 0]), dtype=np.float64)
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    s = np.array(node.get("scale", [1, 1, 1]), dtype=np.float64)
    r = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    m = np.eye(4)
    m[:3, :3] = r * s
    m[:3, 3] = t
    return m


def world_matrices(j):
    nodes = j["nodes"]
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i
    cache = {}

    def world(i):
        if i not in cache:
            m = trs(nodes[i])
            cache[i] = world(parent[i]) @ m if i in parent else m
        return cache[i]
    return [world(i) for i in range(len(nodes))]


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def texture_image(j, binb, tex_index):
    src = j["textures"][tex_index]["source"]
    img = j["images"][src]
    bv = j["bufferViews"][img["bufferView"]]
    data = binb[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
    return np.asarray(Image.open(io.BytesIO(data)).convert("RGB"), dtype=np.float64) / 255.0


def triangles(path):
    """All triangles in the rest pose (N,3,3) and their sRGB colour (N,3)."""
    j, binb = read_glb(path)
    W = world_matrices(j)
    tris, cols = [], []
    images = {}
    for ni, node in enumerate(j["nodes"]):
        if "mesh" not in node:
            continue
        skin = j["skins"][node["skin"]] if "skin" in node else None
        if skin:
            ibm = accessor(j, binb, skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
            jm = np.array([W[jn] @ ibm[k] for k, jn in enumerate(skin["joints"])])
        for prim in j["meshes"][node["mesh"]]["primitives"]:
            if prim.get("mode", 4) != 4:
                continue
            at = prim["attributes"]
            pos = accessor(j, binb, at["POSITION"])
            ph = np.c_[pos, np.ones(len(pos))]
            if skin and "JOINTS_0" in at:
                J = accessor(j, binb, at["JOINTS_0"]).astype(int)
                Wt = accessor(j, binb, at["WEIGHTS_0"])
                Wt /= np.maximum(Wt.sum(1, keepdims=True), 1e-9)
                out = np.zeros((len(pos), 4))
                for k in range(4):
                    out += Wt[:, k:k + 1] * np.einsum("nij,nj->ni", jm[J[:, k]], ph)
                v = out[:, :3]
            else:
                v = (ph @ W[ni].T)[:, :3]
            idx = accessor(j, binb, prim["indices"]).astype(int).ravel() if "indices" in prim else np.arange(len(pos))
            idx = idx.reshape(-1, 3)
            t = v[idx]
            mat = j["materials"][prim["material"]] if "material" in prim else {}
            pbr = mat.get("pbrMetallicRoughness", {})
            factor = np.array(pbr.get("baseColorFactor", [1, 1, 1, 1])[:3])
            if "baseColorTexture" in pbr and "TEXCOORD_0" in at:
                ti = pbr["baseColorTexture"]["index"]
                if ti not in images:
                    images[ti] = texture_image(j, binb, ti)
                im = images[ti]
                uv = accessor(j, binb, at["TEXCOORD_0"])[idx].mean(1)
                h, w = im.shape[:2]
                px = (np.mod(uv[:, 0], 1) * (w - 1)).astype(int)
                py = (np.mod(uv[:, 1], 1) * (h - 1)).astype(int)
                c = im[py, px] * lin_to_srgb(factor)
            else:
                c = np.tile(lin_to_srgb(factor), (len(t), 1))
            tris.append(t)
            cols.append(c)
    return np.concatenate(tris), np.concatenate(cols)


def palette(cols, max_colors=10):
    """Group triangle colours: quantise, keep the biggest groups, map the rest to the nearest."""
    q = np.round(cols * 15) / 15
    keys, inv, counts = np.unique(q, axis=0, return_inverse=True, return_counts=True)
    order = np.argsort(-counts)
    keep = keys[order[:max_colors]]
    d = ((q[:, None, :] - keep[None, :, :]) ** 2).sum(-1)
    return keep, d.argmin(1)


def write_stl(path, tris):
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    rec = np.zeros(len(tris), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    rec["n"] = n
    rec["v"] = tris
    with open(path, "wb") as fh:
        fh.write(b"KherveCAD character mesh".ljust(80, b" "))
        fh.write(struct.pack("<I", len(tris)))
        fh.write(rec.tobytes())


def hexcol(c):
    return "#" + "".join(f"{int(round(x * 255)):02x}" for x in np.clip(c, 0, 1))


def main(models, section_dir):
    section = os.path.basename(section_dir.rstrip("/"))
    os.makedirs(section_dir, exist_ok=True)
    for file, title, height, desc, tags in CHARACTERS:
        src = os.path.join(models, file + ".glb")
        tris, cols = triangles(src)
        # glTF (x, y up, z towards viewer) -> CAD (x, y back, z up): facing -y
        cad = np.stack([tris[..., 0], -tris[..., 2], tris[..., 1]], axis=-1)
        pts = cad.reshape(-1, 3)
        lo, hi = pts.min(0), pts.max(0)
        k = height * 1000.0 / max(1e-9, hi[2] - lo[2])
        cad = (cad - np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]])) * k
        keep, which = palette(cols)
        size = cad.reshape(-1, 3).max(0) - cad.reshape(-1, 3).min(0)
        mesh_dir = os.path.join(section_dir, "meshes", file)
        os.makedirs(mesh_dir, exist_ok=True)
        children = []
        for ci, col in enumerate(keep):
            part = cad[which == ci]
            if not len(part):
                continue
            name = f"{file}-{ci + 1}.stl"
            write_stl(os.path.join(mesh_dir, name), part)
            children.append({
                "type": "color", "name": f"Colour {hexcol(col)}", "visible": True,
                "params": {"color": hexcol(col), "alpha": 1.0, "material": "Default"},
                "children": [{
                    "type": "stl_import", "name": f"{title} part {ci + 1}", "visible": True,
                    "params": {"path": f"meshes/{file}/{name}", "x": 0.0, "y": 0.0, "z": 0.0,
                               "rx": 0.0, "ry": 0.0, "rz": 0.0, "scale": 1.0},
                }],
            })
        full_title = f"{title} {height:g} m"
        uid = uuid.uuid4().hex
        description = (
            f"{desc} Low-poly character by Quaternius (CC0 1.0, public domain), from the animated "
            f"model used in the KherveOS games, here in its rest pose. {height * 1000:.0f} mm tall "
            f"({size[0]:.0f} x {size[1]:.0f} x {size[2]:.0f} mm), standing on z = 0, centred on x/y, "
            f"facing -Y. Built as one Object of {len(children)} coloured imported meshes (STL files in "
            f"meshes/{file}/ beside this part); scale the Object to resize it. {len(cad)} triangles."
        )
        doc = {
            "format": "kcad", "version": 13, "global_fn": 45, "global_fn_on": True, "unit": "mm",
            "tree": {"type": "root", "name": "root", "visible": True, "params": {}, "children": [{
                "type": "component", "name": full_title, "visible": True,
                "params": {"x": 0.0, "y": 0.0, "z": 0.0, "rx": 0.0, "ry": 0.0, "rz": 0.0, "color": "", "alpha": 1.0,
                           "library": {"uid": uid, "title": full_title, "area": section, "named": full_title}},
                "children": children,
            }]},
            "library": {"title": full_title, "description": description,
                        "tags": tags + ["character", "quaternius", "low poly", "cc0"],
                        "source": "assistant", "uid": uid,
                        "created": datetime.datetime.now().isoformat(timespec="seconds")},
        }
        with open(os.path.join(section_dir, f"{full_title}.kcad"), "w", encoding="utf-8") as fh:
            json.dump(doc, fh, indent=1)
        print(f"{full_title}: {len(cad)} tris, {len(children)} colours, {size.round().tolist()} mm")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
