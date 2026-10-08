# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/FileMenu/KFitting_IO.py. Regenerate with tools/export_khervetech.py.
"""Save / open a KherveFitting project as a single .kfit (HDF5) file.

A ``.kfit`` file replaces the ``.xlsx`` + ``.json`` pair with one HDF5
container holding the complete project:

  * ``project_json_gz`` — the full ``window.Data`` structure (identical in
    content to the sibling ``.json`` of an ``.xlsx`` project), serialized to
    JSON and zlib-compressed. Stored as a dataset, not an attribute, because
    HDF5 attributes are capped at 64 KB.
  * ``core_levels/cl_<i>`` — one group per core level with the spectral
    arrays (``B.E.``, ``Raw Data``, background ``Bkg Y``) stored as lossless
    float64 datasets. On load these override the 2-decimal-rounded copies in
    the JSON, so a .kfit round-trip is lossless where the .json was not.

The point of the format is loading speed: opening a big project no longer
goes through openpyxl/pandas Excel parsing — the state is rebuilt straight
from the embedded JSON and numeric datasets.

ARPES cubes keep their existing companion ``<base>_arpes.h5`` mechanism
(`save_arpes_companion` / `load_arpes_companion`), which works unchanged
because it only derives its path from the project file path.
"""

import os
import re
import json
import zlib

import numpy as np
import wx

KFITTING_EXT = '.kfit'
KFITTING_WILDCARD = "KherveFitting HDF5 files (*.kfit)|*.kfit"


def is_kfitting_path(file_path):
    return bool(file_path) and str(file_path).lower().endswith(KFITTING_EXT)


def kfitting_save_active(window):
    """True when saves must go to .kfit instead of .xlsx + .json.

    Either the open project *is* a .kfit file, or the user selected the
    .kfit format in Preferences > Save. Explicit Excel exports set
    ``window._kfitting_export_xlsx`` to bypass this routing while they run.
    """
    if not hasattr(window, 'Data'):
        return False
    if getattr(window, '_kfitting_export_xlsx', False):
        return False
    if is_kfitting_path(window.Data.get('FilePath', '')):
        return True
    return getattr(window, 'save_file_format', 'xlsx') == 'kfitting'


def _as_float_array(values):
    """Return a 1-D float64 array, or None if the values are not numeric."""
    if values is None:
        return None
    try:
        arr = np.asarray(values, dtype=np.float64)
    except (TypeError, ValueError):
        return None
    if arr.ndim != 1 or arr.size == 0:
        return None
    return arr


def _lossless_keys(core_level):
    """Sheet keys whose arrays are written to HDF5 instead of the rounded JSON.

    Besides the spectrum itself, this covers the auxiliary traces a technique
    hangs off its sheet - a TGA sheet carries its DSC signal, time base and
    sensitivity alongside the mass, and a DSC signal of order 1e-4 µV/mg would
    not survive the two-decimal rounding.  An EIS sheet is worse still: one
    sweep runs from hertz to megahertz and from milliohms to megaohms, so both
    ends of every trace would be destroyed.
    """
    keys = ['B.E.', 'Raw Data']
    # The transmission function and the uncorrected counts behind it: the
    # VAMAS export divides one by the other to reconstruct the file's raw
    # values, and a transmission of 1/(scans x dwell) is often well below 0.01,
    # where two decimals leave one significant figure or none at all.
    keys += ['Corrected Data', 'Transmission']
    keys += [k for k in core_level if k.startswith('TGA_')]
    keys += [k for k in core_level if k.startswith('EIS_')]
    # An XRD pattern's 2-theta step is ~0.01-0.03 degrees, so the rounded JSON
    # copy would quantise the whole axis.
    keys += [k for k in core_level if k.startswith('XRD_')]
    # A TEM line profile is sampled every pixel - a few picometres on a
    # lattice image - and the fringe positions picked off it sit 0.2 nm
    # apart, so at two decimals every one of them would land on 0.2.
    # (Non-numeric TEM_ keys are skipped by _as_float_array below.)
    keys += [k for k in core_level if k.startswith('TEM_')]
    # An AFM height profile lives at sub-nanometre amplitudes (an Sa of
    # 0.098 nm would round to 0.1), so its arrays travel losslessly too.
    keys += [k for k in core_level if k.startswith('AFM_')]
    # Dilatometry dL/L0 is of order 1e-5 and the BET transform of order 1e-3,
    # both far below the two-decimal rounding of the JSON copy.
    keys += [k for k in core_level if k.startswith('DIL_')]
    keys += [k for k in core_level if k.startswith('BET_')]
    # EELS: sub-nm ADF profile distances and any future per-point arrays.
    # (Non-numeric EELS_ keys, e.g. the axis labels, are skipped by
    # _as_float_array.)
    keys += [k for k in core_level if k.startswith('EELS_')]
    return keys


