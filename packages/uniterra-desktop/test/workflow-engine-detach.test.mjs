/**
 * Deterministic regression test for the vendored `@dsh-external/workflow`
 * engine's run-controller signal lifecycle in Code Mode (the PTC preset).
 *
 * BUG: `DynamicWorkflowEngine.start()` permanently forwards the launching
 * tool-exec signal into the long-lived run controller (`forward = () =>
 * controller.abort(...)`, removed only when `execute()` settles). In Code
 * Mode the tool-exec signal IS the `run_code` run controller, which the
 * code-mode registry aborts as soon as the model's program settles
 * ("run_code settled") — even though a background workflow launch
 * (`wait: false`) already returned. The abort then raced the still-pending
 * approval ask: the DSH answerer settles `cancelled` on an aborted signal
 * and the run is DENIED ("workflow approval cancelled") without the user ever
 * being asked. In Standard mode the exec signal is the agent-loop turn
 * signal, which is not aborted when the tool step closes, so the same flow
 * worked — exactly "only standard mode works".
 *
 * FIX: the run handle exposes `detach()`, which the service calls the
 * moment a launch is handed to the background-job system. After detach the
 * run (and its pending approval ask) is owned by the DSH job system and the
 * launcher step's signal no longer reaches the run controller; a synchronously
 * awaited run (`wait: true`) keeps the binding so cancelling the parent
 * still cancels the workflow.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./workflow-engine-stub-loader.mjs', new URL('./', import.meta.url));
const { DynamicWorkflowEngine } =
  await import('../../../vendor/dsh-plugins/dsh-workflow/lib/engine.js');

/** Minimal fake store writer: records every append, persists nothing. */
function storeOf(events) {
  return {
    create: () => ({
      append: (type, data) => {
        const event = { seq: events.length, type, data };
        events.push(event);
        return event;
      },
      writeSnapshot: () => {},
      snapshotScript: () => {},
      artifact: () => {
        throw new Error('unexpected artifact');
      },
      cacheKey: () => 'c',
      getCached: () => undefined,
      setCached: () => {},
    }),
    getEvents: () => events,
    prune: () => {},
  };
}

/** A session stub that records session-level appends. */
function sessionOf(appends) {
  return {
    id: 'session-s',
    header: { cwd: '/w' },
    append: (type, data) => {
      appends.push({ type, data });
    },
  };
}

const manifest = {
  name: 'detach-probe',
  description: 'detach probe',
  phases: ['p'],
  readOnly: true,
  maxAgents: 1,
  maxConcurrency: 1,
  patterns: ['loop-until-done'],
};

function engineOf(events, approvalRequests) {
  return new DynamicWorkflowEngine({
    config: {
      approvalMode: 'generated-and-local',
      availableTools: [],
      availableMcp: [],
      availableSkills: [],
      modelTiers: { balanced: {} },
      maxResultChars: 1000,
    },
    approval: {
      effectivePolicy: () => 'ask',
      request: async (req) => {
        approvalRequests.push(req);
        return 'allowed-once';
      },
    },
    store: storeOf(events),
  });
}

test('detached background launch survives the launcher step closing: the approval ask is not auto-cancelled', async () => {
  const events = [];
  const sessionAppends = [];
  const approvalRequests = [];
  const engine = engineOf(events, approvalRequests);
  const launcher = new AbortController();
  const launched = await engine.start({
    module: {
      manifest,
      execution: 'capability-generated',
      run: async () => await new Promise(() => {}),
    },
    source: 'inline',
    parent: { session: sessionOf(sessionAppends) },
    args: {},
    signal: launcher.signal,
  });
  // The tool step returned (wait:false -> background job); the launch signal
  // must no longer govern the run.
  launched.detach();
  launcher.abort('run_code settled');
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(approvalRequests.length, 1, 'the workflow launch must reach the approval ask');
  assert.equal(
    approvalRequests[0].signal.aborted,
    false,
    'the pending approval ask must NOT be aborted by the launcher step closing in code mode',
  );
  assert.equal(
    events.some((event) => event.type === 'workflow-stopped'),
    false,
    'a detached run must not be stopped when the launcher step closes',
  );
});

test('synchronously awaited run keeps the launcher binding: cancelling the launcher cancels the approval', async () => {
  const events = [];
  const sessionAppends = [];
  const approvalRequests = [];
  const engine = engineOf(events, approvalRequests);
  const launcher = new AbortController();
  const launched = await engine.start({
    module: {
      manifest,
      execution: 'capability-generated',
      run: async () => await new Promise(() => {}),
    },
    source: 'inline',
    parent: { session: sessionOf(sessionAppends) },
    args: {},
    signal: launcher.signal,
  });
  // wait:true -> the tool call awaits run.done; the parent cancelling the
  // turn must still cancel the workflow through the launch signal.
  launcher.abort('parent step aborted');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(approvalRequests.length, 1);
  assert.equal(
    approvalRequests[0].signal.aborted,
    true,
    'an attached run must follow the launcher signal so a cancelled turn cancels the workflow',
  );
});
