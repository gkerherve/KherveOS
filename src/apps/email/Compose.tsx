// Writing a message: a panel over the mail window. Cmd/Ctrl+Enter sends.

import { useEffect, useId, useRef, useState } from 'react'
import { CircleAlert, HardDrive, LoaderCircle, Monitor, Paperclip, Send, Trash2, X } from 'lucide-react'
import { HOME, os, path } from '@/os'
import type { WindowApi } from '@/os'
import { errorMessage, mail, type Account } from './api'
import { blobToBase64, formatBytes, guessType, splitAddresses, type ComposeInit } from './util'

const LIMIT = 25 * 1024 * 1024
const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent)

interface Draft {
  id: number
  filename: string
  contentType: string
  size: number
  /** null while a forwarded attachment is still downloading. */
  blob: Blob | null
  error?: string
}

let nextDraftId = 1

interface ComposeProps {
  init: ComposeInit
  accounts: Account[]
  win: WindowApi
  onClose(): void
  onSent(init: ComposeInit): void
}

export function Compose({ init, accounts, win, onClose, onSent }: ComposeProps) {
  const id = useId()
  const [accountId, setAccountId] = useState(init.accountId)
  const [to, setTo] = useState(init.to)
  const [cc, setCc] = useState(init.cc)
  const [bcc, setBcc] = useState(init.bcc)
  const [showCc, setShowCc] = useState(!!init.cc)
  const [showBcc, setShowBcc] = useState(!!init.bcc)
  const [subject, setSubject] = useState(init.subject)
  const [body, setBody] = useState(init.body)
  const [files, setFiles] = useState<Draft[]>(
    () =>
      init.forwardAttachments?.attachments.map((a) => ({
        id: nextDraftId++,
        filename: a.filename,
        contentType: a.content_type,
        size: a.size,
        blob: null,
      })) ?? [],
  )
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const forwardIds = useRef(files.map((f) => f.id))
  const toRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const pickRef = useRef<HTMLInputElement>(null)

  const totalSize = files.reduce((n, f) => n + f.size, 0)
  const dirty =
    to !== init.to || cc !== init.cc || bcc !== init.bcc || subject !== init.subject || body !== init.body ||
    files.length !== forwardIds.current.length

  // Cursor: the top of the body for replies, the To field otherwise.
  useEffect(() => {
    if (init.focus === 'body' && bodyRef.current) {
      bodyRef.current.focus()
      bodyRef.current.setSelectionRange(0, 0)
      bodyRef.current.scrollTop = 0
    } else toRef.current?.focus()
  }, [init])

  // Forwarding: bring the original attachments along.
  useEffect(() => {
    const fwd = init.forwardAttachments
    if (!fwd) return
    let alive = true
    fwd.attachments.forEach((att, i) => {
      const draftId = forwardIds.current[i]
      mail.attachment(fwd.accountId, fwd.folder, fwd.uid, att.index).then(
        (blob) => alive && setFiles((fs) => fs.map((f) => (f.id === draftId ? { ...f, blob, size: blob.size } : f))),
        (err) => alive && setFiles((fs) => fs.map((f) => (f.id === draftId ? { ...f, error: errorMessage(err) } : f))),
      )
    })
    return () => {
      alive = false
    }
  }, [init])

  // Closing the Email window with an unsent message asks first.
  useEffect(() => {
    if (!dirty) return
    win.setCloseGuard(() =>
      os.dialog.confirm('You are writing a message that has not been sent. Close Email and discard it?', {
        title: 'Discard message?',
        okLabel: 'Discard',
        danger: true,
      }),
    )
    return () => win.setCloseGuard(null)
  }, [dirty, win])

  const discard = async () => {
    if (sending) return
    if (dirty && !(await os.dialog.confirm('Discard this message?', { title: 'Discard message', okLabel: 'Discard', danger: true }))) return
    onClose()
  }

  const add = (blobs: { name: string; blob: Blob }[]) => {
    setError(null)
    setFiles((fs) => [
      ...fs,
      ...blobs.map(({ name, blob }) => ({
        id: nextDraftId++,
        filename: name,
        contentType: blob.type || guessType(name),
        size: blob.size,
        blob,
      })),
    ])
  }

  const attachFromFiles = async () => {
    const p = await os.dialog.openFile({ title: 'Attach a file', startDir: HOME })
    if (!p) return
    try {
      const data = await os.fs.readBytes(p)
      const name = path.basename(p)
      add([{ name, blob: new Blob([data as BlobPart], { type: guessType(name) }) }])
    } catch (err) {
      setError(`Could not read ${path.basename(p)}: ${errorMessage(err)}`)
    }
  }

  const sendNow = async () => {
    if (sending) return
    const toList = splitAddresses(to)
    const ccList = splitAddresses(cc)
    const bccList = splitAddresses(bcc)
    if (!toList.length && !ccList.length && !bccList.length) {
      setError('Add at least one recipient.')
      toRef.current?.focus()
      return
    }
    if (files.some((f) => f.error)) return setError('An attachment could not be loaded. Remove it to send the message.')
    if (files.some((f) => !f.blob)) return setError('Wait a moment: the attachments are still loading.')
    if (totalSize > LIMIT) return setError('Attachments are limited to 25 MB in total.')
    if (!subject.trim() && !(await os.dialog.confirm('Send this message without a subject?', { title: 'No subject', okLabel: 'Send' }))) return
    setSending(true)
    setError(null)
    try {
      const attachments = await Promise.all(
        files.map(async (f) => ({ filename: f.filename, content_type: f.contentType, data_base64: await blobToBase64(f.blob!) })),
      )
      const result = await mail.send(accountId, {
        to: toList,
        cc: ccList,
        bcc: bccList,
        subject: subject.trim(),
        text: body,
        in_reply_to: init.inReplyTo,
        references: init.references,
        attachments,
      })
      win.setCloseGuard(null)
      onSent(init)
      os.notify({ title: 'Message sent', body: result.warning ?? (subject.trim() || '(no subject)'), icon: Send, color: '#ef4444' })
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setSending(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void sendNow()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      void discard()
    }
  }

  const attachMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    os.contextMenu({ clientX: r.left, clientY: r.top - 80 }, [
      { label: 'From Files…', icon: HardDrive, onClick: () => void attachFromFiles() },
      { label: 'From this computer…', icon: Monitor, onClick: () => pickRef.current?.click() },
    ])
  }

  const account = accounts.find((a) => a.id === accountId)

  return (
    <div className="mail-overlay">
      <div
        className="mail-compose"
        role="dialog"
        aria-modal="true"
        aria-label={init.title}
        onKeyDown={onKeyDown}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault()
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return
          e.preventDefault()
          add([...e.dataTransfer.files].map((f) => ({ name: f.name, blob: f })))
        }}
      >
        <div className="mail-compose-head">
          <span className="mail-compose-title">{init.title}</span>
          <button className="k-icon-btn" onClick={() => void discard()} aria-label="Close" title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="mail-fields">
          <div className="mail-field">
            <label htmlFor={`${id}-from`}>From</label>
            {accounts.length > 1 ? (
              <select id={`${id}-from`} value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.display_name ? `${a.display_name} <${a.email}>` : a.email}
                  </option>
                ))}
              </select>
            ) : (
              <span id={`${id}-from`} className="mail-field-static">
                {account ? (account.display_name ? `${account.display_name} <${account.email}>` : account.email) : ''}
              </span>
            )}
          </div>
          <div className="mail-field">
            <label htmlFor={`${id}-to`}>To</label>
            <input
              id={`${id}-to`}
              ref={toRef}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="name@example.com, …"
              spellCheck={false}
              autoComplete="off"
            />
            <span className="mail-field-extra">
              {!showCc && (
                <button type="button" className="k-link-btn" onClick={() => setShowCc(true)}>
                  Cc
                </button>
              )}
              {!showBcc && (
                <button type="button" className="k-link-btn" onClick={() => setShowBcc(true)}>
                  Bcc
                </button>
              )}
            </span>
          </div>
          {showCc && (
            <div className="mail-field">
              <label htmlFor={`${id}-cc`}>Cc</label>
              <input id={`${id}-cc`} value={cc} onChange={(e) => setCc(e.target.value)} spellCheck={false} autoComplete="off" />
            </div>
          )}
          {showBcc && (
            <div className="mail-field">
              <label htmlFor={`${id}-bcc`}>Bcc</label>
              <input id={`${id}-bcc`} value={bcc} onChange={(e) => setBcc(e.target.value)} spellCheck={false} autoComplete="off" />
            </div>
          )}
          <div className="mail-field">
            <label htmlFor={`${id}-subject`}>Subject</label>
            <input id={`${id}-subject`} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
        </div>

        <textarea
          ref={bodyRef}
          className="mail-compose-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your message…"
          aria-label="Message"
        />

        {files.length > 0 && (
          <div className="mail-compose-files">
            {files.map((f) => (
              <span key={f.id} className={`mail-chip${f.error ? ' error' : ''}`} title={f.error ?? `${f.filename} · ${f.contentType}`}>
                {f.blob || f.error ? <Paperclip size={13} /> : <LoaderCircle size={13} className="k-spin" />}
                <span className="mail-chip-name">{f.filename}</span>
                <span className="mail-chip-size">{f.error ? 'failed' : formatBytes(f.size)}</span>
                <button
                  type="button"
                  className="mail-chip-remove"
                  aria-label={`Remove ${f.filename}`}
                  onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        {error && (
          <div className="mail-compose-error" role="alert">
            <CircleAlert size={15} />
            <span>{error}</span>
          </div>
        )}

        <div className="mail-compose-foot">
          <button className="k-btn primary" onClick={() => void sendNow()} disabled={sending}>
            {sending ? <LoaderCircle size={14} className="k-spin" /> : <Send size={14} />}
            {sending ? 'Sending…' : 'Send'}
          </button>
          <span className="mail-hint">{MAC ? '⌘' : 'Ctrl'}+Enter</span>
          <button className="k-btn" onClick={attachMenu} disabled={sending}>
            <Paperclip size={14} /> Attach
          </button>
          <input
            ref={pickRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              add([...(e.target.files ?? [])].map((f) => ({ name: f.name, blob: f })))
              e.target.value = ''
            }}
          />
          <span className="mail-spacer" />
          {files.length > 0 && (
            <span className={`mail-hint${totalSize > LIMIT ? ' over' : ''}`}>
              {formatBytes(totalSize)}
              {totalSize > LIMIT ? ' — over 25 MB' : ''}
            </span>
          )}
          <button className="k-icon-btn" title="Discard" aria-label="Discard" onClick={() => void discard()} disabled={sending}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
