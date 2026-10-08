import { os } from '@/os'
import { useAuth } from '@/os/server'

/** Ask, then sign out of the KherveOS account (Messages and Email share it). */
export async function confirmSignOut(): Promise<void> {
  const me = useAuth.getState().user
  if (!me) return
  const ok = await os.dialog.confirm('Chat and Mail will ask you to sign in again.', {
    title: `Sign out ${me.display_name}?`,
    okLabel: 'Sign out',
  })
  if (ok) await useAuth.getState().logout()
}
