# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ViewMenu/TechniqueOverview.py. Regenerate with tools/export_khervetech.py.
"""
Technique overview panel for the right frame — TEM, SEM, and whatever comes
next.

On a non-XPS image sheet the Peak Parameters and Results grids are meaningless,
so the right frame shows a companion view of the same analysis instead: a
second linked plot on top, a chip per sheet in the group, and an info box. The
machinery (page swap, companion canvas, chips) is identical for every
technique; only *what* the companion draws, how the sheets group, and what the
info box says differ. Those live in a per-technique ``spec`` dict, so adding a
technique is a spec, not a new panel.

    spec = {
        'name':        'TEM',                 # page label + title
        'open_label':  'TEM Analysis…',
        'open_tool':   fn(window),            # open the full analysis window
        'group':       fn(window, sheet) -> (root, [members]),
        'companions':  fn(window, sheet, members) -> [names for the dropdown],
        'default_companion': fn(window, sheet, members) -> name | None,
        'render':      fn(ax, window, name) -> bool,   # draw the companion
        'info':        fn(window, sheet) -> [lines],
    }

Everything only ever reads ``window.Data``; the heavy actions stay in the
floating analysis windows.
"""

import wx
from matplotlib.backends.backend_wxagg import FigureCanvasWxAgg as FigureCanvas
from matplotlib.figure import Figure

BRAND = (79 / 255, 190 / 255, 159 / 255)


# ---------------------------------------------------------------------------
# Shared companion helpers
# ---------------------------------------------------------------------------

HIST_LABEL = 'Histogram (contrast)'


def _persist(window):
    try:
        from libraries.FileMenu.KFitting_IO import persist_project
        persist_project(window)
    except Exception as e:
        print(f'technique-overview persist skipped: {e}')


def _bc_from_levels(top, black, white):
    """Brightness/contrast (adjust_image parameterisation) for a black/white cut.

    Dragging the histogram's black and white points defines a linear stretch
    out = (in - black)/(white - black); this returns the equivalent (offset,
    gain) so it can be stored as the sheet's brightness/contrast.
    """
    if top <= 0:
        return None
    b = min(black, white) / top
    w = max(black, white) / top
    if w <= b:
        return None
    gain = 1.0 / (w - b)
    contrast = 100.0 * (gain - 1.0)
    brightness = 100.0 * (gain * (0.5 - b) - 0.5)
    return brightness, contrast


def _launch_section(window, opener, key, method=None):
    """Open a section window and optionally arm its primary interaction."""
    win = opener(window, key)
    if win is not None and method:
        try:
            getattr(win, method)(None)
        except Exception as e:
            print(f'Quick action skipped: {e}')
    return win


# ---------------------------------------------------------------------------
# TEM spec — reuses the helpers already written for the TEM overview
# ---------------------------------------------------------------------------

def _tem_spec():
    from libraries.ViewMenu.TEMOverview import (root_map, tem_group,
                                                tem_info_lines, _is_image)
    from libraries.ToolsMenu.TEM_Plot import (render_tem_thumbnail,
                                              render_tem_live_fft)
    from libraries.FileMenu.TEM_Import import tem_array

    def companions(window, sheet_name, members):
        # Real image sheets, minus the one already on the main canvas — no
        # point previewing the same picture twice.
        levels = window.Data.get('Core levels', {})
        return [m for m in members
                if _is_image(levels.get(m, {})) and m != sheet_name]

    def image_of(window, sheet_name):
        levels = window.Data.get('Core levels', {})
        return tem_array(levels.get(root_map(window, sheet_name), {}))

    def hist_image(window, sheet_name):
        """(display-input array, target sheet) for the active TEM sheet.

        FFTs histogram their log-power display; a sheet with no image falls
        back to the group's source micrograph.
        """
        import numpy as np
        from libraries.FileMenu.TEM_Import import is_tem_fft
        from libraries.ToolsMenu.TEM_Engine import display_fft
        levels = window.Data.get('Core levels', {})
        sheet = levels.get(sheet_name, {})
        arr = tem_array(sheet)
        if arr is None:
            target = root_map(window, sheet_name)
            arr = tem_array(levels.get(target, {}))
            return (np.asarray(arr, float) if arr is not None else None), target
        if is_tem_fft(sheet):
            return np.asarray(display_fft(np.asarray(arr)), float), sheet_name
        return np.asarray(arr, float), sheet_name

    def apply_levels(window, target_name, black, white):
        import numpy as np
        from libraries.ToolsMenu.TEM_Plot import plot_tem_image
        arr, _n = hist_image(window, target_name)
        if arr is None:
            return
        bc = _bc_from_levels(float(np.nanmax(arr)), black, white)
        if not bc:
            return
        sheet = window.Data.get('Core levels', {}).get(target_name, {})
        sheet['TEM_Brightness'], sheet['TEM_Contrast'] = float(bc[0]), float(bc[1])
        sheet['TEM_AutoContrast'] = False
        plot_tem_image(window, target_name, preserve_view=True)
        window.plot_manager.canvas.draw_idle()
        tw = getattr(window, 'tem_analysis_window', None)
        if tw and getattr(tw, 'brightness_slider', None):
            try:
                tw._load_adjust_from_sheet()
            except Exception:
                pass
        _persist(window)

    def modes(window, sheet_name):
        return [
            ('Live FFT', lambda ax, w, s: render_tem_live_fft(ax, w, s)),
        ]

    def default_companion(window, sheet_name, members):
        levels = window.Data.get('Core levels', {})
        ffts = [m for m in members
                if levels.get(m, {}).get('_tem_kind') == 'fft' and m != sheet_name]
        if ffts:
            return ffts[-1]
        # A saved FFT is best; otherwise the on-the-fly diffractogram.
        return 'Live FFT'

    def actions(window):
        from libraries.ToolsMenu.TEM_Analysis import open_tem_section
        return [
            ('Compute FFT',
             lambda: _launch_section(window, open_tem_section, 'fft', 'on_draw_roi')),
            ('Draw profile',
             lambda: _launch_section(window, open_tem_section, 'profile', 'on_draw_line')),
            ('Detect particles',
             lambda: _launch_section(window, open_tem_section, 'particles')),
        ]

    def open_tool(window):
        from libraries.Widgets_Toolbars import open_tem_analysis_window
        open_tem_analysis_window(window)

    return {
        'name': 'TEM', 'open_label': 'TEM Analysis…', 'open_tool': open_tool,
        'group': tem_group, 'companions': companions,
        'default_companion': default_companion, 'companion_modes': modes,
        'render': render_tem_thumbnail, 'info': tem_info_lines,
        'actions': actions,
        'hist_image': hist_image, 'apply_levels': apply_levels,
    }


# ---------------------------------------------------------------------------
# SEM spec
# ---------------------------------------------------------------------------

def _sem_source(sheet):
    return sheet.get('SEM_Source_Sheet') if isinstance(sheet, dict) else None


def _sem_root(window, sheet_name):
    levels = window.Data.get('Core levels', {})
    src = _sem_source(levels.get(sheet_name, {}))
    return src if src in levels else sheet_name


def sem_group(window, sheet_name):
    levels = window.Data.get('Core levels', {})
    root = _sem_root(window, sheet_name)
    members = [root] if root in levels else []
    for name, sheet in levels.items():
        if name != root and _sem_source(sheet) == root:
            members.append(name)

    def rank(name):
        if name == root:
            return (0, name)
        if str(name).startswith('SEM~Count'):
            return (1, name)
        if str(name).startswith('SEM~Freq'):
            return (2, name)
        return (3, name)

    members.sort(key=rank)
    return root, members


def sem_default_companion(window, sheet_name, members):
    root = _sem_root(window, sheet_name)
    if sheet_name == root:
        dists = [m for m in members
                 if str(m).startswith(('SEM~Count', 'SEM~Freq'))]
        return dists[0] if dists else None
    levels = window.Data.get('Core levels', {})
    return root if root in levels else None


def sem_info_lines(window, sheet_name):
    from libraries.FileMenu.SEM_Import import sem_array

    levels = window.Data.get('Core levels', {})
    sheet = levels.get(sheet_name, {})
    lines = [f'Sheet: {sheet_name}']
    if not isinstance(sheet, dict):
        return lines

    if str(sheet_name).startswith(('SEM~Count', 'SEM~Freq')):
        src = sheet.get('SEM_Source_Sheet')
        if src:
            lines.append(f'From: {src}')
        stats = (levels.get(src, {}).get('SEM_Particles')
                 if src else None) or {}
        if stats.get('Count'):
            lines.append(f"Particles: {stats['Count']}")
        return lines

    nm = sheet.get('SEM_NM_Per_Px')
    array = sem_array(sheet)
    if array is not None:
        lines.append(f'{array.shape[1]} × {array.shape[0]} px')
    if nm:
        lines.append(f'{nm:.4g} nm/px')
        if array is not None:
            width_nm = array.shape[1] * nm
            lines.append('Field: ' + (f'{width_nm / 1000:.3g} µm'
                                       if width_nm > 2000 else f'{width_nm:.4g} nm'))
    else:
        lines.append('uncalibrated — set the scale in Calibrate')
    if sheet.get('SEM_Crop'):
        lines.append('cropped')
    stats = sheet.get('SEM_Particles')
    if isinstance(stats, dict) and stats.get('Count'):
        lines.append(f"Particles: {stats['Count']}")
        for key in ('ECD Mean (nm)', 'ECD Mean (px)', 'Areal Coverage (%)'):
            if key in stats and stats[key] is not None:
                lines.append(f'{key}: {stats[key]:.4g}')
    return lines


def _sem_spec():
    from libraries.ToolsMenu.SEM_Plot import render_sem_thumbnail
    from libraries.FileMenu.SEM_Import import sem_array

    def companions(window, sheet_name, members):
        return [m for m in members if m != sheet_name]

    def image_of(window, sheet_name):
        levels = window.Data.get('Core levels', {})
        return sem_array(levels.get(_sem_root(window, sheet_name), {}))

    def hist_image(window, sheet_name):
        import numpy as np
        target = _sem_root(window, sheet_name)
        arr = sem_array(window.Data.get('Core levels', {}).get(target, {}))
        return (np.asarray(arr, float) if arr is not None else None), target

    def apply_levels(window, target_name, black, white):
        import numpy as np
        from libraries.ToolsMenu.SEM_Plot import plot_sem_image
        arr, _n = hist_image(window, target_name)
        if arr is None:
            return
        bc = _bc_from_levels(float(np.nanmax(arr)), black, white)
        if not bc:
            return
        sheet = window.Data.get('Core levels', {}).get(target_name, {})
        sheet['SEM_Brightness'], sheet['SEM_Contrast'] = float(bc[0]), float(bc[1])
        sheet['SEM_AutoContrast'] = False
        plot_sem_image(window, target_name, preserve_view=True)
        window.plot_manager.canvas.draw_idle()
        sw = getattr(window, 'sem_analysis_window', None)
        if sw and getattr(sw, 'brightness_slider', None):
            try:
                sw._load_adjust_from_sheet()
            except Exception:
                pass
        _persist(window)

    def modes(window, sheet_name):
        return []

    def default_companion(window, sheet_name, members):
        # The size distribution when viewing the image, the image when viewing
        # a distribution, and the histogram when neither the same as the main
        # view is available.
        chosen = sem_default_companion(window, sheet_name, members)
        return chosen if (chosen and chosen != sheet_name) else HIST_LABEL

    def actions(window):
        from libraries.ToolsMenu.SEM_Analysis import open_sem_section
        return [
            ('Detect particles',
             lambda: _launch_section(window, open_sem_section, 'detect')),
            ('Crop image',
             lambda: _launch_section(window, open_sem_section, 'crop', 'on_draw_crop')),
            ('Set scale',
             lambda: _launch_section(window, open_sem_section, 'calibrate', 'on_draw_calibration')),
        ]

    def open_tool(window):
        from libraries.Widgets_Toolbars import open_sem_analysis_window
        open_sem_analysis_window(window)

    return {
        'name': 'SEM', 'open_label': 'SEM Analysis…', 'open_tool': open_tool,
        'group': sem_group, 'companions': companions,
        'default_companion': default_companion, 'companion_modes': modes,
        'render': render_sem_thumbnail, 'info': sem_info_lines,
        'actions': actions,
        'hist_image': hist_image, 'apply_levels': apply_levels,
    }


