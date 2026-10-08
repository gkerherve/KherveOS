# KherveOS: these definitions cut unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/FileMenu/KFitting_Import.py. Regenerate with tools/export_khervetech.py.
import os
import re
import json
import math


TECH_XPS = "XPS Core Level"


TECH_RAMAN = "Raman Spectrum"


TECH_FTIR = "FTIR Spectrum"


TECH_XAS = "XAS Spectrum"


TECH_EELS = "EELS Spectrum"


TECH_TGA = "TGA / DSC"


TECH_SQUID = "SQUID Magnetometry"


TECH_EIS = "EIS (Nyquist)"


TECH_SEM_COUNT = "SEM Size Distribution (counts)"


TECH_SEM_FREQ = "SEM Size Distribution (%)"


TECH_UVVIS = "UV-Vis Spectrum"


TECH_PL = "Photoluminescence"


TECH_ELLIPS = "Ellipsometry (Ψ)"


TECH_MS = "Mass Spectrum"


TECH_GC = "Gas Chromatogram"


TECH_DIL = "Dilatometry (dL/L0)"


TECH_BET = "BET Isotherm"


TECH_PROFILE = "Depth Profile (zzProfile)"


TECH_SKIP = "Skip This Sheet"


GENERIC_TECHNIQUES = {
    TECH_XPS: {'base': None, 'round': True,
               'x': 'Binding Energy (eV)', 'y': 'Intensity (CPS)'},
    TECH_RAMAN: {'base': 'Raman', 'round': True,
                 'x': 'Raman shift (cm-1)', 'y': 'Intensity (a.u.)'},
    TECH_FTIR: {'base': 'FTIR',
                'x': 'Wavenumber (cm-1)', 'y': 'Transmittance (%) / Absorbance'},
    TECH_XAS: {'base': None, 'prefix': 'XAS~', 'round': True,
               'x': 'Photon energy (eV)', 'y': 'Intensity (a.u.)'},
    TECH_EELS: {'base': 'EELS~Plot', 'round': True,
                'x': 'Energy loss (eV)', 'y': 'Intensity (a.u.)'},
    TECH_TGA: {'base': 'TGA',
               'x': 'Temperature (°C)', 'y': 'Mass (% or mg)'},
    TECH_SQUID: {'base': 'SQUID',
                 'x': 'Temperature (K) or Field (Oe)', 'y': 'Moment (emu)'},
    TECH_EIS: {'base': 'EIS',
               'x': "Z' (Ω)", 'y': "-Z'' (Ω)"},
    TECH_SEM_COUNT: {'base': 'SEM~Count',
                     'x': 'Particle size (nm)', 'y': 'Number of particles'},
    TECH_SEM_FREQ: {'base': 'SEM~Freq',
                    'x': 'Particle size (nm)', 'y': 'Frequency of particles (%)'},
    TECH_UVVIS: {'base': 'UVvis',
                 'x': 'Wavelength (nm)', 'y': 'Absorbance / Transmittance'},
    TECH_PL: {'base': 'PL', 'round': True,
              'x': 'Wavelength (nm)', 'y': 'PL Intensity (a.u.)'},
    TECH_ELLIPS: {'base': 'Ellips',
                  'x': 'Wavelength (nm)', 'y': 'Ψ (°)'},
    TECH_MS: {'base': 'MS', 'round': True,
              'x': 'm/z', 'y': 'Intensity (a.u.)'},
    TECH_GC: {'base': 'GC',
              'x': 'Retention time (min)', 'y': 'Signal (a.u.)'},
    TECH_DIL: {'base': 'DIL',
               'x': 'Temperature (°C)', 'y': 'dL/L0'},
    TECH_BET: {'base': 'BET',
               'x': 'Relative pressure (P/P0)',
               'y': 'Quantity adsorbed (cm3/g STP)'},
    TECH_PROFILE: {'base': 'zzProfile',
                   'x': 'Layer / cycle number', 'y': 'Atomic concentration (%)'},
    TECH_SKIP: {},
}


