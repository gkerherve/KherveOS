"""Render the desktop KherveSheet's toolbar and menu icons to PNG.

On the desktop the icons are drawn at run time (QPainter glyphs and
qtawesome MDI icons in khervesheet/icons.py). This runs that same code,
offscreen, and writes public/apps/khervesheet/icons/{light,dark}/<name>.png
at 2x (64 px for the 32 px toolbar):

  light: the desktop's default Emerald theme (ButtonText #0d2a1d,
         icon style "Dark Blue")
  dark:  KherveOS's dark chrome (ButtonText #e9f1ec, icon style "Snow")

Usage (PyQt5 + qtawesome, e.g. the KherveSheet venv):
  git -C ../KherveSheet archive origin/dev | tar -x -C /tmp/ks
  QT_QPA_PLATFORM=offscreen ../KherveSheet/.venv/bin/python \
      tools/render_khervesheet_icons.py /tmp/ks
"""

import os
import sys

src = sys.argv[1] if len(sys.argv) > 1 else "../KherveSheet"
sys.path.insert(0, os.path.abspath(src))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PyQt5.QtCore import QSize  # noqa: E402
from PyQt5.QtGui import QColor, QPalette, QPixmap  # noqa: E402
from PyQt5.QtWidgets import QApplication  # noqa: E402

app = QApplication(sys.argv)

from khervesheet import icons  # noqa: E402


class _Pixmap2x(QPixmap):
    """Every pixmap the icon code makes is 2x, drawn in 1x coordinates."""

    def __init__(self, *a):
        if len(a) == 2 and all(isinstance(v, int) for v in a):
            super().__init__(a[0] * 2, a[1] * 2)
            super().setDevicePixelRatio(2.0)
        else:
            super().__init__(*a)

    def setDevicePixelRatio(self, _r):
        super().setDevicePixelRatio(2.0)


icons.QPixmap = _Pixmap2x

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "apps",
                   "khervesheet", "icons")
S = 32

PAINTED = {
    "new_file": icons.new_file_icon, "open_file": icons.open_file_icon,
    "save_file": icons.save_file_icon, "print": icons.print_icon,
    "undo": icons.undo_icon, "redo": icons.redo_icon,
    "solver": icons.solver_icon, "fitting": icons.fitting_icon,
    "science": icons.science_icon, "bold": icons.bold_icon,
    "italic": icons.italic_icon, "underline": icons.underline_icon,
    "align_left": icons.align_left_icon,
    "align_center": icons.align_center_icon,
    "align_right": icons.align_right_icon,
    "border": icons.border_icon, "merge_cells": icons.merge_cells_icon,
    "unmerge_cells": icons.unmerge_cells_icon,
    "table_design": icons.table_design_icon, "image": icons.image_icon,
    "shapes": icons.shapes_button_icon, "sparkline": icons.sparkline_icon,
    "equation": icons.equation_icon, "omega": icons.omega_icon,
    "symbol": icons.symbol_icon, "checkbox": icons.checkbox_icon,
    "dropdown": icons.dropdown_icon, "emoji": icons.emoji_icon,
    "comment": icons.comment_icon, "note": icons.note_icon,
    "link": icons.link_icon, "fx": icons.fx_icon,
    "plot_line": icons.plot_icon_line,
    "plot_scatter": icons.plot_icon_scatter,
    "plot_line_symbol": icons.plot_icon_line_symbol,
    "plot_bar": icons.plot_icon_bar, "plot_step": icons.plot_icon_step,
    "plot_stem": icons.plot_icon_stem,
    "plot_histogram": icons.plot_icon_histogram,
    "plot_box": icons.plot_icon_box,
    "plot_heatmap": icons.plot_icon_heatmap,
    "plot_3d_surface": icons.plot_icon_3d_surface,
    "plot_pie": icons.plot_icon_pie,
    "plot_doughnut": icons.plot_icon_doughnut,
    "plot_3d_pie": icons.plot_icon_3d_pie,
}
for b in ("bottom", "top", "left", "right", "none", "all", "outside",
          "thick_outside", "bottom_double", "thick_bottom", "top_bottom",
          "top_thick_bottom", "top_double_bottom"):
    PAINTED[f"border_{b}"] = (lambda bb: lambda s: icons.border_preset_icon(bb, s))(b)

# qtawesome MDI icons: (mdi name, fixed colour or None for the style colour)
MDI = {
    "robot": ("mdi.robot", None),
    "lan_connect": ("mdi.lan-connect", None),
    "source_branch": ("mdi.source-branch", None),
    "wrap": ("mdi.wrap", None),
    "table_large": ("mdi.table-large", None),
    "bring_forward": ("mdi.arrange-bring-forward", None),
    "send_backward": ("mdi.arrange-send-backward", None),
    # The Python editor (formula bar and pop-out), fixed colours.
    "py_open_in_new": ("mdi.open-in-new", "#3776ab"),
    "py_timer": ("mdi.timer-outline", "#3776ab"),
    "py_play": ("mdi.play", "#27ae60"),
    "py_stop": ("mdi.stop", "#c0392b"),
    "py_ks": ("mdi.table-arrow-left", "#3776ab"),
    "py_pick": ("mdi.cursor-default-click-outline", "#3776ab"),
    "py_snippets": ("mdi.code-braces", "#3776ab"),
    "py_comment": ("mdi.comment-text-outline", "#3776ab"),
    "py_play_circle": ("mdi.play-circle-outline", "#27ae60"),
    "py_stop_circle": ("mdi.stop-circle-outline", "#c0392b"),
    "py_help": ("mdi.help-circle-outline", "#3776ab"),
}

VARIANTS = {
    "light": ("#0d2a1d", "Dark Blue"),
    "dark": ("#e9f1ec", "Snow"),
}


def save(pm, path):
    if pm.isNull():
        print("  (empty)", path)
        return
    pm.setDevicePixelRatio(1.0)
    pm.save(path, "PNG")


for variant, (fg, style) in VARIANTS.items():
    pal = app.palette()
    pal.setColor(QPalette.ButtonText, QColor(fg))
    pal.setColor(QPalette.WindowText, QColor(fg))
    app.setPalette(pal)
    icons.set_active_icon_style(style)
    d = os.path.join(OUT, variant)
    os.makedirs(d, exist_ok=True)
    for name, fn in PAINTED.items():
        ic = fn(S)
        sizes = ic.availableSizes()
        pm = ic.pixmap(sizes[-1]) if sizes else ic.pixmap(QSize(2 * S, 2 * S))
        save(pm, os.path.join(d, f"{name}.png"))
    for name, (mdi, colour) in MDI.items():
        ic = icons.themed_icon(mdi, color=colour or "")
        save(ic.pixmap(QSize(2 * S, 2 * S)), os.path.join(d, f"{name}.png"))
    print(variant, len(PAINTED) + len(MDI), "icons")
