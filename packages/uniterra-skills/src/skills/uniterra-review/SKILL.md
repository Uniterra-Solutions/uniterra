---
name: uniterra-review
description: >
  Company-standard property-based adversarial review on DeepSeek Harness. Usable
  whenever there is a review scope — no plan required. Assemble the goal + context
  (requirements, design, acceptance — from docs or your own input for simple
  tasks), then run a review workflow: a review agent reads the business modules,
  extracts the pre/post-conditions and invariants of every conditional branch into
  a formal specification table, writes all the property tests in one pass and
  executes them in the background with an iteration budget > 10,000 runs, then
  shrinks every counterexample to a structured error report (file, line, input,
  expected/actual). A fixer agent repairs each reported branch and re-runs the
  counterexample green, reporting straight back. You (the main agent) then
  aggregate every counterexample + fix by severity (critical / medium / low) and
  state which business logic is wrong, why, and the user impact — never re-running
  the tests yourself. LOAD when:
  - User asks to review changes, hunt for bugs, or run the review phase
    (review / 審查 / code review)
  - User asks to verify business logic is invariant-correct
  Do NOT use for simplification review (uniterra-simplify), planning
  (uniterra-plan), or implementing (uniterra-implement).
---

# Uniterra Review — property-based adversarial review

Pipeline position: after `uniterra-implement`, or standalone. The review is
driven by a goal + three context blocks (requirements, design, acceptance) and a
task that names the review scope — NOT by `execution-plan.json`.

## 1. Assemble goal and context

- **goal** — one line: what the change should achieve.
- **context.requirements** — the requirements list.
- **context.design** — the architecture/design.
- **context.acceptance** — the acceptance criteria list.
- **task** — what to review: the scope (default: uncommitted changes) + focus.

The three context blocks may come from the plan docs (`prd.md`, `design.md`,
`acceptance.md`) OR be written by you directly when no plan exists (simple
tasks). Any block may be empty — the review agent treats an empty block as "no
contract on that axis"; the property-based invariants carry the review.

## 2. Run the review workflow

Use `assets/workflow-template.md` with the `workflow` tool as **ONE call** whose `arguments`
is a single object with `meta` + `script` + `args` together (never split across parallel
calls, never wrapped in a field named `arguments`). `args = { goal, context, task }`. The
workflow orchestrates **two subagents** — there is no main-agent step inside it:

1. **review agent** (`references/review-agent.md`) — reads every business module in scope in ONE
   pass, discovers the repo's test + property-testing conventions (never assumes a framework),
   extracts the pre/post-conditions and invariants of each conditional branch into a formal
   specification table, writes ALL the property tests in one pass, then runs them together in a
   **background** terminal job with an iteration budget **> 10,000 runs**. Each counterexample is
   shrunk to its minimal failing input and wrapped as a structured error report (id, severity,
   file, line, invariant, input, expected/actual, test). Only confirmed counterexamples are
   reported. Returns `{ spec_table, reports }`.
2. **fixer agent** (`references/fix-agent.md`) — repairs each reported conditional branch so its
   property test passes, re-runs the counterexample to confirm green, and reports its diff /
   result / explanation **directly back to you (the main agent)**. It never deletes or weakens
   the property tests and leaves changes UNCOMMITTED.

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
- The fixer agent leaves changes UNCOMMITTED and never deletes or weakens the property tests.
- The main agent (you) never re-runs the property-based tests — the review agent ran them
  (> 10,000 runs each) and the fixer re-confirmed its fixes; trust that evidence and just aggregate.
- Counterexample reports must reference a concrete file + line + failure mode (the property the
  branch violated).

## Files

- `assets/workflow-template.md` — the review → fix workflow script (two subagents; the main agent
  aggregates the returned reports + fixes itself).
- `references/review-agent.md` — formal-spec extraction + property-based proof + shrink.
- `references/fix-agent.md` — the fixer prompt.
- `references/main-agent.md` — the main agent's (orchestrator) aggregation guide.
- `references/security-checklist.md` — optional focus checklist of common AI-agent
  code-security mistakes (pinned as security invariants when relevant).
