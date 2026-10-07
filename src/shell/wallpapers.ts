// KherveOS has one wallpaper: the Ktools Advanced Tech Lab.

import type { WallpaperFit } from '@/os/settings'

export interface Wallpaper {
  id: string
  name: string
  css: string
}

// The picture is the user's artwork upscaled 3× by Real-ESRGAN (tools/upscale_wallpaper.py, then
// tools/make_wallpaper.py), with floor added below it
// (a fading reflection), so its caption sits above the Dock. Anchored at the
// bottom: on wide screens the top is what gets cropped, never the caption.
export const WALLPAPER: Wallpaper = {
  id: 'ktools-lab',
  name: 'Ktools – Advanced Tech Lab',
  css: `50% 100% / cover no-repeat url('/wallpapers/ktools-tech-lab.webp'), #050706`,
}

const URL_ = `url('/wallpapers/ktools-tech-lab.webp')`
const BASE = '#050706'
/** The artwork's own size: the file is a 3× upscale of it (4128 × 2574). */
const NATURAL = '1376px 858px'

/** How the wallpaper fits the screen (Settings › Appearance › Wallpaper). */
export const WALLPAPER_FITS: { id: WallpaperFit; name: string; tip: string }[] = [
  { id: 'fill', name: 'Fill', tip: 'Cover the whole screen (the top is cropped on wide screens)' },
  { id: 'fit', name: 'Fit', tip: 'Show the whole picture' },
  { id: 'centre', name: 'Centre', tip: 'The picture at its own size, in the middle' },
]

/** `centreSize`: the picture's size at "Centre" (a preview passes a scaled-down one). */
export function wallpaperCss(fit: WallpaperFit = 'fill', centreSize = NATURAL): string {
  if (fit === 'fit') return `50% 50% / contain no-repeat ${URL_}, ${BASE}`
  if (fit === 'centre') return `50% 50% / ${centreSize} no-repeat ${URL_}, ${BASE}`
  return WALLPAPER.css
}
