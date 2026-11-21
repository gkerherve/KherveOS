// kTeX in KherveOS: the React kTeX (../KherveTeX-React), built for the browser
// into public/apps/ktex-react/ and shown whole in the window. Refresh it with
//   (cd ../KherveTeX-React && npx vite build --outDir ../KherveOS/public/apps/ktex-react --emptyOutDir)
// The browser build edits, opens and saves .ktex files but cannot compile:
// tectonic only runs in the desktop app (the older kTeX, "kTeX classic", compiles
// through the KherveOS server when one is running).
import type { AppProps } from '@/os'

export default function KTeXReact(_: AppProps) {
  return (
    <iframe
      title="kTeX"
      src={`${import.meta.env.BASE_URL}apps/ktex-react/index.html`}
      style={{ border: 0, width: '100%', height: '100%', display: 'block', background: '#fff' }}
      allow="clipboard-read; clipboard-write; fullscreen"
    />
  )
}
