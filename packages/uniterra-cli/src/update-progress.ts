/**
 * Update progress events for the uniterra CLI (issue #15).
 *
 * Two outputs ride the same stdout:
 *  - the machine-readable NDJSON event stream: one line per event, every line
 *    starting with {@link PROGRESS_PREFIX}, and nothing else on that line;
 *  - the human-readable stage lines the terminal user reads.
 *
 * Every function here is pure: the clock (`at`) and the run id are injected by
 * the caller, so the encoder never reads a clock, an environment variable or a
 * TTY — which is what makes the invariants in `test/update-progress-pbt.test.mts`
 * expressible as functions of generated input.
 */

import { appendFileSync } from 'node:fs';
import type { InstallStage } from './install-logic.js';

/** The sentinel every event line starts with (trailing space included). No
 * human-readable line may start with it; a line starting with the sentinel IS
 * an event line, byte for byte. */
export const PROGRESS_PREFIX = '@uniterra ';

/** The exact key set of an encoded event: the schema is CLOSED — an encoder
 * that adds a key, or drops one, breaks the round trip. */
export const PROGRESS_EVENT_KEYS = [
  'v',
  'run',
  'seq',
  'at',
  'event',
  'stage',
  'status',
  'message',
] as const;

/** The four event kinds of one run. */
export type ProgressEventName = 'run-start' | 'stage-start' | 'stage-end' | 'run-end';

/** `ok`/`failed` come from a real stage outcome; `dry-run` only ever ends a run
 * that executed nothing. */
export type ProgressOutcome = 'ok' | 'failed' | 'dry-run';

/** One progress event. `seq` starts at 0 in every run and increments by exactly
 * one; `stage` is null only for run boundaries, `status` is null for
 * `run-start`/`stage-start`. */
export interface ProgressEvent {
  readonly v: 1;
  readonly run: string;
  readonly seq: number;
  readonly at: string;
  readonly event: ProgressEventName;
  readonly stage: InstallStage | null;
  readonly status: ProgressOutcome | null;
  readonly message: string;
}

/** What a human-readable line IS, independent of its wording: the property tests
 * assert on this structure, never on the copy. */
export type HumanLineKind = 'init' | 'stage-start' | 'stage-end' | 'summary';

export interface HumanLine {
  readonly kind: HumanLineKind;
  readonly stage: InstallStage | null;
  readonly status: ProgressOutcome | null;
  readonly text: string;
}

/** A durable record of the event stream (append-only). */
export interface ProgressSink {
  append(line: string): void;
}

export interface ProgressRecorderOptions {
  readonly run: string;
  /** Injected clock: called once per emitted event. */
  readonly at: () => string;
  /** Where event lines go (stdout in the CLI). */
  readonly emit: (line: string) => void;
  /** Where human-readable lines go (the formatted text plus its structure);
   * omitted in tests that only watch events. */
  readonly emitHuman?: (text: string, line: HumanLine) => void;
  /** Optional durable record; omitted when `UNITERRA_UPDATE_PROGRESS_FILE` is
   * unset or the run is a dry run. */
  readonly sink?: ProgressSink;
}

export interface ProgressRecorder {
  readonly run: string;
  readonly events: readonly ProgressEvent[];
  /** The structured human lines emitted so far, in order. */
  readonly humanLines: readonly HumanLine[];
  event(
    name: ProgressEventName,
    stage: InstallStage | null,
    status: ProgressOutcome | null,
    message: string,
  ): ProgressEvent;
  /** The initialization event: emitted before the first stage runs. */
  runStart(message: string): ProgressEvent;
  stageStart(stage: InstallStage): ProgressEvent;
  stageEnd(stage: InstallStage, status: 'ok' | 'failed', message: string): ProgressEvent;
  /** The single closing event; a failure carries the stage it died in. */
  runEnd(status: ProgressOutcome, stage: InstallStage | null, message: string): ProgressEvent;
}

