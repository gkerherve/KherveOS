// FaceCraft: a photo, as a blocky game skin. It runs on its own server (KherveSkins/serve.py, port 8140).

import type { AppProps } from '@/os'
import { WebGame } from './WebGame'

export default function FaceCraft({ win }: AppProps) {
  return <WebGame game="facecraft" win={win} />
}
