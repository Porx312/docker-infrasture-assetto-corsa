import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(root, '..', 'package.json'), 'utf-8'));
const info = {
  version: pkg.version ?? 'unknown',
  builtAt: new Date().toISOString(),
};

fs.writeFileSync(path.join(root, '..', 'dist', 'build-info.json'), JSON.stringify(info, null, 2));
console.log(`[build] wrote dist/build-info.json version=${info.version}`);
