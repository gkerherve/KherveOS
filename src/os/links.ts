// What a click on a link should do in KherveOS — pure, so Node can test it.
// "You do not want to leave the OS": web and mail links open inside KherveOS
// (os.openUrl), never in a new browser tab. Downloads, blob: and data: links
// keep working as they are; jumps inside a page (#…) too.

export interface LinkClick {
  /** The href attribute as written. */
  raw: string
  /** The resolved address (a.href). */
  href: string
  /** The link has a download attribute. */
  download: boolean
  /** Middle click, or ⌘/Ctrl-click: a background tab. */
  background: boolean
}

export type LinkAction = { kind: 'ignore' } | { kind: 'open'; url: string; background: boolean }

const IGNORE: LinkAction = { kind: 'ignore' }

export function linkAction(c: LinkClick): LinkAction {
  const raw = c.raw.trim()
  if (c.download || !raw || raw.startsWith('#')) return IGNORE
  let url: URL
  try {
    url = new URL(c.href || raw)
  } catch {
    return IGNORE
  }
  switch (url.protocol) {
    case 'http:':
    case 'https:':
      // Same-origin links too: followed, they would navigate KherveOS itself away.
      return { kind: 'open', url: url.href, background: c.background }
    case 'mailto:':
      return { kind: 'open', url: url.href, background: false }
    default:
      return IGNORE // blob:, data:, javascript:, tel:… stay as they are
  }
}

export type UrlKind = 'web' | 'mail' | 'file' | 'none'

/** What os.openUrl does with an address. */
export function urlKind(url: string): UrlKind {
  const t = url.trim()
  if (/^https?:\/\//i.test(t)) return 'web'
  if (/^mailto:/i.test(t)) return 'mail'
  if (/^file:\/\//i.test(t)) return 'file'
  return 'none'
}

/** The address of a mailto: link, e.g. "mailto:a@b.org?subject=Hi" → "a@b.org". */
export function mailtoAddress(url: string): string {
  const body = url.trim().replace(/^mailto:/i, '')
  const to = body.split('?')[0]
  try {
    return decodeURIComponent(to)
  } catch {
    return to
  }
}
