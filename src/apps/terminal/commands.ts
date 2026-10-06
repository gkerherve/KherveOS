// The shell's built-in commands. Each one gets the Shell (for the current
// folder, the drive and the environment), its arguments and an Io to read
// and write through.

import { HOME, basename, dirname, isInside, join, pretty } from '@/os/path'
import type { Stat } from '@/os/vfs'
import { columns, padStart, style } from './ansi'
import type { Io, Shell, ShellFs } from './shell'
import { OS_VERSION, colorName, decoder, escapeRe, globRegExp, isBinary, joinShown, reason, splitLines, writeLines } from './util'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pad2 = (n: number) => String(n).padStart(2, '0')

function humanSize(n: number): string {
  if (n < 1024) return String(n)
  const units = ['K', 'M', 'G', 'T']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return (v < 10 ? v.toFixed(1) : String(Math.round(v))) + units[i]
}

function lsDate(ms: number, now: number): string {
  const d = new Date(ms)
  const recent = Math.abs(now - ms) < 182 * 24 * 3600 * 1000
  const tail = recent ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : ` ${d.getFullYear()}`
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2)} ${tail}`
}

/** "Tue Oct  6 22:14:03 GMT+2 2026", like Unix `date`. */
function unixDate(d: Date): string {
  const zone = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  const day = String(d.getDate()).padStart(2)
  return [DAYS[d.getDay()], MONTHS[d.getMonth()], day, time, zone?.value, String(d.getFullYear())].filter(Boolean).join(' ')
}

function echoEscapes(s: string): string {
  const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', e: '\x1b', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\' }
  return s.replace(/\\(x[0-9a-fA-F]{1,2}|.)/g, (m, c: string) =>
    c[0] === 'x' && c.length > 1 ? String.fromCharCode(parseInt(c.slice(1), 16)) : (map[c] ?? m),
  )
}

interface Opts {
  flags: Set<string>
  values: Map<string, string>
  operands: string[]
}

/** Split "-la foo -n 5" style arguments. `valued` lists the flags that take a value. */
function getopt(args: string[], allowed: string, valued = ''): Opts | { error: string } {
  const flags = new Set<string>()
  const values = new Map<string, string>()
  const operands: string[] = []
  let onlyOperands = false
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (onlyOperands || a === '-' || !a.startsWith('-')) {
      operands.push(a)
      continue
    }
    if (a === '--') {
      onlyOperands = true
      continue
    }
    if (a.startsWith('--')) return { error: `unknown option ${a}` }
    for (let j = 1; j < a.length; j++) {
      const f = a[j]
      if (valued.includes(f)) {
        const v = j + 1 < a.length ? a.slice(j + 1) : args[++k]
        if (v === undefined) return { error: `option -${f} needs a value` }
        values.set(f, v)
        break
      }
      if (!allowed.includes(f)) return { error: `unknown option -${f}` }
      flags.add(f)
    }
  }
  return { flags, values, operands }
}

export function badUsage(io: Io, cmd: string, problem: string): number {
  io.err(`${cmd}: ${problem}\n`)
  const c = COMMANDS[cmd]
  if (c) io.err(`usage: ${c.usage}\n`)
  return 2
}

/** Edits (insert, delete, change, swap two neighbours) to turn `a` into `b`. */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** The command closest to a mistyped name, if one is close enough. */
export function suggestCommand(name: string): string | null {
  let best: string | null = null
  let bestDistance = name.length <= 3 ? 2 : 3
  for (const c of Object.keys(COMMANDS)) {
    const d = editDistance(name, c)
    if (d < bestDistance) {
      best = c
      bestDistance = d
    }
  }
  return best
}

type Group = 'Files' | 'Apps' | 'Python' | 'Shell'

export interface Command {
  group: Group
  usage: string
  summary: string
  /** Extra lines for `help <command>`. */
  more?: string[]
  run(sh: Shell, args: string[], io: Io): number | Promise<number>
}

interface Entry {
  name: string
  st: Stat
}

function longListing(entries: Entry[], user: string, tty: boolean): string {
  const now = Date.now()
  const rows = entries.map((e) => ({
    mode: e.st.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--',
    size: e.st.type === 'dir' ? '-' : humanSize(e.st.size),
    date: lsDate(e.st.mtime, now),
    name: colorName(e.name, e.st, tty, tty),
  }))
  const width = Math.max(...rows.map((r) => r.size.length))
  return rows.map((r) => `${r.mode}  ${user}  ${r.size.padStart(width)}  ${r.date}  ${r.name}`).join('\n') + '\n'
}

async function copyTree(fs: ShellFs, src: string, dst: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  const st = fs.stat(src)
  if (!st) return
  if (st.type === 'file') {
    await fs.writeBytes(dst, await fs.readBytes(src))
    return
  }
  if (!fs.exists(dst)) await fs.mkdir(dst)
  else if (!fs.isDir(dst)) throw Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' })
  for (const child of fs.list(src)) await copyTree(fs, child.path, join(dst, child.name), signal)
}

/** -n N, -nN, -N and (tail) +N. */
function lineCount(cmd: string, args: string[], io: Io): { n: number; fromStart: boolean; files: string[] } | null {
  let n = 10
  let fromStart = false
  const files: string[] = []
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    let v: string | undefined
    if (a === '-n') v = args[++k]
    else if (a.startsWith('-n')) v = a.slice(2)
    else if (/^-\d+$/.test(a)) v = a.slice(1)
    else if (a.startsWith('-') && a !== '-') {
      badUsage(io, cmd, `unknown option ${a}`)
      return null
    } else {
      files.push(a)
      continue
    }
    if (v === undefined || !/^\+?\d+$/.test(v)) {
      badUsage(io, cmd, `not a number of lines: ${v ?? ''}`)
      return null
    }
    fromStart = v.startsWith('+')
    n = parseInt(v, 10)
  }
  return { n, fromStart, files }
}

function headers(io: Io, count: number) {
  return (name: string, index: number) => {
    if (count > 1) io.out(`${index ? '\n' : ''}==> ${name} <==\n`)
  }
}

export const COMMANDS: Record<string, Command> = {
  // ---------------------------------------------------------------- files
  ls: {
    group: 'Files',
    usage: 'ls [-l] [-a] [-1] [path…]',
    summary: 'list a folder (-l for details, -a to show hidden files)',
    more: ['ls -l Documents    sizes and dates', 'ls *.py            only Python files'],
    run(sh, args, io) {
      const o = getopt(args, 'laA1dhF')
      if ('error' in o) return badUsage(io, 'ls', o.error)
      const all = o.flags.has('a')
      const hidden = all || o.flags.has('A')
      const long = o.flags.has('l')
      const targets = o.operands.length ? o.operands : ['.']
      const files: Entry[] = []
      const dirs: Entry[] = []
      let status = 0
      for (const t of targets) {
        const st = sh.fs.stat(sh.abs(t))
        if (!st) {
          io.err(`ls: no such file or folder: ${t}\n`)
          status = 2
        } else if (st.type === 'dir' && !o.flags.has('d')) dirs.push({ name: t, st })
        else files.push({ name: t, st })
      }
      const show = (entries: Entry[]) => {
        if (!entries.length) return
        if (long) io.out(longListing(entries, sh.env.user, io.tty))
        else if (io.tty && !o.flags.has('1')) io.out(columns(entries.map((e) => colorName(e.name, e.st, true, true)), io.cols))
        else writeLines(io, entries.map((e) => e.name))
      }
      show(files)
      dirs.forEach((d, k) => {
        if (targets.length > 1) io.out(`${files.length || k ? '\n' : ''}${d.name}:\n`)
        let entries: Entry[] = sh.fs
          .list(d.st.path)
          .filter((e) => hidden || !e.name.startsWith('.'))
          .map((e) => ({ name: e.name, st: e }))
        if (all) entries = [{ name: '.', st: d.st }, { name: '..', st: sh.fs.stat(dirname(d.st.path)) ?? d.st }, ...entries]
        show(entries)
      })
      return status
    },
  },

  cd: {
    group: 'Files',
    usage: 'cd [folder]',
    summary: 'go to a folder (cd .. goes up, cd - goes back, cd alone goes home)',
    run(sh, args, io) {
      if (args.length > 1) return badUsage(io, 'cd', 'too many arguments')
      let target = args[0] ?? HOME
      if (target === '-') {
        if (!sh.oldPwd) {
          io.err('cd: no previous folder yet\n')
          return 1
        }
        target = sh.oldPwd
        io.out(pretty(target) + '\n')
      }
      const p = sh.abs(target)
      const st = sh.fs.stat(p)
      if (!st) {
        io.err(`cd: no such file or folder: ${target}\n`)
        return 1
      }
      if (st.type !== 'dir') {
        io.err(`cd: not a folder: ${target}\n`)
        return 1
      }
      if (p !== sh.cwd) sh.oldPwd = sh.cwd
      sh.cwd = p
      return 0
    },
  },

  pwd: {
    group: 'Files',
    usage: 'pwd',
    summary: 'print the current folder',
    run(sh, _args, io) {
      io.out(sh.cwd + '\n')
      return 0
    },
  },

  cat: {
    group: 'Files',
    usage: 'cat [-n] file…',
    summary: 'print files (-n numbers the lines)',
    run(sh, args, io) {
      const o = getopt(args, 'n')
      if ('error' in o) return badUsage(io, 'cat', o.error)
      let line = 1
      return sh.eachText('cat', o.operands, io, ({ text }) => {
        if (!o.flags.has('n')) return io.out(text)
        const lines = splitLines(text)
        io.out(lines.map((l) => `${String(line++).padStart(6)}  ${l}`).join('\n') + (lines.length ? '\n' : ''))
      })
    },
  },

  head: {
    group: 'Files',
    usage: 'head [-n lines] file…',
    summary: 'print the first lines of files (10 unless -n)',
    run(sh, args, io) {
      const a = lineCount('head', args, io)
      if (!a) return 2
      const header = headers(io, a.files.length)
      return sh.eachText('head', a.files, io, ({ text }, name, k) => {
        header(name, k)
        writeLines(io, splitLines(text).slice(0, a.n))
      })
    },
  },

  tail: {
    group: 'Files',
    usage: 'tail [-n lines] file…',
    summary: 'print the last lines of files (-n +N starts at line N)',
    run(sh, args, io) {
      const a = lineCount('tail', args, io)
      if (!a) return 2
      const header = headers(io, a.files.length)
      return sh.eachText('tail', a.files, io, ({ text }, name, k) => {
        header(name, k)
        const lines = splitLines(text)
        writeLines(io, a.fromStart ? lines.slice(Math.max(0, a.n - 1)) : a.n ? lines.slice(-a.n) : [])
      })
    },
  },

  wc: {
    group: 'Files',
    usage: 'wc [-l] [-w] [-c] file…',
    summary: 'count lines, words and bytes',
    async run(sh, args, io) {
      const o = getopt(args, 'lwcm')
      if ('error' in o) return badUsage(io, 'wc', o.error)
      const f = o.flags
      const pick = f.size ? ['l', 'w', f.has('m') ? 'm' : 'c'].filter((k) => f.has(k)) : ['l', 'w', 'c']
      const rows: { counts: number[]; name: string }[] = []
      const status = await sh.eachText(
        'wc',
        o.operands,
        io,
        ({ text, bytes }, name) => {
          const all: Record<string, number> = {
            l: (text.match(/\n/g) ?? []).length,
            w: text.split(/\s+/).filter(Boolean).length,
            c: bytes.length,
            m: [...text].length,
          }
          rows.push({ counts: pick.map((k) => all[k]), name: name === '-' ? '' : name })
        },
        { binary: true },
      )
      if (rows.length > 1) rows.push({ counts: pick.map((_, i) => rows.reduce((s, r) => s + r.counts[i], 0)), name: 'total' })
      const width = Math.max(1, ...rows.flatMap((r) => r.counts.map((c) => String(c).length)))
      for (const r of rows) io.out(r.counts.map((c) => padStart(String(c), width)).join(' ') + (r.name ? ` ${r.name}` : '') + '\n')
      return status
    },
  },

  grep: {
    group: 'Files',
    usage: 'grep [-i] [-n] [-r] [-v] [-c] [-l] pattern [file…]',
    summary: 'find lines matching a pattern (-i any case, -n line numbers, -r in folders)',
    more: ['grep -n TODO notes.txt', 'grep -ri "hello" Documents', 'ls | grep py'],
    async run(sh, args, io) {
      const o = getopt(args, 'inrRvclFwHhsqE')
      if ('error' in o) return badUsage(io, 'grep', o.error)
      const f = o.flags
      const [pattern, ...names] = o.operands
      if (pattern === undefined) return badUsage(io, 'grep', 'missing pattern')
      const recursive = f.has('r') || f.has('R')
      let source = f.has('F') ? escapeRe(pattern) : pattern
      if (f.has('w')) source = `\\b(?:${source})\\b`
      let re: RegExp
      try {
        re = new RegExp(source, f.has('i') ? 'gi' : 'g')
      } catch {
        re = new RegExp(escapeRe(pattern), f.has('i') ? 'gi' : 'g')
      }
      const quiet = (s: string) => !f.has('s') && io.err(s)
      let status = 1
      let errors = false
      const inputs: { shown: string; path: string | null }[] = []
      const implicit = !names.length && recursive
      if (!names.length) {
        if (recursive) names.push('.')
        else if (io.stdin !== null) inputs.push({ shown: '(input)', path: null })
        else return badUsage(io, 'grep', 'no file given (grep -r searches the current folder)')
      }
      for (const name of names) {
        const p = sh.abs(name)
        const st = sh.fs.stat(p)
        if (!st) {
          quiet(`grep: no such file or folder: ${name}\n`)
          errors = true
        } else if (st.type === 'dir') {
          if (!recursive) {
            quiet(`grep: is a folder: ${name} (use grep -r to search inside)\n`)
            errors = true
            continue
          }
          for (const s of sh.fs.walk(p)) {
            if (s.type !== 'file') continue
            const rel = s.path.slice(p === '/' ? 1 : p.length + 1)
            inputs.push({ shown: implicit ? rel : joinShown(name, rel), path: s.path })
          }
        } else inputs.push({ shown: name, path: p })
      }
      const showName = !f.has('h') && (f.has('H') || inputs.length > 1 || recursive)
      const tty = io.tty
      const label = (s: string) => (tty ? style.magenta(s) : s)
      const sep = tty ? style.cyan(':') : ':'
      for (const input of inputs) {
        if (io.signal.aborted) break
        let text = io.stdin ?? ''
        let binary = false
        if (input.path) {
          const bytes = await sh.fs.readBytes(input.path)
          binary = isBinary(bytes)
          text = decoder.decode(bytes)
        }
        const lines = splitLines(text)
        let count = 0
        for (let i = 0; i < lines.length; i++) {
          re.lastIndex = 0
          if (re.test(lines[i]) === f.has('v')) continue
          count++
          if (f.has('q')) return 0
          if (f.has('l')) break
          if (f.has('c') || binary) continue
          const line = tty && !f.has('v') ? lines[i].replace(re, (m) => style.boldRed(m)) : lines[i]
          const prefix = (showName ? label(input.shown) + sep : '') + (f.has('n') ? (tty ? style.green(String(i + 1)) : String(i + 1)) + sep : '')
          io.out(prefix + line + '\n')
        }
        if (count) status = 0
        if (f.has('l') && count) io.out(label(input.shown) + '\n')
        else if (f.has('c')) io.out((showName ? label(input.shown) + sep : '') + count + '\n')
        else if (binary && count) io.out(`Binary file ${input.shown} matches\n`)
      }
      return status === 0 ? 0 : errors ? 2 : 1
    },
  },

  find: {
    group: 'Files',
    usage: 'find [folder…] [-name pattern] [-iname pattern] [-type f|d] [-maxdepth n]',
    summary: 'search for files by name (patterns use * and ?)',
    more: ['find . -name "*.py"', 'find ~ -type d -iname "*note*"'],
    run(sh, args, io) {
      const roots: string[] = []
      let k = 0
      while (k < args.length && !args[k].startsWith('-')) roots.push(args[k++])
      let nameRe: RegExp | null = null
      let type: 'f' | 'd' | null = null
      let maxDepth = Infinity
      let minDepth = 0
      for (; k < args.length; k++) {
        const a = args[k]
        const v = args[k + 1]
        if (a === '-name' || a === '-iname') {
          if (v === undefined) return badUsage(io, 'find', `${a} needs a pattern`)
          nameRe = globRegExp(v, a === '-iname' ? 'i' : '')
        } else if (a === '-type') {
          if (v !== 'f' && v !== 'd') return badUsage(io, 'find', '-type needs f (files) or d (folders)')
          type = v
        } else if (a === '-maxdepth' || a === '-mindepth') {
          if (!v || !/^\d+$/.test(v)) return badUsage(io, 'find', `${a} needs a number`)
          if (a === '-maxdepth') maxDepth = +v
          else minDepth = +v
        } else return badUsage(io, 'find', `unknown option ${a}`)
        k++
      }
      if (!roots.length) roots.push('.')
      let status = 0
      for (const root of roots) {
        const st = sh.fs.stat(sh.abs(root))
        if (!st) {
          io.err(`find: no such file or folder: ${root}\n`)
          status = 1
          continue
        }
        const visit = (s: Stat, shown: string, depth: number) => {
          if (io.signal.aborted) return
          const typeOk = !type || (type === 'd') === (s.type === 'dir')
          if (depth >= minDepth && typeOk && (!nameRe || nameRe.test(s.name))) io.out(shown + '\n')
          if (s.type === 'dir' && depth < maxDepth) for (const c of sh.fs.list(s.path)) visit(c, joinShown(shown, c.name), depth + 1)
        }
        visit(st, root, 0)
      }
      return status
    },
  },

  tree: {
    group: 'Files',
    usage: 'tree [-a] [-d] [-L depth] [folder…]',
    summary: 'show a folder and everything inside it as a tree',
    run(sh, args, io) {
      const o = getopt(args, 'ad', 'L')
      if ('error' in o) return badUsage(io, 'tree', o.error)
      const levels = o.values.get('L')
      if (levels !== undefined && !/^[1-9]\d*$/.test(levels)) return badUsage(io, 'tree', '-L needs a number of levels')
      const maxDepth = levels ? +levels : Infinity
      let dirs = 0
      let files = 0
      let status = 0
      for (const root of o.operands.length ? o.operands : ['.']) {
        const st = sh.fs.stat(sh.abs(root))
        if (!st) {
          io.err(`tree: no such file or folder: ${root}\n`)
          status = 1
          continue
        }
        io.out(colorName(root, st, io.tty) + '\n')
        const walk = (dir: string, prefix: string, depth: number) => {
          const entries = sh.fs
            .list(dir)
            .filter((e) => (o.flags.has('a') || !e.name.startsWith('.')) && (!o.flags.has('d') || e.type === 'dir'))
          entries.forEach((e, i) => {
            if (io.signal.aborted) return
            const last = i === entries.length - 1
            io.out(`${prefix}${last ? '└── ' : '├── '}${colorName(e.name, e, io.tty)}\n`)
            if (e.type === 'dir') {
              dirs++
              if (depth + 1 < maxDepth) walk(e.path, prefix + (last ? '    ' : '│   '), depth + 1)
            } else files++
          })
        }
        if (st.type === 'dir') walk(st.path, '', 0)
      }
      io.out(`\n${dirs} ${dirs === 1 ? 'folder' : 'folders'}, ${files} ${files === 1 ? 'file' : 'files'}\n`)
      return status
    },
  },

  mkdir: {
    group: 'Files',
    usage: 'mkdir [-p] folder…',
    summary: 'create folders (-p also creates the folders above)',
    async run(sh, args, io) {
      const o = getopt(args, 'pv')
      if ('error' in o) return badUsage(io, 'mkdir', o.error)
      if (!o.operands.length) return badUsage(io, 'mkdir', 'missing folder name')
      const parents = o.flags.has('p')
      let status = 0
      for (const name of o.operands) {
        const p = sh.abs(name)
        if (sh.fs.exists(p)) {
          if (parents && sh.fs.isDir(p)) continue
          io.err(`mkdir: already exists: ${name}\n`)
          status = 1
          continue
        }
        try {
          await sh.fs.mkdir(p, { recursive: parents })
        } catch (e) {
          const hint = !parents && !sh.fs.exists(dirname(p)) ? ' (mkdir -p also creates the folders above)' : ''
          io.err(`mkdir: ${reason(e)}: ${name}${hint}\n`)
          status = 1
        }
      }
      return status
    },
  },

  rmdir: {
    group: 'Files',
    usage: 'rmdir folder…',
    summary: 'delete empty folders',
    async run(sh, args, io) {
      if (!args.length) return badUsage(io, 'rmdir', 'missing folder name')
      let status = 0
      for (const name of args) {
        const p = sh.abs(name)
        const st = sh.fs.stat(p)
        let problem = ''
        if (!st) problem = 'no such file or folder'
        else if (st.type !== 'dir') problem = 'not a folder'
        else if (sh.fs.list(p).length) problem = 'folder is not empty'
        else {
          try {
            await sh.fs.remove(p)
          } catch (e) {
            problem = reason(e)
          }
        }
        if (problem) {
          io.err(`rmdir: ${problem}: ${name}\n`)
          status = 1
        }
      }
      return status
    },
  },

  rm: {
    group: 'Files',
    usage: 'rm [-r] [-f] path…',
    summary: 'delete files (-r for folders and everything in them, -f ignores missing files)',
    async run(sh, args, io) {
      const o = getopt(args, 'rRfidv')
      if ('error' in o) return badUsage(io, 'rm', o.error)
      const recursive = o.flags.has('r') || o.flags.has('R')
      const force = o.flags.has('f')
      if (!o.operands.length) return force ? 0 : badUsage(io, 'rm', 'missing file name')
      let status = 0
      for (const name of o.operands) {
        if (io.signal.aborted) break
        if (/(^|\/)\.\.?\/*$/.test(name)) {
          io.err(`rm: refusing to delete '.' or '..': ${name}\n`)
          status = 1
          continue
        }
        const p = sh.abs(name)
        const st = sh.fs.stat(p)
        if (!st) {
          if (!force) {
            io.err(`rm: no such file or folder: ${name}\n`)
            status = 1
          }
          continue
        }
        if (st.type === 'dir' && !recursive && !(o.flags.has('d') && !sh.fs.list(p).length)) {
          io.err(`rm: is a folder: ${name} (use rm -r to delete it and everything inside)\n`)
          status = 1
          continue
        }
        try {
          await sh.fs.remove(p, { recursive: true })
        } catch (e) {
          io.err(`rm: ${reason(e)}: ${name}\n`)
          status = 1
        }
      }
      return status
    },
  },

  touch: {
    group: 'Files',
    usage: 'touch file…',
    summary: 'create empty files (or update their date)',
    async run(sh, args, io) {
      if (!args.length) return badUsage(io, 'touch', 'missing file name')
      let status = 0
      for (const name of args) {
        const p = sh.abs(name)
        const st = sh.fs.stat(p)
        try {
          if (!st) await sh.fs.writeText(p, '')
          else if (st.type === 'file') await sh.fs.writeBytes(p, await sh.fs.readBytes(p))
        } catch (e) {
          io.err(`touch: ${reason(e)}: ${name}\n`)
          status = 1
        }
      }
      return status
    },
  },

  cp: {
    group: 'Files',
    usage: 'cp [-r] source… destination',
    summary: 'copy files (-r copies folders too)',
    more: ['cp notes.txt notes-backup.txt', 'cp -r Documents ~/Desktop'],
    async run(sh, args, io) {
      const o = getopt(args, 'rRfvai')
      if ('error' in o) return badUsage(io, 'cp', o.error)
      const recursive = o.flags.has('r') || o.flags.has('R') || o.flags.has('a')
      if (o.operands.length < 2) return badUsage(io, 'cp', o.operands.length ? `missing destination after ${o.operands[0]}` : 'missing file names')
      const dest = o.operands[o.operands.length - 1]
      const destAbs = sh.abs(dest)
      const intoDir = sh.fs.isDir(destAbs)
      const sources = o.operands.slice(0, -1)
      if (sources.length > 1 && !intoDir) {
        io.err(`cp: not a folder: ${dest}\n`)
        return 1
      }
      let status = 0
      for (const src of sources) {
        if (io.signal.aborted) break
        const s = sh.abs(src)
        const st = sh.fs.stat(s)
        const target = intoDir ? join(destAbs, basename(s)) : destAbs
        let problem = ''
        if (!st) problem = `no such file or folder: ${src}`
        else if (st.type === 'dir' && !recursive) problem = `is a folder: ${src} (use cp -r to copy folders)`
        else if (target === s) problem = `cannot copy a file onto itself: ${src}`
        else if (st.type === 'dir' && isInside(target, s)) problem = `cannot copy a folder into itself: ${src}`
        else {
          try {
            await copyTree(sh.fs, s, target, io.signal)
          } catch (e) {
            problem = `${reason(e)}: ${pretty(target)}`
          }
        }
        if (problem) {
          io.err(`cp: ${problem}\n`)
          status = 1
        }
      }
      return status
    },
  },

  mv: {
    group: 'Files',
    usage: 'mv source… destination',
    summary: 'move or rename files and folders',
    more: ['mv draft.txt final.txt     rename', 'mv *.png ~/Pictures        move into a folder'],
    async run(sh, args, io) {
      const o = getopt(args, 'fvin')
      if ('error' in o) return badUsage(io, 'mv', o.error)
      if (o.operands.length < 2) return badUsage(io, 'mv', o.operands.length ? `missing destination after ${o.operands[0]}` : 'missing file names')
      const dest = o.operands[o.operands.length - 1]
      const destAbs = sh.abs(dest)
      const intoDir = sh.fs.isDir(destAbs)
      const sources = o.operands.slice(0, -1)
      if (sources.length > 1 && !intoDir) {
        io.err(`mv: not a folder: ${dest}\n`)
        return 1
      }
      let status = 0
      for (const src of sources) {
        const s = sh.abs(src)
        const target = intoDir ? join(destAbs, basename(s)) : destAbs
        let problem = ''
        if (!sh.fs.exists(s)) problem = `no such file or folder: ${src}`
        else if (target !== s) {
          const existing = sh.fs.stat(target)
          try {
            if (existing && (existing.type === 'dir' || sh.fs.isDir(s))) problem = `already exists: ${pretty(target)}`
            else await sh.fs.rename(s, target, { overwrite: !!existing })
            if (!problem) sh.followRename(s, target)
          } catch (e) {
            problem = `${reason(e)}: ${src}`
          }
        }
        if (problem) {
          io.err(`mv: ${problem}\n`)
          status = 1
        }
      }
      return status
    },
  },

  // ----------------------------------------------------------------- apps
  open: {
    group: 'Apps',
    usage: 'open path…',
    summary: 'open files or folders with their app',
    run(sh, args, io) {
      if (!args.length) return badUsage(io, 'open', 'missing file or folder name')
      let status = 0
      for (const name of args) {
        const p = sh.abs(name)
        if (sh.fs.exists(p)) sh.env.openFile(p)
        else {
          io.err(`open: no such file or folder: ${name}\n`)
          status = 1
        }
      }
      return status
    },
  },

  edit: {
    group: 'Apps',
    usage: 'edit file…',
    summary: 'edit files in Notepad (creates them if needed)',
    async run(sh, args, io) {
      if (!args.length) return badUsage(io, 'edit', 'missing file name')
      let status = 0
      for (const name of args) {
        const p = sh.abs(name)
        const st = sh.fs.stat(p)
        try {
          if (st?.type === 'dir') throw Object.assign(new Error('EISDIR'), { code: 'EISDIR' })
          if (!st) await sh.fs.writeText(p, '')
          sh.env.openApp('notepad', { path: p })
        } catch (e) {
          io.err(`edit: ${reason(e)}: ${name}\n`)
          status = 1
        }
      }
      return status
    },
  },

  download: {
    group: 'Apps',
    usage: 'download file…',
    summary: "save files to your computer's Downloads folder",
    async run(sh, args, io) {
      if (!args.length) return badUsage(io, 'download', 'missing file name')
      let status = 0
      for (const name of args) {
        const p = sh.abs(name)
        const st = sh.fs.stat(p)
        let problem = ''
        if (!st) problem = 'no such file or folder'
        else if (st.type === 'dir') problem = 'folders cannot be downloaded yet'
        else {
          try {
            await sh.env.download(p)
            io.out(`Downloading ${basename(p)}…\n`)
          } catch (e) {
            problem = reason(e)
          }
        }
        if (problem) {
          io.err(`download: ${problem}: ${name}\n`)
          status = 1
        }
      }
      return status
    },
  },

  upload: {
    group: 'Apps',
    usage: 'upload [folder]',
    summary: 'copy files from your computer into this folder',
    async run(sh, args, io) {
      if (args.length > 1) return badUsage(io, 'upload', 'too many arguments')
      const name = args[0] ?? '.'
      const dir = sh.abs(name)
      const st = sh.fs.stat(dir)
      if (st?.type !== 'dir') {
        io.err(`upload: ${st ? 'not a folder' : 'no such file or folder'}: ${name}\n`)
        return 1
      }
      io.out(style.muted(`Choose the files to copy into ${pretty(dir)}… (Ctrl+C cancels)`) + '\n')
      const added = await sh.env.upload(dir)
      if (io.signal.aborted) return 130
      if (!added.length) {
        io.err('upload: no files chosen\n')
        return 1
      }
      for (const p of added) io.out(`Uploaded ${pretty(p)}\n`)
      return 0
    },
  },

  // --------------------------------------------------------------- python
  python: {
    group: 'Python',
    usage: 'python [file.py [args…]] | python -c code',
    summary: 'start Python, or run a Python file',
    more: ['python             the >>> prompt (exit() or Ctrl+D leaves)', 'python hello.py 3   run a script with arguments'],
    run(sh, args, io) {
      const py = sh.env.python
      if (!py) {
        io.err('python: Python is not available here\n')
        return 1
      }
      if (!args.length) {
        if (io.stdin !== null) return py.code(io.stdin, io)
        if (!io.tty) {
          io.err('python: the >>> prompt needs the terminal (remove the redirection)\n')
          return 2
        }
        return py.repl(io)
      }
      const [first, ...rest] = args
      if (first === '-V' || first === '--version') return py.version(io)
      if (first === '-c') {
        if (!rest.length) return badUsage(io, 'python', '-c needs some code')
        return py.code(rest[0], io)
      }
      if (first === '-m') {
        if (rest[0] === 'pip') return COMMANDS.pip.run(sh, rest.slice(1), io)
        io.err(`python: -m ${rest[0] ?? ''} is not supported here\n`)
        return 2
      }
      if (first.startsWith('-')) return badUsage(io, 'python', `unknown option ${first}`)
      const p = sh.abs(first)
      const st = sh.fs.stat(p)
      if (!st || st.type === 'dir') {
        io.err(`python: can't open file: ${first}: ${st ? 'is a folder' : 'no such file or folder'}\n`)
        return 2
      }
      if (!isInside(p, HOME)) {
        io.err(`python: only files inside your home folder (~) can be run: ${first}\n`)
        return 2
      }
      return py.script(p, rest, sh.cwd, io)
    },
  },

  pip: {
    group: 'Python',
    usage: 'pip install package… | pip install -r requirements.txt',
    summary: 'add pure-Python packages from PyPI',
    async run(sh, args, io) {
      const py = sh.env.python
      if (!py) {
        io.err('pip: Python is not available here\n')
        return 1
      }
      const [sub, ...rest] = args
      if (sub !== 'install') {
        if (sub && !['help', '-h', '--help'].includes(sub)) io.err(`pip: only "pip install" works in KherveOS\n`)
        io.err(`usage: ${COMMANDS.pip.usage}\n`)
        return sub ? 1 : 2
      }
      const packages: string[] = []
      for (let k = 0; k < rest.length; k++) {
        const a = rest[k]
        if (a === '-r' || a === '--requirement') {
          const f = await sh.readFile('pip', rest[++k] ?? '', io)
          if (!f) return 1
          for (const line of splitLines(f.text)) {
            const req = line.replace(/#.*/, '').trim()
            if (req && !req.startsWith('-')) packages.push(req)
          }
        } else if (!a.startsWith('-')) packages.push(a)
      }
      if (!packages.length) return badUsage(io, 'pip', 'nothing to install')
      return py.install(packages, io)
    },
  },

  // ---------------------------------------------------------------- shell
  echo: {
    group: 'Shell',
    usage: 'echo [-n] [-e] text…',
    summary: 'print text (echo hi > file.txt writes a file)',
    run(_sh, args, io) {
      let newline = true
      let escapes = false
      let k = 0
      for (; k < args.length && /^-[neE]+$/.test(args[k]); k++) {
        for (const f of args[k].slice(1)) {
          if (f === 'n') newline = false
          else escapes = f === 'e'
        }
      }
      const text = args.slice(k).join(' ')
      io.out((escapes ? echoEscapes(text) : text) + (newline ? '\n' : ''))
      return 0
    },
  },

  clear: {
    group: 'Shell',
    usage: 'clear',
    summary: 'clear the screen (Ctrl+L too)',
    run(_sh, _args, io) {
      io.clear()
      return 0
    },
  },

  history: {
    group: 'Shell',
    usage: 'history [count] | history -c',
    summary: 'list the commands you typed (-c forgets them)',
    run(sh, args, io) {
      const h = sh.env.history
      if (args[0] === '-c') {
        h.clear()
        return 0
      }
      if (args[0] !== undefined && !/^\d+$/.test(args[0])) return badUsage(io, 'history', `not a number: ${args[0]}`)
      const items = h.items
      const from = args[0] ? Math.max(0, items.length - +args[0]) : 0
      const width = Math.max(4, String(items.length).length)
      let out = ''
      for (let i = from; i < items.length; i++) out += `${String(i + 1).padStart(width)}  ${items[i]}\n`
      io.out(out)
      return 0
    },
  },

  date: {
    group: 'Shell',
    usage: 'date',
    summary: 'print the date and time',
    run(_sh, args, io) {
      if (args.length) return badUsage(io, 'date', `unknown argument ${args[0]}`)
      io.out(unixDate(new Date()) + '\n')
      return 0
    },
  },

  whoami: {
    group: 'Shell',
    usage: 'whoami',
    summary: 'print your user name',
    run(sh, _args, io) {
      io.out(sh.env.user + '\n')
      return 0
    },
  },

  uname: {
    group: 'Shell',
    usage: 'uname [-a]',
    summary: 'print the system name (-a for everything)',
    run(sh, args, io) {
      const o = getopt(args, 'asnrvmo')
      if ('error' in o) return badUsage(io, 'uname', o.error)
      const info: Record<string, string> = { s: 'KherveOS', n: sh.env.hostname, r: OS_VERSION, v: '#1', m: 'browser', o: 'KherveOS' }
      const order = ['s', 'n', 'r', 'v', 'm', 'o']
      let pick = o.flags.has('a') ? order : order.filter((k) => o.flags.has(k))
      if (!pick.length) pick = ['s']
      io.out(pick.map((k) => info[k]).join(' ') + '\n')
      return 0
    },
  },

  env: {
    group: 'Shell',
    usage: 'env',
    summary: 'list the shell variables (use them as $NAME)',
    run(sh, _args, io) {
      writeLines(io, sh.environment().map(([k, v]) => `${k}=${v}`))
      return 0
    },
  },

  export: {
    group: 'Shell',
    usage: 'export NAME=value…',
    summary: 'set shell variables',
    run(sh, args, io) {
      if (!args.length) return COMMANDS.env.run(sh, [], io)
      let status = 0
      for (const a of args) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:=([\s\S]*))?$/.exec(a)
        if (!m) {
          io.err(`export: not a valid name: ${a}\n`)
          status = 1
        } else if (m[2] !== undefined) sh.setVar(m[1], m[2])
      }
      return status
    },
  },

  sort: {
    group: 'Shell',
    usage: 'sort [-r] [-n] [-u] [file…]',
    summary: 'sort lines (-r reverse, -n by number, -u drop repeats)',
    async run(sh, args, io) {
      const o = getopt(args, 'rnuf')
      if ('error' in o) return badUsage(io, 'sort', o.error)
      const lines: string[] = []
      const status = await sh.eachText('sort', o.operands, io, ({ text }) => {
        for (const l of splitLines(text)) lines.push(l)
      })
      const num = (s: string) => parseFloat(s) || 0
      lines.sort(o.flags.has('n') ? (a, b) => num(a) - num(b) || a.localeCompare(b) : (a, b) => a.localeCompare(b))
      if (o.flags.has('r')) lines.reverse()
      writeLines(io, o.flags.has('u') ? lines.filter((l, i) => i === 0 || l !== lines[i - 1]) : lines)
      return status
    },
  },

  uniq: {
    group: 'Shell',
    usage: 'uniq [-c] [file]',
    summary: 'drop repeated lines next to each other (-c counts them)',
    async run(sh, args, io) {
      const o = getopt(args, 'c')
      if ('error' in o) return badUsage(io, 'uniq', o.error)
      return sh.eachText('uniq', o.operands, io, ({ text }) => {
        const out: [string, number][] = []
        for (const l of splitLines(text)) {
          const last = out[out.length - 1]
          if (last && last[0] === l) last[1]++
          else out.push([l, 1])
        }
        writeLines(io, out.map(([l, n]) => (o.flags.has('c') ? `${String(n).padStart(7)} ${l}` : l)))
      })
    },
  },

  sleep: {
    group: 'Shell',
    usage: 'sleep seconds',
    summary: 'wait a little (Ctrl+C stops it)',
    async run(_sh, args, io) {
      const s = Number(args[0])
      if (args.length !== 1 || !(s >= 0)) return badUsage(io, 'sleep', 'needs a number of seconds')
      await new Promise<void>((done) => {
        const t = setTimeout(done, s * 1000)
        io.signal.addEventListener('abort', () => (clearTimeout(t), done()), { once: true })
      })
      return io.signal.aborted ? 130 : 0
    },
  },

  help: {
    group: 'Shell',
    usage: 'help [command]',
    summary: 'list the commands, or explain one',
    run(_sh, args, io) {
      if (args.length) {
        let status = 0
        for (const a of args) {
          const name = ALIASES[a]?.[0] ?? a
          const c = COMMANDS[name]
          if (!c) {
            io.err(`help: no such command: ${a}\n`)
            status = 1
            continue
          }
          io.out(`${style.bold('usage:')} ${c.usage}\n  ${c.summary}\n`)
          if (c.more) io.out(c.more.map((l) => '  ' + style.muted(l)).join('\n') + '\n')
        }
        return status
      }
      let out = ''
      for (const group of ['Files', 'Apps', 'Python', 'Shell'] as Group[]) {
        out += style.bold(group) + '\n'
        for (const [name, c] of Object.entries(COMMANDS)) if (c.group === group) out += `  ${style.green(name.padEnd(9))} ${c.summary}\n`
      }
      out +=
        '\n' +
        style.muted(
          [
            "Quotes '…' \"…\", ~ for home, *.py patterns, | pipes, > and >> to save output, ; and && to chain.",
            'Tab completes names, ↑ ↓ recall commands, Ctrl+C cancels. help <command> explains one.',
          ].join('\n'),
        ) +
        '\n'
      io.out(out)
      return 0
    },
  },

  exit: {
    group: 'Shell',
    usage: 'exit',
    summary: 'close the terminal',
    run(sh) {
      sh.env.exit()
      return 0
    },
  },
}

export const ALIASES: Record<string, string[]> = {
  ll: ['ls', '-l'],
  la: ['ls', '-a'],
  python3: ['python'],
  pip3: ['pip'],
  man: ['help'],
  cls: ['clear'],
}
