"""Bring a character improved in KherveCAD back into the games, animated.

The KherveCAD part (made by export_characters_to_khervecad.py) is an Object
whose coloured children are either the original body meshes (stl_import) or
what was added in KherveCAD (gear: pouches, pads, radio...). This tool keeps
the original animated GLB as it is and adds the new parts to it:

1. each added child is meshed by OpenSCAD from the program KherveCAD writes
   for it (KherveCAD's own code, imported from the KherveCAD checkout);
2. mm / Z-up are turned back into the model's own rest-pose space (the
   inverse of the export, recomputed from the same GLB);
3. every new vertex takes the bone weights of the nearest vertex of the
   original body, so the gear follows the body in every animation;
4. the result is the original GLB plus one skinned mesh (one primitive per
   colour, materials named "Gear ..."), same skeleton, same animations.

usage:
  python3 tools/kcad_to_game_glb.py PART.kcad SOURCE.glb OUT.glb HEIGHT_M [--khervecad ../KherveCAD]
e.g.
  python3 tools/kcad_to_game_glb.py "$HOME/Documents/KherveCAD Library/Characters & monsters/SWAT soldier 1.8 m.kcad" \\
      public/models/quaternius/soldier.glb public/models/quaternius/soldier-cad.glb 1.8
"""

import argparse
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from export_characters_to_khervecad import accessor, read_glb, triangles, world_matrices  # noqa: E402


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def parse_stl(path):
    b = open(path, "rb").read()
    if b[:5].lower() == b"solid" and b"facet" in b[:400]:
        pts = [list(map(float, ln.split()[1:4])) for ln in b.decode(errors="replace").splitlines() if ln.strip().startswith("vertex")]
        return np.array(pts, dtype=np.float64).reshape(-1, 3, 3)
    n = struct.unpack("<I", b[80:84])[0]
    rec = np.frombuffer(b[84:84 + n * 50], dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    return rec["v"].astype(np.float64)


def gear_meshes(kcad, khervecad_repo, openscad):
    """[(hex colour, name, triangles in mm)] for every added (non stl_import) child."""
    sys.path.insert(0, khervecad_repo)
    from khervecad import library_kcad
    from khervecad.model import DocumentModel
    root = library_kcad.load_part(kcad)
    comp = next(n for n in root.walk() if n.type == "component")
    out = []
    tmp = tempfile.mkdtemp(prefix="kcad2glb-")
    try:
        for i, child in enumerate(comp.children):
            if any(n.type == "stl_import" for n in child.walk()) or not child.visible:
                continue
            colour = child.params.get("color") if child.type == "color" else "#808080"
            m = DocumentModel()
            m.root.children.append(child)
            scad = os.path.join(tmp, f"p{i}.scad")
            stl = os.path.join(tmp, f"p{i}.stl")
            open(scad, "w").write(m.to_scad())
            r = subprocess.run([openscad, "-o", stl, "--export-format", "binstl", scad], capture_output=True, text=True)
            if r.returncode or not os.path.exists(stl):
                print(f"  skipped {child.name}: {r.stderr.strip()[-200:]}")
                continue
            tris = parse_stl(stl)
            label = next((n.name for n in child.walk() if n is not child), child.name)
            out.append((colour or "#808080", label, tris))
            print(f"  {label}: {len(tris)} triangles, {colour}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return out


def body_samples(j, binb):
    """Rest-pose positions of the original skinned body, with joint NODE indices and weights."""
    W = world_matrices(j)
    P, J, Wt = [], [], []
    for node in j["nodes"]:
        if "mesh" not in node or "skin" not in node:
            continue
        skin = j["skins"][node["skin"]]
        ibm = accessor(j, binb, skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
        jm = np.array([W[jn] @ ibm[k] for k, jn in enumerate(skin["joints"])])
        for prim in j["meshes"][node["mesh"]]["primitives"]:
            at = prim["attributes"]
            if "JOINTS_0" not in at:
                continue
            pos = accessor(j, binb, at["POSITION"])
            ph = np.c_[pos, np.ones(len(pos))]
            jj = accessor(j, binb, at["JOINTS_0"]).astype(int)
            ww = accessor(j, binb, at["WEIGHTS_0"])
            ww /= np.maximum(ww.sum(1, keepdims=True), 1e-9)
            v = np.zeros((len(pos), 4))
            for k in range(4):
                v += ww[:, k:k + 1] * np.einsum("nij,nj->ni", jm[jj[:, k]], ph)
            P.append(v[:, :3])
            J.append(np.array(skin["joints"])[jj])
            Wt.append(ww)
    return np.concatenate(P), np.concatenate(J), np.concatenate(Wt)


def cad_frame(src, height):
    """The export's mapping: cad = (rot(gl) - centre) * k, rot(x, y, z) = (x, -z, y)."""
    tris, _ = triangles(src)
    cad = np.stack([tris[..., 0], -tris[..., 2], tris[..., 1]], axis=-1).reshape(-1, 3)
    lo, hi = cad.min(0), cad.max(0)
    k = height * 1000.0 / (hi[2] - lo[2])
    centre = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]])
    return k, centre


