"""matplotlib.transforms for the recording matplotlib."""

from ._rec import Bbox, _Transform  # noqa: F401


import numpy as np


class Affine2D(_Transform):
    """An affine map built by chaining (rotate_deg, translate, scale…), in matplotlib's order: each call acts after the earlier ones.
    ``affine + ax.transData`` is "this, then the axes' data transform": a shape carrying it is drawn with its corners moved
    by the matrix, in data coordinates."""

    def __init__(self, matrix=None):
        super().__init__('affine')
        self.matrix = np.eye(3) if matrix is None else np.array(matrix, dtype=float)

    def _then(self, m):
        self.matrix = m @ self.matrix
        return self

    def rotate_deg(self, d):
        a = np.radians(d)
        c, s = np.cos(a), np.sin(a)
        return self._then(np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]]))

    def rotate(self, rad):
        return self.rotate_deg(np.degrees(rad))

    def rotate_deg_around(self, x, y, d):
        return self.translate(-x, -y).rotate_deg(d).translate(x, y)

    def rotate_around(self, x, y, rad):
        return self.rotate_deg_around(x, y, np.degrees(rad))

    def translate(self, x, y):
        return self._then(np.array([[1, 0, x], [0, 1, y], [0, 0, 1]], dtype=float))

    def scale(self, x, y=None):
        y = x if y is None else y
        return self._then(np.array([[x, 0, 0], [0, y, 0], [0, 0, 1]], dtype=float))

    def clear(self):
        self.matrix = np.eye(3)
        return self

    def transform(self, xy):
        a = np.asarray(xy, dtype=float)
        pts = a.reshape(-1, 2)
        out = (self.matrix @ np.vstack([pts.T, np.ones(len(pts))]))[:2].T
        return out.reshape(a.shape)

    def __add__(self, other):
        res = _Transform(getattr(other, 'kind', 'data'), getattr(other, 'ax', None))
        res.affine = self.matrix.copy()
        return res


def blended_transform_factory(x_transform, y_transform):
    kx = getattr(x_transform, 'kind', 'data')
    ky = getattr(y_transform, 'kind', 'data')
    return _Transform(f'{kx}|{ky}')


def offset_copy(trans, fig=None, x=0.0, y=0.0, units='inches'):
    return trans


class ScaledTranslation(_Transform):
    def __init__(self, *a):
        super().__init__('data')


IdentityTransform = Affine2D
TransformedBbox = Bbox
