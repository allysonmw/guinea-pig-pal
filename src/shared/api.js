// Returns the Electron bridge, or a browser stand-in so the pages can also be
// opened directly in a browser while designing (handy for quick previews).
export function getApi() {
  if (window.api) return window.api;
  const listeners = { config: [], action: [], sensors: [] };
  const read = () => { try { return JSON.parse(localStorage.getItem('gp-state') || '{}'); } catch { return {}; } };
  const write = (s) => localStorage.setItem('gp-state', JSON.stringify(s));
  window.addEventListener('mousemove', (e) => {
    listeners.sensors.forEach((f) => f({ cursor: { x: e.clientX, y: e.clientY }, idleSeconds: 0 }));
  });
  window.__petAction = (action, payload) => listeners.action.forEach((f) => f({ action, payload }));
  return {
    getConfig: async () => read(),
    saveConfig: (config) => { const s = read(); s.config = config; write(s); listeners.config.forEach((f) => f(config)); },
    previewConfig: (config) => listeners.config.forEach((f) => f(config)),
    saveStats: (stats) => { const s = read(); s.stats = stats; write(s); },
    setIgnoreMouse: () => {},
    moveBy: async () => ({ blocked: false }),
    dragTo: () => {},
    showMenu: () => console.log('[menu]'),
    openCustomizer: () => window.open('customize.html'),
    getUsage: async () => ({ instagram: { used: 130, limit: 300 } }),
    getDistractionInfo: async () => ({ platform: 'browser', canCapture: false, current: null }),
    resetUsage: () => {},
    testEat: () => window.open('eat.html?demo'),
    requestScreenPermission: () => {},
    eatReady: () => console.log('[eat ready]'),
    eatDone: () => console.log('[eat done]'),
    reportMouth: (m) => { window.__mouth = m; },
    onEatStart: (f) => { window.__eatStart = f; },
    onTab: () => {},
    closeCustomizer: () => window.close(),
    onConfig: (f) => listeners.config.push(f),
    onAction: (f) => listeners.action.push(f),
    onSensors: (f) => listeners.sensors.push(f),
  };
}