def nearest(src_pts, query, chunk=2048):
    idx = np.empty(len(query), dtype=int)
    for s in range(0, len(query), chunk):
        q = query[s:s + chunk]
        d = ((q[:, None, :] - src_pts[None, :, :]) ** 2).sum(-1)
        idx[s:s + chunk] = d.argmin(1)
    return idx


def pad4(b, fill=b"\0"):
    return b + fill * ((4 - len(b) % 4) % 4)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("kcad")
    ap.add_argument("source")
    ap.add_argument("out")
    ap.add_argument("height", type=float)
    ap.add_argument("--khervecad", default=os.path.join(os.path.dirname(__file__), "..", "..", "KherveCAD"))
    ap.add_argument("--openscad", default=shutil.which("openscad") or "/opt/homebrew/bin/openscad")
    a = ap.parse_args()

    print("meshing the KherveCAD gear with OpenSCAD…")
    parts = gear_meshes(a.kcad, os.path.abspath(a.khervecad), a.openscad)
    if not parts:
        sys.exit("No added parts found in the KherveCAD Object.")
    j, binb = read_glb(a.source)
    k, centre = cad_frame(a.source, a.height)
    body_p, body_j, body_w = body_samples(j, binb)
    W = world_matrices(j)

    joint_nodes = sorted(set(body_j.ravel().tolist()))
    slot = {n: i for i, n in enumerate(joint_nodes)}
    blob = bytearray(pad4(bytes(binb)))
    views, accs = j["bufferViews"], j["accessors"]

    def add(arr, comp, typ, target=None, minmax=False):
        nonlocal blob
        off = len(blob)
        data = np.ascontiguousarray(arr).tobytes()
        blob += pad4(data)
        bv = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target:
            bv["target"] = target
        views.append(bv)
        acc = {"bufferView": len(views) - 1, "componentType": comp, "count": int(arr.shape[0]), "type": typ}
        if minmax:
            acc["min"] = arr.min(0).tolist()
            acc["max"] = arr.max(0).tolist()
        accs.append(acc)
        return len(accs) - 1

    prims = []
    for colour, label, tris in parts:
        # mm, Z-up -> the model's rest pose
        r = tris.reshape(-1, 3) / k + centre
        gl = np.stack([r[:, 0], r[:, 2], -r[:, 1]], axis=-1).astype(np.float32)
        t = gl.reshape(-1, 3, 3)
        n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
        normals = np.repeat(n, 3, axis=0).astype(np.float32)
        near = nearest(body_p, gl.astype(np.float64))
        joints = np.vectorize(slot.get)(body_j[near]).astype(np.uint16)
        weights = body_w[near].astype(np.float32)
        rgb = [int(colour[i:i + 2], 16) / 255 for i in (1, 3, 5)] if str(colour).startswith("#") and len(colour) >= 7 else [0.5, 0.5, 0.5]
        j["materials"].append({
            "name": f"Gear {label}",
            "pbrMetallicRoughness": {"baseColorFactor": [*srgb_to_linear(rgb).tolist(), 1.0], "metallicFactor": 0.0, "roughnessFactor": 0.8},
        })
        prims.append({
            "attributes": {
                "POSITION": add(gl, 5126, "VEC3", 34962, minmax=True),
                "NORMAL": add(normals, 5126, "VEC3", 34962),
                "JOINTS_0": add(joints, 5123, "VEC4", 34962),
                "WEIGHTS_0": add(weights, 5126, "VEC4", 34962),
            },
            "material": len(j["materials"]) - 1,
        })
    # one skin over the same skeleton: inverse binds of the rest pose (the gear is in rest-pose space)
    ibm = np.array([np.linalg.inv(W[n]).T.ravel() for n in joint_nodes], dtype=np.float32)
    j.setdefault("skins", []).append({"name": "Gear", "joints": joint_nodes, "inverseBindMatrices": add(ibm, 5126, "MAT4"),
                                      "skeleton": j["skins"][0].get("skeleton", joint_nodes[0])})
    j["meshes"].append({"name": "Gear", "primitives": prims})
    j["nodes"].append({"name": "Gear", "mesh": len(j["meshes"]) - 1, "skin": len(j["skins"]) - 1})
    j["scenes"][j.get("scene", 0)]["nodes"].append(len(j["nodes"]) - 1)
    j["buffers"][0]["byteLength"] = len(blob)

    js = pad4(json.dumps(j, separators=(",", ":")).encode(), b" ")
    bb = pad4(bytes(blob))
    total = 12 + 8 + len(js) + 8 + len(bb)
    with open(a.out, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        fh.write(struct.pack("<II", len(bb), 0x004E4942) + bb)
    print(f"wrote {a.out}: {len(parts)} gear parts, {sum(len(p[2]) for p in parts)} triangles, {total // 1024} KB")


if __name__ == "__main__":
    main()
