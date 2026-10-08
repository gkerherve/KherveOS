"""The desktop's widgets as JSON for the web side, and user input back.

`serialize(widget)` turns a headless widget (qtshim) into a node the
React renderer (src/apps/khervecad/qt) draws; a subtree the web side
already has (same revision) is sent as {"id", "same": 1}. `dispatch`
applies one input event to its widget the way Qt would deliver it, so
the desktop's own slots run.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""

import re
import weakref

from PyQt5 import _core, _graphics, _views, _widgets
from PyQt5._dialogs import QDialog, QDialogButtonBox, QMessageBox
from PyQt5._widgets import (QAbstractButton, QAction, QCheckBox,
                            QComboBox, QDockWidget, QDoubleSpinBox, QFrame,
                            QGroupBox, QLabel, QLayout, QLineEdit, QMenu,
                            QMenuBar, QProgressBar, QPushButton,
                            QRadioButton, QScrollArea, QSlider, QSpinBox,
                            QSplitter, QStackedWidget, QStatusBar,
                            QTabWidget, QTextEdit, QToolBar, QToolButton,
                            QWidget, QAbstractSlider, QFormLayout,
                            QGridLayout, QBoxLayout)

#: ids of items (tree/list/table rows) -> item
ITEMS = weakref.WeakValueDictionary()
_item_ids = iter(range(1, 1 << 62))

#: widget id -> revision last sent to the web side
SENT = {}

#: widget classes drawn by a dedicated component on the web side
CUSTOM = {}
#: extra revisions a widget depends on (a graphics view's scene items)
REV_HOOKS = []
#: [(test(widget), node(widget))] for widgets that paint themselves
PAINTERS = []


def item_id(item):
    iid = item.__dict__.get("_kc_iid")
    if iid is None:
        iid = item._kc_iid = next(_item_ids)
        ITEMS[iid] = item
    return iid


def icon_name(icon):
    return getattr(icon, "_kc_name", None) if icon is not None else None


def _font_flags(font):
    if font is None:
        return {}
    out = {}
    if getattr(font, "_italic", False):
        out["it"] = 1
    if getattr(font, "_bold", False):
        out["b"] = 1
    return out


def _rich(text):
    return bool(re.search(r"<[a-zA-Z/][^>]*>", text or ""))


# ------------------------------------------------------------------ revs

def _subtree_rev(w, seen=None):
    """The newest revision anywhere in *w*'s visible subtree."""
    rev = w.__dict__.get("_kc_rev", 0)
    for c in w.__dict__.get("_kc_children", ()):
        if not c.__dict__.get("_kc_hidden", False):
            r = _subtree_rev(c)
            if r > rev:
                rev = r
    lay = w.__dict__.get("_kc_layout")
    if lay is not None:
        r = _layout_rev(lay)
        if r > rev:
            rev = r
    for a in w.__dict__.get("_kc_actions", ()):
        r = _action_rev(a)
        if r > rev:
            rev = r
    for hook in REV_HOOKS:
        r = hook(w)
        if r > rev:
            rev = r
    return rev


def _layout_rev(lay):
    rev = lay.__dict__.get("_kc_rev", 0)
    for item in lay._kc_items:
        if item.kind == "l":
            r = _layout_rev(item.obj)
            if r > rev:
                rev = r
    return rev


def _action_rev(a):
    rev = a.__dict__.get("_kc_rev", 0)
    menu = a.__dict__.get("_kc_menu")
    if menu is not None:
        r = menu.__dict__.get("_kc_rev", 0)
        if r > rev:
            rev = r
        for sub in menu._kc_actions:
            r = _action_rev(sub)
            if r > rev:
                rev = r
    return rev


# --------------------------------------------------------------- actions

def action(a, deep=True):
    """A QAction as a menu / toolbar entry."""
    if a.isSeparator():
        node = {"id": a._kc_id, "sep": 1}
        if a._kc_text:
            node["text"] = a._kc_text
        return node
    node = {"id": a._kc_id, "text": a._kc_text}
    ic = icon_name(a._kc_icon)
    if ic:
        node["icon"] = ic
    if a._kc_shortcuts:
        node["sc"] = list(a._kc_shortcuts)
    if a._kc_checkable:
        node["ck"] = 1
        if a._kc_checked:
            node["chk"] = 1
    if not a.isEnabled():
        node["dis"] = 1
    if not a._kc_visible:
        node["hid"] = 1
    if a._kc_tip:
        node["tip"] = a._kc_tip
    if a._kc_status:
        node["st"] = a._kc_status
    if a._kc_data is not None and isinstance(a._kc_data, (str, int, float)):
        node["key"] = a._kc_data
    menu = a._kc_menu
    if menu is not None and deep:
        node["menu"] = menu_items(menu)
        if menu._kc_icon is not None and not ic:
            node["icon"] = icon_name(menu._kc_icon)
    return node


