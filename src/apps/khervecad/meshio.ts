// Triangle meshes as flat Float32Arrays (x, y, z × 3 per triangle): reading
// what OpenSCAD writes (OFF, ASCII / binary STL), and base64 both ways for the
// trip to and from Python. Pure functions (tests in tests/logic.test.mjs).

/** OFF text → triangles (faces fan-triangulated, like engine._parse_off). */
export function parseOff(text: string): Float32Array {
  const tokens: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const body = line.split('#', 1)[0].trim()
    if (body) tokens.push(...body.split(/\s+/))
  }
  if (!tokens.length) return new Float32Array(0)
  let i = /OFF$/i.test(tokens[0]) ? 1 : 0
  const nv = parseInt(tokens[i], 10)
  const nf = parseInt(tokens[i + 1], 10)
  if (!Number.isFinite(nv) || !Number.isFinite(nf)) return new Float32Array(0)
  i += 3
  const verts = new Float64Array(nv * 3)
  for (let v = 0; v < nv; v++, i += 3) {
    verts[v * 3] = +tokens[i]
    verts[v * 3 + 1] = +tokens[i + 1]
    verts[v * 3 + 2] = +tokens[i + 2]
  }
  const out: number[] = []
  for (let f = 0; f < nf && i < tokens.length; f++) {
    const cnt = parseInt(tokens[i++], 10)
    const face: number[] = []
    for (let j = 0; j < cnt; j++) face.push(parseInt(tokens[i + j], 10))
    i += cnt
    // colour columns after the indices (COFF) are skipped by the loop's
    // own count: OFF puts them on the same line, which the token scan reads
    while (i < tokens.length && tokens[i].includes('.') && !/^\d+$/.test(tokens[i])) i++
    for (let j = 1; j < cnt - 1; j++)
      for (const k of [face[0], face[j], face[j + 1]]) out.push(verts[k * 3], verts[k * 3 + 1], verts[k * 3 + 2])
  }
  return new Float32Array(out)
}

/** STL (binary or ASCII) → triangles. */
export function parseStl(bytes: Uint8Array): Float32Array {
  if (bytes.length >= 84) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const count = dv.getUint32(80, true)
    if (84 + count * 50 === bytes.length) {
      const out = new Float32Array(count * 9)
      for (let t = 0; t < count; t++) {
        const base = 84 + t * 50 + 12
        for (let k = 0; k < 9; k++) out[t * 9 + k] = dv.getFloat32(base + k * 4, true)
      }
      return out
    }
  }
  const text = new TextDecoder().decode(bytes)
  const out: number[] = []
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3])
  return new Float32Array(out.length - (out.length % 9) ? out.slice(0, out.length - (out.length % 9)) : out)
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** base64 of little-endian float32s → Float32Array. */
export function floatsFromBase64(b64: string): Float32Array {
  const bytes = fromBase64(b64)
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2)
}

export function u16FromBase64(b64: string): Uint16Array {
  const bytes = fromBase64(b64)
  return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1)
}

export function floatsToBase64(values: Float32Array): string {
  return toBase64(new Uint8Array(values.buffer, values.byteOffset, values.byteLength))
}

/** Bounds of a flat triangle array: [minx, miny, minz, maxx, maxy, maxz]. */
export function bounds(pos: Float32Array): number[] | null {
  if (pos.length < 3) return null
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = pos[i + k]
      if (v < b[k]) b[k] = v
      if (v > b[k + 3]) b[k + 3] = v
    }
  }
  return b
}
