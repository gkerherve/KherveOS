"""The recording figure, axes and artists (see matplotlib/__init__.py)."""

from __future__ import annotations

import hashlib
import itertools
import math

import numpy as np

rcParams = {
    'font.size': 10, 'axes.labelsize': 10, 'xtick.labelsize': 10, 'ytick.labelsize': 10, 'legend.fontsize': 10,
    'lines.linewidth': 1.5, 'axes.prop_cycle': None, 'figure.dpi': 100, 'savefig.dpi': 100,
    'font.family': ['sans-serif'], 'axes.linewidth': 0.8, 'mathtext.default': 'it', 'axes.unicode_minus': True,
    'axes.formatter.useoffset': True, 'xtick.direction': 'out', 'ytick.direction': 'out',
}

CYCLE = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf']
_ids = itertools.count(1)


# ---------------------------------------------------------------- colours

_SHORT = {'b': '#0000ff', 'g': '#008000', 'r': '#ff0000', 'c': '#00bfbf', 'm': '#bf00bf', 'y': '#bfbf00',
          'k': '#000000', 'w': '#ffffff'}
_TAB = {'tab:blue': CYCLE[0], 'tab:orange': CYCLE[1], 'tab:green': CYCLE[2], 'tab:red': CYCLE[3],
        'tab:purple': CYCLE[4], 'tab:brown': CYCLE[5], 'tab:pink': CYCLE[6], 'tab:gray': CYCLE[7],
        'tab:grey': CYCLE[7], 'tab:olive': CYCLE[8], 'tab:cyan': CYCLE[9]}


def css_colour(c, alpha=None):
    """Any matplotlib colour spec as a CSS colour (None stays None)."""
    if c is None:
        return None
    if isinstance(c, str):
        s = c.strip()
        low = s.lower()
        if low in ('none', ''):
            return 'none'
        if low in _SHORT:
            return _SHORT[low]
        if low in _TAB:
            return _TAB[low]
        if len(low) == 2 and low[0] == 'c' and low[1].isdigit():
            return CYCLE[int(low[1]) % 10]
        try:
            g = float(low)
            v = int(round(max(0.0, min(1.0, g)) * 255))
            return f'#{v:02x}{v:02x}{v:02x}'
        except ValueError:
            pass
        return low.replace(' ', '')
    if hasattr(c, 'css') and not isinstance(c, (tuple, list, np.ndarray)):
        return c.css()
    try:
        vals = [float(v) for v in np.asarray(c, dtype=float).ravel()[:4]]
    except (TypeError, ValueError):
        return str(c)
    if len(vals) < 3:
        return '#000000'
    if max(vals[:3]) > 1.0:
        vals = [v / 255.0 for v in vals[:3]] + vals[3:]
    r, g, b = (int(round(max(0.0, min(1.0, v)) * 255)) for v in vals[:3])
    a = vals[3] if len(vals) > 3 else 1.0
    if a < 1.0:
        return f'rgba({r},{g},{b},{a:.3f})'
    return f'#{r:02x}{g:02x}{b:02x}'


def _ls(ls):
    return {'solid': '-', 'dashed': '--', 'dotted': ':', 'dashdot': '-.', 'None': 'none', 'none': 'none', ' ': 'none',
            '': 'none'}.get(ls, ls) if isinstance(ls, str) else '-'


# ---------------------------------------------------------------- arrays

_SENT: set = set()


def reset_sent():
    _SENT.clear()


class _Arrays:
    """The arrays of one serialisation: each sent once, then referred to by key."""

    def __init__(self):
        self.out = {}

    def ref(self, values):
        if values is None:
            return None
        try:
            a = np.asarray(values, dtype=float).ravel()
        except (TypeError, ValueError):
            a = np.asarray([v if isinstance(v, (int, float)) else np.nan for v in values], dtype=float)
        key = hashlib.blake2b(a.tobytes(), digest_size=8).hexdigest()
        if key not in _SENT and key not in self.out:
            if a.size:
                text = np.char.mod('%.7g', a)
                vals = text.astype(np.float64).tolist()
                self.out[key] = [v if math.isfinite(v) else None for v in vals]
            else:
                self.out[key] = []
        return key

    def commit(self):
        _SENT.update(self.out)
        return self.out


# ---------------------------------------------------------------- transforms

class _Transform:
    def __init__(self, kind, ax=None):
        self.kind, self.ax = kind, ax

    def transform(self, xy):
        return np.asarray(xy, dtype=float)

    def inverted(self):
        return self

    def __add__(self, other):
        return self

    def __radd__(self, other):
        return self


class Bbox:
    def __init__(self, x0, y0, w, h):
        self.x0, self.y0, self.width, self.height = float(x0), float(y0), float(w), float(h)

    x1 = property(lambda s: s.x0 + s.width)
    y1 = property(lambda s: s.y0 + s.height)
    xmin = property(lambda s: s.x0)
    ymin = property(lambda s: s.y0)
    xmax = property(lambda s: s.x1)
    ymax = property(lambda s: s.y1)
    bounds = property(lambda s: (s.x0, s.y0, s.width, s.height))

    def get_points(self):
        return np.array([[self.x0, self.y0], [self.x1, self.y1]])

    def __iter__(self):
        return iter(self.bounds)

    @staticmethod
    def from_bounds(x0, y0, w, h):
        return Bbox(x0, y0, w, h)

    @staticmethod
    def from_extents(x0, y0, x1, y1):
        return Bbox(x0, y0, x1 - x0, y1 - y0)


# ---------------------------------------------------------------- artists

class Artist:
    kind = 'artist'

    def __init__(self, **kw):
        self.id = next(_ids)
        self.axes = None
        self.figure = None
        self._label = str(kw.pop('label', '') or '')
        self._visible = bool(kw.pop('visible', True))
        self._zorder = kw.pop('zorder', None)
        self._alpha = kw.pop('alpha', None)
        self.props = {}
        self._owner = None          # the list this artist lives in
        self.tags = {}

    # ----- generic
    def remove(self):
        if self._owner is not None and self in self._owner:
            self._owner.remove(self)
        self._owner = None
        if self.axes is not None:
            self.axes._touch()

    def set_visible(self, v):
        self._visible = bool(v)
        self._touch()

    def get_visible(self):
        return self._visible

    def set_label(self, s):
        self._label = '' if s is None else str(s)

    def get_label(self):
        return self._label

    def set_zorder(self, z):
        self._zorder = z
        self._touch()

    def get_zorder(self):
        return self._zorder if self._zorder is not None else 2

    def set_alpha(self, a):
        self._alpha = a
        self._touch()

    def get_alpha(self):
        return self._alpha

    def set_animated(self, b):
        pass

    def set_picker(self, p):
        pass

    def set_clip_on(self, b):
        self.props['clip'] = bool(b)

    def set_transform(self, t):
        self.props['transform'] = getattr(t, 'kind', 'data')

    def get_transform(self):
        return _Transform(self.props.get('transform', 'data'), self.axes)

    def set_gid(self, g):
        self.tags['gid'] = g

    def get_window_extent(self, renderer=None):
        return Bbox(0, 0, 0, 0)

    def contains(self, event):
        return False, {}

    def set(self, **kw):
        for k, v in kw.items():
            fn = getattr(self, f'set_{k}', None)
            if fn:
                fn(v)
            else:
                self.props[k] = v
        return self

    update = set

    def _touch(self):
        if self.axes is not None:
            self.axes._touch()

    def __getattr__(self, name):
        if name.startswith('set_'):
            key = name[4:]

            def setter(*a, **kw):
                self.props[key] = a[0] if len(a) == 1 else (a if a else kw)
                self._touch()
            return setter
        if name.startswith('get_'):
            key = name[4:]
            return lambda *a, **kw: self.props.get(key)
        raise AttributeError(name)

    def _base(self, arrays):
        d = {'k': self.kind, 'id': self.id}
        if self._label and not self._label.startswith('_'):
            d['label'] = self._label
        if not self._visible:
            d['hidden'] = True
        if self._zorder is not None:
            d['z'] = self._zorder
        if self._alpha is not None:
            d['alpha'] = float(self._alpha)
        if self.tags:
            d['tags'] = {k: v for k, v in self.tags.items() if isinstance(v, (str, int, float, bool))}
        if self.props.get('transform'):
            d['tr'] = self.props['transform']
        return d

    def serial(self, arrays):
        return self._base(arrays)


