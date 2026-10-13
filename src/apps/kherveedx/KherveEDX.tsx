// kEDX: SEM-EDX spectrum images. The analysis is KherveFitting-AI's own (its EDX / SEM window runs unchanged in
// Python, through the technique engine of src/apps/khervetech): the sum spectrum is on the plot in the middle,
// labelled with the elements found, and the EDX HeatMap window (the intensity map and its tools: point, area and
// line selection, element maps, quantification) docked on the right. Checklist: docs/parity/kherveedx.md.

import { Atom } from 'lucide-react'
import type { AppProps } from '@/os'
import { AnalysisApp, type AnalysisLook } from '@/apps/khervetech/AnalysisApp'
import { techApp } from '@/apps/khervetech/spec'
import { EDX_ACTIONS } from './actions'

/** What a sheet holds, from the names the desktop gives them (EDX~Plot, EDX~Plot1…, EDX~Map). */
function sheetKind(name: string): string {
  if (name.startsWith('EDX~Map')) return 'Intensity map'
  if (name.startsWith('EDX~Plot')) return name === 'EDX~Plot' ? 'Sum spectrum' : 'Spectrum of a selection'
  return 'EDX data'
}

const LOOK: AnalysisLook = {
  spec: techApp('kherveedx'),
  actions: EDX_ACTIONS,
  icon: Atom,
  fileKind: 'EDX map',
  projectName: 'EDX_Data',
  panelTitle: 'EDX HeatMap',
  sheetKind,
  xIsTemperature: /^$/,
  welcome: {
    blurb: 'SEM-EDX spectrum images: the sum spectrum with its elements labelled, intensity and element maps, spectra of a point, an area or a line, and standardless quantification.',
    formats: '.kfit projects · HDF5 (.hdf5 / .h5) · Bruker .bcf · Velox .emd',
    start: 'Open an EDX map, or try an example.',
  },
}

export default function KherveEDX(props: AppProps) {
  return <AnalysisApp {...props} look={LOOK} />
}
