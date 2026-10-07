// LaTeX *documents* in a LaTeX cell (\documentclass, \section, \textbf,
// lists, equations…). The desktop compiles them with tectonic, or falls back
// to a lightweight text renderer (latextext.py). There is no TeX engine in
// the browser, so this is that renderer, with the maths typeset by KaTeX:
// title block, (numbered) sections, paragraphs, text styles, lists, tables,
// numbered display equations and figure captions.

import katex from 'katex'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function math(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: 'ignore', trust: false, maxExpand: 1000, maxSize: 40 })
  } catch {
    return `<span class="nb-math-error" title="Not understood by the math renderer">${esc(display ? tex : `$${tex}$`)}</span>`
  }
}

/** The balanced {…} group starting at s[i] === '{': [content, index after]. */
function group(s: string, i: number): [string, number] | null {
  if (s[i] !== '{') return null
  let depth = 0
  for (let j = i; j < s.length; j++) {
    const ch = s[j]
    if (ch === '\\') {
      j++
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1]
  }
  return null
}

/** Replace every \cmd{…} (balanced braces), left to right. `pattern` is a regex source for the command name. */
function replaceCmd(s: string, pattern: string, fn: (arg: string, name: string) => string): string {
  const re = new RegExp(`\\\\(${pattern})\\s*(?=\\{)`, 'g')
  let out = ''
  let last = 0
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const g = group(s, m.index + m[0].length)
    if (!g) continue
    out += s.slice(last, m.index) + fn(g[0], m[1])
    last = g[1]
    re.lastIndex = g[1]
  }
  return out + s.slice(last)
}

function grab(s: string, cmd: string): string | null {
  const m = new RegExp(`\\\\${cmd}\\s*(?=\\{)`).exec(s)
  if (!m) return null
  const g = group(s, m.index + m[0].length)
  return g ? g[0] : null
}

const DISPLAY_ENVS = ['equation', 'align', 'gather', 'multline', 'eqnarray', 'displaymath', 'flalign', 'alignat']

const STYLES: [string, (a: string) => string][] = [
  ['textbf', (a) => `<b>${a}</b>`],
  ['textit', (a) => `<i>${a}</i>`],
  ['emph', (a) => `<i>${a}</i>`],
  ['textsl', (a) => `<i>${a}</i>`],
  ['underline', (a) => `<u>${a}</u>`],
  ['uline', (a) => `<u>${a}</u>`],
  ['texttt', (a) => `<code>${a}</code>`],
  ['sout', (a) => `<s>${a}</s>`],
  ['textsc', (a) => `<span class="nb-texdoc-sc">${a}</span>`],
  ['textsubscript', (a) => `<sub>${a}</sub>`],
  ['textsuperscript', (a) => `<sup>${a}</sup>`],
  ['footnote', (a) => `<span class="nb-texdoc-note"> (${a})</span>`],
  ['url', (a) => `<code>${a}</code>`],
  ['href\\{[^}]*\\}', (a) => a],
]

