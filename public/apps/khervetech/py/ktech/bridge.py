"""The requests a technique app's page sends to Python, and the answers.

Same protocol as KherveFitting's kfweb.bridge (the page's FitBridge): the
page runs ``await ktech.bridge.run(<json>)`` with a batch of requests
``[{"op", "args"}]`` and reads the answers between the markers on stdout.

Every answer carries what changed on screen (``state``): the main plot (the
recorded matplotlib figure), the red lines, the sheet selector, the right
frame (the desktop's TechniqueOverview panel), every tool window whose
widgets changed, and the effects the page must show (messages, the
clipboard). A request that reached a modal dialog answers ``modal`` instead;
the page asks the user and sends the same request again with ``answers``.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0.
"""

from __future__ import annotations

import importlib
import importlib.util
import json
import os
import sys
import traceback

START = "\x02KT-JSON\x03"
END = "\x02/KT-JSON\x03"


class _S:
    frame = None
    tech = None
    plot_version = -1
    sent_frames: set = set()


S = _S()


def _fn(target):
    module, _, name = target.partition(':')
    return getattr(importlib.import_module(module), name)


# ------------------------------------------------------------------ set-up

def _patch():
    """The few desktop entry points the browser does differently."""
    from libraries.FileMenu import KFitting_IO
    from ktech import project
    KFitting_IO.open_kfitting_file = project.open_kfitting_file
    KFitting_IO._close_aux_windows = lambda window: (False, None)


def op_init(a):
    import wx
    from matplotlib._rec import reset_sent
    from ktech.frame import MainFrame
    from ktech.techniques import TECHS
    key = a['tech'].upper()
    if key not in TECHS:
        raise ValueError(f"Unknown technique {key}")
    for f in list(wx.frames()):
        f.Destroy()
    import ktech.compat  # noqa: F401
    _patch()
    tech = TECHS[key]
    if 'pandas' in tech.get('packages', []):
        ktech.compat.pandas_openpyxl()
    for m in tech['modules']:
        importlib.import_module(m)
    S.tech = tech
    S.frame = MainFrame(tech)
    reset_sent()
    S.plot_version = -1
    S.sent_frames = set()
    S.frame.select_sheet(None, from_user=False)
    return {'info': _info(), 'full': True}


def _info():
    """What the page needs to build the window: sections, technique help, menus."""
    from libraries.ToolsMenu import TechniqueTool
    from libraries.ViewMenu import TechniqueToolbar
    tech = S.tech
    sections, _opener = TechniqueToolbar._technique_sections(tech['key'])
    spec = next((t for t in TechniqueTool.TECHNIQUES if t['key'] == tech['prefix']), None)
    return {
        'key': tech['prefix'],
        'sections': [{'key': k, 'short': s, 'full': f,
                      'help': TechniqueToolbar.SECTION_HELP.get((tech['key'], k), f"{f} — open this "
                                                                f"{tech['key'].upper()} section in its own window")}
                     for k, s, f, *_g in sections],
        'icon': spec['icon'] if spec else f"Tech-{tech['prefix']}-3.png",
        'help': spec['help'] if spec else '',
        'noneIcon': TechniqueTool.NO_TECHNIQUE_ICON,
        'noneHelp': TechniqueTool.NO_TECHNIQUE_HELP,
        'imports': [x if x == '-' else {'label': x[0], 'id': x[1]} for x in tech['imports']],
        'menuLabel': tech['menu_label'],
        'toolsLabel': tech['tools_label'],
        'exts': tech['exts'],
    }


# ------------------------------------------------------------------ the state the page shows

