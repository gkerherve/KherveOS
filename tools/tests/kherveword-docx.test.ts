// KherveWord's .docx writer and reader: a document with every feature goes
// out to .docx and comes back the same; the parts Word needs are there and
// well formed; equations go to OMML and back; files written by other tools
// (macOS textutil, when present) are read. Starts nothing.
//
//   node --test tools/tests/kherveword-docx.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { writeDocx, imageSize, decodeDataUrl } from '../../src/apps/kherveword/docx/writer.ts'
import { readDocx } from '../../src/apps/kherveword/docx/reader.ts'
import { latexToOmml, ommlToLatex } from '../../src/apps/kherveword/docx/omml.ts'
import { parseXml } from '../../src/apps/kherveword/docx/xml.ts'
import { defaultSettings, type PMMark, type PMNode, type WordDoc } from '../../src/apps/kherveword/model.ts'
import { docToMarkdown, docToText } from '../../src/apps/kherveword/formats/export.ts'
import { rtfToHtml } from '../../src/apps/kherveword/formats/rtf.ts'
import { odtToHtml } from '../../src/apps/kherveword/formats/odt.ts'
import { zipSync, strToU8 } from 'fflate'
import { docToHtml } from '../../src/apps/kherveword/formats/html.ts'
import { htmlToPdf } from '../../src/apps/kherveword/pdf/pdfCore.ts'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const t = (text: string, ...marks: PMMark[]): PMNode => (marks.length ? { type: 'text', text, marks } : { type: 'text', text })
const p = (content: PMNode[] | string, attrs: Record<string, unknown> = {}): PMNode => ({
  type: 'paragraph',
  attrs: { style: 'Normal', ...attrs },
  content: typeof content === 'string' ? [t(content)] : content,
})
const li = (...content: PMNode[]): PMNode => ({ type: 'listItem', content })
const cell = (text: string, attrs: Record<string, unknown> = {}, type = 'tableCell'): PMNode => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: [120], ...attrs }, content: [p(text)] })

