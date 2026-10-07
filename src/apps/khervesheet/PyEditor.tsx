// The desktop's Python editing, 1:1 (khervesheet/python_engine.py and the
// formula bar in sheet.py):
//  - PythonHighlighter's colours (keywords, numbers, strings, comments),
//  - the "PY" badge (two-tone Python blue over yellow) with the loop period,
//  - the loop period menu, Play and Stop (sheet._on_loop_period / play / stop),
//  - PythonCellDialog, the larger editor the formula bar's pop-out button
//    opens: a non-modal window with a toolbar (Run, ks(), Pick, Snippets,
//    Comment, Period, Play/Stop, Help), the hint line, the code editor
//    (_DialogCodeEditor: line numbers, current line, error line, Tab and
//    Shift+Tab, Ctrl+/ and Ctrl+Space autocomplete, Ctrl+Enter runs) over the
//    output pane, and Close.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { os, type MenuItem } from '@/os'
import type { Book } from './book'
import { FloatWin } from './dialogs'
import { fmtLoopPeriod, PY_BLUE, PY_YELLOW } from './draw'
import { Ico } from './icons'
import { a1 } from './model'
import { errorLineFrom, pyTokens } from './pytext'

// ------------------------------------------------------------ highlighting

const TOK_CLASS = ['', 'kpy-kw', 'kpy-num', 'kpy-str', 'kpy-com']

/** One line, coloured like the desktop's PythonHighlighter (later rules win, per line). */
function highlightLine(line: string, key: number): ReactNode {
  const parts = pyTokens(line).map((t, i) => (t.kind ? <span key={i} className={TOK_CLASS[t.kind]}>{t.text}</span> : t.text))
  return <div key={key} className="kpy-line">{parts.length ? parts : '\u200b'}</div>
}

/** The coloured copy of the code shown under a transparent textarea. */
export function Highlight({ code, innerRef, className = '' }: { code: string; innerRef?: React.Ref<HTMLPreElement>; className?: string }) {
  const lines = useMemo(() => code.split('\n').map(highlightLine), [code])
  return (
    <pre className={`kpy-hl ${className}`} ref={innerRef} aria-hidden>
      {lines}
    </pre>
  )
}

// ---------------------------------------------------------------- the badge

/** The desktop's PyBadge: two-tone, raised, "PY" with two eyes, or the loop period. */
export function PyBadge({ loop, className }: { loop: number | null; className?: string }) {
  return (
    <span className={`kpy-badge${loop ? ' loop' : ''} ${className ?? ''}`} title={loop ? `Python loop: every ${fmtLoopPeriod(loop)}` : 'Python cell'} aria-hidden>
      <span className="kpy-badge-top" style={{ background: PY_BLUE }} />
      <span className="kpy-badge-bot" style={{ background: PY_YELLOW }} />
      {loop ? (
        <>
          <b className="kpy-badge-py up">PY</b>
          <span className="kpy-badge-loop">
            <svg width="9" height="9" viewBox="0 0 10 10">
              <path d="M3.2 1.4 A4 4 0 1 0 6.8 1.4" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
              <path d="M2 0 L4.6 1.2 L2.4 3.2 Z" fill="#fff" />
            </svg>
            <i>{fmtLoopPeriod(loop)}</i>
          </span>
        </>
      ) : (
        <>
          <span className="kpy-eye a" />
          <span className="kpy-eye b" />
          <b className="kpy-badge-py">PY</b>
        </>
      )}
    </span>
  )
}

// ------------------------------------------------------------------ loops

/** The period button's menu (sheet._on_loop_period): presets, checked, and Custom…. */
export function loopPeriodMenu(book: Book, sheetId: string, r: number, c: number, at: { clientX: number; clientY: number }) {
  const sh = book.sheet(sheetId)
  const saved = book.savedLoop(sh, r, c)
  const presets: [string, number][] = [
    ['0.1 s', 0.1], ['0.2 s', 0.2], ['0.5 s', 0.5], ['1 s', 1], ['2 s', 2], ['5 s', 5], ['10 s', 10],
    ['30 s', 30], ['1 min', 60], ['5 min', 300], ['15 min', 900],
  ]
  const items: MenuItem[] = presets.map(([label, secs]) => ({
    label,
    checked: saved !== null && Math.abs(saved - secs) < 0.01,
    onClick: () => book.saveLoopPeriod(sh, r, c, secs),
  }))
  items.push('-', {
    label: 'Custom…',
    onClick: () => void customLoop(book, sheetId, r, c, (secs) => book.saveLoopPeriod(sh, r, c, secs)),
  })
  os.contextMenu(at, items)
}

