"""Tests of the headless desktop window (kcweb + qtshim) under CPython.

The desktop KherveCAD's Python (public/apps/khervecad/py/khervecad.zip,
with its data files beside it) runs on the headless Qt exactly as it does
in Pyodide: these drive it through kcweb.app.request the way the web side
does and check what comes back. Needs numpy. Run from the repository:

    python3 src/apps/khervecad/tests/headless_test.py

(or `node --test src/apps/khervecad/tests/python.test.mjs`). Nothing is
written outside a temporary folder (HOME points there).
"""

import json
import os
import shutil
import sys
import tempfile
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
PY = os.path.join(REPO, "public", "apps", "khervecad", "py")
TMP = tempfile.mkdtemp(prefix="kcweb-test-")
os.environ["HOME"] = TMP
os.environ["KHERVECAD_USER_LIBRARY"] = os.path.join(TMP, "lib")

# the desktop package as KherveOS ships it: the zip + its data files
with zipfile.ZipFile(os.path.join(PY, "khervecad.zip")) as z:
    z.extractall(TMP)
DATA = os.path.join(PY, "data", "khervecad")
for root, _dirs, files in os.walk(DATA):
    for f in files:
        src = os.path.join(root, f)
        dst = os.path.join(TMP, "khervecad", os.path.relpath(src, DATA))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if not os.path.exists(dst):
            try:
                os.symlink(src, dst)
            except OSError:
                shutil.copyfile(src, dst)
sys.path[:0] = [os.path.join(PY, "kcweb", "qtshim"), PY, TMP]

from PyQt5 import _core  # noqa: E402
from PyQt5.QtCore import QObject, QTimer, pyqtSignal, process_events  # noqa
from PyQt5.QtWidgets import QComboBox, QUndoCommand, QUndoStack  # noqa
from kcweb import app, ui  # noqa: E402

PKG = os.path.join(TMP, "khervecad")


def find(items, *path):
    """The action at a menu path of plain texts."""
    for it in items:
        text = (it.get("text") or "").replace("&&", "\0") \
            .replace("&", "").replace("\0", "&").split("\t")[0]
        if text == path[0]:
            if len(path) == 1:
                return it
            return find(it.get("menu") or [], *path[1:])
    raise KeyError(path)


class Shim(unittest.TestCase):
    def test_signals_drop_extra_arguments(self):
        class A(QObject):
            changed = pyqtSignal(int, str)

        got = []
        a = A()
        a.changed.connect(lambda n: got.append(n))
        a.changed.connect(lambda: got.append("none"))
        a.changed.emit(3, "x")
        self.assertEqual(got, [3, "none"])
        a.blockSignals(True)
        a.changed.emit(4, "y")
        self.assertEqual(got, [3, "none"])

    def test_timers_fire_on_the_next_turn(self):
        fired = []
        QTimer.singleShot(0, lambda: fired.append(1))
        self.assertEqual(fired, [])
        process_events()
        self.assertEqual(fired, [1])

    def test_undo_stack_merges_like_qt(self):
        class Cmd(QUndoCommand):
            def __init__(self, log, n):
                super().__init__("c")
                self.log, self.n = log, n

            def id(self):
                return 7

            def mergeWith(self, other):
                self.n += other.n
                return True

            def redo(self):
                self.log.append(("redo", self.n))

            def undo(self):
                self.log.append(("undo", self.n))

        log = []
        stack = QUndoStack()
        stack.push(Cmd(log, 1))
        stack.push(Cmd(log, 2))
        self.assertEqual(stack.count(), 1)
        stack.undo()
        self.assertEqual(log[-1], ("undo", 3))
        self.assertFalse(stack.canUndo())
        self.assertTrue(stack.canRedo())

    def test_combo_box_state_and_signals(self):
        box = QComboBox()
        seen = []
        box.currentIndexChanged.connect(seen.append)
        box.addItem("a", 1)
        box.addItem("b", 2)
        box.setCurrentIndex(1)
        self.assertEqual(box.currentData(), 2)
        self.assertEqual(seen, [0, 1])
        node = ui.serialize(box, force=True)
        self.assertEqual(node["t"], "combo")
        self.assertEqual(node["idx"], 1)

    def test_missing_desktop_attributes_raise(self):
        from PyQt5.QtWidgets import QWidget

        class Panel(QWidget):          # a desktop class
            pass

        _core.learn_attrs(PKG)
        w = Panel()
        self.assertIsNone(getattr(w, "_library_dialog", None))
        self.assertIsNone(getattr(w, "nav_bar", None))
        w.setMinimumWidth(10)          # a Qt call we model
        w.setWindowModified(True)      # one we do not: inert
        # a shim widget answers any Qt-looking name, even one the
        # desktop also uses for its own attributes (QImageReader.size)
        self.assertIsNotNone(getattr(QWidget(), "nav_bar", None))


