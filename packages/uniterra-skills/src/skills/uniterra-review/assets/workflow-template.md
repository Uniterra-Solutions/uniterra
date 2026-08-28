# Review Workflow Template

> **MIGRATED.** This historical script is superseded by the persisted
> `workflows/review.workflow.json` capsule. The skill now calls
> `run_workflow('review', { task })` — do NOT copy this JS block into a `workflow`
> tool call. It is retained only as a reference for the REVIEW_PROMPT /
> FIXER_PROMPT text the capsule now owns.

One workflow: review (whole-logic model + state-machine property-based proof) → fix. Make **ONE** `workflow` tool call —
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
and models the whole business logic + lifecycle itself.

There is **no main agent inside the workflow** — the workflow orchestrates only two subagents:
the review agent and the fixer agent. The fixer reports directly back to the **main agent** (the
orchestrator that ran the `workflow` call), which then aggregates the results itself. The two
embedded prompts mirror `references/review-agent.md` and `references/fix-agent.md`; the main
agent's aggregation contract lives in `references/main-agent.md`.

The workflow is **model-based + property-based** and runs in a **single pass** — no re-review loop
and no round cap. The review agent is given the scope and models the WHOLE business logic +
lifecycle of the modules in scope — every operation, every state, every sequence — as a formal
specification table, writes a property test per invariant (state-machine / model-based properties
that generate random operation sequences, plus pure input–output properties), and executes them
with an iteration budget **> 10,000 runs** (run in the background, and written all-then-run-all).
Running PBT that many times over every invariant is a statistically strong (near-formal) proof, so
the outcome is trusted without re-reviewing the fixed code: once a counterexample is found it is
shrunk to its minimal failing input (or operation sequence) and wrapped as a structured error
report (file, line, input, expected/actual), the fixer repairs each report and re-runs its
counterexample green, and the main agent aggregates the reports

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

## 1. Model the WHOLE business logic + lifecycle — never just suspicious paths
Read every business module named by the review scope (the changed files, or the change's surface).
Read the repo conventions first (AGENTS.md / CLAUDE.md) so your tests match them.

Your job is NOT to pick the paths that LOOK wrong and test those. Human reasoning cannot anticipate
every interaction, and a review that only tests the branches a reviewer suspects is a biased review.
The machine's brute-force search is what finds the bugs your thinking cannot imagine — so MODEL the
module COMPLETELY, every operation and every lifecycle phase, happy paths included:

- Enumerate EVERY public operation — every exported function / handler / API / event callback —
  plus all the private state they share (fields, resources, cursors, timers, concurrency,
  persistence).
- Map the LIFECYCLE: initial state → operations that may run in any order / any combination (incl.
  interleavings and repeats) → intermediate states → normal termination → teardown → restart. Track
  state that accumulates across calls, resources acquired and released, retry/race/re-entrancy
  windows, and every path back to a clean state.
- Hunt for HIDDEN state and interactions — a lifecycle that is not obvious is exactly where the
  bugs live: implicit / derived state (fields, caches, lazy initialization, closures, monotonic
  counters, memory of previous calls, accumulated effects — anything operations read or write
  besides their arguments); asynchronous / event boundaries (callbacks, timers, promises,
  pending-request tables, subscription order — the lifecycle is event-driven, not call-driven, so
  the model includes event sequences and their interleavings); and INTERNAL COMPOSITION (the
  module's own operations call private helpers in some order — model each internal step and derive
  composition invariants: one step's postcondition must satisfy the next step's precondition on
  EVERY path that reaches it).
- A STATELESS module (pure input→output, no carried state, no events) has no lifecycle to model:
  its model is only the DATA invariants of its operations — do NOT invent a fake lifecycle.
- The METHOD is one for every software type; only the model's vocabulary changes (operations +
  lifecycle per type):
  - Backend / library / service: operations = the module's exports (handlers, APIs, events);
    lifecycle = init → use → teardown, concurrency, resource handling.
  - Desktop / web UI: operations = user actions + component lifecycle + events; the model is the
    UI state machine (mount/update/unmount, double-clicks, in-flight request races). Geometry and
    pixels are NOT review's job — that is QA; review pins the state/event logic only.
  - CLI / installer / script: operations = commands and their steps; lifecycle = parse → plan →
    execute → rollback/cleanup; exit codes and filesystem effects are postconditions.
  - Data / config / schema (configs, manifests, wire formats): invariants = shape validity, no
    silent field loss, idempotent re-apply, write→read round-trip.
  - Infra / CI workflows: operations = jobs/steps/triggers; invariants = determinism, ordering,
    env/secret hygiene.
  - OUT OF SCOPE for the review agent (state it where it applies; do not fake it): measured
    timing/performance and liveness ('eventually …') are NOT review's job — they need
    maintainer-defined targets and are verified by the acceptance / perf suites, statistically
    (e.g. a percentage-of-paths-above-target pass criterion), not by this review. Real scheduler
    interleavings and anything only visible in a pixel are also QA's domain. What IS review's job
    here: deterministic complexity/risk smells (obvious O(n²) / N+1 queries / unbounded memory
    growth / busy-wait loops over the whole path) — reason about them from the code and report
    them without benchmarking.