/** "Re-run this cell every (seconds):" (QInputDialog.getDouble, 0.1 to 86400). */
export async function customLoop(book: Book, sheetId: string, r: number, c: number, done: (secs: number) => void) {
  const sh = book.sheet(sheetId)
  const cur = book.savedLoop(sh, r, c) ?? 1
  const v = await os.dialog.prompt('Re-run this cell every (seconds):', { title: 'Python loop', defaultValue: String(cur) })
  if (v === null) return
  const n = Number(v.replace(',', '.'))
  if (!Number.isFinite(n) || n < 0.1 || n > 86400) {
    book.showFlash('Type a number of seconds between 0.1 and 86400.')
    return
  }
  done(Math.round(n * 10) / 10)
}

/** The cell menu's "Python loop (auto-refresh)" submenu (sheet._cell_menu). */
export function loopSubmenu(book: Book, sheetId: string, r: number, c: number): MenuItem {
  const sh = book.sheet(sheetId)
  const current = book.loopOf(sh, r, c) ?? 0
  const presets: [string, number][] = [
    ['Off', 0], ['0.1 second', 0.1], ['0.5 second', 0.5], ['1 second', 1], ['5 seconds', 5], ['10 seconds', 10],
    ['30 seconds', 30], ['1 minute', 60], ['5 minutes', 300], ['15 minutes', 900],
  ]
  return {
    label: 'Python loop (auto-refresh)',
    submenu: [
      ...presets.map(([label, secs]): MenuItem => ({ label, checked: current === secs, onClick: () => book.setPyLoop(sh, r, c, secs || null) })),
      '-',
      { label: 'Custom…', onClick: () => void customLoop(book, sheetId, r, c, (secs) => book.setPyLoop(sh, r, c, secs)) },
    ],
  }
}

// ------------------------------------------------------------------- help

