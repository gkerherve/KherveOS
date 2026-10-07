// A web page inside KherveOS: directly in a sandboxed iframe, or through the
// KherveOS page fetcher for sites that refuse to be framed (see os/web.ts and
// server/kherveos_server/webfetch.py). Used by the Browser and KherveDB.
//
// `url` is read when the view is mounted: give it a `key` to navigate. Pages
// shown through the fetcher get an opaque origin (no allow-same-origin), so
// their scripts never reach KherveOS's cookies or storage; they report where
// they are, and the links they want opened, by postMessage (`onMessage`).

import { useEffect, useRef, useState } from 'react'
import { ExternalLink, LoaderCircle, ShieldOff } from 'lucide-react'
import { fetchPrefix, openInRealBrowser } from '../web'
import { FETCH_SANDBOX, fetchedUrl, parseFrameMessage, type FrameMessage } from '../webfetch'

export type WebVia = 'direct' | 'fetch'

/** Pages framed directly may do everything except navigate KherveOS itself away (no allow-top-navigation). */
export const DIRECT_SANDBOX =
  'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads'
/** KherveOS's own origin (and files from the drive) get an opaque origin: they can't reach its storage. */
export const OPAQUE_SANDBOX = DIRECT_SANDBOX.replace(' allow-same-origin', '')
export const FRAME_ALLOW = 'fullscreen; clipboard-write; autoplay; encrypted-media'

export interface WebViewProps {
  url: string
  via: WebVia
  title: string
  className?: string
  /** Show the page directly when the fetcher can't be used (server offline, not signed in). */
  directFallback?: boolean
  onLoad?: () => void
  onMessage?: (m: FrameMessage) => void
}

type Prefix = { prefix: string } | { error: string } | null

export function WebView({ url, via, title, className = 'br-frame', directFallback, onLoad, onMessage }: WebViewProps) {
  const [address] = useState(url) // navigating = a new key
  const [prefix, setPrefix] = useState<Prefix>(null)
  const [renewals, setRenewals] = useState(0)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const onMessageRef = useRef(onMessage)
  useEffect(() => {
    onMessageRef.current = onMessage
  })

  useEffect(() => {
    if (via !== 'fetch') return
    let alive = true
    fetchPrefix(renewals > 0).then(
      (p) => alive && setPrefix({ prefix: p }),
      (e: unknown) => alive && setPrefix({ error: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      alive = false
    }
  }, [via, renewals])

  useEffect(() => {
    const listen = (e: MessageEvent) => {
      const frame = frameRef.current
      if (!frame || e.source !== frame.contentWindow) return
      if (via === 'fetch' && e.origin !== 'null') return // fetched pages always have an opaque origin
      const m = parseFrameMessage(e.data)
      if (!m) return
      if (m.type === 'error' && m.kind === 'expired' && renewals < 2) {
        setRenewals((n) => n + 1) // the server restarted: a new token, and the page again
        return
      }
      onMessageRef.current?.(m)
    }
    window.addEventListener('message', listen)
    return () => window.removeEventListener('message', listen)
  }, [via, renewals])

  const direct = via === 'direct' || (directFallback && prefix !== null && 'error' in prefix)
  if (direct) {
    let own = false
    try {
      own = new URL(address).origin === window.location.origin
    } catch {
      /* not an address: the frame shows nothing */
    }
    return (
      <iframe
        ref={frameRef}
        className={className}
        src={address}
        title={title}
        sandbox={own ? OPAQUE_SANDBOX : DIRECT_SANDBOX}
        allow={FRAME_ALLOW}
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={onLoad}
      />
    )
  }
  if (!prefix) {
    return (
      <div className="k-center k-muted">
        <LoaderCircle size={22} className="k-spin" />
      </div>
    )
  }
  if ('error' in prefix) {
    return (
      <div className="k-center" style={{ flexDirection: 'column', gap: 10, padding: 24, textAlign: 'center' }}>
        <ShieldOff size={36} style={{ color: 'var(--k-muted)' }} />
        <strong>This site needs the KherveOS server to be shown here</strong>
        <p className="k-muted" style={{ margin: 0, maxWidth: 460 }}>
          It refuses to be shown inside other apps, so KherveOS fetches it for you, and the server said: {prefix.error}
        </p>
        <button className="k-btn primary" onClick={() => openInRealBrowser(address)}>
          <ExternalLink size={15} /> Open in your real browser
        </button>
      </div>
    )
  }
  return (
    <iframe
      ref={frameRef}
      key={prefix.prefix}
      className={className}
      src={fetchedUrl(prefix.prefix, address) ?? 'about:blank'}
      title={title}
      sandbox={FETCH_SANDBOX}
      allow="fullscreen; clipboard-write; autoplay"
      referrerPolicy="no-referrer"
      onLoad={onLoad}
    />
  )
}
