# KherveFitting - XPS Data Analysis Software
# Copyright (C) 2024-2026 Gwilherm Kerherve <g.kerherve@ic.ac.uk>
#
# KherveFitting is dual-licensed:
#   - GNU GPL v3.0 (see LICENSE-GPL.txt) for open-source use
#   - Commercial Licence (see LICENSE-COMMERCIAL.txt) for proprietary use
# SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-KherveFitting-Commercial
#
# KherveOS port: the curves the desktop draws — each peak from its row of the
# peak table (PlotManager.plot_peak), the envelope and the residuals
# (PlotManager.update_overall_fit_and_residuals). Same models and parameters;
# the web page draws the arrays. Synced with KherveFitting-AI (dev-AI v1.93):
# the new line shapes, the apex-anchored skewed Voigt and the Gaussian
# broadening (Wg) of SingleEntity envelopes.

import numpy as np
import lmfit

from .peak_functions import PeakFunctions

SKIPPED = ("Unfitted", "SurveyID", "D-parameter", "Fermi", "VBM", "Cut-Off", "Curie-Weiss",
           "Equivalent Circuit")


def _singleentity_curve(window, row, x_values, by_position):
    """A SingleEntity peak: a stored envelope shifted (σ column) and scaled (γ column)."""
    grid = window.peak_params_grid
    sheet_name = window.sheet_combobox.GetValue()
    peaks = window.Data['Core levels'][sheet_name].get('Fitting', {}).get('Peaks', {})
    position_shift = float(grid.GetCellValue(row, 7))
    area_scale = float(grid.GetCellValue(row, 8))
    try:
        current_wg = float(grid.GetCellValue(row, 9))  # Wg col 9
    except (ValueError, TypeError):
        current_wg = 0.0
    peak_data = None
    for name, data in peaks.items():
        if data.get('Fitting Model') != 'SingleEntity':
            continue
        if by_position:
            if abs(data.get('Position', 0) - float(grid.GetCellValue(row, 2))) < 0.01:
                peak_data = data
                break
        elif grid.GetCellValue(row, 1) in name:
            peak_data = data
            break
    if not peak_data or 'x_data' not in peak_data or 'y_data' not in peak_data:
        return None
    from scipy.interpolate import interp1d
    x_env = np.array(peak_data['x_data'])
    interpolator = interp1d(x_env, np.array(peak_data['y_data']), kind='cubic',
                            bounds_error=False, fill_value=0.0)
    y_interpolated = interpolator(x_values - position_shift)
    if current_wg > 0.01:
        from scipy.ndimage import gaussian_filter1d
        dx = abs(np.mean(np.diff(np.sort(x_env))))
        if dx > 0:
            sigma_pts = current_wg / (2 * np.sqrt(2 * np.log(2))) / dx
            if sigma_pts >= 0.5:
                y_interpolated = gaussian_filter1d(y_interpolated, sigma_pts)
    return y_interpolated * area_scale


