// Full-screen overlay: the distracting tab gets sucked into the guinea pig's mouth like a funnel.
import { Sounds } from '../shared/sounds.js';
import { getApi } from '../shared/api.js';

const api = getApi();
const canvas = document.getElementById('meal');
const ctx = canvas.getContext('2d');
const dpr = Math.min(window.devicePixelRatio || 1, 2);

const PREP = 0.55;      // getting ready (the tab wobbles toward the mouth)
const SWALLOW = 1.45;   // being sucked in
const STRIPS = 150;     // how many vertical strips the tab is cut into

let run = null;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smoothstep = (x) => x * x * (3 - 2 * x);

function layout() {
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
}

// ---------- fallback "tab" picture when we can't take a screenshot ----------
const BRANDS = {
  'instagram.com': { bg: ['#f58529', '#dd2a7b', '#8134af'], fg: '#fff' },
  'tiktok.com': { bg: ['#010101', '#161616'], fg: '#fff', glow: ['#25f4ee', '#fe2c55'] },
  'youtube.com': { bg: ['#ff0033', '#cc0000'], fg: '#fff' },
  'x.com': { bg: ['#000', '#111'], fg: '#fff' },
  'twitter.com': { bg: ['#1d9bf0', '#0c7abf'], fg: '#fff' },
  'reddit.com': { bg: ['#ff4500', '#e03d00'], fg: '#fff' },
  'facebook.com': { bg: ['#1877f2', '#0f5fcc'], fg: '#fff' },
  'netflix.com': { bg: ['#141414', '#000'], fg: '#e50914' },
  'twitch.tv': { bg: ['#9146ff', '#6b2fd6'], fg: '#fff' },
  'pinterest.com': { bg: ['#e60023', '#b8001c'], fg: '#fff' },
  'snapchat.com': { bg: ['#fffc00', '#f5e900'], fg: '#111' },
  'discord.com': { bg: ['#5865f2', '#4752c4'], fg: '#fff' },
};
function brandFor(match, label) {
  const d = String(match || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  if (BRANDS[d]) return BRANDS[d];
  let h = 0;
  for (const ch of String(label)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return { bg: [`hsl(${h},70%,55%)`, `hsl(${(h + 30) % 360},70%,45%)`], fg: '#fff' };
}

function drawCard({ label, match, type }) {
  const w = 1200, h = 800;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  const b = brandFor(match, label);
  x.fillStyle = '#ffffff';
  x.beginPath(); x.roundRect(0, 0, w, h, 28); x.fill();
  // window chrome
  x.fillStyle = '#ebe7e3';
  x.beginPath(); x.roundRect(0, 0, w, 120, [28, 28, 0, 0]); x.fill();
  ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => { x.fillStyle = col; x.beginPath(); x.arc(40 + i * 34, 36, 11, 0, 7); x.fill(); });
  x.fillStyle = '#fff';
  x.beginPath(); x.roundRect(150, 14, 360, 46, [14, 14, 0, 0]); x.fill();
  x.fillStyle = '#4a3326'; x.font = '700 24px system-ui, sans-serif'; x.fillText(String(label).slice(0, 22), 175, 46);
  x.fillStyle = '#fff'; x.beginPath(); x.roundRect(30, 70, w - 60, 38, 19); x.fill();
  x.fillStyle = '#8a7b70'; x.font = '22px system-ui, sans-serif';
  x.fillText(type === 'site' ? `https://${String(match).replace(/^https?:\/\//, '')}` : `${label}.app`, 52, 97);
  // hero
  const g = x.createLinearGradient(0, 120, w, h);
  b.bg.forEach((col, i) => g.addColorStop(i / Math.max(1, b.bg.length - 1), col));
  x.fillStyle = g; x.fillRect(0, 120, w, h - 120);
  x.textAlign = 'center';
  x.font = '900 120px system-ui, sans-serif';
  if (b.glow) { x.fillStyle = b.glow[0]; x.fillText(label, w / 2 - 5, 420); x.fillStyle = b.glow[1]; x.fillText(label, w / 2 + 5, 426); }
  x.fillStyle = b.fg; x.fillText(label, w / 2, 423);
  x.font = '700 40px system-ui, sans-serif';
  x.globalAlpha = 0.85;
  x.fillText("⏰ time's up!", w / 2, 520);
  x.globalAlpha = 0.35;
  for (let i = 0; i < 3; i++) { x.beginPath(); x.roundRect(200 + i * 280, 590, 240, 150, 18); x.fillStyle = b.fg; x.fill(); }
  x.globalAlpha = 1;
  return c;
}

function loadImage(src) {
  return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
}

async function start(d) {
  layout();
  Sounds.enabled = d.config?.settings?.sound !== false;
  const img = d.image ? await loadImage(d.image) : null;
  let src, s;
  if (img) {
    // crop the distracting window out of the screenshot
    const k = img.naturalWidth / innerWidth;
    src = img;
    s = { x: d.rect.x * k, y: d.rect.y * k, w: d.rect.width * k, h: d.rect.height * k };
  } else {
    src = drawCard(d);
    s = { x: 0, y: 0, w: src.width, h: src.height };
  }
  run = { t: 0, d, src, s, rect: d.rect, mouth: d.mouth, ready: false, slurping: false };
}

// Draws the tab as a funnel. T: 0 = untouched, 1 = completely swallowed.
function drawFunnel(r, T, pull) {
  const R = r.rect, M = r.mouth, S = r.s;
  const nearLeft = M.x < R.x + R.width / 2;   // which side of the tab is closest to the mouth
  const pts = [];
  for (let j = 0; j <= STRIPS; j++) {
    const u = j / STRIPS;
    const dist = nearLeft ? u : 1 - u;        // 0 = edge next to the mouth, 1 = far edge
    let sq = smoothstep(clamp(T * 1.9 - dist * 0.9, 0, 1));
    sq = Math.max(sq, pull * Math.pow(1 - dist, 2));
    const colX = R.x + u * R.width;
    const v = Math.pow(sq, 0.72);
    pts.push({
      x: colX + (M.x - colX) * sq,
      top: R.y + (M.y - R.y) * v,
      bot: R.y + R.height + (M.y - (R.y + R.height)) * v,
      sq,
    });
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  ctx.imageSmoothingQuality = 'high';
  for (let j = 0; j < STRIPS; j++) {
    const a = pts[j], b = pts[j + 1];
    const x0 = Math.min(a.x, b.x);
    const w = Math.abs(b.x - a.x) + 0.8;
    const top = Math.min(a.top, b.top), bot = Math.max(a.bot, b.bot);
    const h = bot - top;
    if (h < 0.6) continue;
    ctx.drawImage(r.src, S.x + (S.w * j) / STRIPS, S.y, S.w / STRIPS + 0.6, S.h, x0, top, w, h);
    const shade = Math.max(a.sq, b.sq);
    if (shade > 0.01) {                       // darker as it squeezes into the mouth
      ctx.fillStyle = `rgba(25, 12, 18, ${(shade * 0.5).toFixed(3)})`;
      ctx.fillRect(x0, top, w, h);
    }
  }
}

let last = performance.now();
const NOCAP = new URLSearchParams(location.search).has('nocap');
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(NOCAP ? 0.5 : 0.05, (now - last) / 1000);
  last = now;
  if (!run) return;
  const r = run;
  r.t += dt;

  // once the picture covers the real window, actually close the tab/app underneath
  if (!r.ready && r.t > 0.08) { r.ready = true; api.eatReady(); }

  let T = 0, pull = 0;
  if (r.t < PREP) {
    pull = Math.sin((r.t / PREP) * Math.PI) * 0.05;          // the tab leans toward the mouth
  } else {
    if (!r.slurping) { r.slurping = true; Sounds.slurp?.(SWALLOW); }
    T = Math.min(1, Math.pow((r.t - PREP) / SWALLOW, 1.35));  // speeds up as it goes in
  }
  drawFunnel(r, T, pull);

  if (r.t > PREP + SWALLOW + 0.12) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    run = null;
    Sounds.gulp?.();
    api.eatDone();
  }
}
requestAnimationFrame(frame);

api.onEatStart((d) => start(d));
window.addEventListener('resize', layout);

// browser demo: open eat.html?demo
if (new URLSearchParams(location.search).has('demo')) {
  setTimeout(() => start({
    label: 'Instagram', match: 'instagram.com', type: 'site', image: null, config: null,
    rect: { x: innerWidth * 0.42, y: innerHeight * 0.08, width: innerWidth * 0.52, height: innerHeight * 0.78 },
    mouth: { x: innerWidth * 0.2, y: innerHeight * 0.78 },
  }), 300);
}