/** The desktop's "Python in KherveSheet" help (python_engine.PYTHON_HELP_HTML). */
export const PYTHON_HELP_HTML = `
<h2>Python in KherveSheet</h2>
<p>A cell can run real Python instead of an Excel formula. Type <code>=PY</code> in a cell (or use <b>Insert &rarr; Python Cell</b>) and the
formula bar turns into a multi-line code editor. Press <b>Ctrl+Enter</b> to run (plain Enter adds a new line).</p>
<p>The cell's value is the value of the <b>last line</b>, if that line is an expression &mdash; just like Excel's Python. Assignments,
<code>import</code>s and <code>def</code>s produce no output on their own.</p>
<h3>Reading the grid with <code>ks()</code></h3>
<p>Use <code>ks("...")</code> to pull cell values into your code (<code>xl()</code> and <code>cell()</code> are aliases):</p>
<table><tr><th><code>ks("A1")</code></th><td>the value in A1</td></tr>
<tr><th><code>ks("A1:A10")</code></th><td>a 1-D NumPy array</td></tr>
<tr><th><code>ks("A1:C5")</code></th><td>a 2-D NumPy array</td></tr>
<tr><th><code>ks("Sheet2!B2")</code></th><td>a value from another sheet</td></tr></table>
<h3>Writing back with <code>ks_set()</code></h3>
<p>Push values from Python into any cell or range (<code>write()</code> is an alias):</p>
<table><tr><th><code>ks_set("C1", 42)</code></th><td>write a scalar into C1</td></tr>
<tr><th><code>ks_set("D1:D50", arr)</code></th><td>write a 1-D array down a column</td></tr>
<tr><th><code>ks_set("A1:C3", matrix)</code></th><td>write a 2-D array into a block</td></tr></table>
<p>The cell running the code is never overwritten. A scalar fills the whole range; a list/array fills row-by-row.</p>
<h3>Embedding images with <code>ks_image()</code></h3>
<p>Return an image to embed it next to the cell, just like a plot:</p>
<pre>=PY
ks_image("https://example.com/photo.jpg")</pre>
<p>Accepts a URL, local file path, raw bytes, a PIL image, or a NumPy H&times;W&times;3 uint8 array.</p>
<h3>What a cell can output</h3>
<ul>
<li><b>A number or text</b> &mdash; shown directly in the cell.</li>
<li><b>A list</b> &mdash; spills into the cell and the cells below/right.</li>
<li><b>A NumPy array / DataFrame / any object</b> &mdash; kept <i>live in the cell</i> (shown as a badge like <code>&#9646; ndarray(100,)</code>)
and reused elsewhere with <code>ks("C1")</code>. To spill an array instead, end with <code>list(my_array)</code> or <code>my_array.tolist()</code>.</li>
<li><b>A matplotlib figure</b> &mdash; embedded as a picture next to the cell.</li>
<li><b>An image</b> (via <code>ks_image()</code> or a PIL image) &mdash; embedded as a picture next to the cell.</li>
</ul>
<h3>Shared namespace &amp; UDFs</h3>
<p>All Python cells in a workbook share one namespace, so a function defined in one cell is callable from any other:</p>
<pre>=PY
def celsius_to_f(c):
    return c * 9 / 5 + 32</pre>
<pre>=PY
celsius_to_f(ks("A1"))</pre>
<p><b>User-defined functions (UDFs):</b> Any function you <code>def</code> in a <code>=PY</code> cell can also be called from an ordinary formula.
For example, after defining <code>celsius_to_f</code> above, you can write <code>=CELSIUS_TO_F(A1)</code> in any cell &mdash; case-insensitive,
and built-in functions are never overridden.</p>
<h3>Python loop (auto-refresh)</h3>
<p>Right-click a <code>=PY</code> cell &rarr; <b>Python loop</b> to re-run it on an interval (0.1&nbsp;s, 1&nbsp;s, 5&nbsp;s, 30&nbsp;s, &hellip; up to
24&nbsp;hours, or a custom value). The PY badge shows a refresh icon and the period. This is handy for live data, clocks, animations, or polling.</p>
<h3>Examples &mdash; calculations</h3>
<pre>=PY
import numpy as np
np.mean(ks("A1:A10"))            # average of a column</pre>
<pre>=PY
[x ** 2 for x in range(1, 6)]    # spills 1, 4, 9, 16, 25</pre>
<pre>=PY
import numpy as np
np.linspace(0, 1, 100)           # stored as an object in the cell</pre>
<h3>Examples &mdash; write back</h3>
<pre>=PY
import numpy as np
ks_set("D1:D50", np.cumsum(ks("A1:A50")))
"written"</pre>
<h3>Examples &mdash; matplotlib plots</h3>
<p>Build a figure and return it (or just create one &mdash; KherveSheet captures the current figure automatically).</p>
<p><b>Simple line plot of a column</b></p>
<pre>=PY
import matplotlib.pyplot as plt
plt.plot(ks("A1:A20"))
plt.title("My data")
plt.gcf()</pre>
<p><b>X vs Y with labels and a grid</b></p>
<pre>=PY
import matplotlib.pyplot as plt
x = ks("A2:A50")
y = ks("B2:B50")
fig, ax = plt.subplots()
ax.plot(x, y, "o-", color="#4472C4")
ax.set_xlabel("Time (s)")
ax.set_ylabel("Signal (V)")
ax.grid(True)
fig</pre>
<p><b>Histogram</b></p>
<pre>=PY
import matplotlib.pyplot as plt
plt.hist(ks("A1:A200"), bins=30, color="#E07B39")
plt.gcf()</pre>
<p><b>Curve from a formula</b></p>
<pre>=PY
import numpy as np, matplotlib.pyplot as plt
x = np.linspace(0, 2 * np.pi, 200)
plt.plot(x, np.sin(x), label="sin")
plt.plot(x, np.cos(x), label="cos")
plt.legend()
plt.gcf()</pre>
<p><b>Bar chart from two columns</b></p>
<pre>=PY
import matplotlib.pyplot as plt
labels = [str(v) for v in ks("A1:A6")]
plt.bar(labels, ks("B1:B6"))
plt.gcf()</pre>
<h3>Good to know</h3>
<ul>
<li>Editing a cell that <code>ks()</code> reads re-runs dependent Python cells automatically.</li>
<li><code>print()</code> output is captured and shown in the cell tooltip (hover the cell to see it).</li>
<li>Errors show <code>#PYERR</code> &mdash; hover the cell for the message.</li>
<li>Each cell has a <b>30-second timeout</b>. An infinite loop is automatically stopped; you will see a <code>TimeoutError</code>.</li>
<li>Code is saved in the <code>.ksheet</code> file. Reopening a file with Python cells asks for permission before running it.</li>
<li>Ready to use: <code>math</code>, <code>numpy as np</code>, <code>matplotlib.pyplot as plt</code>, and <code>pandas as pd</code> /
<code>scipy</code>. You can <code>import</code> other pure-Python packages; they load the first time.</li>
<li>Click the pop-out button next to the PY badge for a larger editor with line numbers, autocomplete (Ctrl+Space), comment toggle (Ctrl+/),
and a <b>Pick cell</b> button to click-insert <code>ks("&hellip;")</code> references.</li>
<li>KherveAI can also write Python cells for you &mdash; just ask it to "write a Python cell that&hellip;".</li>
</ul>
`

