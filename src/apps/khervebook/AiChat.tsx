// The AI Assistant panel (desktop ai_chat.py): chat with Claude, ChatGPT,
// Mistral, Ollama or a local model about the notebook. The assistant sees
// every cell; its fenced blocks become cells with one click (one undo step),
// and are run. Pasted screenshots are attached to the next message.

import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import { CirclePlay, HelpCircle, ImagePlus, LoaderCircle, RefreshCw, SendHorizontal, Settings, Square, Trash2, X } from 'lucide-react'
import { os } from '@/os'
import type { Notebook } from './notebook'
import { renderMarkdown } from './render'
import {
  EXAMPLE_PROMPTS, GREETING, PROVIDERS, PROVIDER_IDS, chat, configFor, extractCells, fetchModels, imageForChat, inputHistory,
  loadAiSettings, saveAiSettings, saveInputHistory, systemPrompt, trimHistory,
  type AiSettings, type ChatImage, type ChatMessage, type ProposedCell, type ProviderConfig, type ProviderId,
} from './ai'

interface ChatState {
  history: ChatMessage[]
  /** The last reply's cells, waiting for Apply & run. */
  pending: ProposedCell[]
  images: ChatImage[]
  draft: string
  status: string
  busy: boolean
}

/** One window's conversation (kept while the panel is hidden). */
export type ChatSession = StoreApi<ChatState>

export function createChatSession(): ChatSession {
  return createStore<ChatState>(() => ({ history: [], pending: [], images: [], draft: '', status: '', busy: false }))
}

function Bubble({ role, text, images }: { role: 'user' | 'assistant'; text: string; images?: ChatImage[] }) {
  const html = useMemo(() => renderMarkdown(text || (images?.length ? '' : ' ')), [text, images])
  const open = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute('href') ?? ''
    if (/^(https?:\/\/|mailto:)/i.test(href)) os.openUrl(href, { background: e.metaKey || e.ctrlKey })
  }
  return (
    <div className={`nb-ai-bubble ${role}`}>
      <div className="nb-ai-who">{role === 'user' ? 'You' : 'AI'}</div>
      {!!images?.length && (
        <div className="nb-ai-thumbs">
          {images.map((im, i) => (
            <img key={i} src={`data:${im.mediaType};base64,${im.data}`} alt="Attached" />
          ))}
        </div>
      )}
      {text && <div className="nb-md nb-ai-text" onClick={open} dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  )
}

