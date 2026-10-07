// KherveTeX's AI tools, the part without the editor (src/apps/khervetex/aiDoc.ts):
// reading the outline and blocks, replacing the whole document from LaTeX
// (the round trip the Code tab does), inserting / replacing blocks, find and
// replace, title and settings.
// Run:  node --test tools/tests/khervetex-ai.test.ts   (Node ≥ 23 runs TypeScript directly.)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// The KherveTeX modules import each other without ".ts" (Vite resolves it): teach Node the same.
register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context) } catch (e) {
    if (/^\\.{1,2}\\//.test(specifier) && !/\\.[a-z]+$/i.test(specifier)) return next(specifier + '.ts', context)
    throw e
  }
}`),
)

const ai = await import('../../src/apps/khervetex/aiDoc.ts')
const { blankDocument, plainText } = await import('../../src/apps/khervetex/model.ts')
const { serializeDocument } = await import('../../src/apps/khervetex/serializer.ts')

const FULL = String.raw`\documentclass[11pt]{article}
\usepackage{amsmath}
\usepackage{graphicx}
\title{Thin Films of TiO$_2$}
\author{Ada Lovelace \\ Charles Babbage}
\begin{document}
\maketitle
\section{Introduction}
Titanium dioxide is \textbf{widely} studied.
\section{Methods}
We measured XPS spectra.
\begin{itemize}
  \item C 1s
  \item O 1s
