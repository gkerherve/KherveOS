// Shows an HTML email safely.
//
// The HTML is sanitised with DOMPurify (its own instance, so these hooks don't
// touch other apps), then shown in an iframe with `srcdoc` and a sandbox
// WITHOUT allow-scripts or allow-same-origin: nothing in the message can run
// or reach KherveOS. Links open in a new tab (<base target="_blank"> and
// allow-popups). Until the user asks for them, remote images, stylesheets and
// fonts are removed and also blocked by a Content-Security-Policy, so opening
// a message doesn't tell the sender (tracking pixels).

import { useEffect, useMemo } from 'react'
import DOMPurify from 'dompurify'

const purifier = DOMPurify(window)
let blockRemote = true
let remoteCount = 0

const REMOTE_URL = /^\s*(?:https?:)?\/\//i
const CSS_REMOTE_URL = /url\(\s*(['"]?)\s*(?:https?:)?\/\/[^)]*?\1\s*\)/gi
const CSS_IMPORT = /@import\s+[^;]+;?/gi

function stripCss(css: string): string {
  return css
    .replace(CSS_IMPORT, () => {
      remoteCount++
      return ''
    })
    .replace(CSS_REMOTE_URL, () => {
      remoteCount++
      return 'none'
    })
}

purifier.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName !== 'style' || !node.textContent) return
  // Emails often wrap their CSS in <!-- … --> (CSS ignores those markers), but
  // markup-like text makes DOMPurify drop the whole <style> block: remove them.
  let css = node.textContent.replace(/<!--|-->/g, '')
  if (blockRemote) css = stripCss(css)
  if (css !== node.textContent) node.textContent = css
})

purifier.addHook('afterSanitizeAttributes', (el) => {
  if (el.tagName === 'A' || el.tagName === 'AREA') {
    if ((el.getAttribute('href') ?? '').startsWith('#')) {
      el.setAttribute('target', '_self') // a jump inside the message
    } else {
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noopener noreferrer')
    }
  }
  if (!blockRemote) return
  for (const attr of ['src', 'background', 'poster', 'lowsrc', 'dynsrc']) {
    const value = el.getAttribute(attr)
    if (value && REMOTE_URL.test(value)) {
      el.removeAttribute(attr)
      remoteCount++
    }
  }
  const srcset = el.getAttribute('srcset')
  if (srcset && /(?:https?:)?\/\//i.test(srcset)) {
    el.removeAttribute('srcset')
    remoteCount++
  }
  const style = el.getAttribute('style')
  if (style && /url\(|@import/i.test(style)) {
    const cleaned = stripCss(style)
    if (cleaned !== style) el.setAttribute('style', cleaned)
  }
})

// The page an email is drawn on. Emails are designed for a white page, so the
// frame keeps one in every theme (this is the email's own document, not the app's).
const BASE_CSS = `
html{background:#fff;color:#1f2328;color-scheme:light}
body{margin:0;padding:18px 22px;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow-wrap:break-word;word-wrap:break-word}
img{max-width:100%;height:auto}
pre{white-space:pre-wrap}
blockquote{margin:0 0 0 4px;padding-left:12px;border-left:3px solid #d0d7de;color:#57606a}
a{color:#0969da}
`

const CSP_BLOCKED = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src data:"
const CSP_ALLOWED = "default-src 'none'; img-src data: blob: http: https:; style-src 'unsafe-inline' http: https:; font-src data: http: https:; media-src data: http: https:"

export interface PreparedHtml {
  doc: string
  /** How many remote images/resources were held back. */
  remote: number
}

export function prepareHtml(html: string, showRemote: boolean): PreparedHtml {
  blockRemote = !showRemote
  remoteCount = 0
  const root = purifier.sanitize(html, {
    WHOLE_DOCUMENT: true,
    RETURN_DOM: true,
    FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'option', 'dialog'],
    ADD_ATTR: ['target'],
  }) as HTMLElement
  const remote = remoteCount
  const doc = root.ownerDocument
  let head = root.querySelector('head')
  if (!head) {
    head = doc.createElement('head')
    root.insertBefore(head, root.firstChild)
  }
  const meta = (attrs: Record<string, string>) => {
    const el = doc.createElement('meta')
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    return el
  }
  const base = doc.createElement('base')
  base.setAttribute('target', '_blank')
  const style = doc.createElement('style')
  style.textContent = BASE_CSS
  head.prepend(
    meta({ charset: 'utf-8' }),
    meta({ 'http-equiv': 'Content-Security-Policy', content: showRemote ? CSP_ALLOWED : CSP_BLOCKED }),
    meta({ name: 'referrer', content: 'no-referrer' }),
    base,
    style,
  )
  return { doc: '<!doctype html>' + root.outerHTML, remote }
}

export function HtmlBody({
  html,
  showRemote,
  title,
  onRemote,
}: {
  html: string
  showRemote: boolean
  title: string
  onRemote: (count: number) => void
}) {
  const prepared = useMemo(() => prepareHtml(html, showRemote), [html, showRemote])
  useEffect(() => {
    if (!showRemote) onRemote(prepared.remote)
  }, [prepared, showRemote, onRemote])
  return (
    <iframe
      className="mail-html"
      title={title}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={prepared.doc}
    />
  )
}
