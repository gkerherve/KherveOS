// KherveTGA's AI `run` actions: the TGA / DSC Analysis window's controls and
// handlers (libraries/ToolsMenu/TGA_Analysis.py, attribute names as there).
// Described for models in src/os/ai/manifests/khervetga.ts.

import { defined, optList, optNum, optStr, type ActionTable } from '../khervetech/actions.ts'

const NORMS = ['Raw mass (mg)', '% of initial mass', '% of mass at range start', '% of dry mass', 'Mass change per gram (mg/g)', 'Mass change per mole (g/mol)']
const norm = (v: string | undefined) => (v ? NORMS.find((n) => n.toLowerCase() === v.toLowerCase()) ?? NORMS.find((n) => n.toLowerCase().includes(v.toLowerCase())) ?? v : undefined)

export const TGA_ACTIONS: ActionTable = {
  generate: {
    call: 'on_generate',
    range: true,
    set: ({ options: o }) => defined({ initial_mass_ctrl: optNum(o, 'initial_mass', 'mass'), norm_choice: norm(optStr(o, 'normalisation', 'normalization', 'basis')) }),
    read: ['gen_status', 'selection_info'],
  },
  mass_step: {
    call: 'on_mass_step',
    range: true,
    set: ({ options: o }) => defined({ region_name_ctrl: optStr(o, 'name'), average_ctrl: optNum(o, 'edges_over', 'average') }),
    read: ['mass_grid'],
  },
  smooth: {
    call: 'on_smooth',
    set: ({ options: o }) => defined({ smooth_choice: optStr(o, 'method'), smooth_width_ctrl: optNum(o, 'width') }),
    read: ['smooth_info', 'mass_info'],
  },
  normalise: {
    call: 'on_apply_normalisation',
    set: ({ options: o }) => defined({ mass_norm_choice: norm(optStr(o, 'basis', 'normalisation')), dry_mass_ctrl: optNum(o, 'dry_mass'), molar_mass_ctrl: optNum(o, 'molar_mass') }),
    read: ['smooth_info', 'mass_info'],
  },
  dtg: {
    call: 'on_calculate_dtg',
    set: ({ options: o }) => defined({ dtg_mode_choice: optStr(o, 'mode'), dtg_width_ctrl: optNum(o, 'width') }),
    read: ['dtg_info'],
  },
  dtg_peaks: {
    call: 'on_detect_dtg_peaks',
    set: ({ options: o }) => defined({ dtg_prominence_ctrl: optNum(o, 'sensitivity') }),
    read: ['dtg_grid', 'dtg_info'],
  },
  dsc_area: {
    call: 'on_dsc_area',
    range: true,
    set: ({ options: o }) => defined({ baseline_choice: optStr(o, 'baseline'), poly_order_ctrl: optNum(o, 'poly_order'), anchors_ctrl: optList(o, 'anchors') }),
    read: ['dsc_results'],
  },
  events: {
    call: 'on_detect_events',
    set: ({ options: o }) => defined({ dtg_prominence_ctrl: optNum(o, 'sensitivity') }),
    read: ['events_grid', 'interpretation'],
  },
  cycles: {
    call: 'on_cycle_analysis',
    set: ({ options: o }) => defined({ cycle_tol_ctrl: optNum(o, 'tolerance') }),
    read: ['cycles_grid', 'cycles_summary'],
  },
  isothermal: {
    // one model, or all of them ranked (the window's "Try all models")
    call: ({ options }) => (String(options.model ?? '').toLowerCase() === 'all' ? 'on_fit_all_isothermal' : 'on_fit_isothermal'),
    range: true,
    set: ({ options: o }) => {
      const m = optStr(o, 'model')
      return defined({ kinetic_choice: m && m.toLowerCase() !== 'all' ? m : undefined })
    },
    read: ['iso_results'],
  },
  arrhenius: {
    call: 'on_arrhenius',
    set: ({ options: o }) => defined({ kinetic_choice: optStr(o, 'model') }),
    read: ['iso_results'],
  },
  heatflow_peak: {
    call: 'on_heatflow_area',
    range: true,
    set: ({ options: o }) => defined({ hf_mass_ctrl: optNum(o, 'mass'), hf_baseline_choice: optStr(o, 'baseline'), hf_dh_ref_ctrl: optNum(o, 'dh_ref') }),
    read: ['heatflow_results'],
  },
  glass_transition: {
    call: 'on_glass_transition',
    range: true,
    set: ({ options: o }) => defined({ hf_mass_ctrl: optNum(o, 'mass') }),
    read: ['heatflow_results'],
  },
  oxygen: {
    call: 'on_oxygen_calc',
    set: ({ options: o }) => defined({ oxide_formula_ctrl: optStr(o, 'formula'), delta_initial_ctrl: optNum(o, 'delta_initial'), oxygen_sites_ctrl: optNum(o, 'sites'), oxy_mass_ctrl: optNum(o, 'mass_change') }),
    read: ['chem_results'],
  },
  theoretical: {
    call: 'on_theoretical_calc',
    set: ({ options: o }) => defined({ host_formula_ctrl: optStr(o, 'host'), species_formula_ctrl: optStr(o, 'species'), n_species_ctrl: optNum(o, 'n') }),
    read: ['chem_results'],
  },
}

