// The middle pane: search, the open folder's messages, "Load more".

import { useEffect, useRef, useState } from 'react'
import { CircleAlert, Flag, LoaderCircle, Menu, Paperclip, RefreshCw, Reply, Search, X } from 'lucide-react'
import { os } from '@/os'
import { deleteMessage, messageMenuItems } from './actions'
import { useMail, useMailStore } from './store'
import { listDate, senderLabel } from './util'

interface ListProps {
  title: string
  subtitle: string
  outgoing: boolean
  onMenu?: () => void
}

export function MessageList({ title, subtitle, outgoing, onMenu }: ListProps) {
  const store = useMailStore()
  const current = useMail((s) => s.current)
  const items = useMail((s) => s.items)
  const total = useMail((s) => s.total)
  const query = useMail((s) => s.query)
  const loading = useMail((s) => s.listLoading)
  const error = useMail((s) => s.listError)
  const loadingMore = useMail((s) => s.loadingMore)
  const selected = useMail((s) => s.selected)
  const [text, setText] = useState(query)
  const listRef = useRef<HTMLDivElement>(null)

  // Another folder: the search box shows that folder's (empty) search.
  useEffect(() => setText(store.getState().query), [current, store])

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

  const onKeyDown = (e: React.KeyboardEvent) => {
    const s = store.getState()
    const index = items.findIndex((m) => m.uid === selected)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = items[e.key === 'ArrowDown' ? index + 1 : index < 0 ? 0 : index - 1]
      if (next) void s.select(next.uid)
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected != null) {
      e.preventDefault()
      void deleteMessage(store, selected)
    }
  }

  const more = items.length < total

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

      <div className="mail-list-head">
        <span className="mail-list-title">{query ? `Results for “${query}”` : title}</span>
        <span className="mail-list-sub">{subtitle}</span>
      </div>

      <div
        className="mail-list"
        ref={listRef}
        role="listbox"
        aria-label={title}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {items.map((m) => (
          <div
            key={m.uid}
            data-uid={m.uid}
            role="option"
            aria-selected={m.uid === selected}
            className={`mail-row${m.seen ? '' : ' unread'}${m.uid === selected ? ' selected' : ''}`}
            onClick={() => void store.getState().select(m.uid)}
            onContextMenu={(e) => {
              e.preventDefault()
              os.contextMenu(e, [
                { label: 'Open', onClick: () => void store.getState().select(m.uid) },
                '-',
                ...messageMenuItems(store, m),
              ])
            }}
          >
            <span className="mail-dot" aria-label={m.seen ? undefined : 'Unread'} />
            <div className="mail-row-main">
              <div className="mail-row-top">
                <span className="mail-row-from">{senderLabel(m, outgoing)}</span>
                <span className="mail-row-date">{listDate(m.date)}</span>
              </div>
              <div className="mail-row-bottom">
                <span className="mail-row-subject">{m.subject || '(no subject)'}</span>
                {m.answered && <Reply size={12} className="mail-row-icon" aria-label="Answered" />}
                {m.has_attachments && <Paperclip size={12} className="mail-row-icon" aria-label="Has attachments" />}
                {m.flagged && <Flag size={12} className="mail-row-icon mail-flag-on" aria-label="Flagged" />}
              </div>
            </div>
          </div>
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
            <p>{query ? `No messages match “${query}”.` : 'No messages.'}</p>
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
    </section>
  )
}
