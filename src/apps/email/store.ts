// The Email window's state: accounts, folders, the open folder's message list
// and the message being read. One store per window (created when the app
// mounts, dropped when it closes or the user signs out).

import { createContext, useContext } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import { errorMessage, mail, MailApiError, type Account, type Folder, type MessageDetail, type MessageSummary } from './api'

export const PAGE = 50

export interface FolderRef {
  accountId: number
  folder: string
}

type Flags = { seen?: boolean; flagged?: boolean; answered?: boolean }

export interface MailState {
  accounts: Account[] | null
  accountsError: string | null
  folders: Record<number, Folder[] | undefined>
  folderErrors: Record<number, string | undefined>

  current: FolderRef | null
  query: string
  items: MessageSummary[]
  total: number
  listLoading: boolean
  listError: string | null
  loadingMore: boolean

  selected: number | null
  detail: MessageDetail | null
  detailLoading: boolean
  detailError: string | null

  checking: boolean
  lastChecked: number | null

  loadAccounts(): Promise<void>
  loadFolders(accountId: number): Promise<void>
  openFolder(ref: FolderRef): void
  search(query: string): void
  refresh(): Promise<void>
  loadMore(): Promise<void>
  select(uid: number | null): Promise<void>
  setFlags(uid: number, flags: Flags): Promise<void>
  /** Delete (to the Trash) or move a message out of the open folder. */
  takeOut(uid: number, to: string | null): Promise<void>
  /** Look for new mail in every inbox; `notify` announces it. */
  check(notify: boolean): Promise<void>
  accountAdded(account: Account): void
  accountUpdated(account: Account): void
  removeAccount(id: number): Promise<void>
  /** A message was answered from the reply window. */
  markAnswered(ref: FolderRef, uid: number): void
}

export interface MailDeps {
  onNewMail(account: Account, messages: MessageSummary[]): void
  onError(title: string, err: unknown): void
}

export type MailStore = StoreApi<MailState>

