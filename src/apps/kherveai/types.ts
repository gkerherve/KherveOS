// KherveAI's data: chats, their messages, and what the agent did in them.
// The same neutral shape is saved to disk and turned into each provider's
// message format when a request is made (see history.ts).

export type ProviderId = 'ollama' | 'anthropic' | 'openai'

/** A text file from the drive, added to a user message. */
export interface Attachment {
  path: string
  name: string
  /** Bytes on the drive. */
  size: number
  /** Characters in the whole file. */
  chars: number
  /** What the model gets (head and tail when the file is long). */
  text: string
  truncated: boolean
}

export interface ToolOutcome {
  ok: boolean
  result?: unknown
  error?: string
}

/** One tool call the model made, and what came of it. */
export interface ToolCall {
  id: string
  /** The KherveOS tool's name (not the API-safe wire name). */
  name: string
  args: Record<string, unknown>
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped'
  result?: ToolOutcome
  /** Milliseconds the tool took. */
  ms?: number
}

/** One model call: its thinking, its text, and the tools it asked for. */
export interface Turn {
  thinking?: string
  text: string
  calls: ToolCall[]
}

export interface UserMessage {
  id: string
  role: 'user'
  time: number
  text: string
  attachments?: Attachment[]
}

export interface Usage {
  input?: number
  output?: number
}

export interface AssistantMessage {
  id: string
  role: 'assistant'
  time: number
  provider: ProviderId
  model: string
  turns: Turn[]
  error?: string
  /** The person pressed Stop. */
  stopped?: boolean
  /** The step limit was reached with tool calls left: offer Continue. */
  limited?: boolean
  usage?: Usage
}

export type Message = UserMessage | AssistantMessage

export interface Chat {
  id: string
  /** Shown in the list; the file name is the source of truth for saved chats. */
  title: string
  created: number
  updated: number
  provider: ProviderId
  model: string
  /** This chat's own system prompt; null = the default one. */
  system: string | null
  messages: Message[]
}

/** A chat as saved in ~/Documents/AI Chats/<title>.json */
export interface ChatFile extends Chat {
  format: 'kherveai-chat'
  version: 1
}

/** What a streamed model call reports, the same for every provider. */
export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; id: string; name: string; args: Record<string, unknown> }

export interface OllamaModel {
  name: string
  size: number
  params?: string
  family?: string
  /** "completion", "tools", "thinking", "vision"… (null until known). */
  caps: string[] | null
}
