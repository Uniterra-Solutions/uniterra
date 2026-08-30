/**
 * Deterministic regression test for the vendored `@dsh-external/workflow`
 * plugin's whole-run wall-clock limit default.
 *
 * INVARIANT pinned here:
 *   The plugin default `scriptWallTimeoutMs` must be at least 8 hours, and the
 *   schema `z.default` must agree with the `resolveConfig` fallback.
 *
 * BUG: the plugin defaulted `scriptWallTimeoutMs` to `3_600_000` (1 h). The
 * QuickJS runtime arms that value as a wall deadline for the WHOLE workflow
 * script, including the time its `run(wf, args)` is still awaiting subagents.
 * A multi-hour agent fan-out therefore "timed out" while its children were
 * still working: the deadline fired, `onTimeout` called
 * `engine.stop(runId, 'workflow script timed out')`, every still-running child
 * was cancelled, and `run_workflow(..., { wait: true })` surfaced a `stopped`
 * run with `workflow script timed out after 3600000ms` — the "system timeout,
 * agents unfinished" failure.
 *
 * FIX: raise the default to 8 h (28_800_000) so a long workflow run is only
 * limited by an explicit config override, not by a default shorter than the
 * work it legitimately takes.
 *
 * This test is a deterministic source-pattern guard (a maintainer re-introducing
 * a sub-8-hour default gets a red test without running a live workflow).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pluginIndex = join(
  here,
  '..',
  '..',
  '..',
  'vendor/dsh-plugins/dsh-workflow/lib/index.js',
);

const source = readFileSync(pluginIndex, 'utf8');

/** Floor below which the default would abort long multi-agent runs. */
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1_000;

function schemaDefault(name) {
  const re = new RegExp(
    `${name}\\s*:\\s*z\\.natural\\(\\)\\.min\\(1\\)\\.default\\((\\d[\\d_]*)\\)`,
  );
  const match = source.match(re);
  assert.ok(match, `schema default for ${name} not found in ${pluginIndex}`);
  return Number(match[1].replaceAll('_', ''));
}

function resolveConfigFallback(name) {
  const re = new RegExp(
    `${name}\\s*:\\s*config\\.${name}\\s*\\?\\?\\s*(\\d[\\d_]*),`,
  );
  const match = source.match(re);
  assert.ok(
    match,
    `resolveConfig fallback for ${name} not found in ${pluginIndex}`,
  );
  return Number(match[1].replaceAll('_', ''));
}

test('scriptWallTimeoutMs schema default is at least 8 hours', () => {
  const value = schemaDefault('scriptWallTimeoutMs');
  assert.ok(
    value >= EIGHT_HOURS_MS,
    `scriptWallTimeoutMs default is ${value}ms, below the ${EIGHT_HOURS_MS}ms (8 h) floor — ` +
      'a long multi-agent workflow run would be aborted while its children are still working.',
  );
});

test('scriptWallTimeoutMs resolveConfig fallback agrees with the schema default', () => {
  const fallback = resolveConfigFallback('scriptWallTimeoutMs');
  assert.equal(
    fallback,
    schemaDefault('scriptWallTimeoutMs'),
    'resolveConfig and the schema must share one default — a drifting fallback ' +
      're-introduces the 1 h abort for configs that skip the schema merge.',
  );
  assert.ok(
    fallback >= EIGHT_HOURS_MS,
    `scriptWallTimeoutMs resolveConfig fallback is ${fallback}ms, below the ${EIGHT_HOURS_MS}ms (8 h) floor.`,
  );
});
