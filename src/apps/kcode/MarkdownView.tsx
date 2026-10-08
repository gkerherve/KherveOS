// Draws the tree of markdown.ts as React elements. Text is always a React text node,
// so nothing in a lesson can become markup; links open through the KherveOS Browser.

import { memo, useMemo, type ReactNode } from 'react'
import { Copy } from 'lucide-react'
import { os } from '@/os'
import { CodeEditor, type EditorLanguage } from '@/os/ui/CodeEditor'
import { parseMarkdown, type Block, type Inline } from './markdown.ts'

function Inlines({ nodes }: { nodes: Inline[] }): ReactNode {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text': return <span key={i}>{n.s}</span>
          case 'code': return <code key={i} className="kcd-ic">{n.s}</code>
          case 'b': return <strong key={i}><Inlines nodes={n.c} /></strong>
          case 'i': return <em key={i}><Inlines nodes={n.c} /></em>
          case 'a': return (
            <a key={i} href={n.href} className="kcd-link" onClick={(e) => { e.preventDefault(); os.openUrl(n.href) }}>
              <Inlines nodes={n.c} />
            </a>
          )
        }
      })}
    </>
  )
}

const LANGS: Record<string, EditorLanguage> = { python: 'python', py: 'python', javascript: 'javascript', js: 'javascript' }

export function CodeBlock({ text, lang, fontSize = 12.5 }: { text: string; lang: string; fontSize?: number }) {
  const language = LANGS[lang.toLowerCase()]
  const copy = () => {
    try {
      void navigator.clipboard?.writeText(text)
    } catch {
      /* no clipboard access: nothing to do */
    }
  }
  return (
    <div className="kcd-block">
      {language ? (
        <CodeEditor value={text} language={language} readOnly autoHeight fontSize={fontSize} wrap />
      ) : (
        <pre className="kcd-plain">{text}</pre>
      )}
      <button className="k-icon-btn kcd-copy" title="Copy" aria-label="Copy the code" onClick={copy}><Copy size={13} /></button>
    </div>
  )
}

function BlockView({ b, fontSize }: { b: Block; fontSize: number }) {
  const codeSize = fontSize - 0.5
  switch (b.t) {
    case 'h':
      return b.level === 1 ? <h2 className="kcd-h1"><Inlines nodes={b.c} /></h2> : b.level === 2 ? <h3 className="kcd-h2"><Inlines nodes={b.c} /></h3> : <h4 className="kcd-h3"><Inlines nodes={b.c} /></h4>
    case 'p': return <p><Inlines nodes={b.c} /></p>
    case 'ul': return <ul>{b.items.map((it, i) => <li key={i}><Inlines nodes={it} /></li>)}</ul>
    case 'ol': return <ol>{b.items.map((it, i) => <li key={i}><Inlines nodes={it} /></li>)}</ol>
    case 'quote': return <blockquote><Inlines nodes={b.c} /></blockquote>
    case 'code': return <CodeBlock text={b.text} lang={b.lang} fontSize={codeSize} />
    case 'hr': return <hr />
  }
}

/** A lesson text (markdown, see markdown.ts). */
export const MarkdownView = memo(function MarkdownView({ text, fontSize = 13 }: { text: string; fontSize?: number }) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return (
    <div className="kcd-md" style={{ fontSize }}>
      {blocks.map((b, i) => <BlockView key={i} b={b} fontSize={fontSize} />)}
    </div>
  )
})
