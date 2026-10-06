// Helpers shared by the shell (shell.ts) and its commands (commands.ts).

import { extname } from '@/os/path'
import type { Stat } from '@/os/vfs'
import { style } from './ansi'
import type { Io } from './shell'

export const OS_VERSION = '0.1.0'

export const encoder = new TextEncoder()
export const decoder = new TextDecoder()

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** A shell pattern (*, ?, [abc], \x escapes) as an anchored regular expression. */
export function globRegExp(glob: string, flags = ''): RegExp {
  let re = '^'
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '\\' && i + 1 < glob.length) re += escapeRe(glob[++i])
    else if (c === '*') re += '.*'
    else if (c === '?') re += '.'
    else if (c === '[' && glob.indexOf(']', i + 2) > 0) {
      const end = glob.indexOf(']', i + 2)
      let body = glob.slice(i + 1, end).replace(/\\/g, '\\\\')
      if (body[0] === '!') body = '^' + body.slice(1)
      re += `[${body}]`
      i = end
    } else re += escapeRe(c)
  }
  return new RegExp(re + '$', flags)
}

export function joinShown(prefix: string, name: string): string {
  if (!prefix) return name
  return prefix.endsWith('/') ? prefix + name : `${prefix}/${name}`
}

const REASONS: Record<string, string> = {
  ENOENT: 'no such file or folder',
  EEXIST: 'already exists',
  ENOTDIR: 'not a folder',
  EISDIR: 'is a folder',
  ENOTEMPTY: 'folder is not empty',
  EINVAL: 'invalid operation',
  EPERM: 'not allowed (system folder)',
}

/** A short, human reason for a file-system error. */
export function reason(e: unknown): string {
  const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : ''
  if (code === 'EINVAL' && e instanceof Error && !e.message.startsWith('EINVAL')) {
    return e.message.charAt(0).toLowerCase() + e.message.slice(1)
  }
  if (REASONS[code]) return REASONS[code]
  return e instanceof Error ? e.message : String(e)
}

export function isBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000)
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true
  return false
}

/** Lines of a text, without the empty one after a final newline. */
export function splitLines(text: string): string[] {
  if (!text) return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

export function writeLines(io: Io, lines: string[]) {
  if (lines.length) io.out(lines.join('\n') + '\n')
}

/** Quote a name the way you would type it (for messages and `ls`). */
export function quoteArg(s: string): string {
  if (s && !/[\s'"\\$`!*?[\](){}<>|&;#]/.test(s)) return s
  return s.includes("'") ? `"${s.replace(/(["\\$`])/g, '\\$1')}"` : `'${s}'`
}

const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico', '.avif'])
const ARCHIVE = new Set(['.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar'])
const MEDIA = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.mp4', '.webm', '.mov', '.mkv'])
const RUNNABLE = new Set(['.py', '.sh'])

/** A file or folder name coloured like `ls --color` does. */
export function colorName(name: string, st: Stat, tty: boolean, quote = false): string {
  const shown = quote ? quoteArg(name) : name
  if (!tty) return name
  if (st.type === 'dir') return style.boldBlue(shown)
  const ext = extname(name)
  if (RUNNABLE.has(ext)) return style.green(shown)
  if (IMAGE.has(ext)) return style.magenta(shown)
  if (ARCHIVE.has(ext)) return style.red(shown)
  if (MEDIA.has(ext)) return style.cyan(shown)
  if (ext === '.kbook') return style.yellow(shown)
  return shown
}
