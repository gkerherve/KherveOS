// Side panes: Navigation (headings), Comments & Changes, and the Find bar.

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { Check, CaseSensitive, ChevronDown, ChevronUp, MessageSquare, Regex, Trash, WholeWord, X, CheckCheck } from 'lucide-react'
import type { Comment } from '../model'
import { findNext, findState, replaceAll, replaceCurrent, setFind, type FindQuery } from '../editor/find'
import { listChanges, listCommentRanges, reviewChanges } from '../editor/tracking'

export function NavigationPane({ headings, current, onGo, onClose }: { headings: { text: string; level: number; pos: number }[]; current: number; onGo: (pos: number) => void; onClose: () => void }) {
  return (
    <aside className="kw-side kw-nav">
      <div className="kw-side-title">
        <span>Navigation</span>
        <button className="k-icon-btn" aria-label="Close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="kw-side-body">
        {!headings.length && <p className="k-muted kw-hint">Headings appear here. Use the Heading 1, Heading 2… styles to give the document an outline.</p>}
        {headings.map((h, i) => (
          <button key={`${h.pos}-${i}`} className={`kw-nav-item${i === current ? ' active' : ''}`} style={{ paddingLeft: 8 + (h.level - 1) * 14 }} onClick={() => onGo(h.pos)} title={h.text}>
            {h.text}
          </button>
        ))}
      </div>
    </aside>
  )
}

function ago(date: string): string {
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function CommentsPane({
  editor, comments, focusId, onChange, onDelete, onClose, version,
}: {
  editor: Editor
  comments: Record<string, Comment>
  focusId: string | null
  onChange: (id: string, c: Comment) => void
  onDelete: (id: string) => void
  onClose: () => void
  version: number
}) {
  void version
  const ranges = listCommentRanges(editor.state)
  const changes = listChanges(editor.state.doc)
  const [tab, setTab] = useState<'comments' | 'changes'>('comments')
  const select = (from: number, to: number) => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)).scrollIntoView())
    editor.view.focus()
  }
  const sel = editor.state.selection
  return (
    <aside className="kw-side kw-comments">
      <div className="kw-side-title">
        <span className="kw-side-tabs">
          <button className={tab === 'comments' ? 'active' : ''} onClick={() => setTab('comments')}>
            Comments ({ranges.filter((r) => comments[r.id]).length})
          </button>
          <button className={tab === 'changes' ? 'active' : ''} onClick={() => setTab('changes')}>
            Changes ({changes.length})
          </button>
        </span>
        <button className="k-icon-btn" aria-label="Close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="kw-side-body">
        {tab === 'comments' && (
          <>
            {!ranges.length && <p className="k-muted kw-hint">No comments. Select some text and choose Review › New Comment (⌥⌘M).</p>}
            {ranges.map((r) => {
              const c = comments[r.id]
              if (!c) return null
              const here = sel.from <= r.to && sel.to >= r.from
              return (
                <div key={r.id} className={`kw-card${here ? ' active' : ''}${c.done ? ' done' : ''}`} onClick={() => select(r.from, r.to)}>
                  <div className="kw-card-head">
                    <MessageSquare size={13} />
                    <b>{c.author || 'Someone'}</b>
                    <span className="k-muted">{ago(c.date)}</span>
                    <span style={{ flex: 1 }} />
                    <button className="k-icon-btn" title={c.done ? 'Reopen' : 'Resolve'} onClick={(e) => (e.stopPropagation(), onChange(r.id, { ...c, done: !c.done }))}>
                      <Check size={13} />
                    </button>
                    <button className="k-icon-btn" title="Delete comment" onClick={(e) => (e.stopPropagation(), onDelete(r.id))}>
                      <Trash size={13} />
                    </button>
                  </div>
                  <div className="kw-card-quote">“{r.text.slice(0, 80)}{r.text.length > 80 ? '…' : ''}”</div>
                  <CommentText value={c.text} autoFocus={focusId === r.id} onCommit={(text) => text !== c.text && onChange(r.id, { ...c, text })} />
                </div>
              )
            })}
          </>
        )}
        {tab === 'changes' && (
          <>
            {changes.length > 0 && (
              <div className="kw-card-actions">
                <button className="k-btn small" onClick={() => reviewChanges(editor.view, true, 'all')}>
                  <CheckCheck size={13} /> Accept all
                </button>
                <button className="k-btn small" onClick={() => reviewChanges(editor.view, false, 'all')}>
                  <X size={13} /> Reject all
                </button>
              </div>
            )}
            {!changes.length && <p className="k-muted kw-hint">No tracked changes. Turn on Review › Track Changes to record insertions and deletions.</p>}
            {changes.map((c, i) => (
              <div key={`${c.id}-${i}`} className={`kw-card kw-change ${c.kind}`} onClick={() => select(c.from, c.to)}>
                <div className="kw-card-head">
                  <b>{c.author || 'Someone'}</b>
                  <span className="k-muted">{c.kind === 'insertion' ? 'Inserted' : 'Deleted'} · {ago(c.date)}</span>
                  <span style={{ flex: 1 }} />
                  <button className="k-icon-btn" title="Accept" onClick={(e) => (e.stopPropagation(), reviewChanges(editor.view, true, { id: c.id }))}>
                    <Check size={13} />
                  </button>
                  <button className="k-icon-btn" title="Reject" onClick={(e) => (e.stopPropagation(), reviewChanges(editor.view, false, { id: c.id }))}>
                    <X size={13} />
                  </button>
                </div>
                <div className="kw-card-quote">{c.text.slice(0, 120)}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  )
}

function CommentText({ value, autoFocus, onCommit }: { value: string; autoFocus: boolean; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setV(value), [value])
  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])
  return (
    <textarea
      ref={ref}
      className="k-input kw-comment-text"
      rows={2}
      placeholder="Write a comment…"
      value={v}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          onCommit(v)
          ;(e.target as HTMLTextAreaElement).blur()
        }
      }}
    />
  )
}

