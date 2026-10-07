// Settings: appearance, storage, server & account, AI & MCP, Python, about.

import { useEffect, useState } from 'react'
import { Cpu, HardDrive, Info, Palette, Server, Sparkles, type LucideIcon } from 'lucide-react'
import { os, fs, formatSize, useFsVersion, type AppProps } from '@/os'
import { useSettings } from '@/os/settings'
import { WALLPAPER } from '@/shell/wallpapers'
import { APPS, GROUPS } from '@/os/registry'
import { AppIcon } from '@/os/ui/AppIcon'
import { useAuth, useServer } from '@/os/server'
import { KHERVEOS_VERSION, PYODIDE_VERSION } from '@/os/version'
import { McpSection } from './McpSection'
import './settings.css'

type Section = 'appearance' | 'storage' | 'server' | 'ai' | 'python' | 'about'

const SECTIONS: { id: Section; name: string; icon: LucideIcon }[] = [
  { id: 'appearance', name: 'Appearance', icon: Palette },
  { id: 'storage', name: 'Storage', icon: HardDrive },
  { id: 'server', name: 'Server & account', icon: Server },
  { id: 'ai', name: 'AI & MCP', icon: Sparkles },
  { id: 'python', name: 'Python', icon: Cpu },
  { id: 'about', name: 'About', icon: Info },
]

export default function Settings({ win, args }: AppProps) {
  const [section, setSection] = useState<Section>((args.section as Section) ?? 'appearance')
  useEffect(() => {
    if (args.section) setSection(args.section as Section)
  }, [args.section])
  useEffect(() => {
    win.setTitle(`Settings — ${SECTIONS.find((s) => s.id === section)?.name}`)
  }, [win, section])

  return (
    <div className="k-app st-app">
      <nav className="st-nav">
        {SECTIONS.map((s) => (
          <button key={s.id} className={`k-place${section === s.id ? ' active' : ''}`} onClick={() => setSection(s.id)}>
            <s.icon size={15} /> {s.name}
          </button>
        ))}
      </nav>
      <main className="st-main">
        {section === 'appearance' && <Appearance />}
        {section === 'storage' && <Storage />}
        {section === 'server' && <ServerSection />}
        {section === 'ai' && <McpSection />}
        {section === 'python' && <PythonSection />}
        {section === 'about' && <About />}
      </main>
    </div>
  )
}

