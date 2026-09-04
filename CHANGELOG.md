# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.15.1] — 2026-09-04

### Fixed

- **Sessions could not be opened or created after the `0.1.2-rc.1` migration** (`packages/uniterra-desktop`, `src/preset-compat.ts`). dsh `0.1.2-rc.1` renamed the shipped `code` agent preset (Code Mode, the PTC-style TypeScript-program presentation) to `ptc`, but an upgraded profile still names the legacy id in two places: `$DSH_HOME/settings.yaml` (`agent-presets: default: code`) and every pre-upgrade session log header (`agentPreset: "code"` in the version-0 header line). dsh resolves presets by id, so every session create/resume failed with `agent-presets: preset "code" not found (available: standard, ptc, minimal, cordis)` and the web UI surfaced it as unresolvable sessions ("session not found" / resume failed) while the session logs remained on disk. The desktop now provisions a user preset named `code` (a byte copy of the shipped `ptc` composition + metadata) into `$DSH_HOME/.agent-presets/code` at boot via `ensureAgentPresetCompatibility(dshHome, sourceRoot)`; the legacy id therefore resolves to its PTC-mode successor without rewriting settings or log headers, an existing user-authored preset is never overwritten, provisioning is idempotent and fail-soft, and the row is removable once upstream ships a rename migration itself. Regression net: `packages/uniterra-desktop/test/preset-compat-pbt.test.mjs` (write-plan / never-clobber / byte-identity + idempotence / fail-soft / roster invariants) and `packages/uniterra-desktop/test/preset-compat-regressions.test.mjs` (the 0.1.1-rc.2 → 0.1.2-rc.1 upgrade scenario: `default: code` settings row plus a `code`-header session; user-preset protection). Docs and `AGENTS.md` updated.

## [0.15.0] — 2026-09-04

### Added

- **Git worktree session targets as a built-in** (`dsh-git-worktree@0.7.4`, npm — `wloops/dsh-git-worktree`). Isolated sessions per Git worktree with review checkpoints, human-confirmed delivery, and safe recovery. Its peers target the pinned dsh `0.1.2-rc.1` family exactly, so it rides the same `dsh plugin add` npm path as the other built-ins.

### Changed

- **Bundled DeepSeek Harness bumped to the `0.1.2-rc.1` family** (the current `latest`/npm release): the vendored source tree was re-pinned to the `dsh-v0.1.2-rc.1` tag (`a66e4702…`, 2026-09-03) and rebuilt (`vendor/dsh-harness`, ledger + divergences re-applied), the desktop's `@deepseek-ai/dsh` pin moved to `0.1.2-rc.1`, and the workspace lockfile refreshed. Breaking changes absorbed: `@deepseek-ai/dsh-client-runtime` was removed (the web client runtime is `@deepseek-ai/dsh-cordis-client-runner`, composed by the shell), the client wire face moved from `connection.api` (IApiClient) to the typed Remote namespaces on `ctx.remote` (`dsh-api-remotes` assembly — `remote.settings` / `remote.credentials` / `remote.llm`), the settings-section slot gained the `locale` registration field and the owner `close` prop, `ctx.settings.register` replaced the removed `installSettingsSection` helper, cordis bumped to 4.0.2 (strict `inject` guards — optional seams now resolve through `ctx.get`), and `@deepseek-ai/dsh-llm`'s `CallId` was renamed `ToolCallId` — a rename the community plugin ecosystem (including `dsh-git-worktree@0.7.4`, published for this family) has not caught up with, so every plugin still imports `CallId` and the whole plugin layer fails to load on the new family. A TEMPORARY compatibility alias (`export { ToolCallId as CallId }`) ships in both the vendored source (`vendor/dsh-harness` brand.ts — divergence ledger) and as a pnpm patch on the npm family (`patches/@deepseek-ai__dsh-llm@0.1.2-rc.1.patch`), to be removed when the plugins republish against the renamed surface. `uniterra-provider` and the vendored `@dsh-external/workflow` / `dsh-shortcuts` / `dsh-deep-whale` copies were migrated and re-verified (`dsh-shortcuts`'s `dsh.client.inject` + peers now omit the removed runtime package; `dsh-deep-whale` re-pinned to the v0.1.1 tag declaring `dshCompatibility: 0.1.2rc1`; the profile's pnpm settings now disable `autoInstallPeers` — disjoint pre-release families cannot co-resolve in one tree, and only peers can be auto-installed into a conflict).
- **Built-in plugin versions refreshed** to the current `0.1.2-rc.1`-family releases: `dshmarket` 1.21.2 → 1.41.0, `dsh-notifier` 0.8.6 → 0.9.0, `dsh-better-sidebar` 0.15.2 → 0.18.0, `dsh-computer-use` 0.1.0 → 0.2.0. The others (`dsh-file-upload`, `dsh-find-plugin`, `dsh-subagent-model-picker`, `dsh-tool-git`, `dsh-browser-playwright`) are already at their latest.
- Pipeline workflow capsules (`minDshVersion` / `dshVersion`) regenerated for the new family; docs, pin ledgers (`vendor/dsh-harness/VENDOR.md`, `vendor/dsh-plugins/VENDOR.md`), README, `docs/`, and `AGENTS.md` updated.
- App version bumped to `0.15.0` (root / CLI / desktop), provider `0.1.4`, skills `0.5.1`.

## [0.14.12] — 2026-09-03

### Fixed