class Window(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.boot = app.request({"boot": 1, "pkg": PKG})
        cls.menus = cls.boot["menubar"]["menus"]

    def req(self, *events, **extra):
        payload = dict(extra, events=list(events))
        out = app.request(payload)
        self.assertNotIn("fatal", out, out.get("trace"))
        self.assertFalse(out.get("errors"), out.get("errors"))
        return out

    def trigger(self, *path):
        menu = next(m for m in self.menus
                    if m["title"].replace("&", "") == path[0])
        return self.req({"op": "trigger",
                         "id": find(menu["items"], *path[1:])["id"]})

    def test_1_the_desktop_window_is_built(self):
        r = self.boot
        # the desktop's version, from the VERSION the export tool writes
        self.assertRegex(r["title"], r" — KherveCAD v0\.1\.\d+(\+\w+)?$")
        self.assertEqual([m["title"].replace("&", "")
                          for m in r["menubar"]["menus"]],
                         ["File", "Edit", "Insert", "Tools", "Library",
                          "View", "Analyse", "AI", "Git", "Help"])
        areas = [area for area, _bar in r["main"]["toolbars"]]
        self.assertEqual(sorted(areas), [1, 4])
        left = dict(r["main"]["toolbars"])[1]
        self.assertEqual(left["o"], 2)
        self.assertEqual(left["items"][0]["text"], "Select")
        self.assertTrue(left["items"][0]["chk"])
        top = dict(r["main"]["toolbars"])[4]
        groups = [i for i in top["items"] if i.get("t") == "tbutton"
                  and i.get("popup") == 1]
        self.assertEqual(len(groups), 7)  # extrude … logic families
        self.assertIn("v3", r)
        self.assertIn("sketch", r)

    def test_2_a_cube_becomes_an_object(self):
        out = self.trigger("Insert", "3D Solids", "Cube")
        self.assertTrue(out["dirty"])
        self.assertEqual(out["v3"]["mesh"]["n"], 12)
        self.assertTrue(any(j["kind"] == "render" for j in out["jobs"]))
        code = next(j["code"] for j in out["jobs"] if j["kind"] == "render")
        self.assertIn("cube([20, 20, 20]", code)
        # the Object tab opened on it, with Properties
        main = app.SESSION.win.builder
        self.assertIs(main.currentWidget(), main.object_tab)

    def test_3_a_question_waits_for_the_answer(self):
        out = self.trigger("File", "New")
        self.assertEqual(out["ask"]["kind"], "question")
        self.assertIn("Discard", out["ask"]["buttons"])
        out = app.request({"answer": {"clicked":
                                      out["ask"]["buttons"].index(
                                          "Discard")}})
        self.assertNotIn("ask", out)
        self.assertFalse(out["dirty"])
        self.assertEqual(len(app.SESSION.win.model.root.children), 0)

    def test_4_undo_brings_it_back(self):
        self.trigger("Insert", "3D Solids", "Sphere")
        win = app.SESSION.win
        self.assertEqual(len(win.model.root.children), 1)
        win.model.UNDO_MERGE_S = 0          # no merge with the next step
        self.trigger("Edit", "Delete")
        self.assertEqual(len(win.model.root.children), 1)  # nothing in Main
        win.builder.setCurrentIndex(0)
        process_events()
        win.builder.tree.select_nodes(list(win.model.root.children))
        self.trigger("Edit", "Delete")
        self.assertEqual(len(win.model.root.children), 0)
        self.trigger("Edit", "Undo")
        self.assertEqual(len(win.model.root.children), 1)

    def test_5_drawing_a_rectangle_in_the_sketch(self):
        win = app.SESSION.win
        win.builder.setCurrentIndex(0)
        before = len(list(win.model.root.walk()))
        rect = find(dict(self.boot["main"]["toolbars"])[1]["items"],
                    "Rectangle")
        self.req({"op": "trigger", "id": rect["id"]})
        v = win.view2d
        self.req({"op": "sk_view", "sx": 4, "sy": -4, "cx": 0, "cy": 0,
                  "w": 400, "h": 400})
        # scene (0,0) is the view's centre; 4 px per mm, y up
        self.req({"op": "sk_press", "x": 200, "y": 200, "button": 1,
                  "buttons": 1},
                 {"op": "sk_move", "x": 240, "y": 160, "buttons": 1},
                 {"op": "sk_release", "x": 240, "y": 160, "button": 1})
        rects = [n for n in win.model.root.walk() if n.type == "rect"]
        self.assertEqual(len(rects), 1)
        p = rects[0].params
        self.assertAlmostEqual(p["width"], 10.0)
        self.assertAlmostEqual(p["height"], 10.0)
        self.assertGreater(len(list(win.model.root.walk())), before)
        self.assertAlmostEqual(v.px_per_mm(), 4.0)

    def test_6_the_tree_selects_and_renames(self):
        win = app.SESSION.win
        tree = win.builder.active_tree()
        node = ui.serialize(tree, force=True)
        row = node["rows"][0]
        self.req({"op": "select", "id": tree._kc_id, "items": [row["i"]],
                  "cur": row["i"]})
        self.assertEqual(len(tree.selected_nodes()), 1)
        self.req({"op": "rename", "id": tree._kc_id, "item": row["i"],
                  "col": 0, "text": "Renamed"})
        self.assertEqual(tree.selected_nodes()[0].name, "Renamed")

    def test_7_desktop_mcp_tools(self):
        out = self.req({"op": "mcp", "name": "apply_code",
                        "args": {"code": "translate([40,0,0]) "
                                         "cylinder(h=10, r=5);  // Peg"},
                        "req": 1})
        result = out["mcp"][0]["result"]
        self.assertNotIn("error", result)
        out = self.req({"op": "mcp", "name": "list_tree", "args": {},
                        "req": 2})
        self.assertIn("Peg", json.dumps(out["mcp"][0]["result"]))
        out = self.req({"op": "mcp_list", "search": "apply", "req": 3})
        self.assertTrue(any(t["name"] == "apply_code"
                            for t in out["mcp"][0]["result"]["tools"]))

    def test_8_shortcuts_reach_the_actions(self):
        win = app.SESSION.win
        win.builder.setCurrentIndex(0)
        before = win.scene.show_grid
        self.req({"op": "shortcut", "keys": ["Ctrl+'"]})
        self.assertNotEqual(win.scene.show_grid, before)
        self.req({"op": "shortcut", "keys": ["C"]})
        self.assertEqual(win.scene.tool, "circle")

    def test_9_library_part_and_save(self):
        lib = next(m for m in self.menus if "Library" in m["title"])
        part = find(lib["items"], "Fasteners & brackets", "Fasteners",
                    "Hex nut, threaded (DIN 934)")
        win = app.SESSION.win
        win.builder.setCurrentIndex(0)
        before = len(win.model.root.children)
        self.req({"op": "trigger", "id": part["id"]})
        self.assertEqual(len(win.model.root.children), before + 1)
        path = os.path.join(TMP, "Documents", "test.kcad")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        out = self.trigger("File", "Save As...")
        self.assertEqual(out["ask"]["kind"], "save")
        out = app.request({"answer": {"path": path}})
        self.assertNotIn("ask", out)
        with open(path, encoding="utf-8") as fh:
            self.assertEqual(json.load(fh)["format"], "kcad")
        self.assertFalse(out["dirty"])

    def test_9y_menus_are_not_resent_unchanged(self):
        out = self.req()
        self.assertFalse(out.get("menubar", {}).get("menus"))
        app.SESSION.win._add_recent(os.path.join(TMP, "x.kcad"))
        out = self.req()
        titles = [m["title"] for m in out["menubar"]["menus"]]
        self.assertEqual(titles, ["&File"])

    def test_9z_properties_edit_a_parameter(self):
        win = app.SESSION.win
        win.builder.setCurrentIndex(0)
        self.trigger("Insert", "3D Solids", "Cube")      # opens the Object
        cube = [n for n in win.model.root.walk() if n.type == "cube"][-1]
        win.builder.object_tab.tree.select_nodes([cube])
        process_events()
        form = ui.serialize(win.properties, force=True)
        text = json.dumps(form)
        self.assertIn("Width (X)", text)
        # the field after the "Width (X)" label: an editable combo
        rows = []

        def collect(node):
            if isinstance(node, dict):
                if node.get("k") == "form":
                    rows.extend(node["rows"])
                for v in node.values():
                    collect(v)
            elif isinstance(node, list):
                for v in node:
                    collect(v)
        collect(form)
        field = next(f for l, f in rows if l and l.get("text") == "Width (X)")
        self.assertEqual(field["t"], "combo")
        self.req({"op": "combo_text", "id": field["id"], "text": "35"})
        self.assertEqual(cube.params["width"], 35.0)
        out = self.req({"op": "combo_text", "id": field["id"],
                        "text": "35 + 1"})
        self.assertEqual(cube.params["width"], "35 + 1")
        self.assertIn("v3", out)


if __name__ == "__main__":
    try:
        unittest.main(verbosity=1)
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