export function showPythonHelp(book: Book) {
  void os.dialog
    .alert(<div className="ks-doc kpy-help" dangerouslySetInnerHTML={{ __html: PYTHON_HELP_HTML }} />, { title: 'Python in KherveSheet' })
    .finally(() => book.refocus())
}

// --------------------------------------------------------------- snippets

/** Ready-to-paste snippets offered by the dialog's Snippets menu (PY_SNIPPETS). */
export const PY_SNIPPETS: [string, string][] = [
  ['Imports (numpy, matplotlib)', 'import numpy as np\nimport matplotlib.pyplot as plt\n'],
  ['Plot a column', 'import matplotlib.pyplot as plt\ny = ks("A1:A50")\nplt.plot(y)\nplt.gcf()'],
  ['X–Y plot', 'import matplotlib.pyplot as plt\nx = ks("A2:A50")\ny = ks("B2:B50")\nplt.plot(x, y, "o-")\nplt.xlabel("x"); plt.ylabel("y"); plt.grid(True)\nplt.gcf()'],
  ['Histogram', 'import matplotlib.pyplot as plt\nplt.hist(ks("A1:A200"), bins=30)\nplt.gcf()'],
  ['Linear fit (slope, intercept)', 'import numpy as np\nx = ks("A2:A50"); y = ks("B2:B50")\nm, b = np.polyfit(x, y, 1)\n[float(m), float(b)]'],
  [
    'Gaussian fit',
    'import numpy as np\nfrom scipy.optimize import curve_fit\ndef g(x, A, mu, s): return A*np.exp(-(x-mu)**2/(2*s*s))\nx = ks("A2:A100"); y = ks("B2:B100")\npopt, _ = curve_fit(g, x, y, p0=[y.max(), x.mean(), 1])\npopt.tolist()',
  ],
  ['FFT magnitude spectrum', 'import numpy as np, matplotlib.pyplot as plt\ny = ks("B2:B514")\nmag = np.abs(np.fft.rfft(y))\nplt.plot(mag); plt.xlabel("bin"); plt.ylabel("|FFT|")\nplt.gcf()'],
  ['Define a helper function', 'def my_func(x):\n    return x * 2\n'],
  ['Write back to the grid (ks_set)', 'import numpy as np\nks_set("D1:D50", np.cumsum(ks("A1:A50")))\n"written"'],
  ['Embed an image (ks_image)', 'ks_image("https://example.com/photo.jpg")'],
  ['Live clock (use with Python loop)', 'import datetime\ndatetime.datetime.now().strftime("%H:%M:%S")'],
]

// ------------------------------------------------------- text-area helpers

