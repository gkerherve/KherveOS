"""KherveOS stand-in for the desktop's libraries/Sheet_Operations.py: selecting
a sheet is the main window's job (ktech.frame.MainFrame.select_sheet), which
does what on_sheet_selected does for a technique sheet: update the sheet
selector, the technique button and right frame, redraw the plot."""


def on_sheet_selected(window, event):
    if isinstance(event, str):
        name = event
    else:
        name = event.GetString() if hasattr(event, 'GetString') else window.sheet_combobox.GetValue()
    window.select_sheet(name)
