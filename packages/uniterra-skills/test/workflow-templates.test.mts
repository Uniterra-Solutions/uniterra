/**
 * Workflow-capsule contract tests for the bundled pipeline skills
 * (uniterra-plan / uniterra-implement / uniterra-review / uniterra-simplify).
 *
 * After the workflow-builtin-rebuild milestone the four pipeline workflows are
 * no longer JS blocks the model copies into the dsh `workflow` tool. They are
 * persisted `dsh.workflow` capsules the skill invokes by NAME via
 * `run_workflow(name, args)`. These tests lock that contract:
 *
 *  1. Every pipeline skill ships exactly one `workflows/<name>.workflow.json`
 *     capsule with `format: dsh.workflow`, `version: 1`, `workflowApiVersion: 1`,
 *     a valid manifest (name / phases / readOnly / maxAgents / maxConcurrency /
 *     patterns), and a `source` that defines `async function run(wf, args)` and
 *     compiles under Node's `vm.Script`.
 *  2. Each capsule's `source` executes to a terminal JSON result under stubbed
 *     `wf` hooks, proving the `wf.phase` / `wf.runAgent` / `wf.parallel` calls,
 *     the `outputSchema` structured results, and the terminal `return` all match
 *     the dsh_workflow engine contract (mirrors the old templates' behaviour:
 *     plan-review single review pass, implement parallel + batched shapes, review
 *     single pass with a skipped fixer on a clean run, simplify pass-verdict
 *     early exit + cross-round skip accumulation).
 *  3. The SKILL.md call layer already invokes `run_workflow('<name>', args)` and
 *     no longer instructs copying a script into the `workflow` tool (no
 *     "meta + script + args single call", no "copy verbatim").
 *  4. The legacy template/script files that used to embed the JS are flagged
 *     MIGRATED so a model never copies them back into a `workflow` tool call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { builtinSkillsDir } from '../dist/index.js';

/** skill dir → its persisted capsule (from the C3–C6 build). */
const CAPSULES: ReadonlyArray<{ skill: string; capsule: string; file: string }> = [
  { skill: 'uniterra-plan', capsule: 'plan-review', file: 'plan-review.workflow.json' },
  { skill: 'uniterra-implement', capsule: 'implement', file: 'implement.workflow.json' },
  { skill: 'uniterra-review', capsule: 'review', file: 'review.workflow.json' },
  { skill: 'uniterra-simplify', capsule: 'simplify', file: 'simplify.workflow.json' },
];

/** The legacy script/template files that used to embed the runnable JS. */
const LEGACY_SCRIPTS: ReadonlyArray<string> = [
  'uniterra-plan/scripts/review-workflow.md',
  'uniterra-implement/assets/workflow-template.md',
  'uniterra-review/assets/workflow-template.md',
  'uniterra-simplify/assets/workflow-template.md',
];

interface Capsule {
  readonly source: string;
  readonly format?: unknown;
  readonly version?: unknown;
  readonly workflowApiVersion?: unknown;
  readonly manifest?: unknown;
  [key: string]: unknown;
}

function loadCapsule(
  root: string,
  { skill, file }: { skill: string; file: string },
): Capsule {
  const p = path.join(root, skill, 'workflows', file);
  const raw = readFileSync(p, 'utf8');
  const capsule = JSON.parse(raw) as Capsule;
  assert.equal(typeof capsule.source, 'string', `${p}: capsule.source must be a string`);
  return capsule;
}

