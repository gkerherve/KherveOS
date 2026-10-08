// KherveRaman: the Raman technique of KherveFitting-AI as an app of its own
// (the shared base is src/apps/khervetech; the desktop code runs unchanged in
// Python). Checklist: docs/parity/kherveraman.md.

import type { AppProps } from '@/os'
import { TechApp } from '@/apps/khervetech/TechApp'
import { techApp } from '@/apps/khervetech/spec'
import { RAMAN_ACTIONS } from './actions'

const SPEC = techApp('kherveraman')

export default function KherveRaman(props: AppProps) {
  return <TechApp {...props} spec={SPEC} actions={RAMAN_ACTIONS} />
}
