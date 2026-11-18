// Food and accessory models (stylized, chunky & glossy, like toy vegetables).
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...extra });
const glossy = (color, extra = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.3, ...extra });

// seeded random so models look the same every time
function rng(seed = 1) {
  let s = seed * 9301 + 49297;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

// lathe from a [radius, height] profile
function lathe(profile, segments = 24) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

function tintByHeight(geo, bottom, top, yMin, yMax) {
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const a = new THREE.Color(bottom), b = new THREE.Color(top), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - yMin) / (yMax - yMin)));
    c.copy(a).lerp(b, t);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

// ---------------------------------------------------------------- FOOD
function carrot() {
  const g = new THREE.Group();
  // tapered body with growth rings
  const prof = [];
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let r = 0.105 * Math.pow(t, 0.55);
    if (t > 0.08 && t < 0.92) r *= 1 + 0.035 * Math.sin(t * 46);
    prof.push([Math.max(0.002, r), t * 0.62]);
  }
  prof.push([0.085, 0.635], [0.05, 0.648], [0.0, 0.652]);
  const geo = lathe(prof, 12);
  // gentle bend
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setX(i, pos.getX(i) + 0.05 * Math.pow(1 - y / 0.65, 2));
  }
  geo.computeVertexNormals();
  tintByHeight(geo, '#d94a00', '#ff7a0a', 0, 0.65);
  const body = new THREE.Mesh(geo, glossy(0xffffff, { vertexColors: true, roughness: 0.38, clearcoat: 0.3 }));
  g.add(body);
  // top stub
  const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.04, 10), std('#5c9a2e'));
  stub.position.y = 0.665;
  g.add(stub);
  // frilly parsley-like greens
  const greens = ['#3f8a2c', '#56a33a', '#6dbb46'];
  const r = rng(3);
  for (let s = 0; s < 4; s++) {
    const ang = (s - 1.5) * 0.38;
    const len = 0.28 + r() * 0.12;
    const stem = new THREE.Group();
    stem.position.y = 0.67;
    stem.rotation.z = ang;
    stem.rotation.x = (r() - 0.5) * 0.5;
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, len, 6), std('#4d8f2f'));
    stalk.position.y = len / 2;
    stem.add(stalk);
    for (let k = 0; k < 5; k++) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045 + r() * 0.02, 0), std(greens[(k + s) % 3], { flatShading: true, roughness: 0.6 }));
      leaf.scale.set(1, 0.35, 1.3);
      leaf.position.set((r() - 0.5) * 0.08, len * (0.45 + k * 0.13), (r() - 0.5) * 0.06);
      leaf.rotation.set(r() * 2, r() * 6, r() * 2);
      stem.add(leaf);
    }
    g.add(stem);
  }
  // lie it on its side, tip pointing toward the guinea pig
  g.rotation.x = Math.PI / 2;      // tip toward the guinea pig, leaves pointing away
  g.position.set(0, 0.105, -0.3);
  const wrap = new THREE.Group();
  wrap.add(g);
  wrap.rotation.y = 1.35;
  return wrap;
}

function lettuce() {
  const g = new THREE.Group();
  const r = rng(7);
  const leafCount = 9;
  for (let i = 0; i < leafCount; i++) {
    const inner = i < 3;
    // a cupped, ruffled leaf: part of a sphere shell with a wavy rim
    const geo = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 0.95, 0, Math.PI * 0.62);
    const pos = geo.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const cBase = new THREE.Color('#f1fbd2'), cTip = new THREE.Color(inner ? '#a8e45a' : '#4cbb2e'), c = new THREE.Color();
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
      const theta = Math.acos(Math.max(-1, Math.min(1, y)));   // 0 at top pole
      const phi = Math.atan2(z, x);
      const edge = theta / (Math.PI * 0.62);
      const ruffle = 1 + Math.pow(edge, 2.5) * 0.16 * Math.sin(phi * 14 + i);
      pos.setXYZ(k, x * ruffle, y, z * ruffle);
      c.copy(cBase).lerp(cTip, Math.pow(edge, 0.3));
      // central vein stays pale
      const vein = Math.exp(-Math.pow((phi - Math.PI * 0.475) * 4, 2));
      c.lerp(cBase, vein * 0.5);
      cols.set([c.r, c.g, c.b], k * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const leaf = new THREE.Mesh(geo, std(0xffffff, { vertexColors: true, side: THREE.DoubleSide, roughness: 0.5 }));
    const s = inner ? 0.13 : 0.19 + r() * 0.03;
    leaf.scale.set(s, s * 0.85, s);
    const a = (i / leafCount) * Math.PI * 2 + r() * 0.4;
    leaf.rotation.order = 'YXZ';
    leaf.rotation.set(Math.PI + (inner ? 0.25 : 0.95), a, 0);
    leaf.position.set(0, s * 0.8, 0);
    g.add(leaf);
  }
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), std('#dff0b0'));
  core.position.y = 0.05;
  core.scale.y = 0.8;
  g.add(core);
  return g;
}

