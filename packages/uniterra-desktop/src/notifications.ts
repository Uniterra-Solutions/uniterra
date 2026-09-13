/**
 * Turn-completion notifications: the decision that turns a finished dsh turn
 * into one OS notification, and the per-profile preference that gates it.
 *
 * This module owns exactly two things:
 *  - the pure decision ({@link turnNotification}) and the replay deduper
 *    ({@link createTurnDeduper}) — no I/O, no Electron, no timers;
 *  - the preference stored in the profile's `.uniterra.json`
 *    ({@link readTurnNotificationsEnabled} / {@link writeTurnNotificationsEnabled})
 *    — the SAME file `builtin.ts` owns for the optional-plugin toggle, so the
 *    writes stay additive (every other key survives) and an illegible user file
 *    is never rewritten.
 *
 * The application menu, the OS notification, and the live dsh transport live
 * in the shell (`main.ts` / `dsh-observer.ts`); everything here is decided by
 * arguments and returns a value, which is what makes the guarantees testable.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { OPTIONAL_PLUGINS_FILE, copyBuiltins } from './builtin.js';

/** The `.uniterra.json` section the notification preferences live under. */
export const NOTIFICATIONS_SECTION = 'notifications';

/** The key inside {@link NOTIFICATIONS_SECTION} holding the turn-complete toggle. */
export const TURN_NOTIFICATIONS_KEY = 'turnComplete';

/** What a missing file — or a file without the key — means: notifications ON.
 * The feature works out of the box; the menu checkbox is what turns it off. */
export const TURN_NOTIFICATIONS_DEFAULT = true;

/** Icon-free fallback title for a session that has no usable title or id. */
export const UNTITLED_SESSION_TITLE = 'Untitled session';

/** One `turn/end` frame as the decision reads it. The payload stays `unknown`:
 * a real frame crosses the dsh wire as JSON and is never trusted. */
export interface TurnEndEvent {
  /** The session event name — only `turn/end` produces a notification. */
  readonly type: string;
  /** The event payload; `{ turn, reason: { kind } }` for a well-formed turn end. */
  readonly data?: unknown;
}

/** Everything the decision needs about one finished turn. */
export interface TurnNotificationInput {
  /** The profile toggle, read at the moment the turn ended. */
  readonly enabled: boolean;
  /** The session the turn belongs to (used as the title fallback). */
  readonly sessionId: string;
  /** The session origin; `subagent` marks an intermediate child session. */
  readonly origin?: string | undefined;
  /** The session's display title, when the host published one. */
  readonly title?: string | undefined;
  /** The frame that ended the turn. */
  readonly event: TurnEndEvent;
}

/** The payload of one native OS notification. */
export interface TurnNotification {
  /** The notification title: the session's title. */
  readonly title: string;
  /** The notification body: the turn's completion status. */
  readonly body: string;
}

/** Replay guard: one (session, turn) produces at most one notification. A
 * follow stream replays its opening window on every (re)connect, so the same
 * finished turn arrives more than once by design. */
export interface TurnDeduper {
  /**
   * Claim one finished turn.
   * @param sessionId - the session the turn belongs to.
   * @param turn - the session-local turn number.
   * @returns true exactly once per distinct (sessionId, turn).
   */
  shouldNotify(sessionId: string, turn: number): boolean;
}

/** The status text one documented `turn/end` reason maps to. A Map, not an
 * object literal: a merge-extensible reason kind called `constructor` or
 * `toString` must read as unknown, never as an inherited Object member. */
const STATUS_TEXT = new Map<string, string>([
  ['completed', 'Turn completed'],
  ['aborted', 'Turn aborted'],
  ['blocked', 'Turn blocked'],
  ['error', 'Turn failed'],
  ['max-tokens', 'Turn stopped at the token limit'],
  ['interrupted', 'Turn interrupted'],
]);

/**
 * Create the replay deduper.
 *
 * Remembers one entry per distinct (session, turn) — the numbers of finished
 * turns in this app run, which is bounded by how many turns the user runs, not
 * by how long the app stays open.
 *
 * @returns a deduper holding its own state; share one instance to guard a
 *   whole observation session (including across re-listed sessions).
 */
