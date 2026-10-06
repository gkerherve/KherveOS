// OS-wide overlays: right-click menus, notifications (toasts) and modal
// dialogs. Apps reach them through `os` (src/os/index.ts); the hosts at the
// bottom of this file are mounted once by the shell.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { AlertTriangle, Info, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { MenuList, type MenuItem } from './ui/Menu'
import { FileDialog, type FileDialogOptions } from './ui/FileDialog'

// ------------------------------------------------------------ context menu

interface CtxMenu {
  x: number
  y: number
  items: MenuItem[]
  above?: boolean
  className?: string
  /** Who opened it (lets a button toggle its menu). */
  owner?: string
}
interface CtxState {
  menu: CtxMenu | null
}
const useCtx = create<CtxState>(() => ({ menu: null }))

export function showContextMenu(
  at: { clientX: number; clientY: number },
  items: MenuItem[],
  opts: { above?: boolean; className?: string; owner?: string } = {},
) {
  useCtx.setState({ menu: { x: at.clientX, y: at.clientY, items, ...opts } })
}

export function closeContextMenu() {
  useCtx.setState({ menu: null })
}

/** The owner of the open menu, if any. */
export function openMenuOwner(): string | null {
  return useCtx.getState().menu?.owner ?? null
}

function ContextMenuHost() {
  const menu = useCtx((s) => s.menu)
  useEffect(() => {
    if (!menu) return
    const close = () => useCtx.setState({ menu: null })
    // A click on the button that opened the menu is left to that button (it toggles).
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('.k-menu')) return
      if (menu.owner && t.closest(`[data-menu-owner="${menu.owner}"]`)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [menu])
  if (!menu) return null
  return (
    <MenuList
      items={menu.items}
      x={menu.x}
      y={menu.y}
      above={menu.above}
      className={menu.className}
      minWidth={menu.above ? 220 : 180}
      onClose={() => useCtx.setState({ menu: null })}
    />
  )
}

// ----------------------------------------------------------- notifications

export interface Toast {
  id: number
  title: string
  body?: string
  icon?: LucideIcon
  color?: string
  onClick?: () => void
  timeout?: number
}
const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }))
let toastId = 0

export function notify(t: Omit<Toast, 'id'>): number {
  const id = ++toastId
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }))
  const ms = t.timeout ?? 6000
  if (ms > 0) setTimeout(() => dismiss(id), ms)
  return id
}

export function dismiss(id: number) {
  useToasts.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }))
}

function ToastHost() {
  const toasts = useToasts((s) => s.toasts)
  return (
    <div className="k-toasts" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.icon ?? Info
        return (
          <div
            key={t.id}
            className={`k-toast${t.onClick ? ' clickable' : ''}`}
            onClick={() => {
              if (t.onClick) { t.onClick(); dismiss(t.id) }
            }}
          >
            <span className="k-toast-icon" style={{ background: t.color ?? 'var(--k-accent)' }}>
              <Icon size={16} />
            </span>
            <div className="k-toast-text">
              <div className="k-toast-title">{t.title}</div>
              {t.body && <div className="k-toast-body">{t.body}</div>}
            </div>
            <button className="k-icon-btn k-toast-close" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); dismiss(t.id) }}>
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ----------------------------------------------------------------- dialogs

type DialogSpec =
  | { kind: 'alert'; title: string; message: ReactNode; resolve: (v: void) => void }
  | { kind: 'confirm'; title: string; message: ReactNode; okLabel: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: 'prompt'; title: string; message: ReactNode; value: string; okLabel: string; placeholder?: string; selectStem: boolean; resolve: (v: string | null) => void }
  | { kind: 'file'; options: FileDialogOptions; resolve: (v: string | null) => void }
  | { kind: 'choose'; title: string; message: ReactNode; buttons: ChoiceButton[]; resolve: (v: string | null) => void }

export interface ChoiceButton {
  label: string
  value: string
  primary?: boolean
  danger?: boolean
}

const useDialogs = create<{ stack: (DialogSpec & { id: number })[] }>(() => ({ stack: [] }))
let dialogId = 0

function push<T>(make: (resolve: (v: T) => void) => DialogSpec): Promise<T> {
  return new Promise<T>((resolve) => {
    const id = ++dialogId
    const spec = make((v: T) => {
      useDialogs.setState((s) => ({ stack: s.stack.filter((d) => d.id !== id) }))
      resolve(v)
    })
    useDialogs.setState((s) => ({ stack: [...s.stack, { ...spec, id }] }))
  })
}

