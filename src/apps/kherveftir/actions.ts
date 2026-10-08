// KherveFTIR's AI `run` actions: the FTIR Analysis window's controls and
// handlers (libraries/ToolsMenu/FTIR_Analysis.py, attribute names as there).
// Described for models in src/os/ai/manifests/kherveftir.ts.

import { defined, optNum, optStr, type ActionTable } from '../khervetech/actions.ts'

const UNITS = ['Transmittance (%)', 'Transmittance (fraction)', 'Absorbance', 'Reflectance (%)', 'Kubelka-Munk', 'Intensity (a.u.)']
const METHODS = ['Intensity (prominence)', '2nd derivative (resolves shoulders)']
const pick = (list: string[], v: string | undefined) => (v ? list.find((m) => m.toLowerCase() === v.toLowerCase()) ?? list.find((m) => m.toLowerCase().startsWith(v.toLowerCase())) ?? list.find((m) => m.toLowerCase().includes(v.toLowerCase())) ?? v : undefined)
const PRESETS = ['Gentle', 'Standard', 'Strong']

export const FTIR_ACTIONS: ActionTable = {
  detect_unit: { call: 'on_detect_unit', read: ['unit_note', 'warning_text'] },
  input_unit: {
    call: 'on_input_unit_changed',
    set: ({ options: o }) => defined({ input_unit_choice: pick(UNITS, optStr(o, 'unit')) }),
    read: ['unit_note', 'warning_text'],
  },
  display_unit: {
    call: 'on_display_unit_changed',
    set: ({ options: o }) => defined({ display_unit_choice: pick(UNITS, optStr(o, 'unit')) }),
    read: ['unit_note'],
  },
  auto_clean: {
    call: 'on_auto_clean',
    args: ({ options: o }) => [pick(PRESETS, optStr(o, 'preset')) ?? 'Standard'],
    read: ['history_text'],
  },
  reset: { call: 'on_reset', read: ['history_text'] },
  find_bands: {
    call: 'on_find_peaks',
    set: ({ options: o }) =>
      defined({
        method_choice: pick(METHODS, optStr(o, 'method')),
        prominence_ctrl: optNum(o, 'prominence'),
        distance_ctrl: optNum(o, 'min_distance', 'distance'),
        tolerance_ctrl: optNum(o, 'tolerance'),
      }),
    read: ['peaks_grid'],
  },
  reassign: {
    call: 'on_reassign',
    set: ({ options: o }) => defined({ tolerance_ctrl: optNum(o, 'tolerance') }),
    read: ['peaks_grid'],
  },
  label_bands: { call: 'on_label_peaks', read: [] },
  clear_labels: { call: 'on_clear_labels', read: [] },
  band_library: {
    call: 'on_search_library',
    set: ({ options: o }) => defined({ search_ctrl: optStr(o, 'search', 'query') ?? '' }),
    read: ['library_grid'],
  },
  add_reference: {
    call: 'on_load_reference',
    args: () => [],
    set: ({ options: o }) => defined({ ref_listbox: optStr(o, 'name', 'file') }),
    read: ['ref_listbox'],
  },
}