/** Running text: escape, then text styles, ligatures and leftover commands. */
function inline(tex: string): string {
  let t = esc(tex)
  for (let k = 0; k < 3; k++) for (const [cmd, fn] of STYLES) t = replaceCmd(t, cmd, fn)
  t = t
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/``/g, '“')
    .replace(/&#39;&#39;/g, '”')
    .replace(/(?<!\\)~/g, '&nbsp;')
    .replace(/\\(?:quad|qquad)\b/g, '&emsp;')
    .replace(/\\[,;:! ]/g, ' ')
    .replace(/\\\\(\[[^\]]*\])?/g, '<br>')
    .replace(/\\(?:newline|linebreak)\b/g, '<br>')
    .replace(/\\(?:ref|eqref|cite|pageref)\{([^}]*)\}/g, '[$1]')
    .replace(/\\(LaTeX|TeX)\b(\{\})?/g, '$1')
  // Other one-argument commands keep their argument; bare commands go.
  for (let k = 0; k < 2; k++) t = t.replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g, '$1')
  t = t.replace(/\\(?:begin|end)\{[^}]*\}/g, '').replace(/\\[a-zA-Z]+\*?\s?/g, '')
  return t
    .replace(/\\&#38;/g, '&amp;')
    .replace(/\\%/g, '%')
    .replace(/\\#/g, '#')
    .replace(/\\_/g, '_')
    .replace(/\\\$/g, '$')
    .replace(/\\\{/g, '&#123;')
    .replace(/\\\}/g, '&#125;')
    .replace(/[{}]/g, '')
}

export function renderLatexDocument(src: string): string {
  const held: string[] = []
  /** Inline placeholder for finished HTML (survives escaping: \u0000 and digits). */
  const hold = (html: string) => `\u0000${held.push(html) - 1}\u0000`
  /** A block of its own (breaks the paragraph around it). */
  const block = (html: string) => `\n\n${hold(html)}\n\n`

  let tex = src.replace(/\r\n?/g, '\n')
  tex = tex.replace(/(^|[^\\])%.*$/gm, '$1') // comments
  tex = tex.replace(/\\documentclass(\[[^\]]*\])?\{[^}]*\}/g, '')
  tex = tex.replace(/\\usepackage(\[[^\]]*\])?\{[^}]*\}/g, '')
  tex = tex.replace(/\\(begin|end)\{document\}/g, '')
  tex = tex.replace(/\\(?:tableofcontents|centering|noindent|newpage|clearpage|bigskip|medskip|smallskip|hfill|vfill)\b/g, '')
  tex = tex.replace(/\\label\{[^}]*\}/g, '')
  // A control word eats the spaces after it ("\textbackslash section" → "\section").
  tex = tex.replace(/\\textbackslash(?:\{\}| *)/g, () => hold('&#92;'))

  // Display maths, numbered like LaTeX; then inline maths.
  let eq = 0
  const envRe = new RegExp(`\\\\begin\\{(${DISPLAY_ENVS.join('|')})(\\*?)\\}([\\s\\S]*?)\\\\end\\{\\1\\2\\}`, 'g')
  tex = tex.replace(envRe, (_m, env: string, star: string, body: string) => {
    let inner = body.trim()
    if (env !== 'equation' && env !== 'displaymath') {
      const wrap = env === 'gather' || env === 'multline' ? 'gathered' : 'aligned'
      inner = `\\begin{${wrap}}${inner}\\end{${wrap}}`
    }
    if (!star && env !== 'displaymath') inner += `\\tag{${++eq}}`
    return block(`<div class="nb-texdoc-eq">${math(inner, true)}</div>`)
  })
  const display = (_m: string, b: string) => block(`<div class="nb-texdoc-eq">${math(b.trim(), true)}</div>`)
  tex = tex.replace(/\$\$([\s\S]+?)\$\$/g, display).replace(/\\\[([\s\S]+?)\\\]/g, display)
  tex = tex.replace(/(?<!\\)\$((?:\\.|[^\\$])+?)\$/g, (_m, b: string) => hold(math(b, false)))
  tex = tex.replace(/\\\(([\s\S]+?)\\\)/g, (_m, b: string) => hold(math(b, false)))

  // Title block, shown where \maketitle is (as LaTeX does).
  const title = grab(tex, 'title')
  const author = grab(tex, 'author')
  const date = grab(tex, 'date')
  tex = replaceCmd(tex, 'title|author|date', () => '')
  const head =
    (title ? `<h1 class="nb-texdoc-title">${inline(title)}</h1>` : '') +
    (author ? `<div class="nb-texdoc-author">${inline(author)}</div>` : '') +
    (date ? `<div class="nb-texdoc-date">${inline(date)}</div>` : '')
  tex = tex.replace(/\\maketitle\b/, () => (head ? block(`<header class="nb-texdoc-head">${head}</header>`) : ''))
  tex = tex.replace(/\\maketitle\b/g, '')

  // Tables.
  tex = tex.replace(/\\begin\{tabular\*?\}(?:\{[^}]*\})?\{[^}]*\}([\s\S]*?)\\end\{tabular\*?\}/g, (_m, body: string) => {
    const rows = body
      .replace(/\\(?:hline|toprule|midrule|bottomrule)\b|\\cline\{[^}]*\}/g, '')
      .split(/\\\\/)
      .map((r) => r.trim())
      .filter(Boolean)
    const html = rows.map((r) => `<tr>${r.split(/(?<!\\)&/).map((c) => `<td>${inline(c.trim())}</td>`).join('')}</tr>`).join('')
    return block(`<table class="nb-texdoc-table">${html}</table>`)
  })

  // Figures: the graphic is named, the caption kept.
  tex = tex.replace(/\\includegraphics(?:\[[^\]]*\])?\{([^}]*)\}/g, (_m, f: string) => block(`<div class="nb-texdoc-graphic">[figure: ${esc(f)}]</div>`))
  tex = replaceCmd(tex, 'caption', (a) => block(`<p class="nb-texdoc-caption">${inline(a)}</p>`))
  tex = tex.replace(/\\(?:begin|end)\{(?:figure|table)\*?\}(?:\[[^\]]*\])?/g, '\n\n')

  // Sections, numbered unless starred (one pass, in document order).
  const n = [0, 0, 0]
  tex = replaceCmd(tex, '(?:sub){0,2}section\\*?|paragraph', (arg, name) => {
    if (name === 'paragraph') return hold(`<b>${inline(arg)}</b>`) + ' '
    const level = name.startsWith('subsub') ? 2 : name.startsWith('sub') ? 1 : 0
    let num = ''
    if (!name.endsWith('*')) {
      n[level]++
      for (let k = level + 1; k < 3; k++) n[k] = 0
      num = n.slice(0, level + 1).join('.') + '&ensp;'
    }
    return block(`<h${level + 2}>${num}${inline(arg)}</h${level + 2}>`)
  })

  // Lists, innermost first: a nested list is held inside its parent's item.
  const lists = new Set<string>()
  const innermost = /\\begin\{(itemize|enumerate|description)\}((?:(?!\\begin\{(?:itemize|enumerate|description)\})[\s\S])*?)\\end\{\1\}/
  for (let m = innermost.exec(tex); m; m = innermost.exec(tex)) {
    const [whole, env, body] = m
    const items = body
      .split(/\\item\b\s*/)
      .slice(1)
      .map((it) => {
        const lab = /^\[([^\]]*)\]\s*/.exec(it)
        const text = lab ? it.slice(lab[0].length) : it
        return `<li>${lab ? `<b>${inline(lab[1])}</b> ` : ''}${inline(text.trim())}</li>`
      })
      .join('')
    const tag = env === 'enumerate' ? 'ol' : 'ul'
    const ph = hold(`<${tag}${env === 'description' ? ' class="nb-texdoc-desc"' : ''}>${items}</${tag}>`)
    lists.add(ph)
    tex = tex.slice(0, m.index) + ph + tex.slice(m.index + whole.length)
  }
  // The lists still in the text are the outer ones: each is a block of its own.
  for (const ph of lists) tex = tex.split(ph).join(`\n\n${ph}\n\n`)

  // Paragraphs from blank lines.
  const out: string[] = []
  for (const raw of tex.split(/\n\s*\n/)) {
    const part = raw.trim()
    if (!part) continue
    out.push(/^\u0000\d+\u0000$/.test(part) ? part : `<p>${inline(part)}</p>`)
  }
  let html = out.join('\n')
  // Held pieces may hold others (a caption with maths): resolve until stable.
  for (let k = 0; k < 4 && html.includes('\u0000'); k++) html = html.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => held[Number(i)] ?? '')
  return `<div class="nb-texdoc">${html}</div>`
}
