// AI tools of kAFM (the AFM technique of KherveFitting-AI as an app).
// The `run` actions are src/apps/kherveafm/actions.ts.

import { techniqueToolSet } from './technique.ts'

export const KHERVEAFM_TOOL_SET = techniqueToolSet({
  app: 'kherveafm',
  name: 'kAFM',
  summary: 'AFM / SPM scans: scan size, levelling, roughness (Sq, Sa, Sz…), line profiles and step heights, grain statistics, 3D.',
  keywords: ['kherveafm', 'afm', 'spm', 'atomic force microscopy', 'scanning probe', 'topography', 'height map', 'roughness', 'rms', 'step height', 'grain', 'particle', 'ibw', 'nanoscope', 'gwyddion', 'ardf', 'force curve', 'terrace'],
  files: 'AFM scan (.ibw, .spm, .ardf, .gwy, .gsf, .emd)',
  actions: {
    scan_size: 'options.width: the scan width in micrometres (files without calibration show pixels). Applies to every channel.',
    colour_map: 'options.name: the colour map of the channel (e.g. "Gradient Brown", "Gradient Grey"); empty = automatic.',
    level: 'Levels every measurement: options.background ("None", "Plane", "Polynomial 2nd order", "Polynomial 3rd order"), options.rows (align rows: "Median", "Median of differences", "Modus", "Matching", "Facet-level tilt", "Polynomial", "Trimmed mean"), options.degree, options.trim (%), options.direction ("Horizontal"/"Vertical"), options.scars (true/false), options.zero ("Minimum to zero", "Mean to zero", "None"). The stored data is never changed.',
    level_default: 'Back to the recipe a channel opens with.',
    level_reset: 'Raw data: no levelling.',
    roughness: 'Roughness of the levelled image: Sq (RMS), Sa, Ssk, Sku, Sp, Sv, Sz, Sdr… in the unit of the channel.',
    profile_line: 'A line profile: options.x0, y0, x1, y1 = the end points in image PIXELS (column, row; row 0 is the top), options.width = averaging width in px (default 1), options.add=false to move the current line instead of adding one. Returns its length, Ra / Rq / Rz and the step height (half vs half).',
    profile_sheet: 'Makes the current line profile a sheet (AFM~Profile) that can be plotted and exported.',
    grains: 'Grain / particle analysis of the map: options.method ("Threshold" or "Watershed"), options.particles ("grains" above the threshold or "pits"), options.threshold ("Otsu", "Top-hat", "Manual"), options.level (for Manual; in the channel unit), options.min_size / max_size (nm across), options.fill_holes, options.discard_edge, options.split, options.auto=false to keep the watershed settings as they are (they are otherwise measured off the scan first). Returns count, equivalent diameters, D10 / D50 / D90 and coverage.',
    grain_sheet: 'Makes the grain statistics a sheet.',
    grain_fit: 'low / high = the diameter range (nm) to fit a size distribution to; fits it.',
    build_3d: 'Builds the 3D surface sheet (AFM~3D) of the height channel.',
  },
})