def write_kfitting(window, file_path, update_console=None):
    """Write the complete project state of ``window`` into ``file_path``."""
    import h5py
    from libraries.FileMenu.Save import convert_to_serializable_and_round

    def console(msg):
        if update_console:
            update_console(msg)

    json_data = dict(window.Data)
    json_data['FilePath'] = file_path

    # ARPES datasets: cube + axes go to the companion <base>_arpes.h5
    # (lossless), only light metadata stays in the JSON — same handling as
    # the .xlsx save path.
    try:
        from libraries.FileMenu.ARPES_Import import (
            save_arpes_companion, strip_arpes_arrays_for_json)
        n_arpes = save_arpes_companion(window.Data.get('Core levels', {}), file_path)
        if n_arpes:
            core = {k: (dict(v) if isinstance(v, dict) and v.get('_arpes') else v)
                    for k, v in json_data.get('Core levels', {}).items()}
            strip_arpes_arrays_for_json(core)
            json_data['Core levels'] = core
            console(f"Saved {n_arpes} ARPES cube(s) to companion .h5")
    except Exception as e:
        print(f"ARPES companion save skipped: {e}")

    # SEM images go *inside* the .kfit (it is already HDF5, so unlike the
    # .xlsx path there is no need for a companion file and the project stays
    # self-contained). The JSON keeps only the light metadata.
    try:
        from libraries.FileMenu.SEM_Import import strip_sem_arrays_for_json
        core_levels_src = window.Data.get('Core levels', {})
        if any(isinstance(v, dict) and v.get('_sem') for v in core_levels_src.values()):
            core = {k: (dict(v) if isinstance(v, dict) and v.get('_sem') else v)
                    for k, v in json_data.get('Core levels', {}).items()}
            strip_sem_arrays_for_json(core)
            json_data['Core levels'] = core
    except Exception as e:
        print(f"SEM strip skipped: {e}")

    # TEM images/FFTs: same treatment as SEM — pixels embed in the .kfit
    # below, the JSON keeps only the light metadata.
    try:
        from libraries.FileMenu.TEM_Import import strip_tem_arrays_for_json
        core_levels_src = window.Data.get('Core levels', {})
        if any(isinstance(v, dict) and v.get('_tem') for v in core_levels_src.values()):
            core = {k: (dict(v) if isinstance(v, dict) and v.get('_tem') else v)
                    for k, v in json_data.get('Core levels', {}).items()}
            strip_tem_arrays_for_json(core)
            json_data['Core levels'] = core
    except Exception as e:
        print(f"TEM strip skipped: {e}")

    # AFM channel maps (and any force volume): same treatment.
    try:
        from libraries.FileMenu.AFM_Import import strip_afm_arrays_for_json
        core_levels_src = window.Data.get('Core levels', {})
        if any(isinstance(v, dict) and v.get('_afm') for v in core_levels_src.values()):
            core = {k: (dict(v) if isinstance(v, dict) and v.get('_afm') else v)
                    for k, v in json_data.get('Core levels', {}).items()}
            strip_afm_arrays_for_json(core)
            json_data['Core levels'] = core
    except Exception as e:
        print(f"AFM strip skipped: {e}")

    # Label image overlays: the PNG bytes go into the .kfit itself below; the
    # JSON keeps only the light entry.
    try:
        from libraries.ViewMenu.Label_Images import (has_image_labels,
                                                     strip_label_images_for_json)
        if has_image_labels(window.Data.get('Core levels', {})):
            core = {k: (dict(v) if isinstance(v, dict) else v)
                    for k, v in json_data.get('Core levels', {}).items()}
            strip_label_images_for_json(core)
            json_data['Core levels'] = core
    except Exception as e:
        print(f"Label image strip skipped: {e}")

    console("Converting data to serializable format...")
    json_data = convert_to_serializable_and_round(json_data)
    json_text = json.dumps(json_data)

    console("Writing .kfit file...")
    tmp_path = file_path + '.tmp'
    try:
        with h5py.File(tmp_path, 'w') as f:
            f.attrs['format'] = 'kfitting'
            f.attrs['version'] = 1
            f.attrs['application'] = 'KherveFitting'

            comp = np.frombuffer(zlib.compress(json_text.encode('utf-8'), 6),
                                 dtype=np.uint8)
            f.create_dataset('project_json_gz', data=comp)

            # Lossless spectral arrays (the JSON copies are rounded to 2 dp).
            grp = f.create_group('core_levels')
            core_levels = window.Data.get('Core levels', {})
            try:
                from libraries.FileMenu.SEM_Import import write_sem_into_h5
                n_sem = write_sem_into_h5(f, core_levels)
                if n_sem:
                    console(f"Embedded {n_sem} SEM image(s)")
            except Exception as e:
                print(f"SEM embed skipped: {e}")

            try:
                from libraries.FileMenu.TEM_Import import write_tem_into_h5
                n_tem = write_tem_into_h5(f, core_levels)
                if n_tem:
                    console(f"Embedded {n_tem} TEM image(s)")
            except Exception as e:
                print(f"TEM embed skipped: {e}")

            try:
                from libraries.FileMenu.AFM_Import import write_afm_into_h5
                n_afm = write_afm_into_h5(f, core_levels)
                if n_afm:
                    console(f"Embedded {n_afm} AFM channel map(s)")
            except Exception as e:
                print(f"AFM embed skipped: {e}")

            try:
                from libraries.ViewMenu.Label_Images import write_label_images_into_h5
                n_img = write_label_images_into_h5(f, core_levels)
                if n_img:
                    console(f"Embedded {n_img} label image(s)")
            except Exception as e:
                print(f"Label image embed skipped: {e}")

            for i, (name, cl) in enumerate(core_levels.items()):
                if not isinstance(cl, dict) or cl.get('_arpes') or cl.get('_sem') \
                        or cl.get('_tem') or cl.get('_afm'):
                    continue
                sg = grp.create_group(f'cl_{i}')
                sg.attrs['name'] = str(name)
                for key in _lossless_keys(cl):
                    arr = _as_float_array(cl.get(key))
                    if arr is not None:
                        sg.create_dataset(key, data=arr, compression='gzip')
                bkg = cl.get('Background')
                if isinstance(bkg, dict):
                    arr = _as_float_array(bkg.get('Bkg Y'))
                    if arr is not None:
                        sg.create_dataset('Bkg Y', data=arr, compression='gzip')
        os.replace(tmp_path, file_path)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
    console(f"Saved: {os.path.basename(file_path)}")


def read_kfitting(file_path):
    """Read a .kfit file and return the project data dictionary."""
    import h5py

    with h5py.File(file_path, 'r') as f:
        fmt = f.attrs.get('format')
        if isinstance(fmt, bytes):
            fmt = fmt.decode('utf-8')
        if fmt != 'kfitting' or 'project_json_gz' not in f:
            raise ValueError("Not a KherveFitting .kfit file "
                             "(missing project data).")

        comp = bytes(np.asarray(f['project_json_gz'][()], dtype=np.uint8))
        data = json.loads(zlib.decompress(comp).decode('utf-8'))

        # Overlay the lossless spectral arrays over the rounded JSON copies.
        core_levels = data.get('Core levels', {})
        try:
            from libraries.FileMenu.SEM_Import import read_sem_from_h5
            read_sem_from_h5(f, core_levels)
        except Exception as e:
            print(f"SEM image restore skipped: {e}")
        try:
            from libraries.FileMenu.TEM_Import import read_tem_from_h5
            read_tem_from_h5(f, core_levels)
        except Exception as e:
            print(f"TEM image restore skipped: {e}")
        try:
            from libraries.FileMenu.AFM_Import import read_afm_from_h5
            read_afm_from_h5(f, core_levels)
        except Exception as e:
            print(f"AFM map restore skipped: {e}")
        try:
            from libraries.ViewMenu.Label_Images import read_label_images_from_h5
            read_label_images_from_h5(f, core_levels)
        except Exception as e:
            print(f"Label image restore skipped: {e}")
        if 'core_levels' in f:
            for key in f['core_levels']:
                sg = f['core_levels'][key]
                name = sg.attrs.get('name', key)
                if isinstance(name, bytes):
                    name = name.decode('utf-8')
                cl = core_levels.get(str(name))
                if not isinstance(cl, dict):
                    continue
                for dkey in sg:
                    if dkey != 'Bkg Y':
                        cl[dkey] = sg[dkey][:].tolist()
                if 'Bkg Y' in sg and isinstance(cl.get('Background'), dict):
                    cl['Background']['Bkg Y'] = sg['Bkg Y'][:].tolist()

    return data


def save_kfitting_project(window):
    """Save the open project to its .kfit file (the Ctrl+S path).

    If the project was opened from an .xlsx but the .kfit format is
    selected in Preferences, the project is written to ``<base>.kfit``
    and the working file path switches to it — from then on every save goes
    to the .kfit only. The original .xlsx/.json are left untouched.
    """
    if 'FilePath' not in window.Data or not window.Data['FilePath']:
        wx.MessageBox("No file path found in window.Data. Please open a file first.",
                      "Error", wx.OK | wx.ICON_ERROR)
        return

    current_path = window.Data['FilePath']
    if is_kfitting_path(current_path):
        target_path = current_path
    else:
        target_path = os.path.splitext(current_path)[0] + KFITTING_EXT

    from libraries.FileMenu.ProcessingConsole import ProcessingConsole
    console_frame = ProcessingConsole(window, "Saving Data (.kfit)")

    def update_console(msg):
        console_frame.update(msg)

    try:
        update_console("Starting .kfit save process...")
        write_kfitting(window, target_path, update_console)

        if target_path != current_path:
            window.Data['FilePath'] = target_path
            window.SetStatusText(f"Selected File: {target_path}", 0)
            from libraries.FileMenu.Open import update_recent_files
            update_recent_files(window, target_path)
            update_console("Project now saves to the .kfit file only.")

        update_console(".kfit file saved successfully!")
        console_frame.finish("Data saved successfully!")
    except Exception as e:
        update_console(f"Error during save: {str(e)}")
        console_frame.finish(f"Error: {str(e)}", auto_close_ms=0)
        import traceback
        traceback.print_exc()
        wx.MessageBox(f"Error saving .kfit file: {str(e)}", "Error",
                      wx.OK | wx.ICON_ERROR)


