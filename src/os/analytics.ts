// Visitor counts for the public web build (gkerherve.github.io), with
// GoatCounter: page views and which apps are opened, no cookies and no
// personal data. Off unless the build sets VITE_GOATCOUNTER to the site's
// code (https://<code>.goatcounter.com); never on for local or server builds.

const CODE = import.meta.env.VITE_WEB === '1' ? (import.meta.env.VITE_GOATCOUNTER as string | undefined) : undefined

type GoatCounter = { count?: (o: { path: string; title?: string; event?: boolean }) => void }

export function startAnalytics(): void {
  if (!CODE || typeof document === 'undefined') return
  const s = document.createElement('script')
  s.async = true
  s.src = 'https://gc.zgo.at/count.js'
  s.dataset.goatcounter = `https://${CODE}.goatcounter.com/count`
  // apps opened before the script arrived (?app=... at start) count now
  s.addEventListener('load', () => pending.splice(0).forEach(countAppOpen))
  document.head.append(s)
}

const pending: string[] = []

/** One event per app window opened ("app/khervecad"). */
export function countAppOpen(appId: string): void {
  if (!CODE) return
  const gc = (window as unknown as { goatcounter?: GoatCounter }).goatcounter
  if (!gc?.count) {
    if (pending.length < 20) pending.push(appId)
    return
  }
  try {
    gc?.count?.({ path: `app/${appId}`, title: appId, event: true })
  } catch {
    /* counting never breaks the desktop */
  }
}
