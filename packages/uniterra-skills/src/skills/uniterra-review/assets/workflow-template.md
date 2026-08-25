# Review Workflow Template

One workflow: review (formal-spec + property-based proof) → fix. Make **ONE** `workflow` tool call —
`meta`, `script`, and `args` are three properties of ONE arguments object, never three separate
calls, and never wrapped under a field named `arguments`:

```json
{
  "meta": {
    "name": "review",
    "description": "Property-based review: extract invariants, prove with PBT, fix"
  },
  "script": "<the JS below>",
  "args": {
    "task": "..."
  }
}
```

`meta` + `script` are required; `args` is optional. Splitting `meta`/`script`/`args` across
parallel calls fails with `missing required property "meta"` / `"script"`; wrapping them in
`arguments` fails with `"arguments" must be an object`. `meta` must contain only `name`,
`description` (plus optional `whenToUse`/`phases`).

`args.task` is the **review scope** — what to review (the changed business modules / the diff, plus
any focus). That is ALL the review agent receives. The main agent's own framing (a goal line,
requirements / design / acceptance interpretation) is deliberately NOT injected, because passing the
orchestrator's interpretation biases the review before it starts. The review agent reads the code
and traverses the business paths itself.

There is **no main agent inside the workflow** — the workflow orchestrates only two subagents:
the review agent and the fixer agent. The fixer reports directly back to the **main agent** (the
orchestrator that ran the `workflow` call), which then aggregates the results itself. The two
embedded prompts mirror `references/review-agent.md` and `references/fix-agent.md`; the main
agent's aggregation contract lives in `references/main-agent.md`.

The workflow is **property-based** and runs in a **single pass** — no re-review loop and no round
cap. The review agent is given the scope and reads the business modules, extracts the
pre/post-conditions and invariants of every conditional branch into a formal specification table,
writes a property test per invariant, and executes them with an iteration budget **> 10,000 runs**
(run in the background, and written all-then-run-all). Running PBT that many times over every
invariant is a statistically strong (near-formal) proof, so the outcome is trusted without
re-reviewing the fixed code: once a counterexample is found it is shrunk to its minimal failing
input and wrapped as a structured error report (file, line, input, expected/actual), the fixer
repairs each report and re-runs its counterexample green, and the main agent aggregates the reports

- fixes into a final severity report — **without ever re-running the property tests itself**.

```js
const { task } = args;

const REVIEW_PROMPT = `You are the isolated REVIEW AGENT of a property-based adversarial review. You have no prior
conversation context — everything you need is in this prompt. Your job is to BREAK the
business logic by proving (or disproving) its invariants, not to approve it. You are given ONLY
the review scope below.

Anti-bias rule — you are deliberately NOT given the orchestrator's goal, requirements, design, or
acceptance interpretation. Those are the MAIN AGENT's assumptions; trusting them biases your review
before it starts. Read the ACTUAL code and derive the invariants from it yourself. Never assume a
module is correct, intended, or safe because of any framing you were (not) handed — you judge the
code as it is.

## 1. Read every business module in scope
Read every business module named by the review scope (the changed files, or the change's surface).
Read the repo conventions first (AGENTS.md / CLAUDE.md) so your tests match them. Traverse EVERY
business path the change touches — entry points, each conditional branch, each edge/error path —
in ONE pass before writing any test; do not read one module, write its test, and run it before
moving on. Inspect ONLY the review scope.

## 2. Extract a formal specification table
For each business module, traverse EVERY conditional branch and extract a formal spec row:
- module — the file/path of the module.
- branch — the specific conditional branch (the condition expression, or a named path).
- precondition — what must hold before the branch runs.
- postcondition — what must hold after it runs.
- invariant — the property that must hold for ANY input (the claim a property test can pin).

Build a machine-readable specification table (an array of these rows). Each row's invariant is
what you will prove.

Derive **security invariants** too — this is a first-class axis, not an afterthought. Run through
references/security-checklist.md and, for EVERY item that applies to the code in scope, add a spec
row whose invariant is the security property (e.g. 'the resolved path always stays under the base
directory for any user-supplied input', 'get(id) denies resources the caller does not own', 'no
untrusted input reaches a query/command/path sink without escaping'). Each security invariant is
proven with its own PBT test, exactly like a business-logic invariant. For checklist items that are
not property-based (a hardcoded secret, a known-vulnerable dependency), check them deterministically
and report them as findings if present.

## 3. Discover the repo's test + property-testing stack
Do NOT assume a testing framework. Discover what the repo already uses and follow it exactly:
- Read the repo's test conventions (AGENTS.md / CLAUDE.md), the package manifest (package.json
  devDependencies + the 'test' script), and a few existing test files.
- Identify the property-based testing library the repo uses (fast-check, Vitest/Jest property
  forms, hypothesis, proptest, quickcheck, etc.) AND the convention for where tests live (test/,
  tests/, __tests__/, a colocated *.test.ts beside the source) and how they are named/run.
If the repo has NO property-based testing library, do NOT introduce one: pin the invariant with a
deterministic regression test (a concrete input and its expected/actual) in the repo's framework,
and drive many generated inputs with a small explicit loop over that same framework instead.

## 4. Write ALL the tests in one pass
For EVERY spec row, write the property test that pins the invariant against the REAL code, using
the repo's discovered stack and conventions. Write ALL of them first, in a single pass, before you
run any of them:
- Put each in the repo's conventional test location (the directory + format the package's 'test'
  script actually picks up), using the repo's test framework and its property-testing library if
  present.
