/**
 * PBT suite for the CLI's update progress stream (`src/update-progress.ts`,
 * compiled dist) — the CLI half of issue #15.
 *
 * Business invariants locked here:
 *  - PROGRESS-SCHEMA: encode/decode are inverse and the event key set is CLOSED
 *    (no extra key, no missing key).
 *  - PROGRESS-SEQ: one run's seq starts at 0 and increments by exactly one.
 *  - PROGRESS-PARTITION: filtering the sentinel restores the event stream
 *    exactly, and no human line this module renders can be mistaken for one.
 *  - PROGRESS-NOANSI: no escape byte is emitted, whatever the TTY/NO_COLOR
 *    state says, and the bytes do not depend on it.
 *  - PROGRESS-SINK: the durable record is line-for-line the event stream, an
 *    unset variable or a dry run leaves zero file side effects, and a replayed
 *    (run, seq) is never written twice.
 *  - PROGRESS-PHASES: every executed stage brackets itself once, the run ends
 *    with exactly one summary line, and a failed run names its stage.
 *
 * The golden vector at the bottom is shared BYTE-FOR-BYTE with the desktop
 * decoder's suite (`packages/uniterra-desktop/test/update-progress-pbt.test.mjs`):
 * the two packages deliberately share no module (neither may depend on the
 * other), so those literal lines ARE the cross-package contract and either side
 * fails by name when the schema drifts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { InstallStage } from '../dist/install-logic.js';
import {
  PROGRESS_EVENT_KEYS,
  PROGRESS_PREFIX,
  createProgressFileSink,
  createProgressRecorder,
  decodeProgressEvent,
  encodeProgressEvent,
  formatHumanLine,
  humanLineFor,
  partitionProgressLines,
  progressFilePath,
  type HumanLine,
  type ProgressEvent,
  type ProgressOutcome,
} from '../dist/update-progress.js';

const runFile = promisify(execFile);

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const stageArb = fc.constantFrom<InstallStage>('update-cli', 'build-install-app', 'launch-app');
const statusArb = fc.constantFrom<ProgressOutcome>('ok', 'failed', 'dry-run');

/** Messages are the point of a closed schema: empty, huge, multi-line, JSON
 * shaped, sentinel shaped, non-BMP, raw control bytes and raw escape bytes all
 * travel through it. */
const messageArb = fc.oneof(
  { weight: 3, arbitrary: fc.string({ maxLength: 40 }) },
  { weight: 1, arbitrary: fc.string({ unit: 'binary', maxLength: 40 }) },
  { weight: 1, arbitrary: fc.constant('') },
  { weight: 1, arbitrary: fc.constant('line one\nline two') },
  { weight: 1, arbitrary: fc.constant('@@uniterra {"run":"x"}') },
  { weight: 1, arbitrary: fc.constant('\u001b[33mnot really colour\u001b[0m') },
  { weight: 1, arbitrary: fc.string({ minLength: 2000, maxLength: 2000 }) },
  { weight: 1, arbitrary: fc.constant('emoji 🐳 and 中文 and \u0000 nul') },
);

const eventArb: fc.Arbitrary<ProgressEvent> = fc.record({
  v: fc.constant(1 as const),
  run: fc.string({ minLength: 1, maxLength: 12 }),
  seq: fc.nat({ max: 9999 }),
  at: fc.string({ maxLength: 30 }),
  event: fc.constantFrom<ProgressEvent['event']>(
    'run-start',
    'stage-start',
    'stage-end',
    'run-end',
  ),
  stage: fc.option(stageArb, { nil: null }),
  status: fc.option(statusArb, { nil: null }),
  message: messageArb,
});

/** Human lines must never start with the sentinel — including near misses. */
const humanLineArb = fc.oneof(
  { weight: 4, arbitrary: fc.string({ maxLength: 30 }) },
  { weight: 1, arbitrary: fc.constant('') },
  { weight: 1, arbitrary: fc.constant('@@uniterra') },
  { weight: 1, arbitrary: fc.constant('@@uniterr {"v":1}') },
  { weight: 1, arbitrary: fc.constant(' @@uniterra {"v":1}') },
  // Near misses of the sentinel itself: a filter that matches the sentinel
  // WITHOUT its trailing space eats these.
  { weight: 1, arbitrary: fc.constant('@uniterra') },
  { weight: 1, arbitrary: fc.constant('@uniterra-not-an-event') },
  { weight: 1, arbitrary: fc.constant('@uniterrax') },
  { weight: 1, arbitrary: fc.constant('{"v":1,"event":"run-end"}') },
);

