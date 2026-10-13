// kAFM: atomic-force and scanning-probe microscopy. The analysis is KherveFitting-AI's own (its AFM code
// runs unchanged in Python, through the technique engine of src/apps/khervetech); the window is kTGA's
// design on the OS theme (src/apps/khervetech/AnalysisApp.tsx): the channels on the left, the scan in
// the middle and the AFM Analysis (Channels, Level, Regions, Roughness, Profile, Grains, Force Curves, 3D)
// docked on the right. Checklist: docs/parity/kherveafm.md.

import { Mountain } from 'lucide-react'
import type { AppProps } from '@/os'
import { AnalysisApp, type AnalysisLook } from '@/apps/khervetech/AnalysisApp'
import { techApp } from '@/apps/khervetech/spec'
import { AFM_ACTIONS } from './actions'

/** What a sheet holds, from the names the desktop gives them (AFM, AFM~Phase, AFM~3D, AFM~Profile…). */
function sheetKind(name: string): string {
  const part = name.split('~')[1]?.toLowerCase() ?? ''
  if (!part) return 'Height map'
  if (part === '3d') return '3D surface'
  if (part.startsWith('profile')) return 'Line profile'
  if (part.startsWith('phase')) return 'Phase map'
  if (part.startsWith('amp')) return 'Amplitude map'
  return `${part.charAt(0).toUpperCase()}${part.slice(1)} channel`
}

const LOOK: AnalysisLook = {
  spec: techApp('kherveafm'),
  actions: AFM_ACTIONS,
  icon: Mountain,
  fileKind: 'AFM',
  projectName: 'AFM_Data',
  panelTitle: 'AFM Analysis',
  sheetKind,
  xIsTemperature: /^$/,
  welcome: {
    blurb: 'Scanning-probe microscopy: every channel of a scan, levelling, roughness (Rq, Ra, Rz…), line profiles and step heights, grain and particle analysis, force curves and a 3D surface.',
    formats: '.kfit projects · Asylum .ibw / .ardf · Bruker Nanoscope .spm · Gwyddion .gwy / .gsf · Velox .emd',
    start: 'Open an AFM scan, or try an example.',
  },
}

export default function KherveAFM(props: AppProps) {
  return <AnalysisApp {...props} look={LOOK} />
}
