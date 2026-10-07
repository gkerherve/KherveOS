// One message in the conversation: your bubble (with its attached files), or
// KherveAI's reply — its thinking, its text and each tool it used (collapsible).

import { memo, useState } from 'react'
import {
  AlertTriangle, Brain, Check, ChevronRight, CircleSlash, Clock, Copy, FileText, KeyRound, LoaderCircle, Pencil, Play, RefreshCw,
  Sparkles, Wrench, X,
} from 'lucide-react'
import { formatSize, os, path as vpath } from '@/os'
import { continueRun, regenerate, MAX_STEPS } from './agent'
import { composerCommand } from './Composer'
import { pictureUrl } from './pictures'
import { Markdown } from './Markdown'
import { openDialog, takeLastUserMessage } from './store'
import type { AssistantMessage, ToolCall, Turn, UserMessage } from './types'
import { clip, clockTime, copyToClipboard, safeJson } from './util'

// ------------------------------------------------------------------- yours

export const UserBubble = memo(function UserBubble({ m, chatId, canEdit }: { m: UserMessage; chatId: string; canEdit: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (await copyToClipboard(m.text)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    }
  }
  const edit = () => {
    const taken = takeLastUserMessage(chatId)
    if (taken) composerCommand(chatId, { type: 'fill', text: taken.text, files: taken.attachments ?? [] })
  }
  return (
    <div className="kai-msg kai-user">
      {m.attachments?.length ? (
        <div className="kai-attached">
          {m.attachments.map((a) =>
            a.image ? (
              <button key={a.path} className="kai-picture" title={`Open ${vpath.pretty(a.path)}`} onClick={() => void os.openFile(a.path)}>
                <img src={pictureUrl(a.image)} alt={a.name} draggable={false} />
              </button>
            ) : (
              <button key={a.path} className="kai-file" title={`Open ${a.path}`} onClick={() => void os.openFile(a.path)}>
                <FileText size={14} />
                <span className="kai-file-name">{a.name}</span>
                <span className="kai-file-meta">
                  {formatSize(a.size)}
                  {a.truncated ? ' · shortened' : ''}
                </span>
              </button>
            ),
          )}
        </div>
      ) : null}
      {m.text && <div className="kai-bubble">{m.text}</div>}
      <div className="kai-msg-actions kai-user-actions">
        <span className="kai-time">{clockTime(m.time)}</span>
        {m.text && (
          <button className="kai-act-btn" title="Copy" aria-label="Copy message" onClick={() => void copy()}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        )}
        {canEdit && (
          <button className="kai-act-btn" title="Edit and send again" aria-label="Edit message" onClick={edit}>
            <Pencil size={13} />
          </button>
        )}
      </div>
    </div>
  )
})

// ------------------------------------------------------------------- tools

function argSummary(args: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(args)) {
    if (parts.length >= 2) {
      parts.push('…')
      break
    }
    let s: string
    if (typeof v === 'string') s = v.startsWith('/') ? vpath.pretty(v) : JSON.stringify(v.length > 48 ? `${v.slice(0, 46)}…` : v)
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) s = String(v)
    else s = Array.isArray(v) ? `[${v.length}]` : '{…}'
    parts.push(`${k}: ${s}`)
  }
  return parts.join(', ')
}

function resultBody(c: ToolCall): string {
  const r = c.result
  if (!r) return ''
  if (!r.ok) return r.error ?? 'Failed.'
  if (r.result === undefined || r.result === null) return 'Done.'
  return clip(typeof r.result === 'string' ? r.result : safeJson(r.result, 2), 12_000)
}

const STATUS_LABEL: Record<ToolCall['status'], string> = {
  pending: 'waiting',
  running: 'running…',
  done: 'done',
  error: 'failed',
  skipped: 'not run',
}

function StatusIcon({ status }: { status: ToolCall['status'] }) {
  switch (status) {
    case 'running':
      return <LoaderCircle size={14} className="k-spin" />
    case 'done':
      return <Check size={14} />
    case 'error':
      return <X size={14} />
    case 'skipped':
      return <CircleSlash size={13} />
    default:
      return <Clock size={13} />
  }
}

