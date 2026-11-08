// Gunshots made with WebAudio, for the first-person games (Last Train,
// DataCenter Assault). A real shot is several sounds at once, and each is a
// layer here: the supersonic crack (a few milliseconds of bright noise), the
// blast's body (band-passed noise, saturated), the low punch you feel in the
// chest (a sine dropping in pitch, clipped), the action cycling (a metallic
// click), and the room answering (a convolution reverb). Everything goes
// through one compressor so a burst of fire is loud without clipping.

import { audioOut } from './sound'

export type GunKind =
  | 'pistol' | 'magnum' | 'rifle' | 'smg' | 'dmr' | 'shotgun' | 'autoshotgun' | 'minigun'
  | 'launcher' | 'rocket' | 'rail' | 'arc' | 'explosion'

interface Profile {
  /** The crack: high-passed at `crackF`, `crackDur` long. */
  crack: number
  crackF: number
  crackDur: number
  /** The body: band-passed noise around `bodyF`. */
  body: number
  bodyF: number
  bodyQ: number
  bodyDur: number
  /** The punch: a sine from `f0` down to `f1`. */
  punch: number
  f0: number
  f1: number
  punchDur: number
  /** How much goes to the room, and a low rumble after the shot. */
  room: number
  rumble: number
  /** The action: a click after the shot (a slide, a bolt). */
  click: number
}

const P: Record<GunKind, Profile> = {
  pistol: { crack: 0.9, crackF: 3500, crackDur: 0.014, body: 0.9, bodyF: 1300, bodyQ: 0.8, bodyDur: 0.09, punch: 1.0, f0: 150, f1: 55, punchDur: 0.09, room: 0.5, rumble: 0.25, click: 0.25 },
  magnum: { crack: 1.1, crackF: 3000, crackDur: 0.02, body: 1.1, bodyF: 950, bodyQ: 0.7, bodyDur: 0.16, punch: 1.35, f0: 110, f1: 38, punchDur: 0.2, room: 0.75, rumble: 0.45, click: 0.15 },
  rifle: { crack: 1.0, crackF: 4500, crackDur: 0.011, body: 0.95, bodyF: 1700, bodyQ: 0.75, bodyDur: 0.075, punch: 0.95, f0: 125, f1: 48, punchDur: 0.08, room: 0.45, rumble: 0.3, click: 0.12 },
  smg: { crack: 0.75, crackF: 4200, crackDur: 0.009, body: 0.75, bodyF: 2100, bodyQ: 0.8, bodyDur: 0.055, punch: 0.65, f0: 160, f1: 70, punchDur: 0.055, room: 0.35, rumble: 0.15, click: 0.1 },
  dmr: { crack: 1.25, crackF: 4000, crackDur: 0.016, body: 1.1, bodyF: 1150, bodyQ: 0.7, bodyDur: 0.14, punch: 1.35, f0: 95, f1: 34, punchDur: 0.22, room: 0.9, rumble: 0.55, click: 0.3 },
  shotgun: { crack: 0.85, crackF: 2600, crackDur: 0.02, body: 1.3, bodyF: 700, bodyQ: 0.5, bodyDur: 0.22, punch: 1.55, f0: 80, f1: 30, punchDur: 0.3, room: 0.85, rumble: 0.6, click: 0 },
  autoshotgun: { crack: 0.8, crackF: 2700, crackDur: 0.018, body: 1.2, bodyF: 760, bodyQ: 0.5, bodyDur: 0.17, punch: 1.35, f0: 85, f1: 32, punchDur: 0.22, room: 0.6, rumble: 0.4, click: 0.1 },
  minigun: { crack: 0.6, crackF: 4800, crackDur: 0.008, body: 0.7, bodyF: 2500, bodyQ: 0.9, bodyDur: 0.045, punch: 0.6, f0: 150, f1: 70, punchDur: 0.045, room: 0.25, rumble: 0.1, click: 0 },
  launcher: { crack: 0.2, crackF: 2000, crackDur: 0.02, body: 0.7, bodyF: 450, bodyQ: 0.8, bodyDur: 0.1, punch: 1.2, f0: 130, f1: 60, punchDur: 0.14, room: 0.4, rumble: 0.2, click: 0.3 },
  rocket: { crack: 0.3, crackF: 2000, crackDur: 0.03, body: 0.9, bodyF: 600, bodyQ: 0.6, bodyDur: 0.35, punch: 1.1, f0: 90, f1: 40, punchDur: 0.25, room: 0.6, rumble: 0.5, click: 0 },
  rail: { crack: 1.2, crackF: 5000, crackDur: 0.03, body: 0.8, bodyF: 2400, bodyQ: 1.5, bodyDur: 0.3, punch: 1.4, f0: 80, f1: 28, punchDur: 0.35, room: 0.9, rumble: 0.5, click: 0 },
  arc: { crack: 0.5, crackF: 6000, crackDur: 0.04, body: 0.35, bodyF: 3200, bodyQ: 3, bodyDur: 0.09, punch: 0.3, f0: 60, f1: 50, punchDur: 0.1, room: 0.25, rumble: 0, click: 0 },
  explosion: { crack: 0.6, crackF: 1800, crackDur: 0.05, body: 1.5, bodyF: 500, bodyQ: 0.4, bodyDur: 0.9, punch: 1.8, f0: 65, f1: 22, punchDur: 0.85, room: 1, rumble: 1, click: 0 },
}

