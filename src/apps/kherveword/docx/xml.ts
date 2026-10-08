// A small XML parser and writer for the Office Open XML parts of .docx/.odt
// files. Plain TypeScript (no DOM): Node runs the round-trip tests.
//
// Element and attribute names keep a prefix, but the prefix is the canonical
// one for the namespace URI (w:, r:, wp:, a:, pic:, m:, v:…) whatever the file
// declared, so the reader can look for "w:p" in documents written by any tool.

export interface XmlElement {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
}
export type XmlNode = XmlElement | string

/** Namespace URI → the prefix the reader uses. */
const CANONICAL: Record<string, string> = {
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main': 'w',
  'http://purl.oclc.org/ooxml/wordprocessingml/main': 'w',
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships': 'r',
  'http://purl.oclc.org/ooxml/officeDocument/relationships': 'r',
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing': 'wp',
  'http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing': 'wp',
  'http://schemas.openxmlformats.org/drawingml/2006/main': 'a',
  'http://purl.oclc.org/ooxml/drawingml/main': 'a',
  'http://schemas.openxmlformats.org/drawingml/2006/picture': 'pic',
  'http://purl.oclc.org/ooxml/drawingml/picture': 'pic',
  'http://schemas.openxmlformats.org/officeDocument/2006/math': 'm',
  'http://purl.oclc.org/ooxml/officeDocument/math': 'm',
  'urn:schemas-microsoft-com:vml': 'v',
  'urn:schemas-microsoft-com:office:office': 'o',
  'http://schemas.openxmlformats.org/markup-compatibility/2006': 'mc',
  'http://schemas.microsoft.com/office/word/2010/wordprocessingShape': 'wps',
  'http://schemas.microsoft.com/office/word/2010/wordml': 'w14',
  'http://schemas.openxmlformats.org/package/2006/relationships': 'rel',
  'http://schemas.openxmlformats.org/package/2006/content-types': 'ct',
  'http://schemas.openxmlformats.org/package/2006/metadata/core-properties': 'cp',
  'http://purl.org/dc/elements/1.1/': 'dc',
  'http://purl.org/dc/terms/': 'dcterms',
  // OpenDocument
  'urn:oasis:names:tc:opendocument:xmlns:office:1.0': 'office',
  'urn:oasis:names:tc:opendocument:xmlns:text:1.0': 'text',
  'urn:oasis:names:tc:opendocument:xmlns:style:1.0': 'style',
  'urn:oasis:names:tc:opendocument:xmlns:table:1.0': 'table',
  'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0': 'draw',
  'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0': 'fo',
  'http://www.w3.org/1999/xlink': 'xlink',
  'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0': 'svg',
  'http://www.w3.org/1998/Math/MathML': 'math',
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e] ?? m
  })
}

/** Parse an XML document; returns its root element. Throws on hopeless input. */
export function parseXml(src: string): XmlElement {
  const root: XmlElement = { name: '#document', attrs: {}, children: [] }
  const stack: { el: XmlElement; ns: Map<string, string> }[] = [{ el: root, ns: new Map() }]
  let i = 0
  const n = src.length
  if (src.charCodeAt(0) === 0xfeff) i = 1
  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt < 0) {
      pushText(stack[stack.length - 1].el, src.slice(i))
      break
    }
    if (lt > i) pushText(stack[stack.length - 1].el, src.slice(i, lt))
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4)
      i = end < 0 ? n : end + 3
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9)
      const text = src.slice(lt + 9, end < 0 ? n : end)
      const top = stack[stack.length - 1].el
      top.children.push(text)
      i = end < 0 ? n : end + 3
    } else if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      const end = src.indexOf('>', lt)
      i = end < 0 ? n : end + 1
    } else if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt)
      if (stack.length > 1) stack.pop()
      i = end < 0 ? n : end + 1
    } else {
      // A start tag: name, attributes (quoted values may hold ">").
      let j = lt + 1
      while (j < n && !/[\s/>]/.test(src[j])) j++
      const rawName = src.slice(lt + 1, j)
      const rawAttrs: [string, string][] = []
      let selfClose = false
      for (;;) {
        while (j < n && /\s/.test(src[j])) j++
        if (j >= n) break
        if (src[j] === '>') {
          j++
          break
        }
        if (src[j] === '/' && src[j + 1] === '>') {
          selfClose = true
          j += 2
          break
        }
        let k = j
        while (k < n && !/[\s=/>]/.test(src[k])) k++
        const an = src.slice(j, k)
        while (k < n && /\s/.test(src[k])) k++
        let value = ''
        if (src[k] === '=') {
          k++
          while (k < n && /\s/.test(src[k])) k++
          const q = src[k]
          if (q === '"' || q === "'") {
            const e = src.indexOf(q, k + 1)
            value = src.slice(k + 1, e < 0 ? n : e)
            k = e < 0 ? n : e + 1
          } else {
            const s = k
            while (k < n && !/[\s>]/.test(src[k])) k++
            value = src.slice(s, k)
          }
        }
        if (an) rawAttrs.push([an, decodeEntities(value)])
        j = Math.max(k, j + 1)
      }
      const parent = stack[stack.length - 1]
      let ns = parent.ns
      for (const [an, v] of rawAttrs) {
        if (an === 'xmlns' || an.startsWith('xmlns:')) {
          if (ns === parent.ns) ns = new Map(parent.ns)
          ns.set(an === 'xmlns' ? '' : an.slice(6), v)
        }
      }
      const attrs: Record<string, string> = {}
      for (const [an, v] of rawAttrs) {
        if (an === 'xmlns' || an.startsWith('xmlns:')) continue
        attrs[canon(an, ns, false)] = v
      }
      const el: XmlElement = { name: canon(rawName, ns, true), attrs, children: [] }
      parent.el.children.push(el)
      if (!selfClose) stack.push({ el, ns })
      i = j
    }
  }
  const first = root.children.find((c): c is XmlElement => typeof c !== 'string')
  if (!first) throw new Error('Not an XML document.')
  return first
}

