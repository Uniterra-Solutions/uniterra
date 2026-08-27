/**
 * Deterministic regression test for the vendored `@dsh-external/workflow`
 * plugin's per-tier output-token ceilings.
 *
 * INVARIANT pinned here:
 *   The engine's default `modelTiers.{fast,balanced,deep}.maxTokens` must NOT be
 *   so small that a normally-reasoning child agent is truncated mid-response.
 *
 * BUG: the plugin's schema defaulted the tiers to 4_096 / 8_192 / 16_384. A
 * workflow `runAgent`/`spawnAgent` without an explicit `maxTokens` resolves to
 * the `balanced` tier, so the child was given `agentOptions.maxTokens = 8_192`,
 * which the provider forwards verbatim as `max_output_tokens`. A reasoning-heavy
 * agent (e.g. the review workflow's FIXER AGENT) burned the whole 8_192 ceiling
 * inside one giant chain-of-thought trace and the upstream gateway ended the
 * response as `response.incomplete` → `INCOMPLETE` ("response not completed").
 * Normal subagent/main-agent calls never pass through the plugin's `modelTiers`,
 * so they use the model's real default and are not truncated — which is why the
 * failure only ever showed up on workflow agents.
 *
 * FIX: raise every tier ceiling to the model's real max output (384_000) so a
 * workflow agent is never capped below the model's own capability.
 *
 * This test is a deterministic source-pattern guard (a maintainer re-introducing
 * a tiny ceiling gets a red test without needing to run a live model).
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

/** Floor below which a default ceiling is clearly too small to be deliberate. */
const MIN_SANE_CEILING = 32_768;

function defaultCeiling(name) {
  const re = new RegExp(`${name}\\s*:\\s*z\\.natural\\(\\)\\.min\\(1\\)\\.default\\((\\d[\\d_]*)\\)`);
  const match = source.match(re);
  assert.ok(match, `schema default for ${name} not found in ${pluginIndex}`);
  return Number(match[1].replaceAll('_', ''));
}

for (const tier of ['fastMaxTokens', 'balancedMaxTokens', 'deepMaxTokens']) {
  test(`${tier} default ceiling is not artificially small`, () => {
    const value = defaultCeiling(tier);
    assert.ok(
      value >= MIN_SANE_CEILING,
      `${tier} default is ${value}, below the ${MIN_SANE_CEILING} floor — a workflow ` +
        'agent would be truncated mid-response by a ceiling far under the model\u2019s real max output.',
    );
  });
}