# ---------------------------------------------------------------------------
# AFM spec
#
# The group is every channel imported from the same file (height, amplitude,
# phase, potential, current, ...) plus any AFM~Profile sheets extracted from
# them, so the companion dropdown is how you glance at the phase while the
# height map is on the main canvas.
# ---------------------------------------------------------------------------

def _afm_root(window, sheet_name):
    levels = window.Data.get('Core levels', {})
    sheet = levels.get(sheet_name, {})
    src = sheet.get('AFM_Source_Sheet') if isinstance(sheet, dict) else None
    return src if src in levels else sheet_name


def afm_group(window, sheet_name):
    levels = window.Data.get('Core levels', {})
    root = _afm_root(window, sheet_name)
    root_sheet = levels.get(root, {})
    source = root_sheet.get('AFM_Source_File') if isinstance(root_sheet, dict) else None
    members = [root] if root in levels else []
    group_names = set(members)
    for name, sheet in levels.items():
        if name in group_names or not isinstance(sheet, dict):
            continue
        if sheet.get('_afm') and source and sheet.get('AFM_Source_File') == source:
            members.append(name)
            group_names.add(name)
    for name, sheet in levels.items():
        if name in group_names or not isinstance(sheet, dict):
            continue
        if sheet.get('AFM_Source_Sheet') in group_names:
            members.append(name)
            group_names.add(name)
    return root, members


def afm_info_lines(window, sheet_name):
    from libraries.FileMenu.AFM_Import import afm_array

    levels = window.Data.get('Core levels', {})
    sheet = levels.get(sheet_name, {})
    lines = [f'Sheet: {sheet_name}']
    if not isinstance(sheet, dict):
        return lines

    if str(sheet_name).startswith('AFM~Profile'):
        src = sheet.get('AFM_Source_Sheet')
        if src:
            lines.append(f'From: {src}')
        stats = sheet.get('AFM_Profile_Stats') or {}
        for key in ('Ra', 'Rq', 'Rz'):
            if key in stats:
                lines.append(f'{key}: {stats[key]:.4g}')
        return lines

    if sheet.get('_afm_kind') == '3d':
        view = sheet.get('AFM_3D') or {}
        lines.append(f"Surface of: {view.get('source') or '?'}")
        lines.append(f"View: {float(view.get('elev', 45)):.0f}° / "
                     f"{float(view.get('azim', -60)):.0f}°")
        lines.append(f"Height exaggeration: {float(view.get('zscale', 1.0)):.2f}×")
        return lines

    channel = sheet.get('AFM_Channel')
    units = sheet.get('AFM_Units')
    if channel:
        lines.append(f'Channel: {channel}' + (f' ({units})' if units else ''))
    mode = sheet.get('AFM_Mode')
    if mode:
        lines.append(f'Mode: {mode}')
    array = afm_array(sheet)
    nm = sheet.get('AFM_NM_Per_Px')
    if array is not None:
        lines.append(f'{array.shape[1]} × {array.shape[0]} px')
    if nm:
        if array is not None:
            width_nm = array.shape[1] * nm
            lines.append('Scan: ' + (f'{width_nm / 1000:.3g} µm'
                                     if width_nm > 2000 else f'{width_nm:.4g} nm'))
        lines.append(f'{nm:.4g} nm/px')
    else:
        lines.append('uncalibrated — set the scan size in Channels')
    level = sheet.get('AFM_Level')
    if level:
        parts = [v for v in (level.get('plane'), level.get('lines'))
                 if v and v != 'none']
        if parts:
            lines.append('leveled: ' + ' + '.join(parts))
    stats = sheet.get('AFM_Roughness')
    if isinstance(stats, dict) and 'Sa' in stats:
        lines.append(f"Sa: {stats['Sa']:.4g} {units or ''}".rstrip())
        lines.append(f"Sq: {stats['Sq']:.4g} {units or ''}".rstrip())
    cd = sheet.get('AFM_Profile_CD')
    if isinstance(cd, dict) and cd.get('h') is not None:
        lines.append(f"Feature h: {cd['h']:.4g} ± {cd.get('h_err', 0):.2g} "
                     f"{units or ''}".rstrip())
        if cd.get('width'):
            lines.append(f"Feature width: {cd['width']:.4g}")
    if sheet.get('_afm_volume'):
        volume = sheet['_afm_volume']
        lines.append(f"Force curves: {len(volume.get('curves') or [])} "
                     f"({volume.get('points')} × {volume.get('lines')})")
    return lines


def _afm_spec():
    from libraries.ToolsMenu.AFM_Plot import (afm_companion_mouse,
                                              render_afm_thumbnail,
                                              render_afm_histogram,
                                              render_afm_particles,
                                              render_afm_psd,
                                              render_afm_live_profile,
                                              render_afm_force_curve,
                                              render_afm_surface_companion)

    def companions(window, sheet_name, members):
        return [m for m in members if m != sheet_name]

    def _has_volume(window, sheet_name):
        levels = window.Data.get('Core levels', {})
        root = _afm_root(window, sheet_name)
        source = levels.get(root, {}).get('AFM_Source_File')
        return any(isinstance(s, dict) and s.get('_afm_volume')
                   and (s.get('AFM_Source_File') == source or n == root)
                   for n, s in levels.items())

    def hist_image(window, sheet_name):
        """(leveled height array, target sheet) for the contrast histogram.

        The leveled view, not the raw one: the histogram must show the same
        numbers the colour key and the particle threshold work in.
        """
        import numpy as np
        from libraries.FileMenu.AFM_Import import afm_array
        levels = window.Data.get('Core levels', {})
        target = _afm_root(window, sheet_name)
        arr = afm_array(levels.get(target, {}))
        return (np.asarray(arr, float) if arr is not None else None), target

    def apply_levels(window, target_name, black, white):
        """Store the dragged black/white points as the sheet's display range."""
        from libraries.ToolsMenu.AFM_Plot import plot_afm_image
        sheet = window.Data.get('Core levels', {}).get(target_name, {})
        if float(white) <= float(black):
            return
        sheet['AFM_Display_Range'] = [float(black), float(white)]
        if getattr(window, 'afm_on_main', None) == target_name:
            plot_afm_image(window, target_name, preserve_view=True)
            window.plot_manager.canvas.draw_idle()
        _persist(window)

    def modes(window, sheet_name):
        # The AFM Analysis tabs draw nothing themselves; these computed views
        # are where their plots live.
        out = [('Live profile', render_afm_live_profile),
               ('3D view', render_afm_surface_companion),
               ('Histogram', render_afm_histogram),
               ('Particle sizes', render_afm_particles),
               ('PSD', render_afm_psd)]
        if _has_volume(window, sheet_name):
            out.append(('Force curve', render_afm_force_curve))
        return out

    def default_companion(window, sheet_name, members):
        levels = window.Data.get('Core levels', {})
        sheet = levels.get(sheet_name, {})
        # A drawn line makes the live profile the thing being worked on;
        # a force map defaults to its curve; otherwise show a sibling channel.
        if isinstance(sheet, dict) and sheet.get('AFM_Profile_Line'):
            return 'Live profile'
        if isinstance(sheet, dict) and sheet.get('_afm_volume'):
            return 'Force curve'
        others = [m for m in members if m != sheet_name]
        return others[0] if others else 'Histogram'

    def actions(window):
        from libraries.ToolsMenu.AFM_Analysis import open_afm_section
        return [
            ('Level image',
             lambda: _launch_section(window, open_afm_section, 'level')),
            ('Roughness',
             lambda: _launch_section(window, open_afm_section, 'roughness')),
            ('3D surface',
             lambda: _launch_section(window, open_afm_section, 'view3d')),
            ('Draw profile',
             lambda: _launch_section(window, open_afm_section, 'profile',
                                     'on_draw_line')),
            ('Measure grain size',
             lambda: _launch_section(window, open_afm_section, 'particles')),
        ]

    def open_tool(window):
        from libraries.Widgets_Toolbars import open_afm_analysis_window
        open_afm_analysis_window(window)

    return {
        'name': 'AFM', 'open_label': 'AFM Analysis…', 'open_tool': open_tool,
        'group': afm_group, 'companions': companions,
        'default_companion': default_companion, 'companion_modes': modes,
        'render': render_afm_thumbnail, 'info': afm_info_lines,
        'actions': actions,
        # Dragging a range on the live profile picks the feature the Profile
        # tab measures the critical dimension of.
        'canvas_mouse': afm_companion_mouse,
        # The contrast histogram sets the display range, which is also what
        # the particle threshold can be taken from.
        'hist_image': hist_image, 'apply_levels': apply_levels,
        'hist_xlabel': 'height',
    }


# ---------------------------------------------------------------------------
# SQUID spec
#
# Unlike TEM/SEM the sheets here are curves, not images, so there is no
# contrast histogram — the companion is the sibling derived quantity (moment ↔
# χ ↔ 1/χ ↔ χT) drawn as a line, with any Curie-Weiss fit overlaid. The peak
# and results grids are meaningless for a magnetometry sweep; this overview
# takes their place while the fit still writes its grid row / plot label as
# before.
# ---------------------------------------------------------------------------

def _squid_root(window, sheet_name):
    """The source moment scan a derived χ/1/χ/χT sheet came from, or itself."""
    levels = window.Data.get('Core levels', {})
    sheet = levels.get(sheet_name, {})
    parent = sheet.get('SQUID_Parent') if isinstance(sheet, dict) else None
    return parent if parent in levels else sheet_name


def squid_group(window, sheet_name):
    from libraries.FileMenu.SQUID_Import import (QTY_MOMENT, QTY_CHI,
                                                 QTY_INV_CHI, QTY_CHI_T)
    levels = window.Data.get('Core levels', {})
    root = _squid_root(window, sheet_name)
    members = [root] if root in levels else []
    for name, sheet in levels.items():
        if (name != root and isinstance(sheet, dict)
                and sheet.get('SQUID_Parent') == root):
            members.append(name)

    order = {QTY_MOMENT: 0, QTY_CHI: 1, QTY_INV_CHI: 2, QTY_CHI_T: 3}

    def rank(name):
        quantity = levels.get(name, {}).get('SQUID_Quantity')
        return (0, name) if name == root else (1 + order.get(quantity, 9), name)

    members.sort(key=rank)
    return root, members


def squid_info_lines(window, sheet_name):
    levels = window.Data.get('Core levels', {})
    sheet = levels.get(sheet_name, {})
    lines = [f'Sheet: {sheet_name}']
    if not isinstance(sheet, dict):
        return lines

    label = sheet.get('SQUID_Label')
    if label:
        lines.append(label)

    scan = sheet.get('SQUID_Scan_Type')
    x_values = sheet.get('B.E.', [])
    if x_values:
        unit = 'K' if scan == 'MT' else 'Oe'
        kind = 'M(T)' if scan == 'MT' else 'M(H)'
        lines.append(f'{kind}: {len(x_values)} pts, '
                     f'{min(x_values):.2f}–{max(x_values):.2f} {unit}')
    field = sheet.get('SQUID_Field_Oe')
    if field is not None:
        lines.append(f'Field: {field:g} Oe')

    params = sheet.get('SQUID_Params') or {}
    if params.get('mass_mg'):
        lines.append(f"Mass: {params['mass_mg']:g} mg")
    if params.get('molar_mass'):
        lines.append(f"Molar mass: {params['molar_mass']:g} g/mol")

    fitting = sheet.get('Fitting')
    cw = (fitting.get('Peaks', {}).get('Curie-Weiss')
          if isinstance(fitting, dict) else None)
    if cw:
        # peak_data mapping: Position=θ_CW, Height=C, FWHM=μ_eff, Area=R²
        lines += ['', 'Curie-Weiss fit:',
                  f"  C = {cw.get('Height', 0):.4g} emu K/mol",
                  f"  θ_CW = {cw.get('Position', 0):.2f} K",
                  f"  μ_eff = {cw.get('FWHM', 0):.3f} μB",
                  f"  R² = {cw.get('Area', 0):.5f}"]
    return lines


