// The Terminal app: an xterm.js view wired to a TerminalSession (the shell,
// the line editor and Python — see session.ts). This file only does the
// browser side: sizing, colours, keyboard shortcuts, clipboard and menus.

import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { ClipboardPaste, Copy, Eraser, ScanText } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import { os, type AppProps, type MenuBarMenu, type MenuItem } from '@/os'
import { useWindows } from '@/os/windows'
import { isDarkTheme, useResolvedTheme, useWindowTheme } from '@/os/themes'
import { TerminalSession } from './session'
import { monoFont, terminalTheme } from './theme'
import './terminal.css'

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const KEYS = IS_MAC
  ? { copy: '⌘C', paste: '⌘V', selectAll: '⌘A', clear: '⌘K' }
  : { copy: 'Ctrl+C', paste: 'Ctrl+V', selectAll: undefined, clear: 'Ctrl+L' }

function copySelection(term: XTerm): void {
  const text = term.getSelection()
  if (!text) return
  // navigator.clipboard only exists on https/localhost; fall back to the old way elsewhere.
  const viaTextArea = () => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
    } catch {
      // nothing else to try
    }
    ta.remove()
    term.focus()
  }
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(viaTextArea)
  else viaTextArea()
}

async function pasteClipboard(term: XTerm): Promise<void> {
  try {
    const text = await navigator.clipboard.readText()
    if (text) term.paste(text)
  } catch {
    os.notify({ title: 'Paste was blocked by the browser', body: `Press ${KEYS.paste} to paste into the terminal.` })
  }
  term.focus()
}

/** Run a menu action, then give the keyboard back to the terminal. */
const andFocus = (term: XTerm, fn: () => void) => () => {
  fn()
  term.focus()
}

/** Copy / Paste / Select All. The right-click menu has icons and greys out Copy without a selection. */
function clipboardItems(term: XTerm, contextMenu: boolean): MenuItem[] {
  return [
    {
      label: 'Copy',
      icon: contextMenu ? Copy : undefined,
      shortcut: KEYS.copy,
      disabled: contextMenu && !term.hasSelection(),
      onClick: andFocus(term, () => copySelection(term)),
    },
    { label: 'Paste', icon: contextMenu ? ClipboardPaste : undefined, shortcut: KEYS.paste, onClick: () => void pasteClipboard(term) },
    { label: 'Select All', icon: contextMenu ? ScanText : undefined, shortcut: KEYS.selectAll, onClick: andFocus(term, () => term.selectAll()) },
  ]
}