def save_kfitting_file_dialog(window):
    """Export the current project to a chosen .kfit file.

    Unlike :func:`save_kfitting_project`, this never rebinds the working
    file path — it writes a self-contained copy, like the VAMAS export.
    """
    if 'FilePath' not in window.Data or not window.Data['FilePath']:
        wx.MessageBox("No file is currently open. Open or save a project first.",
                      "Export to .kfit", wx.OK | wx.ICON_ERROR)
        return

    current_path = window.Data['FilePath']
    default_dir = os.path.dirname(current_path)
    default_file = os.path.splitext(os.path.basename(current_path))[0] + KFITTING_EXT

    with wx.FileDialog(window, "Export as KherveFitting HDF5",
                       defaultDir=default_dir, defaultFile=default_file,
                       wildcard=KFITTING_WILDCARD,
                       style=wx.FD_SAVE | wx.FD_OVERWRITE_PROMPT) as dlg:
        if dlg.ShowModal() != wx.ID_OK:
            return
        file_path = dlg.GetPath()
    if not is_kfitting_path(file_path):
        file_path += KFITTING_EXT

    try:
        # Keep the embedded FilePath pointing at the exported file itself so
        # the export opens as a standalone project.
        write_kfitting(window, file_path)
        if hasattr(window, 'show_popup_message2'):
            window.show_popup_message2("Export to .kfit", f"Saved to:\n{file_path}")
        else:
            wx.MessageBox(f"Saved to:\n{file_path}", "Export to .kfit",
                          wx.OK | wx.ICON_INFORMATION)
    except Exception as e:
        import traceback
        traceback.print_exc()
        wx.MessageBox(f"Failed to write .kfit file:\n{e}",
                      "Export to .kfit", wx.OK | wx.ICON_ERROR)


def _close_aux_windows(window):
    """Close file manager / fitting / export windows before loading a project.

    Mirrors the window-closing preamble of ``open_xlsx_file``. Returns
    (file_manager_was_open, file_manager_position) so the caller can restore
    the file manager afterwards.
    """
    file_manager_was_open = False
    file_manager_position = None
    try:
        if hasattr(window, 'file_manager') and window.file_manager is not None \
                and window.file_manager.IsShown():
            file_manager_was_open = True
            file_manager_position = window.file_manager.GetPosition()
            window.file_manager.Close()
            window.file_manager = None
    except RuntimeError:
        window.file_manager = None

    for attr in ('fitting_screen', 'areafit_screen', 'profile_creator_window',
                 'export_results_window'):
        try:
            win = getattr(window, attr, None)
            if win is not None:
                try:
                    win.GetSize()
                    win.Close()
                except RuntimeError:
                    pass
                setattr(window, attr, None)
        except Exception:
            pass

    return file_manager_was_open, file_manager_position


def open_kfitting_file(window, file_path=None):
    """Open a .kfit project natively — no Excel parsing involved."""
    from libraries.FileMenu.Open import convert_from_serializable, update_recent_files
    from libraries.FileMenu.Save import update_undo_redo_state, save_state
    from libraries.Sheet_Operations import on_sheet_selected
    from libraries.Grid_Operations import populate_results_grid

    if file_path is None:
        with wx.FileDialog(window, "Open KherveFitting HDF5 file",
                           wildcard=KFITTING_WILDCARD,
                           style=wx.FD_OPEN | wx.FD_FILE_MUST_EXIST) as dlg:
            if dlg.ShowModal() != wx.ID_OK:
                return
            file_path = dlg.GetPath()

    file_manager_was_open, file_manager_position = _close_aux_windows(window)

    try:
        from libraries.FileMenu.ProcessingConsole import ProcessingConsole
        console_frame = ProcessingConsole(window, "Loading KFitting File")

        def update_console(msg):
            console_frame.update(msg)

        update_console("Initializing...")
        window.SetStatusText(f"Selected File: {file_path}", 0)

        # Clear history and results
        window.history = []
        window.redo_stack = []
        update_undo_redo_state(window)
        window.results_grid.ClearGrid()
        if window.results_grid.GetNumberRows() > 0:
            window.results_grid.DeleteRows(0, window.results_grid.GetNumberRows())

        update_console("Reading .kfit file...")
        loaded_data = read_kfitting(file_path)
        window.Data = convert_from_serializable(loaded_data)
        window.Data['FilePath'] = file_path
        populate_results_grid(window)

        # Restore ARPES dataset cubes from the companion <base>_arpes.h5.
        try:
            from libraries.FileMenu.ARPES_Import import load_arpes_companion
            load_arpes_companion(window.Data.get('Core levels', {}), file_path)
        except Exception as e:
            print(f"ARPES companion load skipped: {e}")

        sheet_names = [name for name in window.Data.get('Core levels', {}).keys()]
        if not sheet_names:
            console_frame.close_now()
            wx.MessageBox("This .kfit file contains no core levels.",
                          "Open KFitting File", wx.OK | wx.ICON_WARNING)
            return

        console_frame.set_total(len(sheet_names) + 8)
        update_console(f"Found {len(sheet_names)} core levels...")
        for i, sheet_name in enumerate(sheet_names, 1):
            update_console(f"  {i}/{len(sheet_names)}: {sheet_name}")

        update_console("Loading BE corrections...")
        window.load_be_correction()

        update_console("Setting up interface...")
        window.sheet_combobox.Clear()
        window.sheet_combobox.AppendItems(sheet_names)
        first_sheet = sheet_names[0]
        window.sheet_combobox.SetValue(first_sheet)

        event = wx.CommandEvent(wx.EVT_COMBOBOX.typeId)
        event.SetString(first_sheet)
        window.plot_config.plot_limits.clear()
        on_sheet_selected(window, event)

        save_state(window)
        update_recent_files(window, file_path)

        if hasattr(window, 'setup_backup_timer'):
            window.setup_backup_timer()

        from libraries.Utilities import perform_auto_backup
        update_console("Performing auto backup...")
        perform_auto_backup(window)

        update_console("Updating plots...")
        if not (first_sheet == 'EDX~Map' or first_sheet.startswith('EDX~Plot')):
            window.plot_manager.plot_data(window)
            window.clear_and_replot()

        update_console("File loaded successfully!")
        console_frame.finish("File loaded successfully!")

        # Notify KherveAI to reload chat and notes for the new file
        try:
            kf = getattr(window, '_kherve_ai_frame', None)
            if kf and hasattr(kf, 'panel') and hasattr(kf.panel, '_on_new_file_opened'):
                wx.CallAfter(kf.panel._on_new_file_opened)
        except Exception:
            pass

        # Restore file manager
        if file_manager_was_open:
            from libraries.ViewMenu.FileManager import FileManagerWindow
            window.file_manager = FileManagerWindow(window)
            if file_manager_position:
                window.file_manager.SetPosition(file_manager_position)
            window.file_manager.Show()

    except Exception as e:
        import traceback
        traceback.print_exc()
        wx.MessageBox(f"Error reading file: {str(e)}", "Error", wx.OK | wx.ICON_ERROR)


def persist_project(window, update_console=None):
    """Persist ``window.Data`` to the project's native store.

    For a .kfit project that is the HDF5 file itself; for an .xlsx project
    it is the sibling .json. Use this from sheet operations (delete, rename,
    copy, ...) instead of dumping the .json directly.
    """
    file_path = window.Data.get('FilePath', '') or ''
    if is_kfitting_path(file_path):
        write_kfitting(window, file_path, update_console)
    else:
        # _write_project_json routes the heavy arrays (ARPES cubes, SEM images)
        # to the companion .hdf5 first. Serialising window.Data directly here
        # would dump a whole pixel array into the .json as rounded numbers.
        from libraries.FileMenu.Save import _write_project_json
        _write_project_json(window, file_path)


