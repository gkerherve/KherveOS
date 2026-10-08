# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/FileMenu/FTIR_Import.py. Regenerate with tools/export_khervetech.py.
# libraries/FileMenu/FTIR_Import.py
"""
FTIR text-file importer.

Handles Agilent Cary 630 (MicroLab Expert) exports:

    DATATYPE     IR Spectrum
    XYUNITS      Wavenumber;PercentTransmittance
    DECIMALSYMBOL.
    298.1870     43.8443
    ...
    Created at (UTC)=06/20/2025 14:51:06
    SampleScans=20
    ...

as well as generic two-column (wavenumber, intensity) text files.

Sheets are named FTIR, FTIR1, FTIR2, ... which follows the KherveFitting
row convention (base name + row index) and triggers the FTIR plot mode
(wavenumber x-axis, transmittance y-axis).
"""

import os
import re
import openpyxl
import wx


# Y-unit strings as stored in the sheet data (read by the plot code).
Y_UNIT_TRANSMITTANCE = "Transmittance (%)"
Y_UNIT_ABSORBANCE = "Absorbance"


def infer_y_unit(y_values):
    """Guess the ordinate unit of a spectrum that carries no unit header.

    Delegates to :func:`FTIR_Engine.detect_y_unit`, which knows about every
    supported ordinate - including uncalibrated single-beam intensity, the
    case that used to be mislabelled as percent transmittance and then
    "converted" into absorbances of -4.5.

    Returns ``(unit, confidence, reason)``.  Nothing is rescaled here: a 0-1
    transmittance fraction is a unit in its own right.
    """
    from libraries.ToolsMenu.FTIR_Engine import detect_y_unit
    if not y_values:
        return Y_UNIT_TRANSMITTANCE, 0.0, "No data."
    return detect_y_unit(y_values)


def parse_ftir_txt(file_path):
    """
    Parse an FTIR text file (Agilent Cary 630 MicroLab export or generic
    two-column data).

    Returns (data, y_unit, metadata):
        data     : list of (wavenumber, intensity) tuples
        y_unit   : Y_UNIT_TRANSMITTANCE or Y_UNIT_ABSORBANCE
        metadata : dict of header/footer key-value pairs
    """
    data = []
    metadata = {}
    y_unit = Y_UNIT_TRANSMITTANCE
    unit_declared = False
    decimal_symbol = '.'

    with open(file_path, 'r', errors='ignore') as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line or line.startswith('#'):
                continue

            # Split on tabs, semicolons, whitespace (and commas, unless the
            # comma is the decimal symbol)
            if decimal_symbol == ',':
                tokens = re.split(r'[\t;\s]+', line)
            else:
                tokens = re.split(r'[\t;,\s]+', line)

            # Try to read a data point from the first two tokens
            if len(tokens) >= 2:
                t0, t1 = tokens[0], tokens[1]
                if decimal_symbol == ',':
                    t0, t1 = t0.replace(',', '.'), t1.replace(',', '.')
                try:
                    x_val = float(t0)
                    y_val = float(t1)
                    data.append((x_val, y_val))
                    continue
                except ValueError:
                    pass

            # Footer metadata lines: key=value
            if '=' in line:
                key, _, value = line.partition('=')
                metadata[key.strip()] = value.strip()
                continue

            # Header lines: DATATYPE / XYUNITS / DECIMALSYMBOL
            upper = line.upper()
            if upper.startswith('XYUNITS'):
                units = line.split(None, 1)[1] if len(line.split(None, 1)) > 1 else ''
                metadata['XYUNITS'] = units.strip()
                if 'ABSORB' in units.upper():
                    y_unit = Y_UNIT_ABSORBANCE
                    unit_declared = True
                elif 'TRANSMIT' in units.upper():
                    y_unit = Y_UNIT_TRANSMITTANCE
                    unit_declared = True
            elif upper.startswith('DECIMALSYMBOL'):
                parts = line.split(None, 1)
                if len(parts) > 1 and parts[1].strip() == ',':
                    decimal_symbol = ','
                metadata['DECIMALSYMBOL'] = decimal_symbol
            elif upper.startswith('DATATYPE'):
                parts = line.split(None, 1)
                metadata['DATATYPE'] = parts[1].strip() if len(parts) > 1 else ''

    # Bare CSV/text exports declare no units - infer them from the data shape.
    if data and not unit_declared:
        y_unit, confidence, reason = infer_y_unit([pt[1] for pt in data])
        metadata['Y Units'] = f"{y_unit} (inferred from data)"
        metadata['Y Unit Confidence'] = f"{confidence:.0%}"
        metadata['Y Unit Reason'] = reason
        metadata['_y_unit_confidence'] = confidence
        metadata['_y_unit_reason'] = reason
    elif unit_declared:
        metadata['_y_unit_confidence'] = 1.0
        metadata['_y_unit_reason'] = "Declared in the file header (XYUNITS)."

    return data, y_unit, metadata


