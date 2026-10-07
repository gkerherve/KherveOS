// The AI assistant's providers and protocol (the desktop's ai_providers.py
// and the non-Qt half of ai_chat.py). Plain fetch, no SDKs. Settings and
// keys live in this browser's localStorage and go only to the chosen
// provider.

import type { Cell, CellType } from './format'
import { describeWorkbook } from './sheet'
import { readJson, writeJson } from './prefs'

export type ProviderId = 'anthropic' | 'openai' | 'mistral' | 'ollama' | 'local'
type Api = 'anthropic' | 'openai' | 'ollama'

export interface ProviderMeta {
  label: string
  /** "Ask Claude…" */
  ask: string
  api: Api
  needsKey: boolean
  needsHost: boolean
  models: string[]
  defaultModel: string
  host: string
  help: string
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    ask: 'Claude',
    api: 'anthropic',
    needsKey: true,
    needsHost: false,
    models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-fable-5'],
    defaultModel: 'claude-sonnet-5-5',
    host: 'https://api.anthropic.com',
    help:
      'To get an API key:\n1. Go to console.anthropic.com\n2. Sign up or log in\n3. Navigate to API Keys in the left sidebar\n' +
      '4. Click "Create Key" and copy the key (starts with sk-ant-)\n5. Add credit to your account under Billing',
  },
  openai: {
    label: 'OpenAI (ChatGPT)',
    ask: 'ChatGPT',
    api: 'openai',
    needsKey: true,
    needsHost: false,
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3', 'o3-mini', 'o4-mini'],
    defaultModel: 'gpt-4o',
    host: 'https://api.openai.com/v1',
    help:
      'To get an API key:\n1. Go to platform.openai.com\n2. Sign up or log in\n3. Navigate to API Keys in the left sidebar\n' +
      '4. Click "Create new secret key" and copy it (starts with sk-)\n5. Add credit under Billing > Payment methods',
  },
  mistral: {
    label: 'Mistral AI',
    ask: 'Mistral',
    api: 'openai',
    needsKey: true,
    needsHost: false,
    models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest', 'open-mistral-nemo', 'ministral-8b-latest', 'ministral-3b-latest', 'pixtral-large-latest'],
    defaultModel: 'mistral-large-latest',
    host: 'https://api.mistral.ai/v1',
    help: 'To get an API key:\n1. Go to console.mistral.ai\n2. Sign up or log in\n3. Navigate to API Keys\n4. Click "Create new key" and copy it\n5. Add credit under Billing',
  },
  ollama: {
    label: 'Ollama (local)',
    ask: 'Ollama',
    api: 'ollama',
    needsKey: false,
    needsHost: true,
    models: ['llama3.2', 'llama3.1', 'qwen2.5-coder', 'qwen2.5', 'mistral', 'mistral-nemo', 'gemma2', 'phi3', 'codellama', 'deepseek-coder-v2'],
    defaultModel: 'llama3.2',
    host: 'http://localhost:11434',
    help:
      'Ollama runs locally — no API key needed.\n1. Download and install from ollama.com\n2. Run "ollama pull <model>" to download a model\n' +
      '   (e.g. ollama pull llama3.2, ollama pull qwen2.5-coder)\n3. The server starts automatically on localhost:11434\n' +
      '4. Use the refresh button (⟳) to see available models\n\nIf KherveOS is not served from localhost, start Ollama with\nOLLAMA_ORIGINS set to its address so the browser may call it.',
  },
  local: {
    label: 'Local AI (OpenAI-compatible)',
    ask: 'the local AI',
    api: 'openai',
    needsKey: false,
    needsHost: true,
    models: [],
    defaultModel: '',
    host: 'http://localhost:11434/v1',
    help:
      'Connect to any OpenAI-compatible local server.\nWorks with LM Studio, llama.cpp, LocalAI, Ollama\n(OpenAI mode), text-generation-webui, and others.\n\n' +
      '1. Start your local server (allow this page in its CORS settings)\n2. Enter the server URL below (e.g. http://localhost:1234/v1)\n' +
      '3. Click refresh (⟳) to see available models\n4. No API key is needed for most local servers',
  },
}

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[]

