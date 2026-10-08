// Structure pictures with a cache: RDKit draws a SMILES once per size; the screen shows the themed SVG and files get
// the plain one. Browser-side but with no React.

import type { MainModule } from '@rdkit/rdkit'
import { depict, isValidSmiles, molComposition } from './rdengine'
import type { ResolveHooks } from './reaction'
import { staticSvg, themeSvg } from './svgtheme'

const cache = new Map<string, string | null>()

/** RDKit's own SVG of a SMILES (null when RDKit cannot read it). */
export function rawSvg(rd: MainModule, smiles: string, width = 220, height = 160): string | null {
  const key = `${smiles}|${width}|${height}`
  if (cache.has(key)) return cache.get(key) ?? null
  const svg = depict(rd, smiles, { width, height })
  if (cache.size > 600) cache.clear()
  cache.set(key, svg)
  return svg
}

export function screenSvg(rd: MainModule, smiles: string, width = 220, height = 160): string | null {
  const raw = rawSvg(rd, smiles, width, height)
  return raw ? themeSvg(raw) : null
}

export function printSvg(rd: MainModule, smiles: string, width = 300, height = 220): string | null {
  const raw = rawSvg(rd, smiles, width, height)
  return raw ? staticSvg(raw) : null
}

/** Hooks that let RDKit read and count the atoms of every SMILES in a reaction (the built-in reader when it is null). */
export function resolveHooks(rd: MainModule | null): ResolveHooks {
  if (!rd) return {}
  return { valid: (s) => isValidSmiles(rd, s), composition: (s) => molComposition(rd, s) }
}
