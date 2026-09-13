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

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
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

/** The four event kinds, for total decoding of foreign input. */
const EVENT_NAMES: ReadonlySet<string> = new Set<ProgressEventName>([
  'run-start',
  'stage-start',
  'stage-end',
  'run-end',
]);

/** Every install stage name, for total decoding of foreign input. */
const STAGE_NAMES: ReadonlySet<string> = new Set<InstallStage>([
  'update-cli',
  'build-install-app',
  'launch-app',
]);

/** Every outcome, for total decoding of foreign input. */
const OUTCOMES: ReadonlySet<string> = new Set<ProgressOutcome>(['ok', 'failed', 'dry-run']);

function isEventName(value: unknown): value is ProgressEventName {
  return typeof value === 'string' && EVENT_NAMES.has(value);
}

function isStage(value: unknown): value is InstallStage {
  return typeof value === 'string' && STAGE_NAMES.has(value);
}

function isOutcome(value: unknown): value is ProgressOutcome {
  return typeof value === 'string' && OUTCOMES.has(value);
}

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

/** The one control byte JSON.stringify leaves raw. */
const DEL = '\u007f';

/** Its JSON escape: JSON.parse turns this back into {@link DEL}. */
const DEL_ESCAPE = '\\u007f';

/** Encode one event as its single stdout line (no trailing newline).
 *
 * The key order IS the wire format (a golden vector on both sides of the
 * process boundary compares these bytes), and JSON.stringify escapes every C0
 * control byte, so an event line can never smuggle a raw newline or escape
 * byte into the stream. DEL is the one control byte JSON leaves raw, so it is
 * escaped here as its JSON escape — JSON.parse decodes that back to the same
 * character, which keeps the round trip exact. */
export function encodeProgressEvent(event: ProgressEvent): string {
  const json = JSON.stringify({
    v: event.v,
    run: event.run,
    seq: event.seq,
    at: event.at,
    event: event.event,
    stage: event.stage,
    status: event.status,
    message: event.message,
  });
  return PROGRESS_PREFIX + json.replaceAll(DEL, DEL_ESCAPE);
}

/** Decode one line back into an event; undefined when it is not an event line.
 *
 * Total: a foreign prefix, a truncated/oversized line, a missing key, an extra
 * key or a wrongly typed value all yield undefined instead of throwing. */
export function decodeProgressEvent(line: string): ProgressEvent | undefined {
  if (!line.startsWith(PROGRESS_PREFIX)) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(PROGRESS_PREFIX.length));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== PROGRESS_EVENT_KEYS.length) {
    return undefined;
  }
  for (const key of PROGRESS_EVENT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      return undefined;
    }
  }
  const { v, run, seq, at, event, stage, status, message } = record;
  if (v !== 1 || typeof run !== 'string' || typeof at !== 'string') {
    return undefined;
  }
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
    return undefined;
  }
  if (typeof message !== 'string' || !isEventName(event)) {
    return undefined;
  }
  if (stage !== null && !isStage(stage)) {
    return undefined;
  }
  if (status !== null && !isOutcome(status)) {
    return undefined;
  }
  return { v, run, seq, at, event, stage, status, message };
}

/** Whether a line is an event line (exact prefix match). */
export function isProgressLine(line: string): boolean {
  return line.startsWith(PROGRESS_PREFIX);
}

/** Split a mixed stream into event lines and human lines, both in order. */
export function partitionProgressLines(lines: readonly string[]): {
  readonly events: readonly string[];
  readonly human: readonly string[];
} {
  const events: string[] = [];
  const human: string[] = [];
  for (const line of lines) {
    (isProgressLine(line) ? events : human).push(line);
  }
  return { events, human };
}

/** How a stage is named inside a human line: the stage id the CLI, the events
 * and the desktop all share — a failed summary line must name the stage it
 * died in, not a paraphrase of it. */
function stageName(stage: InstallStage | null): string {
  return stage ?? 'the run';
}

/** Escape every C0 control byte and DEL as its JSON escape: a human line is
 * terminal text, and a raw escape byte would both colour the output and let a
 * crafted message rewrite the line it sits in. */
