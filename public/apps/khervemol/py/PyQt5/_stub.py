"""Inert placeholder classes for the Qt names KherveMol imports but the
browser never uses (see PyQt5/__init__.py).

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""


class _Meta(type):
    """Class-level attribute access (``Qt.LeftButton``,
    ``QDialogButtonBox.Ok``) yields 0, so enum arithmetic still works."""

    def __getattr__(cls, name):
        if name.startswith("__"):
            raise AttributeError(name)
        return 0


class Stub(metaclass=_Meta):
    """Accepts any arguments; any method call does nothing."""

    def __init__(self, *args, **kwargs):
        pass

    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        return _noop

    def __call__(self, *args, **kwargs):
        return Stub()

    def __bool__(self):
        return False

    def __or__(self, other):
        return self

    __ror__ = __and__ = __rand__ = __or__


def _noop(*args, **kwargs):
    return Stub()


_CLASSES = {}


def make(name):
    """A distinct placeholder class per Qt name (so two of them can be base
    classes of one class without a duplicate-base error)."""
    cls = _CLASSES.get(name)
    if cls is None:
        cls = _CLASSES[name] = _Meta(name, (Stub,), {})
    return cls


def module_getattr(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return make(name)
