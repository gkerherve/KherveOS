// KherveOS's wallpapers: the kTools Advanced Tech Lab picture (the user's artwork, with
// floor added below so its caption sits above the Dock), and the green science pictures
// drawn by tools/make_wallpapers.py. Each is a file in public/wallpapers/.

import type { WallpaperFit } from '@/os/settings'

export interface Wallpaper {
  id: string
  name: string
  /** The file in public/wallpapers/. */
  file: string
  /** The picture's own size, for "Centre". */
  natural: string
  /** Where the picture is anchored when it covers the screen. */
  anchor: string
}

// The lab picture is anchored at the bottom: on wide screens the top is cropped, never the caption.
export const WALLPAPERS: Wallpaper[] = [
  { id: 'ktools-lab', name: 'kTools – Advanced Tech Lab', file: 'ktools-tech-lab.webp', natural: '1376px 858px', anchor: '50% 100%' },
  { id: 'graphene', name: 'Graphene', file: 'graphene.webp', natural: '2560px 1440px', anchor: '50% 50%' },
  { id: 'molecules', name: 'Molecules', file: 'molecules.webp', natural: '2560px 1440px', anchor: '50% 50%' },
  { id: 'periodic', name: 'Periodic table', file: 'periodic.webp', natural: '2560px 1440px', anchor: '50% 50%' },
  { id: 'formulas', name: 'Equations', file: 'formulas.webp', natural: '2560px 1440px', anchor: '50% 50%' },
  { id: 'dna', name: 'DNA', file: 'dna.webp', natural: '2560px 1440px', anchor: '50% 50%' },
]

/** The wallpaper with this id, or the first one (the lab picture) when the id is unknown. */
export function wallpaperOf(id: string): Wallpaper {
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0]
}

const BASE = '#050706'

/** How the wallpaper fits the screen (Settings › Wallpaper). */
export const WALLPAPER_FITS: { id: WallpaperFit; name: string; tip: string }[] = [
  { id: 'fill', name: 'Fill', tip: 'Cover the whole screen (the edges are cropped if the screen has another shape)' },
  { id: 'fit', name: 'Fit', tip: 'Show the whole picture' },
  { id: 'centre', name: 'Centre', tip: 'The picture at its own size, in the middle' },
]

/** `centreSize`: the picture's size at "Centre" (a preview passes a scaled-down one). */
export function wallpaperCss(fit: WallpaperFit = 'fill', centreSize?: string, id = 'ktools-lab'): string {
  const w = wallpaperOf(id)
  const url = `url('/wallpapers/${w.file}')`
  if (fit === 'fit') return `50% 50% / contain no-repeat ${url}, ${BASE}`
  if (fit === 'centre') return `50% 50% / ${centreSize ?? w.natural} no-repeat ${url}, ${BASE}`
  return `${w.anchor} / cover no-repeat ${url}, ${BASE}`
}
