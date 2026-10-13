"""The techniques that are KherveOS apps, as the desktop wires them up.

Everything here points at the desktop's own functions (exported unchanged to
py/desktop by tools/export_khervetech.py):

``imports``   the File > Import > <technique> submenu of
              Widgets_Toolbars.create_menu: (label, "module:function"), or '-'.
``open_paths`` how a file chosen elsewhere (Files, an example, an AI tool)
              is imported: the function behind the menu entry, given paths.
``tool``      the analysis window: full window and one section
              (TechniqueToolbar._technique_sections / TechniqueTool).
``extras``    what PlotManager.clear_and_replot draws after the data for
              this technique.
``windows``   the attribute lists the tool windows register in on the parent.
``packages``  the Pyodide packages its file operations need (loaded on demand).

``open_paths`` entries are (extensions, "module:function", how): ``how`` is
the name of the combined project (fn(window, paths, project)), None
(fn(window, paths)), or 'dialog': the File > Import function itself, its
wx.FileDialog answered with the paths (the desktop has no path entry point).

Adding a technique: add an entry, export its modules (TECHNIQUES in
tools/export_khervetech.py), and add the app (CLAUDE.md, "Technique apps").
"""

def ftir_sheet_note(sheet):
    """What an FTIR sheet is, for the sidebar: a reference spectrum (by its title) or a measurement (by its ordinate)."""
    ref = sheet.get('FTIR_Reference')
    if ref:
        return 'Reference: ' + str(ref).split(' [')[0]
    unit = sheet.get('FTIR_Y_Unit') or ''
    return f'Measured, {unit}' if unit else 'Measured'


