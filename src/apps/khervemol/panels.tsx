// The docks of the desktop's main window: Structure (structure_tree.py), the
// Library tree (MainWindow._build_dock), My molecules (shelf_panel.py), and
// the Periodic table window (periodic.py).

import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { mdiArrowDown, mdiArrowUp, mdiBookmarkPlusOutline, mdiDeleteOutline, mdiFlaskOutline, mdiFolderUploadOutline, mdiRenameBox } from '@mdi/js'
import { bondLength, color as cpk, name as elName, number, textColor, valence, weight, TABLE } from './elements'
import { ElementChip, Mdi } from './icons'
import { angle, bondBetween, canReattach, distance, freeValence } from './model'
import { buildTree, type TreeNode } from './structure'
import { entryColor, type EntryRow } from './catalog'
import type { MolApp } from './app'
import type { Mol } from './types'
import { DND_MIME } from './Viewer3D'

const ORDER_DASH: Record<number, string> = { 1: '–', 2: '=', 3: '≡' }
const ORDER_NAME: Record<number, string> = { 1: 'single', 2: 'double', 3: 'triple' }
const ATOM_MIME = 'application/x-khervemol-atom'

// ================================================================ Structure

interface Visible {
  node: TreeNode
  depth: number
  key: string
  hasKids: boolean
  open: boolean
}

interface RowProps {
  v: Visible
  alt: boolean
  sel: boolean
  drop: boolean
  draggable: boolean
  atoms: Mol['atoms']
  bonds: Mol['bonds']
  onSelect: (atom: number) => void
  onToggle: (key: string) => void
  onDragStart: (atom: number, e: DragEvent) => void
  onDragOver: (atom: number, e: DragEvent) => void
  onDrop: (atom: number, e: DragEvent) => void
  onDragEnd: () => void
}

function tipOf(atoms: Mol['atoms'], bonds: Mol['bonds'], n: TreeNode): string {
  const [el, x, y, z] = atoms[n.atom]
  const lines = [
    `${elName(el)} (${el}), atom ${n.atom}`,
    `Z = ${number(el)}, ${weight(el).toFixed(3)} g/mol`,
    `Valence ${valence(el)} — ${freeValence(atoms, bonds, n.atom)} free`,
    `x ${x.toFixed(3)}, y ${y.toFixed(3)}, z ${z.toFixed(3)} Å`,
  ]
  if (n.parent !== null) {
    const pel = atoms[n.parent][0]
    lines.push(`${ORDER_NAME[n.order]} bond ${pel}${ORDER_DASH[n.order]}${el}: ${distance(atoms, n.parent, n.atom).toFixed(3)} Å (ideal ${bondLength(pel, el, n.order).toFixed(2)} Å)`)
  }
  return lines.join('\n')
}

const TRow = memo(function TRow({ v, alt, sel, drop, draggable, atoms, bonds, onSelect, onToggle, onDragStart, onDragOver, onDrop, onDragEnd }: RowProps) {
  const n = v.node
  const el = atoms[n.atom][0]
  const label = n.ring ? `↻ closes ring to ${el}${n.atom}` : `${el}${n.atom}  ${elName(el)}`
  return (
    <div
      data-atom={n.ring ? undefined : n.atom}
      className={`km-trow${alt ? ' alt' : ''}${sel ? ' sel' : ''}${n.ring ? ' ring' : ''}${drop ? ' drop' : ''}`}
      title={n.ring ? undefined : tipOf(atoms, bonds, n)}
      draggable={draggable}
      onClick={() => !n.ring && onSelect(n.atom)}
      onDragStart={(e) => onDragStart(n.atom, e)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => !n.ring && onDragOver(n.atom, e)}
      onDrop={(e) => !n.ring && onDrop(n.atom, e)}
    >
      <span className="km-tcell km-tatom" style={{ paddingLeft: 4 + v.depth * 14 }}>
        <span
          className={`km-twisty${v.hasKids ? '' : ' leaf'}`}
          onClick={(e) => {
            e.stopPropagation()
            if (v.hasKids) onToggle(v.key)
          }}
        >
          {v.hasKids ? (v.open ? '▾' : '▸') : ''}
        </span>
        <ElementChip color={cpk(el)} size={14} />
        <span className="km-ttext">{label}</span>
      </span>
      <span className="km-tcell num">{n.parent !== null ? ORDER_DASH[n.order] : ''}</span>
      <span className="km-tcell num">{n.parent !== null ? `${distance(atoms, n.parent, n.atom).toFixed(2)} Å` : ''}</span>
      <span className="km-tcell num">{n.parent !== null && n.grand !== null ? `${angle(atoms, n.grand, n.parent, n.atom).toFixed(1)}°` : ''}</span>
    </div>
  )
})

