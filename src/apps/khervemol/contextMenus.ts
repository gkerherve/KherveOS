// The right-click menus of the 3D view and the 2D sketch — the desktop's
// MainWindow._viewer_menu (with _bond_section, _atom_section, _join_section
// and _crystal_section) and _sketch_menu.

import { os } from '@/os'
import type { MenuItem } from '@/os'
import { name as elName, valence } from './elements'
import { canBond, freeValence } from './model'
import { MODES, MODE_LABELS } from './molrepr'
import { STANDARD_VIEWS, type MolApp, type Tool } from './app'
import { pickColour } from './Viewer3D'

const head = (label: string): MenuItem => ({ label, disabled: true })

function bondSection(app: MolApp, bi: number): MenuItem[] {
  const m = app.get().mol
  const current = m.bonds[bi][2]
  const out: MenuItem[] = [head(`Bond  ${app.bondLabel(bi)}`)]
  for (const [order, label] of [[1, 'Single'], [2, 'Double'], [3, 'Triple']] as const) {
    out.push({ label, checked: order === current, disabled: !app.canSetOrder(bi, order), onClick: () => void app.setBondOrder(bi, order) })
  }
  out.push('-', { label: 'Delete bond', onClick: () => void app.deleteBond(bi) })
  return out
}

function joinSection(app: MolApp, atom: number): MenuItem[] {
  const s = app.get()
  const others = s.selection.filter((i) => i !== atom)
  if (!others.length) return []
  const partner = others[others.length - 1]
  const a = s.mol.atoms[partner][0], b = s.mol.atoms[atom][0]
  const sub: MenuItem[] = ([[1, 'Single'], [2, 'Double'], [3, 'Triple']] as const).map(([order, label]) => ({
    label,
    disabled: !canBond(s.mol.atoms, s.mol.bonds, partner, atom, order),
    onClick: () => void app.bondAtoms(partner, atom, order),
  }))
  return [{ label: `Bond ${a}${partner}–${b}${atom}`, submenu: sub }]
}

function atomSection(app: MolApp, atom: number): MenuItem[] {
  const s = app.get()
  const el = s.mol.atoms[atom][0]
  const free = freeValence(s.mol.atoms, s.mol.bonds, atom)
  const out: MenuItem[] = [head(`Atom  ${el} (${elName(el)}) — ${free} free of ${valence(el)}`)]
  for (const [order, label] of [[1, 'Bond on'], [2, 'Double-bond on'], [3, 'Triple-bond on']] as const) {
    const options = app.bondable(atom, order)
    if (!options.length) continue
    const sub: MenuItem[] = options.map((sym) => ({ label: `${sym} — ${elName(sym)}`, onClick: () => void app.bondElement(atom, sym, order) }))
    const active = s.activeElement
    if (!options.includes(active) && valence(active) >= order) sub.push('-', { label: `${active} — ${elName(active)} (table)`, onClick: () => void app.bondElement(atom, active, order) })
    sub.push('-', { label: 'Select an atom on screen…', onClick: () => app.startPick(atom, order) })
    out.push({ label, submenu: sub })
  }
  out.push(...joinSection(app, atom))
  out.push({ label: 'Delete atom', onClick: () => void app.deleteSelected() })
  return out
}

function crystalSection(app: MolApp, kind: string | null, index: number): MenuItem[] {
  const m = app.get().mol
  const out: MenuItem[] = []
  if (m.can_stack) out.push({ label: 'Stack unit cells…', onClick: () => void app.stackCells() })
  if (kind === 'atom' && index >= 0 && index < m.atoms.length) {
    app.selectAtom(index)
    const atom = m.atoms[index]
    out.push('-', head(`${atom[0]} (${elName(atom[0])})`), { label: 'Atom colour…', onClick: () => pickColour(app) })
    if (m.stacked) {
      const cell = app.cellOf(index)
      out.push({
        label: `Tilt cell (${cell.replace(/,/g, ', ')})`,
        submenu: (
          [
            ['15° about x', [15, 0, 0]],
            ['15° about y', [0, 15, 0]],
            ['15° about z', [0, 0, 15]],
            ['Straighten', [0, 0, 0]],
          ] as const
        ).map(([label, angles]) => ({ label, onClick: () => void app.setTilt(cell, [...angles] as [number, number, number]) })),
      })
    }
  }
  out.push(
    '-',
    { label: 'Coordination polyhedra', checked: m.poly, disabled: !app.polyEnabled(), onClick: () => void app.setPoly(!m.poly) },
    { label: 'Colour legend', checked: app.get().legend, onClick: () => app.setLegend(!app.get().legend) },
    { label: 'Reset colours', onClick: () => void app.resetColors() },
  )
  if (Object.keys(m.tilts).length) out.push({ label: 'Reset cell tilts', onClick: () => void app.resetTilts() })
  return out
}

