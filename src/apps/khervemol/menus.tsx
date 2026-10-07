// The menu bar and the two toolbars of the desktop's main window
// (MainWindow._build_menus and maintools.build): every menu item, its
// shortcut and icon, and the icon-only toolbars whose library buttons open
// the same menus.

import type { ReactNode } from 'react'
import { os } from '@/os'
import type { MenuBarMenu, MenuItem } from '@/os'
import {
  mdiArrowDecision, mdiAtom, mdiBookmarkMultipleOutline, mdiBookmarkPlusOutline, mdiCloseCircleOutline, mdiContentSave, mdiCubeOutline, mdiCursorMove,
  mdiDeleteOutline, mdiEqual, mdiEraser, mdiFileExportOutline, mdiFileOutline, mdiFlaskOutline, mdiFolderOpen, mdiFormatText, mdiHelpCircleOutline,
  mdiHexagonMultiple, mdiHomeOutline, mdiImage, mdiInformationOutline, mdiLanConnect, mdiLayersOutline, mdiLink, mdiLinkVariant, mdiLockOutline,
  mdiMagnify, mdiMenu, mdiMinus, mdiMolecule, mdiPencil, mdiPeriodicTable, mdiPlay, mdiPlusCircleOutline, mdiPrinter3d, mdiRobotOutline, mdiRotate3d,
  mdiStop, mdiTagTextOutline, mdiVectorSquare,
} from '@mdi/js'
import { Mdi } from './icons'
import { sectionKey, type Catalog, type EntryGroup } from './catalog'
import { MODES, MODE_LABELS } from './molrepr'
import { STYLES, STYLE_LABELS } from './scene'
import { sc, type MolApp, type State, type Tool } from './app'
import { ElementCombo } from './Editor2D'
import { PALETTE } from './elements'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

const icon = (path: string) => <Mdi path={path} size={14} />

function groups(app: MolApp, gs: EntryGroup[]): MenuItem[] {
  return gs.map((g) => ({
    label: g.title,
    submenu: g.rows.map((r) => ({ label: r.label, onClick: () => void app.loadEntry(r.kind, r.value, r.label) })),
  }))
}

export interface Menus {
  bar: MenuBarMenu[]
  molecules: MenuItem[]
  crystals: MenuItem[]
  surfaces: MenuItem[]
  carbon: MenuItem[]
  polymers: MenuItem[]
  reactions: MenuItem[]
}