export interface ProviderConfig {
  key: string
  model: string
  host: string
}

export interface AiSettings {
  provider: ProviderId
  configs: Partial<Record<ProviderId, Partial<ProviderConfig>>>
  /** Chat text size, px. */
  fontSize: number
  /** Apply and run the assistant's cells as soon as it replies. */
  auto: boolean
}

const SETTINGS_KEY = 'khervebook.ai'
const HISTORY_KEY = 'khervebook.ai.inputs'

export function loadAiSettings(): AiSettings {
  const s = readJson<Partial<AiSettings>>(SETTINGS_KEY, {})
  const provider = s.provider && s.provider in PROVIDERS ? s.provider : 'anthropic'
  const fontSize = typeof s.fontSize === 'number' ? Math.min(22, Math.max(10, s.fontSize)) : 13
  return { provider, configs: s.configs && typeof s.configs === 'object' ? s.configs : {}, fontSize, auto: s.auto === true }
}

export function saveAiSettings(s: AiSettings) {
  writeJson(SETTINGS_KEY, s)
}

export function configFor(s: AiSettings, id: ProviderId = s.provider): ProviderConfig {
  const meta = PROVIDERS[id]
  const c = s.configs[id] ?? {}
  return { key: c.key ?? '', model: c.model || meta.defaultModel, host: c.host || meta.host }
}

export function inputHistory(): string[] {
  const v = readJson<unknown>(HISTORY_KEY, [])
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export function saveInputHistory(list: string[]) {
  writeJson(HISTORY_KEY, list.slice(-100))
}

// --------------------------------------------------------------- messages

export interface ChatImage {
  mediaType: string
  /** base64, no data: prefix */
  data: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  images?: ChatImage[]
}

/** The neutral history in a provider's message shape (images expanded). */
function formatMessages(api: Api, history: ChatMessage[]): unknown[] {
  return history.map((m) => {
    const images = m.images ?? []
    if (!images.length) return { role: m.role, content: m.content }
    if (api === 'anthropic') {
      return {
        role: m.role,
        content: [
          ...(m.content ? [{ type: 'text', text: m.content }] : []),
          ...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.data } })),
        ],
      }
    }
    if (api === 'ollama') return { role: m.role, content: m.content, images: images.map((im) => im.data) }
    return {
      role: m.role,
      content: [
        ...(m.content ? [{ type: 'text', text: m.content }] : []),
        ...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mediaType};base64,${im.data}` } })),
      ],
    }
  })
}

const MAX_TOKENS = 8192

function errorMessage(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const d = data as Record<string, unknown>
  const e = d.error
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && typeof (e as Record<string, unknown>).message === 'string') return (e as Record<string, string>).message
  if (typeof d.message === 'string') return d.message
  if (typeof d.detail === 'string') return d.detail
  return ''
}

async function post(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal, provider: ProviderId): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal })
  } catch (e) {
    if (signal.aborted) throw e
    const where = PROVIDERS[provider].needsHost
      ? `Is the server running at ${new URL(url).origin}, and does it allow requests from this page (CORS)?`
      : 'Check your internet connection.'
    throw new Error(`Could not reach ${PROVIDERS[provider].label}. ${where}`)
  }
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${errorMessage(data) || text.slice(0, 300) || res.statusText}`)
  return data
}

