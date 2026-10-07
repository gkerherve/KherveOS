// The built-in symbol palettes and examples, in the desktop's order
// (mainwindow.SYMBOL_LIBRARIES). Each palette module was ported from the
// desktop's Python and is checked against it symbol by symbol.

import type { LucideIcon } from 'lucide-react'
import { ArrowUpRight, Dna, Factory, FlaskConical, Gauge, Layers, Network, Sigma, Sofa, Sparkles, Workflow, Zap } from 'lucide-react'
import type { Palette, Spec } from './spec'
import * as scheme3d from './symbols/scheme3d'
import * as floorplan from './symbols/floorplan'
import * as electrical from './symbols/electrical'
import * as optics from './symbols/optics'
import * as vacuum from './symbols/vacuum'
import * as labware from './symbols/labware'
import * as flowchart from './symbols/flowchart'
import * as network from './symbols/network'
import * as pid from './symbols/pid'
import * as arrows from './symbols/arrows'
import * as biology from './symbols/biology'
import * as maths from './symbols/maths'
import { PAGE_DPI, PAGE_H, PAGE_W } from './symbols/example_kit'
import { SKETCHES } from './symbols/example_sketches'

export interface PaletteInfo extends Palette {
  icon: LucideIcon
  tip: string
}

interface Module {
  SIZES: Record<string, [number, number]>
  LABELS: Record<string, string>
  CATEGORIES: [string, string[]][]
  BUILDERS: Record<string, (w: number, h: number) => Spec[]>
  REFERENCE_MM?: number
}

const make = (id: string, title: string, icon: LucideIcon, tip: string, m: Module): PaletteInfo => ({
  id, title, icon, tip,
  reference: m.REFERENCE_MM ?? 4800,
  sizes: m.SIZES,
  labels: m.LABELS,
  categories: m.CATEGORIES,
  builders: m.BUILDERS,
})

export const PALETTES: PaletteInfo[] = [
  make('scheme3d', '3D scheme', Layers, 'Slabs, particle beds, glows (device schematics)', scheme3d),
  make('floorplan', 'Room layout', Sofa, 'Walls, doors, furniture (top view)', floorplan),
  make('electrical', 'Electrical', Zap, 'Circuit and installation symbols', electrical),
  make('optics', 'Optics', Sparkles, 'Lasers, mirrors, lenses (beam-path diagrams)', optics),
  make('vacuum', 'Vacuum', Gauge, 'UHV chambers, pumps, valves (surface science)', vacuum),
  make('labware', 'Lab glassware', FlaskConical, 'Beakers, flasks, apparatus', labware),
  make('flowchart', 'Flowchart', Workflow, 'Process, decision, connector nodes', flowchart),
  make('network', 'Network / IT', Network, 'Servers, devices, cloud', network),
  make('pid', 'P&ID', Factory, 'Tanks, pumps, valves, instruments (process flow)', pid),
  make('arrows', 'Arrows & callouts', ArrowUpRight, 'Block arrows, callouts, banners', arrows),
  make('biology', 'Biology', Dna, 'Cells, molecules, lab', biology),
  make('maths', 'Math', Sigma, 'Axes, vectors, graphs and symbols', maths),
]

export const paletteById = (id: string) => PALETTES.find((p) => p.id === id) ?? null

// ------------------------------------------------------------ examples

export const EXAMPLE_PAGE = { width: PAGE_W, height: PAGE_H, dpi: PAGE_DPI }

const ORDER = ['Spectroscopy', 'Mass spectrometry', 'Diffraction', 'Microscopy', 'Thermal & sorption', 'Electrochemistry', 'Chromatography']

export interface Example {
  category: string
  name: string
  build: () => Spec[]
}

/** The Examples menu: instrument schematics on an A4 page, by category then name. */
export const EXAMPLES: Example[] = (SKETCHES as [string, string, () => Spec[]][])
  .map(([category, name, build]) => ({ category, name, build }))
  .sort((a, b) => {
    const ia = ORDER.includes(a.category) ? ORDER.indexOf(a.category) : 99
    const ib = ORDER.includes(b.category) ? ORDER.indexOf(b.category) : 99
    return ia - ib || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  })
