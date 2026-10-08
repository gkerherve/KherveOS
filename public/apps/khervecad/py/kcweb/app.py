"""The desktop KherveCAD window, running headless in Pyodide.

`Session` builds the real `khervecad.mainwindow.MainWindow` on the
headless Qt (qtshim) — every menu, toolbar, panel, dialog and slot is
the desktop's own code — with three things swapped for the browser:

- the OpenSCAD engine (QProcess) for `WebEngine`, whose renders are
  handed to the web side (OpenSCAD compiled to WebAssembly, in a Web
  Worker) and whose results come back in a later request;
- the 3D view's painter/BSP machinery is idle (three.js draws), and
- worker threads run inline (Pyodide has none).

`Session.handle(request)` applies the web side's input events, runs the
event loop's due timers, and answers with what changed: the window's
widgets (kcweb.ui), the menus, open dialogs and pop-up menus, a modal
question (NeedInput), the 3D meshes, the 2D sketch, render jobs.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""

import base64
import json
import os
import sys
import threading
import traceback
from array import array

from PyQt5 import _core, _dialogs, _widgets
from PyQt5.QtCore import process_events
from PyQt5._widgets import QIcon

from . import ui

PKG_DIR = None


# --------------------------------------------------------------- patches

def _inline_threads():
    """Pyodide cannot start threads: run a thread's work at start()."""

    def start(self):
        try:
            self.run()
        except Exception:
            traceback.print_exc()

    threading.Thread.start = start
    threading.Thread.is_alive = lambda self: False
    threading.Thread.join = lambda self, *a, **k: None


def _patch_icons():
    from khervecad import icons
    icons.icon = lambda name, color=None: QIcon(name)
    icons.app_icon = lambda *a, **k: QIcon("kcad")


def _patch_window(session):
    """What a desktop window asks of the operating system, for KherveOS:
    another window, closing this one, showing a file in Files, opening a
    web page (webbrowser / QDesktopServices)."""
    import webbrowser
    from khervecad import mainwindow
    from PyQt5 import QtGui

    def new_window(self):
        session.os_requests.append({"op": "new_window"})

    def close(self):
        session.os_requests.append({"op": "close"})
        return True

    def show_in_explorer(self):
        path = getattr(self, "_path", None)
        if not path:
            from PyQt5.QtWidgets import QMessageBox
            from khervecad import APP_NAME, language
            QMessageBox.information(self, APP_NAME, language.tr(
                "Save the document first — there is no file to show yet."))
            return
        session.os_requests.append({"op": "reveal", "path": str(path)})

    def open_web(url, *a, **k):
        QtGui.OPENED_URLS.append(str(url))
        return True

    mainwindow.MainWindow.new_window = new_window
    mainwindow.MainWindow.close = close
    mainwindow.MainWindow._show_in_explorer = show_in_explorer
    webbrowser.open = webbrowser.open_new = webbrowser.open_new_tab = \
        open_web


def _patch_style():
    """View ▸ Theme: the desktop restyles the Qt application; here only
    its colour tokens change (tree colours, the 3D view's base colour) —
    KherveOS draws the window in its own theme."""
    from khervecad import icons, mainwindow, style

    def apply_style(app=None, name=None):
        style._current = name or style.saved_theme()
        t = style.tokens(style._current)
        _core.SETTINGS["theme"] = style._current
        _core.SETTINGS_DIRTY[0] = True
        icons.set_icon_color(t["icon"])

    style.apply_style = apply_style
    mainwindow.apply_style = apply_style


def _patch_updater():
    """Help ▸ Check for Updates: the desktop downloads its installer;
    here KherveCAD is updated with KherveOS itself."""
    from khervecad import updater

    def check_now(self):
        from PyQt5.QtWidgets import QMessageBox
        QMessageBox.information(
            self._window, "KherveCAD",
            "This is the desktop KherveCAD running inside KherveOS: it is "
            "updated together with KherveOS, so there is no installer to "
            "download here.")

    updater.Updater.check_now = check_now
    updater.Updater._start_check = lambda self, manual=False: None


def _patch_code_view():
    """The Code tab's Indent / Dedent buttons edit with QTextCursor; the
    web editor does the editing, so they become editor commands."""
    from khervecad import treepanel
    treepanel.CodeView.indent_selection = \
        lambda self: self._kc_cmd("indent")
    treepanel.CodeView.dedent_selection = \
        lambda self: self._kc_cmd("dedent")


