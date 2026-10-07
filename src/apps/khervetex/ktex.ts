// The .ktex file: a ZIP holding the document model and its pictures, the
// same container as the desktop KherveTeX (khervedoc/kdocz.py):
//
//   manifest.json   {"format": "ktex", "schema_version": 1, "app": "KherveTeX"}
//   document.json   the model (model.ts), figure paths pointing into the archive
//   document.tex    the generated LaTeX, for readers without KherveTeX
//   project.json    only in a project's main document (kept as it is)
//   kherveref.bib   the cited entries of a KherveRef-managed bibliography
//   figures/…       the pictures (and a drawing's .pdf/.svg siblings)
//
// .ktexz / .kdocz are older names for the same container; .ktex.json and
// .kdoc.json are the bare document.json.

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { fromJson, pyJson, toJson, type Document, type Figure } from './model'
import { serializeDocument } from './serializer'

export const SCHEMA_VERSION = 1
const MANIFEST = 'manifest.json'
const DOC = 'document.json'
const TEX = 'document.tex'
const PROJECT = 'project.json'
export const BIB_FILE = 'kherveref.bib'

/** A document with the files it carries. */
export interface Bundle {
  doc: Document
  /** Pictures and their siblings, by path inside the archive ("figures/figure_001.png"). */
  files: Map<string, Uint8Array>
  /** kherveref.bib, or "". */
  bib: string
  /** project.json of a project's main document, or null. */
  project: string | null
}

// The editable source and the PDF LaTeX includes live beside a figure's PNG preview.
const FIGURE_SIBLINGS: Record<string, string[]> = { drawing: ['.svg', '.pdf'], flowchart: ['.pdf', '.flow.json', '.tikz'] }

export function isBundlePath(p: string): boolean {
  const s = p.toLowerCase()
  return s.endsWith('.ktex') || s.endsWith('.ktexz') || s.endsWith('.kdocz')
}

export function isLegacyBundle(p: string): boolean {
  const s = p.toLowerCase()
  return s.endsWith('.ktexz') || s.endsWith('.kdocz')
}

export function isJsonDocPath(p: string): boolean {
  const s = p.toLowerCase()
  return s.endsWith('.ktex.json') || s.endsWith('.kdoc.json') || s.endsWith('.json')
}

/** "My paper.ktex" → "My paper" (also .ktex.json, .kdoc.json). */
export function docStem(name: string): string {
  for (const ext of ['.ktex.json', '.kdoc.json', '.kdocproj.json']) if (name.endsWith(ext)) return name.slice(0, -ext.length)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function cleanEntry(name: string): string {
  return name.replace(/\\/g, '/').replace(/^(\.\/)+/, '')
}

export function readBundle(bytes: Uint8Array): Bundle {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch {
    throw new Error('This is not a KherveTeX document (it is not a ZIP archive).')
  }
  const byName = new Map<string, Uint8Array>()
  for (const [name, data] of Object.entries(entries)) if (!name.endsWith('/')) byName.set(cleanEntry(name), data)
  const manifest = byName.get(MANIFEST)
  if (manifest) {
    let version = 0
    try {
      version = Number((JSON.parse(strFromU8(manifest)) as { schema_version?: number }).schema_version ?? 0)
    } catch {
      // a broken manifest is not fatal
    }
    if (version > SCHEMA_VERSION) throw new Error(`This document was made by a newer KherveTeX (schema ${version} > ${SCHEMA_VERSION}).`)
  }
  const docJson = byName.get(DOC)
  if (!docJson) throw new Error('This archive has no document.json: it is not a KherveTeX document.')
  const doc = fromJson(strFromU8(docJson))
  const files = new Map<string, Uint8Array>()
  for (const [name, data] of byName) {
    if (name === MANIFEST || name === DOC || name === TEX || name === PROJECT || name === BIB_FILE) continue
    files.set(name, data)
  }
  const bib = byName.get(BIB_FILE)
  const project = byName.get(PROJECT)
  return { doc, files, bib: bib ? strFromU8(bib) : '', project: project ? strFromU8(project) : null }
}

/** The files a document's figures use: each picture and its siblings, in document order. */
export function figureFiles(doc: Document, files: Map<string, Uint8Array>): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>()
  for (const block of doc.children) {
    if (block.type !== 'Figure' || !block.path) continue
    const fig = block as Figure
    const data = files.get(fig.path)
    if (!data || out.has(fig.path)) continue
    out.set(fig.path, data)
    const dot = fig.path.lastIndexOf('.')
    const stem = dot > fig.path.lastIndexOf('/') ? fig.path.slice(0, dot) : fig.path
    for (const ext of FIGURE_SIBLINGS[fig.source] ?? []) {
      const sib = files.get(stem + ext)
      if (sib) out.set(stem + ext, sib)
    }
  }
  return out
}

const STORED = /\.(png|jpe?g|gif|webp|pdf|zip)$/i

export function writeBundle(b: Bundle): Uint8Array {
  const zip: Zippable = {}
  // Insertion order is the archive order, as the desktop writes it.
  if (b.project !== null) zip[PROJECT] = strToU8(b.project)
  zip[MANIFEST] = strToU8(pyJson({ format: 'ktex', schema_version: SCHEMA_VERSION, app: 'KherveTeX' }))
  zip[DOC] = strToU8(toJson(b.doc))
  zip[TEX] = strToU8(serializeDocument(b.doc))
  for (const [name, data] of figureFiles(b.doc, b.files)) {
    zip[name] = STORED.test(name) ? [data, { level: 0 }] : data
  }
  if (b.bib) zip[BIB_FILE] = strToU8(b.bib)
  return zipSync(zip, { level: 6 })
}

/** A LaTeX package for Overleaf or a journal: main.tex, figures/ and one equations/eq_NNN.tex per display equation. */
export function writeLatexZip(b: Bundle, mainName = 'main'): Uint8Array {
  const zip: Zippable = {}
  zip[`${mainName}.tex`] = strToU8(serializeDocument(b.doc))
  for (const [name, data] of figureFiles(b.doc, b.files)) zip[name] = data
  if (b.bib && b.doc.meta.ref_library) zip[BIB_FILE] = strToU8(b.bib)
  let n = 0
  for (const block of b.doc.children) {
    if (block.type === 'MathBlock' && block.latex.trim()) {
      n += 1
      const env = block.numbered ? 'equation' : 'equation*'
      const label = block.label ? `\\label{${block.label}}\n` : ''
      zip[`equations/eq_${String(n).padStart(3, '0')}.tex`] = strToU8(`\\begin{${env}}\n${label}${block.latex.trim()}\n\\end{${env}}\n`)
    }
  }
  return zipSync(zip, { level: 6 })
}
