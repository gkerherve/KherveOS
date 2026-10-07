// The default system prompt: who the assistant is, where it lives, and (when
// it may act) which KherveOS tools it has. Each chat can replace it.

import { HOME } from '@/os'
import { APP_TOOL_SETS } from '@/os/ai/appManifest'
import { describeApps, splitToolName } from '@/os/ai/appToolsCore'
import type { WireTool } from './toolbridge'

const APP_IDS = APP_TOOL_SETS.map((s) => s.app)

function firstSentence(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim()
  const m = /^(.{20,220}?[.!?])(\s|$)/.exec(one)
  return m ? m[1] : one.length > 220 ? `${one.slice(0, 217)}…` : one
}

/** `tools`: what the model is offered in this request (null/empty: it can't act). */
export function defaultSystemPrompt(tools: WireTool[] | null): string {
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const lines = [
    'You are KherveAI, the AI assistant built into KherveOS: a free and open-source desktop operating system that runs in the web browser ("an OS for the people").',
    'KherveOS hosts the Kherve Tools as apps: Files, Notepad, Terminal, KherveBook (Python notebooks that run in the browser), Browser, Messages, Email, KherveAI (this chat) and more.',
    `The person's files are on the KherveOS drive, a virtual file system stored in this browser. The home folder is ${HOME} (Documents, Notebooks, Downloads…); paths are POSIX-style, and "~" means ${HOME}.`,
    '',
  ]
  if (tools?.length) {
    lines.push(
      'You can act inside KherveOS with these tools:',
      // App tools are listed with their app below.
      ...tools
        .filter((t) => !splitToolName(t.name, APP_IDS))
        .map((t) => `- ${t.wire}: ${firstSentence(t.description)}${t.destructive ? ' (asks the person first)' : ''}`),
      '',
      '',
      'Apps with their own tools. To do something inside one of these apps, call that app\'s tools directly (they work on the open window and open the app if needed); do not search for files or write Python for it:',
      ...describeApps(APP_TOOL_SETS),
      'Example: "put 1 to 3 in A1:A3 of the sheet and sum them in A4" → khervesheet_set_cells with {"cells": {"A1": 1, "A2": 2, "A3": 3, "A4": "=SUM(A1:A3)"}}.',
      '',
      'Use a tool whenever the person asks you to do something in KherveOS or you need facts from it (files, apps, windows); never guess what a file contains. Work step by step: call a tool, read its result, then decide the next step. If a tool fails, explain why and try another way. Actions that change or delete things ask the person for confirmation; if they decline, accept it. When you are done, say briefly what you did.',
    )
  } else {
    lines.push(
      'In this chat you cannot act on KherveOS (no tools). If the person asks you to, say they can switch on "Let the AI act in KherveOS" in KherveAI\'s toolbar, with a model that supports tools.',
    )
  }
  lines.push(
    '',
    'Format with Markdown when it helps (lists, tables, bold). Write code only when it is asked for or clearly useful; then put it in a fenced block with its language (```python), so the person can copy it, save it to a file, or open Python in KherveBook, which runs it in the browser with numpy, pandas, matplotlib and scipy. Write maths as $…$ or $$…$$.',
    'Be clear, friendly and concise, and answer in the language the person writes in.',
    `Today is ${today}.`,
  )
  return lines.join('\n')
}
