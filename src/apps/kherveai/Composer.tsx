// Where messages are written: grows with its text, Enter sends, Shift+Enter
// starts a new line, Esc stops a reply. Files from the drive can be attached
// (paperclip, or dragged in from Files): their text, or the picture, goes with
// the message. The camera next to the paperclip attaches a screenshot of a
// window or of the whole screen (saved in ~/Pictures/Screenshots too).

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, Camera, FileText, LoaderCircle, Monitor, Paperclip, Square, X } from 'lucide-react'
import { HOME, formatSize, os, type MenuItem } from '@/os'
import { DRAG_MIME } from '@/os/fileActions'
import { AppIcon } from '@/os/ui/AppIcon'
import { screenshotTargets, type ShotTarget } from '@/os/screenshot'
import { MAX_PICTURES, pictureUrl, screenshotForMessage } from './pictures'
import './pictures.css'
import { sendMessage } from './agent'
import { MAX_ATTACH_CHARS, readAttachment } from './history'
import { ollamaModel, stopRun, useAi } from './store'
import type { Attachment, Chat } from './types'
import { errorText } from './util'

// Unsent text and files, per chat, kept while you look at another chat.
const drafts = new Map<string, { text: string; files: Attachment[] }>()

type Command = { type: 'attach' } | { type: 'focus' } | { type: 'fill'; text: string; files: Attachment[] }
const listeners = new Set<(chatId: string, cmd: Command) => void>()

/** Talk to the composer of a chat (menus, "Edit" on a message…). */
export function composerCommand(chatId: string, cmd: Command) {
  if (cmd.type === 'fill') drafts.set(chatId, { text: cmd.text, files: cmd.files })
  for (const l of [...listeners]) l(chatId, cmd)
}

