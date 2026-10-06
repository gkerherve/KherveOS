import { useEffect } from 'react'
import { useThemeEffect } from '@/os/themes'
import { startServerWatch } from '@/os/server'
import { OverlayHosts } from '@/os/overlays'
import { Desktop } from './Desktop'
import { WindowLayer } from './WindowFrame'
import { TopBar } from './TopBar'
import { Dock } from './Dock'
import { Launchpad } from './Launchpad'
import { useShellUi } from './ui'

export function Shell() {
  useThemeEffect()
  useEffect(() => startServerWatch(), [])
  // Message notifications from the start, even before Messages is opened.
  useEffect(() => {
    void import('@/apps/messages/notifier').then((m) => m.startMessagesNotifier())
  }, [])
  const launchpad = useShellUi((s) => s.launchpad)
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
