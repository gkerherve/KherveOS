// Where messages are written: grows with its text, Enter sends, Shift+Enter
// starts a new line, ↑ in an empty box edits your last message.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, LoaderCircle, Pencil, SendHorizontal, X } from 'lucide-react'
import { os } from '@/os'
import { realtime } from '@/os/server'
import { MAX_MESSAGE } from './api'
import { drafts, editMessage, errorText, sendMessage } from './store'
import type { ChatMessage, Conversation } from './types'

/** Tell the others we're typing at most this often (ms). */
const TYPING_EVERY = 3000

interface Props {
  conversation: Conversation
  editing: ChatMessage | null
  onStopEditing: () => void
  /** Start editing your latest message; false if there is none. */
  onEditLast: () => boolean
}

export function Composer({ conversation: c, editing, onStopEditing, onEditLast }: Props) {
  const [text, setText] = useState(() => drafts.get(c.id) ?? '')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const lastTyping = useRef(0)
  const editingId = useRef<number | null>(null)

  const focusEnd = () =>
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })

  // Swap the box between the draft and the message being edited.
  useEffect(() => {
    const id = editing?.id ?? null
    if (id === editingId.current) return
    editingId.current = id
    setText(editing ? editing.body : (drafts.get(c.id) ?? ''))
    focusEnd()
  }, [editing, c.id])

  useEffect(() => {
    focusEnd()
  }, [])

  // Grow with the text, up to about eight lines.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 172)}px`
  }, [text])

  const body = text.trim()
  const tooLong = body.length > MAX_MESSAGE
  const canSend = !!body && !tooLong && !saving

  const submit = async () => {
    if (!canSend) return
    if (editing) {
      if (body === editing.body) {
        onStopEditing()
        return
      }
      setSaving(true)
      try {
        await editMessage(editing, body)
        onStopEditing()
      } catch (err) {
        await os.dialog.alert(errorText(err), { title: 'The message could not be edited' })
      } finally {
        setSaving(false)
      }
      return
    }
    sendMessage(c.id, body)
    setText('')
    drafts.delete(c.id)
    lastTyping.current = 0
  }

  const onChange = (value: string) => {
    setText(value)
    if (editing) return
    if (value) drafts.set(c.id, value)
    else drafts.delete(c.id)
    const now = Date.now()
    if (value.trim() && now - lastTyping.current > TYPING_EVERY) {
      lastTyping.current = now
      realtime.send({ type: 'typing', conversation_id: c.id })
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    } else if (e.key === 'Escape' && editing) {
      e.preventDefault()
      onStopEditing()
    } else if (e.key === 'ArrowUp' && !text && !editing) {
      if (onEditLast()) e.preventDefault()
    }
  }

  const count = body.length
  return (
    <form
      className={`msg-composer${editing ? ' editing' : ''}`}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      {editing && (
        <div className="msg-editing-bar">
          <Pencil size={13} />
          <span>Editing message</span>
          <span className="msg-editing-hint">Esc to cancel</span>
          <button type="button" className="k-icon-btn" aria-label="Cancel editing" onClick={onStopEditing}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="msg-composer-box">
        <textarea
          ref={ref}
          className="msg-input"
          rows={1}
          value={text}
          placeholder={editing ? 'Edit your message' : `Message ${c.title}`}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={editing ? 'Edit message' : `Message ${c.title}`}
        />
        <button
          type="submit"
          className="msg-send"
          disabled={!canSend}
          title={editing ? 'Save (Enter)' : 'Send (Enter)'}
          aria-label={editing ? 'Save' : 'Send'}
        >
          {saving ? <LoaderCircle size={16} className="k-spin" /> : editing ? <Check size={17} /> : <SendHorizontal size={17} />}
        </button>
      </div>
      {count > MAX_MESSAGE - 400 && (
        <div className={`msg-count${tooLong ? ' over' : ''}`}>
          {count.toLocaleString()} / {MAX_MESSAGE.toLocaleString()}
        </div>
      )}
    </form>
  )
}
