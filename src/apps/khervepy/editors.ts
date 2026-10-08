// The editor tabs: open files, save (and auto-save), ask before losing edits,
// follow renames, reload what other apps (or git) change on the drive.

import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { os, fs, path } from '@/os'
import { languageForExtension, type EditorLanguage } from '@/os/ui/CodeEditor'

export interface EditorTab {
  id: string
  /** null: not saved yet ("untitled"). */
  path: string | null
  title: string
  text: string
  /** What is on the drive; null when it isn't (never saved, or deleted meanwhile). */
  saved: string | null
  language: EditorLanguage
  /** Changed by another app while edited here. */
  diskChanged: boolean
}

export function isDirty(t: EditorTab): boolean {
  return t.saved === null ? t.text !== '' : t.text !== t.saved
}

const MAX_SIZE = 5 * 1024 * 1024
let nextId = 1

function tabFor(p: string | null, text: string, saved: string | null): EditorTab {
  return {
    id: `t${nextId++}`,
    path: p,
    title: p ? path.basename(p) : 'untitled',
    text,
    saved,
    language: p ? languageForExtension(path.extname(p)) : 'python',
    diskChanged: false,
  }
}

function looksBinary(data: Uint8Array): boolean {
  const n = Math.min(data.length, 8000)
  for (let i = 0; i < n; i++) if (data[i] === 0) return true
  return false
}

export interface Editors {
  tabs: EditorTab[]
  active: EditorTab | null
  activeId: string | null
  activate(id: string): void
  open(p: string, opts?: { line?: number }): Promise<boolean>
  newFile(text?: string): void
  setText(id: string, text: string): void
  /** Resolves to the path saved to, or null (cancelled / failed). */
  save(id?: string): Promise<string | null>
  saveAs(id?: string): Promise<string | null>
  saveAll(): Promise<boolean>
  close(id?: string): Promise<boolean>
  closeMany(ids: string[]): Promise<boolean>
  /** Save what auto-save may save; returns the tabs that still have unsaved edits. */
  flush(): Promise<EditorTab[]>
  goToLine(id: string, line: number): void
  registerView(id: string, view: EditorView): void
  view(id?: string | null): EditorView | null
  reloadFromDisk(id: string): Promise<void>
}

