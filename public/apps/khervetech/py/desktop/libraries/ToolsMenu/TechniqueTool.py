# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/TechniqueTool.py. Regenerate with tools/export_khervetech.py.
"""The toolbar button that follows the technique of the selected sheet.

KherveFitting now carries a tool per technique - FTIR, Raman, TGA/DSC, SQUID,
EIS, SEM, EELS, EDX, XRD, ARPES, UV-Vis, PL, ellipsometry - and each one only
ever applies to its own sheets.  Rather than a dozen permanent buttons of
which all but one are always wrong, the toolbar carries one button that
becomes whichever tool the current sheet needs: it shows that technique's
icon and opens its window.  On an XPS sheet there is no such tool, so it
greys out.

Which technique a sheet belongs to is read off its name - the same prefix
convention the plotting and axis code uses - except for SEM images, which are
flagged rather than named.
"""

import os

import wx

_ICON_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'Icons')

NO_TECHNIQUE_ICON = 'Tech-None-3.png'
NO_TECHNIQUE_HELP = ("TECHNIQUE TOOL (NONE FOR THIS SHEET)\n"
                     "\n"
                     "This button changes with the selected sheet: it\n"
                     "opens the analysis tool of that sheet's technique.\n"
                     "The current sheet (e.g. an XPS core level) has no\n"
                     "such tool, so it is greyed out.\n"
                     "\n"
                     "Select a sheet of another technique (FTIR, Raman,\n"
                     "TGA, SQUID, EIS, SEM, TEM, AFM, EELS, EDX, XRD,\n"
                     "ARPES, UV-Vis, PL, ellipsometry, MS, GC,\n"
                     "dilatometry or BET) and it becomes that tool.")


def _open_ftir(window):
    from libraries.Widgets_Toolbars import open_ftir_analysis_window
    open_ftir_analysis_window(window)


def _open_tga(window):
    from libraries.Widgets_Toolbars import open_tga_analysis_window
    open_tga_analysis_window(window)


def _open_squid(window):
    from libraries.Widgets_Toolbars import open_squid_analysis_window
    open_squid_analysis_window(window)


def _open_eis(window):
    from libraries.Widgets_Toolbars import open_eis_analysis_window
    open_eis_analysis_window(window)


def _open_sem(window):
    from libraries.Widgets_Toolbars import open_sem_analysis_window
    open_sem_analysis_window(window)


def _open_tem(window):
    from libraries.Widgets_Toolbars import open_tem_analysis_window
    open_tem_analysis_window(window)


def _open_eels(window):
    from libraries.Widgets_Toolbars import on_open_eels_window
    on_open_eels_window(window, None)


def _open_edx(window):
    from libraries.Widgets_Toolbars import on_open_edx_sem
    on_open_edx_sem(window)


def _open_xrd(window):
    from libraries.Widgets_Toolbars import open_xrd_analysis_window
    open_xrd_analysis_window(window)


def _open_afm(window):
    from libraries.Widgets_Toolbars import open_afm_analysis_window
    open_afm_analysis_window(window)


def _open_arpes(window):
    from libraries.ToolsMenu.ARPES_Analysis import open_arpes_window
    open_arpes_window(window)


def _open_raman(window):
    from libraries.ToolsMenu.Raman_Analysis import open_raman_window
    open_raman_window(window)


def _open_uvvis(window):
    from libraries.ToolsMenu.UVVIS_Analysis import open_uvvis_window
    open_uvvis_window(window)


def _open_pl(window):
    from libraries.ToolsMenu.PL_Analysis import open_pl_window
    open_pl_window(window)


def _open_ellips(window):
    from libraries.ToolsMenu.Ellips_Analysis import open_ellips_window
    open_ellips_window(window)


def _open_ms(window):
    from libraries.ToolsMenu.MS_Analysis import open_ms_window
    open_ms_window(window)


def _open_gc(window):
    from libraries.ToolsMenu.GC_Analysis import open_gc_window
    open_gc_window(window)


def _open_dil(window):
    from libraries.ToolsMenu.DIL_Analysis import open_dil_window
    open_dil_window(window)


