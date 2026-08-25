# Review Workflow Template

One workflow: review (formal-spec + property-based proof) → fix → aggregate. Make **ONE**
`workflow` tool call — `meta`, `script`, and `args` are three properties of ONE arguments
object, never three separate calls, and never wrapped under a field named `arguments`:

```json
{
  "meta": {
    "name": "review",
    "description": "Property-based review: extract invariants, prove with PBT, fix, aggregate"
  },
  "script": "<the JS below>",
  "args": {
    "goal": "...",
    "context": { "requirements": "...", "design": "...", "acceptance": "..." },
    "task": "..."
  }
}
```

`meta` + `script` are required; `args` is optional. Splitting `meta`/`script`/`args` across
parallel calls fails with `missing required property "meta"` / `"script"`; wrapping them in
`arguments` fails with `"arguments" must be an object`. `meta` must contain only `name`,
`description` (plus optional `whenToUse`/`phases`).

The three embedded prompts mirror `references/review-agent.md`, `references/fix-agent.md`,
and `references/main-agent.md`.

The workflow is **property-based** and runs in a single pass — no re-review loop. The review
agent reads the business modules in scope, extracts the pre/post-conditions and invariants of
every conditional branch into a formal specification table, writes a property test per
invariant, and executes them with an iteration budget **> 10,000 runs**. Running PBT that many
times over every invariant is a statistically strong (near-formal) proof, so the outcome is
trusted without re-reviewing the fixed code: once a counterexample is found it is shrunk to its
minimal failing input and wrapped as a structured error report (file, line, input,
expected/actual), the fixer repairs each report and re-runs its counterexample green, and the
main agent aggregates every counterexample + fix into a final severity report.

```js
const { goal, context, task } = args;

const REVIEW_PROMPT = `You are the isolated REVIEW AGENT of a property-based adversarial review. You have no prior
conversation context — everything you need is in this prompt. Your job is to BREAK the
business logic by proving (or disproving) its invariants, not to approve it. The goal, task,
and context blocks are injected below.

## 1. Read every business module in scope
Read the business modules named by the task (the changed files, or the change's surface). Read
the repo conventions first (AGENTS.md / CLAUDE.md) so your tests match them. Inspect ONLY the
review scope.

## 2. Extract a formal specification table
For each business module, traverse EVERY conditional branch and extract a formal spec row:
- module — the file/path of the module.
- branch — the specific conditional branch (the condition expression, or a named path).
- precondition — what must hold before the branch runs.
- postcondition — what must hold after it runs.
- invariant — the property that must hold for ANY input (the claim a property test can pin).

Build a machine-readable specification table (an array of these rows). Each row's invariant is
what you will prove.

## 3. Discover the repo's test + property-testing stack
Do NOT assume a testing framework. Discover what the repo already uses and follow it exactly:
- Read the repo's test conventions (AGENTS.md / CLAUDE.md), the package manifest (package.json
  devDependencies + the 'test' script), and a few existing test files.
- Identify the property-based testing library the repo uses (fast-check, Vitest/Jest property
  forms, hypothesis, proptest, quickcheck, etc.) AND the convention for where tests live (test/,
  tests/, __tests__/, a colocated *.test.ts beside the source) and how they are named/run.
If the repo has NO property-based testing library, do NOT introduce one: pin the invariant with a
deterministic regression test (a concrete input and its expected/actual) in the repo's framework,
and drive many generated inputs with a small explicit loop over that same framework instead

## 4. Write a property-based test for every invariant
For each spec row, write a property test that pins the invariant against the REAL code, using the
repo's discovered stack and conventions:
- Put it in the repo's conventional test location (the directory + format the package's 'test'
  script actually picks up), using the repo's test framework and its property-testing library if
  present.
- Name it DESCRIPTIVELY after the invariant it pins (e.g. <module>-<behaviour>.<ext>), never
  after a finding id.
- Match the repo's conventions (imports, formatting, assertion style, module type) so it passes
  the repo's lint/format.
- If a property test for an invariant already exists (e.g. from an earlier round), do not
  duplicate it — re-run it.

## 5. Execute the tests > 10,000 runs
Run each property test with a high iteration budget (>= 10000 runs). Configure the run count with
the repo's library (e.g. fast-check numRuns, a random-seeded loop over the repo's test runner) —
if the library caps or defaults low, run several batches totalling > 10000. A genuinely correct
branch passes all runs; a violation surfaces as a counterexample.

