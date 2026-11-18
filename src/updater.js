// Checks GitHub for a newer version of Guinea Pig Pal and offers to download it.
// New versions are published as GitHub Releases on github.com/allysonmw/guinea-pig-pal
const { app, dialog, shell, net } = require('electron');

const OWNER = 'allysonmw';
const REPO = 'guinea-pig-pal';
const EVERY = 6 * 60 * 60 * 1000; // check every 6 hours

// "1.10.0" > "1.9.2"
function isNewer(remote, local) {
  const a = String(remote).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const b = String(local).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

// The right installer for this computer
function pickDownload(release) {
  const assets = release.assets || [];
  let asset = null;
  if (process.platform === 'darwin') {
    asset = assets.find((a) => a.name.endsWith('.dmg') && a.name.includes(process.arch))
      || assets.find((a) => a.name.endsWith('.dmg'));
  } else if (process.platform === 'win32') {
    asset = assets.find((a) => a.name.endsWith('.exe') && !a.name.includes('blockmap'));
  }
  return asset ? asset.browser_download_url : release.html_url;
}

async function latestRelease() {
  const res = await net.fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Guinea-Pig-Pal' },
  });
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  return res.json();
}

function setupUpdates({ getState, saveState, petName }) {
  let busy = false;

  async function check({ manual = false } = {}) {
    if (busy) return;
    // while testing with `npm start`, only check when you ask
    if (!app.isPackaged && !manual) return;
    busy = true;
    try {
      const rel = await latestRelease();
      const version = String(rel.tag_name || '').replace(/^v/, '');
      const state = getState();
      state.updates = state.updates || {};
      state.updates.lastCheck = Date.now();
      saveState();
      if (!isNewer(version, app.getVersion())) {
        if (manual) {
          await dialog.showMessageBox({ type: 'info', title: 'Guinea Pig Pal', message: 'You’re up to date! 🐹', detail: `You have the newest version (${app.getVersion()}).` });
        }
        return;
      }
      if (!manual && state.updates.skipped === version) return;
      const notes = String(rel.body || '').trim();
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'Guinea Pig Pal',
        message: `A new version of Guinea Pig Pal is here! 🐹 (${version})`,
        detail: `${petName()} would love the upgrade. You have ${app.getVersion()}.`
          + (notes ? `\n\nWhat’s new:\n${notes.slice(0, 600)}` : '')
          + (process.platform === 'darwin'
            ? '\n\nClick Download, open the file, and drag Guinea Pig Pal into Applications (choose Replace). Your guinea pig and settings stay the same.'
            : '\n\nClick Download, then run the installer. Your guinea pig and settings stay the same.'),
        buttons: ['Download', 'Later', 'Skip this version'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) shell.openExternal(pickDownload(rel));
      if (response === 2) { state.updates.skipped = version; saveState(); }
    } catch (e) {
      if (manual) {
        await dialog.showMessageBox({ type: 'warning', title: 'Guinea Pig Pal', message: 'Couldn’t check for updates', detail: `Check your internet connection and try again.\n\n(${e.message})` });
      }
    } finally {
      busy = false;
    }
  }

  setTimeout(() => check(), 15000);
  setInterval(() => check(), EVERY);
  return { check };
}

module.exports = { setupUpdates, isNewer };