def _open_bet(window):
    from libraries.ToolsMenu.BET_Analysis import open_bet_window
    open_bet_window(window)


def _is_raman_name(name):
    # Case-sensitive on purpose: 'RA1' and 'Ra_xx' are Raman sheets, while
    # 'Ra3d' is a radium core level and must stay XPS.
    return (name.startswith('RA') or 'RAMAN' in name.upper()
            or name.startswith('Ra_'))


# Ordered: the first prefix that matches wins.  EELS is listed before EIS
# because neither prefix is a prefix of the other, but the order keeps the
# reading obvious.
_ALL_TECHNIQUES = (
    {'key': 'FTIR', 'feature': 'ftir', 'prefixes': ('FTIR',), 'icon': 'Tech-FTIR-3.png',
     'help': ('FTIR ANALYSIS\n'
              '\n'
              'Opens the FTIR tool for this infrared spectrum\n'
              '(sheets named FTIR...). Tabs cover unit conversion\n'
              'and metadata, a processing pipeline (spikes,\n'
              'atmosphere, ATR, baseline, smoothing,\n'
              'normalisation), band detection with ranked\n'
              'assignments, an IR band library and reference\n'
              'spectra.\n'
              '\n'
              'Processing is non-destructive: the raw spectrum\n'
              'is kept and Ctrl+Z undoes changes.'),
     'open': _open_ftir},
    {'key': 'TGA', 'feature': 'tga', 'prefixes': ('TGA',), 'icon': 'Tech-TGA-3.png',
     'help': ('TGA / DSC ANALYSIS\n'
              '\n'
              'Opens the thermal-analysis tool (sheets named\n'
              'TGA...). Work through the tabs left to right:\n'
              '\n'
              '  1. Range: bracket one heating ramp with the red\n'
              '     dashed lines and make a sheet from it.\n'
              '  2. Mass: normalise and measure mass-loss steps.\n'
              '  3. DTG: derivative curve with peak detection.\n'
              '  4. DSC: baseline and peak integration.\n'
              '  5. Events: combined table of thermal events.'),
     'open': _open_tga},
    {'key': 'SQUID', 'feature': 'squid', 'prefixes': ('SQUID',), 'icon': 'Tech-SQUID-3.png',
     'help': ('SQUID ANALYSIS\n'
              '\n'
              'Opens the magnetometry tool (sheets named\n'
              'SQUID...).\n'
              '\n'
              'How to use:\n'
              '  1. Enter sample mass, molar mass, magnetic ions\n'
              '     per formula unit and the applied field.\n'
              '  2. Generate chi, 1/chi and chi*T sheets.\n'
              '  3. Bracket a temperature range with the red\n'
              '     dashed lines and fit a Curie-Weiss model.\n'
              '\n'
              'Changes can be undone with Ctrl+Z.'),
     'open': _open_squid},
    {'key': 'EIS', 'feature': 'eis', 'prefixes': ('EIS',), 'icon': 'Tech-EIS-3.png',
     'help': ('EIS ANALYSIS\n'
              '\n'
              'Opens the impedance tool (sheets named EIS...).\n'
              'Tabs run in the order a spectrum is worked up:\n'
              'real-axis intercepts of the Nyquist arc (ohmic\n'
              'and polarisation resistance), equivalent-circuit\n'
              'fitting, batch fitting of many sweeps,\n'
              'normalisation by area/electrode, conductivity,\n'
              'and more.\n'
              '\n'
              'Bracket the part of the arc to use with the red\n'
              'dashed lines on the main plot.'),
     'open': _open_eis},
    {'key': 'EELS', 'feature': 'eels', 'prefixes': ('EELS',), 'icon': 'Tech-EELS-3.png',
     'help': ('EELS ANALYSIS\n'
              '\n'
              'Opens the electron energy-loss tool (sheets named\n'
              'EELS...): spectrum-image maps, spectra from\n'
              'regions of interest, PSR and elemental mapping.'),
     'open': _open_eels},
    {'key': 'EDX', 'feature': 'edx', 'prefixes': ('EDX',), 'icon': 'Tech-EDX-3.png',
     'help': ('EDX HEATMAP\n'
              '\n'
              'Opens the EDX / SEM window (sheets named EDX...)\n'
              'to view the electron image, select points, areas\n'
              'or lines, and plot elemental maps and their\n'
              'quantification.'),
     'open': _open_edx},
    {'key': 'SEM', 'feature': 'sem', 'prefixes': ('SEM',), 'icon': 'Tech-SEM-3.png',
     'help': ('SEM IMAGE ANALYSIS\n'
              '\n'
              'Opens the SEM tool for the image on the main plot.\n'
              'Tabs:\n'
              '  Calibrate - set nm per pixel from the file or by\n'
              '              drawing along the scale bar.\n'
              '  Crop      - keep only part of the image.\n'
              '  Detect    - threshold settings and region, with a\n'
              '              live particle overlay.\n'
              '  Results   - statistics and size distributions.'),
     'open': _open_sem},
    {'key': 'TEM', 'feature': 'tem', 'prefixes': ('TEM',), 'icon': 'Tech-TEM-3.png',
     'help': ('TEM ANALYSIS\n'
              '\n'
              'Opens the TEM tool for the image on the main plot\n'
              '(sheets named TEM...). Tabs include pixel-size\n'
              'calibration, particle counting, line profiles\n'
              '(fringe spacing), FFT of a region, FFT filtering\n'
              'and d-spacing / angle measurement on the FFT.'),
     'open': _open_tem},
    {'key': 'AFM', 'feature': 'afm', 'prefixes': ('AFM',), 'icon': 'Tech-AFM-3.png',
     'help': ('AFM ANALYSIS\n'
              '\n'
              'Opens the AFM tool for this scan (sheets named\n'
              'AFM...). Switch channels and colour map, level the\n'
              'image (flatten, align rows, remove scars),\n'
              'compute ISO 25178 roughness (Sa, Sq...), view it\n'
              'in 3D, count grains, draw line profiles and\n'
              'analyse force curves.\n'
              '\n'
              'Levelling is stored as a recipe on the sheet, so\n'
              'the original data is never overwritten.'),
     'open': _open_afm},
    {'key': 'XRD', 'feature': 'xrd', 'prefixes': ('XRD',), 'icon': 'Tech-XRD-3.png',
     'help': ('XRD ANALYSIS\n'
              '\n'
              'Opens the diffraction tool (sheets named XRD...).\n'
              'Find phases in the COD, Materials Project or your\n'
              'own CIF files, set the background and refine the\n'
              'pattern (Le Bail or Rietveld).\n'
              '\n'
              'Calculated pattern, difference curve and phase\n'
              'ticks are drawn on the main plot; refined\n'
              'reflections go into the peak-fitting table.'),
     'open': _open_xrd},
    {'key': 'ARPES', 'feature': 'arpes', 'prefixes': ('ARPES',),
     'icon': 'Tech-ARPES-3.png',
     'help': ('ARPES ANALYSIS\n'
              '\n'
              'Opens the ARPES control window for this dataset.\n'
              'The dispersion (intensity map with EDC/MDC\n'
              'profiles and crosshairs) takes the main plot;\n'
              'Fermi-surface and other views appear on the right,\n'
              'and 3D views show on the ARPES~3D sheet.'),
     'open': _open_arpes},
    # Raman sheets cannot be recognised by an upper-cased prefix ('RA3D' would
    # swallow radium core levels), so this spec carries a match callable that
    # technique_of_sheet consults with the original casing.
    {'key': 'RAMAN', 'feature': 'raman', 'prefixes': (),
     'match': _is_raman_name, 'icon': 'Tech-RAMAN-3.png',
     'help': ('RAMAN ANALYSIS\n'
              '\n'
              'Opens the Raman tool (sheets named RA..., Ra_...\n'
              'or containing "Raman"). Find peaks on the spectrum\n'
              'or use the peaks already fitted in the grid, then\n'
              'get ranked assignments from the band database and\n'
              'label them on the plot.\n'
              '\n'
              'Tip: fit the peaks first, then assign them.'),
     'open': _open_raman},
    {'key': 'UVVIS', 'feature': 'uvvis', 'prefixes': ('UVVIS',),
     'icon': 'Tech-UVVIS-3.png',
     'help': ('UV-VIS ANALYSIS\n'
              '\n'
              'Opens the UV-Vis tool (sheets named UVvis...):\n'
              'convert the ordinate, find band maxima and\n'
              'extract the band gap with a Tauc plot.\n'
              '\n'
              'How to get a band gap:\n'
              '  1. Create the UVvis~Tauc sheet (nm to eV).\n'
              '  2. Drag the red lines over the linear part.\n'
              '  3. Fit band gap: the Eg value is shown.'),
     'open': _open_uvvis},
    {'key': 'ELLIPS', 'feature': 'ellips', 'prefixes': ('ELLIPS',),
     'icon': 'Tech-ELLIPS-3.png',
     'help': ('ELLIPSOMETRY ANALYSIS\n'
              '\n'
              'Opens the ellipsometry tool (sheets named\n'
              'Ellips...). Fits one transparent film on a known\n'
              'substrate (Cauchy model) to the measured Ψ and Δ\n'
              'to get the film thickness and refractive index.\n'
              '\n'
              'The fitted index is written to an Ellips~n sheet.'),
     'open': _open_ellips},
    {'key': 'MS', 'feature': 'ms', 'prefixes': ('MS',),
     'icon': 'Tech-MS-3.png',
     'help': ('MASS SPECTROMETRY ANALYSIS\n'
              '\n'
              'Opens the MS tool (sheets named MS...). Detects\n'
              'peaks with intensities relative to the base peak,\n'
              'labels them, and suggests neutral losses, adducts,\n'
              'fragments and common contaminant ions.\n'
              '\n'
              'Suggestions are interpretive aids, not a formula\n'
              'search. Reference EI spectra can be fetched from\n'
              'the NIST WebBook.'),
     'open': _open_ms},
    {'key': 'GC', 'feature': 'gc', 'prefixes': ('GC',),
     'icon': 'Tech-GC-3.png',
     'help': ('GAS CHROMATOGRAPHY ANALYSIS\n'
              '\n'
              'Opens the GC tool (sheets named GC...). Detects\n'
              'peaks, integrates each one valley-to-valley above\n'
              'a straight local baseline, and reports retention\n'
              'time, height, area and area %.'),
     'open': _open_gc},
    {'key': 'DIL', 'feature': 'dil', 'prefixes': ('DIL',),
     'icon': 'Tech-DIL-3.png',
     'help': ('DILATOMETRY ANALYSIS\n'
              '\n'
              'Opens the dilatometry tool (sheets named DIL...).\n'
              'Splits the run into heating / cooling / dwell\n'
              'segments as separate sheets, then computes the\n'
              'mean and differential thermal-expansion\n'
              'coefficient (CTE) and sintering metrics.'),
     'open': _open_dil},
    {'key': 'BET', 'feature': 'bet', 'prefixes': ('BET',),
     'icon': 'Tech-BET-3.png',
     'help': ('BET / PHYSISORPTION ANALYSIS\n'
              '\n'
              'Opens the gas-adsorption tool for N2 isotherms at\n'
              '77 K (sheets named BET...). Gives the BET surface\n'
              'area (default P/P0 window 0.05-0.30), a t-plot\n'
              '(external area, micropore volume) and the BJH\n'
              'pore-size distribution from the desorption branch.'),
     'open': _open_bet},
    # 'PL' last: no other prefix starts with it, but the longer names above
    # must never be shadowed by a two-letter prefix.
    {'key': 'PL', 'feature': 'pl', 'prefixes': ('PL',),
     'icon': 'Tech-PL-3.png',
     'help': ('PHOTOLUMINESCENCE ANALYSIS\n'
              '\n'
              'Opens the PL tool (sheets named PL...). Reads peak\n'
              'position, FWHM and centroid straight off the\n'
              'emission curve, converts wavelength to energy\n'
              '(written to a PL~eV sheet) and gives the CIE 1931\n'
              'colour coordinates.'),
     'open': _open_pl},
)

