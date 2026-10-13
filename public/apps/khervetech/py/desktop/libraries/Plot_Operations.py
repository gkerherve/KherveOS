# KherveOS: these definitions cut unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/Plot_Operations.py. Regenerate with tools/export_khervetech.py.
import re


_TECHNIQUE_AXES = (
    # (prefix test, x label, y label, key prefix for per-sheet labels)
    (lambda n: n.startswith('EDX~Plot'), 'Energy (keV)', 'Counts', None),
    (lambda n: n.startswith('TEM~Plot'), 'Distance (nm)', 'Intensity (a.u.)', 'TEM'),
    (lambda n: n.startswith('AFM~Profile'), 'Distance (nm)', 'Height (nm)', 'AFM'),
    (lambda n: n.startswith(('SEM', 'TEM~Count', 'TEM~Freq')),
     'Particle size (nm)', 'Count', 'SEM'),
    (lambda n: n.upper().startswith('FTIR'),
     'Wavenumber (cm$^{-1}$)', 'Transmittance (%)', None),
    (lambda n: n.upper().startswith('EELS'),
     'Energy Loss (eV)', 'Intensity (a.u.)', 'EELS'),
    # EIS covers every derived view too - the per-sheet EIS_X_Label is what
    # tells a Nyquist plot from a Bode one from a DRT.
    (lambda n: n.upper().startswith('EIS'), "Z' (Ω)", "-Z'' (Ω)", 'EIS'),
    (lambda n: n.upper().startswith('SQUID'),
     'Temperature (K)', 'Moment (emu)', 'SQUID'),
    (lambda n: n.upper().startswith('TGA'),
     'Temperature (°C)', 'Mass (mg)', 'TGA'),
    (lambda n: n.upper().startswith('XRD'), '2θ (°)', 'Intensity (counts)', None),
    (lambda n: n.startswith('XAS'), 'Photon Energy (eV)', 'Intensity (a.u.)', None),
    # The optical wavelength techniques: UV-Vis before PL is irrelevant (no
    # shared prefix) but ELLIPS must not be spelled 'EL' - EELS would match.
    (lambda n: n.upper().startswith('UVVIS'),
     'Wavelength (nm)', 'Absorbance (a.u.)', 'UVVIS'),
    (lambda n: n.upper().startswith('ELLIPS'),
     'Wavelength (nm)', '$\\Psi$ (°)', 'ELLIPS'),
    (lambda n: n.upper().startswith('PL'),
     'Wavelength (nm)', 'PL Intensity (a.u.)', 'PL'),
    (lambda n: n.upper().startswith('MS'),
     'm/z', 'Intensity (a.u.)', 'MS'),
    (lambda n: n.upper().startswith('GC'),
     'Retention time (min)', 'Signal (a.u.)', 'GC'),
    (lambda n: n.upper().startswith('DIL'),
     'Temperature (°C)', 'dL/L$_0$', 'DIL'),
    (lambda n: n.upper().startswith('BET'),
     'Relative pressure (P/P$_0$)',
     'Quantity adsorbed (cm$^3$/g STP)', 'BET'),
    (lambda n: n.startswith('RA') or 'RAMAN' in n.upper() or n.startswith('Ra_'),
     'Wavenumber (cm$^{-1}$)', 'Intensity (a.u.)', None),
)


def plain_axis_label(label):
    """An axis label as plain text, for places that cannot render mathtext.

    The table above writes mathtext so the plot draws real superscripts —
    ``cm$^{-1}$``, ``P/P$_0$``, ``$\\Psi$``. A spreadsheet cell would show that
    markup verbatim, so Excel and KherveSheet headers go through here.
    """
    text = str(label or '')
    text = re.sub(r'[\^_]\{([^}]*)\}', r'\1', text)   # ^{-1} -> -1
    text = re.sub(r'[\^_](\w)', r'\1', text)          # ^3    -> 3
    text = re.sub(r'\\([A-Za-z]+)', r'\1', text)      # \Psi  -> Psi
    return text.replace('$', '').strip()


