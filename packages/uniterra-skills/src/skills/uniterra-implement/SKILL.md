---
name: uniterra-implement
description: >
  Company-standard implementation phase on DeepSeek Harness: PBT-first execution
  in which the acceptance criteria ARE the spec (test as spec). Read
  prd.md + acceptance.md, write the red suite in the main session (every
  acceptance line maps to at least one test, every test traces back to a
  requirement), freeze the cross-task seams that suite pins, scaffold each
  subagent task doc so it carries only its own requirements + acceptance +
  tests, then dispatch subagents through a workflow script — fully parallel when
  tasks are independent, batched (parallel within a batch, serial across
  batches) when they overlap — turn the failing tests green, reconcile the
  per-task reports against the requirements (coverage + every deviation
  adjudicated), and hand off only on a fully green suite. LOAD when:
  - User asks to execute an approved plan (execute_plan / 執行計畫)
  - User asks to implement a planned or well-specified task/feature
  Use uniterra-plan for planning and uniterra-review / uniterra-simplify for
  reviewing changes; this skill executes only approved plans.
---

# Uniterra Implement — test-as-spec execution against requirements + acceptance

Pipeline position: after `uniterra-plan`, or standalone when the task is well-specified.
Every implementation starts from the requirements list AND its acceptance criteria: the
acceptance lines become the failing tests that encode the business logic (test as spec),
written before the implementation code.

> **Leave the plan as it is.** The plan already exists: read `prd.md` + `acceptance.md`
> from the plan's run directory (`uniterra-plan`) or take them from the user's request.
> Your job is to turn the acceptance criteria into tests, decompose the work into tasks
> that each carry their own requirements + acceptance + tests, and dispatch subagents —
> author tests and tasks, not a new plan document.

## Workflow

### 1. Establish requirements and acceptance

- Collect the requirements list and the acceptance criteria. From a plan: read `prd.md`
  and `acceptance.md` in the run directory. Standalone: derive them from the user's
  request.
- **No plan?** Build the two documents with the user via `ask_user_question` — the
  requirements, the acceptance criteria, and the constraints that cannot be discovered
  from the repo (external-system behavior, compatibility commitments, organizational
  conventions, irreversible choices). The repo answers everything else: read it instead of
  asking, and never co-design the implementation with the user.
- **Any requirement unclear?** Clarify with the user via `ask_user_question` before
  proceeding. Number requirements REQ-1, REQ-2, …; each must be unambiguous and verifiable,
  and every acceptance line must name verifiable evidence.

### 2. Write the red suite (test as spec), freeze the seams, decompose into tasks

1. Write ALL failing property-based tests first in the main session — the red suite that
   encodes the whole specification. This is **test as spec**: every acceptance line maps to
   at least one test, and every test traces back to at least one requirement. An acceptance
   line with no test, or a test with no requirement behind it, is a spec gap — close it
   before dispatching. These tests are the single acceptance target for the whole
   implementation: subagents strengthen and complete them (extend, not replace) and turn
   them green.
2. **Freeze the seams.** List the data flow between the tasks you are about to create. Every
   cross-task seam — an interface, a serialized shape, an event one task emits and another
   consumes — must ALREADY be pinned by a test in the red suite, or be promoted to a
   requirement / acceptance line now. A seam no test pins is a seam that drifts silently.
   Two tasks that share a seam are dispatched either in the SAME batch (each mocking the
   seam) or in separate batches with the PROVIDER first.