# Only the techniques this edition ships. Filtering here rather than at each
# call site means the toolbar button cannot light up for a tool whose menu
# entries are hidden - in the free edition it simply never has a technique.
from libraries.Config_Edition import feature_enabled as _feature_enabled

TECHNIQUES = tuple(spec for spec in _ALL_TECHNIQUES
                   if _feature_enabled(spec['feature']))

_BY_KEY = {spec['key']: spec for spec in TECHNIQUES}

# Bitmaps are kept: the button reloads its icon on every sheet change.
_bitmap_cache = {}


def _bitmap(file_name):
    if file_name not in _bitmap_cache:
        _bitmap_cache[file_name] = wx.Bitmap(
            os.path.join(_ICON_DIR, file_name), wx.BITMAP_TYPE_PNG)
    return _bitmap_cache[file_name]


def technique_of_sheet(window, sheet_name):
    """The technique spec for a sheet, or None when no tool applies."""
    if not sheet_name:
        return None

    # SEM images carry a pixel array and a flag rather than a technique name,
    # so they cannot be recognised from the sheet name alone.
    sheet = {}
    if hasattr(window, 'Data'):
        sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    if isinstance(sheet, dict) and sheet.get('_sem'):
        # .get, not [...]: SEM is absent from _BY_KEY in an edition that does
        # not ship it, and the button must simply stay greyed out.
        return _BY_KEY.get('SEM')
    if isinstance(sheet, dict) and sheet.get('_afm'):
        return _BY_KEY.get('AFM')

    name = str(sheet_name)
    upper = name.upper()
    for spec in TECHNIQUES:
        match = spec.get('match')
        if match is not None and match(name):
            return spec
        if any(upper.startswith(prefix) for prefix in spec['prefixes']):
            return spec
    return None


