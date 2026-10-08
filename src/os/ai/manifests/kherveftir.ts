// AI tools of KherveFTIR (the FTIR technique of KherveFitting-AI as an app).
// The `run` actions are src/apps/kherveftir/actions.ts.

import { techniqueToolSet } from './technique.ts'

export const KHERVEFTIR_TOOL_SET = techniqueToolSet({
  app: 'kherveftir',
  name: 'KherveFTIR',
  summary: 'FTIR spectra: ordinate units, auto clean, band detection and assignment, references.',
  keywords: ['kherveftir', 'ftir', 'infrared', 'ir spectrum', 'ir spectroscopy', 'wavenumber', 'transmittance', 'absorbance', 'jcamp', 'band assignment', 'functional group', 'atr'],
  files: 'FTIR (.txt/.csv/.dat), JCAMP-DX (.jdx/.dx) or Nicolet library',
  actions: {
    detect_unit: 'Auto-detects what the y data are (transmittance, absorbance…).',
    input_unit: 'options.unit: what the y data are ("Transmittance (%)", "Transmittance (fraction)", "Absorbance", "Reflectance (%)", "Kubelka-Munk", "Intensity (a.u.)").',
    display_unit: 'options.unit: how to show the spectrum (same names).',
    auto_clean: 'options.preset ("Gentle", "Standard", "Strong"): the processing pipeline (spikes, atmosphere, baseline, smoothing…). Non-destructive.',
    reset: 'Back to the raw spectrum.',
    find_bands: 'options.method ("Intensity (prominence)" or "2nd derivative"), options.prominence (%), options.min_distance (cm-1), options.tolerance (cm-1). Detects bands with ranked assignments.',
    reassign: 'options.tolerance (cm-1). Assigns the bands again.',
    label_bands: 'Writes the band labels on the plot.',
    clear_labels: 'Removes the FTIR labels.',
    band_library: 'options.search (e.g. "C=O", "1720"). Searches the IR correlation table.',
    add_reference: 'options.name: a spectrum of the local reference library (e.g. "Polystyrene_synthetic.jdx"); adds it as an FTIR sheet.',
  },
})
