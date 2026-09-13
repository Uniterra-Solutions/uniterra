/**
 * Build the dsh_workflow `review` capsule that replaces the dynamic workflow
 * script the bundled review skill used to ask the model to copy into the native
 * `workflow` tool.
 *
 * The orchestration + the agent prompts are packaged as a `.workflow.json`
 * capsule (format `dsh.workflow`) so the model invokes it by NAME with
 * `run_workflow('name', args)` — no more "copy the JS block" step. The
 * capsule's `source` is a self-contained `async function run(wf, args)` that
 * uses the dsh_workflow `wf` API (wf.phase / wf.runAgent / wf.readFile) and
 * embeds the agent prompts as the `prompt` argument.
 *
 * The prompts are read from the canonical reference files under `src/skills/*`
 * so the prompt TEXT is never duplicated/edited here — only the orchestration
 * is new. The emitted capsule is written next to its skill
 * (`src/skills/uniterra-review/workflows/review.workflow.json`), mirrored to
 * `dist/skills/` by copy-skills.mjs, and provisioned into the profile's
 * workflow dir by the desktop; this runs as part of `pnpm run build`.
 *
 * Usage: node scripts/build-workflow-capsules.mjs [targetDir]
 *   - default target: src/skills (used by `pnpm run build`)
 *   - explicit target: used by the test harness to mirror the capsule beside
 *     the compiled test fixtures.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcSkills = path.join(here, '..', 'src', 'skills');
// The canonical capsule lives next to its skill under `src/skills/<skill>/workflows/`
// (copied to `dist/skills/<skill>/workflows/` by copy-skills.mjs, and the
// desktop provisions it from there into the profile's workflow dir). Passing an
// explicit target emits it into one flat directory (used by the test harness).
const explicitTarget = process.argv[2];
const target = explicitTarget === undefined ? srcSkills : explicitTarget;

const DSH_VERSION = '0.1.5-rc.2'; // the uniterra-pinned dsh family (see VENDOR.md)
const PLUGIN_VERSION = '0.1.4'; // the pinned dsh_workflow tag (v0.1.4)
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

/**
 * Build the review capsule source. Mirrors the original single-pass,
 * three-layer property-based review: the review agent models AND proves the
 * intra-module logic, the module × counterpart interactions, and the system
 * slices involving the module — everything by PBT (>10k runs) — and a fixer
 * repairs each counterexample (only if any were found). The review knowledge is
 * split into responsibility-separated reference files; the capsule composes ONE
 * self-contained REVIEW_PROMPT from them (the subagent cannot read the skill
 * dir from the repo under review). When \`args.standard\` names the plan's
 * prd + acceptance (repo-relative paths), both documents are read and inlined
 * VERBATIM into the review AND fixer prompts — the standard reaches the agents
 * as the document text, never as the main agent's narrative. The manifest is
 * not read-only because the fixer must change source; the REVIEW agent is
 * individually read-only.
 */
function reviewSource() {
  const reviewDir = path.join(srcSkills, 'uniterra-review', 'references');
  const readRef = (name) => {
    const content = readFileSync(path.join(reviewDir, name), 'utf8').trim();
    // The capsule embeds this knowledge: an empty file would silently ship an
    // empty prompt section. Fail loudly instead.
    if (content.length === 0)
      throw new Error(`build-workflow-capsules: references/${name} is empty`);
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
  const { task, standard } = args;

  const REVIEW_PROMPT = \`${tmpl(reviewPrompt)}\`;

  const FIXER_PROMPT = \`${tmpl(fixerPrompt)}\`;

  const STANDARD_BLOCK = '## Standard (authoritative — the requirements + acceptance of record)';

  // The standard is the plan's prd + acceptance AS THEIR ORIGINAL TEXT: the
  // authoritative documents go in, the main agent's narrative stays out. Both
  // paths must resolve to non-empty content or there is no standard at all
  // (standalone review degrades to pure code modelling, exactly as before).
  async function readStandard() {
    if (standard == null || typeof standard !== 'object') return '';
    try {
      const requirements = typeof standard.requirements === 'string' && standard.requirements.trim().length > 0
        ? (await wf.readFile(standard.requirements)) || ''
        : '';
      const acceptance = typeof standard.acceptance === 'string' && standard.acceptance.trim().length > 0
        ? (await wf.readFile(standard.acceptance)) || ''
        : '';
      if (requirements.trim().length === 0 || acceptance.trim().length === 0) return '';
      return '\\n\\n' + STANDARD_BLOCK + '\\n' + requirements.trim() + '\\n\\n' + acceptance.trim();
    } catch {
      return '';
    }
  }

  const standardBlock = await readStandard();

  const REVIEW_SCHEMA = {
    type: 'object',
    required: ['spec_table', 'reports'],
    properties: {
      spec_table: { type: 'array', items: { type: 'object', required: ['module', 'state', 'operation', 'precondition', 'postcondition', 'invariant'], properties: { module: { type: 'string' }, state: { type: 'string' }, operation: { type: 'string' }, precondition: { type: 'string' }, postcondition: { type: 'string' }, invariant: { type: 'string' } } } },
      reports: { type: 'array', items: { type: 'object', required: ['id', 'level', 'file', 'line', 'invariant', 'input', 'expected', 'actual', 'test'], properties: { id: { type: 'string' }, level: { type: 'string', enum: ['critical', 'medium', 'low'] }, file: { type: 'string' }, line: { type: 'number' }, invariant: { type: 'string' }, input: { type: 'string' }, expected: { type: 'string' }, actual: { type: 'string' }, test: { type: 'string' } } } },
      compliance: { type: 'array', items: { type: 'object', required: ['requirement', 'status'], properties: { requirement: { type: 'string' }, acceptance: { type: 'string' }, test: { type: 'string' }, status: { type: 'string', enum: ['pass', 'fail', 'missing', 'contradiction'] }, note: { type: 'string' } } } },
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
    prompt: REVIEW_PROMPT + standardBlock + '\\n\\n## Review scope\\n' + task,
    readOnly: false,
    modelHint: 'deep',
    outputSchema: REVIEW_SCHEMA,
  }));
  if (review === null) return { status: 'blocked', reason: 'review agent failed' };

  const reports = review.structured?.reports ?? [];
  // The compliance table is the review's own output (requirement X/Y), passed
  // through untouched so the main agent aggregates it instead of inventing it.
  const compliance = review.structured?.compliance ?? [];
  const clean = reports.length === 0;

  let fixes = [];
  if (!clean) {
    const fix = await wf.phase('fix', () => wf.runAgent({
      name: 'fix',
      prompt: FIXER_PROMPT + standardBlock + '\\n\\n## Error reports\\n' + JSON.stringify(reports, null, 2),
      readOnly: false,
      modelHint: 'deep',
      outputSchema: FIXER_SCHEMA,
    }));
    if (fix === null) return { status: 'blocked', reason: 'fix agent failed', reports };
    fixes = fix.structured?.fixes ?? [];
    // A fixer that could not repair every counterexample is an incomplete review,
    // not a completed one — surface 'failed' (parity with simplify),
    // never a misleading 'done'.
    if (fix.structured?.status === 'failed') return { status: 'failed', clean: false, reports, fixes, compliance };
  }

  return { status: 'done', clean, reports, fixes, compliance };
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
