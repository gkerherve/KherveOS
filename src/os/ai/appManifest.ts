// The AI tools of the apps: names, arguments and descriptions, known before
// any window opens (KherveAI's prompt and the MCP tool list come from here).
// The code is in each app, registered while one of its windows is open:
//
//   import { useAppTools } from '@/os/ai/appTools'
//   useAppTools(win, {
//     set_cells: async (args, ctx) => { …; return { written: 5 } },
//   })
//
// A call to "<app>_<action>" runs in the app's front window (or the window
// given as "window"); when the app has no window, KherveOS opens one with
// `openArgs` and waits for it to register. Results are small JSON values;
// throw an Error with a helpful sentence when something is wrong.
// ctx.confirm(…) / ctx.allowPython(…) ask the user (runTool's rules).
//
// Adding an app is a few lines. For example, KherveDB (not done yet):
//
//   here:  {
//            app: 'khervedb', name: 'KherveDB', summary: 'the XPS binding-energy database.',
//            keywords: ['khervedb', 'xps', 'binding energy', 'element'],
//            tools: [{ action: 'select_element', description: 'Show an element, e.g. "O" for oxygen.',
//                      inputSchema: object({ element: str('Chemical symbol, e.g. "O".') }, ['element']) }],
//          },
//   in KherveDB.tsx:  useAppTools(win, { select_element: async (a) => { select(String(a.element)); return { shown: a.element } } })
//
// and the Browser: { app: 'browser', …, tools: [{ action: 'open_url', … }] } with
// useAppTools(win, { open_url: async (a) => { navigate(String(a.url)); return { url: a.url } } }).
//
// Keep descriptions short and schemas small: small local models read all of it.

import type { AppToolSet, Schema } from './appToolsCore.ts'
import { COMMUNICATION_TOOL_SETS } from './manifests/communication.ts'
import { SYSTEM_TOOL_SETS } from './manifests/system.ts'
import { GAME_TOOL_SETS } from './manifests/games.ts'

const str = (description: string): Schema => ({ type: 'string', description })
const int = (description: string): Schema => ({ type: 'integer', description })
const bool = (description: string): Schema => ({ type: 'boolean', description })
const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', properties, required })

const SHEET_ARG = str('Sheet name (default: the sheet shown).')