export function createTurnDeduper(): TurnDeduper {
  const seen = new Map<string, Set<number>>();
  return {
    shouldNotify(sessionId: string, turn: number): boolean {
      let turns = seen.get(sessionId);
      if (turns === undefined) {
        turns = new Set<number>();
        seen.set(sessionId, turns);
      }
      if (turns.has(turn)) {
        return false;
      }
      turns.add(turn);
      return true;
    },
  };
}

/**
 * Decide whether one frame becomes a notification, and what it says.
 *
 * Never throws: an unknown (merge-extensible) reason kind, a missing payload,
 * or a malformed title still yields a notice, because a silent drop of a
 * finished turn is the one failure the user notices.
 *
 * @param input - the profile toggle, the session facts and the ending frame.
 * @returns the notification payload, or undefined when nothing should be
 *   raised (toggle off, subagent child session, or a frame that is not a
 *   `turn/end`).
 */
export function turnNotification(input: TurnNotificationInput): TurnNotification | undefined {
  if (!input.enabled) {
    return undefined;
  }
  if (input.origin === 'subagent') {
    return undefined;
  }
  if (input.event.type !== 'turn/end') {
    return undefined;
  }
  return {
    title: notificationTitle(input.title, input.sessionId),
    body: statusText(reasonKind(input.event.data)),
  };
}

/** The reason kind of a `turn/end` payload, or undefined when it is unusable. */
function reasonKind(data: unknown): string | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const reason = data.reason;
  if (!isRecord(reason)) {
    return undefined;
  }
  const kind = reason.kind;
  return typeof kind === 'string' ? nonBlank(kind) : undefined;
}

/** The notification title: the session title, else its id, else a label. */
function notificationTitle(title: string | undefined, sessionId: string): string {
  return nonBlank(title) ?? nonBlank(sessionId) ?? UNTITLED_SESSION_TITLE;
}

/** The status text for one reason kind; an unknown kind is named verbatim. */
function statusText(kind: string | undefined): string {
  if (kind === undefined) {
    return 'Turn ended';
  }
  return STATUS_TEXT.get(kind) ?? `Turn ended (${kind})`;
}

/**
 * A structurally Electron-compatible checkbox menu item describing the toggle.
 * Defined here (not in `main.ts`) so the "reflect the stored preference, write
 * it back on click" behaviour is testable without an Electron runtime.
 */
export interface TurnNotificationMenuCheckbox {
  /** Stable id, so the shell can find the item again if it rebuilds the menu. */
  readonly id: string;
  readonly label: string;
  readonly type: 'checkbox';
  /** The stored preference at menu-build time. */
  readonly checked: boolean;
  /** Electron calls this with the item AFTER it flipped `checked` to the new
   * state, which is the value the preference is written from. */
  readonly click: (item: { readonly checked: boolean }) => void;
}

/** The application-menu id of the turn-notification checkbox. */
export const TURN_NOTIFICATION_MENU_ITEM_ID = 'uniterra-turn-notifications';

/**
 * Build the application-menu checkbox for the turn-completion toggle.
 * @param options - the stored preference and the write-back sink.
 * @returns the menu item; assignable to Electron's `MenuItemConstructorOptions`.
 */
export function turnNotificationMenuItem(options: {
  readonly enabled: boolean;
  readonly onToggle: (enabled: boolean) => void;
}): TurnNotificationMenuCheckbox {
  return {
    id: TURN_NOTIFICATION_MENU_ITEM_ID,
    label: 'Notify When a Turn Completes',
    type: 'checkbox',
    checked: options.enabled,
    click: (item): void => {
      options.onToggle(item.checked);
    },
  };
}

// ---------------------------------------------------------------------------
// The per-profile preference (.uniterra.json)
// ---------------------------------------------------------------------------

/** Parsed state of the shared toggle file. `legible === false` means the file
 * exists but is not a JSON object: the read falls back to the default and the
 * write refuses, so a user-owned file is never destroyed. */
interface PreferenceState {
  readonly present: boolean;
  readonly legible: boolean;
  readonly document?: Record<string, unknown> | undefined;
}

function preferenceFilePath(profileDirPath: string): string {
  return path.join(profileDirPath, OPTIONAL_PLUGINS_FILE);
}

