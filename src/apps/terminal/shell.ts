// The KherveOS shell: a small POSIX-flavoured command interpreter over the
// virtual drive — quotes, ~ and $VAR, *.py patterns, pipes, > and >>
// redirection, and ; && || lists. It never touches the DOM or xterm: the
// Terminal app hands it command lines and somewhere to write, and everything
// else (opening apps, downloads, Python) comes in through ShellEnv.
// The commands themselves live in commands.ts.

import { HOME, dirname, isInside, join, resolve } from '@/os/path'
import type { fs as vfs } from '@/os/vfs'
import { style } from './ansi'
import { ALIASES, COMMANDS, badUsage, suggestCommand } from './commands'
import type { CompletionResult } from './lineEditor'
import { colorName, decoder, encoder, globRegExp, isBinary, joinShown, quoteArg, reason } from './util'

export type ShellFs = Pick<
  typeof vfs,
  'stat' | 'exists' | 'isDir' | 'isFile' | 'list' | 'walk' | 'readBytes' | 'writeBytes' | 'writeText' | 'mkdir' | 'remove' | 'rename'
>

/** Where a command reads and writes. */
export interface Io {
  /** Piped or redirected input; null when the command reads from the keyboard. */
  stdin: string | null
  out(text: string): void
  err(text: string): void
  /** Clear the screen (only meaningful when `tty`). */
  clear(): void
  /** Output goes straight to the terminal: colours and columns are welcome. */
  tty: boolean
  cols: number
  /** Aborted when the user presses Ctrl+C. */
  signal: AbortSignal
}

/** The terminal, as the shell sees it. */
export interface TermOut {
  out(text: string): void
  /** Error text (shown in red). */
  err(text: string): void
  clear(): void
  cols(): number
}

/** Python, provided by the Terminal app (one interpreter per window). */
export interface PythonBridge {
  /** The interactive >>> prompt. */
  repl(io: Io): Promise<number>
  script(path: string, argv: string[], cwd: string, io: Io): Promise<number>
  /** `python -c "…"` or code piped into `python`. */
  code(source: string, io: Io): Promise<number>
  install(packages: string[], io: Io): Promise<number>
  version(io: Io): Promise<number>
}

export interface ShellEnv {
  fs: ShellFs
  user: string
  hostname: string
  /** Open a file or folder with its default app. */
  openFile(path: string): void
  openApp(appId: string, args: { path: string }): void
  download(path: string): Promise<void>
  /** Ask for files from the computer and copy them into `dir`; resolves with the new paths. */
  upload(dir: string): Promise<string[]>
  /** Close the terminal window. */
  exit(): void
  history: { readonly items: string[]; clear(): void }
  python: PythonBridge | null
}

// ------------------------------------------------------------------ parsing

/** A piece of a word: literal text (quoted or not), a $VARIABLE, or a leading ~. */
type Part = { t: 'lit'; s: string; q: boolean } | { t: 'var'; name: string } | { t: 'tilde' }
type Op = '|' | ';' | '&&' | '||' | '>' | '>>' | '<' | '2>' | '2>>' | '2>&1'
type Token = { kind: 'word'; parts: Part[] } | { kind: 'op'; op: Op }
type RedirectOp = '>' | '>>' | '<' | '2>' | '2>>'

interface SimpleCommand {
  words: Part[][]
  redirects: { op: RedirectOp; target: Part[] }[]
  errToOut: boolean
}

interface ListItem {
  /** How this pipeline is joined to the previous one. */
  connector: ';' | '&&' | '||' | null
  pipeline: SimpleCommand[]
}

export class ShellSyntaxError extends Error {}

const BREAK = new Set([' ', '\t', '\n', '\r', '|', '&', ';', '<', '>'])

function readVar(src: string, i: number): { name: string; len: number } | null {
  const rest = src.slice(i + 1)
  const m = /^\{([A-Za-z_][A-Za-z0-9_]*|\?)\}/.exec(rest) ?? /^([A-Za-z_][A-Za-z0-9_]*|\?)/.exec(rest)
  return m ? { name: m[1], len: m[0].length + 1 } : null
}