_MENU_CACHE = {}


def menu_items(menu):
    """A QMenu's entries; unchanged menus come from a cache (the
    Library menu alone has ~2,700)."""
    rev = max([menu.__dict__.get("_kc_rev", 0)] +
              [_action_rev(a) for a in menu._kc_actions])
    hit = _MENU_CACHE.get(menu._kc_id)
    if hit is not None and hit[0] == rev:
        return hit[1]
    items = [action(a) for a in menu._kc_actions]
    _MENU_CACHE[menu._kc_id] = (rev, items)
    return items


#: menus that fill themselves: menu id -> (what they showed, actions, rev)
_DYNAMIC = {}


def _signature(actions):
    return tuple((a._kc_text, a._kc_sep, a._kc_checked, a.isEnabled(),
                  _signature(a._kc_menu._kc_actions)
                  if a._kc_menu is not None else None) for a in actions)


def _about_to_show(menu):
    """Menus that fill themselves when opened (Open Recent, My Library,
    Cut at a Storey): the web menu bar has no "opening" moment, so they
    are asked with every answer. When they come out the same, the actions
    they had are put back, so the menu (and its ids) does not change."""
    if menu.aboutToShow._slots:
        try:
            menu.aboutToShow.emit()
        except Exception:
            pass
        sig = _signature(menu._kc_actions)
        prev = _DYNAMIC.get(menu._kc_id)
        if prev is not None and prev[0] == sig:
            menu._kc_actions = list(prev[1])
            menu.__dict__["_kc_rev"] = prev[2]
        else:
            _DYNAMIC[menu._kc_id] = (sig, list(menu._kc_actions),
                                     menu._kc_rev)
    for a in list(menu._kc_actions):
        if a._kc_menu is not None:
            _about_to_show(a._kc_menu)


_MENUBAR_SENT = {}


def menubar(bar, full=False):
    """The menu bar: {"order": [ids], "menus": [the changed menus]}."""
    if full:
        _MENUBAR_SENT.clear()
    menus = [a for a in bar._kc_actions if a._kc_menu is not None]
    for a in menus:
        _about_to_show(a._kc_menu)
    changed = []
    for a in menus:
        rev = _action_rev(a)
        if _MENUBAR_SENT.get(a._kc_id) != rev:
            _MENUBAR_SENT[a._kc_id] = rev
            changed.append({"id": a._kc_id, "title": a._kc_text,
                            "items": menu_items(a._kc_menu)})
    return {"order": [a._kc_id for a in menus], "menus": changed}


# --------------------------------------------------------------- widgets

def serialize(w, force=False):
    """*w* as a node; {"id", "same": 1} when the web side has it."""
    if w is None:
        return None
    rev = _subtree_rev(w)
    wid = w._kc_id
    if not force and SENT.get(wid) == rev:
        return {"id": wid, "same": 1}
    node = _node(w)
    node["id"] = wid
    SENT[wid] = rev
    if w.__dict__.get("_kc_hidden"):
        node["hid"] = 1
    if not w._kc_enabled:
        node["dis"] = 1
    if w._kc_tip:
        node["tip"] = w._kc_tip
    name = w.objectName()
    if name:
        node["name"] = name
    if w._kc_fixed_w:
        node["fw"] = w._kc_fixed_w
    if w._kc_fixed_h:
        node["fh"] = w._kc_fixed_h
    if w._kc_min_w:
        node["mw"] = w._kc_min_w
    if w._kc_min_h:
        node["mh"] = w._kc_min_h
    if w._kc_max_w:
        node["xw"] = w._kc_max_w
    if w._kc_max_h:
        node["xh"] = w._kc_max_h
    return node


def _children_nodes(w):
    return [serialize(c) for c in w._kc_children
            if not c.__dict__.get("_kc_window")
            and not isinstance(c, QMenu)]


def layout(lay):
    if isinstance(lay, QFormLayout):
        rows = []
        for label, field in lay._kc_rows:
            rows.append([_layout_item(label), _layout_item(field)])
        return {"k": "form", "rows": rows}
    if isinstance(lay, QGridLayout):
        return {"k": "grid",
                "cells": [[r, c, rs, cs, _layout_item(item)]
                          for r, c, rs, cs, item in lay._kc_cells],
                "cs": {str(k): v for k, v in lay._kc_col_stretch.items()}}
    kind = getattr(lay, "_kc_dir", "v")
    node = {"k": kind, "items": [_layout_item(i) for i in lay._kc_items]}
    if lay._kc_margins is not None:
        node["m"] = lay._kc_margins
    if lay._kc_spacing is not None:
        node["s"] = lay._kc_spacing
    return node


