// KherveAI's AI tools (kherveai_new_chat, kherveai_list_chats): names,
// arguments and descriptions are in src/os/ai/manifests/system.ts;
// KherveAI.tsx registers these with useAppTools.

import { fs } from '@/os'
import { pretty } from '@/os/path'
import type { AppTools } from '@/os/ai/appTools'
import { sendMessage } from './agent'
import { composerCommand } from './Composer'
import { CHATS_DIR, activeChat, newChat, useAi } from './store'

const stem = (name: string) => name.replace(/\.json$/i, '')

export function kherveaiAiTools(focus: () => void): AppTools {
  return {
    async new_chat(a, ctx) {
      // A KherveAI chat starting another KherveAI chat (and maybe sending it) would loop.
      if (/^kherveai/i.test(ctx.caller)) {
        throw new Error('You are kAI already: answer in this chat instead of starting another one.')
      }
      const prompt = String(a.prompt ?? '').trim()
      if (!prompt) throw new Error('"prompt" is empty: give the message to type in the new chat.')
      const id = newChat()
      focus()
      const chat = useAi.getState().chats[id]
      const base = { chat_id: id, provider: chat?.provider, model: chat?.model }
      if (a.send === true) {
        if (!sendMessage(id, prompt)) {
          composerCommand(id, { type: 'fill', text: prompt, files: [] })
          throw new Error(
            `kAI could not send it (no API key for ${chat?.provider ?? 'the provider'}, or the chat is busy). The prompt is typed in the new chat for the user to send.`,
          )
        }
        return { ...base, sent: true, note: 'kAI is writing the reply in its window.' }
      }
      composerCommand(id, { type: 'fill', text: prompt, files: [] })
      return { ...base, sent: false, note: 'The prompt is typed in a new chat; the user sends it.' }
    },

    async list_chats(a) {
      const q = typeof a.query === 'string' ? a.query.trim().toLowerCase() : ''
      const limit = typeof a.limit === 'number' && a.limit >= 1 ? Math.min(200, Math.round(a.limit)) : 20
      let files: ReturnType<typeof fs.list> = []
      try {
        files = fs.list(CHATS_DIR)
      } catch {
        files = []
      }
      const chats = files
        .filter((f) => f.type === 'file' && /\.json$/i.test(f.name) && !f.name.startsWith('.'))
        .filter((f) => !q || stem(f.name).toLowerCase().includes(q))
        .sort((x, y) => y.mtime - x.mtime)
      const s = useAi.getState()
      const open = activeChat(s)
      const openPath = open ? s.paths[open.id] : undefined
      return {
        folder: pretty(CHATS_DIR),
        total: chats.length,
        chats: chats.slice(0, limit).map((f) => ({
          title: stem(f.name),
          path: pretty(f.path),
          modified: new Date(f.mtime).toISOString(),
          ...(f.path === openPath && { open: true }),
        })),
        ...(chats.length > limit && { more: chats.length - limit }),
      }
    },
  }
}
