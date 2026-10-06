// A readline-style line editor drawn with ANSI escape codes. It owns the
// prompt and the line being typed: cursor keys, Home/End, kill and yank,
// history, Tab completion, and redraws that survive soft-wrapping.
// DOM-free — it only needs something to write to — so it can be tested alone.

import { columns, stripAnsi, style, wcwidth } from './ansi'

export interface EditorHost {
  write(data: string): void
  cols(): number
  /** Rows between the start of the cursor's soft-wrapped line and the cursor (read from the terminal). */
  rowsAboveCursor?(): number
  /** Call `cb` once everything written so far has been processed by the terminal. */
  afterWrite?(cb: () => void): void
}

export interface CompletionResult {
  /** String index in the line where the word being completed starts. */
  start: number
  /** New text for line[start, cursor). */
  replacement: string
  /** Every match, listed in columns when Tab cannot make progress. */
  candidates: string[]
}

export type Completer = (line: string, cursor: number) => CompletionResult | null

export interface ReadOptions {
  /** May contain colour codes. */
  prompt: string
  history?: History
  complete?: Completer
  /** Inserted by Tab when there is no completer (four spaces in Python). */
  indent?: string
}

export type ReadResult = { type: 'line'; text: string } | { type: 'eof' } | { type: 'interrupt' }

/** Command history, oldest first. */
export class History {
  items: string[]
  readonly max: number
  /** Called with each line added, or null when the history is cleared. */
  onChange: ((line: string | null) => void) | null = null

  constructor(items: string[] = [], max = 1000) {
    this.max = max
    this.items = items.slice(-max)
  }

  add(line: string): void {
    if (!line.trim() || this.items[this.items.length - 1] === line) return
    this.items.push(line)
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max)
    this.onChange?.(line)
  }

  clear(): void {
    this.items = []
    this.onChange?.(null)
  }
}

// ---------------------------------------------------------------- layout

export interface Pos {
  row: number
  col: number
}

const cpWidth = (ch: string) => wcwidth(ch.codePointAt(0)!)

/** Split text into editing units: a character plus any zero-width marks after it. */
export function toUnits(s: string): string[] {
  const out: string[] = []
  for (const ch of s) {
    if (out.length && cpWidth(ch) === 0) out[out.length - 1] += ch
    else out.push(ch)
  }
  return out
}

/**
 * Screen position of every unit (relative to the first cell of the prompt),
 * followed by the position just after the last one. Follows the terminal's
 * auto-wrap: a wide character that does not fit moves to the next row, and
 * a full row puts the next character at the start of the following one.
 */
export function layout(prompt: string, units: string[], cols: number): Pos[] {
  const width = Math.max(1, cols)
  let row = 0
  let col = 0
  const place = (w: number) => {
    if (!w) return
    if (col + w > width) {
      row++
      col = 0
    }
    col += w
    if (col >= width) {
      row++
      col = 0
    }
  }
  for (const ch of prompt) place(cpWidth(ch))
  const out: Pos[] = []
  for (const u of units) {
    let first = 0
    for (const ch of u) if ((first = cpWidth(ch))) break
    if (first && col + first > width) {
      row++
      col = 0
    }
    out.push({ row, col })
    for (const ch of u) place(cpWidth(ch))
  }
  out.push({ row, col })
  return out
}

// ------------------------------------------------------------------ keys

type Key = { kind: 'text'; text: string } | { kind: 'key'; name: string }

const CONTROL: Record<number, string> = {
  0x01: 'home', // Ctrl+A
  0x02: 'left', // Ctrl+B
  0x03: 'interrupt', // Ctrl+C
  0x04: 'eof', // Ctrl+D
  0x05: 'end', // Ctrl+E
  0x06: 'right', // Ctrl+F
  0x08: 'kill-word-back', // Ctrl+Backspace (and Ctrl+H)
  0x09: 'tab',
  0x0a: 'enter',
  0x0b: 'kill-end', // Ctrl+K
  0x0c: 'clear', // Ctrl+L
  0x0d: 'enter',
  0x0e: 'down', // Ctrl+N
  0x10: 'up', // Ctrl+P
  0x15: 'kill-start', // Ctrl+U
  0x17: 'kill-space-word', // Ctrl+W
  0x19: 'yank', // Ctrl+Y
  0x7f: 'backspace',
}

function csiName(params: string, final: string): string {
  const [first, mod] = params.split(';')
  const bits = Number(mod ?? 1) - 1 // 1 shift, 2 alt, 4 ctrl, 8 meta
  const byWord = (bits & 6) !== 0
  switch (final) {
    case 'A': return 'up'
    case 'B': return 'down'
    case 'C': return byWord ? 'word-right' : 'right'
    case 'D': return byWord ? 'word-left' : 'left'
    case 'H': return 'home'
    case 'F': return 'end'
    case '~':
      if (first === '1' || first === '7') return 'home'
      if (first === '4' || first === '8') return 'end'
      if (first === '3') return byWord ? 'kill-word' : 'delete'
      return 'ignore'
    default: return 'ignore'
  }
}

