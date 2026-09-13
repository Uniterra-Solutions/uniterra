/**
 * PBT suite for the turn-completion notification decision (compiled dist).
 *
 * REQ-1 (issue #34): when the agent finishes a response turn the desktop
 * raises a native OS notification carrying the session title and the
 * completion status; intermediate subagent turns never raise one; the
 * per-profile toggle gates the whole behaviour.
 *
 * Business invariants locked here:
 *  - DISABLED: with the profile toggle off, no event ever produces a notice.
 *  - SUBAGENT-SILENT: a turn ending in a subagent-origin session never
 *    produces a notice, whatever its reason — a child turn is not a
 *    user-facing completion.
 *  - USER-TURN: an enabled profile turns every user-facing `turn/end` into a
 *    notice carrying a non-empty title and a non-empty status.
 *  - TOTAL: an unknown (merge-extensible) reason kind still produces a notice
 *    — the decision never throws and never silently drops a completion.
 *  - DEDUPE: one (session, turn) produces at most one notice, however often a
 *    stream replays it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { createTurnDeduper, turnNotification } from '../dist/notifications.js';

/** The reason kinds the pinned family emits on `turn/end` (dsh session types). */
const REASON_KINDS = ['completed', 'aborted', 'blocked', 'error', 'max-tokens', 'interrupted'];

const reasonArb = fc.oneof(
  fc.constantFrom(...REASON_KINDS).map((kind) => ({ kind })),
  // Merge-extensible vocabulary: a newer family may add kinds we do not know.
  fc.string({ minLength: 1, maxLength: 16 }).map((kind) => ({ kind })),
);

const turnArb = fc.record({
  turn: fc.nat({ max: 100_000 }),
  reason: reasonArb,
});

const sessionArb = fc.record({
  sessionId: fc.string({ minLength: 1, maxLength: 24 }),
  origin: fc.option(fc.constantFrom('subagent', 'user'), { nil: undefined }),
  title: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: undefined }),
});

function inputOf(session, turn, enabled) {
  return {
    enabled,
    sessionId: session.sessionId,
    origin: session.origin,
    title: session.title,
    event: { type: 'turn/end', data: turn },
  };
}

/** A user-facing session: anything that is not a subagent child. */
function userFacing(session) {
  return { ...session, origin: session.origin === 'subagent' ? undefined : session.origin };
}

// ---------------------------------------------------------------------------
// DISABLED / SUBAGENT-SILENT / USER-TURN — the decision
// ---------------------------------------------------------------------------

test('DISABLED: no turn ever notifies while the profile toggle is off', () => {
  fc.assert(
    fc.property(sessionArb, turnArb, (session, turn) => {
      assert.equal(
        turnNotification(inputOf(session, turn, false)),
        undefined,
        'the profile toggle is authoritative',
      );
    }),
  );
});

test('SUBAGENT-SILENT: a subagent session turn never notifies, whatever its reason', () => {
  fc.assert(
    fc.property(sessionArb, turnArb, (session, turn) => {
      const subagent = { ...session, origin: 'subagent' };
      assert.equal(
        turnNotification(inputOf(subagent, turn, true)),
        undefined,
        'intermediate child turns are not user-facing completions',
      );
    }),
  );
});

test('USER-TURN: an enabled profile notifies on every user-facing turn/end with title + status', () => {
  fc.assert(
    fc.property(sessionArb, turnArb, (session, turn) => {
      const notice = turnNotification(inputOf(userFacing(session), turn, true));
      assert.ok(notice !== undefined, 'a user-facing turn always notifies');
      assert.equal(typeof notice.title, 'string');
      assert.ok(notice.title.length > 0, 'the title is never empty');
      assert.equal(typeof notice.body, 'string');
      assert.ok(notice.body.length > 0, 'the status is never empty');
    }),
  );
});

// ---------------------------------------------------------------------------
// TOTAL / deterministic regressions
// ---------------------------------------------------------------------------

test('regression: an unknown (merge-extensible) reason kind still notifies', () => {
  const notice = turnNotification({
    enabled: true,
    sessionId: 's1',
    title: 'Refactor the parser',
    event: { type: 'turn/end', data: { turn: 3, reason: { kind: 'some-future-kind' } } },
  });
  assert.ok(notice !== undefined, 'an unknown reason must not swallow the completion');
  assert.equal(notice.title, 'Refactor the parser');
  assert.ok(notice.body.length > 0);
});