function strawberry() {
  const g = new THREE.Group();
  const prof = [[0, 0], [0.035, 0.012], [0.08, 0.055], [0.115, 0.12], [0.132, 0.19], [0.128, 0.25], [0.1, 0.29], [0.05, 0.31], [0, 0.312]];
  const geo = lathe(prof, 28);
  geo.computeVertexNormals();
  tintByHeight(geo, '#d81d33', '#f0384a', 0, 0.31);
  const berry = new THREE.Mesh(geo, glossy(0xffffff, { vertexColors: true, roughness: 0.3 }));
  g.add(berry);
  // seeds sitting in little dimples
  const seedMat = std('#f7d65c', { roughness: 0.4 });
  const seedGeo = new THREE.SphereGeometry(0.009, 6, 4);
  const r = rng(11);
  const curve = new THREE.SplineCurve(prof.map(([x, y]) => new THREE.Vector2(x, y)));
  for (let i = 0; i < 46; i++) {
    const t = 0.1 + r() * 0.72;
    const p = curve.getPoint(t);
    const tan = curve.getTangent(t);
    const ang = r() * Math.PI * 2;
    const seed = new THREE.Mesh(seedGeo, seedMat);
    seed.scale.set(1, 1.6, 0.6);
    const n = V(tan.y * Math.cos(ang), -tan.x, tan.y * Math.sin(ang)).normalize();
    seed.position.set(Math.cos(ang) * p.x, p.y, Math.sin(ang) * p.x).addScaledVector(n, 0.002);
    seed.lookAt(seed.position.clone().add(n));
    g.add(seed);
  }
  // leafy green cap
  const leafMat = std('#3f9a35', { roughness: 0.55, side: THREE.DoubleSide });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.13, 4), leafMat);
    leaf.scale.set(1, 1, 0.3);
    const holder = new THREE.Group();
    holder.position.y = 0.305;
    holder.rotation.y = a;
    leaf.rotation.z = -Math.PI / 2 - 0.35;
    leaf.position.set(0.06, -0.01, 0);
    holder.add(leaf);
    g.add(holder);
  }
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.014, 0.07, 6), std('#4f8f2f'));
  stem.position.y = 0.34;
  stem.rotation.z = 0.25;
  g.add(stem);
  // lay it down a little, like it's been placed on the floor
  g.scale.setScalar(1.35);
  g.rotation.z = 1.25;
  g.position.y = 0.16;
  const wrap = new THREE.Group();
  wrap.add(g);
  return wrap;
}

