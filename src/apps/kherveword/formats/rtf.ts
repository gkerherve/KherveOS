// RTF → HTML for KherveWord's import (TextEdit, WordPad and Word write RTF):
// paragraphs with alignment, bold/italic/underline/strike, super/subscript,
// font sizes and colours, line breaks, tabs, and the usual special
// characters. Pictures, tables and fields' instructions are left out (field
// results are kept). Plain TypeScript: tested in Node.

const CP1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
}

const SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'headerl', 'headerr', 'headerf', 'footerl', 'footerr', 'footerf', 'fldinst', 'object', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'mmathPr', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'pgdsctbl', 'revtbl', 'filetbl', 'shppict', 'nonshppict', 'bkmkstart', 'bkmkend', 'footnote', 'annotation', 'atnid', 'atnauthor'])

interface State {
  b: boolean
  i: boolean
  u: boolean
  s: boolean
  sup: boolean
  sub: boolean
  fs: number
  cf: number
  skip: boolean
  uc: number
  colortbl: boolean
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function rtfToHtml(rtf: string): string {
  const colors: string[] = ['']
  let color = { r: 0, g: 0, b: 0, set: false }
  const paras: string[] = []
  let para = ''
  let align = ''
  let runText = ''
  let runKey = ''
  let runOpen = ''
  let runClose = ''
  const st: State[] = [{ b: false, i: false, u: false, s: false, sup: false, sub: false, fs: 24, cf: 0, skip: false, uc: 1, colortbl: false }]
  const cur = () => st[st.length - 1]

  const flushRun = () => {
    if (runText) para += runOpen + esc(runText).replace(/\t/g, '\t') + runClose
    runText = ''
  }
  const emit = (text: string) => {
    const s = cur()
    if (s.skip) return
    const key = `${s.b}${s.i}${s.u}${s.s}${s.sup}${s.sub}${s.fs}${s.cf}`
    if (key !== runKey) {
      flushRun()
      runKey = key
      let open = ''
      let close = ''
      const wrap = (o: string, c: string) => {
        open += o
        close = c + close
      }
      const style: string[] = []
      if (s.fs !== 24) style.push(`font-size:${s.fs / 2}pt`)
      if (s.cf && colors[s.cf]) style.push(`color:${colors[s.cf]}`)
      if (style.length) wrap(`<span style="${style.join(';')}">`, '</span>')
      if (s.b) wrap('<b>', '</b>')
      if (s.i) wrap('<i>', '</i>')
      if (s.u) wrap('<u>', '</u>')
      if (s.s) wrap('<s>', '</s>')
      if (s.sup) wrap('<sup>', '</sup>')
      if (s.sub) wrap('<sub>', '</sub>')
      runOpen = open
      runClose = close
    }
    runText += text
  }
  const endPara = () => {
    flushRun()
    paras.push(`<p${align ? ` style="text-align:${align}"` : ''}>${para}</p>`)
    para = ''
  }

  let i = 0
  let skipChars = 0
  while (i < rtf.length) {
    const c = rtf[i]
    if (c === '{') {
      st.push({ ...cur(), colortbl: false })
      i++
      // {\*\dest …}: an ignorable destination.
      if (rtf.startsWith('\\*', i)) {
        cur().skip = true
        i += 2
      }
      continue
    }
    if (c === '}') {
      if (cur().colortbl && color.set) colors.push(`rgb(${color.r},${color.g},${color.b})`)
      if (st.length > 1) st.pop()
      i++
      continue
    }
    if (c === '\\') {
      const n = rtf[i + 1]
      if (n === '\\' || n === '{' || n === '}') {
        if (skipChars > 0) skipChars--
        else emit(n)
        i += 2
        continue
      }
      if (n === "'") {
        const code = parseInt(rtf.slice(i + 2, i + 4), 16)
        i += 4
        if (skipChars > 0) {
          skipChars--
          continue
        }
        emit(String.fromCharCode(CP1252[code] ?? code))
        continue
      }
      if (n === '~') {
        emit(' ')
        i += 2
        continue
      }
      if (n === '-') {
        i += 2
        continue
      }
      if (n === '_') {
        emit('‑')
        i += 2
        continue
      }
      if (n === '\n' || n === '\r') {
        if (!cur().skip) endPara()
        i += 2
        continue
      }
      const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i + 1, i + 40))
      if (!m) {
        i += 2
        continue
      }
      i += 1 + m[0].length
      const word = m[1]
      const arg = m[2] === undefined ? undefined : Number(m[2])
      const s = cur()
      if (SKIP.has(word)) {
        if (word === 'colortbl') {
          s.colortbl = true
          color = { r: 0, g: 0, b: 0, set: false }
        } else s.skip = true
        continue
      }
      if (s.colortbl) {
        if (word === 'red') color = { ...color, r: arg ?? 0, set: true }
        if (word === 'green') color = { ...color, g: arg ?? 0, set: true }
        if (word === 'blue') color = { ...color, b: arg ?? 0, set: true }
        continue
      }
      switch (word) {
        case 'par':
        case 'sect':
          if (!s.skip) endPara()
          break
        case 'line':
          if (!s.skip) {
            flushRun()
            para += '<br>'
          }
          break
        case 'tab':
          emit('\t')
          break
        case 'b':
          s.b = arg !== 0
          break
        case 'i':
          s.i = arg !== 0
          break
        case 'ul':
          s.u = arg !== 0
          break
        case 'ulnone':
          s.u = false
          break
        case 'strike':
          s.s = arg !== 0
          break
        case 'super':
          s.sup = true
          s.sub = false
          break
        case 'sub':
          s.sub = true
          s.sup = false
          break
        case 'nosupersub':
          s.sup = s.sub = false
          break
        case 'plain':
          Object.assign(s, { b: false, i: false, u: false, s: false, sup: false, sub: false, fs: 24, cf: 0 })
          break
        case 'fs':
          s.fs = arg ?? 24
          break
        case 'cf':
          s.cf = arg ?? 0
          break
        case 'pard':
          align = ''
          break
        case 'qc':
          align = 'center'
          break
        case 'qr':
          align = 'right'
          break
        case 'qj':
          align = 'justify'
          break
        case 'ql':
          align = ''
          break
        case 'uc':
          s.uc = arg ?? 1
          break
        case 'u': {
          let code = arg ?? 0
          if (code < 0) code += 65536
          emit(String.fromCharCode(code))
          skipChars = s.uc
          break
        }
        case 'emdash':
          emit('—')
          break
        case 'endash':
          emit('–')
          break
        case 'bullet':
          emit('•')
          break
        case 'lquote':
          emit('‘')
          break
        case 'rquote':
          emit('’')
          break
        case 'ldblquote':
          emit('“')
          break
        case 'rdblquote':
          emit('”')
          break
        case 'emspace':
        case 'enspace':
          emit(' ')
          break
        default:
          break
      }
      continue
    }
    if (c === '\r' || c === '\n') {
      i++
      continue
    }
    // Plain text up to the next control character.
    let j = i
    while (j < rtf.length && rtf[j] !== '\\' && rtf[j] !== '{' && rtf[j] !== '}' && rtf[j] !== '\r' && rtf[j] !== '\n') j++
    let text = rtf.slice(i, j)
    if (skipChars > 0) {
      const k = Math.min(skipChars, text.length)
      text = text.slice(k)
      skipChars -= k
    }
    if (text) emit(text)
    i = j
  }
  flushRun()
  if (para) endPara()
  return paras.join('\n')
}
