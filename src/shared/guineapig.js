// Realistic procedural 3D guinea pig.
// - One seamless body sculpted from a signed-distance field (rump + chest + head + roman nose + cheeks)
// - Real fur via "shell" rendering: many layers of the body, each showing only the strand cross-sections
// - Petal ears, eyelids, toes with claws, nose pad with Y-split lip, long whiskers
// Shared by the desktop pet, the customizer preview, and the distraction-eating overlay.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makeFood, buildAccessory } from './props.js';

export { makeFood };

export const DEFAULT_DISTRACTIONS = {
  enabled: false,
  mode: 'visit',        // 'visit' = limit per visit (resets after a break), 'day' = daily allowance
  warn: true,
  appAction: 'close',   // 'close' | 'hide'
  items: [
    { id: 'instagram', type: 'site', match: 'instagram.com', label: 'Instagram', minutes: 5, enabled: true },
    { id: 'tiktok', type: 'site', match: 'tiktok.com', label: 'TikTok', minutes: 5, enabled: true },
    { id: 'youtube', type: 'site', match: 'youtube.com', label: 'YouTube', minutes: 15, enabled: false },
  ],
};

export const DEFAULT_CONFIG = {
  name: 'Peanut',
  coat: {
    pattern: 'dutch',      // solid | dutch | himalayan | tricolor | bicolor | roan | tortoise | agouti
    hair: 'smooth',        // smooth | abyssinian | teddy | long
    base: '#c9772f',
    patch: '#3b2a24',
    white: '#f4f1ec',
    skin: '#e9aaa4',
    eye: '#140d0b',
    seed: 7,
    chonk: 1.0,
  },
  accessory: 'none',
  accessoryColor: '#e2557a',
  size: 1.0,
  settings: {
    wander: true,
    sound: true,
    sleepWhenIdle: true,
    alwaysOnTop: true,
    startAtLogin: false,
  },
  distractions: DEFAULT_DISTRACTIONS,
};

export const PATTERNS = [
  ['solid', 'Solid'], ['dutch', 'Dutch'], ['himalayan', 'Himalayan'], ['tricolor', 'Tricolor'],
  ['bicolor', 'Bicolor'], ['tortoise', 'Tortoiseshell'], ['roan', 'Roan'], ['agouti', 'Agouti'],
];
export const HAIRS = [['smooth', 'Smooth'], ['abyssinian', 'Abyssinian'], ['teddy', 'Teddy'], ['long', 'Long-haired']];
export const ACCESSORIES = [
  ['none', 'None'], ['bow', 'Bow'], ['partyhat', 'Party hat'], ['flowers', 'Flower crown'],
  ['glasses', 'Glasses'], ['tophat', 'Top hat'], ['crown', 'Crown'],
];

export function mergeConfig(base, over) {
  const out = structuredClone(base);
  if (!over) return out;
  for (const k of Object.keys(over)) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = mergeConfig(out[k], over[k]);
    } else if (over[k] !== undefined) out[k] = structuredClone(over[k]);
  }
  return out;
}

// ---------- noise (Perlin) ----------
const PERM = (() => {
  const p = Array.from({ length: 256 }, (_, i) => i);
  let r = 12345;
  for (let i = 255; i > 0; i--) { r = (r * 16807) % 2147483647; const j = r % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  return Uint8Array.from([...p, ...p]);
})();
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h, x, y, z) {
  const hh = h & 15;
  const u = hh < 8 ? x : y;
  const v = hh < 4 ? y : (hh === 12 || hh === 14 ? x : z);
  return ((hh & 1) ? -u : u) + ((hh & 2) ? -v : v);
}
function perlin(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z, B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u), l(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u), v),
    l(l(grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1), u), l(grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1), u), v),
    w,
  );
}
const vnoise = (x, y, z) => perlin(x, y, z) * 0.5 + 0.5;
function fbm(x, y, z) {
  const wx = perlin(x * 0.8 + 5.2, y * 0.8 + 1.3, z * 0.8) * 0.6;
  const wy = perlin(x * 0.8 + 9.1, y * 0.8 + 2.8, z * 0.8 + 4.4) * 0.6;
  x += wx; y += wy;
  return 0.5 + perlin(x, y, z) * 0.62 + perlin(x * 2.1, y * 2.1, z * 2.1) * 0.22 + perlin(x * 4.2, y * 4.2, z * 4.2) * 0.08;
}
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- body shape (signed distance field) ----------
function sdEllipsoid(x, y, z, c, r) {
  const px = (x - c[0]) / r[0], py = (y - c[1]) / r[1], pz = (z - c[2]) / r[2];
  const k0 = Math.hypot(px, py, pz);
  const k1 = Math.hypot(px / r[0], py / r[1], pz / r[2]);
  return k1 < 1e-6 ? -Math.min(...r) : (k0 * (k0 - 1)) / k1;
}
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
function smax(a, b, k) { return -smin(-a, -b, k); }

const HEADC = V(0, 0.74, 0.74);
const NECK = V(0, 0.66, 0.36); // head pivot
const GRAB = V(0, 1.12, 0.32); // scruff of the neck, where you pick it up
const HOLD_LIFT = 0.3;          // how high it's lifted when picked up

