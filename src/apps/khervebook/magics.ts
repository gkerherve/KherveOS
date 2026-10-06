// The few IPython-style lines KherveBook understands before code reaches Python:
//
//   %pip install pkg …   (or !pip install)  → installed with micropip first
//   %matplotlib inline                      → ignored: figures are always shown
//
// Handled lines are blanked rather than removed, so line numbers in
// tracebacks still match the cell.

export interface PreparedCode {
  /** What is sent to Python. */
  code: string
  /** Packages to pip-install before running. */
  packages: string[]
  /** Messages for the user (shown on stderr). */
  notes: string[]
  /** 1-based lines that look like other IPython magics or shell commands. */
  magicLines: number[]
}

const PIP = /^\s*[%!]\s*pip3?(?:\s+(.*))?$/
const MATPLOTLIB = /^\s*%matplotlib\b/
const OTHER_MAGIC = /^\s*(?:%%?[A-Za-z]|![A-Za-z./~])/
/** pip options followed by a value we have to skip too. */
const TAKES_VALUE = new Set(['-r', '--requirement', '-c', '--constraint', '-i', '--index-url', '--extra-index-url', '-f', '--find-links', '-t', '--target', '--python-version', '--platform'])

function splitArgs(s: string): string[] {
  const out: string[] = []
  for (const m of s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

export function prepareCode(source: string): PreparedCode {
  const packages: string[] = []
  const notes: string[] = []
  const magicLines: number[] = []
  const lines = source.split('\n').map((line, i) => {
    const pip = PIP.exec(line)
    if (pip) {
      const args = splitArgs(pip[1] ?? '')
      if (args[0] !== 'install') {
        notes.push(`Line ${i + 1}: only "%pip install …" is supported in KherveBook.`)
        return ''
      }
      let skip = false
      for (const a of args.slice(1)) {
        if (skip) {
          skip = false
          continue
        }
        if (TAKES_VALUE.has(a)) {
          skip = true
          if (a === '-r' || a === '--requirement') notes.push(`Line ${i + 1}: requirements files are not supported; list the packages instead.`)
          continue
        }
        if (a.startsWith('-')) continue // -q, -U, --upgrade, --quiet…
        packages.push(a)
      }
      if (args.length === 1) notes.push(`Line ${i + 1}: %pip install needs at least one package name.`)
      return ''
    }
    if (MATPLOTLIB.test(line)) return ''
    if (OTHER_MAGIC.test(line)) magicLines.push(i + 1)
    return line
  })
  return { code: lines.join('\n'), packages: [...new Set(packages)], notes, magicLines }
}

export const MAGIC_HINT =
  '\n\nKherveBook runs plain Python: IPython magics (%time, %%capture…) and shell commands (!ls) are not available. ' +
  'Only "%pip install <package>" is understood.'
