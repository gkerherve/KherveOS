// Menus and messages shared by the list, the reader and the menu bar.

import { Archive, CircleAlert, Flag, FolderInput, Mail, MailOpen, Trash2 } from 'lucide-react'
import { os } from '@/os'
import type { MenuItem } from '@/os'
import { errorMessage, type MessageSummary } from './api'
import type { MailStore } from './store'
import { folderIcon, folderLabel, folderRows } from './util'

export function failure(title: string, err: unknown) {
  os.notify({ title, body: errorMessage(err), icon: CircleAlert, color: 'var(--k-danger)' })
}

/** "Move to" items: every other folder of the open folder's account. */
export function moveMenuItems(store: MailStore, uid: number | number[]): MenuItem[] {
  const s = store.getState()
  const current = s.current
  const folders = current ? s.folders[current.accountId] : undefined
  const items: MenuItem[] =
    current && folders
      ? folderRows(folders)
          .filter((r) => r.folder.selectable && r.folder.raw !== current.folder)
          .map((r) => ({
            label: ' '.repeat(r.indent) + folderLabel(r.folder),
            icon: folderIcon(r.folder),
            onClick: () => void store.getState().takeOut(uid, r.folder.raw),
          }))
      : []
  return items.length ? items : [{ label: 'No other folders', disabled: true }]
}

/** Where "Archive" puts a message of the open folder: the Archive folder (Gmail: All Mail), unless it is open. */
export function archiveTarget(store: MailStore): string | null {
  const s = store.getState()
  const cur = s.current
  const folders = cur ? s.folders[cur.accountId] : undefined
  if (!cur || !folders) return null
  const target = folders.find((f) => f.role === 'archive' && f.selectable) ?? folders.find((f) => f.role === 'all' && f.selectable)
  const here = folders.find((f) => f.raw === cur.folder)
  if (!target || target.raw === cur.folder || here?.role === 'sent' || here?.role === 'drafts' || here?.role === 'trash') return null
  return target.raw
}

export function archiveMessages(store: MailStore, uids: number[]) {
  const to = archiveTarget(store)
  if (to && uids.length) void store.getState().takeOut(uids, to)
}

/** Delete: to the Trash, or — from the Trash, or without one — for good, after asking. */
export async function deleteMessages(store: MailStore, uids: number[]) {
  const s = store.getState()
  const cur = s.current
  if (!cur || !uids.length) return
  const folders = s.folders[cur.accountId]
  const here = folders?.find((f) => f.raw === cur.folder)
  const permanent = here?.role === 'trash' || (!!folders && !folders.some((f) => f.role === 'trash' && f.selectable))
  if (
    permanent &&
    !(await os.dialog.confirm(
      uids.length === 1 ? 'Delete this message for good? It cannot be recovered.' : `Delete these ${uids.length} messages for good? They cannot be recovered.`,
      { title: uids.length === 1 ? 'Delete message' : 'Delete messages', okLabel: 'Delete', danger: true },
    ))
  )
    return
  await store.getState().takeOut(uids, null)
}

export const deleteMessage = (store: MailStore, uid: number) => deleteMessages(store, [uid])

/** The actions on one message (right-click in the list, Message menu). */
export function messageMenuItems(store: MailStore, m: Pick<MessageSummary, 'uid' | 'seen' | 'flagged'>): MenuItem[] {
  const s = store.getState()
  const canArchive = !!archiveTarget(store)
  return [
    {
      label: m.seen ? 'Mark as Unread' : 'Mark as Read',
      icon: m.seen ? Mail : MailOpen,
      onClick: () => void s.setFlags(m.uid, { seen: !m.seen }),
    },
    { label: m.flagged ? 'Remove Flag' : 'Flag', icon: Flag, onClick: () => void s.setFlags(m.uid, { flagged: !m.flagged }) },
    ...(canArchive ? [{ label: 'Archive', icon: Archive, onClick: () => archiveMessages(store, [m.uid]) }] : []),
    { label: 'Move to', icon: FolderInput, submenu: moveMenuItems(store, m.uid) },
    '-',
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => void deleteMessage(store, m.uid) },
  ]
}

/** Open a menu under the button that was clicked. */
export function menuBelow(e: React.MouseEvent, items: MenuItem[]) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  os.contextMenu({ clientX: r.left, clientY: r.bottom + 4 }, items)
}
