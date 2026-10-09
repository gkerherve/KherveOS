// One entry: title and metadata, the rich-text editor with its toolbar, the signature banner, the addenda.
// A signed entry is read-only; the editor stays on the page but nothing in it can be changed.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import {
  Bold, Code, Code2, FilePlus2, Heading1, Heading2, Heading3, Highlighter, Italic, Link2, List, ListChecks, ListOrdered, Lock, Pencil, Plus, Quote, Redo2, Sigma, Star, Strikethrough, Subscript, Superscript,
  Table2, Underline, Undo2, AtSign, ShieldCheck, FileSignature, Copy, Trash2,
} from 'lucide-react'
import { os } from '@/os'
import { BLOCK_LABELS, INSERTABLE_BLOCKS, newBlock, type BlockKind } from './blocks'
import { docToHtml, type PMNode } from './doc'
import { BlockEnvContext, type BlockEnv, type EditorEnv, type ParentEditorEnv } from './env'
import { createExtensions, editorProps } from './editorExt'
import { renderMath } from './files'
import { entryHash, getProject, type Entry, type Notebook } from './model'
import type { EditPatch, FlagPatch } from './notebook'
import { renderCtx } from './render'
import { createTracker } from './editTracker'
import { Html, StatusBadge, shortDate, stamp } from './ui'

export interface EntryActions {
  onPatch(patch: EditPatch & FlagPatch): void
  onContent(doc: PMNode): void
  onProject(projectId: string): void
  onSign(): void
  onWitness(): void
  onAmend(): void
  onDuplicate(): void
  onDelete(): void
  registerFlush(fn: (() => void) | null): void
}

interface Props extends EntryActions {
  nb: Notebook
  entry: Entry
  blockEnv: BlockEnv
  editorEnv: ParentEditorEnv
  onLinkClick(href: string, mod: boolean): void
  onWords?(n: number): void
}

function TagsField({ tags, onChange, disabled }: { tags: string[]; onChange(t: string[]): void; disabled: boolean }) {
  const [draft, setDraft] = useState('')
  const commit = () => {
    const add = draft.split(/[,;]/).map((t) => t.trim().replace(/^#/, '')).filter((t) => t && !tags.includes(t))
    setDraft('')
    if (add.length) onChange([...tags, ...add])
  }
  return (
    <div className="ln-tags">
      {tags.map((t) => (
        <span key={t} className="ln-tagchip">#{t}{!disabled && <button aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>×</button>}</span>
      ))}
      {!disabled && <input className="ln-tag-input" value={draft} placeholder={tags.length ? '' : 'Add tags…'} aria-label="Add a tag" onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit() } else if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1)) }} />}
    </div>
  )
}

/** An image attachment becomes an image block, anything else a file block. */
function insertAttachmentBlock(editor: Editor, env: BlockEnv, attId: string) {
  const a = env.attachment(attId)
  const image = !!a && /^image\//.test(a.mime)
  editor.chain().focus().insertContent({ type: 'elnBlock', attrs: { block: image ? { kind: 'image', data: { att: attId, caption: '', width: 60 } } : { kind: 'file', data: { att: attId, note: '' } } } }).run()
}