def prompt_project_format(window, n_sheets=0):
    """Ask how a freshly imported project should be stored.

    Returns 'kfitting' or 'xlsx'. The answer can be remembered for the rest
    of the session via a checkbox; cancelling the dialog keeps .xlsx (the
    do-nothing choice). Called by the open/import pipelines for projects
    that do not have a sibling .json yet (i.e. brand-new imports).
    """
    remembered = getattr(window, '_import_format_session_choice', None)
    if remembered in ('kfitting', 'xlsx'):
        return remembered

    big = n_sheets > 15
    dlg = wx.Dialog(window, title="Choose Project Format",
                    style=wx.DEFAULT_DIALOG_STYLE | wx.STAY_ON_TOP)
    s = wx.BoxSizer(wx.VERTICAL)
    s.Add(wx.StaticText(dlg, label="How should this imported data be stored?"),
          0, wx.ALL, 10)

    rb_kfit = wx.RadioButton(dlg, label=".kfit  —  single HDF5 file, very fast (newer format)",
                             style=wx.RB_GROUP)
    rb_xlsx = wx.RadioButton(dlg, label=".xlsx + .json  —  slower, but sheets open in Excel")
    s.Add(rb_kfit, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 12)
    s.Add(rb_xlsx, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 12)

    if big:
        note = wx.StaticText(
            dlg, label=f"Note: this project has {n_sheets} sheets — "
                       ".kfit is strongly recommended (much faster).")
        note.SetForegroundColour(wx.Colour(178, 90, 0))
        s.Add(note, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 12)

    remember_cb = wx.CheckBox(dlg, label="Don't ask again this session")
    s.Add(remember_cb, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 12)

    # Default: preference (or .kfit when the sheet count begs for it)
    if big or getattr(window, 'save_file_format', 'xlsx') == 'kfitting':
        rb_kfit.SetValue(True)
    else:
        rb_xlsx.SetValue(True)

    bs = wx.StdDialogButtonSizer()
    bs.AddButton(wx.Button(dlg, wx.ID_OK))
    bs.Realize()
    s.Add(bs, 0, wx.ALL | wx.ALIGN_CENTER, 8)
    dlg.SetSizer(s)
    dlg.Fit()
    dlg.CentreOnParent()

    choice = 'xlsx'
    if dlg.ShowModal() == wx.ID_OK:
        choice = 'kfitting' if rb_kfit.GetValue() else 'xlsx'
        if remember_cb.GetValue():
            window._import_format_session_choice = choice
    dlg.Destroy()
    return choice


def create_new_project_file(window, suggested_name='Project', default_dir=None,
                            update_console=None, ask=True, fmt=None):
    """Ask where to store a freshly imported project and write it there.

    An import that starts from an empty application has no project file, so
    until the user remembers to Save As there is nowhere for anything to
    persist: every edit calls persist_project, which silently does nothing
    without a FilePath. Creating the file at import time gives calibration,
    results and overlays somewhere to go from the first edit.

    ``ask=False`` skips both the format chooser and the Save-As dialog: the
    project is written straight to ``default_dir/suggested_name`` in ``fmt``
    (or the saved preference, defaulting to .kfit). The SEM import uses this to
    save the project beside the image, named after it, with no prompts.

    Returns the new path, or None if the user cancelled.
    """
    if ask:
        choice = prompt_project_format(window,
                                       len(window.Data.get('Core levels', {})))
    else:
        choice = fmt or getattr(window, 'save_file_format', None) or 'kfitting'
        if choice not in ('kfitting', 'xlsx'):
            choice = 'kfitting'
    if choice == 'kfitting':
        wildcard, ext = KFITTING_WILDCARD, KFITTING_EXT
    else:
        wildcard, ext = "Excel files (*.xlsx)|*.xlsx", '.xlsx'

    if ask:
        with wx.FileDialog(window, "Save the new project as",
                           defaultDir=default_dir or '',
                           defaultFile=f'{suggested_name}{ext}',
                           wildcard=wildcard,
                           style=wx.FD_SAVE | wx.FD_OVERWRITE_PROMPT) as dialog:
            if dialog.ShowModal() == wx.ID_CANCEL:
                return None
            path = dialog.GetPath()
    else:
        path = os.path.join(default_dir or '', f'{suggested_name}{ext}')
    if not path.lower().endswith(ext):
        path += ext

    window.Data['FilePath'] = path
    if choice == 'kfitting':
        window.save_file_format = 'kfitting'
        write_kfitting(window, path, update_console)
    else:
        from libraries.FileMenu.Save import _save_as_fresh_project
        _save_as_fresh_project(window, path)
        return path

    try:
        from libraries.FileMenu.Open import update_recent_files
        update_recent_files(window, path)
    except Exception:
        pass
    try:
        window.SetStatusText(f"Selected File: {path}", 0)
        window.save_config()
    except Exception:
        pass
    return path


def convert_to_kfitting_if_preferred(window, update_console=None):
    """Migrate an .xlsx-backed project to .kfit when the user chose that
    format for this import (``window._kfit_convert_choice``) or when it is
    the Preferences choice.

    Called at the end of the open/import pipelines so that importing a VAMAS,
    Kratos, Avantage, ... file (which always builds an intermediate .xlsx)
    lands directly on a .kfit project. The intermediate .xlsx/.json are
    deleted after the .kfit is written, so only the .kfit file remains.
    Returns the new path, or None if no conversion applied. Best-effort:
    never raises.
    """
    if getattr(window, '_kfitting_export_xlsx', False):
        return None

    # An explicit per-import answer from prompt_project_format wins over the
    # Preferences format. Consume it either way so later refreshes fall back
    # to the preference behaviour.
    choice = getattr(window, '_kfit_convert_choice', None)
    window._kfit_convert_choice = None

    # Importer-built project (intermediate marker set) that was not routed
    # through a pipeline that already asked: ask here. Import pipelines that
    # go via open_xlsx_file (or set the choice themselves) pass a non-None
    # choice, so this cannot double-ask.
    if choice is None and hasattr(window, 'Data'):
        marker = getattr(window, '_kfit_intermediate_xlsx', None)
        fp = window.Data.get('FilePath', '') or ''
        if (marker and fp.lower().endswith('.xlsx')
                and os.path.splitext(str(marker))[0] == os.path.splitext(fp)[0]):
            choice = prompt_project_format(
                window, len(window.Data.get('Core levels', {}) or {}))

    if choice == 'xlsx':
        window._kfit_intermediate_xlsx = None  # keep the .xlsx + .json project
        return None
    if choice != 'kfitting' and getattr(window, 'save_file_format', 'xlsx') != 'kfitting':
        return None
    if not hasattr(window, 'Data'):
        return None
    file_path = window.Data.get('FilePath', '') or ''
    if not file_path.lower().endswith('.xlsx'):
        return None

    target = os.path.splitext(file_path)[0] + KFITTING_EXT
    try:
        write_kfitting(window, target, update_console)
    except Exception as e:
        print(f"Could not convert project to .kfit: {e}")
        return None

    # The .kfit (HDF5) is self-contained and replaces the .xlsx + .json pair.
    # When an *importer* built a throwaway .xlsx (it marks it via
    # window._kfit_intermediate_xlsx), remove that intermediate + its .json so
    # only the .kfit remains. A plain "open my_data.xlsx" does NOT set the
    # marker, so the user's own Excel file is never deleted. Best-effort.
    marker = getattr(window, '_kfit_intermediate_xlsx', None)
    window._kfit_intermediate_xlsx = None  # consume the marker
    if marker and os.path.splitext(marker)[0] == os.path.splitext(file_path)[0]:
        base = os.path.splitext(file_path)[0]
        # openpyxl readers sit in reference cycles, so closing one is not enough
        # to release the Windows file lock - the handle only goes away on a GC
        # pass, and until then the .xlsx below refuses to be removed.
        import gc
        gc.collect()
        for intermediate in (base + '.xlsx', base + '.json'):
            try:
                if os.path.exists(intermediate):
                    os.remove(intermediate)
                    if update_console:
                        update_console(f"Removed intermediate {os.path.basename(intermediate)}")
            except Exception as e:
                # Usually a Windows file lock left by a reader that was never
                # closed - say so in the console, or the stray .xlsx looks
                # like the conversion silently did not happen.
                print(f"Could not remove intermediate {intermediate}: {e}")
                if update_console:
                    update_console(f"Warning: could not remove "
                                   f"{os.path.basename(intermediate)} ({e})")

    window.Data['FilePath'] = target
    try:
        window.SetStatusText(f"Selected File: {target}", 0)
    except Exception:
        pass
    try:
        from libraries.FileMenu.Open import update_recent_files
        update_recent_files(window, target)
    except Exception:
        pass
    if update_console:
        update_console(f"Project converted to {os.path.basename(target)} (.kfit format)")
    return target


