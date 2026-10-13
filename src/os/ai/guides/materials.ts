// Guides of the Materials apps other than the technique apps (techniques.ts): XPS.

import type { AppGuide } from './core.ts'

export const MATERIALS_GUIDES: AppGuide[] = [
  {
    app: 'khervefitting',
    use: 'XPS spectra: background, peak fitting of core levels, constraints, atomic % composition',
    about:
      'XPS peak fitting with the engine of the desktop KherveFitting-AI. A workbook holds one sheet per core level (C1s, O1s, Survey…); for each you set a background, add peaks, fit, and the Results grid turns peak areas into atomic % and weight %.',
    writes: ['the workbook / project it was opened from (Save in the app)', 'plots and tables through the app\'s own File menu'],
    concepts: [
      'Binding energy in eV on a reversed axis; intensity in counts per second (CPS).',
      'A core level = a sheet. `khervefitting_list_core_levels` shows the open file, its sheets and, for the shown one, its BE range, background and number of peaks.',
      'Background: a region between low and high BE (eV) with a method: Smart (default), Shirley, Iterated Shirley, Linear, Offset, U4-Tougaard, U2-Tougaard, Active Shirley, Active Tougaard.',
      'Peak table columns: ID letter, label, position (eV), height, FWHM, L/G (Lorentzian / Gaussian mix, %), area, model, Conc. % and constraints. Spin-orbit doublets (p, d, f) need their pair constrained.',
      'Fit quality: chi (< 1 excellent, 1–3 acceptable), R², reduced chi². The Results grid holds atomic % and weight % of the ticked rows, using relative sensitivity factors.',
    ],
    workflow: [
      '`khervefitting_open_example` (no name lists them, e.g. "SP2 Carbon", "Fe2O3", "Ni(0)-NiO"), or `open_file` / `open_app` with the user\'s file (.vms; .xlsx workbooks are opened from KherveFitting\'s own File menu).',
      '`khervefitting_list_core_levels`, then `khervefitting_select_core_level` for the sheet to work on.',
      '`khervefitting_set_background` with low / high BE around the peak group (flat ends, the whole peak inside) and a method.',
      '`khervefitting_add_peak` for each component (position optional: it goes where the data stands highest above the current fit; fwhm, lg, model optional), then `khervefitting_fit` (passes until chi is stable). Read `khervefitting_get_peaks`.',
      'Repeat per core level, then `khervefitting_get_results` with export=true to add the shown level\'s peaks to the Results grid and read the composition.',
    ],
    pitfalls: [
      'add_peak needs a background first and does not fit: call `khervefitting_fit` after it.',
      'Add only as many peaks as the chemistry justifies; a lower chi from extra peaks is not evidence.',
      'Binding energies depend on charge referencing (adventitious C 1s is usually set to 284.8 eV): say which reference was used.',
      'Fits act on the selected core level; select the sheet first (or pass "sheet").',
    ],
    with: [
      ['khervedb', 'NIST binding energies to identify the chemical state of a fitted peak'],
      ['khervesheet', 'tabulate peak parameters and compositions'],
      ['kplot', 'publication figure (reversed BE axis)'],
      ['keln', 'the lab notebook has an XPS entry with sample lineage'],
    ],
  },
]