function makeSDF(chonk) {
  const rump = { c: [0, 0.64, -0.36], r: [0.8 * chonk, 0.65, 0.9] };
  const chest = { c: [0, 0.56, 0.28], r: [0.66 * chonk, 0.53, 0.64] };
  const head = { c: [HEADC.x, HEADC.y, HEADC.z], r: [0.46, 0.45, 0.5] };
  const snout = { c: [0, 0.68, 1.1], r: [0.28, 0.28, 0.3] };
  const cheekL = { c: [-0.23, 0.55, 0.92], r: [0.21, 0.2, 0.22] };
  const cheekR = { c: [0.23, 0.55, 0.92], r: [0.21, 0.2, 0.22] };
  const E = (x, y, z, e) => sdEllipsoid(x, y, z, e.c, e.r);
  return (x, y, z) => {
    let d = smin(E(x, y, z, rump), E(x, y, z, chest), 0.4);
    d = smin(d, E(x, y, z, head), 0.32);
    d = smin(d, E(x, y, z, snout), 0.2);
    d = smin(d, Math.min(E(x, y, z, cheekL), E(x, y, z, cheekR)), 0.16);
    d = smax(d, 0.035 - y, 0.14); // flat belly on the floor
    return d;
  };
}

const CENTER = V(0, 0.6, 0);
function surfaceAlong(sdf, origin, dir) {
  const d = dir.clone().normalize();
  let t = 3;
  for (let i = 0; i < 80; i++) {
    const s = sdf(origin.x + d.x * t, origin.y + d.y * t, origin.z + d.z * t);
    if (Math.abs(s) < 1e-4) break;
    t -= s * 0.85;
  }
  return origin.clone().addScaledVector(d, t);
}
function sdfNormal(sdf, p) {
  const e = 0.002;
  return V(
    sdf(p.x + e, p.y, p.z) - sdf(p.x - e, p.y, p.z),
    sdf(p.x, p.y + e, p.z) - sdf(p.x, p.y - e, p.z),
    sdf(p.x, p.y, p.z + e) - sdf(p.x, p.y, p.z - e),
  ).normalize();
}

function bodyGeometry(sdf, seg) {
  let g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75));
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const p = V(0, 0, 0);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const s = surfaceAlong(sdf, CENTER, p);
    pos.setXYZ(i, s.x, s.y, s.z);
  }
  return g;
}

function headWeight(p) { return smooth(0.08, 0.46, p.z) * smooth(0.2, 0.48, p.y); }

// ---------- colour patterns ----------
function makePattern(coat, L) {
  const C = (h) => new THREE.Color(h);
  const base = C(coat.base), patch = C(coat.patch), white = C(coat.white), skin = C(coat.skin);
  const s = coat.seed || 1;
  const tmp = new THREE.Color();
  const mix = (a, b, t) => tmp.copy(a).lerp(b, t).clone();
  const band = (v, edge, w = 0.045) => smooth(edge - w, edge + w, v);

  return (p, tag) => {
    if (tag === 'foot') return coat.pattern === 'himalayan' ? mix(skin, patch, 0.75) : skin.clone();
    let c;
    const n = fbm(p.x * 1.5 + s * 13.1, p.y * 1.5 + s * 7.3, p.z * 1.5 + s * 3.7);
    const hr = p.clone().sub(HEADC);
    const dNose = p.distanceTo(L.noseTip);
    switch (coat.pattern) {
      case 'dutch': {
        if (tag === 'body' || tag === 'leg') {
          c = mix(base, white, smooth(-0.2, -0.1, p.z + (n - 0.5) * 0.25));
        } else if (tag === 'ear') c = base.clone();
        else {
          // dark mask around the eyes and cheeks in the second colour
          const off = V(0, -0.06, -0.1); // patch reaches back and down over the cheek
          const de = Math.min(p.distanceTo(L.eyes[0].clone().add(off)), p.distanceTo(L.eyes[1].clone().add(off)));
          const maskN = fbm(p.x * 5 + s, p.y * 5, p.z * 5) - 0.5;
          const mask = smooth(0.34, 0.24, de + maskN * 0.28) * smooth(-0.1, 0.1, hr.y + 0.3);
          const w = 0.06 + Math.max(0, -hr.y) * 0.45 + Math.max(0, hr.z - 0.28) * 0.6;
          const blaze = smooth(w + 0.05, w - 0.02, Math.abs(p.x)) * smooth(-0.15, 0.0, hr.z);
          const chin = smooth(0.18, 0.3, hr.z) * smooth(-0.1, -0.22, hr.y);
          c = mix(mix(base, patch, mask), white, Math.max(blaze, chin, smooth(0.32, 0.22, dNose)));
        }
        break;
      }
      case 'himalayan':
        c = tag === 'ear' ? patch.clone() : mix(patch, white, smooth(0.12, 0.3, dNose));
        break;
      case 'tricolor':
        c = mix(mix(base, white, band(n, 0.42)), patch, band(n, 0.6));
        if (tag === 'head' || tag === 'muzzle') {
          const blaze = smooth(0.12, 0.05, Math.abs(p.x)) * smooth(-0.1, 0.05, hr.z);
          c.lerp(white, Math.max(blaze, smooth(0.3, 0.2, dNose)));
        }
        break;
      case 'bicolor':
        c = mix(base, patch, band(n, 0.5));
        break;
      case 'tortoise': {
        const m = fbm(p.x * 2.2 + s * 3.1, p.y * 2.2, p.z * 2.2 - s * 1.7);
        c = mix(base, patch, band(m, 0.5));
        break;
      }
      case 'roan': {
        c = (tag === 'head' || tag === 'muzzle' || tag === 'ear') ? patch.clone() : base.clone();
        if (tag === 'body') c.lerp(white, smooth(0.48, 0.68, vnoise(p.x * 11 + s, p.y * 11, p.z * 11)) * 0.75);
        break;
      }
      case 'agouti': {
        c = mix(base, patch, vnoise(p.x * 26 + s, p.y * 26, p.z * 26) * 0.45);
        if (p.y < 0.35) c.lerp(white, 0.3);
        break;
      }
      default:
        c = base.clone();
    }
    if (tag === 'ear') c.multiplyScalar(0.82);
    c.multiplyScalar(0.94 + 0.12 * vnoise(p.x * 9, p.y * 9, p.z * 9));
    if (p.y < 0.2 && tag === 'body') c.lerp(white, 0.1);
    // bare nose pad
    const pad = smooth(0.075, 0.045, dNose);
    if (pad > 0) c.lerp(coat.pattern === 'himalayan' ? patch.clone().multiplyScalar(0.8) : skin, pad);
    return c;
  };
}