- Name it DESCRIPTIVELY after the invariant it pins (e.g. <module>-<behaviour>.<ext>), never
  after a finding id.
- Match the repo's conventions (imports, formatting, assertion style, module type) so it passes
  the repo's lint/format.
- If a property test for an invariant already exists (e.g. from an earlier run), do not duplicate
  it — re-run it instead.

## 5. Run all the tests together, in the background
After EVERY test is written, run them ALL in ONE command so the batch executes once. Launch the
run as a BACKGROUND terminal job (a background shell / run_in_background) — a > 10,000-run PBT
takes a while, and holding the foreground until it finishes times out the turn. Configure the run
count with the repo's library (e.g. fast-check numRuns, a random-seeded loop over the repo's test
runner) — if the library caps or defaults low, run several batches totalling > 10000. A genuinely
correct branch passes all runs; a violation surfaces as a counterexample. Read the full output
once the background job settles, then act on the counterexamples.

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
- Read ALL the business logic first, write ALL the tests, then run them ALL at once — never write
  one test and run it before writing the next (that is far slower).
- Run the PBT in the background terminal; never block the foreground waiting for them to finish
  (that times out the turn). Collect the batch output once it settles.
- Confirm EVERY counterexample by running its test and seeing the violation (red). Never report a
  counterexample you did not reproduce; never write a test that fails for an unrelated reason just
  to have a report.
- Report ONLY counterexamples you confirmed. If the code holds for every invariant, return an
  empty reports list.
- You write ONLY the tests that expose/pin the counterexamples (formal regression coverage); you
  NEVER change source.
- Security is a mandatory axis, not optional: run every item of references/security-checklist.md
  against the code and prove each applicable security property with a PBT test (or a deterministic
  check for non-property items). A security hole is a critical counterexample — report it, don't
  wave it through.

## Severity
- critical — wrong results / data loss / a security hole / a core invariant that never holds.
  Blocks delivery.
- medium — fails on an edge/error path or a non-core invariant. Concrete risk, no immediate
  breakage.
- low — a confirmed but non-blocking counterexample with no correctness impact (rare, since
  style/naming nit rows are not reported).

## Output
Return a JSON object { spec_table, reports }:
- spec_table — the array of formal-spec rows (module, branch, precondition, postcondition,
  invariant).
- reports — the array of structured error reports (id, level, file, line, invariant, input,
  expected, actual, test). Empty if the business logic holds.`;

const FIXER_PROMPT = `You are the isolated FIXER AGENT. You repair the confirmed counterexamples reported by the
review agent, then report the results directly back to the MAIN AGENT (the orchestrator that
dispatched you). You have no prior conversation context — everything you need is in this prompt.
The structured error reports are injected below.

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
- Do NOT re-run the whole property suite again as the main agent would — you only re-confirm the
  counterexample you fixed (report.test) and the tests touched by your change.
- Leave changes UNCOMMITTED.

## Output
Return { status: "fixed" | "failed", fixes: [ { id, diff, result, explanation } ] }. For each
report id include: diff (the corrected code / unified diff), result (the re-run outcome of the
counterexample test), and a short explanation. status is "fixed" only if EVERY report's
counterexample now passes; otherwise "failed". Report this object straight to the main agent.`;

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

// The subagent reports to the workflow as JSON: each agent() call passes a schema and returns
// the validated JSON object. Only the subagent's input prompt is text.

// Single pass, no main-agent step inside the workflow: the PBT runs > 10,000 iterations per
// invariant, so the review outcome is a statistically strong proof. The fixer reports straight to
// the main agent, which aggregates the returned reports + fixes itself. The review agent is given
// ONLY the scope — the orchestrator's goal/context framing is deliberately not passed (anti-bias).
phase('review');
const review = await agent(REVIEW_PROMPT + '\n\n## Review scope\n' + task, {
  label: 'review',
  schema: REVIEW_SCHEMA,
});
if (review === null) return { status: 'blocked', reason: 'review agent failed' };

const reports = review.reports;
const clean = reports.length === 0;

// Fixer: repair each counterexample and re-run it green (only if any were found)
let fixes = [];
if (!clean) {
  phase('fix');
  const fix = await agent(
    FIXER_PROMPT + '\n\n## Error reports\n' + JSON.stringify(reports, null, 2),
    { label: 'fix', schema: FIXER_SCHEMA },
  );
  if (fix === null) return { status: 'blocked', reason: 'fix agent failed', reports };
  fixes = fix.fixes;
}

return { status: 'done', clean, reports, fixes };
```

## Reading the result

- `clean` — true when the review found no counterexample (the business logic held for every
  invariant); false when at least one counterexample was found.
- `reports` — every structured error report found (file, line, invariant, input, expected,
  actual, test) with its severity.
- `fixes` — the fixer's per-report outcome (id, diff, result, explanation), reported straight back
  to the main agent.
- `status: 'done'` — the single pass ran to completion (proof clean, or fixed to green).
- `status: 'blocked'` — a subagent failed.

The main agent (the orchestrator) aggregates `reports` + `fixes` into the final severity report
per `references/main-agent.md`, and **never re-runs the property tests** itself.
