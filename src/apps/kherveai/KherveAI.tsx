// KherveAI: chat with Ollama (local models, the default), Claude or ChatGPT,
// and let the model act inside KherveOS through the shared tool registry
// (src/os/ai/tools.ts). Chats are JSON files in ~/Documents/AI Chats/.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Brain, FileDown, FolderOpen, KeyRound, Paperclip, Pencil, RefreshCw, ScrollText, Server, Sparkles, Square, SquarePen, Trash2, Wand2,
} from 'lucide-react'
import { os, type AppProps, type MenuBarMenu, type MenuItem } from '@/os'
import { useWindows } from '@/os/windows'
import { useAppTools } from '@/os/ai/appTools'
import { exportChat, openChatsFolder } from './actions'
import { kherveaiAiTools } from './aiTools'
import { regenerate, sendMessage } from './agent'
import { ChatView } from './ChatView'
import { composerCommand } from './Composer'
import { SettingsDialog, SystemPromptDialog } from './Dialogs'
import { PROVIDER_IDS, PROVIDERS } from './settings'
import { Sidebar } from './Sidebar'
import {
  activeChat,
  deleteChat,
  modelChoices,
  modelSupportsTools,
  newChat,
  openChatFile,
  openDialog,
  promptCustomModel,
  promptRename,
  refreshOllama,
  refreshServerClaude,
  refreshRemoteModels,
  setChatModel,
  stopAll,
  stopRun,
  updateSettings,
  useAi,
  watchChatFiles,
} from './store'
import { availableTools } from './toolbridge'
import type { ProviderId } from './types'
import { errorText } from './util'
import './kherveai.css'

/** Below this width the chat list slides over the conversation. */
const NARROW = 700
/** Below this width (of the conversation pane) the toolbar drops its labels. */
const COMPACT = 600
/** The chat list's width when it sits beside the conversation (kherveai.css). */
const SIDEBAR = 250

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(900)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