def peak_curve(window, row, x_values, envelope=False):
    """One peak above zero, from its row of the peak table (None if not drawn).

    envelope=False follows plot_peak (the coloured peak), envelope=True follows
    update_overall_fit_and_residuals (the sum); they differ only for GL/SGL (Area),
    whose drawn peak comes from the height and whose sum term from the area.
    """
    grid = window.peak_params_grid
    g = grid.GetCellValue
    fitting_model = g(row, 13)
    if fitting_model in SKIPPED or not fitting_model:
        return None
    try:
        x = float(g(row, 2))
        y = float(g(row, 3))
        fwhm = float(g(row, 4))
        lg_ratio = float(g(row, 5))
    except ValueError:
        return None

    if fitting_model == "SingleEntity":
        return _singleentity_curve(window, row, x_values, by_position=not envelope)
    if fitting_model in ["Voigt (Area, L/G, σ)", "Voigt (Area, σ, γ)"]:
        peak_model = lmfit.models.VoigtModel()
        sigma = float(g(row, 7)) / 2.355
        gamma = float(g(row, 8)) / 2
        amplitude = y / peak_model.eval(center=0, amplitude=1, sigma=sigma, gamma=gamma, x=0)
        params = peak_model.make_params(center=x, amplitude=amplitude, sigma=sigma, gamma=gamma)
    elif fitting_model == "Voigt (Area, L/G, σ, S)":
        peak_model = PeakFunctions.create_skewed_voigt_model()
        params = peak_model.make_params(center=x, amplitude=float(g(row, 6)), sigma=float(g(row, 7)) / 2.355,
                                        gamma=float(g(row, 8)) / 2, skew=float(g(row, 9)))
    elif fitting_model == "DS (A, σ, γ)":
        peak_model = lmfit.models.DoniachModel()
        height = float(g(row, 3))
        sigma = float(g(row, 7))
        gamma = float(g(row, 8))
        skew = float(g(row, 9))
        amplitude = PeakFunctions.doniach_sunjic_height_to_amplitude(height, sigma, gamma, skew)
        params = peak_model.make_params(center=x, amplitude=amplitude, sigma=sigma, gamma=gamma, asymmetry=skew)
    elif fitting_model == "DS*G (A, σ, γ, S)":
        peak_model = lmfit.Model(PeakFunctions.DS_G)
        params = peak_model.make_params(center=x, amplitude=float(g(row, 6)), gamma=float(g(row, 8)),
                                        skew=float(g(row, 9)), sigma=float(g(row, 7)))
    elif fitting_model == "ExpGauss.(Area, σ, γ)":
        peak_model = lmfit.models.ExponentialGaussianModel()
        params = peak_model.make_params(center=x, amplitude=float(g(row, 6)), sigma=float(g(row, 7)),
                                        gamma=float(g(row, 8)))
    elif fitting_model == "Pseudo-Voigt (Area)":
        sigma = fwhm / 2
        peak_model = lmfit.models.PseudoVoigtModel()
        amplitude = y / peak_model.eval(center=0, amplitude=1, sigma=sigma, fraction=lg_ratio / 100, x=0)
        params = peak_model.make_params(center=x, amplitude=amplitude, sigma=sigma, fraction=lg_ratio / 100)
    elif fitting_model in ["LA (Area, σ, γ)", "LA (Area, σ/γ, γ)"]:
        peak_model = lmfit.Model(PeakFunctions.LA)
        params = peak_model.make_params(center=x, amplitude=float(g(row, 6)), fwhm=fwhm,
                                        sigma=float(g(row, 7)), gamma=float(g(row, 8)))
    elif fitting_model == "LA*G (Area, σ/γ, γ)":
        peak_model = lmfit.Model(PeakFunctions.LAxG)
        params = peak_model.make_params(center=x, amplitude=float(g(row, 6)), fwhm=fwhm, sigma=float(g(row, 7)),
                                        gamma=float(g(row, 8)), fwhm_g=float(g(row, 9)))
    elif fitting_model == "LF (Area, σ, γ, w)":
        peak_model = lmfit.Model(PeakFunctions.LF)
        params = peak_model.make_params(center=x, amplitude=float(g(row, 6)), fwhm=fwhm, sigma=float(g(row, 7)),
                                        gamma=float(g(row, 8)), w=float(g(row, 9)))
    elif fitting_model == "DL (A, σ, γ, aDL)":
        peak_model = lmfit.Model(PeakFunctions.DL)
        params = peak_model.make_params(center=x, amplitude=float(g(row, 6)), sigma=float(g(row, 7)),
                                        gamma=float(g(row, 8)), a_dl=float(g(row, 9)))
    elif fitting_model in ("TLA (A, μ, α, Wg)", "TLA (A, μ, Wg, α)"):
        # (the desktop's plot_peak tests the second spelling, which no peak
        # carries, so only its envelope draws TLA; both are drawn here)
        peak_model = lmfit.Model(PeakFunctions.TLA)
        params = peak_model.make_params(center=x, amplitude=float(g(row, 6)), fwhm=fwhm, mu=float(g(row, 7)),
                                        wg=float(g(row, 9)), alpha=float(g(row, 8)))
    elif fitting_model == "SB (Height)":
        peak_model = lmfit.Model(PeakFunctions.SB_voigt)
        params = peak_model.make_params(center=x, fwhm=fwhm, fraction=lg_ratio, amplitude=y)
    elif fitting_model in ("A*GL (Area, a, b)", "A*SGL (Area, a, b)"):
        peak_model = lmfit.Model(PeakFunctions.A_GL if fitting_model == "A*GL (Area, a, b)" else PeakFunctions.A_SGL)
        params = peak_model.make_params(center=x, amplitude=y, fwhm=fwhm, fraction=lg_ratio,
                                        a=float(g(row, 7)), b=float(g(row, 8)))
    elif fitting_model == "Voigt (Area)":
        peak_model = lmfit.Model(PeakFunctions.voigt_simple)
        if envelope:
            area = float(g(row, 6))
        else:
            unit_apex = float(PeakFunctions.voigt_simple(0.0, 0.0, 1.0, fwhm, lg_ratio))
            area = y / unit_apex if unit_apex > 0 else 0.0
        params = peak_model.make_params(center=x, area=area, fwhm=fwhm, fraction=lg_ratio)
    elif fitting_model == "Voigt (Area, L/G, S)":
        peak_model = lmfit.Model(PeakFunctions.voigt_simple_skewed)
        skew = float(g(row, 9))
        if envelope:
            area = float(g(row, 6))
        else:
            unit_apex = float(PeakFunctions.voigt_simple_skewed(0.0, 0.0, 1.0, fwhm, lg_ratio, skew))
            area = y / unit_apex if unit_apex > 0 else 0.0
        params = peak_model.make_params(center=x, area=area, fwhm=fwhm, fraction=lg_ratio, skew=skew)
    elif fitting_model == "GL (Height)":
        peak_model = lmfit.Model(PeakFunctions.gauss_lorentz)
        params = peak_model.make_params(center=x, fwhm=fwhm, fraction=lg_ratio, amplitude=y)
    elif fitting_model == "SGL (Height)":
        peak_model = lmfit.Model(PeakFunctions.S_gauss_lorentz)
        params = peak_model.make_params(center=x, fwhm=fwhm, fraction=lg_ratio, amplitude=y)
    elif fitting_model == "GL (Area)":
        peak_model = lmfit.Model(PeakFunctions.gauss_lorentz_Area)
        if envelope:
            area = float(g(row, 6))
        else:
            area = y * (fwhm * np.sqrt(np.pi / (4 * np.log(2))))
        params = peak_model.make_params(center=x, fwhm=fwhm, fraction=lg_ratio, area=area)
    elif fitting_model == "SGL (Area)":
        peak_model = lmfit.Model(PeakFunctions.S_gauss_lorentz_Area)
        if envelope:
            area = float(g(row, 6))
        else:
            sigma = fwhm / (2 * np.sqrt(2 * np.log(2)))
            gamma = fwhm / 2
            area = y * ((1 - lg_ratio / 100) * sigma * np.sqrt(2 * np.pi) + (lg_ratio / 100) * np.pi * gamma)
        params = peak_model.make_params(center=x, fwhm=fwhm, fraction=lg_ratio, area=area)
    else:
        return None
    return peak_model.eval(params, x=x_values)


