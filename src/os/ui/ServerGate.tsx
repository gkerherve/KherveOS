// Wraps apps that need the KherveOS server (Messages, Email): shows how to
// start the server when it is down, and a sign-in / create-account form when
// nobody is signed in. Renders its children only once both are fine.

import { useState, type ReactNode } from 'react'
import { LoaderCircle, RefreshCw, ServerOff } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth, useServer, ApiError } from '../server'

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="k-center k-muted">
      <LoaderCircle size={22} className="k-spin" />
      {label && <div style={{ marginTop: 8 }}>{label}</div>}
    </div>
  )
}

export function ServerGate({ app, icon: Icon, children }: { app: string; icon: LucideIcon; children: ReactNode }) {
  const status = useServer((s) => s.status)
  const check = useServer((s) => s.check)
  const { user, checked } = useAuth()
  const [retrying, setRetrying] = useState(false)

  if (status === 'checking') return <Spinner label="Connecting to the KherveOS server…" />

  if (status === 'offline') {
    return (
      <div className="k-center">
        <div className="k-gate-card">
          <ServerOff size={32} color="var(--k-muted)" />
          <h2>The KherveOS server isn't running</h2>
          <p className="k-muted">
            {app} needs the KherveOS server. In the <code>KherveOS</code> folder run (the first time only, then the second):
          </p>
          <pre className="k-code-block">npm run server:setup{'\n'}npm run server</pre>
          <button
            className="k-btn primary"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true)
              await check()
              setRetrying(false)
            }}
          >
            <RefreshCw size={14} className={retrying ? 'k-spin' : undefined} /> Try again
          </button>
        </div>
      </div>
    )
  }

  if (!checked) return <Spinner />
  if (!user) return <SignIn app={app} icon={Icon} />
  return <>{children}</>
}

function SignIn({ app, icon: Icon }: { app: string; icon: LucideIcon }) {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (mode === 'register' && password !== password2) {
      setError('The two passwords are different.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'signin') await login(username.trim(), password)
      else await register(username.trim(), displayName.trim() || username.trim(), password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="k-center">
      <form className="k-gate-card" onSubmit={submit}>
        <Icon size={32} color="var(--k-accent)" />
        <h2>{mode === 'signin' ? `Sign in to ${app}` : 'Create a KherveOS account'}</h2>
        <p className="k-muted">
          {mode === 'signin'
            ? 'Use your account on this KherveOS server.'
            : 'Accounts live on your KherveOS server and work for Messages and Email.'}
        </p>
        {mode === 'register' && (
          <input className="k-input" placeholder="Your name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" />
        )}
        <input className="k-input" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus spellCheck={false} />
        <input className="k-input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
        {mode === 'register' && (
          <input className="k-input" type="password" placeholder="Password again" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
        )}
        {error && <div className="k-error">{error}</div>}
        <button className="k-btn primary wide" type="submit" disabled={busy || !username.trim() || !password}>
          {busy ? <LoaderCircle size={14} className="k-spin" /> : null}
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        <button
          type="button"
          className="k-link-btn"
          onClick={() => {
            setMode(mode === 'signin' ? 'register' : 'signin')
            setError(null)
          }}
        >
          {mode === 'signin' ? 'No account yet? Create one' : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  )
}
