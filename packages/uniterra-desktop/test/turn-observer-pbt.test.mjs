/**
 * PBT suite for the turn observer: which sessions are followed and what the
 * desktop is told (compiled dist).
 *
 * REQ-1 (issue #34): the desktop watches a running dsh for finished turns.
 * The observer is transport-agnostic — session discovery and the per-session
 * frame stream are injected — so the guarantees below are pinned without a
 * live harness.
 *
 * Business invariants locked here:
 *  - SELECTION: only user-facing sessions are followed at all. A subagent
 *    child session is never opened, so an intermediate child turn can never
 *    reach a notification.
 *  - NOTICE: a turn/end frame yields exactly one notice carrying the session
 *    id, its title, the turn number and the reason kind.
 *  - DEDUPE: a replayed turn/end for the same (session, turn) yields one notice.
 *  - LIVE-TOGGLE: the enabled state is consulted per event, so flipping the
 *    profile toggle takes effect without a restart.
 *  - FAIL-SOFT: one broken stream never stops the others and never rejects
 *    observeTurns; aborting the signal always resolves it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTurnDeduper } from '../dist/notifications.js';
import { observeTurns } from '../dist/turn-observer.js';

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** A frame stream that yields the given frames, optionally gating one of them. */
function streamOf(frames, { onFrame } = {}) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const frame of frames) {
        if (onFrame !== undefined) {
          await onFrame(frame);
        }
        yield frame;
      }
    },
  };
}

/** A frame stream that never ends (used for the abort path). */
function parkedStream() {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'snapshot' };
      await new Promise(() => {});
    },
  };
}

/** A frame stream that fails after its frames. */
function failingStream(frames) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const frame of frames) {
        yield frame;
      }
      throw new Error('stream failed');
    },
  };
}

function turnEnd(turn, kind = 'completed') {
  return { type: 'event', event: { type: 'turn/end', data: { turn, reason: { kind } } } };
}

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('waitFor: condition never became true');
}

function harness({ sessions, follow, enabled = () => true }) {
  const notices = [];
  const followed = [];
  const controller = new AbortController();
  const deps = {
    enabled,
    listSessions: async () => sessions,
    followSession: (sessionId) => {
      followed.push(sessionId);
      return follow(sessionId);
    },
    onTurnEnd: (notice) => {
      notices.push(notice);
    },
  };
  return { deps, notices, followed, controller };
}

// ---------------------------------------------------------------------------
// SELECTION — subagent sessions are never followed
// ---------------------------------------------------------------------------

test('SELECTION: only user-facing sessions are followed; a subagent child never is', async () => {
  const sessions = [
    { sessionId: 'user-1', title: 'Alpha' },
    { sessionId: 'child-1', origin: 'subagent', title: 'Child' },
    { sessionId: 'user-2', origin: 'user', title: 'Beta' },
  ];
  const h = harness({ sessions, follow: () => streamOf([turnEnd(1)]) });
  await observeTurns(h.deps, h.controller.signal);
  assert.deepEqual(h.followed.sort(), ['user-1', 'user-2'], 'subagent sessions are not followed');
  assert.deepEqual(
    h.notices.map((n) => n.sessionId).sort(),
    ['user-1', 'user-2'],
    'no notice can come from a subagent session',
  );
});

// ---------------------------------------------------------------------------
// NOTICE — the payload the desktop notifies with
// ---------------------------------------------------------------------------

test('NOTICE: a turn/end frame yields one notice with session id, title, turn and reason', async () => {
  const sessions = [{ sessionId: 'user-1', title: 'Fix the Windows boot' }];
  const h = harness({ sessions, follow: () => streamOf([turnEnd(4, 'error')]) });
  await observeTurns(h.deps, h.controller.signal);
  assert.equal(h.notices.length, 1);
  assert.deepEqual(h.notices[0], {
    sessionId: 'user-1',
    title: 'Fix the Windows boot',
    turn: 4,
    reason: 'error',
  });
});

test('NOTICE: a session without a title still yields a notice', async () => {
  const sessions = [{ sessionId: 'user-1' }];
  const h = harness({ sessions, follow: () => streamOf([turnEnd(1)]) });
  await observeTurns(h.deps, h.controller.signal);
  assert.equal(h.notices.length, 1);
  assert.equal(h.notices[0].sessionId, 'user-1');
  assert.equal(h.notices[0].turn, 1);
});