/** One captured recorder run: the emitted event lines and human lines, plus the
 * structured human lines the property assertions read. */
interface CapturedRun {
  readonly recorder: ReturnType<typeof createProgressRecorder>;
  readonly eventLines: string[];
  readonly humanText: string[];
  readonly humanLines: HumanLine[];
}

function makeRecorder(run: string, sink?: { append(line: string): void }): CapturedRun {
  const eventLines: string[] = [];
  const humanText: string[] = [];
  const humanLines: HumanLine[] = [];
  let tick = 0;
  const recorder = createProgressRecorder({
    run,
    at: () => new Date(Date.UTC(2026, 8, 13, 0, 0, tick++)).toISOString(),
    emit: (line) => eventLines.push(line),
    emitHuman: (text, line) => {
      humanText.push(text);
      humanLines.push(line);
    },
    ...(sink === undefined ? {} : { sink }),
  });
  return { recorder, eventLines, humanText, humanLines };
}

/** Drive one full, well-formed run over the given stages. */
function driveRun(
  captured: CapturedRun,
  stages: readonly InstallStage[],
  outcome: 'ok' | 'failed' = 'ok',
): void {
  const { recorder } = captured;
  recorder.runStart('starting');
  for (const stage of stages) {
    recorder.stageStart(stage);
    recorder.stageEnd(stage, 'ok', `${stage} done`);
  }
  const failedStage = stages[stages.length - 1];
  recorder.runEnd(
    outcome,
    outcome === 'failed' && failedStage !== undefined ? failedStage : null,
    'end',
  );
}

/** The record's lines, or an empty list when the record was never written — so
 * a missing durable record fails as an assertion, not as an ENOENT. */
