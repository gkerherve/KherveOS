"""Dialogs, and how a blocking dialog works without blocking.

Qt's modal calls — QFileDialog.getOpenFileName, QInputDialog.getText,
QMessageBox.question, a dialog's exec_() — wait for the user and return
the answer. Python in the browser cannot wait inside a call, so the
first time one is reached it raises NeedInput (a BaseException, so the
desktop's own `except Exception` never swallows it): the whole user
action is abandoned, the web side shows the dialog, and when the user
answers the action is run again from the start with the answer queued
(ANSWERS). The same call then returns it. Two dialogs in one action
take two rounds. The bridge undoes any model change the abandoned run
made before it asked (kcweb.app).

Non-modal dialogs (show()) need none of this: they stay open in
Python and the web side talks to their widgets.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""

from ._core import Inert, pyqtSignal
from ._widgets import (QAbstractButton, QLabel, QPushButton, QWidget,
                       _plain)

#: answers for the run in progress, in the order its dialogs ask
ANSWERS = []
#: [(kind, title, text)] information/warning boxes shown since last look
MESSAGES = []


class NeedInput(BaseException):
    """A modal dialog needs the user; carries what to show."""

    def __init__(self, spec):
        super().__init__(spec.get("kind", "dialog"))
        self.spec = spec


def ask(spec):
    """The queued answer for this dialog, or raise NeedInput."""
    if ANSWERS:
        return ANSWERS.pop(0)
    raise NeedInput(spec)


def _texts(args):
    return [a for a in args if isinstance(a, str)]


# ------------------------------------------------------------------ QDialog

class QDialog(QWidget):
    accepted = pyqtSignal()
    rejected = pyqtSignal()
    finished = pyqtSignal(int)
    Accepted = 1
    Rejected = 0

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_window = True
        self._kc_result = 0
        self._kc_modal = False

    def setModal(self, on):
        self._kc_modal = bool(on)

    def isModal(self):
        return self._kc_modal

    def setWindowModality(self, *a):
        pass

    def setSizeGripEnabled(self, *a):
        pass

    def result(self):
        return self._kc_result

    def setResult(self, r):
        self._kc_result = int(r)

    def done(self, r):
        self._kc_result = int(r)
        self.setVisible(False)
        self.finished.emit(int(r))
        (self.accepted if r else self.rejected).emit()

    def accept(self):
        self.done(QDialog.Accepted)

    def reject(self):
        self.done(QDialog.Rejected)

    def open(self):
        self.show()

    def exec_(self, *a):
        """Show this dialog and wait — by raising NeedInput the first
        time (the web side shows the live dialog), then, when the action
        is run again, by taking the user's answer: the widgets' values
        from the dialog they filled in and which way it closed."""
        from kcweb import ui
        answer = ask({"kind": "exec", "dialog": self})
        ui.restore_state(self, answer.get("state") or [])
        self._kc_result = int(answer.get("result", 0))
        clicked = answer.get("clicked")
        if clicked is not None and hasattr(self, "_kc_set_clicked"):
            self._kc_set_clicked(clicked)
        self.finished.emit(self._kc_result)
        (self.accepted if self._kc_result else self.rejected).emit()
        return self._kc_result

    exec = exec_


class QDialogButtonBox(QWidget):
    accepted = pyqtSignal()
    rejected = pyqtSignal()
    clicked = pyqtSignal(object)
    helpRequested = pyqtSignal()
    NoButton = 0
    Ok = 0x400
    Save = 0x800
    SaveAll = 0x1000
    Open = 0x2000
    Yes = 0x4000
    YesToAll = 0x8000
    No = 0x10000
    NoToAll = 0x20000
    Abort = 0x40000
    Retry = 0x80000
    Ignore = 0x100000
    Close = 0x200000
    Cancel = 0x400000
    Discard = 0x800000
    Help = 0x1000000
    Apply = 0x2000000
    Reset = 0x4000000
    RestoreDefaults = 0x8000000
    AcceptRole = 0
    RejectRole = 1
    DestructiveRole = 2
    ActionRole = 3
    HelpRole = 4
    YesRole = 5
    NoRole = 6
    ResetRole = 7
    ApplyRole = 8
    Horizontal = 1
    Vertical = 2

    _LABELS = [(0x400, "OK", 0), (0x800, "Save", 0), (0x1000, "Save All", 0),
               (0x2000, "Open", 0), (0x4000, "Yes", 5),
               (0x8000, "Yes to All", 5), (0x10000, "No", 6),
               (0x20000, "No to All", 6), (0x40000, "Abort", 1),
               (0x80000, "Retry", 0), (0x100000, "Ignore", 0),
               (0x200000, "Close", 1), (0x400000, "Cancel", 1),
               (0x800000, "Discard", 2), (0x1000000, "Help", 4),
               (0x2000000, "Apply", 8), (0x4000000, "Reset", 7),
               (0x8000000, "Restore Defaults", 7)]

    def __init__(self, *args, **kwargs):
        parent = next((a for a in args if isinstance(a, QWidget)), None)
        super().__init__(parent)
        self._kc_buttons = []         # [(button, role, standard)]
        flags = next((a for a in args if isinstance(a, int)
                      and not isinstance(a, bool) and a > 2), 0)
        if flags:
            self.setStandardButtons(flags)

    def setStandardButtons(self, flags):
        for b, _r, std in list(self._kc_buttons):
            if std:
                self._kc_buttons.remove((b, _r, std))
                b.setParent(None)
        for value, label, role in self._LABELS:
            if int(flags) & value:
                b = QPushButton(label, self)
                self._kc_wire(b, role)
                self._kc_buttons.append((b, role, value))
        self._touch()

    def _kc_wire(self, button, role):
        def clicked(_=False, b=button, r=role):
            self.clicked.emit(b)
            if r in (0, 5):
                self.accepted.emit()
            elif r in (1, 6):
                self.rejected.emit()
            elif r == 4:
                self.helpRequested.emit()
        button.clicked.connect(clicked)

    def addButton(self, *args):
        role = next((a for a in args if isinstance(a, int)
                     and not isinstance(a, bool)), 0)
        if args and isinstance(args[0], QAbstractButton):
            b = args[0]
            self._kc_add_child(b)
        elif args and isinstance(args[0], str):
            b = QPushButton(args[0], self)
        else:
            std = role
            label, role = next(((l, r) for v, l, r in self._LABELS
                                if v == std), ("OK", 0))
            b = QPushButton(label, self)
            self._kc_wire(b, role)
            self._kc_buttons.append((b, role, std))
            self._touch()
            return b
        self._kc_wire(b, role)
        self._kc_buttons.append((b, role, 0))
        self._touch()
        return b

    def button(self, which):
        return next((b for b, _r, std in self._kc_buttons if std == which),
                    None)

    def buttons(self):
        return [b for b, _r, _s in self._kc_buttons]

    def buttonRole(self, button):
        return next((r for b, r, _s in self._kc_buttons if b is button), -1)

    def standardButton(self, button):
        return next((s for b, _r, s in self._kc_buttons if b is button), 0)

    def removeButton(self, button):
        self._kc_buttons = [x for x in self._kc_buttons if x[0] is not button]
        button.setParent(None)
        self._touch()

    def clear(self):
        for b, _r, _s in self._kc_buttons:
            b.setParent(None)
        self._kc_buttons = []
        self._touch()

    def setOrientation(self, *a):
        pass

    def setCenterButtons(self, *a):
        pass


class QMessageBox(QDialog):
    buttonClicked = pyqtSignal(object)
    NoButton = 0
    Ok = 0x400
    Save = 0x800
    SaveAll = 0x1000
    Open = 0x2000
    Yes = 0x4000
    YesToAll = 0x8000
    No = 0x10000
    NoToAll = 0x20000
    Abort = 0x40000
    Retry = 0x80000
    Ignore = 0x100000
    Close = 0x200000
    Cancel = 0x400000
    Discard = 0x800000
    Help = 0x1000000
    Apply = 0x2000000
    Reset = 0x4000000
    NoIcon = 0
    Information = 1
    Warning = 2
    Critical = 3
    Question = 4
    AcceptRole = 0
    RejectRole = 1
    DestructiveRole = 2
    ActionRole = 3
    HelpRole = 4
    YesRole = 5
    NoRole = 6
    ResetRole = 7
    ApplyRole = 8

    def __init__(self, *args, **kwargs):
        parent = next((a for a in args if isinstance(a, QWidget)), None)
        super().__init__(parent)
        texts = _texts(args)
        self._kc_title = texts[0] if texts else ""
        self._kc_text = texts[1] if len(texts) > 1 else ""
        self._kc_info = ""
        self._kc_detail = ""
        self._kc_icon_kind = 0
        self._kc_buttons = []         # [(button, role, standard)]
        self._kc_clicked = None
        self._kc_default = None
        self._kc_checkbox = None

    def setText(self, t):
        self._kc_text = str(t or "")
        self._touch()

    def text(self):
        return self._kc_text

    def setInformativeText(self, t):
        self._kc_info = str(t or "")

    def setDetailedText(self, t):
        self._kc_detail = str(t or "")

    def setIcon(self, kind):
        self._kc_icon_kind = int(kind) if isinstance(kind, int) else 0

    def setIconPixmap(self, *a):
        pass

    def setTextFormat(self, *a):
        pass

    def setCheckBox(self, box):
        self._kc_checkbox = box
        if box is not None:
            self._kc_add_child(box)

    def checkBox(self):
        return self._kc_checkbox

    def addButton(self, *args):
        role = next((a for a in args if isinstance(a, int)
                     and not isinstance(a, bool)), 0)
        if args and isinstance(args[0], QAbstractButton):
            b = args[0]
            self._kc_add_child(b)
            self._kc_buttons.append((b, role, 0))
        elif args and isinstance(args[0], str):
            b = QPushButton(args[0], self)
            self._kc_buttons.append((b, role, 0))
        else:
            std = role
            label, srole = next(((l, r) for v, l, r in
                                 QDialogButtonBox._LABELS if v == std),
                                ("OK", 0))
            b = QPushButton(label, self)
            self._kc_buttons.append((b, srole, std))
        self._touch()
        return b

    def setStandardButtons(self, flags):
        for value, _label, _role in QDialogButtonBox._LABELS:
            if int(flags) & value:
                self.addButton(value)

    def button(self, which):
        return next((b for b, _r, std in self._kc_buttons if std == which),
                    None)

    def buttons(self):
        return [b for b, _r, _s in self._kc_buttons]

    def setDefaultButton(self, b):
        if isinstance(b, int):
            b = self.button(b)
        self._kc_default = b

    def setEscapeButton(self, *a):
        pass

    def clickedButton(self):
        return self._kc_clicked

    def standardButton(self, button):
        return next((s for b, _r, s in self._kc_buttons if b is button), 0)

    def _kc_set_clicked(self, index):
        if 0 <= int(index) < len(self._kc_buttons):
            self._kc_clicked = self._kc_buttons[int(index)][0]

    def exec_(self, *a):
        if not self._kc_buttons:
            self.addButton(QMessageBox.Ok)
        answer = ask({"kind": "message", "title": self._kc_title,
                      "text": self._kc_text, "info": self._kc_info,
                      "detail": self._kc_detail,
                      "icon": self._kc_icon_kind,
                      "buttons": [b.text() for b, _r, _s
                                  in self._kc_buttons],
                      "default": next((i for i, (b, _r, _s) in
                                       enumerate(self._kc_buttons)
                                       if b is self._kc_default), -1),
                      "checkbox": self._kc_checkbox.text()
                      if self._kc_checkbox is not None else None})
        index = int(answer.get("clicked", -1))
        self._kc_set_clicked(index)
        if self._kc_checkbox is not None and "checked" in answer:
            self._kc_checkbox.setChecked(bool(answer["checked"]))
        if self._kc_clicked is None:
            return QMessageBox.Cancel
        std = self.standardButton(self._kc_clicked)
        return std if std else index

    exec = exec_

    # -- the static helpers
    @staticmethod
    def _note(kind, args):
        texts = _texts(args)
        title = texts[0] if texts else ""
        text = texts[1] if len(texts) > 1 else title
        MESSAGES.append((kind, title, text))

    @staticmethod
    def warning(*args, **kw):
        QMessageBox._note("warning", args)
        return QMessageBox.Ok

    @staticmethod
    def critical(*args, **kw):
        QMessageBox._note("critical", args)
        return QMessageBox.Ok

    @staticmethod
    def information(*args, **kw):
        QMessageBox._note("information", args)
        return QMessageBox.Ok

    @staticmethod
    def about(*args, **kw):
        QMessageBox._note("about", args)

    @staticmethod
    def aboutQt(*args, **kw):
        pass

    @staticmethod
    def question(*args, **kw):
        texts = _texts(args)
        flags = [a for a in args if isinstance(a, int)
                 and not isinstance(a, bool)]
        buttons = flags[0] if flags else (QMessageBox.Yes | QMessageBox.No)
        default = flags[1] if len(flags) > 1 else 0
        names = [(v, l) for v, l, _r in QDialogButtonBox._LABELS
                 if int(buttons) & v]
        answer = ask({"kind": "question",
                      "title": texts[0] if texts else "",
                      "text": texts[1] if len(texts) > 1 else "",
                      "buttons": [l for _v, l in names],
                      "default": next((i for i, (v, _l) in enumerate(names)
                                       if v == default), 0)})
        index = int(answer.get("clicked", -1))
        if 0 <= index < len(names):
            return names[index][0]
        return QMessageBox.Cancel if int(buttons) & QMessageBox.Cancel \
            else QMessageBox.No


class QInputDialog(QDialog):
    @staticmethod
    def getText(*args, **kw):
        texts = _texts(args)
        answer = ask({"kind": "text", "title": texts[0] if texts else "",
                      "label": texts[1] if len(texts) > 1 else "",
                      "value": kw.get("text", texts[3] if len(texts) > 3
                                      else (texts[2] if len(texts) > 2
                                            else ""))})
        return (str(answer.get("value", "")), bool(answer.get("ok")))

    @staticmethod
    def getMultiLineText(*args, **kw):
        texts = _texts(args)
        answer = ask({"kind": "text", "multiline": True,
                      "title": texts[0] if texts else "",
                      "label": texts[1] if len(texts) > 1 else "",
                      "value": kw.get("text", texts[2] if len(texts) > 2
                                      else "")})
        return (str(answer.get("value", "")), bool(answer.get("ok")))

    @staticmethod
    def _number(kind, args, kw):
        texts = _texts(args)
        nums = [a for a in args if isinstance(a, (int, float))
                and not isinstance(a, bool)]
        value = kw.get("value", nums[0] if nums else 0)
        lo = kw.get("min", nums[1] if len(nums) > 1 else -2147483647)
        hi = kw.get("max", nums[2] if len(nums) > 2 else 2147483647)
        decimals = kw.get("decimals", nums[3] if len(nums) > 3 else
                          (1 if kind == "double" else 0))
        answer = ask({"kind": kind, "title": texts[0] if texts else "",
                      "label": texts[1] if len(texts) > 1 else "",
                      "value": value, "min": lo, "max": hi,
                      "decimals": decimals})
        conv = float if kind == "double" else int
        return (conv(answer.get("value", value)), bool(answer.get("ok")))

    @staticmethod
    def getDouble(*args, **kw):
        return QInputDialog._number("double", args, kw)

    @staticmethod
    def getInt(*args, **kw):
        return QInputDialog._number("int", args, kw)

    @staticmethod
    def getItem(*args, **kw):
        texts = _texts(args)
        items = next((a for a in args if isinstance(a, (list, tuple))), [])
        nums = [a for a in args if isinstance(a, int)
                and not isinstance(a, bool)]
        current = kw.get("current", nums[0] if nums else 0)
        editable = kw.get("editable", next(
            (a for a in args if isinstance(a, bool)), True))
        answer = ask({"kind": "item", "title": texts[0] if texts else "",
                      "label": texts[1] if len(texts) > 1 else "",
                      "items": [str(i) for i in items],
                      "current": current, "editable": bool(editable)})
        return (str(answer.get("value", "")), bool(answer.get("ok")))


class QFileDialog(QDialog):
    DontConfirmOverwrite = 4
    ShowDirsOnly = 1
    DontUseNativeDialog = 16
    AcceptSave = 1
    AcceptOpen = 0
    ExistingFile = 1
    ExistingFiles = 3
    Directory = 2
    AnyFile = 0

    @staticmethod
    def _spec(kind, args, kw):
        texts = _texts(args)
        return {"kind": kind,
                "title": kw.get("caption", texts[0] if texts else ""),
                "start": kw.get("directory", texts[1] if len(texts) > 1
                                else ""),
                "filter": kw.get("filter", texts[2] if len(texts) > 2
                                 else "")}

    @staticmethod
    def getOpenFileName(*args, **kw):
        answer = ask(QFileDialog._spec("open", args, kw))
        path = str(answer.get("path") or "")
        return path, answer.get("filter", "") if path else ""

    @staticmethod
    def getOpenFileNames(*args, **kw):
        answer = ask(QFileDialog._spec("open_many", args, kw))
        paths = [str(p) for p in answer.get("paths") or []]
        return paths, answer.get("filter", "") if paths else ""

    @staticmethod
    def getSaveFileName(*args, **kw):
        answer = ask(QFileDialog._spec("save", args, kw))
        path = str(answer.get("path") or "")
        return path, answer.get("filter", "") if path else ""

    @staticmethod
    def getExistingDirectory(*args, **kw):
        answer = ask(QFileDialog._spec("folder", args, kw))
        return str(answer.get("path") or "")

    @staticmethod
    def getOpenFileUrl(*args, **kw):
        return Inert(), ""


class QColorDialog(QDialog):
    ShowAlphaChannel = 1
    NoButtons = 2
    DontUseNativeDialog = 4

    @staticmethod
    def getColor(*args, **kw):
        from .QtGui import QColor
        initial = next((a for a in args if isinstance(a, QColor)), None)
        title = next((a for a in args if isinstance(a, str)), "")
        alpha = any(isinstance(a, int) and not isinstance(a, bool)
                    and a & 1 for a in args)
        answer = ask({"kind": "color", "title": title,
                      "value": initial.name() if initial is not None
                      and initial.isValid() else "#4a90d9",
                      "alpha": initial.alphaF() if initial is not None
                      else 1.0,
                      "with_alpha": alpha})
        if not answer.get("ok"):
            return QColor()
        color = QColor(str(answer.get("value", "#000000")))
        if "alpha" in answer:
            color.setAlphaF(float(answer["alpha"]))
        return color

    @staticmethod
    def customColor(*a):
        from .QtGui import QColor
        return QColor()

    @staticmethod
    def setCustomColor(*a):
        pass


class QFontDialog(QDialog):
    @staticmethod
    def getFont(*args, **kw):
        from .QtGui import QFont
        initial = next((a for a in args if isinstance(a, QFont)), QFont())
        return initial, False


class QProgressDialog(QDialog):
    canceled = pyqtSignal()

    def __init__(self, *args, **kwargs):
        parent = next((a for a in args if isinstance(a, QWidget)), None)
        super().__init__(parent)
        texts = _texts(args)
        self._kc_label = texts[0] if texts else ""
        self._kc_value = 0
        self._kc_max = 100

    def setValue(self, v):
        self._kc_value = int(v)

    def value(self):
        return self._kc_value

    def setMaximum(self, m):
        self._kc_max = int(m)

    def setMinimum(self, *a):
        pass

    def setRange(self, lo, hi):
        self._kc_max = int(hi)

    def setLabelText(self, t):
        self._kc_label = str(t)

    def wasCanceled(self):
        return False

    def setMinimumDuration(self, *a):
        pass

    def setAutoClose(self, *a):
        pass

    def setAutoReset(self, *a):
        pass

    def setCancelButton(self, *a):
        pass

    def setCancelButtonText(self, *a):
        pass

    def show(self):
        pass

    def exec_(self):
        return 0


class QErrorMessage(QDialog):
    def showMessage(self, text, *a):
        MESSAGES.append(("warning", "", str(text)))


class QWizard(QDialog):
    pass


class QWizardPage(QWidget):
    pass


class QSplashScreen(QWidget):
    def showMessage(self, *a):
        pass

    def finish(self, *a):
        pass


def plain(text):
    return _plain(text)


__all__ = ["QDialog", "QDialogButtonBox", "QMessageBox", "QInputDialog",
           "QFileDialog", "QColorDialog", "QFontDialog", "QProgressDialog",
           "QErrorMessage", "QWizard", "QWizardPage", "QSplashScreen",
           "NeedInput", "ANSWERS", "MESSAGES", "ask", "QLabel"]
