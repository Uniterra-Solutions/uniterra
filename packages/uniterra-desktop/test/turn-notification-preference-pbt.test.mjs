/**
 * PBT suite for the turn-completion notification preference (compiled dist).
 *
 * REQ-1 (issue #34): the notification toggle lives in the profile's
 * '.uniterra.json' — the SAME file the optional-plugin toggle owns
 * ('builtin.ts': OPTIONAL_PLUGINS_FILE). The file is shared state, so the seam
 * between the two writers is pinned here.
 *
 * Business invariants locked here:
 *  - DEFAULT: a missing file, or a file without the key, means notifications
 *    are ON — the feature works out of the box and the toggle turns it off.
 *  - ROUND-TRIP: read(write(x)) === x for every boolean.
 *  - MERGE: writing the preference never drops optionalPlugins, version, or
 *    any other key already in the file.
 *  - NEVER-DESTRUCTIVE: an illegible file is left byte-identical and the read
 *    falls back to the default (the same guarantee reconcileOptionalPlugins
 *    makes for the optional-plugin toggle).
 *  - SEAM: reconcileOptionalPlugins leaves the notification preference intact.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { OPTIONAL_PLUGINS_FILE, copyBuiltins, reconcileOptionalPlugins } from '../dist/builtin.js';
import {
  readTurnNotificationsEnabled,
  turnNotificationMenuItem,
  writeTurnNotificationsEnabled,
} from '../dist/notifications.js';

const VENDOR_ROOT = resolve(process.cwd(), '..', '..', 'vendor', 'dsh-plugins');

/** An arbitrary optional-plugin toggle map (package name -> true). */
const optionalPluginsArb = fc
  .dictionary(fc.stringMatching(/^[@a-z0-9/-]{1,12}$/u), fc.constant(true), { maxKeys: 4 })
  // fc.dictionary builds a null-prototype map; the file round-trip yields an
  // ordinary object, so normalise here — the invariant under test is that the
  // KEYS AND VALUES survive the write, not which prototype carries them.
  .map((map) => ({ ...map }));

const preferenceFileArb = fc.record({
  version: fc.constant(1),
  enabled: fc.boolean(),
  optionalPlugins: optionalPluginsArb,
});

