// The middle pane: search, filters, the open folder's messages, "Load more".
//
// Each message is a SwipeRow, as on a phone: drag it left (or two fingers left on the trackpad) to
// uncover Flag, Archive and Delete right beside it, drag it a long way to delete at once; drag right
// for Read / Unread. The same buttons show when the pointer rests on a row. Tick the boxes (or
// ⌘/Ctrl-click, Shift-click for a range) to act on several messages at once.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Archive, Check, CircleAlert, Flag, FolderInput, LoaderCircle, Mail, MailOpen, Menu, Paperclip, RefreshCw, Reply, Search,
  Trash2, Undo2, X,
} from 'lucide-react'
import { os } from '@/os'
import type { MessageFilter, MessageSummary } from './api'
import { archiveMessages, archiveTarget, deleteMessages, menuBelow, messageMenuItems, moveMenuItems } from './actions'
import { useMail, useMailStore } from './store'
import { listDate, senderLabel } from './util'

interface ListProps {
  title: string
  subtitle: string
  outgoing: boolean
  onMenu?: () => void
}

const ACTION_W = 74
const FILTERS: { id: MessageFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'flagged', label: 'Flagged' },
]
const clampX = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

interface RowProps {
  m: MessageSummary
  outgoing: boolean
  selected: boolean
  checked: boolean
  selecting: boolean
  canArchive: boolean
  /** The row whose actions are uncovered (only one at a time). */
  openUid: number | null
  onOpen(uid: number | null): void
  onClick(e: React.MouseEvent): void
  onContextMenu(e: React.MouseEvent): void
  onToggle(e: React.MouseEvent): void
  onFlag(): void
  onRead(): void
  onArchive(): void
  onDelete(): void
}