test('NOTICE: non-turn events are ignored', async () => {
  const sessions = [{ sessionId: 'user-1', title: 'Alpha' }];
  const frames = [
    { type: 'snapshot' },
    { type: 'event', event: { type: 'assistant/message', data: { text: 'hi' } } },
    turnEnd(1),
    { type: 'event', event: { type: 'tool/start', data: {} } },
  ];
  const h = harness({ sessions, follow: () => streamOf(frames) });
  await observeTurns(h.deps, h.controller.signal);
  assert.equal(h.notices.length, 1, 'only turn/end notifies');
});

// ---------------------------------------------------------------------------
// DEDUPE
// ---------------------------------------------------------------------------

test('DEDUPE: a replayed turn/end for the same (session, turn) yields one notice', async () => {
  const sessions = [{ sessionId: 'user-1', title: 'Alpha' }];
  const h = harness({ sessions, follow: () => streamOf([turnEnd(3), turnEnd(3), turnEnd(4)]) });
  await observeTurns(h.deps, h.controller.signal);
  assert.deepEqual(
    h.notices.map((n) => n.turn),
    [3, 4],
    'one notice per distinct turn',
  );
});

// ---------------------------------------------------------------------------
// LIVE-TOGGLE
// ---------------------------------------------------------------------------

test('LIVE-TOGGLE: the enabled state is consulted per event, not once at start', async () => {
  let enabled = true;
  const gate = deferred();
  const sessions = [{ sessionId: 'user-1', title: 'Alpha' }];
  const stream = {
    async *[Symbol.asyncIterator]() {
      yield turnEnd(1);
      await gate.promise;
      yield turnEnd(2);
    },
  };
  const h = harness({ sessions, follow: () => stream, enabled: () => enabled });
  const running = observeTurns(h.deps, h.controller.signal);
  await waitFor(() => h.notices.length === 1);
  enabled = false;
  gate.resolve();
  await running;
  assert.deepEqual(
    h.notices.map((n) => n.turn),
    [1],
    'the toggle took effect mid-stream',
  );
});

// ---------------------------------------------------------------------------
// FAIL-SOFT
// ---------------------------------------------------------------------------

test('FAIL-SOFT: one broken stream never stops the others and never rejects', async () => {
  const sessions = [
    { sessionId: 'broken', title: 'Broken' },
    { sessionId: 'healthy', title: 'Healthy' },
  ];
  const h = harness({
    sessions,
    follow: (sessionId) =>
      sessionId === 'broken' ? failingStream([turnEnd(1)]) : streamOf([turnEnd(1)]),
  });
  await observeTurns(h.deps, h.controller.signal);
  assert.deepEqual(
    h.notices.map((n) => n.sessionId),
    ['healthy'],
    'the healthy session still reports after the broken one fails',
  );
});

test('FAIL-SOFT: aborting the signal resolves observeTurns even while streams stay open', async () => {
  const sessions = [{ sessionId: 'user-1', title: 'Alpha' }];
  const h = harness({ sessions, follow: () => parkedStream() });
  const running = observeTurns(h.deps, h.controller.signal);
  await new Promise((r) => setTimeout(r, 20));
  h.controller.abort();
  await Promise.race([
    running,
    new Promise((_r, reject) =>
      setTimeout(() => reject(new Error('observeTurns did not stop')), 2000),
    ),
  ]);
});

test('FAIL-SOFT: a failing discovery resolves observeTurns without following anything', async () => {
  const h = harness({ sessions: [], follow: () => streamOf([turnEnd(1)]) });
  h.deps.listSessions = async () => {
    throw new Error('session/list failed');
  };
  await observeTurns(h.deps, h.controller.signal);
  assert.deepEqual(h.notices, []);
  assert.deepEqual(h.followed, []);
});

test('FAIL-SOFT: an already-aborted signal never discovers and never follows', async () => {
  let listed = 0;
  const h = harness({
    sessions: [{ sessionId: 'user-1', title: 'Alpha' }],
    follow: () => streamOf([turnEnd(1)]),
  });
  const original = h.deps.listSessions;
  h.deps.listSessions = async () => {
    listed += 1;
    return original();
  };
  h.controller.abort();
  await observeTurns(h.deps, h.controller.signal);
  assert.equal(listed, 0, 'a stopped observer does no work at all');
  assert.deepEqual(h.followed, []);
  assert.deepEqual(h.notices, []);
});

