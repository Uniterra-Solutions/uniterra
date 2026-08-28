---
name: uniterra-review
description: >
  Company-standard property-based adversarial review on DeepSeek Harness. Usable
  whenever there is a review scope — no plan required. Assemble the review scope
  (what to review), then run a review workflow: a review agent is given ONLY that
  scope — no main-agent goal/requirements/design/acceptance framing, to avoid
  bias — models the WHOLE business logic + lifecycle (every operation, every
  state, happy paths included — not just the paths that look suspicious; hidden
  state / async events / internal composition included) as a formal
  specification table of state / transition / composition / lifecycle / data /
  security invariants, writes state-machine property tests that brute-force
  random operation sequences (plus input-generating properties) in one pass and
  executes them in the background with an iteration budget > 10,000 runs, then
  shrinks every counterexample to a structured error report (file, line, input
  or sequence, expected/actual). A fixer agent repairs each reported invariant and
  re-runs the counterexample green, reporting straight back. You (the main agent)
  then aggregate every counterexample + fix by severity (critical / medium / low)
  and state which business logic is wrong, why, and the user impact — never
  re-running the tests yourself. LOAD when:
  - User asks to review changes, hunt for bugs, or run the review phase
    (review / 審查 / code review)
  - User asks to verify business logic is invariant-correct
  Do NOT use for simplification review (uniterra-simplify), planning
  (uniterra-plan), or implementing (uniterra-implement).
---

# Uniterra Review — property-based adversarial review

Pipeline position: after `uniterra-implement`, or standalone. The review is
driven by the **review scope** (what changed / what to review) — NOT by
`execution-plan.json` and NOT by the main agent's requirements/design/acceptance
interpretation.

## 1. Assemble the review scope

Give the review agent ONLY the scope — deliberately, to avoid bias and to avoid duplicate reading:

- **Do NOT feed it your own understanding of the code.** Never write a summary, a "what this does",
  a believed bug, an expected contract, or your interpretation of the intent into the scope. That
  pollutes the review agent with YOUR reading and biases it before it looks at the code.
- **Do NOT read the code yourself to re-describe it.** The review agent reads the code itself;
  your pre-reading only duplicates that work and injects your conclusions. Let the review agent do
  the reading.
- Just name the scope: the changed business modules / the diff (+ any focus).

- **task** — what to review: the scope (default: the uncommitted changes / the diff), e.g.
  "review the changed modules in packages/uniterra-provider (the diff)".

The review agent reads those business modules itself, models the whole business logic + lifecycle
(not just likely-wrong paths), and derives the invariants — so it is not pre-biased by your framing.

## 2. Run the review workflow

Invoke the persisted `review` workflow by name with the dsh_workflow `run_workflow` tool as
**ONE call**: `run_workflow('review', { task })` (the scope). No JS to copy — the
orchestration is the `review` capsule. It orchestrates **two subagents** — there is no
main-agent step inside it:

1. **review agent** (`references/review-agent.md`) — given ONLY the scope (not the orchestrator's
   goal/requirements/design/acceptance, to avoid bias), it reads every business module in scope in
   ONE pass and models the WHOLE business logic + lifecycle — every public operation, every state,
   happy paths included, not just the paths that look suspicious — into a formal specification
   table (state / transition / lifecycle / data / security invariants), discovers the repo's test
   - property-testing conventions (never assumes a framework), AND derives security invariants from
     the security checklist (`references/security-checklist.md`) — security is verified via PBT too,
     not just correctness. It writes ALL the property tests in one pass — state-machine / model-based
     properties that brute-force random operation sequences (plus input-generating properties) — then
     runs them together in a **background** terminal job with an iteration budget **> 10,000 runs**.
     Each counterexample is shrunk to its minimal failing input or operation sequence and wrapped as
     a structured error report (id, severity, file, line, invariant, input, expected/actual, test).
     Only confirmed counterexamples are reported. Returns `{ spec_table, reports }`.
2. **fixer agent** (`references/fix-agent.md`) — repairs each reported operation so its
   property test passes, re-runs the counterexample to confirm green, and **adds a DETERMINISTIC
   unit regression test per counterexample** — one concrete minimal input (the report's `input`) +
   the exact outcome the invariant requires — so the bug is instantly reproducible with no RNG. It
   names each regression after the TEST PURPOSE (the guarantee the test enforces, never the finding
   id — so a maintainer sees at a glance what it tests), keeps it permanent, and never
   deletes or weakens the review agent's property tests or any regression test. It leaves changes
   UNCOMMITTED.

The workflow **returns** `{ status, clean, reports, fixes }`, and runs a **single pass** (no
re-review loop) because the PBT executes **> 10,000 runs per invariant**, which is a statistically
strong (near-formal) proof — the fixer only re-runs each counterexample to confirm it is green.

**Then YOU (the main agent) aggregate** (`references/main-agent.md`): after the workflow returns,
summarize the counterexamples + fixes by severity (**critical / medium / low**) and list which
business logic is wrong, why it is wrong, and the actual user impact, plus whether each was fixed.
You produce the final `{ verdict, summary, issues }` report yourself — you do NOT dispatch another
sub-agent to do it, and you **never re-run the property-based tests** (the review agent ran them

> 10,000 runs each and the fixer re-confirmed its fixes; re-running just wastes time).

The subagent **reports to the workflow as JSON** (validated by the `schema` each `agent(...)`
call passes); only the subagent **input prompts** are text.

## Severity levels

- **critical** — wrong results / data loss / a security hole / a core invariant that never
  holds. Blocks delivery.
- **medium** — fails on an edge/error path or a non-core invariant. Concrete risk, no immediate
  breakage.
- **low** — a confirmed but non-blocking counterexample with no correctness impact. Rare, since
  style/naming nit rows are not reported.

## Rules

- The review agent never modifies source (it only writes the property tests that expose and pin
  the counterexamples).
- The fixer agent leaves changes UNCOMMITTED and never deletes or weakens the property tests or
  the deterministic unit regression tests it adds for each counterexample.
- The main agent (you) never re-runs the property-based tests — the review agent ran them
  (> 10,000 runs each) and the fixer re-confirmed its fixes; trust that evidence and just aggregate.
- Counterexample reports must reference a concrete file + line + failure mode (the property the
  branch violated).

## Files

- `workflows/review.workflow.json` — the persisted `review` capsule (the dsh_workflow
  review → fix orchestration with the REVIEW_PROMPT / FIXER_PROMPT embedded; `args` is
  `{ task }`). Invoke it by name: `run_workflow('review', { task })`.
- `assets/workflow-template.md` — **migrated.** Historical review → fix workflow script. Same
  two-subagent orchestration; superseded by the `review` capsule, kept as a reference only,
  not to be copied into a `workflow` tool call.
- `references/review-agent.md` — whole-logic + lifecycle model extraction, state-machine PBT,
  shrink.
- `references/fix-agent.md` — the fixer prompt.
- `references/main-agent.md` — the main agent's (orchestrator) aggregation guide.
- `references/security-checklist.md` — optional focus checklist of common AI-agent
  code-security mistakes (pinned as security invariants when relevant).
