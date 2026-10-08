"""matplotlib.transforms for the recording matplotlib."""

from ._rec import Bbox, _Transform  # noqa: F401


class Affine2D(_Transform):
    def __init__(self, *a):
        super().__init__('affine')

    def rotate_deg(self, d):
        return self

    def rotate_deg_around(self, x, y, d):
        return self

    def translate(self, x, y):
        return self

    def scale(self, x, y=None):
        return self


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
