/**
 * Turn observer: the transport-agnostic state machine the desktop runs against
 * a live dsh — which sessions are watched, which frames become notices, and how
 * a broken stream or a dead runtime degrades to silence.
 *
 * Session discovery and the per-session frame stream are injected, so the
 * selection rule, the notice payload, the replay dedupe, the live toggle and
 * the fail-soft guarantees are all decidable without a harness or a socket.
 * The real transport (`dsh-observer.ts`) supplies the two I/O callbacks and
 * lets this module own the semantics.
 *
 * Guarantees, all pinned by `test/turn-observer-pbt.test.mjs`:
 *  - only user-facing sessions are followed at all, so an intermediate subagent
 *    turn cannot reach a notification;
 *  - one `turn/end` frame produces exactly one notice, however often the stream
 *    replays it — a stream that dies gets re-followed by the next discovery
 *    pass, replays the turn, and notifies it then;
 *  - the enabled state is consulted per event, so flipping the profile toggle
 *    takes effect without a restart;
 *  - `observeTurns` never rejects and never stops at the first failure.
 */

import { UNTITLED_SESSION_TITLE, createTurnDeduper, type TurnDeduper } from './notifications.js';

/** Sentinel winning the race against an in-flight `next()` when the signal aborts. */
const ABORTED = Symbol('uniterra-turn-observer-aborted');

/** One frame of a session follow stream: the host's opening snapshot, then one
 * frame per appended session event. */
export interface ObservedFrame {
  /** `snapshot` for the opening window, `event` for an appended event. */
  readonly type: string;
  /** The appended session event, present on `event` frames. */
  readonly event?: unknown;
}

/** One session as discovery reports it. */
export interface ObservedSession {
  readonly sessionId: string;
  /** The host's title projection, when it published one. */
  readonly title?: string | undefined;
  /** `subagent` marks an intermediate child session, never user-facing. */
  readonly origin?: string | undefined;
}

/** One finished user-facing turn, as the desktop notifies it. */
export interface TurnNotice {
  readonly sessionId: string;
  /** Never empty: the session title, else its id, else a label. */
  readonly title: string;
  readonly turn: number;
  /** The reason kind as the host wrote it (`completed`, `error`, …), or
   * `unknown` when the frame omitted or malformed it. */
  readonly reason: string;
}

/** The injected seams `observeTurns` drives. */
export interface TurnObserverDeps {
  /** Whether notifications are on right now — read per event, not per run. */
  readonly enabled: () => boolean;
  /** Discover the sessions to consider. A rejection means "none". */
  readonly listSessions: () => Promise<readonly ObservedSession[]>;
  /** Open the frame stream for one session. May throw; that is one dead
   * session, not a dead observer. */
  readonly followSession: (sessionId: string) => AsyncIterable<ObservedFrame>;
  /** Sink for every notice, in arrival order. */
  readonly onTurnEnd: (notice: TurnNotice) => void;
  /** Replay guard to share across calls — one transport poll pass per call
   * means a re-listed session must not re-notify its replayed turns. */
  readonly deduper?: TurnDeduper | undefined;
}

/**
 * Observe one batch of sessions until every stream ends or the signal aborts.
 *
 * Never rejects: every failure (discovery, one stream, one malformed frame, a
 * throwing consumer) degrades to "no notice for that turn". The abort is the
 * only required exit — a stream that stays open forever is left behind when the
 * signal fires, which is how app shutdown and runtime restarts stop watching.
 *
 * A frame is delivered on the turn AFTER it arrived, and a stream that fails
 * before that delivery drops its undelivered frames UNCLAIMED. A dead stream is
 * therefore never the source of a notice, and nothing is lost: discovery
 * re-follows the session, the replayed `turn/end` is claimed then, and the
 * deduper keeps the total at one notice per (session, turn).
 *
 * @param deps - the injected discovery, follow and notification seams.
 * @param signal - aborts the observation; an already-aborted signal returns
 *   without discovering anything.
 * @returns once every followed stream ended or the signal aborted.
 */
export async function observeTurns(deps: TurnObserverDeps, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  const deduper = deps.deduper ?? createTurnDeduper();
  const abort = abortPromise(signal);
  try {
    const sessions = await listQuietly(deps);
    const started = new Set<string>();
    const streams: Promise<void>[] = [];
    for (const session of sessions) {
      const sessionId = session.sessionId;
      if (
        session.origin === 'subagent' ||
        typeof sessionId !== 'string' ||
        sessionId.length === 0
      ) {
        continue;
      }
      if (started.has(sessionId)) {
        continue; // a duplicated listing entry is still one stream
      }
      started.add(sessionId);
      streams.push(followOne(deps, session, deduper, abort.promise));
    }
    await Promise.all(streams);
  } catch {
    // Discovery failed: this pass observes nothing. The next pass tries again.
  } finally {
    abort.dispose();
  }
}