def render_curve(ax, window, x, y, *, xlabel='', ylabel='', colour='black',
                 overlays=(), equal_aspect=False, reverse_x=False, sci_y=True,
                 left=None):
    """Shared companion-curve renderer for the curve techniques.

    Draws ``y`` vs ``x`` (a line) with optional ``overlays`` [(x, y, colour), …]
    such as a fit curve, honouring the main plot's Preferences font sizes.
    ``equal_aspect`` is for an EIS Nyquist view; ``reverse_x`` for FTIR
    wavenumber; ``sci_y`` puts the y-axis in ×10^n form for small quantities.
    """
    import numpy as np
    ax.clear()
    ax.set_aspect('equal' if equal_aspect else 'auto')

    # Follow the same axis font sizes as the main plot (set in Preferences) so
    # the companion reads at the same scale.
    title_size = getattr(window, 'axis_title_size', 12)
    number_size = getattr(window, 'axis_number_size', 10)

    # Fixed margins rather than tight_layout: an embedded wx figure has no
    # renderer at draw time, so tight_layout silently no-ops and the labels get
    # clipped. Scale the left/bottom room with the chosen font size so the
    # y-label + tick numbers and the x-label always fit, then fill the rest.
    if left is None:
        left = min(0.16 + 0.006 * number_size, 0.34)
    bottom = min(0.09 + 0.007 * title_size, 0.30)
    ax.set_position([left, bottom, 0.965 - left, 0.93 - bottom])

    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    if x.size == 0:
        ax.text(0.5, 0.5, 'No data', ha='center', va='center',
                transform=ax.transAxes, fontsize=9, color='gray')
        ax.set_xticks([]); ax.set_yticks([])
        return False

    try:
        ax.plot(x, y, color=colour, lw=1.2)
    except Exception:
        ax.plot(x, y, color='black', lw=1.2)
    for ox, oy, oc in overlays:
        try:
            ax.plot(ox, oy, color=oc, lw=1.4)
        except Exception:
            pass

    ax.set_xlabel(xlabel, fontsize=title_size)
    ax.set_ylabel(ylabel, fontsize=title_size)
    ax.tick_params(labelsize=number_size)
    if reverse_x and not ax.xaxis_inverted():
        ax.invert_xaxis()
    if sci_y:
        # Small quantities (SQUID ~1e-5) read better with a common ×10^n
        # exponent than long 0.00040-style tick numbers.
        from matplotlib.ticker import ScalarFormatter
        formatter = ScalarFormatter(useMathText=True)
        formatter.set_powerlimits((-2, 3))
        ax.yaxis.set_major_formatter(formatter)
        ax.yaxis.get_offset_text().set_fontsize(number_size)
    return True


def render_squid_curve(ax, window, sheet_name):
    """Draw a SQUID sheet's trace, with any Curie-Weiss fit curve on top."""
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    fitting = sheet.get('Fitting')
    cw = (fitting.get('Peaks', {}).get('Curie-Weiss')
          if isinstance(fitting, dict) else None)
    overlays = []
    if cw and cw.get('Curve X') and cw.get('Curve Y'):
        overlays.append((cw['Curve X'], cw['Curve Y'], (0.7, 0.13, 0.13)))
    return render_curve(
        ax, window, sheet.get('B.E.', []), sheet.get('Raw Data', []),
        xlabel=sheet.get('SQUID_X_Label', ''),
        ylabel=sheet.get('SQUID_Y_Label', ''),
        colour=sheet.get('SQUID_Trace_Colour') or 'black',
        overlays=overlays)


def _squid_spec():

    def companions(window, sheet_name, members):
        return [m for m in members if m != sheet_name]

    def default_companion(window, sheet_name, members):
        from libraries.FileMenu.SQUID_Import import QTY_INV_CHI
        levels = window.Data.get('Core levels', {})
        root = _squid_root(window, sheet_name)
        # Viewing the moment scan: preview 1/χ (where the fit happens); viewing
        # a derived sheet: preview the moment scan it came from.
        if sheet_name == root:
            inv = [m for m in members
                   if levels.get(m, {}).get('SQUID_Quantity') == QTY_INV_CHI]
            if inv:
                return inv[0]
        elif root in members and root != sheet_name:
            return root
        others = [m for m in members if m != sheet_name]
        return others[0] if others else None

    def actions(window):
        from libraries.ToolsMenu.SQUID_Analysis import open_squid_section
        return [
            ('Susceptibility', lambda: open_squid_section(window, 'susceptibility')),
            ('Curie-Weiss Fit', lambda: open_squid_section(window, 'fit')),
            ('ZFC–FC', lambda: open_squid_section(window, 'zfcfc')),
            ('M–H', lambda: open_squid_section(window, 'hysteresis')),
        ]

    def open_tool(window):
        from libraries.Widgets_Toolbars import open_squid_analysis_window
        open_squid_analysis_window(window)

    return {
        'name': 'SQUID', 'open_label': 'SQUID Analysis…', 'open_tool': open_tool,
        'group': squid_group, 'companions': companions,
        'default_companion': default_companion,
        'companion_modes': lambda w, s: [],
        'render': render_squid_curve, 'info': squid_info_lines,
        'actions': actions,
    }


# ---------------------------------------------------------------------------
# TGA spec — the derived temperature-view sheet and its source time-view scan
# form the family; the companion is the sibling trace (mass vs T / time).
# ---------------------------------------------------------------------------

def _tga_root(window, sheet_name):
    levels = window.Data.get('Core levels', {})
    sheet = levels.get(sheet_name, {})
    parent = sheet.get('TGA_Parent') if isinstance(sheet, dict) else None
    return parent if parent in levels else sheet_name


def tga_group(window, sheet_name):
    levels = window.Data.get('Core levels', {})
    root = _tga_root(window, sheet_name)
    members = [root] if root in levels else []
    for name, sheet in levels.items():
        if (name != root and isinstance(sheet, dict)
                and sheet.get('TGA_Parent') == root):
            members.append(name)

    def rank(name):
        view = levels.get(name, {}).get('TGA_View')
        return (0, name) if name == root else (1 if view == 'temperature' else 2, name)

    members.sort(key=rank)
    return root, members


def tga_info_lines(window, sheet_name):
    levels = window.Data.get('Core levels', {})
    sheet = levels.get(sheet_name, {})
    lines = [f'Sheet: {sheet_name}']
    if not isinstance(sheet, dict):
        return lines
    if sheet.get('TGA_Label'):
        lines.append(sheet['TGA_Label'])
    view = sheet.get('TGA_View')
    x = sheet.get('B.E.', [])
    if x:
        unit = 'min' if view == 'time' else '°C'
        lines.append(f'{len(x)} pts, {min(x):.1f}–{max(x):.1f} {unit}')
    if sheet.get('TGA_Sample_Mass_mg'):
        lines.append(f"Initial mass: {sheet['TGA_Sample_Mass_mg']:g} mg")
    if sheet.get('TGA_DSC'):
        lines.append('DSC channel present')
    if sheet.get('TGA_Source'):
        lines.append(f"From: {sheet['TGA_Source']}")
    return lines


def render_tga_curve(ax, window, sheet_name):
    """Draw the TGA sheet like the main plot: the main-axis trace plus the DSC
    (and, in the time view, the mass) on right-hand twin axes."""
    import numpy as np
    from libraries.ToolsMenu.TGA_Plot import (_right_axis_traces, MASS_COLOUR,
                                              VIEW_TIME)
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    x = np.asarray(sheet.get('B.E.', []), dtype=float)
    y = np.asarray(sheet.get('Raw Data', []), dtype=float)

    title_size = getattr(window, 'axis_title_size', 12)
    number_size = getattr(window, 'axis_number_size', 10)

    ax.clear()
    ax.set_aspect('auto')
    if x.size == 0:
        ax.text(0.5, 0.5, 'No data', ha='center', va='center',
                transform=ax.transAxes, fontsize=9, color='gray')
        ax.set_xticks([]); ax.set_yticks([])
        return False

    rights = [(np.asarray(values, dtype=float), label, colour)
              for values, label, colour, _is_dsc in _right_axis_traces(sheet)
              if values is not None and len(values) == x.size]

    # Leave room on the left for the y-label and on the right for one strip per
    # twin axis, then fill the middle.
    left = min(0.15 + 0.006 * number_size, 0.30)
    right_margin = 0.03 + 0.14 * len(rights)
    bottom = min(0.09 + 0.007 * title_size, 0.30)
    ax.set_position([left, bottom, max(0.35, 0.97 - left - right_margin),
                     0.93 - bottom])

    main_colour = 'black' if sheet.get('TGA_View') == VIEW_TIME else MASS_COLOUR
    ax.plot(x, y, color=main_colour, lw=1.2)
    fit_x, fit_y = sheet.get('TGA_Fit_X'), sheet.get('TGA_Fit_Y')
    if fit_x and fit_y:
        ax.plot(fit_x, fit_y, color=(0.7, 0.13, 0.13), lw=1.4)
    ax.set_xlabel(sheet.get('TGA_X_Label', ''), fontsize=title_size)
    ax.set_ylabel(sheet.get('TGA_Y_Label', ''), fontsize=title_size,
                  color=main_colour)
    ax.tick_params(labelsize=number_size)

    twins = getattr(ax.figure, '_companion_twins', [])
    for offset, (values, label, colour) in enumerate(rights):
        twin = ax.twinx()
        twin.set_position(ax.get_position())
        if offset:
            twin.spines['right'].set_position(('outward', 36 * offset))
        twin.plot(x, values, color=colour, lw=1.1)
        twin.set_ylabel(label, color=colour, fontsize=title_size)
        twin.tick_params(axis='y', colors=colour, labelsize=number_size)
        twin.spines['right'].set_color(colour)
        twins.append(twin)
    ax.figure._companion_twins = twins
    return True


def _companion_table(ax, window, cols, rows, title, empty_message):
    """Render a live data table onto the companion axes (shared by the TGA
    cycle and mass-step tables)."""
    ax.clear()
    ax.set_aspect('auto')
    ax.axis('off')
    ax.set_position([0.02, 0.03, 0.96, 0.90])
    title_size = getattr(window, 'axis_title_size', 12)
    number_size = getattr(window, 'axis_number_size', 10)
    if not rows:
        ax.text(0.5, 0.5, empty_message, ha='center', va='center',
                transform=ax.transAxes, fontsize=9, color='gray')
        return False
    table = ax.table(cellText=rows, colLabels=cols, loc='center',
                     cellLoc='center')
    table.auto_set_font_size(False)
    table.set_fontsize(max(6, number_size - 1))
    table.scale(1.0, 1.4)
    brand = (79 / 255, 190 / 255, 159 / 255)
    for (row, _col), cell in table.get_celld().items():
        cell.set_edgecolor((0.82, 0.82, 0.82))
        if row == 0:
            cell.set_facecolor(brand)
            cell.set_text_props(weight='bold')
    ax.set_title(title, fontsize=title_size)
    return True


