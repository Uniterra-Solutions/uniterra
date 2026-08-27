/**
 * Property-based adversarial review of the four dsh_workflow pipeline capsules
 * (plan-review / implement / review / simplify).
 *
 * This locks the ORCHESTRATION invariants under GENERATED agent-result shapes,
 * `args`, and dispatch counts — going beyond the deterministic shapes already
 * pinned by `workflow-templates.test.mts`. Each property is driven over a
 * seeded pseudorandom generator (the package has no fast-check dependency, so
 * a small explicit loop over the repo's node:test framework drives the many
 * generated inputs instead, per the review-agent methodology).
 *
 * Invariants pinned here:
 *  - PLAN-REVIEW: an axis that returned `verdict:'pass'` is never re-dispatched
 *    in a later round; `done && pass` implies all three axes passed; a repair
 *    agent is dispatched only after a round with a failure that carried issues;
 *    and, adversarially, a run that fails on a `null` reviewer must NOT list
 *    an axis that passed in that same round as a failure.
 *  - IMPLEMENT: on failure the reported `batch` is the FIRST batch that
 *    contains a failing (`null`) child and no later batch is dispatched; with
 *    no failures every task is counted; and the runner never throws for any
 *    args shape (it must degrade, not crash).
 *  - REVIEW: `clean` is true iff no reports, the fixer is dispatched iff
 *    reports exist, and — adversarially — a fixer that reports `status:
 *    'failed'` must surface as a `failed` capsule status (matching the
 *    plan-review / simplify siblings), not be swallowed as `done`.
 *  - SIMPLIFY: a `verdict:'pass'` (or empty recommendation list) ends the loop
 *    early with no fix round; `skipped` entries are deduped by id across
 *    rounds, never dropped, and record the latest round that skipped them.
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
  new vm.Script(`"use strict";\n${source}\n;globalThis.__run = run;`, { filename: 'capsule.js' }).runInContext(context);
  return context.__run as (wf: unknown, args: unknown) => Promise<unknown>;
}

interface AgentCall {
  readonly name: string;
  readonly phase: string | null;
  readonly outcome: unknown;
}

interface RunOutcome {
  readonly result: Record<string, unknown>;
  readonly calls: AgentCall[];
}

/** Track which phase is active so agent calls can be attributed to a round. */
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
): Promise<RunOutcome> {
  const { wf, calls } = trackingStub(agentMap);
  const result = (await run(wf, args)) as Record<string, unknown>;
  return { result, calls };
}

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) — drives the many generated inputs over node:test.
// ---------------------------------------------------------------------------
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}
function pick<T>(rng: () => number, arr: ReadonlyArray<T>): T {
  return arr[randInt(rng, 0, arr.length - 1)]!;
}

// ---------------------------------------------------------------------------
// PLAN-REVIEW orchestration invariants
// ---------------------------------------------------------------------------
const PLAN_REVIEW = loadCapsule('uniterra-plan', 'plan-review.workflow.json');
const PLAN_RUN = compileCapsule(PLAN_REVIEW.source);
const PLAN_LABEL_TO_KEY: Record<string, string> = {
  'requirement-list-review': 'requirement',
  'design-review': 'design',
  'acceptance-review': 'acceptance',
};
const PLAN_KEYS = ['requirement', 'design', 'acceptance'];
const PLAN_OUTCOME_CHOICES = ['pass', 'fail', 'fail-empty', 'null'] as const;
type PlanOutcome = (typeof PLAN_OUTCOME_CHOICES)[number];

function genPlanWorld(rng: () => number): {
  maxRounds: number;
  seq: Record<string, PlanOutcome[]>;
  repairs: Record<number, 'fixed' | 'failed' | 'null-repair'>;
} {
  const maxRounds = 8;
  const seq: Record<string, PlanOutcome[]> = {};
  for (const k of PLAN_KEYS) {
    const len = 1 + randInt(rng, 0, maxRounds);
    seq[k] = Array.from({ length: len }, () => pick(rng, PLAN_OUTCOME_CHOICES));
  }
  const repairs: Record<number, 'fixed' | 'failed' | 'null-repair'> = {};
  for (let r = 1; r <= maxRounds; r += 1) {
    repairs[r] = pick(rng, ['fixed', 'failed', 'null-repair'] as const);
  }
  return { maxRounds, seq, repairs };
}

