// The left pane: new chat, search, and the saved chats (the files in
// ~/Documents/AI Chats, newest first, grouped by day).

import { useEffect, useMemo, useState } from 'react'
import { FileDown, FolderOpen, LoaderCircle, MessageSquare, MoreHorizontal, Pencil, Search, SquarePen, Trash2, X } from 'lucide-react'
import { HOME, fs, os, useDir, type MenuItem, type Stat } from '@/os'
import { exportChat } from './actions'
import { CHATS_DIR, deleteChat, newChat, openChatFile, promptRename, useAi } from './store'
import { shortWhen } from './util'

const stem = (name: string) => name.replace(/\.json$/i, '')

function groupOf(ms: number, now: number): string {
  const day = 86_400_000
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const t = start.getTime()
  if (ms >= t) return 'Today'
  if (ms >= t - day) return 'Yesterday'
  if (ms >= t - 7 * day) return 'Previous 7 days'
  if (ms >= t - 30 * day) return 'Previous 30 days'
  return 'Older'
}

/** Re-render every minute so "5 min ago" stays true. */
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(t)
  }, [])
  return now
}

export function Sidebar({ onPicked, onClose }: { onPicked: () => void; onClose?: () => void }) {
  const listing = useDir(CHATS_DIR)
  const paths = useAi((s) => s.paths)
  const running = useAi((s) => s.running)
  const activeId = useAi((s) => s.activeId)
  const active = useAi((s) => (s.activeId ? s.chats[s.activeId] : undefined))
  const [query, setQuery] = useState('')
  const now = useMinuteTick()

  const files = useMemo(
    () => (listing ?? []).filter((f) => f.type === 'file' && /\.json$/i.test(f.name) && !f.name.startsWith('.')).sort((a, b) => b.mtime - a.mtime),
    [listing],
  )
  const q = query.trim().toLowerCase()
  const shown = q ? files.filter((f) => stem(f.name).toLowerCase().includes(q)) : files
  const activePath = activeId ? paths[activeId] : undefined
  const idByPath = useMemo(() => new Map(Object.entries(paths).map(([id, p]) => [p, id])), [paths])
  const draft = active && (!activePath || !files.some((f) => f.path === activePath)) && !q ? active : null

  const groups = useMemo(() => {
    const out: { label: string; items: Stat[] }[] = []
    for (const f of shown) {
      const label = groupOf(f.mtime, now)
      const g = out[out.length - 1]
      if (g && g.label === label) g.items.push(f)
      else out.push({ label, items: [f] })
    }
    return out
  }, [shown, now])

  const open = async (path: string) => {
    if (await openChatFile(path)) onPicked()
  }

  const menuFor = (path: string): MenuItem[] => [
    { label: 'Open', icon: MessageSquare, onClick: () => void open(path) },
    { label: 'Rename…', icon: Pencil, onClick: () => void promptRename({ path }) },
    { label: 'Export as Markdown…', icon: FileDown, onClick: () => void exportChat({ path }) },
    { label: 'Show in Files', icon: FolderOpen, onClick: () => os.open('files', { path: CHATS_DIR }) },
    '-',
    { label: 'Delete…', icon: Trash2, danger: true, onClick: () => void deleteChat({ path }) },
  ]

  return (
    <aside className="kai-side" aria-label="Chats">
      <div className="kai-side-head">
        <button
          className="kai-new"
          onClick={() => {
            newChat()
            onPicked()
          }}
          title="Start a new chat"
        >
          <SquarePen size={15} />
          <span>New chat</span>
        </button>
        {onClose && (
          <button className="k-icon-btn" aria-label="Hide chats" title="Hide chats" onClick={onClose}>
            <X size={16} />
          </button>
        )}
      </div>

      {files.length > 0 && (
        <div className="kai-search">
          <Search size={13} className="kai-search-icon" />
          <input
            className="k-input"
            placeholder="Search chats"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            aria-label="Search chats"
            spellCheck={false}
          />
          {query && (
            <button className="k-icon-btn kai-search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
              <X size={12} />
            </button>
          )}
        </div>
      )}

      <div className="kai-chat-list">
        {draft && (
          <div className="kai-row active">
            <button className="kai-row-main" onClick={onPicked}>
              {running[draft.id] ? <LoaderCircle size={14} className="k-spin kai-row-icon" /> : <MessageSquare size={14} className="kai-row-icon" />}
              <span className="kai-row-title">{draft.title}</span>
            </button>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.label} className="kai-group">
            <div className="kai-group-label">{g.label}</div>
            {g.items.map((f) => {
              const id = idByPath.get(f.path)
              const busy = id ? !!running[id] : false
              const isActive = !!activePath && activePath === f.path
              return (
                <div
                  key={f.path}
                  className={`kai-row${isActive ? ' active' : ''}`}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    os.contextMenu(e, menuFor(f.path))
                  }}
                >
                  <button
                    className="kai-row-main"
                    onClick={() => void open(f.path)}
                    onDoubleClick={() => void promptRename({ path: f.path })}
                    title={`${stem(f.name)} — double-click to rename`}
                  >
                    {busy ? <LoaderCircle size={14} className="k-spin kai-row-icon" /> : <MessageSquare size={14} className="kai-row-icon" />}
                    <span className="kai-row-title">{stem(f.name)}</span>
                    <span className="kai-row-time">{shortWhen(f.mtime, now)}</span>
                  </button>
                  <button
                    className="kai-row-more"
                    aria-label={`More for ${stem(f.name)}`}
                    title="More"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect()
                      os.contextMenu({ clientX: r.left, clientY: r.bottom + 2 }, menuFor(f.path))
                    }}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                </div>
              )
            })}
          </div>
        ))}
        {!files.length && !draft && <div className="kai-side-empty">No chats yet.</div>}
        {!!q && !shown.length && <div className="kai-side-empty">No chats match “{query.trim()}”.</div>}
      </div>

      <button
        className="kai-side-foot"
        title="Open the chats folder in Files"
        onClick={() => os.open('files', { path: fs.isDir(CHATS_DIR) ? CHATS_DIR : `${HOME}/Documents` })}
      >
        <FolderOpen size={13} />
        <span>Saved in ~/Documents/AI Chats</span>
      </button>
    </aside>
  )
}