- **`run_workflow` was denied without asking the user in Code Mode (the PTC agent preset)** (`@dsh-external/workflow`, vendored patch). Two root causes fixed: (1) the approval gate keyed on the session's approval-policy knob instead of the sandbox-mode knob the `/permission` presets actually switch — a `danger-full-access` session whose policy still said `ask` ran the gate and the run was auto-rejected/raced away; `needsApproval` now resolves the session's sandbox mode (`danger-full-access` → the approval step is skipped entirely; `read-only` / `workspace-write` → the user's approval popup), with the policy-based behaviour kept only as the no-sandbox-seam fallback. (2) the run controller permanently forwarded the launching tool step's signal; in Code Mode that signal IS the `run_code` controller, aborted the moment the model's program settles ("run_code settled"), so a background launch (`wait: false`) had its still-pending approval ask settled as `cancelled` ("workflow approval cancelled" — no user prompt) or an already-running fan-out cancelled ~100 ms after start; the run handle now exposes `detach()`, invoked when a launch is handed to the DSH job system, so the run and its pending approval outlive the tool step — synchronous launches keep the binding so cancelling the parent turn still cancels the workflow. Regression net: `packages/uniterra-desktop/test/workflow-engine-approval-mode-pbt.test.mjs` + `workflow-engine-detach.test.mjs`; ledger and conventions updated (`vendor/dsh-plugins/VENDOR.md`, `docs/modules/vendor-plugins.md`, `docs/conventions.md`).

## [0.14.11] — 2026-09-01

### Changed

- **App-wide working rules reworded to plain positive phrasing** (`packages/uniterra-systemprompt`). The 12 injected rules now state what to do instead of what not to do: rule 1 "use plain text in replies — leave emoji out of every message", rule 6 "keep the change scoped to the task" (unrequested refactors stay out), rule 8 "write exactly the code the user's requirements need", rule 9 "write only what you have verified against real documentation", and rule 12 keeps the background-tool start-then-STOP rule but points the meantime at independent work. The rule test suite was extended to pin the new phrasing with dedicated tests for the scoped-change and external-API-verification rules.
- **Pipeline skill contracts reworded to positive phrasing** (`packages/uniterra-skills`). The `uniterra-plan` / `uniterra-implement` / `uniterra-review` / `uniterra-simplify` skills replace "Do NOT / never" negative directives with positive statements ("Use uniterra-implement to execute a plan…", "Leave the plan as it is — author tests and tasks, not a new plan document", "Start from the allocated failing test as the acceptance target and extend it", "Keep a pass verdict over a cosmetic-nit report", "Finish with the `structured_output` call — that call is the result"). The four workflow capsules (`plan-review` / `implement` / `review` / `simplify`) were regenerated from the reworded templates.
- Project docs and conventions (`docs/`, `AGENTS.md`) describe the reworded rules and skill contracts.

## [0.14.10] — 2026-08-31

### Fixed

- **Workflow runs were aborted after 1 h by the engine's whole-run wall timeout** (`@dsh-external/workflow`, vendored patch). `scriptWallTimeoutMs` defaulted to `3_600_000` (1 h), armed as the wall deadline of the WHOLE restricted script — including the time `run(wf, args)` spent awaiting subagents. A long multi-agent fan-out therefore hit "system timeout" while its children were still working: the deadline fired `engine.stop(runId, 'workflow script timed out')`, cancelled every still-running child, and `run_workflow(..., { wait: true })` surfaced a `stopped` run with `workflow script timed out after 3600000ms`. The default is now 8 h (`28_800_000`, in both the schema `z.default` and the `resolveConfig` fallback), so an unconfigured profile gets a wall limit that covers legitimate long runs; the limit stays overridable per profile via the plugin config. Regression net: `packages/uniterra-desktop/test/workflow-wall-timeout-default.test.mjs` (`scriptWallTimeoutMs default is at least 8 hours` + fallback-agreement). Documented in `vendor/dsh-plugins/VENDOR.md`.

## [0.14.9] — 2026-08-29

### Added

- **Three-layer, all-PBT review** (`packages/uniterra-skills`). The `uniterra-review` review agent now models and proves THREE verification layers, every one by property-based tests — (1) **intra-module**: the module's own business logic + lifecycle (state / transition / composition / lifecycle / data invariants via random operation-sequence PBT); (2) **interaction**: the module × each counterpart's contract (emit/accept compatibility, event order, ownership, error propagation) with the counterpart mocked to its contract and its states injected; (3) **integration**: the system slices involving the module with the external world mocked (fs / network / env / clock) — end-to-end no loss / no duplication, leak-free teardown, restart/replay correctness, failures injected at any point. Pure business-rule functions retain oracle-backed properties (inverse / round-trip, reference-implementation differential, algebraic laws, relationally complete contracts, purity laws). "All verification by PBT" is a hard rule; the only exceptions are the security checklist's inherently non-property items (a hardcoded secret, a known-vulnerable dependency).
- **Review knowledge split into responsibility-separated reference files** (`packages/uniterra-skills`). `uniterra-review` now organizes its knowledge as `references/review-agent.md` (core operating manual: mission, anti-bias, three-layer spine, rules, severity, output), `references/model-construction.md` (module / counterpart / system-slice models), `references/invariant-taxonomy.md` (invariant kinds per layer + data oracles + security), `references/test-patterns.md` (sequence / environment-mock fault-injection / input-generating patterns + purpose-naming + >10k background run + shrink), plus the existing fix / main / security-checklist files; `SKILL.md` documents each file's responsibility. The capsule generator composes the one self-contained `REVIEW_PROMPT` from these files at build time (a missing/empty reference fails the build loudly) and the fixer prompt from `references/fix-agent.md`, so `run_workflow('review', { task })` always ships the full knowledge into the agent context with no runtime path lookup; the historical `assets/workflow-template.md` was trimmed to a migrated pointer doc.

### Changed

- README and module docs describe the three-layer review.

## [0.14.8] — 2026-08-29

### Added

- **Whole-business-model review** (`packages/uniterra-skills`). `uniterra-review` no longer cherry-picks suspicious paths: the review agent models the WHOLE business logic + lifecycle of the modules in scope — every public operation, every state, happy paths included — into a formal spec table (state / transition / composition / lifecycle / data / security invariants) and proves it with model-based PBT (random operation sequences, asserted after every step and at teardown/restart) plus input-generating properties. Pure business-rule functions get oracle-backed properties (inverse/round-trip, reference-implementation differential, algebraic laws, relationally complete contracts, purity laws) while trivial helpers get cheap structural checks; a DISCRIMINATIVE gate forces every property to be one a deliberately wrong implementation would fail. The method maps per software type (backend / desktop-UI / CLI / data-schema / CI) and states its boundaries: measured performance and liveness are acceptance-suite territory (maintainer-defined targets), pixel correctness is QA's domain, deterministic complexity smells stay review findings.
- **Minute-second implement run dirs + per-project task.json** (`packages/uniterra-skills`). `init_task.mjs` is now `node init_task.mjs <project-name> <task-id> <task-name> [timestamp]` and scaffolds `.dsh/<YYYYMMDD-HHmmss>/<project-name>/<task-name>.md`; the task manifest (`task.json`) lives INSIDE the project directory, so multiple projects under one timestamp never overwrite each other.

### Changed

- Project docs and conventions (README, `docs/`, skill docs) describe the new implement layout and the whole-model review — hidden-state hunt, internal composition invariants, pure-function oracle sources, and the out-of-scope boundaries (perf/liveness → acceptance suites, pixels → QA).

## [0.14.7] — 2026-08-28

### Added

- **Workflow prompts require dsh's built-in `structured_output` tool** (`packages/uniterra-skills`). Every pipeline agent prompt — the plan-review reviewers, the `implement` subagents, and the review/simplify review + fix agents — now requires reporting the result via dsh's built-in `structured_output` tool exactly once with the exact schema, and forbids finishing with a plain-text JSON string or a markdown code block. This kills the failure mode where an agent printed the output JSON as a string in its final message (which fell into a slow "structured output repair" path or failed validation). Also fixed: prompt extraction now masks escaped backticks, so the `implement` capsule's FIXED_RULES is no longer silently truncated at `\`owned_files\`;` — the subagents were missing the forbidden-files / strengthen-tests / conventions rules.
- **`plan-review` runs a SINGLE parallel review pass** (`packages/uniterra-skills`). The `plan-review` capsule dispatches the three review agents once — no repair agent, no re-review loop (`maxRounds` removed) — and returns `{ status, pass, passed, failures }`; the main agent applies each failing axis's issues itself and may re-run the review as a fresh, independent single pass.
- **Scaffolding CLIs for the pipeline skills** (`packages/uniterra-skills`). `uniterra-plan` ships `scripts/init_plan.mjs` — scaffold `<repo>/.plan/<YYYYMMDD>/<plan-name>/` with the `prd.md` / `design.md` / `acceptance.md` templates the agent fills in. `uniterra-implement` ships `scripts/init_task.mjs` — scaffold `.dsh/<YYYYMMDD>/<task-name>/task.md` per task and maintain the run's `tasks.json` manifest, so the agent fills in placeholders and dispatches; the skill also states explicitly that NO separate plan document is written.
- **`wf.readFile` on the workflow API** (`@dsh-external/workflow`, vendored patch). The engine exposes `wf.readFile(path)` — repo-relative, workspace-contained, UTF-8, `WorkflowControlError` on escape / ENOENT — so a capsule can inline a file's content into a subagent prompt. The `implement` capsule uses it to inline each task's brief (the subagent does not read the file itself) while `run_workflow` args stay tiny (paths, not briefs). Regression net: `packages/uniterra-desktop/test/workflow-engine-readfile.test.mjs`.
- **Background-tool wait rule** (`packages/uniterra-systemprompt`). Working rule 12: after starting a background subagent/job, stop and wait for the completion notification instead of polling or sleep-waiting to burn tokens — use the meantime for independent work, else end the turn and let the notification wake the agent.

### Changed

- Project docs and conventions (README, `docs/`, AGENTS.md) now describe the single-pass plan review, the scaffolding CLIs, the inlined subagent briefs, and the `structured_output` reporting requirement.

## [0.14.6] — 2026-08-28

### Fixed

- **Workflow agents were truncated by an absurdly small output-token ceiling** (`@dsh-external/workflow`, vendored patch). The plugin's built-in model tiers defaulted `maxTokens` to 4_096 (`fast`) / 8_192 (`balanced`) / 16_384 (`deep`). Every `run_workflow` child without an explicit `maxTokens` resolved to the `balanced` tier and was handed `agentOptions.maxTokens = 8_192`, which the provider forwards verbatim as `max_output_tokens`. A reasoning-heavy child — e.g. the review workflow's FIXER AGENT — spent the whole 8_192 ceiling inside one giant chain-of-thought trace, and the upstream gateway ended the response as `response.incomplete` → `INCOMPLETE` ("response not completed"). Normal subagent/main-agent calls never route through the plugin's `modelTiers`, so they use the model's real default and are not truncated — which is exactly why the failure only ever appeared on workflow agents. All three tier ceilings are now the model's real max output (384_000), so a workflow agent is never capped below the model's own capability. Regression net: `packages/uniterra-desktop/test/workflow-tier-defaults.test.mjs` (`{fast,balanced,deep}MaxTokens default ceiling is not artificially small`). Documented in `vendor/dsh-plugins/VENDOR.md`.

## [0.14.5] — 2026-08-28

### Changed

- **Adversarial tests are named by test purpose** (`uniterra-review`). The review agent and the fixer now name every property test and deterministic regression after the TEST PURPOSE it pins — the guarantee the test enforces — never a finding id, a placeholder, or a where-only label, so a maintainer sees at a glance what it tests. An at-a-glance gate requires each name to state the property it enforces, and the property test + its minimal-input regression share the same purpose-named title. The main agent's aggregation adds a naming gate that flags any hidden-meaning test.

### Fixed

- **`run_workflow('implement', …)` args were frequently malformed** (`packages/uniterra-skills`). Each task's full markdown brief was embedded inline in the `args` JSON, which the model often corrupted (`invalid arguments: "arguments" must be an object`) or degraded to a silent `{ status: 'done', agents: 0 }`. Tasks now carry only `{ id, name, promptFile }` — a repo-relative path to a file holding the task brief, which the subagent reads with the `read` tool. The `implement` capsule requires `promptFile` and fails loudly when a task lacks it. Convention synced across `AGENTS.md`, `docs/conventions.md`, `docs/workflows.md`, `docs/modules/uniterra-skills.md`, `README.md`.

## [0.14.4] — 2026-08-27

### Fixed

- **Pipeline workflow agents were read-only** (`packages/uniterra-skills`). The `plan-review` / `review` / `simplify` workflows spawned their review/planner agents with `readOnly: true`, which makes the `@dsh-external/workflow` engine hand the child a read-only `toolFilter` allow-list (`read`/`glob`/`grep`/`lsp`/`skill`/`web_search` only). Those agents therefore never inherited the parent agent's write tools and could not write the code/tests that prove their conclusion — the reported "workflow agent did not inherit the main agent's toolset". All four pipeline workflows are write-capable by design; every `runAgent` now sets `readOnly: false`, so each child inherits the full parent toolset with no read-only restriction. Regression net: `packages/uniterra-skills/test/workflow-templates.test.mts` (`every pipeline workflow agent is write-capable (no readOnly:true runAgent)`).

## [0.14.3] — 2026-08-27

### Fixed

- **Vendored-plugin patch not propagating to existing profiles** (`packages/uniterra-desktop`, `@dsh-external/workflow`). The desktop detected a copy-based built-in as stale by comparing ONLY the `package.json` `version`. A customized vendored plugin hand-edited under the SAME version — the `@dsh-external/workflow` full-access approval patch, version stayed `0.1.3` — was therefore never re-provisioned: on update the profile kept running the OLD workflow engine, so `run_workflow` was still denied (`"workflow approval rejected"` under the `never`-approval policy). `copyEntryStale` now also compares the SHA-256 bytes of the implementation files the source and installed copy share (ignoring `package.json`/`node_modules`/`.git`), so a content-only local patch propagates into an already-provisioned profile on its next launch. The fingerprint compares only shared files: an earlier full-source-dir comparison marked an already-matching copy stale and failed the release gate (`scripts/verify-cli-container` STALE_DETECTION), which is corrected here. Regression net: `packages/uniterra-desktop/test/builtin-pbt.test.mjs` (`STALE regression: a customized copy with the SAME version but DIFFERENT content is stale`).

## [0.14.1] — 2026-08-27

### Added

- Vendoring convention: we vendor a plugin **only because we customize it** (edit its copied source in place). A plugin we do not modify stays a `node_modules`/npm import. The divergence + pending-upstream note is recorded in the `vendor/dsh-plugins/VENDOR.md` pin-ledger row (a **LOCAL PATCH** note). Synced across `AGENTS.md`, `docs/conventions.md`, `docs/modules/vendor-plugins.md`, `docs/workflows.md`, `README.md`.

### Fixed

- **Full-access mode workflow failure** (`@dsh-external/workflow`, vendored patch). When the DSH session's effective approval policy is `never` (the `danger-full-access` / no-approval-preset mode), `run_workflow` for a `capability-generated` / `trusted-local` workflow was DENIED before any child started: the workflow engine's static `approvalMode` gate still requested approval, and the DSH approval service auto-rejects every request under `never` (fail-closed). `DynamicWorkflowEngine.needsApproval` now honors the live session approval policy — a `never` session runs a workflow ungated. Regression net: `packages/uniterra-desktop/test/workflow-engine-approval-pbt.test.mjs` (PBT + deterministic anchors, via `workflow-engine-stub-loader.mjs`). Documented in `vendor/dsh-plugins/VENDOR.md`.

## [0.14.0] — 2026-08-27

### Added

- Rebuild the four pipeline workflows (`uniterra-plan` / `uniterra-implement` / `uniterra-review` / `uniterra-simplify`) as persisted `dsh_workflow` capsules (`src/skills/<skill>/workflows/*.workflow.json`, `format: dsh.workflow`). The skills now invoke them by name via `run_workflow('<name>', args)` — no more copying a large JS block into the `workflow` tool, which removes the milestone's copy-failure failure mode.
- `@dsh-external/workflow` (v0.1.3) is now a vendored built-in exposing `workflow_list` / `run_workflow` / `workflow_manage`; `ensureWorkflowCapsules` provisions the bundled capsules into the profile's `$DSH_HOME/workflows` at boot (byte-idempotent). `quickjs-emscripten@0.32.0` is installed as a profile runtime dependency (the copy-based mechanism cannot auto-install it).

### Changed

- `uniterra-review`: the fixer now adds a DETERMINISTIC unit regression test per counterexample (a concrete minimal input + the exact outcome the invariant requires), so the bug is instantly reproducible without RNG — those deterministic regressions are permanent. The review agent's property tests remain.
- The workflow-capsule orchestration is now pinned by `test/workflow-(templates|orchestration-pbt|orchestration-regressions).test.*` and `test/workflow-capsule-provision-pbt.test.mjs`.

## [0.13.2] — 2026-08-25

### Changed

- `uniterra-review`: the review agent is now injected ONLY the review scope (`args.task`) — the orchestrator's goal / requirements / design / acceptance framing is removed from its prompt, and the main agent no longer pre-reads or re-summarizes the code (it only names the scope), so the review is not polluted by the main agent's reading before it starts. Security is a mandatory axis: the review agent runs the security checklist (`references/security-checklist.md`) and proves each applicable security property with a property-based test (non-property items checked deterministically), so logic security is verified via PBT, not just correctness — a security hole is critical. Read all business logic in one pass, write all tests in one pass, run them together in a background job (> 10,000 runs). Docs (`README.md`, `docs/modules/uniterra-skills.md`, `docs/project-structure.md`, `docs/workflows.md`) synced.

## [0.13.1] — 2026-08-25

### Changed

- `uniterra-review`: the workflow script now orchestrates only two subagents (review → fix) — there is no in-workflow main-agent step. The fixer reports straight back to the main agent, which aggregates the counterexamples + fixes by severity (critical / medium / low) and states which logic is wrong, why, and the user impact, **without ever re-running the property tests** (the review agent already ran them > 10,000 runs each and the fixer re-confirmed its fixes). The review agent now reads all business logic in one pass, writes all the property tests in one pass, then runs them together in a **background** terminal job (> 10,000 runs) — so execution is faster and does not time out the turn. The review agent follows the repo's own test + property-testing stack and conventional test location (no forced framework). Docs (`README.md`, `docs/modules/uniterra-skills.md`, `docs/project-structure.md`, `docs/workflows.md`) synced.

## [0.13.0] — 2026-08-25

### Added

- `uniterra-review`: new `references/main-agent.md` aggregator prompt.

### Changed

- `uniterra-review`: reworked into a **property-based 3-agent workflow** (review → fix → aggregate) running in a single pass (the re-review loop is removed — a >10,000-run PBT per invariant is a statistically strong proof). The review agent reads the business modules in scope, extracts each conditional branch's pre/post-conditions and invariants into a formal specification table, writes a property test per invariant in the repo's existing test + property-testing stack and conventional test location (never assumes fast-check or a test dir), executes >10,000 runs, and shrinks every counterexample into a structured error report (file, line, input, expected/actual). The fixer repairs each reported branch and re-runs its counterexample green, returning a diff + result + explanation; the main agent aggregates every counterexample + fix by severity (critical / medium / low), stating which logic is wrong, why, and the user impact. References/security-checklist.md is now an optional invariant focus list.

## [0.12.0] — 2026-08-24

### Changed

- Upgraded the bundled DeepSeek Harness (dsh) runtime and every `@deepseek-ai/dsh-*` client/SDK package from the `0.1.0-rc.6` family to `0.1.1-rc.2` across the desktop shell and `uniterra-provider` — all still pinned exact (no caret) — and refreshed the workspace lockfile.
- Raised the pinned dsh plugin-add builtins to their current published versions (`dshmarket` 1.9.0 → 1.21.2, `dsh-notifier` 0.6.2 → 0.8.6, `dsh-better-sidebar` 0.12.2 → 0.15.2, `dsh-file-upload` 0.4.2 → 0.4.3, `dsh-find-plugin` 0.3.6 → 0.3.7) and widened the `minimumReleaseAgeExclude` set to match.
- Re-pinned the vendored plugins to commits targeting the `0.1.1-rc.2` family per the `VENDOR.md` bump policy: `dsh-deep-whale` → `d3d7ff2b…` (`skin.json` now declares `dshCompatibility: 0.1.1rc2`) and `dsh-shortcuts` → `bf392410…` (v1.1.4); the pin ledger and docs rows updated.

## [0.11.12] — 2026-08-22

### Changed

- `uniterra-implement`: consolidated the orchestration into a **single fixed workflow script** (`assets/workflow-template.md`, copied verbatim), matching the structure that already makes `uniterra-plan` / `uniterra-review` / `uniterra-simplify` reliable. The script branches on `args.tasks` (flat, full parallel) vs `args.batches` (array of task arrays, serial batches) — both shapes, one script; the agent only fills `meta` + `args`. `references/parallel-workflow.md` and `references/batched-workflow.md` are now decision guides only; `assets/workflow-script-example.md` is removed (its shared blocks are inlined).
- The four pipeline workflow skills now instruct the dsh `workflow` tool as **ONE call** — `meta` + `script` + `args` as three properties of one `arguments` object, never split across parallel calls (each partial call fails `missing required property "meta"/"script"`) and never wrapped under an `arguments` field (fails `"arguments" must be an object`). Subagent reports to the workflow are JSON via the `schema` option on each `agent()` call; only the subagent input prompt is text. Docs (`docs/modules/uniterra-skills.md`, `docs/conventions.md`, `docs/workflows.md`) synced.

## [0.11.11] — 2026-08-22

### Changed

- The four pipeline workflow skills (`uniterra-plan` / `uniterra-implement` / `uniterra-review` / `uniterra-simplify`) instructed the `workflow` tool with `meta`, `script`, and `args` as three comma-separated sibling items. The agent model read that as three separate tool calls and split them into parallel invokes, each of which failed with `missing required property "meta"/"script"` or `"arguments" must be an object`. The templates now present a single-call `arguments` object and explicitly forbid splitting across parallel calls or wrapping the three in an `arguments` field.
- `uniterra-implement`: the task list is flattened — each task now carries a pre-rendered markdown `prompt` (goal/context/requirements/conventions/constraints) instead of a deeply nested JSON object, since the deep nesting is what corrupted the tool-call arguments. Subagent reports to the workflow remain JSON via the `schema` option on each `agent()` call.

## [0.11.10] — 2026-08-22

### Changed

- `uniterra-skills`: `create-skill` is no longer a bundled skill — removed from the bundled skill registry (the bundled count drops from 10 to 9) and its source is deleted, so fresh installs no longer provision it. Docs and spec (`AGENTS.md`) synced.
- `uniterra-implement`: each dispatched subagent is now instructed to prioritize STRENGTHENING / completing the failing property tests written in the first step — extend the property, add the missing edge cases and invariant asserts — before making them green, rather than writing a brand-new property test from scratch for a requirement that already has an allocated failing test. Aligns SKILL.md and the shared fixed rules in `assets/workflow-script-example.md`.

## [0.11.9] — 2026-08-21

### Added

- `uniterra-plan`: the plan is now confirmed with the user before the automated three-agent review — the workflow reads back `prd.md` / `design.md` / `acceptance.md` with a short summary and asks via `ask_user_question` whether the content is broadly correct and matches the user's needs, applies their edits, and re-shows them until they confirm, then proceeds to review.

### Changed

- `uniterra-desktop`: the Deep Whale skin (`dsh-deep-whale`) is no longer forced on every profile. A new `optional` registry kind and `reconcileOptionalPlugins()` enforce the per-profile `.uniterra.json` toggle at boot: fresh installs never install or activate the skin (optional entries are excluded from the expected bundles and from stale detection, so a disabled skin can't force a re-provision on every boot); existing row-bearing profiles migrate with the skin preserved and persisted as enabled (nothing is deleted); enabled ⇒ bundle row + fresh copy ensured (self-healing to the shipped source), disabled ⇒ row and copy removed idempotently; an illegible toggle file is never destructive and never overwritten. Also removes the legacy `src/profile.ts` (+ its test) and the orphaned `scripts/prepare-runtime.mjs`.

## [0.11.8] — 2026-08-21

### Changed

- `uniterra-plan`: the review workflow no longer stops at "apply the issues yourself and re-run all three". A failing axis's `issues` are handed to a single repair agent that applies them to the documents itself; after a repair, only the axes that FAILED the previous round are re-dispatched — an axis that already passed is never re-reviewed, so the review-agent count shrinks from 3 toward 0 as fixes land. Aligns SKILL.md and `scripts/review-workflow.md` (the plan workflow now embeds the repair agent prompt and tracks a `passed` set per axis).
- `uniterra-review`: the repro agent is merged into the review agent. The review agent now CONFIRMS each finding before reporting it — it writes a failing regression test in the repo's conventional test location (descriptive, invariant-based name, never a finding id) and reports ONLY confirmed findings, dropping unconfirmed ones. It also stops reporting low-value non-logic issues (stale documentation, stale comments, formatting/style nits) and focuses on the code logic itself; each reported finding carries the path of its confirming test. The workflow is now review → fix → re-review (no separate repro stage). Aligns SKILL.md, the review-agent prompt, the fix-agent prompt, and the workflow template; `references/repro-agent.md` is removed.

## [0.11.7] — 2026-08-21

### Fixed

- `uniterra-review` and `uniterra-simplify`: the review agents could never let a review through — the workflow loop kept forcing repro → fix rounds on any finding or recommendation, however minor, so a single low-severity nit or cosmetic suggestion blocked the pipeline. Each review agent now returns a verdict (`pass` | `fail`) alongside its findings / recommendations: `pass` means the code is ready — no findings, or only low-severity non-blocking ones — and ends the loop immediately, returning those items with the result instead of fixing them; `fail` means at least one finding (medium or above for `uniterra-review`) or recommendation with real simplification value (for `uniterra-simplify`) goes to repro / fix. Aligns SKILL.md, the review-agent prompts, and the workflow templates.

### Added

- Workflow-template contract tests now also lock the pass-verdict short-circuit: a review agent's `verdict: "pass"` ends the review / simplify workflow as `done` with the non-blocking items returned, and no repro / fix round runs (`packages/uniterra-skills/test/workflow-templates.test.mts`).

## [0.11.6] — 2026-08-21

### Fixed

- Bundled pipeline skills (`uniterra-plan` / `uniterra-implement` / `uniterra-review` / `uniterra-simplify`): the workflow templates only instructed the `workflow` tool's `args` — the REQUIRED `meta` parameter (`name` + `description`) was never mentioned, so a workflow submitted straight from a template failed tool-call validation before the script ran, and `uniterra-implement`'s examples hinted at meta only in a `// meta:` comment inside the script (a step away from the `export const meta` body dsh rejects with `SCRIPT_PARSE`). Every template now spells out the full submission (`meta` + `script` + `args`) and warns that dsh rejects any meta field beyond name/description/whenToUse/phases (`META_INVALID`).

### Added

- Regression lane `packages/uniterra-skills/test/workflow-templates.test.mts` locking the templates to the dsh `workflow` tool contract: every embedded script parses under dsh's `(async () => { body })()` wrapper, no body opens with `export const meta`, every template instructs the `meta` parameter, and the single-script templates execute to a terminal JSON result under stubbed hooks. The contract is documented in `AGENTS.md`, `docs/conventions.md`, `docs/modules/uniterra-skills.md`, and `docs/workflows.md`.

## [0.11.5] — 2026-08-21

### Fixed

- `uniterra-provider`: the harness-selected reasoning effort was dropped at serialization — the effort selector had no effect on the wire. Chat Completions now carries `reasoning_effort`, Responses carries `reasoning: { effort }`, both passed through verbatim.
- `uniterra-provider`: a catalog row without an explicit `defaultReasoningEffort` defaulted to the highest declared rung (`max` when available), which over-thinks routine tasks. The default is now `high` when the model offers it (the officially recommended default across DeepSeek and Anthropic), with the settings-page dropdown mirroring the same preference.
- `uniterra-systemprompt`: the app-wide working rules now frame thinking as a cost — reason only far enough to set direction, then verify conclusions against the real system (run code, read files, execute tests, query APIs) and correct them from the evidence; a conclusion the evidence contradicts is a dropped hypothesis, not a defended fact. Output rules are tightened to essentials only (outcome, evidence, next step), cutting filler and process recap.

### Changed

- `uniterra-review`: the repro stage no longer spawns one agent per finding in parallel — a single repro agent now pins ALL findings of a round and returns one result entry per finding (un-reproducible findings stay invalid and dropped). The repro tests are promoted to formal source code that stays in the repo as permanent regression coverage: each failing test goes to the repo's conventional test location (the package's `test/` dir, picked up by its `test` script) with a descriptive, invariant-based name — never a finding id — matching the package's test framework and lint conventions, so a verified finding keeps its regression test after the fix instead of a throwaway `f1-*` file. Existing regression tests for an invariant are re-run rather than duplicated. Aligns SKILL.md, the repro-agent prompt, and the workflow template.

## [0.11.3] — 2026-08-21

### Changed

- `uniterra-simplify`: the plan's `design` context is now an AUTHORITATIVE constraint for both workflow agents. The review agent only proposes simplifications that preserve the architecture and engineering needs stated in the design (module boundaries, layers, interfaces, data shapes, testability, observability, security, error handling, performance, extensibility) — design-mandated machinery (a layer, interface, config flag, guard, or error path) is not over-engineering and is never flagged, and the over-engineering checklist applies only where the design is silent. The fix agent receives the Design block too and refuses (skipped with reason `violates design`) any recommendation that contradicts it. Aligns SKILL.md, the review/fix agent prompts, the checklist, and the workflow template.

## [0.11.2] — 2026-08-21

### Fixed

- CI: all four GitHub Actions in the workflows (checkout / setup-node / cache / pnpm-action-setup) targeted the deprecated Node 20 action runtime, which the runner force-runs on Node 24 with no compatibility guarantee — on the v0.11.1 release the `verify-windows-install` job's setup-node post-run cache save failed with "Path Validation Error" (the Windows verification itself passed, but the gate blocked the release). The actions are upgraded to their Node-24-native majors (checkout v7, setup-node v7, cache v6, pnpm-action-setup v6), and the Windows job now pins the pnpm store to the runner temp volume before setup-node runs, so the cache path it computes (`pnpm store path`) always matches the store that installs actually use.

## [0.11.1] — 2026-08-21

### Changed

- `verify-windows-install` replays the closer-to-real user flow instead of the always-copy `--source` dev path (issue #3): the job first relocates the fresh checkout onto the TEMP volume (the runner workspace is on another volume, `D:\a`, so without this every embed would cross volumes), then the new `--move-source` opt-in lets the disposable checkout be embedded via the same same-volume rename a downloaded release source gets — dropping the full-tree robocopies that were ~96% of the job's ~18 min. The install-destination dir (`%LOCALAPPDATA%\Programs`) is added to the runner's Defender exclusions so the final `copyInstalled` rename no longer degrades to a robocopy fallback under AV locks; the junction re-point (`remapJunctionTarget`) is now exercised end-to-end by the gate (a moved tree preserves pnpm junctions, which a robocopy-materialized tree never did). `embedStrategy(platform, downloaded, moveSource?)` and `parseArgs` (`--move-source` requires `--source`) are PBT-locked.
- `uniterra-simplify`: a fix round now applies EVERY recommendation — `risky` ones go through a test-first equivalence gate (behaviour pinned with property/equivalence tests before the change, kept green after; revert with evidence otherwise) instead of being skippable, and skipped items accumulate across rounds as `{ id, reason }` so the reviewer always sees the full skip history.

## [0.11.0] — 2026-08-20

### Changed

- Redesigned the four bundled pipeline skills (`uniterra-plan` → `uniterra-implement` → `uniterra-simplify` / `uniterra-review`) from an `execution-plan.json`-centric subagent pipeline to workflow-based agent orchestration. `uniterra-plan` writes `prd.md` / `design.md` / `acceptance.md` and reviews them with three parallel agents (feasibility, over-engineering, verifiable acceptance); `uniterra-implement` decomposes into a task list and runs a batched / full-parallel workflow of subagents (each returning structured changed-files / satisfied-requirements / deviations); `uniterra-review` loops review → repro → fix with findings graded critical/high/medium/low and pinned as failing property tests; `uniterra-simplify` loops review → fix against an over-engineering checklist. `execution-plan.json` is no longer produced or consumed.

### Added

- `uniterra-review`: a 12-item code-security checklist (injection, prompt injection, IDOR, SSRF, insecure deserialization, broken auth/JWT, hardcoded secrets, weak crypto/randomness, path traversal, information disclosure, TOCTOU races, insecure dependencies).
- `uniterra-simplify`: a 10-item over-engineering checklist (unnecessary abstraction, premature generalization, design patterns for their own sake, premature architecture, premature optimization, speculative features, excessive defensiveness, reinventing the wheel, boilerplate ceremony, copy-paste drift).

## [0.10.1] — 2026-08-19

### Changed

- Declarative built-in plugin registry: the four parallel built-in constants (`BUILTIN_NPM_PLUGINS`, `BUILTIN_VENDOR_PLUGINS`, `BUILTIN_WORKSPACE_PLUGINS`, `RETIRED_BUILTINS`) and the two staleness helpers (`vendoredPluginsStale` / `workspacePluginsStale`) are replaced by one kind-aware `registerBuiltinPlugin()` registry; `copyBuiltinsStale()` unifies vendored/workspace staleness (content identity for vendored, version for workspace copies), and retirement is now a registry flag healed by `removeRetiredBuiltins()`. The built-in set itself is unchanged.

### Fixed

- Pre-rename leftovers in existing profiles: the rename shipped the same provider and skills under new names, but old profiles kept loading BOTH — `RETIRED_BUILTINS` now heals `@cardo/cardo-provider` (removed alongside its bundle row), and the skills provisioner now removes the retired `cardo-*` skill dirs (`cardo-plan`, `cardo-implement`, `cardo-simplify`, `cardo-review`, `cardo-pbt-debugging`, `cardo-qa`, plus legacy `cardo-planmode` / `qa`) so `uniterra-*` is the only copy left
- Windows install shipped dead pnpm junctions — the desktop showed no window and exited silently after the 60 s readiness timeout: `uniterra setup` embedded the source via robocopy/rename, which preserve pnpm's absolute junction targets verbatim, so every `.pnpm` link pointed at the deleted staging dir and dsh boot died with `ERR_MODULE_NOT_FOUND`. The installer now re-points junctions after embedding (`remapJunctionTarget`), and the desktop surfaces startup failures to `userData/startup-error.log` plus a first-boot error dialog instead of quitting silently

## [0.9.0] — 2026-08-18

### Changed

- **The Deep Whale skin (`dsh-deep-whale`) is now an optional plugin** instead of a forced built-in: fresh installations no longer install or activate it. The desktop reads the profile's `.uniterra.json` toggle (`{"version": 1, "optionalPlugins": {"@dsh-external/dsh-client-ui-skin-maid-atelier": true}}`) at every boot and provisions the skin only when enabled — disabling removes the bundle row and the installed copy. Profiles that already carry the skin (no toggle file yet) migrate automatically: the row is preserved and persisted as enabled, nothing is deleted. An illegible toggle file is never destructive and never overwritten. The registry's new `optional` kind (`reconcileOptionalPlugins()` in `packages/uniterra-desktop/src/builtin.ts`) owns the whole lifecycle; `copyBuiltinsStale()` now ignores optional entries so a disabled skin never forces a re-provision on boot. Enabled optionals still self-heal to the shipped source version.

### Removed

- `packages/uniterra-desktop/src/profile.ts` and its test (`profile.test.mjs`): legacy profile-bootstrap constants that contradicted the live `builtin.ts` registry and were never imported at runtime.
- `packages/uniterra-desktop/scripts/prepare-runtime.mjs`: orphaned since the 0.5.0 `vendor/dsh-runtime` model — no script, CI step, or boot path referenced it, and the output directory no longer exists.

- **Project renamed from Cardo to Uniterra.** The repository, npm packages (`@uniterra-solutions/cardo` → `@uniterra-solutions/uniterra`), CLI command (`cardo` → `uniterra`), desktop app identity (`Uniterra`, `com.uniterra.uniterra`), provider route (`llm-cardo` → `llm-uniterra`), bundled skills (`cardo-*` → `uniterra-*`), and environment variables (`CARDO_*` → `UNITERRA_*`) all use the new name. The old `@uniterra-solutions/cardo` package remains on npm at v0.8.3 for existing installs; earlier entries in this changelog keep the old names as historical record.

### Fixed

- `@uniterra-solutions/uniterra-provider` still intermittently crashed agent turns in thinking mode with "The `reasoning_text` in the thinking mode must be passed back to the API." (Responses) / "The `reasoning_content` …" (Chat): DeepSeek's thinking mode is all-or-nothing — once any assistant message carried reasoning, every later tool-call turn must carry it too, including turns the model answered with zero reasoning (`reasoning_tokens: 0`). The serializers now (Chat) replay a reasoning block verbatim on every assistant message and emit the empty marker (`reasoning_content: ""`) on later tool-call turns that lack one, and (Responses) emit a `reasoning` item before every tool-call turn — carrying the conversation's most recent actual chain of thought forward when the turn's own reasoning is missing or empty (empty reasoning items are rejected upstream). Locked by two new deterministic regressions plus two seeded property tests; verified live against the gateway (the pre-fix wire shape reproduces the 400, the fixed shape completes)
- `@uniterra-solutions/uniterra-provider` bumps 0.1.2 → 0.1.3: the desktop's `workspacePluginsStale()` guard compares the workspace plugin's source vs installed `version`, so existing profiles re-provision the fixed `lib/` on their next launch

## [0.8.3] — 2026-08-18

### Fixed

- `cardo setup` on Windows failed for ordinary users: electron-builder downloaded its `winCodeSign` tool, whose 7z archive contains macOS symlinks (`darwin/*/lib/*.dylib`) that 7-Zip cannot create without Developer Mode or administrator privileges (`SeCreateSymbolicLinkPrivilege`), so packaging aborted with "Cannot create symbolic link" (shown garbled on non-UTF-8 consoles). The Windows build now sets `signAndEditExecutable: false` — Cardo ships unsigned, so the sign + rcedit step (and the `winCodeSign` download it triggers) is skipped entirely, and `app.getVersion()` still reads `package.json`, not the exe resource.

## [0.8.2] — 2026-08-18

### Fixed

- `@cardo/cardo-provider` dropped the prior turn's chain-of-thought when serializing a Responses API tool-call turn back to DeepSeek: `serializeInput` emitted the `function_call` items but no `reasoning` item, so a multi-turn agent loop in thinking mode failed with "The `reasoning_text` in the thinking mode must be passed back to the API." Every assistant turn (tool-call and non-tool-call) now emits a `reasoning` item before its `function_call` items / assistant message, locked by a new deterministic regression plus a seeded property test (`test/reasoning-preservation.test.mjs`).

## [0.8.1] — 2026-08-18

### Added

- `cardo setup` now downloads the release's prebuilt source asset (`cardo-src-<tag>.tar.gz`) when the release carries one — the release workflow builds the workspace on Linux (tsc/esbuild output is platform-independent, so one asset serves macOS and Windows) and uploads it. When the source carries the `.cardo-prebuilt` marker, the CLI skips `pnpm run build`, cutting install time; releases without the asset fall back to the auto-generated archive and build as before.
- pnpm self-provisioning: when `pnpm` is not on `PATH`, the CLI fetches the exact version pinned by the source tree's `packageManager` field via `npx pnpm@<pin>`, so installs no longer fail on machines without a global pnpm.

### Changed

- A downloaded Windows source is embedded into the packaged app via a same-volume rename (instant, with a `robocopy` fallback on `EXDEV`/`EPERM`) instead of a full `robocopy` copy; `--source` checkouts are still copied and never moved away from the user's tree.

### Fixed

- Subprocess failures now surface their stderr and exit code (e.g. electron-builder's binary-download error) instead of only "Command failed: …", which hid the real reason a `cardo setup` failed.

## [0.8.0] — 2026-08-17

### Changed

- Split the `cardo-planmode` skill into four pipeline skills: `cardo-plan` (clarify → PRD/design subagents → execution-plan.json with an explicit per-task `requirements` list → approval), `cardo-implement` (PBT-first: simple tasks inline — invariants → failing property tests → code; complex tasks write ALL failing property tests then run a batched/full-parallel dynamic workflow chosen by task overlap), and `cardo-simplify` / `cardo-review` (scope-bound fix ↔ review loops — each usable standalone with just an explicit review scope). `provisionBuiltinSkills()` now removes the retired `cardo-planmode` from already-provisioned skill dirs.
- Renamed the `qa` skill to `cardo-qa` (the retired `qa` is removed from already-provisioned skill dirs) and split its workflow into two pipelines: UI apps verify DOM geometry with the playwright-backed browser tools, pixel-analyze screenshots of every key state, then operate the UI via external tools (computer-use etc.) or playwright end-to-end when none exist; pure backend apps replay the full install + smoke-boot flow inside a clean container before API/CLI journeys.
- Removed `dsh-lan-gateway` from the profile spec (`packages/cardo-desktop/src/profile.ts`), the packaged runtime deps (`prepare-runtime.mjs`), and the root `pnpm-workspace.yaml` `minimumReleaseAgeExclude` — it was never part of the built-in set in `builtin.ts`.
- `cardo update` is now the one-command full update: it refreshes the CLI itself first (`npm install -g @uniterra-solutions/cardo@latest` — fail fast before the long build), then rebuilds + reinstalls the desktop app exactly like `cardo setup` and relaunches it (unless `--no-open`). The stage plan is pure and PBT-locked (`installPlan` in `packages/cardo-cli/src/install-logic.ts`), so users never need a separate `cardo setup`.
- Desktop Update Now closes the app and spawns the updater detached before quitting; `cardo update` relaunches the app when it finishes — the relaunch IS the restart. The prompt-response → action mapping and the spawn spec are pure and PBT-locked (`resolveUpdateAction` / `updateInvocation` in `@cardo/cardo-updater`): the default invocation runs `npx --yes @uniterra-solutions/cardo@latest update`, so the LATEST updater executes even on machines whose global `cardo` CLI predates the one-command update. The clean-container verification (`scripts/verify-cli-container/verify.sh`) now smoke-tests `cardo update --dry-run` (offline, deterministic).

### Removed

- Retired four built-in plugins whose function overlaps another built-in: `dsh-hotkeys` (covered by `dsh-shortcuts`), `dsh-subagent-monitor` and `dsh-git-graph` (covered by dsh-better-sidebar's Tasks/Git pages), and `dsh-thinking-effort` (covered by `@cardo/cardo-provider`'s models.dev reasoningEfforts). The vendored dirs are gone (`vendor/dsh-plugins/` now ships `dsh-deep-whale` + `dsh-shortcuts`), and a new `RETIRED_BUILTINS` heal (`removeRetiredBuiltins()` in `packages/cardo-desktop/src/builtin.ts`) strips their bundle rows, dependency entries, and installed copies from already-provisioned profiles on the next ensure pass.

## [0.7.1] — 2026-08-17

### Added

- Windows installer support (`cardo setup`): platform branches in the CLI — `electron-builder --win --dir` produces the `win-unpacked/` layout (the NSIS installer cannot carry the source embedded afterwards), the source tree embeds under `resources/src`, the app installs to `%LOCALAPPDATA%\Programs\Cardo` with a best-effort Start Menu shortcut, and launches as `Cardo.exe`. Windows file ops use `robocopy /MT:16 /R:5 /W:5` (exit codes 0–7 = success) with a same-volume `fs.rename` fast path that degrades to robocopy on any failure (EXDEV cross-volume, EPERM locked files); the macOS flow is byte-for-byte unchanged. npm/pnpm/cardo ship as `.cmd` shims on Windows: the CLI and the desktop run them with `shell: true` (cmd.exe resolves via PATHEXT) and quote whitespace-bearing args
- `cardo setup --source <dir>`: build from a local workspace checkout instead of downloading a release — the Windows CI verification path
- Windows dsh CLI resolution: `dshCliPath()` resolves the bundled CLI through the `.pnpm` store on Windows (robocopy materializes pnpm junctions, so the junction path cannot resolve dsh's own dependencies)
- Windows install verification (`scripts/verify-windows-install/verify.ps1`): replays the REAL CLI install on windows-latest — install → build → `--win --dir` packaging → embedded source → install + Start Menu shortcut → `Cardo.exe` boot smoke to a reachable readiness URL
- PR CI workflow (`.github/workflows/ci.yml`): parallel lint / typecheck / tests jobs, callable from the release workflow
- Release gate: `release.yml` publishes only after the full matrix passes (CI + clean-container installer replay + windows-latest install verification, all via `needs`)
- CLI platform-seam PBTs: `win-unpacked` discovery, install destinations, builder args, launch targets, and Start Menu shortcut script quoting (`packages/cardo-cli/test/pbt.test.mts`)

### Changed

- Docs restructured to per-package module docs (cardo-cli / cardo-desktop / cardo-provider / cardo-skills / cardo-systemprompt / cardo-updater / vendor-plugins); cross-platform facts updated across the tree
- `AGENTS.md` documents the cross-platform installer and the gated release flow

## [0.6.2] — 2026-08-17

### Fixed

- `@cardo/cardo-provider` silently dropped reasoning (chain-of-thought) content for most real OpenAI-compatible wire shapes. Chat Completions only read `delta.reasoning_content`, losing `delta.reasoning` (OpenRouter-style aggregators) and the terminal-chunk `message.reasoning_content` / `message.reasoning` full-text replay (DashScope compatible mode); buffered gateways that replay `message.content` / `message.tool_calls` with empty deltas lost text and tool calls too. The Responses API translator only read `response.reasoning_text.delta`, losing `reasoning_summary_text.delta/.done`, complete `reasoning` output items, `content_part` reasoning parts, and the authoritative `response.output` array on `response.completed` / `response.incomplete`. Both translators now consume every shape with per-item dedup (no loss, no duplication), locked by per-shape regressions plus seeded randomized properties (`test/reasoning-preservation.test.mjs`)
- The agent loop never replayed previous turns' reasoning on the wire over the Responses protocol: `serialize-response.ts` now emits a `reasoning` input item (`content` + `summary`) before assistant messages, so OpenAI (requires `summary`) and DeepSeek (merges `content`) both keep conversation state
- `@cardo/cardo-provider` bumps 0.1.0 → 0.1.1: the desktop's `workspacePluginsStale()` guard compares the workspace plugin's source vs installed `version`, so existing profiles re-provision the fixed `lib/` on their next launch

## [0.6.1] — 2026-08-17

### Fixed

- Desktop app would not open after upgrading to v0.6.0: the root `build` script (`cardo setup` runs it on every install) did not run the `@cardo/cardo-provider` esbuild step, so the source archive shipped without `packages/cardo-provider/lib/index.js`. The app then copied a broken provider package into the dsh profile and boot died with `ERR_MODULE_NOT_FOUND` (window never appears, app auto-quits after the 60s readiness timeout). Root `build` now emits the provider bundle (`pnpm --filter @cardo/cardo-provider build`).
- The container harness (`scripts/verify-cli-container`) missed this class of regression: it only asserted install/build/dsh-resolution. It now has a provider-bundle dead gate, a pristine build context (`.dockerignore` excludes local `packages/cardo-provider/lib` build artifacts), and a Docker PBT suite (`pbt/provisioning-pbt.test.mjs`) locking provisioning properties (workspace/vendored built-in entry files, `hasAllBuiltins`, staleness detection) plus a real `dsh --profile web` boot to a reachable readiness URL.

## [0.6.0] — 2026-08-17

### Added

- In-house dual-protocol LLM provider plugin `@cardo/cardo-provider` (`packages/cardo-provider/`): OpenAI chat completions **and** Responses API over any OpenAI-compatible gateway (protocol per-model overridable via `api: 'chat-completions' | 'responses'`), with models.dev context-window / output-token / reasoning-effort auto-detection and a Web settings page (gateway + per-model management, models.dev fetch, proxy support). Ships as a **workspace built-in**: `ensureBuiltinPlugins` gained `BUILTIN_WORKSPACE_PLUGINS` (`workspacePluginsStale()` guard), copying the built package into the profile like a vendored plugin — the host bundle is self-contained (runtime deps inlined, only `@deepseek-ai/*` peers external), so no pnpm install is needed
- Built-in npm plugins extended to 10 (adds `dsh-hotkeys`, `dsh-tool-git`, `dsh-browser-playwright`, `dsh-computer-use`); vendored built-ins extended to 5 (adds `dsh-shortcuts`, `dsh-git-graph` — see `vendor/dsh-plugins/VENDOR.md` pin ledger)
- `AGENTS.md` / `README.md` updated to the dsh/cardo architecture (cardo-provider, workspace built-in provisioning, per-package test commands); root `eslint.config.mjs` ignores `**/lib/` alongside `**/dist/` (cardo-provider's build output)

## [0.5.4] — 2026-08-17

### Fixed

- The built-in whale skin now actually loads. The vendored `deep-whale-day-night-theme` distribution patched the `ui-skin-maid-atelier` roster row that only `@deepseek-ai/dsh-client-ui-theme-plugins` provides (absent in the pinned rc.6 family), so the patch was silently skipped and the plugin never mounted — it also depended on the missing `themeCatalog` service and shipped without the `preview/` assets its host reads at import. The built-in now vendors the standalone `dsh-deep-whale#maid-atelier` distribution (same package name `@dsh-external/dsh-client-ui-skin-maid-atelier`, self-inserting patch, no-op host, art embedded as data URIs, preview assets included). `ensureBuiltinPlugins` gained a version-drift guard (`vendoredPluginsStale`): a vendored copy is re-provisioned when its installed `version` no longer matches the vendored source, so profiles that already carry the old bundle row heal on their next launch. Locked by new VENDOR/STALE property-based invariants in `builtin-pbt.test.mjs`
- Built-in skill provisioning now ships every company skill: `SKILL_NAMES` still listed the retired `agentic-debugging` and omitted `cardo-pbt-debugging` and `cardo-planmode`, so provisioning reported a phantom missing-skill failure every run and never copied two of the seven bundled skills (locked by the existing provisioning tests)

### Changed

- Docs: `AGENTS.md` documents the vendored-plugin staleness guard; `vendor/dsh-plugins/VENDOR.md` updates the pin ledger (`dsh-deep-whale`, commit `873f5c6…`) with the retirement rationale

## [0.5.3] — 2026-08-17

### Added

- Desktop built-in provisioning + PBT (`packages/cardo-desktop/src/builtin.ts`): at startup the profile the run uses gets the 6 npm plugins via `dsh plugin add`, the vendored plugins copied under their package names, and the bundled skills via `DSH_BUNDLED_SKILL_DIR`; dsh CLI resolution and readiness fixes
- CLI source-archive install flow: `cardo setup` downloads the release's auto-generated source tarball → `pnpm install --frozen-lockfile` → build → electron-builder package → install to `~/Applications`; no-TTY pnpm install fix; install-logic PBT
- Docker container harness (`scripts/verify-cli-container`) replaying the `cardo setup` flow in a clean container

### Changed

- Desktop packaging: source-embed — the profile module is manifest constants only; `release.yml` publishes the CLI only (the release source archive is the desktop artifact); root tolerates a missing `.git` for husky

## [0.5.2] — 2026-08-16

### Fixed

- Release artifacts are named with the tag version (`Cardo-<tag>-arm64-mac.zip`), matching the name the updater resolves — `cardo update` works again

## [0.5.1] — 2026-08-16

### Fixed

- CLI release-asset selection is platform-aware (arm64 vs x64) — restores `cardo update` after the publish-package rename

## [0.5.0] — 2026-08-16

### Changed

- Desktop rebuilt on the DeepSeek Harness (dsh) runtime: the Electron shell boots a self-contained bundled `@deepseek-ai/dsh` runtime (`prepare-runtime.mjs` → `resources/dsh-runtime`); the vendored pi-gui desktop and `packages/runtime` extension registry are removed — the pi-gui-era titlebar-strip / silent plan-mode toggle / extension-dock reset UI never shipped, superseded by the dsh shell
- Startup update check extracted into `@cardo/cardo-updater` and wired into the desktop shell
- Plan/debug session modes dropped as a pi extension; the planmode pipeline moved to a bundled skill (cardo-planmode), and agentic-debugging replaced by cardo-pbt-debugging
- Added the cardo dsh profile spec and vendored community dsh plugins (`vendor/dsh-plugins`: dsh-subagent-monitor, dsh-thinking-effort, a day/night whale skin), provisioned into the profile at startup
- CLI renamed to `@uniterra-solutions/cardo`; `release.yml` publishes the CLI via npm trusted publishing (OIDC); the release source archive is the desktop artifact

## [0.4.1] — 2026-08-15

### Fixed

- Desktop transcript delivery no longer republishes the full transcript per driver event (the renderer fell irrecoverably behind on long tasks — agent finishes while the UI still replays). Snapshot + delta delivery: the main process ships a full snapshot on session switch/first publish, then only changed items over the new `pi-gui:transcript-delta` channel; the renderer applies ops locally keeping object identity of untouched rows so the timeline memo comparator short-circuits (sameDisplayItemContent replaces the per-row JSON.stringify). Covered by integrated PBT invariants (convergence under arbitrary coalescing, no-loss/no-dup content, id/kind stability, per-delta liveness, delivery decisions)

## [0.4.0] — 2026-08-15

### Added

- Jovaltus plan mode — `plan`/`execute_plan` are now gated tools of a per-session mode (toggle with `/planmode`, shift+P in the TUI — the TUI keeps shift+tab for `app.thinking.cycle` — or shift+tab / the mode button in the desktop composer). Mode state persists via `pi.appendEntry` and is restored on session start (also via the new `--plan-mode` flag); while off, a direct call is blocked by a `tool_call` gate with an actionable reason
- New plan pipeline: `plan` runs prd → design inside the tool call (asking the user to clarify requirements first when the host has a UI), then parks in `plan_waiting` with a handoff instructing the main agent to write failing PBTs (business logic as invariants — the implementation spec) and `execution-plan.json`; `agent_settled` validates the JSON and marks the plan done
- `execute_plan <plan_id>` replaces `execute`: resolves a completed plan session (id or run dir) and dispatches its subagents — batches serial, agents within a batch parallel — each child getting the role prompt with its task_prompt and the auto-injected PRD/design context. It is plan-mode-exclusive and does not chain into simplify/review; the result carries `execution_mode`, `steps` and the generated mermaid
- Desktop plan-mode UI (vendored pi-gui, `// Cardo:` marked): mode button + shift+tab in the composer, an execute panel above the input (spinner → green light → 3s auto-fade; click opens a right-side graph popup with batch groups, per-agent states and active-batch highlight) rendered natively from the structured `jovaltus-execute` widget protocol — the graph is derived from the same JSON the plan was parsed from, never from mermaid or free text
- Execution-plan model + pure derivations (`parseExecutionPlan`, `deriveExecutionSteps`, `planToMermaid`, the progress machine) with property-based coverage in `plan-*.test.mts` (total parser, mermaid output contract + hostile-prompt escaping, strict batch-gated progress, widget protocol incl. no-`|` collisions, integrated `execute_plan` streaming)

### Changed

- Docs: `AGENTS.md` and `docs/` document the plan-mode pipeline, `execute_plan`, the mode layer and the desktop UI; new `docs/modules/plan.md` + `docs/modules/plan-mode.md`

## [0.3.3] — 2026-08-15

### Added

- Desktop composer: single-row layout with flat inline controls — attach button, textarea, environment/model/thinking selectors and send all on one line inside the surface; environment as a native select with chevron; the new-thread surface follows the same row. Covered by the `composer-layout` e2e spec (geometry, 1px surface border, global scrollbar CSS contract via computed styles) and the composer controls specs

### Fixed

- Desktop streaming delivery: on long tasks the frontend no longer falls irrecoverably behind the backend (the agent finished while the UI kept showing "running" and slowly replayed the work). The driver emits one event per text delta; each event previously shipped a full state + transcript push (several full clones per event) and re-rendered the entire timeline, so delivery cost was O(events²). Window pushes are now coalesced via the new `electron/stream-publish.ts` (at most one per 80ms — leading edge for isolated updates like selection changes and run completion, trailing edge always carrying the latest state) and `conversation-timeline.tsx` memoizes timeline rows by content fingerprint so each snapshot re-renders only the changed rows. The contract is locked by the new `streaming-sync` PBT suite (content accounting, item-identity stability, payload monotonicity, liveness)

### Changed

- Docs: `AGENTS.md`, `docs/architecture.md`, `docs/conventions.md` and `docs/testing.md` document the streaming sync contract (coalesced pushes + memoized rows) and the `streaming-sync.test.mts` PBT lane

## [0.3.2] — 2026-08-15

### Added

- `cardo update` now stops all running cardo desktop app instances before updating: it sends an AppleScript `quit` (letting the app flush its before-quit persistence), polls for up to 10 seconds, then SIGKILLs stragglers. Skipped with `--dry-run`. The process operations are injected (`packages/cli/src/stop-app.ts`) and covered by a new CLI unit suite (`pnpm --filter @uniterra-solutions/cardo test`)
- Desktop startup update check (replaces the vendored pi-gui checker): on launch the app probes the `@uniterra-solutions/cardo` npm `latest` dist-tag and the `Uniterra-Solutions/cardo` GitHub release, and prompts with **Update Now / Later / Skip This Version** when either is newer. Later re-prompts on the next launch; Skip persists the version (no more prompts until a newer one appears). Update Now spawns `cardo update` and quits the app. Manual **Check for Updates…** in the app menu uses the same flow
- The update check only runs outside dev and is disabled entirely with `PI_APP_DISABLE_CARDO_UPDATE_CHECK=1`; endpoints, delay and update command are overridable via `CARDO_UPDATE_API_BASE` / `CARDO_UPDATE_NPM_URL` / `CARDO_UPDATE_DELAY_MS` / `CARDO_UPDATE_COMMAND` (used by the new e2e lane `test:cardo:core:update-flow`)
- Desktop timeline: streaming reasoning renders as a fixed 120px bottom-pinned window — no box surface, 11px mono in `--muted-soft`, and each streamed chunk pins the scroll to the newest content while the model is thinking
- Desktop styling: global 7px thin scrollbars with a transparent track and a `--muted-alpha` warm thumb (sharp 2px corners, Firefox `scrollbar-width: thin` pair), plus a composer footer refactor — attach button far left, status hint and all selectors centered (environment as a native select with chevron, model/thinking badges with caret)

### Changed

- Docs: `AGENTS.md` and `docs/testing.md` document the new CLI test lane and the update-flow e2e lane

### Fixed

- Desktop from-source runs (dev server / `electron .` / preview) now use the `pi-dev` user-data dir instead of sharing the packaged app's `pi` dir, so an orphaned dev electron can no longer hold the single-instance lock or clobber packaged-app state

## [0.3.1] — 2026-08-14

### Added

- Desktop keyboard shortcuts reworked: Cmd+N creates a new thread under the currently selected workspace (previously opened a new window), Cmd+Shift+N opens a new window, and Cmd+Alt+J toggles the files panel. The File menu binds "New Thread" to Cmd+N and "New Window" to Cmd+Shift+N (explicit macOS accelerators, matching Electron's reported form)
- Desktop e2e specs runnable from the cardo workspace: `@playwright/test` is now a desktop devDependency (the vendored root's copy is never installed by the cardo workspace), exposed via the cardo scripts `test:cardo:core:multi-window` and `test:cardo:core:mentions-diff`

### Changed

- Docs: `AGENTS.md` and `docs/testing.md` document the cardo e2e lanes, including the `PI_OFFLINE=1` launch env (specs seed a fake provider key; pi's model-availability refresh would otherwise wait on real network calls — real-auth specs opt out)

### Fixed

- Desktop e2e launch hang in restricted environments: pi's model-availability refresh never resolved, so the test launch env now forces offline mode

## [0.3.0] — 2026-08-14

### Added

- Desktop timeline: streaming reasoning display — `thinking_delta` agent events become a new `assistantThinkingDelta` driver event; the app-store accumulates them into a live thinking block and collapses it to a clickable "Thought for Ns" row (persisted sessions render collapsed, no fabricated duration)
- Desktop timeline: tool-batch collapsing — the consecutive tool calls of one request group into a single "Used N tools" row that auto-expands while calls run and collapses when settled; lone tool calls stay plain rows

### Fixed

- Desktop timeline flicker when tool results and streaming agent output coexisted: `pruneExpandState` returned a fresh `Set` on every transcript change (i.e. every streamed character), defeating React's setState bail-out and re-rendering the timeline three times per character. The pruner now returns the identical reference when nothing is pruned; the invariant is locked by the PBT lane

## [0.2.1] — 2026-08-14

### Added

- `@cardo/general` extension: app-wide working rules (no emoji, concise replies, no over-engineering, minimal code, verify external APIs before use, tests for each piece of business logic, reply in the user's language) appended to the system prompt of every agent turn
- `General` registered as a built-in extension in `@cardo/runtime` (first in the factory chain, before Jovaltus)
- `CHANGELOG.md` — this file

### Changed

- Release workflow hardened for npm trusted publishing: require npm >= 11.5.1 (Node 22's bundled npm 10.x cannot exchange the GitHub OIDC token — `ENEEDAUTH`) and install npm 11 in CI

## [0.2.0] — 2026-08-14

### Added

- `@cardo/skills` built-in skill registry (vendored company-standard skills: 5 Jovaltus pipeline skills + Caelterra `create-skill`)
- Desktop provisions built-in skills into `<agentDir>/skills/` at startup (`provisionBuiltinSkills`, idempotent — existing skills are never clobbered)

### Changed

- Release workflow no longer runs the vendored `verify:packaged-runtime-deps` step (pinned to pi-coding-agent 0.80.6; cardo runs 0.84.x)

## [0.1.0] — 2026-08-14

### Added

- pnpm monorepo scaffold: strict TypeScript, ESLint `strictTypeChecked` (max-warnings 0), Prettier, husky pre-commit
- `@cardo/jovaltus`: Jovaltus pipeline (plan/execute/simplify/review + list_sessions/resume_session, 6 tools) as a pi-agent extension, with SQLite session store (`~/.pi/agent/jovaltus.sqlite`) for cross-session resume
- `@cardo/runtime`: built-in extension registry for the desktop shell
- `@cardo/cli` (`cardo`): one-command macOS app setup/update installer — unsigned release zips over HTTPS (no Gatekeeper quarantine, no Apple signing)
- Vendored pi-gui desktop app (git subtree) with the `extensionFactories` integration seam; `pi-sdk-driver` ported to pi 0.84.1 (`ModelRuntime`)
- Property-based testing lanes (fast-check + node:test) for the extension ↔ pi-backend contract and the pi-gui contract layer
- Warm Paper Sharp design system and project documentation tree (`docs/`)