def switch_project_format(window):
    """File-menu action: convert the open project between .kfit and
    .xlsx + .json (whichever direction applies), keeping the same base name.

    The source files are left on disk — this creates the counterpart format
    and rebinds the session to it.
    """
    file_path = window.Data.get('FilePath', '') if hasattr(window, 'Data') else ''
    if not file_path:
        wx.MessageBox("No project file is currently open.", "Switch Format",
                      wx.OK | wx.ICON_INFORMATION)
        return

    base, ext = os.path.splitext(file_path)
    ext = ext.lower()
    if ext not in ('.xlsx', KFITTING_EXT):
        wx.MessageBox(f"Unsupported project type: {ext}", "Switch Format",
                      wx.OK | wx.ICON_ERROR)
        return

    to_kfit = (ext == '.xlsx')
    target = base + (KFITTING_EXT if to_kfit else '.xlsx')

    if os.path.exists(target):
        resp = wx.MessageBox(
            f"{os.path.basename(target)} already exists.\n\nOverwrite it?",
            "Switch Format", wx.YES_NO | wx.ICON_QUESTION)
        if resp != wx.YES:
            return

    try:
        if to_kfit:
            write_kfitting(window, target)
        else:
            window._kfitting_export_xlsx = True
            try:
                write_project_xlsx(window, target)
                from libraries.FileMenu.Save import _write_project_json
                window.Data['FilePath'] = target
                _write_project_json(window, target)
            finally:
                window._kfitting_export_xlsx = False
    except Exception as e:
        import traceback
        traceback.print_exc()
        wx.MessageBox(f"Error converting project: {str(e)}", "Switch Format",
                      wx.OK | wx.ICON_ERROR)
        return

    window.Data['FilePath'] = target
    try:
        window.SetStatusText(f"Selected File: {target}", 0)
    except Exception:
        pass
    try:
        from libraries.FileMenu.Open import update_recent_files
        update_recent_files(window, target)
    except Exception:
        pass

    if to_kfit:
        msg = (f"Project now saved as {os.path.basename(target)} (fast HDF5 format).\n\n"
               f"The original .xlsx/.json files were kept on disk.")
    else:
        msg = (f"Project now saved as {os.path.basename(target)} + .json.\n\n"
               f"The .kfit file was kept on disk.")
    try:
        window.show_popup_message2("Format Switched", msg)
    except Exception:
        wx.MessageBox(msg, "Format Switched", wx.OK | wx.ICON_INFORMATION)


def refresh_sheets_kfitting(window, on_sheet_selected_func, update_console=None,
                            reopen_file=False):
    """Refresh a .kfit project without touching any Excel file.

    Mirrors what ``refresh_sheets`` does for .xlsx projects, but the sheet
    list comes straight from ``window.Data['Core levels']`` and the state is
    flushed to the .kfit file instead of .json. B.E. values in
    ``window.Data`` already include their corrections, so nothing is
    re-applied here.
    """
    import re

    console_frame = None
    if update_console is None:
        from libraries.FileMenu.ProcessingConsole import ProcessingConsole
        console_frame = ProcessingConsole(window, "Refreshing Sheets")

        def update_console(msg):
            console_frame.update(msg)

    current_sheet = window.sheet_combobox.GetValue()
    file_path = window.Data['FilePath']

    try:
        update_console("Saving current state to .kfit...")
        write_kfitting(window, file_path, update_console)

        if reopen_file:
            update_console("Re-opening file...")
            if console_frame:
                console_frame.close_now()
            open_kfitting_file(window, file_path)
            return

        sheet_names = list(window.Data.get('Core levels', {}).keys())
        window.Data['Number of Core levels'] = len(sheet_names)

        update_console("Updating interface...")
        window.sheet_combobox.Clear()
        window.sheet_combobox.AppendItems(sheet_names)
        if current_sheet not in sheet_names and sheet_names:
            current_sheet = sheet_names[0]
        if current_sheet:
            window.sheet_combobox.SetValue(current_sheet)

        # Update the BE-correction spinbox for the current sheet
        be_corrections = window.Data.get('BEcorrections', {}) or {}
        if current_sheet:
            match = re.search(r'(\d+)$', current_sheet)
            if match and match.group(1) in be_corrections:
                window.be_correction = be_corrections[match.group(1)]
            elif "0" in be_corrections:
                window.be_correction = be_corrections["0"]
            else:
                window.be_correction = 0
            window.be_correction_spinbox.SetValue(window.be_correction)

        # Initialize plot limits for new sheets
        for sheet_name in sheet_names:
            if hasattr(window, 'plot_config') and sheet_name not in window.plot_config.plot_limits:
                window.plot_config.update_plot_limits(window, sheet_name)

        update_console("Updating plots...")
        event = wx.CommandEvent(wx.EVT_COMBOBOX.typeId)
        event.SetString(current_sheet)
        on_sheet_selected_func(window, event)

        if hasattr(window, 'plot_config') and current_sheet:
            window.plot_config.update_plot_limits(window, current_sheet)

        if not (current_sheet == 'EDX~Map' or current_sheet.startswith('EDX~Plot')):
            window.plot_manager.plot_data(window)
            window.clear_and_replot()

        update_console(f"Sheets refreshed. Total sheets: {len(sheet_names)}")
        update_console("Refresh completed successfully!")
        if console_frame:
            console_frame.finish("Refresh complete!")

    except Exception as e:
        import traceback
        traceback.print_exc()
        update_console(f"Error refreshing sheets: {str(e)}")
        if console_frame:
            console_frame.finish(f"Error: {str(e)}", auto_close_ms=0)
        wx.MessageBox(f"Error refreshing sheets: {str(e)}", "Error", wx.OK | wx.ICON_ERROR)


