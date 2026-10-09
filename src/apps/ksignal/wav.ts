// WAV files (pure): read PCM 8/16/24/32-bit and IEEE float 32/64 (also WAVE_FORMAT_EXTENSIBLE), write PCM 8/16/24/32
// and float32. Samples are Float64Array in −1 … +1.

export type WavFormat = 'pcm8' | 'pcm16' | 'pcm24' | 'pcm32' | 'float32'

export const WAV_FORMAT_LABELS: Record<WavFormat, string> = {
  pcm8: '8-bit PCM', pcm16: '16-bit PCM', pcm24: '24-bit PCM', pcm32: '32-bit PCM', float32: '32-bit float',
}

export interface WavData {
  fs: number
  /** One array per channel. */
  channels: Float64Array[]
  /** Bits per sample in the file and whether they were floats. */
  bits: number
  float: boolean
}

const tag = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))

/** True when the bytes start like a WAV file. */
export function looksLikeWav(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WAVE'
}

export function readWav(bytes: Uint8Array): WavData {
  if (!looksLikeWav(bytes)) throw new Error('This is not a WAV file (it does not start with RIFF…WAVE).')
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 12
  let fmt: { format: number; channels: number; fs: number; bits: number; align: number } | null = null
  let dataStart = -1
  let dataLen = 0
  while (pos + 8 <= bytes.length) {
    const id = tag(v, pos)
    let size = v.getUint32(pos + 4, true)
    const body = pos + 8
    if (id === 'fmt ') {
      let format = v.getUint16(body, true)
      const channels = v.getUint16(body + 2, true)
      const fs = v.getUint32(body + 4, true)
      const align = v.getUint16(body + 12, true)
      const bits = v.getUint16(body + 14, true)
      if (format === 0xfffe && size >= 26) format = v.getUint16(body + 24, true) // the sub-format GUID starts with the real tag
      fmt = { format, channels, fs, bits, align }
    } else if (id === 'data') {
      dataStart = body
      if (size > bytes.length - body) size = bytes.length - body // streamed or truncated files
      dataLen = size
      if (fmt) break
    }
    pos = body + size + (size % 2)
  }
  if (!fmt) throw new Error('The WAV file has no fmt chunk.')
  if (dataStart < 0) throw new Error('The WAV file has no data chunk.')
  const { format, channels, fs, bits } = fmt
  if (channels < 1 || channels > 16) throw new Error(`The WAV file has ${channels} channels.`)
  if (!(fs > 0)) throw new Error('The WAV file has no sample rate.')
  const float = format === 3
  if (format !== 1 && !float) throw new Error(`This WAV file is compressed (format ${format}); only PCM and float files can be read here.`)
  if (!float && ![8, 16, 24, 32].includes(bits)) throw new Error(`${bits}-bit PCM is not supported.`)
  if (float && ![32, 64].includes(bits)) throw new Error(`${bits}-bit float is not supported.`)
  const bytesPer = bits / 8
  const frames = Math.floor(dataLen / (bytesPer * channels))
  const out = Array.from({ length: channels }, () => new Float64Array(frames))
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const o = dataStart + (i * channels + c) * bytesPer
      let s: number
      if (float) s = bits === 32 ? v.getFloat32(o, true) : v.getFloat64(o, true)
      else if (bits === 8) s = (v.getUint8(o) - 128) / 128
      else if (bits === 16) s = v.getInt16(o, true) / 32768
      else if (bits === 24) {
        let n = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16)
        if (n & 0x800000) n -= 0x1000000
        s = n / 8388608
      } else s = v.getInt32(o, true) / 2147483648
      out[c][i] = s
    }
  }
  return { fs, channels: out, bits, float }
}

/** Mono mix (mean) of the channels. */
export function mixToMono(channels: readonly Float64Array[]): Float64Array {
  if (channels.length === 1) return channels[0]
  const n = channels[0].length
  const out = new Float64Array(n)
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length
  return out
}

/** A WAV file. Samples beyond ±1 are clipped for the PCM formats. */
export function writeWav(channels: readonly ArrayLike<number>[], fs: number, format: WavFormat = 'pcm16'): Uint8Array {
  const nch = channels.length
  const frames = nch ? channels[0].length : 0
  const bits = format === 'pcm8' ? 8 : format === 'pcm16' ? 16 : format === 'pcm24' ? 24 : 32
  const bytesPer = bits / 8
  const dataLen = frames * nch * bytesPer
  const buf = new ArrayBuffer(44 + dataLen + (dataLen % 2))
  const v = new DataView(buf)
  const put = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  put(0, 'RIFF'); v.setUint32(4, 36 + dataLen + (dataLen % 2), true); put(8, 'WAVE')
  put(12, 'fmt '); v.setUint32(16, 16, true)
  v.setUint16(20, format === 'float32' ? 3 : 1, true)
  v.setUint16(22, nch, true)
  v.setUint32(24, Math.round(fs), true)
  v.setUint32(28, Math.round(fs) * nch * bytesPer, true)
  v.setUint16(32, nch * bytesPer, true)
  v.setUint16(34, bits, true)
  put(36, 'data'); v.setUint32(40, dataLen, true)
  const clip = (x: number) => (x > 1 ? 1 : x < -1 ? -1 : Number.isFinite(x) ? x : 0)
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const o = 44 + (i * nch + c) * bytesPer
      const x = channels[c][i]
      switch (format) {
        case 'float32': v.setFloat32(o, x, true); break
        case 'pcm8': v.setUint8(o, Math.max(0, Math.min(255, Math.round(clip(x) * 128) + 128))); break
        case 'pcm16': v.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(clip(x) * 32768))), true); break
        case 'pcm24': {
          const n = Math.max(-8388608, Math.min(8388607, Math.round(clip(x) * 8388608)))
          v.setUint8(o, n & 255); v.setUint8(o + 1, (n >> 8) & 255); v.setUint8(o + 2, (n >> 16) & 255)
          break
        }
        case 'pcm32': v.setInt32(o, Math.max(-2147483648, Math.min(2147483647, Math.round(clip(x) * 2147483648))), true); break
      }
    }
  }
  return new Uint8Array(buf)
}