export function viewerMenu(app: MolApp, x: number, y: number) {
  const s = app.get()
  const [kind, index] = s.hit
  const editable = app.editable
  const items: MenuItem[] = []
  if (editable && kind === 'bond') items.push(...bondSection(app, index), '-')
  else if (editable && kind === 'atom') items.push(...atomSection(app, index), '-')
  items.push({ label: 'View from', submenu: STANDARD_VIEWS.map(([title, az, el]) => ({ label: title, onClick: () => app.setView(az, el) })) })
  items.push({ label: 'Reset zoom', onClick: () => app.resetZoom() }, { label: 'Toggle labels', onClick: () => app.set({ labels: !app.get().labels }) })
  if (!editable) items.push(...crystalSection(app, kind, index))
  if (editable) {
    items.push({ label: 'Lock bond lengths', checked: s.lock, onClick: () => app.set({ lock: !app.get().lock }) })
    if (kind === null) {
      const el = s.activeElement
      items.push({ label: `Add ${el} (${elName(el)}) atom`, onClick: () => app.addActive() })
      if (s.selection.length >= 2 && app.selected !== null) items.push(...joinSection(app, app.selected))
      if (app.selected !== null) items.push({ label: 'Delete selected atom', onClick: () => void app.deleteSelected() })
    }
  }
  items.push('-', { label: 'Properties…', onClick: () => void app.showProperties() })
  if (s.rdkit) items.push({ label: 'Copy SMILES', onClick: () => void app.copySmiles() })
  items.push(
    { label: 'Flatten to 2D sketch', onClick: () => app.flattenTo2d() },
    { label: 'Export PNG…', onClick: () => void app.exportPng() },
    { label: 'Export SVG (KhervePaint)…', onClick: () => void app.exportSvg() },
  )
  os.contextMenu({ clientX: x, clientY: y }, tidy(items))
}

export function sketchMenu(app: MolApp, x: number, y: number) {
  const s = app.get()
  const tools: [Tool, string][] = [['draw', 'Draw'], ['move', 'Move'], ['atom', 'Atom'], ['erase', 'Erase']]
  const items: MenuItem[] = [
    { label: 'Build 3D from this sketch', onClick: () => void app.build3dFromSketch() },
    { label: 'Refresh 2D from 3D model', onClick: () => app.syncSketch(false) },
    '-',
    { label: 'Tool', submenu: tools.map(([key, label]) => ({ label, checked: s.tool === key, onClick: () => app.set({ tool: key }) })) },
    { label: 'Show as', submenu: MODES.map((k) => ({ label: MODE_LABELS[k], checked: s.mode === k, onClick: () => app.setMode(k) })) },
    { label: 'Toggle all labels', onClick: () => app.set({ showLabels2d: !app.get().showLabels2d }) },
    { label: 'Clear sketch', onClick: () => app.clearSketch() },
    '-',
    { label: 'Export PNG…', onClick: () => void app.exportPng() },
    { label: 'Export SVG (KhervePaint)…', onClick: () => void app.exportSvg() },
  ]
  os.contextMenu({ clientX: x, clientY: y }, items)
}

/** No separator first, last or twice in a row (Qt hides those too). */
export function tidy(items: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = []
  for (const it of items) {
    if (it === '-' && (!out.length || out[out.length - 1] === '-')) continue
    out.push(it)
  }
  while (out.length && out[out.length - 1] === '-') out.pop()
  return out
}
