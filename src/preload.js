// Safe bridge between the windows and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.send('config:save', config),
  previewConfig: (config) => ipcRenderer.send('config:preview', config),
  saveStats: (stats) => ipcRenderer.send('stats:save', stats),
  setIgnoreMouse: (ignore) => ipcRenderer.send('pet:set-ignore', ignore),
  moveBy: (dx, dy) => ipcRenderer.invoke('pet:move-by', dx, dy),
  dragTo: (sx, sy, ox, oy) => ipcRenderer.send('pet:drag-to', sx, sy, ox, oy),
  showMenu: () => ipcRenderer.send('pet:context-menu'),
  openCustomizer: (tab) => ipcRenderer.send('open-customizer', tab),
  getUsage: () => ipcRenderer.invoke('distractions:usage'),
  getDistractionInfo: () => ipcRenderer.invoke('distractions:current'),
  resetUsage: (id) => ipcRenderer.send('distractions:reset', id),
  testEat: (cfg) => ipcRenderer.send('distractions:test', cfg),
  requestScreenPermission: () => ipcRenderer.send('perm:screen'),
  eatReady: () => ipcRenderer.send('eat:ready'),
  eatDone: () => ipcRenderer.send('eat:done'),
  reportMouth: (m) => ipcRenderer.send('pet:mouth', m),
  onEatStart: (fn) => ipcRenderer.on('eat:start', (_e, d) => fn(d)),
  onTab: (fn) => ipcRenderer.on('customizer:tab', (_e, t) => fn(t)),
  closeCustomizer: () => ipcRenderer.send('customizer:close'),
  onConfig: (fn) => ipcRenderer.on('config:changed', (_e, c) => fn(c)),
  onAction: (fn) => ipcRenderer.on('pet:action', (_e, a) => fn(a)),
  onSensors: (fn) => ipcRenderer.on('sensors', (_e, s) => fn(s)),
});
