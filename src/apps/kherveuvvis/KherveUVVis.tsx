// KherveUVVis: the UV-Vis technique of KherveFitting-AI as an app of its own
// (the shared base is src/apps/khervetech; the desktop code runs unchanged in
// Python). Checklist: docs/parity/kherveuvvis.md.

import type { AppProps } from '@/os'
import { TechApp } from '@/apps/khervetech/TechApp'
import { techApp } from '@/apps/khervetech/spec'
import { UVVIS_ACTIONS } from './actions'

const SPEC = techApp('kherveuvvis')

export default function KherveUVVis(props: AppProps) {
  return <TechApp {...props} spec={SPEC} actions={UVVIS_ACTIONS} />
}
