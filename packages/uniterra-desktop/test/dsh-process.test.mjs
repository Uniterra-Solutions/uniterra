/**
 * Deterministic spawn-contract suite for `src/dsh-process.ts` (compiled dist).
 *
 * The two behaviours pinned here are the ones the Electron shell depends on and
 * that a readiness-only test cannot observe:
 *
 *  - FLAGS: `startDsh` spawns the CLI with `--profile <name>` AND `--no-open`.
 *    Without `--no-open` dsh hands its readiness URL to the operating system's
 *    default browser at readiness, which opened a duplicate window beside the
 *    shell (the shell IS this app's browser).
 *  - EARLY EXIT: a child that dies before readiness rejects PROMPTLY — at the
 *    child's own exit latency, not the 60 s readiness timeout — and the
 *    rejection carries the child's captured stderr.
 *
 * The dsh CLI is stubbed by a script written into a throwaway temp dir and
 * launched through the real `process.execPath`, so the true spawn path (argv,
 * env, stdio, exit wiring) is exercised without booting a runtime. A
 * deterministic unit test is the right shape for a spawn contract: there is no
 * input distribution to explore, only flags and one exit race.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDsh, stopDsh } from '../dist/dsh-process.js';

/** The readiness line the stub prints (token included: it is the identity). */
const READY_URL = 'http://127.0.0.1:34567/?token=spawn-contract';

/** Stub CLI: record its own argv, announce readiness, and stay alive until killed. */
const READY_STUB = [
  "import { writeFileSync } from 'node:fs';",
  "import { fileURLToPath } from 'node:url';",
  'const record = fileURLToPath(new URL("./argv.json", import.meta.url));',
  'writeFileSync(record, JSON.stringify(process.argv.slice(2)));',
  "process.stdout.write('dsh web: " + READY_URL + "\\n');",
  'setInterval(() => {}, 1000);',
  '',
].join('\n');

/** Stub CLI: write its diagnosis to stderr and die before any readiness line. */
const DYING_STUB = [
  "process.stderr.write('dsh: duplicate loader entry id: file-upload\\n');",
  'setTimeout(() => { process.exit(3); }, 200);',
  '',
].join('\n');

