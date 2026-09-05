/**
 * dsh-shortcuts behavior tests: white-box coverage of every feature, driven
 * against fixtures modelled on the pinned dsh family (dsh-v0.1.2-rc.1).
 * Tests are named after the guarantee they pin (including the deterministic
 * regressions for the four pinned-dsh breakages the suite found and the
 * local fixes that shipped 2026-09-05).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import {
  loadShortcutsPlugin,
  applyShortcutsPlugin,
  dispatch,
  SHORTCUTS_CLIENT_PATH,
} from './helpers/dsh-shortcuts-harness.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// Combo matching / keyboard dispatch
// ---------------------------------------------------------------------------

test('combo matching normalizes shifted punctuation back to the base key', () => {
  const { plugin } = loadShortcutsPlugin();
  const t = plugin.internals;
  const combo = 'Meta+Shift+1';
  const typed = { key: '!', metaKey: true, shiftKey: true, ctrlKey: false, altKey: false };
  assert.equal(t.matchCombo(combo, typed), true);
  assert.equal(t.matchCombo(combo, { ...typed, shiftKey: false }), false);
});

test('macOS-first defaults use Meta and stay unique', () => {
  const { plugin } = loadShortcutsPlugin();
  const t = plugin.internals;
  const mac = t.FEATURES.filter((f) => f.defaultCombo && f.defaultCombo.startsWith('Meta+'));
  assert.ok(mac.length >= 12, 'macOS-first defaults use Meta');
  const combos = mac.map((f) => f.defaultCombo);
  assert.equal(new Set(combos).size, combos.length);
});

test('Tab+N effort combos match only while Tab is held; bare Tab keeps focus navigation', async () => {
  const h = applyShortcutsPlugin();
  const t = h.plugin.internals;
  const ev1 = dispatch(h, 'keydown', { key: 'Tab' });
  assert.equal(ev1.prevented, false, 'bare Tab keeps focus navigation');
  const ev2 = dispatch(h, 'keydown', { key: '1' });
  assert.equal(ev2.prevented, true, 'Tab+1 matches while held');
  await tick();
  assert.ok(
    h.usage.calls.some(
      (c) =>
        c.method === 'select' &&
        JSON.stringify(c.args) ===
          JSON.stringify([{ provider: 'g1', model: 'm1', reasoningEffort: 'low' }]),
    ),
    'selectEffort1 selected the first effort',
  );
  dispatch(h, 'keyup', { key: 'Tab' });
  assert.equal(t.tabHeld, false, 'keyup clears the held Tab state');
  const ev4 = dispatch(h, 'keydown', { key: '1' });
  assert.equal(ev4.prevented, false, 'bare 1 after Tab release is not a shortcut');
});

test('typing in an editable target is never intercepted without a command-like prefix', () => {
  const h = applyShortcutsPlugin();
  const editable = { tagName: 'TEXTAREA' };
  const ev = dispatch(h, 'keydown', { key: 'a' }, editable);
  assert.equal(ev.prevented, false, 'plain typing passes through');
  const evA = dispatch(h, 'keydown', { key: 'a', metaKey: true }, editable);
  assert.equal(evA.prevented, false, 'Meta+a has no binding either');
});

test('Shift+Tab permission cycle fires even inside an editable target', async () => {
  const h = applyShortcutsPlugin();
  const fetches = [];
  h.sandbox.fetch = async (url) => {
    fetches.push(String(url));
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const ev = dispatch(h, 'keydown', { key: 'Tab', shiftKey: true }, { tagName: 'TEXTAREA' });
  assert.equal(ev.prevented, true);
  await tick();
  assert.equal(fetches.length, 1, 'one write through the loopback route');
  assert.ok(fetches[0].startsWith('/dsh-shortcuts-permission?sessionId=s1&preset='));
});

// ---------------------------------------------------------------------------
// Session lifecycle features
// ---------------------------------------------------------------------------

test('archive-session archives the current session through workspaces.archiveSession', async () => {
  const h = applyShortcutsPlugin();
  const ev = dispatch(h, 'keydown', { key: 'A', metaKey: true, shiftKey: true });
  assert.equal(ev.prevented, true);
  await tick();
  const archive = h.usage.calls.find((c) => c.method === 'archiveSession');
  assert.deepEqual(archive && archive.args, ['s1'], 'archives the current session id');
});

test('stop-task cancels through the session-scoped conversation service', async () => {
  const h = applyShortcutsPlugin();
  const ev = dispatch(h, 'keydown', { key: '.', metaKey: true });
  assert.equal(ev.prevented, true);
  await tick();
  const conv = h.usage.calls.find((c) => c.svc === 'sessions.scope.get' && c.method === 'cancel');
  assert.ok(conv, 'conversation.cancel was reached via the pinned session scope');
});

test('new-session creates a session through a pinned-dsh channel, not a dead workspaces.startSession', async () => {
  const h = applyShortcutsPlugin();
  let threw = null;
  try {
    await h.plugin.internals.FEATURE_BY_ID.newSession.run();
  } catch (err) {
    threw = err;
  }
  assert.equal(
    threw,
    null,
    'newSession must not throw against the pinned workspaces face (workspaces.startSession does not exist)',
  );
  assert.equal(
    h.services.sessions.createCalls.length,
    1,
    'newSession must create a session through sessions.create',
  );
});

test('quick-switcher toggles the palette overlay without touching any service', () => {
  const h = applyShortcutsPlugin();
  const ev = dispatch(h, 'keydown', { key: 'K', metaKey: true });
  assert.equal(ev.prevented, true);
  assert.equal(h.plugin.internals.paletteOpen, true);
  dispatch(h, 'keydown', { key: 'K', metaKey: true });
  assert.equal(h.plugin.internals.paletteOpen, false);
});

test('sidebar/details/theme shortcuts drive the pinned layout and theme services', () => {
  const h = applyShortcutsPlugin();
  dispatch(h, 'keydown', { key: 'B', metaKey: true });
  assert.deepEqual(h.services.layout.calls, ['toggleSidebar']);
  dispatch(h, 'keydown', { key: 'D', metaKey: true, shiftKey: true });
  assert.deepEqual(h.services.layout.calls, ['toggleSidebar', 'openDetails']);
  dispatch(h, 'keydown', { key: 'D', metaKey: true, shiftKey: true });
  assert.deepEqual(h.services.layout.calls, ['toggleSidebar', 'openDetails', 'closeDetails']);
  dispatch(h, 'keydown', { key: 'L', metaKey: true, shiftKey: true });
  assert.equal(h.themeState.active.id, 'light', 'dark -> light');
});

test('toggle-theme keeps a non-base skin active instead of dropping it to the hardcoded base', () => {
  const h = applyShortcutsPlugin();
  h.themeState.themes.push({ id: 'maid-dark', colorScheme: 'dark', tokens: {} });
  h.themeState.active = h.themeState.themes[2];
  h.plugin.internals.FEATURE_BY_ID.toggleTheme.run();
  assert.equal(
    h.themeState.active.id,
    'maid-dark',
    'a skin theme must survive a cycle; got ' + h.themeState.active.id,
  );
});

test('cycle-locale walks the registered locale list in order', () => {
  const h = applyShortcutsPlugin();
  const t = h.plugin.internals;
  t.FEATURE_BY_ID.cycleLocale.run();
  assert.equal(h.localeState.active, 'en');
  t.FEATURE_BY_ID.cycleLocale.run();
  assert.equal(h.localeState.active, 'zh');
});

test('focus-sidebar-search focuses the pinned sidebar search input (type=text + localized placeholder)', () => {
  const h = applyShortcutsPlugin();
  h.plugin.internals.FEATURE_BY_ID.focusSidebarSearch.run();
  assert.equal(h.browser.searchInput.focused, true);
});

test('focus-composer focuses the pinned composer seat (contenteditable role=textbox; no textarea)', () => {
  const h = applyShortcutsPlugin();
  h.plugin.internals.FEATURE_BY_ID.focusComposer.run();
  assert.equal(
    h.browser.composer.focused,
    true,
    'the pinned composer is a contenteditable div (ComposerContentEditable); a textarea probe finds nothing',
  );
});

test('open-settings clicks the pinned settings trigger button and closes it when expanded', () => {
  const h = applyShortcutsPlugin();
  const t = h.plugin.internals;
  t.FEATURE_BY_ID.openSettings.run();
  assert.equal(h.browser.settingsTrigger.clicked, 1, 'first press opens settings');
  h.browser.settingsTrigger.attrs['aria-expanded'] = 'true';
  t.FEATURE_BY_ID.openSettings.run();
  assert.equal(h.browser.usage.dispatchEvent.length, 1, 'second press dispatches Escape to close');
});

// ---------------------------------------------------------------------------
// Clipboard
test('copy-last-message copies the last assistant text from the pinned event window', async () => {
  const h = applyShortcutsPlugin();
  h.sessions.eventWindow.entries = [
    {
      type: 'event',
      event: {
        type: 'user/message',
        seq: 1,
        time: 1,
        data: {
          turn: 1,
          step: 1,
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
            source: { kind: 'human' },
          },
        },
      },
    },
    {
      type: 'event',
      event: {
        type: 'assistant/message',
        seq: 2,
        time: 2,
        data: {
          turn: 1,
          step: 1,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'first reply' }],
            source: { kind: 'model', provider: 'g1', model: 'm1' },
          },
        },
      },
    },
    {
      type: 'event',
      event: {
        type: 'assistant/message',
        seq: 4,
        time: 4,
        data: {
          turn: 1,
          step: 2,
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'final reply' },
              { type: 'tool-call', id: 't1', name: 'run_code', arguments: '{}' },
            ],
            source: { kind: 'model', provider: 'g1', model: 'm1' },
          },
        },
      },
    },
  ];
  await h.plugin.internals.FEATURE_BY_ID.copyLastMessage.run();
  await tick();
  assert.deepEqual(
    h.browser.navigator.clipboard.written,
    ['final reply'],
    'last assistant text blocks only (tool-call blocks excluded)',
  );
  assert.deepEqual(
    h.usage.projections,
    [],
    'never reads a session projection (the pinned family has no conversation projection)',
  );
});

test('copy-last-message falls back to the pinned streaming chunk rows when no assembled message exists', async () => {
  const h = applyShortcutsPlugin();
  h.sessions.eventWindow.entries = [
    {
      type: 'chunks',
      event: {
        type: 'chunkrow/text-chunks',
        seq: 5,
        time: 5,
        data: { turn: 1, step: 3, index: 0, dt: [1, 1], texts: ['streaming ', 'answer ', 'here'] },
      },
    },
  ];
  await h.plugin.internals.FEATURE_BY_ID.copyLastMessage.run();
  await tick();
  assert.deepEqual(
    h.browser.navigator.clipboard.written,
    ['streaming answer here'],
    'the last streaming text run joins',
  );
});

test('copy-last-message stays silent without assistant text in the event window', async () => {
  const h = applyShortcutsPlugin();
  h.sessions.eventWindow.entries = [
    {
      type: 'event',
      event: {
        type: 'user/message',
        seq: 1,
        time: 1,
        data: {
          turn: 1,
          step: 1,
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
            source: { kind: 'human' },
          },
        },
      },
    },
  ];
  await h.plugin.internals.FEATURE_BY_ID.copyLastMessage.run();
  await tick();
  assert.deepEqual(
    h.browser.navigator.clipboard.written,
    [],
    'no assistant text -> no clipboard write',
  );
});

test('copy-session-title/id read the list snapshot and clipboard', async () => {
  const h = applyShortcutsPlugin();
  const t = h.plugin.internals;
  await t.FEATURE_BY_ID.copySessionTitle.run();
  assert.deepEqual(h.browser.navigator.clipboard.written, ['Demo session']);
  await t.FEATURE_BY_ID.copySessionId.run();
  assert.deepEqual(h.browser.navigator.clipboard.written, ['Demo session', 's1']);
});

// ---------------------------------------------------------------------------
// Model selection
// ---------------------------------------------------------------------------

test('select-model picks the Nth catalog model with its default reasoning effort', async () => {
  const h = applyShortcutsPlugin();
  const t = h.plugin.internals;
  await t.selectModelAt('s1', 0);
  assert.deepEqual(JSON.parse(JSON.stringify(h.directory.lastSelection)), {
    provider: 'g1',
    model: 'm1',
    reasoningEffort: 'low',
  });
  await t.selectModelAt('s1', 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.directory.lastSelection)), {
    provider: 'g1',
    model: 'm2',
  });
});

test('select-model falls back to loading the directory when the snapshot has no groups', async () => {
  const h = applyShortcutsPlugin();
  const t = h.plugin.internals;
  h.directory.store.snap = {
    current: null,
    groups: [],
    failures: [],
    status: 'idle',
    error: null,
    routable: null,
  };
  await t.selectModelAt('s1', 0);
  assert.ok(
    h.usage.calls.some((c) => c.svc === 'modelDirectories.directoryFor' && c.method === 'load'),
    'load() was used as the fallback',
  );
  assert.deepEqual(JSON.parse(JSON.stringify(h.directory.lastSelection)), {
    provider: 'g1',
    model: 'm1',
    reasoningEffort: 'low',
  });
});

test('select-effort sets the Nth effort of the current model', async () => {
  const h = applyShortcutsPlugin();
  const t = h.plugin.internals;
  await t.selectEffortAt('s1', 4);
  assert.deepEqual(JSON.parse(JSON.stringify(h.directory.lastSelection)), {
    provider: 'g1',
    model: 'm1',
    reasoningEffort: 'extreme',
  });
});

test('cycle-effort advances through the current model effort list and wraps', async () => {
  const h = applyShortcutsPlugin();
  const t = h.plugin.internals;
  t.FEATURE_BY_ID.cycleEffort.run();
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(h.directory.lastSelection)), {
    provider: 'g1',
    model: 'm1',
    reasoningEffort: 'medium',
  });
});

test('empty model list positions degrade without selecting', async () => {
  const h = applyShortcutsPlugin();
  const t = h.plugin.internals;
  h.directory.store.snap = {
    current: null,
    groups: [],
    failures: [],
    status: 'idle',
    error: null,
    routable: null,
  };
  await t.selectModelAt('s1', 5);
  assert.equal(h.directory.lastSelection, undefined, 'no target index -> no select');
});

// ---------------------------------------------------------------------------
// Permission cycling
// ---------------------------------------------------------------------------

test('permission-cycle writes through the loopback route, skips custom, never uses the slash command', async () => {
  const h = applyShortcutsPlugin();
  const fetches = [];
  h.sandbox.fetch = async (url) => {
    fetches.push(String(url));
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  await h.plugin.internals.cyclePermissionRun();
  await tick();
  assert.equal(fetches.length, 1, 'one write through the route');
  assert.ok(
    fetches[0].startsWith('/dsh-shortcuts-permission?sessionId='),
    'no /permission slash command (transcript must stay clean)',
  );
  assert.ok(!fetches[0].includes('/permission?'), 'no /permission command path used');
  assert.equal(h.usage.commandExecutes, 0, 'no remote command execution');
  assert.equal(h.plugin.internals.lastPermResult, '成功：工作区写入');
  assert.equal(
    h.plugin.internals.toastMsg.kind,
    'perm-workspace',
    'permission toast carries the preset tone',
  );
});

test('permission-cycle advances through non-custom presets in cyclic order', async () => {
  const h = applyShortcutsPlugin();
  const fetches = [];
  h.sandbox.fetch = async (url) => {
    fetches.push(String(url));
    const preset = decodeURIComponent(String(url).split('preset=')[1]);
    h.projections.permissions.currentValue = preset;
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const seen = [];
  for (let i = 0; i < 3; i += 1) {
    await h.plugin.internals.cyclePermissionRun();
    await tick();
    seen.push(fetches[fetches.length - 1].split('preset=')[1]);
  }
  assert.deepEqual(
    seen,
    ['workspace-write', 'read-only', 'workspace-write'],
    'read-only -> workspace-write -> read-only (custom skipped)',
  );
});

test('permission-cycle reports failure when the projection is unavailable (retries then toasts)', async () => {
  const h = applyShortcutsPlugin();
  delete h.projections.permissions;
  await h.plugin.internals.cyclePermissionRun();
  await tick();
  for (let i = 0; i < 6; i += 1) {
    const index = h.timerQueue.findIndex((t) => t.ms === 300);
    if (index < 0) break;
    const retry = h.timerQueue.splice(index, 1)[0];
    retry.fn();
    await tick();
  }
  assert.equal(h.plugin.internals.lastPermResult, '失败：权限投影不可用');
  assert.equal(h.plugin.internals.toastMsg.kind, 'error');
});

test('permission-cycle refuses without a current session', async () => {
  const h = applyShortcutsPlugin();
  h.plugin.internals.currentSessionId = undefined;
  await h.plugin.internals.cyclePermissionRun();
  await tick();
  assert.equal(h.plugin.internals.lastPermResult, '失败：当前会话未就绪');
  assert.equal(h.plugin.internals.toastMsg.kind, 'error');
});

test('permission-cycle rejects host-side refusal with the host reason', async () => {
  const h = applyShortcutsPlugin();
  h.sandbox.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ ok: false, error: 'unknown preset "plan"' }),
  });
  await h.plugin.internals.cyclePermissionRun();
  await tick();
  assert.equal(h.plugin.internals.lastPermResult, '失败：unknown preset "plan"');
});

test('perm-tone maps each preset to its toast tone class', () => {
  const { plugin } = loadShortcutsPlugin();
  const t = plugin.internals;
  assert.equal(t.permTone('read-only'), 'perm-readonly');
  assert.equal(t.permTone('workspace-write'), 'perm-workspace');
  assert.equal(t.permTone('danger-full-access'), 'perm-full');
  assert.equal(t.permTone('other'), 'ok');
});

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

test('settings defaults cover every feature and every default combo is parseable', () => {
  const { plugin } = loadShortcutsPlugin();
  const t = plugin.internals;
  const d = t.defaults();
  assert.equal(Object.keys(d.actions).length, t.FEATURES.length);
  for (const f of t.FEATURES) {
    const a = d.actions[f.id];
    assert.equal(a.enabled, true, 'defaults enable every feature');
    if (f.defaultCombo === null) {
      assert.equal(a.combo, null, f.id + ' starts unbound');
    } else {
      assert.ok(
        t.parseCombo(a.combo) !== null,
        f.id + ' default combo must be parseable: ' + a.combo,
      );
    }
  }
  const combos = Object.entries(d.actions)
    .filter(([, a]) => a.combo)
    .map(([, a]) => a.combo);
  assert.equal(
    new Set(combos).size,
    combos.length,
    'default combos must be unique (a conflict means dead keys)',
  );
});

test('settings normalize migrates legacy Meta+Shift+1..5 effort combos to Tab+N', () => {
  const { plugin } = loadShortcutsPlugin();
  const t = plugin.internals;
  const stored = { actions: { selectEffort2: { enabled: true, combo: 'Meta+Shift+2' } } };
  const out = t.normalize(stored);
  assert.equal(out.actions.selectEffort2.combo, 'Tab+2', '1.1.3 migration');
  assert.equal(out.actions.selectEffort1.combo, 'Tab+1');
});

test('settings normalize survives corrupt JSON, unknown ids, invalid combos, and disabled flags', () => {
  const { plugin, browser } = loadShortcutsPlugin();
  const t = plugin.internals;
  browser.window.localStorage.setItem('dsh.shortcuts.v1', '{not json');
  const d = t.loadSettings();
  assert.equal(d.actions.newSession.combo, 'Meta+N', 'corrupt JSON falls back to defaults');
  const out = t.normalize({
    actions: {
      newSession: { enabled: false, combo: 'Meta+N' },
      noSuchFeature: { enabled: true, combo: 'Meta+Z' },
      toggleTheme: { enabled: true, combo: 'Bogus' },
    },
  });
  assert.equal(out.actions.newSession.enabled, false, 'disabled flag preserved');
  assert.equal(out.actions.noSuchFeature, undefined, 'unknown features are dropped');
  assert.equal(out.actions.toggleTheme.combo, null, 'invalid combos normalize to unbound');
});

test('settings save falls back to memory when localStorage throws', () => {
  const { plugin, browser } = loadShortcutsPlugin();
  const t = plugin.internals;
  browser.window.localStorage.setItem = () => {
    throw new Error('quota');
  };
  t.patchSettings((s) => ({
    ...s,
    actions: { ...s.actions, newSession: { enabled: true, combo: 'Meta+Z' } },
  }));
  assert.equal(t.settings.actions.newSession.combo, 'Meta+Z');
  assert.equal(
    t.memoryStore.actions.newSession.combo,
    'Meta+Z',
    'memory fallback keeps the change',
  );
});

// ---------------------------------------------------------------------------
// Recording UI (mini-react)
// ---------------------------------------------------------------------------

function walk(node, fn) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, fn);
    return;
  }
  if (typeof node !== 'object') return;
  fn(node);
  walk(node.props && node.props.children, fn);
}

function textOf(node) {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object') return textOf(node.props && node.props.children);
  return '';
}

function recordButtonOf(h, title) {
  let found = null;
  walk(h.lastTree, (node) => {
    if (found || !node.props || node.props.className !== 'dyn-kbd-row') return;
    if (!textOf(node).includes(title)) return;
    walk(node, (n) => {
      if (
        !found &&
        n.props &&
        n.props.className === 'dyn-kbd-btn' &&
        textOf(n) !== '清除' &&
        textOf(n) !== '恢复默认快捷键'
      )
        found = n;
    });
  });
  return found;
}

test('recording flow: record a new combo, then conflict detection rejects a duplicate', () => {
  const h = applyShortcutsPlugin();
  h.lastTree = h.React.render(h.plugin.internals.ShortcutsPage, {});
  const btn = recordButtonOf(h, '快捷键速查表');
  assert.ok(btn, 'record button found for the cheatsheet feature');
  btn.props.onClick();
  h.React.flush();
  assert.equal(h.plugin.internals.recordingAction, 'showCheatsheet', 'recording mode enters');
  dispatch(h, 'keydown', { key: 'C', metaKey: true, shiftKey: true });
  h.React.flush();
  assert.equal(h.plugin.internals.settings.actions.showCheatsheet.combo, 'Meta+Shift+C');
  assert.equal(h.plugin.internals.recordingAction, null, 'recording exits after a combo');
  const btn2 = recordButtonOf(h, '会话快速切换');
  btn2.props.onClick();
  h.React.flush();
  dispatch(h, 'keydown', { key: 'C', metaKey: true, shiftKey: true });
  h.React.flush();
  assert.equal(
    h.plugin.internals.settings.actions.quickSwitcher.combo,
    'Meta+K',
    'duplicate combo is rejected',
  );
  assert.equal(
    String(h.plugin.internals.recordingAction),
    'quickSwitcher',
    'recording stays active on conflict',
  );
});

test('recording flow: Escape cancels and Backspace clears the binding', () => {
  const h = applyShortcutsPlugin();
  h.lastTree = h.React.render(h.plugin.internals.ShortcutsPage, {});
  const btn = recordButtonOf(h, '切换界面语言');
  btn.props.onClick();
  h.React.flush();
  dispatch(h, 'keydown', { key: 'Escape' });
  h.React.flush();
  assert.equal(h.plugin.internals.recordingAction, null, 'Escape cancels');
  btn.props.onClick();
  h.React.flush();
  dispatch(h, 'keydown', { key: 'Backspace' });
  h.React.flush();
  assert.equal(
    h.plugin.internals.settings.actions.cycleLocale.combo,
    null,
    'Backspace clears the binding',
  );
  assert.equal(h.plugin.internals.recordingAction, null);
});

// ---------------------------------------------------------------------------
// Diagnostics / key log / React rules / PBT
// ---------------------------------------------------------------------------

test('diagnostics read the permissions projection and probe remote.commands without throwing', () => {
  const h = applyShortcutsPlugin();
  const info = h.plugin.internals.diagnosticInfo();
  assert.equal(info.sessionId, 's1');
  assert.match(info.permState, /3 档/, 'permission projection reports its option count');
  assert.equal(info.remoteOk, true);
  assert.match(info.cyclePermission, /已启用/);
});

test('key log keeps the most recent 30 entries and marks hits', () => {
  const h = applyShortcutsPlugin();
  for (let i = 0; i < 40; i += 1) {
    dispatch(h, 'keydown', { key: 'K', metaKey: true });
  }
  assert.equal(h.plugin.internals.keyLog.length, 30, 'ring buffer cap');
  assert.ok(
    h.plugin.internals.keyLog.filter((_, i) => i % 2 === 1).every((e) => e.hit === true),
    'hit-tagged entries survive the ring buffer',
  );
});

test('React hooks order: Cheatsheet keeps useEffect before its conditional return (react #310 guard)', () => {
  const source = readFileSync(SHORTCUTS_CLIENT_PATH, 'utf8');
  const start = source.indexOf('function Cheatsheet()');
  const end = source.indexOf('function ShortcutButton');
  const body = source.slice(start, end);
  const effect = body.indexOf('React.useEffect(');
  const gate = body.indexOf('if (!state.cheatsheetOpen) return null;');
  assert.ok(effect >= 0 && gate >= 0, 'shape found');
  assert.ok(effect < gate, 'useEffect must precede the conditional return');
});

test('PBT: any parseable combo matches its own event and rejects a single-bit change', () => {
  const { plugin } = loadShortcutsPlugin();
  const t = plugin.internals;
  const mods = ['Meta', 'Control', 'Alt', 'Shift'];
  const keys = ['A', 'B', '1', '2', '.', '/', ',', 'K'];
  fc.assert(
    fc.property(
      fc.set(fc.constantFrom(...mods), { minLength: 1, maxLength: 4 }),
      fc.constantFrom(...keys),
      (modSet, key) => {
        const combo = [...modSet].join('+') + '+' + key;
        const parsed = t.parseCombo(combo);
        if (parsed === null) return true;
        const event = {
          key,
          metaKey: modSet.has('Meta'),
          ctrlKey: modSet.has('Control'),
          altKey: modSet.has('Alt'),
          shiftKey: modSet.has('Shift'),
        };
        if (!t.matchCombo(combo, event)) return false;
        const flip = { ...event, metaKey: !event.metaKey };
        if (!event.metaKey && t.matchCombo(combo, flip)) return false;
        const other = { ...event, key: 'Z' };
        if (key !== 'Z' && t.matchCombo(combo, other)) return false;
        return true;
      },
    ),
  );
});

test('PBT: permission cycle never targets custom and always lands on a provided preset', async () => {
  const pool = ['read-only', 'workspace-write', 'danger-full-access', 'custom', 'plan'];
  await fc.assert(
    fc.asyncProperty(
      fc
        .array(fc.constantFrom(...pool), { minLength: 1, maxLength: 5 })
        .map((v) => [...new Set(v)]),
      fc.constantFrom(...pool),
      async (values, current) => {
        const h = applyShortcutsPlugin();
        h.projections.permissions = {
          options: values.map((v) => ({ value: v, name: v })),
          currentValue: current,
        };
        const got = [];
        h.sandbox.fetch = async (url) => {
          const preset = decodeURIComponent(String(url).split('preset=')[1]);
          got.push(preset);
          h.projections.permissions.currentValue = preset;
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        };
        await h.plugin.internals.cyclePermissionRun();
        await tick();
        // A host projection never repeats a preset value (deduplicated by the
        // permissionPresets service) — the invariant is over the distinct set.
        const nonCustom = [...new Set(values.filter((v) => v !== 'custom'))];
        if (nonCustom.length === 0) return true;
        if (got.length !== 1) return false;
        const next = got[0];
        if (next === 'custom') return false;
        if (!nonCustom.includes(next)) return false;
        if (nonCustom.length > 1 && next === current) return false;
        return true;
      },
    ),
  );
});