/** A stub `wf` object driving the capsules the way the dsh_workflow engine does. */
function stubWf(
  agentMap: Record<string, (input: Record<string, unknown>) => unknown>,
): { wf: Record<string, unknown>; calls: string[] } {
  const calls: string[] = [];
  const wf = {
    runId: 'test',
    args: null,
    budget: { total: null, spent: () => 0, remaining: () => 0 },
    phase: async (name: string, fn: () => Promise<unknown>): Promise<unknown> => {
      calls.push('phase:' + name);
      return fn();
    },
    runAgent: async (
      input: Record<string, unknown>,
    ): Promise<{ structured: unknown } | null> => {
      calls.push('agent:' + String(input.name));
      const fixture = agentMap[String(input.name)];
      return fixture === undefined ? null : { structured: fixture(input) };
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
    pipeline: async (
      items: ReadonlyArray<unknown>,
      ...stages: Array<(value: unknown, item: unknown, index: number) => unknown>
    ): Promise<Array<unknown | null>> =>
      Promise.all(
        items.map(async (item, index) => {
          let value: unknown = item;
          for (const stage of stages) value = await stage(value, item, index);
          return value;
        }),
      ),
    synthesize: async (): Promise<{ text: string }> => ({ text: '' }),
    workflow: async (): Promise<null> => null,
    artifact: async (): Promise<{ name: string; path: string }> => ({ name: '', path: '' }),
    readFile: async (): Promise<string> => '# stub brief\n\nGoal: stub\nRequirements: REQ-1 (test: a)\nowned_files: a.js\nforbidden_files: b.js',
    log: (): void => undefined,
  };
  return { wf, calls };
}

async function runCapsule(
  capsule: { source: string },
  args: unknown,
  agentMap: Record<string, (input: Record<string, unknown>) => unknown>,
): Promise<{ result: unknown; calls: string[] }> {
  const context: Record<string, unknown> = { __run: undefined };
  vm.createContext(context);
  const script = new vm.Script(
    `"use strict";\n${capsule.source}\n;globalThis.__run = run;`,
    { filename: 'capsule.js' },
  );
  script.runInContext(context);
  const run = context.__run as (wf: unknown, args: unknown) => Promise<unknown>;
  const { wf, calls } = stubWf(agentMap);
  const result = await run(wf, args);
  return { result, calls };
}

test('every pipeline skill ships a valid dsh.workflow capsule', () => {
  const root = builtinSkillsDir();
  for (const c of CAPSULES) {
    const capsule = loadCapsule(root, c);
    assert.equal(capsule.format, 'dsh.workflow', `${c.capsule}: format must be dsh.workflow`);
    assert.equal(capsule.version, 1, `${c.capsule}: version must be 1`);
    assert.equal(capsule.workflowApiVersion, 1, `${c.capsule}: workflowApiVersion must be 1`);
    const manifest = capsule.manifest as Record<string, unknown>;
    assert.equal(typeof manifest.name, 'string', `${c.capsule}: manifest.name`);
    assert.equal(manifest.name, c.capsule, `${c.capsule}: manifest.name matches the capsule name`);
    assert.ok(
      Array.isArray(manifest.phases) && manifest.phases.length > 0,
      `${c.capsule}: manifest.phases must be a non-empty array`,
    );
    assert.equal(typeof manifest.readOnly, 'boolean', `${c.capsule}: manifest.readOnly`);
    assert.ok(
      typeof manifest.maxAgents === 'number' && manifest.maxAgents > 0,
      `${c.capsule}: manifest.maxAgents`,
    );
    assert.ok(
      typeof manifest.maxConcurrency === 'number' && manifest.maxConcurrency > 0,
      `${c.capsule}: manifest.maxConcurrency`,
    );
    assert.ok(
      Array.isArray(manifest.patterns) && manifest.patterns.length > 0,
      `${c.capsule}: manifest.patterns`,
    );
    const source = capsule.source as string;
    assert.match(
      source,
      /\basync\s+function\s+run\s*\(\s*wf\s*,\s*args\s*\)/u,
      `${c.capsule}: defines run(wf, args)`,
    );
    assert.doesNotThrow(
      () => new vm.Script(`"use strict";\n${source}`, { filename: `${c.capsule}#source` }),
      `${c.capsule}: source must compile`,
    );
  }
});

test('every pipeline workflow agent is write-capable (no readOnly:true runAgent)', () => {
  // The pipeline agents must write code / run tests in the repo to verify their
  // conclusions. A `readOnly: true` runAgent makes the dsh_workflow engine give
  // the child a read-only toolFilter allow-list (read/glob/grep/... only), so it
  // can never write the counterexample it must prove — the reported bug where the
  // workflow agent did not inherit the main agent's write tools. Pin that no
  // pipeline capsule spawns a read-only child.
  const root = builtinSkillsDir();
  for (const c of CAPSULES) {
    const source = loadCapsule(root, c).source as string;
    const readOnly = [...source.matchAll(/\breadOnly\s*:\s*(true|false)\b/gu)].map((m) => m[1]);
    assert.ok(readOnly.length > 0, `${c.capsule}: source declares readOnly on its runAgent calls`);
    assert.ok(
      !readOnly.includes('true'),
      `${c.capsule}: every runAgent must be write-capable (readOnly: false); found readOnly:true`,
    );
  }
});

test('pipeline prompts embed the FULL fixed rules and require the structured_output tool', () => {
  // Regression: extractPrompt used to truncate a prompt body at the first
  // escaped backtick followed by `;` (e.g. `owned_files`;), silently dropping
  // every rule after it. Pin that the embedded prompts are complete AND tell
  // the subagent to report via dsh's built-in `structured_output` tool instead
  // of printing a JSON string in its final message.
  const root = builtinSkillsDir();
  const implement = loadCapsule(root, CAPSULES[1]!).source as string;
  assert.ok(implement.includes('structured_output'), 'implement agents are told to use structured_output');
  assert.ok(implement.includes('AGENTS.md / CLAUDE.md'), 'implement fixed rules embed the conventions rule (not truncated at `owned_files`)');
  assert.ok(implement.includes('STRENGTHENING'), "implement fixed rules embed the strengthen-don't-rewrite rule (not truncated)");
  for (const c of [CAPSULES[0]!, CAPSULES[2]!, CAPSULES[3]!]) {
    const source = loadCapsule(root, c).source as string;
    assert.ok(
      source.includes('structured_output'),
      `${c.capsule}: the agent prompt must require the structured_output tool`,
    );
  }
});

test('plan-review capsule runs a single parallel review and locks the result shape', async () => {
  const root = builtinSkillsDir();
  const capsule = loadCapsule(root, CAPSULES[0]!);
  const args = { prd_dir: '/p', design_dir: '/d', acceptance_dir: '/a' };

  // All three axes pass → one parallel pass, done, no repair, no re-review.
  {
    const { result, calls } = await runCapsule(capsule, args, {
      'requirement-list-review': () => ({ verdict: 'pass', issues: [] }),
      'design-review': () => ({ verdict: 'pass', issues: [] }),
      'acceptance-review': () => ({ verdict: 'pass', issues: [] }),
    });
    const r = result as Record<string, unknown>;
    assert.equal(r.status, 'done');
    assert.equal(r.pass, true);
    assert.deepEqual([...((r.passed as string[]) ?? [])].sort(), ['acceptance', 'design', 'requirement']);
    assert.deepEqual([...(r.failures as unknown[])], []);
    assert.equal(calls.filter((c) => c === 'phase:plan-review').length, 1, 'one single review phase');
    assert.equal(calls.filter((c) => c.startsWith('agent:')).length, 3, 'three review agents dispatched once');
    assert.ok(!calls.some((c) => c.startsWith('agent:repair-')), 'no repair agent in a single pass');
  }

  // A failing axis → single pass reports it without re-reviewing or repairing it.
  {
    let designRuns = 0;
    const { result, calls } = await runCapsule(capsule, args, {
      'requirement-list-review': () => ({ verdict: 'pass', issues: [] }),
      'design-review': () => {
        designRuns += 1;
        return { verdict: 'fail', issues: [{ where: 'design.md', problem: 'p', suggestion: 's' }] };
      },
      'acceptance-review': () => ({ verdict: 'pass', issues: [] }),
      'repair-1': () => ({ status: 'fixed', summary: 'applied' }),
    });
    const r = result as Record<string, unknown>;
    assert.equal(r.status, 'done');
    assert.equal(r.pass, false);
    assert.equal(designRuns, 1, 'a failing axis is reviewed exactly once (no re-review)');
    assert.deepEqual([...((r.passed as string[]) ?? [])].sort(), ['acceptance', 'requirement']);
    const failures = (r.failures as Array<{ reviewer: string; doc: string }>) ?? [];
    assert.deepEqual([...failures.map((f) => f.reviewer)], ['design']);
    assert.equal(failures[0]!.doc, 'design.md');
    assert.equal(calls.filter((c) => c === 'phase:plan-review').length, 1, 'one single review phase');
    assert.ok(!calls.some((c) => c.startsWith('agent:repair-')), 'no repair agent in a single pass');
  }
});

test('implement capsule supports parallel tasks and serial batches', async () => {
  const root = builtinSkillsDir();
  const capsule = loadCapsule(root, CAPSULES[1]!);

  { // independent tasks → one parallel group, agents = count
    const { result } = await runCapsule(capsule, {
      tasks: [
        { id: 'T1', name: 'T1', promptFile: '.dsh/tasks/T1.md' },
        { id: 'T2', name: 'T2', promptFile: '.dsh/tasks/T2.md' },
      ],
    }, {
      T1: () => ({ changed_files: [{ file: 'a', lines: '1' }], satisfied_requirements: ['REQ-1'] }),
      T2: () => ({ changed_files: [{ file: 'b', lines: '2' }], satisfied_requirements: ['REQ-2'] }),
    });
    const r = result as Record<string, unknown>;
    assert.equal(r.status, 'done');
    assert.equal(r.agents, 2);
  }

  { // overlapping tasks → serial batches, batch order preserved
    const { result, calls } = await runCapsule(capsule, {
      batches: [
        [{ id: 'A', name: 'A', promptFile: '.dsh/tasks/A.md' }],
        [{ id: 'B', name: 'B', promptFile: '.dsh/tasks/B.md' }],
      ],
    }, {
      A: () => ({ changed_files: [], satisfied_requirements: ['A'] }),
      B: () => ({ changed_files: [], satisfied_requirements: ['B'] }),
    });
    const r = result as Record<string, unknown>;
    assert.equal(r.status, 'done');
    assert.equal(r.agents, 2);
    assert.ok(calls.indexOf('phase:batch-2') > calls.indexOf('phase:batch-1'), 'batches run serially');
  }

  { // a failing child fails the whole (batched) run with the batch index
    const { result } = await runCapsule(capsule, {
      batches: [
        [{ id: 'A', name: 'A', promptFile: '.dsh/tasks/A.md' }],
        [{ id: 'B', name: 'B', promptFile: '.dsh/tasks/B.md' }],
      ],
    }, {
      A: () => ({ changed_files: [], satisfied_requirements: ['A'] }),
      // B absent → runAgent returns null (the engine's "child failed" signal).
    });
    const r = result as Record<string, unknown>;
    assert.equal(r.status, 'failed');
    assert.equal(r.batch, 2);
  }
});

test('review capsule runs single-pass and skips the fixer on a clean review', async () => {
  const root = builtinSkillsDir();
  const capsule = loadCapsule(root, CAPSULES[2]!);
  const args = { task: 'scope' };

  { // clean → done, no fix round
    const { result, calls } = await runCapsule(capsule, args, {
      review: () => ({ spec_table: [], reports: [] }),
    });
    const r = result as Record<string, unknown>;
    assert.equal(r.status, 'done');
    assert.equal(r.clean, true);
    assert.equal((r.reports as unknown[]).length, 0);
    assert.equal((r.fixes as unknown[]).length, 0);
    assert.ok(!calls.some((c) => c.startsWith('agent:fix')), `no fix round (${calls.join(', ')})`);
  }

  { // a report → fixer repairs it and reports back
    const reports = [
      { id: 'r1', level: 'critical', file: 'a.js', line: 3, invariant: 'inv', input: 'x', expected: 'y', actual: 'z', test: 't' },
    ];
    const { result } = await runCapsule(capsule, args, {
      review: () => ({ spec_table: [], reports }),
      fix: () => ({ status: 'fixed', fixes: [{ id: 'r1', diff: 'd', result: 'green', explanation: 'e' }] }),
    });
    const r = result as Record<string, unknown>;
    assert.equal(r.status, 'done');
    assert.equal(r.clean, false);
    assert.equal((r.fixes as unknown[]).length, 1);
  }
});

test('simplify capsule ends on a pass verdict and accumulates skips across rounds', async () => {
  const root = builtinSkillsDir();
  const capsule = loadCapsule(root, CAPSULES[3]!);
  const args = { goal: 'g', context: { requirements: '', design: '', acceptance: '' } };

  { // pass verdict → done early, trivial recommendations returned, no fix round
    const { result, calls } = await runCapsule(capsule, args, {
      'review-1': () => ({
        verdict: 'pass',
        recommendations: [{ id: 'r1', safetiness: 'safe', description: 'nit' }],
      }),
    });
    const r = result as Record<string, unknown>;
    assert.equal(r.status, 'done');
    assert.equal(r.verdict, 'pass');
    assert.equal((r.recommendations as unknown[]).length, 1);
    assert.ok(!calls.some((c) => c.startsWith('agent:fix-')), `no fix round (${calls.join(', ')})`);
  }

  { // fail → fix round; a pass on the next review round ends the loop
    const { result } = await runCapsule(capsule, args, {
      'review-1': () => ({
        verdict: 'fail',
        recommendations: [{ id: 'r1', safetiness: 'risky', description: 'x' }],
      }),
      'fix-1': () => ({ status: 'fixed', applied_recommendations: ['r1'], skipped: [], summary: 'done' }),
      'review-2': () => ({ verdict: 'pass', recommendations: [] }),
    });
    const r = result as Record<string, unknown>;
    assert.equal(r.status, 'done');
    assert.equal(r.rounds, 2);
    assert.equal(r.verdict, 'pass');
  }
});

test('the four SKILL.md call layers invoke run_workflow and never instruct a script copy', () => {
  const root = builtinSkillsDir();
  for (const c of CAPSULES) {
    const skillMd = readFileSync(path.join(root, c.skill, 'SKILL.md'), 'utf8');
    assert.match(
      skillMd,
      new RegExp(`run_workflow\\s*\\(\\s*['"]${c.capsule}['"]`, 'u'),
      `${c.skill}/SKILL.md must instruct run_workflow('${c.capsule}', args)`,
    );
    // The old single-call shape must be gone from the call layer.
    assert.doesNotMatch(
      skillMd,
      /copy verbatim|meta\s*\+\s*script\s*\+\s*args|scripts\/review-workflow\.md.*workflow tool/u,
      `${c.skill}/SKILL.md must not instruct copying a script into the workflow tool`,
    );
  }
});

test('legacy template/script files are flagged MIGRATED', () => {
  const root = builtinSkillsDir();
  for (const rel of LEGACY_SCRIPTS) {
    const content = readFileSync(path.join(root, rel), 'utf8');
    assert.match(content, /MIGRATED/u, `${rel}: must carry a MIGRATED banner`);
  }
});
