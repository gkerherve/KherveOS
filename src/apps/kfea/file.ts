// The .kfea file: JSON {format: "kfea", version: 1, name, description, analysis, units, materials, sections, nodes,
// members, supports, loads, plate…} in SI units. Keys are written in a fixed order, numbers with 12 significant
// digits, so that the same model always gives the same text.

import { cleanModel, type Model } from './model.ts'

const ORDER = [
  'format', 'version', 'name', 'description', 'analysis', 'study', 'units', 'materials', 'sections', 'nodes', 'members', 'supports', 'nodeLoads', 'memberLoads', 'gravity', 'plate', 'expected',
]

export function modelToJson(m: Model): Record<string, unknown> {
  const o: Record<string, unknown> = {}
  const src = m as unknown as Record<string, unknown>
  for (const k of ORDER) {
    if (k === 'expected' && !m.expected) continue
    if (k === 'plate' && !m.plate) continue
    if (k === 'study' && m.study === 'static') continue
    o[k] = src[k]
  }
  return o
}

export function serializeModel(m: Model): string {
  return JSON.stringify(modelToJson(m), (_k, v) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toPrecision(12)) : v), 2) + '\n'
}

/** Reads a .kfea file; throws a readable error when it is not one. */
export function parseModel(text: string): Model {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('This is not a kFEA file (it is not valid JSON).') }
  return cleanModel(raw)
}

/** A safe file name for a model name. */
export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'Untitled'
}
