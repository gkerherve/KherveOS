// The Examples menu: the desktop KherveSlide's example presentations
// (kherveslide/examples.py), built into public/examples/kherveslide/ (tests/export_examples.py) with
// their charts and screenshots in media/, listed by index.json:
//
//   {"items": [{"title", "description", "file"}]}
//
// An example opens as a new, untitled presentation (as on the desktop); its
// pictures stay in memory until it is saved, then go next to the file.

import { fromJson, type Deck } from './model'
import { usedPictures } from './media'

export interface ExampleItem {
  title: string
  description: string
  file: string
}

const BASE = `${import.meta.env.BASE_URL}examples/kherveslide/`

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** Only plain relative paths inside the examples folder. */
const safe = (f: unknown, ext: RegExp): f is string => typeof f === 'string' && ext.test(f) && !f.includes('..') && !f.startsWith('/') && !/^[a-z]+:/i.test(f)

let indexPromise: Promise<ExampleItem[]> | null = null

export function loadExamples(): Promise<ExampleItem[]> {
  indexPromise ??= fetch(`${BASE}index.json`, { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<unknown>
    })
    .then((raw) => {
      if (!isObj(raw) || !Array.isArray(raw.items)) throw new Error('index.json has no items')
      return raw.items
        .filter(isObj)
        .filter((x) => safe(x.file, /\.kslide$/i))
        .map((x) => ({
          title: typeof x.title === 'string' && x.title ? x.title : String(x.file),
          description: typeof x.description === 'string' ? x.description : '',
          file: x.file as string,
        }))
    })
    .catch((e: unknown) => {
      indexPromise = null
      throw e
    })
  return indexPromise
}

const url = (file: string) => BASE + file.split('/').map(encodeURIComponent).join('/')

/** An example presentation and its pictures (stored path → bytes). */
export async function fetchExample(item: ExampleItem): Promise<{ deck: Deck; assets: Map<string, Uint8Array> }> {
  const r = await fetch(url(item.file))
  if (!r.ok) throw new Error(`The example could not be downloaded (HTTP ${r.status}).`)
  const deck = fromJson(await r.text())
  const assets = new Map<string, Uint8Array>()
  await Promise.all(
    usedPictures(deck)
      .filter((p) => safe(p, /\.(png|jpe?g|gif|webp|svg|pdf)$/i))
      .map(async (p) => {
        const m = await fetch(url(p))
        if (m.ok) assets.set(p, new Uint8Array(await m.arrayBuffer()))
      }),
  )
  return { deck, assets }
}

/** Find an example by (part of) its title. */
export function findExample(items: ExampleItem[], title: string): ExampleItem | undefined {
  const t = title.trim().toLowerCase()
  return items.find((x) => x.title.toLowerCase() === t) ?? items.find((x) => x.title.toLowerCase().includes(t))
}
