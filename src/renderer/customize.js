// Customizer window: live 3D preview + all the options.
import * as THREE from 'three';
import { buildGuineaPig, makeStage, DEFAULT_CONFIG, DEFAULT_DISTRACTIONS, mergeConfig, PATTERNS, HAIRS, ACCESSORIES } from '../shared/guineapig.js';
import { Sounds } from '../shared/sounds.js';
import { getApi } from '../shared/api.js';

const api = getApi();
const $ = (s) => document.querySelector(s);

const FUR = [
  ['Ginger', '#c9772f'], ['Golden', '#d99a4e'], ['Red', '#b5562c'], ['Buff', '#e3b27a'], ['Cream', '#f0d9b0'], ['Beige', '#d6bf9e'],
  ['Agouti', '#8a6a43'], ['Chocolate', '#5b3a29'], ['Black', '#2a2220'], ['Slate', '#7d7f86'], ['Lilac', '#b9a7a0'],
  ['White', '#f6efe4'],
];
const LIGHT = [['White', '#f6efe4'], ['Snow', '#ffffff'], ['Ivory', '#f3e6cc'], ['Cream', '#eed6ad'], ['Pale grey', '#dcdad6']];
const EYES = [['Black', '#1a1210'], ['Dark brown', '#3e2416'], ['Ruby', '#5a0f17'], ['Pink-red', '#b8323f'], ['Blue-grey', '#46586b']];
const SKIN = [['Pink', '#f0a9a2'], ['Rosy', '#e98f8f'], ['Peach', '#f3b99a'], ['Dark', '#5e4440'], ['Grey', '#8c7f7d']];
const ACC_COLORS = [['Coral', '#e2557a'], ['Sky', '#5aa9e6'], ['Mint', '#5cc8a0'], ['Lemon', '#f2c14e'], ['Lavender', '#a98be0'], ['Red', '#d63a3a'], ['Ink', '#2b2730']];

const PRESETS = [
  { name: 'Peanut', coat: { pattern: 'dutch', hair: 'smooth', base: '#c9772f', patch: '#3b2a24', white: '#f4f1ec', eye: '#140d0b', skin: '#e9aaa4', chonk: 1 }, accessory: 'none' },
  { name: 'Marshmallow', coat: { pattern: 'himalayan', hair: 'smooth', base: '#f6efe4', patch: '#3b2a26', white: '#ffffff', eye: '#b8323f', skin: '#5e4440', chonk: 1.08 }, accessory: 'bow', accessoryColor: '#5aa9e6' },
  { name: 'Cinnamon', coat: { pattern: 'tortoise', hair: 'abyssinian', base: '#b5562c', patch: '#2a2220', white: '#f6efe4', eye: '#1a1210', skin: '#f0a9a2', chonk: 1 }, accessory: 'flowers', accessoryColor: '#ff8fb1' },
  { name: 'Biscuit', coat: { pattern: 'solid', hair: 'teddy', base: '#e3b27a', patch: '#8a6a43', white: '#f3e6cc', eye: '#3e2416', skin: '#f3b99a', chonk: 1.22 }, accessory: 'partyhat', accessoryColor: '#e2557a' },
  { name: 'Duchess', coat: { pattern: 'tricolor', hair: 'long', base: '#d99a4e', patch: '#2a2220', white: '#f6efe4', eye: '#1a1210', skin: '#f0a9a2', chonk: 1 }, accessory: 'crown', accessoryColor: '#a98be0' },
  { name: 'Oreo', coat: { pattern: 'dutch', hair: 'smooth', base: '#2a2220', patch: '#2a2220', white: '#ffffff', eye: '#1a1210', skin: '#e98f8f', chonk: 1.05 }, accessory: 'glasses', accessoryColor: '#2b2730' },
  { name: 'Pepper', coat: { pattern: 'roan', hair: 'smooth', base: '#7d7f86', patch: '#2a2220', white: '#ffffff', eye: '#1a1210', skin: '#8c7f7d', chonk: 0.95 }, accessory: 'tophat', accessoryColor: '#d63a3a' },
];

const PATCH_HINT = {
  solid: '(not used by Solid)', dutch: '(patches around the eyes)', himalayan: '(nose, ears & feet)', tricolor: '(third patch color)',
  bicolor: '(the other half)', tortoise: '(second patch color)', roan: '(head color)', agouti: '(fur tips)',
};

