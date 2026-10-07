"""PyQt5.QtWidgets stand-in (see PyQt5/__init__.py).

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""

from ._stub import module_getattr


def __getattr__(name):
    return module_getattr(name)