function readPreferenceState(profileDirPath: string): PreferenceState {
  const file = preferenceFilePath(profileDirPath);
  if (!existsSync(file)) {
    return { present: false, legible: true };
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!isRecord(parsed)) {
      return { present: true, legible: false };
    }
    return { present: true, legible: true, document: parsed };
  } catch {
    return { present: true, legible: false };
  }
}

/** The writable copy of the `notifications` section (an unusable value is
 * replaced wholesale; other keys inside a usable one are preserved). */
function notificationsSection(document: Record<string, unknown>): Record<string, unknown> {
  const section = document[NOTIFICATIONS_SECTION];
  return isRecord(section) ? { ...section } : {};
}

/**
 * Read the per-profile turn-notification preference.
 *
 * Always answers: a missing file, an illegible file, a missing key, or a key
 * that is not a boolean means {@link TURN_NOTIFICATIONS_DEFAULT}.
 *
 * @param profileDirPath - the profile dir the run actually uses
 *   (`<dshHome>/profiles/<profile>`).
 * @returns whether a finished turn should raise a notification.
 */
export function readTurnNotificationsEnabled(profileDirPath: string): boolean {
  const state = readPreferenceState(profileDirPath);
  if (state.document === undefined) {
    return TURN_NOTIFICATIONS_DEFAULT;
  }
  const value = notificationsSection(state.document)[TURN_NOTIFICATIONS_KEY];
  return typeof value === 'boolean' ? value : TURN_NOTIFICATIONS_DEFAULT;
}

/**
 * Persist the per-profile turn-notification preference.
 *
 * Additive: every other key of the shared `.uniterra.json` is preserved —
 * including the `optionalPlugins` map `reconcileOptionalPlugins` owns. An
 * illegible file is left byte-identical (the same least-destructive rule that
 * reconcile applies), because a file we cannot parse is a file we must not
 * rewrite.
 *
 * When the file does not exist yet it is created with the `optionalPlugins`
 * map the profile's bundle rows already enable, mirroring reconcile's own
 * migration: otherwise creating the file early would read as "the user
 * disabled every optional plugin" and drop an installed one on the next boot.
 *
 * @param profileDirPath - the profile dir the run actually uses.
 * @param enabled - the new toggle state.
 */
export function writeTurnNotificationsEnabled(profileDirPath: string, enabled: boolean): void {
  const state = readPreferenceState(profileDirPath);
  if (state.present && !state.legible) {
    return;
  }
  const document = state.document ?? seedPreferenceDocument(profileDirPath);
  document[NOTIFICATIONS_SECTION] = {
    ...notificationsSection(document),
    [TURN_NOTIFICATIONS_KEY]: enabled,
  };
  writeFileSync(
    preferenceFilePath(profileDirPath),
    `${JSON.stringify(document, null, 2)}\n`,
    'utf8',
  );
}

/** The document a profile without a toggle file starts from. */
function seedPreferenceDocument(profileDirPath: string): Record<string, unknown> {
  return { version: 1, optionalPlugins: bundledOptionalPlugins(profileDirPath) };
}

/** The optional built-ins the profile manifest already bundles. */
function bundledOptionalPlugins(profileDirPath: string): Record<string, boolean> {
  const optionalPlugins: Record<string, boolean> = {};
  const bundles = bundledPackageNames(profileDirPath);
  for (const entry of copyBuiltins('optional')) {
    if (bundles.includes(entry.package)) {
      optionalPlugins[entry.package] = true;
    }
  }
  return optionalPlugins;
}

/** The bundle rows of the profile manifest, or none when it is not legible. */
function bundledPackageNames(profileDirPath: string): readonly unknown[] {
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(path.join(profileDirPath, 'package.json'), 'utf8'),
    );
    const profile = isRecord(manifest) && isRecord(manifest.dsh) ? manifest.dsh.profile : undefined;
    const raw = isRecord(profile) ? profile.bundles : undefined;
    return Array.isArray(raw) ? (raw as readonly unknown[]) : [];
  } catch {
    // No legible manifest: there is no installed optional plugin to preserve.
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The trimmed value, or undefined when it is missing or blank. */
function nonBlank(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
