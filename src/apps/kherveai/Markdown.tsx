// Replies rendered as Markdown (marked + DOMPurify) with $…$ / $$…$$ maths
// (KaTeX). Top-level code blocks become interactive: copy, save to a file on
// the drive, and (Python) open as a new KherveBook notebook.

import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Marked, type Token, type Tokens } from 'marked'
import DOMPurify from 'dompurify'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { BookOpen, Check, Copy, Download } from 'lucide-react'
import { HOME, fs, os, path as vpath } from '@/os'
import { escapeHtml, highlightHtml, highlightNodes } from './highlight'
import { copyToClipboard, errorText } from './util'

// --------------------------------------------------------------------- maths

type MathToken = Tokens.Generic & { tex: string; display: boolean }

let mathParts: string[] = []
let mathNonce = ''

function mathHtml(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', trust: false, maxExpand: 1000, maxSize: 40 })
  } catch {
    return `<code>${escapeHtml(tex)}</code>`
  }
}

function placeholder(t: MathToken): string {
  const i = mathParts.push(mathHtml(t.tex, t.display)) - 1
  return `<span data-kai-math="${mathNonce}-${i}"></span>`
}

const BLOCK_RULES: RegExp[] = [/^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/, /^ {0,3}\\\[([\s\S]+?)\\\][ \t]*(?:\n+|$)/]
const BLOCK_START = /(?:^|\n) {0,3}(?:\$\$|\\\[)/
const INLINE_RULES: [RegExp, boolean][] = [
  [/^\$\$((?:\\[\s\S]|[^\\$])+?)\$\$/, true],
  // $…$: no space just inside the dollars, no digit right after ("$5 and $10" is money)
  [/^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<![\s\\])\$(?!\d)/, false],
  [/^\\\(([\s\S]+?)\\\)/, false],
  [/^\\\[([\s\S]+?)\\\]/, true],
]
const INLINE_START = /\$|\\\(|\\\[/
const MATH_SPANS = /\$\$[\s\S]+?\$\$|\$(?![\s$])(?:\\.|[^\\$\n])+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/g

const md = new Marked({
  gfm: true,
  breaks: true,
  extensions: [
    {
      name: 'kaiMathBlock',
      level: 'block',
      start(src: string) {
        const m = BLOCK_START.exec(src)
        return m ? m.index + (m[0].startsWith('\n') ? 1 : 0) : undefined
      },
      tokenizer(src: string) {
        for (const re of BLOCK_RULES) {
          const m = re.exec(src)
          if (m) return { type: 'kaiMathBlock', raw: m[0], tex: m[1].trim(), display: true } as MathToken
        }
        return undefined
      },
      renderer(token: Tokens.Generic) {
        return `<div class="kai-math-block">${placeholder(token as MathToken)}</div>\n`
      },
    },
    {
      name: 'kaiMath',
      level: 'inline',
      start(src: string) {
        const i = src.search(INLINE_START)
        return i < 0 ? undefined : i
      },
      tokenizer(src: string) {
        for (const [re, display] of INLINE_RULES) {
          const m = re.exec(src)
          if (m) return { type: 'kaiMath', raw: m[0], tex: m[1].trim(), display } as MathToken
        }
        return undefined
      },
      renderer(token: Tokens.Generic) {
        return placeholder(token as MathToken)
      },
    },
  ],
  hooks: {
    // Keep * and _ inside formulas from being taken as emphasis.
    emStrongMask(src: string) {
      return src.replace(MATH_SPANS, (m) => m[0] + 'a'.repeat(Math.max(0, m.length - 2)) + m[m.length - 1])
    },
  },
  renderer: {
    // Code inside lists and quotes (top-level blocks are React components).
    code({ text, lang }: Tokens.Code) {
      const l = langOf(lang)
      return `<pre class="kai-pre"><code>${highlightHtml(text, l)}</code></pre>\n`
    },
  },
})

function langOf(info: string | undefined): string {
  return (info ?? '').trim().split(/\s+/)[0].toLowerCase()
}

function renderTokens(tokens: Token[]): string {
  mathParts = []
  mathNonce = Math.random().toString(36).slice(2, 8)
  let html: string
  try {
    html = md.parser(tokens)
  } catch (e) {
    return `<p>${escapeHtml(errorText(e))}</p>`
  }
  const clean = DOMPurify.sanitize(html, { ADD_ATTR: ['data-kai-math'] })
  const parts = mathParts
  return clean.replace(new RegExp(`<span data-kai-math="${mathNonce}-(\\d+)"></span>`, 'g'), (_m, i: string) => parts[Number(i)] ?? '')
}

type Part = { kind: 'html'; html: string } | { kind: 'code'; code: string; lang: string; closed: boolean }

function splitMarkdown(text: string): Part[] {
  let tokens: Token[]
  try {
    tokens = md.lexer(text)
  } catch {
    return [{ kind: 'html', html: `<p>${escapeHtml(text)}</p>` }]
  }
  const parts: Part[] = []
  let group: Token[] = []
  const flush = () => {
    if (group.length) parts.push({ kind: 'html', html: renderTokens(group) })
    group = []
  }
  for (const tok of tokens) {
    if (tok.type === 'code') {
      flush()
      const c = tok as Tokens.Code
      parts.push({ kind: 'code', code: c.text, lang: langOf(c.lang), closed: /```\s*$|~~~\s*$/.test(c.raw) || c.codeBlockStyle === 'indented' })
    } else {
      group.push(tok)
    }
  }
  flush()
  return parts
}

// ----------------------------------------------------------- the component

/** What code blocks need to know about the chat they are in. */
export const CodeContext = createContext<{ title: string }>({ title: 'kAI' })

function onLinkClick(e: React.MouseEvent) {
  const a = (e.target as HTMLElement).closest('a')
  if (!a) return
  const href = a.getAttribute('href') ?? ''
  e.preventDefault() // never let a link navigate KherveOS itself away
  if (/^https?:\/\//i.test(href)) {
    os.openUrl(href, { background: e.metaKey || e.ctrlKey })
  } else if (href.startsWith('/') || href.startsWith('~/')) {
    let p: string
    try {
      p = vpath.resolve(HOME, decodeURI(href))
    } catch {
      return
    }
    if (fs.exists(p)) void os.openFile(p)
  } else if (/^mailto:/i.test(href)) {
    os.openUrl(href)
  }
}

export const Markdown = memo(function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const parts = useMemo(() => splitMarkdown(text), [text])
  return (
    <div className="kai-md" onClick={onLinkClick}>
      {parts.map((p, i) =>
        p.kind === 'code' ? (
          <CodeBlock key={i} code={p.code} lang={p.lang} writing={streaming && !p.closed && i === parts.length - 1} />
        ) : (
          <div key={i} className="kai-md-part" dangerouslySetInnerHTML={{ __html: p.html }} />
        ),
      )}
    </div>
  )
})

// ------------------------------------------------------------- code blocks

const EXT: Record<string, string> = {
  python: '.py', py: '.py', python3: '.py', ipython: '.py', js: '.js', javascript: '.js', mjs: '.mjs', jsx: '.jsx', ts: '.ts',
  typescript: '.ts', tsx: '.tsx', json: '.json', html: '.html', css: '.css', md: '.md', markdown: '.md', sh: '.sh', bash: '.sh',
  zsh: '.sh', shell: '.sh', tex: '.tex', latex: '.tex', bib: '.bib', csv: '.csv', yaml: '.yml', yml: '.yml', toml: '.toml',
  xml: '.xml', svg: '.svg', sql: '.sql', c: '.c', cpp: '.cpp', 'c++': '.cpp', java: '.java', rust: '.rs', go: '.go', r: '.r',
  ruby: '.rb', php: '.php', ini: '.ini', txt: '.txt', text: '.txt',
}
const PYTHON = new Set(['python', 'py', 'python3', 'ipython'])
const LABELS: Record<string, string> = { py: 'python', js: 'javascript', ts: 'typescript', sh: 'shell', md: 'markdown', yml: 'yaml' }

function safeName(s: string): string {
  return s.replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 60).trim()
}

async function saveCode(code: string, lang: string, title: string) {
  const ext = EXT[lang] ?? '.txt'
  const dir = `${HOME}/Documents`
  const base = `${safeName(title) || 'code'}${ext}`
  const target = await os.dialog.saveFile({ title: 'Save code to a file', startDir: dir, defaultName: vpath.join(dir, fs.isDir(dir) ? fs.uniqueName(dir, base) : base) })
  if (!target) return
  try {
    await fs.writeText(target, code.endsWith('\n') ? code : `${code}\n`, { mkdirs: true })
    os.notify({ title: `Saved ${vpath.basename(target)}`, body: `In ${vpath.pretty(vpath.dirname(target))} — click to open`, onClick: () => void os.openFile(target) })
  } catch (e) {
    await os.dialog.alert(`The file could not be saved.\n\n${errorText(e)}`, { title: 'kAI' })
  }
}

/** A new notebook in ~/Notebooks with the code as its first cell, opened in KherveBook. */
async function openInKherveBook(code: string, title: string) {
  const dir = `${HOME}/Notebooks`
  try {
    await fs.mkdir(dir, { recursive: true })
    const target = vpath.join(dir, fs.uniqueName(dir, `${safeName(title) || 'kAI'}.kbook`))
    const doc = { format: 'kbook', version: 1, cells: [{ type: 'code', source: code.replace(/\n+$/, '') }] }
    await fs.writeText(target, JSON.stringify(doc, null, 1))
    os.open('khervebook', { path: target })
  } catch (e) {
    await os.dialog.alert(`The notebook could not be created.\n\n${errorText(e)}`, { title: 'kAI' })
  }
}

function CodeBlock({ code, lang, writing }: { code: string; lang: string; writing: boolean }) {
  const { title } = useContext(CodeContext)
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  // While the block is still being written, colour it only now and then.
  const settled = useThrottled(code, writing, 300)
  const nodes = useMemo(() => highlightNodes(settled, lang), [settled, lang])
  const tail = code.startsWith(settled) ? code.slice(settled.length) : null
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  const copy = async () => {
    if (!(await copyToClipboard(code))) return
    setCopied(true)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="kai-code">
      <div className="kai-code-head">
        <span className="kai-code-lang">{LABELS[lang] ?? (lang || 'code')}</span>
        <button className="kai-code-btn" onClick={() => void copy()} title="Copy the code">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
        <button className="kai-code-btn" onClick={() => void saveCode(code, lang, title)} title="Save the code to a file on the drive" disabled={writing}>
          <Download size={13} />
          <span>Save to file…</span>
        </button>
        {PYTHON.has(lang) && (
          <button className="kai-code-btn" onClick={() => void openInKherveBook(code, title)} title="Open as a new kBook notebook" disabled={writing}>
            <BookOpen size={13} />
            <span>Open in kBook</span>
          </button>
        )}
      </div>
      <pre className="kai-code-body">
        <code>
          {nodes && tail !== null ? (
            <>
              {nodes}
              {tail}
            </>
          ) : (
            code
          )}
        </code>
      </pre>
    </div>
  )
}

/** `value`, but while `busy` updated at most every `ms` milliseconds. */
function useThrottled(value: string, busy: boolean, ms: number): string {
  const [shown, setShown] = useState(value)
  const last = useRef(0)
  useEffect(() => {
    if (!busy) {
      setShown(value)
      return
    }
    const t = window.setTimeout(() => {
      last.current = Date.now()
      setShown(value)
    }, Math.max(0, last.current + ms - Date.now()))
    return () => window.clearTimeout(t)
  }, [value, busy, ms])
  return busy ? shown : value
}