function runPlanWorld(world: {
  maxRounds: number;
  seq: Record<string, PlanOutcome[]>;
  repairs: Record<number, 'fixed' | 'failed' | 'null-repair'>;
}): Promise<RunOutcome> {
  const counters: Record<string, number> = { requirement: 0, design: 0, acceptance: 0 };
  const agentMap = (name: string): unknown => {
    const key = PLAN_LABEL_TO_KEY[name];
    if (key !== undefined) {
      const i = Math.min(counters[key] ?? 0, world.seq[key]!.length - 1);
      counters[key] = (counters[key] ?? 0) + 1;
      const o = world.seq[key]![i];
      if (o === 'null') return null;
      if (o === 'pass') return { verdict: 'pass', issues: [] };
      if (o === 'fail') {
        return { verdict: 'fail', issues: [{ where: 'w', problem: 'p', suggestion: 's' }] };
      }
      return { verdict: 'fail', issues: [] };
    }
    const round = Number(name.replace('repair-', ''));
    const r = world.repairs[round] ?? 'fixed';
    if (r === 'null-repair') return null;
    if (r === 'failed') return { status: 'failed', summary: 's' };
    return { status: 'fixed', summary: 's' };
  };
  return runCapsule(
    PLAN_RUN,
    { prd_dir: '/p', design_dir: '/d', acceptance_dir: '/a', maxRounds: world.maxRounds },
    agentMap,
  );
}

/** Reconstruct per-round dispatch + pass rounds from the tracking log. */
function analyzePlan(calls: AgentCall[]): {
  dispatch: Record<number, string[]>;
  passRound: Record<string, number>;
  roundsWithNull: Set<number>;
} {
  const dispatch: Record<number, string[]> = {};
  const passRound: Record<string, number> = {};
  const roundsWithNull = new Set<number>();
  for (const c of calls) {
    if (c.phase !== null && c.phase.startsWith('round-')) {
      const r = Number(c.phase.slice('round-'.length));
      const key = PLAN_LABEL_TO_KEY[c.name];
      if (key !== undefined) {
        (dispatch[r] ??= []).push(key);
        if (c.outcome !== null && (c.outcome as { verdict?: string }).verdict === 'pass') {
          if (!(key in passRound)) passRound[key] = r;
        }
      }
    }
  }
  for (const c of calls) {
    if (c.phase !== null && c.phase.startsWith('round-') && c.outcome === null) {
      roundsWithNull.add(Number(c.phase.slice('round-'.length)));
    }
  }
  return { dispatch, passRound, roundsWithNull };
}

test('PLAN-REVIEW: a passed axis is never re-dispatched, and pass/done stays coherent', async () => {
  for (let seed = 0; seed < 3000; seed += 1) {
    const rng = lcg(seed);
    const world = genPlanWorld(rng);
    const { result, calls } = await runPlanWorld(world);
    const status = result.status;
    assert.ok(
      status === 'done' || status === 'failed' || status === 'blocked',
      `seed ${seed}: terminal status in {done, failed, blocked} — got ${String(status)}`,
    );
    const { dispatch, passRound } = analyzePlan(calls);

    // An axis that passed at round p must not be dispatched in any round > p.
    for (const [key, p] of Object.entries(passRound)) {
      for (const [rStr, axes] of Object.entries(dispatch)) {
        const r = Number(rStr);
        if (r > p && axes.includes(key)) {
          assert.fail(
            `seed ${seed}: axis ${key} was re-dispatched in round ${r} after passing in round ${p}`,
          );
        }
      }
    }

    // done && pass ==> all three axes passed (skipped covers every axis).
    if (status === 'done' && result.pass === true) {
      const skipped = result.skipped as string[];
      assert.deepEqual(
        [...skipped].sort(),
        [...PLAN_KEYS].sort(),
        `seed ${seed}: a done/pass run must have passed all three axes`,
      );
    }
  }
});

test('PLAN-REVIEW: a repair agent is dispatched only after a round with a failure that carries issues', async () => {
  for (let seed = 0; seed < 3000; seed += 1) {
    const rng = lcg(seed);
    const world = genPlanWorld(rng);
    const { calls } = await runPlanWorld(world);
    // Map each round to whether it produced a fail-with-issues.
    const failWithIssues = new Set<number>();
    for (const c of calls) {
      if (
        c.phase !== null &&
        c.phase.startsWith('round-') &&
        c.outcome !== null &&
        (c.outcome as { verdict?: string }).verdict === 'fail' &&
        ((c.outcome as { issues?: unknown[] }).issues?.length ?? 0) > 0
      ) {
        failWithIssues.add(Number(c.phase.slice('round-'.length)));
      }
    }
    for (const c of calls) {
      if (c.phase === null && c.name.startsWith('repair-')) {
        const round = Number(c.name.replace('repair-', ''));
        assert.ok(
          failWithIssues.has(round),
          `seed ${seed}: repair-${round} dispatched but round ${round} had no failure with issues`,
        );
      }
    }
  }
});

