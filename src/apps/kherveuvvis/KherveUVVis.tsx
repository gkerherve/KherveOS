// kUVVis: UV-Vis spectroscopy. The analysis is KherveFitting-AI's own (its UV-Vis code runs
// unchanged in Python, through the technique engine of src/apps/khervetech); the window is kTGA's
// design on the OS theme (src/apps/khervetech/AnalysisApp.tsx): the spectra on the left, the plot in
// the middle and the UV-Vis Analysis (Data & Ordinate, Band Gap (Tauc), Band Maxima) docked on the
// right. Checklist: docs/parity/kherveuvvis.md.

import { Rainbow } from 'lucide-react'
import type { AppProps } from '@/os'
import { AnalysisApp, type AnalysisLook } from '@/apps/khervetech/AnalysisApp'
import { techApp } from '@/apps/khervetech/spec'
import { UVVIS_ACTIONS } from './actions'

/** What a sheet holds, from the names the desktop gives them (UVvis, UVvis1, UVvis~Tauc). */
function sheetKind(name: string): string {
  const part = name.split('~')[1]?.toLowerCase() ?? ''
  if (!part) return 'Spectrum'
  if (part.startsWith('tauc')) return 'Tauc plot'
  return part.charAt(0).toUpperCase() + part.slice(1)
}

const LOOK: AnalysisLook = {
  spec: techApp('kherveuvvis'),
  actions: UVVIS_ACTIONS,
  icon: Rainbow,
  fileKind: 'UV-Vis',
  projectName: 'UVvis_Data',
  panelTitle: 'UV-Vis Analysis',
  sheetKind,
  xIsTemperature: /^$/,
  welcome: {
    blurb: 'UV-Vis spectra: absorbance or transmittance, Tauc band-gap analysis (direct and indirect), and band maxima.',
    formats: '.kfit projects · .csv / .txt / .dat / .asc (Cary, Shimadzu, generic wavelength + absorbance)',
    start: 'Open a UV-Vis file, or try an example.',
  },
}

export default function KherveUVVis(props: AppProps) {
  return <AnalysisApp {...props} look={LOOK} />
}
