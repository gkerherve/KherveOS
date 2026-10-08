// KherveWord: a word processor like Word, Pages or LibreOffice Writer —
// a ribbon, white paginated pages with rulers, styles, lists, tables,
// pictures, headers and footers, footnotes, equations, a table of contents,
// comments and tracked changes; .docx in and out (and .odt/.rtf/.md/.html/.txt
// in), PDF out, autosave and recovery, AI tools for KherveAI and MCP.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import {
  Bold, ClipboardPaste, Copy, Download, FileDown, FilePlus, FolderOpen, Italic, LayoutTemplate, Printer, Redo2, Save, Scissors, Search, Undo2,
  Underline, ZoomIn, ZoomOut, FileText, Globe,
} from 'lucide-react'
import { os, fs, path, HOME, type AppProps, type MenuItem } from '@/os'
import { useAppTools } from '@/os/ai/appTools'
import {
  MARGIN_PRESETS, PAGE_SIZES, PX_PER_PT, countWords, defaultSettings, emptyDoc, expandTokens, hfIsEmpty, newId, nodeText, pageDims,
  type Comment, type DocSettings, type HeaderFooter, type PMNode, type StyleDef, type WordDoc,
} from './model'
import { wordExtensions, goToPos, type WordEnv } from './editor/extensions'
import { computeLayout, emptyLayout, layoutKey, sameLayout, type Geometry, type LayoutResult } from './editor/layout'
import { findNext } from './editor/find'
import { listChanges, listCommentRanges, removeCommentMarks, reviewChanges } from './editor/tracking'
import { stylesCss } from './formats/html'
import { docToHtml } from './formats/html'
import {
  NO_SNAPSHOT, applyPainter, capturePainter, growFont, headingList, insertImage, insertTable, selectWordIfEmpty, setNodeAttrs, setParagraph, snapshot,
  type Painter, type Snapshot,
} from './commands'
import { Ribbon, type RibbonTab } from './ui/Ribbon'
import { HRuler, VRuler } from './ui/Ruler'
import { CommentsPane, FindBar, NavigationPane } from './ui/panes'
import {
  EquationDialog, HeaderFooterDialog, ImageDialog, LinkDialog, Modal, PageSetupDialog, ParagraphDialog, StyleDialog, SymbolDialog, TemplateDialog, TextDialog,
  WordCountDialog,
} from './ui/dialogs'
import type { DialogKind, WordActions } from './ui/types'
import {
  OPEN_TYPES, SAVE_TYPES, bytesToDataUrl, defaultPageSize, dropAutosave, encodeDocument, leftoverAutosaves, openDocument, readAutosave, writeAutosave,
} from './io'
import { htmlToPdfInWorker } from './pdf'
import { printPages } from './print'
import { templateDoc, type TemplateId } from './templates'
import { kherveWordAiTools } from './aiTools'
import '@typopro/web-liberation/TypoPRO-Liberation.css'
import './kherveword.css'

const GAP = 24
const IMAGE_TYPES = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp' }
const AUTHOR_KEY = 'kherveword.author'

/** KherveWord windows open in this tab (their autosave files are not leftovers). */
const openWindows = new Set<string>()

function storedAuthor(): string {
  try {
    return localStorage.getItem(AUTHOR_KEY) || 'Me'
  } catch {
    return 'Me'
  }
}

type DialogState = { kind: DialogKind; data?: Record<string, unknown> } | null

/** The editor's view once TipTap has mounted it (TipTap 3 throws before that). */
function viewOf(ed: { view: unknown } | null | undefined) {
  if (!ed) return null
  try {
    const v = ed.view as { dom?: HTMLElement }
    return v && v.dom ? (ed.view as import('@tiptap/pm/view').EditorView) : null
  } catch {
    return null
  }
}