class Line2D(Artist):
    kind = 'line'

    def __init__(self, xdata=(), ydata=(), linewidth=None, linestyle=None, color=None, marker=None,
                 markersize=None, **kw):
        lw = kw.pop('lw', None)
        ls = kw.pop('ls', None)
        c = kw.pop('c', None)
        ms = kw.pop('ms', None)
        mfc = kw.pop('markerfacecolor', kw.pop('mfc', None))
        mec = kw.pop('markeredgecolor', kw.pop('mec', None))
        drawstyle = kw.pop('drawstyle', kw.pop('ds', None))
        transform = kw.pop('transform', None)
        kw.pop('solid_capstyle', None)
        kw.pop('dash_capstyle', None)
        kw.pop('picker', None)
        kw.pop('pickradius', None)
        dashes = kw.pop('dashes', None)
        super().__init__(**kw)
        self._x = np.asarray(xdata, dtype=float).ravel() if xdata is not None else np.zeros(0)
        self._y = np.asarray(ydata, dtype=float).ravel() if ydata is not None else np.zeros(0)
        self.color = color if color is not None else c
        self.lw = linewidth if linewidth is not None else (lw if lw is not None else rcParams['lines.linewidth'])
        self.ls = _ls(linestyle if linestyle is not None else (ls if ls is not None else '-'))
        if dashes:
            self.ls = '--'
        self.marker = marker
        self.ms = markersize if markersize is not None else (ms if ms is not None else 6)
        self.mfc, self.mec = mfc, mec
        self.drawstyle = drawstyle
        self.axline = None        # 'v' / 'h' for axvline / axhline (x or y in data, the other in axes fraction)
        self.span = (0.0, 1.0)
        if transform is not None:
            self.props['transform'] = getattr(transform, 'kind', 'data')

    def set_data(self, *args):
        if len(args) == 1:
            args = args[0]
        self.set_xdata(args[0])
        self.set_ydata(args[1])

    def set_xdata(self, x):
        self._x = np.atleast_1d(np.asarray(x, dtype=float)).ravel()
        self._touch()

    def set_ydata(self, y):
        self._y = np.atleast_1d(np.asarray(y, dtype=float)).ravel()
        self._touch()

    def get_xdata(self, orig=True):
        return self._x

    def get_ydata(self, orig=True):
        return self._y

    def get_data(self, orig=True):
        return self._x, self._y

    def get_xydata(self):
        return np.column_stack([self._x, self._y])

    def set_color(self, c):
        self.color = c
        self._touch()

    def get_color(self):
        return self.color if self.color is not None else 'black'

    def set_linewidth(self, lw):
        self.lw = lw
        self._touch()

    set_lw = set_linewidth

    def get_linewidth(self):
        return self.lw

    def set_linestyle(self, ls):
        self.ls = _ls(ls)
        self._touch()

    set_ls = set_linestyle

    def get_linestyle(self):
        return self.ls

    def set_marker(self, m):
        self.marker = m
        self._touch()

    def get_marker(self):
        return self.marker

    def set_markersize(self, s):
        self.ms = s

    def set_markerfacecolor(self, c):
        self.mfc = c

    def set_markeredgecolor(self, c):
        self.mec = c

    def set_dashes(self, d):
        self.ls = '--'

    def serial(self, arrays):
        d = self._base(arrays)
        d['color'] = css_colour(self.color)
        d['lw'] = float(self.lw)
        d['ls'] = self.ls
        if self.marker not in (None, '', 'None', 'none'):
            d['marker'] = str(self.marker)
            d['ms'] = float(self.ms)
            if self.mfc is not None:
                d['mfc'] = css_colour(self.mfc)
            if self.mec is not None:
                d['mec'] = css_colour(self.mec)
        if self.drawstyle:
            d['drawstyle'] = self.drawstyle
        if self.axline:
            d['k'] = 'axline'
            d['dir'] = self.axline
            v = self._x if self.axline == 'v' else self._y
            d['at'] = float(v[0]) if v.size else None
            d['span'] = [float(self.span[0]), float(self.span[1])]
        else:
            d['x'] = arrays.ref(self._x)
            d['y'] = arrays.ref(self._y)
        return d


class Collection(Artist):
    kind = 'collection'

    def set_facecolor(self, c):
        self.props['facecolor'] = c
        self._touch()

    set_facecolors = set_facecolor

    def set_edgecolor(self, c):
        self.props['edgecolor'] = c
        self._touch()

    set_edgecolors = set_edgecolor

    def set_color(self, c):
        self.props['facecolor'] = c
        self.props['edgecolor'] = c
        self._touch()

    def get_facecolor(self):
        return self.props.get('facecolor')

    def set_offsets(self, xy):
        xy = np.asarray(xy, dtype=float).reshape(-1, 2)
        self.props['x'], self.props['y'] = xy[:, 0], xy[:, 1]
        self._touch()

    def get_offsets(self):
        return np.column_stack([self.props.get('x', []), self.props.get('y', [])])


class Scatter(Collection):
    kind = 'scatter'

    def serial(self, arrays):
        d = self._base(arrays)
        p = self.props
        d['x'] = arrays.ref(p.get('x'))
        d['y'] = arrays.ref(p.get('y'))
        c = p.get('c')
        if c is not None and np.ndim(c) == 1 and not isinstance(c, str) and len(c) == len(p.get('x', [])) \
                and np.issubdtype(np.asarray(c).dtype, np.number):
            d['cvals'] = arrays.ref(c)
            d['cmap'] = str(p.get('cmap') or 'viridis')
        else:
            d['color'] = css_colour(c if c is not None else (p.get('facecolor') or CYCLE[0]))
        d['s'] = float(np.mean(p.get('s'))) if p.get('s') is not None else 20.0
        d['marker'] = str(p.get('marker') or 'o')
        if p.get('edgecolor') is not None:
            d['ec'] = css_colour(p['edgecolor'])
        return d


class FillBetween(Collection):
    kind = 'fill'

    def serial(self, arrays):
        d = self._base(arrays)
        p = self.props
        x = np.asarray(p.get('x', []), dtype=float)
        y1 = np.broadcast_to(np.asarray(p.get('y1', 0.0), dtype=float), x.shape)
        y2 = np.broadcast_to(np.asarray(p.get('y2', 0.0), dtype=float), x.shape)
        where = p.get('where')
        if where is not None:
            w = np.asarray(where, dtype=bool)
            if w.shape == x.shape:
                y1 = np.where(w, y1, np.nan)
                y2 = np.where(w, y2, np.nan)
        d['x'] = arrays.ref(x)
        d['y1'] = arrays.ref(y1)
        d['y2'] = arrays.ref(y2)
        d['fc'] = css_colour(p.get('facecolor') if p.get('facecolor') is not None else CYCLE[0])
        if p.get('edgecolor') is not None:
            d['ec'] = css_colour(p['edgecolor'])
        if p.get('hatch'):
            d['hatch'] = str(p['hatch'])
        if p.get('horizontal'):
            d['horizontal'] = True
        return d


