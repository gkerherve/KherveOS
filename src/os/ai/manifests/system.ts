// AI tools of Terminal, Viewer, Settings and KherveAI (see ../appManifest.ts for how app tools work).

import type { AppToolSet } from '../appToolsCore.ts'
import { bool, int, num, object, oneOf, str } from './schema.ts'
import { TERMINAL_VIEWER_TOOL_SETS } from './terminalViewer.ts'

/** Settings' sections (src/apps/settings/Settings.tsx). */
export const SETTINGS_SECTIONS = ['appearance', 'storage', 'server', 'ai', 'python', 'about'] as const

// Settings: the appearance preferences (src/os/settings.ts), code in src/apps/settings/aiTools.ts.
// Nothing that resets the drive or signs out is offered.
const SETTINGS_TOOLS: AppToolSet = {
  app: 'settings',
  name: 'Settings',
  summary: 'KherveOS preferences: interface size, Dock magnification, wallpaper, desktop icons, light or dark apps.',
  keywords: [
    'settings', 'preferences', 'appearance', 'dark mode', 'light mode', 'wallpaper', 'dock', 'magnification', 'interface size',
    'display scaling', 'desktop icons', 'hidden files',
  ],
  tools: [
    {
      action: 'get_settings',
      description:
        'Read the KherveOS appearance settings: interface size, Dock magnification, wallpaper fit and visibility, desktop icons, hidden files, and which apps are light (all others are dark).',
      inputSchema: object({}),
      readOnly: true,
    },
    {
      action: 'set_appearance',
      description: 'Change KherveOS appearance settings (give only those to change). Returns the new values. The user can change them back in Settings.',
      inputSchema: object({
        ui_scale: num('Interface size: 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75 or 2 (1 = 100%; percentages like 125 also work).'),
        dock_magnification: int('How big a Dock icon grows under the pointer, in px: 48 (off) to 192 (maximum).'),
        wallpaper_fit: oneOf(['fill', 'fit', 'centre'], 'fill: cover the screen; fit: show the whole picture; centre: its own size in the middle.'),
        wallpaper_visibility: int('How strongly the wallpaper shows, in percent: 10 to 100.'),
        desktop_icons: bool('Show app shortcuts on the desktop.'),
        show_hidden_files: bool('Show files whose names start with "." in Files.'),
      }),
    },
    {
      action: 'set_app_mode',
      description: 'Make an app light or dark (KherveOS is dark; light apps open in white and green). app: an app id or name, or "all" for every app.',
      inputSchema: object(
        {
          app: str('The app id or name, e.g. "khervesheet" or "kSheet", or "all".'),
          mode: oneOf(['light', 'dark'], 'light or dark.'),
        },
        ['app', 'mode'],
      ),
    },
    {
      action: 'open_section',
      description: `Show a section of the Settings app: ${SETTINGS_SECTIONS.join(', ')} ("server" is Server & account, "ai" is AI & MCP).`,
      inputSchema: object({ section: oneOf(SETTINGS_SECTIONS, 'The section to show.') }, ['section']),
    },
  ],
}

// KherveAI: its chats (src/apps/kherveai/store.ts), code in src/apps/kherveai/aiTools.ts.
const KHERVEAI_TOOLS: AppToolSet = {
  app: 'kherveai',
  name: 'kAI',
  summary: 'the AI chat app (Ollama, Claude, ChatGPT); start a chat in it or list saved chats.',
  keywords: ['kherveai', 'ai chat', 'ai chats', 'chat history'],
  tools: [
    {
      action: 'new_chat',
      description: 'Start a new chat in kAI with a prompt typed in; it is sent to the chat\'s model only if "send" is true (else the user sends it).',
      inputSchema: object({ prompt: str('The message to type in the new chat.'), send: bool('Send it at once (default false: only typed in).') }, ['prompt']),
    },
    {
      action: 'list_chats',
      description: 'List the saved kAI chats (newest first) with their titles, paths and when they last changed.',
      inputSchema: object({ query: str('Only chats whose title contains this.'), limit: int('At most this many (default 20).') }),
      readOnly: true,
    },
  ],
}

export const SYSTEM_TOOL_SETS: AppToolSet[] = [SETTINGS_TOOLS, KHERVEAI_TOOLS, ...TERMINAL_VIEWER_TOOL_SETS]
