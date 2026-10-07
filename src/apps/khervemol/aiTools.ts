// KherveMol's AI tools (specs: src/os/ai/manifests/khervemol.ts) — the
// desktop's MCP tools (mcp_tools.py) driving this window: every call goes
// through the same methods the menus and buttons use, so the user sees each
// step, and the status bar says "Claude: <tool>" as the desktop does.

import { fs, path as vpath } from '@/os'
import { drivePath } from '@/os/ai/tools'
import type { AppTools } from '@/os/ai/appTools'
import { STANDARD_VIEWS, type MolApp } from './app'
import { bondBetween } from './model'
import { STYLES, type Style } from './scene'
import { descriptorsFromStructure, rdkitAvailable } from './rdkit'
import { molToDict } from './types'

const MESH = ['stl', '3mf', 'obj', 'ply', 'glb']
const CHEM = ['xyz', 'mol', 'sdf', 'pdb', 'cif']

function need<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null || v === '') throw new Error(`${what} is required.`)
  return v
}

async function ready(app: MolApp) {
  const until = Date.now() + 60_000
  while (!app.get().catalog && Date.now() < until) await new Promise((r) => setTimeout(r, 100))
}

function summary(app: MolApp) {
  const m = app.get().mol
  return { name: m.label, formula: m.formula, atoms: m.atoms.length, bonds: m.bonds.length, crystal: m.crystal, editable: !m.crystal }
}

