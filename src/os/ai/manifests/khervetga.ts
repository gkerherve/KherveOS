// AI tools of KherveTGA (the TGA / DSC technique of KherveFitting-AI as an app).
// The `run` actions are src/apps/khervetga/actions.ts.

import { techniqueToolSet } from './technique.ts'

export const KHERVETGA_TOOL_SET = techniqueToolSet({
  app: 'khervetga',
  name: 'KherveTGA',
  summary: 'TGA / DSC analysis: mass steps, DTG, DSC enthalpies, events, cycles, kinetics.',
  keywords: ['khervetga', 'tga', 'thermogravimetric', 'thermogravimetry', 'dsc', 'sta', 'dtg', 'mass loss', 'decomposition', 'enthalpy', 'netzsch', 'trios'],
  files: 'TGA / STA (.csv/.txt/.dat) or TA TRIOS (.tri)',
  actions: {
    generate: 'on the run against time: low / high = the time range (min) of one ramp; options.initial_mass (mg), options.normalisation ("% of mass at range start", "% of initial mass", "Raw mass (mg)", "% of dry mass", …). Makes the TGA~Mass sheet the other actions use.',
    mass_step: 'low / high = temperature range (°C) of one mass change; options.name, options.edges_over (points averaged at each end). Adds a region (table + plot label).',
    smooth: 'options.method ("Savitzky-Golay", "Moving average", "Gaussian"), options.width (points). Non-destructive.',
    normalise: 'options.basis (as normalisation above), options.dry_mass, options.molar_mass.',
    dtg: 'options.mode ("dm/dT" or "dm/dt"), options.width (smoothing points). Calculates the derivative.',
    dtg_peaks: 'options.sensitivity (% of the largest peak, default 5). Detects the DTG peaks.',
    dsc_area: 'low / high = temperature range (°C) of the DSC peak; options.baseline ("Straight", "Tangential", "Sigmoidal", "Polynomial", "Manual anchors", "Blank subtracted"), options.poly_order, options.anchors ("310, 480"). Integrates it (enthalpy).',
    events: 'options.sensitivity. Detects events from mass, DTG and DSC together.',
    cycles: 'options.tolerance (% of amplitude). Reversible / irreversible split over repeated cycles (time-view run).',
    isothermal: 'low / high = time range (min) of a dwell; options.model ("Single exponential", "Double exponential", "Avrami (JMAK)", "Diffusion (Jander)", "Parabolic (sqrt-t)", or "all" to rank them).',
    arrhenius: 'options.model. Fits every dwell of a stepped-isothermal run and ln k vs 1/T (activation energy).',
    heatflow_peak: 'on a heat-flow DSC sheet (.tri): low / high = °C range; options.mass (mg), options.baseline, options.dh_ref (J/g, crystallinity). Melting / crystallisation enthalpy.',
    glass_transition: 'on a heat-flow DSC sheet: low / high = °C range around the step; options.mass. Tg (onset, midpoint, endset, ΔCp).',
    oxygen: 'options.formula, options.delta_initial, options.sites (3 for ABO3), options.mass_change (%). Oxygen non-stoichiometry δ.',
    theoretical: 'options.host (formula), options.species (e.g. H2O), options.n. Theoretical mass change vs the selected region.',
  },
})
