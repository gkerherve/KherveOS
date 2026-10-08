// KherveRaman's AI `run` actions: the Raman Analysis window's controls and
// handlers (libraries/ToolsMenu/Raman_Analysis.py, attribute names as there).
// Described for models in src/os/ai/manifests/kherveraman.ts.

import { defined, optStr, type ActionTable } from '../khervetech/actions.ts'

export const RAMAN_ACTIONS: ActionTable = {
  metadata: {
    call: 'on_meta_changed',
    set: ({ options: o }) =>
      defined({
        material_choice: optStr(o, 'material'),
        substrate_choice: optStr(o, 'substrate'),
        elements_ctrl: optStr(o, 'elements'),
        excitation_combo: optStr(o, 'laser', 'excitation'),
        in_air_check: typeof o.in_air === 'boolean' ? o.in_air : undefined,
      }),
    read: [],
  },
  find_peaks: { call: 'on_find_peaks', read: ['peaks_grid'] },
  use_fitted: { call: 'on_use_fitted', read: ['peaks_grid'] },
  reassign: { call: 'on_reassign', read: ['peaks_grid'] },
  label_plot: { call: 'on_label_peaks', read: [] },
  clear_labels: { call: 'on_clear_labels', read: [] },
  band_library: {
    call: 'on_search_library',
    set: ({ options: o }) => defined({ search_ctrl: optStr(o, 'search', 'query') ?? '' }),
    read: ['library_grid'],
  },
}
