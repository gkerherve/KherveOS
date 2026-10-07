// Settings › AI & MCP: let AI apps (Claude Code, Claude Desktop, ChatGPT, Ollama
// clients…) use KherveOS through the MCP server of the KherveOS server.
// The tools run in this tab (src/os/ai/tools.ts, offered by src/os/ai/mcpBridge.ts).

import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Copy, Eye, EyeOff, RefreshCw, Sparkles, X } from 'lucide-react'
import { os } from '@/os'
import { api, ApiError, useRealtime } from '@/os/server'
import { ServerGate } from '@/os/ui/ServerGate'
import { startMcpBridge, useMcpBridge } from '@/os/ai/mcpBridge'

interface TokenInfo {
  token: string
  /** The MCP endpoint, e.g. http://localhost:8787/mcp */
  url: string
  created_at: number
  last_used: number | null
}

export function McpSection() {
  // Normally started by the shell; starting it again does nothing.
  useEffect(() => void startMcpBridge(), [])
  return (
    <>
      <h2>AI &amp; MCP</h2>
      <p className="k-muted">
        Let AI apps work in KherveOS. Claude Code, Claude Desktop, ChatGPT and other apps that speak MCP (the Model
        Context Protocol) can read and write your files, open apps and run Python here, through this browser tab, while
        it is open. KherveOS asks you before anything is deleted or replaced.
      </p>
      <div className="st-mcp-gate">
        <ServerGate app="AI & MCP" icon={Sparkles}>
          <McpSetup />
        </ServerGate>
      </div>
    </>
  )
}

