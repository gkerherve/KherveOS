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
]

export function appToolSet(app: string): AppToolSet | undefined {
  return APP_TOOL_SETS.find((s) => s.app === app)
}
