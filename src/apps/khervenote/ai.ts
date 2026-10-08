// KherveNote's AI (the desktop's local_ai.py): summarise, rephrase, fill a
// section in from the speech, make notes from the speech. It goes through
// KherveAI's providers and settings — Ollama on this computer by default, or
// Claude / ChatGPT when KherveAI is set to use them.

import { fetchOllamaModels, streamChat } from '@/apps/kherveai/providers'
import { loadKey, loadSettings, pickOllamaModel, PROVIDERS } from '@/apps/kherveai/settings'
import type { ProviderId } from '@/apps/kherveai/types'

export const SUMMARISE =
  'You turn notes taken during a lecture or training into a summary. Write in the same language as the notes. ' +
  "Give the key points as short bullet points, each line starting with '- '. Keep facts, numbers and names exactly; " +
  'do not add anything that is not in the notes. Reply with the bullet points only, no introduction.'

export const SUMMARISE_NOTE =
  'You write the summary at the top of a set of lecture notes. Write in the same language as the notes: 3 to 6 ' +
  'sentences giving what the talk covered and its main conclusions. Do not add anything that is not in the notes. ' +
  'Reply with the summary only.'

export const REPHRASE =
  'Rewrite the text as clear, well-written prose, as it would appear in good lecture notes. Keep the meaning, every ' +
  'fact and number, and the language of the text. It may be a speech transcript: remove hesitations and repetitions ' +
  'and fix words that were obviously misheard. Keep paragraph breaks. Reply with the rewritten text only.'

export const REVISE =
  "Revise the text below following the user's directions. Keep every fact, number and name that the directions do " +
  "not ask you to drop, and do not add facts that are not in the text. Use '## ' for headings and '- ' or '1. ' for " +
  'lists when they help. Reply with the revised text only.'

export const FILL_FROM_SPEECH =
  "You are given someone's own notes for one part of a talk, and the transcript of what the speaker said during that " +
  "part. Write, as short bullet lines starting with '- ', the important points the speaker made that the notes do not " +
  'already contain. Keep facts, numbers and names exactly, in the language of the talk. Do not repeat what the notes ' +
  'already say. If the notes already cover everything, reply exactly: Nothing to add.'

export const NOTES_FROM_SPEECH =
  "Turn this transcript of a talk into clear lecture notes in the language of the talk: '## ' headings for the topics " +
  "in the order they came, and under each, short paragraphs or bullet lines starting with '- '. Keep facts, numbers " +
  'and names exactly; drop hesitations, repetitions and small talk. Reply with the notes only.'

export const SPEECH_PART =
  "Summarise this part of a talk's transcript as bullet lines starting with '- ', keeping facts, numbers and names. " +
  'Reply with the bullets only.'

export interface AiChoice {
  provider: ProviderId
  model: string
  /** "Ollama · qwen3.5:4b" */
  label: string
}

/** The provider and model KherveAI is set to use (an installed Ollama model by default). */
export async function chooseModel(): Promise<AiChoice> {
  const s = loadSettings()
  const provider = s.provider
  let model = s.models[provider]
  if (provider === 'ollama') {
    let installed
    try {
      installed = await fetchOllamaModels(s.ollamaUrl)
    } catch {
      throw new Error(
        `Ollama is not running on this computer (${s.ollamaUrl}). Start it (the Ollama app, or "ollama serve") — or choose Claude or ChatGPT in kAI's settings.`,
      )
    }
    if (!installed.length) throw new Error('Ollama has no model yet. Install one in a terminal, e.g.:  ollama pull qwen3.5:4b')
    model = pickOllamaModel(installed, model)
  }
  if (!model) model = PROVIDERS[provider].defaultModel
  return { provider, model, label: `${PROVIDERS[provider].name} · ${model}` }
}

const THINK_RE = /<think>[\s\S]*?<\/think>/g

export interface AskOptions {
  signal?: AbortSignal
  /** Each piece of the answer as it is written. */
  onText?: (piece: string) => void
  choice?: AiChoice
}

/** One answer from the model, streamed; <think> blocks removed. */
export async function ask(system: string, text: string, opts: AskOptions = {}): Promise<string> {
  const choice = opts.choice ?? (await chooseModel())
  const s = loadSettings()
  const parts: string[] = []
  await streamChat({
    provider: choice.provider,
    model: choice.model,
    system,
    history: [{ id: 'kn', role: 'user', time: Date.now(), text }],
    tools: null,
    signal: opts.signal ?? new AbortController().signal,
    key: loadKey(choice.provider),
    ollamaUrl: s.ollamaUrl,
    // A long transcript needs room; Ollama's default window would cut it off silently.
    numCtx: Math.max(s.numCtx, 16384),
    // Reasoning models would otherwise spend minutes thinking about a paragraph.
    think: choice.provider === 'ollama' ? false : null,
    onEvent: (e) => {
      if (e.type === 'text') {
        parts.push(e.text)
        opts.onText?.(e.text)
      }
    },
  })
  return parts.join('').replace(THINK_RE, '').trim()
}

/** The user's own directions, which win over the format but never over the facts (with_directions). */
export function withDirections(system: string, directions: string): string {
  const d = directions.trim()
  if (!d) return system
  return (
    system +
    '\n\nThe user gives these directions; follow them, even where they change the format or language asked for above — ' +
    'but never invent facts that are not in the text:\n' +
    d
  )
}

export function revise(text: string, directions: string, opts: AskOptions = {}): Promise<string> {
  const d = directions.trim()
  return ask(withDirections(REVISE, d), `${text.slice(0, 40000)}\n\n---\nDirections from the user (follow them exactly): ${d}`, opts)
}

export function fillFromSpeech(notes: string, speech: string, opts: AskOptions = {}): Promise<string> {
  return ask(FILL_FROM_SPEECH, `My notes:\n${notes || '(nothing written)'}\n\nTranscript:\n${speech.slice(0, 40000)}`, opts)
}

/** Notes from a transcript; a long one is condensed part by part first. */
export async function notesFromSpeech(transcript: string, opts: AskOptions & { onStep?: (s: string) => void } = {}, budget = 18000): Promise<string> {
  if (transcript.length <= budget) {
    opts.onStep?.('Writing notes from the speech')
    return ask(NOTES_FROM_SPEECH, transcript, opts)
  }
  const parts: string[] = []
  let buf = ''
  for (const line of transcript.split('\n')) {
    if (buf && buf.length + line.length > budget) {
      parts.push(buf)
      buf = ''
    }
    buf += line + '\n'
  }
  if (buf) parts.push(buf)
  const condensed: string[] = []
  for (let i = 0; i < parts.length; i++) {
    opts.onStep?.(`Reading the speech: part ${i + 1} of ${parts.length}`)
    condensed.push(await ask(SPEECH_PART, parts[i], { ...opts, onText: undefined }))
  }
  opts.onStep?.('Writing notes from the speech')
  return ask(NOTES_FROM_SPEECH, condensed.join('\n'), opts)
}
