/**
 * PBT for the desktop side of the #15 wire sentinel
 * (`src/update-progress.ts`, compiled dist).
 *
 * REQ-15-1 fixes the record's line prefix as `@@uniterra ` and REQ-15-5 makes
 * the desktop the reader of exactly that record. The property pins the bytes the
 * requirements of record name, not the module's own constant: a decoder that
 * only accepts a different sentinel restores nothing and the render-once
 * contract can never fire for a conforming record.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import {
  decodeProgressEvent,
  pendingSummary,
  reduceProgressLines,
} from '../dist/update-progress.js';

/** The sentinel the requirements of record fix (PRD.md REQ-15-1 / ACCEPTANCE.md). */
const DOCUMENTED_PREFIX = '@@uniterra ';

const STAGES = ['update-cli', 'build-install-app', 'launch-app'];

/** A well-formed run's events, exactly as a conforming CLI would emit them. */
function runEvents(run, stages, outcome) {
  const events = [];
  let seq = 0;
  const push = (event, stage, status, message) => {
    events.push({
      v: 1,
      run,
      seq: seq++,
      at: `2026-09-13T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
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
  push(
    'run-end',
    outcome === 'failed' ? (stages[stages.length - 1] ?? null) : null,
    outcome,
    'end',
  );
  return events;
}

const stagesArb = fc.array(fc.constantFrom(...STAGES), { maxLength: 3 });

test('PROGRESS-SENTINEL: a record written with the documented @@uniterra sentinel decodes and renders', () => {
  fc.assert(
    fc.property(stagesArb, fc.constantFrom('ok', 'failed'), (stages, outcome) => {
      const events = runEvents('run-documented', stages, outcome);
      const lines = events.map((event) => `${DOCUMENTED_PREFIX}${JSON.stringify(event)}`);

      events.forEach((event, index) => {
        assert.deepEqual(
          decodeProgressEvent(lines[index]),
          event,
          `a record line written with ${JSON.stringify(DOCUMENTED_PREFIX)} must decode`,
        );
      });

      const summary = pendingSummary(reduceProgressLines(lines));
      assert.notEqual(summary, undefined, 'a conforming finished record has a result to show');
      assert.equal(summary.run, 'run-documented');
      assert.equal(summary.status, outcome);
    }),
    { numRuns: 150 },
  );
});

test('PROGRESS-SENTINEL regression: a record written with the documented sentinel reports its result', () => {
  // The counterexample the property shrank to: every line of a conforming
  // record began with the documented sentinel, and the decoder — pinned to a
  // one-"@" constant — restored NOTHING, so a finished update could never be
  // reported to the user.
  const lines = [
    '@@uniterra {"v":1,"run":" ","seq":0,"at":"","event":"run-start","stage":null,"status":null,"message":""}',
    '@@uniterra {"v":1,"run":" ","seq":1,"at":"","event":"run-end","stage":null,"status":"ok","message":"the app was relaunched"}',
  ];
  assert.deepEqual(decodeProgressEvent(lines[0]), {
    v: 1,
    run: ' ',
    seq: 0,
    at: '',
    event: 'run-start',
    stage: null,
    status: null,
    message: '',
  });
  const summary = pendingSummary(reduceProgressLines(lines));
  assert.notEqual(summary, undefined, 'the documented record renders exactly once');
  assert.equal(summary.run, ' ');
  assert.equal(summary.status, 'ok');
});
