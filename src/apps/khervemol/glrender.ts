// The OpenGL viewer of the desktop (glview.GLView + glshaders.py) on WebGL 2:
// the same impostor shaders — one camera-facing quad per atom and per stick,
// the exact sphere / cylinder solved per pixel, key + fill light, specular,
// fresnel rim, depth-cue fog, MSAA with alpha-to-coverage, soft selection
// halos, dashed tilt-cell rings and translucent polyhedra — ported from
// GLSL 1.20 to GLSL ES 3.00. Orbiting only changes uniforms.

import { BG_BOTTOM, BG_TOP, CELL_COLOR, POLY_ALPHA, rgb, viewBasis, type RGB, type Scene } from './scene.ts'

const VIEW = `
uniform vec3 u_origin;
uniform vec2 u_pan;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_fwd;
uniform vec2 u_scale;
uniform float u_zk;
vec3 to_view(vec3 p) {
    vec3 d = p - u_origin;
    return vec3(dot(d, u_right) - u_pan.x, dot(d, u_up) - u_pan.y, dot(d, u_fwd));
}
`

const SPHERE_VERTEX = `#version 300 es
precision highp float;
in vec3 a_center;
in vec2 a_corner;
in float a_radius;
in vec3 a_color;
uniform float u_ppa;
uniform float u_mult;
uniform float u_zlift;
${VIEW}
out vec2 v_uv;
out vec3 v_color;
out vec3 v_vc;
out float v_rad;
void main() {
    vec3 vc = to_view(a_center);
    float half_size = a_radius * u_mult + 2.0 / u_ppa;
    vec2 xy = vc.xy + a_corner * half_size;
    v_uv = a_corner * (half_size / a_radius);
    v_color = a_color;
    v_vc = vc;
    v_rad = a_radius;
    gl_Position = vec4(xy * u_scale, -(vc.z + a_radius * u_zlift) * u_zk, 1.0);
}
`

const SHADE = `
uniform float u_a2c;
uniform float u_fog;
uniform float u_zfar;
uniform float u_znear;
uniform vec3 u_fogcolor;
uniform float u_gloss;
vec3 shade(vec3 n, vec3 base, float vz) {
    vec3 key = normalize(vec3(-0.45, 0.62, 0.66));
    vec3 fill = normalize(vec3(0.70, -0.35, 0.45));
    float ndl = dot(n, key);
    float diff = max(ndl, 0.0);
    float soft = clamp(ndl * 0.5 + 0.5, 0.0, 1.0);
    float hemi = n.y * 0.5 + 0.5;
    vec3 col = base * (0.24 + 0.16 * hemi + 0.30 * soft * soft + 0.50 * diff);
    col += base * vec3(0.90, 0.95, 1.0) * 0.10 * max(dot(n, fill), 0.0);
    vec3 h = normalize(key + vec3(0.0, 0.0, 1.0));
    float nh = max(dot(n, h), 0.0);
    vec3 speccol = mix(vec3(1.0), base, 0.12);
    col += speccol * (pow(nh, 70.0) * 0.62 + pow(nh, 14.0) * 0.10) * u_gloss;
    float fres = pow(1.0 - clamp(n.z, 0.0, 1.0), 3.0);
    col += vec3(0.80, 0.90, 1.0) * fres * 0.20 * (0.35 + 0.65 * soft);
    float f = clamp((u_znear - vz) / max(u_znear - u_zfar, 1e-4), 0.0, 1.0);
    col = mix(col, u_fogcolor, f * u_fog);
    return clamp(col, 0.0, 1.0);
}
float coverage(float cov) {
    if (u_a2c > 0.5) {
        if (cov <= 0.0) discard;
    } else if (cov < 0.5) {
        discard;
    }
    return cov;
}
`