- Read everything in ONE pass before writing any test — never read one module, test it, and move
  on. Inspect ONLY the review scope, but INSIDE it model everything, not just error branches.

## 2. Build a system model + formal specification table
Turn that model into a machine-readable specification table (an array of rows). Each row is a claim
the code must satisfy for ANY input and ANY operation sequence — a model of the whole behaviour,
not a list of conditional branches:

- module — the file/path of the module.
- state — the lifecycle state / phase the row applies to (initial, steady-state, terminating,
  restart, …), or 'any'.
- operation — the operation / transition the row pins ('any' when the invariant must hold in EVERY
  state, unconditionally).
- precondition — what must hold before it runs.
- postcondition — what must hold after it runs.
- invariant — the property that must hold for ANY input (the claim a property test can pin).

Model each invariant KIND explicitly — a complete coverage of the module means all of these are
present where they apply:

- STATE invariants — properties that hold in EVERY reachable state after ANY sequence of operations
  (e.g. 'account balances never go negative', 'cursors stay within bounds', 'every acquired
  resource is allocated before use and released exactly once after').
- TRANSITION invariants — every operation's pre→post contract ('precondition ⇒ postcondition for
  any input'), pinned as a property over operation + input.
- COMPOSITION invariants — the module's INTERNAL interactions: any internal step / private helper
  that an operation calls has a precondition that the caller's postcondition is guaranteed to
  satisfy, so the composition is consistent on EVERY path that reaches it ('the output state of
  each step is a legal input state for the next step').
- LIFECYCLE invariants — properties over WHOLE sequences: any interleaving of operations still
  holds the state invariants; a complete lifecycle (init → operations → teardown) ends clean
  (nothing leaked, no dangling state); restart / replaying a sequence is idempotent or
  re-entrancy-correct.
- DATA invariants — pure input→output properties of value functions. Scale the oracle effort to
  BUSINESS MEANING: a trivial pure helper ('isEven', 'pad') needs only the cheap purity/structure
  checks below; a pure function that IS the business rule (a response translator, a mapping, a
  money/time/score computation) needs the strongest oracle — a wrong business-rule function that
  passes all its tests is the worst review outcome, and it is exactly what this review is for.
  Where to get the STANDARD that can make an implementation fail (the oracle), strongest first:
  - INVERSE / round-trip: the function pairs with an inverse or re-encoding that must recover the
    input ('encode→decode = identity', 'parse→serialize = fixpoint', canonical-form round-trips).
  - REFERENCE implementation: write the naive / obviously-correct version of the same intent (a
    simple sort as the oracle for a faster one, the direct formula for a memoized one) and require
    agreement on arbitrary inputs — differential testing. This is the strongest oracle when no
    inverse or law exists.
  - ALGEBRAIC laws: associativity, commutativity, idempotency, absorption, monoid laws,
    canonicity ('every input in the same equivalence class maps to the same output'),
    fixpoint ('format(format(x)) === format(x)').
  - RELATIONALLY COMPLETE contracts: pin the whole input→output relation without naming the
    implementation — 'sort' = output is sorted AND a permutation of the input; 'dedupe' =
    preserves order AND has no duplicates AND the same set; 'chunk' = preserves order AND total
    content is unchanged AND every chunk fits the limit.
  - PURITY / structure laws: same input → same output (determinism); arguments are NOT mutated
    (deep-freeze the inputs or snapshot-compare before/after); output depends only on the
    arguments (no hidden read of mutable module state); output structure conforms to the domain
    (result ⊆ domain, keys preserved, ranges respected).
- SECURITY invariants — first-class, not an afterthought. Run through
  references/security-checklist.md and, for EVERY item that applies to the code in scope, add a
  spec row whose invariant is the security property (e.g. 'the resolved path always stays under the
  base directory for any user-supplied input', 'get(id) denies resources the caller does not own',
  'no untrusted input reaches a query/command/path sink without escaping'). Each security invariant
  is proven with its own PBT test, exactly like a business-logic invariant. For checklist items that
  are not property-based (a hardcoded secret, a known-vulnerable dependency), check them
  deterministically and report them as findings if present.

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
- SEQUENCE / model-based properties for lifecycle rows: generate RANDOM SEQUENCES of operations and
  assert the invariant after EVERY step — the library's command-based model if the repo has one
  (fast-check fc.commands + fc.modelRun, hypothesis stateful, proptest state machines), otherwise
  an explicit loop that runs a generated sequence against the REAL code and checks the invariants
  after each step, at the end of the lifecycle, and after teardown/restart. The generator must be
  able to reach every state (initial ops, repeats, interleavings, teardown, restart) — the
  machine, not your intuition, decides which sequences to try.
- INPUT-generating properties for data rows: generate arbitrary inputs from the function's ACTUAL
  consumer domain — read its callers and their preconditions and generate THAT domain (not just
  arbitrary junk), including empties, duplicates, extremes, negative/zero, NaN/Infinity,
  unicode/multibyte, very-long and deeply-nested inputs, and type-boundary values; assert the
  data invariant on every generated case.
- Put each in the repo's conventional test location (the directory + format the package's 'test'
  script actually picks up), using the repo's test framework and its property-testing library if
  present.
- Name it AFTER THE TEST PURPOSE, not the mechanism, a finding id, or a placeholder. The name IS
  the guarantee the test enforces: reading ONLY the name (never opening the file), a maintainer
  must be able to say what the code must always do. Use the repo's own naming convention — a
  kebab/snake-case file name <module>-<behaviour> (e.g. 'dedupe-preserves-order',
  'resolve-always-under-base-dir', 'split-keeps-total-count', 'auth-denies-foreign-resource') or a
  BDD 'should <behaviour>' / 'it(<behaviour>)' title. Never invent a parallel style.
  - FORBID names that hide the purpose: a finding id ('REVIEW-3', 'fix-2'), a number or generic
    placeholder ('test1', 'test_bug', 'should_work', 'my_test'), a where-only label
    ('review-property-test'), or an implementation hint ('fast-check-1'). Rewrite any of these.
  - At-a-glance gate: before running, every test name must let a maintainer state, from the name
    alone, the one property the test must enforce. If it does not, rename it.
  - The SAME invariant keeps the SAME name across its property test AND its later minimal-input
    regression (added by the fixer), so the general property and its concrete failing case read as
    one matched pair to a maintainer.
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
shrinker; otherwise reduce the input — or, for a sequence property, the OPERATION SEQUENCE — by
hand to the smallest value that still fails). Wrap each counterexample as a STRUCTURED ERROR
REPORT:
- id — a stable id for the report.
- level — critical | medium | low (severity below).
- file — the source file with the defect.
- line — the exact line of the faulty branch.
- invariant — the property that was violated (from the spec table).
- input — the minimal counterexample input(s) or operation sequence that triggered it.
- expected — what the invariant / postcondition requires.
- actual — what the code produced.
- test — the path of the test that exposed it.

