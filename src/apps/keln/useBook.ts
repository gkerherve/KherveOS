// The open notebook as React state: the file, unsaved-changes tracking, debounced auto-save, the close guard,
// recent notebooks and the optional daily backup in ~/Documents/kELN Backups.

import { useCallback, useEffect, useRef, useState } from 'react'
import { fs, os, path as osPath, HOME, type WindowApi } from '@/os'
import { KelnError, parseKeln, serializeKeln, systemCtx, type Ctx, type Notebook } from './model'
import { safeName } from './files'

export interface Book {
  nb: Notebook | null
  path: string | null
  rev: number
  savedRev: number
}

export const NOTEBOOK_DIR = `${HOME}/Documents/kELN`
export const BACKUP_DIR = `${HOME}/Documents/kELN Backups`
const RECENT_KEY = 'kherveos.keln.recent'
const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, 12) : []
  } catch { return [] }
}

function pushRecent(path: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([path, ...loadRecent().filter((p) => p !== path)].slice(0, 12))) } catch { /* storage blocked */ }
}

const empty: Book = { nb: null, path: null, rev: 0, savedRev: 0 }

export function useBook(o: { win: WindowApi; user: string; backup: boolean; flush: () => void }) {
  const [book, setBook] = useState<Book>(empty)
  const live = useRef<Book>(empty)
  const opts = useRef(o)
  opts.current = o
  const set = useCallback((b: Book) => { live.current = b; setBook(b) }, [])
  const lastBackup = useRef('')

  const makeCtx = useCallback((): Ctx => systemCtx(opts.current.user), [])

  /** Changes the notebook through a pure operation; a rule that is broken (KelnError) is shown to the user and nothing changes. */
  const commit = useCallback((fn: (nb: Notebook, ctx: Ctx) => Notebook): Notebook | null => {
    const cur = live.current
    if (!cur.nb) return null
    try {
      const next = fn(cur.nb, makeCtx())
      if (next !== cur.nb) set({ ...cur, nb: next, rev: cur.rev + 1 })
      return next
    } catch (e) {
      if (e instanceof KelnError) { void os.dialog.alert(e.message, { title: 'kELN' }); return null }
      throw e
    }
  }, [makeCtx, set])

  const backupNow = useCallback(async (nb: Notebook, force = false) => {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const name = `${safeName(nb.title)}-${day}.keln`
    if (!force && lastBackup.current === `${name}:${live.current.rev}`) return
    try {
      await fs.writeText(osPath.join(BACKUP_DIR, name), serializeKeln(nb), { mkdirs: true })
      lastBackup.current = `${name}:${live.current.rev}`
    } catch { /* a backup that cannot be written is not worth interrupting the work */ }
  }, [])

  const save = useCallback(async (): Promise<boolean> => {
    opts.current.flush()
    const cur = live.current
    if (!cur.nb || !cur.path) return true
    const rev = live.current.rev
    const nb = live.current.nb!
    try {
      await fs.writeText(cur.path, serializeKeln(nb), { mkdirs: true })
    } catch (e) {
      os.notify({ title: 'kELN could not save', body: msgOf(e) })
      return false
    }
    set({ ...live.current, savedRev: Math.max(live.current.savedRev, rev) })
    if (opts.current.backup) void backupNow(nb)
    return true
  }, [backupNow, set])

  const openNotebook = useCallback((nb: Notebook, path: string | null, dirty = false) => {
    set({ nb, path, rev: dirty ? 1 : 0, savedRev: 0 })
    opts.current.win.setDocumentPath(path)
    if (path) pushRecent(path)
  }, [set])

  const openPath = useCallback(async (path: string): Promise<boolean> => {
    try {
      if (!fs.exists(path)) throw new KelnError(`${path} does not exist any more.`)
      openNotebook(parseKeln(await fs.readText(path)), path)
      return true
    } catch (e) {
      await os.dialog.alert(`Could not open “${osPath.basename(path)}”: ${msgOf(e)}`, { title: 'Open notebook' })
      return false
    }
  }, [openNotebook])

  /** Puts a notebook that was changed from outside (the AI tools) in the window. */
  const replace = useCallback((nb: Notebook, saved: boolean) => {
    const cur = live.current
    set({ ...cur, nb, rev: cur.rev + 1, savedRev: saved ? cur.rev + 1 : cur.savedRev })
  }, [set])

  const closeBook = useCallback(() => {
    set(empty)
    opts.current.win.setDocumentPath(null)
  }, [set])

  /** True when it is fine to leave the current notebook (it was saved, or the user chose not to). */
  const confirmLeave = useCallback(async (): Promise<boolean> => {
    opts.current.flush()
    const cur = live.current
    if (!cur.nb || cur.rev === cur.savedRev) return true
    if (await save()) return true
    const choice = await os.dialog.choose(`“${cur.nb.title}” could not be saved. Leave it anyway and lose the latest changes?`, [{ label: 'Stay', value: 'stay', primary: true }, { label: 'Discard changes', value: 'discard', danger: true }], { title: 'Unsaved changes' })
    return choice === 'discard'
  }, [save])

  // auto-save
  useEffect(() => {
    if (!book.nb || !book.path || book.rev === book.savedRev) return
    const t = window.setTimeout(() => { void save() }, 1500)
    return () => window.clearTimeout(t)
  }, [book.rev, book.savedRev, book.nb, book.path, save])

  // the close guard
  useEffect(() => {
    const win = o.win
    win.setCloseGuard(async () => {
      opts.current.flush()
      const cur = live.current
      if (!cur.nb || cur.rev === cur.savedRev) return true
      if (await save()) return true
      const choice = await os.dialog.choose(`“${cur.nb.title}” has changes that could not be saved. Close anyway?`, [{ label: 'Cancel', value: 'cancel', primary: true }, { label: 'Close without saving', value: 'discard', danger: true }], { title: 'Unsaved changes' })
      return choice === 'discard'
    })
    return () => win.setCloseGuard(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.win])

  return { book, live, commit, save, backupNow, openNotebook, openPath, closeBook, confirmLeave, makeCtx, replace }
}

/** Where a new notebook file goes: a free name in the folder. */
export function freeNotebookPath(dir: string, title: string): string {
  return osPath.join(dir, fs.uniqueName(dir, `${safeName(title)}.keln`))
}
