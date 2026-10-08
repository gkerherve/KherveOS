// AI tools of KherveWord, the word processor (≤ 6 arguments each). The code
// is in src/apps/kherveword/aiTools.ts. Paragraphs are addressed by the
// "index" kherveword_read_document gives them.

import type { AppToolSet } from '../appToolsCore.ts'
import { bool, int, object, oneOf, str } from './schema.ts'

const STYLE = str('A paragraph style: Normal, Title, Subtitle, Heading1…Heading6, Quote, IntenseQuote, Caption, Code, NoSpacing, or a style of the document.')

export const KHERVEWORD_TOOL_SET: AppToolSet = {
  app: 'kherveword',
  name: 'KherveWord',
  summary: 'the word processor (Word-like: styles, lists, tables, .docx, PDF).',
  keywords: ['kherveword', 'word', 'docx', 'word document', 'word processor', 'letter', 'report', 'cv', 'resume', 'essay'],
  tools: [
    {
      action: 'read_document',
      description: 'Read the document open in KherveWord: file, pages, words, page setup, and every paragraph (index, style, list level, text; tables as rows).',
      inputSchema: object({ from: int('Start at this paragraph index (default 0).'), max_chars: int('Stop after about this many characters (default 20000).') }),
      readOnly: true,
    },
    {
      action: 'insert_paragraphs',
      description: 'Insert text as paragraphs, written in light Markdown (# headings, - and 1. lists, **bold**, *italic*, [links](url), | tables |, $maths$). One undo step.',
      inputSchema: object({ text: str('The text (Markdown).'), at: int('Insert before the paragraph with this index (default: at the end).'), style: STYLE }, ['text']),
    },
    {
      action: 'replace_paragraph',
      description: 'Replace the text of one paragraph (light Markdown for bold/italic/links); its style and formatting stay unless "style" is given.',
      inputSchema: object({ index: int('Paragraph index from read_document.'), text: str('The new text.'), style: STYLE }, ['index', 'text']),
    },
    {
      action: 'delete_paragraphs',
      description: 'Delete paragraphs (or tables) from index "from" to "to" (inclusive). One undo step.',
      inputSchema: object({ from: int('First paragraph index.'), to: int('Last paragraph index (default: = from).') }, ['from']),
    },
    {
      action: 'apply_style',
      description: 'Apply a paragraph style (e.g. Heading1) and/or an alignment to paragraphs from index "from" to "to".',
      inputSchema: object({ style: STYLE, from: int('First paragraph index.'), to: int('Last paragraph index (default: = from).'), align: oneOf(['left', 'center', 'right', 'justify'], 'Alignment.') }, ['from']),
    },
    {
      action: 'format_text',
      description: 'Format every occurrence of some text (exact, case included): bold, italic, underline, colour, size.',
      inputSchema: object({
        find: str('The text to format.'),
        bold: bool('Bold on/off.'),
        italic: bool('Italic on/off.'),
        underline: bool('Underline on/off.'),
        color: str('Text colour, e.g. "#c00000" or "red".'),
        size: int('Font size in points.'),
      }, ['find']),
    },
    {
      action: 'insert_table',
      description: 'Insert a table from rows of cell texts; the first row can be a header row (bold, repeated on each page).',
      inputSchema: object({
        rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Rows of cells, e.g. [["Name","Value"],["a","1"]].' },
        at: int('Insert before the paragraph with this index (default: at the end).'),
        header: bool('The first row is a header row (default true).'),
        borders: oneOf(['all', 'outer', 'horizontal', 'none'], 'Borders (default all).'),
      }, ['rows']),
    },
    {
      action: 'insert_special',
      description: 'Insert a page break, table of contents, equation (LaTeX), footnote, horizontal line or a picture from the drive, at the end of a paragraph (or the document).',
      inputSchema: object({
        kind: oneOf(['page_break', 'toc', 'equation', 'footnote', 'horizontal_line', 'image'], 'What to insert.'),
        at: int('Paragraph index: page breaks, contents, lines and pictures go before it; equations and footnotes at its end (default: the end of the document).'),
        latex: str('The equation in LaTeX (kind equation), e.g. "E = mc^2".'),
        text: str('The footnote text (kind footnote).'),
        path: str('The picture on the drive (kind image), e.g. "~/Pictures/logo.png".'),
        display: bool('Equation on a line of its own (default true).'),
      }, ['kind']),
    },
    {
      action: 'find_replace',
      description: 'Find text and replace every occurrence (one undo step). Returns how many were replaced.',
      inputSchema: object({
        find: str('Text to find (or a regular expression with regex).'),
        replace: str('Replacement ($1… with regex).'),
        match_case: bool('Case must match (default false).'),
        whole_word: bool('Whole words only.'),
        regex: bool('"find" is a regular expression.'),
      }, ['find', 'replace']),
    },
    {
      action: 'set_page',
      description: 'Page setup, headers and footers. Header/footer: "left|center|right" with {PAGE}, {PAGES}, {TITLE}, {DATE}; e.g. "|Page {PAGE} of {PAGES}|".',
      inputSchema: object({
        size: oneOf(['A4', 'Letter', 'Legal', 'A5', 'A3', 'Executive'], 'Paper size.'),
        orientation: oneOf(['portrait', 'landscape'], 'Orientation.'),
        margins_cm: { type: 'number', description: 'All four margins, in cm.' },
        header: str('Header text, "left|center|right".'),
        footer: str('Footer text, "left|center|right".'),
        title: str('The document title (properties, {TITLE}).'),
      }),
    },
    {
      action: 'review',
      description: 'Track changes on/off, accept or reject all tracked changes, or add a comment on some text.',
      inputSchema: object({
        track_changes: bool('Turn Track Changes on or off.'),
        accept_all: bool('Accept every tracked change.'),
        reject_all: bool('Reject every tracked change.'),
        comment_on: str('Add a comment on the first occurrence of this text…'),
        comment: str('…with this comment text.'),
      }),
    },
    {
      action: 'new_document',
      description: 'Start a new document in this window from a template: blank, letter, report (title page, contents, sections) or cv.',
      inputSchema: object({ template: oneOf(['blank', 'letter', 'report', 'cv'], 'The template (default blank).') }),
    },
    {
      action: 'save',
      description: 'Save the document. The extension of "path" picks the format: .docx (Word, default), .html, .md, .txt.',
      inputSchema: object({ path: str('Where, e.g. "~/Documents/report.docx" (default: where it was opened or last saved).') }),
    },
    {
      action: 'export_pdf',
      description: 'Write the document as a PDF on the drive (text stays selectable). Returns the path and number of pages.',
      inputSchema: object({ path: str('Where, e.g. "~/Documents/report.pdf" (default: next to the document).') }),
    },
  ],
}
