# KherveFitting - XPS Data Analysis Software
# Copyright (C) 2024-2026 Gwilherm Kerherve <g.kerherve@ic.ac.uk>
#
# KherveFitting is dual-licensed:
#   - GNU GPL v3.0 (see LICENSE-GPL.txt) for open-source use
#   - Commercial Licence (see LICENSE-COMMERCIAL.txt) for proprietary use
# SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-KherveFitting-Commercial

#
# KherveOS port of the two PCA windows of the desktop Tools menu, without wx
# and without scikit-learn (Pyodide has no sklearn):
#
#   "PCA Analysis (NMF)"   libraries/ToolsMenu/PCA_Analysis.py           -> nmf, nmf_create
#   "PCA Analysis (Noise)" libraries/ToolsMenu/PCA_Analysis_Standard.py  -> pca, pca_create
#
# The data preparation, offsets, normalisations and the core levels written
# into Data are the desktop's code. The two sklearn estimators the windows use
# are reimplemented in numpy/scipy below, following sklearn 1.9:
#   NMF(n_components, init='random', random_state=0, max_iter, tol)
#       -> solver 'cd' (coordinate descent), beta_loss 'frobenius', no
#          regularisation, shuffle False; _nmf_cd below.
#   PCA(n_components, svd_solver='full' | 'randomized')
#       -> scipy.linalg.svd of the centred data + svd_flip; _pca_full below.

import re

import numpy as np
from scipy import linalg
from scipy.interpolate import interp1d

from .backgrounds import BackgroundCalculations
from .compat import trapz


# ── Helpers ─────────────────────────────────────────────────────────────
def _natural_sort_key(sheet_name):
    """PCAnalysisWindow.natural_sort_key: O1s2 before O1s10."""
    parts = re.split(r'(\d+)', sheet_name)
    return [int(part) if part.isdigit() else part.lower() for part in parts]


def _num(v):
    """A JSON-safe float (None for NaN/inf)."""
    v = float(v)
    return v if np.isfinite(v) else None


def _list(a):
    a = np.asarray(a, dtype=float)
    if a.ndim == 0:
        return _num(a)
    if a.ndim == 1:
        return [_num(v) for v in a]
    return [_list(row) for row in a]


_OFFSETS = {'min': 'Minimum Value', 'minimum value': 'Minimum Value', 'minimum': 'Minimum Value',
            'smart': 'Smart Background', 'smart background': 'Smart Background'}
_NORMS = {'none': 'None', 'area': 'Area', 'max': 'Max Height', 'height': 'Max Height',
          'max height': 'Max Height'}


def _offset_mode(offset):
    return _OFFSETS.get(str(offset).strip().lower(), 'Minimum Value')


def _norm_mode(norm):
    return _NORMS.get(str(norm).strip().lower(), 'None')


# ── The core-level list (populate_core_level_list) ──────────────────────
def pca_candidates(w):
    """The sheets the PCA windows list: core levels with B.E. and Raw Data,
    without profiles, valence bands, wide scans and Auger lines (three
    consecutive lowercase letters, e.g. CKLL is kept, 'Ckll' is not),
    naturally sorted. Same list in both windows."""
    core_levels = []
    for sheet_name, cl in w.Data.get('Core levels', {}).items():
        if not isinstance(cl, dict) or 'B.E.' not in cl or 'Raw Data' not in cl:
            continue
        if 'zzProfile' in sheet_name or sheet_name.startswith('zzBook'):
            continue
        sheet_lower = sheet_name.lower()
        if any(x in sheet_lower for x in ['vb', 'valence', 'valenceband', 'wide']):
            continue
        if any(c.islower() for c in sheet_name):
            lower_count = 0
            for c in sheet_name:
                if c.islower():
                    lower_count += 1
                    if lower_count >= 3:
                        break
                else:
                    lower_count = 0
            if lower_count >= 3:
                continue
        core_levels.append(sheet_name)
    return {'sheets': sorted(core_levels, key=_natural_sort_key)}