const SPHERE_FRAGMENT = `#version 300 es
precision highp float;
uniform float u_ppa;
uniform float u_zk;
${SHADE}
in vec2 v_uv;
in vec3 v_color;
in vec3 v_vc;
in float v_rad;
out vec4 fragColor;
void main() {
    float d = length(v_uv);
    float cov = clamp((1.0 - d) * v_rad * u_ppa + 0.5, 0.0, 1.0);
    float alpha = coverage(cov);
    vec2 uv = (d > 1.0) ? v_uv / d : v_uv;
    float z = sqrt(max(1.0 - dot(uv, uv), 0.0));
    vec3 n = vec3(uv, z);
    float vz = v_vc.z + z * v_rad;
    fragColor = vec4(shade(n, v_color, vz), alpha);
    gl_FragDepth = clamp(-vz * u_zk * 0.5 + 0.5, 0.0, 1.0);
}
`

const HALO_FRAGMENT = `#version 300 es
precision highp float;
uniform float u_mult;
uniform float u_dash;
in vec2 v_uv;
in vec3 v_color;
in vec3 v_vc;
in float v_rad;
out vec4 fragColor;
void main() {
    float d = length(v_uv);
    float span = u_mult - 1.0;
    if (u_dash > 0.5) {
        float dt = (d - 1.02) / max(span - 0.02, 1e-3);
        if (dt < 0.0 || dt > 1.0) discard;
        if (sin(atan(v_uv.y, v_uv.x) * 9.0) < 0.0) discard;
        float edge = smoothstep(0.0, 0.25, dt) * (1.0 - smoothstep(0.7, 1.0, dt));
        fragColor = vec4(v_color, edge);
        return;
    }
    float t = clamp((d - 1.0) / span, 0.0, 1.0);
    if (d < 0.985 || t >= 1.0) discard;
    float ring = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.08, 0.26, t));
    float glow = pow(1.0 - t, 1.8) * 0.70;
    float a = clamp(ring * 0.95 + glow, 0.0, 1.0);
    a *= smoothstep(0.985, 1.0, d);
    vec3 col = mix(v_color, vec3(1.0), 0.18 * ring);
    fragColor = vec4(col, a);
}
`

const CYL_VERTEX = `#version 300 es
precision highp float;
in vec3 a_p0;
in vec3 a_p1;
in vec2 a_corner;
in float a_radius;
in float a_off;
in vec3 a_color;
uniform float u_ppa;
${VIEW}
out vec3 v_p0;
out vec3 v_p1;
out vec2 v_xy;
out float v_rad;
out vec3 v_color;
void main() {
    vec3 p0 = to_view(a_p0);
    vec3 p1 = to_view(a_p1);
    vec2 sd = p1.xy - p0.xy;
    float sl = length(sd);
    vec2 dir = (sl > 1e-5) ? sd / sl : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    float r = abs(a_radius);
    if (a_radius < 0.0) r = max(r, 0.8 / u_ppa);
    p0 += vec3(nrm * a_off, 0.0);
    p1 += vec3(nrm * a_off, 0.0);
    vec2 pad = vec2(1.5 / u_ppa);
    vec2 along = mix(p0.xy, p1.xy, a_corner.x) + dir * ((a_corner.x * 2.0 - 1.0) * pad.x);
    vec2 xy = along + nrm * a_corner.y * (r + pad.y);
    v_p0 = p0;
    v_p1 = p1;
    v_xy = xy;
    v_rad = r;
    v_color = a_color;
    gl_Position = vec4(xy * u_scale, 0.0, 1.0);
}
`

const CYL_FRAGMENT = `#version 300 es
precision highp float;
uniform float u_ppa;
uniform float u_zk;
${SHADE}
in vec3 v_p0;
in vec3 v_p1;
in vec2 v_xy;
in float v_rad;
in vec3 v_color;
out vec4 fragColor;
void main() {
    vec3 axis = v_p1 - v_p0;
    float len = length(axis);
    vec3 a = axis / max(len, 1e-6);
    vec3 o = vec3(v_xy, 0.0) - v_p0;
    vec3 e = vec3(0.0, 0.0, 1.0);
    vec3 A = o - dot(o, a) * a;
    vec3 B = e - a.z * a;
    float bb = dot(B, B);
    if (bb < 1e-8) discard;
    float ab = dot(A, B);
    float disc = ab * ab - bb * (dot(A, A) - v_rad * v_rad);
    float t = (-ab + sqrt(max(disc, 0.0))) / bb;
    vec3 q = vec3(v_xy, t);
    float s = dot(q - v_p0, a);
    float slack = 1.0 / u_ppa;
    if (s < -slack || s > len + slack) discard;
    vec2 sd = a.xy;
    float sl = length(sd);
    vec2 perp = (sl > 1e-5) ? vec2(-sd.y, sd.x) / sl : vec2(0.0, 1.0);
    float dperp = abs(dot(v_xy - v_p0.xy, perp));
    float cov = clamp((v_rad - dperp) * u_ppa + 0.5, 0.0, 1.0);
    float alpha = coverage(cov);
    vec3 n = normalize(q - (v_p0 + a * clamp(s, 0.0, len)));
    fragColor = vec4(shade(n, v_color, q.z), alpha);
    gl_FragDepth = clamp(-q.z * u_zk * 0.5 + 0.5, 0.0, 1.0);
}
`

