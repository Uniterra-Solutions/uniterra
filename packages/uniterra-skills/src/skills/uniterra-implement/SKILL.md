---
name: uniterra-implement
description: >
  Company-standard implementation phase on DeepSeek Harness: PBT-first
  execution against an explicit requirements list. Establish the requirements
  and design (interactive clarification via ask_user_question when anything is
  unclear), scaffold each subagent task doc, then dispatch subagents through a
  workflow script — fully parallel when tasks are independent, batched (parallel
  within a batch, serial across batches) when they overlap — to turn the failing
  property tests green. LOAD when:
  - User asks to execute an approved plan (execute_plan / 執行計畫)
  - User asks to implement a planned or well-specified task/feature
  Do NOT use for planning (uniterra-plan) or reviewing changes (uniterra-review /
  uniterra-simplify).
---

# Uniterra Implement — PBT-first execution against an explicit requirements list

Pipeline position: after `uniterra-plan`, or standalone when the task is well-specified.
Every implementation starts from an explicit requirements list and the failing property
tests that encode the business logic as invariants — never write implementation code first.

> **Do NOT write a plan document.** The plan already exists: read the PRD + design doc
> from the plan's run directory (`uniterra-plan`) or take them from the user's request.
> Your job is to decompose the existing requirements into tasks, generate the task docs,
> and dispatch subagents — not to author a new plan.

## Workflow

### 1. Establish requirements and design

- Collect the requirements list and the design. From a plan: read the PRD and design
  doc in the run directory. Standalone: derive them from the user's request.
- **No design doc?** Build one interactively with the user via `ask_user_question` —
  architecture, data shapes, module boundaries, external dependencies.
- **Any requirement unclear?** Clarify with the user via `ask_user_question` before
  proceeding. Number requirements REQ-1, REQ-2, …; each must be unambiguous and verifiable.

### 2. Write failing tests, decompose into tasks

1. Write ALL failing property-based tests first in the main session — the red suite
   encoding every invariant from the requirements list. Every test traces to at least
   one requirement. These tests are the single acceptance target for the whole
   implementation: subagents strengthen and complete them (never rewrite them from
   scratch) and turn them green.
2. Decompose requirements + design into a **task list** (`assets/task-list-example.md`):
   one entry per task. Scaffold each task's brief with the init CLI (no hand-writing of
   boilerplate). Run it in the repo root (your cwd):

   ```
   node "<skill_base>/scripts/init_task.mjs" "<task-id>" "<task-name>"
   ```

   It creates `<cwd>/.dsh/<YYYYMMDD>/<task-name>/task.md` (the full brief the capsule inlines
   into the subagent prompt via `promptFile`) and maintains `.dsh/<YYYYMMDD>/tasks.json` (the
   `{ tasks: [...] }` argument for the workflow). It prints the `promptFile` path and the
   ready-to-use per-task JSON. Pass an optional third arg (a timestamp) to override the default
   date. (The skill base dir is the one listed in `skill_resources`.) Then fill in the brief's
   placeholders (goal, context files, requirements + their allocated tests, conventions,
   constraints) and dispatch — you do not need to hand-build the directory or the tasks array.

3. Choose the workflow shape by task overlap — you only pick the shape, never write JS:
   - Independent tasks → set `args.tasks` (flat array) — `references/parallel-workflow.md`.
   - Overlapping tasks → set `args.batches` (array of task arrays) — `references/batched-workflow.md`.
     The fixed orchestration lives in the persisted `implement` capsule (see the Files
     section); you only supply `args`.

### 3. Run the workflow by name

- Run it with the dsh_workflow `run_workflow` tool as **ONE call**:
  `run_workflow('implement', { tasks })` for independent tasks, or
  `run_workflow('implement', { batches })` for overlapping batches. No JS to copy — the
  orchestration is the persisted `implement` capsule. Each entry is `{ id, name, promptFile }`
  (a repo-relative path, NOT the brief text). The capsule inlines the task's `promptFile` brief
  into the subagent prompt (the subagent does NOT read it), then the subagent makes its
  requirements' failing tests green, returning a JSON report (changed files, satisfied
  requirements, deviations) as its structured output.
- `run_workflow` returns `{ status: 'done', agents }` on success (every task returned a
  valid JSON report); `{ status: 'failed', batch }` when a subagent failed. The subagent
  reports to the workflow as **JSON** (its structured output); only its input prompt is
  markdown.
- **Strengthen, don't rewrite.** Each subagent works against the failing tests written in
  step 2 (its requirement's allocated test). It FIRST prioritizes strengthening / completing
  those failing test cases — extend the property, add the missing edge cases and invariant
  asserts, so the failing PBT genuinely covers the requirement — THEN makes them green.
  Never start by writing a brand-new property test from scratch for the same requirement:
  the allocated test is the acceptance target, not a starting point (see the fixed rules
  embedded in the `implement` capsule).
- Afterwards run the FULL test suite in the main session: every failing PBT must be green
  before handoff. Red tests are the ONLY acceptable signal that work remains — fix inline
  or dispatch a follow-up agent, never declare done with red tests.

## Rules

- Do NOT commit changes; leave the working tree uncommitted so a later review reads the diff.
- Follow project conventions (`AGENTS.md`): lint / typecheck / build, tests for new behaviour.

## Files

- `workflows/implement.workflow.json` — the persisted `implement` capsule (dsh_workflow
  `format: dsh.workflow`). Its `source` is the fixed orchestration (both parallel and
  batched shapes); do NOT copy it — invoke it by name with `run_workflow('implement', args)`.
- `scripts/init_task.mjs` — the scaffolding CLI. Run it per task to generate the task doc
  under `.dsh/<YYYYMMDD>/<task-name>/` and maintain the run's `tasks.json` manifest.
- `assets/workflow-template.md` — **migrated.** Historical JS template + the ONE-call
  submission format. Superseded by the `implement` capsule; kept as a reference only, not
  to be copied into a `workflow` tool call.
- `assets/task-list-example.md` — the per-task contract (pre-rendered markdown `prompt`) + example.
- `references/parallel-workflow.md` — scenario guide: independent tasks → `run_workflow('implement', { tasks })`.
- `references/batched-workflow.md` — scenario guide: overlapping tasks → `run_workflow('implement', { batches })`.
