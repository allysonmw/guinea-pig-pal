// The desktop pet: rendering, behaviour, and interaction.
import * as THREE from 'three';
import { buildGuineaPig, makeStage, makeFood, DEFAULT_CONFIG, mergeConfig } from '../shared/guineapig.js';
import { makeBiteable, addBite, CRUMB_COLORS, makeWaterBottle } from '../shared/props.js';
import { heartUrl } from '../shared/pixelheart.js';
import { Sounds } from '../shared/sounds.js';
import { getApi } from '../shared/api.js';

const api = getApi();
const canvas = document.getElementById('stage');
const bubbleEl = document.getElementById('bubble');
const bubbleText = document.getElementById('bubbleText');
const fxEl = document.getElementById('fx');
const { renderer, scene, camera } = makeStage(canvas, { fov: 27 });

camera.position.set(3.7, 2.3, 5.5);
const LOOK_AT = new THREE.Vector3(0, 0.9, 0.05);
camera.lookAt(LOOK_AT);
const CAM_YAW = Math.atan2(camera.position.x, camera.position.z);
const CAM_BASE = camera.position.clone();
let camHold = 0;
// body yaw that walks the pig along the screen (slightly angled toward the viewer)
const WALK_YAW = { 1: CAM_YAW + Math.PI / 2 - 0.35, [-1]: CAM_YAW - Math.PI / 2 + 0.35 };

// the window is a bit roomier than the original 320x280 one; widen the view to match so the
// guinea pig stays the same size on screen and just has more space around it
const BASE_FOV = 27, BASE_H = 280, ROOMY_H = 310;
camera.fov = (2 * Math.atan(Math.tan((BASE_FOV / 2) * Math.PI / 180) * ROOMY_H / BASE_H)) * 180 / Math.PI;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- state ----------
let config = mergeConfig(DEFAULT_CONFIG, null);
let pig = null;
let stats = { hunger: 80, happiness: 80, lastSeen: Date.now(), sleeping: false };

const S = {
  mode: 'idle', // idle | walk | eat | sleep | popcorn | held | petted | drink
  modeT: 0,
  lookYaw: CAM_YAW, lookPitch: 0,
  eyesClosed: 0, chew: false, sniff: false, groom: false,
  walk: false, turn: 0, jump: 0, spin: 0, blush: 0, sleep: false, held: false, eating: false,
};
let nextIdle = 2;
let idleAction = null; // { kind, until }
let cursor = null; // px within window
let cursorStillFor = 0;
let lastCursor = null;
let systemIdle = 0;
let activeTicks = 0;
let sleepReason = null; // 'idle' | 'manual'
let food = null;
let walkDir = 1, walkEnd = 0, walkAccum = 0, walkPending = false;
let jumpT = -1, jumpCount = 0;
let petEnergy = 0, lastPetAt = -10, purrAt = 0;
let lastZ = 0, lastHungryNag = 0;
let t = 0;

function rebuild(cfg) {
  config = mergeConfig(DEFAULT_CONFIG, cfg);
  Sounds.enabled = config.settings.sound !== false;
  if (pig) { scene.remove(pig.object); pig.dispose(); }
  pig = buildGuineaPig(config);
  scene.add(pig.object);
}

// ---------- helpers ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function headScreenPos(lift = 0.75) {
  const v = new THREE.Vector3();
  pig.headGroup.getWorldPosition(v);
  v.y += lift * (config.size || 1);
  v.project(camera);
  return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
}

let bubbleTimer = null;
// Which speech bubbles are allowed to show. Set one to true to bring those lines back.
const BUBBLES = {
  full: true,     // "too full" when you try to feed it
  eat: true,      // sometimes, when food arrives / when it finishes
  drag: true,     // squeaks when you pick it up
  chatter: false, // everything else (walking, following, typing, petting, waking, hungry, distractions...)
};

function say(text, ms = 1800, kind = 'chatter') {
  if (!BUBBLES[kind]) return;
  bubbleText.textContent = text;
  bubbleEl.style.setProperty('--heart', `url("${heartUrl()}")`);
  bubbleEl.classList.add('hidden');
  void bubbleEl.offsetWidth;            // restart the pop animation
  bubbleEl.classList.remove('hidden');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubbleEl.classList.add('hidden'), ms);
}

function floatFx(char, cls = '') {
  const p = headScreenPos(0.45);
  const el = document.createElement('div');
  el.className = `float ${cls}`;
  if (char === 'heart') {
    const img = document.createElement('img');
    img.src = heartUrl();
    img.style.width = `${Math.round(rand(16, 24))}px`;
    el.appendChild(img);
  } else el.textContent = char;
  el.style.left = `${p.x + rand(-25, 25)}px`;
  el.style.top = `${p.y}px`;
  el.style.setProperty('--dx', `${rand(-20, 20)}px`);
  fxEl.appendChild(el);
  setTimeout(() => el.remove(), 2700);
}
const hearts = (n = 3) => { for (let i = 0; i < n; i++) setTimeout(() => floatFx('heart', 'heart'), i * 180); };