def state(full=False):
    import wx
    from matplotlib._rec import begin_arrays, end_arrays, serialise_figure
    w = S.frame
    out = {}
    begin_arrays()
    try:
        for i, line in ((1, w.vline1), (2, w.vline2)):
            if line is not None:
                line.tags['vline'] = i
        fig = w.figure
        if full or fig.version != S.plot_version:
            from matplotlib._rec import current_arrays
            out['main'] = serialise_figure(fig, current_arrays())
            S.plot_version = fig.version
        out['vlines'] = {str(k): v for k, v in w.vline_positions().items()}
        out['rangeActive'] = w.range_active()
        names = w.sheet_names()
        out['sheets'] = names
        out['sheet'] = w.sheet_combobox.GetValue()
        out['file'] = w.Data.get('FilePath', '') or ''
        spec = w.technique_tool_spec
        out['technique'] = {'key': spec['key'], 'icon': spec['icon'], 'help': spec['help']} if spec else None
        if full or w._dirty:
            out['right'] = w.grid_notebook._serial()
            w._dirty = False
        frames = wx.frames()
        out['open'] = [f._uid for f in frames]
        out['frames'] = [wx.serialise_frame(f) for f in frames if full or f._dirty or f._uid not in S.sent_frames]
        S.sent_frames = {f._uid for f in frames}
        out['canUndo'] = bool(w.history)
        out['canRedo'] = bool(w.redo_stack)
        out['status'] = w.status[0]
    finally:
        out['arrays'] = end_arrays()
    out['effects'] = wx.take_effects()
    return out


# ------------------------------------------------------------------ operations

def op_state(a):
    from matplotlib._rec import reset_sent
    if a.get('full'):
        reset_sent()
    return {'full': bool(a.get('full'))}


def op_open(a):
    """Open a .kfit project, or import a technique file (the desktop's menu entry, with this path)."""
    from ktech import project
    import wx
    paths = a.get('paths') or [a['path']]
    first = paths[0]
    if first.lower().endswith('.kfit'):
        project.open_kfitting_file(S.frame, first)
        return {}
    if first.lower().endswith('.xlsx'):
        project.open_xlsx_file(S.frame, first)
        return {}
    ext = os.path.splitext(first)[1].lower()
    for exts, target, combined in S.tech['open_paths']:
        if ext in exts:
            fn = _fn(target)
            if combined == 'dialog':
                # the File > Import entry, its file dialog answered with these paths
                wx._Loop.answers.insert(0, {'id': wx.ID_OK, 'paths': list(paths)})
                fn(S.frame)
            elif combined is None:
                fn(S.frame, paths)
            else:
                proj = _fn(S.tech.get('project_path', 'libraries.FileMenu.TGA_Import:_project_path_for'))
                fn(S.frame, paths, proj(paths, combined))
            return {}
    raise ValueError(f"{os.path.basename(first)}: not a file this app imports ({', '.join(S.tech['exts'])}).")


def op_menu(a):
    """A File > Import entry: the desktop function behind it (it asks for the files itself)."""
    target = a['id']
    allowed = {x[1] for x in S.tech['imports'] if x != '-'}
    if target not in allowed:
        raise ValueError(f"Not a menu entry of this app: {target}")
    _fn(target)(S.frame)
    return {}


def op_tool(a):
    """The technique button / Tools menu / a section tile."""
    full, section = S.tech['tool']
    if a.get('section'):
        _fn(section)(S.frame, a['section'])
    else:
        _fn(full)(S.frame)
    return {}


def op_event(a):
    import wx
    wx.apply_event(a['msg'])
    return {}


def op_select(a):
    S.frame.select_sheet(a['sheet'])
    return {}


def op_vline(a):
    S.frame.vline_moved(int(a['which']), float(a['x']), bool(a.get('final')))
    return {}


def op_undo(a):
    return {'nothing': not S.frame.undo()}


def op_redo(a):
    return {'nothing': not S.frame.redo()}


def op_save(a):
    """Quick Save / Save As: the project as .kfit (KFitting_IO.write_kfitting)."""
    from libraries.FileMenu.KFitting_IO import write_kfitting
    w = S.frame
    path = a.get('path') or w.Data.get('FilePath') or ''
    if not path:
        raise ValueError("No file path: use Save As.")
    if not path.lower().endswith('.kfit'):
        path = os.path.splitext(path)[0] + '.kfit'
    write_kfitting(w, path)
    w.Data['FilePath'] = path
    return {'path': path}


def op_new(a):
    from libraries.ConfigFile import Init_Measurement_Data
    w = S.frame
    for f in list(__import__('wx').frames()):
        f.Close()
    w.Data = Init_Measurement_Data(w)
    w.history, w.redo_stack = [], []
    w.plot_config.forget()
    w.sync_sheet_list()
    w.select_sheet(None, from_user=False)
    return {}


