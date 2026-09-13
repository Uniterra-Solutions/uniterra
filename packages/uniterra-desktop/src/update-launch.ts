/**
 * The updater hand-off (issues #15 and #28).
 *
 * `uniterra update` refreshes the CLI, rebuilds + reinstalls the app and
 * relaunches it; the desktop quits itself and lets that command own the whole
 * update. This module owns the one spawn that starts it, detached, so it
 * survives the app's shutdown — and the environment the update's progress
 * record depends on.
 */

import { spawn, type ChildProcess } from 'node:child_process';

export interface UpdaterInvocation {
  readonly command: string;
  readonly args: readonly string[];
}

/** Spawn the updater detached and return the child (never awaited: the app
 * quits immediately after). The child's environment carries the progress
 * record path so the update reports back to this app on its next boot. */
export function spawnUpdater(
  invocation: UpdaterInvocation,
  _userDataDir: string,
  platform: NodeJS.Platform,
  onError: (error: Error) => void,
): ChildProcess {
  // STUB: the progress record environment variable is missing.
  const child = spawn(invocation.command, [...invocation.args], {
    detached: true,
    stdio: 'ignore',
    shell: platform === 'win32',
  });
  child.once('error', onError);
  child.unref();
  return child;
}
