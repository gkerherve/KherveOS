// Crash reports: an app that crashes (or an error nobody caught) is reported to
// the KherveOS server, which writes it to its log. Only when signed in; a few
// per page load at most; never throws.

let sent = 0
const MAX_REPORTS = 30

export function reportCrash(app: string, error: unknown, component = ''): void {
  if (sent >= MAX_REPORTS) return
  sent++
  const e = error instanceof Error ? error : new Error(String(error))
  void fetch('/api/crash', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app: app.slice(0, 80),
      message: `${e.name}: ${e.message}`.slice(0, 2000),
      stack: (e.stack ?? '').slice(0, 8000),
      component: component.slice(0, 8000),
    }),
  }).catch(() => {})
}

/** Report errors that no app caught (event handlers, promises). Call once at start. */
export function installCrashReporter(): void {
  window.addEventListener('error', (ev) => {
    if (ev.error) reportCrash('KherveOS (uncaught)', ev.error)
  })
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason
    // A request someone cancelled is not a crash.
    if (r instanceof DOMException && r.name === 'AbortError') return
    reportCrash('KherveOS (unhandled promise)', r)
  })
}
