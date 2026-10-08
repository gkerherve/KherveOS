// Chat > Export as Markdown, and opening the chats folder.

import { HOME, fs, os, path as vpath } from '@/os'
import { chatToMarkdown } from './history'
import { CHATS_DIR, readChatFile, useAi } from './store'
import type { Chat } from './types'
import { errorText } from './util'

function safeName(s: string): string {
  return s.replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 80).trim() || 'Chat'
}

/** Save a chat (open, or just a file in the list) as a Markdown document. */
export async function exportChat(target: { id?: string; path?: string }): Promise<void> {
  let chat: Chat | undefined = target.id ? useAi.getState().chats[target.id] : undefined
  try {
    if (!chat && target.path) chat = await readChatFile(target.path)
  } catch (e) {
    await os.dialog.alert(`Could not read the chat.\n\n${errorText(e)}`, { title: 'kAI' })
    return
  }
  if (!chat?.messages.length) {
    await os.dialog.alert('This chat has no messages yet.', { title: 'Export as Markdown' })
    return
  }
  const dir = `${HOME}/Documents`
  const name = `${safeName(chat.title)}.md`
  const target2 = await os.dialog.saveFile({
    title: 'Export chat as Markdown',
    startDir: dir,
    defaultName: vpath.join(dir, fs.isDir(dir) ? fs.uniqueName(dir, name) : name),
    extensions: ['.md'],
  })
  if (!target2) return
  try {
    await fs.writeText(target2, chatToMarkdown(chat.title, chat.messages), { mkdirs: true })
    os.notify({ title: `Exported ${vpath.basename(target2)}`, body: 'Click to open it', onClick: () => void os.openFile(target2) })
  } catch (e) {
    await os.dialog.alert(`The file could not be saved.\n\n${errorText(e)}`, { title: 'kAI' })
  }
}

export function openChatsFolder() {
  os.open('files', { path: fs.isDir(CHATS_DIR) ? CHATS_DIR : `${HOME}/Documents` })
}
