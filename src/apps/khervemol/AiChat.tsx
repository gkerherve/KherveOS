// The AI Chat dock — the desktop's AiDock (ai_assistant.py): a chemistry
// assistant that answers, and when asked to draw a molecule replies with a
// "SMILES:" line that is built in 3D and 2D. Provider, model and key are set
// with the ⚙ button (AI Chat Settings).

import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { mdiBroom, mdiCog } from '@mdi/js'
import { Mdi } from './icons'
import { chat, loadAiSettings, type ChatMessage } from './ai'
import { extractSmiles } from './catalog'
import type { MolApp } from './app'

interface Line {
  role: 'user' | 'assistant' | 'system' | 'error'
  text: string
}

const COLORS: Record<Line['role'], string> = { user: '#0e6f52', assistant: '#123529', system: '#8a8a8a', error: '#b00020' }
const WHO: Partial<Record<Line['role'], string>> = { user: 'You', assistant: 'AI', error: 'Error' }

export function AiChat({ app }: { app: MolApp }) {
  const catalog = useStore(app.store, (s) => s.catalog)
  const [settings, setSettings] = useState(loadAiSettings)
  const [log, setLog] = useState<Line[]>([{ role: 'system', text: 'Ask a chemistry question, or say “draw caffeine”. Set your provider, model and API key with the ⚙ button first.' }])
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [log])

  const provider = settings.provider
  const names = catalog?.ai.names ?? {}
  const model = settings.models[provider] || ''
  const append = (role: Line['role'], t: string) => setLog((l) => [...l, { role, text: t }])

  const send = async () => {
    if (busy) return
    const msg = text.trim()
    if (!msg) return
    const key = settings.keys[provider] ?? ''
    const needs = catalog?.ai.needsKey ?? ['Claude', 'ChatGPT', 'Mistral']
    if (needs.includes(provider) && !key.trim()) {
      append('error', 'No API key set — click ⚙ to add one.')
      return
    }
    if (!model) {
      append('error', 'No model selected — click ⚙ to choose one.')
      return
    }
    setText('')
    append('user', msg)
    const next: ChatMessage[] = [...history, { role: 'user', content: msg }]
    setHistory(next)
    setBusy(true)
    try {
      const reply = await chat(provider, model, [{ role: 'system', content: catalog?.ai.systemPrompt ?? '' }, ...next], key, settings.bases[provider] ?? '')
      setHistory((h) => [...h, { role: 'assistant', content: reply }])
      append('assistant', reply)
      const smiles = extractSmiles(reply)
      if (smiles) {
        try {
          if (await app.buildSmiles(smiles, smiles)) append('system', `✓ Built ${smiles} in the 3D view + 2D sketch.`)
          else append('error', `Could not build ${smiles}.`)
        } catch (e) {
          append('error', `Could not build ${smiles}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    } catch (e) {
      append('error', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="km-ai">
      <div className="km-row">
        <span className="km-grow km-ai-provider">
          <b>{names[provider] ?? provider}</b> · {model || '(no model set)'}
        </span>
        <button
          className="k-icon-btn"
          title="AI provider / model / key settings"
          onClick={() =>
            void app.ask('aisettings').then((ok) => {
              if (ok) setSettings(loadAiSettings())
            })
          }
        >
          <Mdi path={mdiCog} size={18} />
        </button>
        <button
          className="k-icon-btn"
          title="Clear the conversation"
          onClick={() => {
            setHistory([])
            setLog([])
          }}
        >
          <Mdi path={mdiBroom} size={18} />
        </button>
      </div>
      <div className="km-ai-log" ref={logRef}>
        {log.map((l, i) => (
          <div key={i} className="km-ai-line" style={{ color: COLORS[l.role] }}>
            {WHO[l.role] && <b style={{ color: COLORS[l.role] }}>{WHO[l.role]}: </b>}
            {l.text}
          </div>
        ))}
      </div>
      <div className="km-row km-ai-input">
        <textarea
          className="k-input km-grow"
          placeholder="Ask a question, or “draw aspirin”…  (Enter to send, Shift+Enter for a newline)"
          value={text}
          readOnly={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button className="k-btn" disabled={busy} onClick={() => void send()}>
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
