// Every action of the desktop KherveTeX main window (mainwindow.py
// _build_actions): its label (the desktop's text, without the & accelerator),
// its toolbar icon (the desktop's own icon, drawn by khervedoc/icons.py and
// rendered to public/apps/khervetex/icons/) and its tooltip.
//
// The toolbars and the menus both read this table, so they say the same thing.

export interface ActionDef {
  label: string
  /** Icon file name in public/apps/khervetex/icons (without .png). */
  icon?: string
  /** Tooltip, when the desktop sets one; otherwise the label. */
  tip?: string
  shortcut?: string
}

export const ICON_BASE = `${import.meta.env.BASE_URL}apps/khervetex/icons/`
export const iconUrl = (name: string) => `${ICON_BASE}${name}.png`

export const ACTIONS = {
  // File
  new: { label: 'New', icon: 'file-new' },
  newWindow: { label: 'New window' },
  open: { label: 'Open...', icon: 'file-open', shortcut: '⌘O' },
  openInNewWindow: { label: 'Open in new window...' },
  save: { label: 'Save', icon: 'file-save', shortcut: '⌘S' },
  saveAs: { label: 'Save As...', shortcut: '⇧⌘S' },
  closeDoc: { label: 'Close document' },
  newProject: { label: 'New project...' },
  openProject: { label: 'Open project...', icon: 'project-open' },
  saveProject: { label: 'Save project' },
  closeProject: { label: 'Close project' },
  importTex: { label: 'Import .tex...' },
  importDocx: { label: 'Import .docx...' },
  importPdf: { label: 'Import .pdf...' },
  importMd: { label: 'Import .md...' },
  exportTex: { label: 'Export .tex...' },
  exportZip: { label: 'Export LaTeX package (.zip)...' },
  exportDocx: { label: 'Export .docx...' },
  exportPdf: { label: 'Export .pdf...', icon: 'export-pdf' },
  print: { label: 'Print…', icon: 'printer', shortcut: '⌘P' },
  printPreview: { label: 'Print preview…', icon: 'print-preview', shortcut: '⇧⌘P' },
  showInExplorer: { label: 'Show in file explorer' },
  docProps: { label: 'Document properties...' },
  manageStyles: { label: 'Manage styles…' },
  quit: { label: 'Quit' },
  // Edit
  undo: { label: 'Undo', icon: 'undo', shortcut: '⌘Z' },
  redo: { label: 'Redo', icon: 'redo', shortcut: '⇧⌘Z' },
  cut: { label: 'Cut', shortcut: '⌘X' },
  copy: { label: 'Copy', shortcut: '⌘C' },
  paste: { label: 'Paste', shortcut: '⌘V' },
  selectAll: { label: 'Select All', shortcut: '⌘A' },
  clearFormat: { label: 'Clear formatting' },
  find: { label: 'Find...', shortcut: '⌘F' },
  replace: { label: 'Replace...', shortcut: '⌃H' },
  // Alignment, columns
  alignLeft: { label: 'Align left', icon: 'align-left' },
  alignCenter: { label: 'Align center', icon: 'align-center' },
  alignRight: { label: 'Align right', icon: 'align-right' },
  alignJustify: { label: 'Justify', icon: 'align-justify' },
  cols1: { label: '1 column', icon: 'one-column' },
  cols2: { label: '2 columns', icon: 'two-columns' },
  cols3: { label: '3 columns', icon: 'three-columns' },
  // Format
  bold: { label: 'Bold', icon: 'bold', shortcut: '⌘B' },
  italic: { label: 'Italic', icon: 'italic', shortcut: '⌘I' },
  underline: { label: 'Underline', icon: 'underline', shortcut: '⌘U' },
  strike: { label: 'Strikethrough', icon: 'strike' },
  code: { label: 'Code (monospace)', icon: 'code' },
  smallcaps: { label: 'Small caps', icon: 'smallcaps' },
  subscript: { label: 'Subscript', icon: 'subscript' },
  superscript: { label: 'Superscript', icon: 'superscript' },
  // Insert
  mathInline: { label: 'Inline math', icon: 'math-inline', shortcut: '⌘M' },
  mathBlock: { label: 'Math block', icon: 'math-block', shortcut: '⇧⌘M' },
  bullet: { label: 'Bullet list', icon: 'bullet-list' },
  ordered: { label: 'Numbered list', icon: 'numbered-list' },
  link: { label: 'Hyperlink...', icon: 'link', shortcut: '⌘K' },
  footnote: { label: 'Footnote...', icon: 'footnote' },
  citation: { label: 'Citation...', icon: 'citation' },
  checkCitations: { label: 'Check citations', tip: 'List cited keys that no kRef library or bibliography file defines' },
  crossref: { label: 'Cross-reference...', icon: 'cross-ref' },
  figure: { label: 'Figure...', icon: 'figure' },
  table: { label: 'Table...', icon: 'table' },
  drawing: { label: 'Drawing…', icon: 'drawing' },
  flowchart: { label: 'Flowchart builder…', icon: 'flowchart-builder', shortcut: '⇧⌘F' },
  rawLatex: { label: 'Raw LaTeX...' },
  compileStart: { label: 'Compile start marker', tip: 'Insert a compile-range start marker' },
  compileEnd: { label: 'Compile end marker', tip: 'Insert a compile-range end marker' },
  notCompileStart: { label: 'Not-compile start marker', tip: 'Insert a not-compile start marker (content after this is skipped)' },
  notCompileEnd: { label: 'Not-compile end marker', tip: 'Insert a not-compile end marker (resume compiling here)' },
  codeBlock: { label: 'Code block...' },
  symbol: { label: 'Symbol...', icon: 'symbol', shortcut: '⇧⌘G' },
  equationBuilder: { label: 'Equation builder...', icon: 'equation-builder', shortcut: '⇧⌘E' },
  chemistry: { label: 'Chemical reaction...', icon: 'chemistry' },
  chemfig: { label: 'Chemical structure...', icon: 'chemfig-structure' },
  abstract: { label: 'Abstract paragraph' },
  keywords: { label: 'Keywords paragraph' },
  pagebreak: { label: 'Page break', icon: 'page-break' },
  hrule: { label: 'Horizontal rule', icon: 'horizontal-rule' },
  multicol: { label: 'Multi-column region (2)...' },
  // View
  viewVisual: { label: 'Show Visual tab', shortcut: '⌘1' },
  viewCode: { label: 'Show Code tab', shortcut: '⌘2' },
  viewPdf: { label: 'Show PDF', shortcut: '⌘3' },
  viewConsole: { label: 'Show Console', shortcut: '⌘6' },
  sideBySide: { label: 'PDF side panel', shortcut: '⌘4' },
  visualOnly: { label: 'Visual only (like Word)', tip: 'Hide the PDF and stop compiling while you write' },
  pdfWindow: { label: 'PDF in its own window', tip: 'Show the PDF in a separate window, e.g. on a second screen' },
  documents: { label: 'Documents', shortcut: '⌘5' },
  fitPageWidth: { label: 'Fit page width', shortcut: '⌘0' },
  spell: { label: 'Check spelling', icon: 'spell-check', tip: 'Underline misspelled English words in red. Toggle from the toolbar or View menu.' },
  marks: { label: 'Show formatting marks', icon: 'formatting-marks', tip: 'Show spaces and paragraph marks (¶)' },
  // Git
  commitNow: { label: 'Save snapshot and upload', icon: 'commit', tip: 'Save your work, create a version snapshot, and upload it to the cloud (GitHub, GitLab, etc.)' },
  pull: { label: 'Download latest from cloud', tip: 'Download the newest version of this document from the cloud (e.g. if a collaborator made changes)' },
  remotes: { label: 'Connect to GitHub / GitLab…', tip: 'Set up a cloud link so your document is backed up online and can be shared with others' },
  history: { label: 'View version history…', icon: 'history', tip: 'Browse every saved snapshot of this document and see what changed each time' },
  branches: { label: 'Branches…', icon: 'branch', tip: 'View, create, switch or delete branches' },
  // Review
  highlight: { label: 'Highlight', icon: 'highlight', shortcut: '⇧⌘H', tip: 'Highlight selected text' },
  removeHighlight: { label: 'Remove highlight' },
  comment: { label: 'New comment', icon: 'comment', shortcut: '⌥⌘M', tip: 'Add a reviewer comment to the selected text' },
  acceptComment: { label: 'Accept', icon: 'accept-change', tip: 'Accept comment and keep the text' },
  rejectComment: { label: 'Reject', icon: 'reject-change', tip: 'Reject comment and delete the text' },
  prevComment: { label: '← Previous comment', icon: 'prev-comment', shortcut: '⇧⌘[' },
  nextComment: { label: '→ Next comment', icon: 'next-comment', shortcut: '⇧⌘]' },
  // Compile
  compile: { label: 'Compile PDF', icon: 'compile-pdf', tip: 'Compile the PDF now', shortcut: '⌘↩' },
  auto: { label: 'Auto-compile', icon: 'auto-compile-on', tip: 'Toggle automatic PDF compilation on every edit' },
  skipImages: { label: 'Skip images', icon: 'compile-no-images', tip: 'Compile without images for faster preview' },
  compileRange: { label: 'Compile range', icon: 'compile-range', tip: 'Only compile content between compile markers' },
  // Help
  helpGuide: { label: 'User guide', shortcut: 'F1' },
  shortcuts: { label: 'Keyboard shortcuts' },
  about: { label: 'About kTeX' },
} satisfies Record<string, ActionDef>

export type ActionId = keyof typeof ACTIONS

/** The toolbar tooltip: the desktop's tooltip, else its label (shortcut added, as Qt shows it on macOS menus). */
export function tipOf(id: ActionId): string {
  const a: ActionDef = ACTIONS[id]
  const text = a.tip ?? a.label
  return a.shortcut ? `${text} (${a.shortcut})` : text
}