function setMode(m) {
  S.mode = m;
  S.modeT = 0;
  S.walk = false; S.eating = false; S.chew = false; S.held = false; S.groom = false; S.sniff = false;
  S.sleep = m === 'sleep';
  S.mouthOpen = 0;
  idleAction = null;
}

function bumpHappy(v) { stats.happiness = clamp(stats.happiness + v, 0, 100); }

// ---------- actions ----------
function popcorn() {
  if (S.mode === 'sleep') { wake(true); return; }
  if (S.mode === 'eat' || S.mode === 'held') return;
  setMode('popcorn');
  jumpT = 0;
  jumpCount = Math.random() < 0.35 ? 2 : 1;
  Sounds.wheek(rand(1, 3) | 0);
  const lines = ['wheek >_<', 'wheek wheek!', 'hai!', `${config.name} says hi!`, 'popcorn!', '*happy squeak*'];
  say(stats.hunger < 30 ? 'wheek! 🥕?' : pick(lines));
  bumpHappy(3);
}

function feed(type) {
  if (S.mode === 'sleep') wake(false);
  if (stats.hunger > 96) { say("ouhgh me full", 1800, 'full'); return; }
  if (food) { scene.remove(food); food = null; }
  setMode('eat');
  S.turn = 0;
  food = makeFood(type);
  const sc = config.size || 1;
  food.position.set(0.05 * sc, 0, 1.45 * sc);
  food.scale.setScalar(sc);
  food.userData = { type, eaten: 0, dur: 5.5, bites: 0, nBites: 7 };
  makeBiteable(food);
  scene.add(food);
  planBites(food);
  if (Math.random() < 0.5) say(pick(['ooouu for me?', 'wheek!']), 1200, 'eat');
  Sounds.wheek(1);
}

// Works out where each bite goes: starting at the edge nearest the mouth and working through the food.
function planBites(f) {
  f.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(f);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const mouth = pig.mouthWorld();
  const dir = center.clone().sub(mouth).setY(0);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  dir.normalize();
  const half = 0.5 * (Math.abs(size.x * dir.x) + Math.abs(size.z * dir.z));
  const n = f.userData.nBites;
  const step = (2 * half) / n;
  const radius = Math.max(0.075 * (config.size || 1), step * 1.15, Math.max(size.y, Math.min(size.x, size.z)) * 0.42);
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  f.userData.plan = Array.from({ length: n }, (_, k) => {
    const along = -half + step * (k + 0.55);
    const p = center.clone().addScaledVector(dir, along).addScaledVector(side, (Math.random() - 0.5) * half * 0.3);
    p.y = box.min.y + size.y * (0.45 + Math.random() * 0.3);
    // the last bites are big enough to finish it off
    return { p, r: k >= n - 2 ? radius * 1.6 : radius };
  });
  f.userData.dir = dir.clone().negate();
}

// ---------- crumbs ----------
const crumbs = [];
// a mix of crumb shapes: mostly blocky bits, plus a few rounder chunks
const wedgeGeo = (() => {
  const shape = new THREE.Shape([new THREE.Vector2(-0.018, -0.012), new THREE.Vector2(0.02, -0.012), new THREE.Vector2(-0.006, 0.016)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.016, bevelEnabled: false });
  g.translate(0, 0, -0.008);
  return g;
})();
const CRUMB_SHAPES = [
  { geo: new THREE.BoxGeometry(0.028, 0.028, 0.028), weight: 3 },   // little cube
  { geo: new THREE.BoxGeometry(0.04, 0.012, 0.03), weight: 3 },     // flat chip
  { geo: new THREE.BoxGeometry(0.05, 0.013, 0.013), weight: 2 },    // stick / shred
  { geo: wedgeGeo, weight: 2 },                                     // wedge
  { geo: new THREE.IcosahedronGeometry(0.02, 0), weight: 2 },       // round-ish chunk
];
const CRUMB_TOTAL = CRUMB_SHAPES.reduce((a, c) => a + c.weight, 0);
function crumbGeo() {
  let r = Math.random() * CRUMB_TOTAL;
  for (const c of CRUMB_SHAPES) { r -= c.weight; if (r <= 0) return c.geo; }
  return CRUMB_SHAPES[0].geo;
}
function spawnCrumbs(at, type, n = 8) {
  const cols = CRUMB_COLORS[type] || ['#d9b38c'];
  const sc = config.size || 1;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(crumbGeo(), new THREE.MeshStandardMaterial({ color: pick(cols), roughness: 0.6, flatShading: true, transparent: true }));
    m.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.08));
    const base = sc * (0.6 + Math.random() * 0.9);
    m.scale.set(base * (0.75 + Math.random() * 0.5), base * (0.75 + Math.random() * 0.5), base * (0.75 + Math.random() * 0.5));
    m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    const a = Math.random() * Math.PI * 2;
    const spd = (0.4 + Math.random() * 0.7) * sc;
    m.userData = { v: new THREE.Vector3(Math.cos(a) * spd, (0.8 + Math.random() * 0.9) * sc, Math.sin(a) * spd), spin: (Math.random() - 0.5) * 18, life: 1.8 + Math.random() * 0.8, age: 0 };
    scene.add(m);
    crumbs.push(m);
  }
}
function updateCrumbs(dt) {
  for (let i = crumbs.length - 1; i >= 0; i--) {
    const c = crumbs[i], u = c.userData;
    u.age += dt;
    u.v.y -= 6.5 * dt;
    c.position.addScaledVector(u.v, dt);
    c.rotation.x += u.spin * dt; c.rotation.z += u.spin * 0.7 * dt;
    const floor = 0.012 * c.scale.x;
    if (c.position.y < floor) {       // bounce, then settle on the floor
      c.position.y = floor;
      u.v.y = Math.abs(u.v.y) * 0.32;
      u.v.x *= 0.55; u.v.z *= 0.55;
      u.spin *= 0.5;
    }
    c.material.opacity = Math.min(1, (u.life - u.age) * 2.5);
    if (u.age > u.life) { scene.remove(c); c.material.dispose(); crumbs.splice(i, 1); }
  }
}

