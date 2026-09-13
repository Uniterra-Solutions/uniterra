/**
 * Configuration-compatibility properties: the `llm-uniterra` model-row format is
 * this plugin's EXTERNAL contract. dsh persists the settings section in the
 * profile and serves it back on the next boot, so a row written while the
 * plugin ran on the previous dsh family must keep validating and resolving to
 * exactly the same facts after the family bump — no field renamed, no field
 * silently dropped, and no previously-optional field turned required.
 *
 * The property sweeps every subset of the row's optional fields through the
 * same schema the settings section validates a write with; the deterministic
 * cases pin the exact row an earlier family could persist and the set of
 * required fields. All tests run on the built `lib/`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as plugin from '../lib/index.js';

/** Deterministic 32-bit PRNG so failing counterexamples are reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every optional model-row field, with one value the earlier family accepted. */
const OPTIONAL_ROW_FIELDS = {
  name: 'Legacy Model',
  description: 'persisted before the dsh 0.1.5 family',
  contextWindow: 65536,
  maxTokens: 4096,
  api: 'responses',
  reasoningEfforts: ['low', 'high'],
  defaultReasoningEffort: 'high',
  inputModalities: ['text', 'image'],
};

test('property: every legacy subset of model-row fields still validates and resolves unchanged', () => {
  const rand = mulberry32(0x11a9);
  for (let run = 0; run < 16; run += 1) {
    const row = { id: `legacy-${String(run)}` };
    for (const [field, value] of Object.entries(OPTIONAL_ROW_FIELDS)) {
      if (rand() < 0.5) row[field] = value;
    }
    // A default effort only ever accompanied a declared effort list: the pair
    // was already invalid without it, before the family bump.
    if (row.defaultReasoningEffort !== undefined && row.reasoningEfforts === undefined) {
      delete row.defaultReasoningEffort;
    }

    // The same validation the settings section runs on a write.
    const section = plugin.Config({ models: [row] });
    assert.deepEqual(
      plugin.resolveAdapterOptions(section).models,
      [row],
      `run ${String(run)}: a row valid before the family bump must resolve to the same facts`,
    );
  }
});

test('regression: the model row an earlier dsh family persisted still resolves to the same facts', () => {
  // The exact shape a profile written under dsh 0.1.2-rc.1 stores.
  const legacyRow = {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    description: 'row persisted under dsh 0.1.2-rc.1',
    contextWindow: 65536,
    maxTokens: 8192,
    api: 'chat-completions',
    reasoningEfforts: ['low', 'high', 'max'],
    defaultReasoningEffort: 'high',
    inputModalities: ['text'],
  };
  const resolved = plugin.resolveAdapterOptions(plugin.Config({ models: [legacyRow] }));
  assert.deepEqual(resolved.models, [legacyRow]);
  // The connection-level facts that section relied on are unchanged too.
  assert.equal(resolved.api, 'chat-completions');
  assert.equal(resolved.defaultContextWindow, plugin.DEFAULT_CONTEXT_WINDOW);
  assert.deepEqual(resolved.modelExcludePatterns, [...plugin.DEFAULT_MODEL_EXCLUDE_PATTERNS]);
  assert.equal(resolved.streamIdleTimeoutMs, plugin.DEFAULT_STREAM_IDLE_TIMEOUT_MS);
});

test('regression: the model-row schema requires exactly id', () => {
  // A row that omits every optional field still validates.
  assert.deepEqual(
    plugin.resolveAdapterOptions(plugin.Config({ models: [{ id: 'bare' }] })).models,
    [{ id: 'bare' }],
  );
  // No new required top-level field appeared either: an empty section parses.
  const empty = plugin.Config({});
  assert.deepEqual(empty.models, []);
  assert.equal(empty.api, 'chat-completions');
  // `id` is still the ONLY required field, so a nameless row still fails loudly.
  assert.throws(
    () => plugin.Config({ models: [{ name: 'no id' }] }),
    (error) => error.message.includes('id missing required value'),
    'a row without its only required field must still be refused',
  );
});
