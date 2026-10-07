"""More requests of the KherveFitting web page: the desktop's (dev-AI) tools.

The bridge merges these into its tables:

    from .features import OPS as FOPS, MUTATING as FMUT, NEEDS as FNEEDS, view_extra

Each op takes the request's args and answers a dict (the bridge adds ok /
canUndo). Ops that change what is shown answer ``view``. ``view_extra(w,
sheet)`` gives the fields added to every view.

Fitting window ........ add_doublet, remove_region, propagate, monte_carlo (kfcore.fitops,
                        kfcore.uncertainty)
Peak library .......... lib_kinds, lib_save, lib_load          (kfcore.peaklib)
Core levels ........... sheet_rename, sheet_delete, sheet_copy, sheet_join,
                        sheet_crop_info, sheet_crop, sheet_sort   (kfcore.sheetops)
BE correction ......... be_set, be_auto, be_reset              (kfcore.becorr)
Sample manager ........ samples, sample_rename                 (kfcore.samples)
Survey identification . id_labels_add, id_labels_remove_last, id_labels_clear,
                        id_add_peaks, auto_id, auto_id_create   (kfcore.survey)
D-parameter ........... dparam, dparam_clear                   (kfcore.dparam)
Area measurement ...... area_methods, area_create, area_batch  (kfcore.area)
PCA / NMF ............. nmf, nmf_create                        (kfcore.pca)

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0 (KherveFitting code: GPL-3.0-only).
"""

from __future__ import annotations


def _B():
    from kfweb import bridge as B
    return B


def _w():
    return _B()._session()


def _current(w, a=None):
    name = (a or {}).get('sheet') or w.sheet_combobox.GetValue()
    if not name or name not in w.Data['Core levels']:
        raise ValueError("Please select a core level first.")
    return name


def _select(w, name):
    """Make name the current sheet (as choosing it in the combo box does)."""
    from kfcore.sheets import select_sheet
    if w.sheet_combobox.GetValue() != name:
        select_sheet(w, name)
        w.background_method = w.background_method or 'Smart'


def _view(arrays=True):
    w = _w()
    w.background_method = w.background_method or 'Smart'
    return _B().view(include_arrays=arrays)


# ── Peak library ─────────────────────────────────────────────────────
def op_lib_kinds(a):
    from kfcore.peaklib import save_choices, suggested_name
    w = _w()
    _current(w)
    kinds = save_choices(w)
    return {'kinds': kinds, 'names': {k: suggested_name(w, k) for k in kinds}}


def op_lib_save(a):
    from kfcore.peaklib import save_library
    w = _w()
    _current(w)
    kind = a.get('kind', 'peaks')
    name, text = save_library(w, kind, a.get('name') or None)
    out = {'name': name, 'json': text}
    if kind == 'single':     # the desktop's constrained fit has changed the peaks a little
        w.load_view()
        out['view'] = _view()
    return out


def op_lib_load(a):
    from kfcore.peaklib import load_library
    w = _w()
    _current(w)
    info = load_library(w, a['json'], a.get('mode', 'overwrite'))
    return {'view': _view(), **info}


# ── Core levels ──────────────────────────────────────────────────────
def _sheet_result(sheets, original, selected):
    B = _B()
    B.S.sheets = sheets
    B.S.original = original
    w = _w()
    if selected and w.sheet_combobox.GetValue() != selected:
        _select(w, selected)
    return {'view': _view(), 'sheet': selected}


def op_sheet_rename(a):
    from kfcore.sheetops import rename_sheet
    B, w = _B(), _w()
    old = _current(w, a)
    _select(w, old)
    return _sheet_result(*rename_sheet(w, list(B.S.sheets), B.S.original, old, a.get('name', '')))


def op_sheet_delete(a):
    from kfcore.sheetops import delete_sheet
    B, w = _B(), _w()
    name = _current(w, a)
    return _sheet_result(*delete_sheet(w, list(B.S.sheets), B.S.original, name))


def op_sheet_copy(a):
    from kfcore.sheetops import copy_sheet
    B, w = _B(), _w()
    name = _current(w, a)
    return _sheet_result(*copy_sheet(w, list(B.S.sheets), B.S.original, name))


def op_sheet_join(a):
    from kfcore.sheetops import join_sheets
    B, w = _B(), _w()
    return _sheet_result(*join_sheets(w, list(B.S.sheets), B.S.original, list(a.get('sheets') or []),
                                      a.get('name') or 'Joined_Scan'))


def op_sheet_crop_info(a):
    from kfcore.sheetops import crop_info
    w = _w()
    return crop_info(w, _current(w, a))


