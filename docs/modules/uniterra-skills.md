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

`build` = `tsc -b` + `scripts/build-workflow-capsules.mjs` + `scripts/copy-skills.mjs`: the capsule builder emits each pipeline workflow's `.workflow.json` into `src/skills/<skill>/workflows/` (the persisted `plan-review` / `implement` / `review` / `simplify` capsules), then `copy-skills.mjs` mirrors `src/skills/*` → `dist/skills/` (including each `workflows/` subdir), deletes stale `dist/skills` entries (a deleted skill must not keep shipping), and throws if zero skills were copied (fail fast on a wrong path).

## Workflow Capsules & the `run_workflow` Contract

The four pipeline skills (`uniterra-plan` / `uniterra-implement` / `uniterra-review` /
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

The four capsules (`plan-review` / `implement` / `review` / `simplify`) are generated by
`scripts/build-workflow-capsules.mjs` (embeds the canonical prompt text from the
`prompts/*.md` / `references/*.md` assets) and emitted into each skill's `workflows/` dir;
`copy-skills.mjs` mirrors them to `dist/skills/<skill>/workflows/`.

`test/workflow-templates.test.mts` locks this: each capsule is `format: dsh.workflow`
with a valid manifest and a `source` that compiles and defines `async function run(wf, args)`;
each capsule's `source` executes to a terminal JSON result under stubbed `wf` hooks
(axis-shrinking for plan-review, parallel + batched shapes for implement, single-pass with
a skipped fixer on a clean review, pass-verdict early exit + cross-round skip accumulation
for simplify); the four SKILL.md call layers invoke `run_workflow('<name>', args)` and no
longer instruct copying a script; and the legacy template/script files are flagged
`MIGRATED`.

## Bundled Skills

| Skill                                             | Trigger (LOAD when)                                                                 | Workflow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [uniterra-plan](#uniterra-plan)                   | Plan a feature/task (prd/design/plan/規劃/計畫)                                     | Clarify requirements + design interactively → scaffold the run dir (init_plan.mjs) → fill prd.md / design.md / acceptance.md → confirm the plan with the user → SINGLE parallel review (3 agents; the main agent applies any returned issues and may re-run the review fresh)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| [uniterra-implement](#uniterra-implement)         | Execute an approved plan (execute_plan/執行計畫); implement a well-specified task   | Requirements + design → write ALL failing PBTs → decompose into a task list (init_task.mjs scaffolds each brief) → run_workflow('implement') (inlines each brief into the subagent prompt) → batched/parallel subagents → full suite green                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| [uniterra-simplify](#uniterra-simplify)           | Simplify code / cut over-engineering / run the simplify phase (with a review scope) | goal + context (requirements/design/acceptance) → review (over-engineering checklist — plan design is authoritative, safe/risky, pass/fail verdict) → fix → re-review loop until pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [uniterra-review](#uniterra-review)               | Adversarial review / hunt for bugs / run the review phase (with a review scope)     | scope → review (the review agent gets ONLY the scope — no main-agent goal/req/design/acceptance framing, so it isn't biased; it models the WHOLE business logic + lifecycle — every operation, every state, happy paths included — into a formal spec table of state / transition / lifecycle / data / security invariants → write state-machine PBTs (random operation sequences) + input-generating properties in one pass → prove with >10k-run PBT in a background job → shrink counterexamples into structured error reports) → fixer repairs each and reports back to the main agent → main agent aggregates by severity (critical/medium/low) + user impact (never re-running the tests) |
| [uniterra-pbt-debugging](#uniterra-pbt-debugging) | Bug report / test failure / wrong behavior in business-logic code                   | Read logic → define invariants → failing PBT reproduction → fix → regression tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| uniterra-qa                                       | Verify an app against its PRD (qa/test/驗收/試用)                                   | UI: playwright DOM geometry → screenshot pixel analysis → external-tool UI operation (or playwright E2E); backend: clean-container install + smoke boot → API journeys → fix loop → qa-report.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| project-documentation                             | Generate/update/rebuild project docs (寫文檔/更新文檔/重建文檔/項目文檔)            | SCAN → ANALYZE → GENERATE (12 files in dependency order) → VERIFY audit; existing docs → incremental git-diff update                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| manage-agents-md                                  | Create/audit agent spec files (AGENTS.md etc.)                                      | Scan 6 core areas → write → audit → drift check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| manage-git-repo                                   | Commit/version/release/PR workflows                                                 | Commit (dependency order) / Version Release (semver + changelog + `v` tag) / Branch + Batch Commit + PR / Stacked PR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### uniterra-plan

The planning phase (Jovaltus methodology). Artifacts live under `<repo>/.plan/<YYYYMMDD>/<plan-name>/`: `prd.md`, `design.md`, `acceptance.md`. Scaffold the run dir with the skill's `scripts/init_plan.mjs` CLI (`node "<skill_base>/scripts/init_plan.mjs" <plan-name>` writes the three templates) and fill them in — the agent does not hand-build the boilerplate.

1. **Clarify** — interactively complete the requirements list AND the architecture design with the user (`ask_user_question`).
2. **Write the three docs yourself** (no authoring subagents) — `prd.md` (Functional Requirements list), `design.md` (architecture), `acceptance.md` (one acceptance criterion per requirement, each naming an objective verifiable piece of evidence).
3. **Confirm with the user** — before the automated review, read the three docs back with a short summary and ask via `ask_user_question` whether the content is broadly correct and matches their needs; apply any edits they raise and show the result again, then proceed only once they confirm.
4. **Review workflow** (`run_workflow('plan-review', { prd_dir, design_dir, acceptance_dir })` — the `workflows/plan-review.workflow.json` capsule) — a **SINGLE review pass**: three parallel review agents, each fed `prd_dir` / `design_dir` / `acceptance_dir`: requirement-list-review (technical feasibility + contradictions), design-review (over-engineering / minimal complexity / minimal invasiveness / necessary vs unnecessary libraries), acceptance-review (clarity + objective verifiable evidence). There is no repair agent and no re-review loop: the capsule returns `{ status, pass, passed, failures }` (`failures` carries each failing axis's `issues`), the main agent applies the issues to the documents itself, and may re-run the review as a fresh, independent single pass. Each agent reports via dsh's built-in `structured_output` tool (never a plain-text JSON string).

### uniterra-implement

PBT-first implementation against an explicit requirements list. The failing property tests are written HERE (red phase), never in the plan.

1. **Requirements + design** — read the plan's `prd.md` + `design.md`, or build them interactively (`ask_user_question`) when no design exists; clarify any ambiguous requirement.
2. **Write ALL failing property tests** in the main session (the red suite), then decompose requirements + design into a **task list** (`assets/task-list-example.md`): one entry per task with its requirements (each pointing at the covering test), context files, conventions, and owned / forbidden file sets. Scaffold each task's brief with the skill's `scripts/init_task.mjs` CLI (`node "<skill_base>/scripts/init_task.mjs" <project-name> <task-id> <task-name>` — writes `.dsh/<YYYYMMDD-HHmmss>/<project-name>/<task-name>.md` and maintains that project's `task.json` manifest, one per project so projects under the same timestamp never overwrite each other), then fill in the placeholders. Do NOT write a separate plan document — the plan already exists; decompose and dispatch.
3. **Workflow** (`run_workflow('implement', args)` — the `workflows/implement.workflow.json` capsule) — one orchestration handles both shapes: set `args.tasks` (flat) for full parallel when tasks are independent, or `args.batches` (array of task arrays, serial across batches) when they overlap. Each task carries a `promptFile` (a repo-relative path to a file holding the task's pre-rendered markdown brief — goal + context + requirements + conventions + constraints) — `args` stays tiny and the brief is never embedded inline, so the tool call JSON is never corrupted. The capsule INLINES each `promptFile` brief into the subagent prompt via the workflow engine's `wf.readFile` (tasks without `promptFile` fail loudly), so the subagent does NOT read the file itself; it reports `{changed_files, satisfied_requirements, deviations}` through dsh's built-in `structured_output` tool — never as a plain-text JSON string. Each subagent works against the failing tests written in step 2 and **prioritizes STRENGTHENING / completing those test cases** (extend the property, add the missing edge cases and invariant asserts) rather than writing a fresh property test from scratch each time. After the workflow the full suite must be green before review.

### uniterra-simplify

Behaviour-preserving simplification — usable standalone, no plan required. Assemble a goal + context (requirements / design / acceptance, from docs or written directly), then a `workflow` loops review → fix → re-review: the review agent returns a verdict (`pass` | `fail`) plus simplification opportunities against the over-engineering checklist (`references/overengineering-checklist.md`), each rated `safe` (provably behaviour-preserving) or `risky`; the fix agent applies them, preserving behaviour exactly. A `pass` verdict means the code is already simple enough — trivial/nitpick-level ideas are returned with the result but not applied, so the loop ends; `fail` sends the recommendations to the fix agent. The `design` context block is AUTHORITATIVE: neither agent ever proposes/applies a simplification that contradicts the plan's architecture or engineering needs (module boundaries, layers, interfaces, data shapes, testability, observability, security, error handling, performance) — design-mandated machinery (a layer, interface, config flag, guard, error path) is not over-engineering, and the checklist applies only where the design is silent. Cap at `maxRounds` (default 8).

### uniterra-review

Property-based adversarial review — usable standalone, no plan required. Assemble the **review scope** (task); the review agent is given ONLY that scope — not the orchestrator's goal / requirements / design / acceptance framing, and the orchestrator does NOT pre-read or re-summarize the code (it only names the scope), so the review is not polluted by the main agent's reading before it even starts — then a `workflow` (review → fix) orchestrates **two subagents** (there is no main-agent step inside it): the **review agent** reads every business module in scope in ONE pass, discovers the repo's test + property-testing conventions (never assumes a framework), traverses the WHOLE business logic + lifecycle and models THREE verification layers — every operation, every state, happy paths included, not just the paths that look suspicious — proving ALL THREE by PBT: (1) **intra-module**: the module's own state / transition / composition / lifecycle / data invariants with random operation-sequence properties; (2) **interaction**: the module × each counterpart's contract (emit/accept compatibility, event order, ownership, error propagation) with the counterpart mocked to its contract and its states injected; (3) **integration**: the system slices involving the module with the external world mocked (fs/network/env/clock) — end-to-end no loss / no duplication, leak-free teardown, restart/replay correctness, failures injected at any point — and ALSO derives **security invariants** from the security checklist (`references/security-checklist.md`), so the review verifies logic **security** via PBT, not just correctness, writes ALL the property tests in one pass (state-machine / model-based properties that brute-force random operation sequences, plus input-generating properties), then runs them together in a **background** job with an iteration budget **> 10,000 runs**. It shrinks every counterexample to its minimal failing input or operation sequence and wraps it as a structured error report (id, severity, file, line, invariant, input, expected/actual, test); only confirmed counterexamples are reported. The **fixer agent** repairs each reported operation so its invariant holds, re-runs the counterexample green, and **adds a deterministic unit regression test per counterexample** (a concrete minimal input + the exact outcome the invariant requires) so the bug is instantly reproducible with no RNG; every property test and regression is named after the TEST PURPOSE it pins (never a finding id, so a maintainer sees at a glance what it tests); it reports a diff + result + explanation **straight back to the main agent** (the orchestrator). The main agent then aggregates every counterexample + fix by severity (**critical / medium / low**) and explicitly lists which business logic is wrong, why, and the user impact, plus whether each was fixed — **without ever re-running the property tests** (the review agent ran them > 10,000 runs each and the fixer re-confirmed its fixes). The workflow is a **single pass** (no re-review loop) because the PBT is a statistically strong (near-formal) proof. Severity: **critical** = wrong results / data loss / a security hole / a core invariant that never holds; **medium** = fails on an edge/error path or a non-core invariant; **low** = a confirmed but non-blocking counterexample (rare — style/naming nits are not reported). A `pass` verdict means no critical/medium counterexample remains open. The whole-model method adapts per software type (backend / desktop-UI / CLI / data-schema / CI); pure business-rule functions are proven with oracle-backed properties (inverse/round-trip, reference-implementation differential, algebraic laws, relationally complete contracts, purity laws), while trivial helpers get cheap structural checks only; measured performance/liveness and pixel correctness are deliberately out of scope for review (maintainer-defined acceptance targets → QA/perf suites), while deterministic complexity smells (O(n²) / N+1 / unbounded growth) ARE review findings.

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
