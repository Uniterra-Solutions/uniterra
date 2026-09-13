# Module: uniterra-skills

**Purpose:** Built-in skill registry — bundles the 8 company-standard skills and provisions them into the agent's skills directory at startup (idempotent, never clobbers user edits; retired skills are removed). In the dsh runtime the same skill tree ships via the rank-600 bundled provider (`DSH_BUNDLED_SKILL_DIR`).

Source: `packages/uniterra-skills/src/index.ts`, `src/skills/*/SKILL.md`; build `scripts/build-workflow-capsules.mjs` + `scripts/copy-skills.mjs`; tests `test/provision.test.mts`, `test/workflow-templates.test.mts`, `test/workflow-orchestration-pbt.test.mts`, `test/workflow-orchestration-regressions.test.mts`.

## Public API

| Export                   | Signature                                                      | Description                                                                                                       |
| ------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `builtinSkillNames`      | `readonly BuiltinSkillName[]`                                  | The 8 skill names in provision order                                                                              |
| `listBuiltinSkills`      | `() => BuiltinSkillInfo[]`                                     | Names + frontmatter description + `dist/skills` dir per skill                                                     |
| `provisionBuiltinSkills` | `(agentDir, options?: { force?: boolean }) => ProvisionResult` | Idempotent copy into `<agentDir>/skills/`; retired skills removed; `{ installed, skipped, failed }`; never throws |
| `builtinSkillsDir`       | `() => string`                                                 | `dist/skills` relative to the compiled module                                                                     |
| `resolveAgentDir`        | `() => string`                                                 | `PI_CODING_AGENT_DIR` (tilde-expanded) else `~/.pi/agent`                                                         |

Provision order (`SKILL_NAMES`): `uniterra-pbt-debugging`, `uniterra-review`, `manage-agents-md`, `manage-git-repo`, `project-documentation`, `uniterra-qa`, `dsh-skill-creator`, `dsh-prompt-writer`.

## Provisioning Mechanics

- Copy source: `dist/skills` → `<agentDir>/skills/<name>`.
- Target exists and `force` unset → skipped (user edits survive restarts).
- `force` → delete + re-copy (re-provision bundled content).
- Retired skills are removed from the target dir on every run — the copy loop alone would leave them loaded forever. `RETIRED_SKILL_NAMES` covers the pre-rename `cardo-*` names, the old `qa`, and the retired plan / implement / simplify pipeline (the capabilities they carried now ship as `dsh-skill-creator` / `dsh-prompt-writer`).
- Source `SKILL.md` missing → recorded failure; copy errors never throw.
- `resolveAgentDir()` reimplements pi's `getAgentDir()` — avoids importing the ESM-only pi package from the CJS Electron main bundle.

## Build / Packaging

`build` = `tsc -b` + `scripts/build-workflow-capsules.mjs` + `scripts/copy-skills.mjs`: the capsule builder emits the persisted `review` capsule (`.workflow.json`) into `src/skills/uniterra-review/workflows/` — composing its prompt from that skill's `references/*.md` at build time — then `copy-skills.mjs` mirrors `src/skills/*` to `dist/skills/` and removes entries deleted from `src` (a retired skill stops shipping).

## The `review` Workflow Capsule & the `run_workflow` Contract

`uniterra-review` dispatches its agents through the `@dsh-external/workflow` plugin's
`run_workflow(name, args)` tool, which runs a **persisted `.workflow.json` capsule**. The
model never copies a JS block into a `workflow` tool call — the orchestration + agent
prompts live in the capsule, bundled under the skill's `workflows/` dir and provisioned
into `$DSH_HOME/workflows` by `ensureWorkflowCapsules` (which also removes the retired
`implement` / `simplify` capsules on every boot). Capsule contract:

- Format: `format: "dsh.workflow"`, `version: 1`, `workflowApiVersion: 1`, plus a
  `manifest` (lowercase-kebab `name`, `description`, non-empty `phases`, `readOnly`,
  positive `maxAgents` / `maxConcurrency`, non-empty `patterns` from the six pattern ids)
  and a `source` string.
- **`source`** is plain JS (no TypeScript) defining `async function run(wf, args)` and
  running in a restricted sandbox (no `Math.random` / `Date.now` / `console`, no
  `import`/`require`/`process`/`fs`/`fetch`/`eval`/`__proto__`). It uses the `wf` API:
  `wf.phase(name, fn)`, `wf.runAgent({ name, prompt, readOnly, modelHint, outputSchema })`,
  `wf.readFile(path)`, `wf.parallel(thunks, { concurrency })`, `wf.synthesize(...)`,
  `wf.artifact(...)`, `wf.log(...)`. `modelHint` is exactly `fast` | `balanced` | `deep`. A
  manifest `readOnly: true` forbids spawning a write-capable child (`input.readOnly: false`
  throws), so the review capsule is `readOnly: false` (the fixer must change source).
