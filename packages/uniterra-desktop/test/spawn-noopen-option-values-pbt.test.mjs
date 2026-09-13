/**
 * Environment-mock PBT for the dsh child argv contract (issue #28,
 * `src/dsh-process.ts` compiled dist, real spawn against a stub CLI).
 *
 * REQ-28-3 fixes the argv contract of the dsh runtime child: the auto-open
 * suppression is present at least once AND no flag that re-enables the OS
 * browser handoff may reach the child — for ANY `DshRuntimeOptions`, option
 * VALUES included (`--profile <name>` interpolates a caller string into the
 * same argv the contract is about).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDsh, stopDsh } from '../dist/dsh-process.js';

/** The readiness line the stub prints. */
const READY_URL = 'http://127.0.0.1:34567/?token=spawn-noopen';

/** Stub CLI: record its own argv, announce readiness, and stay alive. */
const READY_STUB = [
  "import { writeFileSync } from 'node:fs';",
  "import { fileURLToPath } from 'node:url';",
  'const record = fileURLToPath(new URL("./argv.json", import.meta.url));',
  'writeFileSync(record, JSON.stringify(process.argv.slice(2)));',
  "process.stdout.write('dsh web: " + READY_URL + "\\n');",
  'setInterval(() => {}, 1000);',
  '',
].join('\n');

/** Any token that turns dsh's OS browser handoff back on. */
const AUTO_OPEN_FLAG = /^--open/u;

const profileArb = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom('--open', '--open-browser', '--open=false') },
  { weight: 1, arbitrary: fc.constantFrom('--no-open', '--profile', 'web', '') },
  { weight: 1, arbitrary: fc.string({ maxLength: 10 }) },
);

const portArb = fc.oneof(
  { weight: 2, arbitrary: fc.constant(undefined) },
  { weight: 1, arbitrary: fc.constantFrom(0, 65535, 3456) },
);

test('SPAWN-NOOPEN: no option value can smuggle an auto-open flag into the child argv', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'uniterra-spawn-noopen-'));
  const cli = join(dir, 'stub-cli.mjs');
  const argvFile = join(dir, 'argv.json');
  await writeFile(cli, READY_STUB, 'utf8');
  try {
    await fc.assert(
      fc.asyncProperty(profileArb, portArb, async (profile, port) => {
        const handle = await startDsh({
          cli,
          nodeExec: process.execPath,
          profile,
          ...(port === undefined ? {} : { port }),
        });
        try {
          const argv = JSON.parse(await readFile(argvFile, 'utf8'));
          assert.ok(
            argv.filter((token) => token === '--no-open').length >= 1,
            `--no-open must always be in the final argv, got ${JSON.stringify(argv)}`,
          );
          for (const token of argv) {
            assert.ok(
              !AUTO_OPEN_FLAG.test(token),
              `an auto-open token reached the child: ${token} (profile=${JSON.stringify(profile)})`,
            );
          }
        } finally {
          await stopDsh(handle.child, 2000);
        }
      }),
      { numRuns: 8 },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('SPAWN-NOOPEN regression: a leading-dash profile is attached to its option, never a bare flag', async () => {
  // The shrunk counterexample: the profile was interpolated as a bare argv
  // token, so `--open` reached the child as the very switch this contract
  // suppresses (argv was ['--profile', '--open', '--no-open']).
  const dir = await mkdtemp(join(tmpdir(), 'uniterra-spawn-noopen-'));
  const cli = join(dir, 'stub-cli.mjs');
  const argvFile = join(dir, 'argv.json');
  await writeFile(cli, READY_STUB, 'utf8');
  try {
    for (const profile of ['--open', '--open-browser']) {
      const handle = await startDsh({ cli, nodeExec: process.execPath, profile });
      try {
        const argv = JSON.parse(await readFile(argvFile, 'utf8'));
        assert.ok(
          argv.includes('--no-open'),
          `--no-open stays in the final argv, got ${JSON.stringify(argv)}`,
        );
        for (const token of argv) {
          assert.ok(
            !AUTO_OPEN_FLAG.test(token),
            `an auto-open token reached the child: ${token} (profile=${JSON.stringify(profile)})`,
          );
        }
        assert.ok(
          argv.includes(`--profile=${profile}`),
          'the profile value is still passed verbatim, attached to its option',
        );
      } finally {
        await stopDsh(handle.child, 2000);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