export function StructureTree({ app }: { app: MolApp }) {
  const m = useStore(
    app.store,
    useShallow((s) => ({ atoms: s.mol.atoms, bonds: s.mol.bonds, label: s.mol.label, name: s.mol.name, formula: s.mol.formula, crystal: s.mol.crystal })),
  )
  const selection = useStore(app.store, (s) => s.selection)
  const selected = selection.length ? selection[selection.length - 1] : null
  const { roots, parentOf } = useMemo(() => buildTree(m.atoms, m.bonds), [m.atoms, m.bonds])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [dropOn, setDropOn] = useState<number | null>(null)
  const dragSrc = useRef<number | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const latest = useRef({ m, parentOf })
  latest.current = { m, parentOf }

  useEffect(() => setCollapsed(new Set()), [m.atoms.length, m.label])

  useEffect(() => {
    if (selected === null) return
    bodyRef.current?.querySelector(`[data-atom="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const rootOpen = !collapsed.has('root')
  const visible = useMemo(() => {
    const out: Visible[] = []
    const walk = (nodes: TreeNode[], depth: number, path: string) => {
      for (const node of nodes) {
        const key = `${path}/${node.ring ? 'r' : ''}${node.atom}`
        const hasKids = node.children.length > 0
        const open = !collapsed.has(key)
        out.push({ node, depth, key, hasKids, open })
        if (hasKids && open) walk(node.children, depth + 1, key)
      }
    }
    if (rootOpen) walk(roots, 1, 'root')
    return out
  }, [roots, collapsed, rootOpen])

  const canDrop = useCallback((source: number, target: number | null) => {
    const { m: cur, parentOf: po } = latest.current
    if (cur.crystal || target === null || source === target) return false
    const parent = po.get(source) ?? null
    const old = parent === null ? null : bondBetween(cur.bonds, source, parent)
    return canReattach(cur.atoms, cur.bonds, source, old, target)
  }, [])
  const onSelect = useCallback((atom: number) => app.selectAtom(atom), [app])
  const onToggle = useCallback((key: string) => {
    setCollapsed((c) => {
      const next = new Set(c)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  const onDragStart = useCallback((atom: number, e: DragEvent) => {
    dragSrc.current = atom
    e.dataTransfer.setData(ATOM_MIME, String(atom))
    e.dataTransfer.effectAllowed = 'copy'
  }, [])
  const onDragEnd = useCallback(() => {
    dragSrc.current = null
    setDropOn(null)
  }, [])
  const onDragOver = useCallback(
    (atom: number, e: DragEvent) => {
      const src = dragSrc.current
      if (src === null || !canDrop(src, atom)) {
        setDropOn(null)
        return
      }
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setDropOn(atom)
    },
    [canDrop],
  )
  const onDrop = useCallback(
    (atom: number, e: DragEvent) => {
      const src = dragSrc.current
      setDropOn(null)
      if (src === null || !canDrop(src, atom)) return
      e.preventDefault()
      void app.onReattach(src, latest.current.parentOf.get(src) ?? null, atom)
    },
    [app, canDrop],
  )

  if (!m.atoms.length) return <div className="km-tree km-structure" />
  return (
    <div className="km-tree km-structure">
      <div className="km-thead">
        <span className="km-tcell km-tatom">Atom</span>
        <span className="km-tcell num">Bond</span>
        <span className="km-tcell num">Length</span>
        <span className="km-tcell num">Angle</span>
      </div>
      <div className="km-tbody" ref={bodyRef}>
        <div className="km-trow root" title={`${m.formula} — ${m.atoms.length} atoms, ${m.bonds.length} bonds`}>
          <span className="km-tcell km-tatom" style={{ paddingLeft: 4 }}>
            <span className="km-twisty" onClick={() => onToggle('root')}>
              {rootOpen ? '▾' : '▸'}
            </span>
            <b className="km-ttext">{m.label || m.name}</b>
          </span>
          <span className="km-tcell" />
          <span className="km-tcell" />
          <span className="km-tcell" />
        </div>
        {visible.map((v, i) => (
          <TRow
            key={v.key}
            v={v}
            alt={i % 2 === 0}
            sel={!v.node.ring && selected === v.node.atom}
            drop={!v.node.ring && dropOn === v.node.atom}
            draggable={!v.node.ring && !m.crystal}
            atoms={m.atoms}
            bonds={m.bonds}
            onSelect={onSelect}
            onToggle={onToggle}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>
    </div>
  )
}

// ================================================================== Library

export function LibraryTree({ app }: { app: MolApp }) {
  const catalog = useStore(app.store, (s) => s.catalog)
  const [open, setOpen] = useState<Set<string> | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const crystals = useMemo(() => new Set(catalog?.classic.filter((c) => c.title === 'Crystal structures' || c.title === 'Lattice systems').flatMap((c) => c.keys.map((k) => k.key)) ?? []), [catalog])
  useEffect(() => {
    // the first six sections start expanded (top.setExpanded(n < 6)); groups start closed
    if (catalog && open === null) setOpen(new Set(catalog.sections.slice(0, 6).map((s) => s.title)))
  }, [catalog, open])
  if (!catalog || !open) return <div className="km-tree km-library" />
  const toggle = (key: string) => {
    const next = new Set(open)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setOpen(next)
  }
  const carbon = cpk('C')
  const load = (r: EntryRow) => void app.loadEntry(r.kind, r.value, r.label)
  return (
    <div className="km-tree km-library" tabIndex={0}>
      {catalog.sections.map((sec) => (
        <div key={sec.title}>
          <div className="km-lrow head" onClick={() => toggle(sec.title)}>
            <span className="km-twisty">{open.has(sec.title) ? '▾' : '▸'}</span>
            <b>{sec.title}</b>
          </div>
          {open.has(sec.title) &&
            sec.groups.map((g) => {
              const gk = `${sec.title}/${g.title}`
              return (
                <div key={gk}>
                  <div className="km-lrow group" onClick={() => toggle(gk)}>
                    <span className="km-twisty">{open.has(gk) ? '▾' : '▸'}</span>
                    <b>{g.title}</b>
                  </div>
                  {open.has(gk) &&
                    g.rows.map((r, i) => {
                      const id = `${r.kind}|${r.value}`
                      return (
                        <div
                          key={`${gk}/${i}`}
                          className={`km-lrow leaf${current === id ? ' sel' : ''}`}
                          title={r.smiles ?? (r.kind === 'reaction' ? r.value : undefined)}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData(DND_MIME, id)
                            e.dataTransfer.effectAllowed = 'copy'
                          }}
                          onClick={() => setCurrent(id)}
                          onDoubleClick={() => load(r)}
                          onKeyDown={(e) => e.key === 'Enter' && load(r)}
                          tabIndex={-1}
                        >
                          <ElementChip color={entryColor(r.kind, r.value, crystals, carbon)} size={16} />
                          <span>{r.label}</span>
                        </div>
                      )
                    })}
                </div>
              )
            })}
        </div>
      ))}
    </div>
  )
}

// ============================================================= My molecules

export function ShelfPanel({ app }: { app: MolApp }) {
  const items = useStore(app.store, (s) => s.shelf)
  const sel = useStore(app.store, (s) => s.shelfSelected)
  const has = sel !== null
  const btn = (text: string, icon: string, onClick: () => void, tip: string, enabled = true) => (
    <button className="k-btn small km-shelfbtn" title={tip} disabled={!enabled} onClick={onClick}>
      <Mdi path={icon} size={16} />
      {text && <span>{text}</span>}
    </button>
  )
  return (
    <div className="km-shelf">
      <div className="km-hint">
        Build a molecule in 3D, then <b>Keep</b> it. Use the kept molecules in the Reaction builder as <code>@Molecule_1</code>.
      </div>
      <div className="km-list">
        {items.map((it) => (
          <div
            key={it.name}
            className={`km-lrow leaf${sel === it.name ? ' sel' : ''}`}
            title={`Write it in an equation as ${it.token}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DND_MIME, `mine|${it.name}`)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => app.set({ shelfSelected: it.name })}
            onDoubleClick={() => app.loadKept(it.name)}
          >
            <span>
              {it.name}    {it.formula}
            </span>
          </div>
        ))}
      </div>
      <div className="km-row">{btn('Keep current molecule', mdiBookmarkPlusOutline, () => void app.keepMolecule(), 'Store the molecule in the 3D view on the shelf under a name you choose')}</div>
      <div className="km-row">
        {btn('Load', mdiFolderUploadOutline, () => sel && app.loadKept(sel), 'Show the selected molecule in 3D', has)}
        {btn('Rename', mdiRenameBox, () => sel && void app.renameKept(sel), 'Rename the selected molecule', has)}
        {btn('', mdiArrowUp, () => sel && void app.moveKept(sel, -1), 'Move up', has)}
        {btn('', mdiArrowDown, () => sel && void app.moveKept(sel, 1), 'Move down', has)}
        {btn('', mdiDeleteOutline, () => sel && void app.deleteKept(sel), 'Remove the selected molecule from the shelf', has)}
      </div>
      <div className="km-row">{btn('Use in a reaction…', mdiFlaskOutline, () => void app.openReactionBuilder(), 'Open the Reaction builder with your kept molecules ready to pick', items.length > 0)}</div>
    </div>
  )
}

