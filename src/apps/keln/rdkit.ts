// Draws the reaction scheme of a Reaction table block from its reaction SMILES with RDKit (the RDKit project's
// MinimalLib, WebAssembly, npm @rdkit/rdkit). Loaded the first time a scheme is needed; everything is optional:
// without RDKit the block simply shows no picture.

import type { MainModule } from '@rdkit/rdkit'

let loading: Promise<MainModule | null> | null = null

export function loadRDKit(): Promise<MainModule | null> {
  loading ??= (async () => {
    try {
      const [{ default: init }, { default: wasmUrl }] = await Promise.all([import('@rdkit/rdkit'), import('@rdkit/rdkit/RDKit_minimal.wasm?url')])
      return await (init as unknown as (o: unknown) => Promise<MainModule>)({ locateFile: () => wasmUrl })
    } catch (e) {
      console.warn('[keln] RDKit is unavailable', e)
      return null
    }
  })()
  return loading
}

/** An SVG of "A.B>>C" (or of one molecule), or null when it cannot be drawn. */
export async function schemeSvg(smiles: string, width = 560, height = 150): Promise<string | null> {
  const s = smiles.trim()
  if (!s) return null
  const rd = await loadRDKit()
  if (!rd) return null
  try {
    if (s.includes('>')) {
      const rxn = rd.get_rxn(s)
      if (rxn) {
        try { return rxn.get_svg(width, height) } finally { rxn.delete() }
      }
    }
    const parts = s.split('>>').join('.').split('.').filter(Boolean)
    const svgs: string[] = []
    for (const part of parts) {
      const m = rd.get_mol(part, JSON.stringify({ removeHs: true }))
      if (!m || !m.is_valid()) { m?.delete(); return null }
      try { svgs.push(m.get_svg(Math.round(width / Math.max(2, parts.length)), height)) } finally { m.delete() }
    }
    return svgs.length ? `<div style="display:flex;gap:4px">${svgs.join('')}</div>` : null
  } catch {
    return null
  }
}