function bellPepper() {
  const g = new THREE.Group();
  const prof = [[0.0, 0.03], [0.07, 0.01], [0.13, 0.03], [0.17, 0.09], [0.185, 0.17], [0.18, 0.25], [0.155, 0.31], [0.1, 0.335], [0.05, 0.32], [0.0, 0.31]];
  const geo = lathe(prof, 48);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const th = Math.atan2(z, x);
    const lobe = Math.cos(th * 4);
    const k = 1 + 0.11 * lobe;
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
    // four little feet on the bottom
    if (y < 0.08) pos.setY(i, y - 0.025 * Math.max(0, lobe) * (1 - y / 0.08));
  }
  geo.computeVertexNormals();
  tintByHeight(geo, '#c4160d', '#ee3a1f', 0, 0.33);
  const body = new THREE.Mesh(geo, glossy(0xffffff, { vertexColors: true, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.12 }));
  body.position.y = 0.025;
  g.add(body);
  // calyx + curved stem
  const calyx = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.025, 12), std('#3f7f2a'));
  calyx.position.y = 0.345;
  g.add(calyx);
  const stemCurve = new THREE.CatmullRomCurve3([V(0, 0.35, 0), V(0.005, 0.4, 0), V(0.03, 0.44, 0), V(0.07, 0.455, 0)]);
  const stem = new THREE.Mesh(new THREE.TubeGeometry(stemCurve, 12, 0.02, 8), std('#4c8f30', { roughness: 0.45 }));
  g.add(stem);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.012, 8), std('#c9d68b'));
  tip.position.set(0.075, 0.455, 0);
  tip.rotation.z = Math.PI / 2;
  g.add(tip);
  return g;
}

export function makeFood(type) {
  const g = type === 'carrot' ? carrot() : type === 'lettuce' ? lettuce() : type === 'strawberry' ? strawberry() : bellPepper();
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return g;
}

// ---------------------------------------------------------------- WATER BOTTLE
// A little hutch water bottle on a wooden stand. The group's origin is the tip of the metal
// spout (put it at the guinea pig's mouth). Local -x is "away to the side", +y is up.
// `drop` is how far it is from the spout tip down to the floor.
export function makeWaterBottle(drop = 0.6) {
  const g = new THREE.Group();
  const BX = -0.42, BOT = 0.3, TOP = 0.86, R = 0.13;
  // wooden pole behind the bottle
  const wood = std('#c89a64', { roughness: 0.7 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, drop + TOP + 0.12, 14), wood);
  pole.position.set(BX, (TOP + 0.12 - drop) / 2, -0.17);
  g.add(pole);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.035, 24), wood);
  foot.position.set(BX, -drop + 0.017, -0.17);
  g.add(foot);
  // clear plastic shell
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, TOP - BOT, 32, 1, true),
    new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.08, transparent: true, opacity: 0.22, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false }),
  );
  shell.position.set(BX, (TOP + BOT) / 2, 0);
  shell.renderOrder = 2;
  g.add(shell);
  // the water (scaled from the bottom as it gets drunk)
  const waterGeo = new THREE.CylinderGeometry(R * 0.93, R * 0.93, 1, 32);
  waterGeo.translate(0, 0.5, 0);
  const water = new THREE.Mesh(waterGeo, glossy('#74b3e6', { roughness: 0.15, transparent: true, opacity: 0.93 }));
  const WATER_FULL = (TOP - 0.1) - (BOT + 0.03);
  water.position.set(BX, BOT + 0.03, 0);
  water.scale.y = WATER_FULL * 0.85;
  g.add(water);
  // cap on top, green collar at the bottom, a little bracket holding it to the pole
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.04, R * 1.04, 0.13, 32), glossy('#f6eedc', { roughness: 0.4 }));
  cap.position.set(BX, TOP + 0.03, 0);
  g.add(cap);
  const capTop = new THREE.Mesh(new THREE.SphereGeometry(R * 1.04, 32, 8, 0, Math.PI * 2, 0, Math.PI / 2), cap.material);
  capTop.scale.y = 0.18; capTop.position.set(BX, TOP + 0.095, 0);
  g.add(capTop);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.05, R * 0.75, 0.09, 32), glossy('#7cc46a', { roughness: 0.35 }));
  collar.position.set(BX, BOT - 0.03, 0);
  g.add(collar);
  const grey = std('#b8bec6', { metalness: 0.6, roughness: 0.3 });
  for (const y of [BOT + 0.1, TOP - 0.12]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(R * 1.02, 0.012, 8, 32), grey);
    band.rotation.x = Math.PI / 2; band.position.set(BX, y, 0);
    g.add(band);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.025, 0.07), grey);
    arm.position.set(BX, y, -0.15);
    g.add(arm);
  }
  // metal spout: from the collar down and across to the tip, with the little ball valve
  const steel = new THREE.MeshStandardMaterial({ color: '#cfd6dd', metalness: 0.9, roughness: 0.22 });
  const a = V(BX + 0.02, BOT - 0.07, 0), b = V(0, 0, 0);
  const len = a.distanceTo(b);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.022, len, 12), steel);
  tube.position.copy(a).add(b).multiplyScalar(0.5);
  tube.quaternion.setFromUnitVectors(V(0, 1, 0), a.clone().sub(b).normalize());
  g.add(tube);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.024, 16, 12), steel);
  g.add(ball);
  // bubbles that rise when it takes a sip
  const bubbles = new THREE.Group();
  g.add(bubbles);
  const bubbleMat = new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, roughness: 0.1 });
  const bubbleGeo = new THREE.SphereGeometry(1, 10, 8);
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  g.userData = {
    water, bubbles, level: 0.85,
    setLevel(v) { this.level = Math.max(0.05, v); water.scale.y = WATER_FULL * this.level; },
    bubble() {
      const m = new THREE.Mesh(bubbleGeo, bubbleMat);
      m.scale.setScalar(0.012 + Math.random() * 0.016);
      m.position.set(BX + (Math.random() - 0.5) * R * 0.9, BOT + 0.05, (Math.random() - 0.5) * R * 0.9);
      m.userData.v = 0.35 + Math.random() * 0.3;
      bubbles.add(m);
    },
    update(dt) {
      const top = BOT + 0.03 + WATER_FULL * this.level;
      for (const m of [...bubbles.children]) {
        m.position.y += m.userData.v * dt;
        m.position.x += Math.sin(m.position.y * 40) * 0.002;
        if (m.position.y > top) bubbles.remove(m);
      }
    },
  };
  return g;
}

