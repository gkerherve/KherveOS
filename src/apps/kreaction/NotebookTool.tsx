// The notebook: results, structures and charts pinned from the other tools; copy as Markdown or export a report.

import { Copy, Download, NotebookPen, Pencil, Trash2 } from 'lucide-react'
import { stamp, type NotebookEntry } from './notebook'
import { svgDataUri } from './svgtheme'
import { Card, useKr } from './ui'

interface Actions {
  copyEntry(e: NotebookEntry): void
  copyAll(format: 'md' | 'txt'): void
  rename(e: NotebookEntry): void
  remove(e: NotebookEntry): void
  clear(): void
  exportAs(): void
}

export function NotebookTool({ a }: { a: Actions }) {
  const kr = useKr()
  const entries = kr.ws.notebook
  return (
    <div className="kr-tool-body">
      <Card
        title={`Notebook (${entries.length})`}
        icon={<NotebookPen size={15} />}
        actions={
          <>
            <button className="k-btn small" disabled={entries.length === 0} onClick={() => a.copyAll('md')} title="Copy everything as Markdown"><Copy size={13} /> Copy as Markdown</button>
            <button className="k-btn small" disabled={entries.length === 0} onClick={a.exportAs} title="Save the notebook as a Markdown file with the pictures embedded"><Download size={13} /> Export…</button>
            <button className="k-btn small" disabled={entries.length === 0} onClick={a.clear} title="Remove every entry"><Trash2 size={13} /> Clear</button>
          </>
        }
      >
        {entries.length === 0 && (
          <div className="k-muted kr-empty">
            Nothing pinned yet. Use the Pin button on a result (a balanced reaction, a mechanism, a simulation, a fit, an energy profile) to keep it here, then export everything as a Markdown report.
          </div>
        )}
        {entries.map((e) => (
          <article className="kr-note" key={e.id}>
            <header className="kr-note-head">
              <div>
                <b>{e.label}</b>
                <div className="k-muted kr-small">{e.tool} · {stamp(e.time)}</div>
              </div>
              <div className="kr-actions">
                <button className="k-icon-btn" onClick={() => a.copyEntry(e)} title="Copy this entry" aria-label="Copy this entry"><Copy size={14} /></button>
                <button className="k-icon-btn" onClick={() => a.rename(e)} title="Rename" aria-label="Rename"><Pencil size={14} /></button>
                <button className="k-icon-btn" onClick={() => a.remove(e)} title="Remove" aria-label="Remove"><Trash2 size={14} /></button>
              </div>
            </header>
            {(e.svgs ?? []).map((svg, i) => (
              // pictures from a .kreact file are shown as images, never as markup, so a file cannot run anything
              <img className="kr-note-pic" key={i} src={svgDataUri(svg)} alt={e.label} />
            ))}
            <pre className="kr-note-text">{e.text}</pre>
          </article>
        ))}
      </Card>
    </div>
  )
}
