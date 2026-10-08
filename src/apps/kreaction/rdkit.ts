// Loads RDKit (the RDKit project's MinimalLib, WebAssembly, npm @rdkit/rdkit) the first time a structure is
// needed, and lets components follow its state. Everything RDKit is asked to do is in rdengine.ts.

import { useEffect, useSyncExternalStore } from 'react'
import type { MainModule } from '@rdkit/rdkit'

type State = { status: 'idle' | 'loading' | 'ready' | 'failed'; rd: MainModule | null }

let state: State = { status: 'idle', rd: null }
let loading: Promise<MainModule | null> | null = null
const listeners = new Set<() => void>()

function set(next: State) {
  state = next
  listeners.forEach((l) => l())
}

/** Starts loading (once); resolves to null when RDKit cannot run here. */
export function loadRDKit(): Promise<MainModule | null> {
  if (loading) return loading
  set({ status: 'loading', rd: null })
  loading = (async () => {
    try {
      const [{ default: init }, { default: wasmUrl }] = await Promise.all([import('@rdkit/rdkit'), import('@rdkit/rdkit/RDKit_minimal.wasm?url')])
      const mod = await (init as unknown as (o: unknown) => Promise<MainModule>)({ locateFile: () => wasmUrl })
      set({ status: 'ready', rd: mod })
      return mod
    } catch (e) {
      console.warn('[kreaction] RDKit (MinimalLib) is unavailable', e)
      set({ status: 'failed', rd: null })
      return null
    }
  })()
  return loading
}

/** The RDKit module (null while loading or if it failed) and the loading status; starts loading on first use. */
export function useRDKit(): State {
  const snap = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
  useEffect(() => {
    if (state.status === 'idle') void loadRDKit()
  }, [])
  return snap
}

/** The module if it is already loaded (for event handlers). */
export function currentRDKit(): MainModule | null {
  return state.rd
}