## 6. Shrink and wrap every counterexample
On any counterexample, shrink it to its MINIMAL failing case (prefer the library's built-in
shrinker; otherwise reduce the input by hand to the smallest value that still fails). Wrap each
counterexample as a STRUCTURED ERROR REPORT:
- id — a stable id for the report.
- level — critical | medium | low (severity below).
- file — the source file with the defect.
- line — the exact line of the faulty branch.
- invariant — the property that was violated (from the spec table).
- input — the minimal counterexample input(s) that triggered it.
- expected — what the invariant / postcondition requires.
- actual — what the code produced.
- test — the path of the test that exposed it.

## Rules
- Confirm EVERY counterexample by running its test and seeing the violation (red). Never
  report a counterexample you did not reproduce; never write a test that fails for an unrelated
  reason just to have a report.
- Report ONLY counterexamples you confirmed. If the code holds for every invariant, return an
  empty reports list.
- You write ONLY the tests that expose/pin the counterexamples (formal regression coverage); you
  NEVER change source.
- If you touch security-sensitive logic (auth, injection, secrets, file/path handling), pin those
  invariants too — see references/security-checklist.md.

## Severity
- critical — wrong results / data loss / a security hole / a core invariant that never holds.
  Blocks delivery.
- medium — fails on an edge/error path or a non-core invariant. Concrete risk, no immediate breakage.
- low — a confirmed but non-blocking counterexample with no correctness impact (rare, since
  style/naming nit rows are not reported).

## Output
Return a JSON object { spec_table, reports }:
- spec_table — the array of formal-spec rows (module, branch, precondition, postcondition, invariant).
- reports — the array of structured error reports (id, level, file, line, invariant, input,
  expected, actual, test). Empty if the business logic holds.`;

const FIXER_PROMPT = `You are the isolated FIXER AGENT. You repair the confirmed counterexamples reported by the
review agent. You have no prior conversation context — everything you need is in this prompt.
The goal and the structured error reports are injected below.

## Method
For each error report:
1. Read the report (file, line, invariant, input, expected, actual) and the source at that location.
2. Diagnose the faulty conditional branch and make the MINIMAL source change so the reported
   invariant holds — the test the review agent wrote (report.test) must now PASS.
3. Re-run the exact counterexample / test and confirm it PASSES (green). Then re-run the
   relevant test suite + lint to confirm nothing else broke.

## Constraints
- Do NOT delete or rename the review agent's tests.
- Do NOT break already-implemented business logic — all other tests stay green.
- Do NOT refactor unrelated code or add abstractions / dependency injection unless a report
  specifically demands it.
- Leave changes UNCOMMITTED.

## Output
Return { status: "fixed" | "failed", fixes: [ { id, diff, result, explanation } ] }. For each
report id include: diff (the corrected code / unified diff), result (the re-run outcome of the
counterexample test), and a short explanation. status is "fixed" only if EVERY report's
counterexample now passes; otherwise "failed".`;

const MAIN_PROMPT = `You are the isolated MAIN AGENT. You aggregate every counterexample from the review phase and its
fix outcome, and produce the final report. You have no prior conversation context — everything
you need is in this prompt. The goal and the collected error reports + fixes are injected below.

## Aggregate
1. Collect all counterexample error reports and their fix outcomes
   (diff + result + explanation).
2. For each, state its severity (critical | medium | low — inherit the report's level; adjust only
   if warranted).
3. Explicitly list, per issue:
   - logic — WHICH business logic is wrong (file / branch / invariant).
   - why — the root cause: how the conditional branch violates the invariant, or which edge it
     mishandles.
   - impact — the ACTUAL user-visible impact.
   - fixed — whether the fixer resolved it (yes/no; reference the diff/result).
4. Verdict: "pass" if no critical/medium counterexample remains open (unfixed); "fail" if any
   critical/medium counterexample is still open.

