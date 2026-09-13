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
