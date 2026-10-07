// KhervePY — a light, GitHub-first Python IDE (KherveOS port of the desktop
// app ../khervePY, PyQt6 + QScintilla).
//
// Like the desktop app: a toolbar with the actions reached for most (branch
// chip first), the Project / Search dock on the left, tabbed editors with
// auto-save, the Git / Log dock on the right, Output / Diff at the bottom.
// Python runs in the window's own Pyodide kernel; Git is the shared Git
// service (src/os/services/git.ts) — GitHub through the KherveOS server.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { StateEffect } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { copyLineDown, deleteLine, moveLineDown, moveLineUp, redo, selectAll, toggleComment, undo } from '@codemirror/commands'
import { gotoLine, openSearchPanel } from '@codemirror/search'
import {
  ChevronDown, Code2, Copy, FilePlus, FileSearch, FileText, FolderOpen, GitBranch, GitFork, History, KeyRound, LoaderCircle,
  Package, PanelBottom, PanelLeft, PanelRight, Play, RefreshCw, Replace, Save, SaveAll, Search, Square, SquareTerminal,
  Trash2, CloudUpload, ArrowDownToLine, ArrowUpFromLine, X, Info, ExternalLink, UserRound, Eraser,
} from 'lucide-react'
import { os, fs, path, HOME, type AppProps, type MenuBarMenu, type MenuItem } from '@/os'
import { CodeEditor, type EditorLanguage } from '@/os/ui/CodeEditor'
import * as git from '@/os/services/git'
import { DEFAULT_PREFS, loadPrefs, pushRecent, savePrefs, type BottomTab, type LeftTab, type Prefs, type RightTab } from './prefs'
import { isDirty, useEditors } from './editors'
import { useRepo } from './repo'
import { missingModule, parseRequirements, useRunner } from './runner'
import { changeBar, hasChangeBar, setChangeMarkers } from './changeBar'
import { ProjectTree } from './ProjectTree'
import { SearchPanel, type SearchPanelHandle } from './SearchPanel'
import { GitPanel, type GitActions } from './GitPanel'
import { LogPanel } from './LogPanel'
import { OutputPanel } from './OutputPanel'
import { DiffView, type DiffContent } from './DiffView'
import { CloneDialog, CommitPushDialog, IdentityDialog, ReposDialog, TokenDialog } from './dialogs'
import './khervepy.css'

const VERSION = '0.40.1-os'
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
const MOD = isMac ? '⌘' : 'Ctrl+'

const LANG_NAMES: Record<EditorLanguage, string> = {
  python: 'Python', markdown: 'Markdown', javascript: 'JavaScript', typescript: 'TypeScript', json: 'JSON', latex: 'LaTeX', plain: 'Plain text',
}

type DialogState =
  | { kind: 'token' }
  | { kind: 'clone'; url?: string }
  | { kind: 'commitPush' }
  | { kind: 'identity' }
  | { kind: 'repos' }

/** A project's obvious script: main.py, or one named after the folder (the desktop app's rule). */
function entryPoint(root: string): string | null {
  for (const name of ['main.py', `${path.basename(root)}.py`]) {
    const p = path.join(root, name)
    if (fs.isFile(p)) return p
  }
  return null
}

function initialProject(args: AppProps['args'], prefs: Prefs): { root: string; file: string | null } {
  const p = typeof args.path === 'string' ? args.path : null
  if (p && fs.isDir(p)) return { root: p, file: null }
  if (p && fs.isFile(p)) return { root: git.findRoot(path.dirname(p)) ?? path.dirname(p), file: p }
  if (prefs.lastProject && fs.isDir(prefs.lastProject)) return { root: prefs.lastProject, file: null }
  return { root: fs.isDir(`${HOME}/Documents`) ? `${HOME}/Documents` : HOME, file: null }
}

/** A callback whose identity never changes but which always runs the latest code (keeps memo'd panels still). */
function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback((...args: A) => ref.current(...args), [])
}

