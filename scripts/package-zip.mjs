import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const distDir = path.join(root, 'dist');
fs.mkdirSync(distDir, { recursive: true });

// 1. Zoho Sigma / ZET upload zip (`plugin-manifest.json` + `app/` at archive root)
const sigmaZip = path.join(distDir, `proweblook-zoho-sigma-widget-v${pkg.version}.zip`);
if (fs.existsSync(sigmaZip)) fs.unlinkSync(sigmaZip);
execFileSync('zip', ['-r', '-q', sigmaZip, 'plugin-manifest.json', 'app'], { cwd: root });

// 2. Full extension + Deluge scripts release archive
const fullZip = path.join(distDir, `proweblook-zoho-extension-v${pkg.version}.zip`);
if (fs.existsSync(fullZip)) fs.unlinkSync(fullZip);
execFileSync(
  'zip',
  ['-r', '-q', fullZip, 'plugin-manifest.json', 'package.json', 'README.md', 'LICENSE', 'app', 'deluge', 'scripts', 'test'],
  { cwd: root }
);

console.log(`Packaged:\n- ${sigmaZip}\n- ${fullZip}`);