TECHS = {
    'TGA': {
        'key': 'tga',
        'prefix': 'TGA',
        'menu_label': 'TGA',
        'tools_label': 'TGA / DSC',
        'modules': ['libraries.FileMenu.TGA_Import', 'libraries.FileMenu.TRI_Import',
                    'libraries.ToolsMenu.TGA_Analysis'],
        'imports': [
            ('File(s) (.csv/.txt/.dat)', 'libraries.FileMenu.TGA_Import:import_tga_file'),
            ('Multiple files (folder)', 'libraries.FileMenu.TGA_Import:import_multiple_tga_files'),
            '-',
            ('TA TRIOS DSC file(s) (.tri)', 'libraries.FileMenu.TRI_Import:import_tri_file'),
            ('Multiple .tri files (folder)', 'libraries.FileMenu.TRI_Import:import_multiple_tri_files'),
        ],
        'open_paths': [
            (('.tri',), 'libraries.FileMenu.TRI_Import:_import_tri_paths', 'DSC_Data.kfit'),
            (('.csv', '.txt', '.dat'), 'libraries.FileMenu.TGA_Import:_import_tga_paths', 'TGA_Data.kfit'),
        ],
        'project_path': 'libraries.FileMenu.TGA_Import:_project_path_for',
        'tool': ('libraries.ToolsMenu.TGA_Analysis:open_tga_window',
                 'libraries.ToolsMenu.TGA_Analysis:open_tga_section'),
        'window_attr': 'tga_analysis_window',
        'windows': '_tga_windows',
        'extras': ['libraries.ToolsMenu.TGA_Plot:draw_tga_extras'],
        'exts': ['.csv', '.txt', '.dat', '.tri'],
    },
    'BET': {
        'key': 'bet',
        'prefix': 'BET',
        'menu_label': 'BET',
        'tools_label': 'BET / Physisorption',
        'modules': ['libraries.FileMenu.BET_Import', 'libraries.ToolsMenu.BET_Analysis'],
        'imports': [
            ('Isotherm file(s) (.csv/.txt/.dat)', 'libraries.FileMenu.BET_Import:import_bet_file'),
            ('Multiple files (folder)', 'libraries.FileMenu.BET_Import:import_multiple_bet_files'),
        ],
        # _import_bet_paths(window, paths) works out the project path itself
        'open_paths': [
            (('.csv', '.txt', '.dat'), 'libraries.FileMenu.BET_Import:_import_bet_paths', None),
        ],
        'tool': ('libraries.ToolsMenu.BET_Analysis:open_bet_window',
                 'libraries.ToolsMenu.BET_Analysis:open_bet_section'),
        'window_attr': 'bet_analysis_window',
        'windows': '_bet_windows',
        'extras': [],
        'exts': ['.csv', '.txt', '.dat'],
    },
    'DIL': {
        'key': 'dil',
        'prefix': 'DIL',
        'menu_label': 'Dilatometry',
        'tools_label': 'Dilatometry',
        'modules': ['libraries.FileMenu.DIL_Import', 'libraries.ToolsMenu.DIL_Analysis'],
        'imports': [
            ('File(s) (.csv/.txt/.dat)', 'libraries.FileMenu.DIL_Import:import_dil_file'),
            ('Multiple files (folder)', 'libraries.FileMenu.DIL_Import:import_multiple_dil_files'),
        ],
        'open_paths': [
            (('.csv', '.txt', '.dat'), 'libraries.FileMenu.DIL_Import:_import_dil_paths', 'DIL_Data.kfit'),
        ],
        'project_path': 'libraries.FileMenu.DIL_Import:_project_path_for',
        'tool': ('libraries.ToolsMenu.DIL_Analysis:open_dil_window',
                 'libraries.ToolsMenu.DIL_Analysis:open_dil_section'),
        'window_attr': 'dil_analysis_window',
        'windows': '_dil_windows',
        'extras': [],
        'exts': ['.csv', '.txt', '.dat'],
    },
    'UVVIS': {
        'key': 'uvvis',
        'prefix': 'UVVIS',
        'menu_label': 'UV-Vis',
        'tools_label': 'UV-Vis',
        'modules': ['libraries.FileMenu.Optical_Import', 'libraries.ToolsMenu.UVVIS_Analysis',
                    'libraries.ToolsMenu.UVVIS_Plot'],
        'imports': [
            ('File(s) (.csv/.txt) - Cary / Shimadzu / generic', 'libraries.FileMenu.Optical_Import:import_uvvis_file'),
        ],
        'open_paths': [
            (('.csv', '.txt', '.dat', '.asc'), 'libraries.FileMenu.Optical_Import:import_uvvis_file', 'dialog'),
        ],
        'tool': ('libraries.ToolsMenu.UVVIS_Analysis:open_uvvis_window',
                 'libraries.ToolsMenu.UVVIS_Analysis:open_uvvis_section'),
        'window_attr': 'uvvis_analysis_window',
        'windows': '_uvvis_windows',
        'extras': ['libraries.ToolsMenu.UVVIS_Plot:draw_uvvis_extras'],
        'exts': ['.csv', '.txt', '.dat', '.asc'],
    },
    'FTIR': {
        'key': 'ftir',
        'prefix': 'FTIR',
        'menu_label': 'FTIR',
        'tools_label': 'FTIR',
        'modules': ['libraries.FileMenu.FTIR_Import', 'libraries.FileMenu.JCAMP_Import',
                    'libraries.FileMenu.NicoletLibrary_Import', 'libraries.ToolsMenu.FTIR_Analysis'],
        'imports': [
            ('File(s) (.txt) - Agilent Cary 630 / generic', 'libraries.FileMenu.FTIR_Import:import_ftir_file'),
            ('Multiple files (folder)', 'libraries.FileMenu.FTIR_Import:import_multiple_ftir_files'),
            ('CSV file(s) (.csv)', 'libraries.FileMenu.FTIR_Import:import_ftir_csv_file'),
            ('Multiple CSV files (folder)', 'libraries.FileMenu.FTIR_Import:import_multiple_ftir_csv_files'),
            ('JCAMP-DX file(s) (.jdx/.dx)', 'libraries.FileMenu.JCAMP_Import:import_jcamp_file'),
            ('Nicolet/OMNIC library (.lbd/.lbt/.lbp)', 'libraries.FileMenu.NicoletLibrary_Import:import_nicolet_library'),
        ],
        'open_paths': [
            (('.jdx', '.dx'), 'libraries.FileMenu.JCAMP_Import:import_jcamp_file', 'dialog'),
            (('.csv',), 'libraries.FileMenu.FTIR_Import:import_ftir_csv_file', 'dialog'),
            (('.txt', '.dat'), 'libraries.FileMenu.FTIR_Import:import_ftir_file', 'dialog'),
            (('.lbd', '.lbt', '.lbp'), 'libraries.FileMenu.NicoletLibrary_Import:import_nicolet_library', 'dialog'),
        ],
        'tool': ('libraries.ToolsMenu.FTIR_Analysis:open_ftir_window',
                 'libraries.ToolsMenu.FTIR_Analysis:open_ftir_section'),
        'project_format': 'kfitting',
        'sheet_note': ftir_sheet_note,
        'window_attr': 'ftir_analysis_window',
        'windows': '_ftir_windows',
        'extras': [],
        'exts': ['.jdx', '.dx', '.csv', '.txt', '.dat', '.lbd'],
        'packages': ['pandas'],
    },
    'AFM': {
        'key': 'afm',
        'prefix': 'AFM',
        'menu_label': 'AFM',
        'tools_label': 'AFM Analysis',
        'modules': ['libraries.FileMenu.AFM_Import', 'libraries.ToolsMenu.AFM_Plot',
                    'libraries.ToolsMenu.AFM_Analysis'],
        'imports': [
            ('AFM / SPM file(s) (.ibw/.spm/.ardf/.gwy/.gsf)', 'libraries.FileMenu.AFM_Import:import_afm_file'),
        ],
        'open_paths': [
            (('.ibw', '.spm', '.ardf', '.gwy', '.gsf', '.emd', '.001', '.002', '.003'), 'ktech.openers:afm_open', None),
        ],
        'tool': ('libraries.ToolsMenu.AFM_Analysis:open_afm_window',
                 'libraries.ToolsMenu.AFM_Analysis:open_afm_section'),
        'window_attr': 'afm_analysis_window',
        'windows': '_afm_windows',
        'image_plot': 'libraries.ToolsMenu.AFM_Plot:plot_afm_image',
        'extras': [],
        'exts': ['.ibw', '.spm', '.ardf', '.gwy', '.gsf', '.emd'],
        'project_format': 'kfitting',
        'packages': ['scikit-image'],
    },
    'TEM': {
        'key': 'tem',
        'prefix': 'TEM',
        'menu_label': 'TEM',
        'tools_label': 'TEM Analysis',
        'modules': ['libraries.FileMenu.TEM_Import', 'libraries.ToolsMenu.TEM_Plot',
                    'libraries.ToolsMenu.TEM_Analysis'],
        'imports': [
            ('TEM image (.dm3/.dm4/.dm5/.tif/.png)', 'libraries.FileMenu.TEM_Import:import_tem_image'),
        ],
        'open_paths': [
            (('.dm3', '.dm4', '.dm5', '.tif', '.tiff', '.png'), 'ktech.openers:tem_open', None),
        ],
        'tool': ('libraries.ToolsMenu.TEM_Analysis:open_tem_window',
                 'libraries.ToolsMenu.TEM_Analysis:open_tem_section'),
        'window_attr': 'tem_analysis_window',
        'windows': '_tem_windows',
        'image_plot': 'libraries.ToolsMenu.TEM_Plot:plot_tem_image',
        'extras': [],
        'exts': ['.dm3', '.dm4', '.dm5', '.tif', '.tiff', '.png'],
        'project_format': 'kfitting',
        'packages': ['scikit-image', 'pillow'],
    },
    'EDX': {
        'key': 'edx',
        'prefix': 'EDX',
        'menu_label': 'EDX',
        'tools_label': 'EDX HeatMap',
        'modules': ['libraries.ToolsMenu.EDX_SEM_Analysis'],
        'imports': [
            ('Map (.hdf5/.h5/.bcf/.emd)', 'ktech.openers:edx_import_dialog'),
        ],
        'open_paths': [
            (('.hdf5', '.h5', '.bcf', '.emd'), 'ktech.openers:edx_open', None),
        ],
        'tool': ('ktech.openers:edx_window', 'ktech.openers:edx_window_section'),
        'window_attr': 'edx_window',
        'windows': '_edx_windows',
        # the spectrum sheets are drawn by the desktop's PlotManager.plot_edx_data (styled, peak-labelled)
        'sheet_plot': ('EDX~', 'libraries.Plot_Operations:plot_edx_data'),
        'extras': [],
        'exts': ['.hdf5', '.h5', '.bcf', '.emd'],
        'project_format': 'kfitting',
    },
    'RAMAN': {
        'key': 'raman',
        'prefix': 'RAMAN',
        'menu_label': 'Raman',
        'tools_label': 'Raman',
        'modules': ['libraries.FileMenu.Kal_Import', 'libraries.ToolsMenu.Raman_Analysis'],
        'imports': [
            ('File (.txt)', 'libraries.FileMenu.Open:import_raman_txt_file'),
            ('Multiple files (folder)', 'libraries.FileMenu.Open:import_multiple_raman_files'),
        ],
        'open_paths': [
            (('.txt',), 'libraries.FileMenu.Open:import_raman_txt_file', 'dialog'),
        ],
        'tool': ('libraries.ToolsMenu.Raman_Analysis:open_raman_window',
                 'libraries.ToolsMenu.Raman_Analysis:open_raman_section'),
        'project_format': 'kfitting',
        'raw_as_line': True,
        'window_attr': 'raman_analysis_window',
        'windows': '_raman_windows',
        'extras': [],
        'exts': ['.txt'],
        'packages': ['pandas'],
    },
}

#: every tool-window list a technique registers in (MainFrame.refresh_tools)
WINDOW_LISTS = tuple(t['windows'] for t in TECHS.values())
