// Open / Save Peaks Library (dev-AI Widgets_Toolbars load_peaks_library /
// save_peaks_library): peak models as .json files in a "Peaks Library"
// folder, the same files as the desktop's. The first time, the starter
// templates the desktop ships (public/apps/khervefitting/peaklib/) are copied
// into ~/Documents/KherveFitting/Peaks Library.

import { os } from '@/os'
import { HOME, basename } from '@/os/path'
import type { Doc } from './doc'

export const LIBRARY_DIR = `${HOME}/Documents/KherveFitting/Peaks Library`
const TEMPLATES = `${import.meta.env.BASE_URL}apps/khervefitting/peaklib/`

interface Template {
  group: string
  name: string
  file: string
}

async function ensureTemplates() {
  if (os.fs.isDir(LIBRARY_DIR) && os.fs.list(LIBRARY_DIR).length) return
  try {
    const r = await fetch(`${TEMPLATES}index.json`)
    if (!r.ok) return
    const items = (await r.json()) as Template[]
    for (const t of items) {
      if (typeof t.file !== 'string' || t.file.includes('..')) continue
      const res = await fetch(TEMPLATES + t.file.split('/').map(encodeURIComponent).join('/'))
      if (!res.ok) continue
      const dest = `${LIBRARY_DIR}/${t.file}`
      if (!os.fs.exists(dest)) await os.fs.writeText(dest, await res.text(), { mkdirs: true })
    }
  } catch {
    /* the folder stays as it is */
  }
}

export async function libOpen(doc: Doc, hasData: boolean) {
  if (!hasData) return doc.flash('Select the sheet you want to fit first.', true)
  await ensureTemplates()
  const path = await os.dialog.openFile({ title: 'Open Peaks Library', startDir: LIBRARY_DIR, extensions: ['.json'] })
  if (!path) return
  let mode = 'overwrite'
  if (doc.state.view?.grid.length) {
    const c = await os.dialog.choose('This core level already has peaks.', [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Add after existing peaks', value: 'add' },
      { label: 'Overwrite existing peaks', value: 'overwrite', primary: true },
    ], { title: 'Open Peaks Library' })
    if (!c || c === 'cancel') return
    mode = c
  }
  const json = await os.fs.readText(path)
  const a = await doc.call('lib_load', { json, mode })
  if (a.ok) doc.flash(`Loaded ${basename(path)}`)
}

export async function libSave(doc: Doc, hasData: boolean) {
  if (!hasData || !doc.state.view?.grid.length) return doc.flash('Build and fit the peak model of the current sheet first.', true)
  const k = await doc.call('lib_kinds')
  const kinds = (k.kinds as string[] | undefined) ?? ['peaks', 'single']
  const names = (k.names as Record<string, string> | undefined) ?? {}
  const LABELS: Record<string, string> = { peaks: 'Individual Peaks', single: 'SingleEntity using Peak Model', raw: 'SingleEntity using Raw Data' }
  const kind = await os.dialog.choose('What to save:', [{ label: 'Cancel', value: '' }, ...kinds.map((v, i) => ({ label: LABELS[v] ?? v, value: v, primary: i === 0 }))], { title: 'Save Peaks Library' })
  if (!kind) return
  await ensureTemplates()
  const suggested = names[kind] || `${doc.state.view.sheet}_peaks.json`
  const path = await os.dialog.saveFile({ title: 'Save Peaks Library', defaultName: `${LIBRARY_DIR}/${suggested.endsWith('.json') ? suggested : `${suggested}.json`}`, extensions: ['.json'] })
  if (!path) return
  const a = await doc.call('lib_save', { kind, name: basename(path).replace(/\.json$/i, '') })
  if (!a.ok) return
  await os.fs.writeText(path, String(a.json), { mkdirs: true })
  doc.flash(`Saved ${basename(path)}`)
}