function sample(): WordDoc {
  const settings = defaultSettings('Letter')
  settings.page.orientation = 'landscape'
  settings.page.margins = { top: 54, right: 50, bottom: 60, left: 70, header: 30, footer: 28 }
  settings.header = { left: 'KherveWord', center: '', right: '{TITLE}' }
  settings.footer = { left: '', center: 'Page {PAGE} of {PAGES}', right: '' }
  settings.differentFirst = true
  settings.firstHeader = { left: '', center: 'First page', right: '' }
  settings.firstFooter = { left: '', center: '', right: '' }
  settings.title = 'Round trip'
  settings.author = 'Ada Lovelace'
  settings.trackChanges = true
  settings.styles.Heading1 = { ...settings.styles.Heading1, color: '#c00000', size: 18 }
  settings.styles.MyStyle = { id: 'MyStyle', name: 'My Style', basedOn: 'Normal', quick: true, font: 'Georgia', size: 12, italic: true, color: '#336699', spaceAfter: 4 }
  settings.comments = {
    c0: { author: 'Bob', date: '2026-10-08T10:00:00Z', text: 'Check this.' },
    c1: { author: 'Eve', date: '2026-10-08T11:00:00Z', text: 'Two\nlines' },
  }
  const ins = { type: 'insertion', attrs: { id: 'x', author: 'Ada', date: '2026-10-08T12:00:00Z' } }
  const del = { type: 'deletion', attrs: { id: 'y', author: 'Ada', date: '2026-10-08T12:00:00Z' } }
  const doc: PMNode = {
    type: 'doc',
    content: [
      p('A document title', { style: 'Title' }),
      { type: 'toc' },
      p('Introduction', { style: 'Heading1' }),
      p(
        [
          t('Plain, '),
          t('bold', { type: 'bold' }),
          t(', '),
          t('italic', { type: 'italic' }),
          t(', '),
          t('under', { type: 'underline' }),
          t(' '),
          t('struck', { type: 'strike' }),
          t(' H'),
          t('2', { type: 'subscript' }),
          t('O x'),
          t('2', { type: 'superscript' }),
          t(' '),
          t('red Georgia 14', { type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSize: '14pt', color: '#ff0000' } }),
          t(' '),
          t('yellow', { type: 'highlight', attrs: { color: '#ffff00' } }),
          t(' '),
          t('peach', { type: 'highlight', attrs: { color: '#ffd8b0' } }),
          t(' and a '),
          t('link', { type: 'link', attrs: { href: 'https://example.org/a?b=1&c=2' } }),
          t('.'),
          { type: 'hardBreak' },
          t('After\ta tab.'),
        ],
        { align: 'justify', spaceBefore: 6, spaceAfter: 12, lineHeight: 1.5, indentLeft: 18, indentRight: 9, indentFirst: 27 },
      ),
      p('Hanging, boxed and shaded', { indentLeft: 36, indentFirst: -18, border: 'box', shading: '#eeeeee', tabs: [{ pos: 144, align: 'right' }, { pos: 216, align: 'center' }] }),
      p('A custom style', { style: 'MyStyle', align: 'center' }),
      {
        type: 'bulletList',
        attrs: {},
        content: [
          li(p('One'), { type: 'bulletList', attrs: {}, content: [li(p('One.one'), { type: 'orderedList', attrs: { start: 1 }, content: [li(p('deep a')), li(p('deep b'))] })] }),
          li(p('Two'), p('Two, second paragraph')),
        ],
      },
      p('Between lists'),
      { type: 'orderedList', attrs: { start: 3, listStyle: 'lower-roman' }, content: [li(p('three')), li(p('four'))] },
      { type: 'orderedList', attrs: { start: 1, listStyle: 'outline' }, content: [li(p('Chapter'), { type: 'orderedList', attrs: { start: 1 }, content: [li(p('Section'))] })] },
      { type: 'bulletList', attrs: { listStyle: 'square' }, content: [li(p('square bullet'))] },
      {
        type: 'table',
        attrs: { borders: 'horizontal' },
        content: [
          { type: 'tableRow', content: [cell('Name', {}, 'tableHeader'), cell('Value', { colspan: 2, colwidth: [100, 80] }, 'tableHeader')] },
          { type: 'tableRow', content: [cell('tall', { rowspan: 2, background: '#ddeeff', valign: 'middle' }), cell('b1', { colwidth: [100] }), cell('c1', { colwidth: [80] })] },
          { type: 'tableRow', content: [cell('b2', { colwidth: [100] }), cell('c2', { colwidth: [80] })] },
        ],
      },
      p([t('Picture: '), { type: 'image', attrs: { src: PNG, alt: 'A dot', width: 40, height: 40, wrap: 'inline' } }, t(' floating '), { type: 'image', attrs: { src: PNG, alt: null, width: 20, height: 30, wrap: 'right' } }]),
      { type: 'pageBreak', attrs: { kind: 'page' } },
      p('Notes', { style: 'Heading2' }),
      p([t('A claim'), { type: 'footnote', attrs: { text: 'The source & proof.' } }, t(' and maths '), { type: 'equation', attrs: { latex: '\\frac{a}{b}+x^{2}' } }, t('.')]),
      { type: 'equationBlock', attrs: { latex: '\\sum_{i=1}^{n}{x_{i}}=\\sqrt{\\alpha}' } },
      p([t('Commented ', { type: 'comment', attrs: { id: 'c0' } }), t('text'), t(' across', { type: 'comment', attrs: { id: 'c1' } })]),
      p([t('paragraphs', { type: 'comment', attrs: { id: 'c1' } }), t(' with '), t('added', ins), t(' and '), t('removed', del), t(' words.')]),
      { type: 'pageBreak', attrs: { kind: 'section' } },
      p('Last section', { style: 'Heading1' }),
      { type: 'horizontalRule' },
      p(''),
    ],
  }
  // An empty paragraph has no content.
  doc.content![doc.content!.length - 1] = { type: 'paragraph', attrs: { style: 'Normal' } }
  return { doc, settings }
}

