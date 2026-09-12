# Module: uniterra-skills

**Purpose:** Built-in skill registry — bundles the 9 company-standard skills and provisions them into the agent's skills directory at startup (idempotent, never clobbers user edits; retired skills are removed). In the dsh runtime the same skill tree ships via the rank-600 bundled provider (`DSH_BUNDLED_SKILL_DIR`).

Source: `packages/uniterra-skills/src/index.ts`, `src/skills/*/SKILL.md`; build `scripts/copy-skills.mjs`; tests `test/provision.test.mts`, `test/workflow-templates.test.mts`.

## Public API

| Export                   | Signature                                                      | Description                                                                                                       |
| ------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `builtinSkillNames`      | `readonly BuiltinSkillName[]`                                  | The 9 skill names in provision order                                                                              |
| `listBuiltinSkills`      | `() => BuiltinSkillInfo[]`                                     | Names + frontmatter description + `dist/skills` dir per skill                                                     |
| `provisionBuiltinSkills` | `(agentDir, options?: { force?: boolean }) => ProvisionResult` | Idempotent copy into `<agentDir>/skills/`; retired skills removed; `{ installed, skipped, failed }`; never throws |
| `builtinSkillsDir`       | `() => string`                                                 | `dist/skills` relative to the compiled module                                                                     |
| `resolveAgentDir`        | `() => string`                                                 | `PI_CODING_AGENT_DIR` (tilde-expanded) else `~/.pi/agent`                                                         |

Provision order (`SKILL_NAMES`): `uniterra-pbt-debugging`, `uniterra-plan`, `uniterra-implement`, `uniterra-simplify`, `uniterra-review`, `manage-agents-md`, `manage-git-repo`, `project-documentation`, `uniterra-qa`.

## Provisioning Mechanics

- Copy source: `dist/skills` → `<agentDir>/skills/<name>`.
- Target exists and `force` unset → skipped (user edits survive restarts).
- `force` → delete + re-copy (re-provision bundled content).
- Retired skills (`uniterra-planmode`, split into the four uniterra-* skills) are removed from the target dir on every run — the copy loop alone would leave them loaded forever.
- Source `SKILL.md` missing → recorded failure; copy errors never throw.
- `resolveAgentDir()` reimplements pi's `getAgentDir()` — avoids importing the ESM-only pi package from the CJS Electron main bundle.

## Build / Packaging

`build` = `tsc -b` + `scripts/build-workflow-capsules.mjs` + `scripts/copy-skills.mjs`: the capsule builder emits each pipeline workflow's `.workflow.json` into `src/skills/<skill>/workflows/` (the persisted `implement` / `review` / `simplify` capsules), then `copy-skills.mjs` mirrors `src/skills/*` → `dist/skills/` (including each `workflows/` subdir), deletes stale `dist/skills` entries (a deleted skill must not keep shipping), and throws if zero skills were copied (fail fast on a wrong path).

## Workflow Capsules & the `run_workflow` Contract

The three pipeline skills (`uniterra-implement` / `uniterra-review` /
`uniterra-simplify`) dispatch their agents through the `@dsh-external/workflow` plugin's
`run_workflow(name, args)` tool, which runs a **persisted `.workflow.json` capsule**. The
model never copies a JS block into a `workflow` tool call — the orchestration + agent
prompts live in the capsule, bundled under each skill's `workflows/` dir (provisioned into
`$DSH_HOME/workflows` by `ensureWorkflowCapsules`). Capsule contract:

- Format: `format: "dsh.workflow"`, `version: 1`, `workflowApiVersion: 1`, plus a
  `manifest` (lowercase-kebab `name`, `description`, non-empty `phases`, `readOnly`,
  positive `maxAgents` / `maxConcurrency`, non-empty `patterns` from the six pattern ids)
  and a `source` string.
- **`source`** is plain JS (no TypeScript) defining `async function run(wf, args)` and
  running in a restricted sandbox (no `Math.random` / `Date.now` / `console`, no
  `import`/`require`/`process`/`fs`/`fetch`/`eval`/`__proto__`). It uses the `wf` API:
  `wf.phase(name, fn)`, `wf.runAgent({ name, prompt, readOnly, modelHint, outputSchema })`,
  `wf.parallel(thunks, { concurrency })`, `wf.synthesize(...)`, `wf.artifact(...)`,
  `wf.log(...)`. `modelHint` is exactly `fast` | `balanced` | `deep`. A manifest
  `readOnly: true` forbids spawning a write-capable child (`input.readOnly: false` throws),
  so the mutating workflows (which have a repair/fix agent) are `readOnly: false` and set
  each review agent `readOnly: true` individually.
