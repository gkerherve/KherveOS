"""mpl_toolkits.axes_grid1 for the recording matplotlib: make_axes_locatable(ax).append_axes(side, size, pad) gives a new axes
beside ``ax``, as an inset placed outside its frame (so it follows the parent's box, which an equal-aspect image shrinks)."""


def _fraction(v, default):
    if isinstance(v, str) and v.endswith('%'):
        return float(v[:-1]) / 100.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


class _Divider:
    def __init__(self, ax):
        self.ax = ax

    def append_axes(self, position, size='5%', pad=0.1, **kw):
        s, p = _fraction(size, 0.05), _fraction(pad, 0.05)
        if position == 'right':
            rect = [1.0 + p, 0.0, s, 1.0]
        elif position == 'left':
            rect = [-p - s, 0.0, s, 1.0]
        elif position == 'top':
            rect = [0.0, 1.0 + p, 1.0, s]
        else:
            rect = [0.0, -p - s, 1.0, s]
        return self.ax.inset_axes(rect)

    def new_horizontal(self, *a, **kw):
        return self.append_axes('right', *a[:1], **kw)

    def new_vertical(self, *a, **kw):
        return self.append_axes('top', *a[:1], **kw)


def make_axes_locatable(ax):
    return _Divider(ax)


class ImageGrid:
    def __init__(self, fig, rect, nrows_ncols=(1, 1), **kw):
        self.axes_all = [fig.add_subplot(*([nrows_ncols[0], nrows_ncols[1], i + 1])) for i in range(nrows_ncols[0] * nrows_ncols[1])]

    def __iter__(self):
        return iter(self.axes_all)

    def __getitem__(self, i):
        return self.axes_all[i]
