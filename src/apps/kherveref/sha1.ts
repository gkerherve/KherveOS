// SHA-1 of a file's bytes, as the desktop records it on each attachment (and
// uses to spot the same PDF twice). WebCrypto when the page is a secure
// context; a small fallback otherwise (KherveOS served over plain http).

export async function sha1Hex(data: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    try {
      const digest = await subtle.digest('SHA-1', data as BufferSource)
      return hex(new Uint8Array(digest))
    } catch {
      /* fall through */
    }
  }
  return sha1Fallback(data)
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

export function sha1Fallback(data: Uint8Array): string {
  const ml = data.length
  const withPad = ((ml + 9 + 63) >> 6) << 6
  const buf = new Uint8Array(withPad)
  buf.set(data)
  buf[ml] = 0x80
  const view = new DataView(buf.buffer)
  view.setUint32(withPad - 8, Math.floor((ml * 8) / 2 ** 32))
  view.setUint32(withPad - 4, (ml * 8) >>> 0)
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n))
  for (let off = 0; off < withPad; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(off + t * 4)
    for (let t = 16; t < 80; t++) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1)
    let a = h0, b = h1, c = h2, d = h3, e = h4
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (b & c) | (~b & d) : t < 40 ? b ^ c ^ d : t < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6
      const tmp = (rotl(a, 5) + f + e + k + w[t]) >>> 0
      e = d
      d = c
      c = rotl(b, 30) >>> 0
      b = a
      a = tmp
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, '0')).join('')
}
