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

// ------------------- File › Open Examples (examples_periodic_table.py)

export const EXAMPLE_SYMBOLS = 'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr'.split(' ')

/** Tile positions (row, column) of examples_periodic_table._build_positions. */
export function examplePositions(): Record<string, [number, number]> {
  const p: Record<string, [number, number]> = { H: [0, 0], He: [0, 17], Li: [1, 0], Be: [1, 1], Na: [2, 0], Mg: [2, 1], K: [3, 0], Ca: [3, 1], Rb: [4, 0], Sr: [4, 1], Cs: [5, 0], Ba: [5, 1], La: [5, 2], Fr: [6, 0], Ra: [6, 1], Ac: [6, 2] }
  const run = (row: number, col: number, list: string) => list.split(' ').forEach((s, i) => (p[s] = [row, col + i]))
  run(1, 12, 'B C N O F Ne')
  run(2, 12, 'Al Si P S Cl Ar')
  run(3, 2, 'Sc Ti V Cr Mn Fe Co Ni Cu Zn')
  run(3, 12, 'Ga Ge As Se Br Kr')
  run(4, 2, 'Y Zr Nb Mo Tc Ru Rh Pd Ag Cd')
  run(4, 12, 'In Sn Sb Te I Xe')
  run(5, 3, 'Hf Ta W Re Os Ir Pt Au Hg')
  run(5, 12, 'Tl Pb Bi Po At Rn')
  run(6, 3, 'Rf Db Sg Bh Hs Mt Ds Rg Cn')
  run(6, 12, 'Nh Fl Mc Lv Ts Og')
  run(8, 2, 'La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu')
  run(9, 2, 'Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr')
  return p
}

const CATEGORY_FOLDERS: Record<string, string> = {
  'zz Metals': 'Metals',
  'zz Other Techniques': 'Other Techniques',
  'zz Mixed Materials': 'Mixed Materials',
  'zz RawData_ToBeImported': 'Raw Data',
}

/** Example files by element ("26 - Fe - Iron" folders) and by category folder (ExamplesPeriodicTableDialog.refresh_files). */
export function indexExamples(files: string[]) {
  const byElement: Record<string, { name: string; file: string }[]> = {}
  const byCategory: Record<string, { name: string; file: string }[]> = {}
  for (const file of [...new Set(files)].filter((f) => /\.xlsx$/i.test(f)).sort()) {
    const parts = file.split('/')
    const name = parts[parts.length - 1].replace(/\.xlsx$/i, '')
    for (const folder of parts.slice(0, -1)) {
      const m = /^(\d+)\s*[-_]\s*([A-Za-z]+)/.exec(folder)
      const sym = m ? EXAMPLE_SYMBOLS[Number(m[1]) - 1] : undefined
      if (sym) {
        ;(byElement[sym] ??= []).push({ name, file })
        break
      }
    }
    const cat = CATEGORY_FOLDERS[parts[0]]
    if (cat) (byCategory[cat] ??= []).push({ name, file })
  }
  return { byElement, byCategory }
}

