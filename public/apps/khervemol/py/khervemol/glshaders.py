"""GLSL sources for the OpenGL viewer (`glview.GLView`).

Everything is ``#version 120`` (OpenGL 2.1) so the same shaders run on
macOS's legacy profile and on Windows / Linux compatibility contexts.
Atoms and bonds are drawn as **impostors** — one camera-facing quad each,
with the fragment shader solving the exact sphere / cylinder under every
pixel, shading it, and writing ``gl_FragDepth`` so intersecting balls and
sticks occlude one another correctly.

View space is the isometric camera of `model._proj`: x to the right, y up,
z toward the viewer, in ångström; ``u_scale`` turns that into clip space
(orthographic) and ``u_zk`` maps depth into [-1, 1].

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

#: Attribute slots, bound by name before linking (order = location).
SPHERE_ATTRS = ["a_center", "a_corner", "a_radius", "a_color"]
CYL_ATTRS = ["a_p0", "a_p1", "a_corner", "a_radius", "a_off", "a_color"]
BG_ATTRS = ["a_pos"]
POLY_ATTRS = ["a_pos", "a_nrm", "a_color"]

# Shared view transform.
_VIEW = """
uniform vec3 u_origin;
uniform vec2 u_pan;        // view-plane shift (tight-fit centring)
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_fwd;        // toward the viewer
uniform vec2 u_scale;      // clip units per angstrom (x, y)
uniform float u_zk;        // clip z = -view z * u_zk
vec3 to_view(vec3 p) {
    vec3 d = p - u_origin;
    return vec3(dot(d, u_right) - u_pan.x, dot(d, u_up) - u_pan.y, dot(d, u_fwd));
}
"""

SPHERE_VERTEX = """
#version 120
attribute vec3 a_center;
attribute vec2 a_corner;
attribute float a_radius;
attribute vec3 a_color;
uniform float u_ppa;       // device pixels per angstrom
uniform float u_mult;      // quad radius multiplier (1 sphere, >1 halo)
uniform float u_zlift;     // fraction of the radius the quad is lifted toward the viewer
""" + _VIEW + """
varying vec2 v_uv;
varying vec3 v_color;
varying vec3 v_vc;
varying float v_rad;
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
"""

# The lighting model shared by spheres and cylinders: a key light from the
# upper left, a cool fill, a soft + a tight specular lobe, a fresnel rim and
# depth-cue fog toward the background colour.
_SHADE = """
uniform float u_a2c;       // 1 when alpha-to-coverage antialiasing is on
uniform float u_fog;       // fog strength at the far side
uniform float u_zfar;      // view z that is fully fogged
uniform float u_znear;     // view z that is not fogged
uniform vec3 u_fogcolor;
uniform float u_gloss;     // specular strength (0..1)
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
// Coverage -> output alpha. With alpha-to-coverage the alpha *is* the
// MSAA coverage mask; without it fall back to a hard edge.
float coverage(float cov) {
    if (u_a2c > 0.5) {
        if (cov <= 0.0) discard;
    } else if (cov < 0.5) {
        discard;
    }
    return cov;
}
"""

SPHERE_FRAGMENT = """
#version 120
uniform float u_ppa;
uniform float u_zk;
""" + _SHADE + """
varying vec2 v_uv;
varying vec3 v_color;
varying vec3 v_vc;
varying float v_rad;
void main() {
    float d = length(v_uv);
    float cov = clamp((1.0 - d) * v_rad * u_ppa + 0.5, 0.0, 1.0);
    float alpha = coverage(cov);
    vec2 uv = (d > 1.0) ? v_uv / d : v_uv;
    float z = sqrt(max(1.0 - dot(uv, uv), 0.0));
    vec3 n = vec3(uv, z);
    float vz = v_vc.z + z * v_rad;
    gl_FragColor = vec4(shade(n, v_color, vz), alpha);
    gl_FragDepth = clamp(-vz * u_zk * 0.5 + 0.5, 0.0, 1.0);
}
"""

# Selection halo: a soft ring just outside the ball, blended on top.
HALO_FRAGMENT = """
#version 120
uniform float u_mult;
uniform float u_dash;      // >0.5: a thin dashed ring (the tilt-cell target)
varying vec2 v_uv;
varying vec3 v_color;
varying vec3 v_vc;
varying float v_rad;
void main() {
    float d = length(v_uv);            // 1.0 at the ball's silhouette
    float span = u_mult - 1.0;
    if (u_dash > 0.5) {
        float dt = (d - 1.02) / max(span - 0.02, 1e-3);
        if (dt < 0.0 || dt > 1.0) discard;
        if (sin(atan(v_uv.y, v_uv.x) * 9.0) < 0.0) discard;
        float edge = smoothstep(0.0, 0.25, dt) * (1.0 - smoothstep(0.7, 1.0, dt));
        gl_FragColor = vec4(v_color, edge);
        return;
    }
    float t = clamp((d - 1.0) / span, 0.0, 1.0);
    if (d < 0.985 || t >= 1.0) discard;
    float ring = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.08, 0.26, t));
    float glow = pow(1.0 - t, 1.8) * 0.70;
    float a = clamp(ring * 0.95 + glow, 0.0, 1.0);
    a *= smoothstep(0.985, 1.0, d);
    vec3 col = mix(v_color, vec3(1.0), 0.18 * ring);
    gl_FragColor = vec4(col, a);
}
"""

CYL_VERTEX = """
#version 120
attribute vec3 a_p0;
attribute vec3 a_p1;
attribute vec2 a_corner;   // x: 0 at p0 .. 1 at p1, y: -1 / +1 across
attribute float a_radius;  // negative: a hairline (never thinner than ~1 px)
attribute float a_off;     // sideways shift, angstrom, perpendicular to view
attribute vec3 a_color;
uniform float u_ppa;
""" + _VIEW + """
varying vec3 v_p0;
varying vec3 v_p1;
varying vec2 v_xy;
varying float v_rad;
varying vec3 v_color;
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
"""

CYL_FRAGMENT = """
#version 120
uniform float u_ppa;
uniform float u_zk;
""" + _SHADE + """
varying vec3 v_p0;
varying vec3 v_p1;
varying vec2 v_xy;
varying float v_rad;
varying vec3 v_color;
void main() {
    vec3 axis = v_p1 - v_p0;
    float len = length(axis);
    vec3 a = axis / max(len, 1e-6);
    vec3 o = vec3(v_xy, 0.0) - v_p0;
    vec3 e = vec3(0.0, 0.0, 1.0);
    vec3 A = o - dot(o, a) * a;
    vec3 B = e - a.z * a;
    float bb = dot(B, B);
    if (bb < 1e-8) discard;               // looking straight down the bond
    float ab = dot(A, B);
    float disc = ab * ab - bb * (dot(A, A) - v_rad * v_rad);
    float t = (-ab + sqrt(max(disc, 0.0))) / bb;     // nearest to the viewer
    vec3 q = vec3(v_xy, t);
    float s = dot(q - v_p0, a);
    float slack = 1.0 / u_ppa;
    if (s < -slack || s > len + slack) discard;
    // perpendicular distance of the pixel from the projected axis
    vec2 sd = a.xy;
    float sl = length(sd);
    vec2 perp = (sl > 1e-5) ? vec2(-sd.y, sd.x) / sl : vec2(0.0, 1.0);
    float dperp = abs(dot(v_xy - v_p0.xy, perp));
    float cov = clamp((v_rad - dperp) * u_ppa + 0.5, 0.0, 1.0);
    float alpha = coverage(cov);
    vec3 n = normalize(q - (v_p0 + a * clamp(s, 0.0, len)));
    gl_FragColor = vec4(shade(n, v_color, q.z), alpha);
    gl_FragDepth = clamp(-q.z * u_zk * 0.5 + 0.5, 0.0, 1.0);
}
"""

BG_VERTEX = """
#version 120
attribute vec2 a_pos;
varying vec2 v_p;
void main() {
    v_p = a_pos;
    gl_Position = vec4(a_pos, 0.999, 1.0);
}
"""

BG_FRAGMENT = """
#version 120
uniform vec3 u_top;
uniform vec3 u_bottom;
varying vec2 v_p;
void main() {
    float t = clamp(0.5 - v_p.y * 0.5, 0.0, 1.0);
    vec3 col = mix(u_top, u_bottom, t * t * (3.0 - 2.0 * t));
    float vig = dot(v_p * vec2(0.55, 0.7), v_p * vec2(0.55, 0.7));
    col *= 1.0 - 0.06 * vig;
    gl_FragColor = vec4(col, 1.0);
}
"""

# Translucent coordination-polyhedron faces: two-sided flat shading, blended
# over the opaque pass (depth-tested, no depth writes).
POLY_VERTEX = """
#version 120
attribute vec3 a_pos;
attribute vec3 a_nrm;
attribute vec3 a_color;
""" + _VIEW + """
varying vec3 v_nrm;
varying vec3 v_color;
void main() {
    vec3 p = to_view(a_pos);
    v_nrm = vec3(dot(a_nrm, u_right), dot(a_nrm, u_up), dot(a_nrm, u_fwd));
    v_color = a_color;
    gl_Position = vec4(p.xy * u_scale, -p.z * u_zk, 1.0);
}
"""

POLY_FRAGMENT = """
#version 120
uniform float u_alpha;
varying vec3 v_nrm;
varying vec3 v_color;
void main() {
    vec3 n = normalize(v_nrm);
    vec3 key = normalize(vec3(-0.45, 0.62, 0.66));
    float k = 0.68 + 0.32 * abs(dot(n, key));
    float rim = pow(1.0 - abs(n.z), 2.0) * 0.10;
    gl_FragColor = vec4(min(v_color * k + rim, 1.0), u_alpha);
}
"""