def _layout_item(item):
    if item is None:
        return None
    if item.kind == "w":
        node = serialize(item.obj)
        if item.stretch:
            node = dict(node)
            node["str"] = item.stretch
        return node
    if item.kind == "l":
        return layout(item.obj)
    if item.kind == "stretch":
        return {"k": "stretch", "n": item.stretch}
    if item.kind == "spacing":
        return {"k": "space", "n": item.stretch}
    if item.kind == "text":
        return {"t": "label", "text": item.obj}
    return None


def _with_layout(w, node):
    if w._kc_layout is not None:
        node["l"] = layout(w._kc_layout)
    else:
        kids = _children_nodes(w)
        if kids:
            node["kids"] = kids
    return node


def _node(w):
    for cls, fn in CUSTOM.items():
        if isinstance(w, cls):
            return fn(w)
    if w._kc_layout is None and not w._kc_children or \
            type(w).__name__ in _PAINTED:
        for test, fn in PAINTERS:
            if test(w):
                _PAINTED.add(type(w).__name__)
                return fn(w)
    if isinstance(w, QLabel):
        n = {"t": "label", "text": w._kc_text}
        if _rich(w._kc_text):
            n["rich"] = 1
        if w._kc_wrap:
            n["wrap"] = 1
        if w._kc_align:
            n["al"] = w._kc_align
        return n
    if isinstance(w, QToolButton):
        n = {"t": "tbutton", "text": w.text(), "icon": icon_name(w.icon())}
        if w.isCheckable():
            n["ck"] = 1
            if w.isChecked():
                n["chk"] = 1
        if not w.isEnabled():
            n["dis"] = 1
        a = w._kc_default_action
        if a is not None:
            n["act"] = a._kc_id
            if a._kc_shortcuts:
                n["sc"] = a._kc_shortcuts
        menu = w._kc_menu
        if menu is not None:
            n["menu"] = menu_items(menu)
            n["popup"] = w._kc_popup
        if w._kc_style_mode:
            n["style"] = w._kc_style_mode
        if w._kc_repeat:
            n["rep"] = 1
        tip = w.toolTip()
        if tip:
            n["tip"] = tip
        return n
    if isinstance(w, QCheckBox):
        return {"t": "check", "text": w._kc_text,
                **({"chk": 1} if w._kc_checked else {})}
    if isinstance(w, QRadioButton):
        return {"t": "radio", "text": w._kc_text,
                **({"chk": 1} if w._kc_checked else {})}
    if isinstance(w, QAbstractButton):
        n = {"t": "button", "text": w._kc_text,
             "icon": icon_name(w._kc_icon)}
        if w._kc_checkable:
            n["ck"] = 1
            if w._kc_checked:
                n["chk"] = 1
        if getattr(w, "_kc_default", False):
            n["def"] = 1
        menu = getattr(w, "_kc_menu", None)
        if menu is not None:
            n["menu"] = menu_items(menu)
        if w._kc_style:
            n["css"] = w._kc_style
        return n
    if isinstance(w, QLineEdit):
        n = {"t": "line", "text": w.text()}
        if w._kc_placeholder:
            n["ph"] = w._kc_placeholder
        if w._kc_readonly:
            n["ro"] = 1
        if w._kc_password:
            n["pw"] = 1
        return n
    if isinstance(w, QTextEdit):
        n = {"t": "text", "text": w._kc_text}
        if w._kc_html:
            n["html"] = 1
        if w._kc_readonly:
            n["ro"] = 1
        if w._kc_placeholder:
            n["ph"] = w._kc_placeholder
        if not w._kc_wrap:
            n["nowrap"] = 1
        cmd = w.__dict__.get("_kc_command")
        if cmd:
            n["cmd"] = list(cmd)
        search = w.__dict__.get("_kc_search")
        if search:
            n["srch"] = search
        font = w.__dict__.get("_kc_font")
        if font is not None and getattr(font, "_mono", False):
            n["mono"] = 1
        # the code tab's marks: the selected object's lines, broken lines
        sel = w.__dict__.get("_selected_ranges")
        if sel:
            n["sel_lines"] = [list(r) for r in sel]
        err = w.__dict__.get("_error_ranges")
        if err:
            n["err_lines"] = [list(r) for r in err]
        return n
    if isinstance(w, QDoubleSpinBox):
        n = {"t": "spin", "value": w._kc_value, "min": w._kc_min,
             "max": w._kc_max, "step": w._kc_step,
             "dec": w._kc_decimals}
        if w._kc_suffix:
            n["suf"] = w._kc_suffix
        if w._kc_prefix:
            n["pre"] = w._kc_prefix
        if isinstance(w, QSpinBox):
            n["int"] = 1
        if w.__dict__.get("_kc_special"):
            n["special"] = w._kc_special
        return n
    if isinstance(w, QAbstractSlider):
        return {"t": "slider", "value": w._kc_value, "min": w._kc_min,
                "max": w._kc_max, "step": w._kc_step,
                "o": w._kc_orient}
    if isinstance(w, QProgressBar):
        return {"t": "progress", "value": w._kc_value, "min": w._kc_min,
                "max": w._kc_max}
    if isinstance(w, QComboBox):
        items = []
        for it in w._kc_items:
            row = [it["text"]]
            if it.get("icon") or not it.get("enabled", True) or \
                    it.get("sep"):
                row += [it.get("icon"), 0 if not it.get("enabled", True)
                        else 1, 1 if it.get("sep") else 0]
            items.append(row)
        n = {"t": "combo", "items": items, "idx": w._kc_index}
        if w._kc_editable:
            n["edit"] = 1
            n["etext"] = w._kc_edit_text
            if w._kc_line is not None and w._kc_line._kc_placeholder:
                n["ph"] = w._kc_line._kc_placeholder
        return n
    if isinstance(w, QGroupBox):
        n = {"t": "group", "title": w._kc_title}
        if w._kc_checkable:
            n["ck"] = 1
            if w._kc_checked:
                n["chk"] = 1
        return _with_layout(w, n)
    if isinstance(w, QTabWidget):
        tabs = [{"label": p["label"], **({"tip": p["tip"]} if p["tip"]
                                          else {}),
                 **({"icon": p["icon"]} if p["icon"] else {}),
                 **({"dis": 1} if not p["enabled"] else {}),
                 **({"hid": 1} if not p["show"] else {})}
                for p in w._kc_pages]
        cur = w.widget(w._kc_index)
        return {"t": "tabs", "tabs": tabs, "idx": w._kc_index,
                "page": serialize(cur) if cur is not None else None}
    if isinstance(w, QStackedWidget):
        cur = w.widget(w._kc_index)
        return {"t": "stack", "page": serialize(cur)
                if cur is not None else None}
    if isinstance(w, QScrollArea):
        inner = w._kc_widget
        return {"t": "scroll", "w": serialize(inner)
                if inner is not None else None}
    if isinstance(w, QSplitter):
        return {"t": "split", "o": w._kc_orient, "sizes": w.sizes(),
                "kids": [serialize(c) for c in w._kc_widgets]}
    if isinstance(w, _views.QTreeWidget):
        return _tree(w)
    if isinstance(w, _views.QTableWidget):
        return _table(w)
    if isinstance(w, _views.QListWidget):
        return _list(w)
    if isinstance(w, QToolBar):
        return toolbar(w)
    if isinstance(w, QDialogButtonBox):
        return {"t": "buttons", "kids": [serialize(b) for b, _r, _s
                                         in w._kc_buttons]}
    if isinstance(w, QFrame) and w._kc_shape in (4, 5) and \
            w._kc_layout is None:
        return {"t": "sep", "o": "h" if w._kc_shape == 4 else "v"}
    if isinstance(w, QStatusBar):
        return {"t": "status", "msg": w._kc_message,
                "msgms": w._kc_timeout, "msgrev": w._kc_rev,
                "items": [[serialize(it), 1 if perm else 0]
                          for it, perm, _s in w._kc_items]}
    if isinstance(w, QMenu):
        return {"t": "menu", "items": menu_items(w)}
    return _with_layout(w, {"t": "w"})