def _patch_view3d():
    from khervecad import view3d
    view3d.View3D._start_bsp_build = lambda self: None
    view3d.View3D._gl_active = lambda self: True
    view3d.View3D.wait_for_bsp = lambda self, timeout=None: None


# ----------------------------------------------------------------- engine

JOBS = []           # render jobs waiting for the web side
_job_ids = iter(range(1, 1 << 62))


def _decode_tris(b64):
    """Triangles from little-endian float32 x,y,z ×3 per triangle."""
    data = array("f")
    data.frombytes(base64.b64decode(b64))
    if sys.byteorder != "little":
        data.byteswap()
    v = data.tolist()
    return [((v[i], v[i + 1], v[i + 2]), (v[i + 3], v[i + 4], v[i + 5]),
             (v[i + 6], v[i + 7], v[i + 8])) for i in range(0, len(v) - 8, 9)]


def _defines():
    """OpenSCAD -D variables (the animation's $t, engine.DEFINES)."""
    from khervecad import engine
    return {str(k): str(v) for k, v in engine.DEFINES.items()}


def _make_engine_class():
    from khervecad.engine import ScadEngine
    from PyQt5.QtCore import QObject

    class WebEngine(ScadEngine):
        """ScadEngine's interface over OpenSCAD in WebAssembly: a render
        becomes a job the web side runs in a worker; its answer comes
        back through `deliver`. Exports wait through NeedInput."""

        def __init__(self, parent=None):
            QObject.__init__(self, parent)
            self.binary = "openscad-wasm"
            self._dir = None
            self._process = None
            self._pending_code = None
            self._generation = 0
            self._running_generation = 0
            self._part_queue = {}
            self._running_part = None
            self._lanes = {}
            self.max_jobs = 1
            self.cache_dir = None
            self._timer = None
            self._inflight = {}           # job id -> job

        @property
        def available(self):
            return True

        @property
        def backend(self):
            return "Manifold"

        def refresh_binary(self):
            return self.binary

        def prune_cache(self, *a, **k):
            pass

        def _busy(self):
            return bool(self._inflight)

        def is_idle(self):
            return not self._inflight and self._pending_code is None \
                and not self._part_queue

        def request_render(self, scad_code):
            self._pending_code = scad_code
            self._generation += 1
            self._queue()

        def request_part_render(self, key, scad_code):
            if not key or key in self._part_queue or any(
                    j.get("key") == key for j in self._inflight.values()):
                return
            self._part_queue[key] = scad_code
            self._queue()

        def cancel_parts(self):
            self._part_queue.clear()

        def cancel(self):
            self._pending_code = None
            self._generation += 1

        def shutdown(self):
            self.cancel()
            self._part_queue.clear()

        def _queue(self):
            """Hand everything waiting to the web side (it debounces and
            runs one at a time; a newer whole render supersedes)."""
            if self._pending_code is not None:
                for jid in [j for j, job in self._inflight.items()
                            if job["kind"] == "render"]:
                    self._inflight.pop(jid)
                JOBS[:] = [j for j in JOBS if j["kind"] != "render"]
                job = {"id": next(_job_ids), "kind": "render",
                       "code": self._pending_code, "gen": self._generation,
                       "defines": _defines()}
                self._pending_code = None
                self._inflight[job["id"]] = job
                JOBS.append(job)
            for key, code in list(self._part_queue.items()):
                job = {"id": next(_job_ids), "kind": "part", "key": key,
                       "code": code, "gen": self._generation,
                       "defines": _defines()}
                self._inflight[job["id"]] = job
                JOBS.append(job)
            self._part_queue.clear()
            self.busy_changed.emit(self._busy())

        def deliver(self, jid, ok, tris_b64=None, stderr=""):
            job = self._inflight.pop(int(jid), None)
            self.busy_changed.emit(self._busy())
            if job is None:
                return
            if not ok:
                if job["kind"] == "render" and job["gen"] == self._generation:
                    self.render_failed.emit(stderr or "render failed")
                return
            tris = _decode_tris(tris_b64 or "")
            if job["kind"] == "part":
                self.part_ready.emit(job["key"], tris)
            elif job["gen"] == self._generation:
                self.mesh_ready.emit(tris)

        def export_mesh(self, scad_code, out_path):
            ext = os.path.splitext(str(out_path))[1].lower().lstrip(".") \
                or "stl"
            answer = _dialogs.ask({"kind": "openscad", "code": scad_code,
                                   "format": ext, "defines": _defines()})
            if not answer.get("ok"):
                return answer.get("error") or "OpenSCAD export failed"
            data = base64.b64decode(answer.get("data") or "")
            with open(out_path, "wb") as fh:
                fh.write(data)
            return ""

        def export_stl(self, scad_code, out_path):
            return self.export_mesh(scad_code, out_path)

        def export_png(self, scad_code, out_path, *a, **k):
            return ("OpenSCAD's picture export is not available in "
                    "KherveOS — use File ▸ Export PNG… (the 3D view).")

    return WebEngine