/** The document as the reader is expected to give it back (ids of changes vary; nulls are left out). */
function norm(n: PMNode): unknown {
  const out: Record<string, unknown> = { type: n.type }
  if (n.attrs) {
    const a: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(n.attrs)) if (v !== null && v !== undefined) a[k] = v
    if (Object.keys(a).length) out.attrs = a
  }
  if (n.text !== undefined) out.text = n.text
  if (n.marks?.length) {
    out.marks = n.marks
      .map((m) => {
        const a: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(m.attrs ?? {})) if (v !== null && v !== undefined && !((m.type === 'insertion' || m.type === 'deletion') && k === 'id')) a[k] = v
        return Object.keys(a).length ? { type: m.type, attrs: a } : { type: m.type }
      })
      .sort((x, y) => x.type.localeCompare(y.type))
  }
  if (n.content?.length) {
    const merged: PMNode[] = []
    for (const c of n.content) {
      const prev = merged[merged.length - 1]
      if (c.type === 'text' && prev?.type === 'text' && JSON.stringify(norm({ ...prev, text: '' })) === JSON.stringify(norm({ ...c, text: '' }))) {
        merged[merged.length - 1] = { ...prev, text: (prev.text ?? '') + (c.text ?? '') }
      } else merged.push(c)
    }
    out.content = merged.map(norm)
  }
  return out
}

const NOW = new Date('2026-10-08T09:00:00Z')

test('a document with every feature comes back from .docx the same', () => {
  const wd = sample()
  const bytes = writeDocx(wd, { now: NOW, headingPages: [1, 2, 2] })
  const back = readDocx(bytes)
  const want = norm(wd.doc) as { content: unknown[] }
  const got = norm(back.doc) as { content: unknown[] }
  for (let i = 0; i < Math.max(want.content.length, got.content.length); i++) {
    assert.deepEqual(got.content[i], want.content[i], `block ${i}`)
  }
  const s = back.settings
  assert.deepEqual(s.page, wd.settings.page)
  assert.deepEqual(s.header, wd.settings.header)
  assert.deepEqual(s.footer, wd.settings.footer)
  assert.equal(s.differentFirst, true)
  assert.deepEqual(s.firstHeader, wd.settings.firstHeader)
  assert.equal(s.title, 'Round trip')
  assert.equal(s.author, 'Ada Lovelace')
  assert.equal(s.trackChanges, true)
  assert.deepEqual(s.comments, wd.settings.comments)
  for (const id of ['Normal', 'Title', 'Heading1', 'Heading2', 'Quote', 'MyStyle']) {
    const a = { ...wd.settings.styles[id] }
    const b = { ...s.styles[id] }
    assert.deepEqual(b, a, `style ${id}`)
  }
})

