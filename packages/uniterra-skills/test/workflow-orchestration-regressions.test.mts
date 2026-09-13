/**
 * Deterministic unit regression tests for the CONFIRMED counterexamples found
 * by the property-based adversarial review of the bundled `review` dsh_workflow
 * capsule.
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
  const { result } = await runCapsule(REVIEW_RUN, { task: 'scope' }, (name) => {
    if (name === 'review') return { spec_table: [], reports: ONE_REPORT };
    // The single counterexample input: the fixer could not apply every fix.
    return { status: 'failed', fixes: [], summary: 'not applied' };
  });
  assert.equal(result.status, 'failed', 'a failed fixer must not be reported as a done review');
  assert.equal(result.clean, false, 'a failed fixer is not a clean review');
  // Evidence is still carried so the main agent can aggregate the unfixed reports.
  assert.equal((result.reports as unknown[]).length, 1);
  assert.equal((result.fixes as unknown[]).length, 0);
});

test('REVIEW: a fixer reporting status fixed is a completed review (positive control)', async () => {
  const { result } = await runCapsule(REVIEW_RUN, { task: 'scope' }, (name) => {
    if (name === 'review') return { spec_table: [], reports: ONE_REPORT };
    return { status: 'fixed', fixes: [{ id: 'r1', diff: 'd', result: 'green', explanation: 'e' }] };
  });
  assert.equal(result.status, 'done', 'a succeeded fixer completes the single-pass review');
  assert.equal(result.clean, false);
  assert.equal((result.fixes as unknown[]).length, 1);
});

test('REVIEW: a clean review is done and skips the fixer (single-pass control)', async () => {
  const { result, calls } = await runCapsule(REVIEW_RUN, { task: 'scope' }, (name) =>
    name === 'review' ? { spec_table: [], reports: [] } : { status: 'fixed', fixes: [] },
  );
  assert.equal(result.status, 'done');
  assert.equal(result.clean, true);
  assert.equal((result.reports as unknown[]).length, 0);
  assert.equal((result.fixes as unknown[]).length, 0);
  assert.ok(!calls.some((c) => c.name === 'fix'), 'no fixer dispatched on a clean review');
});