export function lex(src: string): Token[] {
  const tokens: Token[] = []
  const op = (o: Op) => tokens.push({ kind: 'op', op: o })
  const n = src.length
  let i = 0
  while (i < n) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
      continue
    }
    if (c === '#') break // a comment runs to the end of the line
    if (c === '|' || c === '&' || c === ';' || c === '<' || c === '>') {
      const two = src.slice(i, i + 2)
      if (two === '||' || two === '&&' || two === '>>') {
        op(two)
        i += 2
        continue
      }
      if (c === '&') throw new ShellSyntaxError("'&' (running in the background) is not supported")
      op(c)
      i++
      continue
    }
    if (src.startsWith('2>', i)) {
      const o = src.startsWith('2>&1', i) ? '2>&1' : src.startsWith('2>>', i) ? '2>>' : '2>'
      op(o)
      i += o.length
      continue
    }

    // a word, made of literal, quoted and $variable pieces
    const parts: Part[] = []
    const lit = (s: string, q: boolean) => {
      const last = parts[parts.length - 1]
      if (last?.t === 'lit' && last.q === q) last.s += s
      else parts.push({ t: 'lit', s, q })
    }
    if (c === '~' && (i + 1 >= n || src[i + 1] === '/' || BREAK.has(src[i + 1]))) {
      parts.push({ t: 'tilde' })
      i++
    }
    while (i < n && !BREAK.has(src[i])) {
      const ch = src[i]
      if (ch === '\\') {
        if (i + 1 < n) lit(src[i + 1], true)
        i += 2
      } else if (ch === "'") {
        const end = src.indexOf("'", i + 1)
        if (end < 0) throw new ShellSyntaxError("missing closing quote (')")
        lit(src.slice(i + 1, end), true)
        i = end + 1
      } else if (ch === '"') {
        let buf = ''
        let closed = false
        i++
        while (i < n) {
          const d = src[i]
          if (d === '"') {
            closed = true
            i++
            break
          }
          if (d === '\\' && i + 1 < n && '"\\$`'.includes(src[i + 1])) {
            buf += src[i + 1]
            i += 2
            continue
          }
          const v = d === '$' ? readVar(src, i) : null
          if (v) {
            if (buf) lit(buf, true)
            buf = ''
            parts.push({ t: 'var', name: v.name })
            i += v.len
            continue
          }
          buf += d
          i++
        }
        if (!closed) throw new ShellSyntaxError('missing closing quote (")')
        lit(buf, true)
      } else {
        const v = ch === '$' ? readVar(src, i) : null
        if (v) {
          parts.push({ t: 'var', name: v.name })
          i += v.len
        } else {
          lit(ch, false)
          i++
        }
      }
    }
    tokens.push({ kind: 'word', parts })
  }
  return tokens
}

export function parse(tokens: Token[]): ListItem[] {
  const list: ListItem[] = []
  const fresh = (): SimpleCommand => ({ words: [], redirects: [], errToOut: false })
  const isEmpty = (c: SimpleCommand) => !c.words.length && !c.redirects.length
  let pipeline: SimpleCommand[] = []
  let cmd = fresh()
  let connector: ListItem['connector'] = null
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]
    if (t.kind === 'word') {
      cmd.words.push(t.parts)
      continue
    }
    switch (t.op) {
      case '2>&1':
        cmd.errToOut = true
        break
      case '>':
      case '>>':
      case '<':
      case '2>':
      case '2>>': {
        const target = tokens[k + 1]
        if (target?.kind !== 'word') throw new ShellSyntaxError(`expected a file name after '${t.op}'`)
        cmd.redirects.push({ op: t.op, target: target.parts })
        k++
        break
      }
      case '|':
        if (isEmpty(cmd)) throw new ShellSyntaxError("unexpected '|'")
        pipeline.push(cmd)
        cmd = fresh()
        break
      default:
        if (isEmpty(cmd)) throw new ShellSyntaxError(`unexpected '${t.op}'`)
        pipeline.push(cmd)
        list.push({ connector, pipeline })
        pipeline = []
        cmd = fresh()
        connector = t.op
    }
  }
  if (!isEmpty(cmd)) {
    pipeline.push(cmd)
    list.push({ connector, pipeline })
  } else if (pipeline.length) {
    throw new ShellSyntaxError("a command is missing after '|'")
  } else if (connector === '&&' || connector === '||') {
    throw new ShellSyntaxError(`a command is missing after '${connector}'`)
  }
  return list
}