// ---------------------------------------------------------------- ACCESSORIES
// ctx: { L (landmarks incl. sdf, headTop, ears, eyes, noseTip), NECK, HEADC, surfaceAlong, sdfNormal }
export function buildAccessory(type, color, ctx) {
  const { L, NECK, HEADC, surfaceAlong, sdfNormal } = ctx;
  const rel = (v) => v.clone().sub(NECK);
  const col = new THREE.Color(color);
  const g = new THREE.Group();
  const top = L.headTop.clone();
  const topN = sdfNormal(L.sdf, top);

  switch (type) {
    case 'bow': {
      const satin = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.35, sheen: 1, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.4, side: THREE.DoubleSide });
      // puffy loop: a sphere pinched toward the knot
      const loopGeo = new THREE.SphereGeometry(1, 28, 18);
      {
        const lp = loopGeo.attributes.position;
        for (let i = 0; i < lp.count; i++) {
          const x = lp.getX(i);
          const pinch = 0.45 + 0.55 * Math.min(1, (x + 1) / 1.2);
          lp.setXYZ(i, x * 0.085 + 0.08, lp.getY(i) * 0.062 * pinch, lp.getZ(i) * 0.04 * pinch);
        }
        loopGeo.computeVertexNormals();
      }
      for (const sx of [-1, 1]) {
        const loop = new THREE.Mesh(loopGeo, satin);
        loop.scale.x = sx;
        loop.rotation.z = sx * 0.22;
        g.add(loop);
        const fold = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), new THREE.MeshPhysicalMaterial({ color: col.clone().multiplyScalar(0.7), roughness: 0.5 }));
        fold.position.set(sx * 0.11, 0.0, 0.03);
        fold.scale.set(1.6, 0.5, 0.4);
        g.add(fold);
        const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.11, 0.012), satin);
        tail.position.set(sx * 0.035, -0.07, 0.005);
        tail.rotation.z = sx * 0.45;
        g.add(tail);
      }
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.036, 16, 12), satin);
      knot.scale.set(1, 1.15, 0.8);
      g.add(knot);
      // beside the right ear, on top of the head
      const at = surfaceAlong(L.sdf, HEADC, V(0.45, 0.88, -0.05));
      const n = sdfNormal(L.sdf, at);
      g.position.copy(rel(at.addScaledVector(n, 0.05)));
      g.quaternion.setFromUnitVectors(V(0, 1, 0), n);
      g.rotateY(0.2);
      g.rotateX(-0.15);
      g.scale.setScalar(1.45);
      break;
    }
    case 'partyhat': {
      const h = 0.44, r = 0.165;
      const cone = new THREE.ConeGeometry(r, h, 40, 10, true);
      const pos = cone.attributes.position;
      const cols = new Float32Array(pos.count * 3);
      const white = new THREE.Color('#fffaf0');
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const swirl = Math.atan2(z, x) + y * 9; // diagonal candy stripes
        const c = Math.sin(swirl * 3) > 0 ? col : white;
        cols.set([c.r, c.g, c.b], i * 3);
      }
      cone.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      const hat = new THREE.Mesh(cone, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, side: THREE.DoubleSide }));
      hat.position.y = h / 2;
      g.add(hat);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.018, 8, 40), std('#ffd84d', { roughness: 0.35 }));
      rim.rotation.x = Math.PI / 2;
      g.add(rim);
      const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.058, 1), std('#fff6e0', { flatShading: true, roughness: 0.9 }));
      pom.position.y = h + 0.02;
      g.add(pom);
      g.position.copy(rel(top.clone().add(V(0.03, -0.035, -0.02))));
      g.quaternion.setFromUnitVectors(V(0, 1, 0), topN.clone().add(V(0.25, 0.1, -0.15)).normalize());
      break;
    }
    case 'flowers': {
      const petalCols = [col, new THREE.Color('#ffc8d8'), new THREE.Color('#fff1a6'), new THREE.Color('#ffffff'), new THREE.Color('#c9b6ff')];
      const pts = [];
      const n = 11;
      for (let i = 0; i <= n; i++) {
        const a = -Math.PI * 0.85 + (i / n) * Math.PI * 1.7;
        pts.push(surfaceAlong(L.sdf, HEADC, V(Math.sin(a) * 0.95, 0.62, Math.cos(a) * 0.55 - 0.32)));
      }
      const vine = new THREE.CatmullRomCurve3(pts.map((p) => rel(p.clone().addScaledVector(sdfNormal(L.sdf, p), 0.03))));
      g.add(new THREE.Mesh(new THREE.TubeGeometry(vine, 60, 0.012, 6), std('#4f8f35')));
      const r = rng(5);
      pts.forEach((p, i) => {
        const nrm = sdfNormal(L.sdf, p);
        const f = new THREE.Group();
        const petalMat = std(petalCols[i % petalCols.length], { roughness: 0.55 });
        const size = 1.15 + r() * 0.4;
        for (let k = 0; k < 5; k++) {
          const petal = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8), petalMat);
          const pa = (k / 5) * Math.PI * 2;
          petal.scale.set(1.25, 0.35, 0.85);
          petal.position.set(Math.cos(pa) * 0.036, 0, Math.sin(pa) * 0.036);
          petal.rotation.y = -pa;
          f.add(petal);
        }
        const center = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), std('#f2b21b', { roughness: 0.6 }));
        center.position.y = 0.01;
        f.add(center);
        if (i % 2 === 0) {
          const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 6), std('#5ea83e'));
          leaf.scale.set(1.6, 0.25, 0.7);
          leaf.position.set(0.06, -0.005, 0.02);
          f.add(leaf);
        }
        f.scale.setScalar(size);
        f.position.copy(rel(p.clone().addScaledVector(nrm, 0.045)));
        f.quaternion.setFromUnitVectors(V(0, 1, 0), nrm);
        f.rotateY(r() * 6);
        g.add(f);
      });
      break;
    }
    case 'glasses': {
      const frame = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.25, metalness: 0.3, clearcoat: 1 });
      const lensMat = new THREE.MeshPhysicalMaterial({ color: '#d8efff', transparent: true, opacity: 0.25, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false });
      const R = 0.105;
      const inner = [], outer = [];
      L.eyes.forEach((eye, i) => {
        const n = sdfNormal(L.sdf, eye);
        const face = n.clone().add(V(0, 0.05, 0.95)).normalize();      // lens faces forward-and-out
        const c = eye.clone().addScaledVector(n, 0.05).add(V(0, 0.01, 0.07));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.014, 10, 40), frame);
        const lens = new THREE.Mesh(new THREE.CircleGeometry(R, 32), lensMat);
        for (const m of [ring, lens]) {
          m.position.copy(rel(c));
          m.lookAt(m.position.clone().add(face));
          g.add(m);
        }
        // in-plane direction pointing toward the middle of the face
        const toMid = V(-c.x, 0, 0).addScaledVector(face, -face.x * -c.x / Math.max(1e-3, Math.abs(c.x)) * 0).normalize();
        const inPlane = toMid.clone().addScaledVector(face, -toMid.dot(face)).normalize();
        inner.push(c.clone().addScaledVector(inPlane, R));
        outer.push({ p: c.clone().addScaledVector(inPlane, -R), i });
      });
      // short bridge arching over the top of the nose
      const mid = inner[0].clone().lerp(inner[1], 0.5);
      const over = surfaceAlong(L.sdf, V(0, 0.6, 0.6), mid.clone().sub(V(0, 0.6, 0.6)));
      const bridgeTop = over.addScaledVector(sdfNormal(L.sdf, over), 0.03);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([inner[0], bridgeTop, inner[1]].map(rel)), 20, 0.012, 8), frame));
      // arms back to the ears
      outer.forEach(({ p, i }) => {
        const ear = L.ears[i];
        const end = ear.clone().addScaledVector(sdfNormal(L.sdf, ear), 0.015).add(V(0, -0.04, 0.02));
        const midA = p.clone().lerp(end, 0.5);
        const lift = sdfNormal(L.sdf, midA);
        const midOn = surfaceAlong(L.sdf, HEADC, midA.clone().sub(HEADC)).addScaledVector(lift, 0.025);
        g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([p, midOn, end].map(rel)), 16, 0.01, 6), frame));
      });
      break;
    }
    case 'tophat': {
      const prof = [[0, 0.012], [0.19, 0.0], [0.215, 0.012], [0.21, 0.024], [0.13, 0.022], [0.118, 0.06], [0.122, 0.21], [0.13, 0.23], [0.0, 0.232]];
      const hat = new THREE.Mesh(lathe(prof, 40), new THREE.MeshPhysicalMaterial({ color: '#1c1a22', roughness: 0.45, sheen: 0.6, sheenColor: new THREE.Color('#555066') }));
      hat.geometry.computeVertexNormals();
      hat.material.side = THREE.DoubleSide;
      g.add(hat);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.124, 0.12, 0.045, 40, 1, true), std(col, { roughness: 0.4, side: THREE.DoubleSide }));
      band.position.y = 0.05;
      g.add(band);
      g.scale.setScalar(1.4);
      g.position.copy(rel(top.clone().add(V(-0.02, -0.035, -0.03))));
      g.quaternion.setFromUnitVectors(V(0, 1, 0), topN.clone().add(V(-0.2, 0, -0.1)).normalize());
      break;
    }
    case 'crown': {
      const gold = new THREE.MeshPhysicalMaterial({ color: '#f5c542', metalness: 0.9, roughness: 0.22, clearcoat: 0.5 });
      const R = 0.13, H = 0.06, spikes = 6;
      // band whose top edge rises into points
      const band = new THREE.CylinderGeometry(R, R * 0.96, 1, 72, 6, true);
      const pos = band.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i) + 0.5, z = pos.getZ(i);
        const a = Math.atan2(z, x);
        const point = Math.pow(Math.abs(Math.cos(a * spikes / 2)), 3);
        pos.setY(i, y * (H + point * 0.075));
      }
      band.computeVertexNormals();
      g.add(new THREE.Mesh(band, new THREE.MeshPhysicalMaterial({ color: '#f5c542', metalness: 0.9, roughness: 0.22, clearcoat: 0.5, side: THREE.DoubleSide })));
      const gemCols = [col, new THREE.Color('#4fb3ff'), new THREE.Color('#ff4f7a')];
      for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * Math.PI * 2;
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), gold);
        ball.position.set(Math.cos(a) * R, H + 0.077, Math.sin(a) * R);
        g.add(ball);
        const ga = a + Math.PI / spikes;
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.018, 0), new THREE.MeshPhysicalMaterial({ color: gemCols[i % 3], roughness: 0.05, metalness: 0.1, clearcoat: 1 }));
        gem.position.set(Math.cos(ga) * (R + 0.006), H * 0.5, Math.sin(ga) * (R + 0.006));
        gem.scale.set(1, 1.3, 0.6);
        gem.lookAt(gem.position.clone().multiplyScalar(2));
        g.add(gem);
      }
      const rimG = new THREE.TorusGeometry(R, 0.009, 8, 60);
      const rim = new THREE.Mesh(rimG, gold);
      rim.rotation.x = Math.PI / 2;
      g.add(rim);
      g.scale.setScalar(1.45);
      g.position.copy(rel(top.clone().add(V(0, -0.035, -0.03))));
      g.quaternion.setFromUnitVectors(V(0, 1, 0), topN.clone().add(V(0.15, 0, 0)).normalize());
      break;
    }
    default:
      return null;
  }
  return g;
}

