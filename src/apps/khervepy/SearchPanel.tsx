// The Search dock (Find in Files): every match in the project's text files,
// grouped by file; click one to open it at that line.

import { forwardRef, memo, useImperativeHandle, useRef, useState } from 'react'
import { CaseSensitive, LoaderCircle, Regex, Search, WholeWord, X } from 'lucide-react'
import { fs, path, type Stat } from '@/os'

const SKIP_DIRS = new Set(['.git', '__pycache__', 'node_modules', '.venv', 'venv', '.mypy_cache', '.pytest_cache', 'build', 'dist', '.idea'])
const MAX_FILE = 1024 * 1024
const MAX_HITS = 2000

interface Hit {
  line: number
  text: string
  start: number
  end: number
}
interface FileHits {
  path: string
  hits: Hit[]
}

export interface SearchPanelHandle {
  focus(query?: string): void
}

function textFiles(root: string): Stat[] {
  const out: Stat[] = []
  const visit = (dir: string) => {
    let items: Stat[]
    try {
      items = fs.list(dir)
    } catch {
      return
    }
    for (const s of items) {
      if (s.type === 'dir') {
        if (!SKIP_DIRS.has(s.name)) visit(s.path)
      } else if (s.size <= MAX_FILE) out.push(s)
    }
  }
  visit(root)
  return out
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const SearchPanel = memo(forwardRef<SearchPanelHandle, { root: string; onOpen: (p: string, line: number) => void }>(
  function SearchPanel({ root, onOpen }, ref) {
    const [query, setQuery] = useState('')
    const [caseSensitive, setCase] = useState(false)
    const [word, setWord] = useState(false)
    const [regex, setRegex] = useState(false)
    const [results, setResults] = useState<FileHits[]>([])
    const [summary, setSummary] = useState('')
    const [busy, setBusy] = useState(false)
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
    const input = useRef<HTMLInputElement>(null)
    const run = useRef(0)

    useImperativeHandle(ref, () => ({
      focus(q?: string) {
        if (q) setQuery(q)
        requestAnimationFrame(() => {
          input.current?.focus()
          input.current?.select()
        })
      },
    }))

    const search = async () => {
      const id = ++run.current
      const q = query
      if (!q) {
        setResults([])
        setSummary('')
        return
      }
      let rx: RegExp
      try {
        const source = regex ? q : escapeRegex(q)
        rx = new RegExp(word ? `\\b(?:${source})\\b` : source, caseSensitive ? 'g' : 'gi')
      } catch (e) {
        setSummary(`Bad regular expression: ${e instanceof Error ? e.message : String(e)}`)
        return
      }
      setBusy(true)
      setResults([])
      const found: FileHits[] = []
      let total = 0
      const decoder = new TextDecoder()
      for (const f of textFiles(root)) {
        if (run.current !== id) return // a newer search started
        let data: Uint8Array
        try {
          data = await fs.readBytes(f.path)
        } catch {
          continue
        }
        if (data.subarray(0, 8000).includes(0)) continue // binary
        const lines = decoder.decode(data).split('\n')
        const hits: Hit[] = []
        for (let i = 0; i < lines.length && total < MAX_HITS; i++) {
          rx.lastIndex = 0
          const m = rx.exec(lines[i])
          if (!m) continue
          const text = lines[i].replace(/\r$/, '')
          const from = Math.max(0, m.index - 40)
          hits.push({ line: i + 1, text: (from ? '…' : '') + text.slice(from, from + 200), start: m.index - from + (from ? 1 : 0), end: m.index - from + (from ? 1 : 0) + Math.max(1, m[0].length) })
          total++
        }
        if (hits.length) {
          found.push({ path: f.path, hits })
          setResults([...found])
        }
        if (total >= MAX_HITS) break
      }
      if (run.current !== id) return
      setBusy(false)
      setSummary(total ? `${total}${total >= MAX_HITS ? '+' : ''} match${total === 1 ? '' : 'es'} in ${found.length} file${found.length === 1 ? '' : 's'}` : 'No matches.')
    }

    const toggle = (p: string) =>
      setCollapsed((cur) => {
        const next = new Set(cur)
        if (next.has(p)) next.delete(p)
        else next.add(p)
        return next
      })

    return (
      <div className="kpy-search">
        <form
          className="kpy-search-bar"
          onSubmit={(e) => {
            e.preventDefault()
            void search()
          }}
        >
          <Search size={14} className="kpy-muted-icon" />
          <input
            ref={input}
            className="kpy-search-input"
            value={query}
            placeholder="Search the project…  (Enter)"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" className="k-icon-btn kpy-mini" title="Clear" onClick={() => { setQuery(''); setResults([]); setSummary('') }}>
              <X size={13} />
            </button>
          )}
        </form>
        <div className="kpy-search-opts">
          <button className={`k-icon-btn kpy-mini${caseSensitive ? ' active' : ''}`} title="Match case" onClick={() => setCase((v) => !v)}>
            <CaseSensitive size={15} />
          </button>
          <button className={`k-icon-btn kpy-mini${word ? ' active' : ''}`} title="Whole word" onClick={() => setWord((v) => !v)}>
            <WholeWord size={15} />
          </button>
          <button className={`k-icon-btn kpy-mini${regex ? ' active' : ''}`} title="Regular expression" onClick={() => setRegex((v) => !v)}>
            <Regex size={15} />
          </button>
          <span className="kpy-search-summary">
            {busy ? <LoaderCircle size={13} className="k-spin" /> : summary}
          </span>
        </div>
        <div className="kpy-search-results">
          {results.map((f) => (
            <div key={f.path}>
              <div className="kpy-search-file" onClick={() => toggle(f.path)} title={f.path}>
                <span className="kpy-row-name">{path.basename(f.path)}</span>
                <span className="kpy-search-dir">{path.dirname(f.path).slice(root.length + 1)}</span>
                <span className="kpy-count">{f.hits.length}</span>
              </div>
              {!collapsed.has(f.path) &&
                f.hits.map((h) => (
                  <div key={h.line} className="kpy-search-hit" onClick={() => onOpen(f.path, h.line)}>
                    <span className="kpy-search-line">{h.line}</span>
                    <span className="kpy-search-text">
                      {h.text.slice(0, h.start)}
                      <mark>{h.text.slice(h.start, h.end)}</mark>
                      {h.text.slice(h.end)}
                    </span>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    )
  },
))