/** Write one stub CLI into a fresh temp dir; returns its path, argv path, cleanup. */
async function stubCli(source) {
  const dir = await mkdtemp(join(tmpdir(), 'uniterra-spawn-'));
  const cli = join(dir, 'stub-cli.mjs');
  await writeFile(cli, source, 'utf8');
  return {
    cli,
    argvFile: join(dir, 'argv.json'),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

test('SPAWN: startDsh passes --profile <name> and --no-open to the CLI', async () => {
  const stub = await stubCli(READY_STUB);
  try {
    const handle = await startDsh({
      cli: stub.cli,
      nodeExec: process.execPath,
      profile: 'web',
    });
    try {
      const argv = JSON.parse(await readFile(stub.argvFile, 'utf8'));
      assert.deepEqual(argv, ['--profile', 'web', '--no-open']);
      const profileAt = argv.indexOf('--profile');
      assert.notEqual(profileAt, -1, '--profile is passed');
      assert.equal(argv[profileAt + 1], 'web', '--profile names the profile to boot');
      assert.ok(
        argv.includes('--no-open'),
        '--no-open suppresses the OS browser handoff (the shell is the browser)',
      );
      assert.equal(handle.url, READY_URL, 'readiness resolves from the printed URL line');
    } finally {
      await stopDsh(handle.child, 2000);
    }
  } finally {
    await stub.cleanup();
  }
});

test('SPAWN: the contract flags lead; port and extra args are appended after them', async () => {
  const stub = await stubCli(READY_STUB);
  try {
    const handle = await startDsh({
      cli: stub.cli,
      nodeExec: process.execPath,
      profile: 'web',
      port: 34567,
      args: ['--patch', 'extra.yml'],
    });
    try {
      const argv = JSON.parse(await readFile(stub.argvFile, 'utf8'));
      assert.deepEqual(argv, [
        '--profile',
        'web',
        '--no-open',
        '--port',
        '34567',
        '--patch',
        'extra.yml',
      ]);
    } finally {
      await stopDsh(handle.child, 2000);
    }
  } finally {
    await stub.cleanup();
  }
});

test('SPAWN: a child that exits before readiness rejects promptly with its captured stderr', async () => {
  const stub = await stubCli(DYING_STUB);
  try {
    const started = Date.now();
    await assert.rejects(
      () =>
        startDsh({
          cli: stub.cli,
          nodeExec: process.execPath,
          profile: 'web',
        }),
      (error) => {
        assert.match(error.message, /^dsh failed to start:/u);
        assert.match(error.message, /dsh exited with code 3 before reporting readiness/u);
        assert.match(
          error.message,
          /duplicate loader entry id: file-upload/u,
          'the captured stderr rides the rejection',
        );
        return true;
      },
    );
    const elapsed = Date.now() - started;
    // The stub dies at ~200 ms; the readiness wait alone holds for 60 s.
    assert.ok(
      elapsed < 10_000,
      'rejected on the child exit, not the readiness timeout (took ' + String(elapsed) + 'ms)',
    );
  } finally {
    await stub.cleanup();
  }
});

// ---------------------------------------------------------------------------
// SPAWN-NOOPEN (issue #28) — the suppression is the shell's own contract
// ---------------------------------------------------------------------------

/** Any token that re-enables dsh's OS browser handoff: `--no-open` is the
 * negation of an `open` option, so a token beginning with `--open` flips it
 * back on. The shell may never let a caller inject one. */
const AUTO_OPEN_FLAG = /^--open/u;

/** argv tokens are passed verbatim to the child: they must be spawnable, so
 * control characters are dropped (an embedded NUL is not a valid argument). */
const tokenArb = fc
  .string({ maxLength: 12 })
  .map((value) => value.replace(/[\u0000-\u001f\u007f]/gu, ''));

const profileArb = fc.oneof(
  { weight: 2, arbitrary: tokenArb },
  { weight: 1, arbitrary: fc.constant('') },
  { weight: 1, arbitrary: fc.constant('  spaced profile  ') },
  { weight: 1, arbitrary: fc.constant('--not-a-profile') },
  { weight: 1, arbitrary: fc.constant('web') },
);

const portArb = fc.oneof(
  { weight: 2, arbitrary: fc.constant(undefined) },
  { weight: 1, arbitrary: fc.constant(0) },
  { weight: 1, arbitrary: fc.constant(65535) },
  { weight: 1, arbitrary: fc.integer({ min: 1, max: 65535 }) },
);

const extraArgsArb = fc.array(
  fc.oneof(
    { weight: 3, arbitrary: tokenArb },
    { weight: 1, arbitrary: fc.constant('--no-open') },
    { weight: 1, arbitrary: fc.constant('--open') },
    { weight: 1, arbitrary: fc.constant('--open-browser') },
    { weight: 1, arbitrary: fc.constant('--port') },
    { weight: 1, arbitrary: fc.constant('extra.yml') },
  ),
  { maxLength: 4 },
);

test('SPAWN-NOOPEN: --no-open is always present and nothing can remove it', async () => {
  const stub = await stubCli(READY_STUB);
  try {
    await fc.assert(
      fc.asyncProperty(profileArb, portArb, extraArgsArb, async (profile, port, args) => {
        const handle = await startDsh({
          cli: stub.cli,
          nodeExec: process.execPath,
          profile,
          ...(port === undefined ? {} : { port }),
          args,
        });
        try {
          const argv = JSON.parse(await readFile(stub.argvFile, 'utf8'));
          assert.ok(
            argv.filter((token) => token === '--no-open').length >= 1,
            `--no-open must always be in the final argv, got ${JSON.stringify(argv)}`,
          );
          for (const token of argv) {
            assert.ok(
              !AUTO_OPEN_FLAG.test(token),
              `an auto-open flag must never reach the child: ${token}`,
            );
          }
          // The contract flags lead; caller args can only be appended after
          // them. The profile value is passed verbatim either way: bare, or —
          // when the value itself would be read as a flag — attached to its
          // option, so the value can never be parsed as an auto-open switch.
          const contract = AUTO_OPEN_FLAG.test(profile)
            ? [`--profile=${profile}`, '--no-open']
            : ['--profile', profile, '--no-open'];
          assert.deepEqual(argv.slice(0, contract.length), contract);
        } finally {
          await stopDsh(handle.child, 2000);
        }
      }),
      { numRuns: 12 },
    );
  } finally {
    await stub.cleanup();
  }
});

test('SPAWN-NOOPEN regression: a caller-supplied --open is dropped, --no-open survives', async () => {
  const stub = await stubCli(READY_STUB);
  try {
    const handle = await startDsh({
      cli: stub.cli,
      nodeExec: process.execPath,
      profile: 'web',
      args: ['--open', '--no-open', '--patch', 'extra.yml'],
    });
    try {
      const argv = JSON.parse(await readFile(stub.argvFile, 'utf8'));
      assert.ok(!argv.includes('--open'), 'the injected auto-open flag was dropped');
      assert.equal(argv[0], '--profile');
      assert.equal(argv[2], '--no-open', 'the contract flag is still the third token');
      assert.ok(argv.includes('--patch'), 'ordinary extra args survive');
    } finally {
      await stopDsh(handle.child, 2000);
    }
  } finally {
    await stub.cleanup();
  }
});
