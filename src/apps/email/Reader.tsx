// The reading pane: headers, actions, attachments and the body.

import { useMemo, useState } from 'react'
import {
  ArrowLeft, CircleAlert, Download, Flag, FolderInput, Forward, HardDriveDownload, ImageOff, LoaderCircle, Mail,
  MailOpen, Paperclip, RefreshCw, Reply, ReplyAll, Trash2,
} from 'lucide-react'
import { HOME, os, path } from '@/os'
import { mail, type Address, type Attachment, type MessageDetail } from './api'
import { deleteMessage, failure, menuBelow, moveMenuItems } from './actions'
import { HtmlBody } from './HtmlBody'
import { useMail, useMailStore, type FolderRef } from './store'
import { displayName, formatBytes, fullDate, initials, linkify, quoteBlocks } from './util'

interface ReaderProps {
  onReply(all: boolean): void
  onForward(): void
  onWrite(to: string): void
  onBack?: () => void
}

export function Reader({ onReply, onForward, onWrite, onBack }: ReaderProps) {
  const store = useMailStore()
  const current = useMail((s) => s.current)
  const selected = useMail((s) => s.selected)
  const detail = useMail((s) => s.detail)
  const loading = useMail((s) => s.detailLoading)
  const error = useMail((s) => s.detailError)
  const total = useMail((s) => s.total)
  const d = detail && detail.uid === selected ? detail : null
  const act = (fn: (s: ReturnType<typeof store.getState>, uid: number) => void) => () => {
    if (d) fn(store.getState(), d.uid)
  }

  return (
    <section className="mail-reader" aria-label="Message">
      <div className="k-toolbar mail-bar">
        {onBack && (
          <button className="k-icon-btn" title="Back to the messages" aria-label="Back" onClick={onBack}>
            <ArrowLeft size={16} />
          </button>
        )}
        <button className="k-icon-btn" title="Reply" aria-label="Reply" disabled={!d} onClick={() => onReply(false)}>
          <Reply size={16} />
        </button>
        <button className="k-icon-btn" title="Reply all" aria-label="Reply all" disabled={!d} onClick={() => onReply(true)}>
          <ReplyAll size={16} />
        </button>
        <button className="k-icon-btn" title="Forward" aria-label="Forward" disabled={!d} onClick={onForward}>
          <Forward size={16} />
        </button>
        <span className="k-sep" />
        <button
          className="k-icon-btn"
          title={d?.seen === false ? 'Mark as read' : 'Mark as unread'}
          aria-label={d?.seen === false ? 'Mark as read' : 'Mark as unread'}
          disabled={!d}
          onClick={act((s, uid) => void s.setFlags(uid, { seen: !d!.seen }))}
        >
          {d?.seen === false ? <MailOpen size={16} /> : <Mail size={16} />}
        </button>
        <button
          className={`k-icon-btn${d?.flagged ? ' mail-flag-on' : ''}`}
          title={d?.flagged ? 'Remove the flag' : 'Flag'}
          aria-label={d?.flagged ? 'Remove the flag' : 'Flag'}
          aria-pressed={!!d?.flagged}
          disabled={!d}
          onClick={act((s, uid) => void s.setFlags(uid, { flagged: !d!.flagged }))}
        >
          <Flag size={16} />
        </button>
        <button className="k-icon-btn" title="Move to…" aria-label="Move to" disabled={!d} onClick={(e) => d && menuBelow(e, moveMenuItems(store, d.uid))}>
          <FolderInput size={16} />
        </button>
        <span className="k-spacer" />
        <button
          className="k-icon-btn mail-delete-btn"
          title="Delete"
          aria-label="Delete"
          disabled={!d}
          onClick={() => d && void deleteMessage(store, d.uid)}
        >
          <Trash2 size={16} />
        </button>
      </div>

      {d && current ? (
        <MessageView key={`${current.accountId}:${current.folder}:${d.uid}`} detail={d} folder={current} onWrite={onWrite} />
      ) : selected != null && loading ? (
        <div className="mail-placeholder">
          <LoaderCircle size={22} className="k-spin" />
        </div>
      ) : selected != null && error ? (
        <div className="mail-placeholder">
          <CircleAlert size={26} />
          <p>{error}</p>
          <button className="k-btn" onClick={() => void store.getState().select(selected)}>
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      ) : (
        <div className="mail-placeholder">
          <Mail size={34} strokeWidth={1.4} />
          <p>{total ? 'Select a message to read it.' : 'Nothing to read here.'}</p>
        </div>
      )}
    </section>
  )
}

function names(list: Address[]): string {
  return list.map((a) => a.name || a.address).join(', ')
}

