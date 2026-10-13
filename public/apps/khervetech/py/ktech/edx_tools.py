"""What the EDX HeatMap window does with the mouse, as calls: a selection on the map, element maps, quantification.

The desktop's window is driven by matplotlib mouse events on its map canvas (on_map_click, a RectangleSelector for areas).
These helpers hand its own handlers the same kind of event, so the AI tools and the page's controls reach the same code.
Each takes the window first (ktech.project.drive calls "module:function" this way) and returns what the caller should see.
"""


class _Event:
    def __init__(self, ax, x, y, button=1):
        self.inaxes, self.xdata, self.ydata, self.x, self.y = ax, x, y, x, y
        self.button, self.key, self.dblclick, self.step = button, None, False, 0


def _spectrum(win):
    import numpy as np
    line = win.parent.ax.lines[0] if win.parent.ax.lines else None
    if line is None:
        return None
    energy, counts = np.asarray(line.get_xdata(), dtype=float), np.asarray(line.get_ydata(), dtype=float)
    return energy, counts


def _peaks(win, limit=15):
    """The window's identified peaks as (energy keV, element, line) rows."""
    out, seen = [], set()
    for p in (getattr(win, 'identified_peaks', None) or []):
        try:
            energy, element, line = float(p[0]), str(p[1]), str(p[2])
        except (TypeError, ValueError, IndexError):
            continue
        if (element, line) in seen:
            continue
        seen.add((element, line))
        out.append({'energy_keV': round(energy, 3), 'element': element, 'line': line})
        if len(out) >= limit:
            break
    return out


def select(win, kind, x1, y1, x2=None, y2=None, width=1, size=1, save=False):
    """A point, an area or a line on the map (pixels: column, row); its spectrum goes to the main plot, as on the desktop.
    ``save`` makes it a sheet (EDX~Plot1, 2…) the way the window's Save button does."""
    if win.current_data is None:
        raise ValueError('No EDX map is loaded.')
    rows, cols = win.current_data.data.shape[:2]
    ax = win.map_ax
    x1, y1 = max(0, min(int(x1), cols - 1)), max(0, min(int(y1), rows - 1))
    if kind == 'point':
        win.selection_mode, win.point_size = 'point', max(1, int(size))
        win.on_map_click(_Event(ax, x1, y1))
    else:
        if x2 is None or y2 is None:
            raise ValueError(f'A {kind} needs its end point: x2 and y2.')
        x2, y2 = max(0, min(int(x2), cols - 1)), max(0, min(int(y2), rows - 1))
        if kind == 'area':
            win.selection_mode = 'area'
            win.on_area_select(_Event(ax, x1, y1), _Event(ax, x2, y2))
        elif kind == 'line':
            win.selection_mode, win.line_width, win.line_start = 'line', max(1, int(width)), None
            win.on_map_click(_Event(ax, x1, y1))
            win.on_map_click(_Event(ax, x2, y2))
        else:
            raise ValueError('kind is "point", "area" or "line".')
    if save:
        win.on_save_edx_plot(None)
    spec = _spectrum(win)
    out = {'selection': kind, 'peaks': _peaks(win)}
    if spec is not None:
        energy, counts = spec
        out.update({'channels': int(len(energy)), 'total_counts': float(counts.sum()), 'max_counts': float(counts.max()),
                    'energy_of_max_keV': round(float(energy[counts.argmax()]), 3)})
    return out


def element_maps(win, elements):
    """Element maps (an RGB composite of up to seven elements) in the EDX window."""
    elements = [str(e) for e in elements]
    win.selected_elements = elements
    win.include_elements = set(elements)
    win.on_plot_maps(None)
    return {'elements': elements}


def quantify(win, elements):
    """Relative atomic percentages of the elements from the sum spectrum (the window's standardless quantification)."""
    import numpy as np
    if win.current_data is None:
        raise ValueError('No EDX map is loaded.')
    elements = [str(e) for e in elements]
    win.selected_elements = elements
    data = np.asarray(win.current_data.data)
    spectrum = data.sum(axis=(0, 1)) if data.ndim == 3 else data
    energy = win.get_energy_axis()
    rows = win._calculate_atomic_percent(energy, spectrum, elements) or []
    return [{'element': r['element'], 'line': r['line'], 'energy_keV': round(float(r['energy']), 3),
             'atomic_percent': round(float(r['atomic_percent']), 2)} for r in rows]


def sum_peaks(win):
    """The peaks the window identified in the sum spectrum, with the element lines they match."""
    return {'peaks': _peaks(win, 40)}