_TECH_BY_PREFIX = (
    ('XAS~', TECH_XAS), ('XAS', TECH_XAS),
    ('FTIR', TECH_FTIR),
    ('SEM~FREQ', TECH_SEM_FREQ), ('SEM~COUNT', TECH_SEM_COUNT), ('SEM', TECH_SEM_COUNT),
    ('EELS', TECH_EELS),
    ('TGA', TECH_TGA), ('DSC', TECH_TGA), ('STA', TECH_TGA),
    ('SQUID', TECH_SQUID), ('MPMS', TECH_SQUID),
    ('EIS', TECH_EIS), ('NYQUIST', TECH_EIS),
    # 'Ra_' is the short form the Raman sheets use elsewhere. A bare 'Ra'
    # prefix is not enough to go on: Ra3d and Ra4f are radium core levels.
    ('RAMAN', TECH_RAMAN), ('RA_', TECH_RAMAN),
    ('UVVIS', TECH_UVVIS), ('UV-VIS', TECH_UVVIS), ('UV_VIS', TECH_UVVIS),
    ('ELLIPS', TECH_ELLIPS), ('PSI', TECH_ELLIPS),
    ('MASS', TECH_MS), ('MS', TECH_MS),
    ('CHROM', TECH_GC), ('GC', TECH_GC), ('TIC', TECH_GC),
    ('DIL', TECH_DIL),
    ('BET', TECH_BET), ('ISOTHERM', TECH_BET),
    # 'PL' after the longer prefixes: nothing else starts with it, but keep it
    # last of the optical group so 'PLxxx' never shadows a more specific name.
    ('PL', TECH_PL),
    ('ZZPROFILE', TECH_PROFILE),
)


def guess_technique(sheet_name):
    """Best guess at the technique of a sheet, from its name."""
    upper = str(sheet_name).upper()
    for prefix, technique in _TECH_BY_PREFIX:
        if upper.startswith(prefix):
            return technique
    return TECH_XPS


def _unique_sheet_name(base, used):
    """base, base1, base2, ... - whichever is free (case-insensitively)."""
    taken = {str(name).upper() for name in used}
    if base.upper() not in taken:
        return base
    idx = 1
    while f"{base}{idx}".upper() in taken:
        idx += 1
    return f"{base}{idx}"


def _generic_background(x_values, y_values):
    """The Background entry every sheet needs (and the vline handler writes to)."""
    return {
        'Bkg Y': list(y_values),
        'Bkg Type': '',
        'Bkg Low': float(min(x_values)) if x_values else '',
        'Bkg High': float(max(x_values)) if x_values else '',
        'Bkg Offset Low': 0,
        'Bkg Offset High': 0,
    }