// ---------- fur (shell rendering) ----------
const FUR = {
  smooth: { shells: 16, len: 0.032, comb: 3.0, gravity: 0.25, density: 130 },
  abyssinian: { shells: 20, len: 0.09, comb: 1.25, gravity: 0.15, density: 85 },
  teddy: { shells: 20, len: 0.07, comb: 0.25, gravity: 0.0, density: 110 },
  long: { shells: 26, len: 0.16, comb: 1.0, gravity: 1.1, density: 80 },
};

function furMaterial(params, L) {
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, envMapIntensity: 0.85, sheen: 0.25, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.75, 0.68, 0.6) });
  const u = {
    uShells: { value: params.shells },
    uFurLen: { value: params.len },
    uCombAmt: { value: params.comb },
    uGravity: { value: params.gravity },
    uDensity: { value: params.density },
    uHeadRot: { value: new THREE.Matrix3() },
    uPivot: { value: NECK.clone() },
    uChew: { value: 0 },
    uMouth: { value: L.mouth.clone() },
  };
  mat.userData.u = u;
  mat.customProgramCacheKey = () => 'gp-fur-v3';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aFur; attribute float aHeadW; attribute vec3 aComb;
        uniform float uShells, uFurLen, uCombAmt, uGravity, uChew;
        uniform mat3 uHeadRot; uniform vec3 uPivot, uMouth;
        varying float vH; varying vec3 vBase; varying float vFur; varying vec3 vComb;`)
      .replace('#include <beginnormal_vertex>', `
        vec3 objectNormal = normalize(mix(normal, uHeadRot * normal, aHeadW));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3( tangent.xyz );
        #endif`)
      .replace('#include <begin_vertex>', `
        #ifdef USE_INSTANCING
          float shellH = float(gl_InstanceID) / uShells;
        #else
          float shellH = 0.0;
        #endif
        vH = shellH; vBase = position; vFur = aFur; vComb = aComb;
        vec3 p0 = position;
        vec3 dm = p0 - uMouth;
        float mw = exp(-dot(dm, dm) / 0.012) * smoothstep(uMouth.y + 0.03, uMouth.y - 0.05, p0.y);
        p0.y -= uChew * mw * 0.04;
        p0 = mix(p0, uPivot + uHeadRot * (p0 - uPivot), aHeadW);
        vec3 comb = mix(aComb, uHeadRot * aComb, aHeadW);
        float Lf = uFurLen * aFur;
        vec3 transformed = p0 + objectNormal * Lf * shellH
          + comb * Lf * uCombAmt * shellH * shellH
          - vec3(0.0, 1.0, 0.0) * Lf * uGravity * shellH * shellH;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vH; varying vec3 vBase; varying float vFur; varying vec3 vComb;
        uniform float uDensity;
        float furHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float furNoise(vec3 p) {
          vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(furHash(i), furHash(i + vec3(1,0,0)), f.x), mix(furHash(i + vec3(0,1,0)), furHash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(furHash(i + vec3(0,0,1)), furHash(i + vec3(1,0,1)), f.x), mix(furHash(i + vec3(0,1,1)), furHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (vH > 0.001) {
          if (vFur < 0.08) discard;
          vec3 q = vBase * uDensity;
          vec3 cell = floor(q);
          float r = furHash(cell);
          vec3 f = fract(q) - 0.5 - (vec3(furHash(cell + 3.1), furHash(cell + 7.7), furHash(cell + 1.3)) - 0.5) * 0.4;
          float rel = vH / (0.5 + 0.5 * r);
          if (rel > 1.0) discard;
          if (length(f) > 0.78 * (1.0 - rel)) discard;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // brushed streaks running along the fur, plus every strand a slightly different shade
          vec3 cd = length(vComb) > 0.05 ? normalize(vComb) : vec3(0.0, 0.0, -1.0);
          vec3 a1 = normalize(cross(cd, vec3(0.31, 0.72, 0.62)));
          vec3 a2 = cross(cd, a1);
          vec3 q = vec3(dot(vBase, cd) * 7.0, dot(vBase, a1) * 75.0, dot(vBase, a2) * 75.0);
          float streak = furNoise(q) * 0.55 + furNoise(q * vec3(2.2, 2.6, 2.6) + 7.1) * 0.3 + furNoise(q * vec3(4.0, 6.0, 6.0) + 3.7) * 0.15;
          float clump = furNoise(vBase * 22.0 + 5.0);
          float strand = furHash(floor(vBase * uDensity) + 11.3);
          float shade = (0.7 + 0.48 * streak) * (0.88 + 0.24 * strand) * (0.9 + 0.18 * clump);
          diffuseColor.rgb *= shade * ((vH > 0.001) ? mix(0.58, 1.12, vH) : 0.55);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06, 1.03, 1.0) + 0.03, smoothstep(0.6, 1.0, vH) * 0.5);
        }`);
  };
  return mat;
}