let cfg = mergeConfig(DEFAULT_CONFIG, null);
let original = null;

// ---------- preview ----------
const canvas = $('#preview');
const { renderer, scene, camera } = makeStage(canvas, { fov: 28 });
camera.position.set(0, 2.3, 6.6);
camera.lookAt(0, 0.85, 0);
let pig = null;
let spin = 0.75, spinVel = 0, dragX = null, autoSpin = true;
window.__setSpin = (a) => { spin = a; autoSpin = false; spinVel = 0; };
let jumpT = -1;
const anim = { lookYaw: 0, lookPitch: 0, blush: 0 };

function resize() {
  const r = canvas.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);

let rebuildTimer = null;
function rebuild(immediate = false) {
  if (typeof renderLooks === 'function' && cfg) queueMicrotask(() => renderLooks());
  const go = () => {
    if (pig) { scene.remove(pig.object); pig.dispose(); }
    pig = buildGuineaPig(cfg);
    pig.object.rotation.y = spin;
    scene.add(pig.object);
    api.previewConfig(cfg);
  };
  clearTimeout(rebuildTimer);
  if (immediate) go(); else rebuildTimer = setTimeout(go, 40);
}

canvas.addEventListener('pointerdown', (e) => { dragX = e.clientX; autoSpin = false; canvas.setPointerCapture(e.pointerId); canvas.dataset.moved = '0'; });
canvas.addEventListener('pointermove', (e) => {
  if (dragX === null) return;
  const dx = e.clientX - dragX;
  if (Math.abs(dx) > 2) canvas.dataset.moved = '1';
  spin += dx * 0.012;
  spinVel = dx * 0.012;
  dragX = e.clientX;
});
canvas.addEventListener('pointerup', () => {
  dragX = null;
  if (canvas.dataset.moved !== '1') { jumpT = 0; Sounds.enabled = cfg.settings.sound !== false; Sounds.wheek(2); }
  setTimeout(() => { autoSpin = true; }, 2500);
});

let t = 0, last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  if (!pig) return;
  if (dragX === null) {
    spin += spinVel;
    spinVel *= 0.92;
    if (autoSpin) spin += dt * 0.35;
  }
  pig.object.rotation.y = spin;
  let jump = 0, eyes = 0;
  if (jumpT >= 0) {
    jumpT += dt;
    const p = jumpT / 0.55;
    if (p <= 1) { jump = Math.sin(Math.PI * p) * 0.5; eyes = 0.7; } else jumpT = -1;
  }
  // glance at the viewer when facing roughly forward
  const facing = Math.atan2(Math.sin(-spin), Math.cos(-spin));
  anim.lookYaw = Math.max(-0.9, Math.min(0.9, facing));
  pig.animate(t, dt, { lookYaw: anim.lookYaw, lookPitch: 0.08, jump, eyesClosed: eyes, blush: jump ? 1 : 0.3, sniff: Math.sin(t * 0.7) > 0.8 });
  renderer.render(scene, camera);
}

// ---------- controls ----------
function get(path) { return path.split('.').reduce((o, k) => o?.[k], cfg); }
function set(path, v) {
  const keys = path.split('.');
  let o = cfg;
  keys.slice(0, -1).forEach((k) => { o = o[k]; });
  o[keys.at(-1)] = v;
}

function chips(el, options, path) {
  el.innerHTML = '';
  for (const [value, label] of options) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = label;
    b.dataset.value = value;
    b.onclick = () => { set(path, value); refresh(); rebuild(); };
    el.appendChild(b);
  }
}

const swatchSets = {
  'coat.base': FUR, 'coat.patch': FUR, 'coat.white': LIGHT, 'coat.eye': EYES, 'coat.skin': SKIN, accessoryColor: ACC_COLORS,
};
function buildSwatches() {
  document.querySelectorAll('.swatches').forEach((el) => {
    const path = el.dataset.key;
    el.innerHTML = '';
    for (const [label, hex] of swatchSets[path]) {
      const b = document.createElement('button');
      b.className = 'sw';
      b.title = label;
      b.style.background = hex;
      b.dataset.hex = hex;
      b.onclick = () => { set(path, hex); refresh(); rebuild(); };
      el.appendChild(b);
    }
    const custom = document.createElement('label');
    custom.className = 'custom-color';
    custom.title = 'Pick any color';
    const input = document.createElement('input');
    input.type = 'color';
    input.oninput = () => { set(path, input.value); refresh(); rebuild(); };
    custom.appendChild(input);
    el.appendChild(custom);
  });
}

