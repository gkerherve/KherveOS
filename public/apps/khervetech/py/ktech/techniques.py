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

Adding a technique: add an entry, export its modules (TECHNIQUES in
tools/export_khervetech.py), and add the app (CLAUDE.md, "Technique apps").
"""

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
}
