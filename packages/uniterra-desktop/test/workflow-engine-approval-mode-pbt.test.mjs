/**
 * Property-based regression test for the vendored `@dsh-external/workflow`
 * engine's approval gate keyed to the SESSION SANDBOX MODE — the knob the
 * `/permission` presets (read-only / workspace-write / danger-full-access)
 * actually switch.
 *
 * BUG: `needsApproval` keyed the gate on the session's APPROVAL POLICY
 * (`effectivePolicy === 'never'`). The approval-policy knob and the
 * sandbox-mode knob are INDEPENDENT session facts (the permission-preset
 * service writes both, but delegation copies them separately — sessions at
 * `workspace-write` sandbox + `never` approval exist in production), and the
 * user-facing modes are the SANDBOX modes:
 *   - read-only      → workflow run REQUIRES the user's approval (popup).
 *   - workspace-write→ workflow run REQUIRES the user's approval (popup).
 *   - danger-full-access → the approval step is SKIPPED entirely.
 * Under a `danger-full-access` sandbox with an `ask` policy the old gate
 * decided "approval needed", called `ApprovalService.request()` and was then
 * auto-rejected or raced away — the run was denied without any user prompt.
 *
 * FIX: when a `sandboxPolicy` seam is mounted, `needsApproval` resolves the
 * session's effective sandbox mode first: `danger-full-access` returns false
 * (full access runs ungated); `read-only` / `workspace-write` follow the
 * plugin's `approvalMode` (the push-to-user path). The approval-policy knob
 * is no longer consulted as a decision input when the seam is mounted.
 *
 * INVARIANT pinned here:
 *   For every (approvalMode, sandboxMode, execution) with the sandbox seam:
 *     - sandboxMode danger-full-access => needsApproval === false.
 *     - sandboxMode read-only / workspace-write => needsApproval follows
 *       approvalMode: never => false; generated-and-local => true only for
 *       capability-generated / trusted-local; always => true.
 *
 * The policy-free rule is independent of the approval-policy knob; the
 * `workflow-engine-approval-pbt` suite pins the no-seam fallback.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./workflow-engine-stub-loader.mjs', new URL('./', import.meta.url));
const { DynamicWorkflowEngine } =
  await import('../../../vendor/dsh-plugins/dsh-workflow/lib/engine.js');

/** Build a real engine with a scripted sandbox-policy seam and approval service. */
function engineFor(approvalMode, sandboxMode, policy) {
  return new DynamicWorkflowEngine({
    config: { approvalMode },
    approval: {
      effectivePolicy() {
        return policy;
      },
    },
    sandboxPolicy: {
      resolve({ session }) {
        return {
          mode: sandboxMode,
          workspaceRoot: '/w',
          ...(session === undefined ? {} : { sessionId: session.id }),
        };
      },
    },
  });
}

const execution = fc.constantFrom('trusted-package', 'capability-generated', 'trusted-local');
const approvalMode = fc.constantFrom('never', 'generated-and-local', 'always');
const sandboxMode = fc.constantFrom('read-only', 'workspace-write', 'danger-full-access');
const policy = fc.constantFrom('ask', 'never');

function needsApproval(mode, sandbox, policy_, executionKind) {
  const engine = engineFor(mode, sandbox, policy_);
  return engine.needsApproval({
    requireApproval: undefined,
    parent: { session: { id: 's' } },
    module: {
      execution: executionKind,
      manifest: { name: 'w', maxAgents: 1, maxConcurrency: 1, readOnly: false },
    },
  });
}

/** Mode-keyed reference: what needsApproval SHOULD be for this quadruple. */
function expected(mode, sandbox, _policy, executionKind) {
  if (sandbox === 'danger-full-access') return false; // full access: never gate
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  return executionKind === 'capability-generated' || executionKind === 'trusted-local';
}

test('needsApproval keys on the session sandbox mode: full access runs ungated, restricted modes ask', () => {
  fc.assert(
    fc.property(
      approvalMode,
      sandboxMode,
      policy,
      execution,
      (mode, sandbox, policy_, executionKind) => {
        const got = needsApproval(mode, sandbox, policy_, executionKind);
        const want = expected(mode, sandbox, policy_, executionKind);
        assert.equal(
          got,
          want,
          `approvalMode=${mode} sandbox=${sandbox} policy=${policy_} execution=${executionKind}`,
        );
      },
    ),
    { numRuns: 300 },
  );
});

/// Concrete anchor cases (no RNG): the counterexamples the review confirmed red.
const anchors = [
  // Full access must skip the gate even when the approval knob still says 'ask'.
  ['generated-and-local', 'danger-full-access', 'ask', 'capability-generated', false],
  ['generated-and-local', 'danger-full-access', 'ask', 'trusted-local', false],
  ['always', 'danger-full-access', 'ask', 'trusted-package', false],
  // Restricted modes must gate exactly per approvalMode; the policy knob does not decide.
  ['generated-and-local', 'workspace-write', 'ask', 'capability-generated', true],
  ['generated-and-local', 'workspace-write', 'never', 'capability-generated', true],
  ['generated-and-local', 'read-only', 'ask', 'capability-generated', true],
  ['generated-and-local', 'read-only', 'never', 'capability-generated', true],
  ['generated-and-local', 'workspace-write', 'ask', 'trusted-package', false],
  ['generated-and-local', 'read-only', 'ask', 'trusted-local', true],
  ['never', 'workspace-write', 'ask', 'capability-generated', false],
  ['never', 'read-only', 'never', 'capability-generated', false],
];

test('needsApproval mode-keyed deterministic anchor cases', () => {
  for (const [mode, sandbox, policy_, kind, want] of anchors) {
    assert.equal(
      needsApproval(mode, sandbox, policy_, kind),
      want,
      `anchor ${mode}/${sandbox}/${policy_}/${kind}`,
    );
  }
});

test('needsApproval mode-keyed does not crash when parent is undefined', () => {
  const engine = engineFor('generated-and-local', 'workspace-write', 'ask');
  assert.equal(
    engine.needsApproval({
      requireApproval: undefined,
      module: {
        execution: 'capability-generated',
        manifest: { name: 'w', maxAgents: 1, maxConcurrency: 1, readOnly: false },
      },
    }),
    true,
  );
});

test('needsApproval explicit requireApproval still wins over the sandbox mode', () => {
  const engine = engineFor('generated-and-local', 'danger-full-access', 'never');
  assert.equal(
    engine.needsApproval({
      requireApproval: true,
      parent: { session: { id: 's' } },
      module: {
        execution: 'capability-generated',
        manifest: { name: 'w', maxAgents: 1, maxConcurrency: 1, readOnly: false },
      },
    }),
    true,
  );
});
