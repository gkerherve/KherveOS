"""matplotlib.cm for the recording matplotlib: the colour maps the tools sample (tab10, viridis…)."""

import numpy as np

_TAB10 = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22',
          '#17becf']
_TAB20 = ['#1f77b4', '#aec7e8', '#ff7f0e', '#ffbb78', '#2ca02c', '#98df8a', '#d62728', '#ff9896', '#9467bd',
          '#c5b0d5', '#8c564b', '#c49c94', '#e377c2', '#f7b6d2', '#7f7f7f', '#c7c7c7', '#bcbd22', '#dbdb8d',
          '#17becf', '#9edae5']
_SET1 = ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#ffff33', '#a65628', '#f781bf', '#999999']
_ANCHORS = {
    'viridis': ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
    'plasma': ['#0d0887', '#7e03a8', '#cc4778', '#f89540', '#f0f921'],
    'inferno': ['#000004', '#57106e', '#bc3754', '#f98e09', '#fcffa4'],
    'magma': ['#000004', '#51127c', '#b73779', '#fc8961', '#fcfdbf'],
    'cividis': ['#00204c', '#414d6b', '#7c7b78', '#bcaf6f', '#ffe945'],
    'gray': ['#000000', '#ffffff'], 'grey': ['#000000', '#ffffff'], 'Greys': ['#ffffff', '#000000'],
    'binary': ['#ffffff', '#000000'], 'hot': ['#0b0000', '#ff0000', '#ffff00', '#ffffff'],
    'jet': ['#000080', '#0000ff', '#00ffff', '#ffff00', '#ff0000', '#800000'],
    'coolwarm': ['#3b4cc0', '#dddddd', '#b40426'], 'RdBu': ['#67001f', '#f7f7f7', '#053061'],
    'RdBu_r': ['#053061', '#f7f7f7', '#67001f'], 'Blues': ['#f7fbff', '#08306b'], 'Reds': ['#fff5f0', '#67000d'],
    'Greens': ['#f7fcf5', '#00441b'], 'Oranges': ['#fff5eb', '#7f2704'], 'Purples': ['#fcfbfd', '#3f007d'],
    'turbo': ['#30123b', '#4686fb', '#1be5b5', '#a2fc3c', '#f9ba38', '#d23105', '#7a0403'],
    'rainbow': ['#8000ff', '#00b4eb', '#80ffb4', '#ffb462', '#ff0000'],
    'copper': ['#000000', '#ffc77f'], 'bone': ['#000000', '#a7c7c7', '#ffffff'], 'afmhot': ['#000000', '#ff8000', '#ffffff'],
    'Spectral': ['#9e0142', '#fdae61', '#ffffbf', '#abdda4', '#5e4fa2'], 'spring': ['#ff00ff', '#ffff00'],
    'summer': ['#008066', '#ffff66'], 'autumn': ['#ff0000', '#ffff00'], 'winter': ['#0000ff', '#00ff80'],
    'cool': ['#00ffff', '#ff00ff'], 'YlOrRd': ['#ffffcc', '#fd8d3c', '#800026'],
}


def _rgb(h):
    return tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))


class Colormap:
    def __init__(self, name, colours, listed=False):
        self.name = name
        self._c = np.array([_rgb(c) + (1.0,) for c in colours])
        self.listed = listed
        self.N = len(colours) if listed else 256

    def __call__(self, x, alpha=None, bytes=False):
        scalar = np.ndim(x) == 0
        x = np.atleast_1d(np.asarray(x, dtype=float))
        if self.listed:
            if np.issubdtype(np.asarray(x).dtype, np.floating) and np.all((x >= 0) & (x <= 1)):
                idx = np.clip((x * self.N).astype(int), 0, self.N - 1)
            else:
                idx = np.clip(x.astype(int), 0, self.N - 1)
            out = self._c[idx]
        else:
            t = np.clip(np.nan_to_num(x), 0, 1) * (len(self._c) - 1)
            i0 = np.clip(np.floor(t).astype(int), 0, len(self._c) - 1)
            i1 = np.clip(i0 + 1, 0, len(self._c) - 1)
            f = (t - i0)[:, None]
            out = self._c[i0] * (1 - f) + self._c[i1] * f
        out = out.copy()
        if alpha is not None:
            out[:, 3] = alpha
        if bytes:
            out = (out * 255).astype(np.uint8)
        return tuple(out[0]) if scalar else out

    def reversed(self):
        cm = Colormap(self.name + '_r', [], self.listed)
        cm._c = self._c[::-1].copy()
        cm.N = self.N
        return cm

    def resampled(self, n):
        return self

    def with_extremes(self, **kw):
        return self

    set_bad = set_under = set_over = lambda s, *a, **kw: None


class ListedColormap(Colormap):
    def __init__(self, colors, name='from_list', N=None):
        hexes = []
        for c in colors:
            from .colors import to_hex
            hexes.append(to_hex(c))
        super().__init__(name, hexes, True)


class LinearSegmentedColormap(Colormap):
    def __init__(self, name, segmentdata=None, N=256, gamma=1.0):
        super().__init__(name, ['#000000', '#ffffff'])

    @staticmethod
    def from_list(name, colors, N=256, gamma=1.0):
        from .colors import to_hex
        return Colormap(name, [to_hex(c if not isinstance(c, tuple) or len(c) != 2 else c[1]) for c in colors])


_REGISTRY = {'tab10': Colormap('tab10', _TAB10, True), 'tab20': Colormap('tab20', _TAB20, True),
             'Set1': Colormap('Set1', _SET1, True)}
for _n, _c in _ANCHORS.items():
    _REGISTRY[_n] = Colormap(_n, _c)
    _REGISTRY[_n + '_r'] = _REGISTRY[_n].reversed()
for _n, _cm in list(_REGISTRY.items()):
    globals()[_n] = _cm


class _Registry(dict):
    def __call__(self, name):
        return self[name]

    def get_cmap(self, name):
        return self[name]


colormaps = _Registry(_REGISTRY)


def get_cmap(name=None, lut=None):
    if isinstance(name, Colormap):
        return name
    return _REGISTRY.get(name or 'viridis', _REGISTRY['viridis'])


class ScalarMappable:
    def __init__(self, norm=None, cmap=None):
        self.norm, self.cmap = norm, get_cmap(cmap)

    def set_array(self, a):
        pass

    def to_rgba(self, x, alpha=None):
        return self.cmap(x)
