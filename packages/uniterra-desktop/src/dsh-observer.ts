/**
 * The live turn transport: authenticate against the running dsh, list its
 * sessions, and follow each user-facing one over the Gateway Remote mux so a
 * finished turn can raise a notification.
 *
 * Wire facts, verified read-only against the pinned harness sources under
 * `vendor/dsh-harness`:
 *  - the readiness token is accepted only on `GET /`, where it mints the
 *    authority-bound `dsh-auth-<hash>` cookie; every `/api` request AND the
 *    WebSocket upgrade must carry that cookie
 *    (`packages/client/connection/src/browser-auth.ts`, `rpc-host.ts`);
 *  - unary calls are `POST /api/<namespace>/<method>` carrying
 *    `{ type: 'client-request', rpcId, method, payload: { args } }`;
 *  - streams share one socket at `/api/remote.mux`: the client sends
 *    `{ type: 'open', streamId, endpoint, payload }` and receives
 *    `{ type: 'item', streamId, value }` / `{ type: 'end' }` /
 *    `{ type: 'error' }` (`packages/api/gateway/src/stream-protocol.ts`).
 *
 * Fail-soft by construction: no cookie, a refused socket, a malformed frame or
 * a dead runtime all degrade to "no notifications" and are logged — nothing
 * here throws out of the caller and nothing blocks it. The work runs detached
 * behind {@link startDshTurnObserver}, which returns synchronously.
 *
 * Only `session/list` and `session/follow` are used. The `$events` stream is
 * deliberately NEVER opened: its waterfall frames (approval/request,
 * user-questions/request) stall host settlement process-wide unless the
 * subscriber answers each one.
 */

import { randomUUID } from 'node:crypto';
import { createTurnDeduper } from './notifications.js';
import {
  observeTurns,
  type ObservedFrame,
  type ObservedSession,
  type TurnNotice,
} from './turn-observer.js';

/** The cookie the root token exchange mints (`dsh-auth-<hash>`). */
const AUTH_COOKIE_PREFIX = 'dsh-auth-';

/** The Gateway multiplexed Remote stream socket. */
const REMOTE_MUX_PATH = '/api/remote.mux';

/** `WebSocket.OPEN` without depending on the global constructor. */
const READY_STATE_OPEN = 1;

/** Deadline for the one-time root token exchange. */
const AUTH_TIMEOUT_MS = 5_000;

/** Deadline for one unary call, so a stalled host cannot park the poll loop. */
const CALL_TIMEOUT_MS = 10_000;

/** How often sessions are re-listed, to pick up sessions created after boot. */
const DEFAULT_POLL_INTERVAL_MS = 5_000;

/** The structural WebSocket surface this module uses. Node's global
 * `WebSocket` satisfies it and the header option it needs (verified against
 * Node 22 / undici); tests inject a fake. */
export interface DshWebSocket {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: { readonly data?: unknown }) => void): void;
  send(data: string): void;
  close(): void;
}

/** Creates one mux socket; the browser cookie rides the upgrade request. */
export type DshWebSocketFactory = (url: string, cookie: string) => DshWebSocket;

/** The fetch surface used for the token exchange and the unary calls. */
export type DshFetch = (input: URL, init: RequestInit) => Promise<Response>;

/** Everything the live observer needs from its owner. */
export interface DshTurnObserverOptions {
  /** The readiness URL `startDsh` resolved — it carries the launch token. */
  readonly readinessUrl: string;
  /** Whether notifications are on right now; read per event. */
  readonly enabled: () => boolean;
  /** Sink for every finished user-facing turn. */
  readonly onTurnEnd: (notice: TurnNotice) => void;
  /** Poll period for session discovery. */
  readonly pollIntervalMs?: number;
  /** Transport overrides; both default to the process globals. */
  readonly fetchImpl?: DshFetch;
  readonly webSocketFactory?: DshWebSocketFactory;
  /** Diagnostic sink; defaults to silence. */
  readonly log?: (message: string) => void;
}

/** A running observer. {@link DshTurnObserverHandle.stop} is idempotent. */
export interface DshTurnObserverHandle {
  /** Stop watching and release the socket. Never throws. */
  stop: () => void;
}

/**
 * Start watching the running dsh for finished turns.
 *
 * Returns immediately: authentication, discovery and the socket all happen on a
 * detached task that swallows its own failures, so a dead or unauthenticated
 * runtime can never fail a boot.
 *
 * @param options - the readiness URL, the live toggle and the notice sink.
 * @returns the handle owning the observation.
 */
