// The right pane: provider and model in the toolbar, hints when something is
// missing (Ollama not running, no API key), the conversation, the composer.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, KeyRound, LoaderCircle, PanelLeft, RefreshCw, ScrollText, Settings2, Sparkles, Wand2 } from 'lucide-react'
import { os } from '@/os'
import { sendMessage } from './agent'
import { Composer } from './Composer'
import { AssistantBlock, UserBubble } from './MessageView'
import { CodeContext } from './Markdown'
import { PROVIDER_IDS, PROVIDERS } from './settings'
import {
  hasAccess,
  modelChoices,
  modelSupportsTools,
  openDialog,
  promptCustomModel,
  refreshOllama,
  refreshRemoteModels,
  setChatModel,
  updateSettings,
  useAi,
} from './store'
import { availableTools } from './toolbridge'
import type { Chat, ProviderId } from './types'
import { errorText } from './util'

// ------------------------------------------------------------------ toolbar

const OTHER = '::kai-other'
const REFRESH = '::kai-refresh'

function ModelSelect({ chat, disabled }: { chat: Chat; disabled: boolean }) {
  const ollama = useAi((s) => s.ollama)
  const remote = useAi((s) => s.remote)
  const custom = useAi((s) => s.settings.custom)
  const key = useAi((s) => (chat.provider === 'ollama' ? '' : s.keys[chat.provider]))
  const choices = useMemo(() => modelChoices(chat.provider, { ollama, remote, settings: { custom } }), [chat.provider, ollama, remote, custom])
  const p = chat.provider
  const known = choices.includes(chat.model)

  const onChange = async (value: string) => {
    if (value === OTHER) return void promptCustomModel(chat.id, p)
    if (value === REFRESH) {
      if (p === 'ollama') return void refreshOllama()
      try {
        await refreshRemoteModels(p)
      } catch (e) {
        os.notify({ title: `Could not list the ${PROVIDERS[p].name} models`, body: errorText(e) })
      }
      return
    }
    setChatModel(chat.id, p, value)
  }

  return (
    <select
      className="k-input kai-select kai-model"
      value={chat.model}
      disabled={disabled}
      onChange={(e) => void onChange(e.target.value)}
      title={`Model: ${chat.model || 'none'}`}
      aria-label="Model"
    >
      {!chat.model && <option value="">{p === 'ollama' && ollama.status === 'down' ? 'Ollama not running' : 'No model'}</option>}
      {chat.model && !known && (
        <option value={chat.model}>
          {chat.model}
          {p === 'ollama' && ollama.status === 'ok' ? ' (not installed)' : ''}
        </option>
      )}
      {p === 'ollama'
        ? ollama.models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
              {m.params ? ` · ${m.params}` : ''}
              {m.caps && !m.caps.includes('tools') ? ' · no tools' : ''}
            </option>
          ))
        : choices.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
      <option disabled>──────────</option>
      {p !== 'ollama' && <option value={OTHER}>Other model…</option>}
      {(p === 'ollama' || key) && <option value={REFRESH}>{p === 'ollama' ? 'Refresh the list' : 'Load the models of my key'}</option>}
    </select>
  )
}

function StatusDot({ chat }: { chat: Chat }) {
  const status = useAi((s) => s.ollama.status)
  const hasKey = useAi((s) => hasAccess(chat.provider, s))
  const viaServer = useAi((s) => chat.provider === 'anthropic' && !s.keys.anthropic && s.serverClaude)
  if (chat.provider === 'ollama') {
    if (status === 'checking' || status === 'unknown') return <LoaderCircle size={13} className="k-spin kai-dot-spin" aria-label="Checking Ollama" />
    return (
      <span
        className={`kai-dot ${status === 'ok' ? 'ok' : 'bad'}`}
        title={status === 'ok' ? 'Ollama is running on this computer' : 'Ollama is not running'}
        role="img"
        aria-label={status === 'ok' ? 'Ollama is running' : 'Ollama is not running'}
      />
    )
  }
  return (
    <span
      className={`kai-dot ${hasKey ? 'ok' : 'warn'}`}
      title={viaServer ? "Claude through the KherveOS server (its key stays on the server)" : hasKey ? 'API key set' : 'No API key yet'}
      role="img"
      aria-label={hasKey ? 'API key set' : 'No API key'}
    />
  )
}