function MessageView({ detail: d, folder, onWrite }: { detail: MessageDetail; folder: FolderRef; onWrite(to: string): void }) {
  const [showRemote, setShowRemote] = useState(false)
  const [remote, setRemote] = useState(0)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const h = d.headers
  const sender = displayName(h.from) || '(unknown sender)'

  const withAttachment = async (att: Attachment, kind: 'download' | 'save') => {
    const key = `${kind}${att.index}`
    setBusy((b) => ({ ...b, [key]: true }))
    try {
      const blob = await mail.attachment(folder.accountId, folder.folder, d.uid, att.index)
      if (kind === 'download') {
        os.downloadBlob(att.filename, blob)
      } else {
        const dir = `${HOME}/Downloads`
        await os.fs.mkdir(dir, { recursive: true })
        const name = os.fs.uniqueName(dir, att.filename)
        const target = path.join(dir, name)
        await os.fs.writeBytes(target, new Uint8Array(await blob.arrayBuffer()))
        os.notify({ title: 'Saved to Downloads', body: name, icon: HardDriveDownload, onClick: () => void os.openFile(target) })
      }
    } catch (err) {
      failure(`Could not ${kind === 'download' ? 'download' : 'save'} ${att.filename}`, err)
    } finally {
      setBusy((b) => ({ ...b, [key]: false }))
    }
  }

  return (
    <div className="mail-message">
      <header className="mail-head">
        <h2 className="mail-subject">{h.subject || '(no subject)'}</h2>
        <div className="mail-from-row">
          <span className="k-avatar mail-avatar" aria-hidden>
            {initials(sender)}
          </span>
          <div className="mail-from">
            <div className="mail-from-line">
              <strong>{sender}</strong>
              {h.from?.name && <span className="k-muted"> &lt;{h.from.address}&gt;</span>}
            </div>
            {(h.to.length > 0 || h.cc.length > 0) && (
              <div className="mail-recipients k-muted" title={[...h.to, ...h.cc].map((a) => a.address).join(', ')}>
                {h.to.length > 0 && <>To: {names(h.to)}</>}
                {h.cc.length > 0 && <>{h.to.length > 0 && ' · '}Cc: {names(h.cc)}</>}
              </div>
            )}
          </div>
          <time className="mail-date k-muted" dateTime={h.date ?? undefined}>
            {fullDate(h.date)}
          </time>
        </div>
      </header>

      {d.html && !showRemote && remote > 0 && (
        <div className="mail-banner">
          <ImageOff size={15} />
          <span>Remote images are hidden to protect your privacy.</span>
          <button className="k-link-btn" onClick={() => setShowRemote(true)}>
            Show images
          </button>
        </div>
      )}

      {d.attachments.length > 0 && (
        <div className="mail-attachments" aria-label="Attachments">
          {d.attachments.map((att) => (
            <div className="mail-attachment" key={att.index} title={`${att.filename} · ${att.content_type}`}>
              <Paperclip size={14} className="mail-attachment-icon" />
              <span className="mail-attachment-name">{att.filename}</span>
              <span className="mail-attachment-size">{formatBytes(att.size)}</span>
              <button
                className="k-icon-btn"
                title="Download to this computer"
                aria-label={`Download ${att.filename}`}
                disabled={busy[`download${att.index}`]}
                onClick={() => void withAttachment(att, 'download')}
              >
                {busy[`download${att.index}`] ? <LoaderCircle size={14} className="k-spin" /> : <Download size={14} />}
              </button>
              <button
                className="k-icon-btn"
                title="Save to Files (Downloads)"
                aria-label={`Save ${att.filename} to Files`}
                disabled={busy[`save${att.index}`]}
                onClick={() => void withAttachment(att, 'save')}
              >
                {busy[`save${att.index}`] ? <LoaderCircle size={14} className="k-spin" /> : <HardDriveDownload size={14} />}
              </button>
            </div>
          ))}
        </div>
      )}

      {d.html ? (
        <HtmlBody html={d.html} showRemote={showRemote} title={h.subject || 'Message'} onRemote={setRemote} />
      ) : (
        <PlainBody text={d.text} onWrite={onWrite} />
      )}
    </div>
  )
}

function PlainBody({ text, onWrite }: { text: string; onWrite(to: string): void }) {
  const blocks = useMemo(() => quoteBlocks(text.replace(/\s+$/, '')), [text])
  if (!text.trim()) return <div className="mail-text mail-text-empty">This message has no text.</div>
  return (
    <div className="mail-text">
      {blocks.map((b, i) => {
        const content = linkify(b.text).map((p, j) =>
          p.href ? (
            <a
              key={j}
              href={p.href}
              onClick={(e) => {
                e.preventDefault()
                os.openUrl(p.href!, { background: e.metaKey || e.ctrlKey })
              }}
            >
              {p.text}
            </a>
          ) : p.email ? (
            <a
              key={j}
              href={`mailto:${p.email}`}
              onClick={(e) => {
                e.preventDefault()
                onWrite(p.email!)
              }}
            >
              {p.text}
            </a>
          ) : (
            p.text
          ),
        )
        return b.quote ? (
          <blockquote key={i} className="mail-quote">
            {content}
          </blockquote>
        ) : (
          <div key={i}>{content}</div>
        )
      })}
    </div>
  )
}
