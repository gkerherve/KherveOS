// App guides, the part without the browser: what an app guide is, how one
// reads as text (the `app_guide` tool, the MCP resources), and how the whole
// set is bundled for the server. Plain TypeScript (no React, no "@/" imports)
// so Node can test it:  node --test tools/tests/app-guides.test.ts
//
// The guides themselves are the other files of this folder (index.ts lists
// them). Every app of the registry needs one; the test says what is missing.
//
// A guide is knowledge, not an API: the tool list already says what each tool
// takes. A guide says what the app is for, which words and units it uses,
// which tools to call in which order, where models go wrong, and which other
// apps it works with.

/** What a guide says about one app (the name, group, file types it opens and its tools come from the registry and the manifests). */
export interface AppGuide {
  /** The app id (registry.ts), e.g. "kherveftir". */
  app: string
  /** One line for the index: when to reach for this app (≤ 120 characters). */
  use: string
  /** What the app is and does, two or three sentences (≤ 450 characters). */
  about: string
  /** Files it writes or exports, e.g. "a .kfit project next to the imported file". */
  writes?: string[]
  /** Key concepts, units, sheet and file naming, where results are. */
  concepts?: string[]
  /** The usual tool sequence, one step per line; name tools in `backticks`. */
  workflow: string[]
  /** What goes wrong, and what to do instead. */
  pitfalls?: string[]
  /** Other apps it combines with: [app id, how]. */
  with?: [app: string, how: string][]
}

/** What the registry and the tool manifests say about an app. */
export interface AppInfo {
  id: string
  name: string
  /** The Dock / Launchpad group: "Materials", "Office"… */
  group: string
  description: string
  /** File extensions it opens. */
  opens: string[]
  /** Its tool names, e.g. "kherveftir_run". */
  tools: string[]
}

/** The order the groups are listed in: the science first, then the work tools, then play. */
export const GROUP_ORDER = [
  'Materials', 'Chemistry', 'Physics', 'Electricity', 'Mechanicals', 'Earth',
  'Office', 'Programming', 'Management', 'Internet', 'Tools', 'Games',
]

/** The groups of `apps`, in GROUP_ORDER (unknown groups last, alphabetically). */
export function groupsOf(apps: readonly { group: string }[]): string[] {
  const present = new Set(apps.map((a) => a.group))
  const known = GROUP_ORDER.filter((g) => present.has(g))
  const other = [...present].filter((g) => !GROUP_ORDER.includes(g)).sort()
  return [...known, ...other]
}

const label = (info: AppInfo | undefined, id: string) => (info ? `${info.name} (${id})` : id)

/** One guide as text, for a model: the app_guide answer and the MCP resource. */
export function renderGuide(guide: AppGuide, info: AppInfo, all: readonly AppInfo[] = []): string {
  const byId = new Map(all.map((a) => [a.id, a]))
  const out: string[] = [`# ${info.name} (${info.id}) - ${info.group}`, guide.about, `Use when: ${guide.use}`]
  if (info.opens.length) out.push(`Opens: ${info.opens.join(' ')}`)
  if (guide.writes?.length) out.push(`Writes: ${guide.writes.join('; ')}`)
  if (guide.concepts?.length) out.push('', 'Concepts:', ...guide.concepts.map((c) => `- ${c}`))
  out.push('', 'Workflow:', ...guide.workflow.map((s, i) => `${i + 1}. ${s}`))
  if (guide.pitfalls?.length) out.push('', 'Pitfalls:', ...guide.pitfalls.map((p) => `- ${p}`))
  if (guide.with?.length) out.push('', 'Works with:', ...guide.with.map(([id, how]) => `- ${label(byId.get(id), id)}: ${how}`))
  out.push('', info.tools.length ? `Tools: ${info.tools.join(', ')}` : 'Tools: none of its own (use the OS tools: open_app, open_file, take_screenshot).')
  return out.join('\n')
}

/** The index of all apps by group, one line each. */
export function renderIndex(guides: readonly AppGuide[], apps: readonly AppInfo[]): string {
  const guideOf = new Map(guides.map((g) => [g.app, g]))
  const listed = apps.filter((a) => guideOf.has(a.id))
  const out = [
    `KherveOS apps by group (${listed.length}). app_guide with "app" gives one app's guide: what it is for, concepts and units, the usual tool sequence, pitfalls, apps it works with. Its tools are named <id>_<action>.`,
  ]
  for (const group of groupsOf(listed)) {
    out.push('', `## ${group}`)
    for (const a of listed.filter((x) => x.group === group)) out.push(`- ${a.id} (${a.name}): ${guideOf.get(a.id)!.use}`)
  }
  return out.join('\n')
}

/** An app by id or by name ("kherveftir", "kFTIR", "kftir", "Meteor Smash"), among those with a guide. */
export function findGuideApp(query: string, apps: readonly AppInfo[]): AppInfo | undefined {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, '')
  const q = norm(query)
  if (!q) return undefined
  return (
    apps.find((a) => norm(a.id) === q) ??
    apps.find((a) => norm(a.name) === q) ??
    apps.find((a) => norm(a.id) === 'kherve' + q || norm(a.id).replace(/^kherve/, 'k') === q)
  )
}

/** What the app_guide tool answers: one guide, the index, or an error that lists the ids. */
export function guideAnswer(query: string | undefined, guides: readonly AppGuide[], apps: readonly AppInfo[]): string {
  if (!query || !query.trim()) return renderIndex(guides, apps)
  const info = findGuideApp(query, apps)
  const guide = info && guides.find((g) => g.app === info.id)
  if (!info || !guide) {
    throw new Error(`There is no app "${query}". The apps are: ${apps.map((a) => a.id).join(', ')}. app_guide without "app" lists them by group.`)
  }
  return renderGuide(guide, info, apps)
}

/** The guides as the bridge sends them to the server (MCP resources, and app_guide when no tab is open). */
export interface GuideBundle {
  /** kherveos://apps */
  index: string
  /** kherveos://apps/<id> */
  apps: Record<string, { name: string; group: string; use: string; text: string }>
}

export function guideBundle(guides: readonly AppGuide[], apps: readonly AppInfo[]): GuideBundle {
  const bundle: GuideBundle = { index: renderIndex(guides, apps), apps: {} }
  for (const guide of guides) {
    const info = apps.find((a) => a.id === guide.app)
    if (info) bundle.apps[info.id] = { name: info.name, group: info.group, use: guide.use, text: renderGuide(guide, info, apps) }
  }
  return bundle
}