test('PLAN-REVIEW adversarial: a run that fails on a null reviewer must not list an axis that passed in that same round as a failure', async () => {
  let found = false;
  for (let seed = 0; seed < 4000; seed += 1) {
    const rng = lcg(seed);
    const world = genPlanWorld(rng);
    const { result, calls } = await runPlanWorld(world);
    if (result.status !== 'failed') continue;
    const failures = (result.failures as Array<{ reviewer: string }>) ?? [];
    const failureReviewers = failures.map((f) => f.reviewer);
    for (const c of calls) {
      const key = PLAN_LABEL_TO_KEY[c.name];
      if (
        key === undefined ||
        c.phase === null ||
        !c.phase.startsWith('round-') ||
        c.outcome === null ||
        (c.outcome as { verdict?: string }).verdict !== 'pass'
      ) {
        continue;
      }
      const sameRoundNull = calls.some(
        (cc) => cc.phase === c.phase && cc.outcome === null,
      );
      if (sameRoundNull && failureReviewers.includes(key)) {
        assert.fail(
          `seed ${seed}: axis ${key} passed in round ${c.phase} and then a null reviewer in the same round — ` +
            `the run reported it as a failure (failures=${JSON.stringify(result.failures)})`,
        );
      }
    }
    found = true;
  }
  assert.ok(found, 'the adversarial generator seeded at least one failed run');
});

test('PLAN-REVIEW minimal counterexample: a null reviewer coexisting with a pass misreports the passed axis', async () => {
  // Round 1: requirement=pass, design=pass, acceptance=null.
  const { result } = await runCapsule(
    PLAN_RUN,
    { prd_dir: '/p', design_dir: '/d', acceptance_dir: '/a', maxRounds: 2 },
    (name) => {
      if (name === 'requirement-list-review') return { verdict: 'pass', issues: [] };
      if (name === 'design-review') return { verdict: 'pass', issues: [] };
      if (name === 'acceptance-review') return null; // reviewer died
      return { status: 'fixed', summary: 's' };
    },
  );
  assert.equal(result.status, 'failed');
  const failures = result.failures as Array<{ reviewer: string }>;
  // The two axes that passed must not be reported as failures. Spread into a
  // plain (main-realm) array because `result` comes from the vm capsule realm.
  assert.deepEqual(
    [...failures.map((f) => f.reviewer)].sort(),
    [],
    'a passed axis must not be reported as a failure',
  );
});

// ---------------------------------------------------------------------------
// IMPLEMENT orchestration invariants
// ---------------------------------------------------------------------------
const IMPLEMENT = loadCapsule('uniterra-implement', 'implement.workflow.json');
const IMPLEMENT_RUN = compileCapsule(IMPLEMENT.source);

test('IMPLEMENT: on failure the reported batch is the first batch with a null child and no later batch runs', async () => {
  for (let seed = 0; seed < 3000; seed += 1) {
    const rng = lcg(seed);
    const numBatches = randInt(rng, 1, 4);
    const batches: Array<Array<{ id: string; promptFile: string; fail: boolean }>> = [];
    const all = [];
    for (let b = 0; b < numBatches; b += 1) {
      const n = randInt(rng, 1, 3);
      const group = [];
      for (let t = 0; t < n; t += 1) {
        const id = `T${b}-${t}`;
        const fail = rng() < 0.4;
        group.push({ id, name: id, promptFile: '.dsh/tasks/' + id + '.md', fail });
        all.push(id);
      }
      batches.push(group);
    }
    const agentMap = (name: string): unknown => {
      const task = batches.flat().find((x) => x.id === name);
      if (task?.fail) return null;
      return { changed_files: [], satisfied_requirements: [name] };
    };
    const { result, calls } = await runCapsule(IMPLEMENT_RUN, { batches }, agentMap);

    // First failing batch index (0-based → reported 1-based).
    let firstFailing = -1;
    for (let b = 0; b < batches.length; b += 1) {
      if (batches[b]!.some((x) => x.fail)) {
        firstFailing = b;
        break;
      }
    }
    if (firstFailing === -1) {
      assert.equal(result.status, 'done', `seed ${seed}: no failures should be done`);
      assert.equal(result.agents, all.length, `seed ${seed}: agents equals total task count`);
    } else {
      assert.equal(result.status, 'failed', `seed ${seed}: a failing child fails the run`);
      assert.equal(result.batch, firstFailing + 1, `seed ${seed}: reported batch is the first failing batch`);
      // No batch after the failing one is dispatched.
      const phases = calls.map((c) => c.phase).filter((p) => p !== null);
      for (const p of phases) {
        if (p?.startsWith('batch-')) {
          const n = Number(p.slice('batch-'.length));
          assert.ok(n <= firstFailing + 1, `seed ${seed}: batch ${n} must not run after failing batch ${firstFailing + 1}`);
        }
      }
    }
  }
});