export default function Terminal({ win, args }: AppProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const sessionRef = useRef<TerminalSession | null>(null)
  // Only the folder the window was opened with matters; later args changes are ignored.
  const startPath = useRef(typeof args.path === 'string' ? args.path : undefined)
  const themeName = useResolvedTheme()
  // Set when the user keeps the Terminal light while the OS is dark.
  const windowTheme = useWindowTheme('terminal')
  const dark = !windowTheme && isDarkTheme(themeName)
  const themeKey = windowTheme ? JSON.stringify(windowTheme.style) : themeName
  const startDark = useRef(dark)
  const focused = useWindows((s) => s.focusedId === win.id)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const term = new XTerm({
      fontFamily: monoFont(),
      fontSize: 13,
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
      scrollOnEraseInDisplay: true,
      minimumContrastRatio: 3,
      drawBoldTextInBrightColors: false,
      macOptionIsMeta: false,
      allowTransparency: true,
      theme: terminalTheme(startDark.current, el),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    termRef.current = term

    // Fit to the window; skip while it is hidden (minimised windows are display:none).
    const refit = () => {
      if (el.clientWidth <= 0 || el.clientHeight <= 0) return
      try {
        fit.fit()
      } catch {
        // not measurable yet
      }
    }
    refit()
    let frame = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(refit)
    })
    ro.observe(el)

    const session = new TerminalSession(
      {
        write: (s) => term.write(s),
        cols: () => term.cols,
        rowsAboveCursor: () => {
          const buf = term.buffer.active
          const y = buf.baseY + buf.cursorY
          let n = 0
          while (n < y && buf.getLine(y - n)?.isWrapped) n++
          return n
        },
        afterWrite: (cb) => term.write('', cb),
        setTitle: (t) => win.setTitle(t),
        close: () => win.close(),
      },
      { winId: win.id, cwd: startPath.current },
    )
    sessionRef.current = session

    term.attachCustomKeyEventHandler((ev) => {
      const key = ev.key.toLowerCase()
      const ctrlOnly = ev.ctrlKey && !ev.altKey && !ev.metaKey
      // Ctrl+C copies when text is selected (Ctrl+Shift+C always does); otherwise it interrupts.
      if (ctrlOnly && key === 'c' && (ev.shiftKey || term.hasSelection())) {
        if (ev.type === 'keydown') {
          copySelection(term)
          term.clearSelection()
        }
        ev.preventDefault()
        return false
      }
      // Ctrl+V: let the browser paste into xterm's text area, which sends it as input.
      if (ctrlOnly && key === 'v') return false
      if (IS_MAC && ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        const action: Record<string, () => void> = {
          arrowleft: () => session.input('\x01'), // line start
          arrowright: () => session.input('\x05'), // line end
          backspace: () => session.input('\x15'), // delete to line start
          k: () => session.clearScreen(),
        }
        if (action[key]) {
          if (ev.type === 'keydown') action[key]()
          ev.preventDefault()
          return false
        }
      }
      return true
    })
    const subscriptions = [term.onData((data) => session.input(data)), term.onResize(() => session.resized())]

    const menus: MenuBarMenu[] = [
      {
        label: 'Shell',
        items: [
          { label: 'New Window', onClick: () => void os.open('terminal', { _new: Date.now() }) },
          '-',
          { label: 'Clear', shortcut: KEYS.clear, onClick: andFocus(term, () => session.clearScreen()) },
          { label: 'Restart Python', onClick: andFocus(term, () => session.restartPython()) },
          '-',
          { label: 'Close Window', onClick: () => win.close() },
        ],
      },
      { label: 'Edit', items: clipboardItems(term, false) },
    ]
    win.setMenus(menus)

    session.start()
    term.focus()

    return () => {
      ro.disconnect()
      cancelAnimationFrame(frame)
      subscriptions.forEach((s) => s.dispose())
      win.setMenus(null)
      session.dispose()
      term.dispose()
      termRef.current = null
      sessionRef.current = null
    }
  }, [win])

  // Follow the theme. The desktop applies the new CSS variables in an effect
  // that runs after this one, so read them on the next frame.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const term = termRef.current
      const el = hostRef.current
      if (term && el) term.options.theme = terminalTheme(dark, el)
    })
    return () => cancelAnimationFrame(frame)
  }, [themeKey, dark])

  // Typing goes to the terminal whenever its window comes to the front.
  useEffect(() => {
    if (focused) termRef.current?.focus()
  }, [focused])

  const onContextMenu = (e: ReactMouseEvent) => {
    const term = termRef.current
    const session = sessionRef.current
    if (!term || !session) return
    e.preventDefault()
    os.contextMenu(e, [
      ...clipboardItems(term, true),
      '-',
      { label: 'Clear', icon: Eraser, shortcut: KEYS.clear, onClick: andFocus(term, () => session.clearScreen()) },
    ])
  }

  const onPaddingDown = (e: ReactMouseEvent) => {
    if (e.target !== e.currentTarget) return
    e.preventDefault()
    termRef.current?.focus()
  }

  return (
    <div className="k-app term-app" onContextMenu={onContextMenu}>
      <div className="term-wrap" onMouseDown={onPaddingDown}>
        <div ref={hostRef} className="term-host" />
      </div>
    </div>
  )
}
