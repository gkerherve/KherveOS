"""Bring the desktop KherveFitting-AI technique tools into KherveOS.

KherveOS runs each technique of KherveFitting-AI (TGA / DSC, BET, …) as an
app of its own (src/apps/khervetech is the shared base, src/apps/kherve<tech>
the apps). Their Python is the desktop's own code, unchanged, run in the
window's Pyodide worker under a headless wx (public/apps/khervetech/py/shims).
This script copies that code from ../KherveFittingPro, branch dev-AI, read
with ``git archive`` (the user's checkout is never touched):

1. whole modules, verbatim, into public/apps/khervetech/py/desktop/libraries/
   (COMMON plus each technique's ``modules``);
2. a few names out of the big wx modules (PARTIAL), cut from the source with
   ``ast`` so the code is still the desktop's, byte for byte;
3. the toolbar icons libraries/Icons/Tech-*-3.png to
   public/apps/khervetech/icons/, and for each technique app a 256 px Dock
   icon drawn from its Tech-<TECH>-3.png (same tile, colours and letters) to
   public/icons/apps/kherve<tech>.png;
4. the examples: Data-Examples/zz Other Techniques/<folder>/ when the desktop
   has some, otherwise the synthetic ones of make_examples() (the desktop
   ships no TGA or BET data), to public/examples/kherve<tech>/ + index.json;
5. py/files.json: every file the worker installs (desktop + shims + ktech).

    python3 tools/export_khervetech.py [--source ../KherveFittingPro] [--ref origin/dev-AI]

Adding a technique: add it to TECHNIQUES below (its modules, icon, example
folder), run this, then follow "Technique apps" in CLAUDE.md.
"""

from __future__ import annotations

import argparse
import ast
import io
import json
import math
import shutil
import subprocess
import tarfile
import tempfile
import textwrap
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
PY = HERE / "public" / "apps" / "khervetech" / "py"
DESKTOP_OUT = PY / "desktop"
ICONS_OUT = HERE / "public" / "apps" / "khervetech" / "icons"
APP_ICONS = HERE / "public" / "icons" / "apps"
EXAMPLES = HERE / "public" / "examples"

#: modules every technique app needs, copied whole
COMMON = [
    "libraries/__init__.py",
    "libraries/FileMenu/__init__.py",
    "libraries/ToolsMenu/__init__.py",
    "libraries/ViewMenu/__init__.py",
    "libraries/FileMenu/KFitting_IO.py",
    "libraries/FileMenu/Optical_Import.py",
    "libraries/ToolsMenu/TechniqueTool.py",
    "libraries/ViewMenu/TechniqueToolbar.py",
    "libraries/ViewMenu/TechniqueOverview.py",
]

