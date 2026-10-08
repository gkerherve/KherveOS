// The notebook: calculations pinned from the other tools, to copy or export.

import { Copy, Download, NotebookPen, Pencil, Trash2 } from 'lucide-react'
import { stamp, type NotebookEntry } from './notebook'
import { Card } from './ui'

export interface NotebookActions {
  entries: NotebookEntry[]
  copyEntry(e: NotebookEntry): void
  copyAll(format: 'md' | 'txt'): void
  rename(e: NotebookEntry): void
  remove(e: NotebookEntry): void
  clear(): void
  exportAs(format: 'md' | 'txt'): void
}

export function NotebookTool({ a }: { a: NotebookActions }) {
  const { entries } = a
  return (
    <div className="kc-tool-body">
      <Card
        title={`Notebook (${entries.length})`}
        icon={<NotebookPen size={15} />}
        actions={
          <>
            <button className="k-btn small" disabled={!entries.length} onClick={() => a.copyAll('md')} title="Copy everything as Markdown"><Copy size={13} /> Copy as Markdown</button>
            <button className="k-btn small" disabled={!entries.length} onClick={() => a.copyAll('txt')} title="Copy everything as plain text"><Copy size={13} /> Copy as text</button>
            <button className="k-btn small primary" disabled={!entries.length} onClick={() => a.exportAs('md')} title="Save as a .md or .txt file"><Download size={13} /> Export…</button>
            <button className="k-btn small danger" disabled={!entries.length} onClick={a.clear}><Trash2 size={13} /> Clear</button>
          </>
        }
      >
        {entries.length === 0 && (
          <div className="k-muted kc-empty">
            Nothing pinned yet. Press <b>Pin</b> next to any result (or ⌘D) to keep it here with a label; the notebook is saved on this computer.
          </div>
        )}
        {[...entries].reverse().map((e) => (
          <article key={e.id} className="kc-note">
            <header className="kc-note-head">
              <div>
                <b>{e.label}</b>
                <div className="k-muted kc-small">{e.tool} · {stamp(e.time)}</div>
              </div>
              <div className="kc-actions">
                <button className="k-icon-btn" aria-label="Rename" title="Rename" onClick={() => a.rename(e)}><Pencil size={14} /></button>
                <button className="k-icon-btn" aria-label="Copy" title="Copy" onClick={() => a.copyEntry(e)}><Copy size={14} /></button>
                <button className="k-icon-btn" aria-label="Delete" title="Delete" onClick={() => a.remove(e)}><Trash2 size={14} /></button>
              </div>
            </header>
            <pre className="kc-note-text">{e.text}</pre>
          </article>
        ))}
      </Card>
    </div>
  )
}