test('regression: the documented reason kinds map to distinct status text', () => {
  const bodies = new Map();
  for (const kind of REASON_KINDS) {
    const notice = turnNotification({
      enabled: true,
      sessionId: 's1',
      title: 'Title',
      event: { type: 'turn/end', data: { turn: 1, reason: { kind } } },
    });
    assert.ok(notice !== undefined, `reason ${kind} notifies`);
    bodies.set(kind, notice.body);
  }
  assert.equal(
    new Set(bodies.values()).size,
    REASON_KINDS.length,
    'each status is distinguishable',
  );
});

test('regression: the session title is carried; an unknown title falls back to a non-empty one', () => {
  const known = turnNotification({
    enabled: true,
    sessionId: 's1',
    title: 'Fix the Windows boot',
    event: { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  });
  assert.equal(known.title, 'Fix the Windows boot');

  const unknown = turnNotification({
    enabled: true,
    sessionId: 's1',
    event: { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  });
  assert.ok(unknown.title.length > 0, 'an unknown title still yields a usable notification title');
});

// ---------------------------------------------------------------------------
// DEDUPE — one (session, turn) is one notice
// ---------------------------------------------------------------------------

test('DEDUPE: one (session, turn) yields at most one notice across arbitrary replays', () => {
  fc.assert(
    fc.property(
      fc.array(fc.tuple(fc.string({ minLength: 1, maxLength: 8 }), fc.nat({ max: 50 })), {
        maxLength: 40,
      }),
      (events) => {
        const deduper = createTurnDeduper();
        const distinct = new Set();
        let emitted = 0;
        for (const [sessionId, turn] of events) {
          if (deduper.shouldNotify(sessionId, turn)) {
            emitted += 1;
          }
          distinct.add(`${sessionId}:${turn}`);
        }
        assert.equal(emitted, distinct.size, 'exactly one notice per distinct (session, turn)');
      },
    ),
  );
});

test('regression: the same turn replayed never notifies twice', () => {
  const deduper = createTurnDeduper();
  assert.equal(deduper.shouldNotify('s1', 7), true);
  assert.equal(deduper.shouldNotify('s1', 7), false);
  assert.equal(deduper.shouldNotify('s1', 8), true, 'a later turn in the same session notifies');
  assert.equal(deduper.shouldNotify('s2', 7), true, 'another session notifies independently');
});

test('regression: a different separator-laden pair never shares a dedupe slot', () => {
  const deduper = createTurnDeduper();
  assert.equal(deduper.shouldNotify('a:1', 2), true);
  assert.equal(deduper.shouldNotify('a', 12), true, 'the pair is distinct, not a replayed key');
  assert.equal(deduper.shouldNotify('a:1', 2), false, 'and the first pair stays claimed');
  assert.equal(
    deduper.shouldNotify('', 0),
    true,
    'the empty session id is a session like any other',
  );
  assert.equal(deduper.shouldNotify('', 0), false);
});

// ---------------------------------------------------------------------------
// TOTAL — the decision never swallows a finished turn
// ---------------------------------------------------------------------------

test('regression: a frame that is not a turn/end never notifies', () => {
  const notice = turnNotification({
    enabled: true,
    sessionId: 's1',
    title: 'Title',
    event: { type: 'assistant/message', data: { turn: 1, reason: { kind: 'completed' } } },
  });
  assert.equal(notice, undefined, 'only turn/end ends a turn');
});

test('TOTAL: a malformed turn/end payload still notifies and never throws', () => {
  const payloads = [undefined, null, {}, { reason: null }, { turn: 'x', reason: { kind: 5 } }];
  for (const data of payloads) {
    const notice = turnNotification({
      enabled: true,
      sessionId: 's1',
      title: 'Title',
      event: { type: 'turn/end', data },
    });
    assert.ok(
      notice !== undefined,
      `a turn/end is never silently dropped (${JSON.stringify(data)})`,
    );
    assert.ok(notice.title.length > 0);
    assert.ok(notice.body.length > 0);
  }
});

test('regression: an inherited Object property is not a known reason kind', () => {
  const notice = turnNotification({
    enabled: true,
    sessionId: 's1',
    title: 'Title',
    event: { type: 'turn/end', data: { turn: 1, reason: { kind: 'constructor' } } },
  });
  assert.ok(notice !== undefined);
  assert.equal(typeof notice.body, 'string', 'a lookup must never return an inherited member');
  assert.ok(notice.body.includes('constructor'), 'an unknown kind is named verbatim');
});

test('regression: a blank title falls back to the session id, then to a label', () => {
  const fromId = turnNotification({
    enabled: true,
    sessionId: 'session-42',
    title: '   ',
    event: { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  });
  assert.equal(fromId.title, 'session-42', 'a blank title is not a title');

  const fromLabel = turnNotification({
    enabled: true,
    sessionId: '  ',
    title: '',
    event: { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  });
  assert.ok(fromLabel.title.length > 0, 'a session with neither title nor id still notifies');
});