export function startDshTurnObserver(options: DshTurnObserverOptions): DshTurnObserverHandle {
  const controller = new AbortController();
  const log = options.log ?? ((): void => {});
  void observeRuntime(options, controller.signal).catch((error: unknown) => {
    log(`turn observer stopped: ${describe(error)}`);
  });
  return {
    stop: (): void => {
      controller.abort();
    },
  };
}

/** Authenticate, then list and follow sessions until the signal aborts. */
async function observeRuntime(options: DshTurnObserverOptions, signal: AbortSignal): Promise<void> {
  const log = options.log ?? ((): void => {});
  const fetchImpl = options.fetchImpl ?? globalFetch;
  const cookie = await acquireAuthCookie(options.readinessUrl, fetchImpl, log);
  if (cookie === undefined) {
    log('turn notifications are off: the dsh browser cookie was not issued');
    return;
  }
  const base = new URL(options.readinessUrl);
  const mux = new RemoteMux(
    muxUrl(base),
    cookie,
    options.webSocketFactory ?? defaultWebSocketFactory,
    log,
  );
  const deduper = createTurnDeduper();
  const watching = new Set<string>();
  const aborted = abortPromise(signal);
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  try {
    while (!signal.aborted) {
      const sessions = await fetchSessions(base, cookie, fetchImpl, signal, log);
      // The observer re-applies its own selection rule; filtering here as well
      // keeps a never-followed child session out of the watch set for good.
      const fresh = sessions.filter(
        (session) => session.origin !== 'subagent' && !watching.has(session.sessionId),
      );
      for (const session of fresh) {
        watching.add(session.sessionId);
      }
      if (fresh.length > 0) {
        // One pass per batch of new sessions: the observer owns selection,
        // dedupe and notice delivery, this loop owns discovery.
        void observeTurns(
          {
            enabled: options.enabled,
            listSessions: () => Promise.resolve(fresh),
            followSession: (sessionId) => followSession(mux, sessionId, watching),
            onTurnEnd: options.onTurnEnd,
            deduper,
          },
          signal,
        );
      }
      await Promise.race([delay(pollIntervalMs), aborted.promise]);
    }
  } finally {
    aborted.dispose();
    mux.close();
  }
}

/** Follow one session over the mux, re-listable once its stream ends. */
async function* followSession(
  mux: RemoteMux,
  sessionId: string,
  watching: Set<string>,
): AsyncGenerator<ObservedFrame> {
  try {
    const payload = { args: { request: { address: { kind: 'session', sessionId } } } };
    for await (const value of mux.open('session/follow', payload)) {
      const frame = asFrame(value);
      if (frame !== undefined) {
        yield frame;
      }
    }
  } catch {
    // A dropped socket or a refused stream ends this watch only; the next poll
    // re-lists the session and opens a fresh stream behind the shared deduper.
  } finally {
    watching.delete(sessionId);
  }
}

/** The session summaries the host lists, mapped to what the observer needs. */
async function fetchSessions(
  base: URL,
  cookie: string,
  fetchImpl: DshFetch,
  signal: AbortSignal,
  log: (message: string) => void,
): Promise<readonly ObservedSession[]> {
  const outcome = await callUnary(
    base,
    cookie,
    'session/list',
    { _request: {} },
    fetchImpl,
    signal,
  );
  if (!outcome.ok) {
    log(`session/list failed: ${outcome.message}`);
    return [];
  }
  const sessions: ObservedSession[] = [];
  for (const item of itemList(outcome.value)) {
    if (!isRecord(item) || typeof item.sessionId !== 'string' || item.sessionId.length === 0) {
      continue;
    }
    sessions.push({
      sessionId: item.sessionId,
      origin: typeof item.origin === 'string' ? item.origin : undefined,
      title: titleOf(item),
    });
  }
  return sessions;
}

/** The `title` projection of one session summary, when the host published one. */
function titleOf(summary: Record<string, unknown>): string | undefined {
  const projections = summary.projections;
  if (!isRecord(projections) || !isRecord(projections.values)) {
    return undefined;
  }
  const title = projections.values.title;
  return typeof title === 'string' && title.trim().length > 0 ? title : undefined;
}

/** The `items` array of a list response, or nothing when it is unusable. */
function itemList(value: unknown): readonly unknown[] {
  if (!isRecord(value)) {
    return [];
  }
  const items = value.items;
  return Array.isArray(items) ? (items as readonly unknown[]) : [];
}

