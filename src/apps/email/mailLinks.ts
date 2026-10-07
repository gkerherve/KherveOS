// Links inside an HTML email. The message is shown in a sandboxed iframe with
// no allow-same-origin and no allow-popups, so a click can't open a browser
// tab: this tiny script (the only one the frame's CSP lets run, by nonce)
// posts link clicks out, and the Email app opens them with os.openUrl.
// Pure (no DOM, no OS imports), so Node can test it.

/** Runs inside the email's frame. */
export const MAIL_LINK_SCRIPT = `(function(){
  function post(url, background) {
    try { parent.postMessage({ source: 'kherveos-mail', type: 'link', url: url, background: background }, '*'); } catch (e) {}
  }
  function onClick(e, aux) {
    var t = e.target;
    var a = t && t.closest ? t.closest('a[href], area[href]') : null;
    if (!a) return;
    var raw = (a.getAttribute('href') || '').trim();
    if (raw.charAt(0) === '#') return;
    e.preventDefault();
    post(a.href, aux || e.metaKey || e.ctrlKey);
  }
  addEventListener('click', function (e) { if (e.button === 0) onClick(e, false); });
  addEventListener('auxclick', function (e) { if (e.button === 1) onClick(e, true); });
})();`

export interface MailLink {
  url: string
  background: boolean
}

/** A link click reported by an email's frame: web and mail addresses only. */
export function parseMailLink(data: unknown): MailLink | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (d.source !== 'kherveos-mail' || d.type !== 'link' || typeof d.url !== 'string' || d.url.length > 8192) return null
  if (!/^(https?:\/\/|mailto:)/i.test(d.url)) return null
  return { url: d.url, background: d.background === true }
}

/** A fresh nonce for the frame's Content-Security-Policy. */
export function makeNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The frame's Content-Security-Policy: nothing remote unless allowed, and only our script. */
export function mailCsp(showRemote: boolean, nonce: string): string {
  const remote = showRemote ? ' http: https:' : ''
  return (
    `default-src 'none'; script-src 'nonce-${nonce}'; img-src data: blob:${remote}; style-src 'unsafe-inline'${remote}; ` +
    `font-src data:${remote}; media-src data:${remote}`
  )
}
