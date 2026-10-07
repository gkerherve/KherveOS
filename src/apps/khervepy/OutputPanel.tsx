// The Output panel: what the running program prints, errors in red, plots inline.

import { memo, useEffect, useLayoutEffect, useRef } from 'react'
import { figureUrl } from '@/os/python/kernel'
import type { OutLine } from './runner'

export const OutputPanel = memo(function OutputPanel({ lines, version }: { lines: OutLine[]; version: number }) {
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  // Follow the output while the user is at the bottom; leave it alone when they scrolled up.
  useLayoutEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [version])
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="kpy-output" ref={box}>
      {lines.length === 0 ? (
        <div className="kpy-placeholder">Run a Python file (F5) to see its output here.</div>
      ) : (
        <pre>
          {lines.map((l) =>
            l.kind === 'img' ? (
              <img key={l.id} className="kpy-figure" src={figureUrl(l.text)} alt="Figure" />
            ) : (
              <span key={l.id} className={`o-${l.kind}`}>
                {l.text}
              </span>
            ),
          )}
        </pre>
      )}
    </div>
  )
})
