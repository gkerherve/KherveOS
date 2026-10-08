// A QTreeWidget: the object tree (Main and Object tabs) and every other tree.
// Selection (click, Ctrl/Shift+click), expand/collapse, double-click (opens an
// Object, else renames in place), right-click (the desktop builds the menu),
// the tree's keys (Space hides, Delete, Q/A, Tab, Ctrl+↑/↓, clipboard) and
// drag & drop to reorder — each goes to Python's ObjectTree.

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { MdiIcon } from '../MdiIcon'
import { qtKey } from '../keys'
import type { Node, TreeRow } from '../types'
import { flatten } from '../logic'
import { useQt } from './context'
import { tipAttr } from './QtNode'

const ROW_H = 22

export const QtTree = memo(function QtTree({ n }: { n: Node }) {
  const { send } = useQt()
  const rows = (n.rows as TreeRow[] | undefined) ?? []
  const flat = useMemo(() => flatten(rows), [rows])
  const indent = n.ind ?? 20
  const [editing, setEditing] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [drop, setDrop] = useState<{ i: number; where: 'on' | 'above' | 'below' } | null>(null)
  const anchor = useRef<number | null>(null)
  const box = useRef<HTMLDivElement>(null)

  // Python asked to rename a row (double-click / Rename / F2)
  useEffect(() => {
    if (typeof n.edit === 'number') {
      const target = flat.find((f) => f.row.i === n.edit)
      if (target) {
        setEditing(target.row.i)
        setEditText(target.row.text)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.edit])

  // keep the current row in view
  useEffect(() => {
    if (n.scroll == null || !box.current) return
    const k = flat.findIndex((f) => f.row.i === n.scroll)
    if (k < 0) return
    const el = box.current
    const top = k * ROW_H
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.scroll, flat])

  const selected = flat.filter((f) => f.row.sel).map((f) => f.row.i)

  const click = (e: React.MouseEvent, k: number) => {
    const id = flat[k].row.i
    let items: number[]
    if (n.multi && (e.ctrlKey || e.metaKey)) {
      items = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]
      anchor.current = k
    } else if (n.multi && e.shiftKey && anchor.current !== null) {
      const [a, b] = [Math.min(anchor.current, k), Math.max(anchor.current, k)]
      items = flat.slice(a, b + 1).map((f) => f.row.i)
    } else {
      items = [id]
      anchor.current = k
    }
    send({ op: 'select', id: n.id, items, cur: id })
  }

  const commitRename = () => {
    if (editing !== null) send({ op: 'rename', id: n.id, item: editing, col: 0, text: editText })
    setEditing(null)
  }

  return (
    <div
      ref={box}
      className="kc-tree"
      tabIndex={0}
      onKeyDown={(e) => {
        if (editing !== null) return
        const k = qtKey(e.nativeEvent)
        if (!k.key) return
        // the tree's own keys; everything else is a window shortcut
        const own = [0x20, 0x01000007, 0x01000001, 0x01000002, 0x51, 0x41, 0x01000013, 0x01000015].includes(k.key) ||
          ((k.mods & 0x04000000) !== 0 && [0x43, 0x58, 0x56].includes(k.key))
        if (k.key === 0x01000013 && !(k.mods & 0x04000000)) {
          // plain ↑ / ↓ walk the rows (Qt's tree does this itself)
          const cur = flat.findIndex((f) => f.row.sel)
          if (cur > 0) send({ op: 'select', id: n.id, items: [flat[cur - 1].row.i], cur: flat[cur - 1].row.i })
          e.preventDefault()
          e.stopPropagation()
          return
        }
        if (k.key === 0x01000015 && !(k.mods & 0x04000000)) {
          const cur = flat.findIndex((f) => f.row.sel)
          if (cur >= 0 && cur < flat.length - 1) send({ op: 'select', id: n.id, items: [flat[cur + 1].row.i], cur: flat[cur + 1].row.i })
          e.preventDefault()
          e.stopPropagation()
          return
        }
        if (k.key === 0x01000039 /* F2 */) {
          const cur = flat.find((f) => f.row.sel)
          if (cur && !cur.row.ne) {
            setEditing(cur.row.i)
            setEditText(cur.row.text)
          }
          e.preventDefault()
          e.stopPropagation()
          return
        }
        if (own) {
          e.preventDefault()
          e.stopPropagation()
          send({ op: 'key', id: n.id, key: k.key, mods: k.mods })
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        send({ op: 'menu', id: n.id, item: null, x: e.clientX, y: e.clientY })
      }}
    >
      {n.hdr && (
        <div className="kc-tree-header">
          {n.hdr.map((h, i) => (
            <span key={i}>{h}</span>
          ))}
        </div>
      )}
      {flat.map((f, k) => {
        const r = f.row
        const hasKids = !!r.kids?.some((c) => !c.hid)
        return (
          <div
            key={r.i}
            className={`kc-tree-row${r.sel ? ' selected' : ''}${drop?.i === k ? ` drop-${drop.where}` : ''}`}
            style={{ paddingLeft: 4 + f.depth * indent, height: ROW_H }}
            draggable={!r.ph}
            {...tipAttr(r.tip)}
            onPointerDown={(e) => {
              if (e.button === 0 && !r.sel) click(e, k)
            }}
            onClick={(e) => {
              if (r.sel && !(e.ctrlKey || e.metaKey || e.shiftKey) && selected.length === 1) return
              if (r.sel) click(e, k)
            }}
            onDoubleClick={() => send({ op: 'dbl', id: n.id, item: r.i, col: 0 })}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              send({ op: 'menu', id: n.id, item: r.i, x: e.clientX, y: e.clientY })
            }}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('application/x-kcad-rows', String(r.i))
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('application/x-kcad-rows')) return
              e.preventDefault()
              const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
              const y = (e.clientY - box.top) / box.height
              setDrop({ i: k, where: y < 0.25 ? 'above' : y > 0.75 ? 'below' : 'on' })
            }}
            onDragLeave={() => setDrop(null)}
            onDrop={(e) => {
              e.preventDefault()
              const where = drop?.where ?? 'on'
              setDrop(null)
              send({ op: 'drop', id: n.id, item: r.i, where })
            }}
          >
            {f.depth > 0 &&
              f.cont.slice(0, -1).map((more, level) =>
                more && level > 0 ? <span key={level} className="kc-guide" style={{ left: 4 + (level - 1) * indent + indent / 2 }} /> : null,
              )}
            <span
              className="kc-tree-arrow"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                if (hasKids) send({ op: 'expand', id: n.id, item: r.i, on: !r.exp })
              }}
            >
              {hasKids ? r.exp ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
            </span>
            {r.cs !== undefined && (
              <input
                type="checkbox"
                checked={r.cs === 2}
                onChange={(e) => send({ op: 'check', id: n.id, item: r.i, state: e.target.checked ? 2 : 0 })}
                onClick={(e) => e.stopPropagation()}
              />
            )}
            {r.icon && <MdiIcon name={r.icon} size={16} className="kc-tree-icon" />}
            {editing === r.i ? (
              <input
                className="k-input kc-tree-edit"
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setEditing(null)
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="kc-tree-text" style={{ color: r.fg, fontStyle: r.it ? 'italic' : undefined, fontWeight: r.b ? 600 : undefined }}>
                {r.text}
                {r.tag && <span className="kc-tree-tag">{r.tag}</span>}
              </span>
            )}
            {r.cols?.map((c, i) => (
              <span key={i} className="kc-tree-col">
                {c}
              </span>
            ))}
          </div>
        )
      })}
      <div
        className="kc-tree-rest"
        onPointerDown={(e) => {
          if (e.button === 0) send({ op: 'select', id: n.id, items: [] })
        }}
        onDragOver={(e) => e.dataTransfer.types.includes('application/x-kcad-rows') && e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          send({ op: 'drop', id: n.id, item: null, where: 'viewport' })
        }}
      />
    </div>
  )
})
