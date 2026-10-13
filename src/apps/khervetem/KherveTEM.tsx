// kTEM: transmission electron microscopy images. The analysis is KherveFitting-AI's own (its TEM code
// runs unchanged in Python, through the technique engine of src/apps/khervetech); the window is kTGA's
// design on the OS theme (src/apps/khervetech/AnalysisApp.tsx): the sheets on the left, the micrograph
// in the middle and the TEM Analysis (Calibrate, Particles, Profile, FFT, Filter, Measure, Advanced,
// Denoise) docked on the right. Checklist: docs/parity/khervetem.md.

import { Microscope } from 'lucide-react'
import type { AppProps } from '@/os'
import { AnalysisApp, type AnalysisLook } from '@/apps/khervetech/AnalysisApp'
import { techApp } from '@/apps/khervetech/spec'
import { TEM_ACTIONS } from './actions'

/** What a sheet holds, from the names the desktop gives them (TEM~Map, TEM~FFT, TEM~Plot, TEM~Count…). */
function sheetKind(name: string): string {
  const part = name.split('~')[1]?.toLowerCase() ?? ''
  if (!part || part.startsWith('map')) return 'Micrograph'
  if (part.startsWith('fft')) return 'FFT (diffractogram)'
  if (part.startsWith('plot')) return 'Line profile'
  if (part.startsWith('count')) return 'Size distribution (counts)'
  if (part.startsWith('freq')) return 'Size distribution (frequency)'
  if (part.startsWith('filt')) return 'Bragg-filtered image'
  if (part.startsWith('den')) return 'Denoised image'
  return `${part.charAt(0).toUpperCase()}${part.slice(1)}`
}

const LOOK: AnalysisLook = {
  spec: techApp('khervetem'),
  actions: TEM_ACTIONS,
  icon: Microscope,
  fileKind: 'TEM',
  projectName: 'TEM_Data',
  panelTitle: 'TEM Analysis',
  sheetKind,
  xIsTemperature: /^$/,
  welcome: {
    blurb: 'TEM images: pixel-size calibration, nanoparticle detection and size distributions, line profiles and fringe spacings, FFT with d-spacing measurement, Bragg filtering and PCA denoising.',
    formats: '.kfit projects · Gatan DigitalMicrograph .dm3 / .dm4 / .dm5 · TIFF / PNG (uncalibrated)',
    start: 'Open a TEM image, or try an example.',
  },
}

export default function KherveTEM(props: AppProps) {
  return <AnalysisApp {...props} look={LOOK} />
}
