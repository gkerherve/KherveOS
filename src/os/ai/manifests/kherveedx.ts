// AI tools of kEDX (the SEM-EDX technique of KherveFitting-AI as an app).
// The `run` actions are src/apps/kherveedx/actions.ts.

import { techniqueToolSet } from './technique.ts'

export const KHERVEEDX_TOOL_SET = techniqueToolSet({
  app: 'kherveedx',
  name: 'kEDX',
  summary: 'SEM-EDX spectrum images: sum spectrum with elements, spectra of a point / area / line, element maps, quantification.',
  keywords: ['kherveedx', 'edx', 'eds', 'sem-edx', 'energy dispersive', 'x-ray spectroscopy', 'elemental map', 'element map', 'composition', 'atomic percent', 'quantification', 'bruker', 'bcf', 'velox', 'emd', 'k alpha'],
  files: 'EDX map (.hdf5, .h5, .bcf, .emd)',
  actions: {
    select: 'Spectrum of a place on the map, shown on the plot with its elements labelled: options.kind ("point", "area" or "line"), options.x / options.y = the pixel (column, row; 0 at the top left), options.x2 / options.y2 = the opposite corner (area) or the end (line), options.width (line, px), options.size (point, px), options.save=true to keep it as a sheet (EDX~Plot1, 2…). Returns the identified peaks (energy, element, line) and the counts.',
    element_maps: 'Element maps of up to seven elements as an RGB composite in the EDX window: options.elements ("Fe Cr Si").',
    quantify: 'Standardless quantification of the sum spectrum: options.elements ("Fe Cr Ni Si O"). Returns each element\'s line, energy and relative atomic %. Relative values: not k-factor calibrated.',
    peaks: 'The peaks identified in the sum spectrum: energy (keV), element and line.',
  },
})
