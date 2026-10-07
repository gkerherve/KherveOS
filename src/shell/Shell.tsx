import { useEffect } from 'react'
import { useThemeEffect } from '@/os/themes'
import { startServerWatch } from '@/os/server'
import { OverlayHosts } from '@/os/overlays'
import { startLinkCatcher } from '@/os/web'
import { Desktop } from './Desktop'
import { WindowLayer } from './WindowFrame'
import { TopBar } from './TopBar'
import { Dock } from './Dock'
import { Launchpad } from './Launchpad'
import { useShellUi } from './ui'
import { useShutdown } from '@/os/shutdown'
import { ShutdownScreen } from './ShutdownScreen'

export function Shell() {
  useThemeEffect()
  useEffect(() => startServerWatch(), [])
  // Web links anywhere open in the KherveOS Browser, never in a new browser tab.
  useEffect(() => startLinkCatcher(), [])
  // Message notifications from the start, even before Messages is opened.
  useEffect(() => {
    void import('@/apps/messages/notifier').then((m) => m.startMessagesNotifier())
  }, [])
  // AI apps connected over MCP (Claude, ChatGPT…) reach KherveOS through this tab.
  useEffect(() => {
    void import('@/os/ai/mcpBridge').then((m) => m.startMcpBridge())
  }, [])
  const launchpad = useShellUi((s) => s.launchpad)
  const off = useShutdown((s) => s.off)
  // Shut down: the whole desktop goes away (apps, frames, workers stop with it).
  if (off) return <ShutdownScreen />
  return (
    <div className="k-shell">
      <Desktop />
      <WindowLayer />
      <TopBar />
      <Dock />
      {launchpad && <Launchpad />}
      <OverlayHosts />
    </div>
  )
}
