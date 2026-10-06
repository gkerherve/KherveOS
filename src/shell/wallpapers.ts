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
    id: 'graphite',
    name: 'Graphite',
    css: `radial-gradient(1200px 800px at 50% 0%, #475569, transparent 70%), #111827`,
  },
]

export function wallpaperCss(id: string): string {
  return (WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0]).css
}