// ------------------------------------------------------------------ globbing

const escapeGlob = (s: string) => s.replace(/[*?[\]\\]/g, '\\$&')
const unescapeGlob = (s: string) => s.replace(/\\(.)/g, '$1')

function hasGlob(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') i++
    else if (s[i] === '*' || s[i] === '?' || s[i] === '[') return true
  }
  return false
}

const compareNames = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

// ------------------------------------------------------------------ completion

/** Backslash-escape a path for the command line, keeping a leading ~ working. */
function escapeArg(s: string): string {
  const lead = s === '~' || s.startsWith('~/') ? '~' : ''
  return lead + s.slice(lead.length).replace(/[\s'"\\$`!*?[\](){}<>|&;#]/g, '\\$&')
}

function commonPrefix(items: string[], ignoreCase = false): string {
  let p = items[0] ?? ''
  for (const s of items) {
    let i = 0
    while (i < p.length && i < s.length && (ignoreCase ? p[i].toLowerCase() === s[i].toLowerCase() : p[i] === s[i])) i++
    p = p.slice(0, i)
  }
  return p
}

export interface FileText {
  text: string
  bytes: Uint8Array
  binary: boolean
}

interface WordAtCursor {
  /** String index where the word starts (including an opening quote). */
  start: number
  /** The word with quotes and escapes removed. */
  value: string
  /** The quote still open at the cursor, if any. */
  quote: '' | "'" | '"'
  /** First word of the command the cursor is in. */
  command: string | null
  /** The cursor is on the command name itself. */
  isCommand: boolean
}

function wordAtCursor(before: string): WordAtCursor {
  let start = before.length
  let value = ''
  let quote: WordAtCursor['quote'] = ''
  let inWord = false
  let words: string[] = []
  let redirectTarget = false
  const endWord = () => {
    if (redirectTarget) redirectTarget = false
    else words.push(value)
    inWord = false
  }
  for (let i = 0; i < before.length; i++) {
    const c = before[i]
    if (quote) {
      if (c === quote) quote = ''
      else if (quote === '"' && c === '\\' && i + 1 < before.length) value += before[++i]
      else value += c
      continue
    }
    if (c === ' ' || c === '\t') {
      if (inWord) endWord()
      continue
    }
    if ('|;&<>'.includes(c)) {
      if (inWord) endWord()
      if (c === '<' || c === '>') redirectTarget = true
      else {
        words = []
        redirectTarget = false
      }
      continue
    }
    if (!inWord) {
      inWord = true
      start = i
      value = ''
    }
    if (c === '\\' && i + 1 < before.length) value += before[++i]
    else if (c === "'" || c === '"') quote = c
    else value += c
  }
  if (!inWord) {
    start = before.length
    value = ''
    quote = ''
  }
  return { start, value, quote, command: words[0] ?? null, isCommand: !words.length && !redirectTarget }
}

/** How a completed path is written back: quoted like the user started, closed when it is a file. */
function completionText(text: string, quote: WordAtCursor['quote'], end: 'dir' | 'file' | 'partial'): string {
  const tail = end === 'dir' ? '/' : ''
  if (quote === '"') return `"${text.replace(/(["\\$`])/g, '\\$1')}${tail}${end === 'file' ? '" ' : ''}`
  if (quote === "'") return `'${text.replace(/'/g, "'\\''")}${tail}${end === 'file' ? "' " : ''}`
  return escapeArg(text) + tail + (end === 'file' ? ' ' : '')
}

// ------------------------------------------------------------------ the shell

export class Shell {
  cwd: string
  oldPwd: string | null = null
  /** Exit status of the last command ($?). */
  status = 0
  readonly env: ShellEnv
  private vars = new Map<string, string>()

  constructor(env: ShellEnv, cwd: string = HOME) {
    this.env = env
    this.cwd = cwd
  }

  get fs(): ShellFs {
    return this.env.fs
  }

  /** Absolute path for something typed on the command line. */
  abs(p: string): string {
    return resolve(this.cwd, p)
  }

  /** Run a command line; resolves with its exit status. */
  async run(line: string, term: TermOut, signal: AbortSignal): Promise<number> {
    let list: ListItem[]
    try {
      list = parse(lex(line))
    } catch (e) {
      if (!(e instanceof ShellSyntaxError)) throw e
      term.err(`shell: ${e.message}\n`)
      return (this.status = 2)
    }
    let status = this.status
    for (const item of list) {
      if (signal.aborted) break
      if (item.connector === '&&' && status !== 0) continue
      if (item.connector === '||' && status === 0) continue
      status = await this.runPipeline(item.pipeline, term, signal)
      this.status = status
      this.fixCwd()
    }
    return status
  }

  /** If the current folder was deleted, move up to the closest folder that still exists. */
  fixCwd(): void {
    while (this.cwd !== '/' && !this.fs.isDir(this.cwd)) this.cwd = dirname(this.cwd)
  }

  /** A folder was renamed or moved (here or in another app): follow it if we are inside. */
  followRename(from: string, to: string): void {
    if (isInside(this.cwd, from)) this.cwd = to + this.cwd.slice(from.length)
    if (this.oldPwd && isInside(this.oldPwd, from)) this.oldPwd = to + this.oldPwd.slice(from.length)
  }

  getVar(name: string): string {
    switch (name) {
      case '?': return String(this.status)
      case 'HOME': return HOME
      case 'PWD': return this.cwd
      case 'OLDPWD': return this.oldPwd ?? ''
      case 'USER':
      case 'LOGNAME': return this.env.user
      case 'HOSTNAME': return this.env.hostname
      default: return this.vars.get(name) ?? ''
    }
  }

  environment(): [string, string][] {
    const base: [string, string][] = [
      ['HOME', HOME], ['USER', this.env.user], ['HOSTNAME', this.env.hostname], ['SHELL', '/bin/sh'],
      ['TERM', 'xterm-256color'], ['PWD', this.cwd],
    ]
    if (this.oldPwd) base.push(['OLDPWD', this.oldPwd])
    return [...base, ...[...this.vars].sort(([a], [b]) => a.localeCompare(b))]
  }

  setVar(name: string, value: string): void {
    this.vars.set(name, value)
  }

  // ---------------------------------------------------------------- running

  private async runPipeline(cmds: SimpleCommand[], term: TermOut, signal: AbortSignal): Promise<number> {
    let input: string | null = null
    let status = 0
    for (let k = 0; k < cmds.length; k++) {
      if (signal.aborted) return 130
      const cmd = cmds[k]
      const piped = k < cmds.length - 1
      let stdin = k === 0 ? null : input
      let outFile: { path: string; shown: string; append: boolean } | null = null
      let errFile: { path: string; shown: string; append: boolean } | null = null
      let redirectFailed = false
      for (const r of cmd.redirects) {
        const shown = this.expandText(r.target)
        if (r.op === '<') {
          const f = await this.readFile('shell', shown, { err: (s: string) => term.err(s), stdin: null })
          if (!f) {
            redirectFailed = true
            break
          }
          stdin = f.text
        } else if (r.op === '>' || r.op === '>>') outFile = { path: this.abs(shown), shown, append: r.op === '>>' }
        else errFile = { path: this.abs(shown), shown, append: r.op === '2>>' }
      }
      if (redirectFailed) {
        status = 1
        input = ''
        continue
      }
      const outBuf: string[] = []
      const errBuf: string[] = []
      const toTerm = !outFile && !piped
      const capture = (s: string) => void outBuf.push(s)
      const io: Io = {
        stdin,
        out: toTerm ? (s) => !signal.aborted && term.out(s) : capture,
        err: errFile ? (s) => void errBuf.push(s) : cmd.errToOut && !toTerm ? capture : (s) => !signal.aborted && term.err(s),
        clear: toTerm ? () => term.clear() : () => capture('\x1b[H\x1b[2J\x1b[3J'),
        tty: toTerm,
        cols: term.cols(),
        signal,
      }
      status = await this.exec(cmd.words, io)
      if (outFile && !(await this.saveTo(outFile, outBuf.join(''), term))) status = 1
      if (errFile && !(await this.saveTo(errFile, errBuf.join(''), term))) status = 1
      input = piped && !outFile ? outBuf.join('') : ''
    }
    return status
  }

  private async saveTo(target: { path: string; shown: string; append: boolean }, text: string, term: TermOut): Promise<boolean> {
    try {
      const st = this.fs.stat(target.path)
      if (st?.type === 'dir') throw Object.assign(new Error('EISDIR'), { code: 'EISDIR' })
      if (target.append && st) {
        const old = await this.fs.readBytes(target.path)
        const add = encoder.encode(text)
        const all = new Uint8Array(old.length + add.length)
        all.set(old)
        all.set(add, old.length)
        await this.fs.writeBytes(target.path, all)
      } else await this.fs.writeText(target.path, text)
      return true
    } catch (e) {
      term.err(`shell: ${reason(e)}: ${target.shown}\n`)
      return false
    }
  }

  private expandText(parts: Part[]): string {
    let text = ''
    for (const p of parts) text += p.t === 'tilde' ? HOME : p.t === 'var' ? this.getVar(p.name) : p.s
    return text
  }

  /** Expand variables, ~ and file patterns into the final argument list. */
  private expandWords(words: Part[][]): string[] {
    const args: string[] = []
    for (const parts of words) {
      let text = ''
      let pattern = ''
      for (const p of parts) {
        const s = p.t === 'tilde' ? HOME : p.t === 'var' ? this.getVar(p.name) : p.s
        text += s
        pattern += p.t === 'lit' && !p.q ? s : escapeGlob(s)
      }
      const matches = hasGlob(pattern) ? this.glob(pattern) : []
      if (matches.length) args.push(...matches)
      else args.push(text)
    }
    return args
  }

  /** Files matching a pattern, written relative the way the pattern was. */
  glob(pattern: string): string[] {
    const absolute = pattern.startsWith('/')
    const dirOnly = pattern.length > 1 && pattern.endsWith('/')
    const segs = pattern.split('/').filter(Boolean)
    let found = [{ shown: absolute ? '/' : '', path: absolute ? '/' : this.cwd }]
    for (let k = 0; k < segs.length; k++) {
      const seg = segs[k]
      const last = k === segs.length - 1
      const next: typeof found = []
      if (!hasGlob(seg)) {
        const name = unescapeGlob(seg)
        for (const f of found) {
          const p = join(f.path, name)
          if (last ? this.fs.exists(p) : this.fs.isDir(p)) next.push({ shown: joinShown(f.shown, name), path: p })
        }
      } else {
        const re = globRegExp(seg)
        const dots = seg.startsWith('.') || seg.startsWith('\\.')
        for (const f of found) {
          if (!this.fs.isDir(f.path)) continue
          for (const s of this.fs.list(f.path)) {
            if ((s.name.startsWith('.') && !dots) || !re.test(s.name) || (!last && s.type !== 'dir')) continue
            next.push({ shown: joinShown(f.shown, s.name), path: s.path })
          }
        }
      }
      found = next
      if (!found.length) return []
    }
    if (dirOnly) found = found.filter((f) => this.fs.isDir(f.path))
    return found.map((f) => f.shown + (dirOnly ? '/' : '')).sort(compareNames)
  }

  private async exec(words: Part[][], io: Io): Promise<number> {
    const args = this.expandWords(words)
    if (!args.length) return 0
    const assign = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(args[0])
    if (assign && args.length === 1) {
      this.setVar(assign[1], assign[2])
      return 0
    }
    const alias = ALIASES[args[0]]
    const [name, ...rest] = alias ? [...alias, ...args.slice(1)] : args
    const cmd = COMMANDS[name]
    if (cmd) {
      try {
        return await cmd.run(this, rest, io)
      } catch (e) {
        io.err(`${name}: ${reason(e)}\n`)
        return 1
      }
    }
    // ./script.py runs with Python, as if it had a #! line
    if (name.includes('/') && name.endsWith('.py') && this.fs.isFile(this.abs(name))) {
      return COMMANDS.python.run(this, [name, ...rest], io)
    }
    io.err(`${name}: command not found\n`)
    if (name.endsWith('.py') && this.fs.isFile(this.abs(name))) io.err(style.muted(`Run Python files with: python ${name}`) + '\n')
    else {
      const near = suggestCommand(name)
      if (near) io.err(style.muted(`Did you mean "${near}"? Type help to see every command.`) + '\n')
    }
    return 127
  }

  /** Read a file named on the command line, reporting problems as `cmd: reason: name`. */
  async readFile(cmd: string, name: string, io: Pick<Io, 'err' | 'stdin'>): Promise<FileText | null> {
    if (name === '-') {
      const text = io.stdin ?? ''
      return { text, bytes: encoder.encode(text), binary: false }
    }
    const p = this.abs(name)
    const st = this.fs.stat(p)
    if (!st) {
      io.err(`${cmd}: no such file or folder: ${name}\n`)
      return null
    }
    if (st.type === 'dir') {
      io.err(`${cmd}: is a folder: ${name}\n`)
      return null
    }
    const bytes = await this.fs.readBytes(p)
    return { text: decoder.decode(bytes), bytes, binary: isBinary(bytes) }
  }

  /** Run `fn` on the text of each named file, or on the piped input when there are none. */
  async eachText(
    cmd: string,
    names: string[],
    io: Io,
    fn: (f: FileText, name: string, index: number) => void,
    opts: { binary?: boolean } = {},
  ): Promise<number> {
    if (!names.length) {
      if (io.stdin === null) return badUsage(io, cmd, 'no file given')
      fn({ text: io.stdin, bytes: encoder.encode(io.stdin), binary: false }, '-', 0)
      return 0
    }
    let status = 0
    for (let k = 0; k < names.length; k++) {
      if (io.signal.aborted) break
      const f = await this.readFile(cmd, names[k], io)
      if (!f) status = 1
      else if (f.binary && !opts.binary) {
        io.err(`${cmd}: not a text file: ${names[k]} (try: open ${quoteArg(names[k])})\n`)
        status = 1
      } else fn(f, names[k], k)
    }
    return status
  }

  // ------------------------------------------------------------- completion

  commandNames(): string[] {
    return [...new Set([...Object.keys(COMMANDS), ...Object.keys(ALIASES)])].sort()
  }

  /** Tab completion: command names first, then files and folders relative to the current folder. */
  complete(line: string, cursor: number): CompletionResult | null {
    const w = wordAtCursor(line.slice(0, cursor))
    if (w.isCommand && !w.quote && !/[/~]/.test(w.value) && !w.value.startsWith('.')) {
      const matches = this.commandNames().filter((n) => n.startsWith(w.value))
      if (!matches.length) return null
      return { start: w.start, replacement: matches.length === 1 ? matches[0] + ' ' : commonPrefix(matches), candidates: matches }
    }
    if (w.value === '~' && !w.quote) return { start: w.start, replacement: '~/', candidates: [] }
    const expanded = w.value.startsWith('~/') ? HOME + w.value.slice(1) : w.value
    const slash = expanded.lastIndexOf('/')
    const dir = slash < 0 ? this.cwd : this.abs(expanded.slice(0, slash) || '/')
    const typedDir = slash < 0 ? '' : w.value.slice(0, w.value.lastIndexOf('/') + 1)
    const base = expanded.slice(slash + 1)
    if (!this.fs.isDir(dir)) return null
    const dirsOnly = w.command === 'cd' || w.command === 'rmdir'
    const pool = this.fs
      .list(dir)
      .filter((e) => (!dirsOnly || e.type === 'dir') && (base.startsWith('.') || !e.name.startsWith('.')))
    let matches = pool.filter((e) => e.name.startsWith(base))
    const ignoreCase = !matches.length
    if (ignoreCase) matches = pool.filter((e) => e.name.toLowerCase().startsWith(base.toLowerCase()))
    if (!matches.length) return null
    const candidates = matches.map((e) => (e.type === 'dir' ? style.boldBlue(e.name) + '/' : colorName(e.name, e, true)))
    if (matches.length === 1) {
      const m = matches[0]
      return { start: w.start, replacement: completionText(typedDir + m.name, w.quote, m.type === 'dir' ? 'dir' : 'file'), candidates }
    }
    const common = commonPrefix(matches.map((e) => e.name), ignoreCase)
    return { start: w.start, replacement: completionText(typedDir + common, w.quote, 'partial'), candidates }
  }
}
