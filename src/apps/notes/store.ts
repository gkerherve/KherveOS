// Notes: the one library of this page (~/Notes on the drive), shared by the
// Notes window and its AI tools, and kept in step with the drive and — when
// signed in — with the server (sync.ts).

import { fs, HOME } from '@/os'
import { NotesLibrary } from './library'
import { NotesSync } from './sync'

export const NOTES_ROOT = `${HOME}/Notes`

export const library = new NotesLibrary(fs, NOTES_ROOT)

export const notesSync = new NotesSync(library)

let users = 0
let stop: (() => void) | null = null

/** Start watching the drive and syncing (once, while a Notes window is open). Returns a release function. */
export function startLibraryService(): () => void {
  users++
  if (users === 1) {
    const unwatch = fs.watch((ev) => {
      library.noticeFsEvent(ev.path, ev.type === 'rename' ? ev.oldPath : undefined)
    })
    void fs.ready.then(() => library.load())
    const unsync = notesSync.start()
    stop = () => {
      unwatch()
      unsync()
    }
  }
  return () => {
    users--
    if (users === 0) {
      stop?.()
      stop = null
    }
  }
}
