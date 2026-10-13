// App guides in the browser: the registry and the open tool sets give the
// AppInfo of each app; core.ts turns the guides into text.

import { APPS } from '@/os/registry'
import { appToolNames } from '../appTools'
import { guideAnswer, guideBundle, type AppInfo, type GuideBundle } from './core'
import { APP_GUIDES } from './index'

/** What the registry and the tool manifests say about every app. */
export function appInfos(): AppInfo[] {
  return APPS.map((app) => ({
    id: app.id,
    name: app.name,
    group: app.group,
    description: app.description,
    opens: (app.fileTypes ?? []).filter(Boolean),
    tools: appToolNames(app.id),
  }))
}

/** The app_guide tool: one app's guide, or the index of all apps by group. */
export const appGuide = (query?: string): string => guideAnswer(query, APP_GUIDES, appInfos())

/** The guides as the MCP bridge sends them to the server. */
export const appGuideBundle = (): GuideBundle => guideBundle(APP_GUIDES, appInfos())