async function withProfile(body, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'uniterra-notify-'));
  try {
    if (body !== undefined) {
      await writeFile(join(dir, OPTIONAL_PLUGINS_FILE), body, 'utf8');
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The pre-existing file content with the notification key set to 'enabled'. */
function withPreference(existing, enabled) {
  const parsed = { ...existing, notifications: { turnComplete: enabled } };
  return JSON.stringify(parsed, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// DEFAULT
// ---------------------------------------------------------------------------

test('DEFAULT: a missing toggle file means notifications are ON', async () => {
  await withProfile(undefined, async (dir) => {
    assert.equal(readTurnNotificationsEnabled(dir), true);
  });
});

test('DEFAULT: a file without the key means notifications are ON', async () => {
  await withProfile('{"version":1,"optionalPlugins":{}}\n', async (dir) => {
    assert.equal(readTurnNotificationsEnabled(dir), true);
  });
});

test('regression: an explicit false is honoured', async () => {
  await withProfile('{"version":1,"notifications":{"turnComplete":false}}\n', async (dir) => {
    assert.equal(readTurnNotificationsEnabled(dir), false);
  });
});

// ---------------------------------------------------------------------------
// ROUND-TRIP + MERGE
// ---------------------------------------------------------------------------

test('ROUND-TRIP: read(write(x)) === x, over arbitrary pre-existing file content', async () => {
  await fc.assert(
    fc.asyncProperty(preferenceFileArb, fc.boolean(), async (existing, enabled) => {
      await withProfile(withPreference(existing, !enabled), async (dir) => {
        writeTurnNotificationsEnabled(dir, enabled);
        assert.equal(readTurnNotificationsEnabled(dir), enabled);
      });
    }),
  );
});

test('MERGE: writing the preference preserves optionalPlugins, version and unknown keys', async () => {
  await fc.assert(
    fc.asyncProperty(preferenceFileArb, fc.boolean(), async (existing, enabled) => {
      const before = JSON.stringify({ ...existing, extra: { keep: 'me' } }, null, 2) + '\n';
      await withProfile(before, async (dir) => {
        writeTurnNotificationsEnabled(dir, enabled);
        const after = JSON.parse(await readFile(join(dir, OPTIONAL_PLUGINS_FILE), 'utf8'));
        assert.deepEqual(after.optionalPlugins, existing.optionalPlugins, 'optionalPlugins kept');
        assert.equal(after.version, existing.version, 'version kept');
        assert.deepEqual(after.extra, { keep: 'me' }, 'unknown keys kept');
        assert.equal(after.notifications.turnComplete, enabled, 'the preference is written');
      });
    }),
  );
});

// ---------------------------------------------------------------------------
// NEVER-DESTRUCTIVE
// ---------------------------------------------------------------------------

test('NEVER-DESTRUCTIVE: an illegible file is left byte-identical', async () => {
  const illegible = 'not json at all {{{';
  await withProfile(illegible, async (dir) => {
    assert.equal(readTurnNotificationsEnabled(dir), true, 'falls back to the default');
    writeTurnNotificationsEnabled(dir, false);
    assert.equal(
      await readFile(join(dir, OPTIONAL_PLUGINS_FILE), 'utf8'),
      illegible,
      'the user-owned file is never rewritten when it cannot be parsed',
    );
  });
});

// ---------------------------------------------------------------------------
// SEAM — the shared .uniterra.json with the optional-plugin toggle
// ---------------------------------------------------------------------------

test('SEAM: reconcileOptionalPlugins leaves the notification preference intact', async () => {
  await withProfile(undefined, async (dir) => {
    writeTurnNotificationsEnabled(dir, false);
    reconcileOptionalPlugins(dir, VENDOR_ROOT);
    assert.equal(
      readTurnNotificationsEnabled(dir),
      false,
      'the optional-plugin reconcile must not drop the notification key',
    );
    assert.ok(existsSync(join(dir, OPTIONAL_PLUGINS_FILE)));
  });
});

test('DEFAULT: an unusable notifications value falls back to ON', async () => {
  const bodies = [
    '{"notifications":null}',
    '{"notifications":[]}',
    '{"notifications":"nope"}',
    '{"notifications":{"turnComplete":"yes"}}',
    '{"notifications":false}',
  ];
  for (const body of bodies) {
    await withProfile(`${body}\n`, async (dir) => {
      assert.equal(readTurnNotificationsEnabled(dir), true, body);
    });
  }
});

test('NEVER-DESTRUCTIVE: a JSON document that is not an object is left byte-identical', async () => {
  for (const body of ['[]\n', '"nope"\n', 'null\n', '42\n']) {
    await withProfile(body, async (dir) => {
      assert.equal(readTurnNotificationsEnabled(dir), true, 'falls back to the default');
      writeTurnNotificationsEnabled(dir, false);
      assert.equal(
        await readFile(join(dir, OPTIONAL_PLUGINS_FILE), 'utf8'),
        body,
        'the user-owned file is never rewritten when it is not a settings document',
      );
    });
  }
});

test('SEAM: creating the file for the preference keeps an installed optional plugin enabled', async () => {
  const optional = copyBuiltins('optional')[0];
  await withProfile(undefined, async (dir) => {
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ dsh: { profile: { bundles: [optional.package] } } }),
      'utf8',
    );
    writeTurnNotificationsEnabled(dir, false);
    const written = JSON.parse(await readFile(join(dir, OPTIONAL_PLUGINS_FILE), 'utf8'));
    assert.equal(written.version, 1, 'the document keeps the shared schema version');
    assert.equal(
      written.optionalPlugins[optional.package],
      true,
      'writing the preference early must not read as "the user disabled the optional plugin"',
    );
    assert.equal(written.notifications.turnComplete, false);
  });
});

test('MENU: the checkbox reflects the stored preference and writes it back on click', async () => {
  await withProfile(undefined, async (dir) => {
    const build = () =>
      turnNotificationMenuItem({
        enabled: readTurnNotificationsEnabled(dir),
        onToggle: (enabled) => {
          writeTurnNotificationsEnabled(dir, enabled);
        },
      });

    const on = build();
    assert.equal(on.type, 'checkbox');
    assert.equal(on.checked, true, 'the default state is ON');
    on.click({ checked: false });
    assert.equal(readTurnNotificationsEnabled(dir), false, 'the click persisted the preference');

    const rebuilt = build();
    assert.equal(rebuilt.checked, false, 'a menu rebuilt after a restart shows the stored state');
    rebuilt.click({ checked: true });
    assert.equal(readTurnNotificationsEnabled(dir), true, 'and toggling back persists too');
  });
});
