"""matplotlib.ticker for the recording matplotlib: formatters and locators that only say what they are."""


class Formatter:
    sci = None

    def __call__(self, x, pos=None):
        return f"{x:g}"

    def set_powerlimits(self, lims):
        self.powerlimits = lims

    def set_scientific(self, b):
        self.sci = bool(b)

    def set_useOffset(self, b):
        pass

    def set_useMathText(self, b):
        pass


class ScalarFormatter(Formatter):
    def __init__(self, useOffset=None, useMathText=None, useLocale=None):
        self.sci = None


class FormatStrFormatter(Formatter):
    def __init__(self, fmt):
        self.fmt = fmt
        self.sci = False

    def __call__(self, x, pos=None):
        return self.fmt % x


class StrMethodFormatter(Formatter):
    def __init__(self, fmt):
        self.fmt = fmt
        self.sci = False


class FuncFormatter(Formatter):
    def __init__(self, fn):
        self.fn = fn


class NullFormatter(Formatter):
    def __call__(self, x, pos=None):
        return ''


LogFormatter = LogFormatterSciNotation = LogFormatterMathtext = PercentFormatter = EngFormatter = ScalarFormatter


class Locator:
    fixed = None

    def __init__(self, *a, **kw):
        pass


class FixedLocator(Locator):
    def __init__(self, locs, nbins=None):
        self.fixed = list(locs)


MaxNLocator = AutoLocator = AutoMinorLocator = MultipleLocator = LogLocator = NullLocator = LinearLocator = Locator
