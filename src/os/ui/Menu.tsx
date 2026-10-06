// Shared drop-down menu list, used by menu bars and right-click menus.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type MenuItem =
  | '-'
  | {
      label: string
      icon?: LucideIcon
      shortcut?: string
      onClick?: () => void
      disabled?: boolean
      danger?: boolean
      checked?: boolean
      submenu?: MenuItem[]
    }

interface MenuListProps {
  items: MenuItem[]
  onClose: () => void
  /** Position in viewport pixels; the list is nudged to stay on screen. */
  x: number
  y: number
  minWidth?: number
}

export function MenuList({ items, onClose, x, y, minWidth = 180 }: MenuListProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [openSub, setOpenSub] = useState<number | null>(null)
  const [subPos, setSubPos] = useState({ x: 0, y: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    })
  }, [x, y])

  return (
    <div
      ref={ref}
      className="k-menu"
      role="menu"
      style={{ left: pos.x, top: pos.y, minWidth }}
      onContextMenu={(e) => e.preventDefault()}
      // Keep keyboard focus in the app, so Edit › Copy etc. act on its selection.
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item === '-') return <div key={i} className="k-menu-sep" />
        const Icon = item.icon
        return (
          <div
            key={i}
            role="menuitem"
            aria-disabled={item.disabled || undefined}
            className={`k-menu-item${item.disabled ? ' disabled' : ''}${item.danger ? ' danger' : ''}${openSub === i ? ' active' : ''}`}
            onMouseEnter={(e) => {
              if (item.submenu) {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setSubPos({ x: r.right - 2, y: r.top - 4 })
                setOpenSub(i)
              } else setOpenSub(null)
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (item.disabled || item.submenu) return
              onClose()
              item.onClick?.()
            }}
          >
            <span className="k-menu-icon">
              {item.checked ? <Check size={14} /> : Icon ? <Icon size={14} /> : null}
            </span>
            <span className="k-menu-label">{item.label}</span>
            {item.shortcut && <span className="k-menu-shortcut">{item.shortcut}</span>}
            {item.submenu && <ChevronRight size={14} className="k-menu-chevron" />}
          </div>
        )
      })}
      {openSub !== null && typeof items[openSub] === 'object' && (items[openSub] as { submenu?: MenuItem[] }).submenu && (
        <MenuList
          items={(items[openSub] as { submenu: MenuItem[] }).submenu}
          onClose={onClose}
          x={subPos.x}
          y={subPos.y}
        />
      )}
    </div>
  )
}

export interface MenuBarMenu {
  label: string
  items: MenuItem[]
}

/** An application menu bar (File, Edit, View…). */
export function MenuBar({ menus, children }: { menus: MenuBarMenu[]; children?: ReactNode }) {
  const [open, setOpen] = useState<number | null>(null)
  const [anchor, setAnchor] = useState({ x: 0, y: 0 })
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open === null) return
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.k-menu, .k-menubar-item')) setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    const onBlur = () => setOpen(null)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [open])

  const openAt = (i: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setAnchor({ x: r.left, y: r.bottom + 2 })
    setOpen(i)
  }

  return (
    <div className="k-menubar" ref={barRef}>
      {menus.map((m, i) => (
        <button
          key={m.label}
          className={`k-menubar-item${open === i ? ' open' : ''}`}
          onClick={(e) => (open === i ? setOpen(null) : openAt(i, e.currentTarget))}
          onMouseEnter={(e) => open !== null && open !== i && openAt(i, e.currentTarget)}
        >
          {m.label}
        </button>
      ))}
      {children && <div className="k-menubar-extra">{children}</div>}
      {open !== null && <MenuList items={menus[open].items} x={anchor.x} y={anchor.y} onClose={() => setOpen(null)} />}
    </div>
  )
}
