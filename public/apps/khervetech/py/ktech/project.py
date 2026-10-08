"""Opening projects, the Edit > Sheet actions, data export and the AI driver.

``open_kfitting_file`` replaces KFitting_IO.open_kfitting_file (whose wx
console, recent-files menu and backup timer have no place here) with the
same steps: read the .kfit (KFitting_IO.read_kfitting, unchanged), adopt
window.Data, fill the sheet selector, select the first sheet, start the undo
history.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0.
"""

from __future__ import annotations

import os

import numpy as np
import wx


def open_kfitting_file(window, file_path=None):
    from libraries.FileMenu.KFitting_IO import KFITTING_WILDCARD, read_kfitting
    if file_path is None:
        with wx.FileDialog(window, "Open KherveFitting HDF5 file", wildcard=KFITTING_WILDCARD,
                           style=wx.FD_OPEN | wx.FD_FILE_MUST_EXIST) as dlg:
            if dlg.ShowModal() != wx.ID_OK:
                return
            file_path = dlg.GetPath()
    window.SetStatusText(f"Selected File: {file_path}", 0)
    window.history, window.redo_stack = [], []
    data = read_kfitting(file_path)
    window.Data = data
    window.Data['FilePath'] = file_path
    names = list(window.Data.get('Core levels', {}).keys())
    if not names:
        wx.MessageBox("This .kfit file contains no core levels.", "Open KFitting File", wx.OK | wx.ICON_WARNING)
        return
    window.plot_config.forget()
    window.sync_sheet_list(names[0])
    window.select_sheet(names[0], from_user=False)
    window.save_state()
    window.refresh_tools()
    wx.effect('opened', path=file_path)


# ------------------------------------------------------------------ Edit > Sheet

def _unique(name, used):
    taken = {str(n).upper() for n in used}
    if name.upper() not in taken:
        return name
    i = 1
    while f"{name}{i}".upper() in taken:
        i += 1
    return f"{name}{i}"


def _persist(window):
    try:
        from libraries.FileMenu.KFitting_IO import persist_project
        persist_project(window)
    except Exception as e:
        print(f'persist skipped: {e}')


