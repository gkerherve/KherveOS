// The JSON documents inside the desktop's Note, File, KFit, KherveTeX and
// Molecule cells (notecell.py, filecell.py, kfitcell.py, ktexcell.py,
// molcell.py): reading them, writing them back the way Python's json.dumps
// does (so a round trip through the web edition leaves the .kbook as the
// desktop wrote it), and the File cell's helpers (sizes, previews, the
// sidecar "<stem>_files" folder). No browser or KherveOS imports: the
// tests run this file in Node.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
type Obj = { [k: string]: Json }

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** Python's json.dumps(obj) (ensure_ascii, ", " and ": " separators); `indent` like json.dumps(indent=n). */
export function pyDumps(v: Json | undefined, indent?: number, level = 0): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity'
    // Python writes floats with a decimal point; JSON numbers read from a file keep their value.
    return String(v)
  }
  if (typeof v === 'string') {
    let out = '"'
    for (const ch of v) {
      const c = ch.codePointAt(0) ?? 0
      if (ch === '"') out += '\\"'
      else if (ch === '\\') out += '\\\\'
      else if (ch === '\n') out += '\\n'
      else if (ch === '\r') out += '\\r'
      else if (ch === '\t') out += '\\t'
      else if (ch === '\b') out += '\\b'
      else if (ch === '\f') out += '\\f'
      else if (c < 0x20 || c > 0x7e) {
        if (c > 0xffff) {
          const s = c - 0x10000
          out += '\\u' + (0xd800 + (s >> 10)).toString(16).padStart(4, '0') + '\\u' + (0xdc00 + (s & 0x3ff)).toString(16).padStart(4, '0')
        } else out += '\\u' + c.toString(16).padStart(4, '0')
      } else out += ch
    }
    return out + '"'
  }
  const nl = indent !== undefined ? '\n' + ' '.repeat(indent * (level + 1)) : ''
  const end = indent !== undefined ? '\n' + ' '.repeat(indent * level) : ''
  const sep = indent !== undefined ? ',' : ', '
  if (Array.isArray(v)) {
    if (!v.length) return '[]'
    return '[' + nl + v.map((x) => pyDumps(x, indent, level + 1)).join(sep + nl) + end + ']'
  }
  const keys = Object.keys(v).filter((k) => v[k] !== undefined)
  if (!keys.length) return '{}'
  return '{' + nl + keys.map((k) => `${pyDumps(k)}: ${pyDumps(v[k], indent, level + 1)}`).join(sep + nl) + end + '}'
}

export function parseJsonObject(src: string): Obj | null {
  const t = (src ?? '').trim()
  if (!t.startsWith('{')) return null
  try {
    const v = JSON.parse(t) as unknown
    return isObj(v) ? v : null
  } catch {
    return null
  }
}

// ------------------------------------------------------------ attachments

/** One held file (desktop _Attachment.to_dict): bytes in the sidecar folder (`path`) or, until the notebook is saved, base64 (`embed`). */
export interface Attachment {
  name: string
  size: number
  path?: string
  embed?: string
}

export function attachmentFrom(d: unknown): Attachment | null {
  if (!isObj(d) || typeof d.name !== 'string' || !d.name) return null
  const a: Attachment = { name: d.name, size: typeof d.size === 'number' ? Math.round(d.size) : 0 }
  if (typeof d.path === 'string' && d.path) a.path = d.path
  if (typeof d.embed === 'string') {
    a.embed = d.embed
    if (!a.size) a.size = base64Length(d.embed)
  }
  return a
}

export function attachmentJson(a: Attachment): Obj {
  const d: Obj = { name: a.name, size: a.size }
  if (a.path) d.path = a.path
  else if (a.embed !== undefined) d.embed = a.embed
  return d
}

function base64Length(b64: string): number {
  const s = b64.replace(/\s+/g, '')
  return Math.floor((s.length * 3) / 4) - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0)
}

/** A File cell's attachments (the multi-file format, or the legacy single file). */
export function parseFiles(src: string): Attachment[] {
  const d = parseJsonObject(src)
  if (!d) return []
  if (Array.isArray(d.files)) return d.files.map(attachmentFrom).filter((a): a is Attachment => !!a)
  const one = attachmentFrom(d)
  return one ? [one] : []
}

export function filesSource(files: Attachment[]): string {
  return pyDumps({ kbook_files: 1, files: files.map(attachmentJson) })
}

/** desktop _human_size */
export function humanSize(n: number): string {
  let size = n
  for (const unit of ['B', 'KB', 'MB', 'GB']) {
    if (size < 1024 || unit === 'GB') return unit === 'B' ? `${Math.round(size)} ${unit}` : `${size.toFixed(1)} ${unit}`
    size /= 1024
  }
  return `${size.toFixed(1)} GB`
}

