// The desktop's QActions as KherveOS menu entries.

import { createElement } from 'react'
import type { MenuItem } from '@/os/ui/Menu'
import { MdiIcon } from '../MdiIcon'
import { plainText, splitShortcut } from '../nodes'
import { showShortcut } from '../keys'
import type { ActionNode } from '../types'

/** Menu entries for *items*; a click calls `trigger(action id)`. */
export function menuItems(items: ActionNode[], trigger: (id: number) => void): MenuItem[] {
  const out: MenuItem[] = []
  for (const a of items) {
    if (a.hid) continue
    if (a.sep) {
      // a section title (QMenu.addSection) keeps its text
      if (out.length && out[out.length - 1] !== '-') out.push('-')
      if (a.text) out.push({ label: plainText(a.text), disabled: true })
      continue
    }
    const [label, inline] = splitShortcut(a.text)
    const item: MenuItem = {
      label,
      shortcut: showShortcut(inline ?? a.sc?.[0]),
      disabled: !!a.dis,
      checked: a.ck && a.chk ? true : undefined,
      image: a.icon ? createElement(MdiIcon, { name: a.icon, size: 14 }) : undefined,
    }
    if (a.menu) item.submenu = menuItems(a.menu, trigger)
    else item.onClick = () => trigger(a.id)
    out.push(item)
  }
  while (out.length && out[out.length - 1] === '-') out.pop()
  while (out.length && out[0] === '-') out.shift()
  return out
}

const CONVERTED = new WeakMap<ActionNode[], { trigger: (id: number) => void; items: MenuItem[] }>()

/** menuItems, converted once per (unchanged) item list. */
export function menuItemsCached(items: ActionNode[], trigger: (id: number) => void): MenuItem[] {
  const hit = CONVERTED.get(items)
  if (hit && hit.trigger === trigger) return hit.items
  const out = menuItems(items, trigger)
  CONVERTED.set(items, { trigger, items: out })
  return out
}

/** Every action with a shortcut in *items*, depth-first (for key handling). */
export function shortcutsOf(items: ActionNode[], out: Map<string, number> = new Map()): Map<string, number> {
  for (const a of items) {
    if (a.menu) shortcutsOf(a.menu, out)
    for (const sc of a.sc ?? []) if (!out.has(sc)) out.set(sc, a.id)
  }
  return out
}
