// kRaman: Raman spectroscopy. The analysis is KherveFitting-AI's own (its Raman code runs unchanged
// in Python, through the technique engine of src/apps/khervetech); the window is kTGA's design on
// the OS theme (src/apps/khervetech/AnalysisApp.tsx): the spectra on the left, the plot in the middle
// and the Raman Analysis (Peaks & Assignment, Band Library) docked on the right.
// Checklist: docs/parity/kherveraman.md.

import { Waves } from 'lucide-react'
import type { AppProps } from '@/os'
import { AnalysisApp, type AnalysisLook } from '@/apps/khervetech/AnalysisApp'
import { techApp } from '@/apps/khervetech/spec'
import { RAMAN_ACTIONS } from './actions'

const LOOK: AnalysisLook = {
  spec: techApp('kherveraman'),
  actions: RAMAN_ACTIONS,
  icon: Waves,
  fileKind: 'Raman',
  projectName: 'Raman_Data',
  panelTitle: 'Raman Analysis',
  sheetKind: () => 'Raman spectrum',
  xIsTemperature: /^$/,
  welcome: {
    blurb: 'Raman spectra: peak detection with ranked database assignments (material, substrate, laser and elements steer them), labels on the plot, and a band library.',
    formats: '.kfit projects · .txt (Raman shift, intensity)',
    start: 'Open a Raman file, or try an example.',
  },
}

export default function KherveRaman(props: AppProps) {
  return <AnalysisApp {...props} look={LOOK} />
}