/** The sidecar path a file takes (desktop _Attachment._claim): "<stem>_files/<name>", "-2", "-3"… when taken. */
export function claimPath(stem: string, name: string, claimed: Set<string>): string {
  const folder = `${stem}_files`
  let rel = `${folder}/${name}`
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let n = 2
  while (claimed.has(rel)) {
    rel = `${folder}/${base}-${n}${ext}`
    n++
  }
  claimed.add(rel)
  return rel
}

export const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp'])
const TEXT_EXT = new Set([
  '.txt', '.csv', '.tsv', '.py', '.js', '.md', '.json', '.dat', '.log', '.xml', '.yaml', '.yml', '.ini', '.cfg', '.tex', '.html', '.css', '.c',
  '.cpp', '.h', '.r', '.m', '.sh',
])

/** extension -> the file chip's icon (desktop filecell._ICONS). */
export const FILE_ICONS: Record<string, string> = {
  '.csv': 'mdi.file-delimited-outline', '.tsv': 'mdi.file-delimited-outline', '.xlsx': 'mdi.file-excel-outline', '.xls': 'mdi.file-excel-outline',
  '.json': 'mdi.code-json', '.py': 'mdi.language-python', '.js': 'mdi.language-javascript', '.txt': 'mdi.file-document-outline',
  '.md': 'mdi.language-markdown', '.pdf': 'mdi.file-pdf-box', '.png': 'mdi.file-image-outline', '.jpg': 'mdi.file-image-outline',
  '.jpeg': 'mdi.file-image-outline', '.gif': 'mdi.file-image-outline', '.bmp': 'mdi.file-image-outline', '.svg': 'mdi.file-image-outline',
  '.zip': 'mdi.folder-zip-outline', '.h5': 'mdi.database-outline', '.npy': 'mdi.database-outline', '.dat': 'mdi.file-table-outline',
}

export function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

function isPrintable(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  if (ch === '\r' || ch === '\n' || ch === '\t') return true
  // Python's str.isprintable: no control characters (Cc), separators other than space, or unassigned.
  return !(c < 0x20 || (c >= 0x7f && c < 0xa0) || c === 0x2028 || c === 0x2029 || c === 0xfffd)
}

/** desktop FileCell._as_text: the bytes as text when they look textual, else null. */
export function asText(data: Uint8Array, ext: string): string | null {
  const known = TEXT_EXT.has(ext)
  if (!known && data.subarray(0, 4096).includes(0)) return null
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    if (!known) return null
    text = new TextDecoder('latin1').decode(data)
  }
  if (!known) {
    const sample = [...text.slice(0, 2000)]
    const printable = sample.filter(isPrintable).length
    if (sample.length && printable / sample.length < 0.85) return null
  }
  return text
}

/** desktop FileCell._snippet: the first 6 lines, at most 500 characters. */
export function snippet(text: string): string {
  const lines = text.split(/\r\n|\r|\n/).slice(0, 6)
  let s = lines.join('\n').slice(0, 500)
  if (text.length > s.length) s += '\n…'
  return s
}

/** kf("name") as the desktop's Copy kf() reference writes it (json.dumps of the name). */
export const kfReference = (name: string) => `kf(${pyDumps(name)})`

// ------------------------------------------------------------------ notes

/** A Note cell's pen strokes (desktop _InkOverlay.to_dict): points in the space of width `ref_w`. */
export interface Ink {
  ref_w: number
  strokes: { color: string; width: number; pts: [number, number][] }[]
}

export interface NoteDoc {
  html: string
  ink: Ink | null
}

/** desktop notecell.NOTE_STARTER */
export const NOTE_STARTER = pyDumps({
  kbook_note: 1,
  html: '<h2>Notes</h2><p>Type here like in a word processor — use the toolbar to format text, or the pen to annotate.</p>',
  ink: null,
})

