// KherveBET: the BET / physisorption technique of KherveFitting-AI as an app
// of its own (the shared base is src/apps/khervetech; the desktop code runs
// unchanged in Python). Checklist: docs/parity/kherve-bet.md.

import type { AppProps } from '@/os'
import { TechApp } from '@/apps/khervetech/TechApp'
import { techApp } from '@/apps/khervetech/spec'
import { BET_ACTIONS } from './actions'

const SPEC = techApp('khervebet')

export default function KherveBET(props: AppProps) {
  return <TechApp {...props} spec={SPEC} actions={BET_ACTIONS} />
}