# ── prepare_data (identical in both windows) ────────────────────────────
def _prepare(w, sheets):
    """Interpolate the selected spectra onto a common 1000-point B.E. grid
    (high to low BE) over the overlap of their ranges."""
    selected = [s for s in dict.fromkeys(sheets or [])
                if s in w.Data['Core levels']]
    be_ranges, raw_intensities, be_values_list = [], [], []
    sheet_names, etch_times = [], []
    for sheet_name in sorted(selected, key=_natural_sort_key):
        cl = w.Data['Core levels'][sheet_name]
        try:
            be_values = np.array(cl['B.E.'], dtype=float)
            raw_data = np.array(cl['Raw Data'], dtype=float)
            be_values_list.append(be_values)
            raw_intensities.append(raw_data)
            be_ranges.append((be_values.min(), be_values.max()))
            sheet_names.append(sheet_name)
            parts = sheet_name.split('_')
            if len(parts) > 1 and parts[-1].isdigit():
                etch_times.append(int(parts[-1]) * 10)
            else:
                etch_times.append(len(etch_times) * 10)
        except Exception:
            continue
    if not raw_intensities:
        raise ValueError("Please select core levels first")

    min_be = max(r[0] for r in be_ranges)
    max_be = min(r[1] for r in be_ranges)
    grid = np.linspace(max_be, min_be, 1000)

    spectra = []
    for be_values, intensities in zip(be_values_list, raw_intensities):
        f = interp1d(be_values, intensities, kind='linear', fill_value='extrapolate')
        spectra.append(f(grid))
    return sheet_names, etch_times, grid, np.array(spectra)


def _apply_offset(data, grid, offset_mode):
    data = np.abs(data.copy())
    if offset_mode == "Minimum Value":
        data = data - np.min(data, axis=1, keepdims=True)
    else:  # Smart Background: Shirley if descending, else linear
        for i in range(len(data)):
            spectrum = data[i]
            if spectrum[0] > spectrum[-1]:
                bg = BackgroundCalculations.calculate_shirley_background(
                    grid, spectrum, start_offset=0.0, end_offset=0.0, num_points=5)
            else:
                bg = BackgroundCalculations.calculate_linear_background(
                    grid, spectrum, start_offset=0.0, end_offset=0.0, num_points=5)
            data[i] = np.maximum(spectrum - bg, 0)
    return np.maximum(data, 0)


def _display_spectra(spectra, grid, offset_mode, norm_mode):
    """plot_all_spectra (NMF window) == _preprocess (Noise window): offset,
    normalise, then rescale to the overall maximum for display."""
    data = _apply_offset(spectra, grid, offset_mode)
    original_max = np.max(np.abs(data))
    if norm_mode == "Area":
        for i in range(len(data)):
            data[i] = data[i] - data[i][-1]
            data[i] = np.maximum(data[i], 0)
            area = np.abs(trapz(data[i], grid))
            if area > 0:
                data[i] = data[i] / area
    elif norm_mode == "Max Height":
        for i in range(len(data)):
            max_val = np.max(data[i])
            if max_val > 0:
                data[i] = data[i] / max_val
    if norm_mode != "None" and original_max > 0:
        data = data * original_max
    return data


def _nmf_input(spectra, grid, offset_mode, norm_mode):
    """on_analyse preprocessing (NMF window). Returns (X, original_max)."""
    data = _apply_offset(spectra, grid, offset_mode)
    original_max = np.max(np.abs(data))
    if norm_mode in ("Area", "Max Height"):
        for i in range(len(data)):
            data[i] = data[i] - data[i][-1]
            data[i] = np.maximum(data[i], 0)
            if norm_mode == "Area":
                scale = np.abs(trapz(data[i], grid))
            else:
                scale = np.max(data[i])
            if scale > 0:
                data[i] = data[i] / scale
    return data + 1e-10, original_max