def op_sheet(a):
    """Edit > Sheet: rename / delete / copy / paste (Sheet_Operations, the parts a technique sheet uses)."""
    from ktech import project
    return project.sheet_action(S.frame, a['action'], a.get('sheet'), a.get('name'))


def op_table(a):
    """The columns of a sheet, for Export > data (TXT / CSV / DAT)."""
    from ktech import project
    return {'table': project.sheet_table(S.frame, a.get('sheet') or S.frame.sheet_combobox.GetValue())}


def op_results(a):
    from ktech import project
    return {'results': project.results(S.frame, a.get('sheet'))}


def op_display(a):
    """The display toggles of the vertical toolbar: legend on / off, y axis values / hidden / 'a.u.'."""
    w = S.frame
    if 'legend' in a:
        w.legend_visible = 1 if a['legend'] else 0
    if 'yAxis' in a:
        w.y_axis_state = int(a['yAxis'])
    w.clear_and_replot()
    w.show_hide_vlines()
    return {}


def op_drive(a):
    """The AI tools: set a tool window's controls and press one of its buttons, as a user would."""
    from ktech import project
    return project.drive(S.frame, S.tech, a)


OPS = {
    'init': op_init, 'state': op_state, 'open': op_open, 'menu': op_menu, 'tool': op_tool, 'event': op_event,
    'select': op_select, 'vline': op_vline, 'undo': op_undo, 'redo': op_redo, 'save': op_save, 'new': op_new,
    'sheet': op_sheet, 'table': op_table, 'results': op_results, 'drive': op_drive, 'display': op_display,
}

#: requests that may read or write a project or workbook (the technique's own packages load first)
DATA_OPS = {'init', 'open', 'menu', 'event', 'drive', 'save', 'tool'}

NEEDS = {'open': ['h5py'], 'save': ['h5py'], 'event': ['h5py'], 'menu': ['h5py'], 'drive': ['h5py'],
         'sheet': ['h5py'], 'undo': ['h5py'], 'redo': ['h5py']}


async def ensure(names):
    missing = []
    for n in names:
        if n in sys.modules:
            continue
        try:
            importlib.util.find_spec(n)
            if importlib.util.find_spec(n) is None:
                missing.append(n)
        except (ImportError, ValueError):
            missing.append(n)
    if not missing:
        return
    try:
        import pyodide_js
        from pyodide.ffi import to_js
    except ImportError:
        return
    await pyodide_js.loadPackage(to_js(missing))
    importlib.invalidate_caches()


async def run(requests_json):
    import wx
    requests = json.loads(requests_json)
    answers = []
    for req in requests:
        op = req.get('op')
        args = req.get('args') or {}
        full = False
        try:
            tech = S.tech
            if op == 'init':
                from ktech.techniques import TECHS
                tech = TECHS.get(str(args.get('tech', '')).upper())
            extra = (tech or {}).get('packages', []) if op in DATA_OPS else []
            await ensure(['numpy', 'scipy'] + NEEDS.get(op, []) + extra)
            fn = OPS.get(op)
            if fn is None:
                raise ValueError(f"Unknown request: {op}")
            if op != 'init' and S.frame is None:
                raise ValueError("The technique engine is not started.")
            wx.set_answers(args.get('answers'))
            try:
                ans = fn(args) or {}
                wx.run_after()
            except wx.NeedModal as m:
                wx.run_after()
                ans = {'modal': m.spec}
            full = bool(ans.pop('full', False))
            ans['ok'] = True
        except Exception as e:  # every failure goes back to the page as text
            ans = {'ok': False, 'error': f"{type(e).__name__}: {e}", 'trace': traceback.format_exc()}
            try:
                wx.run_after()
            except Exception:
                pass
        if S.frame is not None:
            try:
                ans['state'] = state(full)
            except Exception as e:
                ans['stateError'] = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
        answers.append(ans)
    sys.stdout.write(START + json.dumps(answers, allow_nan=False, default=_json_default) + END + "\n")


def _json_default(o):
    if hasattr(o, 'tolist'):
        return o.tolist()
    if isinstance(o, float):
        return None
    return str(o)