const SS3: Record<string, string> = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end' }
const ALT: Record<string, string> = {
  b: 'word-left', B: 'word-left', f: 'word-right', F: 'word-right', d: 'kill-word', D: 'kill-word',
  '\x7f': 'kill-word-back', '\b': 'kill-word-back',
}

/** Read one key (or a run of plain text) from the front of `s`. */
function nextKey(s: string): [Key, number] {
  if (s[0] === '\x1b') {
    const csi = /^\x1b\[([0-9;]*)([~A-Za-z])/.exec(s)
    if (csi) return [{ kind: 'key', name: csiName(csi[1], csi[2]) }, csi[0].length]
    if (s[1] === 'O' && s.length > 2) return [{ kind: 'key', name: SS3[s[2]] ?? 'ignore' }, 3]
    if (s.length === 1 || s[1] === '[') return [{ kind: 'key', name: 'ignore' }, Math.min(2, s.length)]
    return [{ kind: 'key', name: ALT[s[1]] ?? 'ignore' }, 2]
  }
  const code = s.charCodeAt(0)
  if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return [{ kind: 'key', name: CONTROL[code] ?? 'ignore' }, 1]
  const text = /^[^\x00-\x1f\x7f-\x9f]+/.exec(s)![0]
  return [{ kind: 'text', text }, text.length]
}

const isWordUnit = (u: string) => /[\p{L}\p{N}_]/u.test(u)
const isSpaceUnit = (u: string) => /^\s/.test(u)

/** Completion lists longer than this are cut short. */
const MAX_CANDIDATES = 300

// ---------------------------------------------------------------- editor

export class LineEditor {
  private host: EditorHost
  private queue = ''
  private req: { opts: ReadOptions; resolve: (r: ReadResult) => void } | null = null
  private units: string[] = []
  private cursor = 0
  /** Rows between the prompt's first row and the cursor, as last drawn. */
  private row = 0
  private dirty = false
  private histPos = 0
  private draft = ''
  private killed = ''

  constructor(host: EditorHost) {
    this.host = host
  }

  get reading(): boolean {
    return this.req !== null
  }

  /** Show `prompt` and edit a line until Enter, Ctrl+C or Ctrl+D (on an empty line). */
  read(opts: ReadOptions): Promise<ReadResult> {
    this.cancel()
    return new Promise((resolve) => {
      this.req = { opts, resolve }
      this.units = []
      this.cursor = 0
      this.row = 0
      this.histPos = opts.history?.items.length ?? 0
      this.draft = ''
      this.render()
      this.drain() // keys typed ahead while the previous command ran
    })
  }

  /** Keyboard input from the terminal. Kept for the next read() if no line is being edited. */
  feed(data: string): void {
    this.queue += data
    if (this.req) this.drain()
  }

  /** Forget typed-ahead input (after Ctrl+C). */
  clearQueue(): void {
    this.queue = ''
  }

  /** Stop editing without drawing anything (the terminal is closing). */
  cancel(): void {
    const req = this.req
    this.req = null
    req?.resolve({ type: 'eof' })
  }

  /** Replace the prompt of the line being edited. */
  setPrompt(prompt: string): void {
    if (!this.req) return
    this.req.opts = { ...this.req.opts, prompt }
    this.render()
  }

  /** The terminal changed size and re-wrapped the text: find the prompt again and redraw. */
  resync(): void {
    if (!this.req) return
    const host = this.host
    if (!host.afterWrite || !host.rowsAboveCursor) {
      this.render()
      return
    }
    host.afterWrite(() => {
      if (!this.req) return
      this.row = host.rowsAboveCursor?.() ?? this.row
      this.render()
    })
  }

  /** Print text (ending with "\r\n") where the prompt is, then draw the prompt and line again below it. */
  interject(text: string): void {
    if (!this.req) {
      this.host.write(text)
      return
    }
    this.host.write((this.row > 0 ? `\x1b[${this.row}A` : '') + '\r\x1b[J' + text)
    this.row = 0
    this.render()
  }

  /** Clear the screen (Ctrl+L), keeping the line being typed. */
  clearScreen(): void {
    if (!this.req) return
    this.host.write('\x1b[H\x1b[2J')
    this.row = 0
    this.render()
  }

  // -------------------------------------------------------------- input

  private drain(): void {
    while (this.req && this.queue) {
      const [key, len] = nextKey(this.queue)
      this.queue = this.queue.slice(len)
      if (key.kind === 'text') this.insert(key.text)
      else this.handle(key.name)
    }
    if (this.dirty) this.render()
  }

  private handle(name: string): void {
    const n = this.units.length
    switch (name) {
      case 'enter': return this.submit({ type: 'line', text: this.units.join('') })
      case 'interrupt': return this.submit({ type: 'interrupt' }, '^C')
      case 'eof': return n ? this.remove(this.cursor, this.cursor + 1) : this.submit({ type: 'eof' })
      case 'backspace': return this.remove(this.cursor - 1, this.cursor)
      case 'delete': return this.remove(this.cursor, this.cursor + 1)
      case 'left': return this.moveTo(this.cursor - 1)
      case 'right': return this.moveTo(this.cursor + 1)
      case 'home': return this.moveTo(0)
      case 'end': return this.moveTo(n)
      case 'word-left': return this.moveTo(this.wordStart())
      case 'word-right': return this.moveTo(this.wordEnd())
      case 'kill-end': return this.kill(this.cursor, n)
      case 'kill-start': return this.kill(0, this.cursor)
      case 'kill-space-word': return this.kill(this.spaceWordStart(), this.cursor)
      case 'kill-word-back': return this.kill(this.wordStart(), this.cursor)
      case 'kill-word': return this.kill(this.cursor, this.wordEnd())
      case 'yank': return this.insert(this.killed)
      case 'up': return this.historyMove(-1)
      case 'down': return this.historyMove(1)
      case 'clear': return this.clearScreen()
      case 'tab': return this.tab()
    }
  }

  private insert(text: string): void {
    if (!text) return
    const add = toUnits(text)
    this.units = this.units.slice(0, this.cursor).concat(add, this.units.slice(this.cursor))
    this.cursor += add.length
    this.dirty = true
  }

  private remove(from: number, to: number): void {
    from = Math.max(0, from)
    to = Math.min(this.units.length, to)
    if (from >= to) return
    this.units.splice(from, to - from)
    this.cursor = from
    this.dirty = true
  }

  private kill(from: number, to: number): void {
    if (from >= to) return
    this.killed = this.units.slice(from, to).join('')
    this.remove(from, to)
  }

  private moveTo(i: number): void {
    const next = Math.max(0, Math.min(this.units.length, i))
    if (next === this.cursor) return
    this.cursor = next
    this.dirty = true
  }

  private wordStart(): number {
    let k = this.cursor
    while (k > 0 && !isWordUnit(this.units[k - 1])) k--
    while (k > 0 && isWordUnit(this.units[k - 1])) k--
    return k
  }

  private wordEnd(): number {
    let k = this.cursor
    const n = this.units.length
    while (k < n && !isWordUnit(this.units[k])) k++
    while (k < n && isWordUnit(this.units[k])) k++
    return k
  }

  private spaceWordStart(): number {
    let k = this.cursor
    while (k > 0 && isSpaceUnit(this.units[k - 1])) k--
    while (k > 0 && !isSpaceUnit(this.units[k - 1])) k--
    return k
  }

  private historyMove(delta: number): void {
    const h = this.req?.opts.history
    if (!h) return
    const next = Math.min(this.histPos, h.items.length) + delta
    if (next < 0 || next > h.items.length) return
    if (this.histPos >= h.items.length) this.draft = this.units.join('')
    this.histPos = next
    this.units = toUnits(next === h.items.length ? this.draft : h.items[next])
    this.cursor = this.units.length
    this.dirty = true
  }

  private tab(): void {
    const opts = this.req!.opts
    if (!opts.complete) {
      if (opts.indent) this.insert(opts.indent)
      return
    }
    const line = this.units.join('')
    const at = this.units.slice(0, this.cursor).join('').length
    let res: CompletionResult | null = null
    try {
      res = opts.complete(line, at)
    } catch (e) {
      console.warn('[terminal] completion failed', e)
    }
    if (!res) return
    if (res.replacement !== line.slice(res.start, at)) {
      const before = line.slice(0, res.start) + res.replacement
      this.units = toUnits(before + line.slice(at))
      this.cursor = toUnits(before).length
      this.dirty = true
    } else if (res.candidates.length > 1) {
      this.showCandidates(res.candidates)
    }
  }

  private showCandidates(items: string[]): void {
    const keep = this.cursor
    this.cursor = this.units.length
    this.render()
    let list = columns(items.slice(0, MAX_CANDIDATES), this.host.cols())
    if (items.length > MAX_CANDIDATES) list += style.muted(`… and ${items.length - MAX_CANDIDATES} more`) + '\n'
    this.host.write('\r\n' + list.replace(/\n/g, '\r\n'))
    this.row = 0
    this.cursor = keep
    this.render()
  }

  private submit(result: ReadResult, echo = ''): void {
    this.cursor = this.units.length
    this.render()
    this.host.write(echo + '\r\n')
    const req = this.req
    this.req = null
    this.row = 0
    req?.resolve(result)
  }

  // ------------------------------------------------------------- output

  /** Redraw the prompt and the line from the prompt's first row, then place the cursor. */
  private render(): void {
    const req = this.req
    if (!req) return
    this.dirty = false
    const pos = layout(stripAnsi(req.opts.prompt), this.units, this.host.cols())
    const end = pos[pos.length - 1]
    const cur = pos[this.cursor]
    let s = this.row > 0 ? `\x1b[${this.row}A\r\x1b[J` : '\r\x1b[J'
    s += req.opts.prompt + this.units.join('')
    // A full last row leaves the terminal waiting to wrap; print a space so the
    // cursor really moves to the next row before positioning it.
    if (end.row > 0 && end.col === 0) s += ' \r'
    if (end.row > cur.row) s += `\x1b[${end.row - cur.row}A`
    s += '\r'
    if (cur.col > 0) s += `\x1b[${cur.col}C`
    this.row = cur.row
    this.host.write(s)
  }
}
