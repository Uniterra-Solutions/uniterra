# Review knowledge — test patterns + execution

How to turn the spec table into property tests, run them, and wrap the counterexamples. Phases
3–6 of the operating loop. **Everything is PBT** — every invariant, in every layer, is proven by a
property-based test; nothing is verified by hand.

## Pattern → layer map

| Pattern                              | Proves                                                                                                                               | Layer                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| SEQUENCE / model-based               | state / transition / composition / lifecycle invariants                                                                              | Layer 1 (intra-module) |
| ENVIRONMENT-MOCK (fault injection)   | interaction-contract invariants (mock the counterpart to its contract) + integration end-to-end invariants (mock the external world) | Layer 2 + Layer 3      |
| INPUT-generating                     | data (pure-function) invariants                                                                                                      | Any layer's data rows  |
| Deterministic regression (base-case) | the same invariant for one concrete minimal input — added by the FIXER, not a substitute for the property                            | —                      |

## Discover the repo's stack first — never assume a framework

- Read the repo's test conventions (AGENTS.md / CLAUDE.md), the package manifest (package.json
  devDependencies + the `test` script), and a few existing test files.
- Identify the property-based testing library the repo uses (fast-check, Vitest/Jest property
  forms, hypothesis, proptest, quickcheck, etc.) AND the convention for where tests live (`test/`,
  `tests/`, `__tests__/`, a colocated `*.test.ts` beside the source) and how they are named/run.
- If the repo has NO property-based testing library, do NOT introduce one: pin the invariant with
  a deterministic regression test (a concrete input and its expected/actual) in the repo's
  framework, and drive many generated inputs with a small explicit loop over that same framework
  instead — that explicit loop IS your PBT; the deterministic case is only its base case.

## Write ALL the tests in one pass

For EVERY spec row, write the property test that pins the invariant against the REAL code, using
the repo's discovered stack and conventions. Write ALL of them first, in a single pass, before you
run any of them.

### SEQUENCE / model-based properties (layer 1: lifecycle rows)

Generate RANDOM SEQUENCES of operations and assert the invariant after EVERY step — the library's
command-based model if the repo has one (fast-check `fc.commands` + `fc.modelRun`, hypothesis
stateful, proptest state machines), otherwise an explicit loop that runs a generated sequence
against the REAL code and checks the invariants after each step, at the end of the lifecycle, and
after teardown/restart. The generator must be able to reach every state (initial ops, repeats,
interleavings, teardown, restart) — the machine, not your intuition, decides which sequences to
try.

### ENVIRONMENT-MOCK (fault-injection integration) properties (layers 2 + 3)

The module talks to counterparts / an external world — NEVER call the real world from the test.
Fake it through the injection seam:

- **Layer 2** — mock the counterpart TO ITS CONTRACT (an in-memory implementation of what the
  counterpart promises: its accepted shapes, its events, its error semantics), then GENERATE
  counterpart states + response interleavings (happy, empty, malformed, timeout, slow, error/5xx,
  out-of-order, duplicated) and assert the interaction-contract invariants after every step.
- **Layer 3** — mock the EXTERNAL WORLD (adapter interface / DI / env + argv / tmpdir for the
  filesystem / in-memory fetch / captured subprocess / injected clock / recorded event replay),
  then run the composed slice with injected external states + failures (permission-denied, partial
  write, missing dependency, env unset, clock skew, restart underneath) and assert the
  integration end-to-end invariants at each failure point and at the slice's end.

This is verification by substitution: error propagation, leak-on-failure, retry semantics,
rehydration after restart, garbage-in survival, and the emitted contract — all without real
infrastructure. No injection seam? Exercise the smallest integration slice that lets you
substitute the counterpart or the external world; the mock IS the environment model.

### INPUT-generating properties (data rows)

Generate arbitrary inputs from the function's ACTUAL consumer domain — read its callers and their
preconditions and generate THAT domain (not just arbitrary junk), including empties, duplicates,
extremes, negative/zero, NaN/Infinity, unicode/multibyte, very-long and deeply-nested inputs, and
type-boundary values; assert the data invariant on every generated case.

### Placement, naming, conventions

- Put each test in the repo's conventional test location (the directory + format the package's
  `test` script actually picks up), using the repo's test framework and its property-testing
  library if present.
- Name it AFTER THE TEST PURPOSE, not the mechanism, a finding id, or a placeholder. The name IS
  the guarantee the test enforces: reading ONLY the name (never opening the file), a maintainer
  must be able to say what the code must always do. Use the repo's own naming convention — a
  kebab/snake-case file name `<module>-<behaviour>` (e.g. `dedupe-preserves-order`,
  `resolve-always-under-base-dir`, `split-keeps-total-count`, `auth-denies-foreign-resource`) or a
  BDD `should <behaviour>` / `it('<behaviour>')` title. Never invent a parallel style.
  - FORBID names that hide the purpose: a finding id (`REVIEW-3`, `fix-2`), a number or generic
    placeholder (`test1`, `test_bug`, `should_work`, `my_test`), a where-only label
    (`review-property-test`), or an implementation hint (`fast-check-1`). Rewrite any of these.
  - At-a-glance gate: before running, every test name must let a maintainer state, from the name
    alone, the one property the test must enforce. If it does not, rename it.
  - The SAME invariant keeps the SAME name across its property test AND its later minimal-input
    regression (added by the fixer), so the general property and its concrete failing case read as
    one matched pair to a maintainer.
- Match the repo's conventions (imports, formatting, assertion style, module type) so it passes
  the repo's lint/format.
- If a property test for an invariant already exists (e.g. from an earlier run), do not duplicate
  it — re-run it instead.

## Run all the tests together, in the background

After EVERY test is written, run them ALL in ONE command so the batch executes once. Launch the
run as a BACKGROUND terminal job (a background shell / `run_in_background`) — a > 10,000-run PBT
takes a while, and holding the foreground until it finishes times out the turn. Configure the run
count with the repo's library (e.g. fast-check `numRuns`, a random-seeded loop over the repo's
test runner) — if the library caps or defaults low, run several batches totalling > 10000. A
genuinely correct invariant passes all runs; a violation surfaces as a counterexample. Read the
full output once the background job settles, then act on the counterexamples.

## Shrink and wrap every counterexample

On any counterexample, shrink it to its MINIMAL failing case (prefer the library's built-in
shrinker; otherwise reduce the input — or, for a sequence/environment property, the OPERATION +
EXTERNAL-RESPONSE SEQUENCE — by hand to the smallest value that still fails). Wrap each
counterexample as a STRUCTURED ERROR REPORT:

- **id** — a stable id for the report.
- **level** — `critical` | `medium` | `low` (severity in the operating manual).
- **file** — the source file with the defect.
- **line** — the exact line of the faulty branch.
- **invariant** — the property that was violated (from the spec table); name its layer.
- **input** — the minimal counterexample input(s) or operation sequence that triggered it.
- **expected** — what the invariant / postcondition requires.
- **actual** — what the code produced.
- **test** — the path of the test that exposed it.