def export_to_xlsx(window, all_sheets=False):
    """Export core level(s) of a .kfit project into ``<base>.xlsx``.

    The workbook lives next to the .kfit under the same name. It is
    created if missing; each exported sheet is replaced if it already exists
    and added otherwise. The .kfit stays the working project file; a sibling
    ``<base>.json`` holding the project state is written beside the .xlsx so
    the export is a complete, reopenable ``.xlsx + .json`` pair.
    """
    import openpyxl

    kf_path = window.Data.get('FilePath', '')
    if not kf_path:
        wx.MessageBox("No file is currently open.", "Export to Excel",
                      wx.OK | wx.ICON_ERROR)
        return
    xlsx_path = os.path.splitext(kf_path)[0] + '.xlsx'

    if all_sheets:
        sheets = [n for n, s in window.Data.get('Core levels', {}).items()
                  if isinstance(s, dict) and not s.get('_arpes')]
    else:
        sheets = [window.sheet_combobox.GetValue()]
    sheets = [s for s in sheets if s in window.Data.get('Core levels', {})]
    if not sheets:
        wx.MessageBox("No core level selected to export.", "Export to Excel",
                      wx.OK | wx.ICON_ERROR)
        return

    from libraries.FileMenu.ProcessingConsole import ProcessingConsole
    console_frame = ProcessingConsole(window, "Exporting to Excel",
                                      total=len(sheets) + 3)

    def update_console(msg):
        console_frame.update(msg)

    original_sheet = window.sheet_combobox.GetValue()
    original_fill_state = window.plot_manager.peak_fill_enabled
    # Point the save helpers at the .xlsx and disarm the .kfit routing
    # for the duration of the export.
    window._kfitting_export_xlsx = True
    window.Data['FilePath'] = xlsx_path
    try:
        from libraries.FileMenu.Save import (save_to_excel, save_plot_to_excel,
                                             save_results_table,
                                             convert_to_serializable_and_round)
        from libraries.Sheet_Operations import on_sheet_selected

        # Enable peak filling so the peak curves can be extracted from the
        # plot collections (same trick as the ordinary Excel save).
        if not original_fill_state:
            window.plot_manager.peak_fill_enabled = True

        for i, sheet_name in enumerate(sheets, 1):
            if console_frame.is_cancelled():
                update_console("Export cancelled by user.")
                break
            update_console(f"Sheet {i}/{len(sheets)}: {sheet_name}")
            # save_to_excel appends the fit to the sheet's existing data
            # columns — write the current spectrum there first (this also
            # creates the workbook / the sheet when missing)
            _rebuild_base_sheet(window, xlsx_path, sheet_name)
            window.sheet_combobox.SetValue(sheet_name)
            on_sheet_selected(window, sheet_name)
            fit_data = window.get_data_for_save()
            save_to_excel(window, fit_data, xlsx_path, sheet_name, update_console)
            save_plot_to_excel(window, update_console)

        update_console("Saving results table...")
        save_results_table(window)

        # Write a companion <base>.json next to the exported workbook so the
        # project state is saved alongside the .xlsx (a reopenable
        # .xlsx + .json pair, matching a native xlsx project).
        try:
            json_path = os.path.splitext(xlsx_path)[0] + '.json'
            json_data = convert_to_serializable_and_round(window.Data)
            with open(json_path, 'w', encoding='utf-8') as jf:
                json.dump(json_data, jf, indent=2)
        except Exception:
            import traceback
            traceback.print_exc()

        update_console(f"Exported to {os.path.basename(xlsx_path)}")
        console_frame.finish("Export to Excel complete!")

    except Exception as e:
        update_console(f"Error during export: {str(e)}")
        console_frame.finish(f"Error: {str(e)}", auto_close_ms=0)
        import traceback
        traceback.print_exc()
        wx.MessageBox(f"Error exporting to Excel: {str(e)}", "Error",
                      wx.OK | wx.ICON_ERROR)
    finally:
        window.Data['FilePath'] = kf_path
        window._kfitting_export_xlsx = False
        window.plot_manager.peak_fill_enabled = original_fill_state
        # Put the originally selected sheet back and replot with the
        # restored fill state
        if original_sheet and original_sheet in window.Data.get('Core levels', {}):
            try:
                from libraries.Sheet_Operations import on_sheet_selected
                window.sheet_combobox.SetValue(original_sheet)
                on_sheet_selected(window, original_sheet)
            except Exception:
                pass


def build_sheet_dataframe(window, sheet_name):
    """Return the workbook table of one core level of a .kfit project.

    A .kfit project keeps no .xlsx, so everything that used to read the
    sheet back with ``pd.read_excel`` (the TXT/CSV/DAT exports, the plot
    script) has nothing to read. This rebuilds the very same table in a
    throw-away workbook — the raw spectrum columns from
    ``_rebuild_base_sheet`` plus the fit columns ``save_to_excel`` appends
    to them — and hands it back as a DataFrame, so the exported columns are
    identical to those of an .xlsx project.
    """
    import shutil
    import tempfile

    import pandas as pd

    if sheet_name not in window.Data.get('Core levels', {}):
        raise ValueError(f"No data found for sheet '{sheet_name}'.")

    from libraries.FileMenu.Save import save_to_excel

    tmp_dir = tempfile.mkdtemp(prefix='khervefitting_export_')
    tmp_path = os.path.join(tmp_dir, 'sheet.xlsx')

    kf_path = window.Data.get('FilePath', '')
    plot_manager = getattr(window, 'plot_manager', None)
    original_fill_state = getattr(plot_manager, 'peak_fill_enabled', None)

    # Point the save helpers at the temporary workbook and disarm the .kfit
    # routing while it is written (same trick as export_to_xlsx).
    window._kfitting_export_xlsx = True
    window.Data['FilePath'] = tmp_path
    try:
        _rebuild_base_sheet(window, tmp_path, sheet_name)
        # The individual peak curves are read back off the plot's filled
        # collections, so the fill has to be on while they are gathered.
        if original_fill_state is False:
            plot_manager.peak_fill_enabled = True
            window.clear_and_replot()
        fit_data = window.get_data_for_save()
        save_to_excel(window, fit_data, tmp_path, sheet_name)
        return pd.read_excel(tmp_path, sheet_name=str(sheet_name)[:31])
    finally:
        window.Data['FilePath'] = kf_path
        window._kfitting_export_xlsx = False
        if original_fill_state is False and plot_manager is not None:
            plot_manager.peak_fill_enabled = False
            window.clear_and_replot()
        shutil.rmtree(tmp_dir, ignore_errors=True)


def save_core_level_to_excel_action(window):
    """Menu action 'Export/Save this Core Level to Excel'.

    On a .kfit project this exports the selected core level into the
    sibling ``<base>.xlsx``; otherwise it runs the classic save (and never
    reroutes to .kfit, even if that format is preferred — the user
    explicitly asked for Excel).
    """
    if is_kfitting_path(window.Data.get('FilePath', '')):
        export_to_xlsx(window, all_sheets=False)
        return
    window._kfitting_export_xlsx = True
    try:
        from Functions import on_save
        on_save(window)
    finally:
        window._kfitting_export_xlsx = False


def save_all_core_levels_to_excel_action(window):
    """Menu action 'Export/Save all Core Levels to Excel' (same rules)."""
    if is_kfitting_path(window.Data.get('FilePath', '')):
        export_to_xlsx(window, all_sheets=True)
        return
    window._kfitting_export_xlsx = True
    try:
        from libraries.FileMenu.Save import save_all_sheets_with_plots
        save_all_sheets_with_plots(window)
    finally:
        window._kfitting_export_xlsx = False


