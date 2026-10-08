// AI tools of KherveRaman (the Raman technique of KherveFitting-AI as an app).
// The `run` actions are src/apps/kherveraman/actions.ts.

import { techniqueToolSet } from './technique.ts'

export const KHERVERAMAN_TOOL_SET = techniqueToolSet({
  app: 'kherveraman',
  name: 'kRaman',
  summary: 'Raman spectra: peak detection, database assignment, plot labels, band library.',
  keywords: ['kherveraman', 'raman', 'raman shift', 'raman spectrum', 'wavenumber', 'phonon', 'band assignment', 'anatase', 'graphene', 'carbon d band', 'g band'],
  files: 'Raman (.txt: wavenumber, intensity)',
  actions: {
    metadata: 'options.material, options.substrate, options.elements (e.g. "Ti O"), options.laser (nm), options.in_air (true/false): steer the assignment.',
    find_peaks: 'Detects the peaks and ranks database assignments.',
    use_fitted: 'Uses the peaks already fitted in the Peak Parameters grid instead.',
    reassign: 'Assigns the peaks again (after changing the metadata).',
    label_plot: 'Writes the assignments on the plot.',
    clear_labels: 'Removes the Raman labels.',
    band_library: 'options.search (e.g. "TiO2", "D band"). Searches the Raman band library.',
  },
})