def sheet_action(window, action, sheet=None, name=None):
    levels = window.Data.get('Core levels', {})
    sheet = sheet or window.sheet_combobox.GetValue()
    if sheet not in levels:
        raise ValueError(f"No sheet {sheet!r}.")
    if action == 'rename':
        new = (name or '').strip()
        if not new or len(new.split()) > 1:
            raise ValueError("Only a single word is allowed for sheet names or core levels.")
        if new in levels and new != sheet:
            raise ValueError(f"A sheet named {new} already exists.")
        window.save_state()
        window.Data['Core levels'] = {(new if k == sheet else k): v for k, v in levels.items()}
        window.Data['Core levels'][new]['Name'] = new
        for k, v in window.Data['Core levels'].items():
            for key in ('TGA_Parent', 'BET_Source_Sheet'):
                if isinstance(v, dict) and v.get(key) == sheet:
                    v[key] = new
        window.plot_config.forget(sheet)
        window.sync_sheet_list(new)
        window.select_sheet(new, from_user=False)
    elif action == 'delete':
        if len(levels) <= 1:
            raise ValueError("A project keeps at least one sheet.")
        window.save_state()
        names = list(levels)
        i = names.index(sheet)
        del levels[sheet]
        window.Data['Number of Core levels'] = len(levels)
        window.plot_config.forget(sheet)
        rest = list(levels)
        window.sync_sheet_list(rest[min(i, len(rest) - 1)])
        window.select_sheet(rest[min(i, len(rest) - 1)], from_user=False)
    elif action == 'sort':
        # Toolbar "Sort": the sheets in name order (natural: TGA2 before TGA10)
        import re
        window.save_state()
        key = lambda n: [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', str(n))]
        window.Data['Core levels'] = {k: levels[k] for k in sorted(levels, key=key)}
        window.sync_sheet_list(sheet)
        window.select_sheet(sheet, from_user=False)
    elif action == 'copy':
        import copy
        window.save_state()
        base = sheet.rstrip('0123456789') or sheet
        new = _unique(base, levels)
        levels[new] = copy.deepcopy(levels[sheet])
        levels[new]['Name'] = new
        window.Data['Number of Core levels'] = len(levels)
        window.sync_sheet_list(new)
        window.select_sheet(new, from_user=False)
    else:
        raise ValueError(f"Unknown sheet action {action}")
    window.refresh_tools()
    _persist(window)
    return {'sheet': window.sheet_combobox.GetValue()}


# ------------------------------------------------------------------ data export

def sheet_table(window, sheet_name):
    """Columns of a sheet: its x and y, then every per-point trace of the same length."""
    from libraries.Plot_Operations import axis_labels_for_sheet, plain_axis_label
    cl = window.Data.get('Core levels', {}).get(sheet_name)
    if not isinstance(cl, dict):
        raise ValueError(f"No sheet {sheet_name!r}.")
    x = list(cl.get('B.E.', []))
    xl, yl = axis_labels_for_sheet(window, sheet_name)
    if sheet_name.upper().startswith('TGA'):
        xl, yl = cl.get('TGA_X_Label', xl), cl.get('TGA_Y_Label', yl)
    cols = [(plain_axis_label(xl), x), (plain_axis_label(yl), list(cl.get('Raw Data', [])))]
    for key, values in cl.items():
        if key in ('B.E.', 'Raw Data') or not isinstance(values, list) or len(values) != len(x) or not x:
            continue
        if all(isinstance(v, (int, float)) or v is None for v in values[:50]):
            cols.append((key, values))
    return {'columns': [c[0] for c in cols], 'data': [[_f(v) for v in c[1]] for c in cols]}


def _f(v):
    try:
        f = float(v)
        return f if np.isfinite(f) else None
    except (TypeError, ValueError):
        return None


# ------------------------------------------------------------------ results (AI)

RESULT_KEYS = ('TGA_Steps', 'TGA_DTG_Peaks', 'TGA_DSC_Peaks', 'TGA_Events', 'TGA_Cycles', 'TGA_Glass_Transitions',
               'TGA_Oxygen_Result', 'TGA_Kinetic_Model', 'TGA_Kinetic_R2', 'TGA_Arrhenius_Ea_kJ', 'TGA_Arrhenius_R2',
               'TGA_Sample_Mass_mg', 'TGA_Label', 'TGA_View', 'TGA_Y_Unit', 'TGA_Smoothing')
DROP = ('t_selected', 'y_selected', 'baseline', 'pre_line', 'post_line', 'fitted', 't_relative')


def _slim(v, depth=0):
    if isinstance(v, dict):
        return {k: _slim(x, depth + 1) for k, x in v.items() if k not in DROP}
    if isinstance(v, (list, tuple)):
        if len(v) > 60 and all(isinstance(x, (int, float)) for x in v[:10]):
            return f"[{len(v)} values]"
        return [_slim(x, depth + 1) for x in v]
    if isinstance(v, float):
        return round(v, 6) if np.isfinite(v) else None
    return v


def results(window, sheet_name=None):
    import json
    sheet_name = sheet_name or window.sheet_combobox.GetValue()
    cl = window.Data.get('Core levels', {}).get(sheet_name)
    if not isinstance(cl, dict):
        raise ValueError(f"No sheet {sheet_name!r}.")
    out = {'sheet': sheet_name}
    for key in RESULT_KEYS:
        if cl.get(key) not in (None, [], {}):
            out[key] = _slim(cl[key])
    if cl.get('BET_Results'):
        try:
            out['BET_Results'] = _slim(json.loads(cl['BET_Results']))
        except ValueError:
            pass
    x = cl.get('B.E.') or []
    out['points'] = len(x)
    if x:
        out['x_range'] = [round(float(min(x)), 4), round(float(max(x)), 4)]
    bg = cl.get('Background') or {}
    if isinstance(bg.get('Bkg Low'), (int, float)):
        out['range'] = [bg['Bkg Low'], bg.get('Bkg High')]
    return out


# ------------------------------------------------------------------ the AI driver

def _set(widget, value):
    if isinstance(widget, (wx.SpinCtrl,)):
        widget.SetValue(value)
    elif isinstance(widget, wx.CheckBox):
        widget.SetValue(bool(value))
    elif isinstance(widget, wx.RadioButton):
        widget.SetValue(bool(value))
    elif isinstance(widget, wx.ComboBox):
        if isinstance(value, int):
            widget.SetSelection(value)
        else:
            i = widget.FindString(str(value))
            if i == wx.NOT_FOUND:
                match = [n for n, s in enumerate(widget.GetStrings()) if s.split('  -  ')[0] == str(value)]
                if not match:
                    raise ValueError(f"{value!r} is not one of {widget.GetStrings()}")
                i = match[0]
            widget.SetSelection(i)
    elif isinstance(widget, (wx.Choice, wx.ListBox, wx.RadioBox)):
        if isinstance(value, int):
            widget.SetSelection(value)
        elif not widget.SetStringSelection(str(value)):
            low = [s.lower() for s in widget.GetStrings()]
            if str(value).lower() in low:
                widget.SetSelection(low.index(str(value).lower()))
            else:
                raise ValueError(f"{value!r} is not one of {widget.GetStrings()}")
    elif isinstance(widget, wx.TextCtrl):
        widget.ChangeValue('' if value is None else str(value))
    elif isinstance(widget, wx.CheckListBox):
        widget.SetCheckedItems([int(v) for v in value])
    else:
        raise ValueError(f"Cannot set a {type(widget).__name__}")


def _read(widget):
    if isinstance(widget, wx.grid.Grid if hasattr(wx, 'grid') else ()):
        cols = [widget.GetColLabelValue(c) for c in range(widget.GetNumberCols())]
        return [dict(zip(cols, [widget.GetCellValue(r, c) for c in range(len(cols))]))
                for r in range(widget.GetNumberRows())]
    for getter in ('GetValue', 'GetLabel'):
        fn = getattr(widget, getter, None)
        if fn:
            return fn()
    return None


def drive(window, tech, a):
    """Open the tool window (or a section), set controls by attribute name, call a handler, read results.

    ``set``    {attribute: value} of the window's own controls (e.g. relp_lo_ctrl)
    ``call``   the handler method to run (e.g. on_fit_bet), as a button press would
    ``read``   attributes to read back (text boxes, labels, grids)
    ``sheet``  select this sheet on the main plot first
    ``range``  [low, high] for the red lines (the stored Bkg Low / Bkg High of the sheet)
    """
    import wx.grid  # noqa: F401
    from ktech.bridge import _fn
    if a.get('sheet'):
        if a['sheet'] not in window.Data.get('Core levels', {}):
            raise ValueError(f"No sheet {a['sheet']!r}. Sheets: {', '.join(window.sheet_names())}")
        window.select_sheet(a['sheet'])
    win = getattr(window, tech['window_attr'], None)
    if win is None or not win:
        _fn(tech['tool'][0])(window)
        wx.run_after()
        win = getattr(window, tech['window_attr'], None)
    if win is None:
        raise ValueError("The analysis window did not open.")
    if a.get('sheet'):
        for name in ('refresh_sheet_lists', 'refresh_sheet_list'):
            if hasattr(win, name):
                getattr(win, name)()
                break
        for combo_attr in ('sheet_combo', 'run_combo', 'mass_combo', 'heatflow_combo'):
            combo = getattr(win, combo_attr, None)
            if combo is None:
                continue
            for i, s in enumerate(combo.GetStrings()):
                if s.split('  -  ')[0] == a['sheet']:
                    combo.SetSelection(i)
        if hasattr(win, 'load_sheet_into_ui'):
            win.load_sheet_into_ui()
    rng = a.get('range')
    if rng and len(rng) == 2 and rng[0] is not None and rng[1] is not None:
        if hasattr(win, '_set_range'):
            win._set_range(float(rng[0]), float(rng[1]))
        else:
            cl = window.Data['Core levels'].get(window.sheet_combobox.GetValue(), {})
            bg = cl.setdefault('Background', {})
            bg['Bkg Low'], bg['Bkg High'] = min(map(float, rng)), max(map(float, rng))
    for attr, value in (a.get('set') or {}).items():
        widget = getattr(win, attr, None)
        if widget is None:
            raise ValueError(f"The window has no control {attr!r}.")
        _set(widget, value)
    wx.take_effects()
    if a.get('call'):
        handler = getattr(win, a['call'], None)
        if handler is None:
            raise ValueError(f"The window has no action {a['call']!r}.")
        import inspect
        try:
            takes_event = bool(inspect.signature(handler).parameters)
        except (TypeError, ValueError):
            takes_event = True
        if takes_event:
            handler(wx.Event(wx.EVT_BUTTON, win))
        else:
            handler()
        wx.run_after()
    effects = wx.take_effects()
    messages = [f"{e.get('title')}: {e.get('message')}" for e in effects if e.get('kind') in ('message', 'tip')]
    for e in effects:
        wx.effect(e.pop('kind'), **e)
    out = {'messages': messages}
    readouts = {}
    for attr in a.get('read') or []:
        widget = getattr(win, attr, None)
        if widget is not None:
            readouts[attr] = _read(widget)
    out['read'] = readouts
    out['sheet'] = window.sheet_combobox.GetValue()
    return out
