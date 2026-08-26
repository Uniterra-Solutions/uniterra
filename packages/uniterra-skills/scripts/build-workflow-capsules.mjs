/**
 * Build the four dsh_workflow capsules that replace the dynamic workflow
 * scripts the bundled pipeline skills used to ask the model to copy into the
 * native `workflow` tool.
 *
 * The orchestration + the agent prompts are now packaged as `.workflow.json`
 * capsules (format `dsh.workflow`) so the model invokes them by NAME with
 * `run_workflow('name', args)` — no more "copy the JS block" step. Each
 * capsule's `source` is a self-contained `async function run(wf, args)` that
 * uses the dsh_workflow `wf` API (wf.phase / wf.runAgent / wf.parallel) and
 * embeds the agent prompts as the `prompt` argument.
 *
 * The prompts are read from the canonical asset files under `src/skills/*` so
 * the prompt TEXT is never duplicated/edited here — only the orchestration is
 * new. The emitted capsules land in `dist/workflows/` for the test harness and
 * the desktop's capsule provisioning; this runs as part of `pnpm run build`.
 *
 * Usage: node scripts/build-workflow-capsules.mjs [targetDir]
 *   - default target: dist/workflows (used by `pnpm run build`)
 *   - explicit target: used by the test harness to mirror capsules beside the
 *     compiled test fixtures.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcSkills = path.join(here, '..', 'src', 'skills');
// The canonical capsules live next to each skill under `src/skills/<skill>/workflows/`
// (they are copied to `dist/skills/<skill>/workflows/` by copy-skills.mjs, and the
// desktop provisions them from there into the profile's workflow dir). Passing an
// explicit target emits all four into one flat directory (used by the test harness).
const explicitTarget = process.argv[2];
const target = explicitTarget === undefined ? srcSkills : explicitTarget;

const DSH_VERSION = '0.1.1-rc.2'; // the uniterra-pinned dsh family (see VENDOR.md)
const PLUGIN_VERSION = '0.1.3'; // the pinned dsh_workflow tag (v0.1.3)

/** Render a raw prompt string as a JS template-literal body, escaping the
 * characters that would otherwise be interpreted by the QuickJS sandbox
 * (backtick, `${`). The dsh_workflow source runs in a restricted VM, so the
 * prompt text must survive as literal text inside the capsule source. */
