// kDilatometer's AI `run` actions: the Dilatometry Analysis window's controls and handlers
// (libraries/ToolsMenu/DIL_Analysis.py, attribute names as there).
// Described for models in src/os/ai/manifests/khervedilatometer.ts.

import { defined, optNum, type ActionTable } from '../khervetech/actions.ts'

export const DIL_ACTIONS: ActionTable = {
  segments: {
    // only reads: the sheet's programme segments (S1, S2…) as the Data tab lists them
    read: ['info_text', 'seg_grid'],
  },
  segment_sheet: {
    // "Sheet from selected segment": the row is 1-based, as the S1, S2… labels
    call: 'on_segment_sheet',
    set: ({ options: o }) => {
      const n = optNum(o, 'segment')
      return defined({ seg_grid: n === undefined ? undefined : n - 1 })
    },
    read: ['info_text', 'seg_grid'],
  },
  all_segment_sheets: { call: 'on_all_segment_sheets', read: ['info_text', 'seg_grid'] },
  mean_cte: {
    call: 'on_mean_cte',
    set: ({ low, high }) => defined({ t1_ctrl: low, t2_ctrl: high }),
    read: ['cte_result'],
  },
  alpha: {
    call: 'on_alpha_sheet',
    set: ({ options: o }) => defined({ alpha_window_ctrl: optNum(o, 'window') }),
    read: ['cte_result'],
  },
  sintering: {
    call: 'on_sinter',
    set: ({ options: o }) => defined({ onset_ctrl: optNum(o, 'onset'), alpha_window_ctrl: optNum(o, 'window') }),
    read: ['sinter_report'],
  },
  label_plot: { call: 'on_label_plot', read: [] },
  clear_labels: { call: 'on_clear_labels', read: [] },
}