## Output
Return { verdict: "pass" | "fail", summary, issues: [ { id, level, logic, why, impact, fixed, report } ] }.
If there are no counterexamples, return verdict "pass", a short summary, and an empty issues list.
If a counterexample is unfixed, carry its report and mark fixed: false.`;

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['spec_table', 'reports'],
  properties: {
    spec_table: {
      type: 'array',
      items: {
        type: 'object',
        required: ['module', 'branch', 'precondition', 'postcondition', 'invariant'],
        properties: {
          module: { type: 'string' },
          branch: { type: 'string' },
          precondition: { type: 'string' },
          postcondition: { type: 'string' },
          invariant: { type: 'string' },
        },
      },
    },
    reports: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'id',
          'level',
          'file',
          'line',
          'invariant',
          'input',
          'expected',
          'actual',
          'test',
        ],
        properties: {
          id: { type: 'string' },
          level: { type: 'string', enum: ['critical', 'medium', 'low'] },
          file: { type: 'string' },
          line: { type: 'number' },
          invariant: { type: 'string' },
          input: { type: 'string' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          test: { type: 'string' },
        },
      },
    },
  },
};

const FIXER_SCHEMA = {
  type: 'object',
  required: ['status', 'fixes'],
  properties: {
    status: { type: 'string', enum: ['fixed', 'failed'] },
    fixes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'diff', 'result', 'explanation'],
        properties: {
          id: { type: 'string' },
          diff: { type: 'string' },
          result: { type: 'string' },
          explanation: { type: 'string' },
        },
      },
    },
  },
};

const MAIN_SCHEMA = {
  type: 'object',
  required: ['verdict', 'summary', 'issues'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    summary: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'level', 'logic', 'why', 'impact', 'fixed', 'report'],
        properties: {
          id: { type: 'string' },
          level: { type: 'string', enum: ['critical', 'medium', 'low'] },
          logic: { type: 'string' },
          why: { type: 'string' },
          impact: { type: 'string' },
          fixed: { type: 'boolean' },
          report: { type: 'object' },
        },
      },
    },
  },
};

// The subagent reports to the workflow as JSON: each agent() call passes a schema and returns
// the validated JSON object. Only the subagent's input prompt is text.

function contextBlock() {
  return [
    '## Context',
    '### Requirements',
    context.requirements || '(none)',
    '### Design',
    context.design || '(none)',
    '### Acceptance',
    context.acceptance || '(none)',
  ].join('\n');
}

// Single pass: the PBT runs > 10,000 iterations per invariant, so the review outcome is a
// statistically strong proof — there is no re-review loop and no round cap. Review → fix →
// aggregate run in order; the fixer is skipped when the review found no counterexample.
phase('review');
const review = await agent(
  REVIEW_PROMPT + '\n\n## Goal\n' + goal + '\n\n## Task\n' + task + '\n\n' + contextBlock(),
  { label: 'review', schema: REVIEW_SCHEMA },
);
if (review === null) return { status: 'blocked', reason: 'review agent failed', reports: [] };

const reports = review.reports;
const clean = reports.length === 0;

// Stage 2 — fixer: repair each counterexample and re-run it green (only if any were found)
let fixes = [];
if (!clean) {
  phase('fix');
  const fix = await agent(
    FIXER_PROMPT +
      '\n\n## Goal\n' +
      goal +
      '\n\n## Error reports\n' +
      JSON.stringify(reports, null, 2),
    { label: 'fix', schema: FIXER_SCHEMA },
  );
  if (fix === null) return { status: 'blocked', reason: 'fix agent failed', reports };
  fixes = fix.fixes;
}

// Stage 3 — main: aggregate every counterexample + fix into the final severity report
phase('aggregate');
const main = await agent(
  MAIN_PROMPT +
    '\n\n## Goal\n' +
    goal +
    '\n\n## Error reports\n' +
    JSON.stringify(reports, null, 2) +
    '\n\n## Fixes\n' +
    JSON.stringify(fixes, null, 2),
  { label: 'main-report', schema: MAIN_SCHEMA },
);
if (main === null) return { status: 'blocked', reason: 'main agent failed', reports };

return {
  status: 'done',
  clean,
  verdict: main.verdict,
  report: main,
  reports,
  fixes,
};
```

## Reading the result

- `clean` — true when the review found no counterexample (the business logic held for every
  invariant); false when at least one counterexample was found.
- `verdict` — the main agent's verdict ("pass" | "fail"). `pass` means no critical/medium
  counterexample remains open; `fail` means at least one remains.
- `report` — the main agent's aggregate report: `{ verdict, summary, issues }`, where each issue
  lists the business logic that is wrong, why it is wrong, the user impact, and whether it was fixed.
- `reports` — every structured error report found (file, line, invariant, input, expected, actual, test).
- `fixes` — the fixer's per-report outcome (id, diff, result, explanation).
- `status: 'done'` — the single pass ran to completion (proof clean, or fixed to green).
- `status: 'blocked'` — a subagent failed.
