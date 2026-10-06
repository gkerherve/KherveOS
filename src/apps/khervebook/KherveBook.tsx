// KherveBook: Jupyter-style notebooks with Python (Pyodide, in a worker),
// Markdown and LaTeX cells. The web version of the desktop KherveBook; it
// reads and writes the same .kbook files and imports Jupyter .ipynb.

import './khervebook.css'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useStore } from 'zustand'
import { redo, selectAll, undo } from '@codemirror/commands'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowDown, ArrowUp, Code, Eraser, FastForward, FileDown, FilePlus, FolderOpen, Keyboard, ListRestart, LoaderCircle,
  Pilcrow, Play, Plus, Power, RotateCcw, Save, Sigma, Square, Trash2, Undo2,
} from 'lucide-react'
import { os, type AppProps, type MenuBarMenu, type MenuItem } from '@/os'
import { basename, pretty } from '@/os/path'
import type { KernelStatus } from '@/os/python/kernel'
import { CellView } from './CellView'
import type { CellType } from './format'
import { Notebook, STARTING_NOTE, displayName } from './notebook'

// ---------------------------------------------------------------- shortcuts

const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent)

function keyLabel(k: string, m: { mod?: boolean; shift?: boolean; alt?: boolean } = {}): string {
  if (MAC) return `${m.alt ? '⌥' : ''}${m.shift ? '⇧' : ''}${m.mod ? '⌘' : ''}${k === 'Enter' ? '↵' : k}`
  return [m.mod && 'Ctrl', m.alt && 'Alt', m.shift && 'Shift', k].filter(Boolean).join('+')
}

const KEYS = {
  open: keyLabel('O', { mod: true }),
  save: keyLabel('S', { mod: true }),
  saveAs: keyLabel('S', { mod: true, shift: true }),
  run: keyLabel('Enter', { mod: true }),
  runNext: keyLabel('Enter', { shift: true }),
  runInsert: keyLabel('Enter', { alt: true }),
  undo: keyLabel('Z', { mod: true }),
  redo: keyLabel('Z', { mod: true, shift: true }),
  selectAll: keyLabel('A', { mod: true }),
}

