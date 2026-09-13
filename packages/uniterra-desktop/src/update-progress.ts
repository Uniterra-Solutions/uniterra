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
 *
 * The reduction is deliberately monotone and idempotent rather than
 * last-write-wins: a run accepts an event only when its `seq` is strictly
 * greater than the highest `seq` already accepted for that run. A replayed or
 * duplicated line therefore changes nothing, and an out-of-order replay can
 * never complete more than the ordered fold.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The sentinel every event line starts with (trailing space included); no
 * human-readable line starts with it. Mirrors the CLI's `PROGRESS_PREFIX` — the
 * two packages share the wire format (pinned by the byte-exact golden vector in
 * both suites), not a module. */
export const UPDATE_PROGRESS_PREFIX = '@uniterra ';

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

/** The 8 keys of an encoded event, in wire order. The schema is CLOSED: a line
 * that carries any other key set is not an event line. */
const PROGRESS_EVENT_KEYS = [
  'v',
  'run',
  'seq',
  'at',
  'event',
  'stage',
  'status',
  'message',
] as const;

const EVENT_NAMES: readonly ProgressEventName[] = [
  'run-start',
  'stage-start',
  'stage-end',
  'run-end',
];

const STAGE_NAMES: readonly UpdateStage[] = ['update-cli', 'build-install-app', 'launch-app'];

const OUTCOMES: readonly ProgressOutcome[] = ['ok', 'failed', 'dry-run'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEventName(value: unknown): value is ProgressEventName {
  return EVENT_NAMES.some((name) => name === value);
}

function isStage(value: unknown): value is UpdateStage {
  return STAGE_NAMES.some((stage) => stage === value);
}

function isOutcome(value: unknown): value is ProgressOutcome {
  return OUTCOMES.some((outcome) => outcome === value);
}

function markerPath(userDataDir: string): string {
  return join(userDataDir, UPDATE_PROGRESS_CONSUMED_FILE);
}

function emptyState(): UpdateProgressState {
  return { runs: [], consumed: [] };
}

/** Decode one record line; undefined for anything that is not a valid event. */
export function decodeProgressEvent(line: string): ProgressEvent | undefined {
  if (!line.startsWith(UPDATE_PROGRESS_PREFIX)) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(UPDATE_PROGRESS_PREFIX.length));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const keys = Object.keys(parsed);
  if (keys.length !== PROGRESS_EVENT_KEYS.length) {
    return undefined;
  }
  for (const key of PROGRESS_EVENT_KEYS) {
    if (!Object.hasOwn(parsed, key)) {
      return undefined;
    }
  }
  const { v, run, seq, at, event, stage, status, message } = parsed;
  if (v !== 1 || typeof run !== 'string' || typeof at !== 'string') {
    return undefined;
  }
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
    return undefined;
  }
  if (!isEventName(event)) {
    return undefined;
  }
  if (stage !== null && !isStage(stage)) {
    return undefined;
  }
  if (status !== null && !isOutcome(status)) {
    return undefined;
  }
  if (typeof message !== 'string') {
    return undefined;
  }
  return { v: 1, run, seq, at, event, stage, status, message };
}

/** The in-flight accumulator for one run: accepted events plus the highest
 * `seq` seen, which is what makes replay and duplication no-ops. */
interface RunAccumulator {
  readonly run: string;
  readonly events: ProgressEvent[];
  highestSeq: number;
  terminal: ProgressEvent | null;
}

/** Reduce record lines to the progress state. */
export function reduceProgressLines(lines: readonly string[]): UpdateProgressState {
  const order: RunAccumulator[] = [];
  const byRun = new Map<string, RunAccumulator>();
  for (const line of lines) {
    // Decoding is total by contract; the guard keeps the reducer total even if
    // a future decoder regresses.
    let event: ProgressEvent | undefined;
    try {
      event = decodeProgressEvent(line);
    } catch {
      event = undefined;
    }
    if (event === undefined) {
      continue;
    }
    let target = byRun.get(event.run);
    if (target === undefined) {
      target = { run: event.run, events: [], highestSeq: -1, terminal: null };
      byRun.set(event.run, target);
      order.push(target);
    } else if (event.seq <= target.highestSeq) {
      // Monotone acceptance: an event that is not strictly newer than the last
      // accepted one for this run can never move the state backwards.
      continue;
    }
    target.highestSeq = event.seq;
    target.events.push(event);
    if (event.event === 'run-end') {
      target.terminal = event;
    }
  }
  return {
    runs: order.map((record) => ({
      run: record.run,
      events: record.events,
      terminal: record.terminal,
    })),
    consumed: [],
  };
}

