/**
 * Deterministic unit regression tests for the CONFIRMED counterexamples found
 * by the property-based adversarial review of the four dsh_workflow pipeline
 * capsules (plan-review / implement / review / simplify).
 *
 * `workflow-orchestration-pbt.test.mts` drives these same invariants over many
 * SEEDED generated inputs. This file pins each counterexample with a single
 * CONCRETE minimal input + its exact expected outcome, so a regression is caught
 * immediately and deterministically (no RNG) and documented as a one-shot unit
 * test. Each test is named after the TEST PURPOSE it pins — the guarantee the test
 * enforces — never a finding id, so a maintainer sees at a glance what it tests.
 *
 * Counterexamples locked here (the review agent confirmed each red):
 *  1. REVIEW: a fixer that reports `status:'failed'` must surface as a `failed`
 *     capsule status (never a misleading `done`), while still returning the
 *     reports + fixes it produced.
 *  2. PLAN-REVIEW (single pass): an axis that returned `verdict:'pass'` alongside a
 *     `null` reviewer must never be listed in the returned `failures`.
 *  3. IMPLEMENT: the runner must never throw for an empty/absent `args` shape
 *     (no `tasks`/`batches`) — it degrades to a terminal object.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { builtinSkillsDir } from '../dist/index.js';

interface Capsule {
  readonly source: string;
  [key: string]: unknown;
}

function loadCapsule(skill: string, file: string): Capsule {
  const p = path.join(builtinSkillsDir()!, skill, 'workflows', file);
  return JSON.parse(readFileSync(p, 'utf8')) as Capsule;
}

function compileCapsule(source: string): (wf: unknown, args: unknown) => Promise<unknown> {
  const context: Record<string, unknown> = {};
  vm.createContext(context);
  new vm.Script(`"use strict";\n${source}\n;globalThis.__run = run;`, {
    filename: 'capsule.js',
  }).runInContext(context);
  return context.__run as (wf: unknown, args: unknown) => Promise<unknown>;
}

interface AgentCall {
  readonly name: string;
  readonly phase: string | null;
  readonly outcome: unknown;
}

function trackingStub(
  agentMap: (name: string, input: Record<string, unknown>) => unknown,
): { wf: Record<string, unknown>; calls: AgentCall[] } {
  const calls: AgentCall[] = [];
  let currentPhase: string | null = null;
  const wf = {
    runId: 'test',
    args: null,
    budget: { total: null, spent: () => 0, remaining: () => 0 },
    phase: async (name: string, fn: () => Promise<unknown>): Promise<unknown> => {
      currentPhase = name;
      const value = await fn();
      currentPhase = null;
      return value;
    },
    runAgent: async (input: Record<string, unknown>): Promise<{ structured: unknown } | null> => {
      const name = String(input.name);
      const outcome = agentMap(name, input);
      calls.push({ name, phase: currentPhase, outcome });
      return outcome === null ? null : { structured: outcome };
    },
    parallel: async (
      thunks: ReadonlyArray<() => Promise<unknown>>,
      opts?: { concurrency?: number },
    ): Promise<Array<unknown | null>> => {
      const concurrency = opts?.concurrency ?? thunks.length;
      let cursor = 0;
      const out = Array<unknown | null>(thunks.length).fill(null);
      const lane = async (): Promise<void> => {
        for (;;) {
          const index = cursor++;
          if (index >= thunks.length) return;
          out[index] = await thunks[index]!();
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, thunks.length) }, () => lane()),
      );
      return out;
    },
    log: (): void => undefined,
  };
  return { wf, calls };
}

async function runCapsule(
  run: (wf: unknown, args: unknown) => Promise<unknown>,
  args: unknown,
  agentMap: (name: string, input: Record<string, unknown>) => unknown,
): Promise<{ result: Record<string, unknown>; calls: AgentCall[] }> {
  const { wf, calls } = trackingStub(agentMap);
  const result = (await run(wf, args)) as Record<string, unknown>;
  return { result, calls };
}

// ---------------------------------------------------------------------------
// 1. REVIEW — a failed fixer is never reported as a completed review.
//    (Counterexample R-REV-1.)
// ---------------------------------------------------------------------------
const REVIEW = loadCapsule('uniterra-review', 'review.workflow.json');
const REVIEW_RUN = compileCapsule(REVIEW.source);
const ONE_REPORT = [
  {
    id: 'r1',
    level: 'critical',
    file: 'a.js',
    line: 3,
    invariant: 'inv',
    input: 'x',
    expected: 'y',
    actual: 'z',
    test: 't',
  },
];

test('REVIEW: a fixer reporting status failed surfaces as a failed capsule status and loses no evidence', async () => {
  const { result } = await runCapsule(
    REVIEW_RUN,
    { task: 'scope' },
    (name) => {
      if (name === 'review') return { spec_table: [], reports: ONE_REPORT };
      // The single counterexample input: the fixer could not apply every fix.
      return { status: 'failed', fixes: [], summary: 'not applied' };
    },
  );
  assert.equal(result.status, 'failed', 'a failed fixer must not be reported as a done review');
  assert.equal(result.clean, false, 'a failed fixer is not a clean review');
  // Evidence is still carried so the main agent can aggregate the unfixed reports.
  assert.equal((result.reports as unknown[]).length, 1);
  assert.equal((result.fixes as unknown[]).length, 0);
});

test('REVIEW: a fixer reporting status fixed is a completed review (positive control)', async () => {
  const { result } = await runCapsule(
    REVIEW_RUN,
    { task: 'scope' },
    (name) => {
      if (name === 'review') return { spec_table: [], reports: ONE_REPORT };
      return { status: 'fixed', fixes: [{ id: 'r1', diff: 'd', result: 'green', explanation: 'e' }] };
    },
  );
  assert.equal(result.status, 'done', 'a succeeded fixer completes the single-pass review');
  assert.equal(result.clean, false);
  assert.equal((result.fixes as unknown[]).length, 1);
});

test('REVIEW: a clean review is done and skips the fixer (single-pass control)', async () => {
  const { result, calls } = await runCapsule(
    REVIEW_RUN,
    { task: 'scope' },
    (name) => (name === 'review' ? { spec_table: [], reports: [] } : { status: 'fixed', fixes: [] }),
  );
  assert.equal(result.status, 'done');
  assert.equal(result.clean, true);
  assert.equal((result.reports as unknown[]).length, 0);
  assert.equal((result.fixes as unknown[]).length, 0);
  assert.ok(!calls.some((c) => c.name === 'fix'), 'no fixer dispatched on a clean review');
});

// ---------------------------------------------------------------------------
// 2. PLAN-REVIEW — a single review pass: a passed axis is never reported as a
//    failure, and a null reviewer fails the run. (Counterexample R-PLAN-1.)
// ---------------------------------------------------------------------------
const PLAN = loadCapsule('uniterra-plan', 'plan-review.workflow.json');
const PLAN_RUN = compileCapsule(PLAN.source);

test('PLAN-REVIEW: an axis that passed alongside a null reviewer is never a reported failure', async () => {
  // requirement+design pass, acceptance reviewer dies (null). The single pass
  // fails, but the two passed axes must not appear in `failures`.
  const { result } = await runCapsule(
    PLAN_RUN,
    { prd_dir: '/p', design_dir: '/d', acceptance_dir: '/a' },
    (name) => {
      if (name === 'requirement-list-review') return { verdict: 'pass', issues: [] };
      if (name === 'design-review') return { verdict: 'pass', issues: [] };
      if (name === 'acceptance-review') return null; // reviewer died
      return null;
    },
  );
  assert.equal(result.status, 'failed', 'a null reviewer fails the run');
  const failures = result.failures as Array<{ reviewer: string }>;
  const reviewers = [...failures.map((f) => f.reviewer)];
  // No passed axis may be reported as a failure. Both passed axes are the only
  // axes, so the failures array must be empty (no verdict-fail axis exists).
  assert.deepEqual(
    reviewers,
    [],
    'a passed axis must never be listed as a failure (reviewers=' + JSON.stringify(reviewers) + ')',
  );
});

test('PLAN-REVIEW: a verdict-fail axis with issues survives a null reviewer and is the only reported failure', async () => {
  // requirement passes, design fails with issues, acceptance dies. The run
  // fails; the failed axis is reported, the passed axis is not.
  const { result } = await runCapsule(
    PLAN_RUN,
    { prd_dir: '/p', design_dir: '/d', acceptance_dir: '/a' },
    (name) => {
      if (name === 'requirement-list-review') return { verdict: 'pass', issues: [] };
      if (name === 'design-review') {
        return { verdict: 'fail', issues: [{ where: 'design.md', problem: 'p', suggestion: 's' }] };
      }
      if (name === 'acceptance-review') return null;
      return null;
    },
  );
  assert.equal(result.status, 'failed');
  // Spread into a main-realm array (the capsule result lives in the vm realm).
  const reviewers = [...((result.failures as Array<{ reviewer: string }>).map((f) => f.reviewer))];
  assert.deepEqual(reviewers, ['design'], 'only the verdict-fail axis is reported');
});

test('PLAN-REVIEW: a clean pass run is done with all three axes listed as passed (positive control)', async () => {
  const { result } = await runCapsule(
    PLAN_RUN,
    { prd_dir: '/p', design_dir: '/d', acceptance_dir: '/a' },
    (name) => {
      if (name === 'requirement-list-review') return { verdict: 'pass', issues: [] };
      if (name === 'design-review') return { verdict: 'pass', issues: [] };
      if (name === 'acceptance-review') return { verdict: 'pass', issues: [] };
      return null;
    },
  );
  assert.equal(result.status, 'done');
  assert.equal(result.pass, true);
  assert.deepEqual(
    [...((result.passed as string[]) ?? [])].sort(),
    ['acceptance', 'design', 'requirement'],
  );
  assert.deepEqual([...(result.failures as unknown[])], []);
});

// ---------------------------------------------------------------------------
// 3. IMPLEMENT — empty / absent args must not crash the capsule.
//    (Counterexample R-IMP-1.)
// ---------------------------------------------------------------------------
const IMPLEMENT = loadCapsule('uniterra-implement', 'implement.workflow.json');
const IMPLEMENT_RUN = compileCapsule(IMPLEMENT.source);

test('IMPLEMENT: the runner never throws when neither tasks nor batches are given and degrades to a terminal', async () => {
  const ok = () => ({ changed_files: [], satisfied_requirements: [] });
  // The minimal counterexample input: args = {} (no tasks, no batches).
  const empty = await runCapsule(IMPLEMENT_RUN, {}, () => ok());
  assert.equal(empty.result.status, 'done', 'empty args degrades to a terminal, not a crash');
  assert.equal(empty.result.agents, 0);

  // Empty-but-present batches/tasks must also be a graceful terminal.
  for (const args of [{ tasks: [], batches: [] }, { tasks: [] }, { batches: [] }]) {
    const res = await runCapsule(IMPLEMENT_RUN, args, () => ok());
    assert.equal(res.result.status, 'done', `no crash for ${JSON.stringify(args)}`);
  }
});

test('IMPLEMENT: a concrete task is dispatched and reported (positive control)', async () => {
  const { result, calls } = await runCapsule(
    IMPLEMENT_RUN,
    { tasks: [{ id: 'T1', name: 'T1', promptFile: '.dsh/tasks/T1.md' }, { id: 'T2', name: 'T2', promptFile: '.dsh/tasks/T2.md' }] },
    (name) => ({ changed_files: [], satisfied_requirements: [name] }),
  );
  assert.equal(result.status, 'done');
  assert.equal(result.agents, 2);
  assert.deepEqual(
    calls.filter((c) => c.name.startsWith('T')).map((c) => c.name).sort(),
    ['T1', 'T2'],
  );
});

test('IMPLEMENT: a failing child fails the run with the first failing batch (batch semantics control)', async () => {
  const { result, calls } = await runCapsule(
    IMPLEMENT_RUN,
    {
      batches: [
        [{ id: 'A', name: 'A', promptFile: '.dsh/tasks/A.md' }],
        [{ id: 'B', name: 'B', promptFile: '.dsh/tasks/B.md' }],
        [{ id: 'C', name: 'C', promptFile: '.dsh/tasks/C.md' }],
      ],
    },
    (name) => (name === 'B' ? null : { changed_files: [], satisfied_requirements: [name] }),
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.batch, 2, 'the first failing batch is reported');
  // No batch after the failing one may dispatch.
  assert.ok(!calls.some((c) => c.phase === 'batch-3'), 'no batch runs after the failing batch');
});
