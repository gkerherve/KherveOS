// kTEM's AI `run` actions: the TEM Analysis window's controls and handlers
// (libraries/ToolsMenu/TEM_Analysis.py, TEM_Denoise.py, attribute names as there).
// Described for models in src/os/ai/manifests/khervetem.ts.

import { defined, optNum, optStr, pick, type ActionTable } from '../khervetech/actions.ts'

const POLARITIES = ['Dark on bright', 'Bright on dark']
const METHODS = ['Otsu threshold', 'Top hat threshold', 'Manual threshold', 'Blobs (round particles)']
const DENOISE_MODES = ['Line-wise', 'Patch-based (local PCA)']

export const TEM_ACTIONS: ActionTable = {
  calibrate: {
    call: 'on_apply_scale',
    args: () => [null],
    set: ({ options: o }) => defined({ nm_ctrl: optStr(o, 'pixel_size', 'nm_per_px') }),
    read: ['nm_ctrl'],
  },
  particles: {
    call: 'on_detect',
    args: () => [null],
    set: ({ options: o }) =>
      defined({
        polarity: pick(POLARITIES, optStr(o, 'particles', 'polarity')),
        method: pick(METHODS, optStr(o, 'method')),
        threshold: optNum(o, 'level', 'threshold'),
        sensitivity: optNum(o, 'sensitivity'),
        min_size: optNum(o, 'min_size'),
        max_size: optNum(o, 'max_size'),
        fill_holes: typeof o.fill_holes === 'boolean' ? o.fill_holes : undefined,
        exclude_edge: typeof o.exclude_edge === 'boolean' ? o.exclude_edge : undefined,
        split: typeof o.split === 'boolean' ? o.split : undefined,
        split_multiple: optNum(o, 'split_multiple'),
      }),
    read: ['particle_status', 'results_grid'],
  },
  particle_sheet: {
    call: 'on_publish',
    args: ({ options: o }) => [/freq/i.test(optStr(o, 'kind') ?? '') ? 'frequency' : 'count'],
    read: ['particle_status'],
  },
  profile_line: {
    // the line is drawn on the image with the mouse on the desktop; here its end points are given in image pixels
    attrs: ({ options: o }) => {
      const [x0, y0, x1, y1] = [optNum(o, 'x0'), optNum(o, 'y0'), optNum(o, 'x1'), optNum(o, 'y1')]
      if ([x0, y0, x1, y1].some((v) => v === undefined)) throw new Error('Give x0, y0, x1 and y1: the end points of the line in image pixels (column, row).')
      return defined({ _line: [[x0, y0], [x1, y1]], line_width_px: Math.max(1, Math.round(optNum(o, 'width') ?? 1)) })
    },
    call: '_apply_line_change',
    args: () => [],
    read: ['profile_status'],
  },
  fringe_spacing: {
    call: 'on_detect_peaks',
    args: () => [null],
    set: ({ options: o }) => defined({ peak_smooth: optNum(o, 'smooth'), peak_prominence: optNum(o, 'prominence') }),
    read: ['spacing_text', 'profile_status'],
  },
  fft: {
    // the region is dragged out with the mouse on the desktop; here a rectangle in image pixels (default: the whole image)
    attrs: ({ options: o }) => {
      const given = ['x', 'y', 'width', 'height'].every((k) => optNum(o, k) !== undefined)
      return { _roi: { region_px: given ? [optNum(o, 'x'), optNum(o, 'y'), optNum(o, 'width'), optNum(o, 'height'), optNum(o, 'angle') ?? 0] : [null, null, null, null, 0] } }
    },
    call: 'on_compute_fft',
    args: () => [null],
    read: ['fft_status'],
  },
  fft_spots: { call: 'on_auto_detect', args: () => [null], read: ['measure_status', 'spot_grid'] },
  denoise: {
    call: 'on_apply_denoise',
    args: () => [null],
    set: ({ options: o }) =>
      defined({
        denoise_whole: true,
        denoise_mode: pick(DENOISE_MODES, optStr(o, 'mode')),
        line_comp: optNum(o, 'components'),
        patch_comp: optNum(o, 'components'),
        patch_size: optNum(o, 'patch'),
        patch_stride: optNum(o, 'stride'),
      }),
    read: ['denoise_status'],
  },
}