#: desktop widget classes known to paint themselves
_PAINTED = set()


def toolbar(bar):
    items = []
    for a in bar._kc_actions:
        if a.isSeparator():
            items.append({"sep": 1})
            continue
        w = bar._kc_widgets.get(a._kc_id)
        if w is not None and not isinstance(w, QToolButton) or \
                (w is not None and w._kc_default_action is not a):
            if not a._kc_visible or w.__dict__.get("_kc_hidden"):
                continue
            items.append(serialize(w))
            continue
        if not a._kc_visible:
            continue
        node = action(a, deep=False)
        if w is not None and w._kc_style_mode == 2:
            node["beside"] = 1
        if a._kc_menu is not None:
            node["menu"] = menu_items(a._kc_menu)
        items.append(node)
    return {"t": "toolbar", "o": bar._kc_orient, "items": items,
            "title": bar._kc_title}


# ----------------------------------------------------------- item views

def _tree_item(it):
    node = {"i": item_id(it), "text": it.text(0)}
    ic = it._roles.get((0, _views.DECORATION))
    if ic:
        node["icon"] = ic
    fg = it._roles.get((0, _views.FOREGROUND))
    if fg:
        node["fg"] = fg
    tip = it._roles.get((0, _views.TOOLTIP))
    if tip:
        node["tip"] = tip
    node.update(_font_flags(it._roles.get((0, _views.FONT))))
    if it._selected:
        node["sel"] = 1
    if it._expanded:
        node["exp"] = 1
    if it._hidden:
        node["hid"] = 1
    # the object tree's painted tags: "(hidden)" and a debug modifier
    tag = it._roles.get((0, _views.USER + 1))
    if tag:
        node["tag"] = "(hidden)"
    mod = it._roles.get((0, _views.USER + 7))
    if mod:
        node["tag"] = mod
    if not it._flags & _views.ItemIsEditable:
        node["ne"] = 1
    if it._roles.get((0, _views.USER + 2)):
        node["ph"] = 1                      # a placement row
    cols = it.columnCount()
    if cols > 1:
        node["cols"] = [it.text(c) for c in range(1, cols)]
    check = it._roles.get((0, _views.CHECK))
    if check is not None and it._flags & _views.ItemIsUserCheckable:
        node["cs"] = check
    if it._children:
        node["kids"] = [_tree_item(c) for c in it._children]
    return node


