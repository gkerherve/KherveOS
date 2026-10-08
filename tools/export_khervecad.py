"""Bring the desktop KherveCAD into KherveOS.

KherveOS runs KherveCAD's own Python in Pyodide (src/apps/khervecad), so
this copies, from the committed code of ../KherveCAD (``git archive
HEAD`` — the working tree is never touched):

1. the ``khervecad`` package's Python into one zip,
   public/apps/khervecad/py/khervecad.zip, unpacked in the worker;
2. its data files (library parts, human model, planet maps, help
   pictures, translations…) to public/apps/khervecad/py/data/khervecad/,
   listed in lazy.json: the worker creates them empty and fetches each
   one the first time the desktop code opens it;
3. the Liberation fonts (npm @typopro/web-liberation) the OpenSCAD engine
   and the preview's text use, to public/apps/khervecad/py/data/fonts/;
4. the repository's sample document (Chair.kcad) to
   public/apps/khervecad/examples/;
5. with --qt-python (a Python that has PyQt5 + qtawesome, e.g.
   ../KherveCAD/.venv/bin/python): the desktop window itself, built
   offscreen, read back as docs/parity/khervecad-ui.json — every menu with
   every item, both toolbars, the tooltips, icons and shortcuts — so the
   web window is laid out from the desktop's own widgets, plus a picture
   of the window for reference (docs/parity/khervecad-desktop.png).

    python3 tools/export_khervecad.py [--source ../KherveCAD]
        [--qt-python ../KherveCAD/.venv/bin/python]

Run it again whenever the desktop app changes.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
PY_OUT = HERE / "public" / "apps" / "khervecad" / "py"
DATA_OUT = PY_OUT / "data" / "khervecad"
FONT_OUT = PY_OUT / "data" / "fonts"
EXAMPLES_OUT = HERE / "public" / "apps" / "khervecad" / "examples"
UI_OUT = HERE / "docs" / "parity" / "khervecad-ui.json"
MDI_OUT = HERE / "src" / "apps" / "khervecad" / "mdi.ts"
#: the icon font the desktop draws with: qtawesome's "mdi." prefix is
#: Material Design Icons 5.9.55 (npm alias @mdi/js-5, dev dependency)
MDI_JS = HERE / "node_modules" / "@mdi" / "js-5" / "mdi.js"
SHOT_OUT = HERE / "docs" / "parity" / "khervecad-desktop.png"

#: data the web build has no use for
SKIP_SUFFIXES = (".pyc", ".DS_Store")
SAMPLES = ["Chair.kcad"]
FONTS = {
    f"TypoPRO-Liberation{fam}-{style}.ttf": f"Liberation{fam}-{style}.ttf"
    for fam in ("Sans", "Serif", "Mono")
    for style in ("Regular", "Bold", "Italic", "BoldItalic")
}


def archive(source: Path, dest: Path) -> None:
    """The committed tree of *source* (HEAD) unpacked into *dest*."""
    data = subprocess.run(["git", "-C", str(source), "archive", "HEAD"],
                          check=True, capture_output=True).stdout
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        tar.extractall(dest, filter="data")


def version_of(source: Path) -> str:
    """The desktop's own version string (khervecad/_version.py): 0.1.N+sha
    of HEAD — what packaging/build_installer.py writes to VERSION."""
    def git(*args):
        return subprocess.run(["git", "-C", str(source), *args], check=True,
                              capture_output=True, text=True).stdout.strip()
    return f"0.1.{git('rev-list', '--count', 'HEAD')}+" \
        f"{git('rev-parse', '--short', 'HEAD')}"


def export_package(tree: Path, version: str = "") -> None:
    pkg = tree / "khervecad"
    if version:
        (pkg / "VERSION").write_text(version + "\n", encoding="utf-8")
    PY_OUT.mkdir(parents=True, exist_ok=True)
    if DATA_OUT.exists():
        shutil.rmtree(DATA_OUT)
    lazy = []
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for path in sorted(pkg.rglob("*")):
            if not path.is_file() or path.name.endswith(SKIP_SUFFIXES):
                continue
            rel = path.relative_to(tree).as_posix()
            if path.suffix == ".py" or path.name == "VERSION":
                z.write(path, rel)
            else:
                target = DATA_OUT / path.relative_to(pkg)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, target)
                lazy.append(path.relative_to(pkg).as_posix())
    (PY_OUT / "khervecad.zip").write_bytes(buf.getvalue())
    (PY_OUT / "lazy.json").write_text(json.dumps(
        {"files": lazy}, ensure_ascii=False, indent=0))
    size = sum((DATA_OUT / f).stat().st_size for f in lazy)
    print(f"khervecad.zip {len(buf.getvalue()) / 1e6:.1f} MB; "
          f"{len(lazy)} data files, {size / 1e6:.1f} MB (fetched on use)")


def export_fonts() -> None:
    src = HERE / "node_modules" / "@typopro" / "web-liberation"
    FONT_OUT.mkdir(parents=True, exist_ok=True)
    for name, out in FONTS.items():
        shutil.copyfile(src / name, FONT_OUT / out)
    print(f"{len(FONTS)} fonts")


def export_icons(tree: Path) -> None:
    """The desktop's icons: every "mdi.<name>" in its sources, as SVG
    path data from the same Material Design Icons release."""
    import re
    names = set()
    for path in (tree / "khervecad").rglob("*.py"):
        names.update(re.findall(r"mdi\.([a-z0-9][a-z0-9-]*)",
                                path.read_text(encoding="utf-8")))
    paths = dict(re.findall(r'export var (mdi\w+) = "([^"]+)"',
                            MDI_JS.read_text(encoding="utf-8")))

    def camel(name):
        return "mdi" + "".join(p[:1].upper() + p[1:]
                               for p in name.split("-"))

    found = {n: paths[camel(n)] for n in sorted(names) if camel(n) in paths}
    missing = sorted(n for n in names if camel(n) not in paths)
    lines = ["// Generated by tools/export_khervecad.py — do not edit.",
             "// The Material Design Icons (5.9.55, the release the "
             "desktop's qtawesome draws)",
             "// that KherveCAD uses, as SVG path data keyed by the "
             "desktop's own names.",
             "export const MDI: Record<string, string> = {"]
    lines += [f"  {json.dumps('mdi.' + n)}: {json.dumps(d)}," for n, d in
              found.items()]
    lines.append("}")
    MDI_OUT.write_text("\n".join(lines) + "\n")
    print(f"{len(found)} icons" + (f" ({len(missing)} not in MDI 5.9.55: "
                                    f"{', '.join(missing[:8])})"
                                    if missing else ""))


def export_samples(tree: Path) -> None:
    EXAMPLES_OUT.mkdir(parents=True, exist_ok=True)
    for name in SAMPLES:
        shutil.copyfile(tree / name, EXAMPLES_OUT / name)
        print(f"sample {name}: {(tree / name).stat().st_size} bytes")


# ---------------------------------------------------------------- UI dump

DUMP = r'''
import inspect, json, os, sys
TREE, OUT, SHOT, TMP = sys.argv[1:5]
sys.path.insert(0, TREE)
from PyQt5 import QtCore, QtWidgets
_QS = QtCore.QSettings
class _Settings(_QS):           # never the user's own settings
    def __init__(self, *a, **k):
        super().__init__(os.path.join(TMP, "settings.ini"), _QS.IniFormat)
QtCore.QSettings = _Settings
QtCore.QStandardPaths.writableLocation = staticmethod(lambda _k: TMP)
_add = QtWidgets.QMenu.addAction
def _addAction(self, *a, **k):
    act = _add(self, *a, **k)
    if isinstance(act, QtWidgets.QAction):
        slot = next((x for x in a if callable(x) and not isinstance(x, QtCore.QObject)), None)
        if slot is not None:
            code = getattr(slot, "__code__", None)
            defaults = getattr(slot, "__defaults__", None) or ()
            if code is not None and defaults:
                names = code.co_varnames[code.co_argcount - len(defaults):code.co_argcount]
                args = {}
                for n, v in zip(names, defaults):
                    if isinstance(v, (str, int, float, bool)) and n != "_":
                        args[n] = v
                    elif callable(v) and n == "b":
                        args[n] = getattr(v, "__name__", "")
                if args:
                    act.setProperty("kc_args", json.dumps(args))
        fr = next((f for f in inspect.stack()[1:]
                   if os.sep + "khervecad" + os.sep in f.filename), None)
        if fr is not None:
            act.setProperty("kc_src", f"{os.path.basename(fr.filename)}:{fr.lineno}")
    return act
QtWidgets.QMenu.addAction = _addAction
app = QtWidgets.QApplication([])
app.setStyle("Fusion")
from khervecad import icons
NAMES = {}
_icon = icons.icon
def _named(name, color=None):
    ic = _icon(name, color)
    NAMES[ic.cacheKey()] = name
    return ic
icons.icon = _named
from khervecad.style import apply_style
apply_style(app)
from khervecad import language
language.install(app, "en")
from khervecad.mainwindow import MainWindow
win = MainWindow()
win.resize(1400, 900)
win.show()
app.processEvents()

def iname(ic):
    return NAMES.get(ic.cacheKey()) if ic is not None and not ic.isNull() else None

def act(a, path):
    if a.isSeparator():
        return {"sep": True}
    d = {"text": a.text()}
    ic = iname(a.icon())
    if ic: d["icon"] = ic
    sc = [s.toString() for s in a.shortcuts()]
    if sc: d["shortcut"] = sc
    if a.isCheckable():
        d["checkable"] = True
        d["checked"] = a.isChecked()
    if not a.isEnabled(): d["disabled"] = True
    if not a.isVisible(): d["hidden"] = True
    tip = a.toolTip()
    if tip and tip != a.text().replace("&", "").split("\t")[0]:
        d["tip"] = tip
    if a.statusTip(): d["status"] = a.statusTip()
    data = a.data()
    if isinstance(data, (str, int, float)) and not isinstance(data, bool):
        d["key"] = data
    args = a.property("kc_args")
    if args: d["args"] = json.loads(args)
    src = a.property("kc_src")
    if src: d["src"] = src
    if a.menu() is not None:
        title = a.text().replace("&&", "\0").replace("&", "").replace("\0", "&")
        d["menu"] = menu(a.menu(), path + [title])
    return d

def menu(m, path):
    try:
        m.aboutToShow.emit()
    except Exception:
        pass
    if path[-1:] == ["Open Recent"]:
        return {"dynamic": "recent"}
    if path[-1:] == ["My Library"]:
        fixed = []
        for a in m.actions():
            if a.isSeparator():
                break
            fixed.append(act(a, path))
        return {"dynamic": "my_library", "items": fixed}
    return [act(a, path) for a in m.actions()]

def toolbar(tb):
    items = []
    for a in tb.actions():
        w = tb.widgetForAction(a)
        if a.isSeparator():
            items.append({"sep": True}); continue
        kind = type(w).__name__ if w is not None else ""
        if kind == "GroupButton":
            items.append({"widget": "group", "key": w.key, "title": w.menu().title(),
                          "tip": w.toolTip(), "family": [act(x, []) for x in w.family]})
        elif isinstance(w, QtWidgets.QLabel):
            items.append({"widget": "label", "text": w.text()})
        elif isinstance(w, QtWidgets.QComboBox):
            items.append({"widget": "combo", "tip": w.toolTip(),
                          "items": [w.itemText(i) for i in range(w.count())]})
        elif isinstance(w, QtWidgets.QDoubleSpinBox):
            items.append({"widget": "spin", "tip": w.toolTip(), "value": w.value(),
                          "min": w.minimum(), "max": w.maximum(), "step": w.singleStep(),
                          "suffix": w.suffix(), "decimals": w.decimals()})
        else:
            d = act(a, [])
            if isinstance(w, QtWidgets.QToolButton) and \
                    w.toolButtonStyle() == QtCore.Qt.ToolButtonTextBesideIcon:
                d["textBeside"] = True
            items.append(d)
    return items

out = {"menus": [], "toolbars": {}}
for a in win.menuBar().actions():
    title = a.text()
    out["menus"].append({"title": title, "items": menu(a.menu(), [title.replace("&", "")])})
for tb in win.findChildren(QtWidgets.QToolBar):
    if tb.objectName() in ("tools_bar", "options_bar"):
        out["toolbars"][tb.objectName()] = toolbar(tb)

def nav(bar):
    res = []
    lay = bar.layout()
    for i in range(lay.count()):
        w = lay.itemAt(i).widget()
        if isinstance(w, QtWidgets.QFrame) and not isinstance(w, QtWidgets.QToolButton):
            res.append({"sep": True}); continue
        if isinstance(w, QtWidgets.QToolButton):
            key = next((k for k, b in bar.buttons.items() if b is w), "")
            d = {"key": key, "icon": iname(w.icon()), "tip": w.toolTip()}
            if w.isCheckable(): d["checkable"] = True; d["checked"] = w.isChecked()
            if w.autoRepeat(): d["repeat"] = True
            if w.menu() is not None:
                d["popup"] = "split" if w.popupMode() == QtWidgets.QToolButton.MenuButtonPopup else "instant"
                d["menu"] = [act(x, []) for x in w.menu().actions()]
            res.append(d)
    return res

out["nav2d"] = nav(win.view2d.nav_bar)
out["nav3d"] = nav(win.view3d.nav_bar)
bar = win.view3d.lighting_bar
out["lighting"] = {"rows": [{"key": k, "label": l, "tip": t} for k, l, t in bar._rows()],
                   "buttons": [{"icon": iname(b.icon()), "tip": b.toolTip()}
                               for b in bar.findChildren(QtWidgets.QToolButton)]}
b = win.builder
out["tabs"] = [b.tabText(i) for i in range(b.count())]
out["tab_tips"] = [b.tabToolTip(i) for i in range(b.count())]
out["docks"] = [{"title": d.windowTitle(), "object": d.objectName(),
                 "area": int(win.dockWidgetArea(d)), "visible": d.isVisible()}
                for d in win.findChildren(QtWidgets.QDockWidget)]
def kids(w, depth=0):
    d = {"cls": type(w).__name__}
    if w.objectName(): d["name"] = w.objectName()
    for attr in ("text", "title", "placeholderText"):
        f = getattr(w, attr, None)
        if callable(f):
            try:
                v = f()
                if isinstance(v, str) and v: d[attr] = v
            except Exception:
                pass
    if w.toolTip(): d["tip"] = w.toolTip()
    if isinstance(w, QtWidgets.QAbstractButton):
        ic = iname(w.icon())
        if ic: d["icon"] = ic
    if isinstance(w, QtWidgets.QTabWidget):
        d["tabs"] = [w.tabText(i) for i in range(w.count())]
    if isinstance(w, QtWidgets.QComboBox):
        d["items"] = [w.itemText(i) for i in range(w.count())]
    if not w.isVisible(): d["hidden"] = True
    ch = [c for c in w.children() if isinstance(c, QtWidgets.QWidget)
          and not isinstance(c, QtWidgets.QMenu)]
    if ch and depth < 30:
        d["kids"] = [kids(c, depth + 1) for c in ch]
    return d
out["panels"] = {"builder": kids(win.builder), "status": kids(win.statusBar()),
                 "docks": [kids(d) for d in win.findChildren(QtWidgets.QDockWidget)]}
json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=0)
win.grab().save(SHOT)
print("ui.json:", sum(1 for _ in json.dumps(out)), "chars;", len(NAMES), "icons")
'''


def export_ui(tree: Path, qt_python: str) -> None:
    UI_OUT.parent.mkdir(parents=True, exist_ok=True)
    SHOT_OUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "dump.py"
        script.write_text(DUMP)
        env = dict(os.environ, QT_QPA_PLATFORM="offscreen",
                   PYTHONDONTWRITEBYTECODE="1")
        subprocess.run([qt_python, str(script), str(tree), str(UI_OUT),
                        str(SHOT_OUT), tmp], check=True, env=env)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--source", default=str(HERE.parent / "KherveCAD"))
    ap.add_argument("--qt-python", default=None,
                    help="a Python with PyQt5 + qtawesome for the UI dump")
    args = ap.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        tree = Path(tmp)
        archive(Path(args.source), tree)
        version = version_of(Path(args.source))
        print("KherveCAD", version)
        export_package(tree, version)
        export_fonts()
        export_icons(tree)
        export_samples(tree)
        if args.qt_python:
            export_ui(tree, args.qt_python)
        else:
            print("ui.json kept (no --qt-python)")


if __name__ == "__main__":
    sys.exit(main())