def is_optical_sheet(sheet_name):
    """The forward-axis curve techniques: UV-Vis / photoluminescence /
    ellipsometry (wavelength), mass spectrometry (m/z), gas chromatography
    (retention time), dilatometry (temperature) and gas-adsorption isotherms
    (relative pressure). Their x axis runs low to high, never the reversed
    XPS axis, and their labels live in per-sheet keys."""
    return str(sheet_name or '').upper().startswith(
        ('UVVIS', 'PL', 'ELLIPS', 'MS', 'GC', 'DIL', 'BET'))


def axis_labels_for_sheet(window, sheet_name):
    """(x label, y label) for a sheet, whichever technique it belongs to.

    Techniques that vary their own axes store the labels on the sheet - EIS
    switches between ohms and ohm.cm2 and between five different views, SQUID
    between temperature and field - so those are read from the sheet and the
    table entry is only the fallback.
    """
    name = str(sheet_name or '')
    sheet = {}
    try:
        sheet = window.Data['Core levels'].get(name, {}) or {}
    except (AttributeError, KeyError, TypeError):
        sheet = {}

    for matches, x_label, y_label, key_prefix in _TECHNIQUE_AXES:
        if not matches(name):
            continue
        if key_prefix == 'EIS':
            # refresh_labels rather than a plain lookup, so a sheet saved with
            # an older wording - or with Unicode subscripts the font cannot
            # draw - corrects itself here too.
            try:
                from libraries.FileMenu.EIS_Import import refresh_labels
                stored_x, stored_y = refresh_labels(sheet, name)
                return stored_x or x_label, stored_y or y_label
            except Exception:
                pass
        elif key_prefix == 'TEM':
            # A TEM line profile falls back to the SEM keys: the profile sheets
            # were built by the shared SEM sheet writer before TEM had its own.
            return (sheet.get('TEM_X_Label') or sheet.get('SEM_X_Label') or x_label,
                    sheet.get('TEM_Y_Label') or sheet.get('SEM_Y_Label') or y_label)
        elif key_prefix:
            return (sheet.get(f'{key_prefix}_X_Label', x_label),
                    sheet.get(f'{key_prefix}_Y_Label', y_label))
        if key_prefix == 'FTIR' or name.upper().startswith('FTIR'):
            return x_label, sheet.get('FTIR_Y_Unit', y_label)
        return x_label, y_label

    if getattr(window, 'energy_scale', 'BE') == 'KE':
        return 'Kinetic Energy (eV)', 'Intensity (CPS)'
    return 'Binding Energy (eV)', 'Intensity (CPS)'


def is_xps_like_sheet(window, sheet_name):
    """True when the sheet really is on a binding-energy axis.

    The peak-fitting machinery has a pile of behaviour that only makes sense
    for photoemission - reversing the axis, the eV-scale peak widths, the
    core-level name in the corner - and this is the one test for all of it.
    """
    name = str(sheet_name or '')
    return not any(matches(name) for matches, _x, _y, _k in _TECHNIQUE_AXES)


def sheet_x_is_forward(window, sheet_name):
    """True when the sheet's x axis runs low -> high.

    Only photoemission reverses its x axis; every other technique reads left
    to right.  FTIR is the one exception among the techniques - spectroscopic
    convention puts high wavenumber on the left, so it keeps the reversed
    XPS-style axis.

    This is the single test for axis direction outside the live plot.  The
    same predicate had been open-coded four times in ``PlotConfig`` and once
    more in the Excel saver, each copy naming a slightly different set of
    techniques, so a sheet could be drawn low-to-high on screen and then
    written into the workbook reversed.
    """
    name = str(sheet_name or '')
    if name.upper().startswith('FTIR'):
        return False
    if name.startswith(('zzProfile', 'zzBook')):
        return True
    if any(matches(name) for matches, _x, _y, _k in _TECHNIQUE_AXES):
        return True

    # SEM / TEM / AFM images and ARPES cubes carry a flag rather than a
    # technique name. An image's x axis is a distance across the micrograph,
    # and an ARPES dispersion plots energy increasing to the right against
    # angle — neither is a binding-energy axis to be reversed.
    try:
        sheet = window.Data['Core levels'].get(name, {}) or {}
    except (AttributeError, KeyError, TypeError):
        return False
    return bool(isinstance(sheet, dict)
                and (sheet.get('_sem') or sheet.get('_tem')
                     or sheet.get('_afm') or sheet.get('_arpes')))


