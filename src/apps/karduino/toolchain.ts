// kArduino's calls to the KherveOS server (server/kherveos_server/arduino.py).

import { api, ApiError } from '@/os/server'
import { normalizeResult, type CompileResult } from './build'
import { serverNames, toRequest, type SketchFile } from './sketch'

export interface ToolStatus {
  cli: boolean
  version: string | null
  cores: { id: string; version: string; name: string }[]
  message?: string
}

export interface LibraryInfo {
  name: string
  version: string
  author: string
  sentence: string
}

export interface ServerBoard {
  name: string
  fqbn: string
}

const failure = (e: unknown): CompileResult => ({
  ok: false,
  cli: true,
  output: e instanceof ApiError && e.status === 401 ? 'Sign in to KherveOS to compile: the compiler runs on the server.' : e instanceof Error ? e.message : String(e),
  diagnostics: [],
  size: null,
})

/** Compile (or upload to a board plugged into the server's computer). Never throws. */
export async function build(kind: 'compile' | 'upload', files: SketchFile[], board: string, port?: string): Promise<CompileResult> {
  try {
    const body = { ...toRequest(files, board), ...(kind === 'upload' && port ? { port } : {}) }
    const raw = await api<Partial<CompileResult>>(`/arduino/${kind}`, { method: 'POST', body })
    return normalizeResult(raw, serverNames(files))
  } catch (e) {
    return failure(e)
  }
}

export const toolStatus = (): Promise<ToolStatus | null> => api<ToolStatus>('/arduino/status').catch(() => null)

export async function serverBoards(): Promise<ServerBoard[]> {
  try {
    const r = await api<{ source: string; boards: ServerBoard[] }>('/arduino/boards')
    return r.source === 'cli' ? r.boards : []
  } catch {
    return []
  }
}

export async function listLibraries(): Promise<{ libraries: LibraryInfo[]; cli: boolean; output?: string }> {
  try {
    return await api('/arduino/libraries')
  } catch (e) {
    return { libraries: [], cli: true, output: e instanceof Error ? e.message : String(e) }
  }
}

export async function searchLibraries(query: string): Promise<{ libraries: LibraryInfo[]; cli: boolean; output?: string }> {
  try {
    return await api('/arduino/libraries/search', { method: 'POST', body: { query } })
  } catch (e) {
    return { libraries: [], cli: true, output: e instanceof Error ? e.message : String(e) }
  }
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; cli: boolean; output: string }> {
  try {
    return await api(path, { method: 'POST', body })
  } catch (e) {
    return { ok: false, cli: true, output: e instanceof Error ? e.message : String(e) }
  }
}

export const installLibrary = (name: string) => post('/arduino/libraries/install', { name })
export const installCore = (core: string) => post('/arduino/core/install', { core })
