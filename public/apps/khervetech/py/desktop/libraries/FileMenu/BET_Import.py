# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/FileMenu/BET_Import.py. Regenerate with tools/export_khervetech.py.
# libraries/FileMenu/BET_Import.py
"""
Gas-adsorption isotherm importer for BET / physisorption analysis.

Micromeritics, Quantachrome and most other physisorption instruments export
the isotherm as delimited text: a relative-pressure column (P/P0, 0..1) and
a quantity-adsorbed column (cm3/g STP), with any amount of header text
above the numbers. The generic column parser from ``Optical_Import`` keeps
whatever rows parse as numbers, so those all read the same way.

Column selection is by value rather than by header: the relative-pressure
column is the one whose values stay within 0..1.05, and the quantity is the
last other numeric column (a Micromeritics export can put the absolute
pressure between the two). A file with only absolute pressures is converted
when its header carries a saturation pressure (``P0`` / ``Saturation
Pressure``).

An isotherm measured up and back down holds both branches in one sheet: the
adsorption branch runs to the maximum P/P0 and the desorption branch back
from it, split on the turning point and recorded per point in
``BET_Branch`` (1 = adsorption, 2 = desorption).

Sheets are named BET, BET1, BET2, ... which triggers the physisorption plot
mode (forward P/P0 axis, per-sheet labels). Projects go straight to .kfit -
the BET transform is of order 1e-3 and the two-decimal rounding of the
.xlsx/.json format would destroy it.
"""

import os
import wx

from libraries.FileMenu.KFitting_Import import TECH_BET, build_generic_sheet
from libraries.FileMenu.Optical_Import import (
    parse_columns_file, _open_as_kfit_project, _project_path_for)


X_LABEL_RELP = "Relative pressure (P/P$_0$)"
Y_LABEL_QUANTITY = "Quantity adsorbed (cm$^3$/g STP)"


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def _metadata_p0(metadata):
    """A saturation pressure from the header block, if one is quoted."""
    for key, value in metadata.items():
        norm = str(key).lower().replace(' ', '').rstrip(':')
        if norm in ('p0', 'po', 'psat') or 'saturationpressure' in norm:
            try:
                return float(str(value).split()[0].replace(',', '.'))
            except (ValueError, IndexError):
                continue
    return None


def identify_isotherm_columns(rows, metadata):
    """Pick the (relative pressure, quantity) columns out of parsed rows.

    Returns ``(x_values, q_values)`` or raises ``ValueError``.
    """
    n_cols = len(rows[0])
    columns = [[r[i] for r in rows] for i in range(n_cols)]

    def is_relative(values):
        lo, hi = min(values), max(values)
        return -0.001 <= lo and hi <= 1.05 and (hi - lo) > 0.05

    rel_index = next((i for i, col in enumerate(columns) if is_relative(col)),
                     None)

    if rel_index is not None:
        x_values = columns[rel_index]
        remaining = [i for i in range(n_cols) if i != rel_index]
    else:
        # Absolute pressures only: convert through the quoted P0.
        p0 = _metadata_p0(metadata)
        if p0 is None:
            raise ValueError("no relative-pressure column (0..1) found and "
                             "no saturation pressure P0 in the header")
        x_values = [v / p0 for v in columns[0]]
        remaining = list(range(1, n_cols))

    if not remaining:
        raise ValueError("no quantity-adsorbed column found")

    # The quantity is the last remaining column: a Micromeritics export puts
    # the absolute pressure between the relative pressure and the quantity.
    q_values = columns[remaining[-1]]
    return x_values, q_values


def split_branches(x_values):
    """Per-point branch flags: 1 up to the maximum P/P0, 2 after it."""
    if not x_values:
        return []
    turn = max(range(len(x_values)), key=lambda i: x_values[i])
    return [1 if i <= turn else 2 for i in range(len(x_values))]


def parse_bet_file(file_path):
    """Parse an adsorption-isotherm text export.

    Returns ``{'x': [...], 'q': [...], 'branch': [...], 'metadata': {...}}``
    or raises ``ValueError`` when no isotherm can be read.
    """
    rows, metadata = parse_columns_file(file_path, max_columns=6)
    if len(rows) < 3:
        raise ValueError("no numeric data rows found")

    x_values, q_values = identify_isotherm_columns(rows, metadata)

    keep = [i for i, (x, q) in enumerate(zip(x_values, q_values))
            if x is not None and q is not None and 0.0 <= x <= 1.05]
    if len(keep) < 3:
        raise ValueError("fewer than three points with 0 <= P/P0 <= 1")

    x_values = [float(x_values[i]) for i in keep]
    q_values = [float(q_values[i]) for i in keep]

    return {
        'x': x_values,
        'q': q_values,
        'branch': split_branches(x_values),
        'metadata': metadata,
    }