- **Subagent reports to the workflow are the `structured` output** of each
  `wf.runAgent(...)` call (validated by that call's `outputSchema`). Only the subagent
  **input prompt** is text/markdown; never convert the structured return to markdown.
- **The review standard** — `review` accepts an optional
  `standard = { requirements, acceptance }` (repo-relative paths to the requirements +
  acceptance documents of record). Both files are read at run time and inlined VERBATIM into
  the review AND the fixer prompt under the header
  `## Standard (authoritative — the requirements + acceptance of record)`: the document text
  goes in, the main agent's narrative stays out. A missing path, an unreadable file, or empty
  content means no standard block at all — the review then degrades to pure code modelling
  (standalone), exactly as before.
- **Return shape** — `review` returns `{ status, clean, reports, fixes, compliance }`, where
  `compliance` is the review's own requirement-by-requirement audit
  (`pass` / `fail` / `missing` / `contradiction`) — optional in `REVIEW_SCHEMA` so the additive
  extension never has to be a `required` field. A fixer reporting `status: 'failed'` surfaces
  as a `failed` capsule status, never a misleading `done`.
- **Args stay tiny** — `run_workflow('review', { task, standard })`: `task` is a pointer to
  the code under review, `standard` holds two repo-relative PATHS, and the capsule reads the
  documents itself with `wf.readFile` (the engine rejects a path that escapes the workspace).
  Never inline document text or a long brief.

The capsule is generated by `scripts/build-workflow-capsules.mjs`, which composes the review
prompt from the skill's `references/*.md` (the prompt text is never duplicated in the builder)
and emits it into `uniterra-review/workflows/`; `copy-skills.mjs` mirrors it to
`dist/skills/uniterra-review/workflows/`. The provenance timestamp is fixed, so re-running the
builder is byte-idempotent.

`test/workflow-templates.test.mts` locks this: the capsule is `format: dsh.workflow` with a
valid manifest and a `source` that compiles and defines `async function run(wf, args)`; its
`source` executes to a terminal JSON result under stubbed `wf` hooks (single pass with the
fixer skipped on a clean review, the standard documents reaching BOTH the review and the fixer
prompt verbatim, `compliance` passing straight through, and behaviour unchanged when no standard
is supplied); the SKILL.md call layer invokes `run_workflow('review', args)` and no longer
instructs copying a script; and the legacy template is flagged `MIGRATED`.
`test/workflow-orchestration-pbt.test.mts` drives the same invariants over generated inputs, and
`test/workflow-orchestration-regressions.test.mts` pins the confirmed counterexample
deterministically.

## Bundled Skills

| Skill                                             | Trigger (LOAD when)                                                             | Workflow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [uniterra-review](#uniterra-review)               | Adversarial review / hunt for bugs / run the review phase (with a review scope) | scope + standard (prd.md + acceptance.md VERBATIM when a plan exists — never a main-agent summary) → review (models the WHOLE business logic + lifecycle — every operation, every state, happy paths included — into a formal spec table of state / transition / lifecycle / data / security invariants → write state-machine PBTs (random operation sequences) + input-generating properties in one pass → prove with >10k-run PBT in a background job → shrink counterexamples into structured error reports → audit every requirement line against its acceptance evidence: compliance rows + coverage gap / hollow test / spec contradiction) → fixer repairs each (never against a requirement) and reports back to the main agent → main agent aggregates by severity (critical/medium/low) + user impact + the compliance summary (never re-running the tests) |
| [dsh-skill-creator](#dsh-skill-creator)           | Create/add a dsh skill (建立技能/技能創建/新增 skill)                           | Default to the USER root `~/.dsh/skills` (project / bundled roots only when repo-bound; lowest rank wins a duplicate name) → kebab-case name + layout → frontmatter contract → a body that changes behaviour → verify discovery with the `skill` tool                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [dsh-prompt-writer](#dsh-prompt-writer)           | Write a prompt / work order / task brief (寫 prompt/工作單/任務書)              | Recon with real tools → settle every decision in one `ask_user_question` call → write the complete order → deliver it as ONE four-backtick block → verify the result with real tools (`references/pbt-first-dev-mode.md` for software)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [uniterra-pbt-debugging](#uniterra-pbt-debugging) | Bug report / test failure / wrong behavior in business-logic code               | Read logic → define invariants → failing PBT reproduction → fix → regression tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| uniterra-qa                                       | Verify an app against its PRD (qa/test/驗收/試用)                               | UI: playwright DOM geometry → screenshot pixel analysis → external-tool UI operation (or playwright E2E); backend: clean-container install + smoke boot → API journeys → fix loop → qa-report.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| project-documentation                             | Generate/update/rebuild project docs (寫文檔/更新文檔/重建文檔/項目文檔)        | SCAN → ANALYZE → GENERATE (12 files in dependency order) → VERIFY audit; existing docs → incremental git-diff update                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| manage-agents-md                                  | Create/audit agent spec files (AGENTS.md etc.)                                  | Scan 6 core areas → write → audit → drift check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| manage-git-repo                                   | Commit/version/release/PR workflows                                             | Commit (dependency order) / Version Release (semver + changelog + `v` tag) / Branch + Batch Commit + PR / Stacked PR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### uniterra-review

Property-based adversarial review with **requirement as standard** — usable standalone, no plan required. Assemble the **review scope** (`task`) and, when a plan exists, the **standard** (`standard: { requirements, acceptance }`, the repo-relative paths to `prd.md` + `acceptance.md`). The pollution boundary is "documents in, narrative out": the review agent receives those documents AS THEIR ORIGINAL TEXT and never the orchestrator's summary, believed bug, or interpretation — the orchestrator does not pre-read or re-summarize the code either (it only names the scope), so the review is not biased before it starts. A `workflow` (review → fix) then orchestrates **two subagents** (there is no main-agent step inside it):

- **Standard axis** (when a standard is in force): for every requirement line, walk the acceptance line → the test it names → does it **exist**, does it **pass**, and is it **non-hollow** (could it fail if the behaviour were wrong?). Each line yields one compliance row (`pass` / `fail` / `missing` / `contradiction`), and the axis produces the three instrument findings — **coverage gap** (no test covers the line), **hollow test** (a test that passes but proves nothing, with the reason), **spec contradiction** (the code or its tests contradict the line) — reported both as compliance rows and as ordinary counterexample reports. The standard is the authority for what must hold, so a contradiction is a finding against the CODE. Standalone (no standard), the review falls back to pure code modelling.
- **Standard-external axis** — the three verification layers, all proven by PBT. The **review agent** reads every business module in scope in ONE pass, discovers the repo's test + property-testing conventions (never assumes a framework), traverses the WHOLE business logic + lifecycle and models THREE layers — every operation, every state, happy paths included, not just the paths that look suspicious: (1) **intra-module**: the module's own state / transition / composition / lifecycle / data invariants with random operation-sequence properties; (2) **interaction**: the module × each counterpart's contract (emit/accept compatibility, event order, ownership, error propagation) with the counterpart mocked to its contract and its states injected; (3) **integration**: the system slices involving the module with the external world mocked (fs/network/env/clock) — end-to-end no loss / no duplication, leak-free teardown, restart/replay correctness, failures injected at any point. It ALSO derives **security invariants** from the security checklist (`references/security-checklist.md`), so logic **security** is PBT-verified too, writes ALL the property tests in one pass (state-machine / model-based properties that brute-force random operation sequences, plus input-generating properties), then runs them together in a **background** job with an iteration budget **more than 10,000 runs**. It shrinks every counterexample to its minimal failing input or operation sequence and wraps it as a structured error report (id, level, file, line, invariant, input, expected/actual, test), and returns `{ spec_table, reports, compliance }`.
- The **fixer** receives the standard too and repairs each counterexample without ever contradicting a requirement or acceptance line (a report that conflicts with the standard is not repaired — the conflict is stated in that item's explanation and the run reports `failed`, matching the existing semantics); it pins each fix with a deterministic unit regression test (a concrete minimal input, no RNG), names every test after the TEST PURPOSE it enforces (never a finding id), and leaves changes uncommitted.
- The **main agent** (you) aggregates the counterexamples + fixes by severity (critical / medium / low) with the user impact, plus the **compliance summary** (requirements X/Y, acceptance M/N met, every non-`pass` row with its reason) as its own axis next to the severity report — and never re-runs the property-based tests (the review agent already ran them and the fixer re-confirmed its fixes). The workflow returns `{ status, clean, reports, fixes, compliance }`.

### dsh-skill-creator

Teaches the dsh skill contract: **the default target is the USER root `~/.dsh/skills`**
(rank 400 — the directory the `skill` tool reads and the user's own skill list shows); a
project root is for a repository-bound skill only, and the bundled root is never the user's
to write. It carries the six roots and their precedence (project `.dsh/skills` →
`.agents/skills` → custom dirs → user `<dshHome>/skills` → agents home → the read-only
bundled root), kebab-case naming plus the two supported layouts
(`<name>/SKILL.md` and `<name>.md`), the frontmatter fields (`name`, `description`,
`whenToUse`, `disable-model-invocation`, `user-invocable`) and which visibility combination
each produces, body-writing principles, and how to verify discovery (load by name with the
`skill` tool, trigger it in natural language, check the catalog).

### dsh-prompt-writer

Turns a request into one self-contained executor order: the six beats (recon with real tools
→ settle the decisions in ONE `ask_user_question` call → write the order → deliver it as a
single four-backtick fenced block → the user pastes it to the executor → verify with real
tools), the canonical order structure (header / mission / numbered hard constraints /
workstreams / acceptance / execution order + commit discipline / appendix with Out-of-Scope),
the dsh dispatch specifics (a `subagent` sees no conversation, so the prompt carries
everything; `run_workflow` args stay tiny — pass paths), and `references/pbt-first-dev-mode.md`
with the tests-first discipline every software order bakes in.

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
- Retired workflow capsule → add its file name to `RETIRED_WORKFLOW_CAPSULES` in `packages/uniterra-desktop/src/builtin.ts`, so an already-provisioned profile drops it from `$DSH_HOME/workflows` on the next boot.
- Skill content changed → the skill dir itself; no code change needed.

## Find It Fast

```bash
grep -n 'SKILL_NAMES' packages/uniterra-skills/src/index.ts   # registry manifest
ls packages/uniterra-skills/src/skills/                       # bundled skills
```