class Text(Artist):
    kind = 'text'

    def __init__(self, x=0, y=0, text='', **kw):
        transform = kw.pop('transform', None)
        super().__init__(**{k: kw.pop(k) for k in ('label', 'visible', 'zorder', 'alpha') if k in kw})
        self._x, self._y = x, y
        self._text = '' if text is None else str(text)
        self.style = {}
        for key, v in kw.items():
            self._style(key, v)
        if transform is not None:
            self.props['transform'] = getattr(transform, 'kind', 'data')

    def _style(self, key, v):
        key = {'size': 'fontsize', 'weight': 'fontweight', 'c': 'color', 'horizontalalignment': 'ha',
               'verticalalignment': 'va', 'family': 'fontfamily', 'style': 'fontstyle',
               'multialignment': 'ma'}.get(key, key)
        if key == 'fontproperties' and v is not None:
            return
        self.style[key] = v

    def set_text(self, t):
        self._text = '' if t is None else str(t)
        self._touch()

    def get_text(self):
        return self._text

    def set_position(self, xy):
        self._x, self._y = xy
        self._touch()

    def get_position(self):
        return (self._x, self._y)

    def set_x(self, x):
        self._x = x

    def set_y(self, y):
        self._y = y

    def set_color(self, c):
        self.style['color'] = c
        self._touch()

    def get_color(self):
        return self.style.get('color', 'black')

    def set_fontsize(self, s):
        self.style['fontsize'] = s
        self._touch()

    set_size = set_fontsize

    def get_fontsize(self):
        return self.style.get('fontsize', rcParams['font.size'])

    def set_fontweight(self, w):
        self.style['fontweight'] = w

    set_weight = set_fontweight

    def set_rotation(self, r):
        self.style['rotation'] = r

    def set_ha(self, h):
        self.style['ha'] = h

    set_horizontalalignment = set_ha

    def set_va(self, v):
        self.style['va'] = v

    set_verticalalignment = set_va

    def set_bbox(self, b):
        self.style['bbox'] = b

    def set_fontfamily(self, f):
        self.style['fontfamily'] = f

    def set_fontstyle(self, s):
        self.style['fontstyle'] = s

    def set_text_props(self, **kw):
        for k, v in kw.items():
            self._style(k, v)

    def get_window_extent(self, renderer=None):
        n = len(self._text)
        fs = float(self.get_fontsize() if isinstance(self.get_fontsize(), (int, float)) else 10)
        return Bbox(0, 0, n * fs * 0.6, fs * 1.2)

    def draggable(self, *a, **kw):
        return None

    def _textstyle(self):
        s = self.style
        out = {}
        if s.get('color') is not None:
            out['color'] = css_colour(s['color'])
        fs = s.get('fontsize')
        if fs is not None:
            out['size'] = float(fs) if isinstance(fs, (int, float)) else \
                {'xx-small': 5.8, 'x-small': 6.9, 'small': 8.3, 'medium': 10, 'large': 12, 'x-large': 14.4,
                 'xx-large': 17.3}.get(str(fs), 10.0)
        w = s.get('fontweight')
        if w in ('bold', 'heavy', 'semibold', 'demibold', 'extra bold', 'black') or (isinstance(w, (int, float)) and w >= 600):
            out['bold'] = True
        if s.get('fontstyle') in ('italic', 'oblique'):
            out['italic'] = True
        for k in ('ha', 'va'):
            if s.get(k):
                out[k] = str(s[k])
        if s.get('rotation') not in (None, 0, 'horizontal'):
            r = s['rotation']
            out['rotation'] = 90.0 if r == 'vertical' else float(r)
        if s.get('fontfamily'):
            fam = s['fontfamily']
            out['family'] = fam if isinstance(fam, str) else fam[0]
        bbox = s.get('bbox')
        if isinstance(bbox, dict):
            out['bbox'] = {'fc': css_colour(bbox.get('facecolor', bbox.get('fc', 'white'))),
                           'ec': css_colour(bbox.get('edgecolor', bbox.get('ec', 'black'))),
                           'alpha': float(bbox.get('alpha', 1.0)),
                           'pad': float(bbox.get('pad', 0.3)) if bbox.get('boxstyle') is None else 0.3}
        return out

    def serial(self, arrays):
        d = self._base(arrays)
        d['x'] = _num(self._x)
        d['y'] = _num(self._y)
        d['text'] = self._text
        d.update(self._textstyle())
        return d


def _num(v):
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


class Annotation(Text):
    kind = 'annotation'

    def __init__(self, text, xy, xytext=None, xycoords='data', textcoords=None, arrowprops=None, **kw):
        super().__init__(xy[0], xy[1], text, **kw)
        self.xy = xy
        self.xytext = xytext
        self.xycoords = xycoords
        self.textcoords = textcoords
        self.arrowprops = arrowprops

    def set_position(self, xy):
        self.xytext = xy
        self._touch()

    def serial(self, arrays):
        d = super().serial(arrays)
        d['xy'] = [_num(self.xy[0]), _num(self.xy[1])]
        xyc = self.xycoords
        d['xycoords'] = list(xyc) if isinstance(xyc, (tuple, list)) else str(getattr(xyc, 'kind', xyc))
        if self.xytext is not None:
            d['xytext'] = [_num(self.xytext[0]), _num(self.xytext[1])]
            d['textcoords'] = str(getattr(self.textcoords, 'kind', self.textcoords) or d['xycoords'])
        if isinstance(self.arrowprops, dict):
            ap = self.arrowprops
            d['arrow'] = {'color': css_colour(ap.get('color', ap.get('fc', ap.get('facecolor', 'black')))),
                          'style': str(ap.get('arrowstyle', '->')), 'lw': float(ap.get('lw', ap.get('linewidth', 1.0)))}
        return d


class Patch(Artist):
    kind = 'patch'

    def __init__(self, shape='rect', **kw):
        fc = kw.pop('facecolor', kw.pop('fc', None))
        ec = kw.pop('edgecolor', kw.pop('ec', None))
        color = kw.pop('color', None)
        lw = kw.pop('linewidth', kw.pop('lw', None))
        ls = kw.pop('linestyle', kw.pop('ls', None))
        fill = kw.pop('fill', True)
        hatch = kw.pop('hatch', None)
        transform = kw.pop('transform', None)
        for k in ('label', 'visible', 'zorder', 'alpha'):
            pass
        base = {k: kw.pop(k) for k in ('label', 'visible', 'zorder', 'alpha') if k in kw}
        super().__init__(**base)
        self.shape = shape
        self.geom = {}
        if color is not None:
            fc = fc if fc is not None else color
            ec = ec if ec is not None else color
        self.fc = fc if fill else 'none'
        self.ec = ec
        self.lw = lw
        self.ls = _ls(ls) if ls else '-'
        self.hatch = hatch
        if transform is not None:
            self.props['transform'] = getattr(transform, 'kind', 'data')
        self.extra = kw

    def set_facecolor(self, c):
        self.fc = c
        self._touch()

    def set_edgecolor(self, c):
        self.ec = c
        self._touch()

    def set_color(self, c):
        self.fc = self.ec = c
        self._touch()

    def get_facecolor(self):
        return self.fc

    def set_linewidth(self, lw):
        self.lw = lw

    def set_linestyle(self, ls):
        self.ls = _ls(ls)

    def set_xy(self, xy):
        self.geom['xy'] = [float(v) for v in xy] if np.ndim(xy) == 1 else np.asarray(xy, dtype=float).tolist()
        self._touch()

    def get_xy(self):
        return self.geom.get('xy')

    def set_width(self, w):
        self.geom['w'] = float(w)

    def set_height(self, h):
        self.geom['h'] = float(h)

    def get_width(self):
        return self.geom.get('w', 0)

    def get_height(self):
        return self.geom.get('h', 0)

    def get_x(self):
        return (self.geom.get('xy') or [0, 0])[0]

    def get_y(self):
        return (self.geom.get('xy') or [0, 0])[1]

    def set_positions(self, a, b):
        self.geom['a'] = [float(a[0]), float(a[1])]
        self.geom['b'] = [float(b[0]), float(b[1])]
        self._touch()

    def set_center(self, c):
        self.geom['center'] = [float(c[0]), float(c[1])]

    def set_radius(self, r):
        self.geom['r'] = float(r)

    def serial(self, arrays):
        d = self._base(arrays)
        d['shape'] = self.shape
        d['geom'] = _clean(self.geom)
        d['fc'] = css_colour(self.fc) if self.fc is not None else None
        d['ec'] = css_colour(self.ec) if self.ec is not None else None
        if self.lw is not None:
            d['lw'] = float(self.lw)
        d['ls'] = self.ls
        if self.hatch:
            d['hatch'] = str(self.hatch)
        return d


def _clean(v):
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple, np.ndarray)):
        return [_clean(x) for x in (v.tolist() if isinstance(v, np.ndarray) else v)]
    if isinstance(v, (float, np.floating)):
        return float(v) if math.isfinite(float(v)) else None
    if isinstance(v, (int, np.integer)):
        return int(v)
    if isinstance(v, (str, bool)) or v is None:
        return v
    return str(v)


class Cell:
    def __init__(self, text=''):
        self.text = Text(0, 0, text)
        self.fc = '#ffffff'
        self.ec = '#000000'
        self.visible_edges = 'closed'

    def set_edgecolor(self, c):
        self.ec = c

    def set_facecolor(self, c):
        self.fc = c

    def set_text_props(self, **kw):
        self.text.set_text_props(**kw)

    def get_text(self):
        return self.text

    def set_height(self, h):
        pass

    def set_width(self, w):
        pass

    def set_linewidth(self, w):
        pass

    def set_alpha(self, a):
        pass


class Table(Artist):
    kind = 'table'

    def __init__(self, cellText=None, colLabels=None, rowLabels=None, loc='bottom', cellLoc='right',
                 colWidths=None, colColours=None, cellColours=None, bbox=None, **kw):
        super().__init__()
        self.cells = {}
        offset = 0
        if colLabels is not None:
            for c, label in enumerate(colLabels):
                self.cells[(0, c)] = Cell(label)
            offset = 1
        for r, row in enumerate(cellText or []):
            for c, v in enumerate(row):
                self.cells[(r + offset, c)] = Cell(v)
        self.loc, self.cellLoc = loc, cellLoc
        self.fontsize = 10
        self.yscale = 1.0

    def auto_set_font_size(self, v=True):
        pass

    def set_fontsize(self, s):
        self.fontsize = s

    def scale(self, xs, ys):
        self.yscale = ys

    def get_celld(self):
        return self.cells

    def auto_set_column_width(self, cols):
        pass

    def __getitem__(self, rc):
        return self.cells[rc]

    def serial(self, arrays):
        d = self._base(arrays)
        rows = max((r for r, _c in self.cells), default=-1) + 1
        cols = max((c for _r, c in self.cells), default=-1) + 1
        grid = []
        for r in range(rows):
            line = []
            for c in range(cols):
                cell = self.cells.get((r, c))
                if cell is None:
                    line.append(None)
                    continue
                line.append({'t': cell.text.get_text(), 'fc': css_colour(cell.fc), 'ec': css_colour(cell.ec),
                             **cell.text._textstyle()})
            grid.append(line)
        d.update({'cells': grid, 'fontsize': float(self.fontsize), 'yscale': float(self.yscale), 'align': self.cellLoc})
        return d


