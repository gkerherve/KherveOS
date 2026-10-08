// AI tools of KherveUVVis (the UV-Vis technique of KherveFitting-AI as an app).
// The `run` actions are src/apps/kherveuvvis/actions.ts.

import { techniqueToolSet } from './technique.ts'

export const KHERVEUVVIS_TOOL_SET = techniqueToolSet({
  app: 'kherveuvvis',
  name: 'KherveUVVis',
  summary: 'UV-Vis spectra: absorbance conversion, Tauc band gap, band maxima.',
  keywords: ['kherveuvvis', 'uv-vis', 'uvvis', 'uv vis', 'absorbance', 'transmittance', 'band gap', 'tauc', 'optical', 'cary', 'spectrophotometer', 'kubelka-munk'],
  files: 'UV-Vis (.csv/.txt/.dat/.asc: Cary, Shimadzu, generic)',
  actions: {
    absorbance: 'options.ordinate ("Absorbance", "Transmittance (%)", "Reflectance (%)"): what the sheet holds; makes a new absorbance sheet (-log10 T, or Kubelka-Munk F(R)).',
    tauc_sheet: 'options.transition ("Direct allowed", "Indirect allowed", "Direct forbidden", "Indirect forbidden"). Makes the UVvis~Tauc sheet ((αhν)^n vs eV).',
    suggest_window: 'On the Tauc sheet: proposes the linear window (steepest edge).',
    fit_band_gap: 'On the Tauc sheet: low / high = the linear window (eV). Fits the band gap Eg (R², points).',
    insert_inset: 'Puts the fitted Tauc plot on the measured spectrum as an inset; options.font_size.',
    remove_inset: 'Removes that inset.',
    band_maxima: 'Lists the absorption maxima (nm, eV, value, prominence).',
  },
})