const BG_VERTEX = `#version 300 es
precision highp float;
in vec2 a_pos;
out vec2 v_p;
void main() {
    v_p = a_pos;
    gl_Position = vec4(a_pos, 0.999, 1.0);
}
`

const BG_FRAGMENT = `#version 300 es
precision highp float;
uniform vec3 u_top;
uniform vec3 u_bottom;
in vec2 v_p;
out vec4 fragColor;
void main() {
    float t = clamp(0.5 - v_p.y * 0.5, 0.0, 1.0);
    vec3 col = mix(u_top, u_bottom, t * t * (3.0 - 2.0 * t));
    float vig = dot(v_p * vec2(0.55, 0.7), v_p * vec2(0.55, 0.7));
    col *= 1.0 - 0.06 * vig;
    fragColor = vec4(col, 1.0);
}
`

const POLY_VERTEX = `#version 300 es
precision highp float;
in vec3 a_pos;
in vec3 a_nrm;
in vec3 a_color;
${VIEW}
out vec3 v_nrm;
out vec3 v_color;
void main() {
    vec3 p = to_view(a_pos);
    v_nrm = vec3(dot(a_nrm, u_right), dot(a_nrm, u_up), dot(a_nrm, u_fwd));
    v_color = a_color;
    gl_Position = vec4(p.xy * u_scale, -p.z * u_zk, 1.0);
}
`

const POLY_FRAGMENT = `#version 300 es
precision highp float;
uniform float u_alpha;
in vec3 v_nrm;
in vec3 v_color;
out vec4 fragColor;
void main() {
    vec3 n = normalize(v_nrm);
    vec3 key = normalize(vec3(-0.45, 0.62, 0.66));
    float k = 0.68 + 0.32 * abs(dot(n, key));
    float rim = pow(1.0 - abs(n.z), 2.0) * 0.10;
    fragColor = vec4(min(v_color * k + rim, 1.0), u_alpha);
}
`

const SPHERE_ATTRS = [['a_center', 3], ['a_corner', 2], ['a_radius', 1], ['a_color', 3]] as const
const CYL_ATTRS = [['a_p0', 3], ['a_p1', 3], ['a_corner', 2], ['a_radius', 1], ['a_off', 1], ['a_color', 3]] as const
const POLY_ATTRS = [['a_pos', 3], ['a_nrm', 3], ['a_color', 3]] as const

type Attrs = readonly (readonly [string, number])[]

interface Prog {
  p: WebGLProgram
  attrs: Attrs
  u: Map<string, WebGLUniformLocation | null>
}

export interface RenderOptions {
  az: number
  el: number
  /** Logical pixels per Å. */
  ppa: number
  /** Device-pixel ratio of the target. */
  dpr: number
  /** Logical pixels kept free on the right for the legend. */
  legend: number
  selection: readonly number[]
  primary: number | null
  /** The other atoms of the cell a tilt would turn (dashed orange rings). */
  cell: readonly number[]
  top?: string
  bottom?: string
}

/** Raised when WebGL 2 cannot run here: the viewer then uses the classic renderer. */
export class GLUnavailable extends Error {}

export class GLRenderer {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private progs: Record<'sphere' | 'halo' | 'cyl' | 'bg' | 'poly', Prog>
  private bufs = new Map<string, { buf: WebGLBuffer; count: number }>()
  private a2c: boolean
  private scene: Scene | null = null
  private haloKey = ''

