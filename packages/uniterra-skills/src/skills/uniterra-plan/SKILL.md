---
name: uniterra-plan
description: >
  Company-standard planning phase on DeepSeek Harness (Jovaltus methodology).
  Turns raw requirements into two planning artifacts: reconnoitre the repo
  read-only, clarify only the requirements / acceptance / facts the repo cannot
  answer, scaffold the plan run directory, write prd.md + acceptance.md, and
  confirm them with the user. The plan is a requirements list plus the
  acceptance criteria that verify it — there is no design document. LOAD when:
  - User asks to plan a feature or task (prd / design / plan / 規劃 / 計畫)
  - User references Jovaltus planning or asks for an execution plan
  Use uniterra-implement to execute a plan and uniterra-review /
  uniterra-simplify to review or simplify changes.
---

# Uniterra Plan — turn requirements into requirements + acceptance

Pipeline position: **plan → implement → simplify/review**. This skill owns the
plan phase only: it produces `prd.md` and `acceptance.md` for handoff. The plan
states WHAT must hold and how it is verified — never HOW it is built, so it
carries no architecture design; implementation decisions belong to
`uniterra-implement`.

Artifacts live under a **run directory**: `<repo>/.plan/<YYYYMMDD>/<plan-name>/`,
holding `prd.md` and `acceptance.md`.

## Steps

### 1. Read the requirements

- Read the user's request: what they want, for whom, and why now.
- Separate what the request already decides from what it leaves open.

### 2. Reconnoitre the repo — READ ONLY

- Read the relevant modules, the existing tests, and the project's conventions
  (`AGENTS.md` / `CLAUDE.md`) BEFORE asking the user anything.
- **Edit nothing in this step.** Reconnaissance is strictly read-only.
- Every acceptance evidence entry must cite a REAL path or command from this
  repo — an existing test file, a package script, a CLI invocation — never an
  invented one. The reconnaissance is what makes the evidence real.
- Reconnaissance answers most questions by itself: a fact the repo already
  settles is not a question for the user.

### 3. Clarify — ONLY requirements, acceptance, and what the repo cannot answer

Ask the user via `ask_user_question` (options + Other), one at a time, and ONLY
about:

- the **requirements** — what must be built, and what is explicitly out of scope;
- the **acceptance** — how each requirement is objectively verified;
- **facts and constraints that cannot be derived from the repo**: external-system
  behavior, compatibility commitments, organizational conventions, irreversible
  choices.

Two hard limits:

- **Anything the repo can answer must NOT be asked.** Read it instead (step 2).
- **Never co-design the implementation.** Module boundaries, data shapes, and
  internal structure are the implementer's job; the plan states WHAT must hold.

### 4. Scaffold the run directory and fill the two documents

- Scaffold with the init CLI (no hand-writing of boilerplate). Run it in the repo
  root (your cwd):

  ```
  node "<skill_base>/scripts/init_plan.mjs" "<plan-name>"
  ```

  It creates `.plan/<YYYYMMDD>/<plan-name>/` with `prd.md` and `acceptance.md`
  templates and prints the run directory. Pass an optional second arg (a
  timestamp) to override the default date. (The skill base dir is the one listed
  in `skill_resources`.)

- Fill in the placeholders yourself in the main session (no authoring subagents):
  - `prd.md` — the Functional Requirements list (`REQ-1`, `REQ-2`, …). The
    **Assumptions & Constraints** section holds the facts and constraints that
    cannot be derived from the repo and must hold; each one lands as a
    requirement or an acceptance row, never as design prose.
  - `acceptance.md` — the acceptance criteria: one entry per requirement, each
    naming an objective, verifiable piece of evidence (a test, a command output,
    an observable behavior) that exists or can be run in this repo.

### 5. Confirm the plan with the user

Get a sanity check from the user so the plan actually fits their needs:

- Read back the two documents with a short summary: what the plan delivers, the key
  requirements, and how each is verified.
- Ask via `ask_user_question` (options + Other) whether the content is broadly correct
  and matches what they want. Keep it to a single confirming question, e.g. "Does this
  plan match your needs? / Are the requirements correct?"
- If they raise issues or select "needs changes", apply the edits to
  `prd.md` / `acceptance.md` yourself and show the result again.

## Files

- `scripts/init_plan.mjs` — the scaffolding CLI. Run it to generate the run directory +
  the two templates, then fill them in.
