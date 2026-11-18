// Figures out which app / website is in front, and can close a tab or app.
// No native modules: Windows uses a small PowerShell helper, macOS uses lsappinfo + AppleScript.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BROWSERS_WIN = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'opera_gx', 'vivaldi', 'arc', 'chromium', 'zen', 'librewolf', 'waterfox', 'iexplore'];
const CHROMIUM_MAC = ['Google Chrome', 'Google Chrome Canary', 'Brave Browser', 'Microsoft Edge', 'Arc', 'Vivaldi', 'Chromium', 'Opera', 'Opera GX', 'Comet', 'Dia'];
const BROWSERS_MAC = [...CHROMIUM_MAC, 'Safari', 'Safari Technology Preview', 'Firefox', 'Zen', 'Zen Browser', 'Orion'];

const run = (cmd, args, timeout = 2500) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
});
const osa = (script) => run('osascript', ['-e', script]);
const asStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// ---------------- Windows ----------------
const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class GPFG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
}
"@
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $parts = $line.Split(' ')
  $cmd = $parts[0]
  $out = '{"ok":false}'
  try {
    if ($cmd -eq 'poll') {
      $h = [GPFG]::GetForegroundWindow()
      $sb = New-Object System.Text.StringBuilder 1024
      [void][GPFG]::GetWindowText($h, $sb, 1024)
      $procId = [uint32]0
      [void][GPFG]::GetWindowThreadProcessId($h, [ref]$procId)
      $name = ''
      try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}
      $o = @{ ok = $true; handle = $h.ToInt64(); title = $sb.ToString(); app = $name; pid = $procId }
      $out = ($o | ConvertTo-Json -Compress)
    } elseif ($cmd -eq 'closetab') {
      $h = [IntPtr][Int64]$parts[1]
      if ([GPFG]::GetForegroundWindow() -ne $h) { [void][GPFG]::SetForegroundWindow($h); Start-Sleep -Milliseconds 150 }
      [System.Windows.Forms.SendKeys]::SendWait('^w')
      $out = '{"ok":true}'
    } elseif ($cmd -eq 'close') {
      [void][GPFG]::PostMessage([IntPtr][Int64]$parts[1], 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
      $out = '{"ok":true}'
    } elseif ($cmd -eq 'rect') {
      $r = New-Object GPFG+RECT
      if ([GPFG]::GetWindowRect([IntPtr][Int64]$parts[1], [ref]$r)) {
        $out = '{"ok":true,"x":' + $r.L + ',"y":' + $r.T + ',"w":' + ($r.R - $r.L) + ',"h":' + ($r.B - $r.T) + '}'
      }
    } elseif ($cmd -eq 'minimize') {
      [void][GPFG]::ShowWindow([IntPtr][Int64]$parts[1], 6)
      $out = '{"ok":true}'
    }
  } catch {}
  [Console]::Out.WriteLine($out)
  [Console]::Out.Flush()
}
`;

class WindowsForeground {
  constructor() {
    this.proc = null;
    this.queue = [];
    this.buf = '';
  }
  ensure() {
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) return;
    const file = path.join(os.tmpdir(), 'guinea-pig-pal-fg.ps1');
    fs.writeFileSync(file, PS_SCRIPT, 'utf8');
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true });
    this.buf = '';
    this.proc.stdout.on('data', (d) => {
      this.buf += d.toString();
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        const next = this.queue.shift();
        if (next) { clearTimeout(next.timer); try { next.resolve(JSON.parse(line)); } catch { next.resolve(null); } }
      }
    });
    this.proc.on('exit', () => { this.queue.splice(0).forEach((q) => q.resolve(null)); this.proc = null; });
    this.proc.on('error', () => { this.proc = null; });
  }
  send(line) {
    return new Promise((resolve) => {
      try {
        this.ensure();
        if (!this.proc) return resolve(null);
        const entry = { resolve, timer: setTimeout(() => { const i = this.queue.indexOf(entry); if (i >= 0) this.queue.splice(i, 1); resolve(null); }, 4000) };
        this.queue.push(entry);
        this.proc.stdin.write(line + '\n');
      } catch { resolve(null); }
    });
  }
  async poll() {
    const r = await this.send('poll');
    if (!r || !r.ok) return null;
    const app = r.app || '';
    return { app, title: r.title || '', url: '', handle: r.handle, isBrowser: BROWSERS_WIN.includes(app.toLowerCase()) };
  }
  closeTab(info) { return this.send(`closetab ${info.handle}`); }
  closeApp(info, how) { return this.send(`${how === 'hide' ? 'minimize' : 'close'} ${info.handle}`); }
  // window position/size in physical pixels (main.js converts to screen points)
  async getWindowRect(info) {
    if (!info?.handle) return null;
    const r = await this.send(`rect ${info.handle}`);
    return r && r.ok && r.w > 50 && r.h > 50 ? { x: r.x, y: r.y, width: r.w, height: r.h, physical: true } : null;
  }
  stop() { try { this.proc?.kill(); } catch { /* ignore */ } }
}

// ---------------- macOS ----------------
class MacForeground {
  async poll() {
    const asn = await run('lsappinfo', ['front'], 1500);
    if (!asn) return null;
    const info = await run('lsappinfo', ['info', '-only', 'name', asn], 1500);
    const m = info && info.match(/"[^"]*"\s*=\s*"(.*)"/);
    const app = m ? m[1] : '';
    if (!app) return null;
    let url = '', title = '';
    const isBrowser = BROWSERS_MAC.includes(app);
    if (CHROMIUM_MAC.includes(app)) {
      const r = await osa(`tell application ${asStr(app)} to return (URL of active tab of front window) & linefeed & (title of active tab of front window)`);
      if (r) [url, title = ''] = r.split('\n');
    } else if (app.startsWith('Safari') || app === 'Orion') {
      const r = await osa(`tell application ${asStr(app)} to return (URL of current tab of front window) & linefeed & (name of current tab of front window)`);
      if (r) [url, title = ''] = r.split('\n');
    } else if (isBrowser) {
      // Firefox/Zen have no AppleScript URL support; the window title needs Accessibility permission.
      title = (await osa(`tell application "System Events" to get name of front window of process ${asStr(app)}`)) || '';
    }
    return { app, title, url, isBrowser };
  }
  async closeTab(info) {
    const app = info.app;
    let ok = null;
    if (CHROMIUM_MAC.includes(app)) ok = await osa(`tell application ${asStr(app)} to close active tab of front window`);
    else if (app.startsWith('Safari') || app === 'Orion') ok = await osa(`tell application ${asStr(app)} to close current tab of front window`);
    if (ok === null) {
      await osa(`tell application ${asStr(app)} to activate`);
      await osa('tell application "System Events" to keystroke "w" using command down');
    }
  }
  async getWindowRect(info) {
    if (!info?.app) return null;
    const parse = (str) => {
      const n = (str || '').split(',').map((v) => parseFloat(v.trim()));
      return n.length === 4 && n.every(Number.isFinite) ? n : null;
    };
    let b = null;
    if (CHROMIUM_MAC.includes(info.app) || info.app.startsWith('Safari') || info.app === 'Orion') {
      b = parse(await osa(`tell application ${asStr(info.app)} to get bounds of front window`));
      if (b) return { x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1] };
    }
    // other apps (needs Accessibility permission; fine if it fails)
    b = parse(await osa(`tell application "System Events" to tell (first process whose name is ${asStr(info.app)}) to get (position of front window) & (size of front window)`));
    return b ? { x: b[0], y: b[1], width: b[2], height: b[3] } : null;
  }
  closeApp(info, how) {
    if (how === 'hide') return osa(`tell application "System Events" to set visible of process ${asStr(info.app)} to false`);
    return osa(`tell application ${asStr(info.app)} to quit`);
  }
  stop() {}
}

class NoopForeground {
  async poll() { return null; }
  async getWindowRect() { return null; }
  async closeTab() {}
  async closeApp() {}
  stop() {}
}

function createForeground() {
  if (process.platform === 'win32') return new WindowsForeground();
  if (process.platform === 'darwin') return new MacForeground();
  return new NoopForeground();
}

module.exports = { createForeground };