let biteT = 9;
let swallowDir = 1, swallowPhase = '', swallowT = 0;
let hay = 0, nextHayAt = 0;
let chewOn = '';
let camFit = 1;
const tmpL = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpBox = new THREE.Box3();
let fitPts = null;
// Never let the guinea pig (or its bottle / food) poke out of the window: look at where its outline
// lands on screen and ease the camera back a little if anything would get cut off.
function fitCamera(dt) {
  if (!pig) return;
  const body = pig.hitMeshes[0];
  if (!fitPts || fitPts.src !== body.geometry) {
    const pos = body.geometry.attributes.position, pts = [];
    const step = Math.max(1, Math.floor(pos.count / 260));
    for (let i = 0; i < pos.count; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).multiplyScalar(1.08)); // + fluff
    fitPts = { src: body.geometry, pts };
  }
  camera.updateMatrixWorld();
  pig.object.updateMatrixWorld(true);
  let need = 0;
  const M = 0.94; // keep a small margin from the window edge
  const check = (v) => {
    v.project(camera);
    need = Math.max(need, Math.abs(v.x) / M, v.y > 0 ? v.y / M : -v.y / 0.97);
  };
  for (const p of fitPts.pts) check(tmpP.copy(p).applyMatrix4(body.matrixWorld));
  for (const extra of [bottle, food]) {
    if (!extra) continue;
    tmpBox.setFromObject(extra);
    if (tmpBox.isEmpty()) continue;
    for (let i = 0; i < 8; i++) check(tmpP.set(i & 1 ? tmpBox.max.x : tmpBox.min.x, i & 2 ? tmpBox.max.y : tmpBox.min.y, i & 4 ? tmpBox.max.z : tmpBox.min.z));
  }
  const target = Math.max(1, camFit * need);
  // back off quickly when something's about to be cut off, come back in slowly
  camFit += (target - camFit) * (1 - Math.exp(-dt * (target > camFit ? 10 : 1.2)));
}
let bottle = null, lastDrinkAt = 0, drinkEnd = 0, lastLick = 0, licks = 0;
const tmpV = new THREE.Vector3();
function takeBite(f) {
  const u = f.userData;
  const b = u.plan[u.bites];
  u.bites++;
  addBite(f, b.p, b.r, u.dir);
  spawnCrumbs(b.p.clone().addScaledVector(u.dir, b.r * 0.6), u.type, 7 + Math.floor(Math.random() * 5));
  Sounds.munch();
  biteT = 0;
}

function finishEating() {
  const { type } = food.userData;
  scene.remove(food);
  food = null;
  const fill = { carrot: 25, lettuce: 20, strawberry: 12, pepper: 22 }[type] || 20;
  stats.hunger = clamp(stats.hunger + fill, 0, 100);
  bumpHappy(type === 'strawberry' ? 14 : 8);
  hearts(4);
  if (Math.random() < 0.5) say(pick(['yum!', 'nom nom nom', 'delicious >.<', 'more pls?']), 1800, 'eat');
  setMode('idle');
  nextIdle = 2;
  saveStatsSoon();
}

function goSleep(reason) {
  if (S.mode === 'sleep') return;
  if (food) { scene.remove(food); food = null; }
  setMode('sleep');
  sleepReason = reason;
  stats.sleeping = true;
  saveStatsSoon();
}

function wake(startled) {
  if (S.mode !== 'sleep') return;
  setMode('idle');
  sleepReason = null;
  stats.sleeping = false;
  if (startled) { say('!!'); Sounds.eep(); } else say(pick(['zzz', 'oh haii!', 'good nap hehe']));
  nextIdle = 1.5;
  saveStatsSoon();
}