interface Bus {
  ac: AudioContext
  input: GainNode
  send: GainNode
  white: AudioBuffer
  brown: AudioBuffer
  clip: WaveShaperNode
  soft: Float32Array<ArrayBuffer>
}

let bus: Bus | null = null

/** How the room sounds: 0 dry (outdoors), 1 a long hard station. Set by the game for where the player is. */
let roomSize = 0.7
export function setGunRoom(k: number) {
  roomSize = Math.max(0, Math.min(1, k))
}

function curve(drive: number): Float32Array<ArrayBuffer> {
  const n = 1024
  const c = new Float32Array(new ArrayBuffer(n * 4))
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    c[i] = Math.tanh(x * drive) / Math.tanh(drive)
  }
  return c
}

function getBus(): Bus | null {
  const o = audioOut()
  if (!o) return null
  if (bus?.ac === o.ac) return bus
  const { ac, dest } = o
  const comp = ac.createDynamicsCompressor()
  comp.threshold.value = -20
  comp.knee.value = 8
  comp.ratio.value = 6
  comp.attack.value = 0.002
  comp.release.value = 0.18
  const out = ac.createGain()
  out.gain.value = 1.9
  comp.connect(out).connect(dest)
  const input = ac.createGain()
  input.connect(comp)
  // the room: early reflections, then a diffuse tail
  const conv = ac.createConvolver()
  const len = Math.floor(ac.sampleRate * 2.4)
  const ir = ac.createBuffer(2, len, ac.sampleRate)
  for (let c = 0; c < 2; c++) {
    const ch = ir.getChannelData(c)
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * 0.6
    for (let k = 0; k < 14; k++) {
      const at = Math.floor(ac.sampleRate * (0.008 + Math.random() * 0.09))
      ch[at] += (Math.random() < 0.5 ? -1 : 1) * (0.9 - k * 0.05)
    }
  }
  conv.buffer = ir
  const send = ac.createGain()
  send.connect(conv)
  const wet = ac.createGain()
  wet.gain.value = 0.55
  conv.connect(wet).connect(comp)
  const white = ac.createBuffer(1, ac.sampleRate, ac.sampleRate)
  const w = white.getChannelData(0)
  for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1
  const brown = ac.createBuffer(1, ac.sampleRate, ac.sampleRate)
  const b = brown.getChannelData(0)
  let acc = 0
  for (let i = 0; i < b.length; i++) {
    acc = (acc + (Math.random() * 2 - 1) * 0.1) * 0.99
    b[i] = acc * 3.2
  }
  const clip = ac.createWaveShaper()
  clip.curve = curve(3)
  clip.connect(input)
  bus = { ac, input, send, white, brown, clip, soft: curve(2) }
  return bus
}

function env(ac: AudioContext, t0: number, peak: number, dur: number, attack = 0.0015): GainNode {
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  return g
}

function noiseSrc(b: Bus, buf: AudioBuffer, t0: number, dur: number): AudioBufferSourceNode {
  const s = b.ac.createBufferSource()
  s.buffer = buf
  s.loop = true
  s.start(t0, Math.random() * 0.8)
  s.stop(t0 + dur + 0.05)
  return s
}