async function recordLines(file: string): Promise<string[]> {
  try {
    return (await readFile(file, 'utf8')).split('\n').filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

async function withTempRoot<T>(body: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'uniterra-progress-'));
  try {
    return await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// PROGRESS-SCHEMA / PROGRESS-SEQ
// ---------------------------------------------------------------------------

test('PROGRESS-SCHEMA: encoding is decoded back to the same event with an exact key set', () => {
  fc.assert(
    fc.property(eventArb, (event) => {
      const line = encodeProgressEvent(event);
      assert.ok(
        line.startsWith(PROGRESS_PREFIX),
        `every event line carries the sentinel: ${JSON.stringify(line.slice(0, 40))}`,
      );
      assert.ok(!line.includes('\n'), 'an event line is exactly one line');
      const decoded = decodeProgressEvent(line);
      assert.notEqual(decoded, undefined, `decoding must succeed for ${line.slice(0, 60)}`);
      assert.deepEqual(decoded, event);
      assert.deepEqual(Object.keys(decoded ?? {}).sort(), [...PROGRESS_EVENT_KEYS].sort());
      assert.deepEqual(Object.keys(event).sort(), [...PROGRESS_EVENT_KEYS].sort());
    }),
    { numRuns: 300 },
  );
});

test('PROGRESS-SEQ: seq starts at 0 and increments by exactly one per run', () => {
  fc.assert(
    fc.property(fc.array(stageArb, { maxLength: 6 }), (stages) => {
      const captured = makeRecorder('run-1');
      driveRun(captured, stages);
      const seqs = captured.recorder.events.map((event) => event.seq);
      assert.deepEqual(
        seqs,
        seqs.map((_, index) => index),
        'seq is 0..n-1 with no hole and no repeat',
      );
      const emitted = captured.eventLines.map(
        (line) => (JSON.parse(line.slice(PROGRESS_PREFIX.length)) as { seq: number }).seq,
      );
      assert.deepEqual(emitted, seqs, 'the stdout lines carry the same seq sequence');
      const runs = new Set(captured.recorder.events.map((event) => event.run));
      assert.deepEqual([...runs], ['run-1'], 'one CLI invocation is exactly one run');
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// PROGRESS-PARTITION
// ---------------------------------------------------------------------------

test('PROGRESS-PARTITION: filtering the sentinel restores the event stream exactly', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.oneof(
          eventArb.map((event) => encodeProgressEvent(event)),
          humanLineArb,
        ),
        {
          maxLength: 24,
        },
      ),
      (mixed) => {
        const { events, human } = partitionProgressLines(mixed);
        assert.deepEqual(
          events,
          mixed.filter((line) => line.startsWith(PROGRESS_PREFIX)),
        );
        assert.deepEqual(
          human,
          mixed.filter((line) => !line.startsWith(PROGRESS_PREFIX)),
        );
        assert.equal(events.length + human.length, mixed.length, 'nothing is dropped');
        assert.ok(human.every((line) => !line.startsWith(PROGRESS_PREFIX)));
        for (const line of events) {
          assert.notEqual(decodeProgressEvent(line), undefined);
        }
      },
    ),
    { numRuns: 200 },
  );
});

test('PROGRESS-PARTITION: no human line rendered from an event can look like one', () => {
  fc.assert(
    fc.property(eventArb, (event) => {
      const text = formatHumanLine(humanLineFor(event));
      assert.ok(
        !text.startsWith(PROGRESS_PREFIX),
        `a human line must never carry the event sentinel: ${text.slice(0, 60)}`,
      );
      assert.deepEqual(partitionProgressLines([text]).events, []);
    }),
    { numRuns: 200 },
  );
});

// ---------------------------------------------------------------------------
// PROGRESS-NOANSI
// ---------------------------------------------------------------------------

/** Run `body` with the process-level style signals forced to one combination,
 * then restore them: the emitted bytes must not depend on any of them. */
function withProcessStyle<T>(isTTY: boolean, noColor: boolean, body: () => T): T {
  const hadNoColor = Object.prototype.hasOwnProperty.call(process.env, 'NO_COLOR');
  const previousNoColor = process.env.NO_COLOR;
  const previousIsTTY = process.stdout.isTTY;
  try {
    process.stdout.isTTY = isTTY;
    if (noColor) {
      process.env.NO_COLOR = '1';
    } else {
      delete process.env.NO_COLOR;
    }
    return body();
  } finally {
    process.stdout.isTTY = previousIsTTY;
    if (hadNoColor) {
      process.env.NO_COLOR = previousNoColor;
    } else {
      delete process.env.NO_COLOR;
    }
  }
}

/** Any C0 control byte or DEL: none may reach either stream. */
const CONTROL_BYTE = /[\u0000-\u001f\u007f]/;

test('PROGRESS-NOANSI: no escape byte is ever emitted, TTY or not', () => {
  const combos = [
    { isTTY: true, noColor: false },
    { isTTY: true, noColor: true },
    { isTTY: false, noColor: false },
    { isTTY: false, noColor: true },
  ];
  fc.assert(
    fc.property(fc.array(eventArb, { maxLength: 8 }), (events) => {
      const rendered = combos.map((combo) =>
        withProcessStyle(combo.isTTY, combo.noColor, () =>
          events
            .map(
              (event) => `${encodeProgressEvent(event)}\n${formatHumanLine(humanLineFor(event))}`,
            )
            .join('\n'),
        ),
      );
      assert.equal(
        new Set(rendered).size,
        1,
        'the emitted bytes must not depend on isTTY or NO_COLOR',
      );
      for (const text of rendered) {
        assert.ok(!text.includes('\u001b'), 'no ANSI escape byte may reach the stream');
        assert.ok(!CONTROL_BYTE.test(text), 'no control byte may reach the stream');
      }
    }),
    { numRuns: 150 },
  );
});

// ---------------------------------------------------------------------------
// PROGRESS-SINK
// ---------------------------------------------------------------------------

const recordPathArb = fc.oneof(
  { weight: 2, arbitrary: fc.constant('progress.ndjson') },
  { weight: 2, arbitrary: fc.constant('deep/nested/inside/progress.ndjson') },
  { weight: 2, arbitrary: fc.constant('空 白 目錄/進 度.ndjson') },
  {
    weight: 1,
    arbitrary: fc
      .tuple(fc.stringMatching(/^[a-z]{1,6}$/u), fc.stringMatching(/^[a-z]{1,6}$/u))
      .map(([dir, name]) => `${dir}/${name}.ndjson`),
  },
);

test('PROGRESS-SINK: the durable record is line-for-line the event stream', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(stageArb, { maxLength: 5 }),
      recordPathArb,
      async (stages, relative) => {
        await withTempRoot(async (root) => {
          const file = join(root, relative);
          const captured = makeRecorder('run-sink', createProgressFileSink(file));
          driveRun(captured, stages);
          const lines = await recordLines(file);
          assert.deepEqual(lines, captured.eventLines, 'the record is line-for-line the stream');
          assert.ok(lines.every((line) => line.startsWith(PROGRESS_PREFIX)));
        });
      },
    ),
    { numRuns: 25 },
  );
});