def is_image_sheet(window, sheet_name):
    """True for a sheet drawn as a picture rather than as a spectrum.

    SEM / TEM / AFM micrographs, ARPES dispersions and EELS map/image sheets
    all put pixels on the main axes: they hold a cube or an image instead of a
    'B.E.'/'Raw Data' pair, so the plot-limit store has nothing to record for
    them and every limit control - the zoom keys, Ctrl+arrows, the toolbar
    edge arrows - has to nudge the axes directly instead.

    One predicate for all of them, because each of those controls had grown
    its own partial list and whichever technique was missing from it either
    did nothing or raised KeyError('B.E.') / KeyError('Xmin').
    """
    name = str(sheet_name or '')
    try:
        sheet = window.Data['Core levels'].get(name, {}) or {}
    except (AttributeError, KeyError, TypeError):
        return False
    if not isinstance(sheet, dict):
        return False
    if sheet.get('_sem') or sheet.get('_tem') or sheet.get('_afm') \
            or sheet.get('_arpes'):
        return True
    return bool(sheet.get('_EELS_type') in ('map', 'image')
                or name.startswith('EELS~Map'))


def _plot_ftir_overlays(ax, sheet_data):
    """Draw the FTIR non-destructive layers stored on a sheet.

    ``FTIR_Overlays`` is written by the FTIR Analysis tool and holds the raw
    spectrum and any diagnostic curve (baseline, atmospheric correction) that
    the user asked to see alongside the processed trace.
    """
    for overlay in (sheet_data.get('FTIR_Overlays') or []):
        x = overlay.get('x') or []
        y = overlay.get('y') or []
        if len(x) != len(y) or not x:
            continue
        ax.plot(x, y, color=overlay.get('color', '#999999'),
                linestyle=overlay.get('style', '--'),
                linewidth=overlay.get('width', 0.8),
                alpha=overlay.get('alpha', 0.85),
                label=overlay.get('label', 'Overlay'))