def op_sheet_crop(a):
    from kfcore.sheetops import crop_sheets
    B, w = _B(), _w()
    sheet = _current(w, a)
    names = [sheet] + [s for s in (a.get('also') or []) if s != sheet]
    sheets, original, created, failures = crop_sheets(
        w, list(B.S.sheets), B.S.original, names, float(a['low']), float(a['high']),
        a.get('name') or None, name_sheet=sheet)
    if not created:
        raise ValueError("Some sheets could not be cropped:\n\n" + "\n".join(failures))
    ans = _sheet_result(sheets, original, created[0])
    ans.update({'created': created, 'failures': failures})
    return ans


def op_sheet_sort(a):
    from kfcore.sheetops import sort_sheets
    B, w = _B(), _w()
    return _sheet_result(*sort_sheets(w, list(B.S.sheets), B.S.original))


# ── BE correction ────────────────────────────────────────────────────
def _samples_arg(w, value):
    from kfcore.becorr import sample_of, samples_present
    if value in (None, 'current'):
        return [sample_of(w.sheet_combobox.GetValue())]
    if value == 'all':
        return samples_present(w)
    if isinstance(value, (int, str)):
        value = [value]
    return [str(int(v)) for v in value]


def op_be_set(a):
    from kfcore.becorr import sample_of, set_correction
    w = _w()
    sheet = _current(w)
    sample = str(a['sample']) if a.get('sample') is not None else sample_of(sheet)
    delta = set_correction(w, sample, float(a['value']))
    return {'view': _view(), 'shift': delta}


def op_be_auto(a):
    from kfcore.becorr import auto_correct
    w = _w()
    _current(w)
    corrections, missing = auto_correct(w, _samples_arg(w, a.get('samples', 'current')),
                                        a.get('peak') or 'C1s C-C', float(a.get('ref', 284.8)))
    return {'view': _view(), 'corrections': corrections, 'missing': missing}


def op_be_reset(a):
    from kfcore.becorr import reset
    w = _w()
    _current(w)
    done = reset(w, _samples_arg(w, a.get('samples', 'current')))
    return {'view': _view(), 'reset': done}


# ── Sample manager ───────────────────────────────────────────────────
def op_samples(a):
    from kfcore.samples import sample_grid
    return sample_grid(_w(), _B().S.sheets)


def op_sample_rename(a):
    from kfcore.samples import rename_sample, sample_grid
    w = _w()
    rename_sample(w, a['sample'], a.get('name', ''))
    return {**sample_grid(w, _B().S.sheets), 'view': _view(False)}


# ── Survey identification / labels / Auto ID ─────────────────────────
def op_id_labels_add(a):
    from kfcore.survey import add_labels
    w = _w()
    _current(w)
    info = add_labels(w, list(a.get('labels') or []))
    return {'view': _view(False), 'added': info.get('added'), 'skipped': info.get('skipped', [])}


def op_id_labels_remove_last(a):
    from kfcore.survey import remove_last_label
    w = _w()
    _current(w)
    remove_last_label(w)
    return {'view': _view(False)}


def op_id_labels_clear(a):
    from kfcore.survey import clear_labels
    w = _w()
    _current(w)
    clear_labels(w)
    return {'view': _view(False)}


def op_id_add_peaks(a):
    from kfcore.survey import add_survey_peaks
    w = _w()
    _current(w)
    info = add_survey_peaks(w, list(a.get('names') or []))
    return {'view': _view(), 'added': info.get('added')}


_AUTO_ID_ARGS = ('prominence', 'force', 'tolerance', 'width', 'width_max', 'distance', 'max_possibilities')
_AUTO_ID_ALIASES = {'widthMax': 'width_max', 'maxPossibilities': 'max_possibilities'}


def _auto_id_kwargs(a):
    kw = {}
    for k, v in a.items():
        k = _AUTO_ID_ALIASES.get(k, k)
        if k in _AUTO_ID_ARGS and v is not None:
            kw[k] = v if k == 'force' else float(v)
    if 'max_possibilities' in kw:
        kw['max_possibilities'] = int(kw['max_possibilities'])
    return kw


def op_auto_id(a):
    """Run the classic engine and propose (nothing is changed)."""
    from kfcore.survey import auto_id
    w = _w()
    _current(w)
    return auto_id(w, apply=False, **_auto_id_kwargs(a))


def op_auto_id_run(a):
    """The desktop's Run button: propose, then labels + main peaks' areas at once."""
    from kfcore.survey import auto_id
    w = _w()
    _current(w)
    out = auto_id(w, apply=True, **_auto_id_kwargs(a))
    out['view'] = _view()
    return out


def op_auto_id_create(a):
    from kfcore.survey import auto_id_create
    w = _w()
    _current(w)
    out = auto_id_create(w, list(a.get('items') or []), a.get('mode', 'labels'), a.get('force') or '')
    out['view'] = _view()
    return out