test('PROGRESS-SINK: a replayed (run, seq) is never written twice', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(stageArb, { maxLength: 4 }), async (stages) => {
      await withTempRoot(async (root) => {
        const file = join(root, 'replay.ndjson');
        const sink = createProgressFileSink(file);
        const first = makeRecorder('run-replay', sink);
        driveRun(first, stages);
        // The same run id re-emits the same events (a retried stage, a
        // re-entrant call): the record stays a set of (run, seq).
        const second = makeRecorder('run-replay', sink);
        driveRun(second, stages);
        const lines = (await readFile(file, 'utf8')).split('\n').filter((line) => line.length > 0);
        assert.deepEqual(lines, first.eventLines, 'the replay adds nothing');
        const keys = lines.map((line) => {
          const parsed = JSON.parse(line.slice(PROGRESS_PREFIX.length)) as {
            run: string;
            seq: number;
          };
          return `${parsed.run}#${String(parsed.seq)}`;
        });
        assert.equal(new Set(keys).size, keys.length, 'no (run, seq) is written twice');
      });
    }),
    { numRuns: 20 },
  );
});

test('PROGRESS-SINK: unset or dry-run leaves zero file side effects', async () => {
  // (a) unset: no path resolves, and a recorder without a sink writes nothing.
  assert.equal(progressFilePath({}), undefined);
  assert.equal(progressFilePath({ UNITERRA_UPDATE_PROGRESS_FILE: '' }), undefined);
  assert.equal(progressFilePath({ UNITERRA_UPDATE_PROGRESS_FILE: '   ' }), undefined);
  assert.equal(
    progressFilePath({ UNITERRA_UPDATE_PROGRESS_FILE: ' /tmp/x.ndjson ' }),
    '/tmp/x.ndjson',
  );
  await withTempRoot(async (root) => {
    const captured = makeRecorder('run-nosink');
    driveRun(captured, ['build-install-app']);
    assert.deepEqual(await readdir(root), [], 'no sink, no file');
  });

  // (b) a REAL dry run: the CLI streams its events and creates nothing.
  await withTempRoot(async (root) => {
    const target = join(root, 'nested', 'update-progress.ndjson');
    const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
    const result = await runFile(process.execPath, [cli, 'update', '--dry-run'], {
      env: { ...process.env, UNITERRA_UPDATE_PROGRESS_FILE: target },
    });
    const lines = result.stdout.split('\n').filter((line) => line.length > 0);
    const eventLines = lines.filter((line) => line.startsWith(PROGRESS_PREFIX));
    assert.ok(eventLines.length >= 2, `the dry run streams events, got: ${result.stdout}`);
    const events = eventLines.map((line) => decodeProgressEvent(line));
    assert.deepEqual(
      events.map((event) => event?.event),
      ['run-start', 'run-end'],
    );
    assert.equal(events[1]?.status, 'dry-run');
    assert.ok(!existsSync(target), 'a dry run must not create the record');
    assert.ok(!existsSync(join(root, 'nested')), 'a dry run must not create the parent dir');
  });
});

// ---------------------------------------------------------------------------
// PROGRESS-PHASES
// ---------------------------------------------------------------------------

