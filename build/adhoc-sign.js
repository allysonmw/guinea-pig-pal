// Runs after the Mac app is packaged (before the .dmg is made).
// Gives the app a free "ad-hoc" signature. Without any signature, Macs with Apple chips
// say the app "is damaged and can't be opened". With it, people just need to click
// "Open Anyway" once in System Settings → Privacy & Security.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing ${app}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