function SettingsForm({ settings, onDone }: { settings: AiSettings; onDone: (s: AiSettings | null) => void }) {
  const [provider, setProvider] = useState<ProviderId>(settings.provider)
  const [configs, setConfigs] = useState(settings.configs)
  const [models, setModels] = useState<string[] | null>(null)
  const [error, setError] = useState('')
  const meta = PROVIDERS[provider]
  const cfg = configFor({ ...settings, configs }, provider)
  const set = (p: Partial<ProviderConfig>) => setConfigs((c) => ({ ...c, [provider]: { ...cfg, ...c[provider], ...p } }))
  const list = models ?? meta.models
  return (
    <form
      className="nb-ai-settings"
      onSubmit={(e) => {
        e.preventDefault()
        onDone({ ...settings, provider, configs })
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="nb-ai-settings-title">AI Chat Settings</div>
      <label>
        <span>Provider</span>
        <select
          className="k-input"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value as ProviderId)
            setModels(null)
            setError('')
          }}
        >
          {PROVIDER_IDS.map((id) => (
            <option key={id} value={id}>
              {PROVIDERS[id].label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Model</span>
        <div className="nb-ai-row">
          <input className="k-input" list="nb-ai-models" value={cfg.model} onChange={(e) => set({ model: e.target.value })} spellCheck={false} />
          <datalist id="nb-ai-models">
            {list.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <button
            type="button"
            className="k-icon-btn"
            title="Refresh the model list from the server"
            onClick={() => {
              setError('')
              fetchModels(provider, cfg).then(setModels, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
            }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </label>
      {meta.needsKey && (
        <label>
          <span>API Key</span>
          <input
            className="k-input"
            type="password"
            autoComplete="off"
            value={cfg.key}
            placeholder={provider === 'anthropic' ? 'sk-ant-…' : provider === 'openai' ? 'sk-…' : ''}
            onChange={(e) => set({ key: e.target.value.trim() })}
          />
        </label>
      )}
      {meta.needsHost && (
        <label>
          <span>{provider === 'local' ? 'Server URL' : 'Ollama Host'}</span>
          <input className="k-input" value={cfg.host} placeholder={meta.host} onChange={(e) => set({ host: e.target.value.trim() })} spellCheck={false} />
        </label>
      )}
      {error && <div className="k-error">{error}</div>}
      <div className="nb-ai-help">
        <div className="nb-ai-help-title">{meta.needsKey ? 'How to get an API key' : 'How to set up'}</div>
        <pre>{meta.help}</pre>
        {meta.needsKey && <p>The key is kept in this browser only and is sent only to {meta.label}.</p>}
      </div>
      <div className="nb-ai-settings-buttons">
        <button type="button" className="k-btn small" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button type="submit" className="k-btn small primary">
          OK
        </button>
      </div>
    </form>
  )
}

export function AiChat({ nb, session }: { nb: Notebook; session: ChatSession }) {
  const s = useStore(session)
  const [settings, setSettingsState] = useState(loadAiSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [showPrompts, setShowPrompts] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const hist = useRef<{ list: string[]; index: number | null; draft: string }>({ list: inputHistory(), index: null, draft: '' })
  const set = (p: Partial<ChatState>) => session.setState(p)

  const meta = PROVIDERS[settings.provider]
  const cfg = configFor(settings)
  const setSettings = (next: AiSettings) => {
    setSettingsState(next)
    saveAiSettings(next)
  }

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [s.history.length, s.busy, s.status])

  useEffect(() => () => abort.current?.abort(), [])

  const apply = (cells: ProposedCell[]) => {
    const { added, replaced } = nb.applyCells(cells)
    const parts = [added ? `added ${added}` : '', replaced ? `replaced ${replaced}` : ''].filter(Boolean)
    set({ pending: [], status: `AI edit: ${parts.join(', ') || 'nothing'} — applied and ran. Undo takes the edit back.` })
  }

  const send = async () => {
    const text = s.draft.trim()
    const images = s.images
    if ((!text && !images.length) || s.busy) return
    if (meta.needsKey && !cfg.key) {
      setShowSettings(true)
      set({ status: `Enter your ${meta.label} API key first.` })
      return
    }
    if (text) {
      const h = hist.current
      if (h.list[h.list.length - 1] !== text) h.list = [...h.list, text].slice(-100)
      saveInputHistory(h.list)
      h.index = null
      h.draft = ''
    }
    const msg: ChatMessage = { role: 'user', content: text, ...(images.length ? { images } : {}) }
    const history = trimHistory([...s.history, msg])
    set({ history, draft: '', images: [], busy: true, pending: [], status: `Thinking… (${cfg.model})` })
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      const reply = await chat(settings.provider, cfg, systemPrompt(nb.state.cells), history, ctrl.signal)
      if (ctrl.signal.aborted) return
      const pending = extractCells(reply)
      set({ history: [...session.getState().history, { role: 'assistant', content: reply || '(no answer)' }], busy: false, status: '', pending })
      if (pending.length && settings.auto) apply(pending)
    } catch (e) {
      if (ctrl.signal.aborted) set({ busy: false, status: 'Stopped.' })
      else set({ busy: false, status: `⚠ ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      if (abort.current === ctrl) abort.current = null
    }
  }

  const stop = () => {
    abort.current?.abort()
    abort.current = null
    set({ busy: false, status: 'Stopped.' })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation() // the notebook's shortcuts stay out of the chat box
    const el = e.currentTarget
    const h = hist.current
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    } else if (e.key === 'ArrowUp' && !el.value.slice(0, el.selectionStart).includes('\n') && h.list.length) {
      e.preventDefault()
      if (h.index === null) {
        h.draft = s.draft
        h.index = h.list.length
      }
      if (h.index > 0) h.index--
      set({ draft: h.list[h.index] })
    } else if (e.key === 'ArrowDown' && h.index !== null && !el.value.slice(el.selectionEnd).includes('\n')) {
      e.preventDefault()
      h.index++
      if (h.index >= h.list.length) {
        h.index = null
        set({ draft: h.draft })
      } else set({ draft: h.list[h.index] })
    } else if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault()
      void nb.save()
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.items].filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    for (const it of files) {
      const blob = it.getAsFile()
      if (!blob) continue
      imageForChat(blob).then(
        (im) => set({ images: [...session.getState().images, im] }),
        () => set({ status: '⚠ That image could not be read.' }),
      )
    }
  }

  const attach = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const f = input.files?.[0]
      if (f) imageForChat(f).then((im) => set({ images: [...session.getState().images, im] }), () => set({ status: '⚠ That image could not be read.' }))
    }
    input.click()
  }

  const fontSize = settings.fontSize
  const pending = s.pending
  const edits = pending.filter((p) => p.target !== null && p.target >= 0 && p.target < nb.state.cells.length).length
  const adds = pending.length - edits

  return (
    <div className="nb-ai" style={{ fontSize }}>
      <div className="nb-ai-head">
        <span className="nb-ai-title" title={`${meta.label} · ${cfg.model}`}>
          <b>AI Assistant</b> <span className="nb-ai-model">{meta.label} · {cfg.model || '(no model)'}</span>
        </span>
        <button className="nb-ai-tool" title="Decrease text size" onClick={() => setSettings({ ...settings, fontSize: Math.max(10, fontSize - 1) })}>
          A−
        </button>
        <button className="nb-ai-tool" title="Increase text size" onClick={() => setSettings({ ...settings, fontSize: Math.min(22, fontSize + 1) })}>
          A+
        </button>
        <button
          className={`nb-ai-tool${settings.auto ? ' on' : ''}`}
          aria-pressed={settings.auto}
          title="Auto: apply and run the assistant's cells as soon as it replies, instead of waiting for the Apply button"
          onClick={() => setSettings({ ...settings, auto: !settings.auto })}
        >
          Auto
        </button>
        <button className="nb-ai-tool" title="Example prompts" onClick={() => setShowPrompts((v) => !v)}>
          <HelpCircle size={15} />
        </button>
        <button className="nb-ai-tool" title="AI Chat settings" onClick={() => setShowSettings(true)}>
          <Settings size={15} />
        </button>
        <button
          className="nb-ai-tool"
          title="Clear conversation"
          onClick={() => {
            stop()
            set({ history: [], pending: [], status: '' })
          }}
        >
          <Trash2 size={15} />
        </button>
      </div>

      {showSettings ? (
        <SettingsForm
          settings={settings}
          onDone={(next) => {
            if (next) setSettings(next)
            setShowSettings(false)
            set({ status: '' })
          }}
        />
      ) : (
        <>
          {showPrompts && (
            <div className="nb-ai-prompts">
              <div className="nb-ai-prompts-title">Try one of these — click to use it:</div>
              {EXAMPLE_PROMPTS.map((p) => (
                <button
                  key={p}
                  className="nb-ai-prompt"
                  onClick={() => {
                    set({ draft: p })
                    setShowPrompts(false)
                    inputRef.current?.focus()
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
          <div className="nb-ai-log" ref={logRef}>
            <Bubble role="assistant" text={GREETING} />
            {s.history.map((m, i) => (
              <Bubble key={i} role={m.role} text={m.content} images={m.images} />
            ))}
            {s.busy && (
              <div className="nb-ai-thinking">
                <LoaderCircle size={14} className="k-spin" /> {s.status}
              </div>
            )}
          </div>
          {pending.length > 0 && (
            <button className="k-btn small nb-ai-apply" onClick={() => apply(pending)}>
              <CirclePlay size={14} /> Apply &amp; run ({[adds ? `add ${adds}` : '', edits ? `replace ${edits}` : ''].filter(Boolean).join(', ')})
            </button>
          )}
          {!s.busy && s.status && <div className={`nb-ai-status${s.status.startsWith('⚠') ? ' error' : ''}`}>{s.status}</div>}
          {s.images.length > 0 && (
            <div className="nb-ai-attachments">
              {s.images.map((im, i) => (
                <span key={i} className="nb-ai-chip">
                  <img src={`data:${im.mediaType};base64,${im.data}`} alt="Attached" />
                  <button title="Remove image" onClick={() => set({ images: s.images.filter((_x, k) => k !== i) })}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="nb-ai-input-row">
            <textarea
              ref={inputRef}
              className="nb-ai-input"
              value={s.draft}
              placeholder={`Ask ${meta.ask}…  (paste a screenshot with Ctrl+V to attach it)`}
              onChange={(e) => set({ draft: e.target.value })}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
            />
            <div className="nb-ai-input-btns">
              <button className="nb-ai-tool" title="Attach an image" onClick={attach}>
                <ImagePlus size={16} />
              </button>
              {s.busy ? (
                <button className="nb-ai-send stop" title="Stop waiting for the answer" onClick={stop}>
                  <Square size={16} />
                </button>
              ) : (
                <button className="nb-ai-send" title="Send (Enter)" disabled={!s.draft.trim() && !s.images.length} onClick={() => void send()}>
                  <SendHorizontal size={18} />
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
