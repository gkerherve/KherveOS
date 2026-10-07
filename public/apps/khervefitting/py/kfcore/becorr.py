# KherveFitting - XPS Data Analysis Software
# Copyright (C) 2024-2026 Gwilherm Kerherve <g.kerherve@ic.ac.uk>
#
# KherveFitting is dual-licensed:
#   - GNU GPL v3.0 (see LICENSE-GPL.txt) for open-source use
#   - Commercial Licence (see LICENSE-COMMERCIAL.txt) for proprietary use
# SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-KherveFitting-Commercial
#
# KherveOS port: binding-energy correction (On_BE_Corrections_Defs.py: the
# toolbar's BE spin box and "Auto BE", and ToolsMenu/BECorrectionWindow.py).
# A sample is the number at the end of the sheet names (no number = 0); its
# correction is kept in Data['BEcorrections'][sample] and every sheet of that
# sample is shifted by the change.

import re

#: Sheets whose x axis is not an energy (apply_be_correction skips them).
NOT_ENERGY = ('FTIR', 'SQUID', 'TGA', 'EELS', 'EIS', 'XRD', 'UVVIS', 'PL', 'ELLIPS', 'MS', 'GC',
              'DIL', 'BET', 'AFM')


def sample_of(sheet_name):
    m = re.search(r'(\d+)$', sheet_name or '')
    return m.group(1) if m else "0"


def correction_of(w, sample):
    """The stored correction of a sample (0 when none)."""
    v = (w.Data.get('BEcorrections') or {}).get(str(sample), 0.0)
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def samples_present(w):
    """BECorrectionWindow.populate_row_list: the samples that have sheets."""
    rows = {sample_of(s) for s in w.Data['Core levels']}
    return sorted(rows, key=int)


def _shift_sheet(sheet_data, delta):
    """The per-sheet part of apply_be_correction."""
    sheet_data['B.E.'] = [be + delta for be in sheet_data['B.E.']]
    bg = sheet_data.get('Background')
    if isinstance(bg, dict):
        # The desktop writes these back as 2-decimal text; numbers are kept here.
        for k in ('Bkg Low', 'Bkg High'):
            if k in bg and bg[k] not in ('', None):
                try:
                    bg[k] = round(float(bg[k]) + delta, 2)
                except (TypeError, ValueError):
                    pass
        if bg.get('Bkg X'):
            bg['Bkg X'] = [x + delta for x in bg['Bkg X']]
        if bg.get('Recorded_Ranges'):
            bg['Recorded_Ranges'] = [(r[0], r[1], r[2] + delta, r[3] + delta) for r in bg['Recorded_Ranges']]
    fitting = sheet_data.get('Fitting')
    if isinstance(fitting, dict) and 'Peaks' in fitting:
        for peak in fitting['Peaks'].values():
            try:
                peak['Position'] += delta
            except (KeyError, TypeError):
                pass
            cons = peak.get('Constraints')
            if isinstance(cons, dict):
                pc = cons.get('Position', '')
                if pc and isinstance(pc, str) and ',' in pc and not any(c in pc for c in 'ABCDEFGHIJKLMNOP'):
                    try:
                        lo, hi = map(float, pc.split(','))
                        cons['Position'] = f"{lo + delta:.2f},{hi + delta:.2f}"
                    except ValueError:
                        pass
            for k in ('Bkg Low', 'Bkg High'):
                if k in peak and peak[k] not in ('', None):
                    try:
                        peak[k] = round(float(peak[k]) + delta, 2)
                    except (TypeError, ValueError):
                        pass
            if peak.get('Fitted_X'):
                peak['Fitted_X'] = [x + delta for x in peak['Fitted_X']]
            if peak.get('x_data'):
                peak['x_data'] = [x + delta for x in peak['x_data']]
            for k in ('Fermi_Center', 'Original_Position'):
                if k in peak and peak[k] not in ('', None):
                    try:
                        peak[k] = round(float(peak[k]) + delta, 2)
                    except (TypeError, ValueError):
                        pass


def set_correction(w, sample, correction):
    """on_be_correction_change + apply_be_correction for one sample.

    Shifts every sheet of the sample by (correction - its stored correction),
    records the correction, and reselects the current sheet. Returns the shift.
    """
    from .sheets import select_sheet
    sample = str(sample)
    correction = round(float(correction), 2)  # the spin box has 2 decimals
    delta = correction - correction_of(w, sample)
    w.Data['BEcorrection'] = correction
    w.Data.setdefault('BEcorrections', {})[sample] = correction
    if delta != 0:
        for name, data in w.Data['Core levels'].items():
            if name.upper().startswith(NOT_ENERGY):
                continue
            if not isinstance(data, dict) or data.get('_sem') or 'B.E.' not in data:
                continue
            if sample_of(name) == sample:
                _shift_sheet(data, delta)
        # The results table rows of that sample (the desktop shifts the results grid's positions).
        table = w.Data.get(f'Results Table{int(sample)}', {}).get('Peak', {})
        for p in table.values():
            if sample_of(str(p.get('Sheetname', ''))) == sample:
                try:
                    p['Position'] = round(float(p['Position']) + delta, 2)
                except (KeyError, TypeError, ValueError):
                    pass
    current = w.sheet_combobox.GetValue()
    if current:
        select_sheet(w, current)
    return delta


def reference_correction(w, sample, ref_peak='C1s C-C', ref_be=284.8):
    """calculate_c1s_correction: how far the sample's reference peak is from its reference BE.

    Looks through the sample's sheets (in Data order) for the first peak whose label
    contains ref_peak. Returns None when there is none.
    """
    sample = str(sample)
    for name, data in w.Data['Core levels'].items():
        if sample_of(name) != sample or not isinstance(data, dict):
            continue
        fitting = data.get('Fitting')
        if isinstance(fitting, dict) and 'Peaks' in fitting:
            peak = next((p for label, p in fitting['Peaks'].items() if ref_peak in label), None)
            if peak:
                return float(ref_be) - float(peak['Position'])
    return None


def auto_correct(w, samples, ref_peak='C1s C-C', ref_be=284.8):
    """BECorrectionWindow "Correct Current/Selected Rows" (and the toolbar's Auto BE).

    The reference peak is moved to ref_be: the new correction is the stored one
    plus the reference peak's distance to ref_be. Returns ({sample: correction}, [missing]).
    """
    corrections, missing = {}, []
    for sample in samples:
        sample = str(sample)
        off = reference_correction(w, sample, ref_peak, ref_be)
        if off is None:
            missing.append(sample)
            continue
        new = round(correction_of(w, sample) + off, 2)
        set_correction(w, sample, new)
        corrections[sample] = new
    return corrections, missing


def reset(w, samples):
    """BECorrectionWindow "Reset Selected to 0 eV"."""
    done = []
    for sample in samples:
        sample = str(sample)
        if correction_of(w, sample) == 0.0:
            continue
        set_correction(w, sample, 0.0)
        done.append(sample)
    return done
