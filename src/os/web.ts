// Web addresses in KherveOS: "you do not want to leave the OS".
//
//   os.openUrl(url)            opens it in the KherveOS Browser (a new tab in the
//                              front Browser window, or a new window); mailto: in Email
//   os.openInRealBrowser(url)  the explicit escape hatch ("Open in your real browser")
//   startLinkCatcher()         the shell's safety net: <a> clicks and window.open
//                              with web addresses go to os.openUrl
//   fetchPrefix()              the page fetcher's address prefix, for sites that
//                              refuse to be framed (server/kherveos_server/webfetch.py)

import { useWindows } from './windows'
import { api } from './server'
import { linkAction, mailtoAddress, urlKind } from './links'

// The browser's own window.open, before startLinkCatcher replaces it.
const realOpen: typeof window.open = window.open.bind(window)
let opened = 0

export interface OpenUrlOptions {
  /** Open the tab without bringing it to the front (middle clicks). */
  background?: boolean
  /** A new Browser window even when one is open. */
  newWindow?: boolean
}

/** Open an address inside KherveOS. Returns false for addresses it can't open (javascript:, blob:…). */
export function openUrl(url: string, opts: OpenUrlOptions = {}): boolean {
  const kind = urlKind(url)
  const wm = useWindows.getState()
  if (kind === 'mail') {
    wm.open('email', { writeTo: mailtoAddress(url), _n: ++opened })
    return true
  }
  if (kind === 'none') return false
  const args = { url: url.trim(), background: !!opts.background, _n: ++opened }
  const browsers = wm.windows.filter((w) => w.appId === 'browser').sort((a, b) => Number(a.minimized) - Number(b.minimized) || b.z - a.z)
  const front = opts.newWindow ? undefined : browsers[0]
  if (!front) {
    wm.open('browser', { url: args.url })
    return true
  }
  useWindows.setState((s) => ({ windows: s.windows.map((w) => (w.id === front.id ? { ...w, args } : w)) }))
  if (!opts.background || front.minimized) wm.focus(front.id)
  return true
}

/** The one way out: open an http(s) address in a real browser tab (only for explicit "real browser" buttons). */
export function openInRealBrowser(url: string): void {
  if (!/^https?:\/\//i.test(url.trim())) return
  realOpen(url.trim(), '_blank', 'noopener,noreferrer')
}

/** Install the shell-wide link catcher; returns a function that removes it. */
export function startLinkCatcher(): () => void {
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented) return // the app handled it
    if (e.type === 'click' ? e.button !== 0 : e.button !== 1) return
    const el = e.target instanceof Element ? e.target.closest('a[href], area[href]') : null
    if (!el) return
    const raw = el.getAttribute('href') ?? ''
    let href = raw
    try {
      href = new URL(raw, document.baseURI).href
    } catch {
      /* linkAction ignores it */
    }
    const action = linkAction({
      raw,
      href,
      download: el.hasAttribute('download'),
      background: e.button === 1 || e.metaKey || e.ctrlKey,
    })
    if (action.kind !== 'open') return
    e.preventDefault()
    openUrl(action.url, { background: action.background })
  }
  window.addEventListener('click', onClick)
  window.addEventListener('auxclick', onClick)

  const previous = window.open
  window.open = function open(url?: string | URL, target?: string, features?: string) {
    let href = ''
    try {
      href = url === undefined || url === '' ? '' : new URL(String(url), document.baseURI).href
    } catch {
      /* not an address */
    }
    if (href && urlKind(href) !== 'none' && urlKind(href) !== 'file') {
      openUrl(href)
      return null
    }
    return previous.call(window, url, target, features)
  } as typeof window.open

  return () => {
    window.removeEventListener('click', onClick)
    window.removeEventListener('auxclick', onClick)
    window.open = previous
  }
}

// ------------------------------------------------------------ page fetcher

let token: { prefix: string; expires: number } | null = null
let pending: Promise<string> | null = null

/**
 * The page fetcher's address prefix ("https://os.example/api/web/f/<token>/"), asking the
 * server for a fresh token when needed. Rejects when the server is offline or wants a sign-in.
 */
export function fetchPrefix(renew = false): Promise<string> {
  const now = Date.now() / 1000
  if (!renew && token && token.expires - now > 600) return Promise.resolve(token.prefix)
  if (!pending) {
    pending = api<{ prefix: string; expires: number }>('/web/token')
      .then((r) => {
        token = { prefix: location.origin + r.prefix, expires: r.expires }
        return token.prefix
      })
      .finally(() => {
        pending = null
      })
  }
  return pending
}