def _tga_cycles(window, sheet_name):
    """The cycle-analysis rows for a TGA sheet — stored, or computed live."""
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    cycles = sheet.get('TGA_Cycles')
    if cycles:
        return cycles
    try:
        from libraries.ToolsMenu.TGA_Engine import split_cycles, cycle_analysis
        view_time = sheet.get('TGA_View') == 'time'
        temperature = (sheet.get('TGA_Temperature') if view_time
                       else sheet.get('B.E.'))
        mass = ((sheet.get('TGA_Mass_Pct') or sheet.get('TGA_Mass_mg'))
                if view_time else sheet.get('Raw Data'))
        if temperature and mass:
            groups = split_cycles(temperature, segment=sheet.get('TGA_Segment'))
            if len(groups) > 1:
                return cycle_analysis(temperature, mass, groups,
                                      tolerance_fraction=0.02)['cycles']
    except Exception:
        pass
    return []


def render_tga_cycle_table(ax, window, sheet_name):
    """Live table of the temperature-cycling analysis (what the sample gives up
    and takes back each cycle)."""
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    unit = sheet.get('TGA_Mass_Unit') or ('%' if sheet.get('TGA_Mass_Pct') else 'mg')
    cycles = _tga_cycles(window, sheet_name)
    cols = ['#', 'T range', 'start', 'end', 'rev.', 'irrev.', 'rec.%', 'drift']
    rows = [[
        str(r.get('cycle', '')),
        f"{r['t_min']:.0f}–{r['t_max']:.0f}",
        f"{r['mass_start']:.3f}",
        f"{r['mass_end']:.3f}",
        f"{r['reversible']:.3f}",
        f"{r['irreversible']:+.3f}",
        (f"{r['recovery_pct']:.0f}" if r.get('recovery_pct') is not None else '–'),
        f"{r['drift']:+.3f}",
    ] for r in cycles]
    return _companion_table(
        ax, window, cols, rows, f'Cycles (mass in {unit})',
        'No repeated cycles in this run.\n'
        'Cycling needs a programme that ramps up and down more than once.')


def render_tga_step_table(ax, window, sheet_name):
    """Live table of the measured mass-loss steps (regions on the Mass tab)."""
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    steps = sheet.get('TGA_Steps') or []
    cols = ['Region', 'T start', 'T end', 'Δm (mg)', 'Δm (%)']
    rows = [[
        step.get('name', ''),
        f"{step['t_start']:.1f}",
        f"{step['t_end']:.1f}",
        (f"{step['delta_mg']:+.4f}" if step.get('delta_mg') is not None else '–'),
        (f"{step['delta_pct']:+.3f}" if step.get('delta_pct') is not None else '–'),
    ] for step in steps]
    return _companion_table(
        ax, window, cols, rows, 'Mass steps',
        'No mass steps measured yet.\nAdd regions on the Mass tab.')


def _tga_spec():

    def companions(window, sheet_name, members):
        return [m for m in members if m != sheet_name]

    def default_companion(window, sheet_name, members):
        # Adaptive: the cycle table when the run actually cycles, else the
        # mass-step table once regions are measured, else the mass/DSC curve.
        if _tga_cycles(window, sheet_name):
            return 'Cycle table'
        sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
        if sheet.get('TGA_Steps'):
            return 'Mass step table'
        return 'Mass + DSC'

    def modes(window, sheet_name):
        return [('Cycle table', render_tga_cycle_table),
                ('Mass step table', render_tga_step_table),
                ('Mass + DSC', render_tga_curve)]

    def actions(window):
        from libraries.ToolsMenu.TGA_Analysis import open_tga_section
        return [
            ('Range', lambda: open_tga_section(window, 'range')),
            ('DTG', lambda: open_tga_section(window, 'dtg')),
            ('DSC', lambda: open_tga_section(window, 'dsc')),
            ('Cycles', lambda: open_tga_section(window, 'cycles')),
        ]

    def open_tool(window):
        from libraries.Widgets_Toolbars import open_tga_analysis_window
        open_tga_analysis_window(window)

    return {
        'name': 'TGA', 'open_label': 'TGA / DSC Analysis…', 'open_tool': open_tool,
        'group': tga_group, 'companions': companions,
        'default_companion': default_companion,
        'companion_modes': modes,
        'render': render_tga_curve, 'info': tga_info_lines,
        'actions': actions,
    }


# ---------------------------------------------------------------------------
# EIS spec — the family is every EIS sheet in the project (the measured
# Nyquist sweep plus its Bode / DRT / KK / Arrhenius views); the companion is
# another view. A Nyquist companion must keep equal aspect (see the EIS guide).
# ---------------------------------------------------------------------------

def _eis_sheet_names(window):
    return [n for n, s in window.Data.get('Core levels', {}).items()
            if isinstance(s, dict) and str(n).upper().startswith('EIS')]


def eis_group(window, sheet_name):
    from libraries.FileMenu.EIS_Import import (view_of, VIEW_NYQUIST, VIEW_BODE,
                                               VIEW_DRT, VIEW_KK, VIEW_ARRHENIUS)
    levels = window.Data.get('Core levels', {})
    order = {VIEW_NYQUIST: 0, VIEW_BODE: 1, VIEW_DRT: 2, VIEW_KK: 3,
             VIEW_ARRHENIUS: 4}
    members = _eis_sheet_names(window)
    members.sort(key=lambda n: (order.get(view_of(levels.get(n, {}), n), 9), n))
    return sheet_name, members


def eis_info_lines(window, sheet_name):
    from libraries.FileMenu.EIS_Import import view_of
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    lines = [f'Sheet: {sheet_name}']
    if not isinstance(sheet, dict):
        return lines
    lines.append(f'View: {view_of(sheet, sheet_name)}')
    x = sheet.get('B.E.', [])
    if x:
        lines.append(f'{len(x)} points')
    freq = sheet.get('EIS_Frequency')
    if isinstance(freq, (list, tuple)) and freq:
        lines.append(f'{min(freq):.4g}–{max(freq):.4g} Hz')
    temperature = sheet.get('EIS_Temperature_C')
    if isinstance(temperature, (int, float)):
        lines.append(f'{temperature:g} °C')
    return lines


def render_eis_curve(ax, window, sheet_name):
    from libraries.FileMenu.EIS_Import import view_of, VIEW_NYQUIST
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    equal = False
    if view_of(sheet, sheet_name) == VIEW_NYQUIST:
        try:
            from libraries.FileMenu.EIS_Import import load_results
            equal = bool(load_results(sheet).get('equal_aspect', True))
        except Exception:
            equal = True
    return render_curve(
        ax, window, sheet.get('B.E.', []), sheet.get('Raw Data', []),
        xlabel=sheet.get('EIS_X_Label', ''),
        ylabel=sheet.get('EIS_Y_Label', ''),
        equal_aspect=equal, sci_y=False)


def _eis_spec():

    def companions(window, sheet_name, members):
        return [m for m in members if m != sheet_name]

    def default_companion(window, sheet_name, members):
        others = [m for m in members if m != sheet_name]
        return others[0] if others else None

    def actions(window):
        from libraries.ToolsMenu.EIS_Analysis import open_eis_section
        return [
            ('Intercepts', lambda: open_eis_section(window, 'intercept')),
            ('Circuit Fit', lambda: open_eis_section(window, 'circuit')),
            ('DRT', lambda: open_eis_section(window, 'drt')),
            ('Arrhenius', lambda: open_eis_section(window, 'arrhenius')),
        ]

    def open_tool(window):
        from libraries.Widgets_Toolbars import open_eis_analysis_window
        open_eis_analysis_window(window)

    return {
        'name': 'EIS', 'open_label': 'EIS Analysis…', 'open_tool': open_tool,
        'group': eis_group, 'companions': companions,
        'default_companion': default_companion,
        'companion_modes': lambda w, s: [],
        'render': render_eis_curve, 'info': eis_info_lines,
        'actions': actions,
    }


# ---------------------------------------------------------------------------
# FTIR spec — the family is every FTIR sheet in the project (measured spectra
# and reference spectra live as sibling FTIR sheets); the companion is another
# spectrum, drawn with the wavenumber axis reversed like the main plot.
# ---------------------------------------------------------------------------

def _ftir_sheet_names(window):
    return [n for n, s in window.Data.get('Core levels', {}).items()
            if isinstance(s, dict) and str(n).upper().startswith('FTIR')]


def ftir_group(window, sheet_name):
    members = _ftir_sheet_names(window)
    members.sort()
    return sheet_name, members


def ftir_info_lines(window, sheet_name):
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    lines = [f'Sheet: {sheet_name}']
    if not isinstance(sheet, dict):
        return lines
    x = sheet.get('B.E.', [])
    if x:
        lines.append(f'{len(x)} points, {min(x):.0f}–{max(x):.0f} cm⁻¹')
    unit = sheet.get('FTIR_Y_Unit')
    if unit:
        lines.append(f'Ordinate: {unit}')
    bands = sheet.get('FTIR_Bands')
    if isinstance(bands, (list, tuple)) and bands:
        lines.append(f'{len(bands)} bands')
    return lines


def render_ftir_curve(ax, window, sheet_name):
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    return render_curve(
        ax, window, sheet.get('B.E.', []), sheet.get('Raw Data', []),
        xlabel='Wavenumber (cm$^{-1}$)',
        ylabel=sheet.get('FTIR_Y_Unit', 'Transmittance (%)'),
        reverse_x=True, sci_y=False)


def _ftir_spec():

    def companions(window, sheet_name, members):
        return [m for m in members if m != sheet_name]

    def default_companion(window, sheet_name, members):
        others = [m for m in members if m != sheet_name]
        return others[0] if others else None

    def actions(window):
        from libraries.ToolsMenu.FTIR_Analysis import open_ftir_section
        return [
            ('Processing', lambda: open_ftir_section(window, 'processing')),
            ('Bands', lambda: open_ftir_section(window, 'bands')),
            ('Band Library', lambda: open_ftir_section(window, 'library')),
            ('References', lambda: open_ftir_section(window, 'reference')),
        ]

    def open_tool(window):
        from libraries.Widgets_Toolbars import open_ftir_analysis_window
        open_ftir_analysis_window(window)

    return {
        'name': 'FTIR', 'open_label': 'FTIR Analysis…', 'open_tool': open_tool,
        'group': ftir_group, 'companions': companions,
        'default_companion': default_companion,
        'companion_modes': lambda w, s: [],
        'render': render_ftir_curve, 'info': ftir_info_lines,
        'actions': actions,
    }


# ---------------------------------------------------------------------------
# XRD spec — one sheet holds everything (no derived-view family), so the
# companion is a computed "Pattern + fit" mode: the diffractogram with the
# stored refinement curve overlaid.
# ---------------------------------------------------------------------------

def render_xrd_pattern(ax, window, sheet_name):
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    overlays = []
    fit_x, fit_y = sheet.get('XRD_Fit_X'), sheet.get('XRD_Fit_Y')
    if fit_x and fit_y:
        overlays.append((fit_x, fit_y, (0.7, 0.13, 0.13)))
    return render_curve(
        ax, window, sheet.get('B.E.', []), sheet.get('Raw Data', []),
        xlabel='2θ (°)', ylabel='Intensity (counts)',
        overlays=overlays, sci_y=True, left=0.14)


def xrd_info_lines(window, sheet_name):
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    lines = [f'Sheet: {sheet_name}']
    if not isinstance(sheet, dict):
        return lines
    x = sheet.get('B.E.', [])
    if x:
        lines.append(f'{len(x)} pts, {min(x):.1f}–{max(x):.1f}° 2θ')
    res = {}
    try:
        from libraries.FileMenu.XRD_Import import load_results
        res = load_results(sheet) or {}
    except Exception:
        pass
    phases = res.get('phases') or []
    if phases:
        names = ', '.join(str(p.get('name', '?')) for p in phases[:4]
                          if isinstance(p, dict))
        lines.append(f'{len(phases)} phase(s): {names}')
    ref = res.get('refinement') or {}
    for key, label in (('Rwp', 'Rwp'), ('Rp', 'Rp'), ('gof', 'GoF')):
        if isinstance(ref.get(key), (int, float)):
            lines.append(f'{label} = {ref[key]:.4g}')
    return lines