test('FAIL-SOFT: a session whose stream cannot be opened is skipped, never thrown', async () => {
  const sessions = [
    { sessionId: 'unopenable', title: 'Unopenable' },
    { sessionId: 'openable', title: 'Openable' },
  ];
  const h = harness({
    sessions,
    follow: (sessionId) => {
      if (sessionId === 'unopenable') {
        throw new Error('the stream cannot be opened');
      }
      return streamOf([turnEnd(1)]);
    },
  });
  await observeTurns(h.deps, h.controller.signal);
  assert.deepEqual(
    h.notices.map((n) => n.sessionId),
    ['openable'],
  );
});

test('FAIL-SOFT: malformed frames are ignored and a missing reason is still reported', async () => {
  const frames = [
    null,
    'nonsense',
    { type: 'snapshot' },
    { type: 'event', event: null },
    { type: 'event', event: {} },
    { type: 'event', event: { type: 'turn/end' } },
    { type: 'event', event: { type: 'turn/end', data: null } },
    { type: 'event', event: { type: 'turn/end', data: {} } },
    {
      type: 'event',
      event: { type: 'turn/end', data: { turn: Number.NaN, reason: { kind: 'completed' } } },
    },
    {
      type: 'event',
      event: { type: 'turn/end', data: { turn: '2', reason: { kind: 'completed' } } },
    },
    { type: 'event', event: { type: 'turn/end', data: { turn: 9 } } },
  ];
  const h = harness({
    sessions: [{ sessionId: 'user-1', title: 'Alpha' }],
    follow: () => streamOf(frames),
  });
  await observeTurns(h.deps, h.controller.signal);
  assert.equal(h.notices.length, 1, 'only a usable turn number produces a notice');
  assert.equal(h.notices[0].turn, 9);
  assert.equal(
    h.notices[0].reason,
    'unknown',
    'a turn/end without a reason kind is still reported',
  );
});

test('FAIL-SOFT: a throwing notice consumer never stops the observer', async () => {
  const sessions = [{ sessionId: 'user-1', title: 'Alpha' }];
  const h = harness({ sessions, follow: () => streamOf([turnEnd(1), turnEnd(2)]) });
  const seen = [];
  h.deps.onTurnEnd = (notice) => {
    seen.push(notice.turn);
    throw new Error('the consumer failed');
  };
  await observeTurns(h.deps, h.controller.signal);
  assert.deepEqual(seen, [1, 2], 'every turn is still delivered');
});

// ---------------------------------------------------------------------------
// SELECTION / NOTICE — remaining edges
// ---------------------------------------------------------------------------

test('SELECTION: a duplicated listing entry is followed once and notifies once', async () => {
  const sessions = [
    { sessionId: 'user-1', title: 'Alpha' },
    { sessionId: 'user-1', title: 'Alpha' },
  ];
  const h = harness({ sessions, follow: () => streamOf([turnEnd(2)]) });
  await observeTurns(h.deps, h.controller.signal);
  assert.deepEqual(h.followed, ['user-1'], 'one session is one stream');
  assert.equal(h.notices.length, 1);
});

test('NOTICE: a session without a title carries the session id as its title', async () => {
  const h = harness({ sessions: [{ sessionId: 'user-1' }], follow: () => streamOf([turnEnd(1)]) });
  await observeTurns(h.deps, h.controller.signal);
  assert.equal(h.notices[0].title, 'user-1', 'the title is never empty');
});

// ---------------------------------------------------------------------------
// LIVE-TOGGLE — across two discovery passes with one shared deduper
// ---------------------------------------------------------------------------

test('LIVE-TOGGLE: a turn that ended while disabled never notifies through a replay', async () => {
  const deduper = createTurnDeduper();
  const first = harness({
    sessions: [{ sessionId: 'user-1', title: 'Alpha' }],
    follow: () => streamOf([turnEnd(1)]),
    enabled: () => false,
  });
  await observeTurns({ ...first.deps, deduper }, first.controller.signal);
  assert.deepEqual(first.notices, [], 'the toggle is authoritative at delivery time');

  const replay = harness({
    sessions: [{ sessionId: 'user-1', title: 'Alpha' }],
    follow: () => streamOf([turnEnd(1), turnEnd(2)]),
  });
  await observeTurns({ ...replay.deps, deduper }, replay.controller.signal);
  assert.deepEqual(
    replay.notices.map((n) => n.turn),
    [2],
    'the replayed turn stays claimed; the new one notifies',
  );
});
