// kTGA: thermogravimetry and DSC. The analysis is KherveFitting-AI's own (its TGA code runs
// unchanged in Python, through the technique engine of src/apps/khervetech); the window is
// kTGA's own design on the OS theme (src/apps/khervetech/AnalysisApp.tsx): the sheets on the left,
// the plot in the middle and the TGA / DSC Analysis (Range, Mass, DTG, DSC, Heat Flow, Events,
// Chemistry, Cycles, Isothermal, Compare) docked on the right. Checklist: docs/parity/khervetga.md.

import { Thermometer } from 'lucide-react'
import type { AppProps } from '@/os'
import { AnalysisApp, type AnalysisLook } from '@/apps/khervetech/AnalysisApp'
import { techApp } from '@/apps/khervetech/spec'
import { TGA_ACTIONS } from './actions'

/** What a sheet holds, from the names the desktop gives them (TGA, TGA~Mass, TGA~DTG…). */
function sheetKind(name: string): string {
  const part = name.split('~')[1]?.toLowerCase() ?? ''
  if (!part) return 'Measured run'
  if (part.startsWith('mass')) return 'Mass vs temperature'
  if (part.startsWith('dtg')) return 'Derivative (DTG)'
  if (part.startsWith('dsc')) return 'DSC'
  if (part.startsWith('blank') || part.startsWith('corr')) return 'Blank correction'
  if (part.startsWith('iso')) return 'Isothermal'
  if (part.startsWith('cyc')) return 'Cycles'
  return part.charAt(0).toUpperCase() + part.slice(1)
}

const LOOK: AnalysisLook = {
  spec: techApp('khervetga'),
  actions: TGA_ACTIONS,
  icon: Thermometer,
  fileKind: 'TGA',
  projectName: 'TGA_Data',
  panelTitle: 'TGA / DSC Analysis',
  sheetKind,
  xIsTemperature: /temp|°c|\(k\)/i,
  welcome: {
    blurb: 'Thermogravimetry and DSC: mass steps, DTG peaks, DSC enthalpies, heat flow and glass transitions, events, redox cycles and isothermal kinetics.',
    formats: '.kfit projects · Netzsch / STA .csv and .txt · TA TRIOS .tri',
    start: 'Open a TGA, STA or TRIOS file, or try an example.',
  },
}

export default function KherveTGA(props: AppProps) {
  return <AnalysisApp {...props} look={LOOK} />
}
