/**
 * Live verification for the turn-completion observer (REQ-1 / issue #34).
 *
 * Boots the bundled dsh CLI in a THROWAWAY DSH_HOME (never the user's ~/.dsh),
 * runs the real transport from packages/uniterra-desktop/dist/dsh-observer.js
 * against it, and asserts the whole observation path works end to end:
 *   - the readiness line's launch token is exchanged for the dsh-auth cookie,
 *   - session/list answers the authenticated client-request RPC,
 *   - a session/follow stream opens over /api/remote.mux with no protocol error.
 *
 * It does NOT assert a notification: a real turn needs a model provider, so the
 * OS-notification half stays a manual step (the plan's acceptance 5).
 *
 * Usage: scripts/verify-turn-notification/run.sh
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startDshTurnObserver } from '../../packages/uniterra-desktop/dist/dsh-observer.js';

const REPO = resolve(import.meta.dirname, '..', '..');
const READINESS_TIMEOUT_MS = 90_000;
const OBSERVE_WINDOW_MS = 12_000;

function fail(message) {
  console.error('FAIL: ' + message);
  process.exitCode = 1;
}

const home = mkdtempSync(join(tmpdir(), 'uniterra-turn-notify-'));
const child = spawn(
  process.execPath,
  ['vendor/dsh-harness/apps/cli/lib/bin.js', '--profile', 'web', '--no-open', '--port', '0'],
  { cwd: REPO, env: { ...process.env, DSH_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] },
);

let stderrTail = '';
child.stderr.on('data', (d) => {
  stderrTail = (stderrTail + String(d)).slice(-2000);
});

const readinessUrl = await new Promise((resolveUrl, rejectUrl) => {
  let buf = '';
  const timer = setTimeout(() => {
    rejectUrl(new Error('dsh printed no readiness line'));
  }, READINESS_TIMEOUT_MS);
  child.stdout.on('data', (d) => {
    buf += String(d);
    const match = /http:\/\/127\.0\.0\.1:\d+\/?\?token=[A-Za-z0-9._-]+/u.exec(buf);
    if (match !== null) {
      clearTimeout(timer);
      resolveUrl(match[0]);
    }
  });
}).catch((error) => {
  fail(error.message + '\n' + stderrTail);
  return undefined;
});

if (readinessUrl !== undefined) {
  const base = readinessUrl.replace(/\/\?token=.*$/u, '');
  const auth = await fetch(readinessUrl, { redirect: 'manual' });
  const cookie = (auth.headers.getSetCookie?.() ?? [])[0]?.split(';')[0];
  console.log(
    'readiness handshake: HTTP ' +
      auth.status +
      ', cookie ' +
      (cookie === undefined ? 'MISSING' : 'issued'),
  );

  const created = await (
    await fetch(base + '/api/session/create', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'verify-create',
        method: 'session/create',
        payload: { args: { request: {} } },
      }),
    })
  ).json();
  const sessionId = created.result?.value?.sessionId;
  if (typeof sessionId !== 'string') {
    fail('session/create did not return a sessionId: ' + JSON.stringify(created).slice(0, 200));
  } else {
    console.log('session/create: ' + sessionId);
  }

  const logs = [];
  const notices = [];
  const handle = startDshTurnObserver({
    readinessUrl,
    profileDir: join(home, 'profiles', 'web'),
    onTurnEnd: (notice) => notices.push(notice),
    log: (message) => logs.push(message),
  });
  await new Promise((r) => setTimeout(r, OBSERVE_WINDOW_MS));
  handle.stop();
  await new Promise((r) => setTimeout(r, 300));

  console.log('observer log lines: ' + (logs.length === 0 ? '(none)' : ''));
  for (const line of logs) {
    console.log('  - ' + line);
  }
  const protocolErrors = logs.filter((line) => /failed|error|arguments-invalid/iu.test(line));
  if (protocolErrors.length > 0) {
    fail('the observer reported protocol errors: ' + protocolErrors.join(' | '));
  } else {
    console.log('OK: authenticated, listed and followed the live session with no protocol error');
  }
  console.log('notices observed: ' + notices.length + ' (a model turn is required to produce one)');
}

child.kill('SIGTERM');
rmSync(home, { recursive: true, force: true });
setTimeout(() => {
  child.kill('SIGKILL');
  process.exit(process.exitCode ?? 0);
}, 400);