function refresh() {
  $('#name').value = cfg.name;
  document.querySelectorAll('#pattern .chip').forEach((b) => b.classList.toggle('on', b.dataset.value === cfg.coat.pattern));
  document.querySelectorAll('#hair .chip').forEach((b) => b.classList.toggle('on', b.dataset.value === cfg.coat.hair));
  document.querySelectorAll('#accessory .chip').forEach((b) => b.classList.toggle('on', b.dataset.value === cfg.accessory));
  document.querySelectorAll('.swatches').forEach((el) => {
    const cur = (get(el.dataset.key) || '').toLowerCase();
    let matched = false;
    el.querySelectorAll('.sw').forEach((b) => { const on = b.dataset.hex.toLowerCase() === cur; b.classList.toggle('on', on); matched ||= on; });
    const input = el.querySelector('input[type=color]');
    input.value = cur || '#000000';
    el.querySelector('.custom-color').classList.toggle('sw', false);
    el.querySelector('.custom-color').style.outline = matched ? '' : `3px solid ${cur}`;
  });
  const usesPatch = cfg.coat.pattern !== 'solid';
  $('#patchGroup').style.opacity = usesPatch ? 1 : 0.45;
  $('#patchHint').textContent = PATCH_HINT[cfg.coat.pattern] || '';
  $('[data-key="accessoryColor"]').style.display = cfg.accessory === 'none' ? 'none' : '';
  $('#chonk').value = cfg.coat.chonk;
  $('#size').value = cfg.size;
  document.querySelectorAll('[data-setting]').forEach((i) => { const k = i.dataset.setting; i.checked = (k === 'startAtLogin' || k === 'typingNibble') ? !!cfg.settings[k] : cfg.settings[k] !== false; });
}

function buildPresets() {
  const el = $('#presets');
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.className = 'preset';
    const dot = document.createElement('i');
    const second = p.coat.pattern === 'himalayan' ? p.coat.patch : p.coat.white;
    dot.style.background = `linear-gradient(135deg, ${p.coat.base} 50%, ${second} 50%)`;
    b.append(dot, p.name);
    b.onclick = () => {
      cfg = mergeConfig(cfg, { ...structuredClone(p), coat: { ...p.coat, seed: cfg.coat.seed } });
      if (!p.accessoryColor) cfg.accessoryColor = DEFAULT_CONFIG.accessoryColor;
      refresh();
      rebuild();
    };
    el.appendChild(b);
  }
}

function surprise() {
  const pickFrom = (a) => a[Math.floor(Math.random() * a.length)];
  const base = pickFrom(FUR)[1];
  let patch = pickFrom(FUR)[1];
  if (patch === base) patch = '#2a2220';
  cfg.coat = {
    ...cfg.coat,
    pattern: pickFrom(PATTERNS)[0],
    hair: pickFrom(HAIRS)[0],
    base, patch,
    white: pickFrom(LIGHT)[1],
    eye: Math.random() < 0.8 ? '#1a1210' : pickFrom(EYES)[1],
    skin: pickFrom(SKIN)[1],
    seed: Math.floor(Math.random() * 1000),
    chonk: +(0.9 + Math.random() * 0.3).toFixed(2),
  };
  cfg.accessory = Math.random() < 0.6 ? pickFrom(ACCESSORIES)[0] : 'none';
  cfg.accessoryColor = pickFrom(ACC_COLORS)[1];
  refresh();
  rebuild();
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1400);
}

// ---------- saved looks ("outfits") ----------
// A look is everything about how the guinea pig looks (not its name or settings).
const LOOK_KEYS = ['coat', 'accessory', 'accessoryColor', 'size'];
const lookOf = (c) => structuredClone({ coat: c.coat, accessory: c.accessory, accessoryColor: c.accessoryColor, size: c.size });
const sameLook = (a, b) => JSON.stringify(lookOf(a)) === JSON.stringify(lookOf(b));
const looks = () => (cfg.looks ||= []);
const ACC_NAMES = Object.fromEntries(ACCESSORIES);
const PAT_NAMES = Object.fromEntries(PATTERNS);