/**
 * One shot. `vol` scales it (distance: 1 at the player), `room` overrides how much
 * of it the room gives back (default: the current room). Each shot varies a little.
 */
export function gunshot(kind: GunKind, vol = 1, room = roomSize) {
  const b = getBus()
  if (!b || vol <= 0.01) return
  const p = P[kind]
  const { ac } = b
  const t0 = ac.currentTime + 0.001
  const vary = () => 0.9 + Math.random() * 0.2
  const far = 1 - Math.min(1, vol) // far shots lose their top end
  const send = (node: AudioNode, k: number) => {
    const g = ac.createGain()
    g.gain.value = k * room * (0.6 + far)
    node.connect(g).connect(b.send)
  }

  // the crack
  if (p.crack > 0) {
    const s = noiseSrc(b, b.white, t0, p.crackDur)
    const hp = ac.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = p.crackF * vary() * (1 - far * 0.6)
    const g = env(ac, t0, 0.55 * p.crack * vol * (1 - far * 0.7), p.crackDur, 0.0006)
    s.connect(hp).connect(g).connect(b.clip)
    send(g, 0.4)
  }
  // the body, saturated
  {
    const s = noiseSrc(b, b.white, t0, p.bodyDur * 1.3)
    const bp = ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.setValueAtTime(p.bodyF * vary(), t0)
    bp.frequency.exponentialRampToValueAtTime(Math.max(80, p.bodyF * 0.35), t0 + p.bodyDur)
    bp.Q.value = p.bodyQ
    const lp = ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 9000 * (1 - far * 0.8)
    const g = env(ac, t0, 0.7 * p.body * vol, p.bodyDur * 1.3, 0.001)
    s.connect(bp).connect(lp).connect(g).connect(b.clip)
    send(g, 1)
  }
  // the punch
  {
    const o = ac.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(p.f0 * vary(), t0)
    o.frequency.exponentialRampToValueAtTime(p.f1, t0 + p.punchDur)
    const sh = ac.createWaveShaper()
    sh.curve = b.soft
    const g = env(ac, t0, 0.8 * p.punch * vol, p.punchDur * 1.4, 0.002)
    o.connect(sh).connect(g).connect(b.input)
    send(g, 0.3)
    o.start(t0)
    o.stop(t0 + p.punchDur * 1.4 + 0.05)
  }
  // the rumble rolling away
  if (p.rumble > 0) {
    const s = noiseSrc(b, b.brown, t0, 0.3 + p.rumble * 1.2)
    const lp = ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(900, t0)
    lp.frequency.exponentialRampToValueAtTime(120, t0 + 0.3 + p.rumble)
    const g = env(ac, t0 + 0.01, 0.35 * p.rumble * vol * (0.4 + room), 0.3 + p.rumble * 1.2, 0.02)
    s.connect(lp).connect(g).connect(b.input)
  }
  // the action
  if (p.click > 0 && vol > 0.5) {
    for (const [at, f] of [[0.035, 3800], [0.06, 2600]] as [number, number][]) {
      const s = noiseSrc(b, b.white, t0 + at, 0.012)
      const bp = ac.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = f * vary()
      bp.Q.value = 9
      const g = env(ac, t0 + at, 0.5 * p.click * vol, 0.014, 0.0005)
      s.connect(bp).connect(g).connect(b.input)
    }
  }
  // extras: the rocket's hiss, the railgun's whine, the arc's buzz
  if (kind === 'rocket') {
    const s = noiseSrc(b, b.white, t0, 0.9)
    const bp = ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 2
    bp.frequency.setValueAtTime(700, t0)
    bp.frequency.exponentialRampToValueAtTime(2600, t0 + 0.8)
    const g = env(ac, t0, 0.35 * vol, 0.9, 0.05)
    s.connect(bp).connect(g).connect(b.input)
  } else if (kind === 'rail' || kind === 'arc') {
    const o = ac.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(kind === 'rail' ? 3200 : 120, t0)
    o.frequency.exponentialRampToValueAtTime(kind === 'rail' ? 260 : 90, t0 + (kind === 'rail' ? 0.6 : 0.1))
    const g = env(ac, t0, (kind === 'rail' ? 0.14 : 0.12) * vol, kind === 'rail' ? 0.6 : 0.11)
    o.connect(g).connect(b.input)
    send(g, 0.6)
    o.start(t0)
    o.stop(t0 + 0.65)
  }
}