test('PROGRESS-PHASES: every executed stage brackets itself and the run ends once', () => {
  fc.assert(
    fc.property(
      fc.array(stageArb, { minLength: 1, maxLength: 6 }),
      fc.boolean(),
      (stages, fails) => {
        const captured = makeRecorder('run-phases');
        driveRun(captured, stages, fails ? 'failed' : 'ok');
        const lines = captured.humanLines;
        assert.ok(lines.length > 0);
        assert.equal(lines[0]?.kind, 'init', 'the run announces itself before any stage');
        assert.equal(
          lines.filter((line) => line.kind === 'init').length,
          1,
          'exactly one initialization line',
        );
        const summaries = lines.filter((line) => line.kind === 'summary');
        assert.equal(summaries.length, 1, 'exactly one summary line per run');
        assert.equal(lines[lines.length - 1]?.kind, 'summary', 'the summary closes the run');
        assert.equal(summaries[0]?.status, fails ? 'failed' : 'ok');
        if (fails) {
          assert.equal(
            summaries[0]?.stage,
            stages[stages.length - 1],
            'a failed run names the stage it died in',
          );
        }

        for (const stage of stages) {
          const forStage = lines.filter((line) => line.stage === stage);
          assert.equal(
            forStage.filter((line) => line.kind === 'stage-start').length,
            1,
            `${stage} starts exactly once`,
          );
          assert.equal(
            forStage.filter((line) => line.kind === 'stage-end').length,
            1,
            `${stage} ends exactly once`,
          );
          const start = lines.findIndex(
            (line) => line.stage === stage && line.kind === 'stage-start',
          );
          const end = lines.findIndex((line) => line.stage === stage && line.kind === 'stage-end');
          assert.ok(start < end, `${stage} is bracketed in order`);
        }

        const bracketed = lines
          .filter((line) => line.kind === 'stage-start')
          .map((line) => line.stage);
        assert.deepEqual(bracketed, [...stages], 'the brackets follow the executed stages');
        assert.equal(captured.humanText.length, lines.length, 'every human line was written');
        for (const text of captured.humanText) {
          assert.ok(!text.startsWith(PROGRESS_PREFIX));
        }
      },
    ),
    { numRuns: 150 },
  );
});

// ---------------------------------------------------------------------------
// The cross-package golden vector (mirrored byte-for-byte in the desktop suite)
// ---------------------------------------------------------------------------

const GOLDEN_EVENTS: readonly ProgressEvent[] = [
  {
    v: 1,
    run: 'b7f3c0d2-0000-4000-8000-000000000001',
    seq: 0,
    at: '2026-09-13T00:00:00.000Z',
    event: 'run-start',
    stage: null,
    status: null,
    message: 'updating: CLI, then app rebuild + reinstall, then relaunch',
  },
  {
    v: 1,
    run: 'b7f3c0d2-0000-4000-8000-000000000001',
    seq: 1,
    at: '2026-09-13T00:00:01.000Z',
    event: 'stage-start',
    stage: 'update-cli',
    status: null,
    message: '',
  },
  {
    v: 1,
    run: 'b7f3c0d2-0000-4000-8000-000000000001',
    seq: 2,
    at: '2026-09-13T00:00:02.000Z',
    event: 'stage-end',
    stage: 'update-cli',
    status: 'ok',
    message: 'CLI updated',
  },
  {
    v: 1,
    run: 'b7f3c0d2-0000-4000-8000-000000000001',
    seq: 3,
    at: '2026-09-13T00:00:03.000Z',
    event: 'run-end',
    stage: null,
    status: 'ok',
    message: 'the app was relaunched',
  },
];

const GOLDEN_LINES: readonly string[] = [
  '@uniterra {"v":1,"run":"b7f3c0d2-0000-4000-8000-000000000001","seq":0,"at":"2026-09-13T00:00:00.000Z","event":"run-start","stage":null,"status":null,"message":"updating: CLI, then app rebuild + reinstall, then relaunch"}',
  '@uniterra {"v":1,"run":"b7f3c0d2-0000-4000-8000-000000000001","seq":1,"at":"2026-09-13T00:00:01.000Z","event":"stage-start","stage":"update-cli","status":null,"message":""}',
  '@uniterra {"v":1,"run":"b7f3c0d2-0000-4000-8000-000000000001","seq":2,"at":"2026-09-13T00:00:02.000Z","event":"stage-end","stage":"update-cli","status":"ok","message":"CLI updated"}',
  '@uniterra {"v":1,"run":"b7f3c0d2-0000-4000-8000-000000000001","seq":3,"at":"2026-09-13T00:00:03.000Z","event":"run-end","stage":null,"status":"ok","message":"the app was relaunched"}',
];

test('PROGRESS-SCHEMA regression: the shared golden vector is byte-exact', () => {
  assert.equal(GOLDEN_LINES.length, GOLDEN_EVENTS.length);
  GOLDEN_EVENTS.forEach((event, index) => {
    const line = GOLDEN_LINES[index];
    assert.notEqual(line, undefined);
    assert.equal(
      encodeProgressEvent(event),
      line,
      'the encoded bytes are the cross-package contract; the desktop suite pins the same literals',
    );
    assert.deepEqual(decodeProgressEvent(line ?? ''), event);
  });
  assert.deepEqual(partitionProgressLines(GOLDEN_LINES).events, [...GOLDEN_LINES]);
  assert.deepEqual(partitionProgressLines(GOLDEN_LINES).human, []);
});