function SwipeRow(p: RowProps) {
  const { m } = p
  const wrap = useRef<HTMLDivElement>(null)
  const xRef = useRef(0)
  const [x, setX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ id: number; x0: number; y0: number; base: number; active: boolean } | null>(null)
  const wheelTimer = useRef(0)
  const justDragged = useRef(false)
  const latest = useRef(p)
  latest.current = p

  const leftW = ACTION_W * (p.canArchive ? 3 : 2) // uncovered by a swipe to the left
  const rightW = ACTION_W // uncovered by a swipe to the right
  const move = (v: number) => {
    xRef.current = v
    setX(v)
  }

  // Let go: open the buttons, close them, or — after a long swipe — just do it.
  const settle = () => {
    const v = xRef.current
    const now = latest.current
    if (v < -(leftW + 70)) {
      move(-wrap.current!.clientWidth) // slides away, then the message is deleted
      window.setTimeout(() => latest.current.onDelete(), 140)
    } else if (v < -leftW / 2) {
      move(-leftW)
      now.onOpen(now.m.uid)
    } else if (v > rightW + 70) {
      move(0)
      now.onRead()
    } else if (v > rightW / 2) {
      move(rightW)
      now.onOpen(now.m.uid)
    } else {
      move(0)
      if (now.openUid === now.m.uid) now.onOpen(null)
    }
  }

  // Another row was opened, or the list scrolled: this one closes.
  useEffect(() => {
    if (p.openUid !== m.uid && xRef.current !== 0 && !drag.current?.active) move(0)
  }, [p.openUid, m.uid])

  // Two fingers on the trackpad. A native listener: React's onWheel can't cancel the browser's own
  // horizontal "go back" gesture.
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const active = xRef.current !== 0 && wheelTimer.current !== 0
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.3 && Math.abs(e.deltaX) >= 1
      if (!horizontal && !active) return
      e.preventDefault()
      if (!horizontal) return
      setDragging(true)
      const cw = el.clientWidth
      move(clampX(xRef.current - e.deltaX, -cw, rightW + 90))
      window.clearTimeout(wheelTimer.current)
      wheelTimer.current = window.setTimeout(() => {
        wheelTimer.current = 0
        setDragging(false)
        settle()
      }, 120)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      window.clearTimeout(wheelTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftW, rightW])

  // A finger, a pen or the mouse dragged sideways.
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base: xRef.current, active: false }
  }
  const moveTo = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x0
    if (!d.active) {
      if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(e.clientY - d.y0) * 1.5) return
      d.active = true
      setDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    move(clampX(d.base + dx, -wrap.current!.clientWidth, rightW + 90))
  }
  const up = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    if (!d.active) return
    justDragged.current = true
    window.setTimeout(() => (justDragged.current = false), 0)
    setDragging(false)
    settle()
  }

  const act = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    move(0)
    p.onOpen(null)
    fn()
  }

  return (
    <div ref={wrap} className={`mail-swipe${dragging ? ' dragging' : ''}${x !== 0 ? ' moved' : ''}`} data-uid={m.uid}>
      <div className="mail-swipe-act right" style={{ width: rightW }} aria-hidden={x <= 0}>
        <button className="mail-act read" tabIndex={-1} onClick={act(p.onRead)}>
          {m.seen ? <Mail size={17} /> : <MailOpen size={17} />}
          <span>{m.seen ? 'Unread' : 'Read'}</span>
        </button>
      </div>
      <div className="mail-swipe-act left" style={{ width: leftW }} aria-hidden={x >= 0}>
        <button className="mail-act flag" tabIndex={-1} onClick={act(p.onFlag)}>
          <Flag size={17} />
          <span>{m.flagged ? 'Unflag' : 'Flag'}</span>
        </button>
        {p.canArchive && (
          <button className="mail-act archive" tabIndex={-1} onClick={act(p.onArchive)}>
            <Archive size={17} />
            <span>Archive</span>
          </button>
        )}
        <button className="mail-act delete" tabIndex={-1} onClick={act(p.onDelete)}>
          <Trash2 size={17} />
          <span>Delete</span>
        </button>
      </div>

      <div
        role="option"
        aria-selected={p.selected}
        aria-checked={p.selecting ? p.checked : undefined}
        className={`mail-row${m.seen ? '' : ' unread'}${p.selected ? ' selected' : ''}${p.checked ? ' checked' : ''}${p.selecting ? ' selecting' : ''}`}
        style={{ transform: x ? `translateX(${x}px)` : undefined }}
        onPointerDown={down}
        onPointerMove={moveTo}
        onPointerUp={up}
        onPointerCancel={up}
        onClick={(e) => {
          if (justDragged.current) return
          if (xRef.current !== 0) {
            move(0)
            p.onOpen(null)
            return
          }
          p.onClick(e)
        }}
        onContextMenu={p.onContextMenu}
      >
        <button
          type="button"
          className="mail-check"
          tabIndex={-1}
          aria-label={p.checked ? 'Untick this message' : 'Tick this message'}
          onClick={(e) => {
            e.stopPropagation()
            p.onToggle(e)
          }}
        >
          <span className="mail-dot" aria-label={m.seen ? undefined : 'Unread'} />
          <span className="mail-box">{p.checked && <Check size={12} strokeWidth={3} />}</span>
        </button>
        <div className="mail-row-main">
          <div className="mail-row-top">
            <span className="mail-row-from">{senderLabel(m, p.outgoing)}</span>
            <span className="mail-row-date">{listDate(m.date)}</span>
          </div>
          <div className="mail-row-bottom">
            <span className="mail-row-subject">{m.subject || '(no subject)'}</span>
            {m.answered && <Reply size={12} className="mail-row-icon" aria-label="Answered" />}
            {m.has_attachments && <Paperclip size={12} className="mail-row-icon" aria-label="Has attachments" />}
            {m.flagged && <Flag size={12} className="mail-row-icon mail-flag-on" aria-label="Flagged" />}
          </div>
        </div>
        <div className="mail-quick" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          <button className={`k-icon-btn${m.flagged ? ' mail-flag-on' : ''}`} title={m.flagged ? 'Remove the flag' : 'Flag'} aria-label={m.flagged ? 'Remove the flag' : 'Flag'} onClick={p.onFlag}>
            <Flag size={14} />
          </button>
          <button className="k-icon-btn" title={m.seen ? 'Mark as unread' : 'Mark as read'} aria-label={m.seen ? 'Mark as unread' : 'Mark as read'} onClick={p.onRead}>
            {m.seen ? <Mail size={14} /> : <MailOpen size={14} />}
          </button>
          {p.canArchive && (
            <button className="k-icon-btn" title="Archive" aria-label="Archive" onClick={p.onArchive}>
              <Archive size={14} />
            </button>
          )}
          <button className="k-icon-btn mail-delete-btn" title="Delete" aria-label="Delete" onClick={p.onDelete}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

export function MessageList({ title, subtitle, outgoing, onMenu }: ListProps) {
  const store = useMailStore()
  const current = useMail((s) => s.current)
  const items = useMail((s) => s.items)
  const total = useMail((s) => s.total)
  const query = useMail((s) => s.query)
  const filter = useMail((s) => s.filter)
  const checked = useMail((s) => s.checked)
  const undo = useMail((s) => s.undo)
  const loading = useMail((s) => s.listLoading)
  const error = useMail((s) => s.listError)
  const loadingMore = useMail((s) => s.loadingMore)
  const selected = useMail((s) => s.selected)
  const folders = useMail((s) => (s.current ? s.folders[s.current.accountId] : undefined))
  const [text, setText] = useState(query)
  const [openUid, setOpenUid] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const canArchive = !!current && !!archiveTarget(store) && !!folders
  const selecting = checked.length > 0

  // Another folder: the search box shows that folder's (empty) search.
  useEffect(() => setText(store.getState().query), [current, store])
  useEffect(() => setOpenUid(null), [current, filter, query])

  // Search as you type (after a pause); Enter searches at once.
  useEffect(() => {
    if (text.trim() === query) return
    const t = window.setTimeout(() => store.getState().search(text), 500)
    return () => window.clearTimeout(t)
  }, [text, query, store])

  // Keep the selected row in view.
  useEffect(() => {
    if (selected == null) return
    listRef.current?.querySelector(`[data-uid="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  // What a keystroke acts on: the ticked messages, else the open one.
  const targets = (): number[] => {
    const s = store.getState()
    return s.checked.length ? s.checked : s.selected != null ? [s.selected] : []
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const s = store.getState()
    const index = items.findIndex((m) => m.uid === selected)
    const mod = e.metaKey || e.ctrlKey
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = items[e.key === 'ArrowDown' ? index + 1 : index < 0 ? 0 : index - 1]
      if (next) void s.select(next.uid)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      const uids = targets()
      if (!uids.length) return
      e.preventDefault()
      void deleteMessages(store, uids)
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      s.checkAll()
    } else if (e.key === 'Escape') {
      if (s.checked.length) s.clearChecks()
      setOpenUid(null)
    } else if (!mod && !e.altKey && ['f', 'u', 'e'].includes(e.key.toLowerCase())) {
      const uids = targets()
      if (!uids.length) return
      e.preventDefault()
      const rows = items.filter((m) => uids.includes(m.uid))
      if (e.key.toLowerCase() === 'f') void s.setFlagsMany(uids, { flagged: !rows.every((m) => m.flagged) })
      else if (e.key.toLowerCase() === 'u') void s.setFlagsMany(uids, { seen: !rows.every((m) => m.seen) })
      else archiveMessages(store, uids)
    }
  }

  const rowClick = (m: MessageSummary) => (e: React.MouseEvent) => {
    const s = store.getState()
    if (e.shiftKey) s.checkRange(m.uid)
    else if (e.metaKey || e.ctrlKey || s.checked.length) s.toggleCheck(m.uid)
    else void s.select(m.uid)
  }

  const more = items.length < total
  const ticked = items.filter((m) => checked.includes(m.uid))
  const allRead = ticked.every((m) => m.seen)
  const allFlagged = ticked.every((m) => m.flagged)

  return (
    <section className="mail-listpane" aria-label="Messages">
      <div className="k-toolbar mail-bar">
        {onMenu && (
          <button className="k-icon-btn" title="Accounts and folders" aria-label="Accounts and folders" onClick={onMenu}>
            <Menu size={16} />
          </button>
        )}
        <form
          className="mail-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            store.getState().search(text)
          }}
        >
          <Search size={14} className="mail-search-icon" />
          <input
            className="k-input"
            value={text}
            placeholder={`Search ${title}`}
            aria-label="Search messages"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && text) {
                e.stopPropagation()
                setText('')
                store.getState().search('')
              }
            }}
          />
          {text && (
            <button
              type="button"
              className="mail-search-clear"
              aria-label="Clear the search"
              onClick={() => {
                setText('')
                store.getState().search('')
              }}
            >
              <X size={13} />
            </button>
          )}
        </form>
        <button
          className="k-icon-btn"
          title="Refresh"
          aria-label="Refresh"
          disabled={!current}
          onClick={() => void store.getState().refresh()}
        >
          <RefreshCw size={15} className={loading && items.length > 0 ? 'k-spin' : undefined} />
        </button>
      </div>

      {selecting ? (
        <div className="mail-bulk" role="toolbar" aria-label="Actions for the ticked messages">
          <button className="k-icon-btn" title="Clear the selection (Esc)" aria-label="Clear the selection" onClick={() => store.getState().clearChecks()}>
            <X size={15} />
          </button>
          <span className="mail-bulk-count">{checked.length} selected</span>
          {checked.length < items.length && (
            <button className="k-btn small" onClick={() => store.getState().checkAll()}>
              Select all
            </button>
          )}
          <span className="mail-spacer" />
          <button
            className="k-icon-btn"
            title={allRead ? 'Mark as unread (U)' : 'Mark as read (U)'}
            aria-label={allRead ? 'Mark as unread' : 'Mark as read'}
            onClick={() => void store.getState().setFlagsMany(checked, { seen: !allRead })}
          >
            {allRead ? <Mail size={16} /> : <MailOpen size={16} />}
          </button>
          <button
            className={`k-icon-btn${allFlagged ? ' mail-flag-on' : ''}`}
            title={allFlagged ? 'Remove the flags (F)' : 'Flag (F)'}
            aria-label={allFlagged ? 'Remove the flags' : 'Flag'}
            onClick={() => void store.getState().setFlagsMany(checked, { flagged: !allFlagged })}
          >
            <Flag size={16} />
          </button>
          {canArchive && (
            <button className="k-icon-btn" title="Archive (E)" aria-label="Archive" onClick={() => archiveMessages(store, checked)}>
              <Archive size={16} />
            </button>
          )}
          <button className="k-icon-btn" title="Move to…" aria-label="Move to" onClick={(e) => menuBelow(e, moveMenuItems(store, checked))}>
            <FolderInput size={16} />
          </button>
          <button className="k-icon-btn mail-delete-btn" title="Delete" aria-label="Delete" onClick={() => void deleteMessages(store, checked)}>
            <Trash2 size={16} />
          </button>
        </div>
      ) : (
        <div className="mail-list-head">
          <div className="mail-list-heading">
            <span className="mail-list-title">{query ? `Results for “${query}”` : title}</span>
            <span className="mail-list-sub">{subtitle}</span>
          </div>
          <div className="mail-filters" role="radiogroup" aria-label="Show">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="radio"
                aria-checked={filter === f.id}
                className={`mail-filter${filter === f.id ? ' active' : ''}`}
                onClick={() => store.getState().setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        className="mail-list"
        ref={listRef}
        role="listbox"
        aria-label={title}
        aria-multiselectable
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={() => openUid != null && setOpenUid(null)}
      >
        {items.map((m) => (
          <SwipeRow
            key={m.uid}
            m={m}
            outgoing={outgoing}
            selected={m.uid === selected}
            checked={checked.includes(m.uid)}
            selecting={selecting}
            canArchive={canArchive}
            openUid={openUid}
            onOpen={setOpenUid}
            onClick={rowClick(m)}
            onToggle={(e) => (e.shiftKey ? store.getState().checkRange(m.uid) : store.getState().toggleCheck(m.uid))}
            onContextMenu={(e) => {
              e.preventDefault()
              const s = store.getState()
              if (s.checked.length > 1 && s.checked.includes(m.uid)) {
                const rows = items.filter((r) => s.checked.includes(r.uid))
                const read = rows.every((r) => r.seen)
                const flagged = rows.every((r) => r.flagged)
                os.contextMenu(e, [
                  { label: read ? 'Mark as Unread' : 'Mark as Read', icon: read ? Mail : MailOpen, onClick: () => void s.setFlagsMany(s.checked, { seen: !read }) },
                  { label: flagged ? 'Remove Flags' : 'Flag', icon: Flag, onClick: () => void s.setFlagsMany(s.checked, { flagged: !flagged }) },
                  ...(canArchive ? [{ label: 'Archive', icon: Archive, onClick: () => archiveMessages(store, s.checked) }] : []),
                  { label: 'Move to', icon: FolderInput, submenu: moveMenuItems(store, s.checked) },
                  '-',
                  { label: `Delete ${s.checked.length} Messages`, icon: Trash2, danger: true, onClick: () => void deleteMessages(store, s.checked) },
                ])
                return
              }
              os.contextMenu(e, [
                { label: 'Open', onClick: () => void store.getState().select(m.uid) },
                { label: 'Select', onClick: () => store.getState().toggleCheck(m.uid) },
                '-',
                ...messageMenuItems(store, m),
              ])
            }}
            onFlag={() => void store.getState().setFlags(m.uid, { flagged: !m.flagged })}
            onRead={() => void store.getState().setFlags(m.uid, { seen: !m.seen })}
            onArchive={() => archiveMessages(store, [m.uid])}
            onDelete={() => void deleteMessages(store, [m.uid])}
          />
        ))}

        {loading && items.length === 0 && (
          <div className="mail-list-note">
            <LoaderCircle size={20} className="k-spin" />
          </div>
        )}
        {!loading && error && (
          <div className="mail-list-note">
            <CircleAlert size={22} />
            <p>{error}</p>
            <button className="k-btn small" onClick={() => void store.getState().refresh()}>
              <RefreshCw size={13} /> Try again
            </button>
          </div>
        )}
        {!loading && !error && items.length === 0 && current && (
          <div className="mail-list-note">
            <p>
              {query
                ? `No messages match “${query}”.`
                : filter === 'unread'
                  ? 'No unread messages.'
                  : filter === 'flagged'
                    ? 'No flagged messages.'
                    : 'No messages.'}
            </p>
          </div>
        )}
        {more && items.length > 0 && (
          <div className="mail-more">
            <button className="k-btn small" disabled={loadingMore} onClick={() => void store.getState().loadMore()}>
              {loadingMore && <LoaderCircle size={13} className="k-spin" />}
              Load more ({total - items.length} left)
            </button>
          </div>
        )}
      </div>

      {undo && (
        <div className="mail-undo" role="status">
          <span>{undo.label}</span>
          <button className="mail-undo-btn" onClick={() => store.getState().undoTakeOut()}>
            <Undo2 size={14} /> Undo
          </button>
        </div>
      )}
    </section>
  )
}