/** One unary Remote call over `POST /api/<method>`. */
async function callUnary(
  base: URL,
  cookie: string,
  method: string,
  args: unknown,
  fetchImpl: DshFetch,
  signal: AbortSignal,
): Promise<
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string }
> {
  try {
    const response = await fetchImpl(new URL(`/api/${method}`, base), {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: randomUUID(),
        method,
        payload: { args },
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]),
    });
    if (!response.ok) {
      return { ok: false, message: `HTTP ${String(response.status)}` };
    }
    const body: unknown = await response.json();
    if (!isRecord(body) || !isRecord(body.result)) {
      return { ok: false, message: 'malformed server-response envelope' };
    }
    const result = body.result;
    if (result.ok !== true) {
      return { ok: false, message: 'the host refused the request' };
    }
    return { ok: true, value: result.value };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

/**
 * Exchange the readiness URL's launch token for the browser cookie every
 * `/api` request needs. The token is only accepted on `GET /`, which answers
 * `303` with `set-cookie` — so the redirect must NOT be followed.
 */
async function acquireAuthCookie(
  readinessUrl: string,
  fetchImpl: DshFetch,
  log: (message: string) => void,
): Promise<string | undefined> {
  try {
    const response = await fetchImpl(new URL(readinessUrl), {
      redirect: 'manual',
      headers: { accept: 'text/html' },
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';')[0]?.trim();
      if (pair !== undefined && pair.startsWith(AUTH_COOKIE_PREFIX)) {
        return pair;
      }
    }
    log(`the root token exchange answered ${String(response.status)} without a dsh cookie`);
    return undefined;
  } catch (error) {
    log(`the root token exchange failed: ${describe(error)}`);
    return undefined;
  }
}

/** One decoded frame of a logical stream. */
type MuxFrame =
  | { readonly kind: 'item'; readonly value: unknown }
  | { readonly kind: 'end' }
  | { readonly kind: 'error'; readonly message: string };

/** Single-consumer frame queue for one logical stream on the shared socket. */
class FrameQueue {
  private readonly frames: MuxFrame[] = [];
  private waiter: ((frame: MuxFrame) => void) | undefined;
  private terminated = false;

  /** Deliver one frame, waking the parked reader when there is one. */
  push(frame: MuxFrame): void {
    if (this.terminated) {
      return;
    }
    const waiter = this.waiter;
    if (waiter !== undefined) {
      this.waiter = undefined;
      waiter(frame);
      return;
    }
    this.frames.push(frame);
  }

  /** The next frame; a terminated queue keeps answering `end`. */
  next(): Promise<MuxFrame> {
    const queued = this.frames.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    if (this.terminated) {
      return Promise.resolve({ kind: 'end' });
    }
    return new Promise<MuxFrame>((resolve) => {
      this.waiter = resolve;
    });
  }

  /** Terminate with the host's end frame. */
  finish(): void {
    this.push({ kind: 'end' });
    this.terminated = true;
  }

  /** Terminate with a failure, ending the reading generator. */
  fail(message: string): void {
    this.push({ kind: 'error', message });
    this.terminated = true;
  }
}

/**
 * The multiplexed Remote stream socket: one WebSocket carrying every logical
 * stream, reconnected lazily after a drop. A socket that cannot be opened or
 * that fails mid-flight ends the affected streams, never the caller.
 */
class RemoteMux {
  private socket: DshWebSocket | undefined;
  private connecting: Promise<DshWebSocket | undefined> | undefined;
  private disposed = false;
  private readonly queues = new Map<string, FrameQueue>();

  /**
   * @param url - the `ws://…/api/remote.mux` endpoint.
   * @param cookie - the browser cookie the upgrade must carry.
   * @param createSocket - socket factory (injected in tests).
   * @param log - diagnostic sink.
   */
  constructor(
    private readonly url: string,
    private readonly cookie: string,
    private readonly createSocket: DshWebSocketFactory,
    private readonly log: (message: string) => void,
  ) {}

