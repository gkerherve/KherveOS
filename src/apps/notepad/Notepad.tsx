// Notepad: plain-text editing with syntax colouring for code files.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { redo, selectAll, undo } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import {
  Download, FilePlus, FolderOpen, Redo2, Save, Search, Undo2, WrapText, ZoomIn, ZoomOut,
} from 'lucide-react'
import { os, fs, path, HOME, type AppProps } from '@/os'
import { CodeEditor, languageForExtension, type EditorLanguage } from '@/os/ui/CodeEditor'
import './notepad.css'

const LANG_NAMES: Record<EditorLanguage, string> = {
  python: 'Python', markdown: 'Markdown', javascript: 'JavaScript', typescript: 'TypeScript', json: 'JSON', latex: 'LaTeX', plain: 'Plain text',
}

export default function Notepad({ win, args }: AppProps) {
  const [filePath, setFilePath] = useState<string | null>(args.path ?? null)
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [loading, setLoading] = useState(!!args.path)
  const [wrap, setWrap] = useState(true)
  const [lineNumbers, setLineNumbers] = useState(true)
  const [fontSize, setFontSize] = useState(14)
  const [cursor, setCursor] = useState({ line: 1, col: 1 })
  const view = useRef<EditorView | null>(null)
  const dirty = text !== saved
  const name = filePath ? path.basename(filePath) : 'Untitled'
  const language = filePath ? languageForExtension(path.extname(filePath)) : 'plain'

  // Keep the latest values for callbacks registered once.
  const live = useRef({ text, dirty, filePath })
  live.current = { text, dirty, filePath }

  const load = useCallback(async (p: string) => {
    setLoading(true)
    try {
      const content = await fs.readText(p)
      setFilePath(p)
      setText(content)
      setSaved(content)
    } catch (e) {
      await os.dialog.alert(`Could not open ${p}: ${e instanceof Error ? e.message : e}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (args.path) void load(args.path)
  }, [args.path, load])

  useEffect(() => {
    win.setTitle(`${dirty ? '• ' : ''}${name} — Notepad`)
  }, [win, name, dirty])
  useEffect(() => win.setDocumentPath(filePath), [win, filePath])

  // Follow renames, and reload when another app changes the file.
  useEffect(
    () =>
      fs.watch((ev) => {
        const current = live.current.filePath
        if (!current) return
        if (ev.type === 'rename' && path.isInside(current, ev.oldPath)) {
          setFilePath(ev.path + current.slice(ev.oldPath.length))
        } else if (ev.type === 'change' && ev.path === current) {
          void fs.readText(current).then((content) => {
            if (content === live.current.text) return
            if (live.current.dirty) {
              os.notify({ title: `${path.basename(current)} changed on disk`, body: 'Your unsaved edits are kept. Save to overwrite.' })
            } else {
              setText(content)
              setSaved(content)
            }
          })
        }
      }),
    [],
  )

  const saveAs = useCallback(async (): Promise<boolean> => {
    const { filePath: fp, text: t } = live.current
    const target = await os.dialog.saveFile({
      title: 'Save As',
      defaultName: fp ?? `${HOME}/Documents/Untitled.txt`,
    })
    if (!target) return false
    await fs.writeText(target, t)
    setFilePath(target)
    setSaved(t)
    return true
  }, [])

  const save = useCallback(async (): Promise<boolean> => {
    const { filePath: fp, text: t } = live.current
    if (!fp || !fs.exists(path.dirname(fp))) return saveAs()
    try {
      await fs.writeText(fp, t)
      setSaved(t)
      return true
    } catch (e) {
      await os.dialog.alert(`Could not save: ${e instanceof Error ? e.message : e}`)
      return false
    }
  }, [saveAs])

  // Ask before closing with unsaved changes.
  useEffect(() => {
    win.setCloseGuard(async () => {
      if (!live.current.dirty) return true
      const choice = await os.dialog.choose(
        `Save the changes to "${live.current.filePath ? path.basename(live.current.filePath) : 'Untitled'}" before closing?`,
        [
          { label: 'Cancel', value: 'cancel' },
          { label: "Don't save", value: 'discard', danger: true },
          { label: 'Save', value: 'save', primary: true },
        ],
        { title: 'Unsaved changes' },
      )
      if (choice === 'save') return save()
      return choice === 'discard'
    })
    return () => win.setCloseGuard(null)
  }, [win, save])

  const open = async () => {
    const p = await os.dialog.openFile({ startDir: filePath ? path.dirname(filePath) : `${HOME}/Documents` })
    if (p) os.open('notepad', { path: p })
  }

  const cmd = (fn: (v: EditorView) => boolean) => () => {
    if (view.current) {
      fn(view.current)
      view.current.focus()
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    const k = e.key.toLowerCase()
    if (k === 's') {
      e.preventDefault()
      void (e.shiftKey ? saveAs() : save())
    } else if (k === 'o') {
      e.preventDefault()
      void open()
    } else if (k === '=' || k === '+') {
      e.preventDefault()
      setFontSize((s) => Math.min(32, s + 1))
    } else if (k === '-') {
      e.preventDefault()
      setFontSize((s) => Math.max(9, s - 1))
    }
  }

  // The app's menus live in the menu bar at the top of the screen.
  useEffect(() => {
    win.setMenus([
      {
        label: 'File',
        items: [
          { label: 'New', icon: FilePlus, onClick: () => os.open('notepad', { _new: Date.now() }) },
          { label: 'Open…', icon: FolderOpen, shortcut: '⌘O', onClick: () => void open() },
          '-',
          { label: 'Save', icon: Save, shortcut: '⌘S', onClick: () => void save() },
          { label: 'Save As…', shortcut: '⇧⌘S', onClick: () => void saveAs() },
          { label: 'Download to computer', icon: Download, disabled: !filePath, onClick: () => filePath && void os.download(filePath) },
          '-',
          { label: 'Close', onClick: () => win.close() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', icon: Undo2, shortcut: '⌘Z', onClick: cmd(undo) },
          { label: 'Redo', icon: Redo2, shortcut: '⇧⌘Z', onClick: cmd(redo) },
          '-',
          { label: 'Find and Replace', icon: Search, shortcut: '⌘F', onClick: cmd(openSearchPanel) },
          { label: 'Select All', shortcut: '⌘A', onClick: cmd(selectAll) },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Word Wrap', icon: WrapText, checked: wrap, onClick: () => setWrap((w) => !w) },
          { label: 'Line Numbers', checked: lineNumbers, onClick: () => setLineNumbers((v) => !v) },
          '-',
          { label: 'Zoom In', icon: ZoomIn, shortcut: '⌘+', onClick: () => setFontSize((s) => Math.min(32, s + 1)) },
          { label: 'Zoom Out', icon: ZoomOut, shortcut: '⌘−', onClick: () => setFontSize((s) => Math.max(9, s - 1)) },
          { label: 'Actual Size', onClick: () => setFontSize(14) },
        ],
      },
    ])
  })

  const words = text.trim() ? text.trim().split(/\s+/).length : 0

  return (
    <div className="k-app np-app" onKeyDown={onKeyDown}>
      <div className="np-editor">
        {loading ? (
          <div className="k-center k-muted">Opening…</div>
        ) : (
          <CodeEditor
            value={text}
            onChange={setText}
            language={language}
            wrap={wrap}
            lineNumbers={lineNumbers}
            fontSize={fontSize}
            autoFocus
            onReady={(v) => (view.current = v)}
            onUpdate={(u) => updateCursor(u.view)}
          />
        )}
      </div>
      <div className="k-statusbar">
        <span>{filePath ? path.pretty(filePath) : 'Not saved yet'}</span>
        <span>{dirty ? 'Edited' : filePath ? 'Saved' : ''}</span>
        <span style={{ marginLeft: 'auto' }}>Ln {cursor.line}, Col {cursor.col}</span>
        <span>{words} words</span>
        <span>{LANG_NAMES[language]}</span>
        <span>UTF-8</span>
      </div>
    </div>
  )

  function updateCursor(v: EditorView) {
    const head = v.state.selection.main.head
    const line = v.state.doc.lineAt(head)
    setCursor({ line: line.number, col: head - line.from + 1 })
  }
}
