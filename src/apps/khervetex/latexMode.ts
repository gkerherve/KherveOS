// LaTeX colouring for the Code tab: a small CodeMirror stream parser added to
// the shared CodeEditor (whose highlight style colours the tags it emits).

import { StreamLanguage, type StreamParser } from '@codemirror/language'

interface State {
  /** Inside $…$ (1) or $$…$$ / \[…\] (2). */
  math: 0 | 1 | 2
  /** The next {…} names an environment (after \begin / \end). */
  envName: 'begin' | 'end' | null
}

const MATH_ENVS = /^(equation|align|gather|multline|eqnarray|math|displaymath|flalign|alignat)\*?$/

const parser: StreamParser<State> = {
  name: 'latex',
  startState: () => ({ math: 0, envName: null }),
  copyState: (s) => ({ ...s }),
  token(stream, state) {
    if (state.envName) {
      if (stream.eatSpace()) return null
      const which = state.envName
      state.envName = null
      const m = stream.match(/^\{([^}]*)\}/) as RegExpMatchArray | null
      if (m) {
        if (MATH_ENVS.test(m[1])) state.math = which === 'end' ? 0 : 2
        return 'className'
      }
    }
    if (stream.peek() === '%') {
      stream.skipToEnd()
      return 'comment'
    }
    const env = stream.match(/^\\(begin|end)\b/) as RegExpMatchArray | null
    if (env) {
      state.envName = env[1] as 'begin' | 'end'
      return 'keyword'
    }
    if (stream.match('\\[') || stream.match('\\(')) {
      state.math = 2
      return 'keyword'
    }
    if (stream.match('\\]') || stream.match('\\)')) {
      state.math = 0
      return 'keyword'
    }
    if (stream.match(/^\\[a-zA-Z@]+\*?/)) return state.math ? 'string' : 'keyword'
    if (stream.match(/^\\./)) return 'atom'
    if (stream.match('$$')) {
      state.math = state.math ? 0 : 2
      return 'keyword'
    }
    if (stream.eat('$')) {
      state.math = state.math ? 0 : 1
      return 'keyword'
    }
    if (stream.match(/^[{}[\]]/)) return 'bracket'
    if (state.math) {
      stream.next()
      return 'string'
    }
    if (stream.match(/^\d+(\.\d+)?/)) return 'number'
    if (stream.match(/^[&~^_]/)) return 'atom'
    stream.next()
    return null
  },
}

export const latexLanguage = StreamLanguage.define(parser)
