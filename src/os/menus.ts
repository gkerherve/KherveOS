// The menus each window puts in the top menu bar (see WindowApi.setMenus).

import { create } from 'zustand'
import type { MenuBarMenu } from './ui/Menu'

export const useWindowMenus = create<{ menus: Record<string, MenuBarMenu[]> }>(() => ({ menus: {} }))

export function setWindowMenus(id: string, menus: MenuBarMenu[] | null) {
  useWindowMenus.setState((s) => {
    const next = { ...s.menus }
    if (menus) next[id] = menus
    else delete next[id]
    return { menus: next }
  })
}