def plot_profile(self, window):
    """Plot profile data (zzProfile sheets) as line plot"""
    import matplotlib.pyplot as plt
    import pandas as pd
    import numpy as np

    sheet_name = window.sheet_combobox.GetValue()

    print(f"plot_profile called for: {sheet_name}")

    # Check if this is a profile sheet
    if not sheet_name.startswith(('zzProfile', 'zzBook')):
        print(f"Not a profile sheet: {sheet_name}")
        return False

    # Get profile metadata and data from window.Data
    if sheet_name not in window.Data['Core levels']:
        print(f"Sheet not in Data: {sheet_name}")
        return False

    profile_info = window.Data['Core levels'][sheet_name]
    print(f"Profile info keys: {profile_info.keys()}")

    if 'Profile Data' not in profile_info:
        print(f"No 'Profile Data' key found. Keys available: {profile_info.keys()}")
        return False

    # Extract metadata
    y_axis_label = profile_info.get('Y_Axis_Label', 'Atomic Concentration (%)')
    x_axis_label = profile_info.get('X_Axis_Label', 'Number')
    profile_data = profile_info['Profile Data']

    print(f"Y-axis: {y_axis_label}, X-axis: {x_axis_label}")
    print(f"Profile data keys: {profile_data.keys()}")

    # Clear current plot
    self.ax.clear()

    # Remove residuals subplot if it exists
    if hasattr(self, 'residuals_subplot'):
        if self.residuals_subplot:
            self.figure.delaxes(self.residuals_subplot)
            self.residuals_subplot = None
            self.ax.set_position([0.1, 0.1, 0.85, 0.85])
            self.ax.get_xaxis().set_visible(True)

    # Curves from the column roles (X / Y / Y error), drawn in the sheet's
    # style (libraries/ViewMenu/ProfileStyle.py)
    from libraries.ViewMenu.ProfileStyle import draw_profile, get_style
    style = get_style(window, sheet_name)
    draw_profile(self.ax, window, sheet_name, profile_info)

    # Configure plot - no title
    self.ax.set_xlabel(x_axis_label, fontsize=12)
    self.ax.set_ylabel(y_axis_label, fontsize=12)

    handles, _labels = self.ax.get_legend_handles_labels()
    if style['legend'] and handles:
        # A remembered (dragged) position anchors the legend's UPPER-LEFT
        # corner, as on every other sheet: 'best' with such an anchor put
        # the box outside the axes.
        from libraries.ViewMenu.ProfileStyle import legend_kwargs
        loc = 'upper left' if legend_position(window) is not None else style['legend_loc']
        legend = self.ax.legend(loc=loc, **legend_kwargs(style))
        self.make_legend_draggable()

    # Labels Manager items of the book (text, arrows, lines, measures):
    # drawn in data coordinates, after the curves, as on any other sheet
    if profile_info.get('Labels'):
        _remove_all_drawing_artists(self.ax)
        for label_data in profile_info['Labels']:
            if label_data.get('text') == 'Table' and label_data.get('is_table'):
                continue
            try:
                _draw_label_data_on_ax(self.ax, label_data,
                                       getattr(window, 'label_font_size', 10), window)
            except Exception as e:
                print(f"Profile label not drawn: {e}")

    # Format axes (linear only: a log axis keeps its own formatter)
    from matplotlib.ticker import ScalarFormatter
    if not style['logy']:
        self.ax.yaxis.set_major_formatter(ScalarFormatter(useMathText=True))
        # Only use scientific notation for Y values above 1000
        y_min, y_max = self.ax.get_ylim()
        if y_max > 1000:
            self.ax.ticklabel_format(style='sci', axis='y', scilimits=(0, 0))
        else:
            self.ax.ticklabel_format(style='plain', axis='y')
    if not style['logx']:
        self.ax.xaxis.set_major_formatter(ScalarFormatter(useMathText=True))

    print("Profile plot complete")

    # Redraw canvas
    self.canvas.draw_idle()

    return True


