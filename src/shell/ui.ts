import { create } from 'zustand'

/** Shell-only UI state (Launchpad open…). */
export const useShellUi = create<{ launchpad: boolean }>(() => ({ launchpad: false }))

export const openLaunchpad = () => useShellUi.setState({ launchpad: true })
export const closeLaunchpad = () => useShellUi.setState({ launchpad: false })
export const toggleLaunchpad = () => useShellUi.setState((s) => ({ launchpad: !s.launchpad }))