- **Subagent reports to the workflow are the `structured` output** of each
  `wf.runAgent(...)` call (validated by that call's `outputSchema`). Only the subagent
  **input prompt** is text/markdown; never convert the structured return to markdown.
- **The review standard** — `review` accepts an optional
  `standard = { requirements, acceptance }` (repo-relative paths to the plan's `prd.md` +
  `acceptance.md`). Both files are read at run time and inlined VERBATIM into the review AND the
  fixer prompt under the header
  `## Standard (authoritative — the requirements + acceptance of record)`: the document text
  goes in, the main agent's narrative stays out. A missing path, an unreadable file, or empty
  content means no standard block at all — the review then degrades to pure code modelling
  (standalone), exactly as before.
- **Return shapes** — `implement` returns `{ status: 'done', agents, reports }` or
  `{ status: 'failed', batch, reports }`, where `reports` carries one `{ id, ...structured }`
  entry per task in dispatch order (a child that returned nothing stays visible as
  `{ id, failed: true }`); `review` returns `{ status, clean, reports, fixes, compliance }`,
  where `compliance` is the review's own requirement-by-requirement audit
  (`pass` / `fail` / `missing` / `contradiction`) — optional in `REVIEW_SCHEMA` so the additive
  extension never has to be a `required` field.

The three capsules (`implement` / `review` / `simplify`) are generated by
`scripts/build-workflow-capsules.mjs` (embeds the canonical prompt text from the
`prompts/*.md` / `references/*.md` assets) and emitted into each skill's `workflows/` dir;
`copy-skills.mjs` mirrors them to `dist/skills/<skill>/workflows/`.

`test/workflow-templates.test.mts` locks this: each capsule is `format: dsh.workflow`
with a valid manifest and a `source` that compiles and defines `async function run(wf, args)`;
each capsule's `source` executes to a terminal JSON result under stubbed `wf` hooks
(parallel + batched shapes for implement — success returns one report per task in dispatch order
and a failed run still reports its completed batches plus the failing batch; single-pass with a
skipped fixer on a clean review, with the standard documents reaching BOTH the review and the
fixer prompt verbatim and `compliance` passing straight through, and behaviour unchanged when no
standard is supplied; pass-verdict early exit + cross-round skip accumulation for simplify); the
three SKILL.md call layers invoke `run_workflow('<name>', args)` and no longer instruct copying a
script; and the legacy template/script files are flagged `MIGRATED`.

## Bundled Skills

| Skill                                             | Trigger (LOAD when)                                                                 | Workflow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [uniterra-plan](#uniterra-plan)                   | Plan a feature/task (prd/plan/規劃/計畫)                                            | Reconnoitre the repo read-only → clarify ONLY requirements / acceptance / what the repo cannot answer (never co-design the implementation) → scaffold the run dir (init_plan.mjs) → fill prd.md + acceptance.md (no architecture design) → confirm the plan with the user                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| [uniterra-implement](#uniterra-implement)         | Execute an approved plan (execute_plan/執行計畫); implement a well-specified task   | Requirements + acceptance → write the red suite as the spec (every acceptance line ↦ ≥1 test, every test ↦ a requirement) → freeze the cross-task seams → decompose into a task list, each task carrying its own requirements + acceptance + tests (init_task.mjs scaffolds each brief) → run_workflow('implement') (inlines each brief into the subagent prompt, returns per-task reports) → batched/parallel subagents → reconcile coverage + deviations → full suite green                                                                                                                                                                                                                                                                                                                                                                                         |
| [uniterra-simplify](#uniterra-simplify)           | Simplify code / cut over-engineering / run the simplify phase (with a review scope) | goal + context (requirements + acceptance authoritative; the legacy design block optional) → review (over-engineering checklist — required machinery is not over-engineering, safe/risky, pass/fail verdict) → fix → re-review loop until pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| [uniterra-review](#uniterra-review)               | Adversarial review / hunt for bugs / run the review phase (with a review scope)     | scope + standard (prd.md + acceptance.md VERBATIM when a plan exists — never a main-agent summary) → review (models the WHOLE business logic + lifecycle — every operation, every state, happy paths included — into a formal spec table of state / transition / lifecycle / data / security invariants → write state-machine PBTs (random operation sequences) + input-generating properties in one pass → prove with >10k-run PBT in a background job → shrink counterexamples into structured error reports → audit every requirement line against its acceptance evidence: compliance rows + coverage gap / hollow test / spec contradiction) → fixer repairs each (never against a requirement) and reports back to the main agent → main agent aggregates by severity (critical/medium/low) + user impact + the compliance summary (never re-running the tests) |
| [uniterra-pbt-debugging](#uniterra-pbt-debugging) | Bug report / test failure / wrong behavior in business-logic code                   | Read logic → define invariants → failing PBT reproduction → fix → regression tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| uniterra-qa                                       | Verify an app against its PRD (qa/test/驗收/試用)                                   | UI: playwright DOM geometry → screenshot pixel analysis → external-tool UI operation (or playwright E2E); backend: clean-container install + smoke boot → API journeys → fix loop → qa-report.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| project-documentation                             | Generate/update/rebuild project docs (寫文檔/更新文檔/重建文檔/項目文檔)            | SCAN → ANALYZE → GENERATE (12 files in dependency order) → VERIFY audit; existing docs → incremental git-diff update                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| manage-agents-md                                  | Create/audit agent spec files (AGENTS.md etc.)                                      | Scan 6 core areas → write → audit → drift check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| manage-git-repo                                   | Commit/version/release/PR workflows                                                 | Commit (dependency order) / Version Release (semver + changelog + `v` tag) / Branch + Batch Commit + PR / Stacked PR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### uniterra-plan

The planning phase (Jovaltus methodology). The plan is a **requirements list plus the acceptance criteria that verify it** — there is no architecture design anywhere in the pipeline. Artifacts live under `<repo>/.plan/<YYYYMMDD>/<plan-name>/`: `prd.md` and `acceptance.md`. Scaffold the run dir with the skill's `scripts/init_plan.mjs` CLI (`node "<skill_base>/scripts/init_plan.mjs" <plan-name>` writes the two templates) and fill them in — the agent does not hand-build the boilerplate.

1. **Read the requirements** — what the user wants, for whom, and why now.
2. **Reconnoitre the repo, read-only** — relevant modules, existing tests, conventions. Edit nothing here; the reconnaissance is what makes every acceptance evidence entry a real path or command from this repo rather than an invented one, and it answers most questions before they are asked.
3. **Clarify** — via `ask_user_question`, ONLY the requirements, the acceptance criteria, and the facts/constraints the repo cannot answer (external-system behavior, compatibility commitments, organizational conventions, irreversible choices). Two hard limits: anything the repo can answer must not be asked, and the implementation is never co-designed (module boundaries, data shapes and internal structure belong to `uniterra-implement`).
4. **Write the two docs yourself** (no authoring subagents) — `prd.md` (Functional Requirements list; anything in **Assumptions & Constraints** lands as a requirement or an acceptance row, never as design prose) and `acceptance.md` (one acceptance criterion per requirement, each naming an objective verifiable piece of evidence that exists or can be run in this repo).
5. **Confirm with the user** — read the two docs back with a short summary and ask via `ask_user_question` whether the content is broadly correct and matches their needs; apply any edits they raise and show the result again.

### uniterra-implement

Test-as-spec implementation against an explicit requirements list + its acceptance criteria. The failing tests are written HERE (red phase), never in the plan; the acceptance criteria ARE the specification.

1. **Requirements + acceptance** — read the plan's `prd.md` + `acceptance.md`, or, standalone, build them with the user via `ask_user_question` (requirements, acceptance, and the constraints the repo cannot supply — the repo answers everything else, and the implementation is never co-designed). Clarify any ambiguous requirement; every acceptance line names verifiable evidence.
2. **Write the red suite (test as spec), freeze the seams, decompose** — every acceptance line maps to at least one test and every test traces back to a requirement (a line with no test, or a test with no requirement, is a spec gap to close before dispatch). Then list the data flow between tasks: every cross-task seam (an interface, a serialized shape, an event one emits and another consumes) must already be pinned by a test in the red suite, or be promoted to a requirement / acceptance line; tasks sharing a seam go in the SAME batch (each mocking it) or in separate batches with the provider first. Decompose into a **task list** (`assets/task-list-example.md`): one entry per task, each carrying only its own requirements + acceptance lines + allocated tests, plus context files, conventions, and owned / forbidden file sets. Scaffold each task's brief with the skill's `scripts/init_task.mjs` CLI (`node "<skill_base>/scripts/init_task.mjs" <project-name> <task-id> <task-name>` — writes `.dsh/<YYYYMMDD-HHmmss>/<project-name>/<task-name>.md` and maintains that project's `task.json` manifest, one per project so projects under the same timestamp never overwrite each other), then fill in the placeholders. Leave the plan as it is — the plan already exists; author the tests and the task list, not a new plan document.
3. **Workflow** (`run_workflow('implement', args)` — the `workflows/implement.workflow.json` capsule) — one orchestration handles both shapes: set `args.tasks` (flat) for full parallel when tasks are independent, or `args.batches` (array of task arrays, serial across batches) when they overlap. Each task carries a `promptFile` (a repo-relative path to a file holding the task's pre-rendered markdown brief — goal + context + requirements & acceptance with their allocated tests + conventions + constraints) — `args` stays tiny and the brief is never embedded inline, so the tool call JSON is never corrupted. The capsule INLINES each `promptFile` brief into the subagent prompt via the workflow engine's `wf.readFile` (tasks without `promptFile` fail loudly), so the inlined brief is the subagent's source of truth — it re-reads the task file only when a referenced file's details are missing; it reports `{changed_files, satisfied_requirements, deviations}` through dsh's built-in `structured_output` tool — never as a plain-text JSON string. Each subagent works against the failing tests written in step 2 and starts from the allocated failing test as the acceptance target, extending it (add the missing edge cases and invariant asserts) rather than writing a fresh property test from scratch each time, and it never weakens, narrows or deletes an allocated test: a test it believes is wrong stays RED and is recorded as a one-line `deviations` entry, as is a change to an interface another task's tests consume. The capsule returns `{ status: 'done', agents, reports }`, or `{ status: 'failed', batch, reports }` naming the first failing batch (no later batch is dispatched).
4. **Reconcile** — from the returned `reports`: every requirement must appear in some report's `satisfied_requirements` (a gap → dispatch a follow-up or correct the report), and every `deviations` line is adjudicated — a spec problem goes back to the user and into `acceptance.md` (the plan stays the single standard), an interface change is checked against the affected tasks' tests, anything else is ignored (there is no separate design to deviate from). A fully green suite (acceptance tests + lint / typecheck / build) is the handoff gate.

### uniterra-simplify

Behaviour-preserving simplification — usable standalone, no plan required. Assemble a goal + context (requirements + acceptance, from docs or written directly; the `design` block is **optional**, kept for compatibility with older plans), then a `workflow` loops review → fix → re-review: the review agent returns a verdict (`pass` | `fail`) plus simplification opportunities against the over-engineering checklist (`references/overengineering-checklist.md`), each rated `safe` (provably behaviour-preserving) or `risky`; the fix agent applies them, preserving behaviour exactly. A `pass` verdict means the code is already simple enough — trivial/nitpick-level ideas are returned with the result but not applied, so the loop ends; `fail` sends the recommendations to the fix agent. The `requirements` + `acceptance` blocks are AUTHORITATIVE: neither agent ever proposes/applies a simplification that contradicts a requirement or an acceptance line (module boundaries, layers, interfaces, data shapes, testability, observability, security, error handling, performance — to the extent those documents state them) — required machinery (a layer, interface, config flag, guard, error path) is not over-engineering, and the checklist applies only where they are silent. An absent `design` block changes nothing and is never a reason to delete required machinery. Cap at `maxRounds` (default 8).

### uniterra-review

Property-based adversarial review with **requirement as standard** — usable standalone, no plan required. Assemble the **review scope** (`task`) and, when a plan exists, the **standard** (`standard: { requirements, acceptance }`, the repo-relative paths to `prd.md` + `acceptance.md`). The pollution boundary is "documents in, narrative out": the review agent receives those documents AS THEIR ORIGINAL TEXT and never the orchestrator's summary, believed bug, or interpretation — the orchestrator does not pre-read or re-summarize the code either (it only names the scope), so the review is not biased before it starts. A `workflow` (review → fix) then orchestrates **two subagents** (there is no main-agent step inside it):

- **Standard axis** (when a standard is in force): for every requirement line, walk the acceptance line → the test it names → does it **exist**, does it **pass**, and is it **non-hollow** (could it fail if the behaviour were wrong?). Each line yields one compliance row (`pass` / `fail` / `missing` / `contradiction`), and the axis produces the three instrument findings — **coverage gap** (no test covers the line), **hollow test** (a test that passes but proves nothing, with the reason), **spec contradiction** (the code or its tests contradict the line) — reported both as compliance rows and as ordinary counterexample reports. The standard is the authority for what must hold, so a contradiction is a finding against the CODE. Standalone (no standard), the review falls back to pure code modelling.
- **Standard-external axis** — the three verification layers, all proven by PBT. The **review agent** reads every business module in scope in ONE pass, discovers the repo's test + property-testing conventions (never assumes a framework), traverses the WHOLE business logic + lifecycle and models THREE layers — every operation, every state, happy paths included, not just the paths that look suspicious: (1) **intra-module**: the module's own state / transition / composition / lifecycle / data invariants with random operation-sequence properties; (2) **interaction**: the module × each counterpart's contract (emit/accept compatibility, event order, ownership, error propagation) with the counterpart mocked to its contract and its states injected; (3) **integration**: the system slices involving the module with the external world mocked (fs/network/env/clock) — end-to-end no loss / no duplication, leak-free teardown, restart/replay correctness, failures injected at any point. It ALSO derives **security invariants** from the security checklist (`references/security-checklist.md`), so logic **security** is PBT-verified too, writes ALL the property tests in one pass (state-machine / model-based properties that brute-force random operation sequences, plus input-generating properties), then runs them together in a **background** job with an iteration budget **more than 10,000 runs**. It shrinks every counterexample to its minimal failing input or operation sequence and wraps it as a structured error report (id, level, file, line, invariant, input, expected/actual, test), and returns `{ spec_table, reports, compliance }`.
- The **fixer** receives the standard too and repairs each counterexample without ever contradicting a requirement or acceptance line (a report that conflicts with the standard is not repaired — the conflict is stated in that item's explanation and the run reports `failed`, matching the existing semantics); it pins each fix with a deterministic unit regression test (a concrete minimal input, no RNG), names every test after the TEST PURPOSE it enforces (never a finding id), and leaves changes uncommitted.
- The **main agent** (you) aggregates the counterexamples + fixes by severity (critical / medium / low) with the user impact, plus the **compliance summary** (requirements X/Y, acceptance M/N met, every non-`pass` row with its reason) as its own axis next to the severity report — and never re-runs the property-based tests (the review agent already ran them and the fixer re-confirmed its fixes). The workflow returns `{ status, clean, reports, fixes, compliance }`.

### uniterra-pbt-debugging

Invariant-first debugging — turns a bug into a machine-search problem.

1. **Read and search the business logic under investigation** — trace inputs, pure functions, state transitions; find the invariants the code must satisfy.
2. **Define the logic as invariants and reproduce via PBT** — generate arbitrary inputs, assert the property (fast-check); it must FAIL against current code — the counterexample is the reproduction; refine until it fails; keep it as the red phase.
3. **Fix the root cause, then complete unit/regression tests** — PBT goes green; unit tests pin the concrete case; full suite green.

Rules: no code changes before a failing reproduction; prefer properties over unit tests; fall back to the generic evidence-driven loop for non-reducible bugs (I/O, timing) but still add a regression test.

## Dependencies

- Outbound: node builtins only (fs/path); parses YAML frontmatter of SKILL.md in-process.
- Inbound: `packages/uniterra-desktop` (provisions at startup); dsh runtime (bundled provider via `DSH_BUNDLED_SKILL_DIR`).

## Patterns & Gotchas

- `SKILL_NAMES` is the single manifest driving provisioning + listing — add a skill there and to `src/skills/<name>/SKILL.md`; retire a skill via `RETIRED_SKILL_NAMES` (its provisioned copy is then removed).
- Skill frontmatter `description:` is parsed as a folded YAML field (continuation lines joined).

## How to Update

- New/renamed skill → edit `SKILL_NAMES`, add the skill dir, run `pnpm run build` (copy-skills refreshes `dist/skills/`; deleted skills stop shipping).
- Retired skill → add to `RETIRED_SKILL_NAMES` so already-provisioned copies are removed.
- Skill content changed → the skill dir itself; no code change needed.

## Find It Fast

```bash
grep -n 'SKILL_NAMES' packages/uniterra-skills/src/index.ts   # registry manifest
ls packages/uniterra-skills/src/skills/                       # bundled skills
```