def plot_edx_data(self, window, sheet_name):
    """Plot EDX data when EDX~Plot or EDX~Map sheet is selected"""
    import os
    import numpy as np
    from libraries.ToolsMenu.EDX_SEM_Analysis import open_edx_sem_window

    try:
        # Get the data for this sheet
        if sheet_name not in window.Data['Core levels']:
            return False

        sheet_data = window.Data['Core levels'][sheet_name]

        # Handle EDX~Plot and EDX~Plot1, EDX~Plot2, etc.
        if sheet_name == 'EDX~Plot' or sheet_name.startswith('EDX~Plot'):
            # Plot EDX spectrum - support both old and new formats
            if 'B.E.' in sheet_data and 'Raw Data' in sheet_data:
                energy = np.array(sheet_data['B.E.'])
                intensity = np.array(sheet_data['Raw Data'])
            elif 'Energy_keV' in sheet_data and 'Intensity' in sheet_data:
                # OLD FORMAT - still support it
                energy = np.array(sheet_data['Energy_keV'])
                intensity = np.array(sheet_data['Intensity'])
            else:
                print(f"ERROR: {sheet_name} missing required data keys")
                return False

            # Clear the main plot
            self.ax.clear()

            # Reset background to white for non-EDX plots
            if not (sheet_name == 'EDX~Plot' or sheet_name.startswith('EDX~Plot')):
                self.figure.patch.set_facecolor('white')
                self.ax.set_facecolor('white')
                # Reset spines to black
                for spine in self.ax.spines.values():
                    spine.set_edgecolor('black')
                # Reset tick colors to black
                self.ax.tick_params(colors='black', labelcolor='black')

            # Remove heatmap colorbar AND its axes if it exists (same as plot_data)
            if hasattr(window, 'heatmap_colorbar') and window.heatmap_colorbar is not None:
                try:
                    if hasattr(window.heatmap_colorbar, 'ax'):
                        self.figure.delaxes(window.heatmap_colorbar.ax)
                    window.heatmap_colorbar = None
                    window.heatmap_data = None
                    window.heatmap_sheets = None
                except:
                    pass

            # REMOVE RSD subplot if it exists (same as plot_data)
            if hasattr(self, 'residuals_subplot'):
                if self.residuals_subplot:
                    self.figure.delaxes(self.residuals_subplot)
                    self.residuals_subplot = None
                    # Restore X-axis visibility
                    self.ax.get_xaxis().set_visible(True)

            # REMOVE RSD text if it exists
            if hasattr(self, 'rsd_text') and self.rsd_text:
                try:
                    self.rsd_text.remove()
                    self.rsd_text = None
                except:
                    pass

            # Reset plot position to full size
            self.ax.set_position([0.1, 0.1, 0.85, 0.85])

            # Get stored style preference from window config or sheet data
            style = getattr(window, 'edx_plot_style', 'black')

            print(f'Using EDX plot style: {style}')
            if '_EDX_style' in sheet_data:
                style = sheet_data['_EDX_style']

            # Apply EDX plot style
            label_color = self.apply_edx_plot_style(self.ax, self.figure, energy, intensity, style)

            # Set title based on selection info if available
            selection_info = sheet_data.get('_EDX_selection')
            title_color = label_color
            if selection_info:
                sel_type = selection_info.get('type', 'unknown')
                if sel_type == 'point':
                    x, y = selection_info.get('x', 0), selection_info.get('y', 0)
                    size = selection_info.get('size', 1)
                    if size == 1:
                        self.ax.set_title(f'EDX Spectrum - Point ({x}, {y})', color=title_color)
                    else:
                        self.ax.set_title(f'EDX Spectrum - Point ({x}, {y}) [{size}×{size} px]', color=title_color)
                elif sel_type == 'line':
                    self.ax.set_title('EDX Spectrum - Line Profile', color=title_color)
                elif sel_type == 'rectangle':
                    angle = selection_info.get('angle', 0)
                    self.ax.set_title(f'EDX Spectrum - Rectangle (θ={angle:.1f}°)', color=title_color)
                elif sel_type == 'area':
                    self.ax.set_title('EDX Spectrum - Area', color=title_color)
                else:
                    self.ax.set_title(f'EDX Spectrum ({sel_type})', color=title_color)
            else:
                self.ax.set_title('EDX Sum Spectrum', color=title_color)

            self.ax.set_title(' ', color=title_color)

            # Set Y-axis to scientific format
            self.ax.ticklabel_format(axis='y', style='scientific', scilimits=(0, 0))

            # Set data range for zoom and store in window for later use
            if sheet_name in window.Data['Core levels']:
                window.Data['Core levels'][sheet_name]['_EDX_min'] = np.min(energy)
                window.Data['Core levels'][sheet_name]['_EDX_max'] = np.max(energy)

            # Store as window attributes for plotting
            window.x_values = energy
            window.y_values = intensity

            # Set initial display range - check all EDX~Plot sheets for global max
            display_x_max = 20  # default
            for sname in window.Data['Core levels']:
                if sname == 'EDX~Plot' or sname.startswith('EDX~Plot'):
                    if '_EDX_display_max' in window.Data['Core levels'][sname]:
                        display_x_max = window.Data['Core levels'][sname]['_EDX_display_max']
                        break
            # Store in current sheet too
            sheet_data['_EDX_display_max'] = display_x_max
            self.ax.set_xlim(0, display_x_max)
            self.ax.set_ylim(np.min(intensity) * 0.95, np.max(intensity) * 1.1)

            # Add peak labels using EDX window if available
            hdf5_path = None
            if hasattr(window, 'current_file_path') and window.current_file_path:
                # Try different HDF5 path variations
                base_path = window.current_file_path.replace('_EDX.xlsx', '')
                hdf5_variants = [
                    f"{base_path}_EDX.hdf5",
                    f"{base_path}_EDX.h5",
                    f"{base_path}.hdf5",
                    f"{base_path}.h5"
                ]

                for variant in hdf5_variants:
                    if os.path.exists(variant):
                        hdf5_path = variant
                        break

            # Also check if stored in sheet data
            if not hdf5_path:
                # HDF5 path is derived from FilePath
                from libraries.ToolsMenu.EDX_SEM_Analysis import get_hdf5_path_from_filepath
                hdf5_path = get_hdf5_path_from_filepath(window.Data.get('FilePath'))


            # Add peak labels - check if they already exist
            if len(self.ax.texts) == 0:
                # No labels yet - add them
                try:
                    from libraries.ToolsMenu.EDX_SEM_Analysis import EDXSEMWindow
                    temp_edx = EDXSEMWindow(window)
                    temp_edx.add_peak_labels(self.ax, energy, intensity)

                    # Apply label color based on style
                    for text in self.ax.texts:
                        text.set_color(label_color)
                        text.set_fontweight('bold')

                    temp_edx.Destroy()
                    print("Added EDX peak labels")
                except Exception as e:
                    print(f"Could not add EDX labels: {e}")
                    import traceback
                    traceback.print_exc()

            self.canvas.draw()

            # Draw saved selection on EDX map window if open
            if hasattr(window, 'edx_window') and window.edx_window:
                try:
                    if not window.edx_window.IsBeingDeleted():
                        # Clear any previous saved selection
                        window.edx_window._clear_saved_selection()
                        # Draw the selection for this plot if available
                        if selection_info:
                            window.edx_window.draw_saved_selection(selection_info)
                            window.edx_window.map_canvas.draw_idle()
                except Exception as e:
                    print(f"Could not draw saved selection: {e}")

            # Restore grid data if available
            grid_data = sheet_data.get('_EDX_grid_data')
            if grid_data and hasattr(window, 'peak_params_grid'):
                from libraries.Sheet_Operations import _restore_grid_data
                _restore_grid_data(window, grid_data)

            return True

        elif sheet_name == 'EDX~Map':
            # Open EDX HeatMap window if not already open
            from libraries.ToolsMenu.EDX_SEM_Analysis import open_edx_sem_window

            # Check if EDX window exists and is not deleted
            if hasattr(window, 'edx_window') and window.edx_window:
                try:
                    if not window.edx_window.IsBeingDeleted():
                        # Window exists, just raise it to front
                        window.edx_window.Raise()
                        window.edx_window.SetFocus()
                        return True
                except (RuntimeError, wx.wxAssertionError):
                    # Window was deleted, clear reference
                    window.edx_window = None

            # Window doesn't exist or was deleted, create new one
            window.edx_window = open_edx_sem_window(window)

            # Try to load the HDF5 data if available
            from libraries.ToolsMenu.EDX_SEM_Analysis import get_hdf5_path_from_filepath
            hdf5_path = get_hdf5_path_from_filepath(window.Data.get('FilePath'))

            if hdf5_path and os.path.exists(hdf5_path):
                try:
                    window.edx_window.load_file(hdf5_path, 'EDX Map')
                    print(f"Loaded EDX map from: {hdf5_path}")
                except Exception as e:
                    print(f"Could not load EDX map: {e}")
                    import traceback
                    traceback.print_exc()
            else:
                print(f"HDF5 file not found: {hdf5_path}")

            return True

        return False

    except Exception as e:
        print(f"Error plotting EDX data: {e}")
        import traceback
        traceback.print_exc()
        return False