# ---------------------------------------------------------------- session

class Session:
    def __init__(self):
        self.win = None
        self.pending = None           # {"event", "answers", "spec"}
        self.outer = []               # actions waiting on a modal dialog
        self.mcp_results = []         # answers to AI tool calls
        self.os_requests = []         # new window, close, reveal a file…
        self.mesh_sent = None
        self.hi_sent = None
        self.clip_sent = ""
        self.menus_rev = -1
        self.errors = []

    # -- boot
    def boot(self, pkg_dir, settings=None, language="en"):
        global PKG_DIR
        PKG_DIR = pkg_dir
        _core.SETTINGS.clear()
        _core.SETTINGS.update(settings or {})
        _core.SETTINGS["language"] = language
        _core.learn_attrs(pkg_dir)
        _inline_threads()
        _patch_icons()
        _patch_view3d()
        from khervecad import language as lang
        from khervecad import mainwindow, style
        # KherveOS is dark: the desktop's Dark tokens unless a theme was
        # picked in View ▸ Theme
        style._current = str((settings or {}).get("theme") or "Dark")
        if style._current not in style.THEMES:
            style._current = "Dark"
        _patch_style()
        lang.install(_core.Inert(), language)
        mainwindow.ScadEngine = _make_engine_class()
        _patch_window(self)
        _patch_updater()
        _patch_code_view()
        from . import gview, sketch, view3d
        sketch.install()
        view3d.install()
        gview.install()
        self.win = mainwindow.MainWindow()
        ui.PRIMARY[0] = self.win
        self.win.resize(1400, 900)
        self.win.show()
        process_events()
        return self.respond(full=True)

    # -- running user input
    #: events that never open a dialog and are never replayed
    BACKGROUND = ("engine", "v3_camera", "sk_view", "resize", "tick",
                  "clipboard", "splitter", "mcp", "mcp_list", "gv_view",
                  "pw_size")

    def _run(self, fn, answers=()):
        """Run *fn* with *answers* queued for its modal dialogs. Returns
        None when it finished, else the NeedInput spec it stopped at
        (whatever it changed in the model first is rolled back)."""
        model = self.win.model
        before = model._last_state
        _dialogs.ANSWERS[:] = list(answers)
        try:
            fn()
            process_events()
            return None
        except _dialogs.NeedInput as need:
            try:
                process_events()
            except _dialogs.NeedInput:
                pass
            if model._serialize() != before:
                model.restore_state(before)
                try:
                    process_events()
                except _dialogs.NeedInput:
                    pass
            return need.spec
        except Exception as exc:
            self.errors.append(f"{type(exc).__name__}: {exc}")
            traceback.print_exc()
            try:
                process_events()
            except Exception:
                pass
            return None
        finally:
            _dialogs.ANSWERS[:] = []

    def _event(self, ev, answers=()):
        """A user action: run it; if it reaches a modal dialog, remember
        it to run again once the user has answered."""
        spec = self._run(lambda: self._apply(ev), answers)
        if spec is None:
            return
        if spec.get("kind") == "exec":
            dialog = spec["dialog"]
            dialog._kc_modal = True
            dialog._kc_shown = True
            dialog._kc_hidden = False
            dialog._kc_result = 0
            dialog._touch()
            self.outer.append({"event": ev, "answers": list(answers),
                               "dialog": dialog})
        else:
            self.ask_seq = getattr(self, "ask_seq", 0) + 1
            self.pending = {"event": ev, "answers": list(answers),
                            "spec": dict(spec, seq=self.ask_seq)}

    def answer(self, value):
        """The user answered the open question: run its action again."""
        pending, self.pending = self.pending, None
        if pending is not None:
            self._event(pending["event"], pending["answers"] + [value])

    def _close_modals(self):
        """A modal dialog the user closed: run the action that opened it
        again, with the dialog's answer (its widgets and how it closed)."""
        while self.outer:
            top = self.outer[-1]
            dialog = top["dialog"]
            if dialog._kc_shown and not dialog._kc_hidden:
                return
            self.outer.pop()
            self._event(top["event"], top["answers"] + [
                {"result": dialog._kc_result,
                 "state": ui.save_state(dialog)}])

    def _apply(self, ev):
        op = ev.get("op")
        win = self.win
        if op == "boot":
            return
        if op == "engine":
            win.engine.deliver(ev["job"], ev.get("ok"), ev.get("tris"),
                               ev.get("stderr", ""))
            return
        if op == "shortcut":
            for key in ev.get("keys") or [ev.get("key", "")]:
                if key and self._shortcut(key):
                    break
            return
        if op == "clipboard":
            from PyQt5.QtWidgets import CLIPBOARD
            CLIPBOARD.setText(ev.get("text", ""))
            self.clip_sent = CLIPBOARD.text()
            return
        if op == "open_path":
            win.open_any(ev["path"])
            return
        if op == "close_window":
            self.close_ok = bool(win._confirm_discard())
            return
        if op == "tick":
            return
        if op == "mcp":
            self.mcp_results.append({"req": ev.get("req"),
                                     "result": self._mcp(ev)})
            return
        if op == "mcp_list":
            from khervecad.mcp_schema import TOOLS
            text = str(ev.get("search") or "").lower()
            tools = [{"name": t["name"], "description": t["description"],
                      "arguments": t.get("input_schema", {})
                      .get("properties", {})}
                     for t in TOOLS if not text or text in t["name"]
                     or text in t["description"].lower()]
            self.mcp_results.append({"req": ev.get("req"),
                                     "result": {"tools": tools}})
            return
        if op == "settings_language":
            from khervecad import language
            language.set_language(ev["code"])
            return
        if op.startswith("sk_"):
            from . import sketch
            sketch.event(win, ev)
            return
        if op.startswith("v3_"):
            from . import view3d
            view3d.event(win, ev)
            return
        if op.startswith(("gv_", "pw_")):
            from . import gview
            gview.event(ev)
            return
        ui.dispatch(ev)

    def _mcp(self, ev):
        """One desktop MCP tool (mcp_tools.McpToolExecutor) on this
        window — what Claude Desktop reaches through the desktop's MCP
        bridge, here for KherveAI and KherveOS's MCP server."""
        from khervecad.mcp_tools import McpToolExecutor
        name = str(ev.get("name") or "")
        args = ev.get("args") or {}
        if not isinstance(args, dict):
            return {"error": "args must be an object"}
        before = self.win.model._last_state
        _dialogs.ANSWERS[:] = []
        try:
            result = McpToolExecutor(self.win).execute(name, args)
            process_events()
        except _dialogs.NeedInput as need:
            if self.win.model._serialize() != before:
                self.win.model.restore_state(before)
            return {"error": f"{name} stopped at a question for the user "
                             f"({need.spec.get('kind')}); do it in the "
                             "KherveCAD window instead."}
        return _plain_json(result)

    def _shortcut(self, key):
        """A key combination pressed in the window: the enabled action
        bound to it (menus first, then toolbars), as Qt resolves it."""
        seen = set()

        def actions_of(container):
            for a in container._kc_actions:
                if id(a) in seen:
                    continue
                seen.add(id(a))
                yield a
                if a._kc_menu is not None:
                    yield from actions_of(a._kc_menu)

        candidates = list(actions_of(self.win.menuBar()))
        for _area, bar in self.win._kc_toolbars:
            candidates += list(actions_of(bar))
        for a in candidates:
            if key in a._kc_shortcuts and a.isEnabled() and a._kc_visible:
                a.trigger()
                return True
        from PyQt5.QtWidgets import SHORTCUTS
        for s in SHORTCUTS:
            if s._kc_key == key and s._kc_enabled:
                s.activated.emit()
                return True
        return False

    # -- the request / response cycle
    def handle(self, request):
        self.errors = []
        if "answer" in request:
            self.answer(request["answer"])
        for ev in request.get("events", []):
            if ev.get("op") in self.BACKGROUND:
                self._run(lambda e=ev: self._apply(e))
            elif self.pending is None:
                self._event(ev)
            # else: a question is open and the web side shows it modal
        self._close_modals()
        return self.respond(full=request.get("full", False))

    def respond(self, full=False):
        win = self.win
        if full:
            ui.SENT.clear()
            self.mesh_sent = self.hi_sent = None
            self.menus_rev = -1
        out = {"title": win.windowTitle()}
        bar = ui.menubar(win.menuBar(), full=full)
        if bar["menus"] or full:
            out["menubar"] = bar
        out["main"] = self._main()
        out["windows"] = [ui.window(w) for w in ui.open_windows()]
        if self.pending is not None:
            out["ask"] = self.pending["spec"]
        popups = []
        while _widgets.POPUPS:
            menu, pos = _widgets.POPUPS.pop(0)
            try:
                menu.aboutToShow.emit()
            except Exception:
                pass
            popups.append({"id": menu._kc_id, "items": ui.menu_items(menu),
                           "pos": pos})
        if popups:
            out["popups"] = popups
        if _dialogs.MESSAGES:
            out["messages"] = [list(m) for m in _dialogs.MESSAGES]
            _dialogs.MESSAGES.clear()
        if JOBS:
            out["jobs"] = list(JOBS)
            JOBS.clear()
        from . import sketch, view3d
        v3 = view3d.state(win, self)
        if v3:
            out["v3"] = v3
        sk = sketch.state(win)
        if sk:
            out["sketch"] = sk
        if _core.SETTINGS_DIRTY[0]:
            out["settings"] = dict(_core.SETTINGS)
            _core.SETTINGS_DIRTY[0] = False
        from PyQt5.QtWidgets import CLIPBOARD
        if CLIPBOARD.text() != self.clip_sent:
            self.clip_sent = CLIPBOARD.text()
            out["clipboard"] = self.clip_sent
        if self.mcp_results:
            out["mcp"] = list(self.mcp_results)
            self.mcp_results.clear()
        from PyQt5 import QtGui
        if QtGui.OPENED_URLS:
            self.os_requests += [{"op": "url", "url": u}
                                 for u in QtGui.OPENED_URLS]
            QtGui.OPENED_URLS.clear()
        if self.os_requests:
            out["os"] = list(self.os_requests)
            self.os_requests.clear()
        close_ok = self.__dict__.pop("close_ok", None)
        if close_ok is not None:
            out["close_ok"] = close_ok
        out["dirty"] = bool(getattr(win, "_dirty", False))
        out["path"] = getattr(win, "_path", None)
        if self.errors:
            out["errors"] = list(self.errors)
        timers = [t for t in _core._PENDING if t._active and not t._single]
        if timers:
            out["tick"] = max(16, min(t._interval or 16 for t in timers))
        return out

    def _main(self):
        win = self.win
        node = {"toolbars": [[area, ui.serialize(bar)]
                             for area, bar in win._kc_toolbars],
                "central": ui.serialize(win._kc_central),
                "status": ui.serialize(win.statusBar()),
                "docks": [[area, d._kc_id, d._kc_title,
                           0 if d._kc_hidden else 1,
                           ui.serialize(d._kc_widget)
                           if not d._kc_hidden and d._kc_widget is not None
                           else None]
                          for area, d in win._kc_docks]}
        return node


def _plain_json(value, depth=0):
    """A tool result as plain JSON (images and odd objects as text)."""
    if depth > 40:
        return str(value)
    if isinstance(value, dict):
        return {str(k): _plain_json(v, depth + 1) for k, v in value.items()
                if not (isinstance(v, (bytes, bytearray)))}
    if isinstance(value, (list, tuple)):
        return [_plain_json(v, depth + 1) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


SESSION = Session()


def request(payload):
    """Entry point for the bridge: JSON in, JSON out."""
    req = json.loads(payload) if isinstance(payload, str) else payload
    if req.get("boot"):
        return SESSION.boot(req["pkg"], req.get("settings"),
                            req.get("language", "en"))
    return SESSION.handle(req)