export function khervemolAiTools(app: MolApp): AppTools {
  const note = (name: string) => app.status(`Claude: ${name}`)
  const editable = () => {
    if (app.get().mol.crystal) throw new Error('The structure on screen is a fixed lattice or scene: atoms can only be edited on a molecule.')
  }
  const atom = (i: unknown) => {
    const n = Number(i)
    if (!Number.isInteger(n) || n < 0 || n >= app.get().mol.atoms.length) throw new Error(`There is no atom ${String(i)} (the molecule has ${app.get().mol.atoms.length} atoms, from 0).`)
    return n
  }
  return {
    get_structure: async (a) => {
      await ready(app)
      const s = app.get()
      const m = s.mol
      const max = Math.max(0, Math.min(5000, Number(a.max_atoms ?? 200)))
      return {
        ...summary(app),
        kind: m.name,
        shown: s.central === 'welcome' ? 'start screen' : s.tab === 0 ? '3D View' : '2D Sketch',
        selection: s.selection,
        atoms_list: m.atoms.slice(0, max).map((x, i) => [i, x[0], +x[1].toFixed(3), +x[2].toFixed(3), +x[3].toFixed(3)]),
        bonds_list: m.bonds.slice(0, max * 2),
        truncated: m.atoms.length > max,
        cells: m.can_stack ? m.cells : undefined,
        surface_molecules: m.groups.map((g) => g.name),
        sketch: { atoms: s.sketch.atoms.length, bonds: s.sketch.bonds.length },
      }
    },
    search_library: async (a) => {
      await ready(app)
      const r = await app.bridge.call('search', { text: need(a.text as string, 'text'), kind: a.kind, limit: a.limit })
      if (!r.ok) throw new Error(r.error)
      return r.found
    },
    load_entry: async (a) => {
      await ready(app)
      note('load_entry')
      const kind = need(a.kind as string, 'kind'), value = need(a.value as string, 'value')
      const r = await app.call('load_entry', { kind, value, label: a.label })
      if (!r.ok || !r.mol) throw new Error(r.error ?? 'Could not build it.')
      app.setMolecule(r.mol)
      app.syncSketch(true)
      app.set({ tab: 0 })
      app.status(`Loaded ${String(a.label ?? r.mol.label)}`)
      return summary(app)
    },
    build_molecule: async (a) => {
      await ready(app)
      note('build_molecule')
      if (a.smiles) {
        if (!(await app.buildSmiles(String(a.smiles)))) throw new Error(app.get().viewStatus || `Could not build ${String(a.smiles)}.`)
        return summary(app)
      }
      const name = need(a.name as string, 'smiles or name')
      const r = await app.bridge.call('search', { text: name, limit: 5 })
      const rows = (r.found as { results?: { kind: string; value: string; label: string }[] } | undefined)?.results ?? []
      const hit = rows.find((x) => ['compound', 'model', 'smiles', 'mine'].includes(x.kind))
      if (!hit) throw new Error(`No molecule "${name}" in the library: give its SMILES instead.`)
      const b = await app.call('load_entry', { kind: hit.kind, value: hit.value, label: hit.label })
      if (!b.ok || !b.mol) throw new Error(b.error ?? 'Could not build it.')
      app.setMolecule(b.mol)
      app.syncSketch(true)
      app.set({ tab: 0 })
      app.status(`Loaded ${hit.label}`)
      return summary(app)
    },
    build_reaction: async (a) => {
      await ready(app)
      note('build_reaction')
      const eq = need(a.equation as string, 'equation')
      const rep = await app.bridge.call('reaction_report', { text: eq, balance: true })
      if (!rep.ok || rep.valid === false) throw new Error(String(rep.text ?? rep.error ?? 'Cannot read the equation.'))
      const e = await app.bridge.call('reaction_entry', { text: eq, balance: true })
      const value = e.ok ? String(e.equation) : eq
      const r = await app.call('load_entry', { kind: 'reaction', value, label: value })
      if (!r.ok || !r.mol) throw new Error(r.error ?? 'Could not lay it out.')
      app.setMolecule(r.mol)
      app.syncSketch(true)
      app.set({ tab: 0 })
      return { equation: value, report: rep.text, film: r.mol.has_animation }
    },
    play_reaction: async (a) => {
      note('play_reaction')
      if (!app.get().mol.has_animation) throw new Error('The structure on screen is not a reaction with a film (build_reaction first).')
      if (a.stop) app.stopAnimation()
      else app.play()
      return { playing: app.get().playing }
    },
    add_atom: async (a) => {
      note('add_atom')
      editable()
      const el = need(a.element as string, 'element')
      const order = Math.max(1, Math.min(3, Number(a.order ?? 1)))
      if (a.to_atom !== undefined && a.to_atom !== null) app.set({ selection: [atom(a.to_atom)] })
      const before = app.get().mol.atoms.length
      await app.addElement(el, order as 1 | 2 | 3)
      const m = app.get().mol
      if (m.atoms.length === before) throw new Error(app.get().viewStatus || 'The atom was not added.')
      return { added: m.atoms.length - 1, element: el, status: app.get().viewStatus, ...summary(app) }
    },
    delete_atom: async (a) => {
      note('delete_atom')
      editable()
      app.set({ selection: [atom(a.atom)] })
      await app.deleteSelected()
      return summary(app)
    },
    bond_atoms: async (a) => {
      note('bond_atoms')
      editable()
      const i = atom(a.a), j = atom(a.b)
      const order = Number(a.order ?? 1)
      const m = app.get().mol
      const bi = bondBetween(m.bonds, i, j)
      if (order === 0) {
        if (bi === null) throw new Error(`Atoms ${i} and ${j} are not bonded.`)
        await app.deleteBond(bi)
      } else if (bi !== null) {
        if (!app.canSetOrder(bi, order)) throw new Error(`Cannot make that bond order ${order}: one of its atoms has no free valence.`)
        await app.setBondOrder(bi, order)
      } else {
        const before = m.bonds.length
        await app.bondAtoms(i, j, Math.max(1, Math.min(3, order)))
        if (app.get().mol.bonds.length === before) throw new Error(app.get().viewStatus)
      }
      return summary(app)
    },
    set_view: async (a) => {
      note('set_view')
      if (a.view) {
        const v = STANDARD_VIEWS.find(([t]) => t.toLowerCase() === String(a.view).toLowerCase())
        if (!v) throw new Error(`view is one of ${STANDARD_VIEWS.map(([t]) => t.toLowerCase()).join(', ')}.`)
        app.setView(v[1], v[2])
      }
      if (a.style) {
        if (!(STYLES as readonly string[]).includes(String(a.style))) throw new Error(`style is one of ${STYLES.join(', ')}.`)
        app.setStyle(a.style as Style)
      }
      if (typeof a.labels === 'boolean') app.set({ labels: a.labels })
      if (typeof a.spacing === 'number') app.setBondSpread(Math.round(Math.max(app.get().mol.crystal ? 0 : 0.8, Math.min(3, a.spacing)) * 100))
      if (a.tab) app.setTab(a.tab === '2d' ? 1 : 0)
      const s = app.get()
      return { az: s.mol.az, el: s.mol.el, style: s.style, labels: s.labels, spacing: s.mol.bond, tab: s.tab ? '2d' : '3d' }
    },
    properties: async () => {
      await ready(app)
      const m = app.get().mol
      if (!m.atoms.length) throw new Error('Nothing is loaded.')
      const desc = !m.crystal && rdkitAvailable() ? descriptorsFromStructure(m.atoms, m.bonds) : undefined
      const r = await app.call('properties', desc === undefined ? {} : { descriptors: desc ?? {} })
      if (!r.ok) throw new Error(r.error)
      return Object.fromEntries(r.rows as [string, string][])
    },
    keep_molecule: async (a) => {
      note('keep_molecule')
      const mol = app.drawnMolecule()
      if (!mol) throw new Error('Nothing to keep: build or load a molecule first.')
      await app.refreshShelf()
      const r = await app.bridge.call('shelf_add', { mol: molToDict(mol), name: String(a.name ?? app.get().shelfNext) })
      if (!r.ok) throw new Error(r.error)
      await app.refreshShelf(String(r.name))
      app.showShelf()
      return { name: r.name, token: r.token }
    },
    save_document: async (a, ctx) => {
      note('save_document')
      let p = a.path ? drivePath(String(a.path)) : app.get().path
      if (!p) throw new Error('Give a path, e.g. "~/Documents/molecule.kmol".')
      if (!p.toLowerCase().endsWith('.kmol')) p += '.kmol'
      if (fs.exists(p) && p !== app.get().path && !(await ctx.confirm(`Replace ${vpath.basename(p)}?`))) throw new Error('The user kept the existing file.')
      if (!(await app.write(p))) throw new Error('Could not save.')
      app.set({ path: p })
      app.win.setDocumentPath(p)
      app.retitle()
      return { saved: p }
    },
    open_document: async (a) => {
      await ready(app)
      note('open_document')
      const p = drivePath(need(a.path as string, 'path'))
      if (!fs.isFile(p)) throw new Error(`No file ${p}.`)
      await app.openAny(p)
      return summary(app)
    },
    export_file: async (a, ctx) => {
      note('export_file')
      const p = drivePath(need(a.path as string, 'path'))
      const ext = vpath.extname(p).replace('.', '').toLowerCase()
      if (!app.get().mol.atoms.length) throw new Error('Nothing to export.')
      if (fs.exists(p) && !(await ctx.confirm(`Replace ${vpath.basename(p)}?`))) throw new Error('The user kept the existing file.')
      let err: string | null = null
      if (ext === 'png') err = (await app.exportPngTo(p, 0)) ? null : 'Could not render the picture.'
      else if (ext === 'svg') err = await app.exportSvgTo(p, 0)
      else if (CHEM.includes(ext)) err = await app.exportChemTo(p, ext)
      else if (MESH.includes(ext)) err = await app.exportMeshTo(p, ext, { style: app.get().style, scale: Number(a.scale ?? 10), quality: 'medium', cell: !!app.get().mol.edges && app.get().mol.cell_visible, min_stick_mm: 1.6, ascii: false })
      else throw new Error('The extension picks the format: .png .svg .xyz .mol .sdf .pdb .cif .stl .3mf .obj .ply .glb.')
      if (err) throw new Error(err)
      return { exported: p }
    },
  }
}
