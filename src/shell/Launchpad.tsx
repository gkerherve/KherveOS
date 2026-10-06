// Launchpad: every app on one screen, with search over apps and files.

import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { APPS, CATEGORY_NAMES } from '@/os/registry'
import { useWindows } from '@/os/windows'
import { fs } from '@/os/vfs'
import { HOME, pretty, dirname } from '@/os/path'
import { fileIcon } from '@/os/fileIcons'
import { os } from '@/os'
import { AppIcon } from '@/os/ui/AppIcon'
import type { AppManifest } from '@/os/types'
import { closeLaunchpad } from './ui'

const ORDER: AppManifest['category'][] = ['kherve', 'internet', 'system', 'games']

export function Launchpad() {
  const [query, setQuery] = useState('')
  const open = useWindows((s) => s.open)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeLaunchpad()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const q = query.trim().toLowerCase()
  const apps = useMemo(
    () => (q ? APPS.filter((a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)) : APPS),
    [q],
  )
  const files = useMemo(
    () => (q.length >= 2 ? fs.walk(HOME).filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8) : []),
    [q],
  )

  const launch = (id: string) => {
    open(id)
    closeLaunchpad()
  }

  return (
    <div className="k-launchpad" onPointerDown={(e) => e.target === e.currentTarget && closeLaunchpad()} onContextMenu={(e) => e.preventDefault()}>
      <form
        className="k-lp-search"
        onSubmit={(e) => {
          e.preventDefault()
          if (apps[0]) launch(apps[0].id)
          else if (files[0]) {
            void os.openFile(files[0].path)
            closeLaunchpad()
          }
        }}
      >
        <Search size={15} />
        <input autoFocus placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
      </form>
      <div className="k-lp-body" onPointerDown={(e) => e.target === e.currentTarget && closeLaunchpad()}>
        {ORDER.map((cat) => {
          const list = apps.filter((a) => a.category === cat)
          if (!list.length) return null
          return (
            <section key={cat} className="k-lp-section">
              <h3>{CATEGORY_NAMES[cat]}</h3>
              <div className="k-lp-grid">
                {list.map((a) => (
                  <button key={a.id} className="k-lp-app" onClick={() => launch(a.id)} title={a.description}>
                    <AppIcon app={a} size={76} className="k-lp-tile" />
                    <span className="k-lp-name">{a.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )
        })}
        {files.length > 0 && (
          <section className="k-lp-section">
            <h3>Files</h3>
            <div className="k-lp-files">
              {files.map((f) => {
                const { icon: Icon, color } = fileIcon(f.path, f.type)
                return (
                  <button key={f.path} className="k-lp-file" onClick={() => { void os.openFile(f.path); closeLaunchpad() }}>
                    <Icon size={16} color={color} />
                    <span>{f.name}</span>
                    <span className="k-lp-dim">{pretty(dirname(f.path))}</span>
                  </button>
                )
              })}
            </div>
          </section>
        )}
        {!apps.length && !files.length && <div className="k-lp-empty">Nothing matches “{query}”.</div>}
      </div>
    </div>
  )
}
