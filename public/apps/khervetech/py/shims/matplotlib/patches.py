"""matplotlib.patches for the recording matplotlib: shapes the label tools draw."""

from ._rec import Patch as _Patch, Bbox  # noqa: F401

Patch = _Patch


def _xy(xy):
    return [float(xy[0]), float(xy[1])]


class Rectangle(_Patch):
    def __init__(self, xy, width, height, angle=0.0, **kw):
        super().__init__('rect', **kw)
        self.geom.update(xy=_xy(xy), w=float(width), h=float(height), angle=float(angle))


class FancyBboxPatch(Rectangle):
    def __init__(self, xy, width, height, boxstyle='round', **kw):
        super().__init__(xy, width, height, **kw)


class Circle(_Patch):
    def __init__(self, xy, radius=5, **kw):
        super().__init__('circle', **kw)
        self.geom.update(center=_xy(xy), r=float(radius))


class Ellipse(_Patch):
    def __init__(self, xy, width, height, angle=0, **kw):
        super().__init__('ellipse', **kw)
        self.geom.update(center=_xy(xy), w=float(width), h=float(height), angle=float(angle))


class Arc(Ellipse):
    def __init__(self, xy, width, height, angle=0.0, theta1=0.0, theta2=360.0, **kw):
        super().__init__(xy, width, height, angle, **kw)
        self.shape = 'arc'
        self.geom.update(theta1=float(theta1), theta2=float(theta2))


class Wedge(_Patch):
    def __init__(self, center, r, theta1, theta2, width=None, **kw):
        super().__init__('wedge', **kw)
        self.geom.update(center=_xy(center), r=float(r), theta1=float(theta1), theta2=float(theta2))


class Polygon(_Patch):
    def __init__(self, xy, closed=True, **kw):
        super().__init__('polygon', **kw)
        self.geom.update(xy=[_xy(p) for p in xy], closed=bool(closed))


class FancyArrowPatch(_Patch):
    def __init__(self, posA=None, posB=None, path=None, arrowstyle='simple', connectionstyle='arc3',
                 mutation_scale=1, **kw):
        kw.pop('shrinkA', None)
        kw.pop('shrinkB', None)
        super().__init__('arrow', **kw)
        self.geom.update(a=_xy(posA or (0, 0)), b=_xy(posB or (0, 0)), style=str(arrowstyle),
                         scale=float(mutation_scale))


class FancyArrow(FancyArrowPatch):
    def __init__(self, x, y, dx, dy, width=0.001, **kw):
        super().__init__((x, y), (x + dx, y + dy), arrowstyle='-|>', **kw)


class ConnectionPatch(FancyArrowPatch):
    def __init__(self, xyA, xyB, coordsA='data', coordsB=None, **kw):
        super().__init__(xyA, xyB, **kw)
