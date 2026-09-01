---
name: uniterra-plan
description: >
  Company-standard planning phase on DeepSeek Harness (Jovaltus methodology).
  Turns raw requirements into reviewed planning artifacts: clarify the
  requirements and architecture interactively with the user, scaffold the plan
  run directory, write prd.md / design.md / acceptance.md, then dispatch three
  parallel review agents (requirement feasibility, design over-engineering,
  acceptance verifiability) in a SINGLE review pass. LOAD when:
  - User asks to plan a feature or task (prd / design / plan / 規劃 / 計畫)
  - User references Jovaltus planning or asks for an execution plan
  Use uniterra-implement to execute a plan and uniterra-review /
  uniterra-simplify to review or simplify changes.
---

# Uniterra Plan — turn requirements into reviewed planning artifacts

Pipeline position: **plan → implement → simplify/review**. This skill owns the
plan phase only: it produces `prd.md`, `design.md`, and `acceptance.md`, then
reviews them with three parallel agents (a SINGLE review pass) before handoff.

Artifacts live under a **run directory**: `<repo>/.plan/<YYYYMMDD>/<plan-name>/`,
holding `prd.md`, `design.md`, and `acceptance.md`.

## Steps

### 1. Understand requirements and design interactively

- Read the user's requirements.
- Clarify with the user via `ask_user_question` (options + Other), one at a time,
  to complete the requirements list AND the architecture design: what to build,
  module boundaries, data shapes, external dependencies.

### 2. Scaffold the run directory and fill the templates

- Scaffold with the init CLI (no hand-writing of boilerplate). Run it in the repo
  root (your cwd):

  ```
  node "<skill_base>/scripts/init_plan.mjs" "<plan-name>"
  ```

  It creates `.plan/<YYYYMMDD>/<plan-name>/` with `prd.md`, `design.md`, and
  `acceptance.md` templates and prints the run directory. Pass an optional
  second arg (a timestamp) to override the default date. (The skill base dir is
  the one listed in `skill_resources`.)

- Fill in the placeholders yourself in the main session (no authoring subagents):
  - `prd.md` — the Functional Requirements list (project-level requirements).
  - `design.md` — the architecture design (module boundaries, data shapes, the
    business-logic surface).
  - `acceptance.md` — the acceptance criteria: one entry per requirement, each
    naming an objective, verifiable piece of evidence (a test, a command output,
    an observable behavior).

### 3. Confirm the plan broadly matches the user's needs

Before the automated review, get a sanity check from the user so the plan actually
fits their needs:

- Read back the three documents with a short summary: what the plan builds, the key
  requirements, and how each is verified.
- Ask via `ask_user_question` (options + Other) whether the content is broadly correct
  and matches what they want. Keep it to a single confirming question, e.g. "Does this
  plan match your needs? / Are the requirements correct?"
- If they raise issues or select "needs changes", apply the edits to
  `prd.md` / `design.md` / `acceptance.md` yourself and show the result again. Only
  proceed to the automated review once the user confirms the content is broadly correct.

### 4. Review the documents with a SINGLE review pass

- Run the persisted `plan-review` workflow by name with the dsh_workflow `run_workflow` tool
  as **ONE call**: `run_workflow('plan-review', { prd_dir, design_dir, acceptance_dir })`
  (in practice all three are the run directory). No JS to copy — the orchestration is the
  `plan-review` capsule.
- It dispatches the three review agents ONCE, in parallel (no repair agent, no review
  loop). Each is fed all three dirs and returns a `verdict` + `issues` (structured JSON via
  its `outputSchema`):
  - **requirement-list-review** (`prompts/requirement-list-review.md`) — technical
    feasibility + contradictions between requirements.
  - **design-review** (`prompts/design-review.md`) — over-engineering, minimal
    complexity, minimal invasiveness, necessary vs unnecessary external libraries.
  - **acceptance-review** (`prompts/acceptance-review.md`) — clarity + an objective,
    verifiable piece of evidence per criterion.
- The result is `{ status: 'done', pass, passed, failures }` (or `{ status: 'failed' }`
  if a review agent died). `pass` is `true` only when every axis returned `verdict: 'pass'`.
- On a failing axis, apply its `issues` to the document yourself (the capsule does not
  repair). You may then re-run `run_workflow('plan-review', …)` once more — each run is a
  fresh, independent single review.

## Files

- `workflows/plan-review.workflow.json` — the persisted `plan-review` capsule (the
  dsh_workflow orchestration with the three review prompts embedded; `args` carries the
  three directory paths). Invoke it by name: `run_workflow('plan-review', args)`.
- `scripts/init_plan.mjs` — the scaffolding CLI. Run it to generate the run directory +
  the three templates, then fill them in.
- `scripts/review-workflow.md` — **migrated.** Historical fixed workflow script (embeds the
  three prompts + repair agent). Superseded by the `plan-review` capsule; kept as a
  reference only, not to be copied into a `workflow` tool call.
- `prompts/requirement-list-review.md` — requirement feasibility + contradiction agent.
- `prompts/design-review.md` — design over-engineering / minimal-invasiveness agent.
- `prompts/acceptance-review.md` — acceptance clarity + verifiable-evidence agent.