def background_regions(window):
    """PlotManager.get_background_regions: the recorded regions, or None."""
    sheet_name = window.sheet_combobox.GetValue()
    cl = window.Data['Core levels'].get(sheet_name, {})
    regions = []
    for r in (cl.get('Background', {}).get('Recorded_Ranges') or []):
        if len(r) >= 4:
            try:
                lo, hi = float(r[2]), float(r[3])
                regions.append((min(lo, hi), max(lo, hi)))
            except (ValueError, TypeError):
                continue
    return regions or None


def region_mask(window, x_values):
    regions = background_regions(window)
    if not regions:
        return np.ones(len(x_values), dtype=bool)
    mask = np.zeros(len(x_values), dtype=bool)
    for lo, hi in regions:
        mask |= (x_values >= lo) & (x_values <= hi)
    return mask


def overall_fit(window):
    """Envelope (background + every peak) and raw residuals over the whole range."""
    x_values = window.x_values
    y_values = window.y_values[:len(x_values)]
    total = window.background.astype(float).copy()[:len(x_values)]
    grid = window.peak_params_grid
    n = grid.GetNumberRows() // 2
    if n == 0:
        return None, None
    for i in range(n):
        row = i * 2
        if not all(grid.GetCellValue(row, c) for c in (2, 3, 4, 5, 13)):
            continue
        try:
            curve = peak_curve(window, row, x_values, envelope=True)
        except (ValueError, TypeError, ZeroDivisionError):
            curve = None
        if curve is not None:
            total += curve
    m = min(len(y_values), len(total))
    return total[:m], y_values[:m] - total[:m]


def residual_for_new_peak(window):
    """The residual add_peak_params uses to place a new peak."""
    _, residual = overall_fit(window)
    return residual
