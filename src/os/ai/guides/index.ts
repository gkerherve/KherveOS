// Every app guide. Each app of the registry (src/os/registry.ts) needs one
// (tools/tests/app-guides.test.ts says which is missing).
//
// A new app's guide:
//   - a technique app (kAFM, kTEM, kEDX…): one entry in techniques.ts;
//   - any other app: one entry in the file of its kind (science.ts, office.ts,
//     system.ts, games.ts, materials.ts), or a new file listed here.
// See core.ts for the fields and ../manifests/ for the tools the guide names.

import type { AppGuide } from './core.ts'
import { GAME_GUIDES } from './games.ts'
import { MATERIALS_GUIDES } from './materials.ts'
import { OFFICE_GUIDES } from './office.ts'
import { SCIENCE_GUIDES } from './science.ts'
import { SYSTEM_GUIDES } from './system.ts'
import { TECHNIQUE_GUIDES } from './techniques.ts'

export const APP_GUIDES: AppGuide[] = [
  ...MATERIALS_GUIDES,
  ...TECHNIQUE_GUIDES,
  ...SCIENCE_GUIDES,
  ...OFFICE_GUIDES,
  ...SYSTEM_GUIDES,
  ...GAME_GUIDES,
]