// ---------- drinking from the water bottle (an occasional idle) ----------
function placeBottle() {
  const sc = config.size || 1;
  const m = pig.mouthWorld(tmpV);
  const u = bottle.userData;
  u.base = (u.base || new THREE.Vector3()).copy(m);
  // where the stand's foot is (grow the bottle up out of the floor from there)
  u.foot = new THREE.Vector3(-0.42, -m.y / sc, -0.17).applyAxisAngle(new THREE.Vector3(0, 1, 0), CAM_YAW).multiplyScalar(sc);
}
function startDrink() {
  setMode('drink');
  S.turn = 0;
  lastDrinkAt = t;
  drinkEnd = rand(4.5, 6.5);
  lastLick = 0; licks = 0;
  if (bottle) scene.remove(bottle);
  const sc = config.size || 1;
  bottle = makeWaterBottle(pig.mouthWorld(tmpV).y / sc);
  bottle.rotation.y = CAM_YAW;          // stands beside the guinea pig, spout reaching into its mouth
  bottle.userData.k = 0;
  bottle.userData.setLevel(rand(0.55, 0.9));
  placeBottle();
  scene.add(bottle);
}
function updateBottle(dt) {
  if (!bottle) return;
  const u = bottle.userData;
  const here = S.mode === 'drink' && S.modeT < drinkEnd;
  u.k = clamp(u.k + (here ? dt / 0.4 : -dt / 0.3), 0, 1);
  // little springy pop when it appears
  const k = u.k, e = here ? 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2) : k * k;
  const sc = (config.size || 1) * Math.max(0.001, e);
  bottle.scale.setScalar(sc);
  bottle.position.copy(u.base).add(tmpV.copy(u.foot).multiplyScalar(1 - Math.max(0.001, e)));
  u.update(dt);
  if (!here && u.k <= 0) { scene.remove(bottle); bottle = null; }
}

function startWalk() {
  const w = window.screen?.availWidth || 1600;
  const x = window.screenX ?? 0;
  if (x < 120) walkDir = 1;
  else if (x > w - 450) walkDir = -1;
  else walkDir = Math.random() < 0.5 ? -1 : 1;
  setMode('walk');
  S.walk = true;
  walkEnd = rand(1.8, 4.5);
}

async function walkStep(dt) {
  walkAccum += walkDir * 75 * dt;
  const step = Math.trunc(walkAccum);
  if (step === 0 || walkPending) return;
  walkAccum -= step;
  walkPending = true;
  const r = await api.moveBy(step, 0);
  walkPending = false;
  if (r?.blocked && S.mode === 'walk') { setMode('idle'); nextIdle = 1; }
}

// ---------- following your mouse ----------
let cursorMovedAt = -10, followUntil = 0, followAccX = 0, followAccY = 0, followPending = false;
const FOLLOW_SPEED = 140; // px per second, a little trot

function startFollow() {
  setMode('follow');
  S.walk = true;
  followUntil = t + rand(6, 9);
  if (Math.random() < 0.4) say(pick(['ooh! 👀', 'wait for me!', 'whatcha doing?']), 1300);
}

async function followStep(stepX, stepY) {
  followAccX += stepX; followAccY += stepY;
  const sx = Math.trunc(followAccX), sy = Math.trunc(followAccY);
  if ((sx === 0 && sy === 0) || followPending) return;
  followAccX -= sx; followAccY -= sy;
  followPending = true;
  const r = await api.moveBy(sx, sy);
  followPending = false;
  // stuck against the edge of the screen in the direction it wants to go: give up
  const stuckX = !!r?.blocked && Math.abs(sx) >= Math.abs(sy);
  const stuckY = !!r?.blockedY && Math.abs(sy) > Math.abs(sx);
  if ((stuckX || stuckY) && S.mode === 'follow') { setMode('idle'); nextIdle = 2; }
}

function followUpdate(dt) {
  if (!cursor) { setMode('idle'); return; }
  const hp = headScreenPos(0.05);
  const dx = cursor.x - hp.x, dy = cursor.y - hp.y;
  const dist = Math.hypot(dx, dy);
  if (Math.abs(dx) > 25) walkDir = dx > 0 ? 1 : -1;
  S.turn = WALK_YAW[walkDir];
  S.walk = true;
  if (dist < 70 || hovering) {
    // caught up! sniff your pointer
    setMode('idle');
    idleAction = { kind: 'sniff', until: t + 1.6 };
    nextIdle = rand(3, 5);
    if (Math.random() < 0.45) { say(pick(['hi! 💛', 'found you!', '*sniff sniff*']), 1400); hearts(1); }
  } else if (t > followUntil) {
    setMode('idle');
    nextIdle = rand(3, 6);
    if (Math.random() < 0.5) say(pick(['too fast! 😮‍💨', '*pant pant*', 'nevermind…']), 1400);
  } else if (S.modeT > 0.25) {
    followStep((dx / dist) * FOLLOW_SPEED * dt, (dy / dist) * FOLLOW_SPEED * dt);
  }
}

