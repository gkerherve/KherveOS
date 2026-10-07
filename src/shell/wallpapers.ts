// KherveOS has one wallpaper: the Ktools Advanced Tech Lab.

export interface Wallpaper {
  id: string
  name: string
  css: string
}

// The picture is the user's artwork at twice its size (tools/make_wallpaper.py), with floor added below it
// (a fading reflection), so its caption sits above the Dock. Anchored at the
// bottom: on wide screens the top is what gets cropped, never the caption.
export const WALLPAPER: Wallpaper = {
  id: 'ktools-lab',
  name: 'Ktools – Advanced Tech Lab',
  css: `50% 100% / cover no-repeat url('/wallpapers/ktools-tech-lab.webp'), #050706`,
}

export function wallpaperCss(): string {
  return WALLPAPER.css
}