function McpSetup() {
  const [info, setInfo] = useState<TokenInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reveal, setReveal] = useState(false)
  const [tunnel, setTunnel] = useState('')
  const connected = useRealtime((s) => s.connected)
  const registered = useMcpBridge((s) => s.registered)
  const activity = useMcpBridge((s) => s.activity)

  // Reload when AI apps make calls, so "last used" stays current.
  const latestCall = activity[0]?.id
  useEffect(() => {
    let live = true
    api<TokenInfo>('/mcp/token').then(
      (r) => {
        if (!live) return
        setInfo(r)
        setError(null)
      },
      (e) => live && setError(errorText(e)),
    )
    return () => {
      live = false
    }
  }, [latestCall])

  if (!info) {
    return error ? (
      <div className="st-card">
        <div className="k-error">Could not get your MCP token: {error}</div>
      </div>
    ) : (
      <p className="k-muted">Loading…</p>
    )
  }

  const rotate = async () => {
    const ok = await os.dialog.confirm(
      'Make a new token? AI apps set up with the current one stop working until you give them the new one.',
      { title: 'New MCP token', okLabel: 'Make a new token', danger: true },
    )
    if (!ok) return
    try {
      setInfo(await api<TokenInfo>('/mcp/token/rotate', { method: 'POST' }))
      setError(null)
      os.notify({ title: 'New MCP token made', body: 'Give it to your AI apps: the old one no longer works.' })
    } catch (e) {
      setError(errorText(e))
    }
  }

  const token = info.token
  const shown = reveal ? token : `${token.slice(0, 4)}${'•'.repeat(18)}`
  const origin = originOf(info.url)
  const tunnelBase = tunnelOrigin(tunnel) || 'https://<your-tunnel>.trycloudflare.com'

  const claudeCode = (t: string) => `claude mcp add --transport http kherveos ${info.url} --header "Authorization: Bearer ${t}"`
  // mcp-remote fills in ${KHERVEOS_AUTH} itself (Claude Desktop on Windows breaks arguments that contain spaces).
  const claudeDesktop = (t: string) =>
    JSON.stringify(
      {
        mcpServers: {
          kherveos: {
            command: 'npx',
            args: ['-y', 'mcp-remote', info.url, '--header', 'Authorization:${KHERVEOS_AUTH}'],
            env: { KHERVEOS_AUTH: `Bearer ${t}` },
          },
        },
      },
      null,
      2,
    )
  const tokenUrl = (base: string, t: string) => `${base}/mcp/t/${t}`
  const ready = connected && registered !== null

  return (
    <>
      <div className="st-card">
        <div>
          <b className={ready ? 'st-ok' : 'st-off'}>
            {ready ? `● Ready: this tab offers ${registered} tools to AI apps` : connected ? '● Getting ready…' : '● Not connected to the KherveOS server'}
          </b>
          <div className="k-muted">
            {info.last_used ? `An AI app last used KherveOS ${ago(info.last_used)}.` : 'No AI app has used KherveOS yet.'} Keep
            this tab open while they work.
          </div>
        </div>
        <Field label="MCP URL" value={info.url}>
          <CopyButton text={info.url} />
        </Field>
        <Field label="Token" value={shown}>
          <button className="k-icon-btn" title={reveal ? 'Hide the token' : 'Show the token'} onClick={() => setReveal(!reveal)}>
            {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          <CopyButton text={token} />
          <button className="k-btn small" onClick={() => void rotate()}>
            <RefreshCw size={13} /> New token…
          </button>
        </Field>
        {error && <div className="k-error">{error}</div>}
      </div>

      <h3>Claude Code</h3>
      <p>Run this in a terminal:</p>
      <Snippet text={claudeCode(shown)} copy={claudeCode(token)} />

      <h3>Claude Desktop</h3>
      <p>
        In Claude, open Settings › Developer › Edit Config and add this to <code>claude_desktop_config.json</code> (inside
        your <code>"mcpServers"</code> if you already have some), then restart Claude. It needs Node.js.
      </p>
      <Snippet text={claudeDesktop(shown)} copy={claudeDesktop(token)} />

      <h3>ChatGPT</h3>
      <p>
        ChatGPT connects from the internet, so your KherveOS server needs a public HTTPS address. A Cloudflare tunnel gives
        one (install <code>cloudflared</code> first):
      </p>
      <Snippet text={`cloudflared tunnel --url ${origin}`} copy={`cloudflared tunnel --url ${origin}`} />
      <p>Paste the https://….trycloudflare.com address it prints:</p>
      <input
        className="k-input st-mcp-tunnel"
        placeholder="https://….trycloudflare.com"
        value={tunnel}
        onChange={(e) => setTunnel(e.target.value)}
        spellCheck={false}
      />
      <p>
        Then, in ChatGPT, turn on developer mode (Settings › Apps &amp; Connectors › Advanced settings) and create a connector
        with this URL, without authentication:
      </p>
      <Snippet text={tokenUrl(tunnelBase, shown)} copy={tokenUrl(tunnelBase, token)} />
      <div className="st-mcp-warning">
        <AlertTriangle size={15} />
        <div>
          Anyone who has this URL can act on your KherveOS while the tunnel runs. Keep it private, stop the tunnel
          (Ctrl+C) when you are done, and make a new token if the URL leaks.
        </div>
      </div>

      <h3>Ollama and other MCP clients</h3>
      <p>
        Open WebUI, mcphost and other MCP clients, with local Ollama models or any other, connect the same way:
        Streamable HTTP at the MCP URL above, with the header <code>Authorization: Bearer &lt;token&gt;</code>. A client
        that cannot send headers can use this address instead:
      </p>
      <Snippet text={tokenUrl(origin, shown)} copy={tokenUrl(origin, token)} />

      {activity.length > 0 && (
        <>
          <h3>Recent requests in this tab</h3>
          <div className="st-card st-mcp-activity">
            {activity.slice(0, 8).map((a) => (
              <div key={a.id} className="st-mcp-act" title={a.error}>
                <span className="k-muted">{clock(a.at)}</span>
                <span className="st-mcp-ellipsis">{a.caller.replace(/ via MCP$/, '')}</span>
                <code>{a.tool}</code>
                <span className="st-mcp-ellipsis k-muted">{a.error ?? a.detail}</span>
                <span className={`st-mcp-state ${a.state}`}>
                  {a.state === 'running' ? '…' : a.state === 'done' ? <Check size={13} /> : <X size={13} />}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function Field({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className="st-mcp-field">
      <span className="k-muted">{label}</span>
      <span className="st-mcp-value" title={value}>
        {value}
      </span>
      <span className="st-mcp-buttons">{children}</span>
    </div>
  )
}

function Snippet({ text, copy }: { text: string; copy: string }) {
  return (
    <div className="st-mcp-snippet">
      <pre className="k-code-block">{text}</pre>
      <CopyButton text={copy} />
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const timer = window.setTimeout(() => setDone(false), 1500)
    return () => window.clearTimeout(timer)
  }, [done])
  return (
    <button
      className="k-btn small"
      onClick={async () => {
        if (await copyText(text)) setDone(true)
        else os.notify({ title: 'Could not copy', body: 'Select the text and copy it yourself.' })
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? 'Copied' : 'Copy'}
    </button>
  )
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // No clipboard API (plain http on another computer): the old way.
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

const errorText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e))

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return 'http://localhost:8787'
  }
}

/** "abc.trycloudflare.com/" → "https://abc.trycloudflare.com" ("" if it is not an address). */
function tunnelOrigin(text: string): string {
  const t = text.trim()
  if (!t) return ''
  try {
    return new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`).origin
  } catch {
    return ''
  }
}

function ago(seconds: number): string {
  const s = Math.max(0, Date.now() / 1000 - seconds)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `on ${new Date(seconds * 1000).toLocaleDateString()}`
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
