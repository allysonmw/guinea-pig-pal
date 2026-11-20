// Main process: creates the transparent pet window, the customizer, the tray icon,
// and stores the guinea pig's look + stats on disk.
const { app, BrowserWindow, ipcMain, Menu, Tray, screen, powerMonitor, nativeImage, desktopCapturer, systemPreferences, Notification, shell, dialog } = require('electron');
const { createForeground } = require('./foreground');
const { DistractionTracker } = require('./distractions');
const { setupUpdates } = require('./updater');
const path = require('path');
const fs = require('fs');

let appQuitting = false;

const PET_W = 360;
const PET_H = 310;
// the window grows with the size slider so a big guinea pig still fits
function petDims(cfg = state?.config) {
  const s = Math.max(1, Math.min(1.6, cfg?.size || 1));
  return { w: Math.round(PET_W * s), h: Math.round(PET_H * s) };
}
function fitPetWindow(cfg) {
  if (!petWin) return;
  const d = petDims(cfg);
  const b = petWin.getBounds();
  if (b.width === d.w && b.height === d.h) return;
  // keep its feet where they were: grow up and out from the bottom middle
  petWin.setBounds({ x: Math.round(b.x + (b.width - d.w) / 2), y: b.y + b.height - d.h, width: d.w, height: d.h });
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let petWin = null;
let customizeWin = null;
let tray = null;
let state = null; // { config, stats, windowPos, usage }
let eatWin = null;
let tracker = null;
let eating = null;
let updates = null;

// ---------- persistence ----------
const storePath = () => path.join(app.getPath('userData'), 'guinea-pig.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(storePath(), 'utf8'));
  } catch {
    return { config: null, stats: null, windowPos: null };
  }
}
let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(storePath()), { recursive: true });
      fs.writeFileSync(storePath(), JSON.stringify(state, null, 2));
    } catch (e) {
      console.error('Could not save', e);
    }
  }, 300);
}

// ---------- windows ----------
function defaultPosition() {
  const wa = screen.getPrimaryDisplay().workArea;
  const { w, h } = petDims();
  return { x: wa.x + wa.width - w - 24, y: wa.y + wa.height - h + 20 };
}

function positionIsVisible(pos) {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    const { w, h } = petDims();
    return pos.x + w / 2 > a.x && pos.x + w / 2 < a.x + a.width && pos.y + h / 2 > a.y && pos.y + h / 2 < a.y + a.height + h;
  });
}