// Long hair: the lower half flares out and drops to the floor like a silky coat.
function drapeLongHair(p, chonk) {
  const e = { c: V(0, 0.62, -0.2), s: V(0.8 * chonk, 0.62, 1.12) };
  const ny = (p.y - e.c.y) / e.s.y;
  if (ny > 0.35 || headWeight(p) > 0.6) return;
  const ang = Math.atan2(p.x / e.s.x, (p.z - e.c.z) / e.s.z);
  const k = smooth(0.35, -0.6, ny) * (1 - headWeight(p));
  const flare = 1.14 + 0.05 * perlin(ang * 3, 1.7, 0.3);
  const ex = Math.sin(ang) * e.s.x * flare, ez = e.c.z + Math.cos(ang) * e.s.z * (flare - 0.06);
  const hem = 0.03 + 0.06 * (0.5 + 0.5 * perlin(ang * 4.5, 3.3, 0.7));
  p.x += (ex - p.x) * k;
  p.z += (ez - p.z) * k;
  p.y += (hem - p.y) * k * k;
}

function tangentOf(dir, n) { return dir.clone().addScaledVector(n, -dir.dot(n)).normalize(); }

// ---------- misc helpers ----------
function radialTexture(inner, outer) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function earGeometry() {
  const ring = new THREE.RingGeometry(0.001, 1, 48, 10);
  const pos = ring.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i);
    const wide = 0.8 + 0.3 * smooth(-1, 0.4, y);    // petal: narrower base, wide rounded top
    x *= 0.17 * wide;
    y = y * 0.15 + 0.15;                              // base at y=0, tip at y=0.3
    let z = x * x * 4;                                // cupped
    z -= Math.pow(Math.max(0, y - 0.05), 2) * 6.5;    // flops outward & down
    pos.setXYZ(i, x, y, z);
  }
  ring.computeVertexNormals();
  return ring;
}

