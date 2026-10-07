// What the desktop compiler does to the LaTeX before typesetting a preview
// (khervedoc/compiler.py): compile only the marked range, and skip images
// for speed. Exports and prints always compile everything.

export const COMPILE_START = '% ===== KHERVETEX COMPILE START ====='
export const COMPILE_END = '% ===== KHERVETEX COMPILE END ====='
export const NOT_COMPILE_START = '% ===== KHERVETEX NOT COMPILE START ====='
export const NOT_COMPILE_END = '% ===== KHERVETEX NOT COMPILE END ====='

const INCLUDEGRAPHICS_RE = /\\includegraphics(\*?)(\[[^\]]*\])?\{([^}]+)\}/g

/** Keep only the body between the compile markers; the rest is wrapped in \\iffalse…\\fi. */
export function applyCompileRange(tex: string): string {
  const lines = tex.split('\n')
  let beginDoc = -1
  let endDoc = -1
  let start = -1
  let end = -1
  lines.forEach((ln, i) => {
    const s = ln.trim()
    if (s.startsWith('\\begin{document}')) beginDoc = i
    else if (s.startsWith('\\end{document}')) endDoc = i
    else if (s === COMPILE_START) start = i
    else if (s === COMPILE_END) end = i
  })
  if (start === -1 && end === -1) return tex
  if (beginDoc === -1 || endDoc === -1) return tex
  const bodyStart = beginDoc + 1
  const keepFrom = start >= bodyStart ? start + 1 : bodyStart
  const keepTo = end > bodyStart ? end : endDoc
  const out = lines.slice(0, bodyStart)
  const before = lines.slice(bodyStart, keepFrom)
  if (before.some((l) => l.trim())) out.push('\\iffalse', ...before, '\\fi')
  out.push(...lines.slice(keepFrom, keepTo))
  const after = lines.slice(keepTo, endDoc)
  if (after.some((l) => l.trim())) out.push('\\iffalse', ...after, '\\fi')
  out.push(...lines.slice(endDoc))
  return out.join('\n')
}

/** Hide each NOT COMPILE START … END pair in \\iffalse…\\fi. */
export function applyNotCompileRanges(tex: string): string {
  const lines = tex.split('\n')
  const starts: number[] = []
  const ends: number[] = []
  lines.forEach((ln, i) => {
    const s = ln.trim()
    if (s === NOT_COMPILE_START) starts.push(i)
    else if (s === NOT_COMPILE_END) ends.push(i)
  })
  if (!starts.length || !ends.length) return tex
  const pairs: [number, number][] = []
  const used = new Set<number>()
  for (const s of starts) {
    const e = ends.find((x) => x > s && !used.has(x))
    if (e !== undefined) {
      pairs.push([s, e])
      used.add(e)
    }
  }
  if (!pairs.length) return tex
  const out: string[] = []
  let prev = 0
  for (const [s, e] of pairs.sort((a, b) => a[0] - b[0])) {
    out.push(...lines.slice(prev, s), '\\iffalse', ...lines.slice(s, e + 1), '\\fi')
    prev = e + 1
  }
  out.push(...lines.slice(prev))
  return out.join('\n')
}

/** Every \\includegraphics becomes a small framed name: much faster drafts. */
export function stripImages(tex: string): string {
  return tex.replace(INCLUDEGRAPHICS_RE, (_m, _star, _opts, path: string) =>
    `\\fbox{\\texttt{\\footnotesize ${path.replaceAll('\\', '/').replaceAll('_', '\\_')}}}`)
}

/** Does the LaTeX use compile markers at all? */
export function hasCompileMarkers(tex: string): boolean {
  return tex.includes('% ===== KHERVETEX ')
}
