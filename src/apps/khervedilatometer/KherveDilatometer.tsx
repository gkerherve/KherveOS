// kDilatometer: pushrod dilatometry. The analysis is KherveFitting-AI's own (its DIL code runs
// unchanged in Python, through the technique engine of src/apps/khervetech): programme segments
// (heating / dwell / cooling) out of a run, mean and differential thermal-expansion coefficient
// (CTE), sintering shrinkage. The window is kTGA's design (src/apps/khervetech/AnalysisApp.tsx).
// Checklist: docs/parity/khervedilatometer.md.

import { Ruler } from 'lucide-react'
import type { AppProps } from '@/os'
import { AnalysisApp, type AnalysisLook } from '@/apps/khervetech/AnalysisApp'
import { techApp } from '@/apps/khervetech/spec'
import { DIL_ACTIONS } from './actions'

/** What a sheet holds, from the names the desktop gives them (DIL, DIL~Heat, DIL~Cool, DIL~Iso, DIL~Alpha…). */
function sheetKind(name: string): string {
  const part = name.split('~')[1]?.toLowerCase() ?? ''
  if (!part) return 'Measured run'
  if (part.startsWith('heat')) return 'Heating segment'
  if (part.startsWith('cool')) return 'Cooling segment'
  if (part.startsWith('iso')) return 'Dwell (isothermal)'
  if (part.startsWith('alpha')) return 'Expansion coefficient α(T)'
  if (part.startsWith('seg')) return 'Segment'
  return part.charAt(0).toUpperCase() + part.slice(1)
}

const LOOK: AnalysisLook = {
  spec: techApp('khervedilatometer'),
  actions: DIL_ACTIONS,
  icon: Ruler,
  fileKind: 'dilatometry',
  projectName: 'DIL_Data',
  panelTitle: 'Dilatometry Analysis',
  sheetKind,
  xIsTemperature: /temp|°c|\(k\)/i,
  welcome: {
    blurb: 'Dilatometry: split a heat / dwell / cool run into its segments, measure the thermal-expansion coefficient (mean and α(T)) and the sintering shrinkage.',
    formats: '.kfit projects · NETZSCH DIL and compatible .csv / .txt / .dat (dL/L0, dL in µm or %)',
    start: 'Open a dilatometer file, or try an example.',
  },
}

export default function KherveDilatometer(props: AppProps) {
  return <AnalysisApp {...props} look={LOOK} />
}
