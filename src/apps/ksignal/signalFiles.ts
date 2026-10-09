// Reading signal files in the browser app: WAV (own parser), other audio (Web Audio decoding) and CSV / text.
// Kept apart from KSignal.tsx so the window component stays about the window.

import { fs, path } from '@/os'
import { decodeAudio } from './audio'
import { parseCsv } from './csv'
import { looksLikeWav, readWav } from './wav'
import type { DataSource } from './project'

export interface LoadedSignal {
  name: string
  fs: number
  channels: Float64Array[]
  origin: DataSource['origin']
  warnings: string[]
}

const CSV_EXT = new Set(['.csv', '.tsv', '.txt', '.dat', '.asc', '.prn'])

export const IMPORT_EXTENSIONS = ['.ksig', '.wav', '.mp3', '.ogg', '.oga', '.flac', '.m4a', '.aac', '.opus', '.webm', '.csv', '.tsv', '.txt', '.dat']

/**
 * Reads a signal from the drive. `askRate` is called for text files without a time column and returns the sample rate
 * (null: the user cancelled).
 */
export async function readSignalFile(p: string, askRate: (suggested: number) => Promise<number | null>): Promise<LoadedSignal> {
  const name = path.basename(p)
  const stem = name.replace(/\.[^.]+$/, '')
  const ext = path.extname(p).toLowerCase()
  if (CSV_EXT.has(ext)) {
    const text = await fs.readText(p)
    let c = parseCsv(text)
    if (!c.hasTime && c.warnings.some((w) => /sample rate/.test(w))) {
      const rate = await askRate(1000)
      if (rate === null) throw new Error('cancelled')
      c = parseCsv(text, { fs: rate })
    }
    return { name: stem, fs: c.fs, channels: [c.samples], origin: 'csv', warnings: c.warnings }
  }
  const bytes = await fs.readBytes(p)
  if (looksLikeWav(bytes)) {
    try {
      const w = readWav(bytes)
      return { name: stem, fs: w.fs, channels: w.channels, origin: 'wav', warnings: [] }
    } catch (e) {
      // compressed WAV (ADPCM…): the browser may still know it
      try {
        const a = await decodeAudio(bytes)
        return { name: stem, fs: a.fs, channels: a.channels, origin: 'audio', warnings: [] }
      } catch { throw e }
    }
  }
  const a = await decodeAudio(bytes)
  return { name: stem, fs: a.fs, channels: a.channels, origin: 'audio', warnings: [] }
}
