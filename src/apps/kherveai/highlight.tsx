// Syntax colours for code in replies, with the same Lezer parsers the editor
// uses. Token classes map to the theme's --k-syn-* colours (kherveai.css).

import type { ReactNode } from 'react'
import { highlightCode, tagHighlighter, tags as t } from '@lezer/highlight'
import { pythonLanguage } from '@codemirror/lang-python'
import { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from '@codemirror/lang-javascript'
import { jsonLanguage } from '@codemirror/lang-json'

const highlighter = tagHighlighter([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword, t.self], class: 'kai-k' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], class: 'kai-s' },
  { tag: [t.number, t.bool, t.null, t.atom], class: 'kai-n' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: 'kai-c' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: 'kai-f' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName), t.definition(t.function(t.variableName))], class: 'kai-d' },
  { tag: [t.className, t.typeName, t.namespace], class: 'kai-t' },
  { tag: [t.propertyName, t.attributeName], class: 'kai-p' },
  { tag: t.meta, class: 'kai-c' },
  { tag: t.invalid, class: 'kai-x' },
])

type Parser = (typeof pythonLanguage)['parser']

function parserFor(lang: string): Parser | null {
  switch (lang) {
    case 'python':
    case 'py':
    case 'python3':
    case 'ipython':
      return pythonLanguage.parser
    case 'js':
    case 'javascript':
    case 'mjs':
    case 'cjs':
    case 'node':
      return javascriptLanguage.parser
    case 'jsx':
      return jsxLanguage.parser
    case 'ts':
    case 'typescript':
      return typescriptLanguage.parser
    case 'tsx':
      return tsxLanguage.parser
    case 'json':
    case 'jsonc':
    case 'kbook':
      return jsonLanguage.parser
    default:
      return null
  }
}

const MAX_HIGHLIGHT = 60_000

function segments(code: string, lang: string): [string, string][] | null {
  const parser = parserFor(lang)
  if (!parser || code.length > MAX_HIGHLIGHT) return null
  const out: [string, string][] = []
  try {
    highlightCode(
      code,
      parser.parse(code),
      highlighter,
      (text, classes) => out.push([text, classes]),
      () => out.push(['\n', '']),
    )
  } catch {
    return null
  }
  return out
}

/** Highlighted code as React nodes, or null for languages we can't colour. */
export function highlightNodes(code: string, lang: string): ReactNode[] | null {
  const segs = segments(code, lang)
  if (!segs) return null
  return segs.map(([text, cls], i) => (cls ? <span key={i} className={cls}>{text}</span> : text))
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** Highlighted code as HTML (for code inside lists and quotes). */
export function highlightHtml(code: string, lang: string): string {
  const segs = segments(code, lang)
  if (!segs) return escapeHtml(code)
  return segs.map(([text, cls]) => (cls ? `<span class="${cls}">${escapeHtml(text)}</span>` : escapeHtml(text))).join('')
}
