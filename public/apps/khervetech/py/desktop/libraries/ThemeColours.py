# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ThemeColours.py. Regenerate with tools/export_khervetech.py.
"""User-selectable accent colour (View > Theme / Style > Grid Colour).

A single colour is shared by:

- the constraint rows of the peak parameters grid (background, and the
  matching text colour that hides values on non-editable constraint cells),
  plus the same colouring in the AutoID, D-parameter, VB, survey, EDX,
  Area-Fit and KherveAI fitting grids and the highlighted results-grid
  columns;
- the core-level cells of the Sample Manager grid (floating window and
  embedded tab).

The colour is read at paint/populate time via the getters below, so changing
it only requires repainting the grids, not rebuilding them.
"""

import wx


def _interp(a, b, t):
    """Linear RGB interpolation, rounded to ints."""
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


# Endpoints of the green ramp
_LIGHT_GREEN = (200, 245, 228)   # the original default light green
_KHERVE_GREEN = (79, 190, 159)   # the KherveFitting brand green #4FBE9F

# 10 shades of green from the light default to the KherveFitting green
GREEN_SHADES = [_interp(_LIGHT_GREEN, _KHERVE_GREEN, i / 9) for i in range(10)]


def _shade_label(i):
    if i == 0:
        return "Light Green (default)"
    if i == len(GREEN_SHADES) - 1:
        return "KherveFitting Green"
    return f"Green {i + 1}"


# (label, rgb) choices offered in the View > Theme / Style menu
COLOUR_CHOICES = [(_shade_label(i), rgb) for i, rgb in enumerate(GREEN_SHADES)]

DEFAULT_RGB = _LIGHT_GREEN

_state = {'grid': DEFAULT_RGB}


def _normalise(rgb):
    try:
        r, g, b = (int(v) for v in rgb)
        if all(0 <= v <= 255 for v in (r, g, b)):
            return (r, g, b)
    except (TypeError, ValueError):
        pass
    return DEFAULT_RGB


def set_grid_colour(rgb):
    _state['grid'] = _normalise(rgb)


def get_grid_colour():
    return wx.Colour(*_state['grid'])


def get_grid_rgb():
    return _state['grid']


# Backwards-compatible aliases: the constraint rows and the Sample Manager
# cells now share this single colour, so every caller resolves to it.
get_constraint_row_colour = get_grid_colour
get_manager_cell_colour = get_grid_colour
set_constraint_row_colour = set_grid_colour
set_manager_cell_colour = set_grid_colour
get_constraint_row_rgb = get_grid_rgb
get_manager_cell_rgb = get_grid_rgb