function Appearance() {
  const { wallpaperOpacity, desktopIcons, dockZoom, lightApps, set } = useSettings()

  return (
    <>
      <h2>Wallpaper</h2>
      <div className="st-wallpaper-one">
        <span className="st-wallpaper-preview" style={{ background: WALLPAPER.css }} />
        <span>{WALLPAPER.name}</span>
      </div>

      <label className="st-inline st-slider">
        Wallpaper visibility
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={Math.round(wallpaperOpacity * 100)}
          onChange={(e) => set({ wallpaperOpacity: Number(e.target.value) / 100 })}
        />
        <span className="k-muted">{Math.round(wallpaperOpacity * 100)}%</span>
      </label>

      <h2>Dock</h2>
      <label className="st-inline st-slider">
        Magnification
        <input type="range" min={48} max={128} step={4} value={dockZoom} onChange={(e) => set({ dockZoom: Number(e.target.value) })} />
        <span className="k-muted">{dockZoom <= 48 ? 'Off' : dockZoom >= 128 ? 'Maximum' : `${dockZoom} px`}</span>
      </label>

      <h2>Desktop</h2>
      <label className="st-check">
        <input type="checkbox" checked={desktopIcons} onChange={(e) => set({ desktopIcons: e.target.checked })} />
        Show app shortcuts on the desktop
      </label>

      <h2>Light or dark, app by app</h2>
      <p className="k-muted st-note">
        KherveOS is dark. Choose Light for the apps you prefer bright, like paper; they open in white and green.
      </p>
      <div className="st-lightapps">
        {GROUPS.flatMap((g) => APPS.filter((a) => a.group === g)).map((a) => {
          const light = lightApps.includes(a.id)
          const choose = (wantLight: boolean) =>
            set({ lightApps: wantLight ? [...lightApps.filter((x) => x !== a.id), a.id] : lightApps.filter((x) => x !== a.id) })
          return (
            <div key={a.id} className="st-lightapp">
              <AppIcon app={a} size={22} />
              <span className="st-lightapp-name">{a.name}</span>
              <div className="st-seg" role="radiogroup" aria-label={`${a.name}: light or dark`}>
                <button role="radio" aria-checked={!light} className={!light ? 'on' : ''} onClick={() => choose(false)}>
                  Dark
                </button>
                <button role="radio" aria-checked={light} className={light ? 'on' : ''} onClick={() => choose(true)}>
                  Light
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function Storage() {
  useFsVersion()
  const usage = fs.usage()
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number } | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)

  useEffect(() => {
    navigator.storage?.estimate?.().then(setEstimate).catch(() => {})
    navigator.storage?.persisted?.().then(setPersisted).catch(() => {})
  }, [])

  return (
    <>
      <h2>Your drive</h2>
      <div className="st-card">
        <div className="st-stat"><b>{formatSize(usage.bytes)}</b> in {usage.files} files and {usage.folders} folders</div>
        {estimate?.quota ? (
          <>
            <div className="st-meter"><i style={{ width: `${Math.min(100, ((estimate.usage ?? 0) / estimate.quota) * 100)}%` }} /></div>
            <div className="k-muted">
              This site uses {formatSize(estimate.usage ?? 0)} of the {formatSize(estimate.quota)} your browser allows (Python's cache included).
            </div>
          </>
        ) : null}
      </div>
      <p className="k-muted">
        Files are kept in this browser's storage on this computer. They are not uploaded anywhere. Use Download in Files
        to keep copies on your computer.
      </p>
      <div className="st-card">
        <div className="st-row">
          <div>
            <b>Keep my files</b>
            <div className="k-muted">
              {persisted ? 'Your browser has agreed not to clear KherveOS storage when space runs low.' : 'Ask the browser not to clear KherveOS storage when space runs low.'}
            </div>
          </div>
          <button
            className="k-btn"
            disabled={!!persisted}
            onClick={async () => {
              const ok = await navigator.storage?.persist?.()
              setPersisted(!!ok)
              if (!ok) os.notify({ title: 'The browser said no', body: 'Some browsers only allow this for installed or often-used sites.' })
            }}
          >
            {persisted ? 'Protected' : 'Protect'}
          </button>
        </div>
      </div>
      <h3>Danger zone</h3>
      <div className="st-card st-danger">
        <div className="st-row">
          <div>
            <b>Reset the drive</b>
            <div className="k-muted">Deletes every file and folder and puts back the starter files.</div>
          </div>
          <button
            className="k-btn danger"
            onClick={async () => {
              const ok = await os.dialog.confirm('Delete everything on the KherveOS drive? This cannot be undone.', {
                title: 'Reset the drive', okLabel: 'Delete everything', danger: true,
              })
              if (ok) {
                await fs.reset()
                os.notify({ title: 'The drive was reset' })
              }
            }}
          >
            Reset…
          </button>
        </div>
      </div>
    </>
  )
}

function ServerSection() {
  const { status, version, check } = useServer()
  const { user, logout } = useAuth()
  return (
    <>
      <h2>KherveOS server</h2>
      <div className="st-card">
        <div className="st-row">
          <div>
            <b className={status === 'online' ? 'st-ok' : 'st-off'}>{status === 'online' ? '● Connected' : status === 'checking' ? '● Checking…' : '● Not running'}</b>
            {version && <span className="k-muted"> — version {version}</span>}
            <div className="k-muted">Messages, Email and the games need it. Everything else works without it.</div>
          </div>
          <button className="k-btn" onClick={() => void check()}>Check again</button>
        </div>
      </div>
      {status !== 'online' && (
        <>
          <p>Start it from the KherveOS folder (the first command only once):</p>
          <pre className="k-code-block">npm run server:setup{'\n'}npm run server</pre>
          <p className="k-muted">Or start the OS and the server together with <code>npm run dev:all</code>.</p>
        </>
      )}
      <h2>Account</h2>
      <div className="st-card">
        {user ? (
          <div className="st-row">
            <div className="st-user">
              <span className="k-avatar">{user.display_name.slice(0, 1).toUpperCase()}</span>
              <div>
                <b>{user.display_name}</b>
                <div className="k-muted">@{user.username}</div>
              </div>
            </div>
            <button className="k-btn" onClick={() => void logout()}>Sign out</button>
          </div>
        ) : (
          <div className="st-row">
            <div className="k-muted">Not signed in. Open Messages or Email to sign in or create an account.</div>
            <button className="k-btn" disabled={status !== 'online'} onClick={() => os.open('messages')}>Open Messages</button>
          </div>
        )}
      </div>
    </>
  )
}

function PythonSection() {
  return (
    <>
      <h2>Python</h2>
      <div className="st-card">
        <div className="st-stat"><b>Pyodide {PYODIDE_VERSION}</b> — CPython 3.14 compiled to WebAssembly</div>
        <div className="k-muted">Runs entirely in your browser, in the background, one process per Terminal or KherveBook window.</div>
      </div>
      <p>
        The first time Python starts it downloads about 10 MB from <code>cdn.jsdelivr.net</code>; after that the browser keeps it.
        Packages load automatically when you import them: numpy, scipy, pandas, matplotlib, scikit-learn, sympy, h5py, lxml,
        Pillow and many more. Pure-Python packages from PyPI install with <code>pip install name</code> in the Terminal or
        <code> %pip install name</code> in KherveBook.
      </p>
      <p className="k-muted">
        Python sees your home folder at <code>/home/user</code>: files it writes appear in Files straight away. Not available yet:
        <code>input()</code>, threads and starting other programs.
      </p>
    </>
  )
}

function About() {
  return (
    <>
      <div className="st-about">
        <img src="/kherveos.svg" alt="" width={56} height={56} />
        <div>
          <h2>KherveOS {KHERVEOS_VERSION}</h2>
          <div className="k-muted">An OS for the people — free, open source, made to help.</div>
        </div>
      </div>
      <p>
        The{' '}
        <a
          href="https://khervetools.com"
          onClick={(e) => {
            e.preventDefault()
            os.openUrl('https://khervetools.com')
          }}
        >
          Ktools
        </a>{' '}
        desktop in your browser:
        KherveFitting, KherveSheet, KherveTeX, KherveSlide, KhervePDF, KherveRef, KherveNote, KherveBook and more, for
        anyone, on any computer, without installing anything.
      </p>
      <p>
        KherveOS is free software: you can use it, study it, share it and improve it under the terms of the GNU General
        Public License, version 3 or later.
      </p>
      <h3>Built with</h3>
      <ul className="st-credits">
        <li>Pyodide — Python in WebAssembly</li>
        <li>React, Vite, zustand</li>
        <li>CodeMirror — code editing</li>
        <li>xterm.js — the Terminal</li>
        <li>KaTeX and marked — maths and Markdown</li>
        <li>Lucide — icons</li>
        <li>FastAPI — the KherveOS server</li>
      </ul>
    </>
  )
}