function ToolCallView({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false)
  const summary = argSummary(call.args)
  return (
    <div className={`kai-call ${call.status}${open ? ' open' : ''}`}>
      <button className="kai-call-head" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={open ? 'Hide details' : 'Show details'}>
        <ChevronRight size={13} className="kai-call-chev" />
        <span className="kai-call-icon">
          <StatusIcon status={call.status} />
        </span>
        <Wrench size={12} className="kai-call-wrench" />
        <span className="kai-call-name">{call.name}</span>
        {summary && <span className="kai-call-args">{summary}</span>}
        <span className="kai-call-status">
          {STATUS_LABEL[call.status]}
          {call.ms !== undefined && call.status !== 'skipped' ? ` · ${call.ms < 1000 ? `${call.ms} ms` : `${(call.ms / 1000).toFixed(1)} s`}` : ''}
        </span>
      </button>
      {!open && (call.status === 'error' || call.status === 'skipped') && call.result?.error && (
        <div className="kai-call-error">{clip(call.result.error, 240)}</div>
      )}
      {open && (
        <div className="kai-call-body">
          <div className="kai-call-label">Arguments</div>
          <pre>{safeJson(call.args, 2)}</pre>
          {call.result && (
            <>
              <div className="kai-call-label">{call.result.ok ? 'Result' : call.status === 'skipped' ? 'Not run' : 'Error'}</div>
              <pre className={call.result.ok ? '' : 'error'}>{resultBody(call)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------- replies

function Thinking({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false)
  const lines = text.trim().split('\n').filter(Boolean)
  return (
    <div className={`kai-thinking${open ? ' open' : ''}`}>
      <button className="kai-thinking-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Brain size={13} />
        <span>{live ? 'Thinking…' : 'Thoughts'}</span>
        <ChevronRight size={13} className="kai-call-chev" />
      </button>
      {open ? (
        <div className="kai-thinking-text">{text.trim()}</div>
      ) : live && lines.length ? (
        <div className="kai-thinking-peek">{lines[lines.length - 1]}</div>
      ) : null}
    </div>
  )
}

function TurnView({ turn, live }: { turn: Turn; live: boolean }) {
  return (
    <>
      {turn.thinking?.trim() && <Thinking text={turn.thinking} live={live && !turn.text && !turn.calls.length} />}
      {turn.text.trim() && <Markdown text={turn.text} streaming={live} />}
      {turn.calls.length > 0 && (
        <div className="kai-calls">
          {turn.calls.map((c) => (
            <ToolCallView key={c.id} call={c} />
          ))}
        </div>
      )}
    </>
  )
}

function replyText(m: AssistantMessage): string {
  return m.turns
    .map((t) => t.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

export const AssistantBlock = memo(function AssistantBlock({
  m,
  chatId,
  live,
  last,
}: {
  m: AssistantMessage
  chatId: string
  live: boolean
  last: boolean
}) {
  const [copied, setCopied] = useState(false)
  // Waiting for the model: nothing yet in this step, or its tools are done and the next step is coming.
  const lastTurn = m.turns[m.turns.length - 1]
  const waiting =
    live &&
    (!lastTurn ||
      (!lastTurn.text.trim() && !lastTurn.thinking?.trim() && lastTurn.calls.every((c) => c.status !== 'running' && c.status !== 'pending')))
  const text = replyText(m)
  const keyProblem = !!m.error && /API key/.test(m.error)
  const tokens = m.usage && (m.usage.input || m.usage.output) ? `${(m.usage.input ?? 0).toLocaleString()} in · ${(m.usage.output ?? 0).toLocaleString()} out` : ''
  const copy = async () => {
    if (await copyToClipboard(text)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    }
  }
  return (
    <div className="kai-msg kai-assistant">
      <div className="kai-avatar" aria-hidden="true">
        <Sparkles size={14} />
      </div>
      <div className="kai-reply">
        <div className="kai-reply-head">
          <span className="kai-reply-name">KherveAI</span>
          <span className="kai-reply-model">{m.model}</span>
        </div>
        {m.turns.map((t, i) => (
          <TurnView key={i} turn={t} live={live && i === m.turns.length - 1} />
        ))}
        {waiting && (
          <div className="kai-typing" aria-label="Writing">
            <i />
            <i />
            <i />
          </div>
        )}
        {m.error && (
          <div className="kai-error" role="alert">
            <AlertTriangle size={15} />
            <div className="kai-error-text">{m.error}</div>
            <div className="kai-error-actions">
              {keyProblem && (
                <button className="k-btn small" onClick={() => openDialog('settings', m.provider === 'ollama' ? 'ollama' : m.provider)}>
                  <KeyRound size={13} /> API keys
                </button>
              )}
              {last && (
                <button className="k-btn small" onClick={() => regenerate(chatId)}>
                  <RefreshCw size={13} /> Try again
                </button>
              )}
            </div>
          </div>
        )}
        {m.stopped && !live && <div className="kai-note">Stopped.</div>}
        {m.limited && !live && (
          <div className="kai-note">
            KherveAI stops after {MAX_STEPS} steps per message.
            {last && (
              <button className="k-btn small" onClick={() => continueRun(chatId)}>
                <Play size={12} /> Continue
              </button>
            )}
          </div>
        )}
        {!live && (
          <div className="kai-msg-actions">
            {text && (
              <button className="kai-act-btn" title="Copy the reply" aria-label="Copy the reply" onClick={() => void copy()}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            )}
            {last && (
              <button className="kai-act-btn" title="Write this reply again" aria-label="Regenerate" onClick={() => regenerate(chatId)}>
                <RefreshCw size={13} />
              </button>
            )}
            <span className="kai-time" title={tokens ? `Tokens: ${tokens}` : undefined}>
              {clockTime(m.time)}
              {tokens ? ` · ${tokens} tokens` : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  )
})
