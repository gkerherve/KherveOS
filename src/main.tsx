import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './shell/shell.css'
import { Shell } from './shell/Shell'
import { fs } from './os/vfs'
import { installCrashReporter } from './os/crash'

installCrashReporter()

const root = createRoot(document.getElementById('root')!)

if (import.meta.env.DEV) {
  // A handle for debugging from the browser console: kherveos.os.open('files')
  void Promise.all([import('./os'), import('./os/windows')]).then(([m, w]) => {
    Object.assign(window, { kherveos: { os: m.os, fs: m.fs, windows: w.useWindows } })
  })
}

fs.ready.then(
  () => root.render(<Shell />),
  (err) => {
    console.error(err)
    root.render(
      <div className="k-boot-error">
        <h1>KherveOS could not start</h1>
        <p>
          It keeps your files in this browser's storage (IndexedDB), which is not available here. Private windows and some
          privacy settings block it — try a normal window.
        </p>
        <pre>{String(err)}</pre>
      </div>,
    )
  },
)
