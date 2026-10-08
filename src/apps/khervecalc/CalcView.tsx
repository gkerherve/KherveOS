// The Calculate tab: the history (pretty input, exact result, ≈ value), the
// entry line with a live preview and completion, the keypad and the
// Variables / Catalog side panel.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { BookOpen, ClipboardCopy, Copy, CornerDownLeft, Pencil, Sigma, Trash2, Variable, X } from 'lucide-react'
import { Tex } from './Tex'
import { shown } from './display'
import { formatNumber, type NumPayload } from './format'
import { CATALOG, CATEGORIES, complete, wordBefore, type CatalogEntry } from './catalog'
import { KEYPAD, applyInsert, type KeyAction, type KeyDef, type KeyFace } from './keypad'
import { ansIds, inputHistory, type CalcSettings, type HistoryEntry } from './session'
import type { CalcBridge } from './bridge'

export interface VarInfo {
  name: string
  kind: 'var' | 'func'
  latex: string
  text: string
  src?: string | null
}

interface Props {
  bridge: CalcBridge
  settings: CalcSettings
  history: HistoryEntry[]
  vars: VarInfo[]
  input: string
  setInput: (s: string | ((cur: string) => string)) => void
  inputRef: RefObject<HTMLInputElement | null>
  evaluate: (src: string, o?: { approx?: boolean; replaceId?: string }) => Promise<HistoryEntry | null>
  deleteEntry: (id: string) => void
  clearHistory: () => void
  deleteVar: (name: string) => void
  clearVars: () => void
  showKeypad: boolean
  showSide: boolean
  busy: boolean
}

type Layer = 'normal' | 'shift' | 'alpha'

const copy = (t: string) => void navigator.clipboard?.writeText(t).catch(() => {})

