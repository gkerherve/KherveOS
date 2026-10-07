// The library and the lists the desktop builds from its modules at start
// (entries.sections(), library.CATEGORIES, the builders' lists, the User
// Guide, the AI settings), exported to public/apps/khervemol/catalog.json
// by tools/export_khervemol.py so menus and the tree show at once.

export interface EntryRow {
  label: string
  kind: string
  value: string
  smiles?: string
}
export interface EntryGroup {
  title: string
  rows: EntryRow[]
}
export interface Section {
  title: string
  groups: EntryGroup[]
}
export interface Catalog {
  version: string
  sections: Section[]
  classic: { title: string; keys: { key: string; label: string }[] }[]
  crystals: { key: string; name: string; category: string; polyhedra: boolean }[]
  polymers: { key: string; name: string; unit: string; n: number; category: string; head: string; tail: string }[]
  reactions: { name: string; equation: string }[]
  views: [string, number, number][]
  styles: [string, string][]
  reprModes: [string, string][]
  meshFormats: [string, string, string][]
  meshStyles: string[]
  chemFormats: [string, string, string][]
  guide: string
  ai: {
    systemPrompt: string
    providers: string[]
    names: Record<string, string>
    models: Record<string, string[]>
    help: Record<string, string>
    needsKey: string[]
    bases: Record<string, string>
  }
}

let promise: Promise<Catalog> | null = null

export function loadCatalog(): Promise<Catalog> {
  promise ??= fetch(`${import.meta.env.BASE_URL}apps/khervemol/catalog.json`, { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`catalog.json: HTTP ${r.status}`)
      return r.json() as Promise<Catalog>
    })
    .catch((e: unknown) => {
      promise = null
      throw e
    })
  return promise
}

/** The section of a title ("Molecules — 696" → "Molecules"). */
export function sectionKey(title: string): string {
  return title.split(' —')[0]
}

const KIND_COLORS: Record<string, string> = { crystal: '#9aa0a6', surface: '#b08d6e', nano: '#4d5560', reaction: '#159c74' }

/** mainwindow._entry_color: the tree icon colour of a library entry. */
export function entryColor(kind: string, value: string, crystalModels: ReadonlySet<string>, carbon: string): string {
  if (kind === 'model') return crystalModels.has(value) ? '#9aa0a6' : carbon
  return KIND_COLORS[kind] ?? carbon
}

/** builders_ui.insert_species: add *token* to the reactant (0) or product (1) side. */
export function insertSpecies(text: string, token: string, side: 0 | 1): string {
  const ARROWS = [' <=> ', ' <-> ', ' -> ', ' => ', ' = ', ' ⇌ ', ' → ']
  text = text.trimEnd()
  const padded = text + ' '
  const arrow0 = ARROWS.find((a) => padded.includes(a))
  let left: string, right: string, arrow: string
  if (arrow0 === undefined) {
    left = text
    right = ''
    arrow = ' -> '
  } else {
    const i = padded.indexOf(arrow0)
    left = padded.slice(0, i).trim()
    right = padded.slice(i + arrow0.length).trim()
    arrow = arrow0
  }
  const parts = [left, right]
  parts[side] = parts[side].replace(/^[ +]+|[ +]+$/g, '') ? `${parts[side]} + ${token}` : token
  return `${parts[0]}${arrow}${parts[1]}`
}

/** ai_assistant.extract_smiles: a SMILES pulled out of an assistant reply. */
export function extractSmiles(reply: string): string | null {
  const m = /SMILES\s*[:=]\s*`?([^\s`]+)/i.exec(reply)
  if (m) return m[1].trim().replace(/^[.,;]+|[.,;]+$/g, '')
  const f = /```(?:smiles)?\s*([^\n`]+?)\s*```/i.exec(reply)
  if (f) {
    const cand = f[1].trim()
    if (cand && !cand.includes(' ')) return cand
  }
  return null
}