/** MainWindow._build_menus (with mcp_dialog.install's AI item and the Updater's Help items). */
export function buildMenus(app: MolApp, s: State, catalog: Catalog | null): Menus {
  const sec: Record<string, EntryGroup[]> = {}
  for (const x of catalog?.sections ?? []) sec[sectionKey(x.title)] = x.groups
  const m = s.mol
  const classic = (crystal: boolean): MenuItem[] =>
    (catalog?.classic ?? [])
      .filter((c) => (c.title === 'Crystal structures' || c.title === 'Lattice systems') === crystal)
      .map((c) => ({ label: c.title, submenu: c.keys.map((k) => ({ label: k.label, onClick: () => app.loadModel(k.key, k.label) })) }))

  const recent = s.recent
  const file: MenuItem[] = [
    { label: 'New', shortcut: sc('Ctrl+N'), image: icon(mdiFileOutline), onClick: () => void app.newDocument() },
    { label: 'Open…', shortcut: sc('Ctrl+O'), image: icon(mdiFolderOpen), onClick: () => void app.openDialog() },
    {
      label: 'Open Recent',
      submenu: recent.length
        ? [...recent.map((p) => ({ label: p.split('/').pop() ?? p, onClick: () => void app.openPath(p) })), '-' as const, { label: 'Clear Recent Files', onClick: () => app.clearRecent() }]
        : [{ label: '(No recent files)', disabled: true }],
    },
    { label: 'Start Screen', image: icon(mdiHomeOutline), onClick: () => app.showWelcome() },
    '-',
    { label: 'Save', shortcut: sc('Ctrl+S'), image: icon(mdiContentSave), onClick: () => void app.save() },
    { label: 'Save As…', shortcut: sc('Ctrl+Shift+S'), onClick: () => void app.saveAs() },
    '-',
    { label: 'Export PNG…', shortcut: sc('Ctrl+E'), image: icon(mdiImage), onClick: () => void app.exportPng() },
    { label: 'Export SVG (KhervePaint)…', shortcut: sc('Ctrl+Shift+E'), image: icon(mdiVectorSquare), onClick: () => void app.exportSvg() },
    { label: 'Export 3D model (STL, 3MF, OBJ, PLY, GLB)…', shortcut: sc('Ctrl+Shift+3'), image: icon(mdiPrinter3d), onClick: () => void app.exportMeshDialog() },
    { label: 'Export chemistry file (XYZ, MOL, SDF, PDB, CIF)…', shortcut: sc('Ctrl+Shift+X'), image: icon(mdiFileExportOutline), onClick: () => void app.exportChemistry() },
    '-',
    { label: 'Exit', shortcut: sc('Ctrl+Q'), onClick: () => app.win.close() },
  ]

  const molecules: MenuItem[] = [
    { label: 'Explorer…', shortcut: sc('Ctrl+L'), image: icon(mdiMagnify), onClick: () => void app.openExplorer() },
    { label: 'From SMILES…', shortcut: sc('Ctrl+Shift+M'), image: icon(mdiMolecule), onClick: () => void app.fromSmiles() },
    { label: 'Import structure file (MOL/SDF/PDB/CIF)…', onClick: () => void app.importFile() },
    { label: 'Copy SMILES of structure' + (s.rdkit ? '' : '  (needs RDKit)'), onClick: () => void app.copySmiles() },
    '-',
    { label: 'Properties…', shortcut: sc('Ctrl+I'), image: icon(mdiInformationOutline), onClick: () => void app.showProperties() },
    '-',
    ...groups(app, sec.Molecules ?? []),
    '-',
    { label: 'Classic 3D models', submenu: classic(false) },
  ]

  const surfaces: MenuItem[] = [{ label: 'Surface builder…', onClick: () => void app.openSurfaceBuilder() }, '-', ...groups(app, sec.Surfaces ?? [])]
  const carbon: MenuItem[] = [{ label: 'Graphene, nanotubes & fullerenes builder…', onClick: () => app.openNanoBuilder() }, '-', ...groups(app, sec['Graphene, nanotubes & fullerenes'] ?? [])]
  const cellOn = !!m.edges
  const crystals: MenuItem[] = [
    { label: 'Crystal builder…', shortcut: sc('Ctrl+Shift+C'), image: icon(mdiCubeOutline), onClick: () => app.openCrystalBuilder() },
    { label: 'Surface builder…', shortcut: sc('Ctrl+Shift+F'), image: icon(mdiLayersOutline), onClick: () => void app.openSurfaceBuilder() },
    { label: 'Graphene, nanotubes & fullerenes…', shortcut: sc('Ctrl+Shift+G'), image: icon(mdiHexagonMultiple), onClick: () => app.openNanoBuilder() },
    { label: 'Add molecule to surface…', shortcut: sc('Ctrl+Shift+A'), image: icon(mdiPlusCircleOutline), onClick: () => void app.addMoleculeToSurface() },
    '-',
    ...groups(app, sec.Crystals ?? []),
    { label: 'Surfaces', submenu: surfaces },
    { label: 'Graphene, nanotubes & fullerenes', submenu: carbon },
    { label: 'Classic crystal models', submenu: classic(true) },
    '-',
    { label: 'Stack unit cells…', shortcut: sc('Ctrl+U'), onClick: () => void app.stackCells() },
    { label: 'Coordination polyhedra', checked: m.poly, disabled: !app.polyEnabled(), onClick: () => void app.setPoly(!m.poly) },
    { label: 'Colour legend', checked: s.legend, onClick: () => app.setLegend(!s.legend) },
    { label: 'Unit cell outline', checked: cellOn && m.cell_visible, disabled: !cellOn, onClick: () => void app.setCellVisible(!m.cell_visible) },
    { label: 'Reset cell tilts', onClick: () => void app.resetTilts() },
    { label: 'Reset colours', onClick: () => void app.resetColors() },
  ]

  const polymers: MenuItem[] = [
    { label: 'Polymer builder…', shortcut: sc('Ctrl+Shift+P'), image: icon(mdiLinkVariant), onClick: () => app.openPolymerBuilder() },
    '-',
    ...groups(app, sec.Polymers ?? []),
  ]
  const reactions: MenuItem[] = [
    { label: 'Reaction builder…', shortcut: sc('Ctrl+R'), image: icon(mdiFlaskOutline), onClick: () => void app.openReactionBuilder() },
    '-',
    ...groups(app, sec.Reactions ?? []),
  ]

  const structure: MenuItem[] = [
    { label: 'Flatten 3D → 2D sketch', onClick: () => app.flattenTo2d() },
    { label: 'Build 3D from 2D sketch', shortcut: sc('Ctrl+B'), onClick: () => void app.build3dFromSketch() },
    { label: 'Clear 2D sketch', onClick: () => app.clearSketch() },
    '-',
    { label: '2D representation', submenu: MODES.map((k) => ({ label: MODE_LABELS[k], checked: s.mode === k, onClick: () => app.setMode(k) })) },
  ]

  const view: MenuItem[] = [
    // KherveOS has a single theme (Kherve Green): the desktop's theme list does not apply here
    { label: 'Theme', submenu: [{ label: 'Kherve Green (the KherveOS theme)', checked: true, disabled: true }] },
    {
      label: '3D renderer',
      submenu: [
        { label: 'OpenGL (shaded spheres, smooth edges)', checked: s.renderer === 'gl', disabled: !s.glOk, onClick: () => app.setRenderer('gl') },
        { label: 'Classic (vector drawing)', checked: s.renderer === 'classic', onClick: () => app.setRenderer('classic') },
      ],
    },
    { label: '3D style', submenu: STYLES.map((k) => ({ label: STYLE_LABELS[k], checked: s.style === k, onClick: () => app.setStyle(k) })) },
    { label: 'Unit cell outline', checked: cellOn && m.cell_visible, disabled: !cellOn, onClick: () => void app.setCellVisible(!m.cell_visible) },
    '-',
    { label: 'Show 3D View', onClick: () => app.setTab(0) },
    { label: 'Show 2D Sketch', onClick: () => app.setTab(1) },
    '-',
    { label: 'Structure', checked: s.docks.structure, onClick: () => app.toggleDock('structure') },
    { label: 'Library', checked: s.docks.library, onClick: () => app.toggleDock('library') },
    { label: 'My molecules', checked: s.docks.shelf, onClick: () => app.toggleDock('shelf') },
    { label: 'Periodic table…', shortcut: sc('Ctrl+T'), image: icon(mdiPeriodicTable), onClick: () => app.showPeriodicTable() },
  ]

  const ai: MenuItem[] = [
    { label: 'Connect to Claude (MCP)…', image: icon(mdiLanConnect), onClick: () => void connectClaude() },
    '-',
    { label: 'AI Chat (needs an API key)', shortcut: sc('Ctrl+/'), checked: s.docks.ai, onClick: () => app.toggleDock('ai') },
  ]

  const help: MenuItem[] = [
    { label: 'User Guide', shortcut: 'F1', onClick: () => void app.ask('guide') },
    '-',
    { label: 'Check for Updates…', onClick: () => void checkUpdates(s.version) },
    { label: 'Update Automatically', checked: true, disabled: true },
    '-',
    { label: 'About KherveMol', onClick: () => void app.ask('about') },
  ]

  return {
    bar: [
      { label: 'File', items: file },
      { label: 'Molecule', items: molecules },
      { label: 'Crystal', items: crystals },
      { label: 'Polymer', items: polymers },
      { label: 'Reaction', items: reactions },
      { label: 'Structure', items: structure },
      { label: 'View', items: view },
      { label: 'AI', items: ai },
      { label: 'Help', items: help },
    ],
    molecules, crystals, surfaces, carbon, polymers, reactions,
  }
}