export function CalcView(p: Props) {
  const { bridge, settings, history, input, setInput, inputRef } = p
  const [pv, setPv] = useState<{ latex: string; approx: NumPayload | null; error?: string } | null>(null)
  const [layer, setLayer] = useState<Layer>('normal')
  const [hist, setHist] = useState<number | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [comp, setComp] = useState<{ items: CatalogEntry[]; sel: number; start: number } | null>(null)
  const [sideTab, setSideTab] = useState<'vars' | 'catalog'>('vars')
  const [search, setSearch] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const draft = useRef('')

  // live preview of the line
  useEffect(() => {
    const src = input.trim()
    if (!src) {
      setPv(null)
      return
    }
    let alive = true
    const t = setTimeout(() => {
      bridge
        .call<{ ok: boolean; latex?: string; approx?: NumPayload | null; error?: string } | null>('preview', {
          src, settings: engineSettings(settings), ans: ansIds(history),
        })
        .then((r) => {
          if (!alive || !r) return
          if (r.ok) setPv({ latex: r.latex ?? '', approx: r.approx ?? null })
          else setPv({ latex: '', approx: null, error: r.error })
        })
        .catch(() => {})
    }, 140)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [input, settings, bridge, history])

  // follow the newest answer
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [history.length])

  const inputs = useMemo(() => inputHistory(history), [history])
  // ans1 is the newest answer (errors have none)
  const ansNum = useMemo(() => {
    const m = new Map<string, number>()
    let k = 0
    for (let i = history.length - 1; i >= 0; i--) if (history[i].answer.ok) m.set(history[i].id, ++k)
    return m
  }, [history])

  const setLine = (text: string, cursor = text.length) => {
    setInput(text)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(cursor, cursor)
    })
  }

  const insert = (ins: string) => {
    const el = inputRef.current
    const start = el?.selectionStart ?? input.length
    const end = el?.selectionEnd ?? input.length
    let base = input
    let s0 = start
    let s1 = end
    // an operator on an empty line continues from the last answer
    if (!input && /^[+*/^]/.test(ins) && history.some((h) => h.answer.ok)) {
      base = 'ans'
      s0 = s1 = 3
    }
    const r = applyInsert(base, s0, s1, ins)
    setLine(r.text, r.cursor)
  }

  const [submitting, setSubmitting] = useState(false)
  const run = async (approx = false) => {
    const src = input.trim()
    if (!src || submitting) return
    setComp(null)
    setHist(null)
    setSubmitting(true)
    try {
      // waits its turn if Python is still starting or busy (Cancel stops it)
      const e = await p.evaluate(src, { approx })
      if (e && e.answer.ok) setInput((cur) => (cur.trim() === src ? '' : cur))
    } finally {
      setSubmitting(false)
    }
  }

  const action = (a: KeyAction) => {
    const el = inputRef.current
    const pos = el?.selectionStart ?? input.length
    switch (a) {
      case 'shift': setLayer((l) => (l === 'shift' ? 'normal' : 'shift')); return
      case 'alpha': setLayer((l) => (l === 'alpha' ? 'normal' : 'alpha')); return
      case 'left': setLine(input, Math.max(0, pos - 1)); break
      case 'right': setLine(input, Math.min(input.length, pos + 1)); break
      case 'backspace': {
        const end = el?.selectionEnd ?? pos
        if (end > pos) setLine(input.slice(0, pos) + input.slice(end), pos)
        else if (pos > 0) setLine(input.slice(0, pos - 1) + input.slice(pos), pos - 1)
        break
      }
      case 'clear': setLine(''); break
      case 'clearAll': p.clearHistory(); break
      case 'exe': void run(false); break
      case 'approx': void run(true); break
      case 'up': recall(-1); break
      case 'down': recall(1); break
    }
    if (layer === 'shift') setLayer('normal')
  }

  const pressKey = (k: KeyDef) => {
    const face: KeyFace = (layer === 'shift' && k.shift) || (layer === 'alpha' && k.alpha) || k
    if (face.action) action(face.action)
    else if (face.insert !== undefined) {
      insert(face.insert)
      if (layer === 'shift') setLayer('normal')
    }
  }

  const recall = (dir: -1 | 1) => {
    if (!inputs.length) return
    let i = hist
    if (i === null) {
      if (dir > 0) return
      draft.current = input
      i = inputs.length
    }
    i += dir
    if (i >= inputs.length) {
      setHist(null)
      setLine(draft.current)
      return
    }
    i = Math.max(0, i)
    setHist(i)
    setLine(inputs[i])
  }

  const updateCompletion = (text: string, cursor: number) => {
    const { word, start } = wordBefore(text, cursor)
    if (word.length < 2) return setComp(null)
    const items = [
      ...p.vars.filter((v) => v.name.toLowerCase().startsWith(word.toLowerCase()) && v.name !== word)
        .map((v): CatalogEntry => ({ name: v.name, sig: v.kind === 'func' ? v.text.split(' = ')[0] : v.name, desc: v.text, cat: 'Arithmetic' })),
      ...complete(word).filter((c) => c.name !== word),
    ].slice(0, 8)
    setComp(items.length ? { items, sel: 0, start } : null)
  }

  const accept = (c: CatalogEntry) => {
    if (!comp) return
    const el = inputRef.current
    const cursor = el?.selectionStart ?? input.length
    const isFunc = /\(/.test(c.sig)
    const ins = isFunc ? `${c.name}(|)` : c.name
    const r = applyInsert(input, comp.start, cursor, ins)
    setComp(null)
    setLine(r.text, r.cursor)
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (comp) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setComp({ ...comp, sel: (comp.sel + 1) % comp.items.length })
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setComp({ ...comp, sel: (comp.sel - 1 + comp.items.length) % comp.items.length })
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        accept(comp.items[comp.sel])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setComp(null)
        return
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      void run(e.ctrlKey || e.metaKey)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      recall(-1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      recall(1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setLine('')
    }
  }

  const approxText = pv?.approx ? formatNumber(pv.approx, { format: settings.format, fix: settings.fix, digits: Math.min(settings.digits, 15) }, settings.complex, settings.angle) : null
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? CATALOG.filter((c) => c.name.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)) : CATALOG
  }, [search])

  return (
    <div className="kc-calc">
      <div className="kc-main">
        <div className="kc-history" ref={listRef}>
          {!history.length && (
            <div className="kc-welcome">
              <Sigma size={34} />
              <div className="kc-welcome-title">KherveCalc</div>
              <div className="k-muted">
                Type and press Enter. Try <code>integrate(sin(x)^2, x)</code>, <code>solve(x^2 = 2, x)</code>,{' '}
                <code>3_m/_s * 2_h</code>, <code>#h*#c/(500_nm) ▶ _eV</code>, <code>[[1,2],[3,4]]^-1</code>, <code>f(x) := x^2</code>.
              </div>
            </div>
          )}
          {history.map((h) => (
            <Entry
              key={h.id}
              entry={h}
              n={ansNum.get(h.id) ?? 0}
              settings={settings}
              editing={editing?.id === h.id ? editing.text : null}
              onEdit={(text) => setEditing(text === null ? null : { id: h.id, text })}
              onSubmitEdit={async (text) => {
                setEditing(null)
                await p.evaluate(text, { replaceId: h.id })
              }}
              onReuse={() => setLine(h.input)}
              onInsert={(t) => insert(t)}
              onDelete={() => p.deleteEntry(h.id)}
            />
          ))}
        </div>
        <div className="kc-entry-area">
          <div className={`kc-preview${pv?.error ? ' error' : ''}`}>
            {input.trim() ? (
              pv?.latex ? (
                <>
                  <Tex tex={pv.latex} className="kc-preview-tex" />
                  {approxText && <span className="kc-preview-approx">≈ {approxText.text}</span>}
                </>
              ) : (
                <span className="kc-preview-msg">{pv?.error ?? ' '}</span>
              )
            ) : (
              <span className="kc-preview-msg k-muted">Enter: calculate · Ctrl+Enter: decimal · ↑↓: earlier inputs · Tab: complete</span>
            )}
          </div>
          <div className="kc-line">
            <input
              ref={inputRef}
              className="kc-input"
              autoFocus
              value={input}
              spellCheck={false}
              autoComplete="off"
              placeholder="2x^2 + 3x - 5 = 0  ·  solve(…)  ·  ∫ …"
              onChange={(e) => {
                let v = e.target.value
                if (!input && /^[+*/^]$/.test(v) && history.some((h) => h.answer.ok)) v = 'ans' + v
                setInput(v)
                setHist(null)
                updateCompletion(v, e.target.selectionStart ?? v.length)
              }}
              onKeyDown={onKey}
              onBlur={() => setTimeout(() => setComp(null), 150)}
              aria-label="Expression"
            />
            <button className="k-btn primary kc-exe" disabled={submitting || !input.trim()} onClick={() => void run(false)} title="Calculate (Enter)">
              <CornerDownLeft size={15} />
            </button>
            {comp && (
              <div className="kc-complete" role="listbox">
                {comp.items.map((c, i) => (
                  <div
                    key={c.name + i}
                    role="option"
                    aria-selected={i === comp.sel}
                    className={`kc-complete-item${i === comp.sel ? ' sel' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      accept(c)
                    }}
                  >
                    <span className="kc-mono">{c.sig}</span>
                    <span className="k-muted">{c.desc}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {p.showKeypad && <Keypad layer={layer} onKey={pressKey} />}
        </div>
      </div>
      {p.showSide && (
        <aside className="kc-side">
          <div className="kc-side-tabs">
            <button className={sideTab === 'vars' ? 'active' : ''} onClick={() => setSideTab('vars')}>
              <Variable size={14} /> Variables
            </button>
            <button className={sideTab === 'catalog' ? 'active' : ''} onClick={() => setSideTab('catalog')}>
              <BookOpen size={14} /> Catalog
            </button>
          </div>
          {sideTab === 'vars' ? (
            <div className="kc-side-body">
              {!p.vars.length && (
                <div className="k-muted kc-side-hint">
                  Define with <code>a := 5</code>, <code>f(x) := x^2 + 1</code> or store with <code>7 → b</code>. Click a name to use it.
                </div>
              )}
              {p.vars.map((v) => (
                <div key={v.name} className="kc-var" title={v.src ?? v.text}>
                  <button className="kc-var-main" onClick={() => insert(v.kind === 'func' ? `${v.name}(|)` : v.name)}>
                    <Tex tex={v.latex.length > 600 ? `\\text{${v.name}}` : v.latex} />
                  </button>
                  <button className="k-icon-btn" title={`Delete ${v.name}`} onClick={() => p.deleteVar(v.name)}>
                    <X size={13} />
                  </button>
                </div>
              ))}
              {p.vars.length > 0 && (
                <button className="k-btn small kc-side-clear" onClick={p.clearVars}>
                  Clear all variables
                </button>
              )}
            </div>
          ) : (
            <div className="kc-side-body">
              <input className="k-input kc-side-search" placeholder="Search functions…" value={search} onChange={(e) => setSearch(e.target.value)} />
              {CATEGORIES.map((cat) => {
                const items = filtered.filter((c) => c.cat === cat)
                if (!items.length) return null
                return (
                  <div key={cat} className="kc-cat">
                    <div className="kc-cat-title">{cat}</div>
                    {items.map((c) => (
                      <button key={c.cat + c.name} className="kc-cat-item" title={c.desc} onClick={() => insert(`${c.name}(|)`)}>
                        <span className="kc-mono">{c.sig}</span>
                        <span className="k-muted">{c.desc}</span>
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </aside>
      )}
    </div>
  )
}

export function engineSettings(s: CalcSettings) {
  return { number: s.number, digits: s.digits, angle: s.angle, complex: s.complex }
}

function Entry(props: {
  entry: HistoryEntry
  n: number
  settings: CalcSettings
  editing: string | null
  onEdit: (text: string | null) => void
  onSubmitEdit: (text: string) => void
  onReuse: () => void
  onInsert: (t: string) => void
  onDelete: () => void
}) {
  const { entry: h, settings } = props
  const sh = useMemo(() => shown(h.answer, settings), [h.answer, settings])
  const plainNumber = /^[-+]?[\d.]+(e[-+]?\d+)?$/.test(sh.text) && sh.text.length > 60
  const resultText = sh.text || h.answer.text || ''
  return (
    <div className={`kc-entry${h.answer.ok ? '' : ' error'}`}>
      {props.editing !== null ? (
        <input
          className="kc-input kc-edit"
          autoFocus
          value={props.editing}
          onChange={(e) => props.onEdit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') props.onSubmitEdit(props.editing ?? '')
            if (e.key === 'Escape') props.onEdit(null)
          }}
          onBlur={() => props.onEdit(null)}
        />
      ) : (
        <button className="kc-entry-in" title="Click to use this input again" onClick={props.onReuse}>
          {h.inputLatex && h.inputLatex.length < 3000 ? <Tex tex={h.inputLatex} /> : <span className="kc-mono">{h.input}</span>}
        </button>
      )}
      <div className="kc-entry-out">
        {sh.error ? (
          <span className="kc-error">{sh.error}</span>
        ) : (
          <>
            <button className="kc-result" title={`ans${props.n} — click to insert`} onClick={() => props.onInsert(`ans${props.n}`)}>
              {sh.latex !== null && !plainNumber ? <Tex tex={sh.latex} display /> : <span className="kc-mono kc-longnum">{sh.text}</span>}
            </button>
            {sh.mixedLatex && <div className="kc-approx"><Tex tex={`= ${sh.mixedLatex}`} /></div>}
            {sh.approxLatex && (
              <div className="kc-approx">
                {sh.approxLatex.length < 3000 && !/^[-+]?[\d.]{60,}/.test(sh.approxText ?? '') ? <Tex tex={`\\approx ${sh.approxLatex}`} /> : <span className="kc-mono kc-longnum">≈ {sh.approxText}</span>}
              </div>
            )}
          </>
        )}
      </div>
      <div className="kc-entry-tools">
        {props.n > 0 && <span className="kc-entry-n">ans{props.n}</span>}
        {h.answer.ok && (
          <>
            <button className="k-icon-btn" title="Copy the result as text" onClick={() => copy(resultText)}>
              <Copy size={13} />
            </button>
            <button className="k-icon-btn" title="Copy the result as LaTeX" onClick={() => copy(sh.latex ?? h.answer.latex ?? resultText)}>
              <ClipboardCopy size={13} />
            </button>
          </>
        )}
        <button className="k-icon-btn" title="Edit and recalculate in place" onClick={() => props.onEdit(h.input)}>
          <Pencil size={13} />
        </button>
        <button className="k-icon-btn" title="Delete" onClick={props.onDelete}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

function Keypad({ layer, onKey }: { layer: Layer; onKey: (k: KeyDef) => void }) {
  return (
    <div className={`kc-keypad layer-${layer}`}>
      {KEYPAD.map((row, r) => (
        <div key={r} className="kc-keyrow">
          {row.map((k, i) => {
            const active = (layer === 'shift' && k.action === 'shift') || (layer === 'alpha' && k.action === 'alpha')
            const face = (layer === 'shift' && k.shift) || (layer === 'alpha' && k.alpha) || k
            return (
              <button
                key={i}
                className={`kc-key kind-${k.kind}${active ? ' on' : ''}${k.action === 'shift' ? ' shift' : ''}${k.action === 'alpha' ? ' alpha' : ''}`}
                title={face.title ?? k.title ?? face.insert ?? face.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onKey(k)}
              >
                <span className="kc-key-top">
                  <span className="kc-key-shift">{k.shift?.label ?? ''}</span>
                  <span className="kc-key-alpha">{k.alpha?.label ?? ''}</span>
                </span>
                <span className="kc-key-main">{face.label}</span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
