// The Examples menu: notebooks exported from the desktop KherveBook into
// public/examples/khervebook/ (tools/export_khervebook_examples.py), listed
// by index.json:
//
//   {"welcome": "welcome.kbook",
//    "categories": [{"name": "XPS", "notebooks": [{"title", "file", "cells", "types", "live"}]}]}

export interface ExampleNotebook {
  title: string
  file: string
  /** Cell types it uses (to say what may not show in the web version yet). */
  types: string[]
  /** It has a cell that runs continuously. */
  live: boolean
}

export interface ExampleCategory {
  name: string
  notebooks: ExampleNotebook[]
}

export interface ExampleIndex {
  welcome: string | null
  categories: ExampleCategory[]
}

const BASE = `${import.meta.env.BASE_URL}examples/khervebook/`

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** Only plain relative paths inside the examples folder. */
const safeFile = (f: unknown): f is string =>
  typeof f === 'string' && /\.(kbook|ipynb)$/i.test(f) && !f.includes('..') && !f.startsWith('/') && !/^[a-z]+:/i.test(f)

function parseIndex(raw: unknown): ExampleIndex {
  if (!isObj(raw)) throw new Error('index.json is not an object')
  const categories: ExampleCategory[] = (Array.isArray(raw.categories) ? raw.categories : []).filter(isObj).map((c) => ({
    name: typeof c.name === 'string' ? c.name : 'Examples',
    notebooks: (Array.isArray(c.notebooks) ? c.notebooks : [])
      .filter(isObj)
      .filter((n) => safeFile(n.file))
      .map((n) => ({
        title: typeof n.title === 'string' && n.title ? n.title : String(n.file),
        file: n.file as string,
        types: Array.isArray(n.types) ? n.types.filter((t): t is string => typeof t === 'string') : [],
        live: n.live === true,
      })),
  }))
  return { welcome: safeFile(raw.welcome) ? raw.welcome : null, categories }
}

let indexPromise: Promise<ExampleIndex> | null = null

/** The example list (fetched once per page load; a failure is retried next time). */
export function loadExampleIndex(): Promise<ExampleIndex> {
  indexPromise ??= fetch(`${BASE}index.json`, { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<unknown>
    })
    .then(parseIndex)
    .catch((e: unknown) => {
      indexPromise = null
      throw e
    })
  return indexPromise
}

/** The text of an example notebook (`file` relative to the examples folder). */
export async function fetchExample(file: string): Promise<string> {
  if (!safeFile(file)) throw new Error(`Not an example notebook: ${file}`)
  const r = await fetch(BASE + file.split('/').map(encodeURIComponent).join('/'))
  if (!r.ok) throw new Error(`The example could not be downloaded (HTTP ${r.status}).`)
  return r.text()
}

export const WELCOME_FILE = 'welcome.kbook'

/** A file name for Save As, from an example's title. */
export function exampleFileName(title: string): string {
  const s = title
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `${s || 'Example'}.kbook`
}
