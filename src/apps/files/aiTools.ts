// Files' AI tools (files_open_folder, files_select): names, arguments and
// descriptions are in src/os/ai/appManifest.ts; Files.tsx registers these
// with useAppTools.

import { fs } from '@/os'
import { basename, dirname, join, pretty } from '@/os/path'
import { drivePath } from '@/os/ai/tools'
import type { AppTools } from '@/os/ai/appTools'

export interface FilesWindow {
  /** The folder shown. */
  dir(): string
  go(dir: string): void
  select(paths: string[]): void
  showHidden(): boolean
}

const MAX_LIST = 150

export function filesAiTools(w: FilesWindow): AppTools {
  return {
    async open_folder(a) {
      const p = drivePath(String(a.path ?? ''))
      const st = fs.stat(p)
      if (!st) throw new Error(`${pretty(p)} does not exist. "~" is the home folder (Documents, Pictures…).`)
      if (st.type !== 'dir') throw new Error(`${pretty(p)} is a file: open_file opens it, or show its folder.`)
      w.go(p)
      const all = fs.list(p).filter((s) => w.showHidden() || !s.name.startsWith('.'))
      const items = all.slice(0, MAX_LIST).map((s) => (s.type === 'dir' ? `${s.name}/` : s.name))
      return { folder: pretty(p), items, ...(all.length > items.length && { truncated: true, total: all.length }) }
    },

    async select(a) {
      const names = Array.isArray(a.names) ? a.names.filter((n): n is string => typeof n === 'string' && !!n.trim()) : []
      if (!names.length) throw new Error('"names" must list at least one file or folder name.')
      const dir = w.dir()
      const found: string[] = []
      const missing: string[] = []
      for (const n of names) {
        const t = n.trim().replace(/\/+$/, '')
        const p = /^(~|\/)/.test(t) ? drivePath(t) : join(dir, t)
        if (fs.exists(p) && dirname(p) === dir) found.push(p)
        else missing.push(n)
      }
      if (!found.length) throw new Error(`None of these is in ${pretty(dir)}: ${missing.join(', ')}. files_open_folder shows another folder.`)
      w.select(found)
      return { folder: pretty(dir), selected: found.map((p) => basename(p)), ...(missing.length && { not_found: missing }) }
    },
  }
}
