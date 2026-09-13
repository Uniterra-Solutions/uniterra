/**
 * Workflow-capsule contract tests for the bundled review workflow
 * (`uniterra-review`).
 *
 * After the workflow-builtin-rebuild milestone the review workflow is no
 * longer a JS block the model copies into the dsh `workflow` tool. It is a
 * persisted `dsh.workflow` capsule the skill invokes by NAME via
 * `run_workflow(name, args)`. These tests lock that contract:
 *
 *  1. The review skill ships exactly one `workflows/review.workflow.json`
 *     capsule with `format: dsh.workflow`, `version: 1`, `workflowApiVersion: 1`,
 *     a valid manifest (name / phases / readOnly / maxAgents / maxConcurrency /
 *     patterns), and a `source` that defines `async function run(wf, args)` and
 *     compiles under Node's `vm.Script`.
 *  2. The capsule `source` executes to a terminal JSON result under stubbed
 *     `wf` hooks, proving the `wf.phase` / `wf.runAgent` calls, the
 *     `outputSchema` structured results, the standard-document injection and
 *     the terminal `return` all match the dsh_workflow engine contract
 *     (single pass, with the fixer skipped on a clean run).
 *  3. The SKILL.md call layer already invokes `run_workflow('review', args)` and
 *     no longer instructs copying a script into the `workflow` tool (no
 *     "meta + script + args single call", no "copy verbatim").
 *  4. The legacy template file that used to embed the JS is flagged MIGRATED so
 *     a model never copies it back into a `workflow` tool call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { builtinSkillsDir } from '../dist/index.js';

/** skill dir → its persisted capsule. */
const CAPSULES: ReadonlyArray<{ skill: string; capsule: string; file: string }> = [
  { skill: 'uniterra-review', capsule: 'review', file: 'review.workflow.json' },
];

/** The legacy template file that used to embed the runnable JS. */
const LEGACY_SCRIPTS: ReadonlyArray<string> = ['uniterra-review/assets/workflow-template.md'];

interface Capsule {
  readonly source: string;
  readonly format?: unknown;
  readonly version?: unknown;
  readonly workflowApiVersion?: unknown;
  readonly manifest?: unknown;
  [key: string]: unknown;
}

function loadCapsule(root: string, { skill, file }: { skill: string; file: string }): Capsule {
  const p = path.join(root, skill, 'workflows', file);
  const raw = readFileSync(p, 'utf8');
  const capsule = JSON.parse(raw) as Capsule;
  assert.equal(typeof capsule.source, 'string', `${p}: capsule.source must be a string`);
  return capsule;
}

/** The default `wf.readFile` fixture (any document the capsule asks for). */
const DEFAULT_BRIEF =
  '# stub brief\n\nGoal: stub\nRequirements: REQ-1 (test: a)\nowned_files: a.js\nforbidden_files: b.js';

/**
 * A stub `wf` object driving the capsules the way the dsh_workflow engine does.
 * `readFile` overrides the host file fixture (used to serve the authoritative
 * standard documents); `prompts` records every agent prompt the capsule built.
 */
function stubWf(
  agentMap: Record<string, (input: Record<string, unknown>) => unknown>,
  readFile?: (path: string) => string,
): {
  wf: Record<string, unknown>;
  calls: string[];
  prompts: Array<{ name: string; prompt: string }>;
} {
  const calls: string[] = [];
  const prompts: Array<{ name: string; prompt: string }> = [];
  const wf = {
    runId: 'test',
    args: null,
    budget: { total: null, spent: () => 0, remaining: () => 0 },
    phase: async (name: string, fn: () => Promise<unknown>): Promise<unknown> => {
      calls.push('phase:' + name);
      return fn();
    },
    runAgent: async (input: Record<string, unknown>): Promise<{ structured: unknown } | null> => {
      calls.push('agent:' + String(input.name));
      prompts.push({ name: String(input.name), prompt: String(input.prompt) });
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
      await Promise.all(Array.from({ length: Math.min(concurrency, thunks.length) }, () => lane()));
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
    readFile: async (file: string): Promise<string> =>
      readFile === undefined ? DEFAULT_BRIEF : readFile(file),
    log: (): void => undefined,
  };
  return { wf, calls, prompts };
}

async function runCapsule(
  capsule: { source: string },
  args: unknown,
  agentMap: Record<string, (input: Record<string, unknown>) => unknown>,
  readFile?: (path: string) => string,
): Promise<{ result: unknown; calls: string[]; prompts: Array<{ name: string; prompt: string }> }> {
  const context: Record<string, unknown> = { __run: undefined };
  vm.createContext(context);
  const script = new vm.Script(`"use strict";\n${capsule.source}\n;globalThis.__run = run;`, {
    filename: 'capsule.js',
  });
  script.runInContext(context);
  const run = context.__run as (wf: unknown, args: unknown) => Promise<unknown>;
  const { wf, calls, prompts } = stubWf(agentMap, readFile);
  const result = await run(wf, args);
  return { result, calls, prompts };
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
  // every rule after it. The review capsule composes ONE prompt out of the
  // reference files, so pin that the WHOLE composition is embedded (first and
  // last block present) AND that it tells the subagent to report via dsh's
  // built-in `structured_output` tool instead of printing a JSON string in its
  // final message.
  const root = builtinSkillsDir();
  for (const c of CAPSULES) {
    const source = loadCapsule(root, c).source as string;
    assert.ok(
      source.includes('structured_output'),
      `${c.capsule}: the agent prompt must require the structured_output tool`,
    );
    assert.ok(
      source.includes('# Review Agent (operating manual'),
      `${c.capsule}: the first composed prompt block is embedded`,
    );
    assert.ok(
      source.includes('# Security Checklist'),
      `${c.capsule}: the last composed prompt block is embedded (nothing truncated)`,
    );
  }
});