function escapeControlBytes(text: string): string {
  let escaped = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    escaped += code <= 0x1f || code === 0x7f ? `\\u${code.toString(16).padStart(4, '0')}` : char;
  }
  return escaped;
}

/** The human-readable line one event renders as.
 *
 * Structured, not just text: the property tests assert the shape (one init
 * line, one bracketing pair per stage, exactly one summary that names a failed
 * stage) and never the copy. */
export function humanLineFor(event: ProgressEvent): HumanLine {
  const stage = event.stage;
  const message = event.message;
  switch (event.event) {
    case 'run-start':
      return { kind: 'init', stage, status: event.status, text: `[INFO] ${message}` };
    case 'stage-start':
      return {
        kind: 'stage-start',
        stage,
        status: event.status,
        text: `[INFO] ${stageName(stage)}: starting`,
      };
    case 'stage-end':
      return {
        kind: 'stage-end',
        stage,
        status: event.status,
        text:
          `[${event.status === 'failed' ? 'FAIL' : ' OK '}] ${stageName(stage)}` +
          (message.length > 0 ? `: ${message}` : ''),
      };
    case 'run-end':
      if (event.status === 'failed') {
        return {
          kind: 'summary',
          stage,
          status: event.status,
          text: `[FAIL] ${stageName(stage)} failed: ${message}`,
        };
      }
      return {
        kind: 'summary',
        stage,
        status: event.status,
        text: `[${event.status === 'dry-run' ? 'DRY-RUN' : 'DONE'}] ${message}`,
      };
  }
}

/** Format a human line for the terminal: text only, never an ANSI escape, never
 * a control byte, and never something the event filter would mistake for an
 * event line — the sentinel is reserved for the machine-readable stream. */
export function formatHumanLine(line: HumanLine): string {
  const text = escapeControlBytes(line.text);
  return text.startsWith(PROGRESS_PREFIX) ? ` ${text}` : text;
}

/** The durable-record path from the environment, or undefined when unset.
 * An empty or whitespace-only value means "no record" — a shell that exported
 * the variable without a value must not create a file named after nothing, and
 * the surrounding whitespace of a real path is not part of the path. */
export function progressFilePath(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.UNITERRA_UPDATE_PROGRESS_FILE?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

/** Append-only durable sink; write failures warn and never fail the run.
 *
 * The record is the event stream, line for line: it is written synchronously
 * (so a later read — the desktop's next boot, or a test — sees exactly what the
 * stdout stream carried) and de-duplicated by `(run, seq)`, so a retried or
 * re-entrant emission can never append the same event twice. The parent
 * directory is created on the first write, never on construction: a sink that
 * is built but never used must leave the filesystem alone. */
export function createProgressFileSink(
  file: string,
  warn: (message: string) => void = (message) => {
    process.stderr.write(`uniterra: ${message}\n`);
  },
): ProgressSink {
  const written = new Set<string>();
  let parentReady = false;
  return {
    append: (line: string): void => {
      const event = decodeProgressEvent(line);
      const key = event === undefined ? undefined : `${event.run}#${String(event.seq)}`;
      if (key !== undefined && written.has(key)) {
        return;
      }
      try {
        if (!parentReady) {
          mkdirSync(dirname(file), { recursive: true });
          parentReady = true;
        }
        appendFileSync(file, `${line}\n`);
        if (key !== undefined) {
          written.add(key);
        }
      } catch (error) {
        warn(
          `could not append to the update progress record ${file}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
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
  let nextSeq = 0;
  return {
    run: options.run,
    get events(): readonly ProgressEvent[] {
      return events;
    },
    get humanLines(): readonly HumanLine[] {
      return humanLines;
    },
    event(name, stage, status, message): ProgressEvent {
      const event: ProgressEvent = {
        v: 1,
        run: options.run,
        seq: nextSeq,
        at: options.at(),
        event: name,
        stage,
        status,
        message,
      };
      nextSeq += 1;
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