export function FindBar({ editor, replace: showReplace0, onClose, version }: { editor: Editor; replace: boolean; onClose: () => void; version: number }) {
  void version
  const [q, setQ] = useState<FindQuery>({ text: '', matchCase: false, wholeWord: false, regex: false })
  const [by, setBy] = useState('')
  const [showReplace, setShowReplace] = useState(showReplace0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => setShowReplace((s) => s || showReplace0), [showReplace0])
  useEffect(() => {
    // Start from the selected text.
    const { from, to, empty } = editor.state.selection
    if (!empty && to - from < 200) {
      const text = editor.state.doc.textBetween(from, to, ' ')
      setQ((x) => ({ ...x, text }))
      setFind(editor.view, { ...q, text })
    }
    input.current?.focus()
    input.current?.select()
    return () => setFind(editor.view, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const update = (next: FindQuery) => {
    setQ(next)
    setFind(editor.view, next.text ? next : null)
  }
  const st = findState(editor.state)
  const count = st?.matches.length ?? 0
  const current = st && st.current >= 0 ? st.current + 1 : 0
  return (
    <div className="kw-findbar" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="kw-find-line">
        <input
          ref={input}
          className="k-input"
          placeholder="Find in document"
          value={q.text}
          onChange={(e) => update({ ...q, text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              findNext(editor.view, e.shiftKey ? -1 : 1)
            }
          }}
        />
        <span className="kw-find-count">{q.text ? (count ? `${current} of ${count}` : 'No results') : ''}</span>
        <button className={`k-icon-btn${q.matchCase ? ' active' : ''}`} title="Match case" onClick={() => update({ ...q, matchCase: !q.matchCase })}>
          <CaseSensitive size={15} />
        </button>
        <button className={`k-icon-btn${q.wholeWord ? ' active' : ''}`} title="Whole words" onClick={() => update({ ...q, wholeWord: !q.wholeWord })}>
          <WholeWord size={15} />
        </button>
        <button className={`k-icon-btn${q.regex ? ' active' : ''}`} title="Regular expression" onClick={() => update({ ...q, regex: !q.regex })}>
          <Regex size={15} />
        </button>
        <button className="k-icon-btn" title="Previous (⇧Enter)" onClick={() => findNext(editor.view, -1)}>
          <ChevronUp size={15} />
        </button>
        <button className="k-icon-btn" title="Next (Enter)" onClick={() => findNext(editor.view, 1)}>
          <ChevronDown size={15} />
        </button>
        <button className="k-link-btn" onClick={() => setShowReplace((s) => !s)}>
          {showReplace ? 'Hide replace' : 'Replace'}
        </button>
        <button className="k-icon-btn" title="Close (Esc)" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      {showReplace && (
        <div className="kw-find-line">
          <input className="k-input" placeholder="Replace with" value={by} onChange={(e) => setBy(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && replaceCurrent(editor.view, by)} />
          <button className="k-btn small" disabled={!count} onClick={() => replaceCurrent(editor.view, by)}>
            Replace
          </button>
          <button className="k-btn small" disabled={!count} onClick={() => replaceAll(editor.view, q, by)}>
            Replace All
          </button>
        </div>
      )}
    </div>
  )
}
