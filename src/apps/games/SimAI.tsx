// SimAI: a village that lives by itself. It runs on its own server (SimAI/serve.py, port 8137).

import type { AppProps } from '@/os'
import { WebGame } from './WebGame'

export default function SimAI({ win }: AppProps) {
  return <WebGame game="simai" win={win} />
}
