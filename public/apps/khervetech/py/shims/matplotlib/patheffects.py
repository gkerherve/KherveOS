"""matplotlib.patheffects for the recording matplotlib: only the text halo (withStroke / Stroke) is kept, as a
``halo`` of the text the page draws behind it; the other effects (shadows, normal) change nothing."""


class AbstractPathEffect:
    def __init__(self, offset=(0, 0)):
        self.offset = offset


class Normal(AbstractPathEffect):
    pass


class Stroke(AbstractPathEffect):
    def __init__(self, offset=(0, 0), **kw):
        super().__init__(offset)
        self.linewidth = kw.get('linewidth', kw.get('lw', 3))
        self.foreground = kw.get('foreground', kw.get('fg', 'k'))
        self.alpha = kw.get('alpha')


class withStroke(Stroke):
    pass


class SimpleLineShadow(AbstractPathEffect):
    def __init__(self, offset=(2, -2), shadow_color='k', alpha=0.3, rho=0.3, **kw):
        super().__init__(offset)


class SimplePatchShadow(SimpleLineShadow):
    pass


class withSimplePatchShadow(SimplePatchShadow):
    pass


class withSimpleLineShadow(SimpleLineShadow):
    pass


class PathPatchEffect(AbstractPathEffect):
    def __init__(self, offset=(0, 0), **kw):
        super().__init__(offset)


class TickedStroke(Stroke):
    pass
