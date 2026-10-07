// The reusable-object library (library.py): the selection saved as a named,
// standalone SVG in a per-user folder on the drive, organised in sub-folders
// ("Walls/brick"), and inserted later as fresh, editable items.

import { fs, path, HOME } from '@/os'
import type { Item } from './model'
import { cloneItem } from './model'
import { objectSvg, parseSvg } from './svgio'

export const LIBRARY_DIR = `${HOME}/Documents/KhervePaint Library`

export interface LibraryObject {
  /** Sub-folder names from the library root. */
  folder: string[]
  name: string
  path: string
}

/** A filesystem-friendly name from what the user typed (library._safe_name). */
export function safeName(name: string): string {
  const keep = [...name.trim()].filter((c) => /[\p{L}\p{N} _\-()]/u.test(c)).join('').trim()
  return keep || 'object'
}

/** Every saved object, sorted by folder then name. */
export function listObjects(): LibraryObject[] {
  if (!fs.isDir(LIBRARY_DIR)) return []
  const out: LibraryObject[] = []
  for (const st of fs.walk(LIBRARY_DIR)) {
    if (st.type !== 'file' || path.extname(st.name) !== '.svg') continue
    const rel = st.path.slice(LIBRARY_DIR.length + 1).split('/')
    out.push({ folder: rel.slice(0, -1), name: rel[rel.length - 1].replace(/\.svg$/i, ''), path: st.path })
  }
  const key = (o: LibraryObject) => [...o.folder, o.name].join('/').toLowerCase()
  return out.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
}

/** Save items as <library>/<folder>/<name>.svg; a "/" in the name makes sub-folders. Returns the path. */
export async function saveObject(items: Item[], name: string, dpi: number): Promise<string> {
  const parts = name.split('/').map((p) => p.trim()).filter((p) => p && p !== '.' && p !== '..')
  const leaf = safeName(parts.pop() ?? 'object')
  const dir = path.join(LIBRARY_DIR, ...parts.map(safeName))
  const file = path.join(dir, `${leaf}.svg`)
  await fs.writeText(file, objectSvg(items, dpi), { mkdirs: true })
  return file
}

/** A saved object's items, with fresh ids (library.load_object). */
export async function loadObject(file: string): Promise<Item[]> {
  const doc = parseSvg(await fs.readText(file))
  return doc.items.map(cloneItem)
}

export async function deleteObject(file: string) {
  await fs.remove(file)
}

export async function renameObject(file: string, name: string): Promise<string> {
  const target = path.join(path.dirname(file), `${safeName(name)}.svg`)
  if (target !== file) await fs.rename(file, target)
  return target
}
