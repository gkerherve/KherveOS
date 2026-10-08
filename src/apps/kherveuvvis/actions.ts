// KherveUVVis's AI `run` actions: the UV-Vis Analysis window's controls and
// handlers (libraries/ToolsMenu/UVVIS_Analysis.py, attribute names as there).
// Described for models in src/os/ai/manifests/kherveuvvis.ts.

import { defined, optStr, type ActionTable } from '../khervetech/actions.ts'

const MODES = ['Absorbance', 'Transmittance (%)', 'Reflectance (%)']
const TRANSITIONS = ['Direct allowed (n = 2)', 'Indirect allowed (n = 1/2)', 'Direct forbidden (n = 2/3)', 'Indirect forbidden (n = 1/3)']
const pick = (list: string[], v: string | undefined) => (v ? list.find((m) => m.toLowerCase().startsWith(v.toLowerCase())) ?? list.find((m) => m.toLowerCase().includes(v.toLowerCase())) ?? v : undefined)

export const UVVIS_ACTIONS: ActionTable = {
  absorbance: {
    call: 'on_convert',
    set: ({ options: o }) => defined({ mode_radio: pick(MODES, optStr(o, 'ordinate', 'mode')) }),
    read: ['info_text'],
  },
  tauc_sheet: {
    call: 'on_make_tauc',
    set: ({ options: o }) => defined({ transition_choice: pick(TRANSITIONS, optStr(o, 'transition')) }),
    read: [],
  },
  suggest_window: { call: 'on_suggest_window', read: ['e_lo_ctrl', 'e_hi_ctrl'] },
  fit_band_gap: {
    call: 'on_fit_tauc',
    set: ({ low, high }) => defined({ e_lo_ctrl: low, e_hi_ctrl: high }),
    read: ['tauc_result'],
  },
  insert_inset: {
    call: 'on_insert_inset',
    set: ({ options: o }) => defined({ inset_size_ctrl: o.font_size }),
    read: [],
  },
  remove_inset: { call: 'on_remove_inset', read: [] },
  band_maxima: { call: 'on_find_peaks', read: ['peaks_list'] },
}