// ---------- api wiring ----------
api.onConfig((c) => rebuild(c));
api.onAction(({ action, payload }) => {
  if (action === 'feed') feed(payload);
  else if (action === 'drink') {
    if (S.mode === 'sleep') wake(false);
    if (S.mode !== 'eat' && S.mode !== 'held' && S.mode !== 'swallow' && S.mode !== 'drink') { hay = 0; startDrink(); }
  }
  else if (action === 'say') say(payload, 2500);
  else if (action === 'distraction-warn') {
    if (S.mode === 'sleep') wake(false);
    say(`1 more minute of ${payload.label} 👀`, 4500);
    Sounds.wheek(1);
  } else if (action === 'distraction-countdown') {
    if (S.mode === 'sleep') wake(false);
    S.sniff = true;
    say(payload.seconds <= 3 ? `${payload.seconds}… 🍴` : `${payload.label} in ${payload.seconds}… 🐹🍴`, 1300);
  } else if (action === 'swallow-prep') {
    // turn toward the distracting window, open wide, and tell main.js where the mouth is
    if (S.mode === 'sleep') wake(false);
    if (food) { scene.remove(food); food = null; }
    hay = 0;
    setMode('swallow');
    swallowDir = payload && payload.x < window.innerWidth / 2 ? -1 : 1;
    swallowPhase = 'ready';
    setTimeout(() => {
      const m = pig.mouthWorld().project(camera);
      api.reportMouth?.({ x: (m.x * 0.5 + 0.5) * window.innerWidth, y: (-m.y * 0.5 + 0.5) * window.innerHeight });
    }, 550);
  } else if (action === 'swallow-go') {
    swallowPhase = 'suck';
    swallowT = 0;
  } else if (action === 'ate') {
    // gulp! little hop, burp, hearts
    setMode('popcorn');
    jumpT = 0.15; jumpCount = 1;
    stats.hunger = clamp(stats.hunger + 4, 0, 100);
    bumpHappy(6);
    Sounds.burp?.();
    setTimeout(() => { hearts(3); say(pick([`*burp* ${payload} was tasty`, 'Back to work!', 'Nom. You’re welcome !!'])); }, 400);
    saveStatsSoon();
  }
  else if (action === 'sleep') goSleep('manual');
  else if (action === 'wake') wake(false);
});
let lastTypingAt = -10;
api.onSensors(({ cursor: c, idleSeconds, typing }) => {
  if (!dragStart) {
    if (c && cursor && (c.x !== cursor.x || c.y !== cursor.y)) cursorMovedAt = t;
    cursor = c;
  }
  systemIdle = idleSeconds;
  if (idleSeconds < 0.4) activeTicks++; else activeTicks = Math.max(0, activeTicks - 2);
  // real key presses (only reported if you gave permission)
  if (typing) lastTypingAt = t;
});

let statsTimer = null;
function saveStatsSoon() {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(() => { stats.lastSeen = Date.now(); api.saveStats(stats); }, 400);
}

// ---------- mouse: hover-through, petting, dragging, clicking ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hovering = false;
let dragStart = null, dragging = false, lastMove = null;
let sway = 0, swayV = 0, swing = 0, swingV = 0, shakeAt = -1, lastDragX = 0, lastDragY = 0;

function hitTest(x, y) {
  if (!pig) return false;
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObject(pig.root, true).some((h) => h.object.isMesh || h.object.isInstancedMesh);
}

function setHover(h) {
  if (h === hovering) return;
  hovering = h;
  api.setIgnoreMouse(!h);
  document.body.classList.toggle('grab', h);
}

window.addEventListener('mousemove', (e) => {
  if (dragStart) {
    const moved = Math.hypot(e.screenX - dragStart.sx, e.screenY - dragStart.sy);
    if (!dragging && moved > 5) {
      dragging = true;
      document.body.classList.add('dragging');
      if (S.mode === 'sleep') { sleepReason = null; stats.sleeping = false; }
      setMode('held');
      S.held = true;
      // hang the guinea pig from the cursor by its scruff
      const g = pig.grabWorld().project(camera);
      dragStart.ox = (g.x * 0.5 + 0.5) * window.innerWidth;
      dragStart.oy = (-g.y * 0.5 + 0.5) * window.innerHeight;
      lastDragX = e.screenX; lastDragY = e.screenY;
      Sounds.eep();
      say(pick(['eep!', 'whoa!', 'wheee!']), 1200, 'drag');
    }
    if (dragging) {
      api.dragTo(e.screenX, e.screenY, dragStart.ox, dragStart.oy);
      // moving the window pushes the dangling body the other way (pendulum)
      swayV += (e.screenX - lastDragX) * 0.035;
      swingV -= (e.screenY - lastDragY) * 0.02;
      lastDragX = e.screenX; lastDragY = e.screenY;
    }
    return;
  }
  const hit = hitTest(e.clientX, e.clientY);
  setHover(hit);
  // petting = moving the mouse over the guinea pig without clicking
  if (hit && lastMove) {
    const d = Math.hypot(e.clientX - lastMove.x, e.clientY - lastMove.y);
    petEnergy = Math.min(petEnergy + d, 400);
    lastPetAt = t;
  }
  lastMove = { x: e.clientX, y: e.clientY };
});

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !hitTest(e.clientX, e.clientY)) return;
  dragStart = { sx: e.screenX, sy: e.screenY, ox: e.clientX, oy: e.clientY };
  dragging = false;
});

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !dragStart) return;
  const wasDragging = dragging;
  dragStart = null;
  dragging = false;
  document.body.classList.remove('dragging');
  if (wasDragging) {
    setMode('popcorn'); // little landing bounce
    jumpT = 0.3; jumpCount = 1;
    nextIdle = 1;
    if (Math.random() < 0.55) shakeAt = t + 0.7; // sometimes shakes itself off
  } else {
    popcorn();
  }
  setHover(hitTest(e.clientX, e.clientY));
});