class Legend(Artist):
    kind = 'legend'

    def __init__(self, entries, loc='best', **kw):
        super().__init__()
        self.entries = entries
        self.loc = loc
        self.kw = kw
        self._title = Text(0, 0, kw.get('title') or '')

    def get_texts(self):
        return [Text(0, 0, label) for label, _h in self.entries]

    def get_lines(self):
        return [h for _l, h in self.entries if isinstance(h, Line2D)]

    def get_title(self):
        return self._title

    def set_draggable(self, *a, **kw):
        pass

    draggable = set_draggable

    def get_frame(self):
        return Patch()

    def set_bbox_to_anchor(self, *a, **kw):
        pass

    def serial(self, arrays):
        d = self._base(arrays)
        loc = self.loc
        if isinstance(loc, int):
            loc = {0: 'best', 1: 'upper right', 2: 'upper left', 3: 'lower left', 4: 'lower right', 5: 'right',
                   6: 'center left', 7: 'center right', 8: 'lower center', 9: 'upper center', 10: 'center'}.get(loc,
                                                                                                                'best')
        d['loc'] = str(loc)
        items = []
        for label, h in self.entries:
            e = {'label': str(label)}
            if isinstance(h, Line2D):
                e.update(h=('line'), color=css_colour(h.color or 'black'), lw=float(h.lw), ls=h.ls,
                         marker=str(h.marker) if h.marker not in (None, '', 'None', 'none') else None)
            elif isinstance(h, Scatter):
                e.update(h='scatter', color=css_colour(h.props.get('c') if isinstance(h.props.get('c'), str)
                                                       else h.props.get('facecolor') or CYCLE[0]),
                         marker=str(h.props.get('marker') or 'o'))
            elif isinstance(h, FillBetween):
                e.update(h='patch', color=css_colour(h.props.get('facecolor') or CYCLE[0]),
                         alpha=float(h._alpha) if h._alpha is not None else 1.0)
            elif isinstance(h, Patch):
                e.update(h='patch', color=css_colour(h.fc or h.ec or CYCLE[0]),
                         alpha=float(h._alpha) if h._alpha is not None else 1.0)
            else:
                e['h'] = 'none'
            if getattr(h, '_alpha', None) is not None and 'alpha' not in e:
                e['alpha'] = float(h._alpha)
            items.append(e)
        d['items'] = items
        kw = self.kw
        d['frameon'] = bool(kw.get('frameon', True))
        d['framealpha'] = float(kw.get('framealpha') if kw.get('framealpha') is not None else 0.8)
        d['edgecolor'] = css_colour(kw.get('edgecolor') or '#cccccc')
        if kw.get('fontsize') is not None:
            fs = kw['fontsize']
            d['fontsize'] = float(fs) if isinstance(fs, (int, float)) else 10.0
        if kw.get('ncol') or kw.get('ncols'):
            d['ncol'] = int(kw.get('ncol') or kw.get('ncols'))
        if kw.get('title'):
            d['title'] = str(kw['title'])
        return d


# ---------------------------------------------------------------- axis bits

class _TickLabel:
    def set_visible(self, v):
        pass

    def set_fontsize(self, s):
        pass

    def set_rotation(self, r):
        pass

    def set_color(self, c):
        pass

    def get_text(self):
        return ''


class Axis:
    def __init__(self, ax, which):
        self.ax, self.which = ax, which
        self.visible = True
        self.label = Text(0, 0, '')
        self.formatter = None
        self.side = 'left' if which == 'y' else 'bottom'

    def set_visible(self, v):
        self.visible = bool(v)
        self.ax._touch()

    def get_visible(self):
        return self.visible

    def set_major_formatter(self, f):
        self.formatter = f
        if getattr(f, 'sci', None) is not None:
            self.ax._format[self.which] = 'sci' if f.sci else 'plain'

    def set_minor_formatter(self, f):
        pass

    def set_major_locator(self, loc):
        if getattr(loc, 'fixed', None) is not None:
            self.ax._ticks[self.which] = list(loc.fixed)

    def set_minor_locator(self, loc):
        pass

    def get_major_formatter(self):
        return self.formatter

    def get_offset_text(self):
        return Text()

    def set_label_position(self, p):
        self.side = p

    def set_ticks_position(self, p):
        self.side = p

    def tick_right(self):
        self.side = 'right'

    def tick_left(self):
        self.side = 'left'

    def tick_top(self):
        self.side = 'top'

    def tick_bottom(self):
        self.side = 'bottom'

    def set_tick_params(self, **kw):
        self.ax.tick_params(axis=self.which, **kw)

    def get_ticklabels(self, *a, **kw):
        return [_TickLabel() for _ in range(6)]

    def set_ticklabels(self, labels, *a, **kw):
        self.ax._ticklabels[self.which] = [str(t) for t in labels]

    def get_label(self):
        return self.label

    def set_label_coords(self, x, y):
        pass

    def set_inverted(self, inv):
        if inv:
            self.ax.invert_xaxis() if self.which == 'x' else self.ax.invert_yaxis()

    def get_inverted(self):
        return self.ax.xaxis_inverted() if self.which == 'x' else self.ax.yaxis_inverted()

    def get_major_ticks(self):
        return []

    def grid(self, *a, **kw):
        pass

    def set_units(self, u):
        pass

    def get_scale(self):
        return self.ax._scale[self.which]

    def axis_date(self, *a):
        pass

    def set_visible_ticks(self, *a):
        pass

    def get_tick_space(self):
        return 6

    def set_major_locator_fixed(self, ticks):
        self.ax._ticks[self.which] = list(ticks)


class Spine:
    def __init__(self, ax, which):
        self.ax, self.which = ax, which
        self.visible = True
        self.color = None
        self.lw = None
        self.outward = 0.0

    def set_position(self, pos):
        if isinstance(pos, tuple) and pos and pos[0] == 'outward':
            self.outward = float(pos[1])
        self.ax._touch()

    def set_color(self, c):
        self.color = c
        self.ax._touch()

    set_edgecolor = set_color

    def set_linewidth(self, lw):
        self.lw = lw

    set_lw = set_linewidth

    def set_visible(self, v):
        self.visible = bool(v)
        self.ax._touch()

    def get_visible(self):
        return self.visible

    def set_bounds(self, *a):
        pass

    def set_linestyle(self, ls):
        pass

    def set_alpha(self, a):
        pass


class _Spines(dict):
    def values(self):
        return list(super().values())

    def __getattr__(self, name):
        return self[name]


class _Callbacks:
    def __init__(self):
        self.fns = {}
        self.ids = itertools.count(1)

    def connect(self, sig, fn):
        cid = next(self.ids)
        self.fns[cid] = (sig, fn)
        return cid

    def disconnect(self, cid):
        self.fns.pop(cid, None)

    def process(self, sig, *a):
        for s, fn in list(self.fns.values()):
            if s == sig:
                try:
                    fn(*a)
                except Exception:
                    pass


class _Patch(Patch):
    """The axes background."""

    def __init__(self):
        super().__init__('axesbg', facecolor='white')


# ---------------------------------------------------------------- axes

def _finite(values):
    a = np.asarray(values, dtype=float).ravel() if values is not None else np.zeros(0)
    return a[np.isfinite(a)]