/** One chat call (not streamed, like the desktop). Resolves to the reply text. */
export async function chat(provider: ProviderId, cfg: ProviderConfig, system: string, history: ChatMessage[], signal: AbortSignal): Promise<string> {
  const meta = PROVIDERS[provider]
  const host = cfg.host.replace(/\/+$/, '')
  const messages = formatMessages(meta.api, history)
  if (meta.api === 'anthropic') {
    const data = (await post(
      `${host}/v1/messages`,
      { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      { model: cfg.model, max_tokens: MAX_TOKENS, system, messages },
      signal,
      provider,
    )) as { content?: { type?: string; text?: string }[] }
    return (data?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
  }
  if (meta.api === 'ollama') {
    const data = (await post(`${host}/api/chat`, {}, { model: cfg.model, stream: false, messages: [{ role: 'system', content: system }, ...messages] }, signal, provider)) as {
      message?: { content?: string }
    }
    return data?.message?.content ?? ''
  }
  const headers: Record<string, string> = cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}
  const data = (await post(`${host}/chat/completions`, headers, { model: cfg.model, max_tokens: MAX_TOKENS, messages: [{ role: 'system', content: system }, ...messages] }, signal, provider)) as {
    choices?: { message?: { content?: string } }[]
  }
  return data?.choices?.[0]?.message?.content ?? ''
}

/** The provider's model list (the settings' refresh button). */
export async function fetchModels(provider: ProviderId, cfg: ProviderConfig): Promise<string[]> {
  const meta = PROVIDERS[provider]
  const host = cfg.host.replace(/\/+$/, '')
  const get = async (url: string, headers: Record<string, string>) => {
    let res: Response
    try {
      res = await fetch(url, { headers })
    } catch {
      throw new Error(`Could not reach ${new URL(url).origin}.`)
    }
    const data = (await res.json().catch(() => null)) as unknown
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${errorMessage(data) || res.statusText}`)
    return data as Record<string, unknown>
  }
  let ids: string[] = []
  if (provider === 'anthropic') {
    const d = await get(`${host}/v1/models?limit=1000`, { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' })
    ids = ((d.data as { id?: string }[]) ?? []).map((m) => m.id ?? '').filter(Boolean)
  } else if (provider === 'ollama') {
    const d = await get(`${host}/api/tags`, {})
    ids = [...new Set(((d.models as { name?: string }[]) ?? []).map((m) => m.name ?? '').filter(Boolean))]
  } else {
    const d = await get(`${host}/models`, cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {})
    ids = ((d.data as { id?: string }[]) ?? []).map((m) => m.id ?? '').filter(Boolean)
    if (provider === 'openai') ids = ids.filter((i) => /^(gpt-|o1-|o3|o4|chatgpt-)/.test(i))
  }
  return ids.length ? ids.sort() : meta.models
}

// ------------------------------------------------------------ the replies

/** One fenced block: an info string (language + optional "cell=N") then the body. */
const FENCE = /```[ \t]*([^\r\n`]*)\r?\n([\s\S]*?)```/g

const KIND: Record<string, CellType> = {
  python: 'code',
  py: 'code',
  md: 'markdown',
  markdown: 'markdown',
  tex: 'latex',
  latex: 'latex',
  sheet: 'sheet',
  js: 'js',
  javascript: 'js',
  html: 'js',
}

export interface ProposedCell {
  type: CellType
  source: string
  /** An existing cell (index in the listing) to replace. */
  target: number | null
}

/** Fenced blocks in a reply → cells (desktop extract_cells). Unknown languages are ignored. */
export function extractCells(text: string): ProposedCell[] {
  const out: ProposedCell[] = []
  for (const m of (text ?? '').matchAll(FENCE)) {
    const tokens = m[1].trim().split(/\s+/).filter(Boolean)
    if (!tokens.length) continue
    const type = KIND[tokens[0].toLowerCase()]
    if (!type) continue
    let target: number | null = null
    for (const tok of tokens.slice(1)) {
      const n = /\d+/.exec(tok)
      if (n) {
        target = Number(n[0])
        break
      }
    }
    out.push({ type, source: m[2].replace(/^\n+|\n+$/g, ''), target })
  }
  return out
}

// ------------------------------------------------------------ the prompt

const MAX_CELL_CHARS = 4000
const MAX_TOTAL_CHARS = 20000

function otherSummary(c: Cell): string {
  const t = c.rawType ?? 'other'
  try {
    const doc = JSON.parse(c.source) as Record<string, unknown>
    if (t === 'note' && typeof doc.html === 'string') {
      return doc.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '(an empty rich-text note)'
    }
    if (t === 'file' && Array.isArray(doc.files)) {
      return `(attached files: ${doc.files.map((f) => (f && typeof f === 'object' ? String((f as Record<string, unknown>).name ?? '') : '')).filter(Boolean).join(', ') || 'none'})`
    }
  } catch {
    /* not JSON */
  }
  return `(a ${t} cell from the desktop KherveBook — you cannot read or edit it)`
}

function listing(cells: Cell[]): string {
  const blocks: string[] = []
  let total = 0
  let sheetN = 1
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    let body: string
    if (c.type === 'svg') body = '(an SVG drawing — you cannot read or edit this cell)'
    else if (c.type === 'other') body = otherSummary(c)
    else if (c.type === 'sheet') {
      const d = describeWorkbook(c.source, sheetN)
      sheetN += d.count
      body = d.text
    } else {
      body = c.source.length > MAX_CELL_CHARS ? c.source.slice(0, MAX_CELL_CHARS) + '\n… (truncated)' : c.source
      if (c.type === 'code') {
        const err = c.outputs.find((o) => o.kind === 'error')
        if (err && err.kind === 'error') body += `\n[last run failed: ${err.ename ? err.ename + ': ' : ''}${err.evalue}]`.slice(0, 600)
      }
    }
    const type = c.type === 'other' ? (c.rawType ?? 'other') : c.type
    const block = `=== Cell [${i}] (${type}) ===\n${body}`
    total += block.length
    if (total > MAX_TOTAL_CHARS && blocks.length) {
      blocks.push(`… (${cells.length - i} more cells omitted)`)
      break
    }
    blocks.push(block)
  }
  return blocks.length ? blocks.join('\n') : '(empty notebook)'
}

/** The desktop's build_system_prompt, for the browser kernel. */
export function systemPrompt(cells: Cell[]): string {
  return `You are the AI assistant inside KherveBook, a Jupyter-style notebook (the web edition, running in KherveOS in the browser). The editable cell types are: code (Python), markdown, latex (one display equation, no $ delimiters), sheet (a small spreadsheet, JSON {"rows", "cols", "data": {"A1": "value or =python formula"}}) and js (JavaScript/HTML rendered in a sandboxed page). There are also svg "drawing" cells that you must NEVER create or modify.

YOUR PRIMARY SKILL is writing excellent, complete, runnable Python for code cells. Key facts about the kernel:
- Python runs in the browser (Pyodide, CPython compiled to WebAssembly), one persistent namespace shared by all code cells.
- Preloaded: math, np/numpy, plt (matplotlib, Agg), pd/pandas. scipy, sympy and lmfit load the first time a cell uses them; import anything else you need. numpy, scipy, pandas, matplotlib, sympy, scikit-learn and many more are available; pure-Python packages from PyPI install with "%pip install name" on its own line.
- input() is not available; files live under /home/user (the notebook's folder is the working directory). Network access from Python is limited.
- The value of a cell's LAST line (if an expression) is displayed: numbers/strings echo, a matplotlib Figure embeds as a plot — end plotting cells with \`fig\`.
- A code cell whose first line contains "runs continuously" can be looped for animations; keep per-frame state in globals().
- Sheet cells publish each sheet to code cells as a variable sheet1, sheet2, ... — a list of rows, each row a list of cell values, header in row 0. THIS is the normal way to read a sheet's data. To load columns A and B: \`rows = sheet1[1:]\` (skip the header), then \`a = [float(r[0]) for r in rows]; b = [float(r[1]) for r in rows]\`, or build a DataFrame with \`pd.DataFrame(sheet1[1:], columns=sheet1[0])\`. The notebook listing below names the variable (sheet1, sheet2, …), the sheet name and the columns of every sheet — use it to pick the right variable. Do NOT loop ks() cell by cell; ks("A1") / ks("A1", v) is only for reading or writing a SINGLE cell.
- js cells are for interactive web visuals Python can't do (D3, Plotly.js, ECharts, three.js, canvas animations). Bare JavaScript is wrapped in a page that shows console.log output; anything with HTML tags loads as a page, and CDN <script src> tags work. A js cell does NOT see the Python namespace — embed the data it needs as literals. Prefer Python/matplotlib for ordinary plots.

READING: the full current notebook is included below — read it to understand and reason about the user's existing code in any cell.

WRITING: reply with each cell you want as ONE fenced block.
- To ADD a new cell, tag it with just the language: \`\`\`python, \`\`\`markdown, \`\`\`latex, \`\`\`sheet or \`\`\`js.
- To REPLACE an existing cell, add its index from the listing, e.g. \`\`\`python cell=3 — keep the same language unless the user wants the type changed.
- You may read and write code, markdown, latex, sheet and js cells. Never emit an svg cell.

Each applied cell is RUN immediately, so the task you are asked to do actually happens — do not just describe it. Every code block must be complete and syntactically valid Python with correct, consistent indentation (4 spaces), no truncation and no placeholders. Keep prose outside the fences brief.

Current notebook (${cells.length} cells):
${listing(cells)}`
}

/** Example prompts (the ? button). */
export const EXAMPLE_PROMPTS = [
  'Plot a damped sine wave and label the axes.',
  'Add error handling and a docstring to cell 2.',
  'Make a 6×3 sheet of monthly sales with a Total column.',
  'Write a Markdown summary of what this notebook does.',
  'Rewrite cell 0 to vectorise the loop with NumPy.',
  'Add a LaTeX cell with the quadratic formula.',
  'Fit a Gaussian to the data in sheet1 and plot the fit.',
  'Add a JavaScript cell with an animated bouncing-ball canvas.',
]

export const GREETING =
  'Hello! I can help you build your notebook. Ask me to write or edit Python, Markdown, LaTeX, sheet or JavaScript cells, analyse your data, ' +
  'or make plots. I read every cell and can add new ones or rewrite existing ones (code, markdown, latex, sheet, js — never drawings); ' +
  'apply with one click and Undo to take it back. You can also paste a screenshot or image (Ctrl+V) for me to look at. ' +
  'Set your provider (Anthropic, OpenAI, Mistral, Ollama, or Local AI) and API key via the gear icon.'

/** Downscale a pasted image past 1568 px (keeps requests small) → base64 PNG/JPEG. */
export async function imageForChat(blob: Blob): Promise<ChatImage> {
  const MAX = 1568
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')?.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const mediaType = 'image/png'
  const url = canvas.toDataURL(mediaType)
  return { mediaType, data: url.slice(url.indexOf(',') + 1) }
}

/** Keep the conversation within ~400k characters, dropping old screenshots first (desktop ai_memory.trim). */
export function trimHistory(history: ChatMessage[], maxChars = 400_000): ChatMessage[] {
  const size = (m: ChatMessage) => m.content.length + (m.images ?? []).reduce((n, im) => n + im.data.length, 0)
  let total = history.reduce((n, m) => n + size(m), 0)
  const out = history.map((m) => ({ ...m }))
  for (let i = 0; i < out.length - 1 && total > maxChars; i++) {
    if (out[i].images?.length) {
      total -= out[i].images!.reduce((n, im) => n + im.data.length, 0)
      out[i].images = undefined
    }
  }
  while (out.length > 1 && total > maxChars) total -= size(out.shift()!)
  // The conversation must start with the user.
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}
