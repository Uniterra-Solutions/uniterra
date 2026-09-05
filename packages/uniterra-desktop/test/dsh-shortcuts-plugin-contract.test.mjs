/**
 * dsh-shortcuts plugin-side contract: pins the exact dsh-facing surface the
 * vendored client bundle exposes and consumes. Every assertion here names a
 * seam (module-table registration, module face, declared inject list, slots,
 * service/projection/DOM usage per feature). The companion
 * dsh-shortcuts-dsh-api test verifies the SAME usage table against the pinned
 * dsh sources (vendor/dsh-harness), so a dsh drift fails there by name.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadShortcutsPlugin, applyShortcutsPlugin } from './helpers/dsh-shortcuts-harness.mjs';

test('client bundle registers under the package name with the expected module face', () => {
  const { plugin } = loadShortcutsPlugin();
  assert.equal(typeof plugin.apply, 'function', 'factory must export apply');
  assert.deepEqual(
    [...plugin.inject],
    ['slots', 'sessions', 'remote', 'timer'],
    'module-level inject is the web boot gate: every name must be provided or the whole page fails to boot',
  );
});

test('apply wires exactly the four declared slot surfaces', () => {
  const h = applyShortcutsPlugin();
  assert.deepEqual(h.usage.slots, [
    'settings.section',
    'shell.overlay',
    'shell.overlay',
    'shell.overlay',
    'sidebar.footer.action',
  ]);
  const regs = h.usage.slotsRegisters.map(({ name, id, order, label }) => ({
    name,
    id,
    order,
    label,
  }));
  assert.deepEqual(regs, [
    { name: 'settings.section', id: 'dyn-shortcuts', order: 30, label: '快捷键' },
    { name: 'shell.overlay', id: 'dyn-shortcuts-palette', order: undefined, label: undefined },
    { name: 'shell.overlay', id: 'dyn-shortcuts-cheatsheet', order: undefined, label: undefined },
    { name: 'shell.overlay', id: 'dyn-shortcuts-toast', order: undefined, label: undefined },
    { name: 'sidebar.footer.action', id: 'dyn-shortcuts', order: 10, label: undefined },
  ]);
});

test('feature registry is well-formed: unique ids, complete metadata, runnable', () => {
  const { plugin } = loadShortcutsPlugin();
  const t = plugin.internals;
  const ids = new Set();
  for (const f of t.FEATURES) {
    assert.ok(typeof f.id === 'string' && f.id.length > 0, 'feature id');
    assert.ok(!ids.has(f.id), 'duplicate feature id: ' + f.id);
    ids.add(f.id);
    for (const key of ['group', 'label', 'description', 'run', 'defaultCombo']) {
      assert.ok(key in f, 'feature ' + f.id + ' lacks ' + key);
    }
    assert.equal(typeof f.run, 'function', 'feature run');
  }
  assert.equal(
    t.FEATURES.length,
    34,
    '34 pre-registered features (ready toast + cheatsheet count)',
  );
  assert.equal(t.FEATURE_BY_ID.newSession.id, 'newSession');
});

/**
 * The per-feature service surface, captured against the pinned dsh faces.
 * A `missing: true` row is a seam the plugin attempts on a member the pinned
 * family does not provide — the plugin-side half of a break found by the
 * dsh-api conformance test.
 */
import { FEATURE_USAGE, EXPECTED_DOM } from './helpers/dsh-shortcuts-surface-table.mjs';

function domKey(line) {
  return line.replace(/\s/g, '');
}

test('each feature dsh surface (services + projections + DOM) exactly matches the contract table', async () => {
  const features = loadShortcutsPlugin().plugin.internals.FEATURES;
  for (const feature of features) {
    const expected = FEATURE_USAGE[feature.id];
    assert.ok(expected, 'contract table missing entry for feature ' + feature.id);
    const h = applyShortcutsPlugin();
    const t = h.plugin.internals;
    const baseline = h.usage.calls.length;
    const domBaseline = h.browser.usage.dom.length;
    try {
      const result = t.FEATURE_BY_ID[feature.id].run();
      if (result && typeof result.then === 'function') await result;
    } catch {
      // Broken seams surface through the recorded missing calls below.
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    const calls = h.usage.calls.slice(baseline).map((c) => ({
      svc: c.svc,
      method: c.method,
      ...(c.missing === true ? { missing: true } : {}),
      ...(c.args && c.args.length > 0
        ? {
            args: c.args.map((a) =>
              typeof a === 'object' && a !== null ? JSON.parse(JSON.stringify(a)) : a,
            ),
          }
        : {}),
    }));
    assert.deepEqual(
      calls,
      expected,
      'feature ' + feature.id + ' service surface drifted from the pinned contract',
    );
    const dom = h.browser.usage.dom.slice(domBaseline).map(domKey);
    assert.deepEqual(
      dom,
      (EXPECTED_DOM[feature.id] ?? []).map(domKey),
      'feature ' + feature.id + ' DOM surface drifted',
    );
  }
});