\end{itemize}
\begin{equation}
E = h\nu - E_k
\end{equation}
\end{document}
`

test('a whole .tex document replaces the document, settings included', () => {
  const doc = ai.documentFromLatex(FULL, blankDocument().meta)
  assert.equal(doc.meta.documentclass, 'article')
  assert.equal(doc.meta.body_font_pt, 11)
  const types = doc.children.map((b: { type: string }) => b.type)
  assert.deepEqual(types.slice(0, 3), ['Title', 'Author', 'Author'])
  assert.ok(types.includes('Section') && types.includes('List') && types.includes('MathBlock'))
  const title = doc.children[0]
  assert.equal(plainText(title.children), 'Thin Films of TiO$_2$')
  // The LaTeX that comes out reads back to the same document (the Code tab's round trip).
  const tex = serializeDocument(doc)
  assert.match(tex, /\\section\{Introduction\}/)
  assert.match(tex, /\\textbf\{widely\}/)
  const again = ai.documentFromLatex(tex, doc.meta)
  assert.deepEqual(again.children, doc.children)
  assert.equal(serializeDocument(again), tex)
})

test('body LaTeX alone keeps the settings; \\title and \\author become the title lines', () => {
  const start = blankDocument()
  const doc = ai.documentFromLatex('\\title{Report}\n\\author{Me}\n\\maketitle\n\\section{Aim}\nTo test.\n', start.meta)
  assert.deepEqual(doc.meta, start.meta)
  assert.deepEqual(doc.children.map((b: { type: string }) => b.type), ['Title', 'Author', 'Section', 'Paragraph'])
  assert.equal(plainText(doc.children[0].children), 'Report')
  assert.throws(() => ai.documentFromLatex('  ', start.meta), /empty/)
})

test('outline, blocks and the document as the model reads it', () => {
  const doc = ai.documentFromLatex(FULL, blankDocument().meta)
  const out = ai.outline(doc)
  assert.equal(out.length, doc.children.length)
  const intro = out.find((e: { text: string }) => e.text === 'Introduction')
  assert.ok(intro && intro.type === 'Section' && intro.level === 1)
  const blocks = ai.blocksLatex(doc, 0, 1)
  assert.match(blocks[0].latex, /^\\title\{Thin Films/)
  assert.match(blocks[1].latex, /^\\author\{Ada Lovelace\}/)
  const d = ai.describeDocument(doc, { maxChars: 50 })
  assert.equal(d.title, 'Thin Films of TiO$_2$')
  assert.equal(d.author, 'Ada Lovelace; Charles Babbage')
  assert.match(String(d.latex), /more characters/)
  assert.throws(() => ai.checkRange(doc, 0, 99), /not in the document/)
  assert.deepEqual(ai.checkRange(doc, 2, undefined), [2, 2])
})

test('insert and replace blocks from body LaTeX', () => {
  const doc = ai.documentFromLatex(FULL, blankDocument().meta)
  const n = doc.children.length
  const added = ai.parseBody('\\section{Results}\nThe films are anatase.\n', doc.meta)
  assert.deepEqual(added.map((b: { type: string }) => b.type), ['Section', 'Paragraph'])
  const at = ai.insertIndex(doc, undefined)
  const longer = ai.spliceBlocks(doc, at, 0, added)
  assert.equal(longer.children.length, n + 2)
  assert.equal(ai.insertIndex(doc, -1), 0)
  assert.throws(() => ai.insertIndex(doc, n + 3), /"after"/)
  // Replace "Introduction" + its paragraph by one new section.
  const i = doc.children.findIndex((b: { type: string; children?: unknown[] }) => b.type === 'Section')
  const repl = ai.spliceBlocks(doc, i, 2, ai.parseBody('\\section{Background}\nRutile and anatase.', doc.meta))
  assert.equal(repl.children.length, n)
  assert.match(serializeDocument(repl), /\\section\{Background\}\s+Rutile and anatase\./)
  assert.doesNotMatch(serializeDocument(repl), /Introduction/)
})

test('find and replace keeps the formatting', () => {
  const doc = ai.documentFromLatex(FULL, blankDocument().meta)
  const r = ai.replaceText(doc, 'widely', 'very widely')
  assert.equal(r.count, 1)
  assert.match(serializeDocument(r.doc), /\\textbf\{very widely\}/)
  const one = ai.replaceText(doc, 's', 'S', { all: false, caseSensitive: true })
  assert.equal(one.count, 1)
  const items = ai.replaceText(doc, 'o 1S', 'O 2p')
  assert.equal(items.count, 1, 'case-insensitive by default, list items included')
  assert.equal(ai.replaceText(doc, 'nowhere', 'x').count, 0)
})

test('title, author and settings', () => {
  const doc = blankDocument()
  const r = ai.setMetadata(doc, { title: 'New title', author: 'A. B. \\\\ C. D.', body_font_pt: 10, page_size: 'letter', add_packages: ['siunitx'] })
  assert.deepEqual(r.changed, ['title', 'author', 'body_font_pt', 'page_size', 'packages'])
  const tex = serializeDocument(r.doc)
  assert.match(tex, /\\title\{New title\}/)
  assert.match(tex, /A\. B\./)
  assert.match(tex, /\\usepackage\{siunitx\}/)
  assert.equal(r.doc.meta.page_size, 'Letter')
  assert.equal(r.doc.children.filter((b: { type: string }) => b.type === 'Author').length, 2)
  assert.throws(() => ai.setMetadata(doc, { body_font_pt: 13 }), /10, 11 or 12/)
})

test('KherveTeX, KhervePY, KhervePaint and KhervePDF offer tools, and a request about LaTeX names KherveTeX', async () => {
  const { APP_TOOL_SETS } = await import('../../src/os/ai/appManifest.ts')
  const { mentionedApps, toolName } = await import('../../src/os/ai/appToolsCore.ts')
  const names = APP_TOOL_SETS.flatMap((s: { app: string; tools: { action: string }[] }) => s.tools.map((t) => toolName(s.app, t.action)))
  for (const n of [
    'khervetex_get_document', 'khervetex_set_latex', 'khervetex_replace_blocks', 'khervetex_insert_latex', 'khervetex_set_metadata',
    'khervetex_new_document', 'khervetex_compile', 'khervetex_save', 'khervepy_set_code', 'khervepy_run', 'khervepaint_add_shape',
    'khervepdf_read_text', 'khervepdf_go_to_page',
  ]) assert.ok(names.includes(n), n)
  assert.ok(mentionedApps('Redo my LaTeX document as a lab report', APP_TOOL_SETS).includes('khervetex'))
  assert.ok(mentionedApps('fix the bug in my python script', APP_TOOL_SETS).includes('khervepy'))
})

test('LaTeX a small model escaped twice is read as LaTeX', () => {
  const twice = '\\\\documentclass{article}\\n\\\\begin{document}\\n\\\\section{Intro}\\nText\\\\\\\\ more.\\n\\\\end{document}'
  const fixed = ai.modelLatex(twice)
  assert.equal(fixed, '\\documentclass{article}\n\\begin{document}\n\\section{Intro}\nText\\\\ more.\n\\end{document}')
  const doc = ai.documentFromLatex(fixed, blankDocument().meta)
  assert.equal(doc.meta.documentclass, 'article')
  assert.ok(!plainText(doc.children[0]?.content ?? []).includes('documentclass'))
  // Normal LaTeX, with real line breaks \\, is left alone.
  const ok = '\\section{A}\nOne\\\\ two \\newline'
  assert.equal(ai.modelLatex(ok), ok)
})