# ── sklearn NMF (init='random', solver='cd', frobenius) in numpy ────────
def _update_cd(X, W, Ht):
    """sklearn _update_coordinate_descent + _update_cdnmf_fast (no l1/l2,
    no shuffle). Updates W in place, returns the projected-gradient
    violation. Rows of W are independent, so each coordinate column is
    updated for all rows at once; the gradient is summed in the Cython
    order (-XHt, then + HHt[t, r] * W[:, r] for r = 0..k-1)."""
    k = Ht.shape[1]
    HHt = np.dot(Ht.T, Ht)
    XHt = X @ Ht
    violation = 0.0
    for t in range(k):
        grad = -XHt[:, t]
        for r in range(k):
            grad = grad + HHt[t, r] * W[:, r]
        wt = W[:, t]
        pg = np.where(wt == 0, np.minimum(0.0, grad), grad)
        violation += float(np.sum(np.abs(pg)))
        hess = HHt[t, t]
        if hess != 0:
            W[:, t] = np.maximum(wt - grad / hess, 0.0)
    return violation


def _nmf_cd(X, n_components, max_iter=200, tol=1e-4, random_state=0):
    """NMF(n_components, init='random', random_state, max_iter, tol)
    .fit_transform(X): returns W, H, n_iter, reconstruction_err_."""
    X = np.asarray(X, dtype=np.float64)
    n_samples, n_features = X.shape
    # _initialize_nmf(init='random')
    avg = np.sqrt(X.mean() / n_components)
    rng = np.random.RandomState(random_state)
    H = avg * rng.standard_normal(size=(n_components, n_features))
    W = avg * rng.standard_normal(size=(n_samples, n_components))
    np.abs(H, out=H)
    np.abs(W, out=W)
    # _fit_coordinate_descent
    W = np.ascontiguousarray(W)
    Ht = np.ascontiguousarray(H.T)
    violation_init = None
    n_iter = 0
    for n_iter in range(1, max_iter + 1):
        violation = _update_cd(X, W, Ht)
        violation += _update_cd(X.T, Ht, W)
        if n_iter == 1:
            violation_init = violation
        if violation_init == 0:
            break
        if violation / violation_init <= tol:
            break
    H = Ht.T
    resid = np.ravel(X - np.dot(W, H))
    err = float(np.sqrt(2 * (np.dot(resid, resid) / 2.0)))
    return W, H, n_iter, err


# ── NMF window ───────────────────────────────────────────────────────────
def _nmf_run(w, sheets, n, offset, norm, iterations, tol):
    offset_mode, norm_mode = _offset_mode(offset), _norm_mode(norm)
    sheet_names, etch_times, grid, spectra = _prepare(w, sheets)
    n = int(n)
    X, original_max = _nmf_input(spectra, grid, offset_mode, norm_mode)
    W, H, n_iter, err = _nmf_cd(X, n, max_iter=int(iterations), tol=float(tol), random_state=0)
    components = H
    if norm_mode != "None" and original_max > 0:
        components = components * original_max
    return dict(sheet_names=sheet_names, etch_times=etch_times, grid=grid, spectra=spectra,
                offset_mode=offset_mode, norm_mode=norm_mode, W=W, components=components,
                n_iter=n_iter, err=err)