def _next_ftir_sheet_name(existing_names):
    """Return the next free FTIR sheet name: FTIR, FTIR1, FTIR2, ..."""
    existing = {name.upper() for name in existing_names}
    if 'FTIR' not in existing:
        return 'FTIR'
    idx = 1
    while f'FTIR{idx}' in existing:
        idx += 1
    return f'FTIR{idx}'


def _write_ftir_sheet(wb, sheet_name, data):
    """Create a data sheet with the standard KherveFitting two-column layout."""
    ws = wb.create_sheet(title=sheet_name)
    ws["A1"] = "Wavenumber (cm-1)"
    ws["B1"] = "Raw Data"
    for i, (wavenumber, intensity) in enumerate(data, start=2):
        ws[f"A{i}"] = wavenumber
        ws[f"B{i}"] = intensity
    return ws


def _append_experimental_description(wb, entries):
    """Write one 'Experimental description' sheet summarising all imported files.

    entries: list of (sheet_name, file_path, y_unit, metadata, n_points)
    """
    exp_sheet = wb.create_sheet("Experimental description")
    exp_sheet.column_dimensions['A'].width = 30
    exp_sheet.column_dimensions['B'].width = 60

    row = 1
    for sheet_name, file_path, y_unit, metadata, n_points in entries:
        exp_sheet[f"A{row}"] = "Sheet"
        exp_sheet[f"B{row}"] = sheet_name
        row += 1
        exp_sheet[f"A{row}"] = "Source File"
        exp_sheet[f"B{row}"] = os.path.basename(file_path)
        row += 1
        exp_sheet[f"A{row}"] = "Technique"
        exp_sheet[f"B{row}"] = "FTIR (ATR)"
        row += 1
        exp_sheet[f"A{row}"] = "Y Units"
        exp_sheet[f"B{row}"] = y_unit
        row += 1
        exp_sheet[f"A{row}"] = "Number of Points"
        exp_sheet[f"B{row}"] = str(n_points)
        row += 1
        for key in ("Created at (UTC)", "SampleScans", "BackgroundScans", "From",
                    "To", "Resolution", "Gain", "Apodization", "ZeroFillFactor"):
            if key in metadata:
                exp_sheet[f"A{row}"] = key
                exp_sheet[f"B{row}"] = metadata[key]
                row += 1
        row += 1  # blank line between files


def _tag_ftir_units(window, unit_by_sheet):
    """After open_xlsx_file rebuilt window.Data, record each sheet's ordinate.

    ``unit_by_sheet`` maps a sheet name to ``(unit, confidence, reason)``.
    Anything the importer is not confident about is put to the user rather
    than assumed - a wrong ordinate silently corrupts every conversion, band
    intensity and assignment downstream.

    The limits computed while the file was opening assumed the transmittance
    default (labels padded below the trace), so drop them for any sheet tagged
    as absorbance and redraw - absorbance bands point up and need the margin
    on the other side.
    """
    from libraries.ToolsMenu import FTIR_Engine as engine

    core_levels = window.Data.get('Core levels', {})
    retagged = False
    for sheet_name, tagged in unit_by_sheet.items():
        if sheet_name not in core_levels:
            continue
        if isinstance(tagged, (tuple, list)):
            y_unit, confidence, reason = tagged
        else:                                    # older callers pass a string
            y_unit, confidence, reason = tagged, 1.0, ""

        sheet = core_levels[sheet_name]
        if confidence < 0.8:
            y_unit = _ask_ordinate(window, sheet_name, sheet, y_unit,
                                   confidence, reason)

        sheet['FTIR_Y_Unit'] = y_unit
        sheet['FTIR_Input_Unit'] = y_unit
        # Capture the pristine spectrum now, before anything can touch it
        sheet['FTIR_Raw'] = {'x': list(sheet.get('B.E.', [])),
                             'y': list(sheet.get('Raw Data', [])),
                             'unit': y_unit}
        sheet['FTIR_Detection'] = {'guess': y_unit, 'confidence': confidence,
                                   'reason': reason}
        warnings = engine.validate_values(sheet['FTIR_Raw']['y'], y_unit)
        if warnings:
            sheet['FTIR_Warnings'] = warnings

        plot_config = getattr(window, 'plot_config', None)
        if plot_config is not None:
            plot_config.plot_limits.pop(sheet_name, None)
            if hasattr(plot_config, 'original_limits'):
                plot_config.original_limits.pop(sheet_name, None)
            retagged = True

    if retagged:
        current = window.sheet_combobox.GetValue()
        if current in core_levels:
            window.plot_config.update_plot_limits(window, current)
            window.clear_and_replot()


def _ask_ordinate(window, sheet_name, sheet, guess, confidence, reason):
    """Ask the user to confirm an uncertain ordinate. Returns the chosen unit."""
    from libraries.ToolsMenu.FTIR_Analysis import UnitConfirmDialog
    dlg = UnitConfirmDialog(window, sheet_name, guess, confidence, reason,
                            sheet.get('Raw Data', []))
    try:
        return dlg.unit() if dlg.ShowModal() == wx.ID_OK else guess
    finally:
        dlg.Destroy()


