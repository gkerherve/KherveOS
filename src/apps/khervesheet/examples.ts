// The Examples menu: the desktop KherveSheet's example workbooks, copied
// into public/examples/khervesheet/ and listed by index.json:
//
//   {"menus": [{"name": "Worked Examples", "items": [{"title", "file"}]},
//              {"name": "Python Examples", "groups": [{"name", "items": […]}]}…]}

export interface ExampleItem {
  title: string
  file: string
}
export interface ExampleGroup {
  name: string
  items: ExampleItem[]
}
export interface ExampleMenu {
  name: string
  items: ExampleItem[]
  groups: ExampleGroup[]
}

const BASE = `${import.meta.env.BASE_URL}examples/khervesheet/`

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** Only plain relative paths inside the examples folder. */
const safeFile = (f: unknown): f is string => typeof f === 'string' && /\.ksheet$/i.test(f) && !f.includes('..') && !f.startsWith('/') && !/^[a-z]+:/i.test(f)

function items(v: unknown): ExampleItem[] {
  return (Array.isArray(v) ? v : [])
    .filter(isObj)
    .filter((x) => safeFile(x.file))
    .map((x) => ({ title: typeof x.title === 'string' && x.title ? x.title : String(x.file), file: x.file as string }))
}

function parse(raw: unknown): ExampleMenu[] {
  if (!isObj(raw)) throw new Error('index.json is not an object')
  return (Array.isArray(raw.menus) ? raw.menus : []).filter(isObj).map((m) => ({
    name: typeof m.name === 'string' ? m.name : 'Examples',
    items: items(m.items),
    groups: (Array.isArray(m.groups) ? m.groups : []).filter(isObj).map((g) => ({ name: typeof g.name === 'string' ? g.name : '', items: items(g.items) })),
  }))
}

let indexPromise: Promise<ExampleMenu[]> | null = null

/** The example list (fetched once per page load; a failure is retried next time). */
export function loadExamples(): Promise<ExampleMenu[]> {
  indexPromise ??= fetch(`${BASE}index.json`, { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<unknown>
    })
    .then(parse)
    .catch((e: unknown) => {
      indexPromise = null
      throw e
    })
  return indexPromise
}

/** An example workbook's bytes. */
export async function fetchExample(file: string): Promise<Uint8Array> {
  if (!safeFile(file)) throw new Error(`Not an example workbook: ${file}`)
  const r = await fetch(BASE + file.split('/').map(encodeURIComponent).join('/'))
  if (!r.ok) throw new Error(`The example could not be downloaded (HTTP ${r.status}).`)
  return new Uint8Array(await r.arrayBuffer())
}

/** A file name for Save As, from an example's title. */
export function exampleFileName(title: string): string {
  const s = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `${s || 'Example'}.ksheet`
}