# ---------------------------------------------------------------------------
# Sheet construction
# ---------------------------------------------------------------------------

def next_bet_sheet_name(existing_names):
    """Return the next free BET sheet name: BET, BET1, BET2, ..."""
    existing = {str(name).upper() for name in existing_names}
    if 'BET' not in existing:
        return 'BET'
    idx = 1
    while f'BET{idx}' in existing:
        idx += 1
    return f'BET{idx}'


def build_bet_sheet(parsed, file_path, sheet_name):
    """The ``window.Data['Core levels'][sheet]`` entry for one isotherm."""
    source = os.path.splitext(os.path.basename(file_path))[0]
    sheet = build_generic_sheet(TECH_BET, sheet_name, parsed['x'], parsed['q'],
                                source_name=source)
    sheet['BET_Branch'] = [float(v) for v in parsed['branch']]
    n_des = sum(1 for b in parsed['branch'] if b == 2)

    info = sheet['ExperimentalInfo']
    info['Technique'] = 'Gas Adsorption (BET)'
    info['Source File'] = os.path.basename(file_path)
    info['P/P0 Range'] = f"{min(parsed['x']):.3f} - {max(parsed['x']):.3f}"
    info['Branches'] = ('adsorption + desorption' if n_des > 1
                        else 'adsorption only')
    for src, dst in (('Sample', 'Sample'), ('Analysis Adsorptive', 'Adsorptive'),
                     ('Adsorptive', 'Adsorptive'), ('Analysis Bath Temp', 'Bath'),
                     ('Operator', 'Operator'), ('Instrument', 'Instrument')):
        for name, value in parsed['metadata'].items():
            if str(name).lower().replace(' ', '') == src.lower().replace(' ', '') \
                    and value:
                info[dst] = value
                break
    return sheet


# ---------------------------------------------------------------------------
# Import entry points
# ---------------------------------------------------------------------------

_WILDCARD = ("Isotherm files (*.csv;*.txt;*.dat)|"
             "*.csv;*.CSV;*.txt;*.TXT;*.dat;*.DAT|"
             "All files (*.*)|*.*")


def _import_bet_paths(window, file_paths):
    core_levels = {}
    skipped = []

    for file_path in sorted(file_paths):
        try:
            parsed = parse_bet_file(file_path)
        except Exception as e:
            skipped.append(f"{os.path.basename(file_path)}: {e}")
            continue
        sheet_name = next_bet_sheet_name(core_levels.keys())
        core_levels[sheet_name] = build_bet_sheet(parsed, file_path, sheet_name)

    if not core_levels:
        window.show_popup_message2(
            "Error", "No valid isotherm data found.\n" + "\n".join(skipped))
        return False

    project_path = _project_path_for(sorted(file_paths), 'BET_Data')
    sample = os.path.splitext(os.path.basename(project_path))[0]
    _open_as_kfit_project(window, core_levels, project_path, sample)

    if skipped:
        window.show_popup_message2(
            "Warning", "Some files were skipped:\n" + "\n".join(skipped))
    return True


def import_bet_file(window):
    """Import one or more adsorption isotherms as sheets BET, BET1, ..."""
    with wx.FileDialog(window, "Open isotherm file(s)", wildcard=_WILDCARD,
                       style=wx.FD_OPEN | wx.FD_FILE_MUST_EXIST | wx.FD_MULTIPLE) as dlg:
        if dlg.ShowModal() == wx.ID_CANCEL:
            return
        file_paths = dlg.GetPaths()

    if not file_paths:
        return
    try:
        _import_bet_paths(window, file_paths)
    except Exception as e:
        import traceback
        traceback.print_exc()
        window.show_popup_message2(
            "Error", f"Error processing isotherm file(s): {str(e)}")


def import_multiple_bet_files(window):
    """Import every isotherm export in a folder as BET, BET1, BET2, ..."""
    with wx.DirDialog(window, "Choose a directory containing isotherm files",
                      style=wx.DD_DEFAULT_STYLE | wx.DD_DIR_MUST_EXIST) as dlg:
        if dlg.ShowModal() == wx.ID_CANCEL:
            return
        dir_path = dlg.GetPath()

    try:
        found = sorted(f for f in os.listdir(dir_path)
                       if f.lower().endswith(('.csv', '.txt', '.dat')))
        if not found:
            window.show_popup_message2(
                "Information", "No .csv/.txt/.dat files found in the selected folder.")
            return
        _import_bet_paths(window, [os.path.join(dir_path, f) for f in found])
    except Exception as e:
        import traceback
        traceback.print_exc()
        window.show_popup_message2(
            "Error", f"Error processing isotherm files: {str(e)}")
