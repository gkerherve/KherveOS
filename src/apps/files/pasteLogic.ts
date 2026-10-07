// Pure rules for copy / cut / paste of files: names, what goes where, and
// which clipboard wins. No imports, so Node can test it directly
// (tools/tests/files-paste.test.ts).

/** Is `child` the same as, or inside, folder `parent`? (absolute, normalised paths) */
export function inside(child: string, parent: string): boolean {
  return parent === '/' ? child.startsWith('/') : child === parent || child.startsWith(parent + '/')
}

function parentOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

function nameOf(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1)
}

function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`
}

/** Split "report.final.pdf" into ["report.final", ".pdf"]; folders and ".bashrc" have no extension. */
export function splitExt(name: string, isDir: boolean): [string, string] {
  if (isDir) return [name, '']
  const dot = name.lastIndexOf('.')
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
}

/**
 * The name a pasted copy gets in a folder, like macOS:
 * "a.txt" → "a copy.txt" → "a copy 2.txt" → "a copy 3.txt"…
 * Copying "a copy.txt" again gives "a copy 2.txt", not "a copy copy.txt".
 */
export function copyName(name: string, isDir: boolean, taken: (name: string) => boolean): string {
  if (!taken(name)) return name
  const [stem, ext] = splitExt(name, isDir)
  const base = stem.replace(/ copy( \d+)?$/, '') || stem
  for (let i = 1; ; i++) {
    const candidate = `${base} copy${i === 1 ? '' : ` ${i}`}${ext}`
    if (!taken(candidate)) return candidate
  }
}

/** The name a moved item gets when the folder already has one ("a.txt" → "a 2.txt"), like "Keep both". */
export function moveName(name: string, isDir: boolean, taken: (name: string) => boolean): string {
  if (!taken(name)) return name
  const [stem, ext] = splitExt(name, isDir)
  for (let i = 2; ; i++) {
    const candidate = `${stem} ${i}${ext}`
    if (!taken(candidate)) return candidate
  }
}

export interface PasteStep {
  from: string
  to: string
}

export interface PastePlan {
  steps: PasteStep[]
  /** Items left out, with the reason. */
  skipped: { path: string; reason: 'missing' | 'into-itself' | 'same-folder' }[]
}

/**
 * Work out where each copied (or cut) item goes when pasted into `dir`.
 * `exists` and `isDir` describe the drive *before* the paste; names chosen for
 * earlier items count as taken for later ones.
 */
export function planPaste(
  paths: string[],
  dir: string,
  mode: 'copy' | 'cut',
  exists: (p: string) => boolean,
  isDir: (p: string) => boolean,
): PastePlan {
  const steps: PasteStep[] = []
  const skipped: PastePlan['skipped'] = []
  const planned = new Set<string>()
  const taken = (name: string) => {
    const p = joinPath(dir, name)
    return planned.has(p) || exists(p)
  }
  // A folder and something inside it both copied: the folder brings it along.
  const unique = [...new Set(paths)]
  const top = unique.filter((p) => !unique.some((q) => q !== p && inside(p, q)))
  for (const p of top) {
    if (!exists(p)) {
      skipped.push({ path: p, reason: 'missing' })
      continue
    }
    const folder = isDir(p)
    if (folder && inside(dir, p)) {
      skipped.push({ path: p, reason: 'into-itself' })
      continue
    }
    if (mode === 'cut' && parentOf(p) === dir) {
      skipped.push({ path: p, reason: 'same-folder' })
      continue
    }
    const name = nameOf(p)
    // A move only renames on a clash with something else; a copy into its own folder clashes with itself.
    const target = joinPath(dir, mode === 'cut' ? moveName(name, folder, taken) : copyName(name, folder, taken))
    planned.add(target)
    steps.push({ from: p, to: target })
  }
  return { steps, skipped }
}

/** Top-level names in a zip's entry list ("a/b.txt", "a/", "c.txt" → a (folder), c.txt (file)). */
export function zipTopLevel(entries: string[]): { name: string; isDir: boolean }[] {
  const out = new Map<string, boolean>()
  for (const e of entries) {
    const clean = safeZipPath(e)
    if (!clean) continue
    const slash = clean.indexOf('/')
    const first = slash < 0 ? clean : clean.slice(0, slash)
    const dirEntry = slash >= 0 || e.endsWith('/')
    out.set(first, (out.get(first) ?? false) || dirEntry)
  }
  return [...out].map(([name, isDir]) => ({ name, isDir }))
}

/** A zip entry name made safe to write under a folder, or null if it tries to escape it. */
export function safeZipPath(entry: string): string | null {
  if (entry.includes('\\') || entry.startsWith('/') || entry.includes('\0')) return null
  const parts = entry.split('/').filter((s) => s !== '' && s !== '.')
  if (!parts.length || parts.some((s) => s === '..')) return null
  return parts.join('/')
}

export interface ClipboardStamp {
  /** When the copy was made, in ms since 1970. */
  time: number
}

export interface ServerStamp extends ClipboardStamp {
  deviceId: string
}

/**
 * Which clipboard a Paste uses: the newest one. The server clipboard only
 * counts when it was copied on another computer (a copy made here is already
 * the local clipboard).
 */
export function pickClipboard(
  local: ClipboardStamp | null,
  server: ServerStamp | null,
  myDeviceId: string,
): 'local' | 'server' | null {
  const remote = server && server.deviceId !== myDeviceId ? server : null
  if (local && remote) return remote.time > local.time ? 'server' : 'local'
  if (local) return 'local'
  if (remote) return 'server'
  return null
}

/** "Paste Item", "Paste 3 Items", "Paste from Chrome on Windows". */
export function pasteLabel(count: number, fromDevice?: string | null): string {
  if (fromDevice) return `Paste from ${fromDevice}`
  return count === 1 ? 'Paste Item' : count > 1 ? `Paste ${count} Items` : 'Paste'
}

/** Text for a DownloadURL drag ("mime:name:url"): a ':' in the name would break it. */
export function downloadUrlData(mime: string, name: string, url: string): string {
  const safe = name.replace(/[:\\/\n\r]/g, '-') || 'download'
  return `${mime || 'application/octet-stream'}:${safe}:${url}`
}

/** "Chrome on macOS" from a user-agent string. */
export function deviceName(ua: string): string {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser'
  const system = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /CrOS/.test(ua)
        ? 'ChromeOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'another computer'
  return `${browser} on ${system}`
}

/** Can this browser drag a file out to the computer ("DownloadURL")? Only Chromium-based ones. */
export function supportsDownloadUrl(ua: string): boolean {
  return /Chrome\/|Chromium\/|Edg\//.test(ua) && !/Firefox\//.test(ua)
}
