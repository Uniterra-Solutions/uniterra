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
import { format } from 'prettier';

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
// Deterministic provenance timestamp so re-running the builder is byte-idempotent
// (a `new Date()` here would make `pnpm run build` dirty the committed capsules
// every run — the provenance is informational, not a real clock).
const CAPSULE_CREATED_AT = '2026-08-27T00:00:00.000Z';

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

/**
 * Extract one `const <NAME> = \`...\`;` prompt body from a template source,
 * tolerating ESCAPED backticks (\`) inside the body. A naive lazy
 * `[\s\S]*?` stops at the first backtick followed by `;` — which happens
 * mid-body whenever the doc writes an escaped backtick before a semicolon
 * (e.g. `\`owned_files\`; never modify …`), silently TRUNCATING the prompt.
 * Mask `\`` with a sentinel before the regex and restore it afterwards so the
 * body is captured verbatim.
 */
function extractPrompt(source, name) {
  const sentinel = '\u0000BT\u0000';
  const masked = source.replace(/\\`/gu, sentinel);
  const m = new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`, 'u').exec(masked);
  if (m === null) {
    throw new Error(`build-workflow-capsules: "${name}" constant not found in template`);
  }
  return m[1].split(sentinel).join('\\`');
}

const SCHEMAS = {
  review:
    "{\n  type: 'object',\n  required: ['verdict', 'issues'],\n  properties: {\n    verdict: { type: 'string', enum: ['pass', 'fail'] },\n    issues: { type: 'array', items: { type: 'object', required: ['where', 'problem', 'suggestion'], properties: { where: { type: 'string' }, problem: { type: 'string' }, suggestion: { type: 'string' } } } },\n  },\n}",
};

/**
 * Build the plan-review capsule source. Runs ONE single-pass review: all three
 * axes (requirement feasibility / design over-engineering / acceptance
 * verifiability) are dispatched in parallel once, each returning a verdict +
 * issues. There is no repair agent and no re-review loop — the main agent reads
 * the returned issues and applies them itself (re-running the review as a fresh,
 * independent single pass if it wants to confirm).
 *
 * Every review agent is write-capable (readOnly: false): the workflow agents
 * must run tests / write code in the repo to verify their conclusions (a
 * reviewer that cannot write cannot prove a counterexample). The manifest
 * readOnly is false so a write-capable child is admitted — the plugin rejects a
 * write-capable child under a readOnly manifest, so the manifest must stay
 * false.
 */