export function createMailStore(deps: MailDeps): MailStore {
  let listSeq = 0
  let detailSeq = 0
  /** The newest INBOX message we know of, per account: anything above it is new mail. */
  const baselines = new Map<number, { uidvalidity: number | null; maxUid: number }>()

  return createStore<MailState>()((set, get) => {
    const isCurrent = (ref: FolderRef) => {
      const cur = get().current
      return !!cur && cur.accountId === ref.accountId && cur.folder === ref.folder
    }

    const patchFolder = (ref: FolderRef, fn: (f: Folder) => Folder) => {
      const list = get().folders[ref.accountId]
      if (list) set({ folders: { ...get().folders, [ref.accountId]: list.map((f) => (f.raw === ref.folder ? fn(f) : f)) } })
    }
    const bumpUnread = (ref: FolderRef, delta: number) =>
      patchFolder(ref, (f) => (f.unread == null ? f : { ...f, unread: Math.max(0, f.unread + delta) }))
    const patchItem = (uid: number, patch: Partial<MessageSummary>) =>
      set({ items: get().items.map((m) => (m.uid === uid ? { ...m, ...patch } : m)) })

    const noteBaseline = (accountId: number, uidvalidity: number | null, messages: MessageSummary[]) => {
      const max = messages.reduce((n, m) => Math.max(n, m.uid), 0)
      const prev = baselines.get(accountId)
      if (!prev || prev.uidvalidity !== uidvalidity || max > prev.maxUid) baselines.set(accountId, { uidvalidity, maxUid: max })
    }

    const loadList = async (mode: 'open' | 'refresh' | 'more') => {
      const { current, query, items } = get()
      if (!current) return
      const seq = mode === 'more' ? listSeq : ++listSeq
      const offset = mode === 'more' ? items.length : 0
      const limit = mode === 'refresh' ? Math.min(200, Math.max(PAGE, items.length)) : PAGE
      set(mode === 'more' ? { loadingMore: true } : { listLoading: true })
      try {
        const page = await mail.messages(current.accountId, current.folder, { offset, limit, q: query })
        if (seq !== listSeq) return // another folder, search or refresh started meanwhile
        if (mode === 'more') {
          const known = new Set(get().items.map((m) => m.uid))
          set({ items: [...get().items, ...page.messages.filter((m) => !known.has(m.uid))], total: page.total, loadingMore: false })
        } else {
          // The message being opened is read now, even if the list was fetched just before.
          const open = get().selected
          const items = page.messages.map((m) => (m.uid === open && !m.seen ? { ...m, seen: true } : m))
          set({ items, total: page.total, listLoading: false, listError: null })
        }
        if (current.folder === 'INBOX' && !query && offset === 0) noteBaseline(current.accountId, page.uidvalidity, page.messages)
      } catch (err) {
        if (seq !== listSeq) return
        if (mode === 'more') {
          set({ loadingMore: false })
          deps.onError('Could not load more messages', err)
        } else set({ listLoading: false, listError: errorMessage(err) })
      }
    }

    const clearReader = { selected: null, detail: null, detailError: null, detailLoading: false }

    return {
      accounts: null,
      accountsError: null,
      folders: {},
      folderErrors: {},
      current: null,
      query: '',
      items: [],
      total: 0,
      listLoading: false,
      listError: null,
      loadingMore: false,
      selected: null,
      detail: null,
      detailLoading: false,
      detailError: null,
      checking: false,
      lastChecked: null,

      async loadAccounts() {
        set({ accountsError: null })
        try {
          const accounts = await mail.accounts()
          set({ accounts })
          for (const a of accounts) void get().loadFolders(a.id)
          const cur = get().current
          if (!cur || !accounts.some((a) => a.id === cur.accountId)) {
            if (accounts.length) get().openFolder({ accountId: accounts[0].id, folder: 'INBOX' })
            else set({ current: null, items: [], total: 0, ...clearReader })
          }
        } catch (err) {
          set({ accountsError: errorMessage(err) })
        }
      },

      async loadFolders(accountId) {
        try {
          const folders = await mail.folders(accountId)
          set({
            folders: { ...get().folders, [accountId]: folders },
            folderErrors: { ...get().folderErrors, [accountId]: undefined },
          })
        } catch (err) {
          set({ folderErrors: { ...get().folderErrors, [accountId]: errorMessage(err) } })
        }
      },

      openFolder(ref) {
        detailSeq++
        set({ current: ref, query: '', items: [], total: 0, listError: null, loadingMore: false, ...clearReader })
        void loadList('open')
      },

      search(query) {
        const q = query.trim()
        if (q === get().query) return
        detailSeq++
        set({ query: q, items: [], total: 0, listError: null, loadingMore: false, ...clearReader })
        void loadList('open')
      },

      async refresh() {
        const cur = get().current
        if (cur) void get().loadFolders(cur.accountId)
        await loadList('refresh')
      },
      loadMore: () => loadList('more'),

      async select(uid) {
        const seq = ++detailSeq
        const cur = get().current
        if (uid == null || !cur) {
          set(clearReader)
          return
        }
        const keep = get().detail?.uid === uid ? get().detail : null
        set({ selected: uid, detail: keep, detailLoading: true, detailError: null })
        const item = get().items.find((m) => m.uid === uid)
        const wasUnread = !!item && !item.seen
        if (wasUnread) {
          // Opening a message marks it read on the server.
          patchItem(uid, { seen: true })
          bumpUnread(cur, -1)
        }
        try {
          const detail = await mail.message(cur.accountId, cur.folder, uid)
          if (seq !== detailSeq) return
          set({ detail, detailLoading: false })
        } catch (err) {
          if (seq !== detailSeq) return
          set({ detailLoading: false, detailError: errorMessage(err) })
          if (err instanceof MailApiError && err.kind === 'gone') {
            // Deleted or moved elsewhere (another device): it leaves the list too.
            set({ items: get().items.filter((m) => m.uid !== uid), total: Math.max(0, get().total - (item ? 1 : 0)) })
          } else if (wasUnread) {
            patchItem(uid, { seen: false })
            bumpUnread(cur, +1)
          }
        }
      },

      async setFlags(uid, flags) {
        const cur = get().current
        if (!cur) return
        const before = get().items.find((m) => m.uid === uid)
        const detail = get().detail
        const apply = (f: Flags, unreadDelta: number) => {
          patchItem(uid, f)
          const d = get().detail
          if (d?.uid === uid) set({ detail: { ...d, ...f } })
          if (unreadDelta) bumpUnread(cur, unreadDelta)
        }
        const delta = before && flags.seen !== undefined && flags.seen !== before.seen ? (flags.seen ? -1 : 1) : 0
        apply(flags, delta)
        try {
          await mail.setFlags(cur.accountId, cur.folder, uid, flags)
        } catch (err) {
          const undo: Flags = {}
          const was = before ?? detail
          if (was) for (const k of Object.keys(flags) as (keyof Flags)[]) undo[k] = was[k]
          if (isCurrent(cur)) apply(undo, -delta)
          deps.onError('Could not update the message', err)
        }
      },

      async takeOut(uid, to) {
        const cur = get().current
        if (!cur) return
        const items = get().items
        const index = items.findIndex((m) => m.uid === uid)
        const item = items[index]
        const next = items[index + 1] ?? items[index - 1] ?? null
        set({ items: items.filter((m) => m.uid !== uid), total: Math.max(0, get().total - (item ? 1 : 0)) })
        if (item && !item.seen) bumpUnread(cur, -1)
        if (get().selected === uid) void get().select(next ? next.uid : null)
        try {
          if (to === null) await mail.remove(cur.accountId, cur.folder, uid)
          else await mail.move(cur.accountId, cur.folder, uid, to)
        } catch (err) {
          deps.onError(to === null ? 'Could not delete the message' : 'Could not move the message', err)
          if (isCurrent(cur)) void loadList('refresh')
        }
        void get().loadFolders(cur.accountId)
      },

      async check(notify) {
        if (get().checking) return
        set({ checking: true })
        for (const account of get().accounts ?? []) {
          try {
            const page = await mail.messages(account.id, 'INBOX', { limit: 20 })
            const prev = baselines.get(account.id)
            const fresh =
              prev && prev.uidvalidity === page.uidvalidity ? page.messages.filter((m) => m.uid > prev.maxUid && !m.seen) : []
            noteBaseline(account.id, page.uidvalidity, page.messages)
            if (fresh.length && notify) deps.onNewMail(account, fresh)
            const cur = get().current
            if (cur && cur.accountId === account.id && cur.folder === 'INBOX' && !get().query) {
              // Merge: new messages on top, flags changed elsewhere (another device) updated.
              const byUid = new Map(page.messages.map((m) => [m.uid, m]))
              const items = get().items
              const top = items[0]?.uid ?? 0
              const added = page.messages.filter((m) => m.uid > top)
              const updated = items.map((m) => {
                const s = byUid.get(m.uid)
                return s && (s.seen !== m.seen || s.flagged !== m.flagged || s.answered !== m.answered)
                  ? { ...m, seen: s.seen, flagged: s.flagged, answered: s.answered }
                  : m
              })
              if (added.length || updated.some((m, i) => m !== items[i])) {
                set({ items: [...added, ...updated], total: page.total })
              }
            }
          } catch {
            // The server or the mail provider is unreachable: try again next time.
          }
          if (notify) void get().loadFolders(account.id) // fresh unread counts
        }
        set({ checking: false, lastChecked: Date.now() })
      },

      accountAdded(account) {
        set({ accounts: [...(get().accounts ?? []), account] })
        void get().loadFolders(account.id)
        get().openFolder({ accountId: account.id, folder: 'INBOX' })
      },

      accountUpdated(account) {
        set({ accounts: (get().accounts ?? []).map((a) => (a.id === account.id ? account : a)) })
        void get().loadFolders(account.id)
      },

      async removeAccount(id) {
        await mail.removeAccount(id)
        baselines.delete(id)
        const accounts = (get().accounts ?? []).filter((a) => a.id !== id)
        const folders = { ...get().folders }
        delete folders[id]
        set({ accounts, folders })
        if (get().current?.accountId === id) {
          if (accounts.length) get().openFolder({ accountId: accounts[0].id, folder: 'INBOX' })
          else set({ current: null, items: [], total: 0, ...clearReader })
        }
      },

      markAnswered(ref, uid) {
        if (!isCurrent(ref)) return
        patchItem(uid, { answered: true })
        const d = get().detail
        if (d?.uid === uid) set({ detail: { ...d, answered: true } })
      },
    }
  })
}

export const MailContext = createContext<MailStore | null>(null)

export function useMailStore(): MailStore {
  const store = useContext(MailContext)
  if (!store) throw new Error('The Email store is missing')
  return store
}

export function useMail<T>(selector: (s: MailState) => T): T {
  return useStore(useMailStore(), selector)
}