test('IMPLEMENT robustness: the runner never throws for contract-valid or empty args, and a task missing promptFile fails loudly', async () => {
  // The manifest has no inputSchema, but each task now REQUIRES a `promptFile` (the
  // brief lives in a file so args stay tiny). Empty/absent shapes still degrade to a
  // terminal; a PROVIDED task without promptFile is a contract violation that surfaces
  // a clear error instead of silently producing an empty subagent prompt.
  const shapes = [
    {},
    { tasks: [{ id: 'T1', name: 'T1', promptFile: '.dsh/tasks/T1.md' }] },
    { tasks: [], batches: [] },
    { batches: [[{ id: 'A', name: 'A', promptFile: '.dsh/tasks/A.md' }], [{ id: 'B', name: 'B', promptFile: '.dsh/tasks/B.md' }]] },
  ];
  for (const args of shapes) {
    await assert.doesNotReject(
      () =>
        runCapsule(IMPLEMENT_RUN, args, () => ({
          changed_files: [],
          satisfied_requirements: [],
        })),
      `implement must not throw for args=${JSON.stringify(args)}`,
    );
  }
  // A task entry WITHOUT promptFile is a contract violation → visible error, not a
  // silent no-op (this is the fail-fast that replaced the old `{done, agents:0}`).
  await assert.rejects(
    () => runCapsule(IMPLEMENT_RUN, { tasks: [{ id: 'X', name: 'X' }] }, () => ({ changed_files: [], satisfied_requirements: [] })),
    /promptFile/,
    'a task without promptFile fails loudly',
  );
});

// ---------------------------------------------------------------------------
// REVIEW orchestration invariants
// ---------------------------------------------------------------------------
const REVIEW = loadCapsule('uniterra-review', 'review.workflow.json');
const REVIEW_RUN = compileCapsule(REVIEW.source);

test('REVIEW: clean iff no reports, and the fixer runs only when reports exist', async () => {
  for (let seed = 0; seed < 3000; seed += 1) {
    const rng = lcg(seed);
    const withReports = rng() < 0.5;
    const reports = withReports
      ? [{ id: 'r1', level: 'critical', file: 'a.js', line: 1, invariant: 'i', input: 'x', expected: 'y', actual: 'z', test: 't' }]
      : [];
    const fixStatus = pick(rng, ['fixed', 'failed'] as const);
    const agentMap = (name: string): unknown => {
      if (name === 'review') return { spec_table: [], reports };
      return { status: fixStatus, fixes: [{ id: 'r1', diff: 'd', result: 'green', explanation: 'e' }], summary: 's' };
    };
    const { result, calls } = await runCapsule(REVIEW_RUN, { task: 'scope' }, agentMap);
    const clean = reports.length === 0;
    assert.equal(result.clean, clean, `seed ${seed}: clean must match reports presence`);
    if (clean) {
      assert.equal(result.status, 'done', `seed ${seed}: clean is a done run`);
      assert.equal((result.fixes as unknown[]).length, 0, `seed ${seed}: no fixes when clean`);
      assert.ok(
        !calls.some((c) => c.name.startsWith('fix')),
        `seed ${seed}: fixer not dispatched when clean`,
      );
    } else {
      // A report-driven run is 'done' only when the fixer succeeded; a fixer that
      // reported 'failed' surfaces as 'failed' (R-REV-1, parity with the siblings).
      assert.equal(
        result.status,
        fixStatus === 'failed' ? 'failed' : 'done',
        `seed ${seed}: a report-driven run is done iff the fixer succeeded`,
      );
      assert.equal((result.fixes as unknown[]).length, 1, `seed ${seed}: fixer output reported`);
    }
  }
});