function inkFrom(v: unknown): Ink | null {
  if (!isObj(v)) return null
  const strokes = (Array.isArray(v.strokes) ? v.strokes : []).filter(isObj).map((s) => ({
    color: typeof s.color === 'string' ? s.color : '#c0392b',
    width: typeof s.width === 'number' ? s.width : 3,
    pts: (Array.isArray(s.pts) ? s.pts : [])
      .filter((p): p is Json[] => Array.isArray(p) && p.length >= 2)
      .map((p) => [Number(p[0]), Number(p[1])] as [number, number]),
  }))
  return strokes.length ? { ref_w: typeof v.ref_w === 'number' ? v.ref_w : 0, strokes } : null
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** desktop NoteCell.set_source: the JSON document, raw HTML, or plain text. */
export function parseNote(src: string): NoteDoc {
  const d = parseJsonObject(src)
  if (d && ('kbook_note' in d || 'html' in d)) return { html: typeof d.html === 'string' ? d.html : '', ink: inkFrom(d.ink) }
  const t = src ?? ''
  if (t.includes('<') && t.includes('>')) return { html: t, ink: null }
  return { html: t ? `<p>${escapeHtml(t).replace(/\n/g, '<br>')}</p>` : '', ink: null }
}

export function noteSource(doc: NoteDoc): string {
  const ink: Json = doc.ink && doc.ink.strokes.length ? { ref_w: doc.ink.ref_w, strokes: doc.ink.strokes.map((s) => ({ color: s.color, width: s.width, pts: s.pts })) } : null
  return pyDumps({ kbook_note: 1, html: doc.html, ink })
}

/** The body of the HTML a Qt QTextEdit saves (a whole document with a <style> head), for display. */
export function noteBody(html: string): string {
  const m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)
  return m ? m[1] : html
}

/** The <body style="…"> Qt writes (font family / size of the page), if any. */
export function noteBodyStyle(html: string): string {
  const m = /<body[^>]*\sstyle\s*=\s*"([^"]*)"/i.exec(html)
  return m ? m[1] : ''
}

/** Plain text of a note (for summaries and the AI). */
export function noteText(src: string): string {
  return noteBody(parseNote(src).html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

// --------------------------------------------- KFit / KherveTeX / Molecule

/** A KFit cell (desktop kfitcell.source): the .kfit, the sheet shown, Plot or Data, where it came from. */
export interface KfitDoc {
  file: Attachment | null
  sheet: string
  view: 'plot' | 'data'
  origin: string
}

export function parseKfit(src: string): KfitDoc {
  const d = parseJsonObject(src) ?? {}
  return {
    file: attachmentFrom(d.file),
    sheet: typeof d.sheet === 'string' ? d.sheet : '',
    view: d.view === 'data' ? 'data' : 'plot',
    origin: typeof d.origin === 'string' ? d.origin : '',
  }
}

export function kfitSource(k: KfitDoc): string {
  const d: Obj = { kbook_kfit: 1, sheet: k.sheet, view: k.view }
  if (k.file) d.file = attachmentJson(k.file)
  if (k.origin) d.origin = k.origin
  return pyDumps(d)
}

/** A KherveTeX document cell (desktop ktexcell.source). */
export interface KtexDoc {
  file: Attachment | null
  origin: string
  page: number
}

export function parseKtex(src: string): KtexDoc {
  const d = parseJsonObject(src) ?? {}
  return { file: attachmentFrom(d.file), origin: typeof d.origin === 'string' ? d.origin : '', page: typeof d.page === 'number' ? Math.max(0, Math.round(d.page)) : 0 }
}

export function ktexSource(k: KtexDoc): string {
  const d: Obj = { kbook_ktex: 1, page: k.page }
  if (k.file) d.file = attachmentJson(k.file)
  if (k.origin) d.origin = k.origin
  return pyDumps(d)
}

/** A Molecule cell (desktop molcell.source): KherveMol's .kmol document, kept verbatim, the view and the last query. */
export interface MolDoc {
  kmol: Obj
  view: '3d' | '2d'
  query: string
}

export function parseMol(src: string): MolDoc {
  const d = parseJsonObject(src) ?? {}
  const kmol = 'kbook_mol' in d ? d.kmol : d
  return { kmol: isObj(kmol) ? kmol : {}, view: d.view === '2d' ? '2d' : '3d', query: typeof d.query === 'string' ? d.query : '' }
}

export function molSource(m: MolDoc): string {
  return pyDumps({ kbook_mol: 1, kmol: m.kmol, view: m.view, query: m.query })
}

export type MolAtom = { el: string; x: number; y: number; z: number }

/** The 3D molecule of a .kmol: atoms [el, x, y, z(, label)] and bonds [i, j, order]. */
export function molAtoms(kmol: Obj): { name: string; atoms: MolAtom[]; bonds: [number, number, number][] } {
  const m = isObj(kmol.mol3d) ? kmol.mol3d : {}
  const atoms = (Array.isArray(m.atoms) ? m.atoms : [])
    .filter((a): a is Json[] => Array.isArray(a) && a.length >= 4)
    .map((a) => ({ el: String(a[0]), x: Number(a[1]), y: Number(a[2]), z: Number(a[3]) }))
  const bonds = (Array.isArray(m.bonds) ? m.bonds : [])
    .filter((b): b is Json[] => Array.isArray(b) && b.length >= 2)
    .map((b) => [Number(b[0]), Number(b[1]), Number(b[2] ?? 1)] as [number, number, number])
    .filter(([i, j]) => i >= 0 && j >= 0 && i < atoms.length && j < atoms.length)
  const name = String(m.label || m.name || '')
  return { name, atoms, bonds }
}

/** The 2D sketch of a .kmol: atoms [el, x, y], bonds [i, j, order]. */
export function molSketch(kmol: Obj): { atoms: { el: string; x: number; y: number }[]; bonds: [number, number, number][] } {
  const s = isObj(kmol.sketch2d) ? kmol.sketch2d : {}
  const atoms = (Array.isArray(s.atoms) ? s.atoms : [])
    .filter((a): a is Json[] => Array.isArray(a) && a.length >= 3)
    .map((a) => ({ el: String(a[0]), x: Number(a[1]), y: Number(a[2]) }))
  const bonds = (Array.isArray(s.bonds) ? s.bonds : [])
    .filter((b): b is Json[] => Array.isArray(b) && b.length >= 2)
    .map((b) => [Number(b[0]), Number(b[1]), Number(b[2] ?? 1)] as [number, number, number])
    .filter(([i, j]) => i < atoms.length && j < atoms.length)
  return { atoms, bonds }
}

/** Hill-style formula with C and H first (desktop ipynb._mol_markdown order). */
export function molFormula(atoms: { el: string }[]): string {
  const counts = new Map<string, number>()
  for (const a of atoms) counts.set(a.el, (counts.get(a.el) ?? 0) + 1)
  const order = [...counts.keys()].sort((a, b) => {
    const ka = [a !== 'C' ? 1 : 0, a !== 'H' ? 1 : 0]
    const kb = [b !== 'C' ? 1 : 0, b !== 'H' ? 1 : 0]
    return ka[0] - kb[0] || ka[1] - kb[1] || (a < b ? -1 : a > b ? 1 : 0)
  })
  return order.map((e) => e + ((counts.get(e) ?? 0) > 1 ? String(counts.get(e)) : '')).join('')
}

/** desktop molcell._subscript */
export const subscriptDigits = (f: string) => f.replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)])

