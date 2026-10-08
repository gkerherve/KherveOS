// KherveTGA: the TGA / DSC technique of KherveFitting-AI as an app of its own
// (the shared base is src/apps/khervetech; the desktop code runs unchanged in
// Python). Checklist: docs/parity/khervetga.md.

import type { AppProps } from '@/os'
import { TechApp } from '@/apps/khervetech/TechApp'
import { techApp } from '@/apps/khervetech/spec'
import { TGA_ACTIONS } from './actions'

const SPEC = techApp('khervetga')

export default function KherveTGA(props: AppProps) {
  return <TechApp {...props} spec={SPEC} actions={TGA_ACTIONS} />
}