def create_technique_tool(window, toolbar):
    """Add the button to ``toolbar``. It starts greyed, with no technique."""
    tool = toolbar.AddTool(wx.ID_ANY, 'Technique Tool',
                           _bitmap(NO_TECHNIQUE_ICON),
                           shortHelp=NO_TECHNIQUE_HELP)
    window.technique_tool = tool
    window.technique_toolbar = toolbar
    toolbar.EnableTool(tool.GetId(), False)
    window.Bind(wx.EVT_TOOL, lambda event: open_technique_tool(window), tool)
    # Start with it off the bar (no sheet -> no technique). Deferred so the
    # toolbar is realized first; update_technique_tool puts it back as soon as
    # a technique sheet is selected.
    wx.CallAfter(update_technique_tool, window, None)
    return tool


def update_technique_tool(window, sheet_name=None):
    """Point the button at the tool the given sheet needs (or grey it out)."""
    tool = getattr(window, 'technique_tool', None)
    toolbar = getattr(window, 'technique_toolbar', None)
    if tool is None or toolbar is None:
        return

    if sheet_name is None and hasattr(window, 'sheet_combobox'):
        sheet_name = window.sheet_combobox.GetValue()

    spec = technique_of_sheet(window, sheet_name)
    window.technique_tool_spec = spec

    # No technique -> take the button off the toolbar entirely. Selecting a
    # sheet switches straight to its technique, so a greyed 'n/a' icon is dead
    # space on every XPS sheet. It is re-inserted at its original position the
    # moment a technique sheet is selected.
    tool_id = tool.GetId()
    pos = getattr(window, '_technique_tool_pos', None)
    if pos is None:
        pos = toolbar.GetToolPos(tool_id)
        if pos >= 0:
            window._technique_tool_pos = pos

    if spec is None:
        if toolbar.FindById(tool_id) is not None:
            toolbar.RemoveTool(tool_id)
            toolbar.Realize()
        return

    if toolbar.FindById(tool_id) is None:
        toolbar.InsertTool(pos if pos is not None else toolbar.GetToolsCount(),
                           tool)
        toolbar.Realize()
    toolbar.SetToolNormalBitmap(tool_id, _bitmap(spec['icon']))
    toolbar.SetToolShortHelp(tool_id, spec['help'])
    toolbar.EnableTool(tool_id, True)


def open_technique_tool(window):
    """Open the tool the button is currently showing."""
    spec = getattr(window, 'technique_tool_spec', None)
    if spec is None:
        return
    spec['open'](window)
