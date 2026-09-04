/**
 * Deterministic regression tests for the vendored `@dsh-external/workflow`
 * engine's child-result collection across the dsh session-API families.
 *
 * BUG (dsh 0.1.2-rc.1): the dsh session refactor REMOVED the public
 * `Session#events` accessor — 0.1.1-rc.2 exposed `get events()`, 0.1.2-rc.1
 * exposes `snapshotEvents()` / `ownEvents()` / `eventAt()` instead. The
 * engine's four collection helpers (`usageOf`, `observedToolEvidence`,
 * `latestAssistantText`, `childRecordedCompleted`) iterated
 * `agent.session.events` unguarded, so every child that finished its work
 * crashed the RESULT-COLLECTION step right after `await childRun.result`:
 * `TypeError: agent.session.events is not iterable` → `driveTask`'s catch
 * recorded `agent-completed { outcome: 'failed' }`, batches stopped advancing,
 * and runs hung or were cancelled on host teardown — while the child's real
 * output was already in the working tree.
 *
 * FIX: `sessionEventsOf(agent)` reads `Session#events` when it is an array
 * (<= 0.1.1-rc.2) and otherwise falls back to `snapshotEvents()`
 * (>= 0.1.2-rc.1), and every collection call site is wrapped in `collect()`
 * so a log-shape surprise degrades to auxiliary-data fallbacks instead of
 * failing the task.
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

/** A parent-session stub that records session-level appends. */
function sessionOf(appends) {
  return {
    id: 'session-p',
    header: { cwd: '/w' },
    append: (type, data) => {
      appends.push({ type, data });
    },
  };
}

const manifest = {
  name: 'session-events-probe',
  description: 'session-events probe',
  phases: ['p'],
  readOnly: true,
  maxAgents: 1,
  maxConcurrency: 1,
  patterns: ['loop-until-done'],
};

const USAGE = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2 };

/** A finished spawn-provider child whose log lives on the given session. */
function childRunOf(session) {
  return {
    id: 'child-1',
    localAgent: {
      session,
      cancel: () => {},
      steer: () => {},
      followup: async () => {},
      whenIdle: async () => {},
    },
    result: Promise.resolve({
      stopReason: 'completed',
      output: [{ type: 'text', text: 'work done' }],
    }),
    dispose: async () => {},
  };
}

function engineOf(events, childRun) {
  return new DynamicWorkflowEngine({
    config: {
      approvalMode: 'generated-and-local',
      availableTools: [],
      availableMcp: [],
      availableSkills: [],
      modelTiers: { balanced: {} },
      maxResultChars: 1000,
      maxAgents: 10,
      defaultProvider: 'spawn',
      readOnlyToolFilter: { deny: [] },
      pluginVersion: 'test',
      dshVersion: '0.1.2-rc.1',
    },
    store: storeOf(events),
    approval: {
      effectivePolicy: () => 'never',
      request: async () => 'allowed-once',
    },
    subagents: {
      getProvider: () => ({ capabilities: { toolFilter: true, outputSchema: true } }),
      start: async () => childRun,
    },
  });
}

/** Drive one single-agent workflow to completion and capture what happened. */
async function runOne(childRun) {
  const events = [];
  const engine = engineOf(events, childRun);
  let moduleResult;
  const launched = await engine.start({
    module: {
      manifest,
      execution: 'capability-generated',
      run: async (wf) => {
        moduleResult = await wf.runAgent({ name: 't1', prompt: 'do the work' });
        return moduleResult;
      },
    },
    source: 'inline',
    parent: { session: sessionOf([]) },
    args: {},
    signal: new AbortController().signal,
  });
  await launched.done;
  return { moduleResult, events };
}

function agentCompleted(events) {
  return events.filter((event) => event.type === 'agent-completed');
}

test('new-family session (snapshotEvents, no events): the finished child is collected and the task completes', async () => {
  const { moduleResult, events } = await runOne(
    childRunOf({
      id: 'session-child',
      header: { cwd: '/w' },
      // dsh >= 0.1.2-rc.1: no `events` property; the log is read via snapshotEvents().
      snapshotEvents: () => [{ type: 'assistant/message', data: { usage: USAGE } }],
      append: () => {},
    }),
  );
  assert.equal(moduleResult.status, 'completed');
  assert.equal(moduleResult.tokenUsage, 17);
  const completed = agentCompleted(events);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].data.outcome, 'completed');
  assert.equal('error' in completed[0].data, false);
});

test('legacy-family session (events array): the finished child is collected exactly as before', async () => {
  const { moduleResult, events } = await runOne(
    childRunOf({
      id: 'session-child',
      header: { cwd: '/w' },
      // dsh <= 0.1.1-rc.2: the public `events` accessor existed.
      events: [{ type: 'assistant/message', data: { usage: USAGE } }],
      append: () => {},
    }),
  );
  assert.equal(moduleResult.status, 'completed');
  assert.equal(moduleResult.tokenUsage, 17);
  const completed = agentCompleted(events);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].data.outcome, 'completed');
});

test('session without events or snapshotEvents: collection degrades and the task still completes', async () => {
  const { moduleResult, events } = await runOne(
    childRunOf({
      id: 'session-child',
      header: { cwd: '/w' },
      append: () => {},
    }),
  );
  assert.equal(moduleResult.status, 'completed');
  assert.equal('tokenUsage' in moduleResult, false);
  const completed = agentCompleted(events);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].data.outcome, 'completed');
});
