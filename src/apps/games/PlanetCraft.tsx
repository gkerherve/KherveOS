// PlanetCraft: a voxel planet. It runs on its own server (KhervePlanet/serve.py, port 8123).

import type { AppProps } from '@/os'
import { WebGame } from './WebGame'

export default function PlanetCraft({ win }: AppProps) {
  return <WebGame game="planetcraft" win={win} />
}