def _xrd_spec():

    def companions(window, sheet_name, members):
        return [m for m in members if m != sheet_name]

    def default_companion(window, sheet_name, members):
        return 'Pattern + fit'

    def modes(window, sheet_name):
        from libraries.ViewMenu import XRD_Companion as XC
        return [('Pattern + fit', render_xrd_pattern),
                ('Reflection table', XC.render_reflection_table),
                ('Stick pattern', XC.render_stick_pattern),
                ('d-spacing (Å)', XC.render_d_pattern),
                ('Q-space (Å⁻¹)', XC.render_q_pattern),
                ('Unit cell (3D)', XC.render_cell_thumbnail)]

    def actions(window):
        from libraries.ToolsMenu.XRD_Analysis import open_xrd_section
        return [
            ('Phases', lambda: open_xrd_section(window, 'phases')),
            ('Guided fit', lambda: open_xrd_section(window, 'guided')),
            ('Background', lambda: open_xrd_section(window, 'background')),
            ('Advanced', lambda: open_xrd_section(window, 'advanced')),
            ('Unit cell', lambda: open_xrd_section(window, 'structure')),
        ]

    def open_tool(window):
        from libraries.Widgets_Toolbars import open_xrd_analysis_window
        open_xrd_analysis_window(window)

    def quick_control(window, sheet_name):
        from libraries.ToolsMenu.XRD_Plot import (xrd_raw_style,
                                                  set_xrd_raw_style)
        labels = {'scatter': 'Scatter (crosses)', 'line': 'Line'}

        def on_select(choice):
            set_xrd_raw_style(window, sheet_name,
                              'line' if choice.startswith('Line') else 'scatter')

        return {'label': 'Raw style:',
                'choices': ['Scatter (crosses)', 'Line'],
                'value': labels[xrd_raw_style(window, sheet_name)],
                'on_select': on_select}

    return {
        'name': 'XRD', 'open_label': 'XRD Analysis…', 'open_tool': open_tool,
        'group': lambda w, s: (s, [s]), 'companions': companions,
        'default_companion': default_companion,
        'companion_modes': modes,
        'render': render_xrd_pattern, 'info': xrd_info_lines,
        'actions': actions, 'quick_control': quick_control,
        # Rietveld/Le Bail refinement writes its reflections into the peak grid
        # as Voigt (Area, L/G, S) peaks, so keep the Peak Parameters grid
        # visible alongside the overview. Results is not meaningful for XRD.
        'keep_grids': ['Peak Parameters'],
    }


# ---------------------------------------------------------------------------
# ARPES spec — the companion is a computed view of the cube (mainly the Fermi
# surface). The floating ARPES Analysis window stays the control surface: when
# it is open the companion follows its settings and every control change
# redraws it (see ARPES_Companion.refresh_arpes_companion).
# ---------------------------------------------------------------------------

def _arpes_spec():
    from libraries.ViewMenu import ARPES_Companion as AC

    def modes(window, sheet_name):
        items = [('Dispersion', AC.render_dispersion),
                 ('EDC/MDC stack', AC.render_stack),
                 ('Angle-integrated EDC', AC.render_edc)]
        if AC.has_3d(window, sheet_name):
            items.insert(0, ('Fermi surface', AC.render_fermi_surface))
            items.append(('3D map', AC.render_3d_map))
        return items

    def companions(window, sheet_name, members):
        # ARPES~3D is a main-plot sheet (3D axes) — it cannot preview in the
        # 2D companion canvas, so keep it out of the dropdown.
        levels = window.Data.get('Core levels', {})
        return [m for m in members
                if m != sheet_name
                and not (isinstance(levels.get(m), dict)
                         and levels[m].get('_arpes_3d'))]

    def default_companion(window, sheet_name, members):
        return ('Fermi surface' if AC.has_3d(window, sheet_name)
                else 'Dispersion')

    def actions(window):
        from libraries.ToolsMenu.ARPES_Analysis import open_arpes_section
        return [
            ('Dispersion', lambda: open_arpes_section(window, 'dispersion')),
            ('Fermi surface', lambda: open_arpes_section(window, 'fs')),
            ('3D Cube', lambda: open_arpes_section(window, 'cube')),
            ('Stacked slices', lambda: open_arpes_section(window, 'slices')),
        ]

    def open_tool(window):
        from libraries.ToolsMenu.ARPES_Analysis import open_arpes_window
        open_arpes_window(window)

    return {
        'name': 'ARPES', 'open_label': 'ARPES Analysis…', 'open_tool': open_tool,
        'group': AC.arpes_group, 'companions': companions,
        'default_companion': default_companion,
        'companion_modes': modes,
        'render': AC.render_member, 'info': AC.arpes_info_lines,
        'actions': actions,
        'canvas_mouse': AC.companion_mouse,
        # The dispersion lives on the main plot and the ARPES window carries
        # the controls, so the right frame is pure companion plot.
        'plot_only': True,
    }


# ---------------------------------------------------------------------------
# Optical (UV-Vis / PL / ellipsometry) and Raman specs — simple curve
# families: the members are the technique's sheets, the companion is another
# member, and any stored fit curve is overlaid (Tauc line, ellipsometry
# model). One factory builds all four; each closes over its own matcher,
# labels and section opener.
# ---------------------------------------------------------------------------

def _curve_family_spec(name, open_label, matches, axis_labels, fit_keys,
                       info_extra, open_tool, section_actions):

    def sheet_names(window):
        return sorted(n for n, s in window.Data.get('Core levels', {}).items()
                      if isinstance(s, dict) and matches(str(n)))

    def group(window, sheet_name):
        return sheet_name, sheet_names(window)

    def companions(window, sheet_name, members):
        return [m for m in members if m != sheet_name]

    def default_companion(window, sheet_name, members):
        others = [m for m in members if m != sheet_name]
        return others[0] if others else None

    def render(ax, window, sheet_name):
        sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
        overlays = []
        fit_x, fit_y = sheet.get(fit_keys[0]), sheet.get(fit_keys[1])
        if fit_x and fit_y:
            overlays.append((fit_x, fit_y, (0.7, 0.13, 0.13)))
        x_label, y_label = axis_labels(sheet)
        return render_curve(ax, window, sheet.get('B.E.', []),
                            sheet.get('Raw Data', []),
                            xlabel=x_label, ylabel=y_label,
                            overlays=overlays, sci_y=False)

    def info(window, sheet_name):
        sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
        lines = [f'Sheet: {sheet_name}']
        if not isinstance(sheet, dict):
            return lines
        x = sheet.get('B.E.', [])
        if x:
            lines.append(f'{len(x)} points, {min(x):.0f}–{max(x):.0f}')
        lines.extend(info_extra(sheet))
        return lines

    return {
        'name': name, 'open_label': open_label, 'open_tool': open_tool,
        'group': group, 'companions': companions,
        'default_companion': default_companion,
        'companion_modes': lambda w, s: [],
        'render': render, 'info': info,
        'actions': section_actions,
    }


def _uvvis_spec():
    def axis_labels(sheet):
        return (sheet.get('UVVIS_X_Label', 'Wavelength (nm)'),
                sheet.get('UVVIS_Y_Label', 'Absorbance (a.u.)'))

    def info_extra(sheet):
        lines = []
        try:
            from libraries.ToolsMenu.UVVIS_Analysis import load_results
            tauc = load_results(sheet).get('tauc')
            if tauc:
                lines.append(f"Eg = {tauc['eg']:.3f} eV")
        except Exception:
            pass
        return lines

    def open_tool(window):
        from libraries.Widgets_Toolbars import open_uvvis_analysis_window
        open_uvvis_analysis_window(window)

    def actions(window):
        from libraries.ToolsMenu.UVVIS_Analysis import open_uvvis_section
        return [('Band Gap (Tauc)', lambda: open_uvvis_section(window, 'tauc')),
                ('Band Maxima', lambda: open_uvvis_section(window, 'peaks'))]

    return _curve_family_spec(
        'UVvis', 'UV-Vis Analysis…',
        lambda n: n.upper().startswith('UVVIS'), axis_labels,
        ('UVVIS_Fit_X', 'UVVIS_Fit_Y'), info_extra, open_tool, actions)


def _pl_spec():
    def axis_labels(sheet):
        return (sheet.get('PL_X_Label', 'Wavelength (nm)'),
                sheet.get('PL_Y_Label', 'PL Intensity (a.u.)'))

    def info_extra(sheet):
        lines = []
        try:
            from libraries.ToolsMenu.PL_Analysis import load_results
            emission = load_results(sheet).get('emission')
            if emission:
                lines.append(f"Peak {emission['peak_nm']:.0f} nm "
                             f"({emission['peak_ev']:.2f} eV)")
                if 'fwhm_nm' in emission:
                    lines.append(f"FWHM {emission['fwhm_nm']:.0f} nm")
        except Exception:
            pass
        return lines

    def open_tool(window):
        from libraries.Widgets_Toolbars import open_pl_analysis_window
        open_pl_analysis_window(window)

    def actions(window):
        from libraries.ToolsMenu.PL_Analysis import open_pl_section
        return [('Emission', lambda: open_pl_section(window, 'peaks')),
                ('Energy Scale', lambda: open_pl_section(window, 'energy')),
                ('CIE Colour', lambda: open_pl_section(window, 'colour'))]

    return _curve_family_spec(
        'PL', 'PL Analysis…',
        lambda n: n.upper().startswith('PL'), axis_labels,
        ('PL_Fit_X', 'PL_Fit_Y'), info_extra, open_tool, actions)


def _ellips_spec():
    def axis_labels(sheet):
        return (sheet.get('ELLIPS_X_Label', 'Wavelength (nm)'),
                sheet.get('ELLIPS_Y_Label', '$\\Psi$ (°)'))

    def info_extra(sheet):
        lines = []
        try:
            from libraries.ToolsMenu.Ellips_Analysis import load_results
            film = load_results(sheet).get('film')
            if film:
                lines.append(f"d = {film['d_nm']:.1f} nm, "
                             f"n(632.8) = {film['n_632']:.3f}")
                lines.append(f"{film['substrate']}, "
                             f"AOI {film['aoi_deg']:.1f}°")
        except Exception:
            pass
        return lines

    def open_tool(window):
        from libraries.Widgets_Toolbars import open_ellips_analysis_window
        open_ellips_analysis_window(window)

    def actions(window):
        from libraries.ToolsMenu.Ellips_Analysis import open_ellips_section
        return [('Data & Geometry', lambda: open_ellips_section(window, 'data')),
                ('Film Fit', lambda: open_ellips_section(window, 'fit'))]

    return _curve_family_spec(
        'Ellips', 'Ellipsometry Analysis…',
        lambda n: n.upper().startswith('ELLIPS'), axis_labels,
        ('ELLIPS_Fit_X', 'ELLIPS_Fit_Y'), info_extra, open_tool, actions)