## Rules
- Read ALL the business logic first, write ALL the tests, then run them ALL at once — never write
  one test and run it before writing the next (that is far slower).
- Cover EVERYTHING, not just the paths you suspect. A review that only tests the branches you
  believe are buggy is a biased review — the model must be complete (every operation, every
  lifecycle phase, happy paths included), because the machine's brute-force search finds the bugs
  your reasoning cannot imagine. Leaving an operation or lifecycle phase out of the model is an
  incomplete review.
- Invariants must be IMPLEMENTATION-INDEPENDENT: state what must ALWAYS hold — a data law, a
  resource law, a security law — as a claim a maintainer could write before reading the code;
  never a restatement of the code's own branches ('the function returns X when condition Y' is the
  implementation's description, and pinning it proves nothing).
- Every property must be DISCRIMINATIVE: if a deliberately wrong or trivially naive implementation
  could still satisfy the property (e.g. 'result.length === input.length' for a broken mapping),
  it is too weak — sharpen it with an inverse, a reference oracle, or a relationally complete
  contract until a wrong implementation necessarily fails. A property that passes regardless of
  correctness proves nothing.
- If some state or path resists a coherent model, do NOT silently omit it: record the attempt in
  the spec table as a row whose operation is '(unmodeled: <what + why>)', pin everything you CAN
  state, and never claim a module is fully covered when the model has holes.
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
- spec_table — the array of formal-spec rows (module, state, operation, precondition,
  postcondition, invariant).
