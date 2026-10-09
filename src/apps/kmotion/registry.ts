// All scenes of kMotion in one place (pure): lookup, default documents and the construction of a simulation from a file.

import { isMethod, type Method } from './integrators.ts'
import { COLLISION } from './scenes/collision.ts'
import { CIRCULAR } from './scenes/circular.ts'
import { OSCILLATOR } from './scenes/oscillator.ts'
import { ORBIT } from './scenes/orbit.ts'
import { PENDULUM } from './scenes/pendulum.ts'
import { PROJECTILE } from './scenes/projectile.ts'
import { SANDBOX } from './scenes/sandbox.ts'
import { sanitize } from './common.ts'
import type { KMotionDoc, Params, SceneDef, SceneId, Sim } from './types.ts'

export const SCENES: SceneDef[] = [PROJECTILE, PENDULUM, OSCILLATOR, COLLISION, ORBIT, SANDBOX, CIRCULAR]

export const sceneById = (id: string): SceneDef | undefined => SCENES.find((s) => s.id === id)

/** Method used when a file does not name one: the accurate default for each scene. */
export const defaultMethod = (scene: SceneId, mode: string): Method => {
  if (scene === 'orbit') return mode === 'restricted3' ? 'rk45' : mode === 'nbody' || mode === 'solar' ? 'verlet' : 'rk4'
  return 'rk4'
}

export function defaultDoc(scene: SceneId, mode?: string): KMotionDoc {
  const def = sceneById(scene)!
  const m = mode && def.modes.some((x) => x.id === mode) ? mode : def.modes[0].id
  return { format: 'kmotion', version: 1, scene, params: def.defaults(m), method: defaultMethod(scene, m) }
}

/** A complete, valid parameter set for the scene and mode (missing values from the defaults, out-of-range values clamped). */
export function cleanParams(scene: SceneId, input: Params): Params {
  const def = sceneById(scene)!
  const mode = typeof input.mode === 'string' && def.modes.some((x) => x.id === input.mode) ? input.mode : def.modes[0].id
  return sanitize(def.params, mode, { ...def.defaults(mode), ...input })
}

export function makeSim(doc: KMotionDoc, method?: Method): Sim {
  const def = sceneById(doc.scene)!
  const params = cleanParams(doc.scene, doc.params)
  return def.create(params, method ?? (isMethod(doc.method) ? doc.method : defaultMethod(doc.scene, String(params.mode))))
}

export class FileError extends Error {}

/** Reads a .kmotion file. Throws FileError with a message fit for a dialog. */
export function parseKmotion(text: string): KMotionDoc {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new FileError('This is not a kMotion file (it is not valid JSON).')
  }
  const o = raw as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || o.format !== 'kmotion') throw new FileError('This is not a kMotion file (the "format" field should be "kmotion").')
  if (typeof o.version === 'number' && o.version > 1) throw new FileError('This file was made by a newer version of kMotion.')
  const def = typeof o.scene === 'string' ? sceneById(o.scene) : undefined
  if (!def) throw new FileError(`Unknown scene “${String(o.scene)}”. Scenes: ${SCENES.map((s) => s.id).join(', ')}.`)
  const params = cleanParams(def.id, (o.params && typeof o.params === 'object' ? o.params : {}) as Params)
  const doc: KMotionDoc = { format: 'kmotion', version: 1, scene: def.id, params }
  if (typeof o.title === 'string') doc.title = o.title
  if (typeof o.description === 'string') doc.description = o.description
  if (isMethod(o.method)) doc.method = o.method
  const v = o.view as Record<string, unknown> | undefined
  if (v && typeof v.cx === 'number' && typeof v.cy === 'number' && typeof v.scale === 'number' && v.scale > 0 && [v.cx, v.cy, v.scale].every(Number.isFinite)) doc.view = { cx: v.cx, cy: v.cy, scale: v.scale }
  return doc
}

export function serializeKmotion(doc: KMotionDoc): string {
  const out: Record<string, unknown> = { format: 'kmotion', version: 1, scene: doc.scene }
  if (doc.title) out.title = doc.title
  if (doc.description) out.description = doc.description
  if (doc.method) out.method = doc.method
  out.params = doc.params
  if (doc.view) out.view = doc.view
  return JSON.stringify(out, null, 2) + '\n'
}