  constructor(canvas: HTMLCanvasElement, opts: { preserve?: boolean } = {}) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: !!opts.preserve })
    if (!gl) throw new GLUnavailable('WebGL 2 is not available')
    this.gl = gl
    const build = (vs: string, fs: string, attrs: Attrs): Prog => {
      const shader = (type: number, src: string) => {
        const s = gl.createShader(type)!
        gl.shaderSource(s, src)
        gl.compileShader(s)
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new GLUnavailable(`shader: ${gl.getShaderInfoLog(s)}`)
        return s
      }
      const p = gl.createProgram()!
      gl.attachShader(p, shader(gl.VERTEX_SHADER, vs))
      gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs))
      attrs.forEach(([name], i) => gl.bindAttribLocation(p, i, name))
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new GLUnavailable(`shader link: ${gl.getProgramInfoLog(p)}`)
      return { p, attrs, u: new Map() }
    }
    this.progs = {
      sphere: build(SPHERE_VERTEX, SPHERE_FRAGMENT, SPHERE_ATTRS),
      halo: build(SPHERE_VERTEX, HALO_FRAGMENT, SPHERE_ATTRS),
      cyl: build(CYL_VERTEX, CYL_FRAGMENT, CYL_ATTRS),
      bg: build(BG_VERTEX, BG_FRAGMENT, [['a_pos', 2]]),
      poly: build(POLY_VERTEX, POLY_FRAGMENT, POLY_ATTRS),
    }
    for (const name of ['sphere', 'halo', 'cell', 'cyl', 'poly', 'bg']) this.bufs.set(name, { buf: gl.createBuffer()!, count: 0 })
    this.upload('bg', new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2)
    this.a2c = Number(gl.getParameter(gl.SAMPLES)) > 0
  }

  get lost(): boolean {
    return this.gl.isContextLost()
  }

  dispose() {
    const gl = this.gl
    for (const { buf } of this.bufs.values()) gl.deleteBuffer(buf)
    for (const p of Object.values(this.progs)) gl.deleteProgram(p.p)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  private upload(name: string, data: Float32Array, stride: number) {
    const gl = this.gl
    const b = this.bufs.get(name)!
    gl.bindBuffer(gl.ARRAY_BUFFER, b.buf)
    gl.bufferData(gl.ARRAY_BUFFER, data.length ? data : new Float32Array(1), gl.DYNAMIC_DRAW)
    b.count = Math.floor(data.length / stride)
  }

  /** Use this scene (rebuilds the vertex buffers). */
  setScene(scene: Scene) {
    if (scene === this.scene) return
    this.scene = scene
    this.upload('sphere', scene.sphereData(), 9)
    this.upload('cyl', scene.cylinderData(), 13)
    this.upload('poly', scene.polyData(), 9)
    this.haloKey = ''
  }

  private syncHalos(o: RenderOptions) {
    const sc = this.scene!
    const key = `${o.selection.join(',')}|${o.primary}|${o.cell.join(',')}`
    if (key === this.haloKey) return
    this.haloKey = key
    this.upload('halo', sc.haloData(o.selection, o.primary), 9)
    this.upload('cell', sc.haloData(o.cell, null, CELL_COLOR), 9)
  }

  private uni(prog: Prog, name: string): WebGLUniformLocation | null {
    let loc = prog.u.get(name)
    if (loc === undefined) {
      loc = this.gl.getUniformLocation(prog.p, name)
      prog.u.set(name, loc)
    }
    return loc
  }

  private set(prog: Prog, name: string, ...v: number[]) {
    const gl = this.gl
    const loc = this.uni(prog, name)
    if (!loc) return
    if (v.length === 1) gl.uniform1f(loc, v[0])
    else if (v.length === 2) gl.uniform2f(loc, v[0], v[1])
    else gl.uniform3f(loc, v[0], v[1], v[2])
  }

  private common(prog: Prog, az: number, el: number, ppa: number, pw: number, ph: number) {
    const sc = this.scene!
    const [r, u, f] = viewBasis(az, el)
    const zr = sc.bound * 1.3 + 1
    const pan = sc.pan(az, el)
    this.set(prog, 'u_origin', ...sc.center)
    this.set(prog, 'u_pan', ...pan)
    this.set(prog, 'u_right', ...r)
    this.set(prog, 'u_up', ...u)
    this.set(prog, 'u_fwd', ...f)
    this.set(prog, 'u_scale', ppa / (pw / 2), ppa / (ph / 2))
    this.set(prog, 'u_zk', 1 / zr)
    this.set(prog, 'u_ppa', ppa)
  }

  private shading(prog: Prog, top: RGB, bottom: RGB) {
    const sc = this.scene!
    this.set(prog, 'u_a2c', this.a2c ? 1 : 0)
    this.set(prog, 'u_fog', 0.3)
    this.set(prog, 'u_znear', sc.bound)
    this.set(prog, 'u_zfar', -sc.bound)
    this.set(prog, 'u_fogcolor', (top[0] + bottom[0]) / 2, (top[1] + bottom[1]) / 2, (top[2] + bottom[2]) / 2)
    this.set(prog, 'u_gloss', 1)
  }

  private draw(name: string, prog: Prog) {
    const gl = this.gl
    const b = this.bufs.get(name)!
    if (!b.count) return
    gl.bindBuffer(gl.ARRAY_BUFFER, b.buf)
    const stride = prog.attrs.reduce((s, [, n]) => s + n, 0) * 4
    let off = 0
    prog.attrs.forEach(([, size], loc) => {
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off)
      off += size * 4
    })
    gl.drawArrays(gl.TRIANGLES, 0, b.count)
    prog.attrs.forEach((_a, loc) => gl.disableVertexAttribArray(loc))
  }

  /** Draw the scene into the canvas (whose backing size is already set). */
  render(o: RenderOptions) {
    if (!this.scene) return
    const gl = this.gl
    const top = rgb(o.top ?? BG_TOP), bottom = rgb(o.bottom ?? BG_BOTTOM)
    this.syncHalos(o)
    const pw = this.canvas.width, ph = this.canvas.height
    const ppa = o.ppa * o.dpr
    gl.viewport(0, 0, pw, ph)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    gl.depthMask(true)
    gl.colorMask(true, true, true, true)
    gl.clearColor(bottom[0], bottom[1], bottom[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    const bg = this.progs.bg
    gl.useProgram(bg.p)
    this.set(bg, 'u_top', ...top)
    this.set(bg, 'u_bottom', ...bottom)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs.get('bg')!.buf)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.disableVertexAttribArray(0)
    const bpw = Math.max(pw - Math.round(o.legend * o.dpr), 1)
    gl.viewport(0, 0, bpw, ph)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LESS)
    gl.colorMask(true, true, true, false)
    if (this.a2c) gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE)
    const sp = this.progs.sphere
    gl.useProgram(sp.p)
    this.common(sp, o.az, o.el, ppa, bpw, ph)
    this.shading(sp, top, bottom)
    this.set(sp, 'u_mult', 1)
    this.set(sp, 'u_zlift', 0)
    this.draw('sphere', sp)
    const cp = this.progs.cyl
    gl.useProgram(cp.p)
    this.common(cp, o.az, o.el, ppa, bpw, ph)
    this.shading(cp, top, bottom)
    this.draw('cyl', cp)
    if (this.a2c) gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.depthMask(false)
    if (this.bufs.get('poly')!.count) {
      const pp = this.progs.poly
      gl.useProgram(pp.p)
      this.common(pp, o.az, o.el, ppa, bpw, ph)
      this.set(pp, 'u_alpha', POLY_ALPHA)
      this.draw('poly', pp)
    }
    for (const [name, mult, dash] of [['halo', 1.7, 0], ['cell', 1.32, 1]] as const) {
      if (!this.bufs.get(name)!.count) continue
      const hp = this.progs.halo
      gl.useProgram(hp.p)
      this.common(hp, o.az, o.el, ppa, bpw, ph)
      this.set(hp, 'u_mult', mult)
      this.set(hp, 'u_dash', dash)
      this.set(hp, 'u_zlift', 0.9)
      this.draw(name, hp)
    }
    gl.depthMask(true)
    gl.disable(gl.BLEND)
    gl.colorMask(true, true, true, true)
    gl.disable(gl.DEPTH_TEST)
  }
}
