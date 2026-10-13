"""How a file chosen outside the technique's own menus (Files, an example, an AI tool) is imported, for the
techniques whose desktop import takes one path rather than the list the generic entry points are given."""


def afm_open(window, paths):
    """File > Import > AFM, with the file chosen: ``import_afm_file(window, file_path)`` skips its dialog."""
    from libraries.FileMenu.AFM_Import import import_afm_file
    return import_afm_file(window, paths[0])


def tem_open(window, paths):
    """File > Import > TEM image, with the file chosen."""
    from libraries.FileMenu.TEM_Import import import_tem_image
    return import_tem_image(window, paths[0])


def edx_window(window):
    """Tools > EDX HeatMap: the desktop's EDX / SEM window (its own map canvas, toolbars and tools).

    The main plot's peak labelling builds a throw-away EDXSEMWindow and destroys it (PlotManager.plot_edx_data), and
    every EDXSEMWindow points ``parent.edx_window`` at itself: so the real window is kept in ``_edx_main`` and put
    back as ``edx_window`` whenever it is asked for."""
    from libraries.ToolsMenu.EDX_SEM_Analysis import EDXSEMWindow
    main = getattr(window, '_edx_main', None)
    if main is not None and not getattr(main, '_dead', False):
        window.edx_window = main
        return main
    win = EDXSEMWindow(window)
    window._edx_main = window.edx_window = win
    win.Show()
    return win


def edx_window_section(window, key=None):
    return edx_window(window)


def edx_open(window, paths):
    """File > Import > EDX > Map, with the file chosen (Widgets_Toolbars.import_edx_map_file's steps): the EDX window
    loads the map (BCF / EMD / HDF5 readers), the project gets the sum spectrum as EDX~Plot and the map as EDX~Map,
    and a copy of the raw file sits next to the project, from which the map is reloaded."""
    import os
    import shutil
    import numpy as np
    from ktech import bridge
    path = paths[0]
    bridge.op_new({})                                   # a fresh project; the old tool windows close
    win = edx_window(window)
    win.load_file(path, 'EDX Map')
    signal = getattr(win, 'current_data', None)
    data = getattr(signal, 'data', None)
    if data is None:
        return win
    energy = win.get_energy_axis()
    data = np.asarray(data)
    spectrum = data.sum(axis=(0, 1)) if data.ndim == 3 else data.reshape(-1)
    energy = np.asarray(energy if energy is not None else np.arange(len(spectrum)), dtype=float)
    if energy.max() > 100:                              # eV, not keV
        energy = energy / 100.0
    levels = window.Data.setdefault('Core levels', {})
    levels['EDX~Plot'] = {'Name': 'EDX~Plot', 'B.E.': [float(v) for v in energy], 'Raw Data': [float(v) for v in spectrum],
                          '_EDX_display_max': 20, '_EDX_type': 'plot', 'Background': {}}
    if data.ndim == 3:
        shown = data.sum(axis=2)
        e0, e1 = float(np.min(energy)), float(np.max(energy))
        levels['EDX~Map'] = {'Name': 'EDX~Map', 'Map_Intensity': shown.tolist(), 'Map_Shape': list(shown.shape),
                             'Energy_Range': f'{e0:.2f} - {e1:.2f} keV', '_EDX_type': 'map'}
    window.Data['Number of Core levels'] = len(levels)
    folder = os.path.dirname(path)
    stem = os.path.splitext(os.path.basename(path))[0]
    ext = os.path.splitext(path)[1].lower()
    copy = os.path.join(folder, f'{stem}_EDX{ext}')
    if os.path.abspath(copy) != os.path.abspath(path) and not os.path.exists(copy):
        shutil.copy2(path, copy)
    from libraries.FileMenu.KFitting_IO import create_new_project_file
    create_new_project_file(window, suggested_name=f'{stem}_EDX', default_dir=folder, ask=False)
    window.sync_sheet_list('EDX~Plot')
    window.select_sheet('EDX~Plot', from_user=False)
    return win


def edx_import_dialog(window):
    """The dialog entry: the file the wx.FileDialog is answered with."""
    import wx
    with wx.FileDialog(window, 'Open EDX Map file', wildcard='EDX files (*.hdf5;*.h5;*.bcf;*.emd)|*.hdf5;*.h5;*.bcf;*.emd',
                       style=wx.FD_OPEN | wx.FD_FILE_MUST_EXIST) as dlg:
        if dlg.ShowModal() != wx.ID_OK:
            return None
        return edx_open(window, [dlg.GetPath()])