  /**
   * Open one logical stream.
   * @param endpoint - the canonical `<namespace>/<method>` endpoint.
   * @param payload - the endpoint request (already wrapped in `{ args }`).
   * @returns host items until the stream ends or fails.
   */
  async *open(endpoint: string, payload: unknown): AsyncGenerator<unknown, void, undefined> {
    const socket = await this.connectedSocket();
    if (socket === undefined) {
      return;
    }
    const streamId = randomUUID();
    const queue = new FrameQueue();
    this.queues.set(streamId, queue);
    socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload }));
    try {
      for (;;) {
        const frame = await queue.next();
        if (frame.kind === 'end') {
          return;
        }
        if (frame.kind === 'error') {
          throw new Error(frame.message);
        }
        yield frame.value;
      }
    } finally {
      this.queues.delete(streamId);
      if (socket.readyState === READY_STATE_OPEN) {
        socket.send(JSON.stringify({ type: 'cancel', streamId }));
      }
    }
  }

  /** Drop the socket and fail every logical stream on it. */
  close(): void {
    this.disposed = true;
    const socket = this.socket;
    this.socket = undefined;
    this.failAll('the mux socket was closed');
    if (socket !== undefined) {
      try {
        socket.close();
      } catch {
        // A socket that is already gone needs no cleanup.
      }
    }
  }

  /** The open socket, opening one when needed; undefined when it cannot be. */
  private connectedSocket(): Promise<DshWebSocket | undefined> {
    if (this.disposed) {
      return Promise.resolve(undefined);
    }
    const current = this.socket;
    if (current !== undefined && current.readyState === READY_STATE_OPEN) {
      return Promise.resolve(current);
    }
    if (this.connecting === undefined) {
      this.connecting = this.connect().finally(() => {
        this.connecting = undefined;
      });
    }
    return this.connecting;
  }

  /** One connection attempt; resolves undefined instead of rejecting. */
  private connect(): Promise<DshWebSocket | undefined> {
    return new Promise<DshWebSocket | undefined>((resolve) => {
      let socket: DshWebSocket;
      try {
        socket = this.createSocket(this.url, this.cookie);
      } catch (error) {
        this.log(`the mux socket could not be created: ${describe(error)}`);
        resolve(undefined);
        return;
      }
      let settled = false;
      const settle = (value: DshWebSocket | undefined): void => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      socket.addEventListener('message', (event) => {
        this.receive(event.data);
      });
      socket.addEventListener('error', () => {
        if (this.socket === socket) {
          this.socket = undefined;
        }
        this.failAll('the mux socket failed');
        settle(undefined);
      });
      socket.addEventListener('close', () => {
        if (this.socket === socket) {
          this.socket = undefined;
        }
        this.failAll('the mux socket closed');
        settle(undefined);
      });
      socket.addEventListener('open', () => {
        if (this.disposed) {
          try {
            socket.close();
          } catch {
            // A socket that never opened needs no cleanup.
          }
          settle(undefined);
          return;
        }
        this.socket = socket;
        settle(socket);
      });
    });
  }

  /** Route one host frame to its logical stream. */
  private receive(data: unknown): void {
    if (typeof data !== 'string') {
      return;
    }
    let frame: unknown;
    try {
      frame = JSON.parse(data);
    } catch {
      return; // a malformed frame ends nothing — it is simply not a frame
    }
    if (!isRecord(frame) || typeof frame.streamId !== 'string') {
      return;
    }
    const queue = this.queues.get(frame.streamId);
    if (queue === undefined) {
      return;
    }
    if (frame.type === 'item') {
      queue.push({ kind: 'item', value: frame.value });
      return;
    }
    if (frame.type === 'end') {
      queue.finish();
      return;
    }
    if (frame.type === 'error') {
      queue.fail(errorMessage(frame.error));
    }
  }

  /** Fail every logical stream (socket loss, or an explicit close). */
  private failAll(message: string): void {
    for (const queue of [...this.queues.values()]) {
      queue.fail(message);
    }
  }
}

/** The default socket factory: Node's global WebSocket with the cookie header. */
function defaultWebSocketFactory(url: string, cookie: string): DshWebSocket {
  const candidate = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (typeof candidate !== 'function') {
    throw new Error('this runtime has no global WebSocket');
  }
  const constructor = candidate as new (
    url: string,
    options: { headers: Record<string, string> },
  ) => DshWebSocket;
  return new constructor(url, { headers: { cookie } });
}

/** The default fetch: the process global. */
function globalFetch(input: URL, init: RequestInit): Promise<Response> {
  return fetch(input, init);
}

/** The `ws://…` mux endpoint derived from the readiness URL's origin. */
function muxUrl(base: URL): string {
  const url = new URL(REMOTE_MUX_PATH, base);
  url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

/** The message of one host error frame. */
function errorMessage(error: unknown): string {
  if (isRecord(error) && typeof error.message === 'string') {
    return error.message;
  }
  return 'the host ended the stream with an error';
}

/** One raw frame value, narrowed to what the observer reads. */
function asFrame(value: unknown): ObservedFrame | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }
  return { type: value.type, event: value.event };
}

/** Resolve after `ms`, or when the signal aborts. */
function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Resolve when the signal aborts; `dispose` detaches the listener. */
function abortPromise(signal: AbortSignal): {
  readonly promise: Promise<void>;
  readonly dispose: () => void;
} {
  let detach = (): void => {};
  const promise = new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    detach = (): void => {
      signal.removeEventListener('abort', onAbort);
    };
  });
  return {
    promise,
    dispose: (): void => {
      detach();
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A short human-readable failure. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