test('REVIEW adversarial: a fixer that reports status "failed" must surface as a failed capsule status', async () => {
  // Sibling capsules (plan-review, simplify) propagate the repair/fix agent's
  // `status:'failed'`; the review capsule must too, not swallow it as `done`.
  const { result } = await runCapsule(
    REVIEW_RUN,
    { task: 'scope' },
    (name) => {
      if (name === 'review') {
        return {
          spec_table: [],
          reports: [{ id: 'r1', level: 'critical', file: 'a.js', line: 1, invariant: 'i', input: 'x', expected: 'y', actual: 'z', test: 't' }],
        };
      }
      return { status: 'failed', fixes: [], summary: 'not applied' };
    },
  );
  assert.equal(
    result.status,
    'failed',
    'a fixer reporting status:"failed" must not be reported as a done run',
  );
});

// ---------------------------------------------------------------------------
// SIMPLIFY orchestration invariants
// ---------------------------------------------------------------------------
const SIMPLIFY = loadCapsule('uniterra-simplify', 'simplify.workflow.json');
const SIMPLIFY_RUN = compileCapsule(SIMPLIFY.source);

test('SIMPLIFY: a pass verdict / empty recommendations ends the loop early with no fix round', async () => {
  for (let seed = 0; seed < 3000; seed += 1) {
    const rng = lcg(seed);
    const verdict = pick(rng, ['pass', 'fail'] as const);
    const recCount = verdict === 'pass' ? randInt(rng, 0, 2) : randInt(rng, 0, 2);
    const recommendations = Array.from({ length: recCount }, (_, i) => ({
      id: `r${i}`,
      safetiness: 'safe',
      description: 'd',
    }));
    const agentMap = (name: string): unknown => {
      if (name === 'review-1') return { verdict, recommendations };
      return { status: 'fixed', applied_recommendations: [], skipped: [], summary: 's' };
    };
    const { result, calls } = await runCapsule(
      SIMPLIFY_RUN,
      { goal: 'g', context: { requirements: '', design: '', acceptance: '' } },
      agentMap,
    );
    if (verdict === 'pass' || recCount === 0) {
      assert.equal(result.status, 'done', `seed ${seed}: pass/empty ends the loop`);
      assert.equal(result.rounds, 1, `seed ${seed}: loop ended on round 1`);
      assert.ok(
        !calls.some((c) => c.name.startsWith('fix-')),
        `seed ${seed}: no fix round when it ends early`,
      );
    }
  }
});

test('SIMPLIFY: skipped recommendations are deduped by id, never dropped, and record the latest round', async () => {
  for (let seed = 0; seed < 3000; seed += 1) {
    const rng = lcg(seed);
    const maxRounds = 4;
    // Build a plan: round r review → fail with recs; fix → skipped with some ids.
    const ids = ['a', 'b', 'c'];
    const skippedPlan: Array<Array<{ id: string }>> = [];
    for (let r = 1; r <= maxRounds; r += 1) {
      skippedPlan.push(Array.from({ length: randInt(rng, 0, 3) }, () => ({ id: pick(rng, ids) })));
    }
    let fixRound = 0;
    const agentMap = (name: string): unknown => {
      if (name.startsWith('review-')) {
        const round = Number(name.replace('review-', ''));
        if (round > maxRounds) return { verdict: 'pass', recommendations: [] };
        return { verdict: 'fail', recommendations: [{ id: 'x', safetiness: 'safe', description: 'd' }] };
      }
      fixRound = Number(name.replace('fix-', ''));
      return {
        status: 'fixed',
        applied_recommendations: [],
        skipped: skippedPlan[fixRound - 1] ?? [],
        summary: 's',
      };
    };
    const { result } = await runCapsule(
      SIMPLIFY_RUN,
      { goal: 'g', context: {}, maxRounds },
      agentMap,
    );
    const skipped = result.skipped as Array<{ round: number; id: string; reason?: string }>;
    // Dedup: every id appears at most once.
    const seenIds = new Set<string>();
    for (const s of skipped) {
      assert.ok(!seenIds.has(s.id), `seed ${seed}: duplicate skipped id ${s.id}`);
      seenIds.add(s.id);
    }
    // Each entry records the round of the fix that skipped it.
    for (const s of skipped) {
      const latest = skippedPlan
        .map((plan, idx) => (plan.some((p) => p.id === s.id) ? idx + 1 : -1))
        .filter((n) => n > 0);
      const expectedRound = latest.length > 0 ? latest[latest.length - 1] : -1;
      assert.equal(s.round, expectedRound, `seed ${seed}: skipped id ${s.id} recorded with its own round`);
    }
  }
});
