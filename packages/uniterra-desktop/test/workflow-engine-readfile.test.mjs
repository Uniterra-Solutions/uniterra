/**
 * Regression test for the vendored `@dsh-external/workflow` engine's
 * `wf.readFile` capability (LOCAL PATCH 2026-08).
 *
 * The `implement` capsule inlines each task's `promptFile` brief into the
 * subagent prompt via `wf.readFile`, so the subagent does NOT read the file
 * itself. This pins the engine host method it depends on:
 *   - resolves a repo-relative path against the parent session's cwd and reads
 *     it as UTF-8;
 *   - rejects a path that escapes the workspace (absolute or `..`);
 *   - rejects a non-existent file.
 *
 * Regression net: `packages/uniterra-desktop/test/workflow-engine-readfile.test.mjs`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./workflow-engine-stub-loader.mjs', new URL('./', import.meta.url));
const { DynamicWorkflowEngine } = await import('../../../vendor/dsh-plugins/dsh-workflow/lib/engine.js');

/** A minimal engine with the config the createApi construction path touches. */
function makeEngine() {
  return new DynamicWorkflowEngine({
    config: {
      maxConcurrency: 8,
      synthesisProvider: 'balanced',
      modelTiers: { balanced: { maxTokens: 1 } },
      scriptSyncTimeoutMs: 5_000,
      scriptWallTimeoutMs: 30_000,
      maxResultChars: 1024,
    },
    store: { list: () => [], get: () => undefined, getEvents: () => [] },
  });
}

/** A minimal `run` carrying only the fields `createApi` touches at build time. */
function makeRun(cwd) {
  return {
    input: {
      args: {},
      parent: { session: { header: { cwd } } },
      module: { manifest: { tokenBudget: null, maxConcurrency: 8 } },
    },
    snapshot: { runId: 'run-1' },
    spentTokens: 0,
    reservedTokens: 0,
    tasks: new Map(),
    writer: { artifact: () => ({ name: '', path: '' }) },
  };
}

test('wf.readFile resolves a repo-relative path against the parent cwd and reads it as UTF-8', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'uniterra-wf-readfile-'));
  try {
    writeFileSync(join(cwd, 'brief.md'), '# Task\n\nGoal: stub\n', 'utf8');
    const engine = makeEngine();
    const api = engine.createApi(makeRun(cwd), {});
    const content = await api.readFile('brief.md');
    assert.equal(content, '# Task\n\nGoal: stub\n');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('wf.readFile rejects a path that escapes the workspace', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'uniterra-wf-readfile-'));
  try {
    mkdirSync(join(cwd, 'sub'));
    writeFileSync(join(cwd, 'outer.md'), 'x', 'utf8');
    const engine = makeEngine();
    const api = engine.createApi(makeRun(cwd), {});
    // Absolute path outside the workspace.
    await assert.rejects(() => api.readFile('/etc/hosts'), /escapes the workspace/);
    // `..` traversal out of the workspace.
    await assert.rejects(() => api.readFile('../outer.md'), /escapes the workspace/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('wf.readFile rejects a non-existent file', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'uniterra-wf-readfile-'));
  try {
    const engine = makeEngine();
    const api = engine.createApi(makeRun(cwd), {});
    await assert.rejects(() => api.readFile('missing.md'), /no such file/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
