// KherveTeX's AI tools (khervetex_get_document, _set_latex, _replace_blocks,
// _compile…): names, arguments and descriptions are in
// src/os/ai/appManifest.ts; KherveTeX.tsx registers these with useAppTools
// for its editor windows. The document work itself is aiDoc.ts; this file
// connects it to the open window (`TexAiHost`, given by KherveTeX.tsx).
//
// Every edit goes into the visual editor as one undo step, the Code tab and
// the PDF follow (the PDF recompiles when auto-compile is on), and nothing
// is saved until khervetex_save.

import { fs, path } from '@/os'
import { drivePath } from '@/os/ai/tools'
import { clipText, waitUntil, type AppTools } from '@/os/ai/appTools'
import type { LatexError } from '@/os/services/latex'
import type { Document } from './model'
import { modelLatex,
  blocksLatex, checkRange, describeDocument, documentFromLatex, insertIndex, parseBody, replaceText, setMetadata, spliceBlocks,
} from './aiDoc'

export interface TexCompileResult {
  ok: boolean | null
  errors: LatexError[]
  log: string
  pages?: number | null
}

export interface TexTemplate {
  name: string
  load(): Promise<Document>
}

/** What the tools need from the KherveTeX window. */
export interface TexAiHost {
  /** Still opening a file. */
  loading(): boolean
  /** The document as it is now (Code-tab edits read in). */
  current(): Document
  /** Show this document in the editor (one undo step) and recompile when auto-compile is on. */
  apply(doc: Document, what: string): void
  status(): { path: string | null; dirty: boolean; project: boolean; autoCompile: boolean; pdfShown: boolean }
  /** Compile now and wait for the result; with `showPdf`, open the PDF window when it is hidden. */
  compile(showPdf: boolean): Promise<TexCompileResult>
  /** The last result, or null (never compiled). */
  lastCompile(): TexCompileResult | null
  templates(): TexTemplate[]
  /** Start a new untitled document in this window (not undoable: the caller asks first). */
  replaceWithNew(doc: Document): Promise<void>
  /** Save in place, or to `path`; resolves to the path written, or null. */
  save(path: string | null): Promise<string | null>
}

const errorList = (errors: LatexError[]) => errors.slice(0, 12).map((e) => ({ ...(e.line && { line: e.line }), ...(e.file && { file: e.file }), message: e.message }))

const logTail = (log: string, lines = 40) => clipText(log.split('\n').slice(-lines).join('\n'), 4000)

