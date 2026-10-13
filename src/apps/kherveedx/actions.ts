// kEDX's AI `run` actions. The EDX HeatMap window is driven with the mouse on the desktop (click a pixel, drag a
// rectangle or a line on the map); here the same handlers get the same events from ktech/edx_tools.py
// (module:function calls: the window first, then the args). Described for models in src/os/ai/manifests/kherveedx.ts.

import { optNum, optStr, type ActionTable } from '../khervetech/actions.ts'

/** Element symbols from "Fe Cr, Si" or ["Fe", "Cr"]. */
function symbols(o: Record<string, unknown>): string[] {
  const v = o.elements
  const list = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(/[\s,;]+/) : []
  const out = list.map((s) => s.trim()).filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
  if (!out.length) throw new Error('Give options.elements: element symbols such as "Fe Cr Ni".')
  return out
}

const KINDS = ['point', 'area', 'line']

export const EDX_ACTIONS: ActionTable = {
  select: {
    call: 'ktech.edx_tools:select',
    args: ({ options: o }) => {
      const kind = KINDS.find((k) => k === (optStr(o, 'kind') ?? 'point').toLowerCase())
      if (!kind) throw new Error('options.kind is "point", "area" or "line".')
      const x = optNum(o, 'x', 'x1')
      const y = optNum(o, 'y', 'y1')
      if (x === undefined || y === undefined) throw new Error('Give options.x and options.y: the pixel (column, row) on the map.')
      return [kind, x, y, optNum(o, 'x2') ?? null, optNum(o, 'y2') ?? null, optNum(o, 'width') ?? 1, optNum(o, 'size') ?? 1, o.save === true]
    },
    read: [],
  },
  element_maps: { call: 'ktech.edx_tools:element_maps', args: ({ options: o }) => [symbols(o)], read: [] },
  quantify: { call: 'ktech.edx_tools:quantify', args: ({ options: o }) => [symbols(o)], read: [] },
  peaks: { call: 'ktech.edx_tools:sum_peaks', args: () => [], read: [] },
}