#: (module, top-level names) cut out of modules too big or too wx-bound to copy
PARTIAL = {
    "libraries/FileMenu/KFitting_Import.py": {
        "imports": "import os\nimport re\nimport json\nimport math\n",
        "names": ["TECH_*", "GENERIC_TECHNIQUES", "_TECH_BY_PREFIX", "guess_technique", "_unique_sheet_name",
                  "_generic_background", "build_generic_sheet"],
    },
    "libraries/FileMenu/Save.py": {
        "imports": "import json\nimport numpy as np\nimport wx\nimport wx.grid\n",
        "names": ["_round_keep_small", "convert_to_serializable_and_round"],
        # save_state / undo / redo are the main window's (ktech.frame)
        "tail": "\n\ndef save_state(window):\n    window.save_state()\n\n\ndef update_undo_redo_state(window):\n    pass\n",
    },
    "libraries/PlotLabelEdit.py": {
        "imports": "",
        "names": ["legend_frame_kwargs"],
    },
    "libraries/Plot_Operations.py": {
        "imports": "import re\n",
        "names": ["_TECHNIQUE_AXES", "plain_axis_label", "is_optical_sheet", "axis_labels_for_sheet", "is_xps_like_sheet",
                  "sheet_x_is_forward", "is_image_sheet", "_plot_ftir_overlays"],
    },
    "libraries/ViewMenu/Labels_Screen.py": {
        "imports": ("import math\nfrom matplotlib.patches import (Rectangle, Circle, FancyArrowPatch, Polygon,\n"
                    "                                Arc, Wedge, Ellipse)\nfrom matplotlib.lines import Line2D\n"
                    "from matplotlib.transforms import Affine2D\nimport matplotlib.transforms as mtransforms\n"
                    "import numpy as np\n"),
        "names": ["ENDPOINT_TYPES", "SHAPE_TYPES", "MEASURE_TYPES", "DRAWING_TYPES", "_DRAWING_TAG",
                  "_draw_label_data_on_ax", "_remove_all_drawing_artists", "_draw_inset", "_draw_source_inset"],
    },
    "libraries/PlotConfig.py": {
        "imports": "import numpy as np\nfrom libraries.Plot_Operations import sheet_x_is_forward, is_image_sheet\n",
        # methods of PlotConfig, as module functions taking ``self`` (ktech.frame.PlotConfig binds them)
        "names": ["x_axis_step", "intensity_step", "PlotConfig.update_plot_limits", "PlotConfig.reset_plot_limits"],
    },
    "libraries/ConfigFile.py": {
        "imports": "import os\nimport sys\nimport json\nimport shutil\nimport wx\n",
        # the per-user folders (wx.StandardPaths: ~/.config in the worker), the technique
        # libraries seeded from the app (FTIR Library), and how a sheet is built from a workbook
        "names": ["_APP_CONFIG_DIRNAME", "_app_root", "get_config_dir", "get_documents_dir", "_ftir_library_seed_dir",
                  "get_ftir_library_dir", "get_ftir_nicolet_dir", "set_ftir_nicolet_dir", "FTIR_ONLINE_DEFAULT_BASE",
                  "get_ftir_online_base", "set_ftir_online_base", "get_ftir_online_cache_path", "get_xrd_library_dir",
                  "get_xrd_instrument_path", "Init_Measurement_Data", "build_core_level_Data", "add_core_level_Data",
                  "add_peak_to_core_level_Data"],
    },
    "libraries/Widgets_Toolbars.py": {
        "imports": "",
        "names": ["open_*_analysis_window", "open_bet_analysis_window", "on_open_eels_window"],
    },
    "libraries/FileMenu/Open.py": {
        "imports": "import os\nimport re\nimport json\nimport wx\n",
        "names": ["convert_from_serializable", "normalize_sheet_name"],
        # open_xlsx_file: ktech.project's (the desktop's steps without its console, recent files and backups)
        "tail": "\n\ndef open_xlsx_file(window, file_path=None):\n    from ktech.project import open_xlsx_file as _open\n"
                "    return _open(window, file_path)\n\n\ndef import_raman_txt_file(window):\n"
                "    from libraries.FileMenu.Kal_Import import import_raman_txt_file as _f\n    return _f(window)\n\n\n"
                "def import_multiple_raman_files(window):\n"
                "    from libraries.FileMenu.Kal_Import import import_multiple_raman_files as _f\n    return _f(window)\n",
    },
    "libraries/PeakFittingGrid.py": {
        "imports": "import numpy as np\n",
        "names": ["format_peak_value"],
    },
    "libraries/FileMenu/Kal_Import.py": {
        "imports": "import os\nimport wx\n",
        "names": ["import_raman_txt_file", "import_multiple_raman_files"],
    },
}

