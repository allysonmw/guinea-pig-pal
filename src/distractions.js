// Tracks time spent on distracting sites/apps and decides when the guinea pig eats them.
const { EventEmitter } = require('events');

// Extra words to look for in window titles (Windows can't read browser URLs without extensions).
const TITLE_HINTS = {
  'instagram.com': ['instagram'],
  'tiktok.com': ['tiktok'],
  'youtube.com': ['youtube'],
  'x.com': ['/ x', ' on x:', '(x)', 'twitter'],
  'twitter.com': ['twitter', '/ x'],
  'reddit.com': ['reddit', ' r/'],
  'facebook.com': ['facebook'],
  'netflix.com': ['netflix'],
  'twitch.tv': ['twitch'],
  'pinterest.com': ['pinterest'],
  'snapchat.com': ['snapchat'],
  'discord.com': ['discord'],
  'threads.net': ['threads'],
  'hulu.com': ['hulu'],
  'disneyplus.com': ['disney+'],
  'roblox.com': ['roblox'],
  'tumblr.com': ['tumblr'],
};

const VISIT_RESET_MS = 5 * 60 * 1000; // per-visit mode: a 5 minute break resets the timer

function normDomain(s) {
  return String(s || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}
function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}
function titleWords(item) {
  const d = normDomain(item.match);
  const words = new Set(TITLE_HINTS[d] || []);
  const root = d.split('.')[0];
  if (root.length >= 4) words.add(root);
  if (item.label && item.label.length >= 4) words.add(item.label.toLowerCase());
  return [...words];
}

function matchItem(info, items) {
  const title = (info.title || '').toLowerCase();
  const app = (info.app || '').toLowerCase();
  const host = hostOf(info.url);
  for (const item of items) {
    if (!item.enabled) continue;
    if (item.type === 'site') {
      if (!info.isBrowser) continue;
      const d = normDomain(item.match);
      if (host) {
        if (host === d || host.endsWith('.' + d)) return item;
      } else if (title && titleWords(item).some((w) => title.includes(w))) {
        return item;
      }
    } else {
      const m = String(item.match || item.label || '').toLowerCase().replace(/\.exe$|\.app$/, '').trim();
      if (!m) continue;
      if (app === m || app.includes(m) || (!info.isBrowser && title.includes(m))) return item;
    }
  }
  return null;
}

class DistractionTracker extends EventEmitter {
  constructor({ foreground, getConfig, getUsage, saveUsage, ownAppNames = [] }) {
    super();
    this.fg = foreground;
    this.getConfig = getConfig;
    this.usage = getUsage() || { date: '', items: {} };
    this.saveUsage = saveUsage;
    this.ownAppNames = ownAppNames.map((s) => s.toLowerCase());
    this.pausedUntil = 0;
    this.busy = false;
    this.last = Date.now();
    this.timer = null;
    this.current = null;
  }

  start() {
    this.timer = setInterval(() => this.tick().catch(() => {}), 1500);
  }
  stop() { clearInterval(this.timer); this.fg.stop(); }
  pause(minutes) { this.pausedUntil = Date.now() + minutes * 60000; }
  resume() { this.pausedUntil = 0; }
  isPaused() { return Date.now() < this.pausedUntil; }
  setBusy(b) { this.busy = b; }

  today() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  usageSnapshot() {
    const cfg = this.getConfig()?.distractions;
    const out = {};
    for (const it of cfg?.items || []) {
      const u = this.usage.items[it.id];
      out[it.id] = { used: Math.round(u?.used || 0), limit: Math.round((it.minutes || 5) * 60) };
    }
    return out;
  }

  resetItem(id) { delete this.usage.items[id]; }

  async tick() {
    const now = Date.now();
    const dt = Math.min(now - this.last, 3500) / 1000;
    this.last = now;
    const cfg = this.getConfig()?.distractions;
    if (!cfg?.enabled || this.isPaused() || this.busy) { this.current = null; return; }

    if (this.usage.date !== this.today()) this.usage = { date: this.today(), items: {} };
    if (cfg.mode !== 'day') {
      for (const u of Object.values(this.usage.items)) {
        if (now - (u.lastSeen || 0) > VISIT_RESET_MS) { u.used = 0; u.warned = false; }
      }
    }

    const info = await this.fg.poll();
    if (!info) { this.current = null; return; }
    if (this.ownAppNames.some((n) => (info.app || '').toLowerCase().includes(n))) return;

    const item = matchItem(info, cfg.items || []);
    this.current = item ? { item, info } : null;
    if (!item) return;

    const u = (this.usage.items[item.id] ||= { used: 0, lastSeen: 0, warned: false, lastEat: 0 });
    u.used += dt;
    u.lastSeen = now;
    // GP_FAST=1 (VS Code test config): minutes count as seconds so you can test quickly
    const limit = Math.max(0.25, Number(item.minutes) || 5) * (process.env.GP_FAST ? 1 : 60);
    const remaining = limit - u.used;

    if (cfg.warn !== false && limit > (process.env.GP_FAST ? 15 : 90) && remaining <= (process.env.GP_FAST ? 5 : 60) && remaining > 10 && !u.warned) {
      u.warned = true;
      this.emit('warn', { item, seconds: Math.ceil(remaining) });
    }
    if (remaining <= 10 && remaining > 0) this.emit('countdown', { item, seconds: Math.ceil(remaining) });
    if (remaining <= 0 && now - (u.lastEat || 0) > 8000) {
      const repeat = cfg.mode === 'day' && u.lastEat > 0;
      u.lastEat = now;
      if (cfg.mode !== 'day') { u.used = 0; u.warned = false; }
      this.emit('eat', { item, info, repeat });
    }
    this.saveUsage(this.usage);
  }
}

module.exports = { DistractionTracker, matchItem, normDomain };
