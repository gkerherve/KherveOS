// The .knote file (the desktop's khervenote/knote_file.py): a ZIP holding
//
//   note.json   the model (model.ts), json.dumps(indent=1, ensure_ascii=False)
//   assets/…    pictures (assets/<id>.png), recordings (assets/rec-<id>.ogg),
//               attached documents (assets/att-<id>/<Name>.pdf)
//
// note.json is deflated; the assets are stored (already compressed). Plain
// TypeScript so Node can test it.

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { assetPaths, noteJson, parseNoteJson, type Note } from './model.ts'

export const NOTE_JSON = 'note.json'
export const EXTENSION = '.knote'

/** A note and the files it carries, by path inside the archive. */
export interface NoteFile {
  note: Note
  assets: Map<string, Uint8Array>
}

/** Only plain relative paths inside the archive (a crafted zip could name ../../x). */
export function safeAssetPath(name: string): string | null {
  const p = name.replace(/\\/g, '/').replace(/^(\.\/)+/, '')
  if (!p || p.startsWith('/') || /^[a-z]:/i.test(p) || p.split('/').some((part) => part === '..' || part === '')) return null
  return p
}

export function writeKnote(note: Note, assets: Map<string, Uint8Array>): Uint8Array {
  const files: Zippable = { [NOTE_JSON]: [strToU8(noteJson(note)), { level: 6 }] }
  for (const rel of [...new Set(assetPaths(note))].sort()) {
    const safe = safeAssetPath(rel)
    const data = safe ? assets.get(rel) : undefined
    if (safe && data) files[safe] = [data, { level: 0 }]
  }
  return zipSync(files)
}

export function readKnote(bytes: Uint8Array): NoteFile {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch {
    throw new Error('This is not a kNote note (it is not a ZIP archive).')
  }
  const json = entries[NOTE_JSON]
  if (!json) throw new Error('This .knote file has no note.json.')
  const note = parseNoteJson(strFromU8(json))
  const assets = new Map<string, Uint8Array>()
  for (const [name, data] of Object.entries(entries)) {
    if (name === NOTE_JSON || name.endsWith('/')) continue
    const safe = safeAssetPath(name)
    if (safe) assets.set(safe, data)
  }
  return { note, assets }
}

/** Only note.json, for listing and searching notes without unpacking pictures and recordings. */
export function readNoteOnly(bytes: Uint8Array): Note {
  const entries = unzipSync(bytes, { filter: (f) => f.name === NOTE_JSON })
  const json = entries[NOTE_JSON]
  if (!json) throw new Error('This .knote file has no note.json.')
  return parseNoteJson(strFromU8(json))
}