def _raman_spec():
    def axis_labels(sheet):
        return 'Wavenumber (cm$^{-1}$)', 'Intensity (a.u.)'

    def info_extra(sheet):
        lines = []
        try:
            from libraries.ToolsMenu.Raman_Analysis import load_peaks
            peaks = load_peaks(sheet)
            if peaks:
                lines.append(f'{len(peaks)} assigned peak(s)')
                strongest = max(peaks,
                                key=lambda p: p.get('relative_height', 0))
                if strongest.get('assignment'):
                    lines.append(f"{strongest['shift']:.0f}: "
                                 f"{strongest['assignment'][:44]}")
        except Exception:
            pass
        return lines

    def open_tool(window):
        from libraries.Widgets_Toolbars import open_raman_analysis_window
        open_raman_analysis_window(window)

    def actions(window):
        from libraries.ToolsMenu.Raman_Analysis import open_raman_section
        return [('Peaks & Assignment',
                 lambda: open_raman_section(window, 'peaks')),
                ('Band Library', lambda: open_raman_section(window, 'library'))]

    def matches(n):
        return (n.startswith('RA') or 'RAMAN' in n.upper()
                or n.startswith('Ra_'))

    spec = _curve_family_spec(
        'Raman', 'Raman Analysis…', matches, axis_labels,
        ('Raman_Fit_X', 'Raman_Fit_Y'), info_extra, open_tool, actions)
    # Raman sheets are fitted with the normal peak machinery, so the Peak
    # Parameters grid stays available next to the overview.
    spec['keep_grids'] = ['Peak Parameters']
    return spec


def _ms_spec():
    def axis_labels(sheet):
        return (sheet.get('MS_X_Label', 'm/z'),
                sheet.get('MS_Y_Label', 'Intensity (a.u.)'))

    def info_extra(sheet):
        lines = []
        try:
            from libraries.ToolsMenu.MS_Analysis import load_peaks
            peaks = load_peaks(sheet)
            if peaks:
                lines.append(f'{len(peaks)} detected peak(s)')
                lines.append(f"Base peak m/z {peaks[0]['mz']:.1f}")
        except Exception:
            pass
        return lines

    def open_tool(window):
        from libraries.Widgets_Toolbars import open_ms_analysis_window
        open_ms_analysis_window(window)

    def actions(window):
        from libraries.ToolsMenu.MS_Analysis import open_ms_section
        return [('Peaks', lambda: open_ms_section(window, 'peaks')),
                ('Losses & Adducts',
                 lambda: open_ms_section(window, 'assign')),
                ('Ion Library', lambda: open_ms_section(window, 'library')),
                ('Reference Library',
                 lambda: open_ms_section(window, 'online'))]

    return _curve_family_spec(
        'MS', 'MS Analysis…',
        lambda n: n.upper().startswith('MS'), axis_labels,
        ('MS_Fit_X', 'MS_Fit_Y'), info_extra, open_tool, actions)


def _gc_spec():
    def axis_labels(sheet):
        return (sheet.get('GC_X_Label', 'Retention time (min)'),
                sheet.get('GC_Y_Label', 'Signal (a.u.)'))

    def info_extra(sheet):
        lines = []
        try:
            from libraries.ToolsMenu.GC_Analysis import load_peaks
            peaks = load_peaks(sheet)
            if peaks:
                lines.append(f'{len(peaks)} integrated peak(s)')
                biggest = max(peaks, key=lambda p: p.get('area_pct', 0))
                lines.append(f"Largest: RT {biggest['rt']:.2f} min, "
                             f"{biggest['area_pct']:.1f}%")
        except Exception:
            pass
        return lines

    def open_tool(window):
        from libraries.Widgets_Toolbars import open_gc_analysis_window
        open_gc_analysis_window(window)

    def actions(window):
        from libraries.ToolsMenu.GC_Analysis import open_gc_section
        return [('Peak Integration',
                 lambda: open_gc_section(window, 'peaks')),
                ('Area Report', lambda: open_gc_section(window, 'report'))]

    return _curve_family_spec(
        'GC', 'GC Analysis…',
        lambda n: n.upper().startswith('GC'), axis_labels,
        ('GC_Fit_X', 'GC_Fit_Y'), info_extra, open_tool, actions)


def _eels_spec():
    """EELS: maps live on the main plot, so the companion answers with the
    other half of the picture — the live extracted spectrum while a map is
    shown, the map (with the ROI echoed on it) while a spectrum is fitted.
    The Peak Parameters grid stays: the extracted spectra are fitted with
    the normal peak machinery."""

    def _sheets(window):
        return [n for n, s in window.Data.get('Core levels', {}).items()
                if isinstance(s, dict) and s.get('_EELS_type')]

    def group(window, sheet_name):
        return 'EELS', _sheets(window)

    def companions(window, sheet_name, members):
        return [m for m in members if m != sheet_name]

    def default_companion(window, sheet_name, members):
        sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
        others = [m for m in members if m != sheet_name]
        if sheet.get('_EELS_type') in ('map', 'image'):
            label = sheet.get('_EELS_signal')
            for candidate in (f'EELS~{label}', 'EELS~LL', 'EELS~HL'):
                if candidate in others:
                    return candidate
        else:
            label = sheet.get('_EELS_signal') or 'LL'
            for candidate in (f'EELS~Map {label}', 'EELS~Map ADF'):
                if candidate in others:
                    return candidate
        return others[0] if others else None

    def render(ax, window, name):
        sheet = window.Data.get('Core levels', {}).get(name, {})
        if not isinstance(sheet, dict):
            return False
        if sheet.get('_EELS_type') in ('map', 'image'):
            from libraries.ToolsMenu.EELS_MainPlot import _display_image
            import numpy as _np
            image, _full = _display_image(window, sheet)
            image = _np.asarray(image, dtype=float)
            if image.ndim != 2:
                return False
            # Wipe whatever the panel drew last. Without this the spectrum
            # line from the previous companion survives under the map, clipped
            # against the image's own limits - which is what drew those black
            # vertical bars across the high-loss half of an LL map, one for
            # every noise excursion of the old trace. render_curve clears for
            # the curve techniques; this is the one renderer that did not.
            ax.clear()
            n_y, n_x = image.shape
            ax.imshow(image, origin='upper', cmap=getattr(
                window, 'eels_colormap', 'viridis'),
                aspect='equal' if not sheet.get('_EELS_profile') else 'auto',
                extent=[0, n_x, n_y, 0])
            ax.set_xticks([])
            ax.set_yticks([])
            ax.set_title(name, fontsize=8)
            # Echo the current ROI when this map shares the active grid
            controller = getattr(window, '_eels_roi_controller', None)
            roi = getattr(controller, 'roi', None)
            if roi and controller.active_sheet:
                active = window.Data.get('Core levels', {}).get(
                    controller.active_sheet, {})
                if (isinstance(active, dict)
                        and list(active.get('Map_Shape', []))
                        == list(sheet.get('Map_Shape', []))):
                    import matplotlib.patches as _patches
                    kind = roi.get('type')
                    if kind == 'point':
                        size = max(1, int(roi.get('size', 1)))
                        half = size / 2.0
                        ax.add_patch(_patches.Rectangle(
                            (roi['x'] + 0.5 - half, roi['y'] + 0.5 - half),
                            size, size, fill=False, edgecolor=BRAND,
                            linewidth=1.2))
                    elif kind == 'area':
                        ax.add_patch(_patches.Rectangle(
                            (roi['x1'], roi['y1']),
                            roi['x2'] - roi['x1'] + 1,
                            roi['y2'] - roi['y1'] + 1,
                            fill=False, edgecolor=BRAND, linewidth=1.2))
                    elif kind == 'line':
                        ax.plot([roi['x1'] + 0.5, roi['x2'] + 0.5],
                                [roi['y1'] + 0.5, roi['y2'] + 0.5],
                                color=BRAND, linewidth=1.4)
            return True
        x_label = sheet.get('EELS_X_Label', 'Energy Loss (eV)')
        y_label = sheet.get('EELS_Y_Label', 'Intensity (a.u.)')
        return render_curve(ax, window, sheet.get('B.E.', []),
                            sheet.get('Raw Data', []),
                            xlabel=x_label, ylabel=y_label, sci_y=True)

    def info(window, sheet_name):
        from libraries.FileMenu.EELS_Import import (eels_map_sheets,
                                                    sheet_axes)
        lines = []
        maps = eels_map_sheets(window)
        for label in ('LL', 'HL', 'ADF'):
            entry = maps.get(label)
            if not entry:
                continue
            _name, sheet = entry
            shape = sheet.get('Map_Shape') or []
            bits = [f"{label}: {shape[1]}x{shape[0]} px" if len(shape) == 2
                    else label]
            nm = sheet_axes(sheet).get('nm_per_px')
            if nm:
                bits.append(f"{nm:.3g} nm/px")
            if sheet.get('Energy_Range'):
                bits.append(sheet['Energy_Range'])
            if sheet.get('_EELS_survey'):
                bits.append('survey')
            lines.append(', '.join(bits))
        rotation = 0
        for _label, (_name, sheet) in maps.items():
            rotation = int(sheet.get('_EELS_rotation', 0) or 0)
            break
        if rotation:
            lines.append(f"Rotated {rotation * 90}\N{DEGREE SIGN}")
        controller = getattr(window, '_eels_roi_controller', None)
        roi = getattr(controller, 'roi', None)
        if roi:
            details = ', '.join(f'{k}={v}' for k, v in roi.items()
                                if k != 'type')
            lines.append(f"ROI: {roi['type']} ({details})")
        current = window.Data.get('Core levels', {}).get(sheet_name, {})
        if isinstance(current, dict) and current.get('_EELS_type') == 'plot':
            x = current.get('B.E.', [])
            if x:
                lines.append(f"{sheet_name}: {len(x)} channels, "
                             f"{min(x):.1f} to {max(x):.1f} eV")
        return lines

    def open_tool(window):
        from libraries.Widgets_Toolbars import on_open_eels_window
        on_open_eels_window(window, None)

    def actions(window):
        def rotate():
            from libraries.FileMenu.EELS_Import import rotate_eels_dataset
            from libraries.ToolsMenu.EELS_MainPlot import (
                EELSRoiController, is_eels_map_sheet, plot_eels_map_main)
            if rotate_eels_dataset(window):
                EELSRoiController.get(window).clear()
                current = window.sheet_combobox.GetValue()
                if is_eels_map_sheet(window, current):
                    plot_eels_map_main(window, current)
                refresh_technique_panel(window)

        def pin():
            from libraries.ToolsMenu.EELS_MainPlot import pin_live_sheet
            for label in ('LL', 'HL'):
                pin_live_sheet(window, label)
            refresh_technique_panel(window)

        def section(key):
            from libraries.ToolsMenu.EELS_Analysis import open_eels_section
            return lambda: open_eels_section(window, key)

        return [('Rotate 90\N{DEGREE SIGN}', rotate),
                ('Pin spectra', pin),
                ('Map tools', section('map')),
                ('Spectrum tools', section('spectrum'))]

    return {
        'name': 'EELS', 'open_label': 'EELS Analysis…',
        'open_tool': open_tool,
        'group': group, 'companions': companions,
        'default_companion': default_companion,
        'companion_modes': lambda w, s: [],
        'render': render, 'info': info, 'actions': actions,
        'keep_grids': ['Peak Parameters'],
    }


def _dil_spec():
    def axis_labels(sheet):
        return (sheet.get('DIL_X_Label', 'Temperature (°C)'),
                sheet.get('DIL_Y_Label', 'dL/L$_0$'))

    def info_extra(sheet):
        lines = []
        if sheet.get('DIL_Sample_Length_mm'):
            lines.append(f"L0 = {sheet['DIL_Sample_Length_mm']:g} mm")
        try:
            from libraries.ToolsMenu.DIL_Analysis import load_results
            results = load_results(sheet)
            cte = results.get('cte')
            if cte:
                lines.append(f"CTE {cte['t1']:.0f}–{cte['t2']:.0f} °C: "
                             f"{cte['alpha_per_K'] * 1e6:.2f} "
                             f"×10$^{{-6}}$ K$^{{-1}}$")
            sinter = results.get('sinter')
            if sinter and 't_onset' in sinter:
                lines.append(f"Shrinkage onset {sinter['t_onset']:.0f} °C")
        except Exception:
            pass
        return lines

    def open_tool(window):
        from libraries.Widgets_Toolbars import open_dil_analysis_window
        open_dil_analysis_window(window)

    def actions(window):
        from libraries.ToolsMenu.DIL_Analysis import open_dil_section
        return [('Data & Segments', lambda: open_dil_section(window, 'data')),
                ('Expansion (CTE)', lambda: open_dil_section(window, 'cte')),
                ('Sintering', lambda: open_dil_section(window, 'sinter'))]

    return _curve_family_spec(
        'DIL', 'Dilatometry Analysis…',
        lambda n: n.upper().startswith('DIL'), axis_labels,
        ('DIL_Fit_X', 'DIL_Fit_Y'), info_extra, open_tool, actions)