def nmf(w, sheets, n=2, offset='min', norm='area', iterations=1000, tol=1e-4, n_use=None):
    """PCAnalysisWindow.prepare_data + on_analyse (+ update_profile_plot).

    sheets: core-level names (any order; sorted naturally like the desktop).
    n: "Find" components. n_use: "Use" components (profiles and the
    create functions; default n). offset 'min'|'smart'; norm 'none'|'area'|
    'max'. iterations / tol: "Non-Negativity Fitting" Iterations and
    Convergence (desktop defaults 1000 and 0.0001).
    """
    r = _nmf_run(w, sheets, n, offset, norm, iterations, tol)
    W = r['W']
    k = W.shape[1]
    n_use = k if n_use is None else int(n_use)
    m = min(n_use, k)
    # update_profile_plot: profiles as concentration (%) of the first n_use
    conc = np.zeros_like(W)
    for j in range(W.shape[0]):
        row_sum = np.sum(W[j, :m])
        if row_sum > 0:
            conc[j, :m] = W[j, :m] / row_sum * 100.0
    return {
        'sheets': r['sheet_names'],
        'etch_times': r['etch_times'],
        'x': _list(r['grid']),
        'spectra': _list(_display_spectra(r['spectra'], r['grid'], r['offset_mode'], r['norm_mode'])),
        'components': _list(r['components']),
        'weights': _list(W.T),
        'weight_totals': _list(np.sum(W, axis=0)),
        'concentration': _list(conc[:, :m].T),
        'error': _num(r['err']),
        'n_iter': int(r['n_iter']),
        'converged': bool(r['n_iter'] < int(iterations)),
        'n': k,
        'n_use': n_use,
        'offset': r['offset_mode'],
        'norm': r['norm_mode'],
    }


def nmf_create(w, sheets, n=2, offset='min', norm='area', iterations=1000, tol=1e-4,
               n_use=None, kind='nmf'):
    """The NMF window's two bottom buttons, after the same analysis as nmf().

    kind='nmf'    "Create NMF as Core Levels" (on_create_core_levels): new
                  sheets NMF1..NMFn_use holding the components.
    kind='fitted' "Add NMFs to Core Levels" (on_create_fitted_core_levels):
                  replaces the peaks of every analysed sheet with one
                  SingleEntity peak per component and an Offset background.
    """
    from .sheets import select_sheet

    r = _nmf_run(w, sheets, n, offset, norm, iterations, tol)
    grid, components, W = r['grid'], r['components'], r['W']
    sheet_names = r['sheet_names']
    n_use = W.shape[1] if n_use is None else int(n_use)
    cls = w.Data['Core levels']

    if kind == 'nmf':
        created = []
        for i in range(min(n_use, len(components))):
            sheet_name = f"NMF{i + 1}"
            cls[sheet_name] = {
                'B.E.': grid.tolist(),
                'Raw Data': components[i].tolist(),
                'Background': {
                    'Bkg Y': components[i].tolist(),
                    'Type': 'None',
                    'Bkg Low': float(grid[-1]),
                    'Bkg High': float(grid[0]),
                },
            }
            created.append(sheet_name)
        w.Data['Number of Core levels'] = len(cls)
        if created:
            select_sheet(w, created[0])
        return {'created': created, 'updated': [], 'select': created[0] if created else None}

    if kind != 'fitted':
        raise ValueError(f"Unknown kind {kind!r}")

    first_sheet = sheet_names[0]
    base_name = "NMF"
    if '_' in first_sheet:
        base_name = first_sheet.split('_')[0]
    else:
        match = re.match(r'([A-Za-z]+\d*[spdfg]*)', first_sheet)
        if match:
            base_name = match.group(1)

    pca_min_be = float(np.min(grid))
    pca_max_be = float(np.max(grid))
    sorted_indices = np.argsort(grid)
    x_sorted = grid[sorted_indices]

    updated = []
    for j, original_sheet_name in enumerate(sheet_names):
        if original_sheet_name not in cls:
            continue
        original_be = np.array(cls[original_sheet_name]['B.E.'])
        peaks_dict = {}
        for i in range(min(n_use, len(components))):
            component_name = f"{base_name} NMF{i + 1}"
            coefficient = W[j, i]
            scale_factor = float(coefficient)
            unscaled = components[i]
            y_max_index = np.argmax(unscaled)
            x_center = float(grid[y_max_index])
            original_area = float(abs(trapz(unscaled[sorted_indices], x_sorted)))
            scaled = coefficient * unscaled
            current_area = float(abs(trapz(scaled[sorted_indices], x_sorted)))
            current_height = float(np.max(scaled))
            peaks_dict[component_name] = {
                "Position": round(x_center, 2),
                "Height": round(current_height, 2),
                "FWHM": 0.0,
                "L/G": round(original_area, 2),
                "Area": round(current_area, 2),
                "Sigma": 0.00,
                "Gamma": round(scale_factor, 2),
                "Skew": 0.0,
                "Fitting Model": "SingleEntity",
                "x_data": grid.tolist(),
                "y_data": unscaled.tolist(),
                "Original_Position": round(x_center, 2),
                "Original_Area": round(original_area, 2),
                "Original_Height": round(float(np.max(unscaled)), 2),
                "Constraints": {
                    "Position": f"{pca_min_be:.2f},{pca_max_be:.2f}",
                    "FWHM": "0.1:10",
                    "L/G": "0:1",
                    "Sigma": "-10:10",
                    "Gamma": "0.01:1000000",
                    "Skew": "0.00:3.00",
                },
            }

        offset_h = 0.0
        offset_l = 0.0
        bg = BackgroundCalculations.calculate_offset_background(
            grid, r['spectra'][j], offset_h, offset_l, num_points=5)
        interp_bg = interp1d(grid, bg, kind='linear', bounds_error=False, fill_value='extrapolate')
        full_background = np.maximum(interp_bg(original_be), 0)

        cls[original_sheet_name]['Background'] = {
            'Bkg Y': full_background.tolist(),
            'Bkg Type': 'Offset',
            'Bkg Low': pca_max_be,
            'Bkg High': pca_min_be,
            'Bkg Offset Low': offset_l,
            'Bkg Offset High': offset_h,
            # The desktop stores a tuple; it is saved as a JSON list.
            'Recorded_Ranges': [[offset_h, offset_l, pca_min_be, pca_max_be]],
        }
        if 'Fitting' not in cls[original_sheet_name]:
            cls[original_sheet_name]['Fitting'] = {}
        cls[original_sheet_name]['Fitting']['Peaks'] = peaks_dict
        cls[original_sheet_name]['Fitting']['Model'] = 'SingleEntity'
        updated.append(original_sheet_name)

    current = w.sheet_combobox.GetValue()
    if current in updated:
        select_sheet(w, current)
    return {'created': [], 'updated': updated, 'select': current if current in updated else None}