def _import_ftir_paths(window, file_paths, excel_path):
    """Convert the given FTIR text files into one Excel workbook and open it."""
    from libraries.FileMenu.Open import open_xlsx_file

    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    entries = []
    unit_by_sheet = {}
    skipped = []

    for file_path in file_paths:
        try:
            data, y_unit, metadata = parse_ftir_txt(file_path)
        except Exception as e:
            skipped.append(f"{os.path.basename(file_path)}: {e}")
            continue

        if not data:
            skipped.append(f"{os.path.basename(file_path)}: no valid data")
            continue

        sheet_name = _next_ftir_sheet_name(wb.sheetnames)
        _write_ftir_sheet(wb, sheet_name, data)
        entries.append((sheet_name, file_path, y_unit, metadata, len(data)))
        unit_by_sheet[sheet_name] = (y_unit,
                                     metadata.get('_y_unit_confidence', 1.0),
                                     metadata.get('_y_unit_reason', ''))

    if not entries:
        window.show_popup_message2("Error", "No valid FTIR data found.\n" + "\n".join(skipped))
        return False

    _append_experimental_description(wb, entries)
    wb.save(excel_path)

    open_xlsx_file(window, excel_path)
    _tag_ftir_units(window, unit_by_sheet)

    if skipped:
        window.show_popup_message2("Warning",
                                   "Some files were skipped:\n" + "\n".join(skipped))
    return True


def _import_from_file_dialog(window, title, wildcard, combined_name):
    """Shared 'pick one or more files' import path."""
    with wx.FileDialog(window, title, wildcard=wildcard,
                       style=wx.FD_OPEN | wx.FD_FILE_MUST_EXIST | wx.FD_MULTIPLE) as fileDialog:
        if fileDialog.ShowModal() == wx.ID_CANCEL:
            return
        file_paths = fileDialog.GetPaths()

    if not file_paths:
        return

    try:
        if len(file_paths) == 1:
            base = os.path.splitext(os.path.basename(file_paths[0]))[0]
            excel_path = os.path.join(os.path.dirname(file_paths[0]), f"{base}.xlsx")
        else:
            excel_path = os.path.join(os.path.dirname(file_paths[0]), combined_name)

        _import_ftir_paths(window, sorted(file_paths), excel_path)

    except Exception as e:
        import traceback
        traceback.print_exc()
        window.show_popup_message2("Error", f"Error processing FTIR file(s): {str(e)}")


def _import_from_folder(window, title, extensions, combined_name):
    """Shared 'pick a folder' import path. ``extensions`` is a tuple of
    lower-case suffixes, e.g. ``('.csv',)``."""
    with wx.DirDialog(window, title,
                      style=wx.DD_DEFAULT_STYLE | wx.DD_DIR_MUST_EXIST) as dirDialog:
        if dirDialog.ShowModal() == wx.ID_CANCEL:
            return
        dir_path = dirDialog.GetPath()

    try:
        found = sorted(f for f in os.listdir(dir_path)
                       if f.lower().endswith(extensions))
        if not found:
            pretty = "/".join(extensions)
            window.show_popup_message2("Information",
                                       f"No {pretty} files found in the selected folder.")
            return

        file_paths = [os.path.join(dir_path, f) for f in found]
        excel_path = os.path.join(dir_path, combined_name)
        _import_ftir_paths(window, file_paths, excel_path)

    except Exception as e:
        import traceback
        traceback.print_exc()
        window.show_popup_message2("Error", f"Error processing FTIR files: {str(e)}")


def import_ftir_file(window):
    """Import one or more FTIR text files (Agilent Cary 630 / generic) selected
    in a file dialog. Each file becomes a sheet FTIR, FTIR1, FTIR2, ..."""
    _import_from_file_dialog(
        window, "Open FTIR file(s)",
        "FTIR text files (*.txt;*.csv;*.dat)|"
        "*.txt;*.csv;*.dat;*.TXT;*.CSV;*.DAT|All files (*.*)|*.*",
        "FTIR_Data.xlsx")


def import_multiple_ftir_files(window):
    """Import all FTIR text files from a folder into one Excel workbook with
    sheets FTIR, FTIR1, FTIR2, ..."""
    _import_from_folder(
        window, "Choose a directory containing FTIR text files",
        ('.txt', '.csv', '.dat'), "FTIR_Data.xlsx")


def import_ftir_csv_file(window):
    """Import one or more FTIR .csv files (bare two-column wavenumber,intensity
    exports). The ordinate unit is inferred from the data - see
    :func:`infer_y_unit`."""
    _import_from_file_dialog(
        window, "Open FTIR CSV file(s)",
        # Both cases are listed because wx wildcards are case-sensitive on
        # GTK, and instruments commonly export upper-case .CSV
        "FTIR CSV files (*.csv)|*.csv;*.CSV|All files (*.*)|*.*",
        "FTIR_CSV_Data.xlsx")


def import_multiple_ftir_csv_files(window):
    """Import every .csv in a folder as FTIR sheets in one workbook."""
    _import_from_folder(
        window, "Choose a directory containing FTIR CSV files",
        ('.csv',), "FTIR_CSV_Data.xlsx")