export function khervetexAiTools(host: TexAiHost): AppTools {
  const ready = async (signal?: AbortSignal) => {
    if (!(await waitUntil(() => !host.loading(), 30_000, signal))) throw new Error('kTeX is still opening the document. Try again in a moment.')
  }

  /** Apply an edit and say what the user sees. */
  const edited = (doc: Document, what: string, extra: Record<string, unknown> = {}) => {
    host.apply(doc, what)
    const s = host.status()
    return {
      ...extra,
      blocks: doc.children.length,
      saved: false,
      shown: 'The change is in the kTeX editor (Ctrl+Z undoes it).',
      ...(s.autoCompile && s.pdfShown ? { pdf: 'Recompiling: call khervetex_compile to wait for it and check for errors.' } : { pdf: 'Call khervetex_compile to typeset it.' }),
    }
  }

  return {
    async get_document(a, ctx) {
      await ready(ctx.signal)
      const doc = host.current()
      const s = host.status()
      const last = host.lastCompile()
      return {
        path: s.path ? path.pretty(s.path) : null,
        unsaved_changes: s.dirty,
        ...(s.project && { note: 'A multi-chapter project: this is the chapter shown.' }),
        ...describeDocument(doc, { maxChars: typeof a.max_chars === 'number' ? a.max_chars : undefined, latex: a.latex !== false }),
        last_compile: last ? { ok: last.ok, errors: errorList(last.errors) } : null,
      }
    },

    async read_blocks(a, ctx) {
      await ready(ctx.signal)
      const doc = host.current()
      const [s, e] = checkRange(doc, a.start, a.end)
      return { blocks: blocksLatex(doc, s, e) }
    },

    async set_latex(a, ctx) {
      await ready(ctx.signal)
      const latex = modelLatex(a.latex)
      const doc = documentFromLatex(latex, host.current().meta)
      if (!doc.children.length) throw new Error('This LaTeX has no content (nothing between \\begin{document} and \\end{document}).')
      return edited(doc, 'Replace the document', { replaced: 'the whole document', documentclass: doc.meta.documentclass })
    },

    async insert_latex(a, ctx) {
      await ready(ctx.signal)
      const doc = host.current()
      const at = insertIndex(doc, a.after)
      const blocks = parseBody(modelLatex(a.latex), doc.meta)
      if (!blocks.length) throw new Error('The LaTeX has no content to insert.')
      return edited(spliceBlocks(doc, at, 0, blocks), 'Insert', { inserted: blocks.length, at_index: at })
    },

    async replace_blocks(a, ctx) {
      await ready(ctx.signal)
      const doc = host.current()
      const [s, e] = checkRange(doc, a.start, a.end)
      const blocks = parseBody(modelLatex(a.latex), doc.meta)
      return edited(spliceBlocks(doc, s, e - s + 1, blocks), 'Replace blocks', { removed: e - s + 1, inserted: blocks.length, at_index: s })
    },

    async delete_blocks(a, ctx) {
      await ready(ctx.signal)
      const doc = host.current()
      const [s, e] = checkRange(doc, a.start, a.end)
      return edited(spliceBlocks(doc, s, e - s + 1, []), 'Delete blocks', { removed: e - s + 1 })
    },

    async replace_text(a, ctx) {
      await ready(ctx.signal)
      const find = String(a.find ?? '')
      const r = replaceText(host.current(), find, String(a.replace ?? ''), { all: a.all !== false, caseSensitive: a.case_sensitive === true })
      if (!r.count) throw new Error(`"${clipText(find, 200)}" is not in the document's text (equations and raw LaTeX are not searched: use khervetex_replace_blocks).`)
      return edited(r.doc, 'Replace text', { replaced: r.count })
    },

    async set_metadata(a, ctx) {
      await ready(ctx.signal)
      const r = setMetadata(host.current(), {
        title: typeof a.title === 'string' ? a.title : undefined,
        author: typeof a.author === 'string' ? a.author : undefined,
        documentclass: typeof a.documentclass === 'string' ? a.documentclass : undefined,
        body_font_pt: typeof a.body_font_pt === 'number' ? a.body_font_pt : undefined,
        page_size: typeof a.page_size === 'string' ? a.page_size : undefined,
        add_packages: Array.isArray(a.add_packages) ? a.add_packages.map(String) : undefined,
      })
      if (!r.changed.length) throw new Error('Nothing to change: pass title, author, documentclass, body_font_pt, page_size or add_packages.')
      return edited(r.doc, 'Document settings', { changed: r.changed })
    },

    async new_document(a, ctx) {
      await ready(ctx.signal)
      const list = host.templates()
      const wanted = typeof a.template === 'string' ? a.template.trim().toLowerCase() : ''
      let doc: Document
      let from = 'a blank document'
      if (wanted && wanted !== 'blank') {
        const t = list.find((x) => x.name.toLowerCase() === wanted) ?? list.find((x) => x.name.toLowerCase().includes(wanted))
        if (!t) throw new Error(`No template "${a.template}". Templates: ${list.map((x) => x.name).join('; ')}.`)
        doc = await t.load()
        from = `the "${t.name}" template`
      } else {
        const blank = list.find((x) => x.name === 'Blank document')
        if (!blank) throw new Error('The blank document template is missing.')
        doc = await blank.load()
      }
      if (typeof a.title === 'string' && a.title.trim()) doc = setMetadata(doc, { title: a.title }).doc
      const s = host.status()
      if (s.dirty && !(await ctx.confirm('replace the unsaved kTeX document with a new one', 'Its unsaved changes will be lost (the file on the drive is kept).'))) {
        throw new Error('The user kept the current document. Save it first (khervetex_save), or edit it instead.')
      }
      await host.replaceWithNew(doc)
      return { started: from, untitled: true, blocks: doc.children.length, note: 'Save it with khervetex_save and a path.' }
    },

    async compile(a, ctx) {
      await ready(ctx.signal)
      let r: TexCompileResult
      try {
        r = await host.compile(a.show_pdf !== false)
      } catch (e) {
        throw new Error(`Could not compile: ${e instanceof Error ? e.message : String(e)} (LaTeX needs the KherveOS server).`)
      }
      return {
        ok: !!r.ok,
        ...(r.pages != null && { pages: r.pages }),
        errors: errorList(r.errors),
        ...(!r.ok && { log_tail: logTail(r.log) }),
        ...(!r.ok && r.errors[0]?.line && { hint: 'Error lines are lines of the LaTeX from khervetex_get_document.' }),
      }
    },

    async save(a, ctx) {
      await ready(ctx.signal)
      const given = typeof a.path === 'string' && a.path.trim() ? a.path.trim() : null
      const s = host.status()
      if (!given && !s.path) throw new Error('This document has never been saved: give "path", e.g. "~/Documents/report.ktex".')
      let p: string | null = null
      if (given) {
        if (/[\\/]\s*$/.test(given)) throw new Error(`"${given}" is a folder: add the file name.`)
        p = drivePath(given)
        if (!/\.(ktex|json)$/i.test(p)) p += '.ktex'
        if (fs.isDir(p)) throw new Error(`${path.pretty(p)} is a folder.`)
        if (p !== s.path && fs.exists(p) && !(await ctx.confirm(`replace ${path.pretty(p)}`, 'What is in it now will be lost.'))) {
          throw new Error(`The user did not allow replacing ${path.pretty(p)}.`)
        }
      }
      const written = await host.save(p)
      if (!written) throw new Error('The document was not saved.')
      return { saved: path.pretty(written) }
    },
  }
}