/** A drag handle between docks. `sign` says which way growing goes. */
function Splitter({ axis, size, sign, min, max, onSize, onDone }: {
  axis: 'x' | 'y'
  size: number
  sign: 1 | -1
  min: number
  max: number
  onSize: (n: number) => void
  onDone: () => void
}) {
  const start = (e: ReactPointerEvent) => {
    e.preventDefault()
    const from = axis === 'x' ? e.clientX : e.clientY
    const initial = size
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    document.body.classList.add('k-dragging')
    const move = (ev: PointerEvent) => {
      const delta = (axis === 'x' ? ev.clientX : ev.clientY) - from
      onSize(Math.round(Math.max(min, Math.min(max, initial + sign * delta))))
    }
    const up = () => {
      document.body.classList.remove('k-dragging')
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
      onDone()
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }
  return <div className={`kpy-split ${axis}`} onPointerDown={start} />
}

function DockTabs<T extends string>({ tabs, value, onChange, children }: {
  tabs: [T, string][]
  value: T
  onChange: (v: T) => void
  children?: ReactNode
}) {
  return (
    <div className="kpy-dock-tabs">
      {tabs.map(([id, label]) => (
        <button key={id} className={`kpy-dock-tab${value === id ? ' active' : ''}`} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
      <span className="kpy-spacer" />
      {children}
    </div>
  )
}

export default function KhervePY({ win, args }: AppProps) {
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const setPrefs = useCallback((fn: (p: Prefs) => Prefs) => {
    setPrefsState((p) => {
      const next = fn(p)
      savePrefs(next)
      return next
    })
  }, [])
  const [initial] = useState(() => initialProject(args, prefs))
  const [project, setProject] = useState(initial.root)
  const [message, setMessage] = useState(`KhervePY ${VERSION} — ready`)
  const [sizes, setSizes] = useState(prefs.sizes)
  const [diff, setDiff] = useState<(DiffContent & { file?: string }) | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [cursor, setCursor] = useState({ line: 1, col: 1 })
  const [ghLogin, setGhLogin] = useState(git.getGithubLogin())
  const [ghToken, setGhToken] = useState(!!git.getGithubToken())
  const searchRef = useRef<SearchPanelHandle>(null)
  /** Resolves the identity dialog opened by ensureIdentity(). */
  const identityDone = useRef<((ok: boolean) => void) | null>(null)

  const status = useCallback((m: string) => setMessage(m), [])
  const projectRef = useRef(project)
  projectRef.current = project

  const editors = useEditors({ autoSave: prefs.autoSave, defaultDir: () => projectRef.current, status })
  const repo = useRepo(project, status)
  const runner = useRunner(`khervepy-${win.id}`)
  const active = editors.active

  useEffect(
    () =>
      git.onSettingsChange(() => {
        setGhLogin(git.getGithubLogin())
        setGhToken(!!git.getGithubToken())
      }),
    [],
  )

  // ------------------------------------------------------------ project

  const showDock = useCallback(
    (side: 'left' | 'right' | 'bottom', tab?: string) =>
      setPrefs((p) => ({ ...p, docks: { ...p.docks, [side]: true }, tabs: tab ? { ...p.tabs, [side]: tab } : p.tabs })),
    [setPrefs],
  )

  const switchProject = useCallback(
    async (root: string, opts: { openEntry?: boolean } = {}) => {
      if (!fs.isDir(root)) {
        await os.dialog.alert(`“${root}” isn’t a folder any more.`, { title: 'KhervePY' })
        return
      }
      if (root !== projectRef.current) {
        // Like the desktop app: files from the old project close (auto-saved first).
        const outside = editors.tabs.filter((t) => t.path && !path.isInside(t.path, root)).map((t) => t.id)
        if (outside.length && !(await editors.closeMany(outside))) return
        setProject(root)
      }
      setPrefs((p) => ({ ...p, lastProject: root, recent: pushRecent(p.recent, root) }))
      if (opts.openEntry) {
        const entry = entryPoint(root)
        if (entry) {
          await editors.open(entry)
          status(`Opened ${path.basename(entry)} — press F5 to run.`)
        } else status(`Opened ${path.basename(root)} — no main.py found; open a file to run.`)
      } else status(`Project: ${path.pretty(root)}`)
    },
    [editors, setPrefs, status],
  )

  // Open what we were asked to open — or the last session's tabs.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    setPrefs((p) => ({ ...p, lastProject: initial.root, recent: pushRecent(p.recent, initial.root) }))
    void (async () => {
      if (initial.file) {
        await editors.open(initial.file)
        return
      }
      const s = prefs.session
      if (s.project === initial.root && s.files.length) {
        for (const f of s.files) if (fs.isFile(f) && path.isInside(f, initial.root)) await editors.open(f)
        if (s.active && fs.isFile(s.active)) await editors.open(s.active)
      } else {
        const entry = entryPoint(initial.root)
        if (entry) await editors.open(entry)
      }
    })()
  }, [editors, initial, prefs.session, setPrefs])

  // Opened again with a file or folder (double-click in Files…).
  const lastArg = useRef(args.path)
  useEffect(() => {
    const p = typeof args.path === 'string' ? args.path : null
    if (!p || p === lastArg.current) return
    lastArg.current = p
    if (fs.isDir(p)) void switchProject(p, { openEntry: true })
    else if (fs.isFile(p)) {
      if (!path.isInside(p, projectRef.current)) void switchProject(git.findRoot(path.dirname(p)) ?? path.dirname(p))
      void editors.open(p)
    }
  }, [args.path, editors, switchProject])

  // Remember the open tabs for next time.
  const sessionKey = editors.tabs.map((t) => t.path ?? '').join('|') + '#' + (active?.path ?? '')
  useEffect(() => {
    const files = editors.tabs.map((t) => t.path).filter((p): p is string => !!p)
    setPrefs((p) => ({ ...p, session: { project, files, active: active?.path ?? null } }))
  }, [sessionKey, project])

  // ------------------------------------------------------------- title

  const dirtyCount = editors.tabs.filter(isDirty).length
  useEffect(() => {
    const name = active ? `${isDirty(active) ? '• ' : ''}${active.title} — ` : ''
    win.setTitle(`${name}${path.basename(project) || project} — KhervePY`)
  }, [win, active, project])
  useEffect(() => win.setDocumentPath(active?.path ?? null), [win, active?.path])

  // Ask before closing with unsaved edits (auto-saved files are just written).
  const live = useRef({ editors })
  live.current = { editors }
  useEffect(() => {
    win.setCloseGuard(async () => {
      const left = await live.current.editors.flush()
      if (!left.length) return true
      const names = left.map((t) => `“${t.title}”`).join(', ')
      const choice = await os.dialog.choose(
        `Save the changes to ${names} before closing?`,
        [
          { label: 'Cancel', value: 'cancel' },
          { label: 'Don’t Save', value: 'discard', danger: true },
          { label: left.length > 1 ? 'Save All' : 'Save', value: 'save', primary: true },
        ],
        { title: 'Unsaved changes' },
      )
      if (choice === 'save') return live.current.editors.saveAll()
      return choice === 'discard'
    })
    return () => win.setCloseGuard(null)
  }, [win])

  // --------------------------------------------------------- change bar

  const headCache = useRef(new Map<string, string | null>())
  useEffect(() => headCache.current.clear(), [repo.version, repo.root])
  const activeText = active?.text
  useEffect(() => {
    const tab = editors.active
    const view = tab ? editors.view(tab.id) : null
    if (!tab || !view || !hasChangeBar(view)) return
    const root = repo.root
    if (!tab.path || !root || !path.isInside(tab.path, root)) {
      view.dispatch({ effects: setChangeMarkers.of(null) })
      return
    }
    const rel = tab.path.slice(root.length + 1)
    let stale = false
    const timer = window.setTimeout(async () => {
      let base = headCache.current.get(rel)
      if (base === undefined) {
        base = await git.readTextAtCommit(root, 'HEAD', rel).catch(() => null)
        headCache.current.set(rel, base)
      }
      if (stale) return
      const st = repo.statusOf(tab.path!)
      const markers =
        base !== null
          ? git.lineMarkers(base, tab.text)
          : st === 'untracked' || st === 'added'
            ? { added: Array.from({ length: view.state.doc.lines }, (_, i) => i), modified: [], deleted: [] }
            : null
      view.dispatch({ effects: setChangeMarkers.of(markers) })
    }, 250)
    return () => {
      stale = true
      window.clearTimeout(timer)
    }
  }, [active?.id, activeText, repo.version, repo.root])

  // ---------------------------------------------------------------- files

  const openFolder = async () => {
    const p = await os.dialog.pickFolder({ title: 'Open Folder', startDir: project })
    if (p) await switchProject(p, { openEntry: true })
  }

  const openFileDialog = async () => {
    const p = await os.dialog.openFile({ title: 'Open File', startDir: active?.path ? path.dirname(active.path) : project })
    if (p) await editors.open(p)
  }

  const newPythonFile = async () => {
    const p = await os.dialog.saveFile({ title: 'New Python File', defaultName: path.join(project, 'untitled.py'), extensions: ['.py'] })
    if (!p) return
    try {
      if (!fs.exists(p)) await fs.writeText(p, '')
      await editors.open(p)
    } catch (e) {
      await os.dialog.alert(`Could not create ${path.basename(p)}: ${e instanceof Error ? e.message : String(e)}`, { title: 'New Python File' })
    }
  }

  const view = (): EditorView | null => editors.view(active?.id ?? null)
  const cmd = (fn: (v: EditorView) => boolean) => () => {
    const v = view()
    if (v) {
      fn(v)
      v.focus()
    }
  }

  const findInFiles = () => {
    showDock('left', 'search')
    const v = view()
    const sel = v ? v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to) : ''
    // The dock may only mount on this render.
    window.setTimeout(() => searchRef.current?.focus(sel && !sel.includes('\n') ? sel : undefined), 30)
  }

  const openAt = useStable((p: string, line?: number) => void editors.open(p, line ? { line } : {}))
  const openInTree = useStable((p: string) => openAt(p))

  // ------------------------------------------------------------------ run

  const runCurrent = async () => {
    if (runner.running) return
    const tab = editors.active
    if (!tab) return status('Nothing to run — open a Python file first.')
    let file = tab.path
    if (!file || isDirty(tab)) file = await editors.save(tab.id)
    if (!file) return
    if (!file.endsWith('.py')) return status('Run supports .py files.')
    if (!path.isInside(file, HOME)) {
      await os.dialog.alert('Python can only run files in your home folder (~). Save the file there first.', { title: 'Run' })
      return
    }
    await editors.flush() // the script may import the project's other modules
    showDock('bottom', 'output')
    runner.clear()
    const cwd = path.isInside(project, HOME) ? project : path.dirname(file)
    const label = path.isInside(file, cwd) ? file.slice(cwd.length + 1) : file
    status(`Running ${path.basename(file)}…`)
    const r = await runner.run(file, cwd, label)
    status(r.stopped ? 'Program stopped.' : r.exitCode === 0 ? 'Process finished (exit code 0).' : `Process exited (${r.exitCode ?? 'error'}).`)
    const missing = !r.stopped && r.exitCode !== 0 ? missingModule(r.stderr) : null
    if (missing) {
      const install = await os.dialog.confirm(
        `The script stopped because “${missing.module}” is not installed.\n\nInstall ${missing.pip} into this window’s Python (with micropip)? Pure-Python packages and the ones Pyodide provides can be installed.`,
        { title: 'Missing module', okLabel: 'Install' },
      )
      if (install && (await runner.install([missing.pip]))) {
        if (await os.dialog.confirm(`${missing.pip} was installed. Run the script again?`, { title: 'Installed', okLabel: 'Run' })) void runCurrent()
      }
    }
  }

  const stopRun = async () => {
    if (!runner.running) return status('Nothing is running.')
    status('Stopping the running program…')
    await runner.stop()
  }

  const installPackages = async () => {
    const names = await os.dialog.prompt('Packages to install (separated by spaces), e.g. “requests rich”:', { title: 'Install Packages', okLabel: 'Install' })
    const list = names?.split(/\s+/).filter(Boolean) ?? []
    if (!list.length) return
    showDock('bottom', 'output')
    status(`Installing ${list.join(', ')}…`)
    status((await runner.install(list)) ? `Installed ${list.join(', ')}.` : 'pip install failed — see the Output panel.')
  }

  const installRequirements = async () => {
    const req = path.join(project, 'requirements.txt')
    if (!fs.isFile(req)) {
      await os.dialog.alert('This project has no requirements.txt in its folder.', { title: 'Requirements' })
      return
    }
    const list = parseRequirements(await fs.readText(req))
    if (!list.length) return status('requirements.txt lists no packages.')
    if (!(await os.dialog.confirm(`Install the ${list.length} package(s) of requirements.txt into this window’s Python?\n\n${list.join('\n')}`, { title: 'Requirements', okLabel: 'Install' }))) return
    showDock('bottom', 'output')
    status((await runner.install(list)) ? 'Requirements installed.' : 'pip install failed — see the Output panel.')
  }

  // ------------------------------------------------------------------ git

  const netError = (title: string) => async (e: unknown) => {
    const code = (e as { code?: string } | null)?.code
    const msg = git.describeGitError(e)
    if (code === 'AuthRequired' || code === 'AuthFailed' || code === 'Forbidden') {
      if (await os.dialog.confirm(msg, { title, okLabel: 'Set Token…' })) setDialog({ kind: 'token' })
    } else if (code === 'MissingNameError') {
      if (await os.dialog.confirm(msg, { title, okLabel: 'Set Identity…' })) setDialog({ kind: 'identity' })
    } else await os.dialog.alert(msg, { title })
  }

  const ensureIdentity = async (): Promise<git.Identity | null> => {
    const root = repo.root
    const have = root ? await git.resolveIdentity(root) : git.getGlobalIdentity()
    if (have) return have
    const ok = await new Promise<boolean>((resolve) => {
      identityDone.current?.(false)
      identityDone.current = resolve
      setDialog({ kind: 'identity' })
    })
    return ok ? (root ? git.resolveIdentity(root) : git.getGlobalIdentity()) : null
  }

  const needRepo = async (): Promise<string | null> => {
    if (repo.root) return repo.root
    await os.dialog.alert('This project isn’t a Git repository. Use Git › Initialize Repository, or clone one.', { title: 'Git' })
    return null
  }

  const doCommit = async (msg: string, then?: 'push'): Promise<boolean> => {
    const root = await needRepo()
    if (!root) return false
    if (!msg.trim()) {
      status('Write a commit message first.')
      return false
    }
    await editors.flush()
    const files = await git.status(root) // fresh: auto-save may just have written
    let stageAll = false
    if (!files.some((f) => f.staged !== ' ')) {
      if (!files.length) {
        await os.dialog.alert('Nothing to commit — the working tree is clean.', { title: 'Commit' })
        return false
      }
      stageAll = await os.dialog.confirm('There are no staged changes. Stage all your changes and commit them?', { title: 'Commit', okLabel: 'Stage All & Commit' })
      if (!stageAll) return false
    }
    const author = await ensureIdentity()
    if (!author) return false
    const oid = await repo.run('Committing…', async () => {
      if (stageAll) await git.stageAll(root)
      return git.commit(root, { message: msg, author })
    })
    if (!oid) return false
    status(`Committed ${oid.slice(0, 7)}.`)
    if (then === 'push') await doPush()
    return true
  }

  const doPush = async () => {
    const root = await needRepo()
    if (!root) return
    const ok = await repo.run('Pushing…', () => git.push(root, git.githubAuth()).then(() => true), { onError: netError('Push') })
    if (ok) status('Pushed.')
  }

  const doPull = async () => {
    const root = await needRepo()
    if (!root) return
    await editors.flush()
    const author = await git.resolveIdentity(root)
    const r = await repo.run('Pulling…', () => git.pull(root, { ...git.githubAuth(), author }), { onError: netError('Pull') })
    if (r) status(r.upToDate ? 'Already up to date.' : r.mergeCommit ? 'Pulled and merged.' : 'Pulled (fast-forward).')
  }

  const doFetch = async () => {
    const root = await needRepo()
    if (!root) return
    if (await repo.run('Fetching…', () => git.fetch(root, git.githubAuth()).then(() => true), { onError: netError('Fetch') })) status('Fetched.')
  }

  const doCheckout = async (ref: string) => {
    const root = await needRepo()
    if (!root || ref === repo.branches?.current) return
    await editors.flush()
    const name = repo.branches?.remote.includes(ref) ? ref.slice(ref.indexOf('/') + 1) : ref
    if (await repo.run('Switching branch…', () => git.checkout(root, ref).then(() => true))) status(`Switched to ${name}.`)
  }

  const newBranch = async () => {
    const root = await needRepo()
    if (!root) return
    const name = (await os.dialog.prompt('Branch name:', { title: 'New Branch', okLabel: 'Create' }))?.trim()
    if (!name) return
    if (await repo.run('Creating branch…', () => git.createBranch(root, name).then(() => true))) status(`Created and switched to ${name}.`)
  }

  const initRepo = async () => {
    if (repo.root) return void os.dialog.alert(`${path.pretty(repo.root)} is already a Git repository.`, { title: 'Git' })
    if (!(await os.dialog.confirm(`Create a Git repository in ${path.pretty(project)}?`, { title: 'Initialize Repository', okLabel: 'Create' }))) return
    if (await repo.run('Initializing…', () => git.init(project).then(() => true))) {
      status('Initialized an empty Git repository.')
      showDock('right', 'git')
    }
  }

  const fork = async () => {
    const token = git.getGithubToken()
    if (!token) {
      if (await os.dialog.confirm('Forking needs a GitHub token. Set one now?', { title: 'Fork', okLabel: 'Set Token…' })) setDialog({ kind: 'token' })
      return
    }
    const url = (await os.dialog.prompt('GitHub repository to fork (URL or owner/repo):', { title: 'Fork Repository', okLabel: 'Fork' }))?.trim()
    if (!url) return
    status('Forking…')
    try {
      const fork = await git.githubFork(url, token)
      status(`Forked → ${fork.html_url}`)
      if (await os.dialog.confirm(`Fork created: ${fork.full_name}.\n\nClone it now?`, { title: 'Fork created', okLabel: 'Clone…' })) {
        setDialog({ kind: 'clone', url: fork.clone_url })
      }
    } catch (e) {
      await os.dialog.alert(e instanceof Error ? e.message : String(e), { title: 'Fork' })
    }
  }

  const setRemote = async () => {
    const root = await needRepo()
    if (!root) return
    const url = (await os.dialog.prompt('URL of the “origin” remote (e.g. https://github.com/you/repo.git):', {
      title: 'Remote URL',
      defaultValue: repo.remoteUrl ?? '',
      okLabel: 'Save',
    }))?.trim()
    if (url === undefined || url === '' || url === repo.remoteUrl) return
    if (await repo.run('Saving remote…', () => git.setRemoteUrl(root, url).then(() => true))) status(`origin → ${git.normalizeRepoUrl(url)}`)
  }

  const commitPush = async () => {
    const root = await needRepo()
    if (!root) return
    await editors.flush()
    if (!(await git.status(root)).length) {
      await os.dialog.alert('Nothing to commit — the working tree is clean.', { title: 'Commit + Push' })
      return
    }
    if (await ensureIdentity()) setDialog({ kind: 'commitPush' })
  }

  const showDiff = useStable((title: string, patch: string, file?: string) => {
    setDiff({ title, patch, file })
    showDock('bottom', 'diff')
  })
  const pullStable = useStable(() => void doPull())
  const setAllBranches = useStable((v: boolean) => setPrefs((p) => ({ ...p, logAllBranches: v })))
  const openDiffFile = useStable(() => diff?.file && openAt(diff.file))

  const gitActions: GitActions = {
    openFile: (p) => openAt(p),
    showDiff,
    status,
    commit: doCommit,
    pull: () => void doPull(),
    push: () => void doPush(),
    fetch: () => void doFetch(),
    checkout: (ref) => void doCheckout(ref),
    newBranch: () => void newBranch(),
    initRepo: () => void initRepo(),
    clone: () => setDialog({ kind: 'clone' }),
    fork: () => void fork(),
  }

  const branchMenu = (e: MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const items: MenuItem[] = [
      { label: ghLogin ? `GitHub: ${ghLogin}` : ghToken ? 'GitHub: token set' : 'GitHub: not signed in', disabled: true },
      { label: 'Set Token / Sign In…', icon: KeyRound, onClick: () => setDialog({ kind: 'token' }) },
      '-',
    ]
    if (!repo.root) {
      items.push(
        { label: 'Clone Repository…', icon: Copy, onClick: () => setDialog({ kind: 'clone' }) },
        { label: 'Fork Repository…', icon: GitFork, onClick: () => void fork() },
        { label: 'Create Git Repository Here', onClick: () => void initRepo() },
      )
    } else {
      const b = repo.branches
      items.push(
        { label: repo.remoteUrl ?? '(no remote)', disabled: true },
        '-',
        { label: 'Update Project (Pull)', icon: ArrowDownToLine, onClick: () => void doPull() },
        { label: 'Commit…', onClick: () => showDock('right', 'git') },
        { label: 'Push', icon: ArrowUpFromLine, onClick: () => void doPush() },
        { label: 'Fetch', icon: RefreshCw, onClick: () => void doFetch() },
        { label: 'New Branch…', icon: GitBranch, onClick: () => void newBranch() },
        '-',
        { label: 'Local', disabled: true },
        ...(b?.local ?? []).map((name): MenuItem => ({ label: name, checked: name === b?.current, onClick: () => void doCheckout(name) })),
      )
      if (b?.remote.length) {
        items.push('-', { label: 'Remote', disabled: true }, ...b.remote.map((name): MenuItem => ({ label: name, onClick: () => void doCheckout(name) })))
      }
    }
    os.contextMenu({ clientX: r.left, clientY: r.bottom + 4 }, items, { owner: `kpy-branch-${win.id}` })
  }

  // ---------------------------------------------------------------- menus

  const toggleDock = (side: 'left' | 'right' | 'bottom', tab: string) =>
    setPrefs((p) => {
      const showing = p.docks[side] && p.tabs[side] === tab
      return { ...p, docks: { ...p.docks, [side]: !showing }, tabs: { ...p.tabs, [side]: tab } }
    })
  const dockChecked = (side: 'left' | 'right' | 'bottom', tab: string) => prefs.docks[side] && prefs.tabs[side] === tab
  const zoom = (d: number) => setPrefs((p) => ({ ...p, fontSize: d === 0 ? DEFAULT_PREFS.fontSize : Math.max(9, Math.min(28, p.fontSize + d)) }))

  const runLabel = active?.path?.endsWith('.py') ? `Run ‘${active.title}’` : 'Run Current File'

  useEffect(() => {
    const menus: MenuBarMenu[] = [
      {
        label: 'File',
        items: [
          { label: 'New File', icon: FilePlus, onClick: () => editors.newFile() },
          { label: 'New Python File…', onClick: () => void newPythonFile() },
          '-',
          { label: 'Open Folder…', icon: FolderOpen, shortcut: `${MOD}K`, onClick: () => void openFolder() },
          { label: 'Open File…', icon: FileText, shortcut: `${MOD}O`, onClick: () => void openFileDialog() },
          {
            label: 'Recent Projects',
            submenu: prefs.recent.length
              ? prefs.recent.map((p): MenuItem => ({ label: path.pretty(p), checked: p === project, disabled: !fs.isDir(p), onClick: () => void switchProject(p, { openEntry: true }) }))
              : [{ label: 'None yet', disabled: true }],
          },
          '-',
          { label: 'Save', icon: Save, shortcut: `${MOD}S`, disabled: !active, onClick: () => void editors.save() },
          { label: 'Save As…', shortcut: isMac ? '⇧⌘S' : 'Ctrl+Shift+S', disabled: !active, onClick: () => void editors.saveAs() },
          { label: 'Save All', icon: SaveAll, disabled: !dirtyCount, onClick: () => void editors.saveAll() },
          { label: 'Auto Save', checked: prefs.autoSave, onClick: () => setPrefs((p) => ({ ...p, autoSave: !p.autoSave })) },
          { label: 'Reload from Disk', disabled: !active?.path, onClick: () => active && void editors.reloadFromDisk(active.id) },
          '-',
          { label: 'Reveal in Files', icon: FolderOpen, onClick: () => os.open('files', { path: active?.path ?? project }) },
          { label: 'Open in Terminal', icon: SquareTerminal, onClick: () => os.open('terminal', { path: project }) },
          { label: 'Download File', disabled: !active?.path, onClick: () => active?.path && void os.download(active.path) },
          '-',
          { label: 'Close Tab', icon: X, disabled: !active, onClick: () => void editors.close() },
          { label: 'Close Window', onClick: () => win.close() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', shortcut: `${MOD}Z`, disabled: !active, onClick: cmd(undo) },
          { label: 'Redo', shortcut: isMac ? '⇧⌘Z' : 'Ctrl+Y', disabled: !active, onClick: cmd(redo) },
          '-',
          { label: 'Find…', icon: Search, shortcut: `${MOD}F`, disabled: !active, onClick: cmd(openSearchPanel) },
          { label: 'Replace…', icon: Replace, shortcut: `${MOD}F`, disabled: !active, onClick: cmd(openSearchPanel) },
          { label: 'Find in Files…', icon: FileSearch, shortcut: isMac ? '⇧⌘F' : 'Ctrl+Shift+F', onClick: findInFiles },
          { label: 'Go to Line…', shortcut: isMac ? '⌥⌘G' : 'Ctrl+Alt+G', disabled: !active, onClick: cmd(gotoLine) },
          '-',
          { label: 'Comment with Line Comment', shortcut: `${MOD}/`, disabled: !active, onClick: cmd(toggleComment) },
          { label: 'Duplicate Line', shortcut: isMac ? '⇧⌥↓' : 'Shift+Alt+Down', disabled: !active, onClick: cmd(copyLineDown) },
          { label: 'Delete Line', shortcut: isMac ? '⇧⌘K' : 'Ctrl+Shift+K', disabled: !active, onClick: cmd(deleteLine) },
          { label: 'Move Line Up', shortcut: isMac ? '⌥↑' : 'Alt+Up', disabled: !active, onClick: cmd(moveLineUp) },
          { label: 'Move Line Down', shortcut: isMac ? '⌥↓' : 'Alt+Down', disabled: !active, onClick: cmd(moveLineDown) },
          '-',
          { label: 'Select All', shortcut: `${MOD}A`, disabled: !active, onClick: cmd(selectAll) },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Project', checked: dockChecked('left', 'project'), onClick: () => toggleDock('left', 'project') },
          { label: 'Search', checked: dockChecked('left', 'search'), onClick: () => toggleDock('left', 'search') },
          { label: 'Git', checked: dockChecked('right', 'git'), onClick: () => toggleDock('right', 'git') },
          { label: 'Log', checked: dockChecked('right', 'log'), onClick: () => toggleDock('right', 'log') },
          { label: 'Output', checked: dockChecked('bottom', 'output'), onClick: () => toggleDock('bottom', 'output') },
          { label: 'Diff', checked: dockChecked('bottom', 'diff'), onClick: () => toggleDock('bottom', 'diff') },
          '-',
          { label: 'Show Hidden Files', checked: prefs.showHidden, onClick: () => setPrefs((p) => ({ ...p, showHidden: !p.showHidden })) },
          { label: 'Word Wrap', checked: prefs.wrap, onClick: () => setPrefs((p) => ({ ...p, wrap: !p.wrap })) },
          { label: 'Line Numbers', checked: prefs.lineNumbers, onClick: () => setPrefs((p) => ({ ...p, lineNumbers: !p.lineNumbers })) },
          '-',
          { label: 'Zoom In', shortcut: `${MOD}+`, onClick: () => zoom(1) },
          { label: 'Zoom Out', shortcut: `${MOD}−`, onClick: () => zoom(-1) },
          { label: 'Actual Size', onClick: () => zoom(0) },
        ],
      },
      {
        label: 'Run',
        items: [
          { label: runLabel, icon: Play, shortcut: 'F5', disabled: !!runner.running || !active, onClick: () => void runCurrent() },
          { label: 'Stop', icon: Square, shortcut: isMac ? '⇧F5' : 'Shift+F5', disabled: !runner.running, onClick: () => void stopRun() },
          '-',
          { label: 'Clear Output', icon: Eraser, onClick: () => runner.clear() },
          { label: 'Restart Python', icon: RefreshCw, disabled: runner.status === 'off', onClick: () => void runner.restart() },
          '-',
          { label: 'Install Packages…', icon: Package, onClick: () => void installPackages() },
          { label: 'Install requirements.txt', onClick: () => void installRequirements() },
        ],
      },
      {
        label: 'Git',
        items: [
          { label: 'Commit…', onClick: () => showDock('right', 'git') },
          { label: 'Commit + Push…', icon: CloudUpload, onClick: () => void commitPush() },
          '-',
          { label: 'Pull', icon: ArrowDownToLine, disabled: !repo.root, onClick: () => void doPull() },
          { label: 'Push', icon: ArrowUpFromLine, disabled: !repo.root, onClick: () => void doPush() },
          { label: 'Fetch', icon: RefreshCw, disabled: !repo.root, onClick: () => void doFetch() },
          '-',
          { label: 'New Branch…', icon: GitBranch, disabled: !repo.root, onClick: () => void newBranch() },
          {
            label: 'Switch Branch',
            disabled: !repo.root,
            submenu: [
              ...(repo.branches?.local ?? []).map((b): MenuItem => ({ label: b, checked: b === repo.branches?.current, onClick: () => void doCheckout(b) })),
              ...(repo.branches?.remote.length ? ['-' as const, ...repo.branches.remote.map((b): MenuItem => ({ label: b, onClick: () => void doCheckout(b) }))] : []),
            ],
          },
          { label: 'Show Log', icon: History, onClick: () => showDock('right', 'log') },
          '-',
          { label: 'Clone…', icon: Copy, onClick: () => setDialog({ kind: 'clone' }) },
          { label: 'Fork…', icon: GitFork, onClick: () => void fork() },
          { label: 'My Repositories…', disabled: !ghToken, onClick: () => setDialog({ kind: 'repos' }) },
          '-',
          { label: 'Initialize Repository', disabled: !!repo.root, onClick: () => void initRepo() },
          { label: 'Remote URL…', disabled: !repo.root, onClick: () => void setRemote() },
          { label: 'Identity (Name & Email)…', icon: UserRound, onClick: () => setDialog({ kind: 'identity' }) },
          { label: 'GitHub Token…', icon: KeyRound, onClick: () => setDialog({ kind: 'token' }) },
          '-',
          { label: 'Refresh', onClick: () => repo.refresh() },
        ],
      },
      {
        label: 'Help',
        items: [
          { label: 'About KhervePY', icon: Info, onClick: () => void about() },
          { label: 'Keyboard Shortcuts', onClick: () => void shortcuts() },
          '-',
          { label: 'Create a GitHub Token…', icon: ExternalLink, onClick: () => os.openUrl(git.CREATE_TOKEN_URL) },
        ],
      },
    ]
    win.setMenus(menus)
  })
  useEffect(() => () => win.setMenus(null), [win])

  const about = () =>
    os.dialog.alert(
      `KhervePY ${VERSION}\n\nA light, GitHub-first Python IDE — part of the KherveTools family, now in KherveOS.\n\nTabbed editor with auto-save, project explorer, Git & GitHub (status, commit, graph, branches, pull/push, clone/fork), Python in the browser (Pyodide) with micropip packages.\n\nCopyright © 2026 Gwilherm Kerherve — GNU GPL v3 or later.`,
      { title: 'About KhervePY' },
    )

  const shortcuts = () =>
    os.dialog.alert(
      [
        `F5 — run the current file;  Shift+F5 — stop`,
        `${MOD}S save · ${isMac ? '⇧⌘S' : 'Ctrl+Shift+S'} save as · ${MOD}O open file · ${MOD}K open folder`,
        `${MOD}F find / replace · ${isMac ? '⇧⌘F' : 'Ctrl+Shift+F'} find in files · ${isMac ? '⌥⌘G' : 'Ctrl+Alt+G'} go to line`,
        `${MOD}/ comment · ${isMac ? '⌥↑/↓' : 'Alt+Up/Down'} move line · ${isMac ? '⇧⌥↓' : 'Shift+Alt+Down'} duplicate line`,
        `In the commit box: ${MOD}Enter commit, ${isMac ? '⇧⌘Enter' : 'Ctrl+Shift+Enter'} commit and push`,
        `${MOD}+ / ${MOD}− zoom`,
      ].join('\n'),
      { title: 'Keyboard Shortcuts' },
    )

  // ------------------------------------------------------------- keyboard

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || dialog) return
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    const take = (fn: () => void) => {
      e.preventDefault()
      e.stopPropagation()
      fn()
    }
    if (e.key === 'F5') return take(() => void (e.shiftKey ? stopRun() : runCurrent()))
    if (!mod) return
    if (k === 's' && e.altKey) return take(() => void editors.saveAll())
    if (k === 's') return take(() => void (e.shiftKey ? editors.saveAs() : editors.save()))
    if (k === 'o' && !e.shiftKey) return take(() => void openFileDialog())
    if (k === 'k' && !e.shiftKey && !e.altKey) return take(() => void openFolder())
    if (k === 'f' && e.shiftKey) return take(findInFiles)
    if (k === '=' || k === '+') return take(() => zoom(1))
    if (k === '-') return take(() => zoom(-1))
    if (k === '0') return take(() => zoom(0))
  }

  // --------------------------------------------------------------- render

  const docks = prefs.docks
  const commitDone = (msg: string) => {
    status(msg)
    repo.refresh()
  }

  const bodyRef = useRef<HTMLDivElement>(null)
  const [bodyWidth, setBodyWidth] = useState(1200)
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setBodyWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // In a narrow window the editor keeps at least ~280px: the Git dock goes last, the Project dock first.
  const EDITOR_MIN = 280
  const showRight = docks.right && bodyWidth - sizes.right >= EDITOR_MIN
  const showLeft = docks.left && bodyWidth - sizes.left - (showRight ? sizes.right : 0) >= EDITOR_MIN
  const maxSide = () => Math.max(200, (bodyRef.current?.clientWidth ?? 1200) - 320)
  const maxBottom = () => Math.max(120, (bodyRef.current?.clientHeight ?? 700) - 140)
  const sizesRef = useRef(sizes)
  sizesRef.current = sizes
  const saveSizes = useStable(() => setPrefs((p) => ({ ...p, sizes: sizesRef.current })))

  const branchLabel = repo.root ? (repo.branches?.current ?? '(detached)') : 'No VCS'
  const ab = repo.ab
  const running = !!runner.running

  const tabsBar = useMemo(
    () => editors.tabs.map((t) => ({ id: t.id, title: t.title, path: t.path, dirty: isDirty(t), disk: t.diskChanged })),
    [editors.tabs],
  )

  return (
    <div className="k-app kpy-app" onKeyDown={onKeyDown}>
      <div className="k-toolbar kpy-toolbar">
        <button className="kpy-branch" data-menu-owner={`kpy-branch-${win.id}`} onClick={branchMenu} title={repo.root ? `Git branch: ${branchLabel}` : 'This folder is not a Git repository — click for options'}>
          <GitBranch size={15} />
          <span>{branchLabel}</span>
          {ab && (ab.ahead > 0 || ab.behind > 0) && (
            <span className="kpy-ab">
              {ab.ahead ? `↑${ab.ahead}` : ''}
              {ab.behind ? `↓${ab.behind}` : ''}
            </span>
          )}
          <ChevronDown size={13} />
        </button>
        <span className="k-sep" />
        <button className="k-icon-btn" title={`Open Folder (${MOD}K)`} onClick={() => void openFolder()}>
          <FolderOpen size={18} />
        </button>
        <button className="k-icon-btn" title={`Open File (${MOD}O)`} onClick={() => void openFileDialog()}>
          <FileText size={18} />
        </button>
        <button className="k-icon-btn" title="New File" onClick={() => editors.newFile()}>
          <FilePlus size={18} />
        </button>
        <button className="k-icon-btn" title={`Save (${MOD}S)`} disabled={!active} onClick={() => void editors.save()}>
          <Save size={18} />
        </button>
        <span className="k-sep" />
        <button className={`k-icon-btn kpy-run${running ? ' running' : ''}`} title="Run the current Python file (F5)" disabled={running || !active} onClick={() => void runCurrent()}>
          {runner.status === 'starting' && running ? <LoaderCircle size={18} className="k-spin" /> : <Play size={18} />}
        </button>
        <button className={`k-icon-btn kpy-stop${running ? ' armed' : ''}`} title="Stop the running program (Shift+F5)" disabled={!running} onClick={() => void stopRun()}>
          <Square size={16} />
        </button>
        <button className="k-icon-btn" title="Open a Terminal in the project folder" onClick={() => os.open('terminal', { path: project })}>
          <SquareTerminal size={18} />
        </button>
        <span className="k-sep" />
        <button className="k-icon-btn" title={`Find / Replace (${MOD}F)`} disabled={!active} onClick={cmd(openSearchPanel)}>
          <Search size={18} />
        </button>
        <button className="k-icon-btn" title={`Find in Files (${isMac ? '⇧⌘F' : 'Ctrl+Shift+F'})`} onClick={findInFiles}>
          <FileSearch size={18} />
        </button>
        <span className="k-sep" />
        <button className="k-icon-btn" title="Commit + Push: stage all, commit and push in one step" onClick={() => void commitPush()}>
          <CloudUpload size={18} />
        </button>
        <button className="k-icon-btn" title="Pull" disabled={!repo.root || !!repo.busy} onClick={() => void doPull()}>
          <ArrowDownToLine size={18} />
        </button>
        <button className="k-icon-btn" title="Clone a repository" onClick={() => setDialog({ kind: 'clone' })}>
          <Copy size={18} />
        </button>
        <button className="k-icon-btn" title="Fork a GitHub repository" onClick={() => void fork()}>
          <GitFork size={18} />
        </button>
        <span className="k-sep" />
        <button className="k-icon-btn" title="Install packages (micropip)" onClick={() => void installPackages()}>
          <Package size={18} />
        </button>
        <span className="k-spacer" />
        {repo.busy && (
          <span className="kpy-busy">
            <LoaderCircle size={14} className="k-spin" /> {repo.busy}
          </span>
        )}
        <button className={`k-icon-btn${docks.left ? ' active' : ''}`} title="Project / Search panel" onClick={() => setPrefs((p) => ({ ...p, docks: { ...p.docks, left: !p.docks.left } }))}>
          <PanelLeft size={17} />
        </button>
        <button className={`k-icon-btn${docks.bottom ? ' active' : ''}`} title="Output / Diff panel" onClick={() => setPrefs((p) => ({ ...p, docks: { ...p.docks, bottom: !p.docks.bottom } }))}>
          <PanelBottom size={17} />
        </button>
        <button className={`k-icon-btn${docks.right ? ' active' : ''}`} title="Git / Log panel" onClick={() => setPrefs((p) => ({ ...p, docks: { ...p.docks, right: !p.docks.right } }))}>
          <PanelRight size={17} />
        </button>
      </div>

      <div className="kpy-body" ref={bodyRef}>
        {showLeft && (
          <>
            <div className="kpy-dock" style={{ width: sizes.left }}>
              <DockTabs<LeftTab>
                tabs={[['project', 'Project'], ['search', 'Search']]}
                value={prefs.tabs.left}
                onChange={(t) => setPrefs((p) => ({ ...p, tabs: { ...p.tabs, left: t } }))}
              />
              {prefs.tabs.left === 'project' ? (
                <>
                  <div className="kpy-project-head" title={project}>
                    <FolderOpen size={14} /> <b>{path.basename(project) || project}</b>
                    <span className="kpy-muted">{path.pretty(path.dirname(project))}</span>
                  </div>
                  <ProjectTree root={project} showHidden={prefs.showHidden} activePath={active?.path ?? null} statusOf={repo.statusOf} onOpen={openInTree} status={status} />
                </>
              ) : null}
              <div className={prefs.tabs.left === 'search' ? 'kpy-fill' : 'kpy-hidden'}>
                <SearchPanel ref={searchRef} root={project} onOpen={openAt} />
              </div>
            </div>
            <Splitter axis="x" size={sizes.left} sign={1} min={150} max={maxSide()} onSize={(n) => setSizes((s) => ({ ...s, left: n }))} onDone={saveSizes} />
          </>
        )}

        <div className="kpy-center">
          <div className="kpy-main">
            {tabsBar.length > 0 && (
              <div className="kpy-tabs" role="tablist">
                {tabsBar.map((t) => (
                  <div
                    key={t.id}
                    role="tab"
                    aria-selected={t.id === editors.activeId}
                    className={`kpy-tab${t.id === editors.activeId ? ' active' : ''}${t.dirty ? ' dirty' : ''}`}
                    title={t.path ? path.pretty(t.path) + (t.disk ? ' — changed on disk' : '') : 'Not saved yet'}
                    onClick={() => editors.activate(t.id)}
                    onMouseDown={(e) => {
                      if (e.button === 1) {
                        e.preventDefault()
                        void editors.close(t.id)
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      os.contextMenu(e, [
                        { label: 'Close', onClick: () => void editors.close(t.id) },
                        { label: 'Close Others', onClick: () => void editors.closeMany(editors.tabs.filter((x) => x.id !== t.id).map((x) => x.id)) },
                        { label: 'Close All', onClick: () => void editors.closeMany(editors.tabs.map((x) => x.id)) },
                        '-',
                        { label: 'Copy Path', disabled: !t.path, onClick: () => t.path && void navigator.clipboard?.writeText(t.path) },
                        { label: 'Reveal in Files', disabled: !t.path, onClick: () => t.path && os.open('files', { path: t.path }) },
                      ])
                    }}
                  >
                    <span className="kpy-tab-title">{t.title}</span>
                    {t.disk && <span className="kpy-tab-flag" title="Changed on disk">!</span>}
                    <button
                      className="kpy-tab-close"
                      title="Close"
                      onClick={(e) => {
                        e.stopPropagation()
                        void editors.close(t.id)
                      }}
                    >
                      <span className="kpy-dot" />
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="kpy-editors">
              {editors.tabs.map((t) => (
                <div key={t.id} className={`kpy-editor${t.id === editors.activeId ? '' : ' kpy-hidden'}`}>
                  <CodeEditor
                    value={t.text}
                    onChange={(v) => editors.setText(t.id, v)}
                    language={t.language}
                    wrap={prefs.wrap}
                    lineNumbers={prefs.lineNumbers}
                    fontSize={prefs.fontSize}
                    autoFocus
                    onReady={(v) => {
                      editors.registerView(t.id, v)
                      if (!hasChangeBar(v)) v.dispatch({ effects: StateEffect.appendConfig.of(changeBar) })
                    }}
                    onUpdate={(u) => {
                      if (t.id !== live.current.editors.activeId) return
                      const head = u.state.selection.main.head
                      const line = u.state.doc.lineAt(head)
                      setCursor({ line: line.number, col: head - line.from + 1 })
                    }}
                  />
                </div>
              ))}
              {!editors.tabs.length && (
                <div className="kpy-welcome">
                  <Code2 size={44} className="kpy-welcome-logo" />
                  <h2>KhervePY</h2>
                  <p className="kpy-muted">A light, GitHub-first Python IDE</p>
                  <div className="kpy-welcome-actions">
                    <button className="k-btn" onClick={() => void openFolder()}>
                      <FolderOpen size={15} /> Open Folder…
                    </button>
                    <button className="k-btn" onClick={() => void newPythonFile()}>
                      <FilePlus size={15} /> New Python File…
                    </button>
                    <button className="k-btn" onClick={() => setDialog({ kind: 'clone' })}>
                      <Copy size={15} /> Clone Repository…
                    </button>
                  </div>
                  {prefs.recent.filter((p) => p !== project && fs.isDir(p)).length > 0 && (
                    <div className="kpy-recent">
                      <div className="kpy-muted">Recent projects</div>
                      {prefs.recent
                        .filter((p) => p !== project && fs.isDir(p))
                        .slice(0, 6)
                        .map((p) => (
                          <button key={p} className="k-link-btn" onClick={() => void switchProject(p, { openEntry: true })}>
                            {path.pretty(p)}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {docks.bottom && (
            <>
              <Splitter axis="y" size={sizes.bottom} sign={-1} min={70} max={maxBottom()} onSize={(n) => setSizes((s) => ({ ...s, bottom: n }))} onDone={saveSizes} />
              <div className="kpy-dock bottom" style={{ height: sizes.bottom }}>
                <DockTabs<BottomTab>
                  tabs={[['output', running ? 'Output ●' : 'Output'], ['diff', 'Diff']]}
                  value={prefs.tabs.bottom}
                  onChange={(t) => setPrefs((p) => ({ ...p, tabs: { ...p.tabs, bottom: t } }))}
                >
                  {prefs.tabs.bottom === 'output' && (
                    <>
                      <span className="kpy-muted kpy-kernel">Python: {runner.status}</span>
                      <button className="k-icon-btn kpy-mini" title="Stop" disabled={!running} onClick={() => void stopRun()}>
                        <Square size={12} />
                      </button>
                      <button className="k-icon-btn kpy-mini" title="Clear" onClick={() => runner.clear()}>
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </DockTabs>
                {prefs.tabs.bottom === 'output' ? (
                  <OutputPanel lines={runner.lines} version={runner.version} />
                ) : (
                  <DiffView diff={diff} onOpen={diff?.file && fs.isFile(diff.file) ? openDiffFile : undefined} />
                )}
              </div>
            </>
          )}
        </div>

        {showRight && (
          <>
            <Splitter axis="x" size={sizes.right} sign={-1} min={220} max={maxSide()} onSize={(n) => setSizes((s) => ({ ...s, right: n }))} onDone={saveSizes} />
            <div className="kpy-dock right" style={{ width: sizes.right }}>
              <DockTabs<RightTab>
                tabs={[['git', repo.files.length ? `Git (${repo.files.length})` : 'Git'], ['log', 'Log']]}
                value={prefs.tabs.right}
                onChange={(t) => setPrefs((p) => ({ ...p, tabs: { ...p.tabs, right: t } }))}
              />
              {prefs.tabs.right === 'git' ? (
                <GitPanel repo={repo} actions={gitActions} />
              ) : (
                <LogPanel
                  root={repo.root}
                  busy={repo.busy}
                  allBranches={prefs.logAllBranches}
                  setAllBranches={setAllBranches}
                  onPull={pullStable}
                  showDiff={showDiff}
                />
              )}
            </div>
          </>
        )}
      </div>

      <div className="k-statusbar kpy-statusbar">
        <span className="kpy-status-msg" title={message}>
          {message}
        </span>
        <span className="k-spacer" style={{ flex: 1 }} />
        {active && (
          <span>
            Ln {cursor.line}, Col {cursor.col}
          </span>
        )}
        {active && <span>{LANG_NAMES[active.language]}</span>}
        {dirtyCount > 0 && <span>{dirtyCount} unsaved</span>}
        <span title="This window's Python">Python: {runner.status}</span>
        <button className="kpy-status-btn" onClick={() => setDialog({ kind: 'token' })} title={ghLogin ? `Signed in as ${ghLogin} — click to change the token` : 'Click to set a GitHub token'}>
          GitHub: {ghLogin || (ghToken ? 'token set' : 'not signed in')}
        </button>
      </div>

      {dialog?.kind === 'token' && <TokenDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'clone' && (
        <CloneDialog
          initialUrl={dialog.url}
          onClose={() => setDialog(null)}
          onCloned={(dir) => {
            setDialog(null)
            status(`Cloned into ${path.pretty(dir)}.`)
            void switchProject(dir, { openEntry: true })
          }}
        />
      )}
      {dialog?.kind === 'commitPush' && repo.root && (
        <CommitPushDialog
          root={repo.root}
          branch={repo.branches?.current ?? null}
          changes={repo.files.length}
          onClose={() => setDialog(null)}
          onDone={commitDone}
          onToken={() => setDialog({ kind: 'token' })}
        />
      )}
      {dialog?.kind === 'identity' && (
        <IdentityDialog
          root={repo.root}
          onClose={() => {
            identityDone.current?.(false)
            identityDone.current = null
            setDialog(null)
          }}
          onSaved={() => {
            identityDone.current?.(true)
            identityDone.current = null
          }}
        />
      )}
      {dialog?.kind === 'repos' && (
        <ReposDialog
          onClose={() => setDialog(null)}
          onClone={(url) => setDialog({ kind: 'clone', url })}
        />
      )}
    </div>
  )
}
