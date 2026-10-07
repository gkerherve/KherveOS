// isomorphic-git uses Node's Buffer as a global; the browser has none.
// Imported (for its side effect) before isomorphic-git is used.

import { Buffer } from 'buffer'

const scope = globalThis as { Buffer?: unknown }
if (!scope.Buffer) scope.Buffer = Buffer