export default function KherveAI({ win, args }: AppProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const width = useWidth(rootRef)
  const narrow = width < NARROW
  const [sideWide, setSideWide] = useState(true)
  const [sideNarrow, setSideNarrow] = useState(false)
  const sideOpen = narrow ? sideNarrow : sideWide
  const mainWidth = narrow || !sideOpen ? width : width - SIDEBAR

  const chat = useAi((s) => activeChat(s))
  const dialog = useAi((s) => s.dialog)
  const running = useAi((s) => (chat ? !!s.running[chat.id] : false))
  const anyRunning = useAi((s) => Object.keys(s.running).length > 0)
  const saved = useAi((s) => (chat ? !!s.paths[chat.id] : false))
  const settings = useAi((s) => s.settings)
  const ollama = useAi((s) => s.ollama)
  const remote = useAi((s) => s.remote)
  const keys = useAi((s) => s.keys)
  const supportsTools = useAi((s) => (chat ? modelSupportsTools(chat.provider, chat.model, s) : false))

  // kherveai_new_chat, kherveai_list_chats (src/os/ai/manifests/system.ts).
  useAppTools(win, kherveaiAiTools(() => win.focus()))

  // Start: watch the chat files, open an empty chat, ask Ollama what it has.
  useEffect(() => {
    const unwatch = watchChatFiles()
    if (!useAi.getState().activeId || !activeChat()) newChat()
    void refreshOllama()
    void refreshServerClaude()
    return () => {
      unwatch()
      stopAll()
    }
  }, [])

  // os.open('kherveai', { path }) with a saved chat.
  useEffect(() => {
    if (typeof args.path === 'string' && /\.json$/i.test(args.path)) void openChatFile(args.path)
  }, [args.path])

  // os.open('kherveai', { ask, _ask }) from another app (KherveTeX's AI ▸ Ask KherveAI…):
  // a new chat that sends the request at once; the app's tools act on its window.
  const lastAsk = useRef<unknown>(null)
  useEffect(() => {
    if (typeof args.ask !== 'string' || !args.ask.trim() || args._ask === lastAsk.current) return
    lastAsk.current = args._ask
    const id = newChat()
    sendMessage(id, args.ask)
  }, [args.ask, args._ask])

  // While Ollama is down and in use, look again now and then (it may have been started).
  const usesOllama = chat?.provider === 'ollama'
  useEffect(() => {
    if (!usesOllama || ollama.status !== 'down') return
    const t = window.setInterval(() => void refreshOllama(), 15_000)
    const onFocus = () => void refreshOllama()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('focus', onFocus)
    }
  }, [usesOllama, ollama.status])

  const title = chat && (chat.messages.length || saved) ? `kAI — ${chat.title}` : 'kAI'
  useEffect(() => {
    win.setTitle(title)
  }, [win, title])

  // A reply finished while you were looking elsewhere: say so.
  useEffect(() => {
    let before = useAi.getState().running
    return useAi.subscribe((s) => {
      if (s.running === before) return
      for (const id of Object.keys(before)) {
        if (s.running[id]) continue
        const chat = s.chats[id]
        const last = chat?.messages[chat.messages.length - 1]
        if (!chat || last?.role !== 'assistant' || last.stopped) continue
        const looking = useWindows.getState().focusedId === win.id && s.activeId === id && !document.hidden
        if (looking) continue
        os.notify({
          title: last.error ? 'kAI ran into a problem' : 'kAI replied',
          body: chat.title,
          icon: Sparkles,
          onClick: () => {
            win.focus()
            useAi.setState({ activeId: id })
          },
        })
      }
      before = s.running
    })
  }, [win])

  // Closing while a reply is being written.
  useEffect(() => {
    win.setCloseGuard(async () => {
      if (!Object.keys(useAi.getState().running).length) return true
      const ok = await os.dialog.confirm('kAI is still writing a reply. Stop it and close?', { title: 'Close kAI', okLabel: 'Stop and Close' })
      if (ok) stopAll()
      return ok
    })
    return () => win.setCloseGuard(null)
  }, [win])

  // ------------------------------------------------------------- menus

  const id = chat?.id ?? ''
  const provider = chat?.provider ?? 'ollama'
  const model = chat?.model ?? ''
  const hasMessages = !!chat?.messages.length
  const lastIsReply = chat?.messages[chat.messages.length - 1]?.role === 'assistant'

  useEffect(() => {
    if (!id) return
    const pick = (p: ProviderId, m: string) => () => setChatModel(id, p, m)
    const providerMenu = (p: ProviderId): MenuItem[] => {
      const items: MenuItem[] = []
      if (p === 'ollama' && ollama.status === 'down') {
        items.push({ label: 'Ollama is not running', disabled: true }, { label: 'Check Again', icon: RefreshCw, onClick: () => void refreshOllama() })
        return items
      }
      const models = modelChoices(p, { ollama, remote, settings })
      if (provider === p && model && !models.includes(model)) models.unshift(model)
      for (const m of models) items.push({ label: m, checked: provider === p && model === m, onClick: pick(p, m), disabled: running })
      if (!models.length) items.push({ label: p === 'ollama' ? 'No models installed' : 'No models', disabled: true })
      items.push('-')
      if (p === 'ollama') items.push({ label: 'Refresh the List', icon: RefreshCw, onClick: () => void refreshOllama() })
      else {
        items.push({ label: 'Other Model…', icon: Pencil, onClick: () => void promptCustomModel(id, p), disabled: running })
        if (keys[p]) {
          items.push({
            label: 'Load the Models of My Key',
            icon: RefreshCw,
            onClick: () =>
              void refreshRemoteModels(p).catch((e: unknown) => os.notify({ title: `Could not list the ${PROVIDERS[p].name} models`, body: errorText(e) })),
          })
        }
      }
      return items
    }
    const toolCount = availableTools().length
    const menus: MenuBarMenu[] = [
      {
        label: 'Chat',
        items: [
          { label: 'New Chat', icon: SquarePen, onClick: () => void newChat() },
          { label: 'Rename…', icon: Pencil, onClick: () => void promptRename({ id }) },
          { label: 'Delete…', icon: Trash2, danger: true, disabled: !hasMessages && !saved, onClick: () => void deleteChat({ id }) },
          '-',
          { label: 'Attach File…', icon: Paperclip, onClick: () => composerCommand(id, { type: 'attach' }) },
          { label: 'System Prompt…', icon: ScrollText, onClick: () => openDialog('system') },
          { label: 'Export as Markdown…', icon: FileDown, disabled: !hasMessages, onClick: () => void exportChat({ id }) },
          '-',
          { label: 'Stop the Reply', icon: Square, disabled: !running, onClick: () => stopRun(id) },
          { label: 'Write the Reply Again', icon: RefreshCw, disabled: running || !lastIsReply, onClick: () => regenerate(id) },
          '-',
          { label: 'Open the Chats Folder', icon: FolderOpen, onClick: openChatsFolder },
        ],
      },
      {
        label: 'Model',
        items: [
          ...PROVIDER_IDS.map((p): MenuItem => ({ label: PROVIDERS[p].label, checked: provider === p, submenu: providerMenu(p) })),
          '-',
          {
            label: 'Let the AI Act in KherveOS',
            icon: Wand2,
            checked: settings.act && supportsTools && toolCount > 0,
            disabled: !supportsTools || !toolCount,
            onClick: () => updateSettings({ act: !settings.act }),
          },
          {
            label: 'Let Local Models Think First (slower)',
            icon: Brain,
            checked: settings.think,
            onClick: () => updateSettings({ think: !settings.think }),
          },
        ],
      },
      {
        label: 'Settings',
        items: [
          { label: 'API Keys…', icon: KeyRound, onClick: () => openDialog('settings', provider === 'openai' ? 'openai' : 'anthropic') },
          { label: 'Ollama Address…', icon: Server, onClick: () => openDialog('settings', 'ollama') },
          '-',
          { label: 'Check Ollama Again', icon: RefreshCw, onClick: () => void refreshOllama() },
          { label: 'Open the Chats Folder', icon: FolderOpen, onClick: openChatsFolder },
        ],
      },
    ]
    win.setMenus(menus)
  }, [win, id, provider, model, running, saved, hasMessages, lastIsReply, settings, ollama, remote, keys, supportsTools])

  useEffect(() => () => win.setMenus(null), [win])

  // ------------------------------------------------------------- layout

  const toggleSidebar = () => (narrow ? setSideNarrow((o) => !o) : setSideWide((o) => !o))
  const picked = () => {
    if (narrow) setSideNarrow(false)
    if (chat) composerCommand(chat.id, { type: 'focus' })
  }

  return (
    <div
      ref={rootRef}
      className={`k-app kai-app${narrow ? ' narrow' : ''}${sideOpen ? ' side-open' : ''}${anyRunning ? ' busy' : ''}`}
    >
      <div className="kai-layout">
        {sideOpen && <Sidebar onPicked={picked} onClose={narrow ? () => setSideNarrow(false) : undefined} />}
        {narrow && sideOpen && <div className="kai-scrim" onClick={() => setSideNarrow(false)} />}
        {chat ? (
          <ChatView chat={chat} compact={mainWidth < COMPACT} onToggleSidebar={toggleSidebar} />
        ) : (
          <div className="kai-main" />
        )}
      </div>
      {dialog === 'settings' && <SettingsDialog onClose={() => openDialog(null)} />}
      {dialog === 'system' && chat && <SystemPromptDialog chat={chat} onClose={() => openDialog(null)} />}
    </div>
  )
}