function Toolbar({ editor, blockEnv, editorEnv }: { editor: Editor; blockEnv: BlockEnv; editorEnv: EditorEnv }) {
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'), code: e.isActive('code'), highlight: e.isActive('highlight'),
      sub: e.isActive('subscript'), sup: e.isActive('superscript'), h1: e.isActive('heading', { level: 1 }), h2: e.isActive('heading', { level: 2 }), h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), task: e.isActive('taskList'), quote: e.isActive('blockquote'), codeBlock: e.isActive('codeBlock'), link: e.isActive('link'),
      table: e.isActive('table'), undo: e.can().undo(), redo: e.can().redo(),
    }),
  })
  const run = (fn: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => fn(editor.chain().focus()).run()
  const btn = (label: string, Icon: typeof Bold, active: boolean, onClick: () => void, disabled = false) => (
    <button className={`k-icon-btn${active ? ' active' : ''}`} aria-label={label} aria-pressed={active} title={label} disabled={disabled} onClick={onClick} onMouseDown={(e) => e.preventDefault()}><Icon size={15} /></button>
  )
  const attachBlock = async (kind: 'any' | 'image') => {
    const id = await blockEnv.pickFile(kind)
    if (id) insertAttachmentBlock(editor, blockEnv, id)
  }
  const insertBlock = (kind: BlockKind) => editor.chain().focus().insertContent({ type: 'elnBlock', attrs: { block: newBlock(kind) } }).run()
  const blockMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    os.contextMenu({ clientX: r.left, clientY: r.bottom + 2 }, [
      ...INSERTABLE_BLOCKS.map((k) => ({ label: BLOCK_LABELS[k], onClick: () => insertBlock(k) })),
      '-',
      { label: 'Image from a file…', onClick: () => void attachBlock('image') },
      { label: 'Attach a file…', onClick: () => void attachBlock('any') },
      '-',
      { label: 'Display equation', onClick: () => void editorEnv.editMath('', true).then((l) => { if (l?.trim()) editor.chain().focus().insertContent({ type: 'mathBlock', attrs: { latex: l.trim() } }).run() }) },
      { label: 'Horizontal rule', onClick: () => run((c) => c.setHorizontalRule()) },
    ], { owner: 'ln-block' })
  }
  const tableMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    os.contextMenu({ clientX: r.left, clientY: r.bottom + 2 }, [
      { label: 'Insert 3×3 table', onClick: () => run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true })) },
      '-',
      { label: 'Add row below', disabled: !st.table, onClick: () => run((c) => c.addRowAfter()) },
      { label: 'Add column right', disabled: !st.table, onClick: () => run((c) => c.addColumnAfter()) },
      { label: 'Delete row', disabled: !st.table, onClick: () => run((c) => c.deleteRow()) },
      { label: 'Delete column', disabled: !st.table, onClick: () => run((c) => c.deleteColumn()) },
      { label: 'Delete table', disabled: !st.table, danger: true, onClick: () => run((c) => c.deleteTable()) },
    ], { owner: 'ln-table' })
  }
  return (
    <div className="ln-toolbar" role="toolbar" aria-label="Formatting">
      {btn('Undo', Undo2, false, () => run((c) => c.undo()), !st.undo)}
      {btn('Redo', Redo2, false, () => run((c) => c.redo()), !st.redo)}
      <span className="k-sep" />
      {btn('Heading 1', Heading1, st.h1, () => run((c) => c.toggleHeading({ level: 1 })))}
      {btn('Heading 2', Heading2, st.h2, () => run((c) => c.toggleHeading({ level: 2 })))}
      {btn('Heading 3', Heading3, st.h3, () => run((c) => c.toggleHeading({ level: 3 })))}
      <span className="k-sep" />
      {btn('Bold (⌘B)', Bold, st.bold, () => run((c) => c.toggleBold()))}
      {btn('Italic (⌘I)', Italic, st.italic, () => run((c) => c.toggleItalic()))}
      {btn('Underline (⌘U)', Underline, st.underline, () => run((c) => c.toggleUnderline()))}
      {btn('Strikethrough', Strikethrough, st.strike, () => run((c) => c.toggleStrike()))}
      {btn('Highlight', Highlighter, st.highlight, () => run((c) => c.toggleHighlight()))}
      {btn('Subscript', Subscript, st.sub, () => run((c) => c.toggleSubscript()))}
      {btn('Superscript', Superscript, st.sup, () => run((c) => c.toggleSuperscript()))}
      {btn('Inline code', Code, st.code, () => run((c) => c.toggleCode()))}
      <span className="k-sep" />
      {btn('Bulleted list', List, st.bullet, () => run((c) => c.toggleBulletList()))}
      {btn('Numbered list', ListOrdered, st.ordered, () => run((c) => c.toggleOrderedList()))}
      {btn('Checklist', ListChecks, st.task, () => run((c) => c.toggleTaskList()))}
      {btn('Quote', Quote, st.quote, () => run((c) => c.toggleBlockquote()))}
      {btn('Code block', Code2, st.codeBlock, () => run((c) => c.toggleCodeBlock()))}
      <span className="k-sep" />
      <button className={`k-icon-btn${st.table ? ' active' : ''}`} aria-label="Table" title="Table" onClick={tableMenu} data-menu-owner="ln-table" onMouseDown={(e) => e.preventDefault()}><Table2 size={15} /></button>
      {btn('Link', Link2, st.link, () => {
        const prev = (editor.getAttributes('link').href as string | undefined) ?? ''
        void os.dialog.prompt('Link address (https://…). Leave empty to remove the link.', { title: 'Link', defaultValue: prev }).then((url) => {
          if (url === null) return
          if (!url.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run()
          else if (/^(https?:|mailto:)/i.test(url.trim())) editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
          else void os.dialog.alert('Only web (https://) and mail links are allowed.', { title: 'Link' })
        })
      })}
      {btn('Formula $…$ (type $x$)', Sigma, false, () => void editorEnv.editMath('', false).then((l) => { if (l?.trim()) editor.chain().focus().insertContent({ type: 'mathInline', attrs: { latex: l.trim() } }).run() }))}
      <button className="k-icon-btn" aria-label="Link a sample (@)" title="Link a sample (@)" onMouseDown={(e) => e.preventDefault()} onClick={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        editorEnv.pickSample({ clientX: r.left, clientY: r.bottom + 2 }, (id) => { if (id) editor.chain().focus().insertContent([{ type: 'sampleMention', attrs: { id, label: id } }, { type: 'text', text: ' ' }]).run() })
      }}><AtSign size={15} /></button>
      <span className="k-sep" />
      <button className="k-btn small" onClick={blockMenu} data-menu-owner="ln-block" onMouseDown={(e) => e.preventDefault()}><Plus size={13} /> Insert block</button>
      <button className="k-btn small" onClick={() => void attachBlock('any')} onMouseDown={(e) => e.preventDefault()}><FilePlus2 size={13} /> Attach</button>
    </div>
  )
}

