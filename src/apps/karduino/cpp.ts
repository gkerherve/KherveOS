// C/C++ (Arduino flavour) highlighting for kArduino's editor, and the error / warning
// marks on lines. CodeEditor has no C++ language and no marks, so both are added to its
// view from outside (onReady): a small StreamLanguage, a line decoration field and a gutter.

import { StateEffect, StateField, RangeSet, RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, gutter, type DecorationSet } from '@codemirror/view'
import { StreamLanguage, type StreamParser } from '@codemirror/language'

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean))

const KEYWORDS = words(`if else for while do switch case default break continue return goto sizeof typedef struct union class
  enum namespace template typename public private protected virtual static const constexpr volatile extern inline new delete
  this using operator try catch throw register unsigned signed auto`)
const TYPES = words(`void int long short char float double bool boolean byte word size_t String uint8_t uint16_t uint32_t uint64_t
  int8_t int16_t int32_t int64_t Serial Wire SPI EEPROM Servo Stepper`)
const ATOMS = words(`true false NULL nullptr HIGH LOW INPUT OUTPUT INPUT_PULLUP LED_BUILTIN LSBFIRST MSBFIRST CHANGE RISING FALLING
  PI HALF_PI TWO_PI DEG_TO_RAD RAD_TO_DEG DEC HEX OCT BIN A0 A1 A2 A3 A4 A5 A6 A7 SDA SCL SS MOSI MISO SCK`)
const BUILTINS = words(`setup loop pinMode digitalWrite digitalRead analogRead analogWrite analogReference tone noTone pulseIn
  shiftOut shiftIn delay delayMicroseconds millis micros map constrain min max abs sq sqrt pow sin cos tan random randomSeed
  attachInterrupt detachInterrupt digitalPinToInterrupt interrupts noInterrupts bitRead bitWrite bitSet bitClear lowByte highByte
  begin end print println write read available flush parseInt parseFloat readStringUntil attach detach`)

interface State {
  block: boolean
  header: boolean
}

const parser: StreamParser<State> = {
  name: 'cpp',
  startState: () => ({ block: false, header: false }),
  token(stream, state) {
    if (state.block) {
      if (stream.skipTo('*/')) {
        stream.match('*/')
        state.block = false
      } else {
        stream.skipToEnd()
      }
      return 'comment'
    }
    if (stream.eatSpace()) return null
    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match('/*')) {
      state.block = true
      if (stream.skipTo('*/')) {
        stream.match('*/')
        state.block = false
      } else {
        stream.skipToEnd()
      }
      return 'comment'
    }
    if (state.header && stream.match(/^<[^>\n]*>/)) {
      state.header = false
      return 'string'
    }
    if (stream.peek() === '#' && stream.match(/^#\s*\w+/)) {
      state.header = /include/.test(stream.current())
      return 'meta'
    }
    const q = stream.peek()
    if (q === '"' || q === "'") {
      stream.next()
      let esc = false
      let c: string | void
      while ((c = stream.next()) != null) {
        if (c === q && !esc) break
        esc = !esc && c === '\\'
      }
      state.header = false
      return 'string'
    }
    if (stream.match(/^(?:0[xX][\da-fA-F]+|0[bB][01]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)[uUlLfF]*/)) return 'number'
    if (stream.match(/^[A-Za-z_]\w*/)) {
      const w = stream.current()
      if (KEYWORDS.has(w)) return 'keyword'
      if (TYPES.has(w)) return 'typeName'
      if (ATOMS.has(w)) return 'atom'
      if (BUILTINS.has(w) || stream.match(/^\s*\(/, false)) return 'variableName.function'
      return 'variableName'
    }
    stream.next()
    return null
  },
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    closeBrackets: { brackets: ['(', '[', '{', "'", '"'] },
  },
}

/** Add to an editor view with `view.dispatch({ effects: StateEffect.appendConfig.of(...) })`. */
export const cppLanguage: Extension = StreamLanguage.define(parser)

// ------------------------------------------------------------------------- marks

export interface EditorMark {
  /** 1-based. */
  line: number
  severity: 'error' | 'warning' | 'note'
  message: string
}

const setMarks = StateEffect.define<EditorMark[]>()

class Dot extends GutterMarker {
  severity: string
  constructor(severity: string) {
    super()
    this.severity = severity
  }
  eq(other: Dot) {
    return other.severity === this.severity
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = `ka-dot ka-dot-${this.severity}`
    el.textContent = '●'
    return el
  }
}
const DOTS: Record<string, Dot> = { error: new Dot('error'), warning: new Dot('warning'), note: new Dot('note') }

/** One mark per line, the worst one (error over warning over note). */
function perLine(marks: EditorMark[], lines: number): EditorMark[] {
  const rank = { error: 0, warning: 1, note: 2 }
  const best = new Map<number, EditorMark>()
  for (const m of marks) {
    if (m.line < 1 || m.line > lines) continue
    const old = best.get(m.line)
    if (!old || rank[m.severity] < rank[old.severity]) best.set(m.line, m)
  }
  return [...best.values()].sort((a, b) => a.line - b.line)
}

const lineMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(setMarks)) continue
      const b = new RangeSetBuilder<Decoration>()
      for (const m of perLine(e.value, tr.state.doc.lines)) {
        b.add(tr.state.doc.line(m.line).from, tr.state.doc.line(m.line).from, Decoration.line({ class: `ka-mark ka-mark-${m.severity}`, attributes: { title: m.message } }))
      }
      value = b.finish()
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f),
})

const gutterMarks = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    value = value.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(setMarks)) continue
      value = RangeSet.of(
        perLine(e.value, tr.state.doc.lines).map((m) => DOTS[m.severity].range(tr.state.doc.line(m.line).from)),
        true,
      )
    }
    return value
  },
})

const markGutter = gutter({
  class: 'ka-gutter',
  markers: (v) => v.state.field(gutterMarks),
  initialSpacer: () => DOTS.error,
})

const markExtensions: Extension = [lineMarks, gutterMarks, markGutter]

/** Install highlighting and marks on an editor view (once). */
export function installArduinoSupport(view: EditorView): void {
  view.dispatch({ effects: StateEffect.appendConfig.of([cppLanguage, markExtensions]) })
}

export function applyMarks(view: EditorView, marks: EditorMark[]): void {
  view.dispatch({ effects: setMarks.of(marks) })
}

/** Select a line (and column) and scroll it into view. */
export function jumpTo(view: EditorView, line: number, col = 1): void {
  const l = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines))
  const pos = Math.min(l.to, l.from + Math.max(0, col - 1))
  view.dispatch({ selection: { anchor: l.from, head: l.to }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
  view.focus()
}

/** Insert text at the cursor (replacing the selection). */
export function insertAtCursor(view: EditorView, text: string): void {
  const sel = view.state.selection.main
  view.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from + text.length }, scrollIntoView: true })
  view.focus()
}