def _tree(w):
    n = {"t": "tree", "rows": [_tree_item(c) for c in w._kc_root._children],
         "ind": w._kc_indent}
    if w._kc_headers and not w._kc_header._hidden:
        n["hdr"] = list(w._kc_headers)
    if w._kc_selmode in (2, 3):
        n["multi"] = 1
    edit = w._kc_edit
    if edit is not None:
        n["edit"] = item_id(edit[0])
        w._kc_edit = None
    cur = w._kc_current
    if cur is not None:
        n["cur"] = item_id(cur)
    scroll = w.__dict__.pop("_kc_scroll_to", None)
    if scroll is not None:
        n["scroll"] = item_id(scroll)
    return n


def _table(w):
    cells = []
    for (r, c), it in sorted(w._kc_cells.items()):
        cell = {"text": it.text()}
        fg = it._roles.get((0, _views.FOREGROUND))
        if fg:
            cell["fg"] = fg
        bg = it._roles.get((0, _views.BACKGROUND))
        if bg:
            cell["bg"] = bg
        tip = it._roles.get((0, _views.TOOLTIP))
        if tip:
            cell["tip"] = tip
        if not it._flags & _views.ItemIsEditable:
            cell["ro"] = 1
        if it._selected:
            cell["sel"] = 1
        cell.update(_font_flags(it._roles.get((0, _views.FONT))))
        cells.append([r, c, cell])
    n = {"t": "table", "rows": w._kc_rows, "cols": w._kc_cols,
         "cells": cells, "cur": list(w._kc_cur),
         "widgets": [[r, c, serialize(x)]
                     for (r, c), x in sorted(w._kc_widgets.items())]}
    if w._kc_hlabels and not w._kc_hheader._hidden:
        n["hl"] = w._kc_hlabels
    if w._kc_vlabels:
        n["vl"] = w._kc_vlabels
    if w._kc_vheader._hidden:
        n["novh"] = 1
    if w._kc_colw:
        n["cw"] = {str(k): v for k, v in w._kc_colw.items()}
    return n


def _list(w):
    items = []
    for it in w._kc_list:
        row = {"text": it.text()}
        ic = it._roles.get((0, _views.DECORATION))
        if ic:
            row["icon"] = ic
        if it._selected:
            row["sel"] = 1
        fg = it._roles.get((0, _views.FOREGROUND))
        if fg:
            row["fg"] = fg
        tip = it._roles.get((0, _views.TOOLTIP))
        if tip:
            row["tip"] = tip
        if it._hidden:
            row["hid"] = 1
        if not it._flags & _views.ItemIsEnabled:
            row["dis"] = 1
        check = it._roles.get((0, _views.CHECK))
        if check is not None and it._flags & _views.ItemIsUserCheckable:
            row["cs"] = check
        items.append(row)
    return {"t": "list", "items": items, "cur": w._kc_row,
            **({"multi": 1} if w._kc_selmode in (2, 3) else {})}


# --------------------------------------------------------------- windows

#: the desktop's main window (its menus go to the KherveOS menu bar)
PRIMARY = [None]


