"""matplotlib.pyplot for the recording matplotlib (the desktop tools mostly use cm and the OO API)."""

from . import cm  # noqa: F401
from ._rec import Figure, rcParams  # noqa: F401
from .cm import get_cmap  # noqa: F401

_current = []


def figure(*a, **kw):
    f = Figure(**{k: v for k, v in kw.items() if k in ('figsize', 'dpi', 'facecolor')})
    _current.append(f)
    return f


def subplots(nrows=1, ncols=1, figsize=None, **kw):
    f = figure(figsize=figsize)
    return f, f.subplots(nrows, ncols)


def gcf():
    return _current[-1] if _current else figure()


def gca():
    return gcf().gca()


def close(*a):
    _current.clear()


def show(*a, **kw):
    pass


def draw(*a, **kw):
    pass


def pause(*a):
    pass


def ion():
    pass


def ioff():
    pass


def plot(*a, **kw):
    return gca().plot(*a, **kw)


def savefig(*a, **kw):
    gcf().savefig(*a, **kw)


def colorbar(*a, **kw):
    return None


def setp(obj, **kw):
    for o in (obj if isinstance(obj, (list, tuple)) else [obj]):
        for k, v in kw.items():
            fn = getattr(o, f'set_{k}', None)
            if fn:
                fn(v)
