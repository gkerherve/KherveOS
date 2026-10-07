// Multi-document projects, as the desktop keeps them (project_store.py,
// mainwindow.py): a folder of .ktex files, the first of which also holds
// project.json — the list of documents, their order, which ones compile, and
// their page numbering. Compiling writes a master .tex that \includes each
// enabled document (serializer.serializeProjectMaster).

import { fs, path } from '@/os'
import { fromJson, projectFromJson, projectToJson, section, text, toJson, type Document, type Project } from './model'
import { chapterStem, pageMark, serializeChapterBody, serializeProjectMaster } from './serializer'
import { docStem, figureFiles, isBundlePath, readBundle, writeBundle, type Bundle } from './ktex'

/** _safe_name: a file name from a label. */
export function safeName(label: string): string {
  const s = [...label].map((c) => (/[\p{L}\p{N}]/u.test(c) || ' _-'.includes(c) ? c : '_')).join('')
  return s.trim().replace(/ /g, '_') || 'document'
}

/** project_store.unique_path */
export function uniquePath(dir: string, stem: string, suffix = '.ktex'): string {
  let dest = path.join(dir, `${stem}${suffix}`)
  let n = 1
  while (fs.exists(dest)) {
    dest = path.join(dir, `${stem}_${n}${suffix}`)
    n += 1
  }
  return dest
}

export async function readDoc(p: string): Promise<Bundle> {
  if (isBundlePath(p)) return readBundle(await fs.readBytes(p))
  return { doc: fromJson(await fs.readText(p)), files: new Map(), bib: '', project: null }
}

export async function writeDoc(p: string, b: Bundle): Promise<void> {
  if (isBundlePath(p)) await fs.writeBytes(p, writeBundle(b))
  else await fs.writeText(p, toJson(b.doc))
}

/** The project a .ktex holds, or null. */
export async function readProject(p: string): Promise<Project | null> {
  if (!isBundlePath(p) || !fs.isFile(p)) return null
  const b = readBundle(await fs.readBytes(p))
  return b.project ? projectFromJson(b.project) : null
}

/** kdocz.write_project_json: store the project in the main .ktex, keeping everything else. */
export async function writeProjectJson(mainPath: string, proj: Project): Promise<void> {
  const b = readBundle(await fs.readBytes(mainPath))
  await fs.writeBytes(mainPath, writeBundle({ ...b, project: projectToJson(proj) }))
}

/** A new document for a project: a heading with its name, in the project's settings. */
export function chapterDocument(label: string, proj: Project): Document {
  return { type: 'Document', children: [section(1, [text(label)])], meta: { ...proj.meta, packages: [...proj.meta.packages] } }
}

/** The LaTeX and files to compile the whole project. */
export function projectSources(proj: Project, docs: Map<number, Bundle>, withImages: boolean): { tex: string; files: Record<string, string | Uint8Array> } {
  const files: Record<string, string | Uint8Array> = {}
  const chapterDocs: Document[] = []
  proj.chapters.forEach((ch, i) => {
    const b = docs.get(i)
    if (!b) return
    const stem = chapterStem(ch)
    // Each document's pictures go in their own folder: two documents both have a figures/figure_001.png.
    const doc: Document = {
      ...b.doc,
      children: b.doc.children.map((blk) => (blk.type === 'Figure' && b.files.has(blk.path) ? { ...blk, path: `${stem}/${blk.path}` } : blk)),
    }
    if (withImages) for (const [p, data] of figureFiles(b.doc, b.files)) files[`${stem}/${p}`] = data
    files[`${stem}.tex`] = pageMark(i) + serializeChapterBody(doc)
    chapterDocs.push(b.doc)
  })
  const tex = serializeProjectMaster(proj, chapterDocs)
  files['document.tex'] = tex
  return { tex, files }
}

/** _page_counts_from_log: each document's page count from the KDOC marks in the log. */
export function pageCountsFromLog(proj: Project, log: string, totalPages: number): boolean {
  const found = new Map<number, [number, string, number]>()
  for (const m of log.matchAll(/KDOC:(\d+):([^:\s]*):(\d+)/g)) found.set(Number(m[1]), [Number(m[1]), m[2], Number(m[3])])
  const marks = [...found.values()].sort((a, b) => a[2] - b[2]).filter((m) => m[0] < proj.chapters.length)
  if (!marks.length) return false
  marks.forEach(([i, , shipped], k) => {
    const end = k + 1 < marks.length ? marks[k + 1][2] : totalPages
    proj.chapters[i].last_known_pages = Math.max(1, end - shipped)
  })
  recomputeAutoPages(proj)
  return true
}

/** _ProjectSidebar.recompute_auto_pages */
export function recomputeAutoPages(proj: Project) {
  if (!proj.auto_page_numbers) return
  let running = 0
  let prev: string | null = null
  for (const ch of proj.chapters) {
    if (ch.numbering !== prev) {
      ch.start_page = 1
      running = 0
      prev = ch.numbering
    } else ch.start_page = running + 1
    running += ch.last_known_pages > 0 ? ch.last_known_pages : 1
  }
}

function roman(n: number): string {
  const vals: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
  let out = ''
  for (const [v, s] of vals) while (n >= v) {
    out += s
    n -= v
  }
  return out
}

/** _ProjectSidebar._rebuild_list: each row's prefix and page range, and the summary. */
export function projectRows(proj: Project) {
  let total = 0
  let compiling = 0
  let chN = 0
  let appN = 0
  const rows = proj.chapters.map((ch) => {
    let pages = ''
    if (ch.last_known_pages > 0) {
      if (ch.start_page !== null) {
        const start = ch.start_page
        const end = start + ch.last_known_pages - 1
        const fmt = ch.numbering === 'roman' ? `${roman(start)}–${roman(end)}` : `${start}–${end}`
        pages = `  pp. ${fmt}  (${ch.last_known_pages}p)`
      } else pages = `  (${ch.last_known_pages}p)`
    }
    total += ch.last_known_pages
    if (ch.enabled) compiling += ch.last_known_pages
    let prefix = ''
    if (ch.chapter_type === 'chapter') {
      chN += 1
      prefix = `Ch. ${ch.chapter_number ?? chN} — `
    } else if (ch.chapter_type === 'appendix') {
      appN += 1
      prefix = `App. ${String.fromCharCode(64 + (ch.chapter_number ?? appN))} — `
    } else if (ch.chapter_type === 'frontmatter') prefix = '◇ '
    else if (ch.chapter_type === 'backmatter') prefix = '○ '
    return { label: ch.label || docStem(path.basename(ch.path)), enabled: ch.enabled, prefix, pages }
  })
  let summary = `Total: ~${total}p`
  if (compiling !== total) summary += `  ·  Compiling: ~${compiling}p`
  return { rows, summary }
}