export const APP_TOOL_SETS: AppToolSet[] = [
  {
    app: 'khervedb',
    name: 'KherveDB',
    summary: 'the NIST XPS binding-energy database with a periodic table.',
    keywords: ['khervedb', 'xps', 'binding energ', 'element', 'periodic', 'nist', 'oxygen', 'carbon'],
    tools: [
      {
        action: 'select_element',
        description:
          'Show an element in KherveDB (e.g. "O" or "oxygen") and get its XPS lines: median binding energy, range and number of NIST entries.',
        inputSchema: object({ element: str('Chemical symbol or name, e.g. "O", "Fe", "oxygen".'), line: str('Optional XPS line to filter on, e.g. "1s", "2p3/2".') }, ['element']),
        readOnly: true,
      },
      {
        action: 'open_databases',
        description: 'Open the Other Databases & Properties window (XPS Fitting, Harwell, Thermo, Scholar) on the shown element.',
        inputSchema: object({}),
        readOnly: true,
      },
    ],
  },
  {
    app: 'browser',
    name: 'Browser',
    summary: 'the KherveOS web browser.',
    keywords: ['browser', 'web', 'website', 'url', 'http', 'page', 'search the web'],
    tools: [
      {
        action: 'open_url',
        description: 'Open a web address (or a search for words) in a new tab of the KherveOS Browser.',
        inputSchema: object({ url: str('A web address like "https://example.org", or words to search for.') }, ['url']),
        readOnly: true,
      },
    ],
  },
  {
    app: 'khervesheet',
    name: 'KherveSheet',
    summary: 'the spreadsheet (Excel-like formulas, charts).',
    keywords: ['sheet', 'spreadsheet', 'spreadsheets', 'workbook', 'excel', 'cell', 'cells', 'column', 'columns', 'ksheet', 'chart'],
    tools: [
      {
        action: 'read_range',
        description: 'Read cells of the open spreadsheet: the value shown and the formula of each non-empty cell. Without "range", reads the whole used area.',
        inputSchema: object({ range: str('A1-style range, e.g. "A1:C10" (default: all used cells).'), sheet: SHEET_ARG }),
        readOnly: true,
      },
      {
        action: 'set_cells',
        description:
          'Write values or formulas into cells of the open spreadsheet, e.g. {"A1": 1, "A2": 2, "A3": "=SUM(A1:A2)"}. ' +
          'Formulas start with "=" (Excel functions: SUM, AVERAGE…). Returns the computed values.',
        inputSchema: object(
          {
            cells: { type: 'object', description: 'Cell → value or formula, e.g. {"A1": 5, "B1": "=A1*2"}. "" clears a cell.', additionalProperties: true },
            sheet: SHEET_ARG,
          },
          ['cells'],
        ),
      },
      {
        action: 'add_sheet',
        description: 'Add a new sheet (tab) to the workbook and show it.',
        inputSchema: object({ name: str('Its name (default: Sheet4…).') }),
      },
      {
        action: 'select',
        description: 'Select a range of cells (and show its sheet), so the user sees it.',
        inputSchema: object({ range: str('A1-style range, e.g. "B2:D8".'), sheet: SHEET_ARG }, ['range']),
      },
      {
        action: 'chart',
        description: 'Insert a chart of a range: the first column is X when it holds labels; a text first row names the series.',
        inputSchema: object(
          {
            range: str('The data, e.g. "A1:B10".'),
            type: { type: 'string', enum: ['Line', 'Line+Symbol', 'Scatter', 'Bar', 'Histogram', 'Pie'], description: 'Chart type.' },
            title: str('Chart title.'),
            sheet: SHEET_ARG,
          },
          ['range', 'type'],
        ),
      },
      {
        action: 'save',
        description: 'Save the workbook (.ksheet, or .csv). A workbook never saved needs "path".',
        inputSchema: object({ path: str('Where to save, e.g. "~/Documents/data.ksheet" (default: its own file).') }),
      },
    ],
  },
  {
    app: 'khervebook',
    name: 'KherveBook',
    summary: 'Python notebooks (code and Markdown cells).',
    keywords: ['notebook', 'notebooks', 'khervebook', 'kbook', 'jupyter'],
    openArgs: { blank: true },
    hides: ['create_notebook'],
    tools: [
      {
        action: 'new_notebook',
        description: 'Start a new, empty notebook in KherveBook (a new window; open notebooks are kept). Then add cells with khervebook_add_cell.',
        inputSchema: object({}),
      },
      {
        action: 'list_cells',
        description: 'List the cells of the open notebook: number (1 = first), type, source (cut when long) and whether it has output.',
        inputSchema: object({}),
        readOnly: true,
      },
      {
        action: 'add_cell',
        description: 'Add a cell to the open notebook. With "run": true, runs it and returns its output.',
        inputSchema: object(
          {
            type: { type: 'string', enum: ['code', 'markdown'], description: 'Python "code" (default) or "markdown".' },
            source: str('The cell text.'),
            after: int('Put it after this cell number (0 = at the top; default: at the end).'),
            run: bool('Run it now (default false).'),
          },
          ['source'],
        ),
      },
      {
        action: 'edit_cell',
        description: 'Replace the text of a cell of the open notebook.',
        inputSchema: object({ cell: int('The cell number (1 = first).'), source: str('The new text.') }, ['cell', 'source']),
      },
      {
        action: 'run',
        description: 'Run one cell, or every cell (restarting Python), and return the outputs: text, errors and whether figures were drawn.',
        inputSchema: object({ cell: int('The cell number (1 = first). Leave out to run all cells.') }),
      },
      {
        action: 'open_example',
        description: 'Open one of KherveBook\'s ready-made example notebooks by title (part of the title is enough) and run it. Without a title, lists them.',
        inputSchema: object({ title: str('The example\'s title, e.g. "Fourier".') }),
      },
    ],
  },
  {
    app: 'notepad',
    name: 'Notepad',
    summary: 'the text editor.',
    keywords: ['notepad', 'text editor', 'editor', 'note', 'notes'],
    tools: [
      {
        action: 'read',
        description: 'Read the text of the document open in Notepad, with its path and whether it has unsaved changes.',
        inputSchema: object({}),
        readOnly: true,
      },
      {
        action: 'set_text',
        description: 'Replace the whole text of the document open in Notepad (not saved until notepad_save).',
        inputSchema: object({ text: str('The new text.') }, ['text']),
      },
      {
        action: 'replace',
        description: 'Find text in the Notepad document and replace it.',
        inputSchema: object({ find: str('The exact text to find.'), replace: str('What to put instead.'), all: bool('Replace every match (default: the first).') }, [
          'find',
          'replace',
        ]),
      },
      {
        action: 'insert',
        description: 'Insert text into the Notepad document: before a line, or at the end.',
        inputSchema: object({ text: str('The text to insert (add "\\n" to end the line).'), line: int('Insert before this line (1 = first; default: at the end).') }, [
          'text',
        ]),
      },
      {
        action: 'save',
        description: 'Save the Notepad document. A new document needs "path".',
        inputSchema: object({ path: str('Where to save, e.g. "~/Documents/notes.txt" (default: its own file).') }),
      },
    ],
  },
  {
    app: 'kherveref',
    name: 'KherveRef',
    summary: 'the reference manager (papers, DOIs, BibTeX/BibLaTeX, citations).',
    keywords: ['kherveref', 'reference', 'references', 'citation', 'citations', 'bibtex', 'biblatex', '.bib', 'bibliography', 'doi', 'arxiv', 'isbn', 'paper', 'papers'],
    tools: [
      {
        action: 'search',
        description: 'Search the reference library (words in title, authors, journal, key, DOI, tags). Returns keys, authors, year, title, journal, DOI.',
        inputSchema: object({
          query: str('Words to find, e.g. "XPS titanium 2020" (empty: every reference).'),
          collection: str('Only this collection (its name).'),
          limit: int('At most this many results (default 25).'),
        }),
        readOnly: true,
      },
      {
        action: 'add_by_doi',
        description: 'Add references by DOI (also arXiv ids and ISBNs): looks up their details online and adds them to the library. Already-present ones are not added twice.',
        inputSchema: object(
          {
            doi: str('One or more DOIs, arXiv ids or ISBNs, separated by spaces or new lines, e.g. "10.1038/nphys1170".'),
            collection: str('Also put them in this collection (its name; made if missing).'),
          },
          ['doi'],
        ),
      },
      {
        action: 'export_bibtex',
        description: 'Export references as BibLaTeX (default) or classic BibTeX: write a .bib file, or return the text when no path is given.',
        inputSchema: object({
          keys: { type: 'array', items: { type: 'string' }, description: 'Citation keys to export (default: all, or those matching "query").' },
          query: str('Export the references matching these words.'),
          dialect: { type: 'string', enum: ['biblatex', 'bibtex'], description: '"biblatex" (default) or classic "bibtex" (natbib).' },
          path: str('Write to this file, e.g. "~/Documents/paper/refs.bib".'),
        }),
      },
    ],
  },
  {
    app: 'kherveslide',
    name: 'KherveSlide',
    summary: 'presentations (slides typeset with LaTeX beamer, .kslide).',
    keywords: ['kherveslide', 'slide', 'slides', 'presentation', 'presentations', 'slideshow', 'deck', 'beamer', 'kslide', 'powerpoint'],
    tools: [
      {
        action: 'list_slides',
        description: 'List the slides of the open presentation: number (1 = first), title, bullet points, other text and objects.',
        inputSchema: object({}),
        readOnly: true,
      },
      {
        action: 'add_slide',
        description: 'Add a slide with a title and bullet points (a bullet starting with "- " is a sub-point).',
        inputSchema: object(
          {
            title: str('The slide title.'),
            bullets: { type: 'array', items: { type: 'string' }, description: 'The bullet points, in order.' },
            after: int('Put it after this slide number (0 = first; default: at the end).'),
          },
          ['title'],
        ),
      },
      {
        action: 'edit_slide',
        description: 'Change a slide: its title, its bullet points (replaced as a whole), text (find / replace) or whether it is hidden.',
        inputSchema: object(
          {
            slide: int('The slide number (1 = first).'),
            title: str('The new title.'),
            bullets: { type: 'array', items: { type: 'string' }, description: 'The new bullet points ("- " for a sub-point).' },
            find: str('Text to find on the slide…'),
            replace: str('…and what to put instead.'),
            hidden: bool('Hide the slide from the PDF and the slideshow (or show it again).'),
          },
          ['slide'],
        ),
      },
      {
        action: 'export_pdf',
        description: 'Typeset the presentation with LaTeX and save it as a PDF.',
        inputSchema: object({ path: str('Where, e.g. "~/Documents/talk.pdf" (default: next to the presentation, or in ~/Documents).') }),
      },
      {
        action: 'open_example',
        description: 'Open one of KherveSlide\'s example presentations by title (part of it is enough). Without a title, lists them.',
        inputSchema: object({ title: str('The example\'s title, e.g. "Research talk".') }),
      },
    ],
  },
  {
    app: 'khervelab',
    name: 'KherveLAB',
    summary: 'lab instrument booking (instruments, free slots, my bookings).',
    keywords: ['khervelab', 'instrument', 'instruments', 'booking', 'bookings', 'book', 'slot', 'slots', 'lab', 'reserve', 'xps', 'tga', 'bet', 'glovebox'],
    tools: [
      {
        action: 'list_instruments',
        description: 'List the lab\'s instruments: id, name, how they are booked (hours, slots), approval, your hourly rate and status (out of order…).',
        inputSchema: object({}),
        readOnly: true,
      },
      {
        action: 'free_slots',
        description: 'Show the slots of an instrument you could book now (free, within its rules), from a date for some days. Times are lab time.',
        inputSchema: object(
          {
            instrument: str('Instrument name or id, e.g. "XPS".'),
            date: str('First day, "YYYY-MM-DD" (default: today).'),
            days: int('How many days (1-14, default 1).'),
          },
          ['instrument'],
        ),
        readOnly: true,
      },
      {
        action: 'book',
        description: 'Book an instrument from start to end (lab time, "YYYY-MM-DD HH:MM"). Checks the rules first, then asks the user to confirm. Adjacent slots can be one booking.',
        inputSchema: object(
          {
            instrument: str('Instrument name or id.'),
            start: str('Start, e.g. "2026-10-07 09:00".'),
            end: str('End, e.g. "2026-10-07 11:00".'),
            purpose: str('What it is for (samples, project).'),
          },
          ['instrument', 'start', 'end'],
        ),
      },
      {
        action: 'my_bookings',
        description: 'List your upcoming bookings (id, instrument, times, status, cost, whether you can still cancel).',
        inputSchema: object({}),
        readOnly: true,
      },
      {
        action: 'cancel_booking',
        description: 'Cancel one of your own bookings that has not started (asks the user to confirm). Get the id from khervelab_my_bookings.',
        inputSchema: object({ booking_id: int('The booking id.'), reason: str('Why (optional).') }, ['booking_id']),
      },
    ],
  },
  {
    app: 'khervenote',
    name: 'KherveNote',
    summary: 'notes of lectures and talks, with the speech transcript beside them, exported to LaTeX/PDF.',
    keywords: ['khervenote', 'knote', 'lecture', 'lectures', 'talk', 'seminar', 'transcript', 'speech', 'notes'],
    tools: [
      {
        action: 'list_notes',
        description: 'List the notes in the KherveNote library (~/Documents/KherveNote, in folders): path, title, speaker, date, folder.',
        inputSchema: object({ query: str('Only notes containing these words (title, people, text).') }),
        readOnly: true,
      },
      {
        action: 'read_note',
        description:
          'Read a note: title, speaker, date, summary, every section (index, title) with its paragraphs (kind, time, text), and what was said (speech transcript, with times). Without "path", the note open in KherveNote.',
        inputSchema: object({ path: str('A .knote path from khervenote_list_notes (default: the open note).'), max_chars: int('Cut the speech to this many characters (default 12000).') }),
        readOnly: true,
      },
      {
        action: 'add_text',
        description:
          'Add text to the note open in KherveNote: at the end of a section, or as a new section with "title". Light Markdown: paragraphs, "- " / "1. " items (indent to nest), "## " subheadings, **bold**, maths as $…$ or $$…$$. One undo step.',
        inputSchema: object(
          {
            text: str('What to add (light Markdown).'),
            section: int('Section index from khervenote_read_note (default: the last section).'),
            title: str('Add it as a new section with this title, at the end of the note.'),
            kind: { type: 'string', enum: ['text', 'important', 'question', 'transcript'], description: 'Paragraph style: text (default), important (key-point box), question, transcript.' },
          },
          ['text'],
        ),
      },
      {
        action: 'export_pdf',
        description: 'Typeset the open note to PDF with LaTeX: "continuous" is one page as long as the note, "paged" is A4. Returns the PDF path.',
        inputSchema: object({
          path: str('Where to write the PDF, e.g. "~/Documents/lecture.pdf" (default: next to the note, named after its title).'),
          layout: { type: 'string', enum: ['continuous', 'paged'], description: 'Default: the note\'s own layout.' },
          show_times: bool('Each paragraph\'s time in the margin.'),
          transcript: bool('Add what was said, with its times, as a last section.'),
        }),
      },
    ],
  },
  {
    app: 'khervefitting',
    name: 'KherveFitting',
    summary: 'XPS peak fitting (core levels, backgrounds, peaks, fit, atomic %), the desktop KherveFitting-AI engine.',
    keywords: ['khervefitting', 'xps', 'fit', 'fitting', 'peak', 'peaks', 'core level', 'background', 'shirley', 'tougaard', 'binding energy', 'atomic', 'spectrum', 'vamas'],
    tools: [
      {
        action: 'list_core_levels',
        description: 'The open file and its core levels (sheets: C1s, O1s, Survey…), with the shown one\'s BE range, background and number of peaks.',
        inputSchema: object({}),
        readOnly: true,
      },
      {
        action: 'select_core_level',
        description: 'Show a core level (sheet) in KherveFitting: the plot and the peak grid follow.',
        inputSchema: object({ sheet: str('Sheet name, e.g. "C1s".') }, ['sheet']),
      },
      {
        action: 'set_background',
        description: 'Create the background region of a core level between low and high binding energy (eV). Methods: Smart (default), Shirley, Iterated Shirley, Linear, Offset, U4-Tougaard, U2-Tougaard, Active Shirley, Active Tougaard.',
        inputSchema: object({
          sheet: SHEET_ARG,
          low: { type: 'number', description: 'Low BE (eV); default: near the low end of the data.' },
          high: { type: 'number', description: 'High BE (eV); default: near the high end.' },
          method: str('Background method (default "Smart").'),
          offset_low: { type: 'number', description: 'CPS offset at the low-BE end (default 0).' },
          offset_high: { type: 'number', description: 'CPS offset at the high-BE end (default 0).' },
        }),
      },
      {
        action: 'add_peak',
        description: 'Add a peak to a core level (it needs a background), at the data height there. Without a position it goes where the data is highest above the current fit. Does not fit: call khervefitting_fit next.',
        inputSchema: object({
          sheet: SHEET_ARG,
          position: { type: 'number', description: 'Binding energy (eV).' },
          label: str('Peak label, e.g. "C1s C-C".'),
          fwhm: { type: 'number', description: 'FWHM (eV).' },
          lg: { type: 'number', description: 'L/G mix (%).' },
          model: str('Fitting model, e.g. "SGL (Area)", "GL (Area)", "LA (Area, σ/γ, γ)".'),
        }),
      },
      {
        action: 'fit',
        description: 'Fit the peaks of a core level like the Fitting window\'s "Fit Until Stable" (passes until chi is stable; passes=1 is "Fit One Time"). Returns chi (<1 excellent, 1-3 acceptable), R², reduced chi² and the fitted peaks.',
        inputSchema: object({ sheet: SHEET_ARG, passes: int('Stable passes required (default 6; 1 = one fit).'), max_passes: int('Hard cap (default 40).') }),
      },
      {
        action: 'get_peaks',
        description: 'The peak table of a core level: ID letter, label, position, height, FWHM, L/G, area, model, Conc. % and constraints, plus the last fit\'s chi / R².',
        inputSchema: object({ sheet: SHEET_ARG }),
        readOnly: true,
      },
      {
        action: 'get_results',
        description: 'The Results grid of the sample (atomic % and weight % of the ticked rows). export=true first adds the shown core level\'s peaks to it.',
        inputSchema: object({ sheet: SHEET_ARG, export: bool('Export the core level\'s peaks to the Results grid first.') }),
      },
      {
        action: 'open_example',
        description: 'Open one of KherveFitting\'s example workbooks (e.g. "SP2 Carbon", "Fe2O3", "Ni(0)-NiO"). Without a name, lists them.',
        inputSchema: object({ name: str('Example name (part of it is enough).') }),
      },
    ],
  },
  {
    app: 'khervetex',
    name: 'KherveTeX',
    summary: 'LaTeX documents (visual editor + Code tab, PDF beside it): articles, reports, letters, theses.',
    keywords: ['khervetex', 'latex', 'tex', 'ktex', 'pdflatex', 'manuscript', 'thesis', 'article', 'document', 'typeset', 'section', 'sections'],
    openArgs: { blank: true },
    tools: [
      {
        action: 'get_document',
        description:
          'Read the open KherveTeX document: title, author, class, settings, the outline (every block with its index) and its LaTeX source. Call this first, before changing it.',
        inputSchema: object({ max_chars: int('Cut the LaTeX to this many characters (default 30000).'), latex: bool('Include the LaTeX source (default true).') }),
        readOnly: true,
      },
      {
        action: 'read_blocks',
        description: 'The LaTeX of blocks start..end (inclusive; indices from khervetex_get_document). Read before you rewrite part of the document.',
        inputSchema: object({ start: int('First block index (0 = first).'), end: int('Last block index (default: start).') }, ['start']),
        readOnly: true,
      },
      {
        action: 'set_latex',
        description:
          'Replace the WHOLE document with new LaTeX: a complete .tex file (\\documentclass…\\begin{document}…) also sets class and packages; body text alone keeps them. It is parsed into editable content, shown in the editor and recompiled. One undo step.',
        inputSchema: object({ latex: str('The new LaTeX source.') }, ['latex']),
      },
      {
        action: 'insert_latex',
        description:
          'Insert LaTeX body source (no preamble) as new blocks: sections, paragraphs, equations, lists, tables, \\cite, \\ref. After block "after" (-1 = at the start), or at the end.',
        inputSchema: object({ latex: str('LaTeX body source.'), after: int('Insert after this block index (-1 = at the start; default: at the end).') }, ['latex']),
      },
      {
        action: 'replace_blocks',
        description: 'Replace blocks start..end (inclusive) with new LaTeX body source, e.g. rewrite one section. Keep what you were not asked to change.',
        inputSchema: object({ start: int('First block index.'), end: int('Last block index.'), latex: str('The new LaTeX body source.') }, ['start', 'end', 'latex']),
      },
      {
        action: 'delete_blocks',
        description: 'Delete blocks start..end (inclusive) from the document.',
        inputSchema: object({ start: int('First block index.'), end: int('Last block index (default: start).') }, ['start']),
      },
      {
        action: 'replace_text',
        description: 'Find and replace plain text in the document, keeping its formatting. Replaces every match unless all=false.',
        inputSchema: object(
          { find: str('The text to find.'), replace: str('What to put instead.'), all: bool('Every match (default true).'), case_sensitive: bool('Match case (default false).') },
          ['find', 'replace'],
        ),
      },
      {
        action: 'set_metadata',
        description: 'Change the title, author (lines separated by "\\\\"), document class, font size, page size or add packages. Only what you pass changes.',
        inputSchema: object({
          title: str('The title.'),
          author: str('The author(s), e.g. "A. Smith \\\\ University of X".'),
          documentclass: str('e.g. "article", "report", "book", "letter", "beamer".'),
          body_font_pt: int('10, 11 or 12.'),
          page_size: str('e.g. "A4", "Letter".'),
          add_packages: { type: 'array', items: { type: 'string' }, description: 'LaTeX packages to add, e.g. ["siunitx"].' },
        }),
      },
      {
        action: 'new_document',
        description:
          'Start a new document in the KherveTeX window: blank, or from a template ("Lab report", "Letter", "CV / résumé", "Two-column article", a journal or one of My templates). An unknown template name lists them.',
        inputSchema: object({ template: str('Template name (part of it is enough; default: blank).'), title: str('Its title.') }),
      },
      {
        action: 'compile',
        description: 'Typeset the document with LaTeX now and wait: ok, page count and the errors (line, message) with the end of the log. The PDF window shows the result.',
        inputSchema: object({ show_pdf: bool('Open the PDF window if it is hidden (default true).') }),
      },
      {
        action: 'save',
        description: 'Save the document (.ktex). A document never saved needs "path".',
        inputSchema: object({ path: str('Where to save, e.g. "~/Documents/report.ktex" (default: its own file).') }),
      },
    ],
  },
  {
    app: 'khervepy',
    name: 'KhervePY',
    summary: 'the Python IDE (project folder, editor tabs, Run in the browser).',
    keywords: ['khervepy', 'python', 'script', 'scripts', '.py', 'code', 'ide', 'program'],
    tools: [
      {
        action: 'read',
        description: 'Read the file shown in KhervePY (or an open tab by path): path, text, unsaved changes, plus the open tabs and the project folder.',
        inputSchema: object({ path: str('An open file (default: the one shown).') }),
        readOnly: true,
      },
      {
        action: 'set_code',
        description: 'Replace the whole text of the file shown in KhervePY (or of "path", opened or created first). Saved with khervepy_save or before a run.',
        inputSchema: object({ code: str('The new file text.'), path: str('A file, e.g. "~/Documents/demo.py" (default: the one shown).') }, ['code']),
      },
      {
        action: 'replace',
        description: 'Find text in the file shown in KhervePY and replace it (exact match).',
        inputSchema: object({ find: str('The exact text to find.'), replace: str('What to put instead.'), all: bool('Every match (default: the first).') }, ['find', 'replace']),
      },
      {
        action: 'open_file',
        description: 'Open a file in a KhervePY tab (create=true makes it, empty, when missing).',
        inputSchema: object({ path: str('The file, e.g. "~/Documents/main.py".'), create: bool('Create it if missing.') }, ['path']),
      },
      {
        action: 'run',
        description: 'Save and run the Python file shown in KhervePY (asks the user first). Returns the exit code and what it printed.',
        inputSchema: object({ max_chars: int('Cut the output to this many characters (default 8000).') }),
      },
      {
        action: 'save',
        description: 'Save the file shown in KhervePY (or every open file).',
        inputSchema: object({ all: bool('Save every open file.') }),
      },
    ],
  },
  {
    app: 'khervepaint',
    name: 'KhervePaint',
    summary: 'the vector drawing app (shapes, lines, arrows, text; .svg / .kpaint).',
    keywords: ['khervepaint', 'paint', 'drawing', 'draw', 'diagram', 'sketch', 'shape', 'shapes', 'svg', 'kpaint'],
    tools: [
      {
        action: 'get_drawing',
        description: 'The open drawing: its size in pixels and every item (id, kind, position, text).',
        inputSchema: object({}),
        readOnly: true,
      },
      {
        action: 'add_shape',
        description:
          'Draw a shape (pixels, origin top-left, y down): rect, roundrect, ellipse with box [x, y, w, h]; line or arrow with box [x1, y1, x2, y2]; text at [x, y]. Rect/ellipse can carry a text label. One undo step.',
        inputSchema: object(
          {
            shape: { type: 'string', enum: ['rect', 'roundrect', 'ellipse', 'line', 'arrow', 'text'], description: 'What to draw.' },
            box: { type: 'array', items: { type: 'number' }, description: '[x, y, w, h], or [x1, y1, x2, y2] for line/arrow, or [x, y] for text.' },
            text: str('The text (text items), or a label inside a rect/ellipse.'),
            color: str('Stroke / text colour, "#rrggbb" (default: dark grey).'),
            fill: str('Fill colour "#rrggbb" for shapes (default: none).'),
            width: { type: 'number', description: 'Line width in pixels (default 2); font size in points for text (default 14).' },
          },
          ['shape', 'box'],
        ),
      },
      {
        action: 'delete_items',
        description: 'Delete items of the drawing by id (from khervepaint_get_drawing). One undo step.',
        inputSchema: object({ ids: { type: 'array', items: { type: 'integer' }, description: 'Item ids.' } }, ['ids']),
      },
      {
        action: 'save',
        description: 'Save the drawing (.svg or .kpaint). A drawing never saved needs "path".',
        inputSchema: object({ path: str('Where, e.g. "~/Documents/figure.svg" (default: its own file).') }),
      },
    ],
  },
  {
    app: 'khervepdf',
    name: 'KhervePDF',
    summary: 'the PDF reader and editor (tabs, annotations, pages).',
    keywords: ['khervepdf', 'pdf', 'pdfs', 'page', 'pages'],
    tools: [
      {
        action: 'get_info',
        description: 'The PDFs open in KhervePDF (tabs) and the shown one\'s path, page count, current page, title and outline.',
        inputSchema: object({}),
        readOnly: true,
      },
      {
        action: 'read_text',
        description: 'The text of pages of the shown PDF (1 = first page). Default: from the current page, as much as fits.',
        inputSchema: object({ from_page: int('First page (1-based).'), to_page: int('Last page (default: the end).'), max_chars: int('At most this many characters (default 20000).') }),
        readOnly: true,
      },
      {
        action: 'go_to_page',
        description: 'Show a page of the PDF in KhervePDF.',
        inputSchema: object({ page: int('Page number (1 = first).') }, ['page']),
      },
      {
        action: 'search',
        description: 'Find words in the shown PDF: the pages they are on and how often, then shows the first one.',
        inputSchema: object({ text: str('What to find.') }, ['text']),
      },
      {
        action: 'open',
        description: 'Open a PDF file in a new KhervePDF tab.',
        inputSchema: object({ path: str('The PDF, e.g. "~/Documents/paper.pdf".') }, ['path']),
      },
    ],
  },
  {
    app: 'files',
    name: 'Files',
    summary: 'the file manager window.',
    keywords: ['files', 'file manager', 'finder', 'folder', 'folders'],
    tools: [
      {
        action: 'open_folder',
        description: 'Show a folder in the Files window, and return what is in it.',
        inputSchema: object({ path: str('The folder, e.g. "~/Documents".') }, ['path']),
      },
      {
        action: 'select',
        description: 'Select items in the folder shown in Files (by name), so the user sees them.',
        inputSchema: object({ names: { type: 'array', items: { type: 'string' }, description: 'File or folder names in that folder.' } }, ['names']),
      },
    ],
  },
  ...COMMUNICATION_TOOL_SETS,
  ...SYSTEM_TOOL_SETS,
  ...GAME_TOOL_SETS,
]

