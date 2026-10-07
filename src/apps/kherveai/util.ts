// Small helpers shared by KherveAI's modules.

export function uid(prefix = ''): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 20)
  } catch {
    /* not a secure context */
  }
  return prefix + Math.random().toString(36).slice(2, 12) + Date.now().toString(36)
}

/** A tool call id every provider accepts (letters, digits, _ and -). */
export function callId(id?: unknown): string {
  const s = typeof id === 'string' ? id.replace(/[^a-zA-Z0-9_-]/g, '_') : ''
  return s || uid('call_')
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name
  if (typeof e === 'string') return e
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException ? e.name === 'AbortError' : e instanceof Error && e.name === 'AbortError'
}

/** JSON that never throws (cycles, BigInt…). */
export function safeJson(v: unknown, indent?: number): string {
  try {
    const seen = new WeakSet<object>()
    const s = JSON.stringify(
      v,
      (_k, x: unknown) => {
        if (typeof x === 'bigint') return x.toString()
        if (x && typeof x === 'object') {
          if (seen.has(x)) return '[circular]'
          seen.add(x)
        }
        return x
      },
      indent,
    )
    return s ?? String(v)
  } catch {
    return String(v)
  }
}

/** Keep the start and the end of a long text, with a note about the middle. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const head = Math.floor(max * 0.8)
  const tail = max - head
  return `${text.slice(0, head)}\n… [${(text.length - max).toLocaleString()} characters left out] …\n${text.slice(text.length - tail)}`
}

/** "just now", "5 min ago", "Yesterday", "3 Oct"… */
export function shortWhen(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000)
  if (s < 50) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  const d = new Date(ms)
  const today = new Date(now)
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const y = new Date(now - 86_400_000)
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })
}

export function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback for browsers that refuse the async clipboard.
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}