// ------------------------------------------------------------ base64

export function bytesToB64(bytes: Uint8Array): string {
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH))
  return btoa(s)
}

export function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64.replace(/\s+/g, ''))
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** The attachments a cell holds (File: many; KFit / KherveTeX: one). */
export function cellAttachments(type: string, src: string): Attachment[] {
  if (type === 'file') return parseFiles(src)
  if (type === 'kfit') {
    const f = parseKfit(src).file
    return f ? [f] : []
  }
  if (type === 'ktex') {
    const f = parseKtex(src).file
    return f ? [f] : []
  }
  return []
}

/** The same cell source with its attachments replaced (same order as cellAttachments). */
export function withAttachments(type: string, src: string, files: Attachment[]): string {
  if (type === 'file') return filesSource(files)
  if (type === 'kfit') return kfitSource({ ...parseKfit(src), file: files[0] ?? null })
  if (type === 'ktex') return ktexSource({ ...parseKtex(src), file: files[0] ?? null })
  return src
}

// ------------------------------------------------------- kf() / kfit()

/** Python that (re)defines kf() and kfit() in the notebook's namespace. */
export function kfCode(files: Record<string, string>, dir: string | null, kfits: { path: string | null; name: string; title: string }[]): string {
  const lines = [
    `def kf(name=None, _files=${JSON.stringify(files)}, _dir=${dir ? JSON.stringify(dir) : 'None'}):`,
    '    """kf("data.csv") -> the path of a file attached in a File cell; kf() -> the notebook\'s folder."""',
    '    import os',
    '    if name is None:',
    '        return _dir or os.getcwd()',
    '    path = _files.get(str(name))',
    '    if path is None:',
    '        raise FileNotFoundError(f"no attached file named {name!r} (check the File cell\'s name)")',
    '    return path',
  ]
  if (kfits.length) {
    lines.push(`kfit = __import__('kbook_kfit.view', fromlist=['view']).make_kfit(__import__('json').loads(${JSON.stringify(JSON.stringify(kfits))}))`)
  } else {
    lines.push(
      'def kfit(sheet=None, cell=1):',
      '    """kfit("C1s") -> a sheet of a KFit cell\'s KherveFitting project; kfit() -> the project."""',
      '    raise NameError("no KherveFitting project yet — add a KFit cell and load a .kfit into it" if not isinstance(cell, str) else f"no KFit cell matching {cell!r}")',
    )
  }
  return lines.join('\n')
}

