// kAFM's AI `run` actions: the AFM Analysis window's controls and handlers
// (libraries/ToolsMenu/AFM_Analysis.py, attribute names as there).
// Described for models in src/os/ai/manifests/kherveafm.ts.

import { defined, optNum, optStr, pick, type ActionTable } from '../khervetech/actions.ts'

const PLANES = ['None', 'Plane (1st order)', 'Polynomial, 2nd order', 'Polynomial, 3rd order']
const ROWS = ['None', 'Median', 'Median of differences', 'Modus', 'Matching', 'Facet-level tilt', 'Polynomial', 'Trimmed mean', 'Trimmed mean of differences']
const ZEROS = ['Minimum to zero', 'Mean to zero', 'None']
const DIRECTIONS = ['Horizontal', 'Vertical']
const ENGINES = ['Threshold (separated particles)', 'Watershed (touching grains)']
const THRESHOLDS = ['Otsu (automatic)', 'Top-hat (uneven background)', 'Manual height level']
const POLARITIES = ['Above the threshold (grains)', 'Below it (pits, holes)']

const pixel = (o: Record<string, unknown>, ...keys: string[]) => optNum(o, ...keys)

export const AFM_ACTIONS: ActionTable = {
  scan_size: {
    call: 'on_apply_scan_size',
    set: ({ options: o }) => defined({ scan_ctrl: optStr(o, 'width', 'scan_width') }),
    read: ['info_text'],
  },
  colour_map: {
    call: 'on_palette',
    set: ({ options: o }) => defined({ palette_choice: optStr(o, 'name', 'colour_map', 'cmap') }),
    read: [],
  },
  level: {
    call: 'on_level_changed',
    set: ({ options: o }) =>
      defined({
        plane_choice: pick(PLANES, optStr(o, 'background', 'plane')),
        lines_choice: pick(ROWS, optStr(o, 'rows', 'align_rows')),
        degree_spin: optNum(o, 'degree'),
        trim_spin: optNum(o, 'trim'),
        direction_choice: pick(DIRECTIONS, optStr(o, 'direction')),
        scars_check: typeof o.scars === 'boolean' ? o.scars : undefined,
        zero_choice: pick(ZEROS, optStr(o, 'zero')),
      }),
    read: ['level_status'],
  },
  level_default: { call: 'on_level_default', read: ['level_status'] },
  level_reset: { call: 'on_level_reset', read: ['level_status'] },
  roughness: { call: 'on_compute_roughness', args: () => [null], read: ['roughness_text'] },
  profile_line: {
    // the line is drawn on the map with the mouse on the desktop; here its end points are given in image pixels
    attrs: ({ options: o }) => {
      const [x0, y0, x1, y1] = [pixel(o, 'x0'), pixel(o, 'y0'), pixel(o, 'x1'), pixel(o, 'y1')]
      if ([x0, y0, x1, y1].some((v) => v === undefined)) throw new Error('Give x0, y0, x1 and y1: the end points of the line in image pixels (column, row).')
      return defined({ _line: [[x0, y0], [x1, y1]], _new_line: o.add === false ? false : true, line_width_px: Math.max(1, Math.round(pixel(o, 'width') ?? 1)) })
    },
    call: '_apply_line_change',
    args: () => [],
    read: ['profile_hint', 'profile_stats', 'cd_text'],
  },
  profile_sheet: { call: 'on_export_profile', read: ['profile_hint'] },
  grains: {
    // the watershed settings are measured off the scan first (the window's "Auto from this image"); the defaults over-split
    before: ({ options: o }) => (/thresh/i.test(optStr(o, 'method', 'engine') ?? '') || o.auto === false ? [] : ['on_auto_watershed']),
    call: 'on_count_particles',
    args: () => [null],
    set: ({ options: o }) =>
      defined({
        p_engine: pick(ENGINES, optStr(o, 'method', 'engine')),
        p_polarity: pick(POLARITIES, optStr(o, 'particles', 'polarity')),
        p_method: pick(THRESHOLDS, optStr(o, 'threshold')),
        p_level: optNum(o, 'level'),
        p_min_size: optNum(o, 'min_size'),
        p_max_size: optNum(o, 'max_size'),
        p_fill: typeof o.fill_holes === 'boolean' ? o.fill_holes : undefined,
        p_edge: typeof o.discard_edge === 'boolean' ? o.discard_edge : undefined,
        p_split: typeof o.split === 'boolean' ? o.split : undefined,
      }),
    read: ['particle_text'],
  },
  grain_sheet: { call: 'on_publish_grain_sheet', read: ['particle_text'] },
  grain_fit: {
    call: 'on_fit_distribution',
    args: () => [null],
    set: ({ low, high }) => defined({ fit_from: low, fit_to: high }),
    read: ['fit_text'],
  },
  build_3d: { call: 'on_build_3d', args: () => [null], read: [] },
}
