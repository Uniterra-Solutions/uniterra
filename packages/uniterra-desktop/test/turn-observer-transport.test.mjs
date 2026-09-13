/**
 * PBT-adjacent suite for the live turn transport (compiled dist).
 *
 * REQ-1 (issue #34): the desktop watches a RUNNING dsh. This suite pins the wire
 * contract and, above all, the fail-soft rule: a missing cookie, a refused
 * socket, a malformed frame or a dead runtime degrade to "no notifications"
 * without throwing out of the caller or blocking it.
 *
 * Business invariants locked here:
 *  - AUTH: the readiness token is exchanged for the browser cookie, and only an
 *    authenticated socket is ever opened — the cookie rides the upgrade.
 *  - WIRE: session discovery is one unary client-request POST; a session follow
 *    is one `open` frame on the shared mux; an `item` frame carries the event.
 *  - NOTICE: the session title comes from the host's title projection.
 *  - FAIL-SOFT: no cookie, a refused socket, malformed frames and a mid-stream
 *    error never notify and never throw; a later poll recovers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startDshTurnObserver } from '../dist/dsh-observer.js';

const READINESS_URL = 'http://127.0.0.1:3080/?token=launch-token';
const COOKIE = 'dsh-auth-abc=v1.body.signature';

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** A fetch double answering the root token exchange and the unary calls;
 * `cookie: null` models a host that answers the exchange without a cookie. */
function fakeFetch({ cookie = COOKIE, sessions = [] } = {}) {
  const calls = [];
  const impl = async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    calls.push({
      url: url.href,
      method,
      cookie: init?.headers?.cookie,
      body: init?.body === undefined ? undefined : JSON.parse(init.body),
    });
    if (method === 'POST') {
      return jsonResponse({
        type: 'server-response',
        rpcId: 'rpc-1',
        result: { ok: true, value: { items: sessions } },
      });
    }
    const headers = new Headers();
    if (cookie !== null) {
      headers.append('set-cookie', `${cookie}; Path=/; HttpOnly; SameSite=Strict`);
    }
    return new Response(null, { status: cookie === null ? 401 : 303, headers });
  };
  return { impl, calls };
}