function tmpl(text) {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/** Read the fixed prompt text for one reviewer from its canonical markdown asset. */
function prompt(kind, ...subpaths) {
  const file = path.join(srcSkills, ...subpaths);
  return readFileSync(file, 'utf8').trim();
}

const SCHEMAS = {
  review:
    "{\n  type: 'object',\n  required: ['verdict', 'issues'],\n  properties: {\n    verdict: { type: 'string', enum: ['pass', 'fail'] },\n    issues: { type: 'array', items: { type: 'object', required: ['where', 'problem', 'suggestion'], properties: { where: { type: 'string' }, problem: { type: 'string' }, suggestion: { type: 'string' } } } },\n  },\n}",
  repair:
    "{\n  type: 'object',\n  required: ['status'],\n  properties: {\n    status: { type: 'string', enum: ['fixed', 'failed'] },\n    summary: { type: 'string' },\n  },\n}",
};

/**
 * Build the plan-review capsule source. Mirrors the original three-axis
 * review → repair loop: review all still-failing axes in parallel, hand the
 * failing axes' issues to one repair agent that edits the docs itself, then
 * re-review ONLY the axes that failed (a passed axis is never re-dispatched).
 *
 * manifest.readOnly is false because the repair agent must write to the plan
 * documents; each REVIEW agent is individually read-only (C3's "readOnly: true"
 * reading applies to the review agents, not the whole mutating workflow — the
 * plugin rejects a write-capable child under a readOnly manifest, so a manifest
 * readOnly of true would make the repair agent impossible).
 */
function planReviewSource() {
  const requirement = prompt('plan-req', 'uniterra-plan', 'prompts', 'requirement-list-review.md');
  const design = prompt('plan-design', 'uniterra-plan', 'prompts', 'design-review.md');
  const acceptance = prompt('plan-accept', 'uniterra-plan', 'prompts', 'acceptance-review.md');
  const repair = `You are an isolated repair subagent. You apply the review issues to the plan documents
yourself. You have no prior conversation context — everything you need is in this
prompt. The issues are injected below as a list of { reviewer, doc, dir, issues }.

Method:
1. For EACH entry, read the document named by \`doc\` inside \`dir\` (e.g. read
   \`<dir>/prd.md\`), and apply every issue in its \`issues\` list. Each issue carries
   a \`where\`, a \`problem\`, and a \`suggestion\`.
2. Make the MINIMAL edit that resolves each issue, following the suggestion where it
   is sensible. Preserve the document's existing structure, formatting, and voice.
3. Do NOT touch a document that has no issues this round, and do NOT rewrite unrelated
   content or invent new problems.

Constraints:
- Only apply the listed issues; do not expand scope.
- Keep changes minimal and consistent with the rest of the document.
- Leave the edited documents on disk (do not commit).

Return: status ("fixed" | "failed") and a short summary of what was applied.`;

  return `{
  const { prd_dir, design_dir, acceptance_dir } = args;

  const REQUIREMENT_PROMPT = \`${tmpl(requirement)}\`;

  const DESIGN_PROMPT = \`${tmpl(design)}\`;

  const ACCEPTANCE_PROMPT = \`${tmpl(acceptance)}\`;

  const REPAIR_PROMPT = \`${tmpl(repair)}\`;

  const REVIEW_SCHEMA = ${SCHEMAS.review};
  const REPAIR_SCHEMA = ${SCHEMAS.repair};

  function inputs() {
    return [
      '## Inputs',
      \`- prd_dir: \${prd_dir}\`,
      \`- design_dir: \${design_dir}\`,
      \`- acceptance_dir: \${acceptance_dir}\`,
    ].join('\\n');
  }

  const REVIEWERS = [
    { key: 'requirement', label: 'requirement-list-review', prompt: REQUIREMENT_PROMPT, doc: 'prd.md', dir: prd_dir },
    { key: 'design', label: 'design-review', prompt: DESIGN_PROMPT, doc: 'design.md', dir: design_dir },
    { key: 'acceptance', label: 'acceptance-review', prompt: ACCEPTANCE_PROMPT, doc: 'acceptance.md', dir: acceptance_dir },
  ];

  const maxRounds = args.maxRounds ?? 8;
  const passed = new Set();

  for (let round = 1; round <= maxRounds; round++) {
    const pending = REVIEWERS.filter(r => !passed.has(r.key));
    if (pending.length === 0) return { status: 'done', roundsUsed: round, pass: true, skipped: [...passed] };

    const results = await wf.phase('round-' + round, () => wf.parallel(
      pending.map(r => () => wf.runAgent({
        name: r.label,
        prompt: r.prompt + '\\n\\n' + inputs(),
        readOnly: true,
        modelHint: 'deep',
        outputSchema: REVIEW_SCHEMA,
      })),
    ));
    // Record each axis' outcome in ONE pass so an axis that passed this round is
    // never misreported as a failure when another axis' agent returned null.
    const failures = [];
    let anyNull = false;
    pending.forEach((r, i) => {
      const res = results[i];
      if (res === null) {
        anyNull = true;
      } else if (res.structured !== undefined && res.structured.verdict === 'pass') {
        passed.add(r.key);
      } else {
        failures.push({ reviewer: r.key, issues: res?.structured?.issues ?? [] });
      }
    });

    // A null reviewer terminates the run as failed WITHOUT listing pass axes (or
    // the null axis itself — its failure is the status, not a verdict-fail row).
    if (anyNull) return { status: 'failed', roundsUsed: round, failures };
    if (failures.length === 0) return { status: 'done', roundsUsed: round, pass: true, skipped: [...passed] };

    const toRepair = failures.filter(f => f.issues.length > 0);
    if (toRepair.length === 0) continue;
    const repairInput = toRepair.map(f => ({ reviewer: f.reviewer, doc: REVIEWERS.find(r => r.key === f.reviewer).doc, dir: REVIEWERS.find(r => r.key === f.reviewer).dir, issues: f.issues }));
    const repair = await wf.runAgent({
      name: 'repair-' + round,
      prompt: REPAIR_PROMPT + '\\n\\n## Issues to repair\\n' + JSON.stringify(repairInput, null, 2),
      readOnly: false,
      modelHint: 'balanced',
      outputSchema: REPAIR_SCHEMA,
    });
    if (repair === null) return { status: 'blocked', reason: 'repair agent failed', roundsUsed: round };
    if (repair.structured?.status === 'failed') return { status: 'failed', roundsUsed: round, failures };
  }

  return { status: 'blocked', reason: 'max rounds reached', roundsUsed: maxRounds, skipped: [...passed] };
}`;
}

/** Build the implement capsule source. Mirrors the original fan-out: all tasks
 * in `args.tasks` run in parallel, or serial batches of parallel tasks when
 * `args.batches` is given; any failing child fails the whole run (batches are
 * dependent). Returns { status, agents } on success. */
function implementSource() {
  const fixedRules = readFileSync(
    path.join(srcSkills, 'uniterra-implement', 'assets', 'workflow-template.md'),
    'utf8',
  );
  // The fixed-rules block is the ```js FIXED_RULES content; extract it verbatim.
  const m = /const FIXED_RULES = `([\s\S]*?)`;/u.exec(fixedRules);
  const rules = m === null ? '' : m[1];

  return `{
  const { tasks, batches } = args ?? {};

  const FIXED_RULES = \`${tmpl(rules)}\`;

  const RETURN_SCHEMA = {
    type: 'object',
    required: ['changed_files', 'satisfied_requirements'],
    properties: {
      changed_files: { type: 'array', items: { type: 'object', required: ['file', 'lines'], properties: { file: { type: 'string' }, lines: { type: 'string' } } } },
      satisfied_requirements: { type: 'array', items: { type: 'string' } },
      deviations: { type: 'array', items: { type: 'string' } },
    },
  };

  const groups = batches ?? (tasks ? [tasks] : []);
  const results = [];

  for (let b = 0; b < groups.length; b++) {
    const label = groups.length > 1 ? 'batch-' + (b + 1) : 'implement';
    const done = await wf.phase(label, () => wf.parallel(
      groups[b].map(t => () => wf.runAgent({
        name: t.id,
        prompt: t.prompt + '\\n\\n' + FIXED_RULES,
        readOnly: false,
        modelHint: 'balanced',
        outputSchema: RETURN_SCHEMA,
      })),
    ));
    if (done.some(r => r === null)) return { status: 'failed', batch: b + 1 };
    results.push(...done.map(r => r.structured));
  }
  return { status: 'done', agents: results.length };
}`;
}

/**
 * Build the review capsule source. Mirrors the original single-pass
 * property-based review: a read-only review agent extracts a formal spec table
 * + >10k-run PBT counterexamples, and a fixer repairs each counterexample (only
 * if any were found). The manifest is not read-only because the fixer must
 * change source; the REVIEW agent is individually read-only.
 */
function reviewSource() {
  const template = readFileSync(
    path.join(srcSkills, 'uniterra-review', 'assets', 'workflow-template.md'),
    'utf8',
  );
  const review = /const REVIEW_PROMPT = `([\s\S]*?)`;/u.exec(template);
  const fixer = /const FIXER_PROMPT = `([\s\S]*?)`;/u.exec(template);
  const reviewPrompt = review === null ? '' : review[1];
  const fixerPrompt = fixer === null ? '' : fixer[1];

  return `{
  const { task } = args;

  const REVIEW_PROMPT = \`${tmpl(reviewPrompt)}\`;

  const FIXER_PROMPT = \`${tmpl(fixerPrompt)}\`;

  const REVIEW_SCHEMA = {
    type: 'object',
    required: ['spec_table', 'reports'],
    properties: {
      spec_table: { type: 'array', items: { type: 'object', required: ['module', 'branch', 'precondition', 'postcondition', 'invariant'], properties: { module: { type: 'string' }, branch: { type: 'string' }, precondition: { type: 'string' }, postcondition: { type: 'string' }, invariant: { type: 'string' } } } },
      reports: { type: 'array', items: { type: 'object', required: ['id', 'level', 'file', 'line', 'invariant', 'input', 'expected', 'actual', 'test'], properties: { id: { type: 'string' }, level: { type: 'string', enum: ['critical', 'medium', 'low'] }, file: { type: 'string' }, line: { type: 'number' }, invariant: { type: 'string' }, input: { type: 'string' }, expected: { type: 'string' }, actual: { type: 'string' }, test: { type: 'string' } } } },
    },
  };

  const FIXER_SCHEMA = {
    type: 'object',
    required: ['status', 'fixes'],
    properties: {
      status: { type: 'string', enum: ['fixed', 'failed'] },
      fixes: { type: 'array', items: { type: 'object', required: ['id', 'diff', 'result', 'explanation'], properties: { id: { type: 'string' }, diff: { type: 'string' }, result: { type: 'string' }, explanation: { type: 'string' } } } },
    },
  };

  const review = await wf.phase('review', () => wf.runAgent({
    name: 'review',
    prompt: REVIEW_PROMPT + '\\n\\n## Review scope\\n' + task,
    readOnly: true,
    modelHint: 'deep',
    outputSchema: REVIEW_SCHEMA,
  }));
  if (review === null) return { status: 'blocked', reason: 'review agent failed' };

  const reports = review.structured?.reports ?? [];
  const clean = reports.length === 0;

  let fixes = [];
  if (!clean) {
    const fix = await wf.phase('fix', () => wf.runAgent({
      name: 'fix',
      prompt: FIXER_PROMPT + '\\n\\n## Error reports\\n' + JSON.stringify(reports, null, 2),
      readOnly: false,
      modelHint: 'deep',
      outputSchema: FIXER_SCHEMA,
    }));
    if (fix === null) return { status: 'blocked', reason: 'fix agent failed', reports };
    fixes = fix.structured?.fixes ?? [];
    // A fixer that could not repair every counterexample is an incomplete review,
    // not a completed one — surface 'failed' (parity with plan-review / simplify),
    // never a misleading 'done'.
    if (fix.structured?.status === 'failed') return { status: 'failed', clean: false, reports, fixes };
  }

  return { status: 'done', clean, reports, fixes };
}`;
}

/** Build the simplify capsule source. Mirrors the original review → fix loop
 * with a hard round cap and cross-round skip accumulation. The design context
 * is authoritative; a verdict 'pass' or an empty recommendation list ends the
 * loop early. */
function simplifySource() {
  const template = readFileSync(
    path.join(srcSkills, 'uniterra-simplify', 'assets', 'workflow-template.md'),
    'utf8',
  );
  const review = /const REVIEW_PROMPT = `([\s\S]*?)`;/u.exec(template);
  const fix = /const FIX_PROMPT = `([\s\S]*?)`;/u.exec(template);
  const reviewPrompt = review === null ? '' : review[1];
  const fixPrompt = fix === null ? '' : fix[1];

  return `{
  const { goal, context } = args;

  const REVIEW_PROMPT = \`${tmpl(reviewPrompt)}\`;

  const FIX_PROMPT = \`${tmpl(fixPrompt)}\`;

  const REVIEW_SCHEMA = {
    type: 'object',
    required: ['verdict', 'recommendations'],
    properties: {
      verdict: { type: 'string', enum: ['pass', 'fail'] },
      recommendations: { type: 'array', items: { type: 'object', required: ['id', 'safetiness', 'description'], properties: { id: { type: 'string' }, safetiness: { type: 'string', enum: ['safe', 'risky'] }, description: { type: 'string' } } } },
    },
  };

  const FIX_SCHEMA = {
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string', enum: ['fixed', 'failed'] },
      applied_recommendations: { type: 'array', items: { type: 'string' } },
      skipped: { type: 'array', items: { type: 'object', required: ['id', 'reason'], properties: { id: { type: 'string' }, reason: { type: 'string' } } } },
      summary: { type: 'string' },
    },
  };

  function contextBlock() {
    return [
      '## Context',
      '### Requirements',
      (context && context.requirements) || '(none)',
      '### Design',
      (context && context.design) || '(none)',
      '### Acceptance',
      (context && context.acceptance) || '(none)',
    ].join('\\n');
  }

  const maxRounds = args.maxRounds ?? 8;
  const accumulatedSkipped = [];

  for (let round = 1; round <= maxRounds; round++) {
    const skippedBlock = accumulatedSkipped.length
      ? '\\n\\n## Previously skipped recommendations (from earlier fix rounds)\\n' +
        'These were considered and deliberately NOT applied. Do NOT re-raise an item ' +
        'unless its reason no longer holds — if the code has since changed so the ' +
        'simplification is now safe, re-raise it with an updated safety rating and a ' +
        'note that the previous reason no longer applies.\\n' +
        JSON.stringify(accumulatedSkipped, null, 2)
      : '';

    const review = await wf.phase('round-' + round, () => wf.runAgent({
      name: 'review-' + round,
      prompt: REVIEW_PROMPT + '\\n\\n## Goal\\n' + goal + '\\n\\n' + contextBlock() + skippedBlock,
      readOnly: true,
      modelHint: 'deep',
      outputSchema: REVIEW_SCHEMA,
    }));
    if (review === null) return { status: 'blocked', reason: 'review agent failed', round, skipped: accumulatedSkipped };

    const recommendations = review.structured?.recommendations ?? [];
    if (review.structured?.verdict === 'pass' || recommendations.length === 0) {
      return { status: 'done', rounds: round, verdict: review.structured?.verdict, recommendations, skipped: accumulatedSkipped };
    }

    const fix = await wf.phase('fix-' + round, () => wf.runAgent({
      name: 'fix-' + round,
      prompt: FIX_PROMPT + '\\n\\n## Goal\\n' + goal + '\\n\\n' + contextBlock() + '\\n\\n## Recommendations\\n' + JSON.stringify(recommendations, null, 2),
      readOnly: false,
      modelHint: 'balanced',
      outputSchema: FIX_SCHEMA,
    }));
    if (fix === null) return { status: 'blocked', reason: 'fix agent failed', round, recommendations, skipped: accumulatedSkipped };
    if (fix.structured?.status === 'failed') return { status: 'failed', round, recommendations, skipped: accumulatedSkipped };

    for (const s of (fix.structured?.skipped ?? [])) {
      const entry = { round, id: s.id, reason: s.reason };
      const existing = accumulatedSkipped.findIndex(e => e.id === s.id);
      if (existing >= 0) accumulatedSkipped[existing] = entry;
      else accumulatedSkipped.push(entry);
    }
  }

  return { status: 'blocked', reason: 'max rounds reached', rounds: maxRounds, skipped: accumulatedSkipped };
}`;
}

function manifest(name, description, phases, readOnly, patterns, inputSchema) {
  return {
    name,
    description,
    phases,
    readOnly,
    maxAgents: 64,
    maxConcurrency: 8,
    ...(inputSchema === undefined ? {} : { inputSchema }),
    patterns,
  };
}

/** Wrap a `run(wf, args)` body (the source string without the wrapper) into a
 * disallowed-token-free `async function run(wf, args) { ... }`. */
function sourceOf(body) {
  return `async function run(wf, args) {\n${body}\n}`;
}

const capsules = [
  {
    file: 'plan-review',
    skillDir: 'uniterra-plan',
    name: 'plan-review',
    description: 'Review plan documents (requirements / design / acceptance) with three parallel agents, repair the failing axes, and re-review only the axes that failed until all pass.',
    phases: ['requirement-list-review', 'design-review', 'acceptance-review'],
    readOnly: false,
    patterns: ['fan-out-and-synthesize', 'loop-until-done'],
    source: sourceOf(planReviewSource()),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        prd_dir: { type: 'string' },
        design_dir: { type: 'string' },
        acceptance_dir: { type: 'string' },
        maxRounds: { type: 'integer' },
      },
      required: ['prd_dir', 'design_dir', 'acceptance_dir'],
    },
  },
  {
    file: 'implement',
    skillDir: 'uniterra-implement',
    name: 'implement',
    description: 'Dispatch an approved task list to subagents — all task in parallel, or serial batches of parallel tasks — and collect each agent JSON report.',
    phases: ['implement'],
    readOnly: false,
    patterns: ['fan-out-and-synthesize'],
    source: sourceOf(implementSource()),
  },
  {
    file: 'review',
    skillDir: 'uniterra-review',
    name: 'review',
    description: 'Property-based adversarial review: extract a formal spec table + >10k-run PBT counterexamples, then fix each counterexample.',
    phases: ['review', 'fix'],
    readOnly: false,
    patterns: ['adversarial-verification'],
    source: sourceOf(reviewSource()),
  },
  {
    file: 'simplify',
    skillDir: 'uniterra-simplify',
    name: 'simplify',
    description: 'Behaviour-preserving simplification: review → fix until simple, with a hard round cap and cross-round skip accumulation.',
    phases: ['round-1'],
    readOnly: false,
    patterns: ['loop-until-done'],
    source: sourceOf(simplifySource()),
  },
];

mkdirSync(target, { recursive: true });
for (const c of capsules) {
  const capsule = {
    format: 'dsh.workflow',
    version: 1,
    workflowApiVersion: 1,
    minDshVersion: DSH_VERSION,
    manifest: manifest(c.name, c.description, c.phases, c.readOnly, c.patterns, c.inputSchema),
    source: c.source,
    intent: {
      taskClass: c.name,
      patterns: c.patterns,
      reusableFor: [],
      notFor: [],
    },
    inputs: {
      description: c.description,
      examples: [],
    },
    requires: {
      modelTiers: ['deep', 'balanced'],
    },
    provenance: {
      createdAt: new Date().toISOString(),
      dshVersion: DSH_VERSION,
      pluginVersion: PLUGIN_VERSION,
    },
  };
  const outDir = explicitTarget === undefined ? path.join(target, c.skillDir, 'workflows') : target;
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${c.file}.workflow.json`);
  writeFileSync(out, `${JSON.stringify(capsule, null, 2)}\n`, 'utf8');
  console.log(`build-workflow-capsules: wrote ${path.relative(process.cwd(), out)}`);
}