# ── sklearn PCA (svd_solver='full') in numpy/scipy ──────────────────────
def _pca_full(X, n_components):
    """PCA(n_components, svd_solver='full').fit_transform(X).
    Returns scores, components, explained_variance_ratio (fractions)."""
    X = np.asarray(X, dtype=np.float64)
    n_samples = X.shape[0]
    mean = np.mean(X, axis=0)
    Xc = X - mean
    U, S, Vt = linalg.svd(Xc, full_matrices=False)
    explained_variance = (S ** 2) / (n_samples - 1)
    # svd_flip(u_based_decision=False)
    max_abs_rows = np.argmax(np.abs(Vt), axis=1)
    signs = np.sign(Vt[np.arange(Vt.shape[0]), max_abs_rows])
    U *= signs[np.newaxis, :]
    Vt *= signs[:, np.newaxis]
    total_var = np.sum(explained_variance)
    ratio = explained_variance / total_var
    scores = U[:, :n_components] * S[:n_components]
    return scores, Vt[:n_components].copy(), ratio[:n_components]


def _pca_run(w, sheets, n, offset, norm, standardize, solver):
    offset_mode, norm_mode = _offset_mode(offset), _norm_mode(norm)
    sheet_names, etch_times, grid, spectra = _prepare(w, sheets)
    n = max(1, min(int(n), len(spectra), spectra.shape[1]))
    pre = _display_spectra(spectra, grid, offset_mode, norm_mode)
    data = pre.copy()
    feature_std = None
    if standardize:
        feature_std = np.std(data, axis=0)
        feature_std[feature_std == 0] = 1.0
        data = data / feature_std
    mean_spectrum = np.mean(data, axis=0)
    # 'randomized' converges to the same decomposition for these small
    # matrices; it is computed with the exact SVD here.
    scores, loadings, ratio = _pca_full(data - mean_spectrum, n)
    return dict(sheet_names=sheet_names, etch_times=etch_times, grid=grid, spectra=spectra,
                pre=pre, feature_std=feature_std, mean=mean_spectrum, scores=scores,
                loadings=loadings, ratio=ratio * 100.0, n=n,
                offset_mode=offset_mode, norm_mode=norm_mode)


