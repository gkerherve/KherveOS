// The KherveOS page fetcher, browser side: pure helpers (no React, no OS
// imports, so Node can test them). The server half is
// server/kherveos_server/webfetch.py; the token and the frames are in web.ts
// and ui/WebView.tsx.
//
// A fetched page lives at  <origin>/api/web/f/<token>/<scheme>/<host[:port]>/<path>?<query>
// and talks to KherveOS by postMessage({ source: 'kherveos-web', type, … }).

/** Fetched pages: scripts and forms, but no allow-same-origin (an opaque origin: no KherveOS cookies or
 *  storage), no popups and no top navigation (new windows and links come to the Browser by postMessage). */
export const FETCH_SANDBOX = 'allow-scripts allow-forms allow-modals allow-downloads allow-pointer-lock'

/** The fetcher address of an http(s) address, or null for anything else. `prefix` ends with "/". */
export function fetchedUrl(prefix: string, address: string): string | null {
  let u: URL
  try {
    u = new URL(address)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  return `${prefix}${u.protocol.slice(0, -1)}/${u.host}${u.pathname}${u.search}${u.hash}`
}

/** The real address behind a fetcher address (anything else comes back as it is). */
export function realUrl(prefix: string, address: string): string {
  if (!address.startsWith(prefix)) return address
  const rest = address.slice(prefix.length)
  const i = rest.indexOf('/')
  if (i < 0) return address
  const scheme = rest.slice(0, i)
  return scheme === 'http' || scheme === 'https' ? `${scheme}://${rest.slice(i + 1)}` : address
}

export type FrameMessage =
  /** The page shown (on load, and when the page changes its own address). */
  | { type: 'location'; url: string; title: string }
  /** A link was followed inside the frame. */
  | { type: 'navigate'; url: string }
  /** A link for a new tab (in the background: middle / ⌘-click), window.open, mailto:… */
  | { type: 'open'; url: string; background: boolean }
  /** A form that sends data (POST): only a real browser can. */
  | { type: 'form'; url: string; method: string }
  /** The fetcher's own error page. */
  | { type: 'error'; kind: string; url: string; message: string; status: number }

const WEB = /^https?:\/\//i
const OPENABLE = /^(https?:\/\/|mailto:)/i

/** A message from a fetched page, checked field by field (the page is untrusted). */
export function parseFrameMessage(data: unknown): FrameMessage | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (d.source !== 'kherveos-web' || typeof d.type !== 'string') return null
  const str = (v: unknown, max = 8192) => (typeof v === 'string' && v.length <= max ? v : null)
  const url = str(d.url)
  switch (d.type) {
    case 'location':
      return url && WEB.test(url) ? { type: 'location', url, title: (str(d.title, 500) ?? '').trim() } : null
    case 'navigate':
      return url && WEB.test(url) ? { type: 'navigate', url } : null
    case 'open':
      return url && OPENABLE.test(url) ? { type: 'open', url, background: d.background === true } : null
    case 'form':
      return url && WEB.test(url) ? { type: 'form', url, method: (str(d.method, 20) ?? 'post').toLowerCase() } : null
    case 'error':
      return {
        type: 'error',
        kind: str(d.kind, 40) ?? 'error',
        url: url && WEB.test(url) ? url : '',
        message: str(d.message, 1000) ?? 'This page could not be shown.',
        status: typeof d.status === 'number' ? d.status : 0,
      }
    default:
      return null
  }
}