def mainwindow_node(w):
    """Another QMainWindow (the Blueprint): its own menu bar, tool bars,
    central widget, docks and status bar, drawn inside its window."""
    bar = w._kc_menubar
    menus = [{"id": a._kc_id, "title": a._kc_text,
              "items": menu_items(a._kc_menu)}
             for a in (bar._kc_actions if bar is not None else [])
             if a._kc_menu is not None]
    return {"t": "mainwin", "menus": menus,
            "toolbars": [[area, serialize(tb)] for area, tb in
                         w._kc_toolbars if not tb._kc_hidden],
            "central": serialize(w._kc_central),
            "status": serialize(w._kc_statusbar)
            if w._kc_statusbar is not None else None,
            "docks": [[area, d._kc_id, d._kc_title,
                       serialize(d._kc_widget)]
                      for area, d in w._kc_docks
                      if not d._kc_hidden and d._kc_widget is not None]}


def window(w):
    """A dialog or other top-level window: its title and contents."""
    if isinstance(w, _widgets.QMainWindow):
        node = mainwindow_node(w)
        node["id"] = w._kc_id
        return {"id": w._kc_id, "title": w._kc_title, "node": node,
                "modal": 0, "w": w._kc_w, "h": w._kc_h,
                "cls": type(w).__name__}
    node = serialize(w)
    return {"id": w._kc_id, "title": w._kc_title, "node": node,
            "modal": 1 if getattr(w, "_kc_modal", False) else 0,
            "w": w._kc_w, "h": w._kc_h,
            "cls": type(w).__name__}


def open_windows():
    """Every visible top-level window except the main one."""
    out = []
    for ref in list(_widgets.REGISTRY.values()):
        w = ref
        if isinstance(w, QWidget) and w.__dict__.get("_kc_window") and \
                w.__dict__.get("_kc_shown") and \
                not w.__dict__.get("_kc_hidden") and \
                w is not PRIMARY[0]:
            out.append(w)
    return out


# ----------------------------------------------------- dialog state copy

def _state_widgets(w):
    """The value-holding widgets of *w* in creation order (a re-run of
    the same code builds the same ones in the same order)."""
    out = []
    for c in w._kc_children:
        if isinstance(c, (QLineEdit, QTextEdit, QAbstractButton,
                          QDoubleSpinBox, QAbstractSlider, QComboBox,
                          QGroupBox, QTabWidget, QStackedWidget,
                          _views.QListWidget, _views.QTableWidget)):
            out.append(c)
        out.extend(_state_widgets(c))
    return out


def save_state(w):
    state = []
    for c in _state_widgets(w):
        if isinstance(c, QLineEdit):
            state.append(["line", c.text()])
        elif isinstance(c, QTextEdit):
            state.append(["text", c._kc_text])
        elif isinstance(c, QAbstractButton):
            state.append(["check", c._kc_checked])
        elif isinstance(c, QDoubleSpinBox):
            state.append(["spin", c._kc_value])
        elif isinstance(c, QAbstractSlider):
            state.append(["slider", c._kc_value])
        elif isinstance(c, QComboBox):
            state.append(["combo", c._kc_index, c._kc_edit_text])
        elif isinstance(c, QGroupBox):
            state.append(["group", c._kc_checked])
        elif isinstance(c, (QTabWidget, QStackedWidget)):
            state.append(["index", c._kc_index])
        elif isinstance(c, _views.QListWidget):
            state.append(["list", [i for i, it in enumerate(c._kc_list)
                                   if it._selected], c._kc_row])
        elif isinstance(c, _views.QTableWidget):
            state.append(["table", [[r, col, it.text()] for (r, col), it
                                    in c._kc_cells.items()]])
    return state


def restore_state(w, state):
    widgets = _state_widgets(w)
    for c, entry in zip(widgets, state):
        kind = entry[0]
        try:
            if kind == "line" and isinstance(c, QLineEdit):
                c.setText(entry[1])
            elif kind == "text" and isinstance(c, QTextEdit):
                c._kc_commit(entry[1])
            elif kind == "check" and isinstance(c, QAbstractButton):
                if c._kc_checkable:
                    c.setChecked(entry[1])
            elif kind == "spin" and isinstance(c, QDoubleSpinBox):
                c.setValue(entry[1])
            elif kind == "slider" and isinstance(c, QAbstractSlider):
                c.setValue(entry[1])
            elif kind == "combo" and isinstance(c, QComboBox):
                c.setCurrentIndex(entry[1])
                if c._kc_editable:
                    c.setEditText(entry[2])
            elif kind == "group" and isinstance(c, QGroupBox):
                c.setChecked(entry[1])
            elif kind == "index" and isinstance(c, (QTabWidget,
                                                    QStackedWidget)):
                c.setCurrentIndex(entry[1])
            elif kind == "list" and isinstance(c, _views.QListWidget):
                c._kc_select(entry[1])
                if entry[2] >= 0:
                    c._kc_set_row(entry[2])
            elif kind == "table" and isinstance(c, _views.QTableWidget):
                for r, col, text in entry[1]:
                    c._kc_edit(r, col, text)
        except Exception:
            pass


