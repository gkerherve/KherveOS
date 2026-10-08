// The technique apps: one entry each. TechApp.tsx builds the window from this;
// the engine side is public/apps/khervetech/py/ktech/techniques.py (same key).
// No browser or OS imports: Node tests load this file.

export interface TechAppSpec {
  /** The registry id (src/os/registry.ts) and AI tool prefix. */
  appId: string
  /** The app's name in KherveOS (Dock, window). */
  name: string
  /** The engine's technique key (ktech/techniques.py TECHS, TechniqueTool's key). */
  tech: string
  /** Sheet names of this technique start with this (TechniqueTool prefixes). */
  prefix: string
  /** public/examples/<appId>/ (index.json), copied to ~/Documents/<name> Examples on first launch. */
  examples: string
  /** Raw files the app imports (registered file types, besides .kfit projects). */
  exts: string[]
  /** Sheets of this technique, when the prefix is not enough (TechniqueTool's 'match': Raman). */
  match?: (sheet: string) => boolean
}

export const TECH_APPS: TechAppSpec[] = [
  { appId: 'khervetga', name: 'KherveTGA', tech: 'TGA', prefix: 'TGA', examples: 'khervetga', exts: ['.csv', '.txt', '.dat', '.tri'] },
  { appId: 'khervebet', name: 'KherveBET', tech: 'BET', prefix: 'BET', examples: 'khervebet', exts: ['.csv', '.txt', '.dat'] },
  { appId: 'kherveuvvis', name: 'KherveUVVis', tech: 'UVVIS', prefix: 'UVVIS', examples: 'kherveuvvis', exts: ['.csv', '.txt', '.dat', '.asc'] },
  { appId: 'kherveftir', name: 'KherveFTIR', tech: 'FTIR', prefix: 'FTIR', examples: 'kherveftir', exts: ['.jdx', '.dx', '.csv', '.txt', '.dat', '.lbd'] },
  {
    appId: 'kherveraman', name: 'KherveRaman', tech: 'RAMAN', prefix: 'RAMAN', examples: 'kherveraman', exts: ['.txt'],
    // TechniqueTool._is_raman_name / Raman_Analysis.is_raman_sheet
    match: (s) => s.startsWith('RA') || s.toUpperCase().includes('RAMAN') || s.startsWith('Ra_'),
  },
]

/** A sheet of this technique (TechniqueTool.technique_of_sheet). */
export const isSheetOf = (spec: TechAppSpec, sheet: string) => (spec.match ? spec.match(sheet) : sheet.toUpperCase().startsWith(spec.prefix))

export const techApp = (appId: string): TechAppSpec => {
  const s = TECH_APPS.find((t) => t.appId === appId)
  if (!s) throw new Error(`No technique app ${appId}`)
  return s
}

/** The technique app a project belongs to, from its sheet names (first match wins, as TechniqueTool). */
export function appForSheets(sheets: string[]): TechAppSpec | null {
  for (const sheet of sheets) {
    const spec = TECH_APPS.find((t) => isSheetOf(t, sheet))
    if (spec) return spec
  }
  return null
}

/** The main toolbar tools the desktop takes off in a technique mode (Widgets_Toolbars register_toolbar_tools). */
export const XPS_ONLY_TOOLS = new Set([
  'be', 'autoBE', 'measureArea', 'fitting', 'miniFitting', 'monteCarlo', 'dparam', 'plotMod', 'thickogram', 'vb', 'pca', 'denoise',
  'profileCreator', 'plotCreator', 'autoId', 'id', 'nist', 'kherveAI', 'libOpen', 'libSave', 'toggleColumns', 'toggleRightPanel',
])

/** Where the technique button and its section tiles go: after the last XPS tool before the stretch (create_technique_tool). */
export const TECH_TOOL_AFTER = 'kherveAI'
