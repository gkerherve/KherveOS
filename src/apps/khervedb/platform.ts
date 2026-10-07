// Desktop (Tauri) vs web: KherveOS runs the web path. There is no references
// window with built-in browser tabs; the reference sites open in a new browser
// tab, because most of them refuse to be shown inside a frame.

/** Open a reference site in a new browser tab. */
export function openInBrowser(url: string) {
  if (!/^https?:\/\//i.test(url)) return
  window.open(url, '_blank', 'noopener')
}