// saved looks are stored right away (no need to press Save), without saving any other unsaved edits
function persistLooks() {
  original = { ...structuredClone(original || cfg), looks: structuredClone(looks()) };
  api.saveConfig(original);
  api.previewConfig(cfg); // keep showing what you're currently editing
}

function renderLooks() {
  const el = $('#lookList');
  el.textContent = '';
  if (!looks().length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No saved looks yet. Dress up your guinea pig, name the look, and save it here!';
    el.appendChild(p);
    return;
  }
  for (const l of looks()) {
    const row = document.createElement('div');
    const worn = sameLook(l, cfg);
    row.className = 'look' + (worn ? ' on' : '');
    const dot = document.createElement('i');
    const second = l.coat.pattern === 'himalayan' ? l.coat.patch : l.coat.pattern === 'solid' ? l.coat.base : l.coat.white;
    dot.style.background = `linear-gradient(135deg, ${l.coat.base} 50%, ${second} 50%)`;
    const name = document.createElement('div');
    name.className = 'lname';
    name.textContent = l.name;
    const small = document.createElement('small');
    small.textContent = [PAT_NAMES[l.coat.pattern], l.accessory !== 'none' ? ACC_NAMES[l.accessory] : null].filter(Boolean).join(' · ');
    name.appendChild(small);
    const equip = document.createElement('button');
    equip.className = 'equip';
    equip.textContent = worn ? 'Wearing' : 'Equip';
    equip.onclick = () => { if (!worn) equipLook(l); };
    const del = document.createElement('button');
    del.className = 'del';
    del.title = 'Delete this look';
    del.textContent = '🗑';
    del.onclick = () => {
      if (!confirm(`Delete the look "${l.name}"?`)) return;
      cfg.looks = looks().filter((x) => x.id !== l.id);
      persistLooks();
      renderLooks();
      toast(`Deleted "${l.name}"`);
    };
    row.append(dot, name, equip, del);
    el.appendChild(row);
  }
}

function saveLook() {
  const name = $('#lookName').value.trim();
  if (!name) { $('#lookName').focus(); toast('Give your look a name first ✏️'); return; }
  const existing = looks().find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    if (!confirm(`You already have a look called "${existing.name}". Replace it with this one?`)) return;
    Object.assign(existing, lookOf(cfg), { name });
  } else {
    looks().push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, ...lookOf(cfg) });
  }
  $('#lookName').value = '';
  persistLooks();
  renderLooks();
  toast(`Saved "${name}" 💾`);
}

// putting a look on applies it to your guinea pig straight away
function equipLook(l) {
  for (const k of LOOK_KEYS) cfg[k] = structuredClone(l[k]);
  original = { ...structuredClone(original || cfg), ...lookOf(l), looks: structuredClone(looks()) };
  api.saveConfig(original);
  refresh();
  rebuild();
  renderLooks();
  toast(`${cfg.name} is wearing "${l.name}" ✨`);
}

$('#lookSave').onclick = saveLook;
$('#lookName').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveLook(); });

// ---------- tabs ----------
function showTab(name) {
  if (!['look', 'focus', 'behave'].includes(name)) name = 'look';
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => { t.hidden = t.dataset.tab !== name; });
  if (name === 'focus') refreshUsage();
}
document.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });
api.onTab((t) => showTab(t));

// ---------- distraction eater ----------
const QUICK_SITES = [
  ['Instagram', 'instagram.com'], ['TikTok', 'tiktok.com'], ['YouTube', 'youtube.com'], ['X', 'x.com'], ['Reddit', 'reddit.com'],
  ['Facebook', 'facebook.com'], ['Netflix', 'netflix.com'], ['Twitch', 'twitch.tv'], ['Pinterest', 'pinterest.com'], ['Snapchat', 'snapchat.com'],
];
const QUICK_APPS = ['Discord', 'Steam', 'Roblox', 'Spotify'];
const ICON_COLORS = {
  'instagram.com': 'linear-gradient(135deg,#f58529,#dd2a7b,#8134af)', 'tiktok.com': '#111', 'youtube.com': '#ff0033', 'x.com': '#111',
  'reddit.com': '#ff4500', 'facebook.com': '#1877f2', 'netflix.com': '#e50914', 'twitch.tv': '#9146ff', 'pinterest.com': '#e60023',
  'snapchat.com': '#f2d600', discord: '#5865f2', steam: '#1b2838', roblox: '#222', spotify: '#1db954',
};
let usage = {};

