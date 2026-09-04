#!/usr/bin/env node
/**
 * Build the vendored DeepSeek Harness source (vendor/dsh-harness) so the dev
 * desktop runs against dsh source instead of the compiled npm packages.
 *
 *   node scripts/build-vendored-dsh.mjs            # install + full build
 *   node scripts/build-vendored-dsh.mjs --no-install   # keep the current install
 *   node scripts/build-vendored-dsh.mjs --host-only    # host libs only (fast)
 *
 * See vendor/dsh-harness/VENDOR.md for the pin ledger and development loop.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendoredRoot = join(repoRoot, 'vendor', 'dsh-harness');
const args = new Set(process.argv.slice(2));

if (!existsSync(join(vendoredRoot, 'package.json'))) {
  console.error(
    'vendor/dsh-harness not found - the vendored DeepSeek Harness source tree is missing.',
  );
  process.exit(1);
}

function run(command, description) {
  console.log('\n[vendor-dsh] ' + description);
  const result = spawnSync('pnpm', command, {
    cwd: vendoredRoot,
    env: { ...process.env, CI: '1' },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    const code = result.status ?? 1;
    console.error('[vendor-dsh] ' + description + ' failed (exit ' + String(code) + ')');
    process.exit(code);
  }
}

if (!args.has('--no-install')) {
  run(['install', '--frozen-lockfile'], 'pnpm install --frozen-lockfile');
}

if (args.has('--host-only')) {
  run(['run', 'build:lib:host'], 'pnpm run build:lib:host (host packages only)');
} else {
  run(['run', 'build'], 'pnpm run build (host + client + web)');
}

const cli = join(vendoredRoot, 'apps', 'cli', 'lib', 'bin.js');
if (!existsSync(cli)) {
  console.error('[vendor-dsh] expected CLI entry missing: ' + cli);
  process.exit(1);
}
console.log('\n[vendor-dsh] vendored CLI ready: ' + cli);
console.log(
  '[vendor-dsh] the dev desktop (pnpm --filter @uniterra-solutions/uniterra-desktop dev) now resolves this CLI.',
);