function planReviewSource() {
  const requirement = prompt('plan-req', 'uniterra-plan', 'prompts', 'requirement-list-review.md');
  const design = prompt('plan-design', 'uniterra-plan', 'prompts', 'design-review.md');
  const acceptance = prompt('plan-accept', 'uniterra-plan', 'prompts', 'acceptance-review.md');

  return `{
  const { prd_dir, design_dir, acceptance_dir } = args;

  const REQUIREMENT_PROMPT = \`${tmpl(requirement)}\`;

  const DESIGN_PROMPT = \`${tmpl(design)}\`;

  const ACCEPTANCE_PROMPT = \`${tmpl(acceptance)}\`;

  const REVIEW_SCHEMA = ${SCHEMAS.review};

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

  // SINGLE review — dispatch all three axes once, in parallel. No repair agent,
  // no re-review loop: the main agent applies the returned issues itself and may
  // re-run the review as a fresh, independent single pass.
  const results = await wf.phase('plan-review', () => wf.parallel(
    REVIEWERS.map(r => () => wf.runAgent({
      name: r.label,
      prompt: r.prompt + '\\n\\n' + inputs(),
      readOnly: false,
      modelHint: 'deep',
      outputSchema: REVIEW_SCHEMA,
    })),
  ));

  const passed = [];
  const failures = [];
  let anyNull = false;
  REVIEWERS.forEach((r, i) => {
    const res = results[i];
    if (res === null) {
      anyNull = true;
      return;
    }
    const structured = res.structured;
    if (structured !== undefined && structured.verdict === 'pass') {
      passed.push(r.key);
    } else {
      failures.push({ reviewer: r.key, doc: r.doc, issues: structured?.issues ?? [] });
    }
  });

  // A null reviewer terminates the run as failed WITHOUT listing pass axes (or
  // the null axis itself — its failure is the status, not a verdict-fail row).
  if (anyNull) return { status: 'failed', reason: 'a review agent failed', failures };
  return { status: 'done', pass: failures.length === 0, passed, failures };
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
  // The fixed-rules block is the ```js FIXED_RULES content; extract it verbatim
  // (tolerating escaped backticks mid-body — see extractPrompt).
  const rules = extractPrompt(fixedRules, 'FIXED_RULES');

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

  // Build a SMALL per-task prompt by inlining the task brief from promptFile
  // (a repo-relative path) via wf.readFile, so run_workflow args stay tiny and
  // the subagent does NOT read the file itself. Falls back to "read it yourself"
  // if the inlined load fails (graceful degradation), and throws if a task is
  // missing promptFile (a contract violation).
  async function taskPrompt(t) {
    if (t == null || typeof t !== 'object') throw new Error('implement task must be an object');
    const id = t.id === undefined ? 'task' : String(t.id);
    if (typeof t.promptFile !== 'string' || t.promptFile.trim().length === 0) {
      throw new Error('implement task "' + id + '" is missing a promptFile path: write the task brief to a file and pass its repo-relative path (keep args small)');
    }
    let brief = '';
    try {
      brief = (await wf.readFile(t.promptFile)) || '';
    } catch {
      brief = '';
    }
    const briefBlock = brief.trim().length > 0
      ? brief.trim()
      : '! The task brief could not be loaded automatically — read the file at ' + t.promptFile + ' now with the read tool. It is your full brief (goal, owned/forbidden files, requirements + their allocated failing tests, conventions, constraints).';
    return [
      '## Task to implement',
      '- task id: ' + id,
      '- task name: ' + (t.name === undefined ? id : String(t.name)),
      '- task file: ' + t.promptFile,
      '',
      briefBlock,
    ].join('\\n');
  }

  const groups = batches ?? (tasks ? [tasks] : []);
  const results = [];

  for (let b = 0; b < groups.length; b++) {
    const label = groups.length > 1 ? 'batch-' + (b + 1) : 'implement';
    const done = await wf.phase(label, () => wf.parallel(
      groups[b].map(t => async () => wf.runAgent({
        name: String(t?.id ?? 'task'),
        prompt: await taskPrompt(t) + '\\n\\n' + FIXED_RULES,
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
 * Build the review capsule source. Mirrors the original single-pass,
 * three-layer property-based review: the review agent models AND proves the
 * intra-module logic, the module × counterpart interactions, and the system
 * slices involving the module — everything by PBT (>10k runs) — and a fixer
 * repairs each counterexample (only if any were found). The review knowledge is
 * split into responsibility-separated reference files; the capsule composes ONE
 * self-contained REVIEW_PROMPT from them (the subagent cannot read the skill
 * dir from the repo under review). The manifest is not read-only because the
 * fixer must change source; the REVIEW agent is individually read-only.
 */
function reviewSource() {
  const reviewDir = path.join(srcSkills, 'uniterra-review', 'references');
  const readRef = (name) => {
    const content = readFileSync(path.join(reviewDir, name), 'utf8').trim();
    // The capsule embeds this knowledge: an empty file would silently ship an
    // empty prompt section. Fail loudly instead.
    if (content.length === 0) throw new Error(`build-workflow-capsules: references/${name} is empty`);
    return content;
  };
  const reviewCore = readRef('review-agent.md');
  const modeling = readRef('model-construction.md');
  const invariants = readRef('invariant-taxonomy.md');
  const patterns = readRef('test-patterns.md');
  const checklist = readRef('security-checklist.md');
  const fixerPrompt = readRef('fix-agent.md');

  const reviewPrompt = [
    reviewCore,
    '## Knowledge — model construction (file: references/model-construction.md)',
    modeling,
    '## Knowledge — invariant taxonomy (file: references/invariant-taxonomy.md)',
    invariants,
    '## Knowledge — test patterns + execution (file: references/test-patterns.md)',
    patterns,
    '## Knowledge — security checklist, inlined (file: references/security-checklist.md; mandatory axis)',
    checklist,
  ].join('\n\n');

  return `{
  const { task } = args;

  const REVIEW_PROMPT = \`${tmpl(reviewPrompt)}\`;

  const FIXER_PROMPT = \`${tmpl(fixerPrompt)}\`;

  const REVIEW_SCHEMA = {
    type: 'object',
    required: ['spec_table', 'reports'],
    properties: {
      spec_table: { type: 'array', items: { type: 'object', required: ['module', 'state', 'operation', 'precondition', 'postcondition', 'invariant'], properties: { module: { type: 'string' }, state: { type: 'string' }, operation: { type: 'string' }, precondition: { type: 'string' }, postcondition: { type: 'string' }, invariant: { type: 'string' } } } },
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
    readOnly: false,
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
  const reviewPrompt = extractPrompt(template, 'REVIEW_PROMPT');
  const fixPrompt = extractPrompt(template, 'FIX_PROMPT');

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
      readOnly: false,
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
    description:
      'Review plan documents (requirements / design / acceptance) in a single parallel pass with three review agents; the main agent applies any returned issues (and may re-run the review fresh).',
    phases: ['plan-review'],
    readOnly: false,
    patterns: ['fan-out-and-synthesize'],
    source: sourceOf(planReviewSource()),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        prd_dir: { type: 'string' },
        design_dir: { type: 'string' },
        acceptance_dir: { type: 'string' },
      },
      required: ['prd_dir', 'design_dir', 'acceptance_dir'],
    },
  },
  {
    file: 'implement',
    skillDir: 'uniterra-implement',
    name: 'implement',
    description:
      'Dispatch an approved task list to subagents — all task in parallel, or serial batches of parallel tasks — and collect each agent JSON report.',
    phases: ['implement'],
    readOnly: false,
    patterns: ['fan-out-and-synthesize'],
    source: sourceOf(implementSource()),
  },
  {
    file: 'review',
    skillDir: 'uniterra-review',
    name: 'review',
    description:
      'Property-based adversarial review: extract a formal spec table + >10k-run PBT counterexamples, then fix each counterexample.',
    phases: ['review', 'fix'],
    readOnly: false,
    patterns: ['adversarial-verification'],
    source: sourceOf(reviewSource()),
  },
  {
    file: 'simplify',
    skillDir: 'uniterra-simplify',
    name: 'simplify',
    description:
      'Behaviour-preserving simplification: review → fix until simple, with a hard round cap and cross-round skip accumulation.',
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
      createdAt: CAPSULE_CREATED_AT,
      dshVersion: DSH_VERSION,
      pluginVersion: PLUGIN_VERSION,
    },
  };
  const outDir = explicitTarget === undefined ? path.join(target, c.skillDir, 'workflows') : target;
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${c.file}.workflow.json`);
  // Format with prettier so the emitted byte content matches what lint-staged
  // writes on commit — a plain JSON.stringify would churn against prettier on
  // every `pnpm run build`.
  const content = await format(`${JSON.stringify(capsule, null, 2)}\n`, { parser: 'json' });
  writeFileSync(out, content, 'utf8');
  console.log(`build-workflow-capsules: wrote ${path.relative(process.cwd(), out)}`);
}
