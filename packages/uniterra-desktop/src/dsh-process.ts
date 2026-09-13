/**
 * dsh runtime supervision — spawn the bundled DeepSeek Harness CLI as a
 * child, wait for its readiness line, expose the served URL, and own
 * shutdown/crash-restart. This is the entire "harness runtime" contract of
 * the uniterra desktop app: the Electron shell is a thin window over the dsh
 * Web UI, exactly like a browser would load it.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import type { Readable } from 'node:stream';

export interface DshRuntimeOptions {
  /** Absolute path to the dsh CLI entry (lib/bin.js). */
  readonly cli: string;
  /** Node executable to run the CLI with. */
  readonly nodeExec: string;
  /** DSH_HOME to run under. Omitted in the packaged app so dsh uses the
   * user's default ~/.dsh; dev passes the mirrored test home. */
  readonly dshHome?: string;
  /** DSH_BUNDLED_SKILL_DIR for the rank-600 bundled skills provider. */
  readonly dshBundledSkillDir?: string;
  /** The profile name to boot (uniterra). */
  readonly profile: string;
  /** Optional explicit port; defaults to the CLI's own (3080). */
  readonly port?: number;
  /** Optional extra CLI args. */
  readonly args?: readonly string[];
}

export interface DshRuntimeHandle {
  readonly url: string;
  readonly child: ChildProcess;
  readonly exited: Promise<number | null>;
}

/** How long a dsh child may take to report readiness before the wait fails. */
const READINESS_TIMEOUT_MS = 60_000;

/** Any argument that re-enables dsh's OS browser handoff. `--no-open` is the
 * negation of an `open` option, so a token beginning with `--open` flips the
 * handoff back on; the shell IS this app's browser (the BrowserWindow loads the
 * readiness URL), and a suppressed launch must never be replaced by an
 * equivalent — the defect of issue #28. */
const AUTO_OPEN_ARGUMENT = /^--open/u;

/** Wait for the dsh readiness URL line on stdout.
 *
 * @param stdout the child's stdout stream.
 * @param timeoutMs how long to wait before rejecting.
 * @param signal releases the wait early: a competing outcome (the child's own
 *   exit) has already settled the caller's race, and neither this wait's timer
 *   nor its stdout listener may outlive it.
 */
function awaitReadinessCancellable(
  stdout: Readable,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`dsh did not report readiness within ${String(timeoutMs)}ms`));
    }, timeoutMs);

    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString();
      // The readiness line is ONE complete console line: `dsh web:
      // http://127.0.0.1:<port>/?token=<token> (LAN: ...)`. New-line
      // termination is what makes the URL (and its auth token) complete — the
      // port must not be resolved before its digits fully arrived, and with
      // the 0.1.2-rc.1 family the URL carries a browser-session token after
      // the port, so resolving mid-token would hand the shell an URL that
      // authenticates as nobody. Any URL on an OTHER line (a boot log echo)
      // is ignored — only the `dsh web:` line announces readiness.
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const match = /(http:\/\/127\.0\.0\.1:\d+\S*)/.exec(line);
        if (match !== null && match[1] !== undefined) {
          cleanup();
          resolve(match[1]);
          return;
        }
      }
    };

    const onAbort = (): void => {
      cleanup();
      reject(new Error('dsh readiness wait was cancelled'));
    };

    const cleanup = (): void => {
      clearTimeout(timer);
      stdout.off('data', onData);
      signal?.removeEventListener('abort', onAbort);
    };

    if (signal?.aborted === true) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    stdout.on('data', onData);
  });
}

/** Wait for the dsh readiness URL line on stdout. */
export function awaitReadiness(
  stdout: Readable,
  timeoutMs = READINESS_TIMEOUT_MS,
): Promise<string> {
  return awaitReadinessCancellable(stdout, timeoutMs, undefined);
}

/**
 * Start the dsh runtime child and resolve once the Web UI is ready.
 * The child owns its exit; callers should wire `exited` to restart/quit.
 */
export async function startDsh(options: DshRuntimeOptions): Promise<DshRuntimeHandle> {
  // `--no-open` is required of every consumer that owns its own browser: the
  // shell IS this app's browser (the BrowserWindow loads `url`), and dsh
  // otherwise hands the same URL to the operating system's default browser at
  // readiness (observed on 0.1.5-rc.2, and present in 0.1.2-rc.1 too). URL
  // printing and the browser handoff are independent switches, so the
  // readiness line this module parses is unaffected.
  const args = ['--profile', options.profile, '--no-open'];
  if (options.port !== undefined) {
    args.push('--port', String(options.port));
  }
  // Caller arguments are filtered: dsh's option is the NEGATION `--no-open`, so
  // any token that begins with `--open` turns the handoff back on — a caller
  // must not be able to undo the contract the shell depends on (issue #28).
  args.push(...(options.args ?? []).filter((arg) => !AUTO_OPEN_ARGUMENT.test(arg)));

  const child = spawn(options.nodeExec, [options.cli, ...args], {
    env: {
      ...process.env,
      ...(options.dshHome === undefined ? {} : { DSH_HOME: options.dshHome }),
      ...(options.dshBundledSkillDir === undefined
        ? {}
        : { DSH_BUNDLED_SKILL_DIR: options.dshBundledSkillDir }),
      ELECTRON_RUN_AS_NODE: '1',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const exited = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => {
      resolve(code);
    });
  });

  let stderrTail = '';
  child.stderr.on('data', (data: Buffer) => {
    stderrTail = (stderrTail + data.toString()).slice(-4000);
  });

  const stdout = child.stdout;

  // A child that dies before readiness (a busy port, a profile whose plugin
  // tree fails to load) has already written its diagnosis to stderr: settle on
  // that instead of waiting out the readiness timeout, which the shell
  // surfaces as a ~60 s hang followed by a generic failure. The rejection is
  // pre-handled because the race only reads it while the readiness wait is
  // still pending — a later, ordinary exit must not surface as an unhandled
  // rejection.
  const exitedEarly = exited.then((code) => {
    throw new Error(`dsh exited with code ${String(code)} before reporting readiness`);
  });
  void exitedEarly.catch(() => undefined);

  // The readiness wait owns a timer and a stdout listener. On the exit path the
  // race settles on `exitedEarly` alone, so that wait is cancelled here — a dead
  // child must not leave its 60 s window (and the listening process) alive. The
  // rejection is pre-handled: the cancellation lands after the race has already
  // settled, and must not surface as an unhandled rejection.
  const cancelReadiness = new AbortController();
  const readiness = awaitReadinessCancellable(stdout, READINESS_TIMEOUT_MS, cancelReadiness.signal);
  void readiness.catch(() => undefined);

  const url = await Promise.race([readiness, exitedEarly]).catch((err: unknown) => {
    cancelReadiness.abort();
    child.kill('SIGTERM');
    throw new Error(
      `dsh failed to start: ${err instanceof Error ? err.message : String(err)}\n${stderrTail}`,
    );
  });

  return { url, child, exited };
}

export async function stopDsh(child: ChildProcess, timeoutMs = 10_000): Promise<void> {
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise((r) => setTimeout(r, timeoutMs))]);
  if (!child.killed) {
    child.kill('SIGKILL');
  }
}