test('the package has what Word needs, and every part is well-formed XML', () => {
  const files = unzipSync(writeDocx(sample(), { now: NOW }))
  const names = Object.keys(files)
  assert.equal(names[0], '[Content_Types].xml')
  for (const part of ['_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/settings.xml', 'word/numbering.xml', 'word/footnotes.xml', 'word/comments.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml', 'word/header1.xml', 'word/footer1.xml', 'word/media/image1.png']) {
    assert.ok(files[part], `${part} is there`)
  }
  assert.equal(names.filter((n) => n.startsWith('word/media/')).length, 1, 'the same picture is stored once')
  for (const n of names.filter((x) => x.endsWith('.xml') || x.endsWith('.rels'))) parseXml(strFromU8(files[n]))
  const ct = strFromU8(files['[Content_Types].xml'])
  for (const n of names.filter((x) => /^word\/[^/]+\.xml$/.test(x))) assert.ok(ct.includes(`PartName="/${n}"`), `${n} has a content type`)
  const doc = strFromU8(files['word/document.xml'])
  assert.ok(!doc.includes('<!--'), 'no placeholders are left')
  assert.equal((doc.match(/<w:commentRangeStart /g) ?? []).length, 2)
  assert.equal((doc.match(/<w:commentRangeEnd /g) ?? []).length, 2)
  assert.match(doc, /<w:instrText xml:space="preserve"> TOC /)
  assert.match(doc, /<w:sectPr>.*<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"\/>/)
  // rels point at parts that exist
  const rels = parseXml(strFromU8(files['word/_rels/document.xml.rels']))
  for (const r of rels.children) {
    if (typeof r === 'string' || r.attrs.TargetMode === 'External') continue
    assert.ok(files[`word/${r.attrs.Target}`], `${r.attrs.Target} exists`)
  }
})

test('pPr and rPr children are in the order Word requires', () => {
  const doc = strFromU8(unzipSync(writeDocx(sample(), { now: NOW }))['word/document.xml'])
  const P_ORDER = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'numPr', 'pBdr', 'shd', 'tabs', 'spacing', 'ind', 'jc', 'outlineLvl', 'rPr', 'sectPr']
  const R_ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'strike', 'color', 'sz', 'szCs', 'highlight', 'u', 'shd', 'vertAlign']
  const check = (re: RegExp, order: string[]) => {
    for (const m of doc.matchAll(re)) {
      const tags = [...m[1].matchAll(/<w:([A-Za-z]+)[\s/>]/g)].map((x) => x[1]).filter((x) => order.includes(x))
      const top = tags.filter((x, i) => i === 0 || x !== tags[i - 1])
      const idx = top.map((x) => order.indexOf(x))
      assert.deepEqual(idx, [...idx].sort((a, b) => a - b), `order of ${top.join(',')}`)
    }
  }
  check(/<w:pPr>((?:(?!<\/w:pPr>).)*)<\/w:pPr>/g, P_ORDER)
  check(/<w:rPr>((?:(?!<\/w:rPr>).)*)<\/w:rPr>/g, R_ORDER)
})

test('equations: LaTeX → OMML → LaTeX', () => {
  const cases: [string, string][] = [
    ['\\frac{a}{b}', '\\frac{a}{b}'],
    ['x^2+y_1', 'x^{2}+y_{1}'],
    ['x_{i}^{2}', 'x_{i}^{2}'],
    ['\\sqrt{x}+\\sqrt[3]{y}', '\\sqrt{x}+\\sqrt[3]{y}'],
    ['\\alpha+\\beta\\leq\\pi', '\\alpha+\\beta\\leq\\pi'],
    ['\\sum_{i=1}^{n} x_i', '\\sum_{i=1}^{n}{x_{i}}'],
    ['\\int_0^1 f(x)\\,dx', '\\int_{0}^{1}{f(x)\\,dx}'],
    ['\\left(\\frac{1}{2}\\right)', '\\left(\\frac{1}{2}\\right)'],
    ['\\hat{x}\\vec{v}', '\\hat{x}\\vec{v}'],
    ['\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}', '\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}'],
    ['\\sin x', '\\sin x'],
    ['\\text{if } x', '\\text{if }x'],
  ]
  for (const [latex, want] of cases) {
    const xml = `<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${latexToOmml(latex)}</m:oMath>`
    assert.equal(ommlToLatex(parseXml(xml)), want, latex)
  }
})

test('images: data URLs and sizes', () => {
  const img = decodeDataUrl(PNG)!
  assert.equal(img.mime, 'image/png')
  assert.deepEqual(imageSize(img.data), { w: 1, h: 1 })
})