def op_auto_id_clear(a):
    from kfcore.survey import auto_id_clear
    w = _w()
    _current(w)
    auto_id_clear(w)
    return {'view': _view()}


def op_auto_id_options(a):
    """The 'Force Assignment' choices for one detected peak."""
    from kfcore.survey import possible_assignments
    w = _w()
    _current(w)
    return {'options': possible_assignments(w, float(a['be']), float(a.get('tolerance', 12)), a.get('force') or '')}


# ── D-parameter ──────────────────────────────────────────────────────
def op_dparam(a):
    from kfcore.dparam import dparam
    w = _w()
    _current(w)
    kw = {}
    for k in ('smooth', 'diff'):
        if a.get(k) is not None:
            kw[k] = float(a[k])
    for k in ('pre', 'post'):
        if a.get(k) is not None:
            kw[k] = int(a[k])
    if a.get('algorithm'):
        kw['algorithm'] = a['algorithm']
    out = dparam(w, **kw)
    out['view'] = _view()
    return out


def op_dparam_clear(a):
    from kfcore.dparam import dparam_clear
    w = _w()
    _current(w)
    dparam_clear(w)
    return {'view': _view()}


def op_dparam_calibration(a):
    from kfcore.dparam import ALGORITHMS, dparam_calibration
    return {'algorithms': ALGORITHMS, **dparam_calibration()}


# ── Measure Area ─────────────────────────────────────────────────────
def op_area_methods(a):
    from kfcore.area import DEFAULT_METHOD, EELS_METHODS, FTIR_METHODS, METHODS
    return {'methods': METHODS, 'ftir': FTIR_METHODS, 'eels': EELS_METHODS, 'default': DEFAULT_METHOD}


def op_area_create(a):
    from kfcore.area import DEFAULT_METHOD, area_create
    w = _w()
    _current(w)
    out = area_create(w, a.get('method') or DEFAULT_METHOD, float(a['low']), float(a['high']),
                      a.get('name') or None, float(a.get('offsetLow', 0) or 0), float(a.get('offsetHigh', 0) or 0),
                      int(a.get('averagingPoints', 1) or 1), a.get('tougaard'))
    out['view'] = _view()
    return out


def op_area_batch(a):
    from kfcore.area import area_batch
    w = _w()
    _current(w)
    out = area_batch(w, a.get('sheets'), float(a.get('offsetLow', 0) or 0), float(a.get('offsetHigh', 0) or 0))
    out['view'] = _view()
    return out


# ── Fitting window: doublets, regions, batching, Monte Carlo ─────────
def op_add_doublet(a):
    from kfcore.fitops import add_doublet
    w = _w()
    _current(w)
    if a.get('model'):
        w.selected_fitting_method = a['model']
    name = a.get('name')
    indices = add_doublet(w, name if name not in ('',) else None)
    return {'view': _view(), 'indices': indices}


def op_remove_region(a):
    from kfcore.fitops import remove_region
    w = _w()
    _current(w)
    left = remove_region(w, int(a['index']))
    return {'view': _view(), 'regions': left}


def op_propagate(a):
    from kfcore import fitops
    w = _w()
    _current(w)
    fn = {'fit': fitops.propagate_fittings, 'constraints': fitops.propagate_constraints,
          'row': fitops.propagate_row}.get(a.get('kind', 'fit'))
    if fn is None:
        raise ValueError("kind must be 'fit', 'constraints' or 'row'")
    out = fn(w, list(a.get('sheets') or []))
    out['view'] = _view()
    return out


def op_monte_carlo(a):
    from kfcore.uncertainty import errors_by_peak, mc_report, run_monte_carlo
    w = _w()
    _current(w)
    stats = run_monte_carlo(w, int(a.get('n', 100) or 100), seed=a.get('seed'))
    return {'view': _view(False), 'report': mc_report(stats),
            'errors': {str(k): v for k, v in errors_by_peak(w).items()}}


# ── PCA / NMF ────────────────────────────────────────────────────────
def _nmf_args(a):
    return dict(n=int(a.get('n', 2)), offset=a.get('offset', 'min'), norm=a.get('norm', 'area'),
                iterations=int(a.get('iterations', 1000)), tol=float(a.get('tol', 1e-4)),
                n_use=(int(a['nUse']) if a.get('nUse') is not None else None))


def _pca_args(a):
    return dict(n=int(a.get('n', 2)), offset=a.get('offset', 'min'), norm=a.get('norm', 'area'),
                standardize=bool(a.get('standardize', False)), solver=a.get('solver', 'full'),
                use=a.get('use'))