#: the techniques that are KherveOS apps. ``key`` is TechniqueTool's key.
TECHNIQUES = {
    "tga": {
        "key": "TGA",
        "app": "khervetga",
        "icon": "Tech-TGA-3.png",
        "modules": [
            "libraries/FileMenu/TGA_Import.py",
            "libraries/FileMenu/TRI_Import.py",
            "libraries/ToolsMenu/TGA_Engine.py",
            "libraries/ToolsMenu/TGA_Chem.py",
            "libraries/ToolsMenu/TGA_Plot.py",
            "libraries/ToolsMenu/TGA_Analysis.py",
        ],
        "examples": "TGA",
    },
    "bet": {
        "key": "BET",
        "app": "khervebet",
        "icon": "Tech-BET-3.png",
        "modules": [
            "libraries/FileMenu/BET_Import.py",
            "libraries/ToolsMenu/BET_Analysis.py",
        ],
        "examples": "BET",
    },
    "uvvis": {
        "key": "UVVIS",
        "app": "kherveuvvis",
        "icon": "Tech-UVVIS-3.png",
        "modules": [
            "libraries/ToolsMenu/UVVIS_Plot.py",
            "libraries/ToolsMenu/UVVIS_Analysis.py",
        ],
        "examples": "UV-Vis",
    },
    "ftir": {
        "key": "FTIR",
        "app": "kherveftir",
        "icon": "Tech-FTIR-3.png",
        "modules": [
            "libraries/FileMenu/FTIR_Import.py",
            "libraries/FileMenu/JCAMP_Import.py",
            "libraries/FileMenu/NicoletLibrary_Import.py",
            "libraries/ToolsMenu/FTIR_Engine.py",
            "libraries/ToolsMenu/FTIR_Library.py",
            "libraries/ToolsMenu/FTIR_Assign.py",
            "libraries/ToolsMenu/FTIR_Analysis.py",
        ],
        # the reference spectra the desktop ships (get_ftir_library_dir seeds the user's library from them)
        "data": ["FTIR Library/*.jdx"],
        "examples": "FTIR",
        "packages": ["numpy", "scipy", "pandas"],
        "example_files": ["FTIR Library/Polystyrene_synthetic.jdx", "FTIR Library/PMMA_synthetic.jdx",
                          "FTIR Library/Ethanol_synthetic.jdx", "FTIR Library/CaCO3_calcite_synthetic.jdx"],
    },
    "raman": {
        "key": "RAMAN",
        "app": "kherveraman",
        "icon": "Tech-RAMAN-3.png",
        "modules": [
            "libraries/ToolsMenu/Raman_Library.py",
            "libraries/ToolsMenu/Raman_Assign.py",
            "libraries/ToolsMenu/Raman_Analysis.py",
        ],
        "examples": "Raman",
        "packages": ["numpy", "scipy", "pandas"],
    },
}

#: KherveFitting's pure-Python wheels (public/apps/khervefitting/py/wheels) every technique worker
#: unpacks: openpyxl for the workbooks the importers write (FileMenu/Open.open_xlsx_file)
BASE_WHEELS = ["openpyxl-3.1.2-py2.py3-none-any.whl", "et_xmlfile-1.1.0-py3-none-any.whl"]
#: Pyodide packages loaded before the first request (h5py for .kfit is loaded on demand)
BASE_PACKAGES = ["numpy", "scipy"]

HEADER = "# KherveOS: {how} from KherveFittingPro {ref} ({rev}), {path}. Regenerate with tools/export_khervetech.py.\n"


def archive(source: Path, ref: str, dest: Path) -> str:
    subprocess.run(["git", "-C", str(source), "fetch", "-q"], check=False)
    rev = subprocess.run(["git", "-C", str(source), "rev-parse", "--short", ref], check=True, capture_output=True,
                         text=True).stdout.strip()
    data = subprocess.run(["git", "-C", str(source), "archive", ref], check=True, capture_output=True).stdout
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        tar.extractall(dest, filter="data")
    return rev


def _matches(name: str, pattern: str) -> bool:
    if "*" not in pattern:
        return name == pattern
    head, _, tail = pattern.partition("*")
    return name.startswith(head) and name.endswith(tail)


def extract(src: Path, names: list[str]) -> str:
    """The source text of the top-level statements defining ``names``, in file order."""
    text = src.read_text(encoding="utf-8")
    tree = ast.parse(text)
    lines = text.splitlines(keepends=True)
    out = []
    nodes = list(tree.body)
    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            for sub in node.body:
                if isinstance(sub, ast.FunctionDef) and any(p == f"{node.name}.{sub.name}" for p in names):
                    nodes.append(("method", node.name, sub))
    for node in nodes:
        if isinstance(node, tuple):
            _kind, cls, fn = node
            start = fn.lineno - 1
            if fn.decorator_list:
                start = min(d.lineno for d in fn.decorator_list) - 1
            chunk = "".join(lines[start:fn.end_lineno])
            out.append(textwrap.dedent(chunk))
            continue
        defined: list[str] = []
        if isinstance(node, (ast.FunctionDef, ast.ClassDef, ast.AsyncFunctionDef)):
            defined = [node.name]
        elif isinstance(node, ast.Assign):
            defined = [t.id for t in node.targets if isinstance(t, ast.Name)]
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            defined = [node.target.id]
        if not any(_matches(d, p) for d in defined for p in names):
            continue
        start = node.lineno - 1
        if getattr(node, "decorator_list", None):
            start = min(d.lineno for d in node.decorator_list) - 1
        out.append("".join(lines[start:node.end_lineno]))
    missing = [p for p in names if "*" not in p and not any(p.split(".")[-1] in chunk for chunk in out)]
    if missing:
        raise SystemExit(f"{src}: not found {missing}")
    return "\n\n".join(out) + "\n"


