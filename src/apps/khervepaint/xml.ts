// A small XML reader and writer shaped like Python's ElementTree, which the
// desktop's svgio.py uses: tags and attributes carry their namespace as
// "{uri}local", text sits on `text` and `tail`, and the writer prints the
// same bytes ET does (namespace declarations sorted by prefix, " />").

export interface XmlEl {
  tag: string
  attrs: Record<string, string>
  children: XmlEl[]
  text: string
  tail: string
}

export const el = (tag: string, attrs: Record<string, string> = {}): XmlEl => ({ tag, attrs, children: [], text: '', tail: '' })

export const localName = (tag: string) => tag.slice(tag.lastIndexOf('}') + 1)

export function* iter(e: XmlEl): Generator<XmlEl> {
  yield e
  for (const c of e.children) yield* iter(c)
}

/** All text inside the element, like ET's itertext(). */
export function itertext(e: XmlEl): string {
  let s = e.text
  for (const c of e.children) s += itertext(c) + c.tail
  return s
}

// ---------------------------------------------------------------- reading

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function decode(s: string, extra?: Record<string, string>): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z_][\w.-]*);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e] ?? extra?.[e] ?? m
  })
}

/** Parse an XML document; throws on malformed input. */
export function parseXml(src: string): XmlEl {
  let i = 0
  const n = src.length
  const entities: Record<string, string> = {}
  const fail = (msg: string): never => {
    throw new Error(`Invalid SVG: ${msg} (at character ${i})`)
  }
  type Raw = { name: string; attrs: [string, string][]; children: Raw[]; text: string; tail: string }
  const root: Raw = { name: '#doc', attrs: [], children: [], text: '', tail: '' }
  const stack: Raw[] = [root]
  const top = () => stack[stack.length - 1]
  const addText = (t: string) => {
    if (!t) return
    const parent = top()
    if (parent.children.length) parent.children[parent.children.length - 1].tail += t
    else parent.text += t
  }
  if (src.charCodeAt(0) === 0xfeff) i = 1
  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt < 0) {
      addText(decode(src.slice(i), entities))
      break
    }
    if (lt > i) addText(decode(src.slice(i, lt), entities))
    i = lt
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4)
      if (end < 0) fail('unclosed comment')
      i = end + 3
    } else if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9)
      if (end < 0) fail('unclosed CDATA')
      addText(src.slice(i + 9, end))
      i = end + 3
    } else if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2)
      if (end < 0) fail('unclosed processing instruction')
      i = end + 2
    } else if (src.startsWith('<!', i)) {
      // DOCTYPE, possibly with an internal subset declaring entities.
      let depth = 0
      let j = i + 2
      for (; j < n; j++) {
        const ch = src[j]
        if (ch === '[') depth++
        else if (ch === ']') depth--
        else if (ch === '>' && depth <= 0) break
      }
      const decl = src.slice(i, j)
      for (const m of decl.matchAll(/<!ENTITY\s+([\w.-]+)\s+(["'])([\s\S]*?)\2\s*>/g)) entities[m[1]] = m[3]
      i = j + 1
    } else if (src[i + 1] === '/') {
      const end = src.indexOf('>', i)
      if (end < 0) fail('unclosed end tag')
      const name = src.slice(i + 2, end).trim()
      const open = stack.pop()
      if (!open || open === root || open.name !== name) fail(`mismatched </${name}>`)
      i = end + 1
    } else {
      i++
      const m = /^[^\s/>]+/.exec(src.slice(i, i + 256))
      if (!m) fail('bad tag')
      const name = m![0]
      i += name.length
      const attrs: [string, string][] = []
      let selfClose = false
      for (;;) {
        while (i < n && /\s/.test(src[i])) i++
        if (src[i] === '/' && src[i + 1] === '>') {
          selfClose = true
          i += 2
          break
        }
        if (src[i] === '>') {
          i++
          break
        }
        if (i >= n) fail('unclosed tag')
        const am = /^([^\s=/>]+)\s*=\s*/.exec(src.slice(i, i + 512))
        if (!am) fail('bad attribute')
        i += am![0].length
        const q = src[i]
        if (q !== '"' && q !== "'") fail('unquoted attribute')
        const end = src.indexOf(q, i + 1)
        if (end < 0) fail('unclosed attribute value')
        // Literal whitespace normalises to spaces; &#10; stays a newline.
        attrs.push([am![1], decode(src.slice(i + 1, end).replace(/\r\n|[\t\n\r]/g, ' '), entities)])
        i = end + 1
      }
      const node: Raw = { name, attrs, children: [], text: '', tail: '' }
      top().children.push(node)
      if (!selfClose) stack.push(node)
    }
  }
  if (stack.length > 1) fail(`unclosed <${top().name}>`)
  const first = root.children[0]
  if (!first) fail('no root element')

  // Resolve namespaces the ElementTree way.
  const resolve = (raw: Raw, scope: Record<string, string>): XmlEl => {
    let ns = scope
    for (const [k, v] of raw.attrs) {
      if (k === 'xmlns' || k.startsWith('xmlns:')) {
        if (ns === scope) ns = { ...scope }
        ns[k === 'xmlns' ? '' : k.slice(6)] = v
      }
    }
    const qname = (name: string, isAttr: boolean) => {
      const c = name.indexOf(':')
      if (c < 0) return isAttr || !ns[''] ? name : `{${ns['']}}${name}`
      const prefix = name.slice(0, c)
      if (prefix === 'xml') return `{http://www.w3.org/XML/1998/namespace}${name.slice(c + 1)}`
      const uri = ns[prefix]
      return uri ? `{${uri}}${name.slice(c + 1)}` : name
    }
    const attrs: Record<string, string> = {}
    for (const [k, v] of raw.attrs) if (k !== 'xmlns' && !k.startsWith('xmlns:')) attrs[qname(k, true)] = v
    return { tag: qname(raw.name, false), attrs, children: raw.children.map((c) => resolve(c, ns)), text: raw.text, tail: raw.tail }
  }
  return resolve(first!, {})
}

// ---------------------------------------------------------------- writing

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escAttr = (s: string) =>
  escText(s).replace(/"/g, '&quot;').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;').replace(/\t/g, '&#09;')

/** Serialise like ET.ElementTree(root).write(..., xml_declaration=True, encoding="utf-8"). */
export function writeXml(root: XmlEl, prefixes: Record<string, string>): string {
  const used = new Map<string, string>()
  const name = (q: string) => {
    if (!q.startsWith('{')) return q
    const close = q.indexOf('}')
    const uri = q.slice(1, close)
    const prefix = prefixes[uri]
    if (prefix === undefined) throw new Error(`no prefix for namespace ${uri}`)
    used.set(uri, prefix)
    return prefix ? `${prefix}:${q.slice(close + 1)}` : q.slice(close + 1)
  }
  const out: string[] = []
  const write = (e: XmlEl, isRoot: boolean) => {
    const tag = name(e.tag)
    const attrs = Object.entries(e.attrs).map(([k, v]) => ` ${name(k)}="${escAttr(v)}"`)
    out.push(`<${tag}`)
    const at = out.length
    out.push(...attrs)
    if (e.text || e.children.length) {
      out.push('>')
      if (e.text) out.push(escText(e.text))
      for (const c of e.children) write(c, false)
      out.push(`</${tag}>`)
    } else out.push(' />')
    if (e.tail) out.push(escText(e.tail))
    if (isRoot) {
      // Every namespace in the tree is declared on the root, sorted by prefix.
      const decls = [...used.entries()]
        .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
        .map(([uri, p]) => ` xmlns${p ? ':' + p : ''}="${escAttr(uri)}"`)
      out.splice(at, 0, ...decls)
    }
  }
  write(root, true)
  return `<?xml version='1.0' encoding='utf-8'?>\n${out.join('')}`
}