/** Encode one event as its single stdout line (no trailing newline). */
export function encodeProgressEvent(event: ProgressEvent): string {
  // STUB: drops the status key — PROGRESS-SCHEMA must catch the missing key.
  return JSON.stringify({
    v: event.v,
    run: event.run,
    seq: event.seq,
    at: event.at,
    event: event.event,
    stage: event.stage,
    message: event.message,
  });
}

/** Decode one line back into an event; undefined when it is not an event line. */
export function decodeProgressEvent(line: string): ProgressEvent | undefined {
  // STUB: naive parse, no prefix check and no validation.
  return JSON.parse(line) as ProgressEvent;
}

/** Whether a line is an event line (exact prefix match). */
export function isProgressLine(line: string): boolean {
  // STUB: prefix without the trailing space.
  return line.startsWith('@uniterra');
}

/** Split a mixed stream into event lines and human lines, both in order. */
export function partitionProgressLines(lines: readonly string[]): {
  readonly events: readonly string[];
  readonly human: readonly string[];
} {
  // STUB: same near-miss prefix as isProgressLine.
  const events: string[] = [];
  const human: string[] = [];
  for (const line of lines) {
    (isProgressLine(line) ? events : human).push(line);
  }
  return { events, human };
}

/** The human-readable line one event renders as. */
export function humanLineFor(event: ProgressEvent): HumanLine {
  // STUB: every event renders as a summary line.
  return {
    kind: 'summary',
    stage: event.stage,
    status: event.status,
    text: `uniterra: ${event.message}`,
  };
}

/** Format a human line for the terminal (never an ANSI escape). */
export function formatHumanLine(line: HumanLine): string {
  return line.text;
}

/** The durable-record path from the environment, or undefined when unset. */
export function progressFilePath(env: NodeJS.ProcessEnv): string | undefined {
  // STUB: no trimming, no empty check.
  return env.UNITERRA_UPDATE_PROGRESS_FILE;
}

/** Append-only durable sink; write failures warn and never fail the run. */
export function createProgressFileSink(
  file: string,
  warn: (message: string) => void = (message) => {
    process.stderr.write(`uniterra: ${message}\n`);
  },
): ProgressSink {
  return {
    append: (line: string): void => {
      try {
        // STUB: no parent mkdir, no (run, seq) de-duplication.
        appendFileSync(file, `${line}\n`);
      } catch (error) {
        warn(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

/** Create the per-run recorder that assigns `seq` and writes both streams. */
export function createProgressRecorder(options: ProgressRecorderOptions): ProgressRecorder {
  const events: ProgressEvent[] = [];
  const humanLines: HumanLine[] = [];
  const emit = options.emit;
  const emitHuman = options.emitHuman ?? ((): void => undefined);
  const sink = options.sink;
  return {
    run: options.run,
    get events(): readonly ProgressEvent[] {
      return events;
    },
    get humanLines(): readonly HumanLine[] {
      return humanLines;
    },
    event(name, stage, status, message): ProgressEvent {
      // STUB: seq is always 0 and the human line is never written.
      const event: ProgressEvent = {
        v: 1,
        run: options.run,
        seq: 0,
        at: options.at(),
        event: name,
        stage,
        status,
        message,
      };
      events.push(event);
      const line = encodeProgressEvent(event);
      emit(line);
      sink?.append(line);
      const human = humanLineFor(event);
      humanLines.push(human);
      emitHuman(formatHumanLine(human), human);
      return event;
    },
    runStart(message): ProgressEvent {
      return this.event('run-start', null, null, message);
    },
    stageStart(stage): ProgressEvent {
      return this.event('stage-start', stage, null, '');
    },
    stageEnd(stage, status, message): ProgressEvent {
      return this.event('stage-end', stage, status, message);
    },
    runEnd(status, stage, message): ProgressEvent {
      return this.event('run-end', stage, status, message);
    },
  };
}
