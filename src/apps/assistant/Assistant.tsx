// Assistant: an AI chat. Claude when the server has an Anthropic API key,
// a local Ollama model otherwise. Chats are saved as ~/Assistant/*.kchat (JSON).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import { Bot, Plus, Send, Square, Trash2 } from 'lucide-react'
import { os, fs, path, HOME, useDir, type AppProps } from '@/os'
import { aiChat, aiStatus, type AiMessage, type AiProvider, type AiStatus } from '@/os/ai'
import './assistant.css'

const DIR = path.join(HOME, 'Assistant')
const EXT = '.kchat'

interface Chat {
  format: 'kchat'
  version: 1
  title: string
  messages: (AiMessage & { by?: string })[]
}

const marked = new Marked({ gfm: true, breaks: true })
const toHtml = (md: string) => DOMPurify.sanitize(marked.parse(md, { async: false }) as string)

function titleFrom(text: string) {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 48 ? `${t.slice(0, 47)}…` : t || 'New chat'
}

export default function Assistant({ win, args }: AppProps) {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [provider, setProvider] = useState<AiProvider>('auto')
  const [model, setModel] = useState('')
  const [chatPath, setChatPath] = useState<string | null>(args.path ?? null)
  const [chat, setChat] = useState<Chat>({ format: 'kchat', version: 1, title: 'New chat', messages: [] })
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const entries = useDir(DIR)
  const chats = useMemo(
    () => (entries ?? []).filter((s) => s.type === 'file' && s.name.endsWith(EXT)).sort((a, b) => b.mtime - a.mtime),
    [entries],
  )

  useEffect(() => {
    aiStatus()
      .then((s) => {
        setStatus(s)
        setModel((m) => m || s.ollama_models[0] || '')
      })
      .catch((e) =>
        setStatusError(
          e?.status === 404 ? 'This server is older than the Assistant: restart it (npm run server).' : e instanceof Error ? e.message : String(e),
        ),
      )
  }, [])

  const openChat = useCallback(async (p: string) => {
    try {
      const data = JSON.parse(await fs.readText(p)) as Chat
      if (data.format !== 'kchat' || !Array.isArray(data.messages)) throw new Error('not an Assistant chat')
      abort.current?.abort()
      setChat(data)
      setChatPath(p)
      setError(null)
    } catch (e) {
      await os.dialog.alert(`Could not open ${path.basename(p)}: ${e instanceof Error ? e.message : e}`)
    }
  }, [])

  useEffect(() => {
    if (args.path) void openChat(args.path)
  }, [args.path, openChat])

  const newChat = useCallback(() => {
    abort.current?.abort()
    setChat({ format: 'kchat', version: 1, title: 'New chat', messages: [] })
    setChatPath(null)
    setError(null)
  }, [])

  const deleteChat = useCallback(
    async (p: string) => {
      if (!(await os.dialog.confirm(`Delete “${path.basename(p).slice(0, -EXT.length)}”?`))) return
      await fs.remove(p)
      if (p === chatPath) newChat()
    },
    [chatPath, newChat],
  )

  useEffect(() => {
    win.setTitle(`${chat.title} — Assistant`)
    win.setDocumentPath(chatPath)
  }, [win, chat.title, chatPath])

  useEffect(() => {
    win.setMenus([
      {
        label: 'File',
        items: [
          { label: 'New Chat', icon: Plus, shortcut: '⌘N', onClick: newChat },
          { label: 'Delete Chat', icon: Trash2, disabled: !chatPath, onClick: () => chatPath && void deleteChat(chatPath) },
          '-',
          { label: 'Close', onClick: () => win.close() },
        ],
      },
    ])
    return () => win.setMenus(null)
  }, [win, newChat, deleteChat, chatPath])

  useEffect(() => () => abort.current?.abort(), [])

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.messages])

  const send = async () => {
    const text = draft.trim()
    if (!text || busy) return
    const history: AiMessage[] = [...chat.messages.map(({ role, content }) => ({ role, content })), { role: 'user', content: text }]
    const title = chat.messages.length ? chat.title : titleFrom(text)
    let current: Chat = { ...chat, title, messages: [...history, { role: 'assistant', content: '' }] }
    setChat(current)
    setDraft('')
    setError(null)
    setBusy(true)
    const ctrl = new AbortController()
    abort.current = ctrl
    const update = (fn: (m: Chat['messages'][number]) => Chat['messages'][number]) => {
      const msgs = current.messages.slice()
      msgs[msgs.length - 1] = fn(msgs[msgs.length - 1])
      current = { ...current, messages: msgs }
      setChat(current)
    }
    try {
      await aiChat(history, { provider, model: model || undefined, signal: ctrl.signal }, (e) => {
        if ('provider' in e) update((m) => ({ ...m, by: e.provider === 'claude' ? `Claude · ${e.model}` : `Ollama · ${e.model}` }))
        else if ('text' in e) update((m) => ({ ...m, content: m.content + e.text }))
        else if ('error' in e) setError(e.error)
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      abort.current = null
    }
    // Drop an empty answer (error or stopped before anything arrived), then save.
    const last = current.messages[current.messages.length - 1]
    if (!last.content) current = { ...current, messages: current.messages.slice(0, -1) }
    setChat(current)
    if (current.messages.length) {
      try {
        const p = chatPath ?? path.join(DIR, fs.uniqueName(DIR, `${title.replace(/[\\/:*?"<>|]/g, ' ').slice(0, 40).trim() || 'Chat'}${EXT}`))
        if (!chatPath && !fs.exists(DIR)) await fs.mkdir(DIR, { recursive: true })
        await fs.writeText(p, JSON.stringify(current, null, 1), { mkdirs: true })
        setChatPath(p)
      } catch (e) {
        setError(`Could not save the chat: ${e instanceof Error ? e.message : e}`)
      }
    }
  }

  const nothing = status && !status.claude && !status.ollama

  return (
    <div className="k-app ai-app">
      <aside className="ai-side">
        <button className="k-btn ai-new" onClick={newChat}>
          <Plus size={15} /> New chat
        </button>
        <div className="ai-list">
          {chats.map((s) => (
            <div
              key={s.path}
              className={`ai-item${s.path === chatPath ? ' active' : ''}`}
              onClick={() => void openChat(s.path)}
              onContextMenu={(e) => {
                e.preventDefault()
                os.contextMenu(e, [{ label: 'Delete', icon: Trash2, onClick: () => void deleteChat(s.path) }])
              }}
            >
              {s.name.slice(0, -EXT.length)}
            </div>
          ))}
        </div>
      </aside>

      <section className="ai-main">
        <div className="k-toolbar ai-bar">
          <label>
            AI{' '}
            <select className="k-input" value={provider} onChange={(e) => setProvider(e.target.value as AiProvider)}>
              <option value="auto">Automatic</option>
              <option value="claude" disabled={!status?.claude}>
                Claude{status && !status.claude ? ' (no API key)' : ''}
              </option>
              <option value="ollama" disabled={!status?.ollama}>
                Ollama (local){status && !status.ollama ? ' — not running' : ''}
              </option>
            </select>
          </label>
          {provider !== 'claude' && status?.ollama && (
            <select className="k-input" value={model} onChange={(e) => setModel(e.target.value)} title="Ollama model">
              {status.ollama_models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          )}
        </div>

        <div className="ai-scroll" ref={scroller}>
          {statusError && <div className="ai-note">{statusError}</div>}
          {nothing && (
            <div className="ai-note">
              No AI is set up yet. For Claude, start the server with <code>ANTHROPIC_API_KEY</code> set. For a free local
              model, install Ollama and run <code>ollama pull llama3.2</code>.
            </div>
          )}
          {chat.messages.length === 0 && !nothing && (
            <div className="ai-empty">
              <Bot size={44} />
              <p>Ask anything.</p>
            </div>
          )}
          {chat.messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="ai-msg user">
                {m.content}
              </div>
            ) : (
              <div key={i} className="ai-msg bot">
                {m.by && <div className="ai-by">{m.by}</div>}
                {m.content ? (
                  <div className="ai-md" dangerouslySetInnerHTML={{ __html: toHtml(m.content) }} />
                ) : (
                  <div className="ai-typing">…</div>
                )}
              </div>
            ),
          )}
          {error && <div className="ai-error">{error}</div>}
        </div>

        <div className="ai-composer">
          <textarea
            className="k-input"
            rows={2}
            placeholder="Message the Assistant (Enter to send, Shift+Enter for a new line)"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send()
              }
            }}
          />
          {busy ? (
            <button className="k-btn" onClick={() => abort.current?.abort()} title="Stop">
              <Square size={15} />
            </button>
          ) : (
            <button className="k-btn primary" onClick={() => void send()} disabled={!draft.trim()} title="Send">
              <Send size={15} />
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
