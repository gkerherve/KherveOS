// Message text with web addresses turned into links. A plain click opens the
// link in the KherveOS Browser; Ctrl/Cmd/Shift-click leaves it to the real browser.

import type { ReactNode } from 'react'
import { os } from '@/os'

const URL_RE = /\bhttps?:\/\/[^\s<>"]+/gi

/** Drop punctuation that ends a sentence rather than the address ("see https://x.org.") */
function trimUrl(url: string): string {
  let out = url
  for (;;) {
    const last = out[out.length - 1]
    if (!last) return out
    if (last === ')') {
      const open = out.split('(').length - 1
      const close = out.split(')').length - 1
      if (close <= open) return out
    } else if (!'.,;:!?\'"]}>'.includes(last)) {
      return out
    }
    out = out.slice(0, -1)
  }
}

export function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0
    const url = trimUrl(match[0])
    if (url.length < 10) continue
    if (start > last) parts.push(text.slice(last, start))
    parts.push(
      <a
        key={start}
        className="msg-link"
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey) return
          e.preventDefault()
          os.open('browser', { url })
        }}
      >
        {url}
      </a>,
    )
    last = start + url.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}
