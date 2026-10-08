// Mad Scientist SIM: a university department that lives by itself. It runs on
// its own server (MadScientistSIM/serve.py, port 8147).

import type { AppProps } from '@/os'
import { WebGame } from './WebGame'

export default function MadScientistSIM({ win }: AppProps) {
  return <WebGame game="madsci" win={win} />
}
