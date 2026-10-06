// Adding a mail account (or editing one): provider presets, the provider's
// advice about app passwords, and the server settings under "Advanced".

import { useEffect, useId, useState } from 'react'
import { ChevronRight, CircleAlert, ExternalLink, Info, LoaderCircle, Lock, Mail, TriangleAlert, X } from 'lucide-react'
import { errorMessage, mail, MailApiError, type Account, type Provider, type Security } from './api'

let providersCache: Promise<Provider[]> | null = null

function loadProviders(): Promise<Provider[]> {
  providersCache ??= mail.providers().catch((err) => {
    providersCache = null
    throw err
  })
  return providersCache
}

const DEFAULT_PORTS: Record<'imap' | 'smtp', Record<Security, number>> = {
  imap: { ssl: 993, starttls: 143, none: 143 },
  smtp: { ssl: 465, starttls: 587, none: 587 },
}

interface ServerFields {
  host: string
  port: string
  security: Security
}

function domainOf(email: string): string {
  const at = email.lastIndexOf('@')
  return at > 0 ? email.slice(at + 1).trim().toLowerCase() : ''
}

function helpHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

interface AccountDialogProps {
  /** Edit this account instead of adding one. */
  account?: Account
  defaultName: string
  onClose(): void
  onSaved(account: Account, created: boolean): void
}