export const dialog = {
  alert(message: ReactNode, opts: { title?: string } = {}): Promise<void> {
    return push<void>((resolve) => ({ kind: 'alert', title: opts.title ?? 'KherveOS', message, resolve }))
  },
  confirm(message: ReactNode, opts: { title?: string; okLabel?: string; danger?: boolean } = {}): Promise<boolean> {
    return push<boolean>((resolve) => ({
      kind: 'confirm', title: opts.title ?? 'Are you sure?', message, okLabel: opts.okLabel ?? 'OK', danger: !!opts.danger, resolve,
    }))
  },
  prompt(
    message: ReactNode,
    opts: { title?: string; defaultValue?: string; okLabel?: string; placeholder?: string; selectStem?: boolean } = {},
  ): Promise<string | null> {
    return push<string | null>((resolve) => ({
      kind: 'prompt', title: opts.title ?? 'KherveOS', message, value: opts.defaultValue ?? '', okLabel: opts.okLabel ?? 'OK',
      placeholder: opts.placeholder, selectStem: !!opts.selectStem, resolve,
    }))
  },
  /** Several buttons, e.g. Save / Don't save / Cancel. Resolves to the clicked value, or null (Escape). */
  choose(message: ReactNode, buttons: ChoiceButton[], opts: { title?: string } = {}): Promise<string | null> {
    return push<string | null>((resolve) => ({ kind: 'choose', title: opts.title ?? 'KherveOS', message, buttons, resolve }))
  },
  /** Pick an existing file. Resolves to its path, or null if cancelled. */
  openFile(opts: Omit<FileDialogOptions, 'mode'> = {}): Promise<string | null> {
    return push<string | null>((resolve) => ({ kind: 'file', options: { ...opts, mode: 'open' }, resolve }))
  },
  /** Choose where to save. Asks before overwriting. Resolves to the path, or null. */
  saveFile(opts: Omit<FileDialogOptions, 'mode'> = {}): Promise<string | null> {
    return push<string | null>((resolve) => ({ kind: 'file', options: { ...opts, mode: 'save' }, resolve }))
  },
  pickFolder(opts: Omit<FileDialogOptions, 'mode' | 'extensions' | 'defaultName'> = {}): Promise<string | null> {
    return push<string | null>((resolve) => ({ kind: 'file', options: { ...opts, mode: 'folder' }, resolve }))
  },
}

function DialogFrame({ title, children, onCancel, icon }: { title: string; children: ReactNode; onCancel: () => void; icon?: ReactNode }) {
  return (
    <div className="k-dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="k-dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
        <div className="k-dialog-title">
          {icon}
          <span>{title}</span>
        </div>
        {children}
      </div>
    </div>
  )
}

function ChoiceDialog({ d }: { d: Extract<DialogSpec, { kind: 'choose' }> }) {
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus(), [])
  return (
    <DialogFrame title={d.title} onCancel={() => d.resolve(null)}>
      <div className="k-dialog-body">
        <div className="k-dialog-message">{d.message}</div>
        <div className="k-dialog-buttons">
          {d.buttons.map((b) => (
            <button
              key={b.value}
              ref={b.primary ? first : undefined}
              className={`k-btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}`}
              onClick={() => d.resolve(b.value)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </DialogFrame>
  )
}

function SimpleDialog({ d }: { d: Exclude<DialogSpec, { kind: 'file' } | { kind: 'choose' }> }) {
  const [value, setValue] = useState(d.kind === 'prompt' ? d.value : '')
  const inputRef = useRef<HTMLInputElement>(null)
  const okRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (d.kind === 'prompt') {
      const el = inputRef.current
      if (!el) return
      el.focus()
      const dot = d.selectStem ? d.value.lastIndexOf('.') : -1
      el.setSelectionRange(0, dot > 0 ? dot : d.value.length)
    } else okRef.current?.focus()
  }, [d])

  const cancel = () => {
    if (d.kind === 'alert') d.resolve()
    else if (d.kind === 'confirm') d.resolve(false)
    else d.resolve(null)
  }
  const ok = () => {
    if (d.kind === 'alert') d.resolve()
    else if (d.kind === 'confirm') d.resolve(true)
    else d.resolve(value)
  }
  const danger = d.kind === 'confirm' && d.danger

  return (
    <DialogFrame
      title={d.title}
      onCancel={cancel}
      icon={danger ? <AlertTriangle size={16} color="var(--k-danger)" /> : undefined}
    >
      <form
        className="k-dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          ok()
        }}
      >
        <div className="k-dialog-message">{d.message}</div>
        {d.kind === 'prompt' && (
          <input
            ref={inputRef}
            className="k-input"
            value={value}
            placeholder={d.placeholder}
            onChange={(e) => setValue(e.target.value)}
            spellCheck={false}
          />
        )}
        <div className="k-dialog-buttons">
          {d.kind !== 'alert' && (
            <button type="button" className="k-btn" onClick={cancel}>
              Cancel
            </button>
          )}
          <button ref={okRef} type="submit" className={`k-btn ${danger ? 'danger' : 'primary'}`}>
            {d.kind === 'alert' ? 'OK' : d.okLabel}
          </button>
        </div>
      </form>
    </DialogFrame>
  )
}

function DialogHost() {
  const stack = useDialogs((s) => s.stack)
  // Render the whole stack so a dialog opened from a dialog (e.g. "replace
  // this file?" from Save As) sits on top without unmounting the one below.
  return (
    <>
      {stack.map((d) =>
        d.kind === 'file' ? (
          <div key={d.id} className="k-dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && d.resolve(null)}>
            <FileDialog options={d.options} onDone={d.resolve} />
          </div>
        ) : d.kind === 'choose' ? (
          <ChoiceDialog key={d.id} d={d} />
        ) : (
          <SimpleDialog key={d.id} d={d} />
        ),
      )}
    </>
  )
}

export function OverlayHosts() {
  return (
    <>
      <ToastHost />
      <DialogHost />
      <ContextMenuHost />
    </>
  )
}
