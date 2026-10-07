// What is left after Shut Down…: the ringed Ꝃ on black, and a way back.

import { KLogo } from './KLogo'

export function ShutdownScreen() {
  return (
    <div className="k-shutdown" role="alertdialog" aria-label="KherveOS is shut down">
      <KLogo size={72} className="k-shutdown-logo" />
      <h1>KherveOS is shut down</h1>
      <p>Your files are saved on this computer. You can close this window.</p>
      <button className="k-btn primary" autoFocus onClick={() => location.reload()}>
        Start KherveOS
      </button>
    </div>
  )
}