# ----------------------------------------------------------------- icons

def dock_icon(tile: Path, label: str, out: Path):
    """The 25 px toolbar tile drawn again at 256 px: its own fill, frame and letter colours."""
    from PIL import Image, ImageDraw, ImageFont

    small = Image.open(tile).convert("RGBA")
    px = small.load()
    w, h = small.size
    fill = px[w // 2, 3]
    frame = px[0, h // 2] if px[0, h // 2][3] > 0 else px[1, h // 2]
    counts: dict[tuple, int] = {}
    for y in range(h):
        for x in range(w):
            c = px[x, y]
            if c[3] > 200 and sum(abs(a - b) for a, b in zip(c[:3], fill[:3])) > 120:
                counts[c[:3]] = counts.get(c[:3], 0) + 1
    ink = max(counts, key=counts.get) if counts else (51, 51, 51)
    size = 256
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = 18
    radius = 44
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=radius, fill=fill[:3] + (255,),
                        outline=frame[:3] + (255,), width=8)
    font_path = None
    for cand in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/Library/Fonts/Arial Bold.ttf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if Path(cand).exists():
            font_path = cand
            break
    room = size - 2 * pad - 36
    pt = 120
    while True:
        font = ImageFont.truetype(font_path, pt) if font_path else ImageFont.load_default()
        box = d.textbbox((0, 0), label, font=font)
        if box[2] - box[0] <= room or pt <= 20:
            break
        pt -= 4
    tw, th = box[2] - box[0], box[3] - box[1]
    d.text(((size - tw) / 2 - box[0], (size - th) / 2 - box[1]), label, font=font, fill=ink + (255,))
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)


# -------------------------------------------------------------- examples

def _netzsch(path: Path, meta: dict, columns: list[str], rows: list[list[float]]):
    lines = [f"#{k}:{' ' * max(1, 28 - len(k))},{v},,,,,," for k, v in meta.items()]
    lines.append(",,,,,,,")
    lines.append("##" + ",".join(columns))
    for r in rows:
        lines.append(",".join(f"{v:.6g}" for v in r))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _sigmoid(t, centre, width):
    return 1.0 / (1.0 + math.exp(-(t - centre) / width))


def _gauss(t, centre, width):
    return math.exp(-0.5 * ((t - centre) / width) ** 2)


