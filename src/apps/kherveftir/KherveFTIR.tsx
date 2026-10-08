// KherveFTIR: the FTIR technique of KherveFitting-AI as an app of its own
// (the shared base is src/apps/khervetech; the desktop code runs unchanged in
// Python). Checklist: docs/parity/kherveftir.md.

import type { AppProps } from '@/os'
import { TechApp } from '@/apps/khervetech/TechApp'
import { techApp } from '@/apps/khervetech/spec'
import { FTIR_ACTIONS } from './actions'

const SPEC = techApp('kherveftir')

export default function KherveFTIR(props: AppProps) {
  return <TechApp {...props} spec={SPEC} actions={FTIR_ACTIONS} />
}