def apply_edx_plot_style(self, ax, figure, energy, intensity, style='black', label_color='black'):
    """Apply EDX plot style to axes

    Args:
        ax: matplotlib axes
        figure: matplotlib figure
        energy: energy array
        intensity: intensity array
        style: 'black', 'blue_yellow', 'white_red', or 'white_blue'
        label_color: color for peak labels (used after add_peak_labels is called)
    """
    if style == 'black':
        # Default style: Black line, black labels, white background
        figure.patch.set_facecolor('white')
        ax.set_facecolor('white')
        ax.plot(energy, intensity, 'k-', linewidth=1.0)
        ax.set_xlabel('Energy (keV)', color='black')
        ax.set_ylabel('Counts', color='black')
        ax.tick_params(colors='black', labelcolor='black')
        for spine in ax.spines.values():
            spine.set_edgecolor('black')
        return 'black'

    # elif style == 'blue_yellow':
    #     # Blue background with yellow filled line and yellow labels
    #     figure.patch.set_facecolor('#1e3a5f')
    #     ax.set_facecolor('#1e3a5f')
    #     ax.fill_between(energy, intensity, color='yellow', alpha=0.8)
    #     ax.plot(energy, intensity, 'yellow', linewidth=1.2)
    #     ax.set_xlabel('Energy (keV)', color='yellow')
    #     ax.set_ylabel('Counts', color='yellow')
    #     ax.tick_params(colors='yellow', labelcolor='yellow')
    #     for spine in ax.spines.values():
    #         spine.set_edgecolor('yellow')
    #     return 'yellow'

    elif style == 'blue_yellow':
        # Blue axes background with yellow filled line, white figure background, black labels
        figure.patch.set_facecolor('white')
        ax.set_facecolor('#1e3a5f')
        ax.fill_between(energy, intensity, color='yellow', alpha=0.8)
        ax.plot(energy, intensity, 'yellow', linewidth=1.0)
        ax.set_xlabel('Energy (keV)', color='black')
        ax.set_ylabel('Counts', color='black')
        ax.tick_params(colors='black', labelcolor='black')
        for spine in ax.spines.values():
            spine.set_edgecolor('black')
        return 'yellow'

    elif style == 'white_green':
        # White background with red filled line and black labels
        figure.patch.set_facecolor('white')
        ax.set_facecolor('white')
        ax.fill_between(energy, intensity, color='#16A085', alpha=0.6)
        ax.plot(energy, intensity, '#16A085', linewidth=1.0)
        ax.set_xlabel('Energy (keV)', color='black')
        ax.set_ylabel('Counts', color='black')
        ax.tick_params(colors='black', labelcolor='black')
        for spine in ax.spines.values():
            spine.set_edgecolor('black')
        return 'black'

    elif style == 'white_red':
        # White background with red filled line and black labels
        figure.patch.set_facecolor('white')
        ax.set_facecolor('white')
        ax.fill_between(energy, intensity, color='red', alpha=0.6)
        ax.plot(energy, intensity, 'red', linewidth=1.0)
        ax.set_xlabel('Energy (keV)', color='black')
        ax.set_ylabel('Counts', color='black')
        ax.tick_params(colors='black', labelcolor='black')
        for spine in ax.spines.values():
            spine.set_edgecolor('black')
        return 'black'

    elif style == 'white_blue':
        # White background with blue filled line and black labels
        figure.patch.set_facecolor('white')
        ax.set_facecolor('white')
        ax.fill_between(energy, intensity, color='blue', alpha=0.6)
        ax.plot(energy, intensity, 'blue', linewidth=1.0)
        ax.set_xlabel('Energy (keV)', color='black')
        ax.set_ylabel('Counts', color='black')
        ax.tick_params(colors='black', labelcolor='black')
        for spine in ax.spines.values():
            spine.set_edgecolor('black')
        return 'black'

    elif style == 'white_purple':
        # White background with blue filled line and black labels
        figure.patch.set_facecolor('white')
        ax.set_facecolor('white')
        ax.fill_between(energy, intensity, color='purple', alpha=0.6)
        ax.plot(energy, intensity, 'purple', linewidth=1.0)
        ax.set_xlabel('Energy (keV)', color='black')
        ax.set_ylabel('Counts', color='black')
        ax.tick_params(colors='black', labelcolor='black')
        for spine in ax.spines.values():
            spine.set_edgecolor('black')
        return 'black'

    elif style == 'white_pink':
        # White background with blue filled line and black labels
        figure.patch.set_facecolor('white')
        ax.set_facecolor('white')
        ax.fill_between(energy, intensity, color='pink', alpha=0.8)
        ax.plot(energy, intensity, 'purple', linewidth=1.0)
        ax.set_xlabel('Energy (keV)', color='black')
        ax.set_ylabel('Counts', color='black')
        ax.tick_params(colors='black', labelcolor='black')
        for spine in ax.spines.values():
            spine.set_edgecolor('black')
        return 'black'

    # Default fallback
    return 'black'

