// The parts of screenshots that need no browser (tested with node --test):
// macOS-style file names and fitting a picture into a size.

const pad = (n: number) => String(n).padStart(2, '0')

/** "Screenshot 2026-10-07 at 14.03.27.png", like macOS (local time). */
export function screenshotFileName(d: Date = new Date()): string {
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`
  return `Screenshot ${day} at ${time}.png`
}

/** A free name in `taken`: "x.png", else "x 2.png", "x 3.png"… (two shots in the same second). */
export function freeName(name: string, taken: (name: string) => boolean): string {
  if (!taken(name)) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 2; ; i++) {
    const n = `${stem} ${i}${ext}`
    if (!taken(n)) return n
  }
}

/** The size of a w×h picture shrunk (never grown) so its longer side is at most `max`. */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number; scale: number } {
  const long = Math.max(w, h)
  const scale = long > max && long > 0 ? max / long : 1
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)), scale }
}

/** "data:image/png;base64,AAAA" → { mime: 'image/png', data: 'AAAA' } (null if it is not a base64 data URL). */
export function splitDataUrl(url: string): { mime: string; data: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url)
  return m ? { mime: m[1], data: m[2] } : null
}
