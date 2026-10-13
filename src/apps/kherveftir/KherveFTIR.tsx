// kFTIR: infrared spectroscopy. The analysis is KherveFitting-AI's own (its FTIR code runs
// unchanged in Python, through the technique engine of src/apps/khervetech); the window is
// kTGA's design on the OS theme (src/apps/khervetech/AnalysisApp.tsx): the spectra on the left,
// the plot in the middle and the FTIR Analysis (Data & Metadata, Processing, Bands, Band Library,
// Reference Spectra) docked on the right. Checklist: docs/parity/kherveftir.md.

import { AudioWaveform } from 'lucide-react'
import type { AppProps } from '@/os'
import { AnalysisApp, type AnalysisLook } from '@/apps/khervetech/AnalysisApp'
import { techApp } from '@/apps/khervetech/spec'
import { FTIR_ACTIONS } from './actions'

/** The desktop names every spectrum FTIR, FTIR1, FTIR2… (measured or reference alike): the engine's note tells them apart. */
function sheetKind(_sheet: string, note?: string) {
  return note ?? 'Spectrum'
}

const LOOK: AnalysisLook = {
  spec: techApp('kherveftir'),
  actions: FTIR_ACTIONS,
  icon: AudioWaveform,
  fileKind: 'FTIR',
  projectName: 'FTIR_Data',
  panelTitle: 'FTIR Analysis',
  sheetKind,
  xIsTemperature: /^$/,
  welcome: {
    blurb: 'Infrared spectra: ordinate units, one-click clean-up (spikes, atmosphere, baseline, smoothing), band detection with functional-group assignments, and reference spectra to compare against.',
    formats: '.kfit projects · JCAMP-DX .jdx / .dx · .txt / .csv / .dat (Agilent, Thermo, generic) · Nicolet library .lbd',
    start: 'Open an FTIR file, or try an example.',
  },
}

export default function KherveFTIR(props: AppProps) {
  return <AnalysisApp {...props} look={LOOK} />
}
