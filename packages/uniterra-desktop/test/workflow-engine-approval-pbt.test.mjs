/**
 * Property-based regression test for the vendored `@dsh-external/workflow`
 * engine's approval gate (`DynamicWorkflowEngine.needsApproval`).
 *
 * BUG: in full-access mode the DSH session's effective approval policy is
 * `never` (the "danger-full-access / no approval prompts" preset). The engine
 * STILL decided it needed approval (its static `approvalMode` defaulted to
 * `generated-and-local`), called `ApprovalService.request()`, and the DSH
 * approval service auto-rejects any request under policy `never` (fail-closed).
 * The run was therefore DENIED before any child started — the workflow "cannot
 * start" in full access instead of running without needing permission.
 *
 * FIX: `needsApproval` consults the live session approval policy. When the
 * session policy is `never`, it returns false so the workflow runs ungated.
 *
 * INVARIANT pinned here:
 *   For every (approvalMode, sessionPolicy, execution) triple:
 *     - sessionPolicy never  ==> needsApproval === false  (full access runs).
 *     - sessionPolicy ask    ==> needsApproval follows approvalMode:
 *         never => false; generated-and-local => true only for
 *         capability-generated / trusted-local; always => true.
 *
 * `workflow-engine-approval-regression.test.mjs` pins each concrete
 * counterexample deterministically.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./workflow-engine-stub-loader.mjs', new URL('./', import.meta.url));
const { DynamicWorkflowEngine } =
  await import('../../../vendor/dsh-plugins/dsh-workflow/lib/engine.js');

/** Build a real engine with a scripted approval service whose policy is fixed. */
function engineFor(approvalMode, sessionPolicy) {
  return new DynamicWorkflowEngine({
    config: { approvalMode },
    approval: {
      effectivePolicy() {
        return sessionPolicy;
      },
    },
  });
}

const execution = fc.constantFrom('trusted-package', 'capability-generated', 'trusted-local');
const approvalMode = fc.constantFrom('never', 'generated-and-local', 'always');
const sessionPolicy = fc.constantFrom('ask', 'never');

function needsApproval(mode, policy, executionKind) {
  const engine = engineFor(mode, policy);
  return engine.needsApproval({
    requireApproval: undefined,
    parent: { session: {} },
    module: {
      execution: executionKind,
      manifest: { name: 'w', maxAgents: 1, maxConcurrency: 1, readOnly: false },
    },
  });
}

/** Invariant reference: what needsApproval SHOULD be for this triple. */
function expected(mode, policy, executionKind) {
  if (policy === 'never') return false; // full access: never gate
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  return executionKind === 'capability-generated' || executionKind === 'trusted-local';
}

test('needsApproval honors the session approval policy (never = full access runs ungated)', () => {
  fc.assert(
    fc.property(approvalMode, sessionPolicy, execution, (mode, policy, executionKind) => {
      const got = needsApproval(mode, policy, executionKind);
      const want = expected(mode, policy, executionKind);
      assert.equal(got, want, `approvalMode=${mode} policy=${policy} execution=${executionKind}`);
    }),
    { numRuns: 300 },
  );
});

/// Concrete anchor cases (no RNG): the counterexamples the review confirmed red.
const anchors = [
  ['generated-and-local', 'never', 'capability-generated', false],
  ['generated-and-local', 'ask', 'capability-generated', true],
  ['generated-and-local', 'ask', 'trusted-package', false],
  ['generated-and-local', 'ask', 'trusted-local', true],
  ['always', 'never', 'trusted-package', false],
  ['always', 'ask', 'trusted-package', true],
  ['never', 'ask', 'capability-generated', false],
];

test('needsApproval deterministic anchor cases', () => {
  for (const [mode, policy, kind, want] of anchors) {
    assert.equal(needsApproval(mode, policy, kind), want, `anchor ${mode}/${policy}/${kind}`);
  }
});

test('needsApproval does not crash when approval service is absent', () => {
  const engine = new DynamicWorkflowEngine({ config: { approvalMode: 'generated-and-local' } });
  const got = engine.needsApproval({
    requireApproval: undefined,
    parent: { session: {} },
    module: {
      execution: 'capability-generated',
      manifest: { name: 'w', maxAgents: 1, maxConcurrency: 1, readOnly: false },
    },
  });
  // Without a DSH approval service, the static approvalMode gate still applies.
  assert.equal(got, true);
});

test('needsApproval does not crash when parent is undefined', () => {
  const engine = engineFor('generated-and-local', 'never');
  assert.equal(
    engine.needsApproval({
      requireApproval: undefined,
      module: {
        execution: 'capability-generated',
        manifest: { name: 'w', maxAgents: 1, maxConcurrency: 1, readOnly: false },
      },
    }),
    false,
  );
});

test('needsApproval explicit requireApproval still wins over policy', () => {
  const engine = engineFor('generated-and-local', 'never');
  assert.equal(
    engine.needsApproval({
      requireApproval: true,
      parent: { session: {} },
      module: {
        execution: 'capability-generated',
        manifest: { name: 'w', maxAgents: 1, maxConcurrency: 1, readOnly: false },
      },
    }),
    true,
  );
});