def _bet_spec():
    def axis_labels(sheet):
        return (sheet.get('BET_X_Label', 'Relative pressure (P/P$_0$)'),
                sheet.get('BET_Y_Label',
                          'Quantity adsorbed (cm$^3$/g STP)'))

    def info_extra(sheet):
        lines = []
        try:
            from libraries.ToolsMenu.BET_Analysis import load_results
            results = load_results(sheet)
            bet = results.get('bet')
            if bet:
                lines.append(f"S(BET) = {bet['s_bet']:.1f} m$^2$/g, "
                             f"C = {bet['c']:.0f}")
            bjh = results.get('bjh')
            if bjh:
                peak = max(bjh, key=lambda p: p['dv_dlogd'])
                lines.append(f"BJH peak pore {peak['d_nm']:.1f} nm")
        except Exception:
            pass
        return lines

    def open_tool(window):
        from libraries.Widgets_Toolbars import open_bet_analysis_window
        open_bet_analysis_window(window)

    def actions(window):
        from libraries.ToolsMenu.BET_Analysis import open_bet_section
        return [('BET Surface Area', lambda: open_bet_section(window, 'bet')),
                ('t-Plot', lambda: open_bet_section(window, 'tplot')),
                ('Pore Size (BJH)', lambda: open_bet_section(window, 'bjh'))]

    return _curve_family_spec(
        'BET', 'BET Analysis…',
        lambda n: n.upper().startswith('BET'), axis_labels,
        ('BET_Fit_X', 'BET_Fit_Y'), info_extra, open_tool, actions)


# ---------------------------------------------------------------------------
# Spec lookup
# ---------------------------------------------------------------------------

_SPEC_CACHE = {}
_SPEC_BUILDERS = {'tem': _tem_spec, 'sem': _sem_spec, 'afm': _afm_spec,
                  'squid': _squid_spec,
                  'tga': _tga_spec, 'eis': _eis_spec, 'ftir': _ftir_spec,
                  'xrd': _xrd_spec, 'arpes': _arpes_spec,
                  'uvvis': _uvvis_spec, 'pl': _pl_spec,
                  'ellips': _ellips_spec, 'raman': _raman_spec,
                  'ms': _ms_spec, 'gc': _gc_spec, 'eels': _eels_spec,
                  'dil': _dil_spec, 'bet': _bet_spec}


def technique_spec_for(window, sheet_name):
    """The overview spec for a sheet's technique, or None (XPS etc.)."""
    if not sheet_name:
        return None
    from libraries.ToolsMenu.TechniqueTool import technique_of_sheet
    tech = technique_of_sheet(window, sheet_name)
    key = tech['key'].lower() if tech else None
    if key not in _SPEC_BUILDERS:
        return None
    if key not in _SPEC_CACHE:
        _SPEC_CACHE[key] = _SPEC_BUILDERS[key]()
    return _SPEC_CACHE[key]


# ---------------------------------------------------------------------------
# Right-frame page management
# ---------------------------------------------------------------------------

def _ensure_panel(window, notebook):
    panel = getattr(window, '_technique_overview_panel', None)
    if panel is None:
        panel = TechniqueOverviewPanel(notebook, window)
        window._technique_overview_panel = panel
    return panel


def refresh_technique_panel(window):
    """Redraw the overview panel in place, if one is showing.

    For tools that change what the companion displays live — the AFM profile
    editor rewrites the line on every edit, leveling changes the histogram —
    without switching pages. The user's companion choice is preserved when it
    still exists; ``update`` alone would snap back to the default.
    """
    panel = getattr(window, '_technique_overview_panel', None)
    if panel is None or not bool(panel) or not panel.IsShown():
        return
    sheet_name = getattr(panel, '_current', None)
    spec = getattr(panel, 'spec', None)
    if not sheet_name or spec is None:
        return
    previous = getattr(panel, '_companion', None)
    try:
        panel.update(sheet_name, spec)
        items = list(panel.companion_choice.GetStrings())
        if previous in items and previous != panel._companion:
            panel._companion = previous
            panel.companion_choice.SetStringSelection(previous)
            panel._draw_companion()
    except Exception as e:
        print(f'technique panel refresh skipped: {e}')


def select_companion_view(window, name):
    """Point the companion panel at one of its views by name.

    For a tool that has just produced the thing a particular view shows —
    measuring grain sizes makes the size distribution the answer — so the
    result is on screen rather than one dropdown away. Does nothing if the
    panel is not showing or does not offer that view; never blocks the caller.
    """
    panel = getattr(window, '_technique_overview_panel', None)
    if panel is None or not bool(panel) or not panel.IsShown():
        return False
    try:
        if name not in list(panel.companion_choice.GetStrings()):
            return False
        panel._companion = name
        panel.companion_choice.SetStringSelection(name)
        panel._draw_companion()
        return True
    except Exception as e:
        print(f'companion view switch skipped: {e}')
        return False


def set_technique_right_frame(window, sheet_name):
    """Show the technique overview for a TEM/SEM sheet, or the grids for XPS.

    The two grids (Peak Parameters, Results) are pulled out of the notebook and
    a single overview page labelled with the technique name takes their place;
    Sample Manager stays. Switching within a technique only refreshes the
    panel. Best-effort — never blocks sheet selection.
    """
    notebook = getattr(window, 'grid_notebook', None)
    if notebook is None:
        return
    try:
        def texts():
            return [notebook.GetPageText(i)
                    for i in range(notebook.GetPageCount())]

        def remove(label):
            # FlatNotebook.RemovePage drops the tab but leaves the page window
            # shown, so hide it by hand or it paints over the overview.
            current = texts()
            if label in current:
                idx = current.index(label)
                page = notebook.GetPage(idx)
                notebook.RemovePage(idx)
                if page is not None:
                    page.Hide()

        spec = technique_spec_for(window, sheet_name)
        want = spec['name'] if spec else None
        prev = getattr(window, '_technique_page_label', None)
        peak_page = getattr(window, 'peak_params_page', None)
        results_page = getattr(window, 'results_page', None)
        panel = getattr(window, '_technique_overview_panel', None)

        if spec:
            panel = _ensure_panel(window, notebook)
            keep_grids = spec.get('keep_grids')
            keep_labels = (['Peak Parameters', 'Results'] if keep_grids is True
                           else list(keep_grids) if keep_grids else [])
            grid_pages = {'Peak Parameters': peak_page, 'Results': results_page}
            if prev and prev != want and prev in texts():
                remove(prev)                 # relabel: TEM <-> SEM
            # Drop the grids this technique does not keep.
            for lbl in ('Peak Parameters', 'Results'):
                if lbl not in keep_labels:
                    remove(lbl)
            if want not in texts():
                panel.Show()
                notebook.InsertPage(0, panel, want, True)
            # Keep the requested grids as tabs after the overview, in order (XRD
            # keeps only Peak Parameters — the grid refinement writes into).
            pos = 1
            for lbl in ('Peak Parameters', 'Results'):
                if lbl in keep_labels:
                    if lbl not in texts() and grid_pages[lbl] is not None:
                        grid_pages[lbl].Show()
                        notebook.InsertPage(min(pos, notebook.GetPageCount()),
                                            grid_pages[lbl], lbl, False)
                    pos += 1
            window._technique_page_label = want
            panel.update(sheet_name, spec)
            current = texts()
            if want in current and notebook.GetSelection() != current.index(want):
                notebook.SetSelection(current.index(want))
        else:
            # Back to the grids only when a technique page was showing. This
            # runs on every sheet refresh (Export to the Results grid calls
            # on_sheet_selected): selecting Peak Parameters each time pulled
            # the user off the Results tab they were working in.
            restored = False
            if prev and prev in texts():
                remove(prev)
                restored = True
                if panel is not None:
                    panel.Hide()
            window._technique_page_label = None
            if 'Peak Parameters' not in texts() and peak_page is not None:
                peak_page.Show()
                notebook.InsertPage(0, peak_page, 'Peak Parameters', False)
                restored = True
            if 'Results' not in texts() and results_page is not None:
                results_page.Show()
                notebook.InsertPage(1, results_page, 'Results', False)
                restored = True
            if restored and 'Peak Parameters' in texts():
                notebook.SetSelection(texts().index('Peak Parameters'))
    except Exception as e:
        print(f'Technique right frame update skipped: {e}')


# ---------------------------------------------------------------------------
# The panel
# ---------------------------------------------------------------------------