class Axes:
    def __init__(self, fig, rect=(0.125, 0.11, 0.775, 0.77), sharex=None, twin_of=None, **kw):
        self.figure = fig
        self.id = next(_ids)
        self._pos = Bbox(*rect)
        self.twin_of = twin_of
        self._sharex = sharex
        self.lines, self.texts, self.patches, self.collections, self.artists, self.tables, self.images = \
            [], [], [], [], [], [], []
        self.child_axes = []
        self._legend = None
        self._xlim = None
        self._ylim = None
        self._xinv = False
        self._yinv = False
        self._labels = {'x': Text(0, 0, ''), 'y': Text(0, 0, '')}
        self._title = Text(0, 0, '')
        self._ticks = {'x': None, 'y': None}
        self._ticklabels = {'x': None, 'y': None}
        self._tickp = {'x': {}, 'y': {}}
        self._format = {'x': 'plain', 'y': 'auto'}
        self._scilimits = {'x': None, 'y': None}
        self._scale = {'x': 'linear', 'y': 'linear'}
        self._aspect = 'auto'
        self._axis_on = True
        self._zorder = 0
        self._margins = (0.05, 0.05)
        self._grid = False
        self.patch = _Patch()
        self.patch.axes = self
        self.xaxis = Axis(self, 'x')
        self.yaxis = Axis(self, 'y')
        self.spines = _Spines(top=Spine(self, 'top'), bottom=Spine(self, 'bottom'), left=Spine(self, 'left'),
                              right=Spine(self, 'right'))
        self.callbacks = _Callbacks()
        self.transAxes = _Transform('axes', self)
        self.transData = _Transform('data', self)
        self._label = kw.get('label', '')
        self._visible = True
        self._color_cycle = itertools.cycle(CYCLE)
        self.tags = {}

    def _touch(self):
        if self.figure is not None:
            self.figure._touch()

    # ----- figure geometry
    def set_position(self, pos, which='both'):
        if isinstance(pos, Bbox):
            self._pos = Bbox(pos.x0, pos.y0, pos.width, pos.height)
        else:
            self._pos = Bbox(*[float(v) for v in pos])
        self._touch()

    def get_position(self, original=False):
        return Bbox(self._pos.x0, self._pos.y0, self._pos.width, self._pos.height)

    def get_figure(self):
        return self.figure

    def set_zorder(self, z):
        self._zorder = z
        self._touch()

    def get_zorder(self):
        return self._zorder

    def set_visible(self, v):
        self._visible = bool(v)
        self._touch()

    def get_visible(self):
        return self._visible

    def remove(self):
        if self.figure is not None:
            self.figure.delaxes(self)

    def get_window_extent(self, renderer=None):
        w, h = self.figure.size_px()
        return Bbox(self._pos.x0 * w, self._pos.y0 * h, self._pos.width * w, self._pos.height * h)

    get_tightbbox = get_window_extent

    # ----- adding
    def _adopt(self, artist, where):
        artist.axes = self
        artist.figure = self.figure
        artist._owner = where
        where.append(artist)
        self._touch()
        return artist

    def add_line(self, line):
        return self._adopt(line, self.lines)

    def add_patch(self, patch):
        return self._adopt(patch, self.patches)

    def add_artist(self, a):
        if isinstance(a, Text):
            return self._adopt(a, self.texts)
        if isinstance(a, Legend):
            self._legend = a
            a.axes = self
            return a
        return self._adopt(a, self.artists)

    def add_collection(self, c, autolim=True):
        return self._adopt(c, self.collections)

    def add_table(self, t):
        return self._adopt(t, self.tables)

    def add_child_axes(self, ax):
        self.child_axes.append(ax)
        return ax

    def _next_colour(self):
        return next(self._color_cycle)

    # ----- plotting
    def plot(self, *args, **kw):
        args = list(args)
        lines = []
        while args:
            if len(args) >= 2 and not isinstance(args[1], str):
                x, y = args[0], args[1]
                args = args[2:]
            else:
                y = args[0]
                x = np.arange(len(np.atleast_1d(y)))
                args = args[1:]
            fmt = None
            if args and isinstance(args[0], str):
                fmt = args.pop(0)
            line_kw = dict(kw)
            if fmt:
                _apply_fmt(fmt, line_kw)
            y = np.asarray(y, dtype=float)
            x = np.asarray(x, dtype=float)
            if y.ndim == 2:
                for col in range(y.shape[1]):
                    c = line_kw.get('color', line_kw.get('c')) or self._next_colour()
                    lines.append(self.add_line(Line2D(x, y[:, col], **{**line_kw, 'color': c})))
                continue
            if line_kw.get('color') is None and line_kw.get('c') is None:
                line_kw['color'] = self._next_colour()
            lines.append(self.add_line(Line2D(x, y, **line_kw)))
        return lines

    def step(self, x, y, *args, where='pre', **kw):
        kw['drawstyle'] = f'steps-{where}'
        return self.plot(x, y, *args, **kw)

    def semilogy(self, *a, **kw):
        self.set_yscale('log')
        return self.plot(*a, **kw)

    def semilogx(self, *a, **kw):
        self.set_xscale('log')
        return self.plot(*a, **kw)

    def loglog(self, *a, **kw):
        self.set_xscale('log')
        self.set_yscale('log')
        return self.plot(*a, **kw)

    def errorbar(self, x, y, yerr=None, xerr=None, fmt='', **kw):
        kw.pop('capsize', None)
        kw.pop('ecolor', None)
        kw.pop('elinewidth', None)
        kw.pop('capthick', None)
        lines = self.plot(x, y, fmt, **kw) if fmt else self.plot(x, y, **kw)
        return lines[0] if lines else None

    def scatter(self, x, y, s=None, c=None, marker=None, cmap=None, norm=None, vmin=None, vmax=None, alpha=None,
                linewidths=None, edgecolors=None, **kw):
        color = kw.pop('color', None)
        facecolor = kw.pop('facecolor', kw.pop('facecolors', None))
        col = Scatter(label=kw.pop('label', ''), zorder=kw.pop('zorder', None), alpha=alpha)
        col.props.update(x=np.asarray(x, dtype=float).ravel(), y=np.asarray(y, dtype=float).ravel(), s=s,
                         c=c if c is not None else (color if color is not None else facecolor),
                         marker=marker or 'o', cmap=getattr(cmap, 'name', cmap), edgecolor=edgecolors)
        if col.props['c'] is None:
            col.props['c'] = self._next_colour()
        return self.add_collection(col)

    def fill_between(self, x, y1, y2=0, where=None, interpolate=False, step=None, **kw):
        fc = kw.pop('facecolor', kw.pop('fc', None))
        color = kw.pop('color', None)
        ec = kw.pop('edgecolor', kw.pop('ec', None))
        col = FillBetween(label=kw.pop('label', ''), zorder=kw.pop('zorder', None), alpha=kw.pop('alpha', None))
        col.props.update(x=np.asarray(x, dtype=float).ravel(), y1=np.asarray(y1, dtype=float),
                         y2=np.asarray(y2, dtype=float), where=where,
                         facecolor=fc if fc is not None else (color if color is not None else self._next_colour()),
                         edgecolor=ec if ec is not None else None, hatch=kw.pop('hatch', None))
        return self.add_collection(col)

    def fill_betweenx(self, y, x1, x2=0, where=None, **kw):
        col = self.fill_between(y, x1, x2, where, **kw)
        col.props['horizontal'] = True
        return col

    def fill(self, x, y, *a, **kw):
        p = Patch('polygon', **kw)
        p.geom['xy'] = np.column_stack([np.asarray(x, float), np.asarray(y, float)]).tolist()
        return [self.add_patch(p)]

    def bar(self, x, height, width=0.8, bottom=None, align='center', **kw):
        color = kw.pop('color', None) or kw.pop('facecolor', None) or self._next_colour()
        ec = kw.pop('edgecolor', None)
        label = kw.pop('label', '')
        x = np.atleast_1d(np.asarray(x, dtype=float))
        h = np.broadcast_to(np.asarray(height, dtype=float), x.shape)
        w = np.broadcast_to(np.asarray(width, dtype=float), x.shape)
        b = np.broadcast_to(np.asarray(bottom if bottom is not None else 0.0, dtype=float), x.shape)
        out = []
        for i in range(x.size):
            x0 = x[i] - w[i] / 2 if align == 'center' else x[i]
            p = Patch('rect', facecolor=color, edgecolor=ec, label=label if i == 0 else '_nolegend_', **kw)
            p.geom.update(xy=[float(x0), float(b[i])], w=float(w[i]), h=float(h[i]))
            out.append(self.add_patch(p))
        return out

    def barh(self, y, width, height=0.8, left=None, **kw):
        out = []
        y = np.atleast_1d(np.asarray(y, dtype=float))
        wv = np.broadcast_to(np.asarray(width, dtype=float), y.shape)
        color = kw.pop('color', None) or self._next_colour()
        for i in range(y.size):
            p = Patch('rect', facecolor=color)
            p.geom.update(xy=[float(left or 0.0), float(y[i] - height / 2)], w=float(wv[i]), h=float(height))
            out.append(self.add_patch(p))
        return out

    def hist(self, x, bins=10, range=None, density=False, color=None, **kw):
        counts, edges = np.histogram(np.asarray(x, dtype=float)[np.isfinite(np.asarray(x, dtype=float))], bins=bins,
                                     range=range, density=density)
        widths = np.diff(edges)
        self.bar(edges[:-1], counts, widths, align='edge', color=color or self._next_colour(), **kw)
        return counts, edges, None

    def axvline(self, x=0, ymin=0, ymax=1, **kw):
        line = Line2D([x, x], [ymin, ymax], **kw)
        line.axline = 'v'
        line.span = (ymin, ymax)
        return self.add_line(line)

    def axhline(self, y=0, xmin=0, xmax=1, **kw):
        line = Line2D([xmin, xmax], [y, y], **kw)
        line.axline = 'h'
        line.span = (xmin, xmax)
        return self.add_line(line)

    def axvspan(self, xmin, xmax, ymin=0, ymax=1, **kw):
        p = Patch('vspan', **kw)
        p.geom.update(x0=float(xmin), x1=float(xmax), y0=float(ymin), y1=float(ymax))
        return self.add_patch(p)

    def axhspan(self, ymin, ymax, xmin=0, xmax=1, **kw):
        p = Patch('hspan', **kw)
        p.geom.update(y0=float(ymin), y1=float(ymax), x0=float(xmin), x1=float(xmax))
        return self.add_patch(p)

    def vlines(self, x, ymin, ymax, colors=None, linestyles='solid', **kw):
        out = []
        xs = np.atleast_1d(np.asarray(x, dtype=float))
        lo = np.broadcast_to(np.asarray(ymin, dtype=float), xs.shape)
        hi = np.broadcast_to(np.asarray(ymax, dtype=float), xs.shape)
        color = colors if isinstance(colors, str) or colors is None else colors
        for i in range(xs.size):
            c = color[i] if isinstance(color, (list, tuple)) and len(color) == xs.size else color
            out.append(self.add_line(Line2D([xs[i], xs[i]], [lo[i], hi[i]], color=c or 'black',
                                            linestyle=linestyles, label='_nolegend_' if i else kw.get('label', ''),
                                            **{k: v for k, v in kw.items() if k != 'label'})))
        return out

    def hlines(self, y, xmin, xmax, colors=None, linestyles='solid', **kw):
        out = []
        ys = np.atleast_1d(np.asarray(y, dtype=float))
        lo = np.broadcast_to(np.asarray(xmin, dtype=float), ys.shape)
        hi = np.broadcast_to(np.asarray(xmax, dtype=float), ys.shape)
        for i in range(ys.size):
            out.append(self.add_line(Line2D([lo[i], hi[i]], [ys[i], ys[i]], color=colors or 'black',
                                            linestyle=linestyles, **{k: v for k, v in kw.items() if k != 'label'})))
        return out

    def text(self, x, y, s, fontdict=None, **kw):
        if fontdict:
            kw = {**fontdict, **kw}
        return self._adopt(Text(x, y, s, **kw), self.texts)

    def annotate(self, text, xy, xytext=None, xycoords='data', textcoords=None, arrowprops=None, annotation_clip=None,
                 **kw):
        return self._adopt(Annotation(text, xy, xytext, xycoords, textcoords, arrowprops, **kw), self.texts)

    def arrow(self, x, y, dx, dy, **kw):
        p = Patch('arrow', **{k: v for k, v in kw.items() if k in ('color', 'fc', 'ec', 'facecolor', 'edgecolor', 'lw',
                                                                   'linewidth', 'alpha', 'zorder')})
        p.geom.update(a=[float(x), float(y)], b=[float(x + dx), float(y + dy)], style='-|>')
        return self.add_patch(p)

    def table(self, cellText=None, **kw):
        t = Table(cellText, **kw)
        return self.add_table(t)

    def imshow(self, X, cmap=None, aspect=None, extent=None, origin=None, **kw):
        p = Patch('image')
        arr = np.asarray(X)
        p.geom.update(shape=list(arr.shape[:2]), extent=list(extent) if extent is not None else None)
        self.images.append(p)
        p.axes = self
        p._owner = self.images
        return p

    def pcolormesh(self, *a, **kw):
        return self.imshow(np.zeros((1, 1)))

    def contour(self, *a, **kw):
        return None

    contourf = contour

    # ----- legend
    def get_legend_handles_labels(self, legend_handler_map=None):
        handles, labels = [], []
        for coll in (self.lines, self.collections, self.patches):
            for a in coll:
                lab = a.get_label()
                if lab and not lab.startswith('_'):
                    handles.append(a)
                    labels.append(lab)
        # matplotlib orders lines, then patches, then collections
        return handles, labels

    def legend(self, *args, **kw):
        handles = kw.pop('handles', None)
        labels = kw.pop('labels', None)
        if len(args) == 2:
            handles, labels = args
        elif len(args) == 1:
            labels = args[0]
        if handles is None:
            h, lab = self.get_legend_handles_labels()
            handles = h
            if labels is None:
                labels = lab
            else:
                handles = handles[:len(labels)]
        if labels is None:
            labels = [h.get_label() for h in handles]
        loc = kw.pop('loc', 'best')
        self._legend = Legend(list(zip(labels, handles)), loc, **kw)
        self._legend.axes = self
        self._touch()
        return self._legend

    def get_legend(self):
        return self._legend

    # ----- limits and scales
    def _data_extent(self, which):
        vals = []
        axes = [self] + ([a for a in self.figure.axes if a._sharex is self] if which == 'x' else [])
        for ax in axes:
            for line in ax.lines:
                if not line._visible or line.axline == ('h' if which == 'x' else 'v'):
                    continue
                if line.axline and line.props.get('transform') != 'axes':
                    vals.append(_finite(line._x if which == 'x' else line._y)[:1])
                    continue
                if line.props.get('transform') in ('axes', 'figure'):
                    continue
                vals.append(_finite(line._x if which == 'x' else line._y))
            for c in ax.collections:
                if isinstance(c, FillBetween):
                    if which == 'x':
                        vals.append(_finite(c.props.get('x')))
                    else:
                        vals.append(_finite(c.props.get('y1')))
                        vals.append(_finite(c.props.get('y2')))
                elif isinstance(c, Scatter):
                    vals.append(_finite(c.props.get(which)))
            for p in ax.patches:
                if p.shape == 'rect' and 'xy' in p.geom:
                    x0, y0 = p.geom['xy']
                    if which == 'x':
                        vals.append(_finite([x0, x0 + p.geom.get('w', 0)]))
                    else:
                        vals.append(_finite([y0, y0 + p.geom.get('h', 0)]))
            if which == 'y' or ax is self:
                pass
        vals = [v for v in vals if v.size]
        if not vals:
            return None
        allv = np.concatenate(vals)
        return float(allv.min()), float(allv.max())

    def _auto(self, which):
        ext = self._data_extent(which)
        if ext is None:
            return (0.0, 1.0)
        lo, hi = ext
        if hi == lo:
            d = abs(lo) * 0.05 or 0.05
            return lo - d, hi + d
        m = self._margins[0 if which == 'x' else 1] * (hi - lo)
        return lo - m, hi + m

    def get_xlim(self):
        if self._sharex is not None:
            return self._sharex.get_xlim()
        lim = self._xlim if self._xlim is not None else self._auto('x')
        return (lim[1], lim[0]) if self._xinv and lim[0] < lim[1] else tuple(lim)

    def get_ylim(self):
        lim = self._ylim if self._ylim is not None else self._auto('y')
        return (lim[1], lim[0]) if self._yinv and lim[0] < lim[1] else tuple(lim)

    def set_xlim(self, left=None, right=None, emit=True, auto=False, xmin=None, xmax=None):
        if self._sharex is not None:
            return self._sharex.set_xlim(left, right, emit, auto, xmin, xmax)
        if isinstance(left, (tuple, list, np.ndarray)):
            left, right = left[0], left[1]
        left = xmin if left is None and xmin is not None else left
        right = xmax if right is None and xmax is not None else right
        cur = self.get_xlim() if (left is None or right is None) else (left, right)
        left = cur[0] if left is None else left
        right = cur[1] if right is None else right
        self._xlim = (float(left), float(right))
        self._xinv = False
        self._touch()
        self.callbacks.process('xlim_changed', self)
        return self._xlim

    def set_ylim(self, bottom=None, top=None, emit=True, auto=False, ymin=None, ymax=None):
        if isinstance(bottom, (tuple, list, np.ndarray)):
            bottom, top = bottom[0], bottom[1]
        bottom = ymin if bottom is None and ymin is not None else bottom
        top = ymax if top is None and ymax is not None else top
        cur = self.get_ylim() if (bottom is None or top is None) else (bottom, top)
        bottom = cur[0] if bottom is None else bottom
        top = cur[1] if top is None else top
        self._ylim = (float(bottom), float(top))
        self._yinv = False
        self._touch()
        self.callbacks.process('ylim_changed', self)
        return self._ylim

    def set_xbound(self, lower=None, upper=None):
        self.set_xlim(lower, upper)

    def set_ybound(self, lower=None, upper=None):
        self.set_ylim(lower, upper)

    get_xbound = get_xlim
    get_ybound = get_ylim

    def invert_xaxis(self):
        a, b = self.get_xlim()
        self._xlim = (b, a)
        self._touch()

    def invert_yaxis(self):
        a, b = self.get_ylim()
        self._ylim = (b, a)
        self._touch()

    def xaxis_inverted(self):
        a, b = self.get_xlim()
        return a > b

    def yaxis_inverted(self):
        a, b = self.get_ylim()
        return a > b

    def set_xscale(self, s, **kw):
        self._scale['x'] = s
        self._touch()

    def set_yscale(self, s, **kw):
        self._scale['y'] = s
        self._touch()

    def get_xscale(self):
        return self._scale['x']

    def get_yscale(self):
        return self._scale['y']

    def margins(self, *args, x=None, y=None, tight=True):
        if args:
            mx = args[0]
            my = args[1] if len(args) > 1 else args[0]
        else:
            mx, my = x, y
        self._margins = (self._margins[0] if mx is None else mx, self._margins[1] if my is None else my)
        return self._margins

    def relim(self, visible_only=False):
        pass

    def autoscale_view(self, tight=None, scalex=True, scaley=True):
        if scalex and self._sharex is None:
            self._xlim = None
        if scaley:
            self._ylim = None
        self._touch()

    def autoscale(self, enable=True, axis='both', tight=None):
        if axis in ('both', 'x') and self._sharex is None:
            self._xlim = None
        if axis in ('both', 'y'):
            self._ylim = None

    def set_aspect(self, aspect, adjustable=None, anchor=None, share=False):
        self._aspect = aspect

    def get_aspect(self):
        return self._aspect

    def set_box_aspect(self, a):
        pass

    # ----- labels and ticks
    def set_xlabel(self, label, fontdict=None, labelpad=None, **kw):
        t = Text(0, 0, label, **{**(fontdict or {}), **kw})
        self._labels['x'] = t
        self.xaxis.label = t
        self._touch()
        return t

    def set_ylabel(self, label, fontdict=None, labelpad=None, **kw):
        t = Text(0, 0, label, **{**(fontdict or {}), **kw})
        self._labels['y'] = t
        self.yaxis.label = t
        self._touch()
        return t

    def get_xlabel(self):
        return self._labels['x'].get_text()

    def get_ylabel(self):
        return self._labels['y'].get_text()

    def set_title(self, label, fontdict=None, loc='center', pad=None, **kw):
        self._title = Text(0, 0, label, **{**(fontdict or {}), **kw})
        self._title.style.setdefault('loc', loc)
        self._touch()
        return self._title

    def get_title(self, loc='center'):
        return self._title.get_text()

    def set_xticks(self, ticks, labels=None, minor=False, **kw):
        if minor:
            return
        self._ticks['x'] = [float(t) for t in ticks]
        if labels is not None:
            self._ticklabels['x'] = [str(t) for t in labels]
        self._touch()

    def set_yticks(self, ticks, labels=None, minor=False, **kw):
        if minor:
            return
        self._ticks['y'] = [float(t) for t in ticks]
        if labels is not None:
            self._ticklabels['y'] = [str(t) for t in labels]
        self._touch()

    def set_xticklabels(self, labels, *a, **kw):
        self._ticklabels['x'] = [str(t) for t in labels]

    def set_yticklabels(self, labels, *a, **kw):
        self._ticklabels['y'] = [str(t) for t in labels]

    def get_xticks(self):
        return np.asarray(self._ticks['x'] or [])

    def get_yticks(self):
        return np.asarray(self._ticks['y'] or [])

    def get_xticklabels(self, *a, **kw):
        return [_TickLabel() for _ in range(6)]

    get_yticklabels = get_xticklabels

    def tick_params(self, axis='both', which='major', reset=False, **kw):
        for a in (('x', 'y') if axis == 'both' else (axis,)):
            p = self._tickp[a]
            if 'colors' in kw:
                p['color'] = css_colour(kw['colors'])
            if 'labelcolor' in kw:
                p['color'] = css_colour(kw['labelcolor'])
            if 'labelsize' in kw:
                p['size'] = float(kw['labelsize']) if isinstance(kw['labelsize'], (int, float)) else 10.0
            for k in ('labelleft', 'labelbottom', 'labelright', 'labeltop', 'left', 'bottom', 'right', 'top'):
                if k in kw:
                    p[k] = bool(kw[k])
            if 'direction' in kw:
                p['direction'] = kw['direction']
            if 'length' in kw:
                p['length'] = float(kw['length'])
        self._touch()

    def ticklabel_format(self, axis='both', style='', scilimits=None, useOffset=None, useLocale=None,
                         useMathText=None):
        for a in (('x', 'y') if axis == 'both' else (axis,)):
            if style in ('plain',):
                self._format[a] = 'plain'
            elif style in ('sci', 'scientific'):
                self._format[a] = 'sci'
                self._scilimits[a] = list(scilimits) if scilimits is not None else None
        self._touch()

    def locator_params(self, *a, **kw):
        pass

    def minorticks_on(self):
        pass

    def minorticks_off(self):
        pass

    def grid(self, visible=None, which='major', axis='both', **kw):
        self._grid = True if visible is None else bool(visible)

    def axis(self, *args, **kw):
        if args and args[0] in ('off', False):
            self._axis_on = False
        elif args and args[0] in ('on', True):
            self._axis_on = True
        elif args and isinstance(args[0], (list, tuple)) and len(args[0]) == 4:
            a = args[0]
            self.set_xlim(a[0], a[1])
            self.set_ylim(a[2], a[3])
        self._touch()
        return (*self.get_xlim(), *self.get_ylim())

    def set_axis_off(self):
        self._axis_on = False
        self._touch()

    def set_axis_on(self):
        self._axis_on = True
        self._touch()

    def set_facecolor(self, c):
        self.patch.fc = c
        self._touch()

    set_fc = set_facecolor

    def get_facecolor(self):
        return self.patch.fc

    def set_frame_on(self, b):
        for s in self.spines.values():
            s.visible = bool(b)

    def set_rasterized(self, r):
        pass

    def set_navigate(self, b):
        pass

    def set_anchor(self, a):
        pass

    def get_shared_x_axes(self):
        return self

    def get_children(self):
        return [*self.lines, *self.collections, *self.patches, *self.texts]

    def get_lines(self):
        return list(self.lines)

    def has_data(self):
        return bool(self.lines or self.collections or self.patches)

    def get_images(self):
        return list(self.images)

    # ----- twins and clearing
    def twinx(self):
        ax = Axes(self.figure, self._pos.bounds, sharex=self, twin_of=self)
        ax.yaxis.side = 'right'
        ax.patch._visible = False
        self.figure.axes.append(ax)
        self.figure._touch()
        return ax

    def twiny(self):
        ax = Axes(self.figure, self._pos.bounds, twin_of=self)
        self.figure.axes.append(ax)
        return ax

    def inset_axes(self, bounds, **kw):
        ax = Axes(self.figure, bounds)
        ax.tags['inset_of'] = self.id
        self.child_axes.append(ax)
        self._touch()
        return ax

    def clear(self):
        for lst in (self.lines, self.texts, self.patches, self.collections, self.artists, self.tables, self.images):
            for a in lst:
                a._owner = None
            lst.clear()
        self.child_axes.clear()
        self._legend = None
        if self._sharex is None:
            self._xlim = None
        self._ylim = None
        self._xinv = self._yinv = False
        self._labels = {'x': Text(0, 0, ''), 'y': Text(0, 0, '')}
        self.xaxis.label = self._labels['x']
        self.yaxis.label = self._labels['y']
        self._title = Text(0, 0, '')
        self._ticks = {'x': None, 'y': None}
        self._ticklabels = {'x': None, 'y': None}
        self._tickp = {'x': {}, 'y': {}}
        self._format = {'x': 'plain', 'y': 'auto'}
        self._scale = {'x': 'linear', 'y': 'linear'}
        self._aspect = 'auto'
        self._axis_on = True
        self.xaxis.visible = self.yaxis.visible = True
        self._color_cycle = itertools.cycle(CYCLE)
        for s in self.spines.values():
            s.visible, s.color, s.outward = True, None, 0.0
        self._touch()

    cla = clear

    def draw_artist(self, a):
        pass

    def redraw_in_frame(self):
        pass

    def get_renderer_cache(self):
        return None

    # ----- serialisation
    def serial(self, arrays):
        x0, x1 = self.get_xlim()
        y0, y1 = self.get_ylim()
        artists = []
        for lst in (self.patches, self.collections, self.lines, self.texts, self.tables):
            for a in lst:
                try:
                    artists.append(a.serial(arrays))
                except Exception as e:  # one odd artist must not lose the plot
                    artists.append({'k': 'error', 'text': f'{type(a).__name__}: {e}'})
        d = {
            'id': self.id, 'pos': list(self._pos.bounds), 'xlim': [_num(x0), _num(x1)], 'ylim': [_num(y0), _num(y1)],
            'xlabel': self._labels['x'].get_text(), 'ylabel': self._labels['y'].get_text(),
            'xlabelStyle': self._labels['x']._textstyle(), 'ylabelStyle': self._labels['y']._textstyle(),
            'title': self._title.get_text(), 'titleStyle': self._title._textstyle(),
            'artists': artists, 'z': self._zorder, 'visible': self._visible, 'axisOn': self._axis_on,
            'xaxisVisible': self.xaxis.visible, 'yaxisVisible': self.yaxis.visible,
            'xticks': self._ticks['x'], 'yticks': self._ticks['y'],
            'xticklabels': self._ticklabels['x'], 'yticklabels': self._ticklabels['y'],
            'xtickp': self._tickp['x'], 'ytickp': self._tickp['y'],
            'xformat': self._format['x'], 'yformat': self._format['y'], 'yscilimits': self._scilimits['y'],
            'xscale': self._scale['x'], 'yscale': self._scale['y'],
            'patchVisible': self.patch._visible, 'facecolor': css_colour(self.patch.fc),
            'spines': {k: {'visible': s.visible, 'color': css_colour(s.color), 'outward': s.outward,
                           'lw': float(s.lw) if s.lw is not None else None} for k, s in self.spines.items()},
            'ySide': self.yaxis.side, 'aspect': self._aspect if isinstance(self._aspect, str) else 'equal',
        }
        if self.twin_of is not None:
            d['twinOf'] = self.twin_of.id
        if self._legend is not None and self._legend._visible:
            d['legend'] = self._legend.serial(arrays)
        if self.child_axes:
            d['children'] = [c.serial(arrays) for c in self.child_axes]
        if self.tags:
            d['tags'] = dict(self.tags)
        return d


