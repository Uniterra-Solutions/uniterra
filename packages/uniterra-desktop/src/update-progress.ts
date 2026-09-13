/**
 * Update progress on the desktop side (issue #15).
 *
 * The CLI writes its machine-readable event stream (see
 * `packages/uniterra-cli/src/update-progress.ts`, same line schema) to
 * `<userData>/update-progress.ndjson` — the app itself is gone while the update
 * runs, so that durable record is the only place a finished update can report
 * back from. On boot the shell reads it, reduces it to the latest run's
 * terminal state, and shows that state exactly once.
 *
 * Everything here is total: arbitrary bytes, a truncated line, a missing file
 * or an illegible marker must never throw and never block boot.
 */

/** The stage names the CLI emits (kept in lockstep with the CLI event schema by
 * a byte-exact golden vector in `test/update-progress-pbt.test.mjs`). */
export type UpdateStage = 'update-cli' | 'build-install-app' | 'launch-app';

export type ProgressEventName = 'run-start' | 'stage-start' | 'stage-end' | 'run-end';
export type ProgressOutcome = 'ok' | 'failed' | 'dry-run';

export interface ProgressEvent {
  readonly v: 1;
  readonly run: string;
  readonly seq: number;
  readonly at: string;
  readonly event: ProgressEventName;
  readonly stage: UpdateStage | null;
  readonly status: ProgressOutcome | null;
  readonly message: string;
}

/** One run's accepted events (ordered by `seq`, de-duplicated by `(run, seq)`). */
export interface RunRecord {
  readonly run: string;
  readonly events: readonly ProgressEvent[];
  readonly terminal: ProgressEvent | null;
}

export interface UpdateProgressState {
  readonly runs: readonly RunRecord[];
  /** Run ids whose terminal state has already been shown to the user. */
  readonly consumed: readonly string[];
}

/** What the shell shows for a finished run. */
export interface ProgressSummary {
  readonly run: string;
  readonly status: ProgressOutcome;
  readonly stage: UpdateStage | null;
  readonly message: string;
}

/** The record file name under `userData`. */
export const UPDATE_PROGRESS_FILE = 'update-progress.ndjson';

/** The consumption marker file name under `userData`. */
export const UPDATE_PROGRESS_CONSUMED_FILE = 'update-progress-consumed.json';

/** Decode one record line; undefined for anything that is not a valid event. */
export function decodeProgressEvent(line: string): ProgressEvent | undefined {
  // STUB: naive parse — throws on a corrupt line.
  return JSON.parse(line) as ProgressEvent;
}

/** Reduce record lines to the progress state. */
export function reduceProgressLines(lines: readonly string[]): UpdateProgressState {
  // STUB: keeps every decoded event; no de-duplication and no ordering rule.
  const runs: RunRecord[] = [];
  const consumed: string[] = [];
  for (const line of lines) {
    const event = decodeProgressEvent(line);
    if (event === undefined) {
      continue;
    }
    const existing = runs.find((record) => record.run === event.run);
    if (existing === undefined) {
      runs.push({ run: event.run, events: [event], terminal: null });
    } else {
      (existing.events as ProgressEvent[]).push(event);
    }
  }
  return { runs, consumed };
}

/** Reduce raw record bytes (any bytes) to the progress state. */
export function reduceProgressBytes(bytes: Uint8Array): UpdateProgressState {
  return reduceProgressLines(new TextDecoder('utf-8').decode(bytes).split('\n'));
}

/** The terminal state the user has not been shown yet, if any. */
export function pendingSummary(state: UpdateProgressState): ProgressSummary | undefined {
  // STUB: any run at all renders.
  const record = state.runs[state.runs.length - 1];
  if (record === undefined) {
    return undefined;
  }
  return { run: record.run, status: 'ok', stage: null, message: '' };
}

/** Mark the pending run's terminal state consumed. */
export function consumeProgress(state: UpdateProgressState): UpdateProgressState {
  // STUB: no-op — the same state renders forever.
  return state;
}

/** The progress record path for one `userData` dir. */
export function updateProgressFilePath(userDataDir: string): string {
  // STUB: wrong file name.
  return `${userDataDir}/progress.ndjson`;
}

/** Load the record + marker from `userData`, fail-soft (missing = empty). */
export function loadProgressState(_userDataDir: string): UpdateProgressState {
  // STUB: never reads the record.
  return { runs: [], consumed: [] };
}

/** The run id already shown, from the marker file; undefined when absent. */
export function readConsumedRun(_userDataDir: string): string | undefined {
  // STUB: never reads the marker.
  return undefined;
}

/** Persist the consumed marker for one run; never throws. */
export function writeConsumedRun(_userDataDir: string, _run: string): void {
  // STUB: never persists the marker.
}

/** The dialog content for a finished run (success names the restart, failure
 * names the stage and the next action). */
export function progressDialogContent(summary: ProgressSummary): {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
} {
  return { title: 'Uniterra', message: 'Update', detail: summary.message };
}
