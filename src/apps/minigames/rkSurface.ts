// Surface detail for the soldier models: the Quaternius characters are
// flat colours, so their fabric, gear and skin get procedural detail in the
// shader instead of image textures. Patterns are computed from the model's
// own bind-pose positions in metres (so they stick to the body while it
// animates, whatever the UVs), and each one also perturbs the normal, so
// the light picks out the relief:
//   uniform: digital urban camo, fabric weave, wrinkles, grime towards the boots
//   gear:    nylon webbing (MOLLE rows), weave, scuffs
//   skin:    mottling, pores, creases
// The visor just becomes glossy glass.

import * as THREE from 'three'

export type SurfaceKind = 'uniform' | 'gear' | 'skin' | 'visor'

/** Which detail a soldier material gets, from its name and colour. */
export function surfaceKindOf(mat: THREE.MeshStandardMaterial): SurfaceKind {
  const name = mat.name.toLowerCase()
  if (/skin/.test(name)) return 'skin'
  if (/visor|glass|lens/.test(name)) return 'visor'
  const c = mat.color
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  if (/^gear|black|dark/.test(name) || lum < 0.035) return 'gear'
  return 'uniform'
}

const KIND_ID: Record<SurfaceKind, number> = { uniform: 0, gear: 1, skin: 2, visor: 3 }

const NOISE = /* glsl */ `
float dHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float dNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dHash(i), dHash(i + vec3(1,0,0)), f.x), mix(dHash(i + vec3(0,1,0)), dHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(dHash(i + vec3(0,0,1)), dHash(i + vec3(1,0,1)), f.x), mix(dHash(i + vec3(0,1,1)), dHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float dFbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * dNoise(p); p *= 2.07; a *= 0.5; } return v; }
// a fine pattern fades out when it gets smaller than a pixel (no shimmering)
float dFade(vec3 p, float freq) { return clamp(1.5 - length(fwidth(p)) * freq * 1.5, 0.0, 1.0); }
`

export function applySurfaceDetail(mat: THREE.MeshStandardMaterial, kind: SurfaceKind, metresPerUnit: number) {
  if (kind === 'visor') {
    mat.roughness = 0.05
    mat.metalness = 0.85
    mat.envMapIntensity = 1.5
    return
  }
  mat.roughness = kind === 'skin' ? 0.55 : kind === 'gear' ? 0.7 : 0.85
  mat.metalness = 0
  const uniforms = { uDetailScale: { value: metresPerUnit }, uDetailKind: { value: KIND_ID[kind] }, uDetailBump: { value: kind === 'skin' ? 0.35 : 0.8 } }
  mat.userData.detail = kind
  mat.customProgramCacheKey = () => `rk-detail-${kind}`
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uDetailScale;\nvarying vec3 vDetailPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvDetailPos = position * uDetailScale;`)
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform int uDetailKind;\nuniform float uDetailBump;\nvarying vec3 vDetailPos;\n${NOISE}`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        vec3 dp = vDetailPos;
        float detailH = 0.0;
        if (uDetailKind == 0) {
          // digital camo: blocky 3 cm cells of three tones, the urban kind
          vec3 cell = floor(dp * 33.0) / 33.0;
          float c = dFbm(cell * 3.1 + 7.0);
          float tone = c < 0.42 ? 0.62 : c < 0.55 ? 1.0 : 1.55;
          diffuseColor.rgb *= mix(1.0, tone, 0.85);
          // fabric weave and wrinkles
          float wf = dFade(dp, 900.0);
          float weave = (sin(dp.x * 900.0) * sin(dp.y * 900.0 + dp.z * 900.0)) * 0.5 + 0.5;
          float folds = 1.0 - abs(dFbm(vec3(dp.x * 9.0, dp.y * 3.5, dp.z * 9.0)) * 2.0 - 1.0);
          detailH = folds * 0.9 + weave * 0.12 * wf;
          diffuseColor.rgb *= 0.88 + 0.12 * weave * wf + 0.1 * folds;
          // dust and wear, heavier towards the boots
          float dirt = dFbm(dp * 6.0) * smoothstep(0.7, 0.0, dp.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.14, 0.11), dirt * 0.45);
        } else if (uDetailKind == 1) {
          // webbing: horizontal rows every 2.5 cm, nylon weave, scuffed edges
          float rowsF = dFade(dp, 40.0);
          float row = smoothstep(0.32, 0.48, abs(fract(dp.y * 40.0) - 0.5)) * rowsF;
          float wf = dFade(dp, 700.0);
          float weave = (sin(dp.x * 700.0 + dp.z * 700.0) * 0.5 + 0.5) * wf;
          float scuff = smoothstep(0.62, 0.78, dFbm(dp * 28.0));
          detailH = row * 0.8 + weave * 0.15;
          diffuseColor.rgb *= 1.0 - row * 0.35;
          diffuseColor.rgb += vec3(0.05, 0.05, 0.045) * scuff + 0.012 * weave;
        } else {
          // skin: mottling, a warm and a cool tint, pores and fine creases
          float m = dFbm(dp * 14.0);
          diffuseColor.rgb *= mix(vec3(0.92, 0.9, 0.95), vec3(1.08, 0.98, 0.92), m);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 0.86, 0.84), smoothstep(0.55, 0.8, dFbm(dp * 5.0 + 3.0)) * 0.35);
          float pf = dFade(dp, 500.0);
          float pores = (1.0 - smoothstep(0.0, 0.35, dNoise(dp * 500.0))) * pf;
          float crease = 1.0 - abs(dNoise(dp * vec3(40.0, 90.0, 40.0)) * 2.0 - 1.0);
          detailH = -pores * 0.6 + crease * 0.25 * dFade(dp, 90.0);
          diffuseColor.rgb *= 1.0 - pores * 0.08;
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        {
          // bump the normal with the detail height (screen-space derivatives)
          vec3 dpdx = dFdx(-vViewPosition);
          vec3 dpdy = dFdy(-vViewPosition);
          float hx = dFdx(detailH);
          float hy = dFdy(detailH);
          vec3 r1 = cross(dpdy, normal);
          vec3 r2 = cross(normal, dpdx);
          float det = dot(dpdx, r1);
          vec3 grad = sign(det) * (hx * r1 + hy * r2);
          normal = normalize(abs(det) * normal - grad * uDetailBump * 0.004 / max(1e-6, length(dpdx) + length(dpdy)) * length(dpdx));
        }`,
      )
  }
  mat.needsUpdate = true
}
