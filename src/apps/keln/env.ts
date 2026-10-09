// What the structured blocks and the editor need from the window around them (a React context, so the blocks inside
// the editor's node views can reach the notebook).

import { createContext, useContext } from 'react'
import type { Attachment, Entry, InventoryItem, Notebook, Sample } from './model'

export interface BlockEnv {
  /** The entry is signed (or the notebook is read-only): nothing can be changed. */
  readOnly: boolean
  nb: Notebook
  entry: Entry
  samples: Sample[]
  inventory: InventoryItem[]
  instruments: string[]
  user: string
  /** A displayable URL for an image attachment, or null while it loads. */
  attUrl(id: string): string | null
  attachment(id: string): Attachment | undefined
  openAttachment(id: string): void
  /** Choose a file from the drive or the computer and attach it to the entry; returns the attachment id. */
  pickFile(kind: 'any' | 'image'): Promise<string | null>
  /** Attach a file the browser gave us (a pasted or dropped picture) and return the attachment. */
  attachFile(file: File): Promise<Attachment | null>
  /** Attach a file of the drive (dragged from Files) and return the attachment. */
  attachPath(path: string): Promise<Attachment | null>
  openPath(path: string): void
  rememberInstrument(name: string): void
  openSample(id: string): void
}

export const BlockEnvContext = createContext<BlockEnv | null>(null)

export function useBlockEnv(): BlockEnv {
  const env = useContext(BlockEnvContext)
  if (!env) throw new Error('A kELN block was drawn outside its notebook.')
  return env
}

/** What the Tiptap extensions need (sample lookups and the dialogs for maths and mentions). */
export type ParentEditorEnv = Omit<EditorEnv, 'pastedFile' | 'droppedPaths'>

export interface EditorEnv {
  sampleExists(id: string): boolean
  sampleLabel(id: string): string
  editMath(initial: string, display: boolean): Promise<string | null>
  pickSample(at: { clientX: number; clientY: number }, done: (id: string) => void): void
  openSample(id: string): void
  pastedFile(file: File): void
  /** Paths dragged from the Files app onto the page. */
  droppedPaths(paths: string[]): void
}