export function useEditors(opts: { autoSave: boolean; defaultDir: () => string; status: (msg: string) => void }): Editors {
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const live = useRef({ tabs, activeId, opts })
  live.current = { tabs, activeId, opts }
  const views = useRef(new Map<string, EditorView>())
  const pendingLine = useRef(new Map<string, number>())
  /** The last text this window wrote to each path (its own saves come back as change events). */
  const ownWrites = useRef(new Map<string, string>())
  /** Opens in progress, so a double click doesn't open a file twice. */
  const opening = useRef(new Map<string, Promise<boolean>>())

  const update = useCallback((id: string, fn: (t: EditorTab) => EditorTab) => {
    setTabs((list) => list.map((t) => (t.id === id ? fn(t) : t)))
  }, [])
  const find = (id?: string | null) => live.current.tabs.find((t) => t.id === (id ?? live.current.activeId)) ?? null

  const goToLine = useCallback((id: string, line: number) => {
    const view = views.current.get(id)
    if (!view) {
      pendingLine.current.set(id, line)
      return
    }
    const doc = view.state.doc
    const pos = doc.line(Math.max(1, Math.min(doc.lines, line))).from
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
    view.focus()
  }, [])

  const load = useCallback(async (p: string, o: { line?: number }): Promise<boolean> => {
    const st = fs.stat(p)
    if (!st || st.type !== 'file') {
      await os.dialog.alert(`“${p}” doesn’t exist any more.`, { title: 'kPY' })
      return false
    }
    if (st.size > MAX_SIZE) {
      const go = await os.dialog.confirm(`${path.basename(p)} is ${(st.size / 2 ** 20).toFixed(1)} MB. Open it anyway?`, { title: 'Large file', okLabel: 'Open' })
      if (!go) return false
    }
    const data = await fs.readBytes(p)
    if (looksBinary(data)) {
      const other = await os.dialog.confirm(`${path.basename(p)} isn’t a text file. Open it with its own app instead?`, { title: 'kPY', okLabel: 'Open' })
      if (other) void os.openFile(p)
      return false
    }
    const tab = tabFor(p, new TextDecoder().decode(data), null)
    tab.saved = tab.text
    setTabs((list) => [...list, tab])
    setActiveId(tab.id)
    if (o.line) pendingLine.current.set(tab.id, o.line)
    return true
  }, [])

  const open = useCallback(
    async (p: string, o: { line?: number } = {}): Promise<boolean> => {
      const existing = live.current.tabs.find((t) => t.path === p)
      if (existing) {
        setActiveId(existing.id)
        if (o.line) goToLine(existing.id, o.line)
        return true
      }
      const pending = opening.current.get(p)
      if (pending) return pending
      // Forget the open only after React has shown the new tab (live.current then has it).
      const job = load(p, o).finally(() => setTimeout(() => opening.current.delete(p), 50))
      opening.current.set(p, job)
      return job
    },
    [goToLine, load],
  )

  const newFile = useCallback((text = '') => {
    const tab = tabFor(null, text, null)
    setTabs((list) => [...list, tab])
    setActiveId(tab.id)
  }, [])

  const setText = useCallback((id: string, text: string) => update(id, (t) => (t.text === text ? t : { ...t, text })), [update])

  const write = useCallback(
    async (tab: EditorTab, target: string): Promise<boolean> => {
      const text = tab.text
      ownWrites.current.set(target, text)
      try {
        await fs.writeText(target, text)
      } catch (e) {
        await os.dialog.alert(`Could not save ${path.basename(target)}: ${e instanceof Error ? e.message : String(e)}`, { title: 'Save failed' })
        return false
      }
      update(tab.id, (t) => ({
        ...t,
        path: target,
        title: path.basename(target),
        language: languageForExtension(path.extname(target)),
        saved: text,
        diskChanged: false,
      }))
      return true
    },
    [update],
  )

  const saveAs = useCallback(
    async (id?: string): Promise<string | null> => {
      const tab = find(id)
      if (!tab) return null
      const target = await os.dialog.saveFile({
        title: 'Save As',
        defaultName: tab.path ?? path.join(live.current.opts.defaultDir(), 'untitled.py'),
      })
      if (!target || !(await write(tab, target))) return null
      live.current.opts.status(`Saved ${path.pretty(target)}`)
      return target
    },
    [write],
  )

  const save = useCallback(
    async (id?: string): Promise<string | null> => {
      const tab = find(id)
      if (!tab) return null
      if (!tab.path || !fs.isDir(path.dirname(tab.path))) return saveAs(tab.id)
      if (!(await write(tab, tab.path))) return null
      live.current.opts.status(`Saved ${path.pretty(tab.path)}`)
      return tab.path
    },
    [saveAs, write],
  )

  const saveAll = useCallback(async () => {
    for (const t of live.current.tabs) if (isDirty(t) && !(await save(t.id))) return false
    return true
  }, [save])

  /** Auto-save: what can be written silently is written; the rest is returned. */
  const flush = useCallback(async () => {
    const left: EditorTab[] = []
    for (const t of live.current.tabs) {
      if (!isDirty(t)) continue
      if (live.current.opts.autoSave && t.path && t.saved !== null && fs.isDir(path.dirname(t.path)) && (await write(t, t.path))) continue
      left.push(t)
    }
    return left
  }, [write])

  const drop = useCallback((ids: string[]) => {
    const gone = new Set(ids)
    for (const id of ids) {
      views.current.delete(id)
      pendingLine.current.delete(id)
    }
    setTabs((list) => {
      const idx = list.findIndex((t) => t.id === live.current.activeId)
      const rest = list.filter((t) => !gone.has(t.id))
      if (gone.has(live.current.activeId ?? '')) {
        const next = rest[Math.min(Math.max(0, idx - 1), rest.length - 1)] ?? null
        setActiveId(next?.id ?? null)
      }
      return rest
    })
  }, [])

  const closeMany = useCallback(
    async (ids: string[]): Promise<boolean> => {
      for (const id of ids) {
        const tab = live.current.tabs.find((t) => t.id === id)
        if (!tab || !isDirty(tab)) continue
        if (live.current.opts.autoSave && tab.path && tab.saved !== null && (await write(tab, tab.path))) continue
        setActiveId(tab.id)
        const choice = await os.dialog.choose(
          `Save the changes to “${tab.title}” before closing?`,
          [
            { label: 'Cancel', value: 'cancel' },
            { label: 'Don’t Save', value: 'discard', danger: true },
            { label: 'Save', value: 'save', primary: true },
          ],
          { title: 'Unsaved changes' },
        )
        if (choice === 'save') {
          if (!(await save(tab.id))) return false
        } else if (choice !== 'discard') return false
      }
      drop(ids)
      return true
    },
    [drop, save, write],
  )

  const close = useCallback(async (id?: string) => {
    const tab = find(id)
    return tab ? closeMany([tab.id]) : true
  }, [closeMany])

  const reloadFromDisk = useCallback(async (id: string) => {
    const tab = find(id)
    if (!tab?.path || !fs.isFile(tab.path)) return
    const text = await fs.readText(tab.path)
    update(id, (t) => ({ ...t, text, saved: text, diskChanged: false }))
  }, [update])

  // Debounced auto-save of files that already have a place on the drive.
  useEffect(() => {
    if (!opts.autoSave) return
    const due = tabs.filter((t) => t.path && t.saved !== null && t.text !== t.saved && !t.diskChanged)
    if (!due.length) return
    const timer = window.setTimeout(() => {
      for (const t of due) {
        const current = live.current.tabs.find((x) => x.id === t.id)
        if (current?.path && current.saved !== null && current.text !== current.saved && fs.isDir(path.dirname(current.path))) void write(current, current.path)
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [tabs, opts.autoSave, write])

  // Follow the drive: renames, deletions, and changes made by other apps (or git).
  useEffect(
    () =>
      fs.watch((ev) => {
        const list = live.current.tabs
        if (ev.type === 'rename') {
          for (const t of list) {
            if (t.path && path.isInside(t.path, ev.oldPath)) {
              const p = ev.path + t.path.slice(ev.oldPath.length)
              update(t.id, (x) => ({ ...x, path: p, title: path.basename(p), language: languageForExtension(path.extname(p)) }))
            }
          }
        } else if (ev.type === 'delete') {
          const hit = list.filter((t) => t.path && path.isInside(t.path, ev.path))
          const clean = hit.filter((t) => !isDirty(t)).map((t) => t.id)
          if (clean.length) drop(clean)
          for (const t of hit) if (isDirty(t)) update(t.id, (x) => ({ ...x, saved: null }))
        } else if (ev.kind === 'file') {
          const t = list.find((x) => x.path === ev.path)
          if (!t) return
          void fs.readText(ev.path).then((content) => {
            const cur = live.current.tabs.find((x) => x.id === t.id)
            if (!cur || cur.path !== ev.path) return
            if (content === cur.text) {
              if (cur.saved !== content) update(cur.id, (x) => ({ ...x, saved: content, diskChanged: false }))
            } else if (content === cur.saved || content === ownWrites.current.get(ev.path)) {
              // our own save (typing went on meanwhile); nothing to do
            } else if (!isDirty(cur)) {
              update(cur.id, (x) => ({ ...x, text: content, saved: content, diskChanged: false }))
            } else if (!cur.diskChanged) {
              update(cur.id, (x) => ({ ...x, diskChanged: true }))
              live.current.opts.status(`${cur.title} was changed by another app — your edits are kept (File › Reload from Disk to take theirs).`)
            }
          }, () => {})
        }
      }),
    [drop, update],
  )

  const registerView = useCallback(
    (id: string, view: EditorView) => {
      views.current.set(id, view)
      const line = pendingLine.current.get(id)
      if (line) {
        pendingLine.current.delete(id)
        requestAnimationFrame(() => goToLine(id, line))
      }
    },
    [goToLine],
  )

  return {
    tabs,
    active: tabs.find((t) => t.id === activeId) ?? null,
    activeId,
    activate: setActiveId,
    open,
    newFile,
    setText,
    save,
    saveAs,
    saveAll,
    close,
    closeMany,
    flush,
    goToLine,
    registerView,
    view: (id) => views.current.get(id ?? live.current.activeId ?? '') ?? null,
    reloadFromDisk,
  }
}
