/**
 * PBT suite for the desktop's update-progress decoder/reducer (issue #15,
 * `src/update-progress.ts` + `src/update-launch.ts`, compiled dist).
 *
 * Business invariants locked here:
 *  - PROGRESS-TOTAL: bytes are hostile input — a truncated line, a non-UTF-8
 *    byte, a foreign prefix or a NUL must be ignored, never thrown.
 *  - PROGRESS-MONO: a completed stage never regresses, whatever order the
 *    events are replayed in, and any prefix of the record is an earlier state.
 *  - PROGRESS-IDEMPOTENT: a duplicated `(run, seq)` changes nothing.
 *  - PROGRESS-RENDER-ONCE: a terminal state renders exactly once — a record
 *    without a terminal state (or an unreadable one) renders NOTHING at all.
 *  - PROGRESS-SINK: the updater is spawned with the progress record path under
 *    the app's userData, so the running update reports back to the next boot.
 *
 * The golden vector is shared BYTE-FOR-BYTE with the CLI encoder's suite
 * (`packages/uniterra-cli/test/update-progress-pbt.test.mts`): the two packages
 * share no module, so those literals are the wire contract.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  UPDATE_PROGRESS_FILE,
  consumeProgress,
  decodeProgressEvent,
  loadProgressState,
  pendingSummary,
  progressDialogContent,
  reduceProgressBytes,
  reduceProgressLines,
  updateProgressFilePath,
  writeConsumedRun,
} from '../dist/update-progress.js';
import { spawnUpdater } from '../dist/update-launch.js';

// ---------------------------------------------------------------------------
// The wire format (mirrored from the CLI encoder; pinned by the golden vector)
// ---------------------------------------------------------------------------

const STAGES = ['update-cli', 'build-install-app', 'launch-app'];

/** One event line exactly as the CLI writes it: sentinel, then the 8 keys in
 * `PROGRESS_EVENT_KEYS` order. */
function encode(event) {
  return `@@uniterra ${JSON.stringify({
    v: event.v,
    run: event.run,
    seq: event.seq,
    at: event.at,
    event: event.event,
    stage: event.stage,
    status: event.status,
    message: event.message,
  })}`;
}

/** A well-formed run over the given stages; `terminal` adds the run-end event. */
function runEvents(run, stages, { terminal = true, outcome = 'ok' } = {}) {
  const events = [];
  let seq = 0;
  const push = (event, stage, status, message) => {
    events.push({
      v: 1,
      run,
      seq: seq++,
      at: `2026-09-13T00:00:0${String(seq % 10)}.000Z`,
      event,
      stage,
      status,
      message,
    });
  };
  push('run-start', null, null, 'starting');
  for (const stage of stages) {
    push('stage-start', stage, null, '');
    push('stage-end', stage, 'ok', `${stage} done`);
  }
  if (terminal) {
    push(
      'run-end',
      outcome === 'failed' ? (stages[stages.length - 1] ?? null) : null,
      outcome,
      'end',
    );
  }
  return events;
}

const stagesArb = fc.array(fc.constantFrom(...STAGES), { maxLength: 4 });

/** State projections read through the public API only. */
function lastRun(state) {
  return state.runs[state.runs.length - 1] ?? null;
}

function endedStages(state) {
  const run = lastRun(state);
  if (run === null) {
    return new Set();
  }
  return new Set(
    run.events.filter((event) => event.event === 'stage-end').map((event) => event.stage),
  );
}