// ========================================================== Periodic table

/** periodic.PeriodicWindow: the whole table in a non-modal tool window. */
export function PeriodicWindow({ app }: { app: MolApp }) {
  const active = useStore(app.store, (s) => s.activeElement)
  const [pos, setPos] = useState({ x: 60, y: 60 })
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const pick = (el: string) => app.onElementPicked(el)
  return (
    <div className="km-tool" style={{ left: pos.x, top: pos.y }} onKeyDown={(e) => e.key === 'Escape' && app.set({ periodic: false })}>
      <div
        className="km-tool-title"
        onPointerDown={(e) => {
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => drag.current && setPos({ x: Math.max(0, e.clientX - drag.current.dx), y: Math.max(0, e.clientY - drag.current.dy) })}
        onPointerUp={() => (drag.current = null)}
      >
        <span>Periodic table</span>
        <button className="km-tool-close" onClick={() => app.set({ periodic: false })} title="Close">
          ×
        </button>
      </div>
      <div className="km-ptable">
        <div className="km-pthead">
          <b>Periodic table</b>
          <span className="km-stretch" />
          <span>
            <b>{active}</b> — {elName(active)} &nbsp; Z = {number(active)}, valence {valence(active)}
          </span>
        </div>
        <div className="km-ptgrid">
          {TABLE.map(([sym, row, col]) => (
            <button
              key={sym}
              className={`km-ptcell${sym === active ? ' active' : ''}`}
              style={{ gridRow: row, gridColumn: col, background: cpk(sym), color: textColor(sym) }}
              title={`${number(sym)} — ${elName(sym)} (valence ${valence(sym)})`}
              onClick={() => pick(sym)}
            >
              {number(sym)}
              <br />
              {sym}
            </button>
          ))}
          <span className="km-ptmark" style={{ gridRow: 6, gridColumn: 3 }}>
            57-71
          </span>
          <span className="km-ptmark" style={{ gridRow: 7, gridColumn: 3 }}>
            89-103
          </span>
          <span style={{ gridRow: 8, gridColumn: 1, height: 6 }} />
        </div>
      </div>
    </div>
  )
}
