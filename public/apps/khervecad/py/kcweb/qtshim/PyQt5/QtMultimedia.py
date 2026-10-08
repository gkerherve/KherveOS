"""PyQt5.QtMultimedia stand-in: inert classes (see _core.py)."""
from ._core import inert_class


def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return inert_class(name)