// ---------------------------------------------------------------- BITES
// Lets food have round bites taken out of it. Each bite is a sphere (in world space);
// anything inside a bite sphere is cut away, and the inside of the food shows through.
const MAX_BITES = 40;
export function makeBiteable(food) {
  const uniforms = {
    uBites: { value: Array.from({ length: MAX_BITES }, () => new THREE.Vector4(0, -100, 0, 0)) },
    uBiteCount: { value: 0 },
  };
  const seen = new Map();
  food.traverse((o) => {
    if (!o.isMesh) return;
    let m = seen.get(o.material);
    if (!m) {
      m = o.material.clone();
      m.side = THREE.DoubleSide;
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, uniforms);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vBiteW;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvBiteW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>
            varying vec3 vBiteW;
            uniform vec4 uBites[${MAX_BITES}];
            uniform int uBiteCount;`)
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
            for (int i = 0; i < ${MAX_BITES}; i++) {
              if (i >= uBiteCount) break;
              if (distance(vBiteW, uBites[i].xyz) < uBites[i].w) discard;
            }`)
          .replace('#include <color_fragment>', `#include <color_fragment>
            if (!gl_FrontFacing) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.96, 0.86), 0.45); // juicy inside`);
      };
      m.customProgramCacheKey = () => 'gp-bite-v1';
      seen.set(o.material, m);
    }
    o.material = m;
  });
  food.userData.biteUniforms = uniforms;
  return uniforms;
}

