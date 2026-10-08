// Keyboard: browser key events in Qt's terms — the key code (Qt::Key) and
// modifiers the desktop's keyPressEvent handlers compare against, and the
// "Ctrl+Shift+S" text its QAction shortcuts are written in. On a Mac, Cmd
// plays Qt's Ctrl (as Qt itself maps it); Ctrl then is Qt's Meta.

export const MOD_SHIFT = 0x02000000
export const MOD_CTRL = 0x04000000
export const MOD_ALT = 0x08000000
export const MOD_META = 0x10000000

const NAMED: Record<string, [number, string]> = {
  Escape: [0x01000000, 'Esc'],
  Tab: [0x01000001, 'Tab'],
  Backspace: [0x01000003, 'Backspace'],
  Enter: [0x01000004, 'Return'],
  Insert: [0x01000006, 'Ins'],
  Delete: [0x01000007, 'Del'],
  Home: [0x01000010, 'Home'],
  End: [0x01000011, 'End'],
  ArrowLeft: [0x01000012, 'Left'],
  ArrowUp: [0x01000013, 'Up'],
  ArrowRight: [0x01000014, 'Right'],
  ArrowDown: [0x01000015, 'Down'],
  PageUp: [0x01000016, 'PgUp'],
  PageDown: [0x01000017, 'PgDown'],
  ' ': [0x20, 'Space'],
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export interface QtKey {
  key: number
  mods: number
  /** Qt's shortcut text, e.g. "Ctrl+Shift+S", or '' for a bare modifier. */
  text: string
  /** Other ways Qt may have written the same keys ("Ctrl+=" is "Ctrl++"). */
  alt: string[]
}

const PUNCT: Record<string, string> = {
  Quote: "'", Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Comma: ',', Period: '.', Slash: '/', Backquote: '`',
}

/** The Qt view of a keydown (pure: pass `mac` for tests). */
export function qtKey(e: { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }, mac = isMac): QtKey {
  const ctrl = mac ? e.metaKey : e.ctrlKey
  const meta = mac ? e.ctrlKey : e.metaKey
  let mods = 0
  if (e.shiftKey) mods |= MOD_SHIFT
  if (ctrl) mods |= MOD_CTRL
  if (e.altKey) mods |= MOD_ALT
  if (meta) mods |= MOD_META
  let key = 0
  let name = ''
  if (e.key === 'Tab' && e.shiftKey) {
    key = 0x01000002
    name = 'Backtab'
  } else if (NAMED[e.key]) {
    ;[key, name] = NAMED[e.key]
  } else if (/^F\d{1,2}$/.test(e.key)) {
    key = 0x01000030 + parseInt(e.key.slice(1), 10) - 1
    name = e.key
  } else if (e.code && /^Key[A-Z]$/.test(e.code)) {
    // the physical letter (Alt/Option on a Mac changes e.key)
    name = e.code.slice(3)
    key = name.charCodeAt(0)
  } else if (e.code && /^Digit\d$/.test(e.code)) {
    name = e.code.slice(5)
    key = name.charCodeAt(0)
  } else if (e.code && PUNCT[e.code]) {
    name = PUNCT[e.code]
    key = name.charCodeAt(0)
  } else if (e.key.length === 1) {
    name = e.key.toUpperCase()
    key = name.charCodeAt(0)
  } else return { key: 0, mods, text: '', alt: [] }
  const parts: string[] = []
  if (mods & MOD_META) parts.push('Meta')
  if (mods & MOD_CTRL) parts.push('Ctrl')
  if (mods & MOD_ALT) parts.push('Alt')
  // Shift is part of the character for punctuation ("Ctrl+'" vs "Ctrl+Shift+'")
  if (mods & MOD_SHIFT && name !== '+' && name !== 'Backtab') parts.push('Shift')
  parts.push(name)
  const text = parts.join('+')
  const alt: string[] = []
  // zoom: Qt's "Ctrl++" is typed Ctrl+= (with or without Shift)
  if (name === '=') alt.push(text.replace(/(\+Shift)?\+=$/, '++'))
  if (e.key === '+' && name !== '+') alt.push([...parts.slice(0, -1).filter((p) => p !== 'Shift'), '+'].join('+'))
  return { key, mods, text, alt }
}

/** How a Qt shortcut is shown in a KherveOS menu ("Ctrl+S" → "⌘S" on a Mac). */
export function showShortcut(sc: string | undefined, mac = isMac): string | undefined {
  if (!sc) return undefined
  if (!mac) return sc
  return sc
    .replace(/Meta\+/g, '⌃')
    .replace(/Ctrl\+/g, '⌘')
    .replace(/Alt\+/g, '⌥')
    .replace(/Shift\+/g, '⇧')
    .replace(/\bDel\b/, '⌦')
    .replace(/\bReturn\b/, '↩')
}