def _write_sem_columns(ws, cl):
    """Write a SEM sheet as Property/Value rows, then the per-particle table.

    Excel has no place for the pixel data, so the worksheet carries what a
    reader actually needs to interpret the companion image: the calibration,
    the acquisition metadata, and the measured particle statistics.
    """
    ws.cell(row=1, column=1, value='Property')
    ws.cell(row=1, column=2, value='Value')
    row = 2

    def put(key, value):
        nonlocal row
        ws.cell(row=row, column=1, value=str(key))
        ws.cell(row=row, column=2, value=value)
        row += 1

    put('Source File', cl.get('SEM_Source_File', ''))
    put('Pixel Size (nm)', cl.get('SEM_NM_Per_Px'))
    put('Scale Source', cl.get('SEM_Scale_Source', ''))
    crop = cl.get('SEM_Crop')
    put('Crop (x0,y0,x1,y1)', ','.join(str(int(v)) for v in crop) if crop else 'none')
    for key, value in (cl.get('ExperimentalInfo') or {}).items():
        put(key, value)

    stats = cl.get('SEM_Particles') or {}
    if stats:
        row += 1
        for key in ('Count', 'Density (per um2)', 'Areal Coverage (%)',
                    'ECD Mean (nm)', 'ECD Median (nm)', 'ECD Std (nm)',
                    'ECD Min (nm)', 'ECD Max (nm)',
                    'D10 (nm)', 'D50 (nm)', 'D90 (nm)'):
            if key in stats:
                put(key, stats[key])

        diameters = stats.get('Diameters (nm)') or []
        if diameters:
            row += 1
            ws.cell(row=row, column=1, value='Particle')
            ws.cell(row=row, column=2, value='ECD (nm)')
            ws.cell(row=row, column=3, value='Area (nm2)')
            areas = stats.get('Areas (nm2)') or []
            for i, diameter in enumerate(diameters):
                ws.cell(row=row + 1 + i, column=1, value=i + 1)
                ws.cell(row=row + 1 + i, column=2, value=diameter)
                if i < len(areas):
                    ws.cell(row=row + 1 + i, column=3, value=areas[i])


def _write_tem_columns(ws, cl):
    """Write a TEM image/FFT sheet as Property/Value rows plus measurements.

    Excel has no place for the pixel data, so the worksheet carries the
    calibration, the acquisition metadata, the particle statistics and the
    measured d-spacings — everything a reader needs to interpret the image
    living in the companion/embedded HDF5.
    """
    ws.cell(row=1, column=1, value='Property')
    ws.cell(row=1, column=2, value='Value')
    row = 2

    def put(key, value):
        nonlocal row
        ws.cell(row=row, column=1, value=str(key))
        ws.cell(row=row, column=2, value=value)
        row += 1

    put('Source File', cl.get('TEM_Source_File', ''))
    put('Kind', cl.get('_tem_kind', 'map'))
    put('Pixel Size (nm)', cl.get('TEM_NM_Per_Px'))
    if cl.get('TEM_RecipPerPx'):
        put('Reciprocal Scale (1/nm per px)', cl.get('TEM_RecipPerPx'))
    put('Scale Source', cl.get('TEM_Scale_Source', ''))
    for key, value in (cl.get('ExperimentalInfo') or {}).items():
        put(key, value)

    stats = cl.get('TEM_Particles') or {}
    if stats:
        row += 1
        for key in ('Count', 'Density (per um2)', 'Areal Coverage (%)',
                    'ECD Mean (nm)', 'ECD Median (nm)', 'ECD Std (nm)',
                    'ECD Min (nm)', 'ECD Max (nm)',
                    'D10 (nm)', 'D50 (nm)', 'D90 (nm)'):
            if key in stats:
                put(key, stats[key])
        diameters = stats.get('Diameters (nm)') or []
        if diameters:
            row += 1
            ws.cell(row=row, column=1, value='Particle')
            ws.cell(row=row, column=2, value='ECD (nm)')
            ws.cell(row=row, column=3, value='Area (nm2)')
            areas = stats.get('Areas (nm2)') or []
            for i, diameter in enumerate(diameters):
                ws.cell(row=row + 1 + i, column=1, value=i + 1)
                ws.cell(row=row + 1 + i, column=2, value=diameter)
                if i < len(areas):
                    ws.cell(row=row + 1 + i, column=3, value=areas[i])
            row += 1 + len(diameters)

    spots = [s for s in (cl.get('TEM_FFT_Spots') or []) if s.get('d_nm')]
    if spots:
        row += 1
        ws.cell(row=row, column=1, value='d (nm)')
        ws.cell(row=row, column=2, value='g (1/nm)')
        ws.cell(row=row, column=3, value='Angle (deg)')
        ws.cell(row=row, column=4, value='hkl')
        for i, spot in enumerate(spots):
            ws.cell(row=row + 1 + i, column=1, value=spot.get('d_nm'))
            ws.cell(row=row + 1 + i, column=2, value=spot.get('g'))
            ws.cell(row=row + 1 + i, column=3, value=spot.get('angle'))
            ws.cell(row=row + 1 + i, column=4, value=spot.get('hkl', ''))
        row += 1 + len(spots)

    structure = cl.get('TEM_FFT_Structure') or {}
    if structure:
        row += 1
        put('Structure', structure.get('structure'))
        put('Lattice Parameter a (nm)', structure.get('a_nm'))


def _write_afm_columns(ws, cl):
    """Write an AFM channel map as Property/Value rows plus measurements.

    Excel has no place for the pixel data, so the worksheet carries the
    channel identity, the calibration, the leveling recipe and the roughness
    numbers — everything a reader needs to interpret the map living in the
    companion/embedded HDF5.
    """
    ws.cell(row=1, column=1, value='Property')
    ws.cell(row=1, column=2, value='Value')
    row = 2

    def put(key, value):
        nonlocal row
        ws.cell(row=row, column=1, value=str(key))
        ws.cell(row=row, column=2, value=value)
        row += 1

    put('Source File', cl.get('AFM_Source_File', ''))
    put('Channel', cl.get('AFM_Channel', ''))
    put('Units', cl.get('AFM_Units', ''))
    put('Mode', cl.get('AFM_Mode', ''))
    put('Pixel Size (nm)', cl.get('AFM_NM_Per_Px'))
    put('Scale Source', cl.get('AFM_Scale_Source', ''))
    level = cl.get('AFM_Level') or {}
    # Only the steps that actually ran: the degree, trim fraction and
    # direction belong to a row method and mean nothing without one.
    parts = []
    if level.get('plane', 'none') != 'none':
        parts.append(f"background={level['plane']}")
    if level.get('lines', 'none') != 'none':
        parts.append(f"rows={level['lines']}")
        parts.append(f"direction={level.get('direction', 'horizontal')}")
        if level['lines'] in ('poly', 'poly1', 'poly2', 'poly3'):
            parts.append(f"degree={level.get('degree', 3)}")
        if level['lines'] in ('trimmed', 'trimmed_diff'):
            parts.append(f"trim={level.get('trim', 5.0)}%")
    if level.get('scars'):
        parts.append('scars removed')
    if level.get('zero', 'none') != 'none':
        parts.append(f"zero={level['zero']}")
    if parts:
        put('Leveling', ', '.join(parts))
    view = cl.get('AFM_3D') or {}
    if view:
        put('3D Surface Of', view.get('source', ''))
        put('3D View (elev/azim)',
            f"{float(view.get('elev', 45)):.1f} / {float(view.get('azim', -60)):.1f}")
        put('3D Height Exaggeration', float(view.get('zscale', 1.0)))
    for key, value in (cl.get('ExperimentalInfo') or {}).items():
        put(key, value)

    stats = cl.get('AFM_Roughness') or {}
    if stats:
        row += 1
        unit = cl.get('AFM_Units', '')
        # Heights carry the channel's unit; the hybrid quantities are areas
        # and volumes of it, and the rest are dimensionless.
        area = f'{unit}²' if unit else ''
        units = {'Sdr': '%', 'projected_area': area, 'surface_area': area,
                 'variation': area, 'volume': f'{unit}³' if unit else '',
                 'theta': 'deg', 'phi': 'deg'}
        for key in ('Sa', 'Sq', 'Ssk', 'Sku', 'Sku_excess', 'Sp', 'Sv', 'Sz',
                    'Sdr', 'mean', 'median', 'min', 'max', 'projected_area',
                    'surface_area', 'volume', 'Sdq', 'variation', 'theta',
                    'phi', 'discrepancy'):
            if key not in stats:
                continue
            dimensionless = key in ('Ssk', 'Sku', 'Sku_excess', 'Sdq',
                                    'discrepancy')
            suffix = units.get(key, '' if dimensionless else unit)
            put(f'{key} ({suffix})' if suffix else key, stats[key])

    cd = cl.get('AFM_Profile_CD')
    if isinstance(cd, dict) and cd.get('kind'):
        from libraries.ToolsMenu.AFM_Engine import CD_LABELS
        row += 1
        unit = cl.get('AFM_Units', '')
        put('Feature', CD_LABELS.get(cd['kind'], cd['kind']))
        put(f'Feature h ({unit})' if unit else 'Feature h', cd.get('h'))
        put('Feature h error', cd.get('h_err'))
        put('Feature y1', cd.get('y1'))
        put('Feature y2', cd.get('y2'))
        put('Feature x1', cd.get('x1'))
        if cd.get('x2') is not None:
            put('Feature x2', cd.get('x2'))
            put('Feature width', cd.get('width'))


