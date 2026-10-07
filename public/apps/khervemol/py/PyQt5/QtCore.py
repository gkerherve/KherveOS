"""PyQt5.QtCore stand-in (see PyQt5/__init__.py).

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""

from ._stub import make, module_getattr


def pyqtSignal(*args, **kwargs):
    return make("pyqtSignal")()


def pyqtSlot(*args, **kwargs):
    return lambda fn: fn


Qt = make("Qt")


def __getattr__(name):
    return module_getattr(name)