export function Composer({ chat, placeholder }: { chat: Chat; placeholder: string }) {
  const running = useAi((s) => !!s.running[chat.id])
  const [text, setText] = useState(() => drafts.get(chat.id)?.text ?? '')
  const [files, setFiles] = useState<Attachment[]>(() => drafts.get(chat.id)?.files ?? [])
  const [reading, setReading] = useState(0)
  const [dragging, setDragging] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const filesRef = useRef(files)
  filesRef.current = files

  const focusEnd = () =>
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })

  useEffect(() => {
    focusEnd()
  }, [])

  // Remember the draft.
  useEffect(() => {
    if (text || files.length) drafts.set(chat.id, { text, files })
    else drafts.delete(chat.id)
  }, [chat.id, text, files])

  // Grow with the text, up to about ten lines.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [text])

  const addPaths = async (paths: string[]) => {
    let current = filesRef.current
    for (const p of paths) {
      if (current.some((f) => f.path === p)) continue
      if (current.filter((f) => f.image).length >= MAX_PICTURES && /\.(png|jpe?g|gif|webp|bmp)$/i.test(p)) {
        await os.dialog.alert(`One message can carry ${MAX_PICTURES} pictures. Send this message first, then attach more in the next one.`, {
          title: 'Too many pictures',
        })
        return
      }
      const used = current.reduce((n, f) => n + f.text.length, 0)
      const budget = MAX_ATTACH_CHARS - used
      if (budget < 1000) {
        await os.dialog.alert('That is as much text as one message can carry. Send this message first, then attach more in the next one.', {
          title: 'Too much attached',
        })
        return
      }
      setReading((n) => n + 1)
      try {
        const a = await readAttachment(p, budget)
        current = [...current, a]
        setFiles((list) => (list.some((f) => f.path === a.path) ? list : [...list, a]))
      } catch (e) {
        await os.dialog.alert(errorText(e), { title: 'Could not attach the file' })
      } finally {
        setReading((n) => n - 1)
      }
    }
    focusEnd()
  }

  const pickFile = async () => {
    const p = await os.dialog.openFile({ title: 'Attach a file', startDir: `${HOME}/Documents` })
    if (p) await addPaths([p])
    else focusEnd()
  }

  // The camera: pick a window (or the whole screen) from a menu above the button.
  const takeShot = async (target: ShotTarget) => {
    setReading((n) => n + 1)
    let path: string | null = null
    try {
      path = await screenshotForMessage(target)
    } catch (e) {
      await os.dialog.alert(errorText(e), { title: 'Could not take the screenshot' })
    } finally {
      setReading((n) => n - 1)
    }
    if (path) await addPaths([path])
    else focusEnd()
  }
  const pickShot = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    // The whole screen, a line, then the windows on screen, front first.
    const items: MenuItem[] = screenshotTargets().map((t) => {
      const app = t.app ? os.getApp(t.app) : undefined
      return {
        label: t.label,
        ...(t.target === 'screen' ? { icon: Monitor } : app ? { image: <AppIcon app={app} size={16} /> } : {}),
        onClick: () => void takeShot(t.target),
      }
    })
    if (items.length > 1) items.splice(1, 0, '-')
    os.contextMenu(
      { clientX: r.left, clientY: r.top - 4 },
      items,
      { above: true, owner: `kai-shot-${chat.id}` },
    )
  }

  // Commands from the menus and messages.
  const pickRef = useRef(pickFile)
  pickRef.current = pickFile
  useEffect(() => {
    const onCmd = (id: string, cmd: Command) => {
      if (id !== chat.id) return
      if (cmd.type === 'attach') void pickRef.current()
      else if (cmd.type === 'focus') focusEnd()
      else {
        setText(cmd.text)
        setFiles(cmd.files)
        focusEnd()
      }
    }
    listeners.add(onCmd)
    return () => void listeners.delete(onCmd)
  }, [chat.id])

  const canSend = !running && !reading && (!!text.trim() || files.length > 0)
  // Ollama models without "vision" can't see pictures: say so before sending.
  const blind = useAi((s) => {
    if (chat.provider !== 'ollama') return false
    const caps = ollamaModel(chat.model, s)?.caps
    return !!caps && !caps.includes('vision')
  })
  const hasPictures = files.some((f) => f.image)

  const send = () => {
    if (!canSend) return
    if (sendMessage(chat.id, text, files)) {
      setText('')
      setFiles([])
      drafts.delete(chat.id)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    } else if (e.key === 'Escape' && running) {
      e.preventDefault()
      stopRun(chat.id)
    }
  }

  const dragPaths = (e: React.DragEvent): boolean => e.dataTransfer.types.includes(DRAG_MIME)

  return (
    <div
      className={`kai-composer${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        if (!dragPaths(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        setDragging(false)
        if (!dragPaths(e)) return
        e.preventDefault()
        try {
          const paths = JSON.parse(e.dataTransfer.getData(DRAG_MIME)) as unknown
          if (Array.isArray(paths)) void addPaths(paths.filter((p): p is string => typeof p === 'string'))
        } catch {
          /* not ours */
        }
      }}
    >
      {(files.length > 0 || reading > 0) && (
        <div className="kai-chips">
          {files.map((f) => (
            <span key={f.path} className={`kai-chip${f.image ? ' picture' : ''}`} title={`${f.path}${f.truncated ? ` — long file: the model gets its start and end (${f.text.length.toLocaleString()} of ${f.chars.toLocaleString()} characters)` : ''}`}>
              {f.image ? <img className="kai-chip-thumb" src={pictureUrl(f.image)} alt="" draggable={false} /> : <FileText size={13} />}
              <span className="kai-chip-name">{f.name}</span>
              <span className="kai-chip-meta">
                {formatSize(f.size)}
                {f.truncated ? ' · shortened' : ''}
              </span>
              <button className="kai-chip-x" aria-label={`Remove ${f.name}`} onClick={() => setFiles((list) => list.filter((x) => x.path !== f.path))}>
                <X size={12} />
              </button>
            </span>
          ))}
          {reading > 0 && (
            <span className="kai-chip">
              <LoaderCircle size={13} className="k-spin" /> Reading…
            </span>
          )}
        </div>
      )}
      <div className="kai-composer-box">
        <button className="k-icon-btn kai-attach" title="Attach a file from the drive" aria-label="Attach a file" onClick={() => void pickFile()}>
          <Paperclip size={17} />
        </button>
        <button
          className="k-icon-btn kai-attach kai-shot"
          title="Attach a screenshot of a window or of the whole screen"
          aria-label="Attach a screenshot"
          data-menu-owner={`kai-shot-${chat.id}`}
          disabled={reading > 0}
          onClick={pickShot}
        >
          <Camera size={17} />
        </button>
        <textarea
          ref={ref}
          className="kai-input"
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Message"
          spellCheck
        />
        {running ? (
          <button className="kai-send stop" title="Stop (Esc)" aria-label="Stop" onClick={() => stopRun(chat.id)}>
            <Square size={13} fill="currentColor" />
          </button>
        ) : (
          <button className="kai-send" title="Send (Enter)" aria-label="Send" disabled={!canSend} onClick={send}>
            <ArrowUp size={18} />
          </button>
        )}
      </div>
      <div className="kai-hint">
        {dragging
          ? 'Drop to attach'
          : running
            ? 'Writing… Esc or ■ stops it'
            : hasPictures && blind
              ? `${chat.model} can't see pictures: choose a vision model to ask about them`
              : 'Enter to send · Shift+Enter for a new line · drag files here from Files'}
      </div>
    </div>
  )
}