async function withTempDir(body) {
  const dir = await mkdtemp(join(tmpdir(), 'uniterra-update-progress-'));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// PROGRESS-TOTAL
// ---------------------------------------------------------------------------

test('PROGRESS-TOTAL: the reducer is total over arbitrary bytes', () => {
  fc.assert(
    fc.property(fc.uint8Array({ maxLength: 400 }), (bytes) => {
      let state;
      assert.doesNotThrow(
        () => {
          state = reduceProgressBytes(bytes);
        },
        `reducing ${String(bytes.length)} arbitrary bytes must never throw`,
      );
      assert.ok(Array.isArray(state.runs));
      assert.ok(Array.isArray(state.consumed));
    }),
    { numRuns: 300 },
  );

  // Deliberately hostile shapes, each one line-level.
  const hostile = [
    Buffer.from([0x00, 0xff, 0xfe, 0x1b]),
    Buffer.from('@uniterra ', 'utf8'),
    Buffer.from('@uniterra {', 'utf8'),
    Buffer.from('@uniterra {"v":1,"run":"r","seq":0,"at":"x","event":"stage-end",', 'utf8'),
    Buffer.from('@uniterra {"v":1,"run":"r","seq":"zero","at":"x","event":"run-end"}', 'utf8'),
    Buffer.from('@uniterra {"v":1,"run":"r","seq":0,"at":"x","event":"nonsense"}', 'utf8'),
    Buffer.from('uniterra-ish garbage\n\n', 'utf8'),
    Buffer.from('', 'utf8'),
  ];
  for (const bytes of hostile) {
    const state = reduceProgressBytes(bytes);
    assert.deepEqual(state.runs, [], `${bytes.toString('utf8')} decodes to no run`);
  }
});

// ---------------------------------------------------------------------------
// PROGRESS-MONO / PROGRESS-IDEMPOTENT
// ---------------------------------------------------------------------------

test('PROGRESS-MONO: replayed out-of-order events never regress the state', async () => {
  const swapArb = (length) =>
    fc.array(
      fc.tuple(
        fc.integer({ min: 0, max: Math.max(0, length - 1) }),
        fc.integer({ min: 0, max: Math.max(0, length - 1) }),
      ),
      { maxLength: 8 },
    );

  await fc.assert(
    fc.asyncProperty(
      stagesArb.chain((stages) => {
        const lines = runEvents('run-mono', stages).map(encode);
        return fc.tuple(fc.constant(lines), swapArb(lines.length));
      }),
      async ([lines, swaps]) => {
        const orderedEnded = endedStages(reduceProgressLines(lines));
        const orderedTerminal = lastRun(reduceProgressLines(lines))?.terminal ?? null;

        // Prefix closure: every prefix is an EARLIER state of the full record.
        let seen = new Set();
        for (let end = 0; end <= lines.length; end += 1) {
          const ended = endedStages(reduceProgressLines(lines.slice(0, end)));
          for (const stage of seen) {
            assert.ok(ended.has(stage), `a completed stage never regresses (${stage})`);
          }
          seen = ended;
        }
        for (const stage of seen) {
          assert.ok(orderedEnded.has(stage), 'a prefix never completes more than the whole');
        }

        // An arbitrary replay order never completes more than the ordered fold,
        // and the run's terminal state is the same one.
        const permuted = [...lines];
        for (const [a, b] of swaps) {
          const tmp = permuted[a];
          permuted[a] = permuted[b];
          permuted[b] = tmp;
        }
        const replayed = reduceProgressLines(permuted);
        for (const stage of endedStages(replayed)) {
          assert.ok(
            orderedEnded.has(stage),
            `a replayed out-of-order event must not complete ${stage} earlier`,
          );
        }
        assert.deepEqual(lastRun(replayed)?.terminal ?? null, orderedTerminal);
      },
    ),
    { numRuns: 150 },
  );
});

test('PROGRESS-IDEMPOTENT: a duplicated (run, seq) is a no-op', () => {
  fc.assert(
    fc.property(stagesArb, fc.integer({ min: 1, max: 3 }), (stages, copies) => {
      const lines = runEvents('run-idem', stages).map(encode);
      const once_ = reduceProgressLines(lines);
      const repeated = lines.flatMap((line) => Array.from({ length: copies }, () => line));
      assert.deepEqual(reduceProgressLines(repeated), once_, 'repeats change nothing');

      // Interleaved repeats too (a retried stage re-emits mid-run).
      const interleaved = lines.flatMap((line) => [line, line]);
      assert.deepEqual(reduceProgressLines(interleaved), once_);
    }),
    { numRuns: 150 },
  );
});

// ---------------------------------------------------------------------------
// PROGRESS-RENDER-ONCE
// ---------------------------------------------------------------------------

test('PROGRESS-RENDER-ONCE: a terminal state renders exactly once', () => {
  fc.assert(
    fc.property(stagesArb, fc.constantFrom('ok', 'failed'), (stages, outcome) => {
      const events = runEvents('run-render', stages, { outcome });
      const state = reduceProgressLines(events.map(encode));
      const terminal = events[events.length - 1];
      const summary = pendingSummary(state);
      assert.notEqual(summary, undefined, 'a finished run has something to report');
      assert.equal(summary.run, 'run-render');
      assert.equal(summary.status, outcome);
      assert.equal(summary.stage, terminal.stage, 'the failure names its stage');
      assert.equal(summary.message, terminal.message);

      const consumed = consumeProgress(state);
      assert.equal(
        pendingSummary(consumed),
        undefined,
        'the same terminal state renders exactly once',
      );
      assert.equal(pendingSummary(consumeProgress(consumed)), undefined, 'and stays consumed');
      assert.deepEqual(consumeProgress(consumed), consumed, 'consuming twice is a no-op');
    }),
    { numRuns: 200 },
  );
});

test('PROGRESS-RENDER-ONCE: a non-terminal or unreadable record renders nothing', () => {
  fc.assert(
    fc.property(stagesArb, fc.boolean(), (stages, corrupt) => {
      const events = runEvents('run-open', stages, { terminal: false });
      const lines = events.map(encode);
      if (corrupt) {
        lines.push('not an event at all', '@uniterra { truncated', '');
      }
      assert.equal(pendingSummary(reduceProgressLines(lines)), undefined);
    }),
    { numRuns: 150 },
  );
  for (const bytes of [
    Buffer.from('', 'utf8'),
    Buffer.from('\n\n\n', 'utf8'),
    Buffer.from([0x00, 0xff]),
  ]) {
    assert.equal(pendingSummary(reduceProgressBytes(bytes)), undefined);
  }
});

test('PROGRESS-RENDER-ONCE regression: only the LATEST run is ever reported', () => {
  const first = runEvents('run-a', ['update-cli'], { outcome: 'ok' }).map(encode);
  const second = runEvents('run-b', ['update-cli', 'build-install-app'], { outcome: 'failed' }).map(
    encode,
  );
  const state = reduceProgressLines([...first, ...second]);
  const summary = pendingSummary(state);
  assert.equal(summary.run, 'run-b', 'the older terminal state is never re-reported');
  assert.equal(summary.status, 'failed');
  assert.equal(pendingSummary(consumeProgress(state)), undefined, 'and it renders exactly once');
});

// ---------------------------------------------------------------------------
// PROGRESS-SINK — the updater carries the record path
// ---------------------------------------------------------------------------

test('PROGRESS-SINK: the updater spawn carries the progress file under userData', async () => {
  await withTempDir(async (dir) => {
    const record = join(dir, 'spawn-env.json');
    const stub = join(dir, 'updater-stub.mjs');
    await writeFile(
      stub,
      [
        "import { writeFileSync } from 'node:fs';",
        `writeFileSync(${JSON.stringify(record)}, JSON.stringify({`,
        '  progress: process.env.UNITERRA_UPDATE_PROGRESS_FILE ?? null,',
        '  args: process.argv.slice(2),',
        '}));',
        '',
      ].join('\n'),
    );
    const userData = join(dir, 'userData-does-not-exist-yet');
    const child = spawnUpdater(
      { command: process.execPath, args: [stub, 'update'] },
      userData,
      process.platform,
      () => undefined,
    );
    await once(child, 'exit');
    const seen = JSON.parse(await readFile(record, 'utf8'));
    assert.equal(
      seen.progress,
      updateProgressFilePath(userData),
      'the child inherits the progress record path',
    );
    assert.equal(
      updateProgressFilePath(userData),
      join(userData, UPDATE_PROGRESS_FILE),
      'the record lives directly under the app userData',
    );
    assert.deepEqual(seen.args, ['update'], 'the invocation itself is untouched');
    assert.ok(!existsSync(userData), 'spawning the updater must not create anything in userData');
  });
});

// ---------------------------------------------------------------------------
// The cross-package golden vector (mirrored byte-for-byte from the CLI suite)
// ---------------------------------------------------------------------------

const GOLDEN_EVENTS = [
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

const GOLDEN_LINES = [
  '@@uniterra {"v":1,"run":"b7f3c0d2-0000-4000-8000-000000000001","seq":0,"at":"2026-09-13T00:00:00.000Z","event":"run-start","stage":null,"status":null,"message":"updating: CLI, then app rebuild + reinstall, then relaunch"}',
  '@@uniterra {"v":1,"run":"b7f3c0d2-0000-4000-8000-000000000001","seq":1,"at":"2026-09-13T00:00:01.000Z","event":"stage-start","stage":"update-cli","status":null,"message":""}',
  '@@uniterra {"v":1,"run":"b7f3c0d2-0000-4000-8000-000000000001","seq":2,"at":"2026-09-13T00:00:02.000Z","event":"stage-end","stage":"update-cli","status":"ok","message":"CLI updated"}',
  '@@uniterra {"v":1,"run":"b7f3c0d2-0000-4000-8000-000000000001","seq":3,"at":"2026-09-13T00:00:03.000Z","event":"run-end","stage":null,"status":"ok","message":"the app was relaunched"}',
];

test('PROGRESS-SCHEMA regression: the shared golden vector decodes to the same events', () => {
  GOLDEN_LINES.forEach((line, index) => {
    assert.deepEqual(
      decodeProgressEvent(line),
      GOLDEN_EVENTS[index],
      'the wire contract is shared with the CLI encoder suite',
    );
  });
  const state = reduceProgressLines(GOLDEN_LINES);
  assert.equal(state.runs.length, 1);
  assert.equal(state.runs[0].events.length, GOLDEN_LINES.length);
  const summary = pendingSummary(state);
  assert.equal(summary.run, GOLDEN_EVENTS[0].run);
  assert.equal(summary.status, 'ok');
  const content = progressDialogContent(summary);
  assert.ok(content.title.length > 0 && content.message.length > 0);
  assert.match(`${content.message} ${content.detail}`, /restart|relaunch|launch/iu);
});

test('PROGRESS-RENDER-ONCE: the record and its consumption marker round-trip through userData', async () => {
  await withTempDir(async (dir) => {
    const file = updateProgressFilePath(dir);
    await mkdir(join(dir), { recursive: true });
    await writeFile(file, `${GOLDEN_LINES.join('\n')}\n`);
    const loaded = loadProgressState(dir);
    assert.notEqual(pendingSummary(loaded), undefined, 'a fresh record has something to report');
    writeConsumedRun(dir, GOLDEN_EVENTS[0].run);
    assert.equal(
      pendingSummary(loadProgressState(dir)),
      undefined,
      'the next boot must not show the same result twice',
    );
    // A missing record, an unreadable one and an unreadable marker never throw.
    await rm(file, { force: true });
    assert.equal(pendingSummary(loadProgressState(dir)), undefined);
    await writeFile(file, '\u0000\u00ff not a record');
    assert.doesNotThrow(() => loadProgressState(dir));
    assert.equal(pendingSummary(loadProgressState(dir)), undefined);
  });
});