async function connectClaude() {
  // As the desktop's AI ▸ Connect to Claude (MCP)…: Claude Desktop / Claude Code drive this
  // window — here through the KherveOS MCP server, with the khervemol_ tools.
  const go = await os.dialog.choose(
    'Claude can build and edit in KherveMol with its tools (search the library, build molecules, crystals, surfaces, nanostructures, ' +
      'polymers and reactions, edit atoms and bonds, export): in KherveAI, or from Claude Code / Claude Desktop through the KherveOS MCP server.',
    [
      { label: 'Cancel', value: 'cancel' },
      { label: 'MCP settings…', value: 'mcp' },
      { label: 'Open KherveAI', value: 'ai', primary: true },
    ],
    { title: 'Connect to Claude (MCP)' },
  )
  if (go === 'ai') os.open('kherveai')
  else if (go === 'mcp') os.open('settings', { section: 'ai' })
}

async function checkUpdates(version: string) {
  await os.dialog.alert(
    `KherveMol in KherveOS runs the engine of the desktop KherveMol v${version} and is updated with KherveOS itself — there is nothing to download here.`,
    { title: 'Check for Updates' },
  )
}

// ================================================================ toolbars

function TbButton({ path, tip, onClick, disabled, on, children }: { path?: string; tip: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; disabled?: boolean; on?: boolean; children?: ReactNode }) {
  return (
    <button className={`km-tb${on ? ' on' : ''}`} title={tip} disabled={disabled} onClick={onClick}>
      {path ? <Mdi path={path} size={20} /> : children}
    </button>
  )
}

