// Example files that ship with an app (public/examples/<app>/ + index.json) and are copied once into a folder
// of the user's drive (~/Documents/<App> Examples), where Files lists them and a double-click opens them in the
// app. The same scheme as the technique apps (khervetech/TechApp.tsx), kept generic so any app can use it.
//
//   index.json   { "examples": [{ "file": "01 Voltage divider.kelec", "title": "Voltage divider",
//                                  "description": "…", "group": "Basics" }, …] }
//
// What is copied: a file that is not on the drive yet and that this browser has not copied before. A file the user
// changed, renamed or deleted is never touched or brought back; a new example in a later version is added.

// This module is pure (nothing is imported that needs the browser): the drive is passed in, so that Node can use
// the file-name and index helpers too (tools/export_app_examples.ts, the tests).

import { HOME, join } from './path.ts'

/** One line of an app's examples/index.json. */
export interface ExampleIndexEntry {
  /** File name (no folders). */
  file: string
  /** Name shown in menus. */
  title: string
  description?: string
  /** A heading to group the menu by (kElec: the category; kReaction: the reaction class). */
  group?: string
}

/** An example as a generator makes it (tools/export_app_examples.ts): the index entry and the text of the file. */
export interface ExampleSource extends ExampleIndexEntry {
  content: string
}

/** File names of generated examples: "01 Voltage divider.kelec" (the number keeps the order in a folder listing; ASCII only). */
export function exampleFileName(n: number, title: string, ext: string): string {
  const clean = title
    .replace(/\s*[⇌⇄]\s*/g, ' = ').replace(/\s*→\s*/g, ' to ').replace(/[–—]/g, '-')
    .normalize('NFKD').replace(/[^\x20-\x7e]/g, '') // plain ASCII: any server and any drive takes the name
    .replace(/:\s+/g, ' - ').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim()
  return `${String(n).padStart(2, '0')} ${clean}.${ext}`
}

/** An index entry and where its file is on the drive. */
export interface ExampleFile extends ExampleIndexEntry {
  path: string
}

/** The part of the virtual drive (the OS's `fs`) that seeding needs. */
export interface ExampleDrive {
  exists(path: string): boolean
  writeBytes(path: string, data: Uint8Array, opts?: { mkdirs?: boolean }): Promise<void>
  /** Optional: lets seeding repair a file that was once saved as an HTML error page. */
  readText?(path: string): Promise<string>
}

/**
 * The address of an example file under `base`. `encodeURIComponent` would turn "," "+" "=" into %2C %2B %3D, which
 * the Vite dev server (and some static hosts) do not decode, so they answer with the app's HTML page instead of the file.
 */
export function exampleUrl(base: string, file: string): string {
  return base + encodeURI(file).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

/** True for the HTML page a server sends for an address it does not know (the single-page-app fallback). */
export function looksLikeHtml(text: string): boolean {
  return /^\s*<(!doctype html|html)\b/i.test(text.slice(0, 200))
}

export interface ExampleFolderOptions {
  /** The folder of public/examples/ the files come from: "kelec". */
  app: string
  /** The folder made in ~/Documents: "kElec Examples". */
  folderName: string
  /** The OS drive: `import { fs } from '@/os'`. */
  fs: ExampleDrive
}

/** ~/Documents/<folderName> */
export const exampleFolderPath = (folderName: string): string => `${HOME}/Documents/${folderName}`

const seededKey = (app: string) => `kherveos.examples.${app}`

function readSeeded(app: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(seededKey(app)) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeSeeded(app: string, files: string[]) {
  try {
    localStorage.setItem(seededKey(app), JSON.stringify(files))
  } catch {
    /* storage blocked: the files are then only copied when they are missing */
  }
}

/** The valid entries of an index.json (anything else is ignored). */
export function readExampleIndex(json: unknown): ExampleIndexEntry[] {
  const list = (json as { examples?: unknown } | null)?.examples
  if (!Array.isArray(list)) return []
  const out: ExampleIndexEntry[] = []
  for (const e of list) {
    const o = (e ?? {}) as Record<string, unknown>
    if (typeof o.file !== 'string' || o.file.includes('/') || o.file.includes('..') || !o.file) continue
    out.push({
      file: o.file,
      title: typeof o.title === 'string' && o.title ? o.title : o.file.replace(/\.[^.]+$/, ''),
      ...(typeof o.description === 'string' ? { description: o.description } : {}),
      ...(typeof o.group === 'string' && o.group ? { group: o.group } : {}),
    })
  }
  return out
}

/**
 * Copies the example files into ~/Documents/<folderName> (see the top of this file) and returns the entries with
 * their paths, in the order of the index, for the files that are on the drive. Never throws: with the server file
 * missing (offline, not built) or the drive full it returns [] or what could be copied.
 */
export async function seedExampleFolder({ app, folderName, fs }: ExampleFolderOptions): Promise<ExampleFile[]> {
  const dir = exampleFolderPath(folderName)
  const base = `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}examples/${app}/`
  try {
    const r = await fetch(`${base}index.json`, { cache: 'no-cache' })
    if (!r.ok) return []
    const entries = readExampleIndex(await r.json())
    // a folder the user removed is made again from scratch
    const done = new Set(fs.exists(dir) ? readSeeded(app) : [])
    for (const e of entries) {
      const target = join(dir, e.file)
      const wantsHtml = /\.html?$/i.test(e.file)
      let broken = false
      if (!wantsHtml && fs.exists(target) && fs.readText) {
        // an earlier version saved the server's HTML fallback page for names with "," "+" "=": bring the real file back
        try {
          broken = looksLikeHtml(await fs.readText(target))
        } catch {
          /* unreadable: leave it */
        }
      }
      if (!broken && (done.has(e.file) || fs.exists(target))) {
        done.add(e.file)
        continue
      }
      try {
        const f = await fetch(exampleUrl(base, e.file))
        if (!f.ok) continue
        if (!wantsHtml && /text\/html/i.test(f.headers?.get?.('content-type') ?? '')) continue // not found: the fallback page
        const bytes = new Uint8Array(await f.arrayBuffer())
        if (!wantsHtml && looksLikeHtml(new TextDecoder().decode(bytes.subarray(0, 200)))) continue
        await fs.writeBytes(target, bytes, { mkdirs: true })
        done.add(e.file)
      } catch {
        /* this one next time */
      }
    }
    writeSeeded(app, [...done])
    // only what is on the drive (a file the user deleted is not offered again)
    return entries.map((e) => ({ ...e, path: join(dir, e.file) })).filter((e) => fs.exists(e.path))
  } catch {
    return [] // offline: try again next time
  }
}

/** The titles of the examples, grouped (in the order the groups first appear); without groups one list. */
export function groupExamples(files: readonly ExampleFile[]): Array<{ group: string; files: ExampleFile[] }> {
  const groups = new Map<string, ExampleFile[]>()
  for (const f of files) {
    const g = f.group ?? ''
    groups.set(g, [...(groups.get(g) ?? []), f])
  }
  return [...groups].map(([group, list]) => ({ group, files: list }))
}