function twoToneMaterial(inner, outer) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uIn = { value: new THREE.Color(inner) };
    sh.uniforms.uOut = { value: new THREE.Color(outer) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vEar;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEar = position.xy;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uIn; uniform vec3 uOut; varying vec2 vEar;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float er = length((vEar - vec2(0.0, 0.15)) / vec2(0.19, 0.16));
        vec3 inC = mix(uIn * 1.12, uOut * 0.75, smoothstep(0.55, 1.0, er));   // fur-coloured rim
        inC *= 0.92 + 0.08 * sin(vEar.x * 90.0 + vEar.y * 30.0);              // faint veins
        diffuseColor.rgb = gl_FrontFacing ? inC : uOut;`);
  };
  m.customProgramCacheKey = () => 'gp-ear-v2';
  return m;
}

// ---------- feet with toes & claws ----------
function makeFoot(skinMat, clawMat, toes, len) {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), skinMat);
  pad.scale.set(0.075, 0.035, len);
  pad.position.set(0, 0.03, 0);
  g.add(pad);
  for (let i = 0; i < toes; i++) {
    const a = (i - (toes - 1) / 2) * 0.32;
    const toe = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.045, 4, 10), skinMat);
    toe.rotation.set(Math.PI / 2 - 0.15, 0, -a * 0.6);
    toe.position.set(Math.sin(a) * 0.075, 0.02, len * 0.85 + 0.03);
    g.add(toe);
    const claw = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.045, 6), clawMat);
    claw.rotation.set(Math.PI / 2 + 0.45, 0, -a * 0.6);
    claw.position.set(Math.sin(a) * 0.1, 0.012, len * 0.85 + 0.085);
    g.add(claw);
  }
  return g;
}

// ---------- the guinea pig ----------
const geoCache = new Map();

export function buildGuineaPig(config, { quality = 'high' } = {}) {
  const cfg = mergeConfig(DEFAULT_CONFIG, config);
  const coat = cfg.coat;
  const chonk = coat.chonk || 1;
  const fp = { ...FUR[coat.hair] || FUR.smooth };
  if (quality === 'low') fp.shells = Math.round(fp.shells * 0.7);

  const sdf = makeSDF(chonk);
  const L = { sdf };
  L.noseTip = surfaceAlong(sdf, V(0, 0.68, 0.6), V(0, 0.08, 1));
  L.mouth = surfaceAlong(sdf, V(0, 0.62, 0.7), V(0, -0.16, 1));
  L.headTop = surfaceAlong(sdf, HEADC, V(0, 1, -0.05));
  L.eyes = [-1, 1].map((sx) => surfaceAlong(sdf, HEADC, V(sx * 0.8, 0.36, 0.52)));
  L.ears = [-1, 1].map((sx) => surfaceAlong(sdf, HEADC, V(sx * 0.66, 0.7, -0.45)));

  const root = new THREE.Group();
  const pig = new THREE.Group();
  root.add(pig);

  // ---- body mesh + per-vertex fur attributes ----
  const key = `${chonk.toFixed(3)}|${coat.hair}`;
  let geo = geoCache.get(key)?.clone();
  if (!geo) {
    geo = bodyGeometry(sdf, 190);
    if (coat.hair === 'long') {
      const pos = geo.attributes.position, p = V(0, 0, 0);
      for (let i = 0; i < pos.count; i++) { p.fromBufferAttribute(pos, i); drapeLongHair(p, chonk); pos.setXYZ(i, p.x, p.y, p.z); }
      geo.computeVertexNormals();
    } else {
      const pos = geo.attributes.position, nor = new Float32Array(pos.count * 3), p = V(0, 0, 0);
      for (let i = 0; i < pos.count; i++) { p.fromBufferAttribute(pos, i); const n = sdfNormal(sdf, p); nor.set([n.x, n.y, n.z], i * 3); }
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    }
    if (geoCache.size > 6) geoCache.clear();
    geoCache.set(key, geo.clone());
  }
  const pattern = makePattern(coat, L);
  {
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const n = pos.count;
    const aFur = new Float32Array(n), aHeadW = new Float32Array(n), aComb = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const p = V(0, 0, 0), nn = V(0, 0, 0);
    // rosette centres for Abyssinians
    let rs = (coat.seed || 1) * 7919;
    const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
    const rosettes = [];
    for (let i = 0; i < 14; i++) {
      rosettes.push(surfaceAlong(sdf, CENTER, V(rnd() * 2 - 1, rnd() * 0.9 + 0.1, rnd() * 1.7 - 1.1)));
    }
    const back = V(0, -0.25, -1).normalize();
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i);
      nn.fromBufferAttribute(nor, i);
      const hw = headWeight(p);
      aHeadW[i] = hw;
      const dNose = p.distanceTo(L.noseTip);
      let f = smooth(0.05, 0.22, dNose);
      if (p.z > 0.9) f *= coat.hair === 'long' ? 0.4 : 0.6;
      for (const e of L.eyes) f *= smooth(0.075, 0.15, p.distanceTo(e));
      if (p.y < 0.07) f *= 0.4;
      if (coat.hair === 'long' && hw > 0.5) f *= 0.35;
      aFur[i] = f;
      let comb = tangentOf(back, nn);
      if (coat.hair === 'abyssinian' && hw < 0.6) {
        let best = null, bd = 1e9;
        for (const r of rosettes) { const d = r.distanceToSquared(p); if (d < bd) { bd = d; best = r; } }
        comb = tangentOf(p.clone().sub(best), nn);
      } else if (coat.hair === 'teddy') {
        comb = tangentOf(V(perlin(p.x * 9, p.y * 9, p.z * 9), perlin(p.y * 9, p.z * 9, 3), perlin(p.z * 9, 1, p.x * 9)), nn);
      }
      if (!Number.isFinite(comb.x)) comb.set(0, 0, 0);
      aComb.set([comb.x, comb.y, comb.z], i * 3);
      const tag = dNose < 0.32 && hw > 0.5 ? 'muzzle' : hw > 0.5 ? 'head' : 'body';
      const c = pattern(p, tag);
      const dEye = Math.min(p.distanceTo(L.eyes[0]), p.distanceTo(L.eyes[1]));
      c.multiplyScalar(1 - 0.28 * smooth(0.16, 0.085, dEye));            // eye ring
      c.multiplyScalar(1 - 0.12 * smooth(0.25, 0.0, p.y));                 // darker towards the belly/floor
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('aFur', new THREE.BufferAttribute(aFur, 1));
    geo.setAttribute('aHeadW', new THREE.BufferAttribute(aHeadW, 1));
    geo.setAttribute('aComb', new THREE.BufferAttribute(aComb, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const furMat = furMaterial(fp, L);
  const fur = new THREE.InstancedMesh(geo, furMat, fp.shells);
  const ident = new THREE.Matrix4();
  for (let i = 0; i < fp.shells; i++) fur.setMatrixAt(i, ident);
  fur.frustumCulled = false;
  fur.raycast = () => {};
  pig.add(fur);

  // invisible low-poly proxy for mouse hit-testing
  const hitMesh = new THREE.Mesh(bodyGeometry(sdf, 40), new THREE.MeshBasicMaterial({ visible: false }));
  pig.add(hitMesh);

  // ---- head group (eyes, ears, whiskers, nose details move with the head) ----
  const headGroup = new THREE.Group();
  headGroup.position.copy(NECK);
  headGroup.rotation.order = 'YXZ';
  pig.add(headGroup);
  const rel = (v) => v.clone().sub(NECK);
  const skinColor = coat.pattern === 'himalayan' ? new THREE.Color(coat.patch).multiplyScalar(0.8) : new THREE.Color(coat.skin);

  // nose: nostrils + Y-shaped split down to the lip
  const darkMat = new THREE.MeshStandardMaterial({ color: '#2a1c1a', roughness: 0.6 });
  const nN = sdfNormal(sdf, L.noseTip);
  for (const sx of [-1, 1]) {
    const nostril = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), darkMat);
    nostril.scale.set(0.022, 0.009, 0.01);
    nostril.position.copy(rel(L.noseTip.clone().add(V(sx * 0.03, -0.006, -0.008))));
    nostril.rotation.z = sx * 0.6;
    headGroup.add(nostril);
  }
  const lipPts = (pts) => new THREE.CatmullRomCurve3(pts.map((q) => rel(surfaceAlong(sdf, V(0, 0.62, 0.6), q.clone().sub(V(0, 0.62, 0.6))).addScaledVector(nN, 0.004))));
  const lipMat = new THREE.MeshStandardMaterial({ color: '#4a302c', roughness: 0.7 });
  const splitTop = L.noseTip.clone().add(V(0, -0.02, 0));
  const lipMid = L.mouth.clone();
  headGroup.add(new THREE.Mesh(new THREE.TubeGeometry(lipPts([splitTop, splitTop.clone().lerp(lipMid, 0.5), lipMid]), 8, 0.0045, 5), lipMat));
  for (const sx of [-1, 1]) {
    headGroup.add(new THREE.Mesh(new THREE.TubeGeometry(lipPts([lipMid, lipMid.clone().add(V(sx * 0.035, -0.012, -0.015)), lipMid.clone().add(V(sx * 0.07, -0.01, -0.05))]), 8, 0.004, 5), lipMat));
  }

  // eyes with eyelids and a dark rim
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: coat.eye, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 });
  const rimMat = new THREE.MeshStandardMaterial({ color: '#1c1311', roughness: 0.7 });
  const lids = [];
  const eyes = [];
  L.eyes.forEach((at, i) => {
    const n = sdfNormal(sdf, at);
    const eg = new THREE.Group();
    eg.position.copy(rel(at.clone().addScaledVector(n, -0.02)));
    eg.lookAt(eg.position.clone().add(n.clone().add(V(0, 0, 0.25)).normalize()));
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.082, 28, 20), eyeMat);
    eg.add(eye);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.074, 0.011, 8, 36), rimMat);
    rim.position.z = 0.022;
    eg.add(rim);
    const lidCol = pattern(at, 'head');
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.088, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: lidCol, roughness: 0.9 }));
    lid.rotation.x = -1.15;
    eg.add(lid);
    lids.push(lid);
    eyes.push(eg);
    headGroup.add(eg);
  });

  // petal ears
  const ears = [];
  L.ears.forEach((at, i) => {
    const sx = i === 0 ? -1 : 1;
    const outerC = pattern(at, 'ear');
    const innerC = new THREE.Color(coat.skin).lerp(outerC, 0.6).multiplyScalar(0.72);
    const ear = new THREE.Mesh(earGeometry(), twoToneMaterial(innerC, outerC));
    const eg = new THREE.Group();
    eg.position.copy(rel(at.clone().addScaledVector(sdfNormal(sdf, at), -0.03)));
    // orient: ear extends outward & slightly back, its inner face looks forward/outward
    const U = V(sx * 0.72, 0.6, -0.35).normalize();
    let N = V(-sx * 0.55, 0.55, 0.6).normalize();
    const X = new THREE.Vector3().crossVectors(U, N).normalize();
    N = new THREE.Vector3().crossVectors(X, U).normalize();
    eg.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, U, N));
    eg.rotation.order = 'YXZ';
    eg.rotation.setFromQuaternion(eg.quaternion, 'YXZ');
    eg.userData.base = eg.rotation.clone();
    eg.add(ear);
    headGroup.add(eg);
    ears.push(eg);
  });

  // whiskers
  const whiskerMat = new THREE.LineBasicMaterial({ color: '#f4f1ea', transparent: true, opacity: 0.6 });
  let ws = (coat.seed || 3) * 131;
  const wr = () => { ws = (ws * 16807) % 2147483647; return ws / 2147483647; };
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const a = surfaceAlong(sdf, V(0, 0.64, 0.8), V(sx * 0.9, -0.2 + i * 0.05, 1.0));
      const len = 0.45 + wr() * 0.45;
      const dir = V(sx * (0.85 + wr() * 0.3), -0.35 + i * 0.1 + wr() * 0.1, 0.35 - wr() * 0.5).normalize();
      const b = a.clone().addScaledVector(dir, len);
      const mid = a.clone().lerp(b, 0.5).add(V(0, 0.04, 0.03));
      const pts = new THREE.QuadraticBezierCurve3(rel(a), rel(mid), rel(b)).getPoints(10);
      headGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), whiskerMat));
    }
  }

  // a piece of hay for nibbling (shown while you type)
  const hay = new THREE.Group();
  {
    const mouthCorner = L.mouth.clone().add(V(0.055, 0.01, -0.03));
    hay.position.copy(rel(mouthCorner));
    hay.lookAt(hay.position.clone().add(V(1, -0.05, 0.75)));   // sticks out sideways from the corner of the mouth
    const hayCols = ['#e8cf6f', '#d9bb55', '#cfc06a'];
    const strands = [[0, 0, 1.0, 0], [0, 0.014, 0.8, 0.25], [0, -0.012, 0.65, -0.3]];
    strands.forEach(([x, y, len, bend], i) => {
      const geo = new THREE.BoxGeometry(0.024, 0.007, 1, 1, 1, 8);
      geo.translate(0, 0, 0.5);
      const pos = geo.attributes.position;
      const cols = new Float32Array(pos.count * 3);
      const c1 = new THREE.Color(hayCols[i % 3]), c2 = new THREE.Color('#9c8a3e'), c = new THREE.Color();
      for (let k = 0; k < pos.count; k++) {
        const z = pos.getZ(k);
        pos.setY(k, pos.getY(k) + bend * z * 0.12);             // strands fan out a little
        pos.setY(k, pos.getY(k) - z * z * 0.03);               // droops a little
        c.copy(c1).lerp(c2, Math.pow(z, 3) * 0.6);             // darker toward the tip
        cols.set([c.r, c.g, c.b], k * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }));
      m.position.set(x, y, 0);
      m.userData.len = len * 0.58;
      hay.add(m);
    });
    hay.visible = false;
    headGroup.add(hay);
  }

  // blush (used when happy)
  const blushTex = radialTexture('rgba(255,120,140,0.85)', 'rgba(255,120,140,0)');
  const cheeks = [-1, 1].map((sx) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: blushTex, transparent: true, opacity: 0, depthWrite: false }));
    sp.scale.set(0.2, 0.13, 1);
    const at = surfaceAlong(sdf, V(0, 0.6, 0.85), V(sx, -0.1, 0.4));
    sp.position.copy(rel(at.addScaledVector(sdfNormal(sdf, at), 0.06)));
    headGroup.add(sp);
    return sp;
  });

  // legs & feet
  const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.6 });
  const clawMat = new THREE.MeshPhysicalMaterial({ color: '#f1e8df', roughness: 0.3, clearcoat: 0.6 });
  const feet = [];
  const footSpots = [[-0.27, 0.6, 3, 0.07, true], [0.27, 0.6, 3, 0.07, true], [-0.38, -0.55, 3, 0.11, false], [0.38, -0.55, 3, 0.11, false]];
  for (const [x, z, toes, len, front] of footSpots) {
    const fg = new THREE.Group();
    fg.position.set(x * chonk, 0, z);
    if (front) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.05, 6, 12), new THREE.MeshStandardMaterial({ color: pattern(V(x, 0.2, z), 'leg').multiplyScalar(0.85), roughness: 0.95 }));
      leg.position.set(0, 0.075, -0.05);
      fg.add(leg);
    }
    const foot = makeFoot(skinMat, clawMat, front ? 4 : 3, len);
    foot.rotation.y = x < 0 ? 0.15 : -0.15;
    fg.add(foot);
    fg.userData.baseZ = fg.position.z;
    fg.userData.baseX = fg.position.x;
    pig.add(fg);
    feet.push(fg);
  }

  // accessory
  const acc = buildAccessory(cfg.accessory, cfg.accessoryColor, { L, NECK, HEADC, surfaceAlong, sdfNormal });
  if (acc) headGroup.add(acc);

  // soft contact shadow
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.3, 3.1),
    new THREE.MeshBasicMaterial({ map: radialTexture('rgba(35,22,12,0.5)', 'rgba(35,22,12,0)'), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, 0.004, -0.05);

  const outer = new THREE.Group();
  outer.add(root, shadow);
  outer.scale.setScalar(cfg.size || 1);

  // ---------- animation ----------
  const cur = { yaw: 0, pitch: 0, eyes: 0, blush: 0, crouch: 0, turn: 0, hold: 0 };
  let blinkT = 2 + Math.random() * 3, blink = 0;
  const earTwitch = [0, 0];
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const m4 = new THREE.Matrix4();

  function animate(t, dt, s = {}) {
    const k = (rate) => 1 - Math.exp(-dt * rate);
    cur.yaw += ((s.lookYaw || 0) - cur.yaw) * k(6);
    cur.pitch += ((s.lookPitch || 0) - cur.pitch) * k(6);
    cur.blush += ((s.blush || 0) - cur.blush) * k(4);
    cur.crouch += ((s.sleep ? 1 : 0) - cur.crouch) * k(2.5);
    cur.turn += ((s.turn || 0) - cur.turn) * k(5);

    blinkT -= dt;
    if (blinkT < 0) { blink = 1; blinkT = 2.5 + Math.random() * 4; }
    blink = Math.max(0, blink - dt * 7);
    const want = Math.max(s.eyesClosed || 0, blink > 0 ? 1 : 0);
    cur.eyes += (want - cur.eyes) * k(want > cur.eyes ? 30 : 10);
    for (const lid of lids) lid.rotation.x = -1.15 + cur.eyes * 2.7;

    const br = Math.sin(t * (s.sleep ? 1.6 : 3.2)) * (s.sleep ? 0.022 : 0.012);
    const walkBob = s.walk ? Math.abs(Math.sin(t * 16)) * 0.04 : 0;
    // picked up: swing upright and dangle from the scruff, belly toward you
    cur.hold += ((s.held ? 1 : 0) - cur.hold) * k(s.held ? 8 : 5);
    const held = cur.hold;
    const shake = s.shake || 0;
    pig.scale.set(1 + br * 0.6 + cur.crouch * 0.04 - held * 0.05, 1 + br - cur.crouch * 0.08, 1 + cur.crouch * 0.03 + held * 0.09);
    pig.position.y = walkBob;
    root.rotation.order = 'YXZ';
    root.rotation.set(
      (s.jump ? -s.jump * 0.25 : (s.lunge || 0)) * (1 - held) - 1.05 * held + (s.swing || 0) * held,
      (cur.turn + (s.spin || 0)) * (1 - held) + (s.holdYaw || 0) * held,
      (s.sway || 0) * held + Math.sin(t * 38) * 0.2 * shake,
    );
    // rotate around the scruff (GRAB) so the guinea pig hangs from where you grabbed it
    const pr = GRAB.clone().applyEuler(root.rotation);
    root.position.set(GRAB.x - pr.x, GRAB.y - pr.y + (s.jump || 0) + held * HOLD_LIFT, GRAB.z - pr.z);

    const pitch = -cur.pitch + cur.crouch * 0.18 + (s.eating ? 0.3 : 0) + held * 0.95;
    const roll = s.groom ? Math.sin(t * 9) * 0.12 : 0;
    euler.set(pitch, cur.yaw, roll, 'YXZ');
    headGroup.rotation.copy(euler);
    m4.makeRotationFromEuler(euler);
    furMat.userData.u.uHeadRot.value.setFromMatrix4(m4);
    // jaw: chewing goes up and down; mouthOpen holds it wide open (for swallowing)
    furMat.userData.u.uChew.value = Math.max(s.chew ? (Math.sin(t * 22) * 0.5 + 0.5) : 0, s.mouthOpen || 0);

    const sniff = s.sniff ? Math.sin(t * 30) * 0.004 : 0;
    headGroup.position.set(NECK.x, NECK.y, NECK.z + sniff);

    if (Math.random() < dt * 0.25) earTwitch[Math.random() < 0.5 ? 0 : 1] = 1;
    ears.forEach((e, i) => {
      earTwitch[i] = Math.max(0, earTwitch[i] - dt * 4);
      const b = e.userData.base;
      const sx = i === 0 ? -1 : 1;
      const tw = Math.sin(earTwitch[i] * Math.PI) * 0.3;
      const flap = Math.sin(t * 38 + i) * 0.35 * shake + Math.sin(t * 9 + i * 2) * 0.12 * held;
      e.rotation.set(b.x - tw * 0.4, b.y, b.z + sx * (-tw - cur.crouch * 0.2 + held * 0.35 + flap));
    });

    for (const c of cheeks) c.material.opacity = cur.blush * 0.8;

    // hay: s.hay is how much of the strand is left (0 = none)
    const hayLeft = s.hay || 0;
    hay.visible = hayLeft > 0.02;
    if (hay.visible) {
      hay.children.forEach((m, i) => {
        m.scale.z = Math.max(0.001, m.userData.len * hayLeft);
        m.rotation.x = s.chew ? Math.sin(t * 22 + i) * 0.06 : 0;       // wiggles as it chews
        m.rotation.y = s.chew ? Math.sin(t * 11 + i * 2) * 0.05 : 0;
      });
    }

    feet.forEach((f, i) => {
      const phase = (i === 0 || i === 3) ? 0 : Math.PI;
      const front = i < 2;
      f.position.x = f.userData.baseX * (1 + held * (front ? 0.45 : 0.2));
      f.position.z = f.userData.baseZ + (s.walk ? Math.sin(t * 16 + phase) * 0.07 : 0) - held * (front ? 0.22 : 0);
      f.position.y = (s.walk ? Math.max(0, Math.sin(t * 16 + phase)) * 0.035 : 0) + held * ((front ? 0.12 : 0.04) + Math.sin(t * 13 + i * 1.9) * 0.035);
      // paws flail around while dangling
      f.rotation.x = held * Math.sin(t * 12 + i * 1.7) * 0.75;
      f.rotation.z = held * Math.sin(t * 9.5 + i * 2.3) * 0.45 * (f.position.x < 0 ? -1 : 1);
    });

    const lift = (s.jump || 0) + held * 0.9;
    shadow.material.opacity = 1 - Math.min(0.75, lift * 1.2);
    const sc = 1 - Math.min(0.5, lift * 0.3);
    shadow.scale.set(chonk * sc, 1, sc);
  }

  // where the scruff will be once fully picked up (world space)
  function grabWorld(target = new THREE.Vector3()) {
    outer.updateMatrixWorld(true);
    return outer.localToWorld(target.copy(GRAB).add(V(0, HOLD_LIFT, 0)));
  }

  // mouth position in world space (for the distraction-eating overlay)
  function mouthWorld(target = new THREE.Vector3()) {
    return target.copy(L.mouth).add(V(0, 0, 0.03)).applyMatrix4(pig.matrixWorld);
  }

  function dispose() {
    outer.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose(); m.dispose(); });
    });
  }

  return { object: outer, root, headGroup, animate, dispose, config: cfg, hitMeshes: [hitMesh], mouthWorld, grabWorld };
}

// Renderer + lighting shared by every window.
export function makeStage(canvas, { fov = 32, pixelRatio } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: false });
  renderer.setPixelRatio(pixelRatio ?? Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 50);
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x6a5040, 0.7));
  const key = new THREE.DirectionalLight(0xfff3e4, 2.3);
  key.position.set(2.5, 4, 3.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffe6cc, 1.6);
  rim.position.set(-3, 2.5, -3);
  scene.add(rim);
  return { renderer, scene, camera, THREE };
}