export default function KherveWord({ win, args }: AppProps) {
  // ---------------------------------------------------------------- document state
  const [settings, setSettingsState] = useState<DocSettings>(() => defaultSettings(defaultPageSize()))
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const [filePath, setFilePath] = useState<string | null>(null)
  const [format, setFormat] = useState<string>('docx')
  const [loading, setLoading] = useState(!!(args.path || args.recover))
  const versionRef = useRef(0)
  const [version, setVersion] = useState(0)
  const [savedVersion, setSavedVersion] = useState(0)
  const dirty = version !== savedVersion
  const live = useRef({ filePath, format, dirty, loading })
  live.current = { filePath, format, dirty, loading }
  const bump = useCallback(() => {
    versionRef.current++
    setVersion(versionRef.current)
  }, [])
  const updateSettings = useCallback(
    (fn: (s: DocSettings) => DocSettings) => {
      const next = fn(settingsRef.current)
      settingsRef.current = next
      setSettingsState(next)
      bump()
    },
    [bump],
  )

  // ---------------------------------------------------------------- view state
  const [zoom, setZoomState] = useState(1)
  const [view, setView] = useState<'print' | 'web'>('print')
  const [ruler, setRuler] = useState(true)
  const [nav, setNav] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [focusComment, setFocusComment] = useState<string | null>(null)
  const [marks, setMarks] = useState(false)
  const [spell, setSpell] = useState(true)
  const [find, setFindOpen] = useState<{ replace: boolean } | null>(null)
  const [tab, setTab] = useState<RibbonTab>('home')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [painter, setPainter] = useState<Painter | null>(null)
  const [author, setAuthorState] = useState(storedAuthor)
  const authorRef = useRef(author)
  authorRef.current = author
  const [layout, setLayout] = useState<LayoutResult>(emptyLayout())
  const layoutRef = useRef(layout)
  const [stats, setStats] = useState({ words: 0, chars: 0, selWords: 0, page: 1 })
  const canvasRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)

  // ---------------------------------------------------------------- geometry
  const { w: pageWpt, h: pageHpt } = pageDims(settings.page)
  const pageW = pageWpt * PX_PER_PT
  const pageH = pageHpt * PX_PER_PT
  const m = settings.page.margins
  const mpx = { top: m.top * PX_PER_PT, bottom: m.bottom * PX_PER_PT, left: m.left * PX_PER_PT, right: m.right * PX_PER_PT }
  const [canvasW, setCanvasW] = useState(900)
  const webW = Math.max(320, canvasW / zoom - 40)
  const paged = view === 'print'
  const pages = paged ? Math.max(1, layout.pages) : 1
  const totalH = paged ? pages * (pageH + GAP) - GAP : 0
  const geomRef = useRef<Geometry>({ paged, pageW, pageH, gap: GAP, ...mpx, scale: zoom, defaultTab: 48 })
  geomRef.current = paged ? { paged, pageW, pageH, gap: GAP, ...mpx, scale: zoom, defaultTab: 48 } : { paged, pageW: webW, pageH: 0, gap: 0, top: 24, bottom: 24, left: 32, right: 32, scale: zoom, defaultTab: 48 }

  // ---------------------------------------------------------------- the editor
  const tocSubs = useRef(new Set<() => void>())
  const tocRef = useRef<{ text: string; level: number; page: number; pos: number }[]>([])
  const editRef = useRef<(kind: string, pos: number) => void>(() => {})
  const layoutTimer = useRef(0)
  const unstable = useRef(0)
  const editorRef = useRef<Editor | null>(null)

  const runLayout = useCallback(() => {
    layoutTimer.current = 0
    const ed = editorRef.current
    if (!ed || ed.isDestroyed) return
    const edView = viewOf(ed)
    if (!edView) {
      layoutTimer.current = requestAnimationFrame(runLayout)
      return
    }
    const r = computeLayout(edView, geomRef.current)
    // Table of contents: headings and their pages.
    const pageOf = new Map(r.blockPages.map((b) => [b.pos, b.page]))
    const toc = headingList(ed, settingsRef.current.styles).map((h) => ({ ...h, page: (pageOf.get(h.pos) ?? 0) + 1 }))
    if (JSON.stringify(toc) !== JSON.stringify(tocRef.current)) {
      tocRef.current = toc
      for (const fn of tocSubs.current) fn()
    }
    if (sameLayout(r, layoutRef.current)) {
      unstable.current = 0
      return
    }
    // Guard against a layout that keeps flipping (rounding at a page edge).
    if (++unstable.current > 8) return
    layoutRef.current = r
    setLayout(r)
    ed.view.dispatch(ed.state.tr.setMeta(layoutKey, r).setMeta('addToHistory', false).setMeta('kwNoTrack', true))
  }, [])
  const scheduleLayout = useCallback(() => {
    if (!layoutTimer.current) layoutTimer.current = requestAnimationFrame(runLayout)
  }, [runLayout])

  const env: WordEnv = useMemo(
    () => ({
      styles: () => settingsRef.current.styles,
      toc: () => tocRef.current,
      subscribeToc: (fn) => {
        tocSubs.current.add(fn)
        return () => tocSubs.current.delete(fn)
      },
      edit: (kind, pos) => editRef.current(kind, pos),
      goTo: (pos) => editorRef.current && goToPos(editorRef.current.view, pos),
      viewUpdated: () => scheduleLayout(),
      tracking: () => ({ on: settingsRef.current.trackChanges, author: authorRef.current }),
    }),
    [scheduleLayout],
  )

  const editor = useEditor(
    {
      extensions: wordExtensions(env),
      content: emptyDoc(),
      editorProps: {
        attributes: { class: 'kw-editor', spellcheck: 'true' },
        handleClick: (view, pos, event) => {
          if (!(event.metaKey || event.ctrlKey)) return false
          const link = view.state.doc.resolve(pos).marks().find((mk) => mk.type.name === 'link')
          if (!link) return false
          const href = String(link.attrs.href ?? '')
          if (href.startsWith('#')) return false
          os.openUrl(href)
          return true
        },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
          if (!files.length) return false
          for (const f of files) void blobToImage(f)
          return true
        },
        handleDrop: (_view, event) => {
          const files = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'))
          if (!files.length) return false
          event.preventDefault()
          for (const f of files) void blobToImage(f)
          return true
        },
      },
      onUpdate: ({ transaction }) => {
        unstable.current = 0
        if (!transaction.getMeta('kwSilent')) bump()
      },
    },
    [],
  )
  editorRef.current = editor
  const snap: Snapshot = useEditorState({ editor, selector: ({ editor: e }) => (e ? snapshot(e, settingsRef.current.styles) : NO_SNAPSHOT) }) ?? NO_SNAPSHOT

  async function blobToImage(f: Blob) {
    const ed = editorRef.current
    if (!ed) return
    const url = await bytesToDataUrl(new Uint8Array(await f.arrayBuffer()), f.type || 'image/png')
    insertImage(ed, url)
  }

  // TipTap mounts its view after the first render: effects that need it wait for this.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (!editor) return
    const check = () => setMounted(!!viewOf(editor))
    check()
    const t = requestAnimationFrame(check)
    editor.on('create', check)
    editor.on('mount' as never, check)
    return () => {
      cancelAnimationFrame(t)
      editor.off('create', check)
      editor.off('mount' as never, check)
    }
  }, [editor])

  // Layout again when the geometry, styles, zoom or fonts change.
  useEffect(() => {
    unstable.current = 0
    scheduleLayout()
  }, [scheduleLayout, pageW, pageH, mpx.top, mpx.bottom, mpx.left, mpx.right, zoom, view, settings.styles, webW])
  useEffect(() => {
    const v = viewOf(editor)
    if (!v) return
    const ro = new ResizeObserver(() => scheduleLayout())
    ro.observe(v.dom)
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    const onFonts = () => {
      unstable.current = 0
      scheduleLayout()
    }
    fonts?.addEventListener?.('loadingdone', onFonts)
    void fonts?.ready.then(onFonts)
    return () => {
      ro.disconnect()
      fonts?.removeEventListener?.('loadingdone', onFonts)
    }
  }, [editor, mounted, scheduleLayout])
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setCanvasW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const v = viewOf(editor)
    v?.dom.setAttribute('spellcheck', String(spell))
    v?.dom.setAttribute('lang', settings.lang || 'en')
  }, [editor, mounted, spell, settings.lang])
  useEffect(() => () => cancelAnimationFrame(layoutTimer.current), [])

  // Word count and the page of the cursor (a little after typing stops).
  useEffect(() => {
    if (!editor) return
    const t = window.setTimeout(() => {
      const doc = editor.state.doc
      const text = nodeText(doc.toJSON() as PMNode)
      const sel = editor.state.selection
      const selText = sel.empty ? '' : doc.textBetween(sel.from, sel.to, ' ', ' ')
      let page = 1
      if (paged && pagesRef.current) {
        try {
          const c = editor.view.coordsAtPos(sel.head)
          const top = pagesRef.current.getBoundingClientRect().top
          page = Math.min(pages, Math.floor((c.top - top) / zoom / (pageH + GAP)) + 1)
        } catch {
          /* not laid out yet */
        }
      }
      setStats({ words: countWords(text), chars: text.replace(/\n/g, '').length, selWords: countWords(selText), page: Math.max(1, page) })
    }, 250)
    return () => clearTimeout(t)
  }, [editor, version, snap, paged, pages, pageH, zoom])

  // ---------------------------------------------------------------- loading
  const loadDoc = useCallback(
    (wd: WordDoc) => {
      const ed = editorRef.current
      if (!ed) return
      settingsRef.current = wd.settings
      setSettingsState(wd.settings)
      let node
      try {
        node = ed.schema.nodeFromJSON(wd.doc)
        node.check()
      } catch {
        // Something the schema does not allow: let TipTap repair it.
        ed.commands.setContent(wd.doc as never, { emitUpdate: false })
        node = ed.state.doc
      }
      // A fresh state: no undo history from the previous document.
      const state = EditorState.create({ doc: node, plugins: ed.state.plugins, selection: TextSelection.atStart(node) })
      ed.view.updateState(state)
      layoutRef.current = emptyLayout()
      setLayout(emptyLayout())
      unstable.current = 0
      scheduleLayout()
    },
    [scheduleLayout],
  )

  const markSaved = useCallback(() => setSavedVersion(versionRef.current), [])

  const loadPath = useCallback(
    async (p: string) => {
      const ed = editorRef.current
      if (!ed) return
      setLoading(true)
      try {
        const { wd, format: f, template } = await openDocument(p, ed.schema)
        loadDoc(wd)
        if (template) {
          setFilePath(null)
          setFormat('docx')
        } else {
          setFilePath(p)
          setFormat(f)
        }
        bump()
        markSaved()
      } catch (e) {
        await os.dialog.alert(`Could not open ${path.basename(p)}: ${e instanceof Error ? e.message : e}`, { title: 'kWord' })
      } finally {
        setLoading(false)
      }
    },
    [bump, loadDoc, markSaved],
  )

  useEffect(() => {
    if (!editor) return
    openWindows.add(win.id)
    if (args.path) void loadPath(String(args.path))
    else if (args.recover) {
      void (async () => {
        const data = await readAutosave(String(args.recover))
        if (data) {
          loadDoc(data.wd)
          setFilePath(data.path)
          setFormat(data.path ? path.extname(data.path).slice(1) || 'docx' : 'docx')
          bump()
          await fs.remove(String(args.recover)).catch(() => undefined)
          os.notify({ title: 'Document recovered', body: 'Save it to keep it.' })
        }
        setLoading(false)
      })()
    } else if (args.template) {
      loadDoc(templateDoc(String(args.template) as TemplateId, defaultPageSize()))
      bump()
    } else {
      // Unsaved documents from an earlier session?
      const t = window.setTimeout(async () => {
        const left = leftoverAutosaves(openWindows)
        if (!left.length) return
        const choice = await os.dialog.choose(
          `kWord kept ${left.length === 1 ? 'an unsaved document' : `${left.length} unsaved documents`} from an earlier session. Recover ${left.length === 1 ? 'it' : 'them'}?`,
          [
            { label: 'Discard', value: 'discard', danger: true },
            { label: 'Not now', value: 'later' },
            { label: 'Recover', value: 'recover', primary: true },
          ],
          { title: 'Recover documents' },
        )
        if (choice === 'recover') for (const p of left) os.open('kherveword', { recover: p, _n: p })
        else if (choice === 'discard') for (const p of left) await fs.remove(p).catch(() => undefined)
      }, 1500)
      return () => {
        clearTimeout(t)
        openWindows.delete(win.id)
      }
    }
    return () => {
      openWindows.delete(win.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  // Title, document path.
  const name = filePath ? path.basename(filePath) : settings.title && settings.title !== 'Document' ? `${settings.title}` : 'Untitled'
  useEffect(() => win.setTitle(`${dirty ? '• ' : ''}${name} — kWord`), [win, name, dirty])
  useEffect(() => win.setDocumentPath(filePath), [win, filePath])

  // Follow renames of the open file.
  useEffect(
    () =>
      fs.watch((ev) => {
        const cur = live.current.filePath
        if (cur && ev.type === 'rename' && path.isInside(cur, ev.oldPath)) setFilePath(ev.path + cur.slice(ev.oldPath.length))
      }),
    [],
  )

  // Autosave every 30 s while there are unsaved changes.
  const autosaved = useRef(-1)
  useEffect(() => {
    const t = window.setInterval(() => {
      const ed = editorRef.current
      if (!ed || !live.current.dirty || autosaved.current === versionRef.current) return
      autosaved.current = versionRef.current
      void writeAutosave(win.id, { wd: { doc: ed.getJSON() as PMNode, settings: settingsRef.current }, path: live.current.filePath, savedAt: new Date().toISOString(), window: win.id }).catch(() => undefined)
    }, 30_000)
    return () => clearInterval(t)
  }, [win.id])

  // ---------------------------------------------------------------- saving
  const currentDoc = useCallback((): WordDoc => ({ doc: editorRef.current!.getJSON() as PMNode, settings: settingsRef.current }), [])
  const headingPages = () => tocRef.current.map((h) => h.page)

  const writeTo = useCallback(
    async (p: string): Promise<string> => {
      const bytes = await encodeDocument(p, currentDoc(), headingPages(), tocRef.current)
      await fs.writeBytes(p, bytes, { mkdirs: true })
      setFilePath(p)
      setFormat(path.extname(p).slice(1).toLowerCase())
      markSaved()
      autosaved.current = -1
      void dropAutosave(win.id)
      return p
    },
    [currentDoc, markSaved, win.id],
  )

  const saveAs = useCallback(async (): Promise<boolean> => {
    const fp = live.current.filePath
    const base = fp ? fp.replace(/\.[^./]+$/, '') : `${HOME}/Documents/${(settingsRef.current.title || 'Untitled').replace(/[\\/:*?"<>|]/g, '-')}`
    const target = await os.dialog.saveFile({ title: 'Save As', defaultName: `${base}.docx`, extensions: SAVE_TYPES })
    if (!target) return false
    try {
      await writeTo(target)
      return true
    } catch (e) {
      await os.dialog.alert(`Could not save: ${e instanceof Error ? e.message : e}`)
      return false
    }
  }, [writeTo])

  const keptFormat = useRef(false)
  const save = useCallback(async (): Promise<boolean> => {
    const { filePath: fp, format: f } = live.current
    if (!fp || !fs.exists(path.dirname(fp)) || !['docx', 'html', 'htm', 'md', 'txt'].includes(f)) return saveAs()
    if ((f === 'txt' || f === 'md') && !keptFormat.current) {
      const choice = await os.dialog.choose(
        `${path.basename(fp)} is a ${f === 'txt' ? 'plain text' : 'Markdown'} file: pictures, colours, fonts and page setup cannot be kept in it.`,
        [
          { label: 'Cancel', value: 'cancel' },
          { label: `Keep ${f === 'txt' ? 'Text' : 'Markdown'}`, value: 'keep' },
          { label: 'Save as Word (.docx)', value: 'docx', primary: true },
        ],
        { title: 'Save' },
      )
      if (choice === 'docx') return saveAs()
      if (choice !== 'keep') return false
      keptFormat.current = true
    }
    try {
      await writeTo(fp)
      return true
    } catch (e) {
      await os.dialog.alert(`Could not save: ${e instanceof Error ? e.message : e}`)
      return false
    }
  }, [saveAs, writeTo])

  // Ask before closing with unsaved changes.
  useEffect(() => {
    win.setCloseGuard(async () => {
      if (!live.current.dirty) {
        void dropAutosave(win.id)
        return true
      }
      const choice = await os.dialog.choose(
        `Save the changes to "${live.current.filePath ? path.basename(live.current.filePath) : settingsRef.current.title || 'Untitled'}" before closing?`,
        [
          { label: 'Cancel', value: 'cancel' },
          { label: "Don't save", value: 'discard', danger: true },
          { label: 'Save', value: 'save', primary: true },
        ],
        { title: 'Unsaved changes' },
      )
      if (choice === 'save') {
        const ok = await save()
        if (ok) void dropAutosave(win.id)
        return ok
      }
      if (choice === 'discard') {
        void dropAutosave(win.id)
        return true
      }
      return false
    })
    return () => win.setCloseGuard(null)
  }, [win, save])

  const pdfToDrive = useCallback(
    async (target: string | null): Promise<{ path: string; pages: number }> => {
      const wd = currentDoc()
      const fp = live.current.filePath
      const p = target ?? (fp ? fp.replace(/\.[^./]+$/, '.pdf') : `${HOME}/Documents/${(wd.settings.title || 'Untitled').replace(/[\\/:*?"<>|]/g, '-')}.pdf`)
      const { w, h } = pageDims(wd.settings.page)
      const html = docToHtml(wd, { mode: 'pdf', toc: tocRef.current })
      const { pdf, pages: n } = await htmlToPdfInWorker(html, w, h)
      await fs.writeBytes(p, pdf, { mkdirs: true })
      return { path: p, pages: n }
    },
    [currentDoc],
  )

  const exportPdfToDrive = useCallback(async () => {
    const fp = live.current.filePath
    const base = fp ? fp.replace(/\.[^./]+$/, '') : `${HOME}/Documents/${settingsRef.current.title || 'Untitled'}`
    const target = await os.dialog.saveFile({ title: 'Export PDF to the drive', defaultName: `${base}.pdf`, extensions: ['.pdf'] })
    if (!target) return
    try {
      const r = await pdfToDrive(target)
      os.notify({ title: 'PDF exported', body: `${path.basename(r.path)} · ${r.pages} page${r.pages === 1 ? '' : 's'} (text layout by MuPDF; Print gives the exact pages)`, onClick: () => void os.openFile(r.path) })
    } catch (e) {
      await os.dialog.alert(`Could not make the PDF: ${e instanceof Error ? e.message : e}`)
    }
  }, [pdfToDrive])

  const print = useCallback(async () => {
    if (view !== 'print') {
      setView('print')
      await new Promise((r) => setTimeout(r, 400))
    }
    if (!pagesRef.current) return
    await printPages(pagesRef.current, { pageW, pageH, gap: GAP, pages: Math.max(1, layoutRef.current.pages) }, settingsRef.current.title || name)
  }, [view, pageW, pageH, name])

  // ---------------------------------------------------------------- AI tools
  useAppTools(
    win,
    useMemo(
      () =>
        kherveWordAiTools({
          editor: () => editorRef.current,
          loading: () => live.current.loading,
          settings: () => settingsRef.current,
          updateSettings,
          info: () => ({ path: live.current.filePath, unsaved: live.current.dirty, pages: Math.max(1, layoutRef.current.pages) }),
          save: (p) => writeTo(p ?? live.current.filePath!),
          exportPdf: (p) => pdfToDrive(p),
          load: (wd) => {
            loadDoc(wd)
            setFilePath(null)
            bump()
          },
          author: () => authorRef.current,
          pageSize: () => defaultPageSize(),
        }),
      [updateSettings, writeTo, pdfToDrive, loadDoc, bump],
    ),
  )

  // ---------------------------------------------------------------- actions
  const openFile = useCallback(async () => {
    const p = await os.dialog.openFile({ title: 'Open', startDir: live.current.filePath ? path.dirname(live.current.filePath) : `${HOME}/Documents`, extensions: OPEN_TYPES })
    if (!p) return
    // An untouched empty window opens it here; otherwise a new window.
    const ed = editorRef.current
    if (ed && !live.current.dirty && !live.current.filePath && ed.isEmpty) void loadPath(p)
    else os.open('kherveword', { path: p })
  }, [loadPath])

  const newFromTemplate = useCallback(
    (id?: TemplateId) => {
      if (!id) return setDialog({ kind: 'templates' })
      const ed = editorRef.current
      if (ed && !live.current.dirty && !live.current.filePath && ed.isEmpty) {
        loadDoc(templateDoc(id, defaultPageSize()))
        bump()
        markSaved()
      } else os.open('kherveword', { template: id, _new: Date.now() })
    },
    [loadDoc, bump, markSaved],
  )

  const insertPicture = useCallback(async () => {
    const p = await os.dialog.openFile({ title: 'Insert Picture', startDir: `${HOME}/Pictures`, extensions: IMAGE_TYPES })
    if (!p || !editorRef.current) return
    const ext = path.extname(p).toLowerCase()
    const url = await bytesToDataUrl(await fs.readBytes(p), MIME[ext] ?? 'image/png')
    insertImage(editorRef.current, url, path.basename(p).replace(/\.[^.]+$/, ''))
  }, [])

  const setZoom = useCallback(
    (z: number | 'width' | 'page') => {
      const el = canvasRef.current
      let v: number
      if (z === 'width') v = el ? (el.clientWidth - 60) / pageW : 1
      else if (z === 'page') v = el ? Math.min((el.clientWidth - 60) / pageW, (el.clientHeight - 40) / pageH) : 1
      else v = z
      setZoomState(Math.max(0.25, Math.min(5, Math.round(v * 100) / 100)))
    },
    [pageW, pageH],
  )

  const newComment = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    if (!selectWordIfEmpty(ed)) {
      void os.dialog.alert('Select the text to comment on first.', { title: 'New Comment' })
      return
    }
    const id = newId()
    updateSettings((s) => ({ ...s, comments: { ...s.comments, [id]: { author: authorRef.current, date: new Date().toISOString(), text: '' } } }))
    ed.chain().focus().setMark('comment', { id }).run()
    setCommentsOpen(true)
    setFocusComment(id)
  }, [updateSettings])

  const deleteComment = useCallback(
    (id?: string) => {
      const ed = editorRef.current
      if (!ed) return
      let target = id
      if (!target) {
        const sel = ed.state.selection
        target = listCommentRanges(ed.state).find((r) => sel.from <= r.to && sel.to >= r.from)?.id
      }
      if (!target) return
      removeCommentMarks(ed.view, target)
      const t = target
      updateSettings((s) => {
        const c = { ...s.comments }
        delete c[t]
        return { ...s, comments: c }
      })
    },
    [updateSettings],
  )

  const gotoRange = (list: { from: number; to: number }[], dir: 1 | -1) => {
    const ed = editorRef.current
    if (!ed || !list.length) return
    const sel = ed.state.selection
    const next = dir > 0 ? (list.find((r) => r.from > sel.from) ?? list[0]) : ([...list].reverse().find((r) => r.from < sel.from) ?? list[list.length - 1])
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, next.from, next.to)).scrollIntoView())
    ed.view.focus()
  }

  const insertCaption = useCallback((kind: 'Figure' | 'Table' | 'Equation') => {
    const ed = editorRef.current
    if (!ed) return
    let n = 0
    ed.state.doc.descendants((node) => {
      if (node.type.name === 'paragraph' && node.attrs.style === 'Caption' && node.textContent.startsWith(kind)) n++
      return node.type.name !== 'paragraph'
    })
    const { $from } = ed.state.selection
    const at = $from.depth > 0 ? $from.after(1) : ed.state.doc.content.size
    ed.chain()
      .insertContentAt(at, { type: 'paragraph', attrs: { style: 'Caption' }, content: [{ type: 'text', text: `${kind} ${n + 1}: ` }] })
      .focus(at + `${kind} ${n + 1}: `.length + 1)
      .run()
  }, [])

  const actions: WordActions = {
    newDoc: () => os.open('kherveword', { _new: Date.now() }),
    newFromTemplate,
    open: () => void openFile(),
    save,
    saveAs,
    exportPdf: () => void print(),
    exportPdfToDrive: () => void exportPdfToDrive(),
    print: () => void print(),
    dialog: (kind, data) => setDialog({ kind, data }),
    insertPicture: () => void insertPicture(),
    insertTable: (r, c) => editor && insertTable(editor, r, c, settingsRef.current),
    insertTOC: () => editor?.chain().focus().insertContent([{ type: 'toc' }, { type: 'paragraph', attrs: { style: 'Normal' } }]).run(),
    insertFootnote: () => setDialog({ kind: 'footnote' }),
    insertCaption,
    insertDate: () => editor?.chain().focus().insertContent({ type: 'text', text: new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) }).run(),
    newComment,
    deleteComment,
    gotoComment: (dir) => editor && gotoRange(listCommentRanges(editor.state), dir),
    gotoChange: (dir) => editor && gotoRange(listChanges(editor.state.doc), dir),
    review: (accept, which) => {
      if (!editor) return
      const n = reviewChanges(editor.view, accept, which)
      if (!n) os.notify({ title: 'No tracked changes here', body: which === 'all' ? 'The document has no tracked changes.' : 'Put the cursor in a change, or choose All.' })
    },
    toggleTrack: () => updateSettings((s) => ({ ...s, trackChanges: !s.trackChanges })),
    setAuthor: () => setDialog({ kind: 'link', data: { author: true } }),
    find: (replace) => setFindOpen({ replace }),
    painter: (sticky) => {
      if (!editor) return
      if (painter && !sticky) return setPainter(null)
      setPainter(capturePainter(editor, sticky))
    },
    painterOn: !!painter,
    copy: (cut) => {
      editor?.view.focus()
      document.execCommand(cut ? 'cut' : 'copy')
    },
    paste: async () => {
      editor?.view.focus()
      try {
        const items = await navigator.clipboard.read()
        for (const it of items) {
          const img = it.types.find((t) => t.startsWith('image/'))
          if (img) {
            await blobToImage(await it.getType(img))
            return
          }
          if (it.types.includes('text/html')) {
            const html = await (await it.getType('text/html')).text()
            editor?.chain().focus().insertContent(html).run()
            return
          }
          if (it.types.includes('text/plain')) {
            const text = await (await it.getType('text/plain')).text()
            const lines = text.replace(/\r\n?/g, '\n').split('\n')
            if (lines.length === 1) editor?.chain().focus().insertContent({ type: 'text', text }).run()
            else editor?.chain().focus().insertContent(lines.map((l) => ({ type: 'paragraph', attrs: { style: 'Normal' }, content: l ? [{ type: 'text', text: l }] : undefined }))).run()
            return
          }
        }
      } catch {
        os.notify({ title: 'Paste', body: 'Use ⌘V (Ctrl+V): the browser did not allow reading the clipboard from the button.' })
      }
    },
    setZoom,
    zoom,
    view,
    setView,
    ruler,
    toggleRuler: () => setRuler((r) => !r),
    nav,
    toggleNav: () => setNav((n) => !n),
    comments: commentsOpen,
    toggleComments: () => setCommentsOpen((c) => !c),
    marks,
    toggleMarks: () => setMarks((v) => !v),
    spell,
    toggleSpell: () => setSpell((v) => !v),
    track: settings.trackChanges,
    author,
    modifyStyle: (id) => setDialog({ kind: 'style', data: { id } }),
    newStyle: () => setDialog({ kind: 'style', data: { id: null } }),
    updateStyleFromSelection: (id) => {
      const st = settingsRef.current.styles[id]
      if (!st || !editor) return
      const sn = snapshot(editor, settingsRef.current.styles)
      updateSettings((s) => ({
        ...s,
        styles: {
          ...s.styles,
          [id]: { ...st, font: sn.font, size: sn.size, bold: sn.bold, italic: sn.italic, underline: sn.underline, color: sn.color ?? st.color, align: sn.align as StyleDef['align'], spaceBefore: sn.spaceBefore, spaceAfter: sn.spaceAfter, lineHeight: sn.lineHeight },
        },
      }))
    },
    setMargins: (preset) => {
      const p = MARGIN_PRESETS[preset]
      if (p) updateSettings((s) => ({ ...s, page: { ...s.page, margins: { ...s.page.margins, top: p.top, right: p.right, bottom: p.bottom, left: p.left } } }))
    },
    setOrientation: (o) => updateSettings((s) => ({ ...s, page: { ...s.page, orientation: o } })),
    setSize: (size) => {
      const p = PAGE_SIZES[size]
      if (p) updateSettings((s) => ({ ...s, page: { ...s.page, size, width: p.width, height: p.height } }))
    },
  }
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  // Double-click on pictures, equations, footnotes, the table of contents.
  editRef.current = (kind, pos) => {
    if (!editor) return
    const node = editor.state.doc.nodeAt(pos)
    if (!node) return
    if (kind === 'image') setDialog({ kind: 'image', data: { pos, attrs: node.attrs } })
    else if (kind === 'footnote') setDialog({ kind: 'footnote', data: { pos, text: node.attrs.text } })
    else if (kind === 'equation' || kind === 'equationBlock') setDialog({ kind: 'equation', data: { pos, latex: node.attrs.latex, display: kind === 'equationBlock' } })
  }

  // Format painter: applied when the mouse is released after selecting.
  useEffect(() => {
    if (!editor || !painter) return
    const dom = editor.view.dom
    const up = () =>
      setTimeout(() => {
        applyPainter(editor, painter)
        if (!painter.sticky) setPainter(null)
      }, 0)
    dom.addEventListener('mouseup', up)
    dom.classList.add('kw-painting')
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPainter(null)
    window.addEventListener('keydown', esc)
    return () => {
      dom.removeEventListener('mouseup', up)
      dom.classList.remove('kw-painting')
      window.removeEventListener('keydown', esc)
    }
  }, [editor, painter])

  // ---------------------------------------------------------------- keyboard
  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod || !editor) return
    const k = e.key.toLowerCase()
    // In the find bar and dialogs, only the file shortcuts are KherveWord's.
    const tag = (e.target as HTMLElement).tagName
    if ((tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') && !['s', 'o', 'n', 'p'].includes(k)) return
    const stop = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    const a = actionsRef.current
    if (k === 's' && e.shiftKey) (stop(), void a.saveAs())
    else if (k === 's') (stop(), void a.save())
    else if (k === 'o') (stop(), a.open())
    else if (k === 'n' && !e.shiftKey && !e.altKey) (stop(), a.newDoc())
    else if (k === 'p') (stop(), a.print())
    else if (k === 'f') (stop(), a.find(false))
    else if (k === 'h' && !e.shiftKey) (stop(), a.find(true))
    else if (k === 'g' && find) (stop(), findNext(editor.view, e.shiftKey ? -1 : 1))
    else if (k === 'k') (stop(), a.dialog('link'))
    else if (k === 'e' && e.shiftKey) (stop(), a.toggleTrack())
    else if (k === 'e') (stop(), setParagraph(editor, { align: 'center' }))
    else if (k === 'l' && !e.shiftKey) (stop(), setParagraph(editor, { align: 'left' }))
    else if (k === 'r' && !e.shiftKey) (stop(), setParagraph(editor, { align: 'right' }))
    else if (k === 'j') (stop(), setParagraph(editor, { align: 'justify' }))
    else if (e.key === ']') (stop(), growFont(editor, snapshot(editor, settingsRef.current.styles).size, 1))
    else if (e.key === '[') (stop(), growFont(editor, snapshot(editor, settingsRef.current.styles).size, -1))
    else if (e.key === '=' || e.key === '+') (stop(), e.shiftKey ? editor.chain().focus().unsetSubscript().toggleSuperscript().run() : editor.chain().focus().unsetSuperscript().toggleSubscript().run())
    else if (e.altKey && /^Digit[1-6]$/.test(e.code)) (stop(), setParagraph(editor, { style: `Heading${e.code.slice(5)}` }))
    else if (e.altKey && e.code === 'Digit0') (stop(), setParagraph(editor, { style: 'Normal' }))
    else if (e.altKey && e.code === 'KeyM') (stop(), a.newComment())
    else if (e.key === '8' && !e.shiftKey) (stop(), a.toggleMarks())
    else if (k === 'c' && e.shiftKey && e.altKey) (stop(), a.painter(false))
  }

  // ---------------------------------------------------------------- menus
  useEffect(() => {
    const a = actionsRef.current
    const ed = editor
    const recent: MenuItem[] = []
    win.setMenus([
      {
        label: 'File',
        items: [
          { label: 'New', icon: FilePlus, shortcut: '⌘N', onClick: () => a.newDoc() },
          { label: 'New from Template…', icon: LayoutTemplate, onClick: () => a.newFromTemplate() },
          { label: 'Open…', icon: FolderOpen, shortcut: '⌘O', onClick: () => a.open() },
          ...recent,
          '-',
          { label: 'Save', icon: Save, shortcut: '⌘S', onClick: () => void a.save() },
          { label: 'Save As…', shortcut: '⇧⌘S', onClick: () => void a.saveAs() },
          {
            label: 'Export',
            icon: FileDown,
            submenu: [
              { label: 'PDF (print dialog, exact pages)…', onClick: () => a.exportPdf() },
              { label: 'PDF to the drive…', onClick: () => a.exportPdfToDrive() },
              { label: 'Word (.docx)…', onClick: () => void a.saveAs() },
              { label: 'Web page (.html)…', onClick: () => void a.saveAs() },
              { label: 'Markdown (.md)…', onClick: () => void a.saveAs() },
              { label: 'Plain text (.txt)…', onClick: () => void a.saveAs() },
            ],
          },
          { label: 'Download to computer', icon: Download, disabled: !filePath, onClick: () => filePath && void os.download(filePath) },
          '-',
          { label: 'Page Setup…', onClick: () => a.dialog('pageSetup') },
          { label: 'Print…', icon: Printer, shortcut: '⌘P', onClick: () => a.print() },
          '-',
          { label: 'Close', onClick: () => win.close() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', icon: Undo2, shortcut: '⌘Z', disabled: !snap.canUndo, onClick: () => ed?.chain().focus().undo().run() },
          { label: 'Redo', icon: Redo2, shortcut: '⇧⌘Z', disabled: !snap.canRedo, onClick: () => ed?.chain().focus().redo().run() },
          '-',
          { label: 'Cut', icon: Scissors, shortcut: '⌘X', onClick: () => a.copy(true) },
          { label: 'Copy', icon: Copy, shortcut: '⌘C', onClick: () => a.copy(false) },
          { label: 'Paste', icon: ClipboardPaste, shortcut: '⌘V', onClick: () => void a.paste() },
          { label: 'Select All', shortcut: '⌘A', onClick: () => ed?.chain().focus().selectAll().run() },
          '-',
          { label: 'Find…', icon: Search, shortcut: '⌘F', onClick: () => a.find(false) },
          { label: 'Replace…', shortcut: '⌘H', onClick: () => a.find(true) },
          '-',
          { label: 'Format Painter', shortcut: '⌥⇧⌘C', checked: a.painterOn, onClick: () => a.painter(false) },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Print Layout', icon: FileText, checked: view === 'print', onClick: () => setView('print') },
          { label: 'Web Layout', icon: Globe, checked: view === 'web', onClick: () => setView('web') },
          '-',
          { label: 'Ruler', checked: ruler, onClick: () => setRuler((r) => !r) },
          { label: 'Navigation Pane', checked: nav, onClick: () => setNav((n) => !n) },
          { label: 'Comments and Changes', checked: commentsOpen, onClick: () => setCommentsOpen((c) => !c) },
          { label: 'Formatting Marks', shortcut: '⌘8', checked: marks, onClick: () => setMarks((v) => !v) },
          '-',
          { label: 'Zoom In', icon: ZoomIn, onClick: () => a.setZoom(Math.min(5, zoom + 0.1)) },
          { label: 'Zoom Out', icon: ZoomOut, onClick: () => a.setZoom(Math.max(0.25, zoom - 0.1)) },
          { label: 'Actual Size (100%)', onClick: () => a.setZoom(1) },
          { label: 'Page Width', onClick: () => a.setZoom('width') },
          { label: 'One Page', onClick: () => a.setZoom('page') },
        ],
      },
      {
        label: 'Insert',
        items: [
          { label: 'Page Break', shortcut: '⌘↩', onClick: () => ed?.chain().focus().insertContent({ type: 'pageBreak', attrs: { kind: 'page' } }).run() },
          { label: 'Section Break', onClick: () => ed?.chain().focus().insertContent({ type: 'pageBreak', attrs: { kind: 'section' } }).run() },
          '-',
          { label: 'Table…', submenu: [2, 3, 4, 5, 6].map((n) => ({ label: `${n} × ${n}`, onClick: () => a.insertTable(n, n) })) },
          { label: 'Picture from the Drive…', onClick: () => a.insertPicture() },
          { label: 'Hyperlink…', shortcut: '⌘K', onClick: () => a.dialog('link') },
          { label: 'Comment', shortcut: '⌥⌘M', onClick: () => a.newComment() },
          '-',
          { label: 'Header & Footer…', onClick: () => a.dialog('headerFooter') },
          { label: 'Page Numbers…', onClick: () => a.dialog('headerFooter', { pageNumber: true }) },
          { label: 'Footnote…', onClick: () => a.insertFootnote() },
          { label: 'Table of Contents', onClick: () => a.insertTOC() },
          { label: 'Caption', onClick: () => a.insertCaption('Figure') },
          '-',
          { label: 'Equation…', onClick: () => a.dialog('equation') },
          { label: 'Symbol…', onClick: () => a.dialog('symbol') },
          { label: 'Date', onClick: () => a.insertDate() },
          { label: 'Horizontal Line', onClick: () => ed?.chain().focus().setHorizontalRule().run() },
        ],
      },
      {
        label: 'Format',
        items: [
          { label: 'Bold', icon: Bold, shortcut: '⌘B', checked: snap.bold, onClick: () => ed?.chain().focus().toggleBold().run() },
          { label: 'Italic', icon: Italic, shortcut: '⌘I', checked: snap.italic, onClick: () => ed?.chain().focus().toggleItalic().run() },
          { label: 'Underline', icon: Underline, shortcut: '⌘U', checked: snap.underline, onClick: () => ed?.chain().focus().toggleUnderline().run() },
          { label: 'Strikethrough', checked: snap.strike, onClick: () => ed?.chain().focus().toggleStrike().run() },
          { label: 'Subscript', shortcut: '⌘=', checked: snap.sub, onClick: () => ed?.chain().focus().unsetSuperscript().toggleSubscript().run() },
          { label: 'Superscript', shortcut: '⇧⌘=', checked: snap.sup, onClick: () => ed?.chain().focus().unsetSubscript().toggleSuperscript().run() },
          { label: 'Bigger', shortcut: '⌘]', onClick: () => ed && growFont(ed, snap.size, 1) },
          { label: 'Smaller', shortcut: '⌘[', onClick: () => ed && growFont(ed, snap.size, -1) },
          '-',
          {
            label: 'Align',
            submenu: [
              { label: 'Left', shortcut: '⌘L', checked: snap.align === 'left', onClick: () => ed && setParagraph(ed, { align: 'left' }) },
              { label: 'Centre', shortcut: '⌘E', checked: snap.align === 'center', onClick: () => ed && setParagraph(ed, { align: 'center' }) },
              { label: 'Right', shortcut: '⌘R', checked: snap.align === 'right', onClick: () => ed && setParagraph(ed, { align: 'right' }) },
              { label: 'Justify', shortcut: '⌘J', checked: snap.align === 'justify', onClick: () => ed && setParagraph(ed, { align: 'justify' }) },
            ],
          },
          {
            label: 'Style',
            submenu: Object.values(settings.styles)
              .filter((s) => s.quick)
              .map((s) => ({ label: s.name, checked: snap.style === s.id, onClick: () => ed && setParagraph(ed, { style: s.id }) })),
          },
          { label: 'Paragraph…', onClick: () => a.dialog('paragraph') },
          { label: 'Modify Style…', onClick: () => a.modifyStyle(snap.style) },
          { label: 'New Style…', onClick: () => a.newStyle() },
          '-',
          { label: 'Bullets', checked: snap.list === 'bullet', onClick: () => ed?.chain().focus().toggleBulletList().run() },
          { label: 'Numbering', checked: snap.list === 'ordered', onClick: () => ed?.chain().focus().toggleOrderedList().run() },
          '-',
          { label: 'Page Setup…', onClick: () => a.dialog('pageSetup') },
          { label: 'Header & Footer…', onClick: () => a.dialog('headerFooter') },
        ],
      },
      {
        label: 'Tools',
        items: [
          { label: 'Spelling', checked: spell, onClick: () => a.toggleSpell() },
          { label: 'Word Count…', onClick: () => a.dialog('wordCount') },
          '-',
          { label: 'Track Changes', shortcut: '⇧⌘E', checked: settings.trackChanges, onClick: () => a.toggleTrack() },
          { label: 'Accept All Changes', onClick: () => a.review(true, 'all') },
          { label: 'Reject All Changes', onClick: () => a.review(false, 'all') },
          { label: 'New Comment', shortcut: '⌥⌘M', onClick: () => a.newComment() },
          { label: `Author Name (${author})…`, onClick: () => a.setAuthor() },
        ],
      },
      {
        label: 'Help',
        items: [{ label: 'kWord Help and Shortcuts', onClick: () => setDialog({ kind: 'wordCount', data: { help: true } }) }],
      },
    ])
  })

  // ---------------------------------------------------------------- dialogs
  const closeDialog = () => {
    setDialog(null)
    editor?.commands.focus()
  }
  const renderDialog = () => {
    if (!dialog || !editor) return null
    const d = dialog.data ?? {}
    switch (dialog.kind) {
      case 'pageSetup':
        return <PageSetupDialog page={settings.page} onClose={closeDialog} onOk={(p) => (updateSettings((s) => ({ ...s, page: p })), closeDialog())} />
      case 'paragraph':
        return (
          <ParagraphDialog
            initial={{ align: snap.align, indentLeft: snap.indentLeft, indentRight: snap.indentRight, indentFirst: snap.indentFirst, spaceBefore: snap.spaceBefore, spaceAfter: snap.spaceAfter, lineHeight: snap.lineHeight, border: null, shading: null, tabs: snap.tabs }}
            onClose={closeDialog}
            onOk={(v) => {
              setParagraph(editor, { ...v, tabs: v.tabs.length ? v.tabs : null })
              closeDialog()
            }}
          />
        )
      case 'headerFooter': {
        const s = d.pageNumber && hfIsEmpty(settings.footer) ? { ...settings, footer: { left: '', center: '{PAGE}', right: '' } } : settings
        return <HeaderFooterDialog settings={s} onClose={closeDialog} onOk={(v) => (updateSettings((x) => ({ ...x, ...v })), closeDialog())} />
      }
      case 'symbol':
        return <SymbolDialog onClose={closeDialog} onPick={(c) => editor.chain().focus().insertContent({ type: 'text', text: c }).run()} />
      case 'equation': {
        const pos = typeof d.pos === 'number' ? d.pos : null
        return (
          <EquationDialog
            latex={String(d.latex ?? '')}
            display={d.display === undefined ? true : !!d.display}
            canChangeKind={pos === null}
            onClose={closeDialog}
            onOk={(latex, display) => {
              if (pos !== null) setNodeAttrs(editor, pos, { latex })
              else editor.chain().focus().insertContent(display ? { type: 'equationBlock', attrs: { latex } } : { type: 'equation', attrs: { latex } }).run()
              closeDialog()
            }}
          />
        )
      }
      case 'link': {
        if (d.author) {
          return (
            <TextDialog
              title="Author Name"
              label="The name shown on your comments and tracked changes"
              value={author}
              onClose={closeDialog}
              onOk={(v) => {
                const name2 = v.trim() || 'Me'
                setAuthorState(name2)
                try {
                  localStorage.setItem(AUTHOR_KEY, name2)
                } catch {
                  /* kept for this session */
                }
                closeDialog()
              }}
            />
          )
        }
        const { from, to } = editor.state.selection
        const text = editor.state.doc.textBetween(from, to, ' ')
        return (
          <LinkDialog
            text={text}
            href={snap.link ?? ''}
            onClose={closeDialog}
            onRemove={snap.link ? () => (editor.chain().focus().extendMarkRange('link').unsetLink().run(), closeDialog()) : undefined}
            onOk={(t, href) => {
              if (snap.link) editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
              else if (from === to || t !== text) editor.chain().focus().insertContent({ type: 'text', text: t || href, marks: [{ type: 'link', attrs: { href } }] }).run()
              else editor.chain().focus().setLink({ href }).run()
              closeDialog()
            }}
          />
        )
      }
      case 'footnote': {
        const pos = typeof d.pos === 'number' ? d.pos : null
        return (
          <TextDialog
            title={pos === null ? 'Insert Footnote' : 'Edit Footnote'}
            label="Footnote text"
            multiline
            value={String(d.text ?? '')}
            onClose={closeDialog}
            onOk={(text) => {
              if (pos !== null) setNodeAttrs(editor, pos, { text })
              else if (text.trim()) editor.chain().focus().insertContent({ type: 'footnote', attrs: { text } }).run()
              closeDialog()
            }}
          />
        )
      }
      case 'image': {
        const pos = Number(d.pos)
        return <ImageDialog attrs={d.attrs as Record<string, unknown>} onClose={closeDialog} onOk={(a) => (setNodeAttrs(editor, pos, a), closeDialog())} />
      }
      case 'style': {
        const id = d.id as string | null
        const styles = settings.styles
        const base: StyleDef = id && styles[id] ? styles[id] : (() => {
          const sn = snapshot(editor, styles)
          let n = 1
          while (styles[`Custom${n}`]) n++
          return { id: `Custom${n}`, name: `Style ${n}`, basedOn: 'Normal', quick: true, font: sn.font, size: sn.size, bold: sn.bold, italic: sn.italic, color: sn.color ?? undefined }
        })()
        return (
          <StyleDialog
            styles={styles}
            style={base}
            isNew={!id}
            onClose={closeDialog}
            onOk={(st) => {
              updateSettings((s) => ({ ...s, styles: { ...s.styles, [st.id]: st } }))
              if (!id) setParagraph(editor, { style: st.id })
              closeDialog()
            }}
          />
        )
      }
      case 'wordCount': {
        if (d.help) return <HelpDialog onClose={closeDialog} />
        const sel = editor.state.selection
        const text = sel.empty ? nodeText(editor.state.doc.toJSON() as PMNode) : editor.state.doc.textBetween(sel.from, sel.to, '\n', ' ')
        let paras = 0
        editor.state.doc.descendants((n) => {
          if (n.isTextblock && n.textContent.trim()) paras++
          return !n.isTextblock
        })
        return (
          <WordCountDialog
            onClose={closeDialog}
            stats={[
              { label: sel.empty ? 'In the document' : 'In the selection', value: '' },
              { label: 'Pages', value: pages },
              { label: 'Words', value: countWords(text) },
              { label: 'Characters (no spaces)', value: text.replace(/\s/g, '').length },
              { label: 'Characters (with spaces)', value: text.replace(/\n/g, '').length },
              { label: 'Paragraphs', value: paras },
              { label: 'Comments', value: Object.keys(settings.comments).length },
            ]}
          />
        )
      }
      case 'templates':
        return <TemplateDialog onClose={closeDialog} onPick={(id) => (closeDialog(), newFromTemplate(id))} />
      default:
        return null
    }
  }

  // ---------------------------------------------------------------- render
  const css = useMemo(() => stylesCss(settings.styles, `.kw-doc-${win.id.replace(/[^A-Za-z0-9_-]/g, '')}`), [settings.styles, win.id])
  const docClass = `kw-doc-${win.id.replace(/[^A-Za-z0-9_-]/g, '')}`
  const curPage = Math.max(1, Math.min(stats.page, pages))
  const footnotesByPage = useMemo(() => {
    const map = new Map<number, { n: number; text: string; pos: number }[]>()
    layout.footnotes.forEach((f, i) => {
      const list = map.get(f.page) ?? []
      list.push({ n: i + 1, text: f.text, pos: f.pos })
      map.set(f.page, list)
    })
    return map
  }, [layout.footnotes])
  const hfFor = (i: number, kind: 'header' | 'footer'): HeaderFooter => {
    if (i === 0 && settings.differentFirst) return (kind === 'header' ? settings.firstHeader : settings.firstFooter) ?? { left: '', center: '', right: '' }
    return kind === 'header' ? settings.header : settings.footer
  }
  const headings = editor ? tocRef.current : []
  const currentHeading = (() => {
    if (!editor) return -1
    const head = editor.state.selection.head
    let k = -1
    headings.forEach((h, i) => {
      if (h.pos <= head) k = i
    })
    return k
  })()

  if (!editor) return <div className="k-app kw-app" />

  return (
    <div className={`k-app kw-app${marks ? ' kw-marks' : ''}${painter ? ' kw-painter-on' : ''}`} onKeyDownCapture={onKeyDown}>
      <Ribbon tab={tab} setTab={setTab} editor={editor} snap={snap} settings={settings} actions={actions} />
      <div className="kw-work">
        {nav && <NavigationPane headings={headings} current={currentHeading} onGo={(pos) => goToPos(editor.view, pos)} onClose={() => setNav(false)} />}
        <div className="kw-center">
          {find && <FindBar editor={editor} replace={find.replace} version={version + (snap.empty ? 0 : 1)} onClose={() => (setFindOpen(null), editor.commands.focus())} />}
          <div className={`kw-canvas${paged ? '' : ' web'}`} ref={canvasRef} onMouseDown={(e) => {
            // A click on the grey around the pages puts the cursor at the end.
            if (e.target === e.currentTarget) {
              e.preventDefault()
              editor.commands.focus('end')
            }
          }}>
            {ruler && paged && (
              <div className="kw-hruler-row">
                <HRuler
                  pageW={pageW}
                  marginL={mpx.left}
                  marginR={mpx.right}
                  zoom={zoom}
                  indentLeft={snap.indentLeft}
                  indentRight={snap.indentRight}
                  indentFirst={snap.indentFirst}
                  tabs={snap.tabs}
                  onIndent={(v) => setParagraph(editor, v)}
                  onTabs={(t) => setParagraph(editor, { tabs: t.length ? t : null })}
                  onMargins={(l, r) => updateSettings((s) => ({ ...s, page: { ...s.page, margins: { ...s.page.margins, left: l / PX_PER_PT, right: r / PX_PER_PT } } }))}
                />
              </div>
            )}
            <div className="kw-zoomwrap" style={paged ? { width: pageW * zoom, height: totalH * zoom } : { width: webW * zoom, minHeight: '100%' }}>
              {ruler && paged && (
                <VRuler
                  pageH={pageH}
                  marginT={mpx.top}
                  marginB={mpx.bottom}
                  zoom={zoom}
                  top={(curPage - 1) * (pageH + GAP) * zoom}
                  onMargins={(t, b) => updateSettings((s) => ({ ...s, page: { ...s.page, margins: { ...s.page.margins, top: t / PX_PER_PT, bottom: b / PX_PER_PT } } }))}
                />
              )}
              <div
                ref={pagesRef}
                className={`kw-pages ${docClass}${paged ? ' paged' : ' web'}`}
                style={{
                  width: paged ? pageW : webW,
                  height: paged ? totalH : undefined,
                  transform: zoom !== 1 ? `scale(${zoom})` : undefined,
                  ['--kw-mt' as string]: `${paged ? mpx.top : 24}px`,
                  ['--kw-mb' as string]: `${paged ? mpx.bottom : 24}px`,
                  ['--kw-ml' as string]: `${paged ? mpx.left : 32}px`,
                  ['--kw-mr' as string]: `${paged ? mpx.right : 32}px`,
                  ['--kw-min-h' as string]: paged ? `${totalH}px` : 'auto',
                }}
              >
                <style>{css}</style>
                {paged &&
                  Array.from({ length: pages }, (_, i) => (
                    <div key={`bg${i}`} className="kw-page bg" style={{ top: i * (pageH + GAP), height: pageH }} />
                  ))}
                <EditorContent editor={editor} className="kw-doc" />
                {paged &&
                  Array.from({ length: pages }, (_, i) => {
                    const head = hfFor(i, 'header')
                    const foot = hfFor(i, 'footer')
                    const notes = footnotesByPage.get(i) ?? []
                    const reserve = layout.reserve[i] ?? 0
                    const part = (h: HeaderFooter, k: keyof HeaderFooter) => expandTokens(h[k], i + 1, pages, settings.title)
                    return (
                      <div key={`over${i}`} className="kw-page over" style={{ top: i * (pageH + GAP), height: pageH }}>
                        <div className={`kw-hf header${hfIsEmpty(head) ? ' empty' : ''}`} style={{ top: m.header * PX_PER_PT, left: mpx.left, right: mpx.right }} onDoubleClick={() => setDialog({ kind: 'headerFooter' })} title="Double-click to edit the header">
                          <span>{part(head, 'left')}</span>
                          <span>{part(head, 'center')}</span>
                          <span>{part(head, 'right')}</span>
                        </div>
                        {notes.length > 0 && (
                          <div className="kw-footnotes" style={{ top: pageH - mpx.bottom - reserve + 6, left: mpx.left, right: mpx.right }}>
                            {notes.map((n) => (
                              <div key={n.n} className="kw-footnote" onDoubleClick={() => editRef.current('footnote', n.pos)} title="Double-click to edit">
                                <sup>{n.n}</sup> {n.text}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className={`kw-hf footer${hfIsEmpty(foot) ? ' empty' : ''}`} style={{ bottom: m.footer * PX_PER_PT, left: mpx.left, right: mpx.right }} onDoubleClick={() => setDialog({ kind: 'headerFooter' })} title="Double-click to edit the footer">
                          <span>{part(foot, 'left')}</span>
                          <span>{part(foot, 'center')}</span>
                          <span>{part(foot, 'right')}</span>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          </div>
          {loading && <div className="kw-loading">Opening…</div>}
        </div>
        {commentsOpen && (
          <CommentsPane
            editor={editor}
            comments={settings.comments}
            focusId={focusComment}
            version={version + (snap.empty ? 0 : 1) + editor.state.selection.from}
            onChange={(id, c: Comment) => updateSettings((s) => ({ ...s, comments: { ...s.comments, [id]: c } }))}
            onDelete={(id) => deleteComment(id)}
            onClose={() => setCommentsOpen(false)}
          />
        )}
      </div>
      <div className="k-statusbar kw-status">
        <span>{paged ? `Page ${curPage} of ${pages}` : 'Web Layout'}</span>
        <span>{stats.selWords ? `${stats.selWords} of ${stats.words} words` : `${stats.words.toLocaleString()} word${stats.words === 1 ? '' : 's'}`}</span>
        <span>{stats.chars.toLocaleString()} characters</span>
        <span title="Spelling language">{settings.lang}</span>
        <button className={`kw-status-btn${settings.trackChanges ? ' on' : ''}`} onClick={() => actions.toggleTrack()} title="Track Changes (⇧⌘E)">
          Track Changes: {settings.trackChanges ? 'On' : 'Off'}
        </button>
        <span>{filePath ? (dirty ? 'Edited' : 'Saved') : dirty ? 'Not saved' : ''}</span>
        <span style={{ flex: 1 }} />
        <button className={`kw-status-btn${view === 'print' ? ' on' : ''}`} title="Print Layout" onClick={() => setView('print')}>
          <FileText size={13} />
        </button>
        <button className={`kw-status-btn${view === 'web' ? ' on' : ''}`} title="Web Layout" onClick={() => setView('web')}>
          <Globe size={13} />
        </button>
        <button className="kw-status-btn" title="Zoom Out" onClick={() => setZoom(Math.max(0.25, zoom - 0.1))}>
          −
        </button>
        <input className="kw-zoom" type="range" min={25} max={300} step={5} value={Math.round(zoom * 100)} onChange={(e) => setZoom(Number(e.target.value) / 100)} aria-label="Zoom" />
        <button className="kw-status-btn" title="Zoom In" onClick={() => setZoom(Math.min(5, zoom + 0.1))}>
          +
        </button>
        <button className="kw-status-btn" title="Zoom to 100%" onClick={() => setZoom(1)}>
          {Math.round(zoom * 100)}%
        </button>
      </div>
      {renderDialog()}
    </div>
  )
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['⌘N / ⌘O / ⌘S / ⇧⌘S', 'New, Open, Save, Save As (.docx, .html, .md, .txt)'],
    ['⌘P', 'Print or save as PDF (exact pages)'],
    ['⌘Z / ⇧⌘Z', 'Undo / Redo'],
    ['⌘B / ⌘I / ⌘U', 'Bold, italic, underline'],
    ['⌘= / ⇧⌘=', 'Subscript / superscript'],
    ['⌘] / ⌘[', 'Bigger / smaller text'],
    ['⌘L / ⌘E / ⌘R / ⌘J', 'Align left, centre, right, justify'],
    ['⌥⌘1…6 / ⌥⌘0', 'Heading 1…6 / Normal'],
    ['Tab / ⇧Tab', 'In a list: indent / outdent; in a table: next / previous cell'],
    ['⌘↩', 'Page break'],
    ['⇧↩', 'Line break in the same paragraph'],
    ['⌘K', 'Hyperlink (⌘-click a link to open it)'],
    ['⌘F / ⌘H / ⌘G', 'Find / Replace / Next match'],
    ['⌥⌘M', 'New comment'],
    ['⇧⌘E', 'Track Changes on/off'],
    ['⌘8', 'Show formatting marks'],
    ['⌥⇧⌘C', 'Format Painter (double-click its button to keep it on)'],
  ]
  return (
    <Modal title="kWord Help" wide onClose={onClose}>
      <p className="kw-hint">
        kWord writes Word documents (.docx) and reads .docx, .odt, .rtf, .md, .html and .txt. Styles (Home › Styles) give headings their look and fill the table of contents and the Navigation pane. Double-click a header, footer, picture, equation or footnote to edit it. Unsaved work is kept every 30 seconds and offered back after a crash.
      </p>
      <table className="kw-stats">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}
