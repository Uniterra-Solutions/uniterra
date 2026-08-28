# Review Workflow Template

> **MIGRATED.** This historical script is superseded by the persisted
> `workflows/review.workflow.json` capsule. The skill now calls
> `run_workflow('review', { task })` — do NOT copy this JS block into a `workflow`
> tool call. Kept as a reference for the orchestration shape only.

## Historical orchestration (what the capsule does now)

One workflow: three-layer property-based review → fix, in a SINGLE pass:

1. `phase('review')` — one review agent is dispatched with ONLY the review scope
   (`args.task`; the orchestrator's goal/requirements/design/acceptance framing is
   deliberately NOT injected — anti-bias). It models and proves THREE verification layers by PBT
   (intra-module logic + lifecycle; module × counterpart interactions; system slices involving
   the module), writes all the property tests in one pass, runs them together in a background job
   with > 10,000 iterations, shrinks each counterexample and returns
   `{ spec_table, reports }`.
2. If any report: `phase('fix')` — one fixer agent repairs each counterexample, re-runs it green,
   and pins it with a purpose-named deterministic unit regression; reports
   `{ status, fixes }` straight back to the main agent (there is no main-agent step inside the
   workflow).
3. Return `{ status: 'done' | 'failed', clean, reports, fixes }`.

The two subagents report via dsh's built-in `structured_output` tool with the schemas in the
capsule — never a plain-text JSON string. The fixer's result is the aggregate evidence; the main
agent aggregates `reports` + `fixes` by severity per `references/main-agent.md` and never re-runs
the property tests.

## Where the prompt TEXT lives

The capsule's `REVIEW_PROMPT` / `FIXER_PROMPT` are **no longer duplicated here.** They are
composed by `packages/uniterra-skills/scripts/build-workflow-capsules.mjs` from the
responsibility-separated reference files:

- `references/review-agent.md` — the review agent's core operating manual (mission, anti-bias,
  three-layer spine, rules, severity, output).
- `references/model-construction.md` — how to build the module / counterpart / system-slice
  models.
- `references/invariant-taxonomy.md` — what to prove: every invariant kind per layer + data
  oracles + security.
- `references/test-patterns.md` — how to prove it: the PBT patterns, naming rules, background
  > 10k runs, shrink + structured reports.
- `references/security-checklist.md` — the mandatory security axis (inlined into the prompt at
  build time).
- `references/fix-agent.md` — the fixer prompt.
