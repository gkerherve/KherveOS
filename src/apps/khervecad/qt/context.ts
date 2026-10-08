// What every widget renderer needs: send input to Python, open a menu.

import { createContext, useContext } from 'react'
import type { ActionNode, UiEvent } from '../types'

export interface QtApi {
  send(ev: UiEvent): void
  /** Show a menu of actions at a screen point (clicks trigger them). */
  menu(items: ActionNode[], at: { clientX: number; clientY: number }): void
  /** Where the pointer last went down (Python's pop-up menus open there). */
  pointer: { x: number; y: number }
}

export const QtContext = createContext<QtApi>({
  send: () => {},
  menu: () => {},
  pointer: { x: 0, y: 0 },
})

export const useQt = () => useContext(QtContext)
