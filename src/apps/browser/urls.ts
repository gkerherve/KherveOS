// Addresses: what typed text means, which pages can be shown inside KherveOS,
// and what to call them. No React and no OS imports, so it is easy to test.
//
// An address is one of
//   kherve:start              the start page
//   file:///home/user/x.html  a file on the KherveOS drive
//   https://…  /  http://…    a web page

import { DEFAULT_SEARCH_ENGINE, FRAME_BLOCKING_SITES, SEARCH_ENGINES, type SearchEngine } from './sites'

export const START_PAGE = 'kherve:start'

export type Page =
  | { kind: 'start' }
  | { kind: 'file'; path: string }
  | { kind: 'web'; url: string; host: string; blocked: boolean }

/** Navigate here, or (for engines that refuse to be framed) open this in a real browser tab. */
export type Target = { address: string } | { external: string }

export function engineById(id: string | null | undefined): SearchEngine {
  return SEARCH_ENGINES.find((e) => e.id === id) ?? SEARCH_ENGINES.find((e) => e.id === DEFAULT_SEARCH_ENGINE) ?? SEARCH_ENGINES[0]
}

export function searchUrl(engine: SearchEngine, query: string): string {
  return engine.url + encodeURIComponent(query.trim())
}

export function fileAddress(path: string): string {
  return `file://${path}`
}

