// Ready-made device models (approximate datasheet values) used by the schematic parts and the SPICE parser.

import type { BjtModel, DiodeModel, MosModel } from './circuit.ts'
import { isForDrop } from './circuit.ts'

const led = (name: string, vf: number): DiodeModel => ({ name, is: isForDrop(vf, 2), n: 2 })

export const DIODE_MODELS: Record<string, DiodeModel> = {
  D: { name: 'D', is: 1e-14, n: 1 },
  '1N4148': { name: '1N4148', is: 2.52e-9, n: 1.752 },
  '1N4007': { name: '1N4007', is: 7.02e-9, n: 1.8 },
  '1N5819': { name: '1N5819', is: 3e-7, n: 1.05 },
  SCHOTTKY: { name: 'SCHOTTKY', is: 3e-7, n: 1.05 },
  LED_RED: led('LED_RED', 1.9),
  LED_YELLOW: led('LED_YELLOW', 2.0),
  LED_GREEN: led('LED_GREEN', 2.1),
  LED_BLUE: led('LED_BLUE', 3.0),
  LED_WHITE: led('LED_WHITE', 3.1),
}

/** A Zener of the given voltage (at 5 mA); the forward part is an ordinary silicon diode. */
export function zenerModel(vz: number): DiodeModel {
  return { name: `DZ${vz}`, is: 1e-14, n: 1, bv: vz, ibv: 5e-3 }
}

export const BJT_MODELS: Record<string, BjtModel> = {
  NPN: { name: 'NPN', pol: 1, is: 1e-14, bf: 100, br: 1 },
  PNP: { name: 'PNP', pol: -1, is: 1e-14, bf: 100, br: 1 },
  '2N3904': { name: '2N3904', pol: 1, is: 6.7e-15, bf: 416, br: 0.74, vaf: 74 },
  '2N3906': { name: '2N3906', pol: -1, is: 1.4e-14, bf: 180, br: 4, vaf: 18 },
  BC547: { name: 'BC547', pol: 1, is: 7e-15, bf: 300, br: 5, vaf: 80 },
  BC557: { name: 'BC557', pol: -1, is: 1e-14, bf: 250, br: 5, vaf: 40 },
}

export const MOS_MODELS: Record<string, MosModel> = {
  NMOS: { name: 'NMOS', pol: 1, vto: 2, kp: 0.12, lambda: 0, w: 1, l: 1 },
  PMOS: { name: 'PMOS', pol: -1, vto: -2, kp: 0.12, lambda: 0, w: 1, l: 1 },
  '2N7000': { name: '2N7000', pol: 1, vto: 2.1, kp: 0.1, lambda: 0.01, w: 1, l: 1 },
  BS250: { name: 'BS250', pol: -1, vto: -2.5, kp: 0.08, lambda: 0.01, w: 1, l: 1 },
}

export function knownModel(name: string): { type: 'D'; m: DiodeModel } | { type: 'Q'; m: BjtModel } | { type: 'M'; m: MosModel } | null {
  const k = name.toUpperCase()
  if (DIODE_MODELS[k]) return { type: 'D', m: DIODE_MODELS[k] }
  if (BJT_MODELS[k]) return { type: 'Q', m: BJT_MODELS[k] }
  if (MOS_MODELS[k]) return { type: 'M', m: MOS_MODELS[k] }
  return null
}