3. Decompose requirements + acceptance into a **task list**
   (`assets/task-list-example.md`): one entry per task. Each task carries only its own slice
   of the spec — the requirements it satisfies, the acceptance lines that verify them, and
   the tests allocated to it (requirement + acceptance row + test per entry), so no subagent
   ever has to reconstruct the whole plan.
   Scaffold each task's brief with the init CLI (no hand-writing of
   boilerplate). Run it in the repo root (your cwd):

   ```
   node "<skill_base>/scripts/init_task.mjs" "<project-name>" "<task-id>" "<task-name>"
   ```

   It creates `<cwd>/.dsh/<YYYYMMDD-HHmmss>/<project-name>/<task-name>.md` (the full brief the
   capsule inlines into the subagent prompt via `promptFile`) and maintains the **per-project**
   `.dsh/<YYYYMMDD-HHmmss>/<project-name>/task.json` (the `{ tasks: [...] }` argument for the
   workflow — one manifest per project, so multiple projects sharing a timestamp never overwrite
   each other). It prints the `promptFile` path and the ready-to-use per-task JSON. Pass an
   optional fourth arg (a timestamp) to override the default. (The skill base dir is the one
   listed in `skill_resources`.) Then fill in the brief's placeholders (goal, context files,
   requirements + acceptance with their allocated tests, conventions, constraints) and dispatch —
   you do not need to hand-build the directory or the tasks array.

4. Choose the workflow shape by task overlap — you only pick the shape, never write JS:
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
- `run_workflow` returns `{ status: 'done', agents, reports }` on success (every task returned a
  valid JSON report; `reports` holds one entry per task in dispatch order) or
  `{ status: 'failed', batch, reports }` when a subagent failed (`batch` is the first failing
  batch, and `reports` carries the batches that completed before it plus the failing batch). The
  subagent reports to the workflow as **JSON** (its structured output); only its input prompt is
  markdown.
- **Strengthen, not replace.** Each subagent works against the failing tests written in
  step 2 (its requirement's allocated test). It FIRST prioritizes strengthening / completing
  those failing test cases — extend the property, add the missing edge cases and invariant
  asserts, so the failing PBT genuinely covers the requirement — THEN makes them green.
  Start from the allocated test as the acceptance target and extend it, rather than writing
  a brand-new property test from scratch for the same requirement (see the fixed rules
  embedded in the `implement` capsule).

### 4. Reconcile the reports against the requirements

The run is not finished when the agents return — it is finished when the plan is accounted
for. Do this in the main session, from the returned `reports`:

1. **Coverage check.** Every requirement in the plan must appear in some report's
   `satisfied_requirements`. A requirement no report claims is a gap: dispatch a follow-up
   task or correct the report — never hand off with an unaccounted requirement.
2. **Adjudicate every `deviations` line.** A deviation is one line and means exactly one of
   two things:
   - a **spec problem** — an allocated test turned out to be wrong or unsatisfiable. Bring it
     to the user, correct `acceptance.md` (the plan stays the single standard), and re-run.
     The allocated test is never weakened or deleted to make a run go green.
   - an **interface change** — a change to an interface another task's tests consume. Verify
     the affected tasks' tests are still consistent with the new interface before accepting it.
     Anything else recorded there is ignored: there is no separate design to deviate from.
3. **Green suite = the handoff gate.** Run the FULL test suite in the main session: every
   acceptance test, plus the project's lint / typecheck / build, must be green before
   handoff. Fix inline or dispatch a follow-up agent, and only then declare done.

## Rules

- Leave all changes uncommitted so a later review reads the working-tree diff.
- Follow project conventions (`AGENTS.md`): lint / typecheck / build, tests for new behaviour.

## Files

- `workflows/implement.workflow.json` — the persisted `implement` capsule (dsh_workflow
  `format: dsh.workflow`). Its `source` is the fixed orchestration (both parallel and
  batched shapes); do NOT copy it — invoke it by name with `run_workflow('implement', args)`.
- `scripts/init_task.mjs` — the scaffolding CLI. Run it per task to generate the task brief
  `.dsh/<YYYYMMDD-HHmmss>/<project-name>/<task-name>.md` and maintain the per-project
  `task.json` manifest (one per project, never a run-root manifest).
- `assets/workflow-template.md` — **migrated.** Historical JS template + the ONE-call
  submission format. Superseded by the `implement` capsule; kept as a reference only, not
  to be copied into a `workflow` tool call.
- `assets/task-list-example.md` — the per-task contract (pre-rendered markdown `prompt`) + example.
- `references/parallel-workflow.md` — scenario guide: independent tasks → `run_workflow('implement', { tasks })`.
- `references/batched-workflow.md` — scenario guide: overlapping tasks → `run_workflow('implement', { batches })`.
