// Find people on this server and start a chat: one person → a direct chat
// (reopened if it exists), several → a group, optionally with a name.

import { useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle, Search, UserPlus, Users, X } from 'lucide-react'
import { messagesApi } from './api'
import { Avatar } from './Avatar'
import { errorText, startConversation } from './store'
import type { User } from './types'

export function NewChatDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<User[] | null>(null)
  const [searching, setSearching] = useState(true)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [picked, setPicked] = useState<User[]>([])
  const [cursor, setCursor] = useState(0)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  // Search as you type (everyone, when the box is empty).
  useEffect(() => {
    let stale = false
    setSearching(true)
    const t = window.setTimeout(
      async () => {
        try {
          const users = await messagesApi.searchPeople(query.trim())
          if (stale) return
          setResults(users)
          setSearchError(null)
          setCursor(0)
        } catch (err) {
          if (!stale) setSearchError(errorText(err))
        } finally {
          if (!stale) setSearching(false)
        }
      },
      query.trim() ? 180 : 0,
    )
    return () => {
      stale = true
      window.clearTimeout(t)
    }
  }, [query])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.msg-person.cursor')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const isPicked = (u: User) => picked.some((p) => p.id === u.id)
  const toggle = (u: User) => {
    setPicked((cur) => (cur.some((p) => p.id === u.id) ? cur.filter((p) => p.id !== u.id) : [...cur, u]))
    setError(null)
  }

  const start = async (people: User[]) => {
    if (!people.length || busy) return
    setBusy(true)
    setError(null)
    try {
      await startConversation(
        people.map((u) => u.username),
        people.length > 1 ? title.trim() || undefined : undefined,
      )
      onClose()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  const list = results ?? []
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((i) => Math.min(i + 1, list.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const u = list[cursor]
      if (!picked.length && u) void start([u])
      else if (query.trim() && u) {
        if (!isPicked(u)) toggle(u)
        setQuery('')
      } else void start(picked)
    } else if (e.key === 'Backspace' && !query && picked.length) {
      setPicked((cur) => cur.slice(0, -1))
    }
  }

  const group = picked.length > 1
  const hint =
    picked.length === 0
      ? 'Pick one person for a direct chat, or several for a group.'
      : picked.length === 1
        ? `A direct chat with ${picked[0].display_name}.`
        : `A group with ${picked.length} people and you.`

  return (
    <div className="msg-modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="msg-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="New chat"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="msg-dialog-head">
          <UserPlus size={17} />
          <span>New chat</span>
          <button className="k-icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="msg-picker">
          {picked.map((u) => (
            <span key={u.id} className="msg-chip">
              <Avatar name={u.display_name} id={u.id} size={20} />
              {u.display_name}
              <button aria-label={`Remove ${u.display_name}`} onClick={() => toggle(u)}>
                <X size={12} />
              </button>
            </span>
          ))}
          <span className="msg-picker-input">
            <Search size={14} />
            <input
              ref={inputRef}
              value={query}
              placeholder={picked.length ? 'Add someone else…' : 'Search by name or username'}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              spellCheck={false}
              aria-label="Search people"
              role="combobox"
              aria-expanded="true"
              aria-controls="msg-people-list"
              aria-activedescendant={list[cursor] ? `msg-person-${list[cursor].id}` : undefined}
            />
          </span>
        </div>

        <div className="msg-people" ref={listRef} id="msg-people-list" role="listbox" aria-multiselectable="true">
          {searchError ? (
            <div className="msg-people-state k-error">{searchError}</div>
          ) : results === null ? (
            <div className="msg-people-state">
              <LoaderCircle size={18} className="k-spin" />
            </div>
          ) : list.length === 0 ? (
            <div className="msg-people-state">
              {query.trim() ? (
                <>No one here matches “{query.trim()}”.</>
              ) : (
                <>
                  <Users size={22} />
                  <strong>Nobody else is here yet</strong>
                  <span>
                    People you can message need an account on this same KherveOS server. Ask them to open Messages here and
                    choose “Create one”.
                  </span>
                </>
              )}
            </div>
          ) : (
            list.map((u, i) => (
              <div
                key={u.id}
                id={`msg-person-${u.id}`}
                role="option"
                aria-selected={isPicked(u)}
                className={`msg-person${isPicked(u) ? ' picked' : ''}${i === cursor ? ' cursor' : ''}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => toggle(u)}
                onDoubleClick={() => void start([u])}
                title="Click to pick · double-click to chat right away"
              >
                <Avatar name={u.display_name} id={u.id} size={34} />
                <span className="msg-person-text">
                  <span className="msg-person-name">{u.display_name}</span>
                  <span className="msg-person-user">@{u.username}</span>
                </span>
                <span className="msg-check">{isPicked(u) && <Check size={13} />}</span>
              </div>
            ))
          )}
          {searching && results !== null && <LoaderCircle size={14} className="k-spin msg-people-busy" />}
        </div>

        {group && (
          <div className="msg-group-name">
            <input
              className="k-input"
              value={title}
              maxLength={100}
              placeholder="Group name (optional)"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void start(picked)}
            />
          </div>
        )}

        <div className="msg-dialog-foot">
          <span className={error ? 'k-error' : 'k-muted'}>{error ?? hint}</span>
          <button className="k-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="k-btn primary" disabled={!picked.length || busy} onClick={() => void start(picked)}>
            {busy && <LoaderCircle size={14} className="k-spin" />}
            {group ? 'Create group' : 'Start chat'}
          </button>
        </div>
      </div>
    </div>
  )
}