export function EntryView(p: Props) {
  const { nb, entry } = p
  const readOnly = entry.status !== 'draft'
  const latest = useRef(p)
  latest.current = p
  const pending = useRef(false)
  const tracker = useRef(createTracker(p.entry.content))
  const timer = useRef<number | null>(null)

  const editorRef = useRef<Editor | null>(null)
  const eenv = useMemo<EditorEnv>(() => ({
    sampleExists: (id) => latest.current.editorEnv.sampleExists(id),
    sampleLabel: (id) => latest.current.editorEnv.sampleLabel(id),
    editMath: (a, b) => latest.current.editorEnv.editMath(a, b),
    pickSample: (at, done) => latest.current.editorEnv.pickSample(at, done),
    openSample: (id) => latest.current.editorEnv.openSample(id),
    pastedFile: (f) => {
      const env = latest.current.blockEnv
      if (env.readOnly) return
      void env.attachFile(f).then((a) => { const ed = editorRef.current; if (a && ed && !ed.isDestroyed) insertAttachmentBlock(ed, env, a.id) })
    },
    droppedPaths: (ps) => {
      const env = latest.current.blockEnv
      if (env.readOnly) return
      void (async () => {
        for (const path of ps) {
          const a = await env.attachPath(path)
          const ed = editorRef.current
          if (a && ed && !ed.isDestroyed) insertAttachmentBlock(ed, env, a.id)
        }
      })()
    },
  }), [])
  const extensions = useMemo(() => createExtensions(eenv), [eenv])
  const props = useMemo(() => editorProps(eenv), [eenv])

  const editor = useEditor({
    extensions,
    content: entry.content as never,
    editable: !readOnly,
    editorProps: props,
    // the editor's own first output is the baseline: only a difference from it is an edit
    onCreate: ({ editor: ed }) => tracker.current.reset(ed.getJSON() as PMNode),
    onUpdate: () => {
      pending.current = true
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, 500)
    },
  }, [])

  const flush = useCallback(() => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null }
    if (!pending.current) return
    pending.current = false
    const ed = editorRef.current
    if (!ed || ed.isDestroyed || latest.current.entry.status !== 'draft') return
    const json = tracker.current.take(ed.getJSON() as PMNode) // null: the editor only tidied its document
    if (json) latest.current.onContent(json)
  }, [])
  editorRef.current = editor

  useEffect(() => {
    p.registerFlush(flush)
    return () => { flush(); p.registerFlush(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flush])

  useEffect(() => { editor?.setEditable(!readOnly, false) }, [editor, readOnly]) // false: no 'update' event, this is not an edit

  // the word count for the status bar
  useEffect(() => {
    if (!editor || !p.onWords) return
    const count = () => p.onWords?.(editor.getText().split(/\s+/).filter(Boolean).length)
    count()
    editor.on('update', count)
    return () => { editor.off('update', count) }
  }, [editor, p])

  const project = getProject(nb, entry.projectId)
  const experiments = useMemo(() => [...new Set(nb.entries.filter((e) => e.projectId === entry.projectId).map((e) => e.experiment))], [nb.entries, entry.projectId])
  const ctx = useMemo(() => renderCtx(nb, { math: renderMath }), [nb])
  const hash = useMemo(() => entryHash(entry), [entry])

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (a) {
      e.preventDefault()
      p.onLinkClick(a.getAttribute('href') ?? '', e.metaKey || e.ctrlKey)
    }
  }

  return (
    <BlockEnvContext.Provider value={p.blockEnv}>
      <div className="ln-entry">
        <div className="ln-entry-head">
          <input className="ln-title" value={entry.title} disabled={readOnly} placeholder="Entry title" aria-label="Entry title" onChange={(e) => p.onPatch({ title: e.target.value })} />
          <StatusBadge entry={entry} />
          <button className={`k-icon-btn${entry.favourite ? ' active' : ''}`} aria-label={entry.favourite ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={entry.favourite} title="Favourite" onClick={() => p.onPatch({ favourite: !entry.favourite })}><Star size={16} fill={entry.favourite ? 'currentColor' : 'none'} /></button>
        </div>
        <div className="ln-meta">
          <label><span>Project</span>
            <select className="k-input" value={entry.projectId} disabled={readOnly} onChange={(e) => p.onProject(e.target.value)}>
              {nb.projects.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
            </select></label>
          <label><span>Experiment</span>
            <input className="k-input" list="ln-experiments" value={entry.experiment} disabled={readOnly} onChange={(e) => p.onPatch({ experiment: e.target.value })} />
            <datalist id="ln-experiments">{experiments.map((x) => <option key={x} value={x} />)}</datalist></label>
          <label><span>Date</span><input className="k-input" type="datetime-local" value={entry.date.slice(0, 16)} disabled={readOnly} onChange={(e) => e.target.value && p.onPatch({ date: `${e.target.value}:00` })} /></label>
          <label><span>Author</span><input className="k-input" value={entry.author} disabled={readOnly} onChange={(e) => p.onPatch({ author: e.target.value })} /></label>
          <div className="ln-meta-tags"><span>Tags</span><TagsField tags={entry.tags} disabled={readOnly} onChange={(tags) => p.onPatch({ tags })} /></div>
        </div>

        {readOnly ? (
          <div className={`ln-banner ln-${entry.status}`} role="status">
            <Lock size={14} />
            <div>
              <b>{entry.status === 'witnessed' ? 'Signed and witnessed' : 'Signed'}</b> by {entry.signature?.user} on {entry.signature ? stamp(entry.signature.time) : ''} UTC
              {entry.witness && <>, witnessed by <b>{entry.witness.user}</b> on {stamp(entry.witness.time)} UTC</>}. Read-only: add an addendum to correct or complete it.
              <div className="ln-hash" title="SHA-256 of the entry's content when it was signed">SHA-256 {entry.signature?.hash}{hash !== entry.signature?.hash && <b className="ln-bad"> · the entry no longer matches this hash</b>}</div>
            </div>
          </div>
        ) : editor ? <Toolbar editor={editor} blockEnv={p.blockEnv} editorEnv={eenv} /> : null}

        <div className={`ln-editor${readOnly ? ' readonly' : ''}`} onClick={onClick}>
          {editor && <EditorContent editor={editor} />}
        </div>

        {entry.addenda.length > 0 && (
          <section className="ln-addenda" aria-label="Addenda">
            <h3><Pencil size={14} /> Addenda</h3>
            {entry.addenda.map((a) => (
              <article key={a.id} className="ln-addendum">
                <header><b>{a.author}</b> · {stamp(a.time)} UTC <span className="k-muted">· reason: {a.reason}</span></header>
                <Html html={docToHtml(a.content, ctx)} className="ln-addendum-body" />
                <div className="ln-hash">SHA-256 {a.hash}</div>
              </article>
            ))}
          </section>
        )}

        <div className="ln-entry-actions">
          {!readOnly && <button className="k-btn primary" onClick={p.onSign} title="Sign this entry: it becomes read-only"><FileSignature size={14} /> Sign…</button>}
          {entry.status === 'signed' && <button className="k-btn" onClick={p.onWitness}><ShieldCheck size={14} /> Witness…</button>}
          {readOnly && <button className="k-btn" onClick={p.onAmend}><Pencil size={14} /> Add addendum…</button>}
          <button className="k-btn" onClick={p.onDuplicate} title="A new draft with the same content"><Copy size={14} /> Duplicate as new draft</button>
          {!readOnly && <button className="k-btn" onClick={p.onDelete}><Trash2 size={14} /> Delete draft</button>}
          <span className="k-muted ln-entry-info">{project?.code} · {shortDate(entry.date)} · modified {stamp(entry.modified)}</span>
        </div>
      </div>
    </BlockEnvContext.Provider>
  )
}