def make_tga_examples(out: Path) -> list[dict]:
    """Synthetic STA runs in the formats TGA_Import reads (the desktop ships none)."""
    import random
    random.seed(7)
    made = []

    # 1. Calcium oxalate monohydrate, NETZSCH STA 449 "DATA ALL" export: three steps
    #    (H2O 12.3 %, CO 19.2 %, CO2 30.1 %) on a 10 K/min ramp, then a dwell and a cooling segment.
    rows = []
    mass0 = 10.225
    t = 0.0
    temp = 30.0
    seg = 1
    while temp < 1000.0:
        loss = 12.33 * _sigmoid(temp, 175, 9) + 19.17 * _sigmoid(temp, 485, 11) + 30.12 * _sigmoid(temp, 745, 14)
        dsc = (-0.35 * _gauss(temp, 178, 14) + 0.55 * _gauss(temp, 488, 12) - 0.9 * _gauss(temp, 748, 18)
               - 0.0004 * (temp - 30))
        rows.append([temp, t, dsc + random.gauss(0, 0.004), 100 - loss + random.gauss(0, 0.01), 50, 1.2, seg])
        t += 0.1
        temp += 1.0
    seg = 2
    for _ in range(100):
        rows.append([1000.0 + random.gauss(0, 0.05), t, -0.38 + random.gauss(0, 0.004), rows[-1][3] + random.gauss(0, 0.005), 50,
                     1.2, seg])
        t += 0.1
    seg = 3
    temp = 1000.0
    while temp > 100.0:
        rows.append([temp, t, -0.36 + 0.0003 * (1000 - temp) + random.gauss(0, 0.004), rows[-1][3] + random.gauss(0, 0.005), 50,
                     1.2, seg])
        t += 0.1
        temp -= 2.0
    _netzsch(out / "CaC2O4_H2O_STA_10Kmin.csv",
             {"EXPORTTYPE": "DATA ALL", "FILE": "CaOx_10K.ngb-ss3", "FORMAT": "NETZSCH5", "FTYPE": "ANSI",
              "IDENTITY": "CaOx-01", "DECIMAL": "POINT", "SEPARATOR": "COMMA", "INSTRUMENT": "NETZSCH STA 449F3 (synthetic)",
              "SAMPLE": "Calcium oxalate monohydrate", "SAMPLE MASS /mg": "10.225", "TYPE OF CRUCIBLE": "Al2O3 85 ul",
              "OPERATOR": "KherveOS example", "RANGE": "30/10.0(K/min)/1000/-20.0(K/min)/100", "EXO": "1"},
             ["Temp./°C", "Time/min", "DSC/(uV/mg)", "Mass/%", "Gas Flow(purge 2)/(ml/min)", "Sensit./(uV/mW)",
              "Segment"], rows)
    made.append({"file": "CaC2O4_H2O_STA_10Kmin.csv", "title": "Calcium oxalate - STA (3 mass steps + DSC)"})

    # 2. A perovskite oxygen-exchange run: three heat / cool cycles in air, reversible O loss.
    rows = []
    t = 0.0
    seg = 0
    mass = 25.0
    drift = 0.0
    for cycle in range(3):
        for up in (True, False):
            seg += 1
            temps = [200 + i * 2.0 for i in range(301)] if up else [800 - i * 2.0 for i in range(301)]
            for temp in temps:
                lost = 0.42 * _sigmoid(temp, 520, 45)
                rows.append([temp, t, 0.05 * _gauss(temp, 520, 60) * (1 if up else -1) + random.gauss(0, 0.002),
                             mass * (1 - lost / 100) - drift + random.gauss(0, 0.0008), seg])
                t += 0.2
            drift += 0.004
    _netzsch(out / "BSCF_redox_cycles_air.csv",
             {"EXPORTTYPE": "DATA ALL", "INSTRUMENT": "NETZSCH STA 449F3 (synthetic)", "SAMPLE": "Ba0.5Sr0.5Co0.8Fe0.2O3-d",
              "SAMPLE MASS /mg": "25.000", "RANGE": "3 x (200/10.0(K/min)/800/-10.0(K/min)/200)", "EXO": "1"},
             ["Temp./°C", "Time/min", "DSC/(uV/mg)", "Mass/mg", "Segment"], rows)
    made.append({"file": "BSCF_redox_cycles_air.csv", "title": "Perovskite - 3 redox cycles (Cycles tab)"})

    # 3. A bare two-column export (no time, no metadata): polymer decomposition, % vs °C.
    lines = ["Temperature (C),Weight (%)"]
    for i in range(0, 581):
        temp = 25 + i
        loss = 1.2 * _sigmoid(temp, 95, 8) + 96.5 * _sigmoid(temp, 412, 12)
        lines.append(f"{temp:.1f},{100 - loss + random.gauss(0, 0.02):.4f}")
    (out / "PMMA_decomposition_bare.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    made.append({"file": "PMMA_decomposition_bare.csv", "title": "Polymer decomposition - bare temperature / mass CSV"})

    # 4. A stepped-isothermal oxidation run (Isothermal tab: kinetics + Arrhenius).
    rows = []
    t = 0.0
    seg = 0
    mass = 18.0
    gained = 0.0
    for dwell_t in (400, 450, 500, 550):
        seg += 1
        temp = (rows[-1][0] if rows else 300.0)
        while temp < dwell_t:
            rows.append([temp, t, 0.0, mass + gained, seg])
            temp += 2.0
            t += 0.2
        seg += 1
        k = 0.02 * math.exp(-95000 / 8.314 * (1 / (dwell_t + 273.15) - 1 / (673.15)))
        start = gained
        for i in range(301):
            tt = i * 0.2
            g = start + 0.30 * (1 - math.exp(-k * tt))
            rows.append([dwell_t + random.gauss(0, 0.05), t, 0.0, mass + g + random.gauss(0, 0.0005), seg])
            t += 0.2
        gained = rows[-1][3] - mass
    _netzsch(out / "Ni_oxidation_stepped_isothermal.csv",
             {"EXPORTTYPE": "DATA ALL", "INSTRUMENT": "NETZSCH TG 209 (synthetic)", "SAMPLE": "Ni powder",
              "SAMPLE MASS /mg": "18.000", "RANGE": "300/10.0(K/min)/400 iso 60 min ... 550 iso 60 min"},
             ["Temp./°C", "Time/min", "DSC/(uV/mg)", "Mass/mg", "Segment"], rows)
    made.append({"file": "Ni_oxidation_stepped_isothermal.csv", "title": "Nickel oxidation - stepped isothermal (kinetics)"})
    return made


def make_bet_examples(out: Path) -> list[dict]:
    """Synthetic N2 isotherms at 77 K in the formats BET_Import reads (the desktop ships none)."""
    import random
    random.seed(11)
    made = []

    def bet_q(x, qm, c):
        return qm * c * x / ((1 - x) * (1 + (c - 1) * x))

    # 1. Mesoporous silica (SBA-15 like): type IV with an H1 hysteresis, Micromeritics-style export.
    ads = [0.01, 0.03, 0.05, 0.07, 0.1, 0.13, 0.16, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.62, 0.64, 0.66,
           0.68, 0.7, 0.72, 0.75, 0.8, 0.85, 0.9, 0.95, 0.99]
    des = [0.95, 0.9, 0.85, 0.8, 0.75, 0.72, 0.7, 0.68, 0.66, 0.64, 0.62, 0.6, 0.58, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3]
    qm, c = 160.0, 110.0

    def meso(x, shift):
        base = bet_q(min(x, 0.35), qm, c) + 120 * max(0.0, x - 0.35)
        fill = 420 * _sigmoid(x, 0.70 - shift, 0.012)
        return base + fill + 25 * max(0.0, x - 0.8)

    lines = ["Micromeritics Instrument Corporation (synthetic example)", "Sample: SBA-15 silica",
             "Analysis Adsorptive: N2", "Analysis Bath Temp.: 77.350 K", "Saturation Pressure: 760.12 mmHg",
             "Operator: KherveOS example", "", "Relative Pressure (P/Po)\tAbsolute Pressure (mmHg)\tQuantity Adsorbed (cm3/g STP)"]
    for x in ads:
        lines.append(f"{x:.6f}\t{x * 760.12:.4f}\t{meso(x, 0.0) * (1 + random.gauss(0, 0.003)):.4f}")
    for x in des:
        lines.append(f"{x:.6f}\t{x * 760.12:.4f}\t{meso(x, 0.055) * (1 + random.gauss(0, 0.003)):.4f}")
    (out / "SBA15_silica_N2_77K.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    made.append({"file": "SBA15_silica_N2_77K.txt", "title": "SBA-15 silica - type IV, H1 hysteresis (BJH)"})

    # 2. Microporous activated carbon: type I, adsorption only, CSV.
    lines = ["P/P0,Quantity adsorbed (cm3/g STP)"]
    for i in range(1, 41):
        x = 0.001 * (1.18 ** i)
        if x > 0.99:
            break
        q = 380 * (24 * x) / (1 + 24 * x) + 18 * x + 60 * (1 - math.exp(-x * 400))
        lines.append(f"{x:.6f},{q * (1 + random.gauss(0, 0.002)):.4f}")
    (out / "Activated_carbon_typeI.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    made.append({"file": "Activated_carbon_typeI.csv", "title": "Activated carbon - type I microporous (t-plot)"})

    # 3. Non-porous alumina: type II, absolute pressures + P0 in the header (converted on import).
    lines = ["Sample: alpha-Al2O3 powder", "P0 = 101.3 kPa", "Pressure (kPa)  Volume adsorbed (cm3/g STP)"]
    for x in [0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]:
        q = bet_q(x, 2.3, 95.0)
        lines.append(f"{x * 101.3:.4f}  {q * (1 + random.gauss(0, 0.004)):.5f}")
    (out / "Alumina_nonporous_kPa.dat").write_text("\n".join(lines) + "\n", encoding="utf-8")
    made.append({"file": "Alumina_nonporous_kPa.dat", "title": "Alumina - type II, absolute pressure + P0 header"})
    return made


MAKERS = {"tga": make_tga_examples, "bet": make_bet_examples}


def export_examples(root: Path, tech: str, spec: dict):
    out = EXAMPLES / spec["app"]
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    folder = root / "Data-Examples" / "zz Other Techniques" / spec["examples"]
    made: list[dict] = []
    real = [f for f in folder.iterdir() if f.is_file() and not f.name.startswith(".") and f.suffix != ".py"] \
        if folder.is_dir() else []
    if spec.get("example_files"):
        # files the desktop ships elsewhere in its tree (e.g. the FTIR reference spectra)
        for rel in spec["example_files"]:
            f = root / rel
            shutil.copy2(f, out / f.name)
            made.append({"file": f.name, "title": f.stem.replace("_", " ")})
    elif real:
        for f in sorted(real):
            shutil.copy2(f, out / f.name)
            made.append({"file": f.name, "title": f.stem.replace("_", " ")})
    else:
        made = MAKERS[tech](out)
    (out / "index.json").write_text(json.dumps({"examples": made}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"examples/{spec['app']}: {len(made)} files")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=str(HERE.parent / "KherveFittingPro"))
    ap.add_argument("--ref", default="origin/dev-AI")
    args = ap.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        rev = archive(Path(args.source), args.ref, root)

        if DESKTOP_OUT.exists():
            shutil.rmtree(DESKTOP_OUT)
        modules = list(COMMON)
        for spec in TECHNIQUES.values():
            modules += [m for m in spec["modules"] if m not in modules]
        for spec in TECHNIQUES.values():
            for pattern in spec.get("data", []):
                for src in sorted(root.glob(pattern)):
                    dst = DESKTOP_OUT / src.relative_to(root)
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, dst)
        for rel in modules:
            src = root / rel
            dst = DESKTOP_OUT / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            text = src.read_text(encoding="utf-8")
            if rel.endswith("__init__.py") and not text.strip():
                dst.write_text("", encoding="utf-8")
            else:
                dst.write_text(HEADER.format(how="copied unchanged", ref=args.ref, rev=rev, path=rel) + text,
                               encoding="utf-8")
        for rel, part in PARTIAL.items():
            dst = DESKTOP_OUT / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            body = extract(root / rel, part["names"])
            dst.write_text(HEADER.format(how="these definitions cut unchanged", ref=args.ref, rev=rev, path=rel)
                           + part["imports"] + "\n\n" + body + part.get("tail", ""), encoding="utf-8")

        ICONS_OUT.mkdir(parents=True, exist_ok=True)
        for png in sorted((root / "libraries" / "Icons").glob("Tech-*-3.png")):
            shutil.copy2(png, ICONS_OUT / png.name)
        for tech, spec in TECHNIQUES.items():
            dock_icon(root / "libraries" / "Icons" / spec["icon"], spec["key"], APP_ICONS / f"{spec['app']}.png")
            export_examples(root, tech, spec)

    write_files_json(rev)
    print(f"KherveFittingPro {args.ref} {rev}: {len(modules)} modules, {len(PARTIAL)} partial")


def write_files_json(rev: str):
    """py/files.json: what every technique's worker installs ("common"), and per technique
    (its TECHS key) its own desktop modules and data, the wheels and Pyodide packages it needs."""
    own: dict[str, list[str]] = {}
    for spec in TECHNIQUES.values():
        rels = [f"desktop/{m}" for m in spec["modules"]]
        for pattern in spec.get("data", []):
            rels += [str(p.relative_to(PY)) for p in sorted(DESKTOP_OUT.glob(pattern))]
        own[spec["key"]] = rels
    taken = {r for rels in own.values() for r in rels}
    common = sorted(str(p.relative_to(PY)) for p in PY.rglob("*.py")
                    if "__pycache__" not in p.parts and str(p.relative_to(PY)) not in taken)
    tech = {}
    for spec in TECHNIQUES.values():
        tech[spec["key"]] = {"files": own[spec["key"]], "wheels": spec.get("wheels", BASE_WHEELS),
                             "packages": spec.get("packages", BASE_PACKAGES)}
    (PY / "files.json").write_text(json.dumps({"rev": rev, "common": common, "tech": tech}, indent=1) + "\n",
                                   encoding="utf-8")
    print(f"files.json: {len(common)} common files, {', '.join(f'{k} {len(v)}' for k, v in own.items())}")


if __name__ == "__main__":
    main()
