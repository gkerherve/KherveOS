// Browser-side helpers: SVG → PNG, safe file names, recent files.

export const safeName = (name: string): string => name.trim().replace(/[^\w.+-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'kmech'

/** The SVG text drawn on a canvas and returned as PNG bytes. */
export function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('The browser gave no canvas to draw on.')); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvas.toBlob(async (b) => (b ? resolve(new Uint8Array(await b.arrayBuffer())) : reject(new Error('The picture could not be made.'))), 'image/png')
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The figure could not be drawn as an image.')) }
    img.src = url
  })
}

const RECENT_KEY = 'kherveos.kmech.recent'

export function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, 8) : []
  } catch { return [] }
}

export function pushRecent(path: string): string[] {
  const list = [path, ...loadRecent().filter((p) => p !== path)].slice(0, 8)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)) } catch { /* storage blocked */ }
  return list
}

const PREFS_KEY = 'kherveos.kmech.prefs'

export function loadPrefs<T extends object>(defaults: T, key = PREFS_KEY): T {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>
    const out = { ...defaults } as Record<string, unknown>
    for (const [k, v] of Object.entries(raw)) if (k in defaults && typeof v === typeof (defaults as Record<string, unknown>)[k]) out[k] = v
    return out as T
  } catch { return defaults }
}

export function savePrefs<T extends object>(prefs: T, key = PREFS_KEY): void {
  try { localStorage.setItem(key, JSON.stringify(prefs)) } catch { /* storage blocked */ }
}