# ------------------------------------------------------------- dispatch

class KeyEvent(_core.Inert):
    def __init__(self, key, mods=0, text=""):
        self._key, self._mods, self._text = int(key), int(mods), text
        self._accepted = True

    def key(self):
        return self._key

    def modifiers(self):
        return self._mods

    def text(self):
        return self._text

    def type(self):
        return 6

    def matches(self, seq):
        std = {1: (0x43, 0x04000000), 2: (0x58, 0x04000000),
               3: (0x56, 0x04000000), 4: (0x01000007, 0),
               5: (0x5a, 0x04000000), 6: (0x59, 0x04000000),
               7: (0x41, 0x04000000)}.get(int(seq))
        return std is not None and std == (self._key, self._mods & ~0x20000000)

    def accept(self):
        self._accepted = True

    def ignore(self):
        self._accepted = False

    def isAccepted(self):
        return self._accepted

    def isAutoRepeat(self):
        return False


class MouseEvent(_core.Inert):
    """A view-level mouse event (pos in the widget's pixels)."""

    def __init__(self, x, y, button=1, buttons=1, mods=0, dy=0):
        self._p = _core.QPointF(x, y)
        self._button, self._buttons = int(button), int(buttons)
        self._mods = int(mods)
        self._dy = dy
        self._accepted = True

    def pos(self):
        return _core.QPointF(self._p)

    def localPos(self):
        return _core.QPointF(self._p)

    def position(self):
        return _core.QPointF(self._p)

    def globalPos(self):
        return _core.QPointF(self._p)

    def x(self):
        return self._p.x()

    def y(self):
        return self._p.y()

    def button(self):
        return self._button

    def buttons(self):
        return self._buttons

    def modifiers(self):
        return self._mods

    def angleDelta(self):
        return _core.QPointF(0, self._dy)

    def accept(self):
        self._accepted = True

    def ignore(self):
        self._accepted = False

    def isAccepted(self):
        return self._accepted


def find(wid):
    return _widgets.REGISTRY.get(int(wid))


def dispatch(ev):
    """Apply one input event (a dict from the web side)."""
    op = ev.get("op")
    w = find(ev["id"]) if "id" in ev else None
    if op == "trigger":
        if isinstance(w, QAction):
            w.trigger()
        return
    if w is None:
        return
    if op == "click":
        if isinstance(w, QAbstractButton):
            w.click()
        return
    if op == "text":
        if isinstance(w, QLineEdit):
            w._kc_commit(str(ev.get("text", "")))
        elif isinstance(w, QTextEdit):
            w._kc_commit(str(ev.get("text", "")))
        return
    if op == "typing":                       # a line edit, as it changes
        if isinstance(w, QLineEdit):
            text = str(ev.get("text", ""))
            if text != w._kc_text:
                w._kc_text = text
                w.textEdited.emit(text)
                w.textChanged.emit(text)
        return
    if op == "return":
        if isinstance(w, QLineEdit):
            w._kc_commit(str(ev.get("text", w.text())))
            w.returnPressed.emit()
        return
    if op == "value":
        if isinstance(w, QDoubleSpinBox):
            w._kc_commit(ev.get("value"))
        elif isinstance(w, QAbstractSlider):
            w.setValue(ev.get("value"))
            if ev.get("final"):
                w.sliderReleased.emit()
            else:
                w.sliderMoved.emit(w._kc_value)
        return
    if op == "combo":
        if isinstance(w, QComboBox):
            w._kc_activate(int(ev.get("index", -1)))
        return
    if op == "combo_text":
        if isinstance(w, QComboBox):
            w._kc_commit_text(str(ev.get("text", "")))
        return
    if op == "combo_popup":
        if isinstance(w, QComboBox):
            w.showPopup()
        return
    if op == "group":
        if isinstance(w, QGroupBox):
            w.setChecked(bool(ev.get("on")))
            w.clicked.emit(w._kc_checked)
        return
    if op == "tab":
        if isinstance(w, (QTabWidget, QStackedWidget)):
            w.setCurrentIndex(int(ev.get("index", 0)))
            if isinstance(w, QTabWidget):
                w.tabBarClicked.emit(int(ev.get("index", 0)))
        return
    if op == "splitter":
        if isinstance(w, QSplitter):
            w._kc_sizes = [int(s) for s in ev.get("sizes", [])]
        return
    if op == "close":
        if isinstance(w, QDialog):
            w.reject()
        elif isinstance(w, QDockWidget):
            w.setVisible(False)
        else:
            w.close()
        return
    if op == "resize":
        w._kc_w, w._kc_h = int(ev.get("w", w._kc_w)), int(ev.get("h",
                                                               w._kc_h))
        return
    if isinstance(w, _views.QTreeWidget):
        return _tree_event(w, op, ev)
    if isinstance(w, _views.QListWidget):
        return _list_event(w, op, ev)
    if isinstance(w, _views.QTableWidget):
        return _table_event(w, op, ev)
    if op == "key":
        handler = getattr(w, "keyPressEvent", None)
        if handler is not None:
            handler(KeyEvent(ev.get("key", 0), ev.get("mods", 0),
                             ev.get("text", "")))
        return


