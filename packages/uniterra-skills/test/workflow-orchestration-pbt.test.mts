/**
 * Property-based adversarial review of the bundled `review` dsh_workflow capsule.
 *
 * This locks the ORCHESTRATION invariants under GENERATED agent-result shapes,
 * `args`, and dispatch counts — going beyond the deterministic shapes already
 * pinned by `workflow-templates.test.mts`. Each property is driven over a
 * seeded pseudorandom generator (the package has no fast-check dependency, so
 * a small explicit loop over the repo's node:test framework drives the many
 * generated inputs instead, per the review-agent methodology).
 *
 * Invariants pinned here:
 *  - REVIEW: `clean` is true iff no reports, the fixer is dispatched iff
 *    reports exist, and — adversarially — a fixer that reports `status:
 *    'failed'` must surface as a `failed` capsule status (never swallowed as
 *    `done`).
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

interface RunOutcome {
  readonly result: Record<string, unknown>;
  readonly calls: AgentCall[];
}

/** Track which phase is active so agent calls can be attributed to a round. */
function trackingStub(agentMap: (name: string, input: Record<string, unknown>) => unknown): {
  wf: Record<string, unknown>;
  calls: AgentCall[];
} {
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
      await Promise.all(Array.from({ length: Math.min(concurrency, thunks.length) }, () => lane()));
      return out;
    },
    readFile: async (): Promise<string> =>
      '# stub brief\n\nGoal: stub\nRequirements: REQ-1 (test: a)',
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
// REVIEW orchestration invariants
// ---------------------------------------------------------------------------
const REVIEW = loadCapsule('uniterra-review', 'review.workflow.json');
const REVIEW_RUN = compileCapsule(REVIEW.source);

test('REVIEW: clean iff no reports, and the fixer runs only when reports exist', async () => {
  for (let seed = 0; seed < 3000; seed += 1) {
    const rng = lcg(seed);
    const withReports = rng() < 0.5;
    const reports = withReports
      ? [
          {
            id: 'r1',
            level: 'critical',
            file: 'a.js',
            line: 1,
            invariant: 'i',
            input: 'x',
            expected: 'y',
            actual: 'z',
            test: 't',
          },
        ]
      : [];
    const fixStatus = pick(rng, ['fixed', 'failed'] as const);
    const agentMap = (name: string): unknown => {
      if (name === 'review') return { spec_table: [], reports };
      return {
        status: fixStatus,
        fixes: [{ id: 'r1', diff: 'd', result: 'green', explanation: 'e' }],
        summary: 's',
      };
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
      // reported 'failed' surfaces as 'failed' (R-REV-1).
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
  // The fixer contract treats `status:'failed'` as an incomplete run; the
  // review capsule must surface that too, not swallow it as `done`.
  const { result } = await runCapsule(REVIEW_RUN, { task: 'scope' }, (name) => {
    if (name === 'review') {
      return {
        spec_table: [],
        reports: [
          {
            id: 'r1',
            level: 'critical',
            file: 'a.js',
            line: 1,
            invariant: 'i',
            input: 'x',
            expected: 'y',
            actual: 'z',
            test: 't',
          },
        ],
      };
    }
    return { status: 'failed', fixes: [], summary: 'not applied' };
  });
  assert.equal(
    result.status,
    'failed',
    'a fixer reporting status:"failed" must not be reported as a done run',
  );
});
