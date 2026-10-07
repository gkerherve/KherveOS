// The Examples menu: the desktop KherveFitting's Data-Examples (workbook +
// JSON pairs and VAMAS files), copied into public/examples/khervefitting/ and
// listed by index.json:
//
//   {"menus": [{"name": "C", "items": [{"title", "file"}], "groups": [{"name", "items"}]}…]}
//
// Only parsing here (no fetch), so Node tests can load it.

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

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** Only plain relative paths inside the examples folder, to a workbook or VAMAS file. */
export const safeFile = (f: unknown): f is string =>
  typeof f === 'string' && /\.(xlsx|vms)$/i.test(f) && !f.includes('..') && !f.startsWith('/') && !f.includes('\\') && !/^[a-z]+:/i.test(f)

function items(v: unknown): ExampleItem[] {
  return (Array.isArray(v) ? v : [])
    .filter(isObj)
    .filter((x) => safeFile(x.file))
    .map((x) => ({ title: typeof x.title === 'string' && x.title ? x.title : String(x.file), file: x.file as string }))
}

export function parseIndex(raw: unknown): ExampleMenu[] {
  if (!isObj(raw)) throw new Error('index.json is not an object')
  return (Array.isArray(raw.menus) ? raw.menus : []).filter(isObj).map((m) => ({
    name: typeof m.name === 'string' ? m.name : 'Examples',
    items: items(m.items),
    groups: (Array.isArray(m.groups) ? m.groups : []).filter(isObj).map((g) => ({ name: typeof g.name === 'string' ? g.name : '', items: items(g.items) })),
  }))
}

/** The JSON file that travels with a workbook ("C1s.xlsx" → "C1s.json"). */
export const jsonSibling = (path: string) => path.replace(/\.xlsx$/i, '') + '.json'

/** A file name for Save As, from an example's title. */
export function exampleFileName(title: string): string {
  const s = title.replace(/\(VAMAS\)/, '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `${s || 'Example'}.xlsx`
}