class TechniqueOverviewPanel(wx.Panel):
    """Companion plot + sheet chips + info, driven by a per-technique spec."""

    def __init__(self, parent, window):
        super().__init__(parent)
        self.window = window
        self.spec = None
        self._current = None
        self._companion = None
        self._chip_buttons = []

        sizer = wx.BoxSizer(wx.VERTICAL)

        # No title / "Analysis…" button here — the technique's own toolbar
        # button opens the full window, and the sheet name is already in the
        # selector and the info box.
        row = wx.BoxSizer(wx.HORIZONTAL)
        row.Add(wx.StaticText(self, label='Companion:'), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.companion_choice = wx.Choice(self, choices=[])
        self.companion_choice.Bind(wx.EVT_CHOICE, self._on_companion_choice)
        row.Add(self.companion_choice, 1)
        refresh = wx.Button(self, label='↻', size=(30, -1))
        refresh.SetToolTip('Recompute the companion — the Live FFT is taken of '
                           'the region currently visible on the main canvas, so '
                           'refresh after zooming or panning.')
        refresh.Bind(wx.EVT_BUTTON, lambda e: self._draw_companion())
        row.Add(refresh, 0, wx.LEFT, 4)
        sizer.Add(row, 0, wx.EXPAND | wx.ALL, 6)

        self.figure = Figure(figsize=(3.0, 3.0))
        self.figure.patch.set_facecolor('white')
        self.ax = self.figure.add_axes([0.06, 0.06, 0.9, 0.9])
        self.ax.set_xticks([])
        self.ax.set_yticks([])
        self.canvas = FigureCanvas(self, -1, self.figure)
        self.canvas.Bind(wx.EVT_LEFT_DCLICK, self._on_companion_dclick)
        sizer.Add(self.canvas, 1, wx.EXPAND | wx.LEFT | wx.RIGHT, 6)

        # Draggable black/white points for the contrast histogram. These fire
        # for every companion but only act while the histogram is shown.
        self._hist_grab = None
        self._hist_state = None
        self.canvas.mpl_connect('button_press_event', self._on_hist_press)
        self.canvas.mpl_connect('motion_notify_event', self._on_hist_motion)
        self.canvas.mpl_connect('button_release_event', self._on_hist_release)

        # Generic per-technique mouse hook: a spec exposing 'canvas_mouse' gets
        # press/motion/release on the companion canvas (the ARPES crosshair
        # uses it, so the companion is interactive and not just a preview).
        for evt, kind in (('button_press_event', 'press'),
                          ('motion_notify_event', 'motion'),
                          ('button_release_event', 'release')):
            self.canvas.mpl_connect(
                evt, lambda e, k=kind: self._on_spec_mouse(e, k))

        self.chip_panel = wx.Panel(self)
        self.chip_panel.SetSizer(wx.WrapSizer(wx.HORIZONTAL))
        sizer.Add(self.chip_panel, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.TOP, 6)

        # Optional per-technique inline control (e.g. XRD raw line/scatter).
        self.control_panel = wx.Panel(self)
        self.control_panel.SetSizer(wx.BoxSizer(wx.HORIZONTAL))
        sizer.Add(self.control_panel, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 6)

        self.action_panel = wx.Panel(self)
        self.action_panel.SetSizer(wx.WrapSizer(wx.HORIZONTAL))
        sizer.Add(self.action_panel, 0, wx.EXPAND | wx.ALL, 6)

        self.info = wx.TextCtrl(self, style=wx.TE_MULTILINE | wx.TE_READONLY,
                                size=(-1, 100))
        sizer.Add(self.info, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 6)

        self.SetSizer(sizer)

        # A computed companion (the Live FFT) is taken of the region visible on
        # the main canvas, so it must follow zooming/panning there. Redraw it,
        # debounced, whenever the main view changes.
        self._refresh_timer = None
        try:
            window.plot_manager.ax.callbacks.connect('xlim_changed',
                                                     self._on_main_view_changed)
        except Exception:
            pass

    def _on_main_view_changed(self, _axes):
        if not (self.IsShown() and self._companion in getattr(self, '_modes', {})):
            return
        try:
            if self._refresh_timer is not None and self._refresh_timer.IsRunning():
                self._refresh_timer.Stop()
            self._refresh_timer = wx.CallLater(200, self._draw_companion)
        except Exception:
            pass

    def update(self, sheet_name, spec):
        self.spec = spec
        self._current = sheet_name
        _root, members = spec['group'](self.window, sheet_name)

        # A 'plot_only' spec (ARPES) devotes the whole frame to the companion
        # plot: no chips, no quick actions, no inline control, no info box.
        plot_only = bool(spec.get('plot_only'))
        self.chip_panel.Show(not plot_only)
        self.action_panel.Show(not plot_only)
        self.info.Show(not plot_only)
        if plot_only:
            self.control_panel.Hide()
        else:
            self._rebuild_chips(members, sheet_name)
            self._rebuild_control(spec, sheet_name)
            self._rebuild_actions(spec)

        # The companion selector lists the computed modes (Live FFT, Histogram)
        # first, then the real sheets you can preview.
        self._modes = dict(spec.get('companion_modes', lambda w, s: [])
                           (self.window, sheet_name))
        sheets = spec['companions'](self.window, sheet_name, members)
        items = list(self._modes)
        if spec.get('hist_image'):
            items.append(HIST_LABEL)
        items += sheets
        self.companion_choice.Set(items)

        choice = spec['default_companion'](self.window, sheet_name, members)
        if choice not in items:
            choice = items[0] if items else None
        self._companion = choice
        if choice is not None:
            self.companion_choice.SetStringSelection(choice)
        self._draw_companion()

        if not plot_only:
            self.info.SetValue('\n'.join(spec['info'](self.window, sheet_name)))
        self.Layout()

    def _rebuild_control(self, spec, sheet_name):
        """Build the optional inline control a spec exposes via ``quick_control``
        — a labelled dropdown that acts immediately on selection."""
        panel = self.control_panel
        panel.GetSizer().Clear(delete_windows=True)
        builder = spec.get('quick_control')
        cfg = builder(self.window, sheet_name) if builder else None
        if cfg:
            panel.GetSizer().Add(
                wx.StaticText(panel, label=cfg.get('label', '')), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
            choice = wx.Choice(panel, choices=cfg.get('choices', []))
            choice.SetStringSelection(cfg.get('value', ''))
            on_select = cfg.get('on_select')
            choice.Bind(wx.EVT_CHOICE,
                        lambda e: on_select and on_select(e.GetString()))
            panel.GetSizer().Add(choice, 0, wx.ALIGN_CENTER_VERTICAL)
            panel.Show()
        else:
            panel.Hide()
        panel.Layout()

    def _rebuild_actions(self, spec):
        panel = self.action_panel
        panel.GetSizer().Clear(delete_windows=True)
        for label, fn in (spec.get('actions', lambda w: [])(self.window) or []):
            btn = wx.Button(panel, label=label, style=wx.BU_EXACTFIT)
            btn.Bind(wx.EVT_BUTTON, lambda e, f=fn: self._run_action(f))
            panel.GetSizer().Add(btn, 0, wx.ALL, 2)
        panel.Layout()

    def _run_action(self, fn):
        try:
            fn()
        except Exception as e:
            print(f'Quick action failed: {e}')

    def _rebuild_chips(self, members, current):
        panel = self.chip_panel
        panel.GetSizer().Clear(delete_windows=True)
        self._chip_buttons = []
        for name in members:
            btn = wx.Button(panel, label=name, style=wx.BU_EXACTFIT)
            if name == current:
                btn.SetBackgroundColour(BRAND)
                f = btn.GetFont(); f.SetWeight(wx.FONTWEIGHT_BOLD); btn.SetFont(f)
            btn.Bind(wx.EVT_BUTTON, lambda e, n=name: self._select_sheet(n))
            panel.GetSizer().Add(btn, 0, wx.ALL, 2)
            self._chip_buttons.append(btn)
        panel.Layout()

    def _draw_companion(self):
        modes = getattr(self, '_modes', {})
        # A 3D companion (the ARPES 3D map) replaces the figure's axes with a
        # 3D projection; restore our flat axes before any 2D render.
        if self.ax not in self.figure.axes:
            self.figure.clear()
            self.figure._companion_twins = []
            self.ax = self.figure.add_axes([0.06, 0.06, 0.9, 0.9])
            self.ax.set_xticks([])
            self.ax.set_yticks([])
        # Reset to a plain axes each time; image renderers re-assert equal
        # aspect via imshow, the curve/histogram ones keep this auto aspect.
        self.ax.set_aspect('auto')
        # Full-bleed axes for images/histograms; a curve renderer (SQUID) that
        # needs room for axis labels sets its own margined position.
        self.ax.set_position([0.06, 0.06, 0.9, 0.9])
        # Drop any right-hand twin axes a previous render (TGA mass/DSC) added,
        # so they neither stack up nor linger over another technique's preview.
        for extra in getattr(self.figure, '_companion_twins', []) or []:
            try:
                self.figure.delaxes(extra)
            except Exception:
                pass
        self.figure._companion_twins = []
        if self._companion and self.spec:
            try:
                if self._companion == HIST_LABEL and self.spec.get('hist_image'):
                    self._draw_histogram_panel()
                elif self._companion in modes:
                    modes[self._companion](self.ax, self.window, self._current)
                else:
                    self.spec['render'](self.ax, self.window, self._companion)
            except Exception as e:
                self.ax.clear()
                self.ax.text(0.5, 0.5, f'preview failed:\n{e}', ha='center',
                             va='center', transform=self.ax.transAxes,
                             fontsize=8, color='gray')
        else:
            self.ax.clear()
            self.ax.text(0.5, 0.5, 'No preview available.', ha='center',
                         va='center', transform=self.ax.transAxes,
                         fontsize=9, color='gray')
            self.ax.set_xticks([])
            self.ax.set_yticks([])
        self.canvas.draw_idle()

    def _on_companion_choice(self, event):
        self._companion = self.companion_choice.GetStringSelection() or None
        self._draw_companion()
        # Give keyboard focus back to the main canvas so arrow keys keep
        # driving the plot (ARPES crosshair) instead of cycling this dropdown.
        try:
            wx.CallAfter(self.window.plot_manager.canvas.SetFocus)
        except Exception:
            pass

    def _on_companion_dclick(self, event):
        # Double-click jumps to the sheet — but only when a real sheet is
        # shown, not a computed mode (Live FFT / Histogram have no sheet).
        if (self._companion and self._companion != HIST_LABEL
                and self._companion not in getattr(self, '_modes', {})):
            self._select_sheet(self._companion)

    def _on_spec_mouse(self, event, kind):
        """Route a companion-canvas mouse event to the technique's handler."""
        if self._companion == HIST_LABEL or not self.spec:
            return
        handler = self.spec.get('canvas_mouse')
        if handler is None:
            return
        try:
            # A True return means the state the companion draws from changed,
            # so re-render rather than just repainting the same artists.
            if handler(self.window, self._companion, self._current, event, kind):
                self._draw_companion()
        except Exception as e:
            print(f'companion mouse skipped: {e}')

    # -- contrast histogram (draggable black/white points) ------------------

    def _draw_histogram_panel(self):
        import numpy as np

        self.ax.clear()
        self.ax.set_aspect('auto')
        self._hist_state = None
        arr, target = self.spec['hist_image'](self.window, self._current)
        if arr is None:
            self.ax.text(0.5, 0.5, 'No image for a histogram', ha='center',
                         va='center', transform=self.ax.transAxes,
                         fontsize=9, color='gray')
            self.ax.set_xticks([])
            self.ax.set_yticks([])
            return
        data = np.asarray(arr, float).ravel()
        data = data[np.isfinite(data)]
        if data.size == 0:
            return
        lo, hi = (float(np.min(data)), float(np.max(data)))
        self.ax.hist(data, bins=128, color=BRAND)
        # Start the two cut points at the 1st/99th percentiles — the same clip
        # an auto-stretch would pick — so the user drags from a sensible place.
        black, white = np.percentile(data, (1.0, 99.0))
        # Red, not near-black: on a dark-tailed histogram a black line is
        # invisible exactly where it matters, at the ends of the range.
        bl = self.ax.axvline(black, color='red', lw=1.6)
        wl = self.ax.axvline(white, color='red', lw=1.6)
        self.ax.set_yticks([])
        self.ax.tick_params(labelsize=7)
        # A quantitative map (AFM heights) histograms its own unit, not greys.
        self.ax.set_xlabel(self.spec.get('hist_xlabel', 'grey level'),
                           fontsize=8)
        self.ax.set_title('Drag the red lines to set the contrast', fontsize=8)
        self.ax.margins(x=0)
        self._hist_state = {'target': target, 'lines': [bl, wl],
                            'xmin': lo, 'xmax': hi}

    def _nearest_hist_line(self, event):
        st = self._hist_state
        if not st or event.inaxes is not self.ax or event.x is None:
            return None
        trans = self.ax.transData
        px = [trans.transform((l.get_xdata()[0], 0))[0] for l in st['lines']]
        dists = [abs(p - event.x) for p in px]
        i = min(range(len(dists)), key=lambda k: dists[k])
        return i if dists[i] <= 14 else None

    def _on_hist_press(self, event):
        if self._companion != HIST_LABEL:
            return
        self._hist_grab = self._nearest_hist_line(event)

    def _on_hist_motion(self, event):
        if (self._companion != HIST_LABEL or self._hist_grab is None
                or not self._hist_state or event.xdata is None):
            return
        st = self._hist_state
        x = min(max(event.xdata, st['xmin']), st['xmax'])
        st['lines'][self._hist_grab].set_xdata([x, x])
        self.canvas.draw_idle()

    def _on_hist_release(self, event):
        if (self._companion != HIST_LABEL or self._hist_grab is None
                or not self._hist_state):
            return
        self._hist_grab = None
        st = self._hist_state
        xs = [float(l.get_xdata()[0]) for l in st['lines']]
        black, white = min(xs), max(xs)
        try:
            self.spec['apply_levels'](self.window, st['target'], black, white)
        except Exception as e:
            print(f'Contrast from histogram skipped: {e}')

    def _select_sheet(self, name):
        try:
            self.window.sheet_combobox.SetStringSelection(name)
        except Exception:
            pass
        from libraries.Sheet_Operations import on_sheet_selected
        on_sheet_selected(self.window, name)