function createPetWindow() {
  let pos = state.windowPos && positionIsVisible(state.windowPos) ? { ...state.windowPos } : defaultPosition();
  if (state.windowPos && pos.x === state.windowPos.x) {
    // saved from a different window size (older version or another size setting): keep the feet in the same spot
    const d = petDims(), ow = state.windowPos.w || 320, oh = state.windowPos.h || 280;
    pos = { x: Math.round(pos.x + (ow - d.w) / 2), y: pos.y + oh - d.h };
  }
  const win = petWin = new BrowserWindow({
    width: petDims().w,
    height: petDims().h,
    x: pos.x,
    y: pos.y,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    backgroundColor: '#00000000',
    title: 'Guinea Pig',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  applyAlwaysOnTop();
  if (process.platform === 'darwin') petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Clicks pass through to the desktop except when the cursor is over the guinea pig.
  petWin.setIgnoreMouseEvents(true, { forward: true });
  petWin.loadFile(path.join(__dirname, 'renderer', 'pet.html'));
  petWin.on('moved', () => {
    const [x, y] = petWin.getPosition();
    const [w, h] = petWin.getSize();
    state.windowPos = { x, y, w, h };
    saveState();
  });
  // A stray Ctrl+W / Cmd+W / Alt+F4 must never close the guinea pig (only quitting the app does)
  petWin.on('close', (e) => { if (!appQuitting) e.preventDefault(); });
  petWin.on('query-session-end', () => { appQuitting = true; });   // Windows shutting down / logging off
  petWin.on('session-end', () => { appQuitting = true; });
  petWin.on('closed', () => { if (petWin === win) petWin = null; });
  // If the guinea pig hasn't been drawn shortly after loading (e.g. the graphics card wasn't ready yet
  // right after the computer started), it would just be a blank box: rebuild the window instead.
  win.webContents.on('did-finish-load', () => {
    clearTimeout(petWatchdog);
    petWatchdog = setTimeout(() => { if (petWin === win) recoverPet('never drew'); }, 15000);
  });
  win.webContents.on('render-process-gone', (_e, d) => { if (petWin === win && !appQuitting) recoverPet('renderer ' + d.reason); });
}

// ---------- blank-window recovery ----------
let petWatchdog = null, petRecoveries = 0, recoverTimer = null;
function recoverPet(why) {
  if (appQuitting || recoverTimer) return;
  if (petRecoveries >= 6) { console.warn('guinea pig: giving up recovering', why); return; }
  petRecoveries++;
  console.warn('guinea pig: rebuilding the pet window because', why);
  clearTimeout(petWatchdog);
  recoverTimer = setTimeout(() => {
    recoverTimer = null;
    const old = petWin;
    petWin = null;
    try { old?.destroy(); } catch { /* already gone */ }
    if (eatWin && !eating) { try { eatWin.destroy(); } catch { /* ignore */ } eatWin = null; }
    createPetWindow();
  }, Math.min(2000 * petRecoveries, 8000));
}
ipcMain.on('pet:alive', (e) => {
  if (petWin && e.sender === petWin.webContents) { clearTimeout(petWatchdog); petRecoveries = 0; }
});
ipcMain.on('pet:broken', (e, why) => { if (petWin && e.sender === petWin.webContents) recoverPet(why); });
app.on('child-process-gone', (_e, d) => { if (d.type === 'GPU' && !appQuitting) recoverPet('graphics process ' + d.reason); });

// started automatically when the computer turned on?
function startedAtLogin() {
  if (process.argv.includes('--at-login')) return true;
  if (process.platform === 'darwin') { try { return !!app.getLoginItemSettings().wasOpenedAtLogin; } catch { return false; } }
  return false;
}

function openCustomizer(tab) {
  if (typeof tab !== 'string') tab = '';
  if (customizeWin) { customizeWin.show(); customizeWin.focus(); if (tab) customizeWin.webContents.send('customizer:tab', tab); return; }
  customizeWin = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 820,
    minHeight: 560,
    title: 'Customize your guinea pig',
    backgroundColor: '#fff8f0',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  customizeWin.loadFile(path.join(__dirname, 'renderer', 'customize.html'), { hash: tab || '' });
  if (process.platform === 'darwin') app.dock?.show();
  customizeWin.on('closed', () => {
    customizeWin = null;
    // revert any unsaved live preview
    fitPetWindow(state.config);
    petWin?.webContents.send('config:changed', state.config);
    if (process.platform === 'darwin') app.dock?.hide();
  });
}

function applyAlwaysOnTop() {
  if (!petWin) return;
  const on = state.config?.settings?.alwaysOnTop !== false;
  petWin.setAlwaysOnTop(on, 'floating');
}

function applyLoginItem() {
  if (process.platform === 'linux') return;
  app.setLoginItemSettings({ openAtLogin: !!state.config?.settings?.startAtLogin, args: ['--at-login'] });
}

// ---------- saved looks ----------
const LOOK_KEYS = ['coat', 'accessory', 'accessoryColor', 'size'];
function isWearing(l) {
  const c = state.config || {};
  return LOOK_KEYS.every((k) => JSON.stringify(l[k] ?? null) === JSON.stringify(c[k] ?? null));
}
function equipLook(id) {
  const l = state.config?.looks?.find((x) => x.id === id);
  if (!l) return;
  for (const k of LOOK_KEYS) if (l[k] !== undefined) state.config[k] = JSON.parse(JSON.stringify(l[k]));
  saveState();
  fitPetWindow(state.config);
  petWin?.webContents.send('config:changed', state.config);
  customizeWin?.webContents.send('config:changed', { ...state.config, lookEquipped: true });
  rebuildTrayMenu();
}

function sendAction(action, payload) {
  petWin?.webContents.send('pet:action', { action, payload });
}

function setSetting(key, value) {
  state.config = state.config || {};
  state.config.settings = { ...(state.config.settings || {}), [key]: value };
  saveState();
  applyAlwaysOnTop();
  applyLoginItem();
  petWin?.webContents.send('config:changed', state.config);
  customizeWin?.webContents.send('config:changed', state.config);
  rebuildTrayMenu();
}

function buildPetMenu() {
  const s = state.config?.settings || {};
  const st = state.stats || {};
  const name = state.config?.name || 'Your guinea pig';
  const pct = (v) => `${Math.round(v ?? 0)}%`;
  return Menu.buildFromTemplate([
    { label: `${name}  ·  Full ${pct(st.hunger)}  ·  Happy ${pct(st.happiness)}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Feed',
      submenu: [
        { label: '🥕  Carrot', click: () => sendAction('feed', 'carrot') },
        { label: '🥬  Lettuce', click: () => sendAction('feed', 'lettuce') },
        { label: '🍓  Strawberry', click: () => sendAction('feed', 'strawberry') },
        { label: '🫑  Bell pepper', click: () => sendAction('feed', 'pepper') },
      ],
    },
    { label: 'Drink water', click: () => sendAction('drink') },
    { label: st.sleeping ? 'Wake up' : 'Nap time', click: () => sendAction(st.sleeping ? 'wake' : 'sleep') },
    ...(state.config?.looks?.length ? [{
      label: 'Saved looks',
      submenu: state.config.looks.map((l) => ({ label: l.name, type: 'checkbox', checked: isWearing(l), click: () => equipLook(l.id) })),
    }] : []),
    { label: 'Customize…', click: () => openCustomizer() },
    { type: 'separator' },
    {
      label: 'Distraction eater',
      submenu: [
        { label: 'On', type: 'checkbox', checked: !!state.config?.distractions?.enabled, click: (i) => setDistractionsEnabled(i.checked) },
        tracker?.isPaused()
          ? { label: 'Resume eating', click: () => { tracker.resume(); rebuildTrayMenu(); } }
          : { label: 'Pause for 15 minutes', click: () => { tracker?.pause(15); sendAction('say', 'Okay, 15 minutes off 😌'); rebuildTrayMenu(); } },
        { label: 'Pause for 1 hour', click: () => { tracker?.pause(60); sendAction('say', 'Fine… one hour 🙄'); rebuildTrayMenu(); } },
        { type: 'separator' },
        { label: 'Choose distractions & timers…', click: () => openCustomizer('focus') },
      ],
    },
    { type: 'separator' },
    { label: 'Wander around', type: 'checkbox', checked: s.wander !== false, click: (i) => setSetting('wander', i.checked) },
    { label: 'Sounds', type: 'checkbox', checked: s.sound !== false, click: (i) => setSetting('sound', i.checked) },
    { label: 'Nap when I’m away', type: 'checkbox', checked: s.sleepWhenIdle !== false, click: (i) => setSetting('sleepWhenIdle', i.checked) },
    { label: 'Always on top', type: 'checkbox', checked: s.alwaysOnTop !== false, click: (i) => setSetting('alwaysOnTop', i.checked) },
    ...(process.platform !== 'linux'
      ? [{ label: 'Start at login', type: 'checkbox', checked: !!s.startAtLogin, click: (i) => setSetting('startAtLogin', i.checked) }]
      : []),
    { label: 'Move back to corner', click: () => { const p = defaultPosition(); petWin?.setPosition(p.x, p.y); } },
    { type: 'separator' },
    { label: `Guinea Pig Pal ${app.getVersion()}`, enabled: false },
    { label: 'Check for updates…', click: () => updates?.check({ manual: true }) },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function rebuildTrayMenu() {
  if (tray) tray.setContextMenu(buildPetMenu());
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png');
  let img = nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) img = nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip('Guinea Pig');
  rebuildTrayMenu();
  tray.on('click', () => { if (process.platform !== 'darwin') petWin?.show(); });
}

function setDistractionsEnabled(on) {
  state.config = state.config || {};
  state.config.distractions = { ...(state.config.distractions || {}), enabled: on };
  if (on && !state.config.distractions.items) {
    state.config.distractions = { enabled: true, mode: 'visit', warn: true, appAction: 'close', items: [
      { id: 'instagram', type: 'site', match: 'instagram.com', label: 'Instagram', minutes: 5, enabled: true },
      { id: 'tiktok', type: 'site', match: 'tiktok.com', label: 'TikTok', minutes: 5, enabled: true },
    ] };
  }
  saveState();
  petWin?.webContents.send('config:changed', state.config);
  customizeWin?.webContents.send('config:changed', state.config);
  sendAction('say', on ? 'Distraction eater ON 🍴' : 'Okay, no snacking 😔');
  rebuildTrayMenu();
}

// ---------- distraction eating ----------
function canCaptureScreen() {
  if (process.platform === 'darwin') return systemPreferences.getMediaAccessStatus('screen') === 'granted';
  return true;
}

function ensureEatWindow(display) {
  const b = display.bounds;
  if (!eatWin) {
    eatWin = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height,
      transparent: true, frame: false, resizable: false, movable: false, hasShadow: false,
      skipTaskbar: true, focusable: false, show: false, alwaysOnTop: true,
      enableLargerThanScreen: true, backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    eatWin.setAlwaysOnTop(true, 'screen-saver');
    eatWin.setIgnoreMouseEvents(true);
    if (process.platform === 'darwin') eatWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    eatWin.loadFile(path.join(__dirname, 'renderer', 'eat.html'));
    eatWin.on('closed', () => { eatWin = null; });
  } else {
    eatWin.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  }
  return eatWin;
}

// Asks the pet window where the guinea pig's mouth is (after it turns toward the tab).
function askMouth(towardScreen) {
  return new Promise((resolve) => {
    const done = (_e, m) => { clearTimeout(timer); resolve(m); };
    const timer = setTimeout(() => { ipcMain.removeListener('pet:mouth', done); resolve(null); }, 1500);
    ipcMain.once('pet:mouth', done);
    if (!petWin) { done(null, null); return; }
    const b = petWin.getBounds();
    sendAction('swallow-prep', { x: towardScreen.x - b.x, y: towardScreen.y - b.y });
  });
}

async function eatDistraction({ item, info, repeat, config }) {
  if (eating || !petWin) return;
  eating = { item, info };
  tracker?.setBusy(true);

  // where is the distracting window? (falls back to the whole screen)
  let rect = null;
  try { rect = info ? await tracker.fg.getWindowRect(info) : null; } catch { rect = null; }
  if (rect?.physical && process.platform === 'win32') rect = screen.screenToDipRect(null, rect);
  const petB = petWin.getBounds();
  const display = rect
    ? screen.getDisplayNearestPoint({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
    : screen.getDisplayMatching(petB);
  const db = display.bounds;
  if (!rect) {
    // a test, or a window we can't measure: use a big centered "tab"
    rect = { x: db.x + db.width * 0.32, y: db.y + db.height * 0.12, width: db.width * 0.56, height: db.height * 0.72 };
  }
  // keep it on that display
  const x1 = Math.max(rect.x, db.x), y1 = Math.max(rect.y, db.y);
  const x2 = Math.min(rect.x + rect.width, db.x + db.width), y2 = Math.min(rect.y + rect.height, db.y + db.height);
  rect = { x: x1, y: y1, width: Math.max(50, x2 - x1), height: Math.max(50, y2 - y1) };

  // a picture of the screen, so the tab can be "swallowed" after it really closes
  let image = null;
  try {
    if (canCaptureScreen()) {
      const { width, height } = display.size;
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
      const src = sources.find((s) => s.display_id === String(display.id)) || sources[0];
      if (src && !src.thumbnail.isEmpty()) image = 'data:image/jpeg;base64,' + src.thumbnail.toJPEG(85).toString('base64');
    }
  } catch { image = null; }

  // the guinea pig turns toward the tab and gets ready; we need its mouth position
  const mouth = await askMouth({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  const pb = petWin?.getBounds() || petB;
  const mouthScreen = mouth ? { x: pb.x + mouth.x, y: pb.y + mouth.y } : { x: pb.x + pb.width / 2, y: pb.y + pb.height * 0.6 };

  const win = ensureEatWindow(display);
  const start = () => {
    win.showInactive();
    // the guinea pig stays in front so the tab goes INTO its mouth
    petWin?.setAlwaysOnTop(true, 'screen-saver');
    petWin?.moveTop();
    win.webContents.send('eat:start', {
      image,
      rect: { x: rect.x - db.x, y: rect.y - db.y, width: rect.width, height: rect.height },
      mouth: { x: mouthScreen.x - db.x, y: mouthScreen.y - db.y },
      label: item.label || item.match, type: item.type, match: item.match, repeat,
      config: config || state.config,
    });
    sendAction('swallow-go');
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', start); else start();

  // safety net in case the overlay never reports back
  eating.timeout = setTimeout(() => finishEating(), 12000);
}

async function closeDistraction() {
  if (!eating || eating.closed) return;
  eating.closed = true;
  const { item, info } = eating;
  try {
    if (item.type === 'site') await tracker.fg.closeTab(info);
    else await tracker.fg.closeApp(info, state.config?.distractions?.appAction === 'hide' ? 'hide' : 'close');
  } catch { /* ignore */ }
}

function finishEating() {
  if (!eating) return;
  clearTimeout(eating.timeout);
  const label = eating.item.label || eating.item.match;
  if (!eating.closed) closeDistraction();
  eating = null;
  eatWin?.hide();
  applyAlwaysOnTop();   // back to its normal layer
  petWin?.showInactive();
  sendAction('ate', label);
  setTimeout(() => tracker?.setBusy(false), 1500);
}

function startTracker() {
  tracker = new DistractionTracker({
    foreground: createForeground(),
    getConfig: () => state.config,
    getUsage: () => state.usage,
    saveUsage: (u) => { state.usage = u; saveState(); },
    ownAppNames: ['guinea pig pal', 'guinea-pig-pal', 'electron'],
  });
  tracker.on('warn', ({ item, seconds }) => {
    sendAction('distraction-warn', { label: item.label, seconds });
    if (Notification.isSupported()) {
      new Notification({ title: `${state.config?.name || 'Your guinea pig'} is getting hungry 🐹`, body: `About 1 minute left on ${item.label}, then it gets eaten!`, silent: true }).show();
    }
  });
  tracker.on('countdown', ({ item, seconds }) => sendAction('distraction-countdown', { label: item.label, seconds }));
  tracker.on('eat', (e) => eatDistraction(e));
  tracker.start();
}

// ---------- IPC ----------
ipcMain.handle('config:get', () => ({ config: state.config, stats: state.stats }));

ipcMain.on('config:save', (_e, config) => {
  const prev = state.config?.settings || {};
  const turnedOn = !prev.typingNibble && !!config.settings?.typingNibble;
  state.config = config;
  // keep the "already asked" answer even if the customizer didn't know about it
  state.config.settings = { ...config.settings, typingAsked: prev.typingAsked || config.settings?.typingAsked, typingPromptedApp: prev.typingPromptedApp };
  saveState();
  applyAlwaysOnTop();
  applyLoginItem();
  applyTypingSetting(turnedOn);
  fitPetWindow(config);
  petWin?.webContents.send('config:changed', config);
  rebuildTrayMenu();
});

ipcMain.on('config:preview', (_e, config) => {
  fitPetWindow(config);
  petWin?.webContents.send('config:changed', config);
});

ipcMain.on('stats:save', (_e, stats) => {
  state.stats = stats;
  saveState();
  rebuildTrayMenu();
});

ipcMain.on('pet:set-ignore', (_e, ignore) => {
  petWin?.setIgnoreMouseEvents(!!ignore, { forward: true });
});

ipcMain.handle('pet:move-by', (_e, dx, dy) => {
  if (!petWin) return { blocked: true };
  const [x, y] = petWin.getPosition();
  const [PW, PH] = petWin.getSize();
  const center = { x: x + PW / 2, y: y + PH / 2 };
  const disp = screen.getDisplayNearestPoint(center);
  const a = disp.workArea;
  let nx = Math.round(x + dx), ny = Math.round(y + dy);
  let blocked = false;
  const minX = a.x - PW * 0.25, maxX = a.x + a.width - PW * 0.75;
  if (nx < minX) { nx = minX; blocked = 'left'; }
  if (nx > maxX) { nx = maxX; blocked = 'right'; }
  // when moving up/down (following your mouse), stay on the screen
  let blockedY = false;
  if (dy) {
    const minY = a.y - PH * 0.35, maxY = a.y + a.height - PH + 20;
    if (ny < minY) { ny = minY; blockedY = 'top'; }
    if (ny > maxY) { ny = maxY; blockedY = 'bottom'; }
  }
  petWin.setPosition(Math.round(nx), Math.round(ny));
  return { blocked, blockedY };
});

ipcMain.on('pet:drag-to', (_e, screenX, screenY, offX, offY) => {
  petWin?.setPosition(Math.round(screenX - offX), Math.round(screenY - offY));
});

ipcMain.on('pet:context-menu', () => {
  buildPetMenu().popup({ window: petWin });
});

ipcMain.on('open-customizer', (_e, tab) => openCustomizer(tab));
ipcMain.handle('distractions:usage', () => tracker?.usageSnapshot() || {});
ipcMain.handle('distractions:current', () => {
  const c = tracker?.current;
  return { platform: process.platform, canCapture: canCaptureScreen(), current: c ? c.item.label : null };
});
ipcMain.on('distractions:reset', (_e, id) => tracker?.resetItem(id));
ipcMain.on('distractions:test', (_e, cfg) => {
  const item = { id: 'test', type: 'site', label: 'Instagram', match: 'instagram.com' };
  eatDistraction({ item, info: null, repeat: false, config: cfg });
  if (eating) eating.closed = true; // a test never closes anything
});
ipcMain.on('perm:screen', async () => {
  if (process.platform !== 'darwin') return;
  try { await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 16, height: 16 } }); } catch { /* ignore */ }
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
});
ipcMain.on('eat:ready', () => closeDistraction());
ipcMain.on('eat:done', () => finishEating());
ipcMain.on('customizer:close', () => customizeWin?.close());

// cursor + activity feed for the pet (lets it look at your mouse and notice when you're away)
function startSensors() {
  setInterval(() => {
    if (!petWin) return;
    const c = screen.getCursorScreenPoint();
    const b = petWin.getBounds();
    petWin.webContents.send('sensors', {
      cursor: { x: c.x - b.x, y: c.y - b.y },
      idleSeconds: powerMonitor.getSystemIdleTime(),
      typing: keyboard.running && Date.now() - keyboard.lastKeyAt < 1200,
    });
  }, 60);
}

// ---------- typing detection (only with your permission) ----------
// Only notices THAT a key was pressed, to make the guinea pig nibble hay.
// It never looks at or stores which keys you press.
const keyboard = { hook: null, running: false, lastKeyAt: 0, waitTimer: null };

function macTrusted(prompt) {
  return process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(prompt);
}

function startKeyboard() {
  if (keyboard.running) return;
  if (!macTrusted(false)) return;
  try {
    if (!keyboard.hook) {
      keyboard.hook = require('uiohook-napi').uIOhook;
      keyboard.hook.on('keydown', () => { keyboard.lastKeyAt = Date.now(); });
    }
    keyboard.hook.start();
    keyboard.running = true;
  } catch (e) {
    console.warn('Typing detection unavailable:', e.message);
  }
}

function stopKeyboard() {
  clearInterval(keyboard.waitTimer);
  if (keyboard.running) { try { keyboard.hook.stop(); } catch { /* ignore */ } }
  keyboard.running = false;
}

// Turn typing detection on: on a Mac this shows macOS's own permission request
// (macOS remembers the answer, so it only ever appears once).
function enableKeyboard(allowPrompt) {
  if (macTrusted(false)) { startKeyboard(); return; }
  // Only show macOS's request right after you said yes, or the very first time this
  // particular app (the test version or the installed app) runs, never again after that
  const settings = state.config?.settings || {};
  // (each new version counts as a new app to macOS, so it asks once more after an update)
  const thisApp = process.execPath + '@' + app.getVersion();
  const firstTimeForThisApp = settings.typingPromptedApp !== thisApp;
  if (allowPrompt || firstTimeForThisApp) {
    macTrusted(true);
    if (state.config?.settings) { state.config.settings.typingPromptedApp = thisApp; saveState(); }
  }
  clearInterval(keyboard.waitTimer);
  keyboard.waitTimer = setInterval(() => {
    if (macTrusted(false)) { clearInterval(keyboard.waitTimer); startKeyboard(); }
  }, 2000);
}

function applyTypingSetting(justTurnedOn = false) {
  if (state.config?.settings?.typingNibble) enableKeyboard(justTurnedOn); else stopKeyboard();
}

// Asked exactly once, the first time the app runs. The answer is saved forever.
async function askTypingPermissionOnce() {
  state.config = state.config || {};
  const settings = (state.config.settings ||= {});
  if (settings.typingAsked) { applyTypingSetting(); return; }
  const name = state.config.name || 'your guinea pig';
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Allow', 'No thanks'],
    defaultId: 0,
    cancelId: 1,
    title: 'Guinea Pig Pal',
    message: `Can ${name} nibble hay while you type? 🌾`,
    detail: 'To do this, Guinea Pig Pal needs to notice when you press a key. '
      + 'It only notices THAT you’re typing, and never records or saves WHICH keys you press.'
      + (process.platform === 'darwin' ? '\n\nIf you allow it, macOS will ask once for Accessibility permission. Turn on Guinea Pig Pal (shown as “Electron” while testing) in that list.' : '')
      + '\n\nYou can change this anytime in Customize → Behaviour.',
  });
  settings.typingAsked = true;
  settings.typingNibble = response === 0;
  saveState();
  petWin?.webContents.send('config:changed', state.config);
  customizeWin?.webContents.send('config:changed', state.config);
  applyTypingSetting(response === 0);
}

// ---------- app lifecycle ----------
app.whenReady().then(() => {
  state = loadState();
  if (process.platform === 'darwin') app.dock?.hide();
  Menu.setApplicationMenu(process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ label: app.name, submenu: [{ role: 'quit' }] }, { role: 'editMenu' }])
    : null);
  // Right after the computer starts, Windows' graphics aren't always ready for a see-through 3D window yet,
  // so give it a few seconds first (the tray icon is there straight away).
  const atLogin = startedAtLogin();
  setTimeout(createPetWindow, atLogin ? (process.platform === 'win32' ? 8000 : 3000) : 0);
  createTray();
  startSensors();
  startTracker();
  applyLoginItem();
  setTimeout(() => askTypingPermissionOnce().catch(() => {}), 2500);
  updates = setupUpdates({ getState: () => state, saveState, petName: () => state.config?.name || 'Your guinea pig' });
  if (process.env.GP_TEST_EAT) {
    setTimeout(() => {
      eatDistraction({ item: { id: 'test', type: 'site', label: 'Instagram', match: 'instagram.com' }, info: null, repeat: false });
      if (eating) eating.closed = true; // a test never closes anything
    }, 3000);
  }
  powerMonitor.on('suspend', () => sendAction('sleep'));
});

app.on('second-instance', () => { petWin?.show(); openCustomizer(); });
app.on('window-all-closed', (e) => { /* keep running in tray */ });
app.on('before-quit', () => {
  appQuitting = true;
  tracker?.stop();
  stopKeyboard();
  try {
    fs.writeFileSync(storePath(), JSON.stringify(state, null, 2));
  } catch { /* ignore */ }
});