def _apply_fmt(fmt, kw):
    colours = 'bgrcmykw'
    for ls in ('--', '-.', '-', ':'):
        if ls in fmt:
            kw.setdefault('linestyle', ls)
            fmt = fmt.replace(ls, '', 1)
            break
    else:
        if any(m in fmt for m in 'o.,s^v<>+xD*'):
            kw.setdefault('linestyle', 'none')
    for ch in fmt:
        if ch in colours:
            kw.setdefault('color', ch)
        elif ch in 'o.,s^v<>+xD*hHpd|_':
            kw.setdefault('marker', ch)


# ---------------------------------------------------------------- figure

class _CanvasBase:
    def __init__(self, figure):
        self.figure = figure
        figure.canvas = self
        self._cids = {}
        self._next = itertools.count(1)

    def draw_idle(self):
        self.figure._touch()

    draw = draw_idle

    def flush_events(self):
        pass

    def mpl_connect(self, event, fn):
        cid = next(self._next)
        self._cids[cid] = (event, fn)
        return cid

    def mpl_disconnect(self, cid):
        self._cids.pop(cid, None)

    def get_renderer(self):
        return None

    def get_width_height(self):
        return self.figure.size_px()

    def blit(self, *a):
        pass

    def copy_from_bbox(self, *a):
        return None

    def restore_region(self, *a):
        pass

    def callbacks_for(self, event):
        return [fn for e, fn in self._cids.values() if e == event]


