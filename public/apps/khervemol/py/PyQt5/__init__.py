"""A stand-in for PyQt5 inside KherveOS's Pyodide worker.

KherveMol's chemistry modules are Qt-free except for a few colour helpers
(``QColor``) and module-level imports of widget classes they only use in
dialogs. The browser has no Qt: this package lets those modules import
unchanged. ``QtGui.QColor`` is a real (small) colour class; every other
name is an inert placeholder class, so ``from PyQt5.QtWidgets import
QDialog`` and ``class X(QDialog)`` work but do nothing.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""

QT_VERSION_STR = "0 (KherveOS stand-in)"
PYQT_VERSION_STR = QT_VERSION_STR