function pushText(el: XmlElement, raw: string) {
  if (!raw) return
  el.children.push(decodeEntities(raw))
}

function canon(name: string, ns: Map<string, string>, isElement: boolean): string {
  const c = name.indexOf(':')
  const prefix = c < 0 ? '' : name.slice(0, c)
  const local = c < 0 ? name : name.slice(c + 1)
  if (prefix === 'xml') return name
  if (c < 0 && !isElement) return name // unprefixed attributes have no namespace
  const uri = ns.get(prefix)
  const p = uri ? CANONICAL[uri] : undefined
  if (p !== undefined) return `${p}:${local}`
  return name
}

// ------------------------------------------------------------------ queries

export const isEl = (n: XmlNode | undefined): n is XmlElement => !!n && typeof n !== 'string'

export function kids(el: XmlElement | undefined, name?: string): XmlElement[] {
  if (!el) return []
  const out: XmlElement[] = []
  for (const c of el.children) if (typeof c !== 'string' && (!name || c.name === name)) out.push(c)
  return out
}

export function kid(el: XmlElement | undefined, name: string): XmlElement | undefined {
  if (!el) return undefined
  for (const c of el.children) if (typeof c !== 'string' && c.name === name) return c
  return undefined
}

/** A descendant by path of names: path(el, 'w:body', 'w:sectPr'). */
export function path(el: XmlElement | undefined, ...names: string[]): XmlElement | undefined {
  let cur = el
  for (const n of names) cur = kid(cur, n)
  return cur
}

/** All descendants with this name (depth first, document order). */
export function findAll(el: XmlElement | undefined, name: string, out: XmlElement[] = []): XmlElement[] {
  if (!el) return out
  for (const c of el.children) {
    if (typeof c === 'string') continue
    if (c.name === name) out.push(c)
    findAll(c, name, out)
  }
  return out
}

export function textOf(el: XmlElement | undefined): string {
  if (!el) return ''
  let s = ''
  for (const c of el.children) s += typeof c === 'string' ? c : textOf(c)
  return s
}

/** w:val of a child, e.g. val(pPr, 'w:jc'). */
export function val(el: XmlElement | undefined, name: string, attr = 'w:val'): string | undefined {
  return kid(el, name)?.attrs[attr]
}

/** An on/off property (<w:b/>, <w:b w:val="0"/>): true, false, or undefined when absent. */
export function onOff(el: XmlElement | undefined, name: string): boolean | undefined {
  const k = kid(el, name)
  if (!k) return undefined
  const v = k.attrs['w:val']
  return !(v === '0' || v === 'false' || v === 'off' || v === 'none')
}

// ------------------------------------------------------------------ writing

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;')).replace(
    // Characters XML 1.0 does not allow.
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g,
    '',
  )
}

/** <name a="1" b="2"/> or <name …>inner</name>; undefined attributes are left out. */
export function tag(name: string, attrs: Record<string, string | number | undefined | null> = {}, inner?: string): string {
  let s = `<${name}`
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) s += ` ${k}="${esc(String(v))}"`
  return inner === undefined || inner === '' ? `${s}/>` : `${s}>${inner}</${name}>`
}

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
