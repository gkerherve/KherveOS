// What a Browser tab shows: the start page, a web page (os/ui/WebView: framed
// directly or through the KherveOS page fetcher), a file from the drive (in a
// sandboxed iframe), or the "needs your real browser" page.

import { useEffect, useState, type MouseEvent } from 'react'
import { ChevronDown, ExternalLink, FileX, Globe, LoaderCircle, Search, ShieldOff } from 'lucide-react'
import { os, fs, path as vpath } from '@/os'
import { mimeType } from '@/os/fileIcons'
import { FRAME_ALLOW, OPAQUE_SANDBOX } from '@/os/ui/WebView'
import { FAVOURITES, SEARCH_ENGINES, type SearchEngine } from './sites'
import { engineNeedsRealBrowser } from './urls'

// ------------------------------------------------------- file on the drive

function blobType(path: string): string {
  const type = mimeType(path)
  return type.startsWith('text/') ? `${type};charset=utf-8` : type
}

/** A file from the KherveOS drive, from a blob URL; shows the new version whenever the file is saved. */
export function FileFrame({ path, onLoad }: { path: string; onLoad: () => void }) {
  const [version, setVersion] = useState(0)
  const [shown, setShown] = useState<{ url: string } | { error: string } | null>(null)

  useEffect(
    () =>
      fs.watch((ev) => {
        if (ev.path === path || (ev.type === 'rename' && ev.oldPath === path)) setVersion((v) => v + 1)
      }),
    [path],
  )

  useEffect(() => {
    let url: string | null = null
    let cancelled = false
    fs.readBytes(path).then(
      (data) => {
        if (cancelled) return
        url = URL.createObjectURL(new Blob([data as BlobPart], { type: blobType(path) }))
        setShown({ url })
      },
      (err: unknown) => {
        if (cancelled) return
        setShown({ error: err instanceof Error ? err.message : String(err) })
        onLoad()
      },
    )
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
    // (onLoad only reports back: a new one must not read the file again)
  }, [path, version])

  if (!shown) {
    return (
      <div className="k-center k-muted">
        <LoaderCircle size={22} className="k-spin" />
      </div>
    )
  }
  if ('error' in shown) {
    return (
      <div className="k-center br-message">
        <FileX size={40} className="br-message-icon" />
        <h2>This file can't be shown</h2>
        <p className="k-muted">
          <code>{path}</code> isn't on the KherveOS drive any more, or can't be read.
        </p>
      </div>
    )
  }
  return (
    <iframe
      key={shown.url}
      className="br-frame"
      src={shown.url}
      title={vpath.basename(path)}
      sandbox={OPAQUE_SANDBOX}
      allow={FRAME_ALLOW}
      referrerPolicy="strict-origin-when-cross-origin"
      onLoad={onLoad}
    />
  )
}

// ------------------------------------------------- needs a real browser

export function BlockedPage({ host, onOpenReal, onBack }: { host: string; onOpenReal: () => void; onBack?: () => void }) {
  return (
    <div className="k-center br-message">
      <ShieldOff size={40} className="br-message-icon" />
      <h2>This site only works in your real browser</h2>
      <p className="k-muted">
        <strong>{host}</strong> needs things KherveOS deliberately doesn't give the sites it shows: a sign-in kept in
        its own cookies, or a check that a person (not a program) is visiting. Pages that merely refuse to be framed are
        shown through KherveOS; this one isn't, to keep your KherveOS session separate from it.
      </p>
      <button className="k-btn primary br-big-btn" onClick={onOpenReal}>
        <ExternalLink size={16} /> Open in your real browser
      </button>
      {onBack && (
        <button className="k-link-btn" onClick={onBack}>
          Go back
        </button>
      )}
    </div>
  )
}

// --------------------------------------------------------------- start page

interface StartPageProps {
  /** Only the visible tab's start page takes the keyboard. */
  active: boolean
  engine: SearchEngine
  onEngine: (id: string) => void
  /** Typed text: an address or something to search for. */
  onSubmit: (text: string) => void
  /** A favourite was clicked; `newTab` for middle, Ctrl and ⌘ clicks. */
  onOpen: (url: string, newTab: boolean) => void
}

export function StartPage({ active, engine, onEngine, onSubmit, onOpen }: StartPageProps) {
  const [text, setText] = useState('')

  const chooseEngine = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    os.contextMenu(
      { clientX: r.left, clientY: r.bottom + 4 },
      SEARCH_ENGINES.map((en) => ({
        label: engineNeedsRealBrowser(en) ? `${en.name} — needs your real browser` : en.name,
        checked: en.id === engine.id,
        icon: engineNeedsRealBrowser(en) ? ExternalLink : undefined,
        onClick: () => onEngine(en.id),
      })),
    )
  }

  return (
    <div className="br-start">
      <div className="br-start-inner">
        <div className="br-start-mark">
          <Globe size={30} />
        </div>
        <form
          className="br-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit(text)
          }}
        >
          <Search size={17} className="br-search-icon" />
          <input
            className="br-search-input"
            autoFocus={active}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Search with ${engine.name} or type an address`}
            aria-label="Search or type an address"
            spellCheck={false}
            autoComplete="off"
          />
          <button type="button" className="br-search-engine" onClick={chooseEngine} title="Choose the search engine">
            {engine.name}
            <ChevronDown size={13} />
          </button>
        </form>
        <div className="br-favs">
          {FAVOURITES.map((f) => (
            <a
              key={f.url}
              className="br-fav"
              href={f.url}
              title={f.url}
              onClick={(e) => {
                e.preventDefault()
                onOpen(f.url, e.metaKey || e.ctrlKey)
              }}
              onAuxClick={(e) => {
                if (e.button !== 1) return
                e.preventDefault()
                onOpen(f.url, true)
              }}
            >
              <span className="br-fav-icon">
                <f.icon size={22} />
              </span>
              <span className="br-fav-name">{f.name}</span>
              <span className="br-fav-hint">{f.hint}</span>
            </a>
          ))}
        </div>
        <p className="br-start-note">
          Pages open right here. Sites that refuse to be shown inside other apps (GitHub, Stack Overflow, arXiv…) come
          through the KherveOS page fetcher, sealed off from your KherveOS session. Sign-ins and a few sites that turn
          programs away (Google search, YouTube's own pages…) need your real browser.
        </p>
      </div>
    </div>
  )
}
