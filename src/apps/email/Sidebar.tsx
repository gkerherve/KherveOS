// The left pane: New message, then each account with its folders.

import { useState } from 'react'
import { ChevronDown, ChevronRight, CircleAlert, Ellipsis, LoaderCircle, Pencil, Plus, RefreshCw, SquarePen, Trash2 } from 'lucide-react'
import { os } from '@/os'
import type { MenuItem } from '@/os'
import type { Account } from './api'
import { failure, menuBelow } from './actions'
import { useMail, useMailStore } from './store'
import { folderIcon, folderLabel, folderRows } from './util'

interface SidebarProps {
  onCompose(): void
  onAddAccount(): void
  onEditAccount(account: Account): void
  /** Called after a folder is picked (closes the drawer on small windows). */
  onPicked?: () => void
}

export function Sidebar({ onCompose, onAddAccount, onEditAccount, onPicked }: SidebarProps) {
  const accounts = useMail((s) => s.accounts) ?? []
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})

  return (
    <nav className="mail-sidebar" aria-label="Accounts and folders">
      <div className="mail-sidebar-top">
        <button className="k-btn primary wide" onClick={onCompose} disabled={!accounts.length}>
          <SquarePen size={15} /> New message
        </button>
      </div>
      <div className="mail-sidebar-scroll">
        {accounts.map((account) => (
          <AccountTree
            key={account.id}
            account={account}
            collapsed={!!collapsed[account.id]}
            onToggle={() => setCollapsed((c) => ({ ...c, [account.id]: !c[account.id] }))}
            onEdit={() => onEditAccount(account)}
            onPicked={onPicked}
          />
        ))}
      </div>
      <div className="mail-sidebar-bottom">
        <button className="mail-add-account" onClick={onAddAccount}>
          <Plus size={15} /> Add account
        </button>
      </div>
    </nav>
  )
}

function AccountTree({
  account,
  collapsed,
  onToggle,
  onEdit,
  onPicked,
}: {
  account: Account
  collapsed: boolean
  onToggle(): void
  onEdit(): void
  onPicked?: () => void
}) {
  const store = useMailStore()
  const folders = useMail((s) => s.folders[account.id])
  const error = useMail((s) => s.folderErrors[account.id])
  const current = useMail((s) => s.current)

  const remove = async () => {
    const ok = await os.dialog.confirm(
      `Remove ${account.email} from KherveOS? The mail itself stays with your provider; KherveOS forgets the connection and the saved password.`,
      { title: 'Remove account', okLabel: 'Remove', danger: true },
    )
    if (!ok) return
    try {
      await store.getState().removeAccount(account.id)
    } catch (err) {
      failure(`Could not remove ${account.email}`, err)
    }
  }

  const menu: MenuItem[] = [
    { label: 'Refresh folders', icon: RefreshCw, onClick: () => void store.getState().loadFolders(account.id) },
    { label: 'Edit account…', icon: Pencil, onClick: onEdit },
    '-',
    { label: 'Remove account…', icon: Trash2, danger: true, onClick: () => void remove() },
  ]

  return (
    <div className="mail-account">
      <div
        className="mail-account-head"
        onContextMenu={(e) => {
          e.preventDefault()
          os.contextMenu(e, menu)
        }}
      >
        <button
          className="mail-account-toggle"
          onClick={onToggle}
          aria-expanded={!collapsed}
          title={account.display_name ? `${account.display_name} <${account.email}>` : account.email}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span className="mail-account-name">{account.email}</span>
        </button>
        <button className="k-icon-btn mail-account-more" title="Account" aria-label={`${account.email} options`} onClick={(e) => menuBelow(e, menu)}>
          <Ellipsis size={15} />
        </button>
      </div>
      {!collapsed && (
        <div className="mail-folders" role="list">
          {!folders && !error && (
            <div className="mail-folder-note">
              <LoaderCircle size={14} className="k-spin" /> Loading folders…
            </div>
          )}
          {error && !folders && (
            <div className="mail-folder-note error" title={error}>
              <CircleAlert size={14} />
              <span>Couldn't load the folders.</span>
              <button className="k-link-btn" onClick={() => void store.getState().loadFolders(account.id)}>
                Retry
              </button>
            </div>
          )}
          {folders &&
            folderRows(folders).map(({ folder, indent }) => {
              const Icon = folderIcon(folder)
              const active = current?.accountId === account.id && current.folder === folder.raw
              const count = folder.role === 'drafts' ? folder.total : folder.unread
              return (
                <button
                  key={folder.raw}
                  role="listitem"
                  className={`mail-folder${active ? ' active' : ''}${folder.selectable ? '' : ' container'}`}
                  style={{ paddingLeft: 10 + indent * 14 }}
                  disabled={!folder.selectable}
                  aria-current={active || undefined}
                  title={folder.name}
                  onClick={() => {
                    store.getState().openFolder({ accountId: account.id, folder: folder.raw })
                    onPicked?.()
                  }}
                >
                  <Icon size={15} className="mail-folder-icon" />
                  <span className="mail-folder-name">{folderLabel(folder)}</span>
                  {!!count && (
                    <span className={`mail-badge${folder.role === 'drafts' ? ' quiet' : ''}`} aria-label={`${count} ${folder.role === 'drafts' ? 'drafts' : 'unread'}`}>
                      {count > 999 ? '999+' : count}
                    </span>
                  )}
                </button>
              )
            })}
          {folders && folders.length === 0 && <div className="mail-folder-note">No folders.</div>}
        </div>
      )}
    </div>
  )
}
