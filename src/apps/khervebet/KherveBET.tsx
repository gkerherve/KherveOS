// kBET: N2 physisorption. The analysis is KherveFitting-AI's own (its BET code runs unchanged in
// Python, through the technique engine of src/apps/khervetech); the window is kTGA's design on the
// OS theme (src/apps/khervetech/AnalysisApp.tsx): the sheets on the left, the isotherm in the middle
// and the BET / Physisorption Analysis (BET Surface Area, t-Plot, Pore Size (BJH), Report) docked on
// the right. Checklist: docs/parity/kherve-bet.md.

import { ChartScatter } from 'lucide-react'
import type { AppProps } from '@/os'
import { AnalysisApp, type AnalysisLook } from '@/apps/khervetech/AnalysisApp'
import { techApp } from '@/apps/khervetech/spec'
import { BET_ACTIONS } from './actions'

/** What a sheet holds, from the names the desktop gives them (BET, BET1, BET~Plot, BET~tPlot, BET~Pore). */
function sheetKind(name: string): string {
  const part = name.split('~')[1]?.toLowerCase() ?? ''
  if (!part) return 'Isotherm'
  if (part.startsWith('plot')) return 'BET transform'
  if (part.startsWith('tplot')) return 't-plot'
  if (part.startsWith('pore')) return 'Pore-size distribution'
  return part.charAt(0).toUpperCase() + part.slice(1)
}

const LOOK: AnalysisLook = {
  spec: techApp('khervebet'),
  actions: BET_ACTIONS,
  icon: ChartScatter,
  fileKind: 'isotherm',
  projectName: 'BET_Data',
  panelTitle: 'BET / Physisorption Analysis',
  sheetKind,
  xIsTemperature: /^$/,
  welcome: {
    blurb: 'N2 physisorption: BET surface area with the Rouquerol check, t-plot external area and micropore volume, BJH pore-size distribution, and a plain-text report.',
    formats: '.kfit projects · isotherm .csv / .txt / .dat (Micromeritics, Quantachrome, generic P/P0 + quantity adsorbed)',
    start: 'Open an isotherm file, or try an example.',
  },
}

export default function KherveBET(props: AppProps) {
  return <AnalysisApp {...props} look={LOOK} />
}
