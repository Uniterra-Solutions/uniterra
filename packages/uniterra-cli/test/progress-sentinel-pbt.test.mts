/**
 * PBT for the CLI progress sentinel (issue #15, `src/update-progress.ts`).
 *
 * The plan of record FIXES the wire sentinel: REQ-15-1 — "每一行以固定前綴
 * `@@uniterra ` 起頭" — and REQ-15-2 makes that same literal the filter that
 * separates the machine-readable stream from the human lines. The property
 * below pins the DOCUMENTED bytes rather than the module's own constant, so an
 * encoder that emits a different prefix fails here by name.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import type { InstallStage } from '../dist/install-logic.js';
import {
  PROGRESS_EVENT_KEYS,
  encodeProgressEvent,
  formatHumanLine,
  humanLineFor,
  type ProgressEvent,
  type ProgressOutcome,
} from '../dist/update-progress.js';

/** The sentinel the requirements of record fix (PRD.md REQ-15-1 / ACCEPTANCE.md). */
const DOCUMENTED_PREFIX = '@@uniterra ';

const stageArb = fc.constantFrom<InstallStage>('update-cli', 'build-install-app', 'launch-app');
const outcomeArb = fc.constantFrom<ProgressOutcome>('ok', 'failed', 'dry-run');

const eventArb: fc.Arbitrary<ProgressEvent> = fc
  .record({
    run: fc.string({ minLength: 1, maxLength: 12 }),
    seq: fc.nat({ max: 999 }),
    at: fc.string({ maxLength: 24 }),
    event: fc.constantFrom<ProgressEvent['event']>(
      'run-start',
      'stage-start',
      'stage-end',
      'run-end',
    ),
    stage: fc.option(stageArb, { nil: null }),
    status: fc.option(outcomeArb, { nil: null }),
    message: fc.oneof(
      fc.string({ maxLength: 30 }),
      fc.constant(''),
      fc.constant('@@uniterra {"v":1}'),
    ),
  })
  .map((fields) => ({ v: 1 as const, ...fields }));

test('PROGRESS-SENTINEL: the event stream carries the documented @@uniterra sentinel', () => {
  fc.assert(
    fc.property(eventArb, (event) => {
      const line = encodeProgressEvent(event);
      assert.deepEqual(Object.keys(event).sort(), [...PROGRESS_EVENT_KEYS].sort());
      assert.ok(
        line.startsWith(DOCUMENTED_PREFIX),
        `REQ-15-1 fixes the sentinel as ${JSON.stringify(DOCUMENTED_PREFIX)}, ` +
          `the encoder emitted ${JSON.stringify(line.slice(0, 24))}`,
      );
      // The documented sentinel is the filter that recovers the event stream
      // from a stream that also carries human lines.
      const human = formatHumanLine(humanLineFor(event));
      assert.ok(!human.startsWith(DOCUMENTED_PREFIX), `a human line is not an event: ${human}`);
      const mixed = [human, line];
      assert.deepEqual(
        mixed.filter((candidate) => candidate.startsWith(DOCUMENTED_PREFIX)),
        [line],
        'the documented filter must restore exactly the event lines',
      );
    }),
    { numRuns: 200 },
  );
});

test('PROGRESS-SENTINEL regression: the shrunk event encodes to the documented sentinel bytes', () => {
  // The counterexample the property shrank to: no field carries an "@", so the
  // bytes the encoder produces are the module's own constant — which had lost
  // one "@" against the sentinel the requirements of record fix.
  const event: ProgressEvent = {
    v: 1,
    run: ' ',
    seq: 0,
    at: '',
    event: 'run-start',
    stage: null,
    status: null,
    message: '',
  };
  const line = encodeProgressEvent(event);
  assert.equal(
    line,
    '@@uniterra {"v":1,"run":" ","seq":0,"at":"","event":"run-start","stage":null,"status":null,"message":""}',
  );
  // The documented sentinel is also the filter: the same pair of lines the
  // property mixes restores exactly the event line, and the human line is not
  // mistaken for one.
  const mixed = [formatHumanLine(humanLineFor(event)), line];
  assert.deepEqual(
    mixed.filter((candidate) => candidate.startsWith(DOCUMENTED_PREFIX)),
    [line],
  );
});
