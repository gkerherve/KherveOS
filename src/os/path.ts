// POSIX-style path helpers for the KherveOS virtual file system.
// Every path the VFS stores is absolute and normalised: "/", "/home/user/a.txt".

export const HOME = '/home/user'

export function normalize(p: string): string {
  const abs = p.startsWith('/')
  const out: string[] = []
  for (const part of p.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.')
}

/** Resolve `p` against `cwd`; understands "~" for the home folder. */
export function resolve(cwd: string, p: string): string {
  if (p === '~') return HOME
  if (p.startsWith('~/')) return normalize(HOME + p.slice(1))
  if (p.startsWith('/')) return normalize(p)
  return normalize(cwd + '/' + p)
}

export function join(...parts: string[]): string {
  return normalize(parts.filter(Boolean).join('/'))
}

export function dirname(p: string): string {
  const n = normalize(p)
  if (n === '/') return '/'
  const i = n.lastIndexOf('/')
  return i <= 0 ? '/' : n.slice(0, i)
}

export function basename(p: string): string {
  const n = normalize(p)
  if (n === '/') return '/'
  return n.slice(n.lastIndexOf('/') + 1)
}

/** ".txt" for "/a/b.txt", "" when there is no extension (".bashrc" has none). */
export function extname(p: string): string {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i).toLowerCase() : ''
}

/** "~/Documents" for paths under home, otherwise the path itself. */
export function pretty(p: string): string {
  if (p === HOME) return '~'
  if (p.startsWith(HOME + '/')) return '~' + p.slice(HOME.length)
  return p
}

export function isInside(child: string, parent: string): boolean {
  return parent === '/' ? child.startsWith('/') : child === parent || child.startsWith(parent + '/')
}