def _created(info):
    """New sheets go at the end of the list (an existing name is replaced in place)."""
    B, w = _B(), _w()
    for name in info.get('created') or []:
        if name not in B.S.sheets:
            B.S.sheets.append(name)
    sel = info.get('select')
    if sel and sel in w.Data['Core levels'] and w.sheet_combobox.GetValue() != sel:
        _select(w, sel)
    return {'view': _view(), **{k: v for k, v in info.items() if k != 'view'}}


def op_pca_candidates(a):
    from kfcore.pca import pca_candidates
    return pca_candidates(_w())


def op_nmf(a):
    from kfcore.pca import nmf
    return nmf(_w(), list(a['sheets']), **_nmf_args(a))


def op_nmf_create(a):
    from kfcore.pca import nmf_create
    return _created(nmf_create(_w(), list(a['sheets']), kind=a.get('kind', 'nmf'), **_nmf_args(a)))


def op_pca(a):
    from kfcore.pca import pca
    return pca(_w(), list(a['sheets']), **_pca_args(a))


def op_pca_create(a):
    from kfcore.pca import pca_create
    return _created(pca_create(_w(), list(a['sheets']), targets=a.get('targets'), **_pca_args(a)))


OPS = {
    'add_doublet': op_add_doublet, 'remove_region': op_remove_region, 'propagate': op_propagate,
    'monte_carlo': op_monte_carlo,
    'dparam': op_dparam, 'dparam_clear': op_dparam_clear, 'dparam_calibration': op_dparam_calibration,
    'area_methods': op_area_methods, 'area_create': op_area_create, 'area_batch': op_area_batch,
    'id_labels_add': op_id_labels_add, 'id_labels_remove_last': op_id_labels_remove_last,
    'id_labels_clear': op_id_labels_clear, 'id_add_peaks': op_id_add_peaks,
    'auto_id': op_auto_id, 'auto_id_run': op_auto_id_run, 'auto_id_create': op_auto_id_create,
    'auto_id_clear': op_auto_id_clear, 'auto_id_options': op_auto_id_options,
    'pca_candidates': op_pca_candidates, 'nmf': op_nmf, 'nmf_create': op_nmf_create,
    'pca': op_pca, 'pca_create': op_pca_create,
    'lib_kinds': op_lib_kinds, 'lib_save': op_lib_save, 'lib_load': op_lib_load,
    'sheet_rename': op_sheet_rename, 'sheet_delete': op_sheet_delete, 'sheet_copy': op_sheet_copy,
    'sheet_join': op_sheet_join, 'sheet_crop_info': op_sheet_crop_info, 'sheet_crop': op_sheet_crop,
    'sheet_sort': op_sheet_sort,
    'be_set': op_be_set, 'be_auto': op_be_auto, 'be_reset': op_be_reset,
    'samples': op_samples, 'sample_rename': op_sample_rename,
}

MUTATING = {
    'lib_save', 'lib_load',
    'sheet_rename', 'sheet_delete', 'sheet_copy', 'sheet_join', 'sheet_crop', 'sheet_sort',
    'be_set', 'be_auto', 'be_reset', 'sample_rename',
    'nmf_create', 'pca_create',
    'id_labels_add', 'id_labels_remove_last', 'id_labels_clear', 'id_add_peaks',
    'auto_id_run', 'auto_id_create', 'auto_id_clear',
    'dparam', 'dparam_clear', 'area_create', 'area_batch',
    'add_doublet', 'remove_region', 'propagate', 'monte_carlo',
}

_CORE = ["numpy", "scipy", "lmfit"]
#: The sheet operations edit the opened workbook's bytes.
NEEDS = {op: _CORE + ["openpyxl"] for op in
         ('sheet_rename', 'sheet_delete', 'sheet_copy', 'sheet_join', 'sheet_crop', 'sheet_sort')}


def view_extra(w, sheet):
    """Fields added to every view (cheap)."""
    from kfcore.becorr import correction_of, sample_of
    sample = sample_of(sheet) if sheet else "0"
    out = {'sample': int(sample), 'beCorrection': correction_of(w, sample),
           'sampleName': str((w.Data.get('SampleNames') or {}).get(sample, '') or ''),
           'labels': [], 'dparam': None, 'areaFills': None}
    cl = w.Data['Core levels'].get(sheet) if sheet else None
    if cl:
        if cl.get('Labels'):
            from kfcore.survey import labels_of
            out['labels'] = labels_of(w, sheet)
        try:
            from kfcore.dparam import dparam_view
            out['dparam'] = dparam_view(w, sheet)
        except Exception:      # never let an overlay stop the view
            out['dparam'] = None
        try:
            from kfcore.area import area_fills
            out['areaFills'] = area_fills(w, sheet)
        except Exception:
            out['areaFills'] = None
    return out
