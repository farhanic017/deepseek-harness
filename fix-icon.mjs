import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import https from 'node:https';
import http from 'node:http';

const rceditPath = join(process.env.TEMP || process.env.TMP || '/tmp', 'rcedit-x64.exe');
const exePath = 'apps/electron/dist/installer/win-unpacked/DeepSeek Harness.exe';
const iconPath = 'apps/electron/resources/icon.ico';

function download(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log('  Redirect →', res.headers.location.substring(0, 120));
        download(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  // Check if exe exists
  if (!existsSync(exePath)) {
    console.error('ERROR: exe not found at', exePath);
    process.exit(1);
  }
  if (!existsSync(iconPath)) {
    console.error('ERROR: icon not found at', iconPath);
    process.exit(1);
  }

  // Download rcedit if needed
  if (!existsSync(rceditPath) || statSync(rceditPath).size < 100000) {
    console.log('Downloading rcedit from GitHub...');
    const urls = [
      'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe',
      'https://github.com/electron/rcedit/releases/download/v1.0.1/rcedit-x64.exe',
    ];
    for (const url of urls) {
      try {
        console.log('  Trying', url);
        const buf = await download(url);
        if (buf[0] === 0x4d && buf[1] === 0x5a) { // MZ header = valid PE
          writeFileSync(rceditPath, buf);
          console.log('  Downloaded:', buf.length, 'bytes - VALID EXE');
          break;
        } else {
          console.log('  Got', buf.length, 'bytes but not a valid EXE, trying next...');
        }
      } catch (e) {
        console.log('  Failed:', e.message);
      }
    }
  }

  if (!existsSync(rceditPath) || statSync(rceditPath).size < 100000) {
    console.error('ERROR: Could not download rcedit');
    process.exit(1);
  }

  // Set icon
  console.log('Setting icon...');
  try {
    const cmd = `"${rceditPath}" "${exePath}" --set-icon "${iconPath}"`;
    console.log('  Running:', cmd);
    const out = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
    console.log('  SUCCESS:', out);
  } catch (e) {
    console.error('  FAILED:', e.message);
    if (e.stderr) console.error('  stderr:', e.stderr);
    process.exit(1);
  }
}

main();