function ActToggle({ chat, compact }: { chat: Chat; compact: boolean }) {
  const act = useAi((s) => s.settings.act)
  const supports = useAi((s) => modelSupportsTools(chat.provider, chat.model, s))
  const toolCount = availableTools().length
  const usable = supports && toolCount > 0
  const on = act && usable
  const title = !toolCount
    ? 'The KherveOS tools are not available yet'
    : !supports
      ? `${chat.model || 'This model'} can't use tools, so it can only chat`
      : on
        ? `The AI may act in KherveOS (${toolCount} tools; it asks before changing or deleting things). Click to switch off.`
        : 'Let the AI act in KherveOS: open apps, read and write files…'
  return (
    <button
      className={`kai-act${on ? ' on' : ''}`}
      onClick={() => updateSettings({ act: !act })}
      disabled={!usable}
      aria-pressed={on}
      title={title}
    >
      <Wand2 size={14} />
      {!compact && <span className="kai-act-label">Act in KherveOS</span>}
      <span className="kai-switch" aria-hidden="true">
        <i />
      </span>
    </button>
  )
}

function Toolbar({ chat, compact, onToggleSidebar }: { chat: Chat; compact: boolean; onToggleSidebar: () => void }) {
  const running = useAi((s) => !!s.running[chat.id])
  return (
    <div className="k-toolbar kai-toolbar">
      <button className="k-icon-btn" onClick={onToggleSidebar} title="Show or hide the chats" aria-label="Chats">
        <PanelLeft size={17} />
      </button>
      <select
        className="k-input kai-select kai-provider"
        value={chat.provider}
        disabled={running}
        onChange={(e) => setChatModel(chat.id, e.target.value as ProviderId)}
        aria-label="Provider"
        title="Who answers: Ollama on this computer, Claude or ChatGPT"
      >
        {PROVIDER_IDS.map((p) => (
          <option key={p} value={p}>
            {PROVIDERS[p].name}
          </option>
        ))}
      </select>
      <ModelSelect chat={chat} disabled={running} />
      <StatusDot chat={chat} />
      <div className="k-spacer" />
      <ActToggle chat={chat} compact={compact} />
      <button className="k-icon-btn" onClick={() => openDialog('system')} title="System prompt for this chat" aria-label="System prompt">
        <ScrollText size={16} />
      </button>
      <button
        className="k-icon-btn"
        onClick={() => openDialog('settings', chat.provider === 'ollama' ? 'ollama' : chat.provider)}
        title="API keys & Ollama"
        aria-label="Settings"
      >
        <Settings2 size={16} />
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ banners

function Banner({ chat }: { chat: Chat }) {
  const ollama = useAi((s) => s.ollama)
  const url = useAi((s) => s.settings.ollamaUrl)
  const hasKey = useAi((s) => hasAccess(chat.provider, s))
  if (chat.provider === 'ollama') {
    if (ollama.status === 'down') {
      const remotePage = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)
      return (
        <div className="kai-banner bad" role="status">
          <div className="kai-banner-text">
            <strong>Ollama isn't running</strong> (nothing answered at {url}). Start it in a terminal with <code>ollama serve</code>, or open
            the Ollama app.
            {remotePage && (
              <>
                {' '}
                KherveOS isn't on this computer's localhost, so also start Ollama with <code>OLLAMA_ORIGINS={window.location.origin}</code>.
              </>
            )}
          </div>
          <div className="kai-banner-actions">
            <button className="k-btn small" onClick={() => void refreshOllama()}>
              <RefreshCw size={13} /> Check again
            </button>
            <button className="k-btn small" onClick={() => openDialog('settings', 'ollama')}>
              Settings
            </button>
          </div>
        </div>
      )
    }
    if (ollama.status === 'ok' && !ollama.models.length) {
      return (
        <div className="kai-banner warn" role="status">
          <div className="kai-banner-text">
            <strong>No models installed in Ollama.</strong> Install one in a terminal, e.g. <code>ollama pull qwen3.5:4b</code>, then check again.
          </div>
          <div className="kai-banner-actions">
            <button className="k-btn small" onClick={() => void refreshOllama()}>
              <RefreshCw size={13} /> Check again
            </button>
          </div>
        </div>
      )
    }
    return null
  }
  if (!hasKey) {
    const meta = PROVIDERS[chat.provider]
    return (
      <div className="kai-banner warn" role="status">
        <div className="kai-banner-text">
          <strong>{meta.name} needs an API key.</strong> It is stored only in this browser and sent only to {meta.host}.
          {chat.provider === 'anthropic' && ' Or start the KherveOS server with ANTHROPIC_API_KEY set and sign in: its key stays on the server.'}
        </div>
        <div className="kai-banner-actions">
          <button className="k-btn small primary" onClick={() => openDialog('settings', chat.provider === 'ollama' ? 'ollama' : chat.provider)}>
            <KeyRound size={13} /> Add key…
          </button>
        </div>
      </div>
    )
  }
  return null
}

// ------------------------------------------------------------------ welcome

const SUGGEST_ACT = [
  'What is in my Documents folder?',
  'Write a short to-do list for today and save it as ~/Documents/todo.md',
  'Open the Terminal and the Notepad',
]
const SUGGEST_CHAT = [
  'Write a Python script that plots a damped sine wave',
  'Explain how a Fourier transform works, with a small example',
  'Help me write a polite email asking for a deadline extension',
]

function Welcome({ chat }: { chat: Chat }) {
  const tools = useAi((s) => (s.settings.act && modelSupportsTools(chat.provider, chat.model, s) ? availableTools().length : 0))
  const viaServer = useAi((s) => chat.provider === 'anthropic' && !s.keys.anthropic && s.serverClaude)
  const where =
    chat.provider === 'ollama'
      ? `${chat.model || 'a local model'} runs on this computer with Ollama: nothing leaves your machine.`
      : viaServer
        ? `${chat.model} answers through the KherveOS server, with its Claude key (the key stays on the server).`
        : `${chat.model} answers through ${PROVIDERS[chat.provider].host}, with your own API key.`
  const ideas = tools ? [...SUGGEST_ACT, SUGGEST_CHAT[0]] : SUGGEST_CHAT
  return (
    <div className="kai-welcome">
      <span className="kai-welcome-icon">
        <Sparkles size={30} />
      </span>
      <h2>How can I help?</h2>
      <p>{where}</p>
      <p className="kai-welcome-note">
        {tools
          ? `It can act in KherveOS with ${tools} tools — open apps, read and write your files — and asks before changing or deleting anything.`
          : 'It can chat, write and explain. Switch on “Act in KherveOS” to let it work with your files and apps.'}
      </p>
      <div className="kai-suggestions">
        {ideas.map((s) => (
          <button key={s} className="kai-suggestion" onClick={() => sendMessage(chat.id, s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------- the thread

function Thread({ chat }: { chat: Chat }) {
  const running = useAi((s) => !!s.running[chat.id])
  const scrollRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const count = chat.messages.length
  const lastUser = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i--) if (chat.messages[i].role === 'user') return i
    return -1
  }, [chat.messages])

  // Opening the chat, or a new message from you: go to the end and follow the reply.
  const prevCount = useRef(-1)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (prevCount.current < 0 || (count > prevCount.current && chat.messages[count - 1]?.role === 'user')) {
      stick.current = true
      setShowJump(false)
      el.scrollTop = el.scrollHeight
    }
    prevCount.current = count
  }, [count, chat.messages])

  // Keep to the bottom as the reply grows (unless you scrolled up to read).
  useEffect(() => {
    const el = scrollRef.current
    const inner = innerRef.current
    if (!el || !inner) return
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight
      else setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > 200)
    })
    ro.observe(inner)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    stick.current = gap < 48
    if (stick.current) setShowJump(false)
  }

  return (
    <div className="kai-body">
      <div className="kai-scroll" ref={scrollRef} onScroll={onScroll} role="log" aria-live="off">
        <div className="kai-thread" ref={innerRef}>
          {count === 0 ? (
            <Welcome chat={chat} />
          ) : (
            chat.messages.map((m, i) =>
              m.role === 'user' ? (
                <UserBubble key={m.id} m={m} chatId={chat.id} canEdit={i === lastUser && !running} />
              ) : (
                <AssistantBlock key={m.id} m={m} chatId={chat.id} live={running && i === count - 1} last={i === count - 1} />
              ),
            )
          )}
        </div>
      </div>
      {showJump && (
        <button
          className="kai-jump"
          onClick={() => {
            const el = scrollRef.current
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
            stick.current = true
            setShowJump(false)
          }}
        >
          <ArrowDown size={14} /> Latest
        </button>
      )}
    </div>
  )
}

// ------------------------------------------------------------------- pane

export function ChatView({ chat, compact, onToggleSidebar }: { chat: Chat; compact: boolean; onToggleSidebar: () => void }) {
  const acts = useAi((s) => s.settings.act && modelSupportsTools(chat.provider, chat.model, s)) && availableTools().length > 0
  const placeholder = `Message ${chat.model || PROVIDERS[chat.provider].name}${acts ? ' — it can act in KherveOS' : ''}…`
  const codeContext = useMemo(() => ({ title: chat.title }), [chat.title])
  return (
    <main className="kai-main">
      <Toolbar chat={chat} compact={compact} onToggleSidebar={onToggleSidebar} />
      <Banner chat={chat} />
      <CodeContext.Provider value={codeContext}>
        <Thread key={chat.id} chat={chat} />
      </CodeContext.Provider>
      <Composer key={chat.id} chat={chat} placeholder={placeholder} />
    </main>
  )
}