function parseWeb(text: string): URL | null {
  try {
    const u = new URL(text)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

function safeDecode(text: string): string {
  try {
    return decodeURI(text)
  } catch {
    return text
  }
}

export function pageFor(address: string): Page {
  if (address.startsWith('file://')) return { kind: 'file', path: address.slice(7) || '/' }
  const url = parseWeb(address)
  if (!url) return { kind: 'start' }
  return { kind: 'web', url: url.href, host: url.hostname, blocked: isFrameBlocked(url) }
}

/** Does showing this address mean waiting for a frame to load? */
export function loadsInFrame(address: string): boolean {
  const page = pageFor(address)
  return page.kind === 'file' || (page.kind === 'web' && !page.blocked)
}

// ------------------------------------------------------------- typed text

export interface ResolveOptions {
  engine: SearchEngine
  /** Is this path a file on the KherveOS drive? */
  isFile: (path: string) => boolean
  /** The home folder, for "~/…". */
  home: string
}

/** What the address bar (or the start page's search box) should do with `text`. */
export function resolveInput(text: string, opts: ResolveOptions): Target | null {
  const raw = text.trim()
  if (!raw) return null
  if (/^kherve:/i.test(raw)) return { address: START_PAGE }
  if (/^file:\/\//i.test(raw)) return { address: fileAddress(safeDecode(raw.slice(7)) || '/') }
  if (raw.startsWith('/') || raw.startsWith('~/')) {
    const path = raw.startsWith('~') ? opts.home + raw.slice(1) : raw
    if (opts.isFile(path)) return { address: fileAddress(path) }
  }
  if (/^https?:\/\//i.test(raw)) {
    const url = parseWeb(raw)
    if (url) return { address: webAddress(url) }
  } else if (!/\s/.test(raw)) {
    const host = hostOf(raw)
    const url = host && parseWeb(`${isLocalHost(host) ? 'http' : 'https'}://${raw}`)
    if (url) return { address: webAddress(url) }
  }
  const url = searchUrl(opts.engine, raw)
  return opts.engine.framable ? { address: url } : { external: url }
}

/** The host in "example.org/page" or "localhost:8000", when the text looks like an address. */
function hostOf(text: string): string | null {
  const hostport = /^[^/?#]+/.exec(text)?.[0] ?? ''
  if (hostport.includes('@')) return null // an email address: search for it
  const host = /^(\[[0-9a-f:.]+\]|[^:]+)(?::\d{1,5})?$/i.exec(hostport)?.[1]?.toLowerCase()
  if (!host) return null
  if (host === 'localhost' || host.endsWith('.localhost') || host.startsWith('[')) return host
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host
  return /^([\p{L}\p{N}-]+\.)+\p{L}[\p{L}\p{N}-]+$/u.test(host) ? host : null
}

function isLocalHost(host: string): boolean {
  return /^(localhost|.*\.localhost|.*\.local|\[.*\]|\d{1,3}(\.\d{1,3}){3})$/.test(host)
}

function webAddress(url: URL): string {
  return youtubeEmbed(url) ?? url.href
}

// ----------------------------------------------------------------- framing

const BLOCKERS: ((host: string) => boolean)[] = FRAME_BLOCKING_SITES.map((site) => {
  if (site.endsWith('.*')) {
    const name = site.slice(0, -2).replace(/\./g, '\\.')
    const re = new RegExp(`(^|\\.)${name}\\.((co|com|org|net|ac|gov|edu)\\.[a-z]{2}|com|[a-z]{2})$`)
    return (host) => re.test(host)
  }
  return (host) => host === site || host.endsWith(`.${site}`)
})

/** Is this a site known to refuse being shown inside other pages? */
export function isFrameBlocked(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (/(^|\.)youtube\.com$/.test(host) && url.pathname.startsWith('/embed/')) return false
  return BLOCKERS.some((blocks) => blocks(host))
}

/** "90", "90s", "1m30s", "1h2m3s" → seconds. */
function seconds(t: string | null): number {
  if (!t) return 0
  if (/^\d+$/.test(t)) return Number(t)
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t)
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0
}

/** YouTube watch / youtu.be / shorts links → the youtube-nocookie.com player, which may be framed. */
export function youtubeEmbed(url: URL): string | null {
  const host = url.hostname.toLowerCase()
  let id: string | null | undefined = null
  if (host === 'youtu.be') id = url.pathname.split('/')[1]
  else if (/^((www|m|music)\.)?youtube\.com$/.test(host)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|live|v)\/([^/]+)/.exec(url.pathname)?.[1]
  }
  if (!id || !/^[\w-]{6,20}$/.test(id)) return null
  const embed = new URL(`https://www.youtube-nocookie.com/embed/${id}`)
  const start = seconds(url.searchParams.get('t') ?? url.searchParams.get('start'))
  if (start) embed.searchParams.set('start', String(start))
  const list = url.searchParams.get('list')
  if (list) embed.searchParams.set('list', list)
  return embed.href
}

/** The address to open in a real browser tab (a YouTube player goes back to its watch page). */
export function realTabUrl(address: string): string | null {
  const page = pageFor(address)
  if (page.kind !== 'web') return null
  const url = new URL(page.url)
  const id = /^\/embed\/([\w-]{6,20})$/.exec(url.pathname)?.[1]
  if (!id || !/(^|\.)youtube(-nocookie)?\.com$/.test(url.hostname)) return page.url
  const watch = new URL('https://www.youtube.com/watch')
  watch.searchParams.set('v', id)
  const start = url.searchParams.get('start')
  if (start) watch.searchParams.set('t', `${start}s`)
  const list = url.searchParams.get('list')
  if (list) watch.searchParams.set('list', list)
  return watch.href
}

// ------------------------------------------------------------------- names

/** The query of a search-engine results page, if it is one. */
function searchQuery(url: URL): string | null {
  for (const engine of SEARCH_ENGINES) {
    const base = new URL(engine.url)
    const param = [...base.searchParams.keys()].pop()
    if (param && url.origin === base.origin && url.pathname === base.pathname) return url.searchParams.get(param) || null
  }
  return null
}

/** `title` labels the tab; `name` (host or page name) goes in the window title. */
export function describe(address: string): { title: string; name: string } {
  const page = pageFor(address)
  if (page.kind === 'start') return { title: 'Start page', name: 'Start page' }
  if (page.kind === 'file') {
    const base = page.path.split('/').pop() || page.path
    return { title: base, name: base }
  }
  const url = new URL(page.url)
  const name = page.host.replace(/^www\./, '')
  const query = searchQuery(url)
  if (query) return { title: query, name }
  if (/youtube(-nocookie)?\.com$/.test(name) && url.pathname.startsWith('/embed/')) return { title: 'YouTube video', name }
  return { title: name, name }
}

/** The address as the address bar shows it while not being edited. */
export function displayAddress(address: string): string {
  const page = pageFor(address)
  if (page.kind === 'start') return ''
  if (page.kind === 'file') return address
  const text = page.url.replace(/^https:\/\//, '')
  return safeDecode(text.indexOf('/') === text.length - 1 ? text.slice(0, -1) : text)
}

/** The address as the address bar shows it while being edited. */
export function editAddress(address: string): string {
  return pageFor(address).kind === 'start' ? '' : address
}
