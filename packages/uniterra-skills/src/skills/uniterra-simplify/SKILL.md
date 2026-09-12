---
name: uniterra-simplify
description: >
  Company-standard simplification review on DeepSeek Harness. Usable whenever
  there is a review scope — no plan required. Assemble the goal + context
  (requirements, design, acceptance — from docs or your own input), then run a
  simplify workflow: a review agent finds simplification opportunities (each
  rated safe / risky), and a fix agent applies them while preserving behaviour.
  LOAD when:
  - User asks to simplify code, cut over-engineering, or reduce complexity
    (simplify / 簡化 / 精簡 / 重構減量)
  - User asks to run the simplify phase after implementation
  Use uniterra-review for adversarial correctness review, uniterra-plan for
  planning, and uniterra-implement for implementing.
---

# Uniterra Simplify — behaviour-preserving simplification

Pipeline position: after `uniterra-implement`, or standalone. The review is
driven by a goal + the context blocks (requirements and acceptance, which are
authoritative; an optional legacy design block) — NOT by `execution-plan.json`.

## 1. Assemble goal and context

- **goal** — one line: what the change should achieve.
- **context.requirements** — the requirements list (authoritative).
- **context.acceptance** — the acceptance criteria list (authoritative).
- **context.design** — **optional**, kept for compatibility. The plan no longer
  produces an architecture design, so pass this block only when an older plan (or
  another source) still carries one.

These may come from the plan docs (`prd.md`, `acceptance.md`) or be written by you
directly for simple tasks. Any block may be empty.

The `requirements` + `acceptance` blocks are AUTHORITATIVE: a simplification must
never contradict a requirement or an acceptance line. Machinery a requirement or an
acceptance line demands (a layer, an interface, a config flag, a guard, an error
path, a testability seam, an observability hook) is NOT over-engineering — keep it in
place. An engineering need counts only once the requirements or acceptance state it:
declare it there and it is justified by definition; do not infer one, and do not
delete machinery on the theory that it might be unnecessary.

A missing `design` block changes none of the above, and is NEVER a reason to delete
machinery a requirement or an acceptance line requires.

## 2. Run the simplify workflow

Invoke the persisted `simplify` workflow by name with the dsh_workflow `run_workflow` tool as
**ONE call**: `run_workflow('simplify', { goal, context, maxRounds? })`. No JS to copy — the
orchestration is the `simplify` capsule. `args = { goal, context }` (plus optional
`maxRounds`, default 8). Two stages:

1. **review agent** (`references/review-agent.md`) — finds simplification
   opportunities against the over-engineering checklist
   (`references/overengineering-checklist.md`); returns a verdict (`pass` |
   `fail`) plus recommendations, each rated `safe` or `risky`.
2. **fix agent** (`references/fix-agent.md`) — applies the recommendations while
   preserving behaviour exactly.

The workflow loops **review → fix → re-review** until a review round returns
`verdict: 'pass'` (no recommendations, or only trivial non-blocking ones), or the
round cap (`maxRounds`, default 8) is hit.

A `pass` verdict means the code is already simple enough — the reviewer judged
any remaining ideas trivial, so they are returned with the result but NOT
applied. `fail` means at least one recommendation has real value and goes to the
fix agent.

The subagent **reports to the workflow as JSON** (validated by the `schema` each
`agent(...)` call passes); only the subagent **input prompts** are text.

Recommendations a fix round cannot apply (the `skipped` list) are carried into the
next review round and **accumulate** — the reviewer always sees the full skip
history (id + reason + round) and re-raises an item only when its reason no longer
applies. Skipped items are never dropped and are returned with the result.

## Safety levels

- **safe** — the simplification provably preserves behaviour (dead code, identical
  duplication, a redundant abstraction).
- **risky** — the simplification may alter behaviour; needs tests or judgment.

## Rules

- Review agents are READ-ONLY.
- Fix agents leave changes UNCOMMITTED and preserve behaviour exactly.
- A `risky` recommendation is pinned by equivalence tests BEFORE it is applied —
  written against the current code, run green, then applied and re-confirmed; it
  is applied only after that gate, and skipped only with a genuine reason.
- The `requirements` + `acceptance` blocks are authoritative: a simplification
  that contradicts a requirement or an acceptance line is omitted. Required
  machinery and the engineering needs those two documents state are not
  simplification opportunities; the checklist applies only where they are silent.
  When an optional `design` block is present it is honoured alongside them, and
  when no context is supplied at all the goal is the binding constraint.

## Files

- `workflows/simplify.workflow.json` — the persisted `simplify` capsule (the dsh_workflow
  review → fix loop with the REVIEW_PROMPT / FIX_PROMPT embedded; `args` is
  `{ goal, context, maxRounds? }`). Invoke it by name: `run_workflow('simplify', args)`.
- `assets/workflow-template.md` — **migrated.** Historical review → fix workflow script. Same
  loop; superseded by the `simplify` capsule, kept as a reference only, not to be copied into
  a `workflow` tool call.
- `references/review-agent.md`, `references/fix-agent.md` — the two agent prompts.
- `references/overengineering-checklist.md` — the focus checklist of common
  AI-agent over-engineering mistakes.
