// Settings (API keys, Ollama) and a chat's system prompt.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Eye, EyeOff, ExternalLink, KeyRound, LoaderCircle, RotateCcw, ScrollText, Server, ShieldCheck, X } from 'lucide-react'
import { os } from '@/os'
import { defaultSystemPrompt } from './prompt'
import { fetchOllamaModels } from './providers'
import { DEFAULT_OLLAMA_URL, PROVIDERS } from './settings'
import { refreshOllama, refreshRemoteModels, setApiKey, setChatSystem, toolsFor, updateSettings, useAi, type KeyedProvider } from './store'
import type { Chat } from './types'
import { errorText } from './util'

function Modal({ title, icon, onClose, children, wide }: { title: string; icon: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="kai-modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`kai-dialog${wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="kai-dialog-head">
          {icon}
          <span>{title}</span>
          <button className="k-icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

type CheckState = { state: 'busy' | 'ok' | 'error'; text: string }

function CheckResult({ check }: { check?: CheckState }) {
  if (!check) return null
  return (
    <div className={`kai-check ${check.state}`}>
      {check.state === 'busy' ? <LoaderCircle size={13} className="k-spin" /> : check.state === 'ok' ? <Check size={13} /> : <X size={13} />}
      <span>{check.text}</span>
    </div>
  )
}

function KeyField({
  p,
  value,
  onChange,
  check,
  onCheck,
  autoFocus,
}: {
  p: KeyedProvider
  value: string
  onChange: (v: string) => void
  check?: CheckState
  onCheck: () => void
  autoFocus: boolean
}) {
  const [show, setShow] = useState(false)
  const serverClaude = useAi((s) => s.serverClaude)
  const meta = PROVIDERS[p]
  return (
    <section className="kai-set-section">
      <div className="kai-set-title">
        <KeyRound size={15} /> {meta.label}
      </div>
      <div className="kai-set-row">
        <div className="kai-key-input">
          <input
            className="k-input"
            type={show ? 'text' : 'password'}
            value={value}
            placeholder={`API key (${meta.keyPlaceholder})`}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoFocus={autoFocus}
            aria-label={`${meta.name} API key`}
          />
          <button
            type="button"
            className="k-icon-btn"
            title={show ? 'Hide the key' : 'Show the key'}
            aria-label={show ? 'Hide the key' : 'Show the key'}
            onClick={() => setShow((s) => !s)}
          >
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        <button type="button" className="k-btn" onClick={onCheck} disabled={!value.trim() || check?.state === 'busy'}>
          Check
        </button>
      </div>
      <div className="kai-set-help">
        Get a key at{' '}
        <a href={meta.keyUrl} onClick={(e) => (e.preventDefault(), meta.keyUrl && os.openUrl(meta.keyUrl))}>
          {meta.keyUrl?.replace(/^https:\/\//, '').replace(/\/.*$/, '')} <ExternalLink size={11} />
        </a>
        . Usage is billed to your {meta.name === 'Claude' ? 'Anthropic' : 'OpenAI'} account.
        {p === 'anthropic' && serverClaude && " Or leave it empty: the KherveOS server has a Claude key and makes the calls (its key never reaches this browser)."}
      </div>
      <CheckResult check={check} />
    </section>
  )
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useAi((s) => s.settings)
  const keys = useAi((s) => s.keys)
  const focus = useAi((s) => s.settingsFocus)
  const [url, setUrl] = useState(settings.ollamaUrl)
  const [numCtx, setNumCtx] = useState(settings.numCtx)
  const [anthropic, setAnthropic] = useState(keys.anthropic)
  const [openai, setOpenai] = useState(keys.openai)
  const [checks, setChecks] = useState<Record<string, CheckState>>({})
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focus === 'ollama') first.current?.focus()
  }, [focus])

  const setCheck = (k: string, c: CheckState) => setChecks((all) => ({ ...all, [k]: c }))
  const cleanUrl = () => (url.trim() || DEFAULT_OLLAMA_URL).replace(/\/+$/, '')

  const checkOllama = async () => {
    setCheck('ollama', { state: 'busy', text: 'Checking…' })
    try {
      const models = await fetchOllamaModels(cleanUrl())
      setCheck('ollama', {
        state: 'ok',
        text: models.length ? `Ollama is running — ${models.length} model${models.length === 1 ? '' : 's'} installed.` : 'Ollama is running, but no models are installed yet (ollama pull qwen3.5:4b).',
      })
    } catch {
      setCheck('ollama', { state: 'error', text: `Not reachable at ${cleanUrl()}. Start it with "ollama serve" (or open the Ollama app).` })
    }
  }

  const checkKey = async (p: KeyedProvider) => {
    const key = p === 'anthropic' ? anthropic : openai
    setCheck(p, { state: 'busy', text: 'Checking the key…' })
    try {
      const models = await refreshRemoteModels(p, key)
      setCheck(p, { state: 'ok', text: `The key works — ${models.length} model${models.length === 1 ? '' : 's'} available.` })
    } catch (e) {
      setCheck(p, { state: 'error', text: errorText(e) })
    }
  }

  const save = () => {
    const newUrl = cleanUrl()
    const urlChanged = newUrl !== settings.ollamaUrl
    updateSettings({ ollamaUrl: newUrl, numCtx })
    setApiKey('anthropic', anthropic)
    setApiKey('openai', openai)
    if (urlChanged || numCtx !== settings.numCtx) void refreshOllama()
    onClose()
  }

  return (
    <Modal title="API Keys & Ollama" icon={<KeyRound size={16} />} onClose={onClose}>
      <form
        className="kai-dialog-form"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <div className="kai-dialog-body">
          <div className="kai-privacy">
            <ShieldCheck size={16} />
            <span>
              API keys are stored only in this browser (localStorage) and are sent only to the provider they belong to — never to KherveOS or anyone
              else. Ollama runs on this computer: with it, nothing leaves your machine.
            </span>
          </div>

          <section className="kai-set-section">
            <div className="kai-set-title">
              <Server size={15} /> {PROVIDERS.ollama.label}
            </div>
            <div className="kai-set-row">
              <input
                ref={first}
                className="k-input"
                value={url}
                placeholder={DEFAULT_OLLAMA_URL}
                onChange={(e) => setUrl(e.target.value)}
                spellCheck={false}
                aria-label="Ollama address"
              />
              <button type="button" className="k-btn" onClick={() => void checkOllama()} disabled={checks.ollama?.state === 'busy'}>
                Check
              </button>
            </div>
            <label className="kai-set-row kai-set-inline">
              <span>Context window</span>
              <select className="k-input" value={numCtx} onChange={(e) => setNumCtx(Number(e.target.value))}>
                {[4096, 8192, 16384, 32768, 65536, 131072].map((n) => (
                  <option key={n} value={n}>
                    {n.toLocaleString()} tokens{n === 16384 ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="kai-set-help">
              Not running? Start it in a terminal with <code>ollama serve</code> (or open the Ollama app). Get models with <code>ollama pull qwen3.5:4b</code>.
              A bigger context window remembers more of the chat but needs more memory.
            </div>
            <CheckResult check={checks.ollama} />
          </section>

          <KeyField
            p="anthropic"
            value={anthropic}
            onChange={setAnthropic}
            check={checks.anthropic}
            onCheck={() => void checkKey('anthropic')}
            autoFocus={focus === 'anthropic'}
          />
          <KeyField p="openai" value={openai} onChange={setOpenai} check={checks.openai} onCheck={() => void checkKey('openai')} autoFocus={focus === 'openai'} />
        </div>
        <div className="kai-dialog-foot">
          <button type="button" className="k-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="k-btn primary">
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function SystemPromptDialog({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const def = defaultSystemPrompt(toolsFor(chat.provider, chat.model))
  const [text, setText] = useState(chat.system ?? def)
  const ref = useRef<HTMLTextAreaElement>(null)
  const isDefault = text.trim() === def.trim()

  useEffect(() => {
    ref.current?.focus()
    ref.current?.setSelectionRange(0, 0)
  }, [])

  const save = () => {
    setChatSystem(chat.id, !text.trim() || isDefault ? null : text)
    onClose()
  }

  return (
    <Modal title="System prompt" icon={<ScrollText size={16} />} onClose={onClose} wide>
      <div className="kai-dialog-body">
        <div className="kai-set-help">
          What the model is told before the conversation, for “{chat.title}” only.{' '}
          {chat.system === null && isDefault
            ? 'This is the default: it describes KherveOS and the tools the model may use, and is rebuilt for every message.'
            : 'This chat has its own prompt.'}
        </div>
        <textarea
          ref={ref}
          className="k-input kai-system-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          aria-label="System prompt"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              save()
            }
          }}
        />
      </div>
      <div className="kai-dialog-foot">
        <button className="k-btn" onClick={() => setText(def)} disabled={isDefault} title="Use the default prompt">
          <RotateCcw size={13} /> Default
        </button>
        <span className="kai-spacer" />
        <button className="k-btn" onClick={onClose}>
          Cancel
        </button>
        <button className="k-btn primary" onClick={save}>
          Save
        </button>
      </div>
    </Modal>
  )
}