class _GridSpec:
    def __init__(self, fig, nrows, ncols, **kw):
        self.fig, self.nrows, self.ncols = fig, nrows, ncols
        self.left = kw.get('left', 0.125)
        self.right = kw.get('right', 0.9)
        self.top = kw.get('top', 0.88)
        self.bottom = kw.get('bottom', 0.11)

    def __getitem__(self, key):
        rows, cols = key if isinstance(key, tuple) else (key, slice(None))

        def span(k, n):
            if isinstance(k, slice):
                a, b, _ = k.indices(n)
                return a, b
            return k, k + 1
        r0, r1 = span(rows, self.nrows)
        c0, c1 = span(cols, self.ncols)
        h = (self.top - self.bottom) / self.nrows
        w = (self.right - self.left) / self.ncols
        bbox = Bbox(self.left + c0 * w, self.top - r1 * h, (c1 - c0) * w, (r1 - r0) * h)
        return _SubplotSpec(bbox)


class _SubplotSpec:
    def __init__(self, bbox):
        self.bbox = bbox

    def get_position(self, fig=None):
        return self.bbox


class Figure:
    def __init__(self, figsize=None, dpi=100, facecolor='white', **kw):
        self.figsize = tuple(figsize) if figsize else (6.4, 4.8)
        self.dpi = dpi
        self.axes = []
        self.texts = []
        self.patch = Patch('figurebg', facecolor=facecolor)
        self.canvas = _CanvasBase(self)
        self.version = 0
        self.legends = []
        self.subplotpars = self

    def _touch(self):
        self.version += 1

    def size_px(self):
        return int(self.figsize[0] * self.dpi), int(self.figsize[1] * self.dpi)

    def add_axes(self, rect, **kw):
        if isinstance(rect, Axes):
            self.axes.append(rect)
            return rect
        ax = Axes(self, rect if not isinstance(rect, Bbox) else rect.bounds, **kw)
        self.axes.append(ax)
        self._touch()
        return ax

    def add_subplot(self, *args, **kw):
        ax = Axes(self, (0.125, 0.11, 0.775, 0.77), **kw)
        self.axes.append(ax)
        self._touch()
        return ax

    def subplots(self, nrows=1, ncols=1, **kw):
        if nrows == 1 and ncols == 1:
            return self.add_subplot()
        gs = _GridSpec(self, nrows, ncols)
        out = np.empty((nrows, ncols), dtype=object)
        for r in range(nrows):
            for c in range(ncols):
                out[r, c] = self.add_axes(gs[r, c].get_position().bounds)
        return out

    def add_gridspec(self, nrows=1, ncols=1, **kw):
        return _GridSpec(self, nrows, ncols, **kw)

    def delaxes(self, ax):
        if ax in self.axes:
            self.axes.remove(ax)
            self._touch()

    def gca(self):
        if not self.axes:
            return self.add_subplot()
        return self.axes[-1]

    def get_axes(self):
        return list(self.axes)

    def clear(self, keep_observers=False):
        self.axes = []
        self.texts = []
        self._touch()

    clf = clear

    def text(self, x, y, s, **kw):
        t = Text(x, y, s, **kw)
        t.props['transform'] = 'figure'
        self.texts.append(t)
        self._touch()
        return t

    def suptitle(self, t, **kw):
        return self.text(0.5, 0.98, t, ha='center', va='top', **kw)

    def legend(self, *a, **kw):
        if self.axes:
            return self.axes[0].legend(*a, **kw)

    def set_size_inches(self, w, h=None, forward=True):
        if h is None:
            w, h = w
        self.figsize = (w, h)

    def get_size_inches(self):
        return np.array(self.figsize)

    def get_dpi(self):
        return self.dpi

    def set_dpi(self, d):
        self.dpi = d

    def set_facecolor(self, c):
        self.patch.fc = c

    def get_facecolor(self):
        return self.patch.fc

    def subplots_adjust(self, **kw):
        pass

    def tight_layout(self, *a, **kw):
        pass

    def set_tight_layout(self, *a):
        pass

    def set_constrained_layout(self, *a):
        pass

    def savefig(self, *a, **kw):
        raise RuntimeError('Saving a figure from Python is not available in KherveOS; use the page\'s export.')

    def colorbar(self, *a, **kw):
        return None

    def get_children(self):
        return list(self.axes)


def serialise_figure(fig, arrays=None):
    own = arrays is None
    arrays = arrays or _Arrays()
    d = {
        'axes': [ax.serial(arrays) for ax in fig.axes],
        'texts': [t.serial(arrays) for t in fig.texts],
        'facecolor': css_colour(fig.patch.fc),
        'version': fig.version,
    }
    if own:
        d['arrays'] = arrays.commit()
    return d


# The arrays of the serialisation in progress (wx canvases serialise their
# figure into the same table as the frames around them).
_CURRENT: list = []


def begin_arrays():
    _CURRENT[:] = [_Arrays()]
    return _CURRENT[0]


def current_arrays():
    if not _CURRENT:
        _CURRENT.append(_Arrays())
    return _CURRENT[0]


def end_arrays():
    arrays = current_arrays()
    _CURRENT.clear()
    return arrays.commit()