- reports — the array of structured error reports (id, level, file, line, invariant, input,
  expected, actual, test). Empty if the business logic holds.

Report it with the `structured_output` tool exactly once. Do NOT finish with a plain-text JSON
string or a markdown code block — only the `structured_output` call counts as your result.`;

const FIXER_PROMPT = `You are the isolated FIXER AGENT. You repair the confirmed counterexamples reported by the
review agent, then report the results directly back to the MAIN AGENT (the orchestrator that
dispatched you). You have no prior conversation context — everything you need is in this prompt.
The structured error reports are injected below.

## Method
For each error report:
1. Read the report (file, line, invariant, input, expected, actual) and the source at that location.
2. Diagnose the faulty operation / transition at that location (the report's 'input' may be an
   operation sequence rather than a single value) and make the MINIMAL source change so the
   reported invariant holds — the test the review agent wrote (report.test) must now PASS.
3. Re-run the exact counterexample / test and confirm it PASSES (green). Then re-run the
   relevant test suite + lint to confirm nothing else broke.
4. Add a DETERMINISTIC unit regression test for EVERY counterexample you fix — the review agent's
   property test proves the invariant statistically over many generated inputs, but a single-input
   unit regression makes the bug instantly reproducible with no RNG. For each report: write ONE
   test using the report's concrete minimal input (a value, or the minimal failing operation
   sequence to replay) and the exact outcome the invariant requires
   (report.expected), name it after the TEST PURPOSE — the guarantee the test enforces — never a
   finding id, a placeholder, or a where-only label. Match the repo's naming convention and REUSE
   the same purpose-named title the review agent gave that invariant's property test, so the general
   property and its minimal-input regression read as ONE pair to a maintainer (e.g.
   'dedupe-preserves-order', 'resolve-always-under-base-dir'). Reading only the name must tell a
   maintainer what the test guarantees. Place it in the repo's conventional test location in its
   test framework, and keep it PERMANENT. If a
   deterministic regression test for the same invariant already exists, do NOT duplicate it —
   strengthen / re-run it, never delete or rename it. Confirm it is RED against the pre-fix code
   and GREEN after the fix, and record it in the fix's result.

## Constraints
- Do NOT delete or rename the review agent's property tests OR any deterministic regression test
  that pins a counterexample — they are permanent.
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
counterexample now passes; otherwise "failed". Report it with the `structured_output` tool
exactly once — do NOT finish with a plain-text JSON string or a markdown code block; only the
`structured_output` call counts as your result.`;

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['spec_table', 'reports'],
  properties: {
    spec_table: {
      type: 'array',
      items: {
        type: 'object',
        required: ['module', 'state', 'operation', 'precondition', 'postcondition', 'invariant'],
        properties: {
          module: { type: 'string' },
          state: { type: 'string' },
          operation: { type: 'string' },
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
