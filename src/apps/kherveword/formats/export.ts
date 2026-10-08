// KherveWord document → Markdown and plain text (File › Save As .md/.txt,
// and what the AI tools read). Plain TypeScript: tested in Node.

import { nodeText, type PMMark, type PMNode } from '../model.ts'

const HEADING: Record<string, string> = { Title: '#', Heading1: '#', Heading2: '##', Heading3: '###', Heading4: '####', Heading5: '#####', Heading6: '######' }

function has(marks: PMMark[] | undefined, type: string) {
  return !!marks?.some((m) => m.type === type)
}

function mdEscape(s: string): string {
  return s.replace(/([\\`*_[\]<>|])/g, '\\$1')
}

function mdInline(nodes: PMNode[] | undefined, notes: string[]): string {
  let out = ''
  for (const n of nodes ?? []) {
    if (has(n.marks, 'deletion')) continue
    if (n.type === 'text') {
      let s = mdEscape(n.text ?? '')
      const lead = /^\s*/.exec(s)![0]
      const trail = /\s*$/.exec(s.slice(lead.length))![0]
      let core = s.slice(lead.length, s.length - trail.length)
      if (core) {
        if (has(n.marks, 'subscript')) core = `<sub>${core}</sub>`
        if (has(n.marks, 'superscript')) core = `<sup>${core}</sup>`
        if (has(n.marks, 'strike')) core = `~~${core}~~`
        if (has(n.marks, 'italic')) core = `*${core}*`
        if (has(n.marks, 'bold')) core = `**${core}**`
        const link = n.marks?.find((m) => m.type === 'link')
        if (link) core = `[${core}](${String(link.attrs?.href ?? '')})`
      }
      s = lead + core + trail
      out += s
    } else if (n.type === 'hardBreak') out += '  \n'
    else if (n.type === 'image') out += `![${mdEscape(String(n.attrs?.alt ?? ''))}](${String(n.attrs?.src ?? '')})`
    else if (n.type === 'equation') out += `$${String(n.attrs?.latex ?? '')}$`
    else if (n.type === 'footnote') {
      notes.push(String(n.attrs?.text ?? ''))
      out += `[^${notes.length}]`
    }
  }
  return out
}

function mdBlocks(nodes: PMNode[] | undefined, notes: string[], indent = ''): string[] {
  const out: string[] = []
  let code: string[] | null = null
  const flushCode = () => {
    if (code) out.push(`${indent}\`\`\`\n${code.map((l) => indent + l).join('\n')}\n${indent}\`\`\``)
    code = null
  }
  for (const n of nodes ?? []) {
    if (n.type === 'paragraph' && n.attrs?.style === 'Code') {
      ;(code ??= []).push(nodeText(n))
      continue
    }
    flushCode()
    switch (n.type) {
      case 'paragraph': {
        const style = String(n.attrs?.style ?? 'Normal')
        const text = mdInline(n.content, notes)
        if (HEADING[style]) out.push(`${indent}${HEADING[style]} ${text}`)
        else if (style === 'Quote' || style === 'IntenseQuote') out.push(`${indent}> ${text}`)
        else out.push(indent + text)
        break
      }
      case 'bulletList':
      case 'orderedList': {
        let k = Number(n.attrs?.start ?? 1) || 1
        const lines: string[] = []
        for (const item of n.content ?? []) {
          const marker = n.type === 'bulletList' ? '- ' : `${k++}. `
          const inner = ' '.repeat(marker.length)
          const parts: string[] = []
          ;(item.content ?? []).forEach((c, i) => {
            if (c.type === 'bulletList' || c.type === 'orderedList') parts.push(...mdBlocks([c], notes, indent + inner))
            else {
              const b = mdBlocks([c], notes, '').join('\n')
              parts.push(i === 0 ? `${indent}${marker}${b}` : `${indent}${inner}${b}`)
            }
          })
          lines.push(parts.join('\n'))
        }
        out.push(lines.join('\n'))
        break
      }
      case 'table': {
        const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => mdInline((c.content ?? []).flatMap((p) => (p.type === 'paragraph' ? (p.content ?? []) : [{ type: 'text', text: nodeText(p) }])), notes).replace(/\|/g, '\\|').replace(/\n/g, ' ')))
        if (!rows.length) break
        const w = Math.max(...rows.map((r) => r.length))
        const line = (r: string[]) => `| ${Array.from({ length: w }, (_, i) => r[i] ?? '').join(' | ')} |`
        out.push([line(rows[0]), `|${' --- |'.repeat(w)}`, ...rows.slice(1).map(line)].map((l) => indent + l).join('\n'))
        break
      }
      case 'pageBreak':
      case 'horizontalRule':
        out.push(`${indent}---`)
        break
      case 'equationBlock':
        out.push(`${indent}$$\n${indent}${String(n.attrs?.latex ?? '')}\n${indent}$$`)
        break
      case 'toc':
        out.push(`${indent}[TOC]`)
        break
      default:
        if (n.content) out.push(...mdBlocks(n.content, notes, indent))
    }
  }
  flushCode()
  return out
}

export function docToMarkdown(doc: PMNode): string {
  const notes: string[] = []
  const blocks = mdBlocks(doc.content, notes)
  let md = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n')
  if (notes.length) md += `\n\n${notes.map((t, i) => `[^${i + 1}]: ${t}`).join('\n')}`
  return `${md.trim()}\n`
}

function textBlocks(nodes: PMNode[] | undefined, out: string[], indent = '') {
  for (const n of nodes ?? []) {
    switch (n.type) {
      case 'paragraph':
        out.push(indent + nodeText(n))
        break
      case 'bulletList':
      case 'orderedList': {
        let k = Number(n.attrs?.start ?? 1) || 1
        for (const item of n.content ?? []) {
          const marker = n.type === 'bulletList' ? '• ' : `${k++}. `
          const sub: string[] = []
          textBlocks(item.content, sub, indent + '    ')
          if (sub.length) sub[0] = indent + marker + sub[0].slice(indent.length + 4)
          out.push(...sub)
        }
        break
      }
      case 'table':
        for (const r of n.content ?? []) out.push(indent + (r.content ?? []).map((c) => nodeText(c).replace(/\s+/g, ' ').trim()).join('\t'))
        break
      case 'equationBlock':
        out.push(indent + String(n.attrs?.latex ?? ''))
        break
      case 'pageBreak':
        out.push('\f')
        break
      default:
        if (n.content) textBlocks(n.content, out, indent)
    }
  }
}

export function docToText(doc: PMNode): string {
  const out: string[] = []
  textBlocks(doc.content, out)
  return `${out.join('\n')}\n`
}