export function appToolSet(app: string): AppToolSet | undefined {
  return APP_TOOL_SETS.find((s) => s.app === app)
}

// KherveMol (its tools' code: src/apps/khervemol/aiTools.ts)
import { KHERVEMOL_TOOL_SET } from './manifests/khervemol.ts'
APP_TOOL_SETS.push(KHERVEMOL_TOOL_SET)

// KherveCAD (its tools' code: src/apps/khervecad/aiTools.ts)
import { KHERVECAD_TOOL_SET } from './manifests/khervecad.ts'
APP_TOOL_SETS.push(KHERVECAD_TOOL_SET)

// Notes (its tools' code: src/apps/notes/aiTools.ts)
import { NOTES_TOOL_SET } from './manifests/notes.ts'
APP_TOOL_SETS.push(NOTES_TOOL_SET)

// KherveWord (its tools' code: src/apps/kherveword/aiTools.ts)
import { KHERVEWORD_TOOL_SET } from './manifests/kherveword.ts'
APP_TOOL_SETS.push(KHERVEWORD_TOOL_SET)

// KherveCalc (its tools' code: src/apps/khervecalc/aiTools.ts)
import { KHERVECALC_TOOL_SET } from './manifests/khervecalc.ts'
APP_TOOL_SETS.push(KHERVECALC_TOOL_SET)

// The technique apps of KherveFitting-AI (their tools' code: src/apps/khervetech/aiTools.ts)
import { KHERVETGA_TOOL_SET } from './manifests/khervetga.ts'
import { KHERVEBET_TOOL_SET } from './manifests/khervebet.ts'
APP_TOOL_SETS.push(KHERVETGA_TOOL_SET, KHERVEBET_TOOL_SET)