def _items(ids):
    return [ITEMS[i] for i in ids if i in ITEMS]


def _tree_event(w, op, ev):
    if op == "select":
        items = _items(ev.get("items", []))
        cur = ITEMS.get(ev.get("cur")) if ev.get("cur") else None
        w._kc_select(items, cur)
        if items:
            w.itemClicked.emit(items[-1], 0)
    elif op == "dbl":
        it = ITEMS.get(ev.get("item"))
        if it is not None:
            w.itemDoubleClicked.emit(it, int(ev.get("col", 0)))
    elif op == "expand":
        it = ITEMS.get(ev.get("item"))
        if it is not None:
            it.setExpanded(bool(ev.get("on")))
    elif op == "rename":
        it = ITEMS.get(ev.get("item"))
        if it is not None:
            it.setText(int(ev.get("col", 0)), str(ev.get("text", "")))
    elif op == "check":
        it = ITEMS.get(ev.get("item"))
        if it is not None:
            it.setCheckState(0, int(ev.get("state", 0)))
    elif op == "menu":
        it = ITEMS.get(ev.get("item"))
        if it is not None and not it._selected:
            w._kc_select([it], it)
        w._kc_hover = it
        w.customContextMenuRequested.emit(_core.QPointF(ev.get("x", 0),
                                                        ev.get("y", 0)))
    elif op == "key":
        w.keyPressEvent(KeyEvent(ev.get("key", 0), ev.get("mods", 0),
                                 ev.get("text", "")))
    elif op == "drop":
        # the selection was dragged onto / above / below an item
        target = ITEMS.get(ev.get("item")) if ev.get("item") else None
        w._kc_drop_pos = {"on": 0, "above": 1, "below": 2}.get(
            ev.get("where"), 3)
        w._kc_hover = target
        drop = getattr(w, "dropEvent", None)
        if drop is not None:
            drop(_DropEvent(target))


class _DropEvent(_core.Inert):
    def __init__(self, target):
        self._target = target

    def mimeData(self):
        return _NoUrls()

    def pos(self):
        return _core.QPointF()

    def position(self):
        return _core.QPointF()

    def setDropAction(self, *a):
        pass

    def accept(self):
        pass

    def acceptProposedAction(self):
        pass

    def ignore(self):
        pass


class _NoUrls(_core.Inert):
    def hasUrls(self):
        return False

    def urls(self):
        return []

    def hasText(self):
        return False


def _list_event(w, op, ev):
    if op == "select":
        rows = [int(r) for r in ev.get("rows", [])]
        w._kc_select(rows)
        if rows:
            it = w.item(rows[-1])
            if it is not None:
                w.itemClicked.emit(it)
    elif op == "dbl":
        it = w.item(int(ev.get("row", -1)))
        if it is not None:
            w.itemDoubleClicked.emit(it)
            w.itemActivated.emit(it)
    elif op == "check":
        it = w.item(int(ev.get("row", -1)))
        if it is not None:
            it.setCheckState(int(ev.get("state", 0)))


def _table_event(w, op, ev):
    r, c = int(ev.get("r", -1)), int(ev.get("c", -1))
    if op == "edit":
        w._kc_edit(r, c, str(ev.get("text", "")))
    elif op == "cur":
        w.setCurrentCell(r, c)
        w.cellClicked.emit(r, c)
        it = w.item(r, c)
        if it is not None:
            w.itemClicked.emit(it)
    elif op == "dbl":
        w.cellDoubleClicked.emit(r, c)
