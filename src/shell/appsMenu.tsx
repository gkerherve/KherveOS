// The Applications menu: one submenu per group (Office, Science, Tools…). The
// Dock's KApps button opens it, and the Ꝃ menu in the menu bar starts with it.

import { LayoutGrid, RotateCw, Settings as SettingsIcon } from 'lucide-react'
import { APPS, GROUPS } from '@/os/registry'
import { AppIcon } from '@/os/ui/AppIcon'
import type { AppManifest } from '@/os/types'
import type { MenuItem } from '@/os/ui/Menu'
import { openLaunchpad } from './ui'

/** The Dock's Applications button, drawn like an app. */
export const APPLICATIONS: AppManifest = {
  id: 'applications', name: 'Applications', icon: LayoutGrid, color: '#4b5563', category: 'system', group: 'Tools',
  description: 'All apps', load: async () => ({ default: () => null }),
  brand: { label: 'KApps', from: '#7a828e', to: '#2b3038', deep: ['#5f6672', '#272b32'] },
}

/** One submenu per group, listing its apps. */
export function appGroups(open: (id: string) => void): MenuItem[] {
  return GROUPS.map((g) => {
    const apps = APPS.filter((a) => a.group === g)
    return {
      label: g,
      disabled: apps.length === 0,
      submenu: apps.map((a) => ({ label: a.name, image: <AppIcon app={a} size={18} />, onClick: () => open(a.id) })),
    }
  })
}

/** The Dock's menu: the groups, then all apps, settings and restart. */
export function applicationsMenu(open: (id: string) => void): MenuItem[] {
  return [
    ...appGroups(open),
    '-',
    { label: 'All Apps…', icon: LayoutGrid, onClick: openLaunchpad },
    { label: 'Settings', icon: SettingsIcon, onClick: () => open('settings') },
    { label: 'Restart KherveOS', icon: RotateCw, onClick: () => location.reload() },
  ]
}