const D = () => (cfg.distractions ||= structuredClone(DEFAULT_DISTRACTIONS));
const cleanDomain = (s) => String(s).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
const fmt = (sec) => { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60); return m ? `${m}m ${String(sec % 60).padStart(2, '0')}s` : `${sec}s`; };

function addItem(type, match, minutes, label) {
  const d = D();
  if (type === 'site') {
    match = cleanDomain(match);
    if (!match || !match.includes('.')) { toast('Type a website like instagram.com'); return false; }
    const root = match.split('.').slice(-2, -1)[0] || match;
    label ||= root.charAt(0).toUpperCase() + root.slice(1);
  } else {
    match = String(match).trim().replace(/\.(exe|app)$/i, '');
    if (!match) { toast('Type an app name like Discord'); return false; }
    label ||= match;
  }
  if (d.items.some((i) => i.type === type && i.match.toLowerCase() === match.toLowerCase())) { toast(`${label} is already on the list`); return false; }
  d.items.push({ id: `${label.toLowerCase().replace(/\W+/g, '-')}-${Date.now().toString(36)}`, type, match, label, minutes: Math.max(1, Math.min(600, Number(minutes) || 5)), enabled: true });
  renderDistractions();
  return true;
}

function renderDistractions() {
  const d = D();
  $('#dEnabled').checked = !!d.enabled;
  document.querySelectorAll('[name=dMode]').forEach((r) => { r.checked = r.value === (d.mode || 'visit'); });
  document.querySelectorAll('[name=dApp]').forEach((r) => { r.checked = r.value === (d.appAction || 'close'); });
  $('#dWarn').checked = d.warn !== false;
  document.querySelectorAll('.pname').forEach((e) => { e.textContent = cfg.name || 'your guinea pig'; });

  const list = $('#dList');
  list.innerHTML = '';
  if (!d.items.length) list.innerHTML = '<div class="empty">Nothing yet. Add a website or app below 👇</div>';
  for (const it of d.items) {
    const row = document.createElement('div');
    row.className = `ditem${it.enabled ? '' : ' off'}`;
    const key = it.type === 'site' ? cleanDomain(it.match) : it.match.toLowerCase();
    const u = usage[it.id];
    const used = u?.used || 0, limit = (it.minutes || 5) * 60;
    row.innerHTML = `
      <span class="dicon" style="background:${ICON_COLORS[key] || (it.type === 'site' ? '#7aa7d9' : '#a58bd6')}">${(it.label || '?').charAt(0).toUpperCase()}</span>
      <div class="dname"><input value="" spellcheck="false" /><small></small><div class="bar"><i style="width:${Math.min(100, (used / limit) * 100)}%"></i></div></div>
      <label class="dmin"><input type="number" min="1" max="600" /> min</label>
      <label class="switch mini" title="On/off"><input type="checkbox" /><span></span></label>
      <button class="xbtn" title="Remove">✕</button>`;
    const [nameIn, minIn, onIn] = row.querySelectorAll('input');
    nameIn.value = it.label;
    row.querySelector('small').textContent = `${it.type === 'site' ? it.match : 'App'} · ${used ? `${fmt(used)} used` : 'not used yet'}`;
    minIn.value = it.minutes;
    onIn.checked = !!it.enabled;
    nameIn.oninput = () => { it.label = nameIn.value || it.match; };
    minIn.onchange = () => { it.minutes = Math.max(1, Math.min(600, Number(minIn.value) || 5)); minIn.value = it.minutes; };
    onIn.onchange = () => { it.enabled = onIn.checked; row.classList.toggle('off', !it.enabled); };
    row.querySelector('.xbtn').onclick = () => { d.items = d.items.filter((x) => x !== it); renderDistractions(); };
    list.appendChild(row);
  }

  const quick = $('#dQuick');
  quick.innerHTML = '<span>Quick add:</span>';
  const has = (type, m) => d.items.some((i) => i.type === type && i.match.toLowerCase() === m.toLowerCase());
  for (const [label, dom] of QUICK_SITES) {
    if (has('site', dom)) continue;
    const b = document.createElement('button');
    b.textContent = `+ ${label}`;
    b.onclick = () => addItem('site', dom, $('#dMin').value, label);
    quick.appendChild(b);
  }
  for (const a of QUICK_APPS) {
    if (has('app', a)) continue;
    const b = document.createElement('button');
    b.textContent = `+ ${a} app`;
    b.onclick = () => addItem('app', a, $('#dMin').value, a);
    quick.appendChild(b);
  }
}

