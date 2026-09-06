---
name: uniterra-plan
description: >
  Company-standard planning phase on DeepSeek Harness (Jovaltus methodology).
  Turns raw requirements into planning artifacts: clarify the requirements and
  architecture interactively with the user, scaffold the plan run directory,
  write prd.md / design.md / acceptance.md, and confirm them with the user.
  LOAD when:
  - User asks to plan a feature or task (prd / design / plan / 規劃 / 計畫)
  - User references Jovaltus planning or asks for an execution plan
  Use uniterra-implement to execute a plan and uniterra-review /
  uniterra-simplify to review or simplify changes.
---

# Uniterra Plan — turn requirements into planning artifacts

Pipeline position: **plan → implement → simplify/review**. This skill owns the
plan phase only: it produces `prd.md`, `design.md`, and `acceptance.md` for
handoff.

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

### 3. Confirm the plan with the user

Get a sanity check from the user so the plan actually fits their needs:

- Read back the three documents with a short summary: what the plan builds, the key
  requirements, and how each is verified.
- Ask via `ask_user_question` (options + Other) whether the content is broadly correct
  and matches what they want. Keep it to a single confirming question, e.g. "Does this
  plan match your needs? / Are the requirements correct?"
- If they raise issues or select "needs changes", apply the edits to
  `prd.md` / `design.md` / `acceptance.md` yourself and show the result again.

## Files

- `scripts/init_plan.mjs` — the scaffolding CLI. Run it to generate the run directory +
  the three templates, then fill them in.