window.addEventListener('mouseleave', () => { if (!dragStart) setHover(false); lastMove = null; });
window.addEventListener('dblclick', (e) => { if (hitTest(e.clientX, e.clientY)) api.openCustomizer(); });
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  stats.lastSeen = Date.now();
  api.saveStats(stats);
  api.showMenu();
});

// ---------- behaviour update ----------
function updateLook(dt) {
  if (S.mode === 'eat') { S.lookYaw = 0; S.lookPitch = -0.1; return; }
  if (S.mode === 'swallow') { S.lookYaw = 0; S.lookPitch = 0.05; return; }
  if (S.mode === 'drink') { S.lookYaw = 0; S.lookPitch = 0; return; }
  if (S.mode === 'held') { S.lookYaw = sway * -0.4; S.lookPitch = 0; return; }
  if (S.mode === 'follow') {
    const hp = headScreenPos(0.05);
    S.lookYaw = walkDir * 0.3;
    S.lookPitch = cursor ? clamp(-(cursor.y - hp.y) / 500, -0.3, 0.4) : 0;
    return;
  }
  if (S.mode === 'sleep' || S.mode === 'walk') { S.lookYaw = S.mode === 'walk' ? walkDir * 0.25 : 0; S.lookPitch = 0; return; }
  if (cursor && lastCursor && Math.hypot(cursor.x - lastCursor.x, cursor.y - lastCursor.y) < 2) cursorStillFor += dt;
  else cursorStillFor = 0;
  lastCursor = cursor ? { ...cursor } : null;
  const hp = headScreenPos(0.1);
  const dist = cursor ? Math.hypot(cursor.x - hp.x, cursor.y - hp.y) : Infinity;
  if (cursor && dist < 1100 && cursorStillFor < 6) {
    const dx = cursor.x - hp.x, dy = cursor.y - hp.y;
    S.lookYaw = clamp(Math.atan2(dx, 420) * 1.1 + CAM_YAW - S.turn, -1.0, 1.0);
    S.lookPitch = clamp(-dy / 520, -0.35, 0.45);
  } else if (idleAction?.kind === 'look') {
    S.lookYaw = idleAction.yaw; S.lookPitch = idleAction.pitch;
  } else {
    S.lookYaw = CAM_YAW * 0.6; S.lookPitch = 0;
  }
}

function chooseIdle() {
  // now and then, if you've been moving your mouse nearby-ish, trot over to it
  if (config.settings.followMouse !== false && cursor && t - cursorMovedAt < 2.5 && Math.random() < 0.18) {
    const hp = headScreenPos(0.05);
    if (Math.hypot(cursor.x - hp.x, cursor.y - hp.y) > 220) { startFollow(); return; }
  }
  // every few minutes it has a little drink of water
  if (t - lastDrinkAt > 150 && hay <= 0 && Math.random() < 0.12) { startDrink(); return; }
  const r = Math.random();
  const wander = config.settings.wander !== false;
  if (wander && r < 0.22) { startWalk(); return; }
  if (r < 0.45) idleAction = { kind: 'look', yaw: rand(-0.9, 0.9), pitch: rand(-0.2, 0.3), until: t + rand(1.5, 3) };
  else if (r < 0.6) idleAction = { kind: 'groom', until: t + rand(1.2, 2.2) };
  else if (r < 0.75) idleAction = { kind: 'sniff', until: t + rand(0.8, 1.6) };
  else if (r < 0.85) idleAction = { kind: 'chew', until: t + rand(1, 2) };
  else if (r < 0.9 && stats.happiness > 70) { popcorn(); return; }
  else idleAction = { kind: 'rest', until: t + rand(2, 4) };
  nextIdle = rand(3, 7);
}