/**
 * Follow one session's stream, delivering the turns it finishes.
 *
 * Frames are queued and delivered on the next delivery turn (the following
 * macrotask): a stream that fails inside that window drops its undelivered
 * frames without claiming them, so a dead stream never notifies and the replay
 * behind the next discovery pass is what notifies the turn. A stream that ends
 * normally, or is aborted, flushes what it has.
 */
async function followOne(
  deps: TurnObserverDeps,
  session: ObservedSession,
  deduper: TurnDeduper,
  aborted: Promise<typeof ABORTED>,
): Promise<void> {
  let iterator: AsyncIterator<ObservedFrame>;
  try {
    iterator = deps.followSession(session.sessionId)[Symbol.asyncIterator]();
  } catch {
    return;
  }
  const queued: TurnNotice[] = [];
  let delivery: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    if (delivery !== undefined) {
      clearTimeout(delivery);
      delivery = undefined;
    }
    for (const notice of queued.splice(0, queued.length)) {
      deliver(deps, deduper, notice);
    }
  };
  try {
    for (;;) {
      const read = iterator.next();
      // An abandoned in-flight read must never surface as an unhandled
      // rejection when the abort wins the race below.
      void read.catch(() => {});
      const step = await Promise.race([read, aborted]);
      if (step === ABORTED || step.done === true) {
        flush();
        return;
      }
      if (queueNotice(session, step.value, queued) && delivery === undefined) {
        delivery = setTimeout(flush, 0);
      }
    }
  } catch {
    // The stream failed before delivery: drop its frames unclaimed, so the
    // replay behind the next discovery pass is what notifies them.
    queued.length = 0;
  } finally {
    if (delivery !== undefined) {
      clearTimeout(delivery);
    }
    closeQuietly(iterator);
  }
}

/** Queue one frame's notice when it is a well-formed finished turn.
 * @returns whether anything was queued. */
function queueNotice(session: ObservedSession, frame: unknown, queued: TurnNotice[]): boolean {
  try {
    if (!isRecord(frame) || frame.type !== 'event') {
      return false;
    }
    const event = frame.event;
    if (!isRecord(event) || event.type !== 'turn/end') {
      return false;
    }
    const data = event.data;
    if (!isRecord(data)) {
      return false;
    }
    const turn = data.turn;
    if (typeof turn !== 'number' || !Number.isFinite(turn)) {
      return false;
    }
    const reason = isRecord(data.reason) ? nonBlank(data.reason.kind) : undefined;
    queued.push({
      sessionId: session.sessionId,
      title: noticeTitle(session),
      turn,
      reason: reason ?? 'unknown',
    });
    return true;
  } catch {
    return false;
  }
}

/** Claim and raise one queued notice. */
function deliver(deps: TurnObserverDeps, deduper: TurnDeduper, notice: TurnNotice): void {
  try {
    // The claim happens even while disabled: a turn that ended while the
    // toggle was off must never notify later through a replay.
    if (!deduper.shouldNotify(notice.sessionId, notice.turn)) {
      return;
    }
    if (!deps.enabled()) {
      return;
    }
    deps.onTurnEnd(notice);
  } catch {
    // A throwing deduper or consumer never stops the observer.
  }
}

/** The notice title: the session title, else its id, else a label. */
function noticeTitle(session: ObservedSession): string {
  return nonBlank(session.title) ?? nonBlank(session.sessionId) ?? UNTITLED_SESSION_TITLE;
}

/** Discover the sessions, treating any failure as "none this pass". */
async function listQuietly(deps: TurnObserverDeps): Promise<readonly ObservedSession[]> {
  try {
    const sessions = await deps.listSessions();
    return Array.isArray(sessions) ? (sessions as readonly ObservedSession[]) : [];
  } catch {
    return [];
  }
}

/** Resolve when the signal aborts; `dispose` detaches the listener. */
function abortPromise(signal: AbortSignal): {
  readonly promise: Promise<typeof ABORTED>;
  readonly dispose: () => void;
} {
  let detach = (): void => {};
  const promise = new Promise<typeof ABORTED>((resolve) => {
    if (signal.aborted) {
      resolve(ABORTED);
      return;
    }
    const onAbort = (): void => {
      resolve(ABORTED);
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

/** Close a stream's iterator without letting its teardown failure escape. */
function closeQuietly(iterator: AsyncIterator<ObservedFrame>): void {
  try {
    void Promise.resolve(iterator.return?.()).catch(() => {
      // The stream is already gone; there is nothing left to release.
    });
  } catch {
    // A throwing close is not an observer failure either.
  }
}

/** The reason kind of a turn/end payload, or undefined when unusable. */
function nonBlank(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