def _selected(r, use):
    k = r['scores'].shape[1]
    if use is None:
        return list(range(k))
    return sorted({int(i) - 1 for i in use if 1 <= int(i) <= k})


def _reconstruct(r, j, selected):
    rec = r['mean'].copy()
    for i in selected:
        rec = rec + r['scores'][j, i] * r['loadings'][i]
    if r['feature_std'] is not None:
        rec = rec * r['feature_std']
    return rec


def pca(w, sheets, n=2, offset='min', norm='area', standardize=False, solver='full', use=None):
    """StandardPCAWindow.prepare_data + on_analyse ("PCA Analysis (Noise)").

    n: "Find" (clamped to the number of spectra). use: 1-based PCs ticked
    in the component list (default all) for the reconstruction.
    """
    r = _pca_run(w, sheets, n, offset, norm, standardize, solver)
    sel = _selected(r, use)
    recon = [_reconstruct(r, j, sel) for j in range(len(r['sheet_names']))]
    return {
        'sheets': r['sheet_names'],
        'etch_times': r['etch_times'],
        'x': _list(r['grid']),
        'spectra': _list(r['pre']),
        'components': _list(r['loadings']),
        'scores': _list(r['scores'].T),
        'explained_variance': _list(r['ratio']),
        'mean': _list(r['mean']),
        'reconstructed': _list(np.array(recon)),
        'use': [i + 1 for i in sel],
        'variance_retained': _num(sum(r['ratio'][i] for i in sel)),
        'n': r['n'],
        'offset': r['offset_mode'],
        'norm': r['norm_mode'],
    }


def _recon_name(name):
    """C1s_1 -> C1s_r1, Ce3d49 -> Ce3d_r49, O1s -> O1s_r."""
    m = re.match(r'^(.*?)_?(\d+)$', name)
    if m:
        return f"{m.group(1)}_r{m.group(2)}"
    return f"{name}_r"


def pca_create(w, sheets, n=2, offset='min', norm='area', standardize=False, solver='full',
               use=None, targets=None):
    """"Add Reconstructed as Core Levels" (on_add_reconstructed_core_levels):
    for each analysed sheet (or only those in targets) a new sheet
    <name>_r<N> with the spectrum rebuilt from the selected PCs,
    interpolated back onto that sheet's own B.E. axis."""
    from .sheets import select_sheet

    r = _pca_run(w, sheets, n, offset, norm, standardize, solver)
    sel = _selected(r, use)
    if not sel:
        raise ValueError("No PCs selected in the component list.")
    cls = w.Data['Core levels']
    wanted = None if targets is None else set(targets)
    created = []
    for j, original_sheet in enumerate(r['sheet_names']):
        if wanted is not None and original_sheet not in wanted:
            continue
        recon_name = _recon_name(original_sheet)
        rec = _reconstruct(r, j, sel)
        original_be = np.array(cls[original_sheet]['B.E.'], dtype=float)
        f = interp1d(r['grid'], rec, kind='linear', fill_value='extrapolate')
        be_list = original_be.tolist()
        recon_list = f(original_be).tolist()
        cls[recon_name] = {
            'B.E.': be_list,
            'Raw Data': recon_list,
            'Background': {
                'Bkg Y': recon_list,
                'Type': 'None',
                'Bkg Low': float(original_be[-1]),
                'Bkg High': float(original_be[0]),
            },
        }
        created.append(recon_name)
    w.Data['Number of Core levels'] = len(cls)
    if created:
        select_sheet(w, created[0])
    return {'created': created, 'select': created[0] if created else None}