function update(dt) {
  t += dt;
  const typing = t - lastTypingAt < 1.2 && S.mode === 'idle';
  S.modeT += dt;

  // stats drift
  stats.hunger = clamp(stats.hunger - dt / 12, 0, 100); // 5% per minute
  stats.happiness = clamp(stats.happiness - dt / (stats.hunger < 20 ? 90 : 300), 0, 100);

  // sleeping when the computer is idle
  if (config.settings.sleepWhenIdle !== false && systemIdle > 120 && S.mode !== 'sleep' && S.mode !== 'held') goSleep('idle');
  if (S.mode === 'sleep' && sleepReason === 'idle' && systemIdle < 1.5) wake(false);

  // petting
  const beingPetted = t - lastPetAt < 0.35 && petEnergy > 60;
  petEnergy = Math.max(0, petEnergy - dt * 120);
  if (beingPetted && S.mode !== 'held' && S.mode !== 'eat') {
    if (S.mode !== 'sleep' && S.mode !== 'petted') setMode('petted');
    S.blush = 1;
    bumpHappy(dt * 1.5);
    if (t - purrAt > 1.1) { purrAt = t; Sounds.purr(1); if (Math.random() < 0.5) floatFx('heart', 'heart'); }
  } else if (S.mode === 'petted' && t - lastPetAt > 1.2) {
    setMode('idle');
    nextIdle = 2;
    if (Math.random() < 0.4) say(pick(['more pets pls', 'brrrr 💛', '^ ^']), 1400);
  }

  // mode logic
  switch (S.mode) {
    case 'idle': {
      nextIdle -= dt;
      if (idleAction && t > idleAction.until) idleAction = null;
      S.groom = idleAction?.kind === 'groom';
      S.sniff = idleAction?.kind === 'sniff';
      S.chew = idleAction?.kind === 'chew';
      // nibble hay while you type
      if (typing) {
        if (hay <= 0 && t > nextHayAt) { hay = 1; if (Math.random() < 0.3) say(pick(['hay time 🌾', '*nom*', 'type type type 🌾']), 1400); }
        if (hay > 0) {
          S.chew = true;
          idleAction = null;
          hay -= dt / 9;                                   // one strand lasts ~9 seconds of typing
          if (Math.random() < dt * 0.8) spawnCrumbs(pig.mouthWorld(), 'hay', 2);
          if (hay <= 0) { hay = 0; nextHayAt = t + 1.2; }  // finished it, grab another in a sec
        }
      } else if (hay > 0 && t - lastTypingAt > 6) {
        hay = Math.max(0, hay - dt * 0.6);                 // 6 seconds after you stop typing: slurps up the rest
        S.chew = true;
        if (Math.random() < dt * 3) spawnCrumbs(pig.mouthWorld(), 'hay', 2);   // crumbs while it gobbles
        if (hay <= 0) spawnCrumbs(pig.mouthWorld(), 'hay', 5);                 // last little bits
      }
      S.turn *= 0.98;
      if (nextIdle <= 0 && !idleAction && !typing) chooseIdle();
      if (stats.hunger < 30 && t - lastHungryNag > 90) { lastHungryNag = t; say('wheek! 🥕?', 2500); Sounds.wheek(2); }
      S.eyesClosed = 0; S.blush = stats.happiness > 85 ? 0.35 : 0;
      break;
    }
    case 'follow': {
      followUpdate(dt);
      break;
    }
    case 'walk': {
      S.turn = WALK_YAW[walkDir];
      if (S.modeT > 0.3) walkStep(dt);
      if (S.modeT > walkEnd) { setMode('idle'); nextIdle = rand(2, 5); }
      break;
    }
    case 'popcorn': {
      jumpT += dt;
      const dur = 0.55;
      const p = jumpT / dur;
      S.jump = p >= 0 && p <= 1 ? Math.sin(Math.PI * p) * 0.5 : 0;
      S.spin = p >= 0 && p <= 1 ? Math.sin(Math.PI * 2 * p) * 0.35 : 0;
      S.eyesClosed = p > 0 && p < 1 ? 0.7 : 0;
      if (p > 1) {
        jumpCount--;
        if (jumpCount > 0) jumpT = -0.08;
        else { S.jump = 0; S.spin = 0; setMode(food ? 'eat' : 'idle'); nextIdle = rand(1.5, 3); }
      }
      break;
    }
    case 'eat': {
      S.eating = true; S.chew = true; S.turn = 0;
      if (food) {
        const u = food.userData;
        if (S.modeT > 0.35) u.eaten += dt; // short pause to settle in before the first bite
        const due = Math.min(u.nBites, Math.floor((u.eaten / u.dur) * u.nBites) + 1);
        if (S.modeT > 0.35 && due > u.bites) takeBite(food);
        if (u.bites >= u.nBites && u.eaten >= u.dur) finishEating();
      } else setMode('idle');
      break;
    }
    case 'sleep': {
      S.eyesClosed = 1; S.sleep = true; S.blush = 0.25;
      if (t - lastZ > 1.8) { lastZ = t; floatFx(pick(['z', 'Z', 'z z']), 'z'); }
      break;
    }
    case 'swallow': {
      // facing the tab, mouth wide open; while sucking it in, it leans in and puffs up a little
      S.turn = WALK_YAW[swallowDir] * 0.85;
      S.mouthOpen = 1;
      S.eyesClosed = swallowPhase === 'suck' ? 0.6 : 0;
      if (swallowPhase === 'suck') {
        swallowT += dt;
        S.lunge = -0.06 - Math.sin(swallowT * 18) * 0.02;   // straining forward
        S.sniff = true;
      } else {
        S.lunge = Math.sin(S.modeT * 6) * 0.03;             // getting ready...
      }
      break;
    }
    case 'drink': {
      S.turn = 0;
      const m = S.modeT;
      if (bottle && m < 1) placeBottle();        // settle the spout at its mouth while it turns
      if (m > 0.5 && m < drinkEnd) {
        // lick lick lick at the ball valve, eyes half shut
        const ph = (m - 0.5) * 9;
        const lk = Math.max(0, Math.sin(ph));
        S.mouthOpen = 0.18 + lk * 0.3;
        S.lunge = -lk * 0.02;
        S.eyesClosed = 0.5;
        S.sniff = true;
        if (Math.floor(ph / (Math.PI * 2)) > lastLick) {
          lastLick = Math.floor(ph / (Math.PI * 2));
          Sounds.lick();
          if (++licks % 3 === 0 && bottle) {  // glug: a bubble goes up and the water drops a smidge
            bottle.userData.bubble();
            if (Math.random() < 0.6) setTimeout(() => bottle?.userData.bubble(), 120);
            bottle.userData.setLevel(bottle.userData.level - 0.015);
            Sounds.bloop();
          }
        }
      } else { S.mouthOpen = 0; S.lunge = 0; S.eyesClosed = 0; S.sniff = false; }
      if (m > drinkEnd + 0.35) {
        setMode('idle');
        nextIdle = rand(2, 4);
        bumpHappy(4);
        if (Math.random() < 0.4) hearts(1);
      }
      break;
    }
    case 'held': {
      S.held = true;
      S.eyesClosed = Math.sin(t * 1.7) > 0.93 ? 1 : 0; // the occasional nervous squint
      break;
    }
    case 'petted': {
      S.eyesClosed = 1;
      break;
    }
  }
  if (S.mode !== 'popcorn') { S.jump *= 0.8; S.spin *= 0.8; }
  biteT += dt;
  if (S.mode !== 'swallow' && S.mode !== 'drink') S.lunge = S.mode === 'eat' && biteT < 0.28 ? Math.sin((biteT / 0.28) * Math.PI) * 0.1 : 0;
  // crunchy chewing sound while it's actually eating (stops while you hold it); quieter for hay
  const eatingFood = S.mode === 'eat' && !!food && S.modeT > 0.35;
  const nibblingHay = S.mode === 'idle' && hay > 0 && S.chew;
  const chewing = eatingFood ? 'food' : nibblingHay ? 'hay' : '';
  if (chewing !== chewOn) { chewOn = chewing; if (chewing) Sounds.chewStart(chewing === 'hay' ? 0.3 : 0.8); else Sounds.chewStop(); }
  S.hay = (S.mode === 'idle' || S.mode === 'petted' || S.mode === 'walk' || S.mode === 'follow') ? hay : 0;
  updateCrumbs(dt);
  updateBottle(dt);

  // pendulum swing while dangling
  swayV += (-42 * sway - 3.2 * swayV) * dt;
  swingV += (-30 * swing - 3.5 * swingV) * dt;
  sway = clamp(sway + swayV * dt, -0.9, 0.9);
  swing = clamp(swing + swingV * dt, -0.5, 0.5);
  S.sway = sway + (S.mode === 'held' ? Math.sin(t * 4.5) * 0.06 : 0);
  S.holdYaw = CAM_YAW; // face you while dangling
  S.swing = swing;
  // shake itself off after being put down
  const sh = t - shakeAt;
  S.shake = shakeAt > 0 && sh > 0 && sh < 0.9 ? Math.sin((sh / 0.9) * Math.PI) : 0;
  if (shakeAt > 0 && sh > 0.9) shakeAt = -1;
  if (S.mode !== 'petted' && S.mode !== 'sleep' && S.mode !== 'idle') S.blush = 0;

  updateLook(dt);
  // zoom out a little while dangling so the whole guinea pig fits in the window
  camHold += ((S.mode === 'held' ? 1 : 0) - camHold) * (1 - Math.exp(-dt * 6));
  pig.animate(t, dt, S);
  // a bigger guinea pig gets a bigger window, so pull the camera back to match (main grows the window)
  const rs = Math.max(1, Math.min(1.6, config.size || 1));
  const look = tmpL.copy(LOOK_AT).multiplyScalar(rs);
  camera.position.copy(CAM_BASE).multiplyScalar(rs).sub(look).multiplyScalar((1 + camHold * 0.22) * camFit).add(look).add(tmpV.set(0, camHold * 0.15 * rs, 0));
  camera.lookAt(look.x, look.y + camHold * 0.2 * rs, look.z);
  fitCamera(dt);

  // keep speech bubble above the head
  const hp = headScreenPos(0.85);
  bubbleEl.style.left = `${clamp(hp.x, 60, window.innerWidth - 60)}px`;
  bubbleEl.style.top = `${clamp(hp.y, 34, window.innerHeight)}px`;
}

