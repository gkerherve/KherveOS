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