function Shortcuts() {
  const groups: [string, [string, string][]][] = [
    [
      'Running',
      [
        [KEYS.runNext, 'Run the cell and go to the next one'],
        [KEYS.run, 'Run the cell'],
        [KEYS.runInsert, 'Run the cell and add a new one below'],
      ],
    ],
    [
      'Command mode (press Esc in a cell)',
      [
        ['Enter', 'Edit the selected cell'],
        ['↑  ↓', 'Select the cell above / below'],
        ['A  B', 'Add a code cell above / below'],
        ['Y  M  L', 'Make the cell Code / Markdown / LaTeX'],
        ['D D', 'Delete the cell'],
        ['Z', 'Bring back the deleted cell'],
      ],
    ],
    [
      'File',
      [
        [KEYS.save, 'Save'],
        [KEYS.saveAs, 'Save as'],
        [KEYS.open, 'Open'],
      ],
    ],
  ]
  return (
    <div className="nb-keys">
      {groups.map(([title, rows]) => (
        <div key={title}>
          <h4>{title}</h4>
          <table>
            <tbody>
              {rows.map(([k, what]) => (
                <tr key={k}>
                  <td>
                    <kbd>{k}</kbd>
                  </td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p className="nb-keys-note">
        Install pure-Python packages from PyPI with <code>%pip install name</code> in a cell. numpy, scipy, pandas and matplotlib load by
        themselves when you import them.
      </p>
    </div>
  )
}

// ----------------------------------------------------------------- toolbar

function TbButton(props: { icon: LucideIcon; label?: string; optionalLabel?: boolean; title: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  const { icon: Icon, label, title, onClick, disabled, primary, optionalLabel } = props
  return (
    <button
      className={`nb-tb-btn${label ? ' labeled' : ''}${primary ? ' primary' : ''}`}
      title={title}
      aria-label={label ?? title}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={15} />
      {label && <span className={`nb-tb-label${optionalLabel ? ' optional' : ''}`}>{label}</span>}
    </button>
  )
}

const STATUS_LABEL: Record<KernelStatus, string> = { off: 'off', starting: 'starting…', idle: 'idle', busy: 'busy', dead: 'stopped' }

function KernelPill({ status, version, pyodide, onStart }: { status: KernelStatus; version: string | null; pyodide: string | null; onStart: () => void }) {
  const startable = status === 'off' || status === 'dead'
  const title =
    status === 'off'
      ? 'Python starts when you run a cell (the first start downloads about 10 MB). Click to start it now.'
      : status === 'starting'
        ? STARTING_NOTE
        : status === 'dead'
          ? 'Python stopped. Click to start it again.'
          : `Python ${version ?? ''}${pyodide ? ` (Pyodide ${pyodide})` : ''}, ${status}`
  return (
    <button className={`nb-kernel ${status}${startable ? ' startable' : ''}`} title={title} onClick={startable ? onStart : undefined}>
      <span className="nb-kernel-dot" />
      <span className="nb-kernel-name">Python{version ? ` ${version}` : ''}</span>
      <span className="nb-kernel-state">{STATUS_LABEL[status]}</span>
    </button>
  )
}

/** Toolbar and menu buttons must not take the focus away from the cell being edited. */
function keepFocus(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('button')) e.preventDefault()
}

// --------------------------------------------------------------------- app

export default function KherveBook({ win, args }: AppProps) {
  const [nb] = useState(() => new Notebook(`nb-${win.id}`, !!args.path))
  const cells = useStore(nb.store, (s) => s.cells)
  const selectedId = useStore(nb.store, (s) => s.selectedId)
  const loading = useStore(nb.store, (s) => s.loading)
  const dirty = useStore(nb.store, (s) => s.dirty)
  const path = useStore(nb.store, (s) => s.path)
  const origin = useStore(nb.store, (s) => s.origin)
  const status = useStore(nb.store, (s) => s.status)
  const pyVersion = useStore(nb.store, (s) => s.pyVersion)
  const pyodideVersion = useStore(nb.store, (s) => s.pyodideVersion)
  const progress = useStore(nb.store, (s) => s.progress)
  const flash = useStore(nb.store, (s) => s.flash)
  const pending = useStore(nb.store, (s) => s.pending)
  const canUndoDelete = useStore(nb.store, (s) => s.canUndoDelete)

  const selIndex = cells.findIndex((c) => c.id === selectedId)
  const selType: CellType | null = selIndex >= 0 ? cells[selIndex].type : null
  const count = cells.length
  const busy = pending > 0
  const kernelOn = status === 'idle' || status === 'busy' || status === 'starting'
  const name = loading && args.path ? basename(args.path) : displayName({ path, origin })
  // Recomputed when the notebook moves (path / origin change).
  const baseDir = useMemo(() => nb.baseDir(), [nb, path, origin])

  // Python lives as long as the window.
  useEffect(() => {
    nb.mount()
    return () => nb.unmount()
  }, [nb])

  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    if (args.path) void nb.openPath(args.path)
    else nb.refocus()
  }, [nb, args.path])

  useEffect(() => {
    win.setTitle(`${dirty ? '• ' : ''}${name} — KherveBook`)
  }, [win, dirty, name])
  // So opening this file again (e.g. after Save As) focuses this window.
  useEffect(() => win.setDocumentPath(path ?? origin), [win, path, origin])

  useEffect(() => {
    win.setCloseGuard(() => nb.confirmClose())
    return () => win.setCloseGuard(null)
  }, [win, nb])

  /** Run something that opens a dialog, then give the focus back to the notebook. */
  const withDialog = (fn: () => Promise<unknown>) => () => void fn().finally(() => nb.refocusSoon())

  // ------------------------------------------------------------ menus

  const menus = useMemo<MenuBarMenu[]>(() => {
    // Clicking the top bar takes the focus away from the notebook: hand it back afterwards.
    const act = (fn: () => void) => () => {
      fn()
      nb.refocusSoon()
    }
    const after = (fn: () => Promise<unknown>) => () => void fn().finally(() => nb.refocusSoon())
    const typeItem = (t: CellType, label: string): MenuItem => ({ label, checked: selType === t, disabled: !selType, onClick: act(() => nb.setType(t)) })
    return [
      {
        label: 'File',
        items: [
          { label: 'New Notebook', icon: FilePlus, onClick: () => os.open('khervebook') },
          { label: 'Open…', icon: FolderOpen, shortcut: KEYS.open, onClick: () => void nb.open() },
          '-',
          { label: 'Save', icon: Save, shortcut: KEYS.save, onClick: after(() => nb.save()) },
          { label: 'Save As…', shortcut: KEYS.saveAs, onClick: after(() => nb.saveAs()) },
          { label: 'Export as Jupyter Notebook…', icon: FileDown, onClick: after(() => nb.exportIpynb()) },
          '-',
          { label: 'Close Window', onClick: () => win.close() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo Typing', shortcut: KEYS.undo, disabled: !selType, onClick: () => nb.editorCommand(undo) },
          { label: 'Redo Typing', shortcut: KEYS.redo, disabled: !selType, onClick: () => nb.editorCommand(redo) },
          { label: 'Select All in Cell', shortcut: KEYS.selectAll, disabled: !selType, onClick: () => nb.editorCommand(selectAll) },
          '-',
          { label: 'Move Cell Up', icon: ArrowUp, disabled: selIndex <= 0, onClick: act(() => nb.move(-1)) },
          { label: 'Move Cell Down', icon: ArrowDown, disabled: selIndex < 0 || selIndex >= count - 1, onClick: act(() => nb.move(1)) },
          '-',
          { label: 'Delete Cell', icon: Trash2, shortcut: 'D D', disabled: !selType, onClick: act(() => nb.remove()) },
          { label: 'Undo Delete Cell', icon: Undo2, shortcut: 'Z', disabled: !canUndoDelete, onClick: act(() => nb.undoDelete()) },
          '-',
          { label: 'Clear Output', disabled: selType !== 'code', onClick: act(() => nb.clearOutputs(nb.state.selectedId ?? undefined)) },
          { label: 'Clear All Outputs', icon: Eraser, onClick: act(() => nb.clearOutputs()) },
        ],
      },
      {
        label: 'Cell',
        items: [
          { label: 'Run Cell', icon: Play, shortcut: KEYS.run, disabled: !selType, onClick: act(() => nb.run(undefined, 'stay')) },
          { label: 'Run Cell and Select Next', shortcut: KEYS.runNext, disabled: !selType, onClick: act(() => nb.run(undefined, 'advance')) },
          { label: 'Run Cell and Insert Below', shortcut: KEYS.runInsert, disabled: !selType, onClick: act(() => nb.run(undefined, 'insert')) },
          { label: 'Run All', icon: FastForward, onClick: act(() => nb.runAll()) },
          '-',
          { label: 'Add Code Cell Below', icon: Code, shortcut: 'B', onClick: act(() => nb.insert('code')) },
          { label: 'Add Code Cell Above', shortcut: 'A', onClick: act(() => nb.insert('code', 'above')) },
          { label: 'Add Markdown Cell Below', icon: Pilcrow, onClick: act(() => nb.insert('markdown')) },
          { label: 'Add LaTeX Cell Below', icon: Sigma, onClick: act(() => nb.insert('latex')) },
          '-',
          { label: 'Cell Type', submenu: [typeItem('code', 'Code'), typeItem('markdown', 'Markdown'), typeItem('latex', 'LaTeX')] },
        ],
      },
      {
        label: 'Kernel',
        items: [
          { label: 'Start Python', icon: Power, disabled: kernelOn, onClick: act(() => nb.startKernel()) },
          { label: 'Interrupt', icon: Square, disabled: !busy, onClick: after(() => nb.interrupt()) },
          '-',
          { label: 'Restart…', icon: RotateCcw, disabled: status === 'off', onClick: after(() => nb.restart()) },
          { label: 'Restart and Run All…', icon: ListRestart, onClick: after(() => nb.restart(true, true)) },
        ],
      },
      {
        label: 'Help',
        items: [{ label: 'KherveBook Shortcuts', icon: Keyboard, onClick: after(() => os.dialog.alert(<Shortcuts />, { title: 'KherveBook shortcuts' })) }],
      },
    ]
  }, [nb, win, selType, selIndex, count, canUndoDelete, busy, kernelOn, status])

  useEffect(() => {
    win.setMenus(menus)
  }, [win, menus])
  useEffect(() => () => win.setMenus(null), [win])

  // --------------------------------------------------------- keyboard

  const lastD = useRef(0)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    if (mod && !e.altKey && k === 's') {
      e.preventDefault()
      withDialog(() => (e.shiftKey ? nb.saveAs() : nb.save()))()
      return
    }
    if (mod && !e.altKey && !e.shiftKey && k === 'o') {
      e.preventDefault()
      void nb.open()
      return
    }
    // Command mode: a cell itself has the focus (not its editor).
    const t = e.target as HTMLElement
    if (!t.classList.contains('nb-cell')) return
    const id = nb.state.selectedId
    if (!id) return
    let handled = true
    if (k === 'Enter') {
      if (e.shiftKey) nb.run(id, 'advance')
      else if (mod) nb.run(id, 'stay')
      else if (e.altKey) nb.run(id, 'insert')
      else nb.focus(id, 'edit')
    } else if (mod || e.altKey) handled = false
    else if (k === 'ArrowUp' || (k === 'k' && !e.shiftKey)) nb.focusSibling(id, -1, 'command')
    else if (k === 'ArrowDown' || (k === 'j' && !e.shiftKey)) nb.focusSibling(id, 1, 'command')
    else if (e.shiftKey) handled = false
    else if (k === 'a') nb.insert('code', 'above', 'command')
    else if (k === 'b') nb.insert('code', 'below', 'command')
    else if (k === 'y') nb.setType('code')
    else if (k === 'm') nb.setType('markdown')
    else if (k === 'l') nb.setType('latex')
    else if (k === 'z') nb.undoDelete()
    else if (k === 'd') {
      const now = Date.now()
      if (now - lastD.current < 700) {
        lastD.current = 0
        nb.remove(id)
      } else lastD.current = now
    } else handled = false
    if (handled) e.preventDefault()
  }

  // ------------------------------------------------------------- view

  const location = path ? pretty(path) : origin ? `${pretty(origin)} · Jupyter notebook, Save makes a .kbook copy` : 'Not saved yet'
  const message =
    progress ?? (status === 'starting' ? STARTING_NOTE : null) ?? flash ?? (pending > 1 ? `Running · ${pending - 1} more waiting` : pending === 1 ? 'Running…' : null)
  const spinning = !!progress || status === 'starting' || (busy && message !== flash)

  return (
    <div className="k-app nb-app" onKeyDown={onKeyDown}>
      <div className="k-toolbar nb-toolbar" onMouseDown={keepFocus}>
        <TbButton icon={FilePlus} title="New notebook (opens a new window)" onClick={() => os.open('khervebook')} />
        <TbButton icon={FolderOpen} title={`Open… (${KEYS.open})`} onClick={() => void nb.open()} />
        <TbButton icon={Save} title={`Save (${KEYS.save})`} onClick={withDialog(() => nb.save())} />
        <span className="k-sep" />
        <TbButton icon={Plus} label="Code" title="Add a code cell below" onClick={() => nb.insert('code')} />
        <TbButton icon={Plus} label="Markdown" title="Add a Markdown cell below" onClick={() => nb.insert('markdown')} />
        <TbButton icon={Plus} label="LaTeX" title="Add a LaTeX cell below" onClick={() => nb.insert('latex')} />
        <span className="k-sep" />
        <select
          className="k-input nb-type-select"
          value={selType ?? 'code'}
          disabled={!selType}
          title="Cell type"
          aria-label="Cell type"
          onChange={(e) => nb.setType(e.target.value as CellType)}
        >
          <option value="code">Code</option>
          <option value="markdown">Markdown</option>
          <option value="latex">LaTeX</option>
        </select>
        <TbButton icon={ArrowUp} title="Move the cell up" disabled={selIndex <= 0} onClick={() => nb.move(-1)} />
        <TbButton icon={ArrowDown} title="Move the cell down" disabled={selIndex < 0 || selIndex >= count - 1} onClick={() => nb.move(1)} />
        <TbButton icon={Trash2} title="Delete the cell" disabled={!selType} onClick={() => nb.remove()} />
        <span className="k-sep" />
        <TbButton
          icon={Play}
          label="Run"
          optionalLabel
          primary
          title={`Run the cell (${KEYS.run}). ${KEYS.runNext} runs it and moves on.`}
          disabled={!selType}
          onClick={() => nb.run(undefined, 'stay')}
        />
        <TbButton icon={FastForward} label="Run all" optionalLabel title="Run all cells, starting from fresh variables" onClick={() => nb.runAll()} />
        <TbButton icon={Square} title="Interrupt: cancel the cells waiting to run (a running cell can only be stopped by restarting Python)" disabled={!busy} onClick={withDialog(() => nb.interrupt())} />
        <TbButton icon={RotateCcw} title="Restart Python…" disabled={status === 'off'} onClick={withDialog(() => nb.restart())} />
        <TbButton icon={Eraser} title="Clear all outputs" onClick={() => nb.clearOutputs()} />
        <span className="k-spacer" />
        <KernelPill status={status} version={pyVersion} pyodide={pyodideVersion} onStart={() => nb.startKernel()} />
      </div>

      <div className="nb-scroll">
        {loading ? (
          <div className="nb-loading">
            <LoaderCircle size={18} className="k-spin" />
            Opening {name}…
          </div>
        ) : (
          <div className="nb-page">
            {cells.map((c) => (
              <CellView key={c.id} cell={c} selected={c.id === selectedId} nb={nb} baseDir={baseDir} />
            ))}
            <div className="nb-add-row" onMouseDown={keepFocus}>
              <button className="nb-add-btn" onClick={() => nb.insert('code', 'end')}>
                <Plus size={14} /> Code
              </button>
              <button className="nb-add-btn" onClick={() => nb.insert('markdown', 'end')}>
                <Plus size={14} /> Markdown
              </button>
              <button className="nb-add-btn" onClick={() => nb.insert('latex', 'end')}>
                <Plus size={14} /> LaTeX
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="k-statusbar nb-statusbar">
        <span className="nb-sb-file" title={path ?? origin ?? undefined}>
          {location}
        </span>
        <span className="nb-sb-msg">
          {message && spinning && <LoaderCircle size={12} className="k-spin" />}
          {message}
        </span>
        <span>{selIndex >= 0 ? `Cell ${selIndex + 1} of ${count}` : `${count} cells`}</span>
      </div>
    </div>
  )
}