def build_generic_sheet(technique, sheet_name, x_values, y_values,
                        source_name='', extra_values=None):
    """Build the ``window.Data['Core levels'][sheet]`` entry for one sheet.

    ``extra_values`` is the optional third column - the frequency of an EIS
    sweep, which the circuit fit and the Bode view cannot be derived without.
    """
    sheet = {
        'Name': sheet_name,
        'B.E.': list(x_values),
        'Raw Data': list(y_values),
        'Background': _generic_background(x_values, y_values),
        'Fitting': {'Peaks': {}},
        'ExperimentalInfo': {
            'Technique': technique,
            'Source Sheet': source_name,
            'Number of Points': str(len(x_values)),
        },
    }

    if technique == TECH_XPS:
        sheet['Corrected Data'] = list(y_values)
        sheet['Transmission'] = [1.0] * len(y_values)

    elif technique == TECH_FTIR:
        from libraries.FileMenu.FTIR_Import import infer_y_unit
        y_unit, scale = infer_y_unit(y_values)
        if scale != 1.0:
            sheet['Raw Data'] = [v * scale for v in y_values]
            sheet['Background']['Bkg Y'] = list(sheet['Raw Data'])
        sheet['FTIR_Y_Unit'] = y_unit
        sheet['ExperimentalInfo']['Y Units'] = f"{y_unit} (inferred from data)"

    elif technique == TECH_EELS:
        sheet['_EELS_type'] = 'plot'

    elif technique == TECH_TGA:
        from libraries.FileMenu import TGA_Import as tga
        # A mass trace on a 0-100 scale is a percentage; anything else is read
        # as milligrams, which is the only other axis a TGA run is plotted on.
        as_percent = bool(y_values) and 0 <= min(y_values) and max(y_values) <= 105
        mass_label = tga.Y_LABEL_MASS_PCT if as_percent else tga.Y_LABEL_MASS_MG
        mass_unit = '%' if as_percent else 'mg'
        sheet.update({
            'TGA_View': tga.VIEW_TEMPERATURE,
            'TGA_X_Label': tga.X_LABEL_TEMPERATURE,
            'TGA_Y_Label': mass_label,
            'TGA_Y_Unit': mass_unit,
            'TGA_Mass_Label': mass_label,
            'TGA_Mass_Unit': mass_unit,
            'TGA_Normalised': False,
            'TGA_Label': source_name or sheet_name,
            'TGA_Source': source_name,
            'TGA_Sample_Mass_mg': None,
            'TGA_DSC_Unit': None,
            'TGA_Exo_Up': True,
            'TGA_Temperature': list(x_values),
            ('TGA_Mass_Pct' if as_percent else 'TGA_Mass_mg'): list(y_values),
        })
        # The selection lines the mass-step tool drags default to the middle
        # half of the run, as they do for an imported TGA file.
        if x_values:
            lo, hi = min(x_values), max(x_values)
            sheet['Background']['Bkg Low'] = float(lo + 0.25 * (hi - lo))
            sheet['Background']['Bkg High'] = float(lo + 0.75 * (hi - lo))

    elif technique == TECH_SQUID:
        from libraries.FileMenu import SQUID_Import as squid
        # A field sweep goes negative and comes back; a temperature sweep does
        # neither, and a temperature below zero kelvin is not a measurement.
        is_field = bool(x_values) and min(x_values) < 0
        sheet.update({
            'SQUID_Scan_Type': squid.SCAN_MH if is_field else squid.SCAN_MT,
            'SQUID_X_Label': squid.X_LABEL_MH if is_field else squid.X_LABEL_MT,
            'SQUID_Y_Label': squid.Y_LABEL_MOMENT,
            'SQUID_Quantity': squid.QTY_MOMENT,
            'SQUID_Label': source_name or sheet_name,
            'SQUID_Branch': '',
            'SQUID_Field_Oe': None,
            'SQUID_Temperature_K': None,
            'SQUID_Source': source_name,
        })

    elif technique == TECH_EIS:
        import numpy as np
        from libraries.FileMenu import EIS_Import as eis
        # y is -Z'' as plotted, so the stored imaginary part is its negative.
        zreal = np.asarray(x_values, dtype=float)
        zimag = -np.asarray(y_values, dtype=float)
        sheet.update({
            'EIS_View': eis.VIEW_NYQUIST,
            'EIS_X_Label': eis.X_LABEL_NYQUIST,
            'EIS_Y_Label': eis.Y_LABEL_NYQUIST,
            'EIS_Label': source_name or sheet_name,
            'EIS_Sweep': 1,
            'EIS_Source': source_name,
            'EIS_Zreal': list(x_values),
            'EIS_Zimag': [float(v) for v in zimag],
            'EIS_Zmod': [float(v) for v in np.hypot(zreal, zimag)],
            'EIS_Phase': [float(v) for v in np.degrees(np.arctan2(zimag, zreal))],
        })
        if extra_values:
            sheet['EIS_Frequency'] = [float(v) for v in extra_values]

    elif technique in (TECH_SEM_COUNT, TECH_SEM_FREQ):
        kind = 'frequency' if technique == TECH_SEM_FREQ else 'count'
        y_label = ('Frequency of particles (%)' if kind == 'frequency'
                   else 'Number of particles')
        width = (float(x_values[1] - x_values[0])
                 if len(x_values) > 1 else 1.0)
        sheet.update({
            'SEM_X_Label': 'Particle size (nm)',
            'SEM_Y_Label': y_label,
            'SEM_Bin_Width': width,
            'SEM_Kind': kind,
            'SEM_Unit': 'nm',
            'SEM_Fit': None,
            'SEM_Stats': None,
            'SEM_Source_Sheet': source_name,
        })
        sheet['Background']['Bkg Y'] = [0.0] * len(y_values)

    elif technique == TECH_UVVIS:
        # Absorbance sits within a few units of zero; a trace running to ~100
        # can only be a percentage (transmittance or reflectance).
        as_percent = bool(y_values) and max(y_values) > 5.0
        sheet.update({
            'UVVIS_X_Label': 'Wavelength (nm)',
            'UVVIS_Y_Label': ('Transmittance (%)' if as_percent
                              else 'Absorbance (a.u.)'),
            'UVVIS_Y_Mode': 'transmittance' if as_percent else 'absorbance',
            'UVVIS_Label': source_name or sheet_name,
            'UVVIS_Source': source_name,
        })

    elif technique == TECH_PL:
        sheet.update({
            'PL_X_Label': 'Wavelength (nm)',
            'PL_Y_Label': 'PL Intensity (a.u.)',
            'PL_Label': source_name or sheet_name,
            'PL_Source': source_name,
        })

    elif technique == TECH_ELLIPS:
        sheet.update({
            'ELLIPS_X_Label': 'Wavelength (nm)',
            'ELLIPS_Y_Label': 'Ψ (°)',
            'ELLIPS_Quantity': 'psi',
            'ELLIPS_Psi': list(y_values),
            'ELLIPS_Label': source_name or sheet_name,
            'ELLIPS_Source': source_name,
        })
        # The optional third column is Δ, without which no model can be fitted.
        if extra_values:
            sheet['ELLIPS_Delta'] = [float(v) for v in extra_values]

    elif technique == TECH_MS:
        sheet.update({
            'MS_X_Label': 'm/z',
            'MS_Y_Label': 'Intensity (a.u.)',
            'MS_Label': source_name or sheet_name,
            'MS_Source': source_name,
        })

    elif technique == TECH_GC:
        sheet.update({
            'GC_X_Label': 'Retention time (min)',
            'GC_Y_Label': 'Signal (a.u.)',
            'GC_Label': source_name or sheet_name,
            'GC_Source': source_name,
        })

    elif technique == TECH_DIL:
        sheet.update({
            'DIL_X_Label': 'Temperature (°C)',
            'DIL_Y_Label': 'dL/L$_0$',
            'DIL_Y_Unit': 'rel',
            'DIL_Label': source_name or sheet_name,
            'DIL_Source': source_name,
            'DIL_Sample_Length_mm': None,
            'DIL_Temperature': list(x_values),
            'DIL_Strain': list(y_values),
        })

    elif technique == TECH_BET:
        sheet.update({
            'BET_X_Label': 'Relative pressure (P/P$_0$)',
            'BET_Y_Label': 'Quantity adsorbed (cm$^3$/g STP)',
            'BET_Label': source_name or sheet_name,
            'BET_Source': source_name,
        })
        # Branch flags: adsorption up to the maximum P/P0, desorption after.
        if x_values:
            turn = max(range(len(x_values)), key=lambda i: x_values[i])
            sheet['BET_Branch'] = [1.0 if i <= turn else 2.0
                                   for i in range(len(x_values))]

    elif technique == TECH_PROFILE:
        sheet.update({
            'Profile Data': {'Number': list(x_values),
                             (source_name or 'Intensity'): list(y_values)},
            'X_Axis_Label': 'Number',
            'Y_Axis_Label': 'Atomic Concentration (%)',
            'Profile_Type': 'Atomic_Concentration',
        })

    return sheet