/** Replace [start, end) with text, keeping the browser's own undo. */
export function replaceRange(el: HTMLTextAreaElement, start: number, end: number, text: string, caret = start + text.length, selEnd = caret) {
  el.focus()
  el.setSelectionRange(start, end)
  let done = false
  try {
    done = document.execCommand('insertText', false, text)
  } catch {
    done = false
  }
  if (!done) {
    el.setRangeText(text, start, end, 'end')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  el.setSelectionRange(caret, selEnd)
}

/** Apply fn to every line the selection touches (or the caret's line), as one edit. */
function perLine(el: HTMLTextAreaElement, fn: (line: string) => string) {
  const v = el.value
  const s = el.selectionStart
  const e = el.selectionEnd
  const a = v.lastIndexOf('\n', s - 1) + 1
  let b = v.indexOf('\n', e > s && v[e - 1] === '\n' ? e - 1 : e)
  if (b < 0) b = v.length
  const lines = v.slice(a, b).split('\n')
  const out = lines.map(fn).join('\n')
  const single = s === e
  replaceRange(el, a, b, out, single ? Math.max(a, s + (out.length - (b - a))) : a, single ? undefined : a + out.length)
}

export function indentSelection(el: HTMLTextAreaElement) {
  perLine(el, (ln) => '    ' + ln)
}

export function dedentSelection(el: HTMLTextAreaElement) {
  perLine(el, (ln) => {
    for (const pre of ['    ', '\t', ' ', '  ', '   ']) if (ln.startsWith(pre)) return ln.slice(pre.length)
    return ln
  })
}

/** Ctrl+/ (toggle_comment): comment the lines unless all of them already are. */
export function toggleComment(el: HTMLTextAreaElement) {
  const v = el.value
  const a = v.lastIndexOf('\n', el.selectionStart - 1) + 1
  let b = v.indexOf('\n', el.selectionEnd)
  if (b < 0) b = v.length
  const lines = v.slice(a, b).split('\n')
  const nonEmpty = lines.filter((l) => l.trim())
  const all = nonEmpty.length > 0 && nonEmpty.every((l) => l.trimStart().startsWith('#'))
  perLine(el, all ? (ln) => (ln.includes('# ') ? ln.replace('# ', '') : ln.includes('#') ? ln.replace('#', '') : ln) : (ln) => (ln.trim() ? '# ' + ln : ln))
}

// ------------------------------------------------------------ autocomplete

const COMPLETE_KEYWORDS = (
  'import from as def class return if elif else for while in is and or ' +
  'not with try except finally raise lambda yield None True False print ' +
  'range len sum min max abs round int float str list dict tuple set ' +
  'enumerate zip sorted reversed'
).split(' ')
const COMPLETE_HINTS = [
  'ks', 'ks_set', 'ks_image', 'write', 'np', 'plt', 'pd', 'np.array', 'np.linspace', 'np.arange', 'np.zeros', 'np.ones', 'np.mean', 'np.sum',
  'np.std', 'np.polyfit', 'np.gradient', 'plt.plot', 'plt.scatter', 'plt.bar', 'plt.hist', 'plt.gcf', 'plt.xlabel', 'plt.ylabel', 'plt.title',
  'plt.legend',
]

/** The word under the caret (QTextCursor.WordUnderCursor, before the caret). */
function wordBefore(text: string, caret: number): { start: number; word: string } {
  let i = caret
  while (i > 0 && /\w/.test(text[i - 1])) i--
  let j = caret
  while (j < text.length && /\w/.test(text[j])) j++
  return { start: i, word: text.slice(i, j) }
}

// ---------------------------------------------------------- the code editor

interface Completion {
  items: string[]
  index: number
  start: number
  end: number
}

/**
 * The pop-out's code editor (_DialogCodeEditor): monospace, no wrapping,
 * line numbers, the current line and an error line highlighted, Tab / Shift+Tab,
 * Ctrl+/, Ctrl+Space and typing autocomplete, Ctrl+Enter runs.
 */
function CodeEditor({
  value, onChange, onRun, errorLine, names, taRef,
}: {
  value: string
  onChange: (v: string) => void
  onRun: () => void
  errorLine: number | null
  names: string[]
  taRef: React.RefObject<HTMLTextAreaElement | null>
}) {
  const hlRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const [caretLine, setCaretLine] = useState(0)
  const [scroll, setScroll] = useState({ x: 0, y: 0 })
  const [comp, setComp] = useState<Completion | null>(null)
  const [metrics, setMetrics] = useState({ ch: 8, lh: 18 })
  const lines = value.split('\n').length
  const digits = Math.max(2, String(Math.max(1, lines)).length)
  const gutter = Math.round(10 + metrics.ch * digits)

  useLayoutEffect(() => {
    const pre = hlRef.current
    if (!pre) return
    const probe = document.createElement('span')
    probe.textContent = 'MMMMMMMMMM'
    probe.style.visibility = 'hidden'
    pre.appendChild(probe)
    const ch = probe.getBoundingClientRect().width / 10
    pre.removeChild(probe)
    const lh = parseFloat(getComputedStyle(pre).lineHeight) || 18
    if (ch > 0) setMetrics({ ch, lh })
  }, [])

  const syncCaret = () => {
    const el = taRef.current
    if (!el) return
    setCaretLine(el.value.slice(0, el.selectionStart).split('\n').length - 1)
  }
  const onScroll = () => {
    const el = taRef.current
    if (!el) return
    setScroll({ x: el.scrollLeft, y: el.scrollTop })
    setComp(null)
  }
  useLayoutEffect(() => {
    if (hlRef.current) hlRef.current.style.transform = `translate(${-scroll.x}px, ${-scroll.y}px)`
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-scroll.y}px)`
    if (layerRef.current) layerRef.current.style.transform = `translateY(${-scroll.y}px)`
  }, [scroll])

  // Show the error line (scroll to it, as mark_error_line does).
  useEffect(() => {
    const el = taRef.current
    if (!el || !errorLine) return
    const idx = value.split('\n').slice(0, errorLine - 1).join('\n').length + (errorLine > 1 ? 1 : 0)
    el.setSelectionRange(idx, idx)
    syncCaret()
    const top = (errorLine - 1) * metrics.lh
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - metrics.lh) el.scrollTop = Math.max(0, top - el.clientHeight / 2)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorLine])

  const candidates = () => {
    const words = new Set<string>([...COMPLETE_KEYWORDS, ...COMPLETE_HINTS, ...names.filter((n) => !n.startsWith('_'))])
    for (const m of value.matchAll(/[A-Za-z_]\w{2,}/g)) words.add(m[0])
    return [...words].sort()
  }
  const showCompletions = (auto: boolean) => {
    const el = taRef.current
    if (!el) return
    const { start, word } = wordBefore(el.value, el.selectionStart)
    if (auto && word.length < 2) return setComp(null)
    const pre = word.toLowerCase()
    const items = candidates().filter((w) => w.toLowerCase().startsWith(pre) && w !== word)
    if (!items.length) return setComp(null)
    let end = el.selectionStart
    while (end < el.value.length && /\w/.test(el.value[end])) end++
    setComp({ items: items.slice(0, 200), index: 0, start, end })
  }
  const accept = (text: string) => {
    const el = taRef.current
    if (!el || !comp) return
    replaceRange(el, comp.start, comp.end, text)
    setComp(null)
    syncCaret()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // (the dialog keeps the keys from the grid's shortcuts)
    const el = e.currentTarget
    const mod = e.ctrlKey || e.metaKey
    if (comp) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const d = e.key === 'ArrowDown' ? 1 : -1
        setComp({ ...comp, index: (comp.index + d + comp.items.length) % comp.items.length })
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        accept(comp.items[comp.index])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setComp(null)
        return
      }
    }
    if (e.key === 'Enter' && mod) {
      e.preventDefault()
      setComp(null)
      onRun()
      return
    }
    if (e.key === ' ' && e.ctrlKey) {
      e.preventDefault()
      showCompletions(false)
      return
    }
    if (e.key === '/' && mod) {
      e.preventDefault()
      toggleComment(el)
      syncCaret()
      return
    }
    if (e.key === 'Tab' && !e.shiftKey && !mod && !e.altKey) {
      e.preventDefault()
      const sel = el.value.slice(el.selectionStart, el.selectionEnd)
      if (sel.includes('\n')) indentSelection(el)
      else replaceRange(el, el.selectionStart, el.selectionEnd, '    ')
      return
    }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      dedentSelection(el)
      return
    }
  }

  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const ev = e.nativeEvent as InputEvent
    const ch = ev.data ?? ''
    if (ev.inputType === 'insertText' && ch.length === 1 && /[\w.]/.test(ch)) {
      requestAnimationFrame(() => {
        const el = taRef.current
        if (!el) return
        const { word } = wordBefore(el.value, el.selectionStart)
        if (word.length >= 2) showCompletions(true)
        else setComp(null)
      })
    } else if (ev.inputType?.startsWith('delete')) setComp(null)
  }

  const caretPos = () => {
    const el = taRef.current
    if (!el || !comp) return { left: 0, top: 0 }
    const before = el.value.slice(0, comp.start)
    const line = before.split('\n').length - 1
    const col = before.length - before.lastIndexOf('\n') - 1
    return { left: 4 + col * metrics.ch - scroll.x, top: (line + 1) * metrics.lh + 2 - scroll.y }
  }

  return (
    <div className="kpy-editor" style={{ ['--kpy-gutter' as string]: `${gutter}px` }}>
      <div className="kpy-gutter">
        <div ref={gutterRef}>
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className="kpy-ln">{i + 1}</div>
          ))}
        </div>
      </div>
      <div className="kpy-code">
        <div className="kpy-lines" ref={layerRef}>
          <div className="kpy-cur" style={{ top: caretLine * metrics.lh, height: metrics.lh }} />
          {errorLine && <div className="kpy-err" style={{ top: (errorLine - 1) * metrics.lh, height: metrics.lh }} />}
        </div>
        <Highlight code={value} innerRef={hlRef} />
        <textarea
          ref={taRef}
          className="kpy-ta"
          value={value}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Python code"
          onChange={(e) => {
            onChange(e.target.value)
            syncCaret()
          }}
          onInput={onInput}
          onSelect={syncCaret}
          onClick={() => setComp(null)}
          onKeyDown={onKeyDown}
          onKeyUp={syncCaret}
          onScroll={onScroll}
          onBlur={() => setTimeout(() => setComp(null), 150)}
          onCopy={(e) => e.stopPropagation()}
          onCut={(e) => e.stopPropagation()}
          onPaste={(e) => e.stopPropagation()}
        />
        {comp && (
          <div className="kpy-complete" style={caretPos()} role="listbox">
            {comp.items.map((w, i) => (
              <div
                key={w}
                role="option"
                aria-selected={i === comp.index}
                className={i === comp.index ? 'on' : ''}
                ref={i === comp.index ? (n) => n?.scrollIntoView?.({ block: 'nearest' }) : undefined}
                onMouseDown={(e) => {
                  e.preventDefault()
                  accept(w)
                }}
              >
                {w}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// -------------------------------------------------- PythonCellDialog (pop-out)

export interface PyDialogTarget {
  sheet: string
  r: number
  c: number
  code: string
}

export { errorLineFrom }

/**
 * The pop-out editor for one =PY cell (PythonCellDialog): non-modal, so the
 * grid stays usable (Pick a cell, watch plots appear). Run applies the code
 * to the cell and shows the result, printed output and errors below.
 */
export function PythonCellDialog({ book, target, root, onClose }: { book: Book; target: PyDialogTarget; root: HTMLElement | null; onClose: () => void }) {
  useStore(book.store, (s) => s.version)
  const picking = useStore(book.store, (s) => s.picking)
  const sh = book.sheet(target.sheet)
  const { r, c } = target
  const ref = a1(r, c)
  const [code, setCode] = useState(target.code)
  const [output, setOutput] = useState<{ text: string; err: boolean } | null>(null)
  const [errorLine, setErrorLine] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [names, setNames] = useState<string[]>([])
  const ta = useRef<HTMLTextAreaElement>(null)
  const loopActive = book.loopOf(sh, r, c) !== null

  useEffect(() => {
    ta.current?.focus()
    void book.pythonNames().then(setNames)
  }, [book])
  // Closing the dialog ends picking (_on_py_dialog_finished).
  useEffect(() => () => book.setPick(null), [book])

  const run = async () => {
    if (running) return
    setErrorLine(null)
    setRunning(true)
    try {
      const out = await book.runPythonCell(sh, r, c, code)
      const parts: string[] = []
      if (out.stdout) parts.push(out.stdout.trimEnd())
      if (out.error) {
        parts.push(out.error.trimEnd())
        setErrorLine(errorLineFrom(out.error))
      } else {
        if (out.hasPlot) parts.push('→ plot embedded in the grid')
        if (out.result !== '') parts.push('Result: ' + out.result)
      }
      setOutput({ text: parts.filter(Boolean).join('\n') || '(ran — no output)', err: !!out.error })
      void book.pythonNames().then(setNames)
    } finally {
      setRunning(false)
    }
  }

  const insert = (text: string, back = 0) => {
    const el = ta.current
    if (!el) return
    const at = el.selectionStart + text.length - back
    replaceRange(el, el.selectionStart, el.selectionEnd, text, at)
  }
  const togglePick = () => {
    if (picking) return book.setPick(null)
    book.setPick((cellRef) => {
      book.setPick(null)
      insert(`ks("${cellRef}")`)
    })
  }

  const tool = (icon: Parameters<typeof Ico>[0]['name'], title: string, onClick: (e: React.MouseEvent<HTMLButtonElement>) => void, on?: boolean) => (
    <button className={`kpy-tb${on ? ' on' : ''}`} title={title} aria-label={title} aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      <Ico name={icon} size={20} />
    </button>
  )
  const at = (e: React.MouseEvent<HTMLButtonElement>) => {
    const b = e.currentTarget.getBoundingClientRect()
    return { clientX: b.left, clientY: b.bottom + 2 }
  }

  return (
    <FloatWin title={`Python — ${ref}`} root={root} width={760} height={560} maximisable className="kpy-dialog" onClose={onClose}>
      <div className="kpy-toolbar">
        {tool('py_play', 'Run and apply to the cell (Ctrl+Enter)', () => void run())}
        <span className="kpy-sep" />
        {tool('py_ks', 'Insert a cell reference: ks("A1")', () => insert('ks("")', 2))}
        {tool('py_pick', 'Click a grid cell to insert its ks("…") reference', togglePick, picking)}
        {tool('py_snippets', 'Snippets', (e) => os.contextMenu(at(e), PY_SNIPPETS.map(([name, body]) => ({ label: name, onClick: () => insert(body) }))))}
        {tool('py_comment', 'Toggle line comments (Ctrl+/)', () => ta.current && toggleComment(ta.current))}
        <span className="kpy-sep" />
        {tool('py_timer', 'Set loop period (auto-refresh interval)', (e) => loopPeriodMenu(book, target.sheet, r, c, at(e)))}
        {loopActive
          ? tool('py_stop_circle', 'Stop loop', () => book.setPyLoop(sh, r, c, null))
          : tool('py_play_circle', 'Start loop', () => book.setPyLoop(sh, r, c, book.savedLoop(sh, r, c) ?? 1))}
        <span className="kpy-sep" />
        {tool('py_help', 'Open the Python examples', () => showPythonHelp(book))}
        {running && <span className="kpy-running">Running…</span>}
      </div>
      <div className="kpy-body">
        <div className="kpy-hint">Read cells with ks("A1") or ks("A1:B10"). The last line's value is the cell result. Ctrl+Enter runs.</div>
        <div className="kpy-split">
          <CodeEditor value={code} onChange={setCode} onRun={() => void run()} errorLine={errorLine} names={names} taRef={ta} />
          <pre className={`kpy-output${output?.err ? ' err' : ''}${output ? '' : ' empty'}`} aria-live="polite">
            {output ? output.text : 'Output appears here after you Run.'}
          </pre>
        </div>
        <div className="kpy-foot">
          <button className="k-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </FloatWin>
  )
}