test('Markdown and text export', () => {
  const md = docToMarkdown(sample().doc)
  assert.match(md, /^# A document title/m)
  assert.match(md, /^# Introduction/m)
  assert.match(md, /\*\*bold\*\*/)
  assert.match(md, /\[link\]\(https:\/\/example\.org/)
  assert.match(md, /^- One$/m)
  assert.match(md, /^ {2}- One\.one$/m)
  assert.match(md, /^3\. three$/m)
  assert.match(md, /^\| Name \| Value \|/m)
  assert.match(md, /\$\\frac\{a\}\{b\}\+x\^\{2\}\$/)
  assert.ok(!md.includes('removed'), 'deleted text is left out')
  const text = docToText(sample().doc)
  assert.match(text, /Plain, bold, italic/)
})

test('RTF and ODT import', () => {
  const html = rtfToHtml('{\\rtf1\\ansi{\\fonttbl{\\f0 Times;}}\\f0\\fs24 Hello {\\b bold} and {\\i italic}\\par Caf\\\'e9 \\u8364? end\\par}')
  assert.match(html, /<p>Hello <b>bold<\/b> and <i>italic<\/i><\/p>/)
  assert.match(html, /Café €/)
  const content = `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"><office:automatic-styles><style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style></office:automatic-styles><office:body><office:text><text:h text:outline-level="1">Title</text:h><text:p>Some <text:span text:style-name="T1">bold</text:span> text</text:p><text:list><text:list-item><text:p>item</text:p></text:list-item></text:list><table:table><table:table-row><table:table-cell><text:p>A</text:p></table:table-cell></table:table-row></table:table></office:text></office:body></office:document-content>`
  const odt = zipSync({ mimetype: strToU8('application/vnd.oasis.opendocument.text'), 'content.xml': strToU8(content) })
  const oh = odtToHtml(odt)
  assert.match(oh, /<h1>Title<\/h1>/)
  assert.match(oh, /<b>bold<\/b>/)
  assert.match(oh, /<ul><li><p>item<\/p><\/li><\/ul>/)
  assert.match(oh, /<table><tr><td><p>A<\/p><\/td><\/tr><\/table>/)
})

// macOS: textutil reads our .docx, and writes one that we read (a file from another tool).
const textutil = process.platform === 'darwin' && existsSync('/usr/bin/textutil')
test('macOS textutil reads KherveWord .docx files and writes ones KherveWord reads', { skip: !textutil && 'needs macOS textutil' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'kword-'))
  const ours = join(dir, 'ours.docx')
  writeFileSync(ours, writeDocx(sample(), { now: NOW }))
  const text = execFileSync('/usr/bin/textutil', ['-convert', 'txt', '-stdout', ours], { encoding: 'utf8' })
  assert.match(text, /Plain, bold, italic/)
  assert.match(text, /Two, second paragraph/)
  const html = join(dir, 'in.html')
  writeFileSync(html, '<html><body><h1>Heading</h1><p>Some <b>bold</b> and <i>italic</i> text.</p><ul><li>one</li><li>two</li></ul></body></html>')
  const theirs = join(dir, 'theirs.docx')
  execFileSync('/usr/bin/textutil', ['-convert', 'docx', html, '-output', theirs])
  const back = readDocx(readFileSync(theirs))
  const all = JSON.stringify(back.doc)
  assert.match(all, /"text":"Heading"/)
  assert.match(all, /"bold"/)
  assert.match(all, /"italic"/)
  assert.match(all, /one/)
})

test('HTML export, and a PDF laid out by MuPDF (no print dialog)', async () => {
  const wd = sample()
  const web = docToHtml(wd, { mode: 'web' })
  assert.match(web, /^<!DOCTYPE html>/)
  assert.match(web, /<h1 class="kw-p kw-s-Title"/)
  assert.match(web, /\.kw-s-Heading1\{[^}]*color:#c00000/)
  assert.ok(!web.includes('removed'), 'deleted text is left out')
  const xhtml = docToHtml(wd, { mode: 'pdf' })
  parseXml(xhtml) // well-formed, as MuPDF's XHTML parser wants
  const mupdf = await import('mupdf')
  const { pdf, pages } = htmlToPdf(mupdf, xhtml, 792, 612)
  assert.ok(pages >= 2, `the page break makes a second page (${pages})`)
  const back = mupdf.Document.openDocument(pdf, 'application/pdf')
  assert.equal(back.countPages(), pages)
  assert.match(back.loadPage(0).toStructuredText().asText(), /A document title/)
  assert.match(back.loadPage(pages - 1).toStructuredText().asText(), /Last section/)
})
