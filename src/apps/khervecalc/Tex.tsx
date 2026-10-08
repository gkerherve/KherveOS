// KaTeX in a span (memoised: history entries render once).

import { memo, useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

export const Tex = memo(function Tex({ tex, display = false, className }: { tex: string; display?: boolean; className?: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { throwOnError: false, displayMode: display, strict: 'ignore', trust: false, output: 'html', maxExpand: 500 })
    } catch {
      return null
    }
  }, [tex, display])
  if (html === null) return <span className={`kc-tex-fallback ${className ?? ''}`}>{tex}</span>
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
})