export function AccountDialog({ account, defaultName, onClose, onSaved }: AccountDialogProps) {
  const editing = !!account
  const id = useId()
  const [providers, setProviders] = useState<Provider[] | null>(null)
  const [providersError, setProvidersError] = useState<string | null>(null)
  const [providerId, setProviderId] = useState(account?.provider ?? '')
  const [picked, setPicked] = useState(editing)
  const [email, setEmail] = useState(account?.email ?? '')
  const [name, setName] = useState(account?.display_name ?? defaultName)
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState(account && account.username !== account.email ? account.username : '')
  const [imap, setImap] = useState<ServerFields>(
    account ? { host: account.imap_host, port: String(account.imap_port), security: account.imap_security } : { host: '', port: '993', security: 'ssl' },
  )
  const [smtp, setSmtp] = useState<ServerFields>(
    account ? { host: account.smtp_host, port: String(account.smtp_port), security: account.smtp_security } : { host: '', port: '465', security: 'ssl' },
  )
  const [guessed, setGuessed] = useState(!editing)
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; kind: string | null } | null>(null)

  useEffect(() => {
    loadProviders().then(setProviders, (err) => setProvidersError(errorMessage(err)))
  }, [])

  const provider = providers?.find((p) => p.id === providerId) ?? null
  const unsupported = !!provider && !provider.supported

  const fillServers = (p: Provider | null, domain: string) => {
    if (p?.imap && p.smtp) {
      setImap({ host: p.imap.host, port: String(p.imap.port), security: p.imap.security })
      setSmtp({ host: p.smtp.host, port: String(p.smtp.port), security: p.smtp.security })
    } else if (domain) {
      // A good first guess for most providers; "Advanced" is open to correct it.
      setImap({ host: `imap.${domain}`, port: '993', security: 'ssl' })
      setSmtp({ host: `smtp.${domain}`, port: '587', security: 'starttls' })
    }
    setGuessed(true)
  }

  const pick = (p: Provider) => {
    setProviderId(p.id)
    setPicked(true)
    setError(null)
    fillServers(p, domainOf(email))
    setAdvanced(p.id === 'other')
  }

  const onEmail = (value: string) => {
    setEmail(value)
    if (editing || !providers) return
    const domain = domainOf(value)
    const match = providers.find((p) => p.domains.includes(domain)) ?? null
    if (match && (!picked || providerId === 'other')) {
      setProviderId(match.id)
      fillServers(match, domain)
      setAdvanced(false)
    } else if (!match && domain && guessed && (!picked || providerId === 'other')) {
      setProviderId('other')
      fillServers(null, domain)
      setAdvanced(true)
    }
  }

  const setSecurity = (which: 'imap' | 'smtp', security: Security) => {
    const [fields, set] = which === 'imap' ? [imap, setImap] : [smtp, setSmtp]
    const defaults = DEFAULT_PORTS[which]
    const usual = !fields.port || Object.values(defaults).some((p) => String(p) === fields.port)
    set({ ...fields, security, port: usual ? String(defaults[security]) : fields.port })
    setGuessed(false)
  }

  const canSubmit = editing || (email.includes('@') && !!password && !unsupported)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || !canSubmit) return
    setBusy(true)
    setError(null)
    const settings = {
      display_name: name.trim(),
      username: username.trim(),
      imap_host: imap.host.trim(),
      imap_port: Number(imap.port) || DEFAULT_PORTS.imap[imap.security],
      imap_security: imap.security,
      smtp_host: smtp.host.trim(),
      smtp_port: Number(smtp.port) || DEFAULT_PORTS.smtp[smtp.security],
      smtp_security: smtp.security,
    }
    try {
      if (account) {
        onSaved(await mail.updateAccount(account.id, { ...settings, ...(password ? { password } : {}) }), false)
      } else {
        onSaved(await mail.addAccount({ ...settings, email: email.trim(), password, provider: providerId || undefined }), true)
      }
    } catch (err) {
      const kind = err instanceof MailApiError ? err.kind : null
      setError({ message: errorMessage(err), kind })
      if (kind === 'connect' || kind === 'tls' || kind === 'input') setAdvanced(true)
      setBusy(false)
    }
  }

  return (
    <div className="mail-overlay">
      <form
        className="mail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.preventDefault()
            onClose()
          }
        }}
      >
        <div className="mail-dialog-head">
          <span className="mail-dialog-icon" aria-hidden>
            <Mail size={18} />
          </span>
          <div className="mail-dialog-titles">
            <h2 id={`${id}-title`}>{editing ? 'Edit account' : 'Add a mail account'}</h2>
            <p>{editing ? account.email : 'Gmail, iCloud, Fastmail, Yahoo — or any IMAP/SMTP server.'}</p>
          </div>
          <button type="button" className="k-icon-btn" onClick={onClose} disabled={busy} aria-label="Close" title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="mail-dialog-body">
          {!editing && (
            <div className="mail-providers" role="radiogroup" aria-label="Your provider">
              {providers ? (
                providers.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    role="radio"
                    aria-checked={p.id === providerId}
                    className={`mail-provider${p.id === providerId ? ' active' : ''}${p.supported ? '' : ' unsupported'}`}
                    onClick={() => pick(p)}
                  >
                    <span className="mail-provider-name">{p.name}</span>
                    {!p.supported && <span className="mail-provider-sub">Not supported yet</span>}
                  </button>
                ))
              ) : providersError ? (
                <div className="mail-form-error">
                  <CircleAlert size={15} />
                  <span>{providersError}</span>
                </div>
              ) : (
                <LoaderCircle size={18} className="k-spin k-muted" />
              )}
            </div>
          )}

          {provider && (
            <div className={`mail-note${unsupported ? ' warn' : ''}`}>
              {unsupported ? <TriangleAlert size={16} /> : <Info size={16} />}
              <div>
                <p>{provider.note}</p>
                {provider.help_url && (
                  <a href={provider.help_url} target="_blank" rel="noopener noreferrer">
                    Open {helpHost(provider.help_url)} <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </div>
          )}

          {!unsupported && (
            <>
              <div className="mail-form">
                <label htmlFor={`${id}-name`}>Your name</label>
                <input
                  id={`${id}-name`}
                  className="k-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Shown to the people you write to"
                  autoComplete="name"
                />
                <label htmlFor={`${id}-email`}>Email address</label>
                <input
                  id={`${id}-email`}
                  className="k-input"
                  type="email"
                  value={email}
                  onChange={(e) => onEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  spellCheck={false}
                  disabled={editing}
                  autoFocus={!editing}
                />
                <label htmlFor={`${id}-password`}>{provider?.password_label ?? 'Password'}</label>
                <input
                  id={`${id}-password`}
                  className="k-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={editing ? 'Leave empty to keep the saved one' : ''}
                  autoComplete="new-password"
                  spellCheck={false}
                />
              </div>

              <button
                type="button"
                className={`mail-advanced-toggle${advanced ? ' open' : ''}`}
                aria-expanded={advanced}
                onClick={() => setAdvanced((a) => !a)}
              >
                <ChevronRight size={14} /> Advanced: servers, ports and user name
              </button>
              {advanced && (
                <div className="mail-advanced">
                  <ServerRow
                    label="Incoming mail (IMAP)"
                    fields={imap}
                    onChange={(f) => {
                      setImap(f)
                      setGuessed(false)
                    }}
                    onSecurity={(s) => setSecurity('imap', s)}
                  />
                  <ServerRow
                    label="Outgoing mail (SMTP)"
                    fields={smtp}
                    onChange={(f) => {
                      setSmtp(f)
                      setGuessed(false)
                    }}
                    onSecurity={(s) => setSecurity('smtp', s)}
                  />
                  <div className="mail-form">
                    <label htmlFor={`${id}-user`}>User name</label>
                    <input
                      id={`${id}-user`}
                      className="k-input"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder={email ? `${email.trim()} (the email address)` : 'Usually your email address'}
                      autoComplete="username"
                      spellCheck={false}
                    />
                  </div>
                  {(imap.security === 'none' || smtp.security === 'none') && (
                    <p className="mail-warn">
                      <TriangleAlert size={13} /> Without encryption the password crosses the network in clear text. Only use
                      that for a server on your own network.
                    </p>
                  )}
                </div>
              )}

              <p className="mail-lock-note">
                <Lock size={13} />
                <span>
                  Your password is stored encrypted on your own KherveOS server and is only used to connect to your mail
                  provider. It never comes back to the browser.
                </span>
              </p>
            </>
          )}

          {error && (
            <div className="mail-form-error" role="alert">
              <CircleAlert size={15} />
              <span>{error.message}</span>
            </div>
          )}
        </div>

        <div className="mail-dialog-foot">
          {busy && <span className="mail-hint">Checking the incoming and outgoing servers…</span>}
          <span className="mail-spacer" />
          <button type="button" className="k-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="k-btn primary" disabled={busy || !canSubmit}>
            {busy && <LoaderCircle size={14} className="k-spin" />}
            {editing ? 'Save' : 'Add account'}
          </button>
        </div>
      </form>
    </div>
  )
}

function ServerRow({
  label,
  fields,
  onChange,
  onSecurity,
}: {
  label: string
  fields: ServerFields
  onChange(f: ServerFields): void
  onSecurity(s: Security): void
}) {
  return (
    <fieldset className="mail-server">
      <legend>{label}</legend>
      <input
        className="k-input mail-server-host"
        aria-label={`${label}: server`}
        placeholder="mail.example.com"
        value={fields.host}
        onChange={(e) => onChange({ ...fields, host: e.target.value })}
        spellCheck={false}
        autoComplete="off"
      />
      <input
        className="k-input mail-server-port"
        aria-label={`${label}: port`}
        inputMode="numeric"
        value={fields.port}
        onChange={(e) => onChange({ ...fields, port: e.target.value.replace(/\D/g, '').slice(0, 5) })}
      />
      <select
        className="k-input mail-server-security"
        aria-label={`${label}: security`}
        value={fields.security}
        onChange={(e) => onSecurity(e.target.value as Security)}
      >
        <option value="ssl">SSL/TLS</option>
        <option value="starttls">STARTTLS</option>
        <option value="none">None</option>
      </select>
    </fieldset>
  )
}