async function refreshUsage() {
  try { usage = (await api.getUsage()) || {}; } catch { usage = {}; }
  if (!$('[data-tab=focus].tab').hidden) renderDistractions();
}
setInterval(() => { if (!$('[data-tab=focus].tab').hidden && document.activeElement?.tagName !== 'INPUT') refreshUsage(); }, 3000);

$('#dEnabled').onchange = (e) => { D().enabled = e.target.checked; if (e.target.checked) toast('Remember to press Save 💾'); };
document.querySelectorAll('[name=dMode]').forEach((r) => { r.onchange = () => { D().mode = r.value; }; });
document.querySelectorAll('[name=dApp]').forEach((r) => { r.onchange = () => { D().appAction = r.value; }; });
$('#dWarn').onchange = (e) => { D().warn = e.target.checked; };
$('#dType').onchange = () => { $('#dMatch').placeholder = $('#dType').value === 'site' ? 'e.g. instagram.com' : 'e.g. Discord'; };
const doAdd = () => { if (addItem($('#dType').value, $('#dMatch').value, $('#dMin').value)) $('#dMatch').value = ''; };
$('#dAdd').onclick = doAdd;
$('#dMatch').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
$('#dTest').onclick = () => api.testEat(cfg);
$('#capBtn').onclick = () => api.requestScreenPermission();

// ---------- wire up ----------
chips($('#pattern'), PATTERNS, 'coat.pattern');
chips($('#hair'), HAIRS, 'coat.hair');
chips($('#accessory'), ACCESSORIES, 'accessory');
buildSwatches();
buildPresets();

$('#name').addEventListener('input', (e) => { cfg.name = e.target.value || 'Piggy'; api.previewConfig(cfg); });
$('#chonk').addEventListener('input', (e) => { cfg.coat.chonk = +e.target.value; rebuild(); });
$('#size').addEventListener('input', (e) => { cfg.size = +e.target.value; rebuild(); });
$('#reshuffle').onclick = () => { cfg.coat.seed = Math.floor(Math.random() * 1000); rebuild(); };
$('#random').onclick = surprise;
document.querySelectorAll('[data-setting]').forEach((i) => {
  i.addEventListener('change', () => { cfg.settings[i.dataset.setting] = i.checked; });
});
if (navigator.userAgent.includes('Linux')) $('#loginToggle').style.display = 'none';
$('#save').onclick = () => {
  if (!cfg.name.trim()) cfg.name = 'Piggy';
  api.saveConfig(cfg);
  original = structuredClone(cfg);
  toast(`Saved! ${cfg.name} loves it 💛`);
  setTimeout(() => api.closeCustomizer(), 900);
};
$('#cancel').onclick = () => { if (original) api.previewConfig(original); api.closeCustomizer(); };
api.onConfig((c) => {
  if (c?.looks) {
    cfg.looks = structuredClone(c.looks);
    if (original) original.looks = structuredClone(c.looks);
    if (c.lookEquipped) { for (const k of LOOK_KEYS) { cfg[k] = structuredClone(c[k]); if (original) original[k] = structuredClone(c[k]); } refresh(); rebuild(); }
    renderLooks();
  }
  if (c?.settings) { cfg.settings = { ...cfg.settings, ...c.settings }; refresh(); }
  if (c?.distractions && c.distractions.enabled !== D().enabled) { D().enabled = c.distractions.enabled; renderDistractions(); }
});

(async () => {
  const saved = await api.getConfig();
  cfg = mergeConfig(DEFAULT_CONFIG, saved?.config);
  original = structuredClone(cfg);
  refresh();
  renderDistractions();
  renderLooks();
  try {
    const info = await api.getDistractionInfo();
    $('#macNote').hidden = info.platform !== 'darwin';
    $('#capNote').style.display = info.canCapture ? 'none' : '';
    $('#capBtn').style.display = info.canCapture ? 'none' : '';
    $('#linuxNote').hidden = info.platform !== 'linux';
  } catch { /* ignore */ }
  showTab(location.hash.replace('#', ''));
  resize();
  rebuild(true);
  requestAnimationFrame(loop);
})();