// Adds one bite (a cluster of spheres, so the edge looks scalloped like teeth marks).
export function addBite(food, center, radius, towardMouth) {
  const u = food.userData.biteUniforms;
  if (!u) return;
  const side = new THREE.Vector3(-towardMouth.z, 0, towardMouth.x).normalize();
  const parts = [
    [center, radius],
    [center.clone().addScaledVector(side, radius * 0.75).addScaledVector(towardMouth, radius * 0.25), radius * 0.6],
    [center.clone().addScaledVector(side, -radius * 0.75).addScaledVector(towardMouth, radius * 0.25), radius * 0.6],
  ];
  for (const [p, r] of parts) {
    if (u.uBiteCount.value >= MAX_BITES) break;
    u.uBites.value[u.uBiteCount.value].set(p.x, p.y, p.z, r);
    u.uBiteCount.value++;
  }
}

export const CRUMB_COLORS = {
  carrot: ['#f07a14', '#ffa043', '#e85d0a', '#ffd2a0'],
  lettuce: ['#9fd65a', '#d9f0a8', '#5cb23a', '#eef7cf'],
  strawberry: ['#e3263a', '#ff8a8a', '#f7d65c', '#ffd6d6'],
  pepper: ['#e8321e', '#ff6a4a', '#f3d2c8', '#c4160d'],
  hay: ['#e3cf7d', '#d4bd62', '#c9c06a', '#b0a050'],
};