const Sep = () => <span className="km-tbsep" />

/** maintools.build: the "Files and libraries" row and the "Drawing tools" row. */
export function Toolbars({ app, menus }: { app: MolApp; menus: Menus }) {
  const s = useStore(
    app.store,
    useShallow((st) => ({
      crystal: st.mol.crystal, tool: st.tool, element2d: st.element2d, order: st.order, labels: st.labels, lock: st.lock, docks: st.docks,
      film: st.mol.has_animation, playing: st.playing, animP: st.animP, selection: st.selection, bonds: st.mol.bonds,
    })),
  )
  const editable = !s.crystal
  const popup = (items: MenuItem[]) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    os.contextMenu({ clientX: r.left, clientY: r.bottom + 2 }, items, { className: 'km-scroll-menu' })
  }
  const tools: [Tool, string, string][] = [
    ['draw', mdiPencil, 'Draw bonds: drag atom→atom, or atom→empty for a new atom; click a bond to cycle its order'],
    ['move', mdiCursorMove, 'Drag an atom to move its whole molecule'],
    ['atom', mdiFormatText, 'Click an atom to re-label it with the chosen element'],
    ['erase', mdiEraser, 'Click an atom or bond to remove it'],
  ]
  const element = s.element2d
  const elements = PALETTE.includes(element) ? PALETTE : [...PALETTE, element]
  const hasFilm = !!s.film
  return (
    <div className="km-toolbars">
      <div className="km-toolbar">
        <TbButton path={mdiFileOutline} tip={`New document (${sc('Ctrl+N')})`} onClick={() => void app.newDocument()} />
        <TbButton path={mdiFolderOpen} tip={`Open a .kmol file (${sc('Ctrl+O')})`} onClick={() => void app.openDialog()} />
        <TbButton path={mdiContentSave} tip={`Save (${sc('Ctrl+S')})`} onClick={() => void app.save()} />
        <TbButton path={mdiImage} tip={`Export the current tab as a PNG (${sc('Ctrl+E')})`} onClick={() => void app.exportPng()} />
        <TbButton path={mdiVectorSquare} tip={`Export an SVG that opens in KhervePaint (${sc('Ctrl+Shift+E')})`} onClick={() => void app.exportSvg()} />
        <TbButton path={mdiPrinter3d} tip={`Export a 3D model: STL, 3MF, OBJ, PLY or GLB (${sc('Ctrl+Shift+3')})`} onClick={() => void app.exportMeshDialog()} />
        <TbButton path={mdiFileExportOutline} tip={`Export XYZ, MOL, SDF, PDB or CIF (${sc('Ctrl+Shift+X')})`} onClick={() => void app.exportChemistry()} />
        <Sep />
        <TbButton path={mdiMagnify} tip={`Search every molecule, crystal, surface, polymer and reaction (${sc('Ctrl+L')})`} onClick={() => void app.openExplorer()} />
        <TbButton path={mdiMolecule} tip={`Build a molecule from a SMILES string (${sc('Ctrl+Shift+M')})`} onClick={() => void app.fromSmiles()} />
        <Sep />
        <TbButton path={mdiAtom} tip="Molecules — 700, by family (menu; the Explorer searches them)" onClick={popup(menus.molecules)} />
        <TbButton path={mdiLinkVariant} tip={`Polymers — Polymer builder, then PE, PVC, nylon, PET… (${sc('Ctrl+Shift+P')})`} onClick={popup(menus.polymers)} />
        <TbButton path={mdiCubeOutline} tip={`Crystals — Crystal builder and 120+ crystals (${sc('Ctrl+Shift+C')})`} onClick={popup(menus.crystals)} />
        <TbButton path={mdiLayersOutline} tip={`Surfaces — Surface builder and 60 ready faces (${sc('Ctrl+Shift+F')})`} onClick={popup(menus.surfaces)} />
        <TbButton path={mdiHexagonMultiple} tip={`Carbon — graphene, nanotubes and fullerenes (${sc('Ctrl+Shift+G')})`} onClick={popup(menus.carbon)} />
        <TbButton path={mdiFlaskOutline} tip={`Reactions — Reaction builder and 36 classics (${sc('Ctrl+R')})`} onClick={popup(menus.reactions)} />
        <Sep />
        <Sep />
        <TbButton path={mdiBookmarkPlusOutline} tip="Keep the molecule in the 3D view as Molecule 1, 2, 3… on the shelf, to use in reactions" onClick={() => void app.keepMolecule()} />
        <TbButton path={mdiBookmarkMultipleOutline} tip="Show the shelf of kept molecules" onClick={() => app.showShelf()} />
        <Sep />
        <TbButton path={mdiInformationOutline} tip={`Formula, weight and descriptors (${sc('Ctrl+I')})`} onClick={() => void app.showProperties()} />
        <TbButton path={mdiRobotOutline} tip="AI Chat — ask chemistry questions, draw molecules" on={s.docks.ai} onClick={() => app.toggleDock('ai')} />
        <TbButton path={mdiHelpCircleOutline} tip="User guide (F1)" onClick={() => void app.ask('guide')} />
      </div>
      <div className="km-toolbar">
        <span className="km-tblabel">2D</span>
        {tools.map(([key, path, tip]) => (
          <TbButton key={key} path={path} tip={tip} on={s.tool === key} onClick={() => app.useSketchTool(key)} />
        ))}
        <TbButton path={mdiCloseCircleOutline} tip="Clear the 2D sketch" onClick={() => app.clearSketch()} />
        <Sep />
        <span className="km-tblabel">Element</span>
        <ElementCombo value={element} items={elements} title="The element drawn / added (the periodic table at the bottom picks any element)" onChange={(el) => app.onElementPicked(el)} />
        <TbButton path={mdiPeriodicTable} tip={`Periodic table — pick any of the 118 elements (${sc('Ctrl+T')})`} onClick={() => app.showPeriodicTable()} />
        <Sep />
        <span className="km-tblabel">3D</span>
        <TbButton path={mdiPlusCircleOutline} disabled={!editable} tip="Bond a new atom of the chosen element onto the selected atom (valence-checked)" onClick={() => {
          app.setTab(0)
          app.addActive()
        }} />
        {(
          [
            [1, 'Single', mdiMinus],
            [2, 'Double', mdiEqual],
            [3, 'Triple', mdiMenu],
          ] as const
        ).map(([order, text, path]) => (
          <TbButton key={order} path={path} disabled={!editable} on={s.order === order} tip={`${text} bond for the atoms you add or join`} onClick={() => {
            app.set({ order })
            app.updateStatus()
          }} />
        ))}
        <TbButton path={mdiLink} disabled={!editable || !app.canBondSelected(s.order)} tip="Bond the two selected atoms (Ctrl+click a second atom)" onClick={() => {
          app.setTab(0)
          app.bondSelected(s.order)
        }} />
        <TbButton path={mdiDeleteOutline} disabled={!editable} tip="Delete the selected atom (Delete)" onClick={() => void app.deleteSelected()} />
        <TbButton path={mdiTagTextOutline} on={s.labels} tip="Show element symbols on the atoms" onClick={() => app.set({ labels: !s.labels })} />
        <TbButton path={mdiLockOutline} on={s.lock} tip="Hold bonds at their real length while dragging an atom" onClick={() => app.set({ lock: !s.lock })} />
        <Sep />
        <TbButton path={mdiArrowDecision} tip="Flatten the 3D model into the 2D sketch" onClick={() => app.flattenTo2d()} />
        <TbButton path={mdiRotate3d} tip={`Build a 3D model from the 2D sketch (${sc('Ctrl+B')}, needs RDKit)`} onClick={() => void app.build3dFromSketch()} />
        <Sep />
        <TbButton path={mdiPlay} disabled={!hasFilm} tip={s.playing ? 'Pause' : 'Play the reaction as a film — atoms rearrange'} on={s.playing} onClick={() => app.toggleAnimation()} />
        <TbButton path={mdiStop} disabled={!hasFilm || s.animP === null} tip="Back to the equation with its arrow" onClick={() => app.stopAnimation()} />
      </div>
    </div>
  )
}
