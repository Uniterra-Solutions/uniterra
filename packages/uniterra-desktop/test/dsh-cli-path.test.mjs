/**
 * Deterministic regression test for the dsh CLI resolution order.
 *
 * INVARIANT pinned here:
 *   Dev (running from the monorepo) resolves the built vendored harness CLI
 *   (`vendor/dsh-harness/apps/cli/lib/bin.js`) FIRST; without a vendored
 *   build, the npm-linked `@deepseek-ai/dsh` package is the fallback.
 *   Packaged builds NEVER use the vendored CLI: they resolve the npm package
 *   inside the embedded source tree (Windows falls back to the physical
 *   `.pnpm` store location as defense-in-depth).
 *
 * The order matters because it decides whether a dev source edit under
 * vendor/dsh-harness actually runs (the whole point of vendoring the source):
 * if packaged/dev reversed, the dev app would silently keep running compiled
 * npm code; if the fallback order reversed, a stray node_modules copy would
 * shadow the vendored build.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveDshCliPath } from '../dist/dsh-cli-path.js';

function junctionCli(root) {
  return join(
    root,
    'packages',
    'uniterra-desktop',
    'node_modules',
    '@deepseek-ai',
    'dsh',
    'lib',
    'bin.js',
  );
}

function vendoredCli(root) {
  return join(root, 'vendor', 'dsh-harness', 'apps', 'cli', 'lib', 'bin.js');
}

function storeCli(root, storeEntry) {
  return join(
    root,
    'node_modules',
    '.pnpm',
    storeEntry,
    'node_modules',
    '@deepseek-ai',
    'dsh',
    'lib',
    'bin.js',
  );
}

function makeFile(file) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '// build\n');
}

async function withRoot(callback) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-cli-path-'));
  try {
    await callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('dsh CLI resolution order', async (t) => {
  await t.test('DEV: vendored build wins over the npm-linked package', async () => {
    await withRoot((root) => {
      makeFile(vendoredCli(root));
      makeFile(junctionCli(root));
      const resolved = resolveDshCliPath({ packaged: false, sourceRoot: root, platform: 'darwin' });
      assert.equal(resolved, vendoredCli(root));
    });
  });

  await t.test('DEV: without a vendored build the npm-linked package is used', async () => {
    await withRoot((root) => {
      assert.equal(
        resolveDshCliPath({ packaged: false, sourceRoot: root, platform: 'darwin' }),
        junctionCli(root),
      );
    });
  });

  await t.test('PACKAGED: never the vendored CLI, even when it is built', async () => {
    await withRoot((root) => {
      makeFile(vendoredCli(root));
      assert.equal(
        resolveDshCliPath({ packaged: true, sourceRoot: root, platform: 'darwin' }),
        junctionCli(root),
      );
    });
  });

  await t.test('PACKAGED (win32): the physical .pnpm store location is preferred', async () => {
    await withRoot((root) => {
      makeFile(storeCli(root, '@deepseek-ai+dsh@0.1.1-rc.2_xyz'));
      makeFile(storeCli(root, '@deepseek-ai+dsh-agent@0.1.1-rc.2_xyz')); // must NOT match
      const resolved = resolveDshCliPath({ packaged: true, sourceRoot: root, platform: 'win32' });
      assert.equal(resolved, storeCli(root, '@deepseek-ai+dsh@0.1.1-rc.2_xyz'));
    });
  });

  await t.test('PACKAGED (win32): no store entry falls back to the junction path', async () => {
    await withRoot((root) => {
      assert.equal(
        resolveDshCliPath({ packaged: true, sourceRoot: root, platform: 'win32' }),
        junctionCli(root),
      );
    });
  });
});