// ---------- loop (30fps when calm, 60 when active, to stay light on CPU) ----------
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  const calm = S.mode === 'sleep' || (S.mode === 'idle' && !hovering);
  const minStep = calm ? 1 / 30 : 1 / 60;
  if (acc < minStep - 0.002) return;
  update(acc);
  acc = 0;
  renderer.render(scene, camera);
}

setInterval(saveStatsSoon, 15000);

// ---------- boot ----------
(async () => {
  const saved = await api.getConfig();
  rebuild(saved?.config);
  if (saved?.stats) {
    stats = { ...stats, ...saved.stats };
    const mins = (Date.now() - (stats.lastSeen || Date.now())) / 60000;
    stats.hunger = clamp(stats.hunger - mins * 5, Math.min(stats.hunger, 25), 100); // 5% per minute while closed
    stats.happiness = clamp(stats.happiness - mins / 10, Math.min(stats.happiness, 40), 100);
    stats.sleeping = false;
  }
  setTimeout(() => say(`${pick(['wheek!', 'hi!', 'hello!'])} ${stats.hunger < 30 ? '🥕?' : '💛'}`), 900);
  requestAnimationFrame(frame);
  if (new URLSearchParams(location.search).has('debug')) window.__S = { S, stats, feed, goSleep, wake, popcorn, setMode, startFollow, startDrink, startWalk, fakeTyping: (sec) => { lastTypingAt = t + sec; }, get pig() { return pig; } };
})();