/** Reduce raw record bytes (any bytes) to the progress state. */
export function reduceProgressBytes(bytes: Uint8Array): UpdateProgressState {
  try {
    return reduceProgressLines(new TextDecoder('utf-8').decode(bytes).split('\n'));
  } catch {
    return emptyState();
  }
}

/** The terminal state the user has not been shown yet, if any. Only the LATEST
 * run is ever reported: an older run's outcome was superseded by the newer
 * update, and re-showing it would report history rather than a result. */
export function pendingSummary(state: UpdateProgressState): ProgressSummary | undefined {
  const record = state.runs[state.runs.length - 1];
  if (record === undefined) {
    return undefined;
  }
  const terminal = record.terminal;
  if (terminal === null) {
    return undefined;
  }
  // Only a real update outcome is worth a dialog; a dry run did nothing.
  if (terminal.status !== 'ok' && terminal.status !== 'failed') {
    return undefined;
  }
  if (state.consumed.includes(record.run)) {
    return undefined;
  }
  return {
    run: record.run,
    status: terminal.status,
    stage: terminal.stage,
    message: terminal.message,
  };
}

/** Mark the pending run's terminal state consumed. */
export function consumeProgress(state: UpdateProgressState): UpdateProgressState {
  const summary = pendingSummary(state);
  if (summary === undefined) {
    return state;
  }
  const consumed = [...new Set([...state.consumed, summary.run])].sort();
  return { runs: state.runs, consumed };
}

/** The progress record path for one `userData` dir. */
export function updateProgressFilePath(userDataDir: string): string {
  return join(userDataDir, UPDATE_PROGRESS_FILE);
}

/** Load the record + marker from `userData`, fail-soft (missing = empty). */
export function loadProgressState(userDataDir: string): UpdateProgressState {
  try {
    const record = reduceProgressBytes(readFileSync(updateProgressFilePath(userDataDir)));
    const consumedRun = readConsumedRun(userDataDir);
    return {
      runs: record.runs,
      consumed: consumedRun === undefined ? [] : [consumedRun],
    };
  } catch {
    return emptyState();
  }
}

/** The run id already shown, from the marker file; undefined when absent. */
export function readConsumedRun(userDataDir: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(markerPath(userDataDir), 'utf8'));
    if (typeof parsed === 'string') {
      return parsed.length > 0 ? parsed : undefined;
    }
    if (isRecord(parsed) && typeof parsed.run === 'string' && parsed.run.length > 0) {
      return parsed.run;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Persist the consumed marker for one run; never throws. Only the most recent
 * consumption has to survive: an older run is never the latest run again, so a
 * single-slot marker is enough to make the next boot silent. */
export function writeConsumedRun(userDataDir: string, run: string): void {
  try {
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(markerPath(userDataDir), `${JSON.stringify({ run }, null, 2)}\n`);
  } catch (error) {
    console.warn(`[uniterra] failed to persist the update-progress marker: ${String(error)}`);
  }
}

/** The dialog content for a finished run (success names the restart, failure
 * names the stage and the next action). */
export function progressDialogContent(summary: ProgressSummary): {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
} {
  switch (summary.status) {
    case 'ok':
      return {
        title: 'Uniterra updated',
        message: 'The update finished and Uniterra was relaunched.',
        detail: `The updater refreshed the CLI, rebuilt and reinstalled the app, then restarted it.${
          summary.message.length > 0 ? `\n\n${summary.message}` : ''
        }`,
      };
    case 'failed':
      return {
        title: 'Uniterra update failed',
        message:
          summary.stage === null
            ? 'The update did not finish.'
            : `The update failed in the "${summary.stage}" stage.`,
        detail: `${
          summary.message.length > 0 ? summary.message : 'No further detail was recorded.'
        }\n\nRetry the update by running "uniterra update" in a terminal, or download the latest release from the Uniterra releases page and install it again.`,
      };
    case 'dry-run':
      return {
        title: 'Uniterra update',
        message: 'The update ran in dry-run mode; nothing was changed.',
        detail:
          summary.message.length > 0
            ? summary.message
            : 'No stage was executed, so there is nothing to report.',
      };
  }
}