/** WebSocket doubles the test opens, feeds and inspects by hand. */
function fakeSockets() {
  const sockets = [];
  const factory = (url, cookie) => {
    const listeners = new Map();
    const emit = (type, event) => {
      for (const listener of listeners.get(type) ?? []) {
        listener(event);
      }
    };
    const socket = {
      readyState: 0,
      url,
      cookie,
      sent: [],
      addEventListener(type, listener) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      send(data) {
        socket.sent.push(JSON.parse(data));
      },
      close() {
        socket.readyState = 3;
      },
      open() {
        socket.readyState = 1;
        emit('open', {});
      },
      message(value) {
        emit('message', { data: typeof value === 'string' ? value : JSON.stringify(value) });
      },
      fail() {
        socket.readyState = 3;
        emit('error', {});
      },
    };
    sockets.push(socket);
    return socket;
  };
  return { factory, sockets };
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

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

function sessionSummaries() {
  return [
    {
      sessionId: 'user-1',
      running: true,
      updatedAt: 1,
      projections: { asOfSeq: 3, values: { title: 'Fix the Windows boot' } },
    },
    {
      sessionId: 'child-1',
      running: true,
      updatedAt: 2,
      origin: 'subagent',
      projections: { asOfSeq: 1, values: { title: 'Child' } },
    },
  ];
}

function observer(options) {
  const notices = [];
  const handle = startDshTurnObserver({
    readinessUrl: READINESS_URL,
    enabled: () => true,
    onTurnEnd: (notice) => {
      notices.push(notice);
    },
    pollIntervalMs: 10,
    ...options,
  });
  return { handle, notices };
}

function turnEndFrame(turn, kind = 'completed') {
  return {
    type: 'item',
    streamId: undefined,
    value: { type: 'event', event: { type: 'turn/end', data: { turn, reason: { kind } } } },
  };
}

// ---------------------------------------------------------------------------
// AUTH / WIRE — the happy path
// ---------------------------------------------------------------------------

test('WIRE: discovery and following use the authenticated client-request protocol', async () => {
  const { impl, calls } = fakeFetch({ sessions: sessionSummaries() });
  const { factory, sockets } = fakeSockets();
  const { handle, notices } = observer({ fetchImpl: impl, webSocketFactory: factory });
  try {
    await waitFor(() => sockets.length === 1);
    const socket = sockets[0];
    assert.ok(socket.url.endsWith('/api/remote.mux'), 'the mux path is the stream socket');
    assert.equal(socket.cookie, COOKIE, 'the upgrade carries the browser cookie');

    socket.open();
    await waitFor(() => socket.sent.length === 1);
    const open = socket.sent[0];
    assert.equal(open.type, 'open');
    assert.equal(open.endpoint, 'session/follow');
    // Live-verified against a booted harness: session/follow names its single
    // wire argument `request` (session/create does too).
    assert.deepEqual(open.payload, {
      args: { request: { address: { kind: 'session', sessionId: 'user-1' } } },
    });

    const list = calls.find((call) => call.method === 'POST');
    assert.ok(list.url.endsWith('/api/session/list'));
    assert.equal(list.cookie, COOKIE, 'unary calls carry the browser cookie too');
    assert.deepEqual(list.body, {
      type: 'client-request',
      rpcId: list.body.rpcId,
      method: 'session/list',
      // Live-verified: session/list names its (empty) wire argument `_request`.
      payload: { args: { _request: {} } },
    });

    // The opening snapshot is ignored; the appended turn/end is the notice.
    socket.message({
      type: 'item',
      streamId: open.streamId,
      value: {
        type: 'snapshot',
        header: {},
        cursor: 0,
        records: [],
        hasMore: false,
        projections: {},
      },
    });
    socket.message({ ...turnEndFrame(3), streamId: open.streamId });
    await waitFor(() => notices.length === 1);
    assert.deepEqual(notices[0], {
      sessionId: 'user-1',
      title: 'Fix the Windows boot',
      turn: 3,
      reason: 'completed',
    });
  } finally {
    handle.stop();
    await tick();
  }
});

test('SELECTION: a subagent child session is never followed', async () => {
  const { impl } = fakeFetch({ sessions: sessionSummaries() });
  const { factory, sockets } = fakeSockets();
  const { handle } = observer({ fetchImpl: impl, webSocketFactory: factory });
  try {
    await waitFor(() => sockets.length === 1);
    sockets[0].open();
    await waitFor(() => sockets[0].sent.length === 1);
    await tick(60);
    const endpoints = sockets[0].sent.filter((message) => message.type === 'open');
    assert.deepEqual(
      endpoints.map((message) => message.payload.args.request.address.sessionId),
      ['user-1'],
      'the subagent child session is never opened',
    );
  } finally {
    handle.stop();
    await tick();
  }
});

// ---------------------------------------------------------------------------
// FAIL-SOFT — every failure degrades to silence, never to a throw
// ---------------------------------------------------------------------------

test('FAIL-SOFT: without the dsh cookie no socket is opened and no notice is raised', async () => {
  const { impl } = fakeFetch({ cookie: null, sessions: sessionSummaries() });
  const { factory, sockets } = fakeSockets();
  const { handle, notices } = observer({ fetchImpl: impl, webSocketFactory: factory });
  await tick(60);
  handle.stop();
  await tick(30);
  assert.deepEqual(notices, []);
  assert.equal(sockets.length, 0, 'an unauthenticated socket is never opened');
});

test('FAIL-SOFT: a refused socket never throws out of the observer and never notifies', async () => {
  const { impl } = fakeFetch({ sessions: sessionSummaries() });
  const { factory, sockets } = fakeSockets();
  const { handle, notices } = observer({
    fetchImpl: impl,
    webSocketFactory: (url, cookie) => {
      const socket = factory(url, cookie);
      setTimeout(() => {
        socket.fail();
      }, 0);
      return socket;
    },
  });
  await tick(80);
  handle.stop();
  await tick(30);
  assert.deepEqual(notices, []);
});

test('FAIL-SOFT: a socket that cannot even be constructed resolves to silence', async () => {
  const { impl } = fakeFetch({ sessions: sessionSummaries() });
  const { handle, notices } = observer({
    fetchImpl: impl,
    webSocketFactory: () => {
      throw new Error('no global WebSocket in this runtime');
    },
  });
  await tick(60);
  handle.stop();
  await tick(30);
  assert.deepEqual(notices, []);
});

test('FAIL-SOFT: malformed mux messages are ignored and a later turn still notifies', async () => {
  const { impl } = fakeFetch({ sessions: sessionSummaries() });
  const { factory, sockets } = fakeSockets();
  const { handle, notices } = observer({ fetchImpl: impl, webSocketFactory: factory });
  try {
    await waitFor(() => sockets.length === 1);
    const socket = sockets[0];
    socket.open();
    await waitFor(() => socket.sent.length === 1);
    const first = socket.sent[0];

    socket.message('not json at all');
    socket.message({ type: 'item' });
    socket.message({ type: 'item', streamId: 'unknown-stream', value: { anything: true } });
    socket.message({
      type: 'error',
      streamId: first.streamId,
      error: { code: 'x', message: 'boom', details: {} },
    });

    await waitFor(() => socket.sent.filter((message) => message.type === 'open').length === 2);
    assert.deepEqual(notices, [], 'a broken stream notifies nothing');

    const second = socket.sent.filter((message) => message.type === 'open')[1];
    socket.message({ ...turnEndFrame(1), streamId: second.streamId });
    await waitFor(() => notices.length === 1);
    assert.equal(notices[0].turn, 1, 'the next pass re-follows the session and notifies');
  } finally {
    handle.stop();
    await tick();
  }
});

test('FAIL-SOFT: stop() closes the socket and is idempotent', async () => {
  const { impl } = fakeFetch({ sessions: sessionSummaries() });
  const { factory, sockets } = fakeSockets();
  const { handle } = observer({ fetchImpl: impl, webSocketFactory: factory });
  try {
    await waitFor(() => sockets.length === 1);
    sockets[0].open();
    await waitFor(() => sockets[0].sent.length === 1);
    handle.stop();
    handle.stop();
    await tick(40);
    assert.equal(sockets[0].readyState, 3, 'the mux socket is closed');
  } finally {
    handle.stop();
    await tick();
  }
});