test('review capsule runs single-pass and skips the fixer on a clean review', async () => {
  const root = builtinSkillsDir();
  const capsule = loadCapsule(root, CAPSULES[0]!);
  const args = { task: 'scope' };

  {
    // clean → done, no fix round
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

  {
    // a report → fixer repairs it and reports back
    const reports = [
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
    const { result } = await runCapsule(capsule, args, {
      review: () => ({ spec_table: [], reports }),
      fix: () => ({
        status: 'fixed',
        fixes: [{ id: 'r1', diff: 'd', result: 'green', explanation: 'e' }],
      }),
    });
    const r = result as Record<string, unknown>;
    assert.equal(r.status, 'done');
    assert.equal(r.clean, false);
    assert.equal((r.fixes as unknown[]).length, 1);
  }
});

/** The verbatim header of the standard block the review capsule inlines. */
const STANDARD_HEADER = '## Standard (authoritative — the requirements + acceptance of record)';

test('review capsule injects the authoritative standard documents into the review and fixer prompts', async () => {
  const root = builtinSkillsDir();
  const capsule = loadCapsule(root, CAPSULES[0]!);
  const requirementsPath = '.plan/20260913/orders/prd.md';
  const acceptancePath = '.plan/20260913/orders/acceptance.md';
  // The standard reaches the agent as the DOCUMENT TEXT — never as the main
  // agent's summary of it (the anti-pollution boundary).
  const prdText = '# PRD — orders\n\n- REQ-1: order totals round half-up\n';
  const acceptanceText =
    '# Acceptance — orders\n\n| Req | Objective | Verifiable evidence |\n| REQ-1 | rounding | test/money.test.ts |\n';
  const documents: Record<string, string> = {
    [requirementsPath]: prdText,
    [acceptancePath]: acceptanceText,
  };
  const readStandard = (file: string): string => {
    const content = documents[file];
    if (content === undefined) throw new Error('ENOENT: ' + file);
    return content;
  };
  const report = {
    id: 'r1',
    level: 'critical',
    file: 'a.js',
    line: 3,
    invariant: 'inv',
    input: 'x',
    expected: 'y',
    actual: 'z',
    test: 't',
  };
  const compliance = [
    {
      requirement: 'REQ-1',
      acceptance: 'REQ-1 row',
      test: 'test/money.test.ts',
      status: 'fail',
      note: 'rounding is half-even',
    },
  ];

  {
    // A standard is supplied → BOTH agent prompts carry the verbatim documents.
    const { result, prompts } = await runCapsule(
      capsule,
      { task: 'scope', standard: { requirements: requirementsPath, acceptance: acceptancePath } },
      {
        review: () => ({ spec_table: [], reports: [report], compliance }),
        fix: () => ({
          status: 'fixed',
          fixes: [{ id: 'r1', diff: 'd', result: 'green', explanation: 'e' }],
        }),
      },
      readStandard,
    );
    for (const name of ['review', 'fix']) {
      const prompt = prompts.find((call) => call.name === name)?.prompt ?? '';
      assert.ok(prompt.length > 0, `the ${name} agent was dispatched`);
      assert.ok(
        prompt.includes(STANDARD_HEADER),
        `the ${name} prompt carries the standard block header`,
      );
      assert.ok(
        prompt.includes(prdText.trim()),
        `the ${name} prompt carries the requirements document verbatim`,
      );
      assert.ok(
        prompt.includes(acceptanceText.trim()),
        `the ${name} prompt carries the acceptance document verbatim`,
      );
    }
    // The compliance table the review produced is passed straight through.
    const r = result as Record<string, unknown>;
    assert.equal(r.status, 'done');
    assert.deepEqual(
      JSON.parse(JSON.stringify(r.compliance)),
      compliance,
      'compliance is passed through from the review structured output',
    );
  }

  {
    // No standard → the capsule behaves exactly as before (no block, and the
    // standard documents are never read).
    const { result, prompts } = await runCapsule(
      capsule,
      { task: 'scope' },
      { review: () => ({ spec_table: [], reports: [] }) },
      () => {
        throw new Error('the capsule must not read any file when no standard is given');
      },
    );
    const r = result as Record<string, unknown>;
    assert.equal(r.status, 'done');
    assert.equal(r.clean, true);
    assert.deepEqual(
      JSON.parse(JSON.stringify(r.compliance)),
      [],
      'compliance defaults to an empty list',
    );
    assert.ok(
      !prompts[0]!.prompt.includes(STANDARD_HEADER),
      'no standard block when no standard is supplied',
    );
  }

  {
    // A sole document is not a standard: both must load and carry content.
    const partials = [
      { requirements: requirementsPath },
      { acceptance: acceptancePath },
      { requirements: requirementsPath, acceptance: '.plan/20260913/orders/missing.md' },
    ];
    for (const standard of partials) {
      const { prompts } = await runCapsule(
        capsule,
        { task: 'scope', standard },
        { review: () => ({ spec_table: [], reports: [] }) },
        readStandard,
      );
      assert.ok(
        !prompts[0]!.prompt.includes(STANDARD_HEADER),
        `no standard block for an incomplete standard (${JSON.stringify(standard)})`,
      );
    }
  }
});

test('the pipeline SKILL.md call layers invoke run_workflow and never instruct a script copy', () => {
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
      /copy verbatim|meta\s*\+\s*script\s*\+\s*args/u,
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
