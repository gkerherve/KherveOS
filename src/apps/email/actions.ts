// Menus and messages shared by the list, the reader and the menu bar.

import { CircleAlert, Flag, FolderInput, Mail, MailOpen, Trash2 } from 'lucide-react'
import { os } from '@/os'
import type { MenuItem } from '@/os'
import { errorMessage, type MessageSummary } from './api'
import type { MailStore } from './store'
import { folderIcon, folderLabel, folderRows } from './util'

export function failure(title: string, err: unknown) {
  os.notify({ title, body: errorMessage(err), icon: CircleAlert, color: 'var(--k-danger)' })
}

/** "Move to" items: every other folder of the open folder's account. */
export function moveMenuItems(store: MailStore, uid: number): MenuItem[] {
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

/** Delete: to the Trash, or — from the Trash, or without one — for good, after asking. */
export async function deleteMessage(store: MailStore, uid: number) {
  const s = store.getState()
  const cur = s.current
  if (!cur) return
  const folders = s.folders[cur.accountId]
  const here = folders?.find((f) => f.raw === cur.folder)
  const permanent = here?.role === 'trash' || (!!folders && !folders.some((f) => f.role === 'trash' && f.selectable))
  if (
    permanent &&
    !(await os.dialog.confirm('Delete this message for good? It cannot be recovered.', {
      title: 'Delete message',
      okLabel: 'Delete',
      danger: true,
    }))
  )
    return
  await store.getState().takeOut(uid, null)
}

/** The actions on one message (right-click in the list, Message menu). */
export function messageMenuItems(store: MailStore, m: Pick<MessageSummary, 'uid' | 'seen' | 'flagged'>): MenuItem[] {
  const s = store.getState()
  return [
    {
      label: m.seen ? 'Mark as Unread' : 'Mark as Read',
      icon: m.seen ? Mail : MailOpen,
      onClick: () => void s.setFlags(m.uid, { seen: !m.seen }),
    },
    { label: m.flagged ? 'Remove Flag' : 'Flag', icon: Flag, onClick: () => void s.setFlags(m.uid, { flagged: !m.flagged }) },
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
