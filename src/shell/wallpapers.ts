// Built-in wallpapers. "kherve" follows the theme's accent colour.

export interface Wallpaper {
  id: string
  name: string
  css: string
}

export const WALLPAPERS: Wallpaper[] = [
  // The fist is right of centre: keep it in view when the screen is narrow.
  {
    id: 'ktool-green',
    name: 'Ktools fist (green)',
    css: `62% 50% / cover no-repeat url('/wallpapers/ktool-fist-green.webp'), #050a06`,
  },
  {
    id: 'ktool',
    name: 'Ktools fist (red)',
    css: `62% 50% / cover no-repeat url('/wallpapers/ktool-fist.webp'), #0a0505`,
  },
  // "An OS for the people": a ring of people holding hands around the emblem (tools/make_wallpaper.py).
  {
    id: 'together-red',
    name: 'Together (red)',
    css: `center / cover no-repeat url('/wallpapers/together-red.svg'), #0d0808`,
  },
  {
    id: 'together-green',
    name: 'Together (green)',
    css: `center / cover no-repeat url('/wallpapers/together-green.svg'), #070c09`,
  },
  {
    id: 'kherve',
    name: 'Kherve (theme)',
    css: `radial-gradient(1200px 700px at 12% 18%, color-mix(in srgb, var(--k-accent) 55%, transparent), transparent 60%),
          radial-gradient(900px 600px at 88% 85%, color-mix(in srgb, var(--k-accent) 35%, transparent), transparent 65%),
          linear-gradient(160deg, color-mix(in srgb, var(--k-desk) 70%, var(--k-accent)), var(--k-desk))`,
  },
  {
    id: 'aurora',
    name: 'Aurora',
    css: `radial-gradient(900px 500px at 20% 20%, #34d39988, transparent 60%),
          radial-gradient(800px 600px at 80% 30%, #60a5fa88, transparent 60%),
          radial-gradient(900px 700px at 50% 100%, #a78bfa88, transparent 60%), #0b1220`,
  },
  {
    id: 'dusk',
    name: 'Dusk',
    css: `linear-gradient(170deg, #1e1b4b 0%, #7c3aed 45%, #f97316 85%, #fbbf24 100%)`,
  },
  {
    id: 'ocean',
    name: 'Ocean',
    css: `radial-gradient(1000px 600px at 70% 10%, #67e8f966, transparent 60%), linear-gradient(180deg, #0c4a6e, #082f49 60%, #020617)`,
  },
  {
    id: 'meadow',
    name: 'Meadow',
    css: `radial-gradient(900px 500px at 30% 15%, #fef08a99, transparent 60%), linear-gradient(180deg, #bbf7d0, #4ade80 55%, #166534)`,
  },
  {
    id: 'graphite',
    name: 'Graphite',
    css: `radial-gradient(1200px 800px at 50% 0%, #475569, transparent 70%), #111827`,
  },
  { id: 'solid', name: 'Plain (theme)', css: 'var(--k-desk)' },
]

export function wallpaperCss(id: string): string {
  return (WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0]).css
}
