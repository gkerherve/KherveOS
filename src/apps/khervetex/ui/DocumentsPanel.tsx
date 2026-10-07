// The "Documents" dock of the desktop main window (mainwindow.py
// _ProjectSidebar in a QDockWidget): always there, listing the open document,
// or a project's documents once there is more than one. "+ Add" makes the
// document a project (New document… / Existing file…).

import { useState } from 'react'
import { os, type MenuItem } from '@/os'

export interface ChapterView {
  label: string
  enabled: boolean
  /** "Ch. 2 — ", "App. A — ", "◇ "… */
  prefix: string
  /** "  pp. 3–7  (5p)" once compiled. */
  pages: string
}

export interface ProjectView {
  title: string
  summary: string
  autoPages: boolean
  chapters: ChapterView[]
  active: number
}

export function DocumentsPanel({
  name, project, onClose, onFloat, onAddNew, onAddExisting, onOpen, onToggle, onMove, onRemove, onCompile, onAutoPages,
  chapterMenu,
}: {
  /** The open document (single-document mode). */
  name: string
  project: ProjectView | null
  onClose: () => void
  onFloat: () => void
  onAddNew: () => void
  onAddExisting: () => void
  onOpen: (i: number) => void
  onToggle: (i: number, enabled: boolean) => void
  onMove: (i: number, delta: number) => void
  onRemove: (i: number) => void
  onCompile: () => void
  onAutoPages: (on: boolean) => void
  /** The right-click menu of a project document. */
  chapterMenu: (i: number) => MenuItem[]
}) {
  const [current, setCurrent] = useState(0)
  const addMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    os.contextMenu({ clientX: r.left, clientY: r.bottom }, [
      { label: 'New document…', onClick: onAddNew },
      { label: 'Existing file…', onClick: onAddExisting },
    ])
  }
  return (
    <div className="ktx-dock">
      <div className="ktx-dock-title">
        <span>Documents</span>
        <span style={{ flex: 1 }} />
        <button className="ktx-dock-btn" title="Float" onClick={onFloat}>
          <svg viewBox="0 0 10 10" width="10" height="10"><rect x="1.5" y="3.5" width="5" height="5" fill="none" stroke="currentColor" /><path d="M3.5 3.5V1.5h5v5h-2" fill="none" stroke="currentColor" /></svg>
        </button>
        <button className="ktx-dock-btn" title="Close" onClick={onClose}>
          <svg viewBox="0 0 10 10" width="10" height="10"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
      </div>
      <div className="ktx-dock-body">
        {project && (
          <>
            <div className="ktx-proj-title">{project.title}</div>
            <div className="ktx-proj-summary">{project.summary}</div>
            <label
              className="ktx-tb-check"
              title={'Automatically compute each chapter\'s start page from the\ncumulative page counts of preceding chapters.\nPage counts update after every compilation.'}
            >
              <input type="checkbox" checked={project.autoPages} onChange={(e) => onAutoPages(e.target.checked)} />
              Auto page numbers
            </label>
          </>
        )}
        <div
          className="ktx-doclist"
          tabIndex={0}
          onContextMenu={(e) => {
            e.preventDefault()
            if (!project) os.contextMenu(e, [{ label: 'Add document…', onClick: onAddNew }])
          }}
        >
          {!project && (
            <div className="ktx-docitem active">
              <span className="ktx-docicon" aria-hidden>
                <svg viewBox="0 0 12 14" width="11" height="13"><path d="M1 .5h6.5L11 4v9.5H1z" fill="#f4f4f4" stroke="#9aa3ad" /><path d="M7.5.5V4H11" fill="none" stroke="#9aa3ad" /></svg>
              </span>
              {name}
            </div>
          )}
          {project?.chapters.map((ch, i) => (
            <div
              key={i}
              className={`ktx-docitem${i === project.active ? ' active' : ''}${i === current ? ' current' : ''}${ch.enabled ? '' : ' off'}`}
              onClick={() => setCurrent(i)}
              onDoubleClick={() => onOpen(i)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setCurrent(i)
                os.contextMenu(e, chapterMenu(i))
              }}
            >
              <input type="checkbox" checked={ch.enabled} onChange={(e) => onToggle(i, e.target.checked)} onClick={(e) => e.stopPropagation()} />
              <span>{ch.prefix}{ch.label}{ch.pages}</span>
            </div>
          ))}
        </div>
        {project && (
          <div className="ktx-dock-row">
            <button className="ktx-pbtn" title="Move selected chapter up" onClick={() => {
              onMove(current, -1)
              setCurrent((c) => Math.max(0, c - 1))
            }}>▲ Up</button>
            <button className="ktx-pbtn" title="Move selected chapter down" onClick={() => {
              onMove(current, 1)
              setCurrent((c) => Math.min(project.chapters.length - 1, c + 1))
            }}>▼ Down</button>
            <button className="ktx-pbtn" title="Remove the selected document from the project (its file is kept on disk)" onClick={() => onRemove(current)}>✕ Remove</button>
          </div>
        )}
        <div className="ktx-dock-row">
          <button
            className="ktx-pbtn ktx-add"
            title="Add another document (chapter). A single document becomes a project the first time you add one."
            onClick={addMenu}
          >
            + Add
            <span className="ktx-menu-arrow" aria-hidden>
              <svg viewBox="0 0 8 5" width="8" height="5"><path d="M0 0h8L4 5z" fill="currentColor" /></svg>
            </span>
          </button>
          {project && <button className="ktx-pbtn" onClick={onCompile}>▶ Compile</button>}
        </div>
      </div>
    </div>
  )
}