def _base_column_headers(title, cl):
    """(x header, y header) for a sheet's first two workbook columns.

    Taken from the same table that titles the plot axes, so the workbook and
    the plot agree. ``Open.open_xlsx_file`` accepts these headers by
    recognising the technique from the sheet name, so a project exported with
    them reopens.
    """
    from libraries.Plot_Operations import (axis_labels_for_sheet,
                                           is_xps_like_sheet, plain_axis_label)

    if title.startswith('SEM~'):
        from libraries.ToolsMenu.SEM_Sheets import sem_plot_labels
        return tuple(plain_axis_label(v) for v in sem_plot_labels(cl, title))
    if title.startswith('TEM~'):
        from libraries.ToolsMenu.TEM_Plot import tem_plot_labels
        return tuple(plain_axis_label(v) for v in tem_plot_labels(cl, title))

    class _Shim:
        """axis_labels_for_sheet only ever reads the one sheet's dict."""
        Data = {'Core levels': {title: cl}}
        energy_scale = 'BE'

    if is_xps_like_sheet(_Shim, title):
        return 'Binding Energy', 'Raw Data'
    x_label, y_label = axis_labels_for_sheet(_Shim, title)
    return plain_axis_label(x_label), plain_axis_label(y_label)


def _write_base_columns(ws, title, cl):
    """Fill a worksheet with the raw spectrum (or profile table) of one core
    level — the data base that ``save_to_excel`` keeps in columns A-E and
    builds the fit columns upon."""
    # SEM sheets hold an image, not a spectrum. Write their calibration and
    # particle statistics as a key/value sheet so the workbook still documents
    # the measurement (the pixels themselves live in the companion .hdf5).
    if cl.get('_sem'):
        _write_sem_columns(ws, cl)
        return
    # TEM image/FFT sheets: same treatment.
    if cl.get('_tem'):
        _write_tem_columns(ws, cl)
        return
    # AFM channel maps: same treatment.
    if cl.get('_afm'):
        _write_afm_columns(ws, cl)
        return

    if 'Profile Data' in cl and isinstance(cl['Profile Data'], dict):
        for c, (col_name, values) in enumerate(cl['Profile Data'].items(), start=1):
            ws.cell(row=1, column=c, value=str(col_name))
            for r, v in enumerate(values, start=2):
                ws.cell(row=r, column=c, value=v)
        return

    # Map sheets (XPS~Map / ARPES~Map): raw matrix of B.E. + Y1..Yn sweeps.
    n_sweeps = cl.get('_num_sweeps') or sum(
        1 for k in cl if k.startswith('Y') and k[1:].isdigit())
    if '~Map' in title or n_sweeps:
        ws.cell(row=1, column=1, value='BE')
        for j in range(int(n_sweeps)):
            ws.cell(row=1, column=j + 2, value=f'Y{j + 1}')
        be = cl.get('B.E.', []) or []
        for r, x in enumerate(be, start=2):
            ws.cell(row=r, column=1, value=x)
            for j in range(int(n_sweeps)):
                col = cl.get(f'Y{j + 1}')
                if col and (r - 2) < len(col):
                    ws.cell(row=r, column=j + 2, value=col[r - 2])
        return

    # Column A/B headers come from the same table the plot titles its axes
    # with, so the workbook says "Temperature (°C)" or "2θ (°)" wherever the
    # plot does. The hand-written chain this replaced knew only six prefixes
    # and labelled every other technique — TGA, XRD, EIS, SQUID, DIL, BET,
    # UV-Vis, PL, ellipsometry — "Binding Energy".
    headers = _base_column_headers(title, cl)

    ws.cell(row=1, column=1, value=headers[0])
    ws.cell(row=1, column=2, value=headers[1])
    be = cl.get('B.E.', []) or []
    raw = cl.get('Raw Data', []) or []
    for r, (x, y) in enumerate(zip(be, raw), start=2):
        ws.cell(row=r, column=1, value=x)
        ws.cell(row=r, column=2, value=y)


def _rebuild_base_sheet(window, xlsx_path, sheet_name):
    """(Re)write the raw-data sheet that ``save_to_excel`` builds upon.

    ``save_to_excel`` reads the existing sheet, keeps its first columns as
    the data base and appends the fit columns after them — so before
    exporting a core level from a .kfit project the sheet must hold the
    current spectrum. Creates the workbook on first use; an existing sheet
    is rebuilt in place at the same position.
    """
    import openpyxl

    cl = window.Data['Core levels'][sheet_name]
    title = str(sheet_name)[:31]

    if not os.path.exists(xlsx_path):
        wb = openpyxl.Workbook()
        wb.remove(wb.active)
    else:
        wb = openpyxl.load_workbook(xlsx_path)

    index = None
    if title in wb.sheetnames:
        index = wb.sheetnames.index(title)
        wb.remove(wb[title])
    ws = wb.create_sheet(title) if index is None else wb.create_sheet(title, index)
    _write_base_columns(ws, title, cl)
    wb.save(xlsx_path)
    wb.close()


def write_project_xlsx(window, xlsx_path):
    """Write a minimal .xlsx for the project (Save As .kfit -> .xlsx).

    Each core level becomes a sheet with the raw spectrum in the first two
    columns under headers that ``open_xlsx_file`` recognises. The sibling
    .json carries the full fitting state, so nothing is lost; the fitted
    columns can be re-created with the normal Excel save actions.
    """
    from openpyxl import Workbook

    wb = Workbook()
    wb.remove(wb.active)

    for sheet_name, cl in window.Data.get('Core levels', {}).items():
        if not isinstance(cl, dict) or cl.get('_arpes'):
            continue
        title = str(sheet_name)[:31]
        ws = wb.create_sheet(title)
        _write_base_columns(ws, title, cl)

    if not wb.sheetnames:
        raise ValueError("No core levels available to write to Excel.")
    wb.save(xlsx_path)
