# Vendored dsh community plugins

These plugins are vendored at pinned commits because they are **not published
to npm** (`dsh plugin add github:<owner>/<repo>` would install the default
branch's HEAD with no version lock — a breaking-change surprise under a fast
moving ecosystem). Vendoring gives uniterra a reproducible, auditable, patchable
copy for every checkout, with no build-time GitHub dependency.

## Pin ledger (2026-09-04)

| Directory | Upstream | Pinned commit | Notes |
|---|---|---|---|
| `dsh-deep-whale` | `Small-tailqwq/dsh-deep-whale` | `d7cfec228ce96fccf052a1ccee717b6b5e721e4d` | Whale-maid skin, **standalone distribution** (`maid-atelier/` package), v0.1.1 tag — the release built for the uniterra-pinned `0.1.2-rc.1` family (`skin.json` declares `dshCompatibility: 0.1.2rc1`). **OPTIONAL** — shipped but not installed by default (see "Optional plugins" below). Chosen over the GGBond `deep-whale-day-night-theme` builtin-row distribution, which depends on `dsh-client-ui-theme-plugins` / `dsh-host-theme-catalog` (absent in the pinned rc.6 family) and so silently never loaded. This copy self-inserts its `ui-skin-maid-atelier` row, ships a no-op host (`apply` is empty, art embedded as data URIs) and needs only `@deepseek-ai/cordis`. Trimmed to runtime files (`lib/` + `package.json` + `cordis.patch.yml` + `skin.json` + `preview/` + license/NOTICE/README); `src/`/`assets/`/`build/`/`tests/` are source/build, not runtime. Package name: `@dsh-external/dsh-client-ui-skin-maid-atelier`. CC BY-NC-SA 4.0 — non-commercial only. |
| `dsh-shortcuts` | `Ricketts-Guo/dsh-shortcuts` | `bf392410868c9686ed3292d2c2272469da3a3293` | 34 pre-registered keyboard shortcuts (session/view/clipboard/model/permission/system), one-click recording, macOS-first defaults (v1.1.4). Client-only plugin (needs `react`, `@deepseek-ai/cordis` — all host-provided). **LOCAL PATCH (2026-09-04, dsh 0.1.2-rc.1 migration):** the plugin's `dsh.client.inject` row and the `peerDependencies` entry naming `@deepseek-ai/dsh-client-runtime` were dropped — that package was REMOVED in the new dsh family (the web client runtime is now `@deepseek-ai/dsh-cordis-client-runner`, composed by the shell), and the client-modules loader would fail resolving a nonexistent inject row. The client bundle itself requires only module-table specifiers, so nothing else changed. Pending upstream (`Ricketts-Guo/dsh-shortcuts`): republish against the new family. Trimmed to runtime (`lib/` + `package.json` + `cordis.patch.yml` + docs); `test/`/`install.sh` are source/ops, not runtime. |
| `dsh-workflow` | `omdsh-dev/dsh_workflow` | `804e4c38e4e1649f5777f92fed28fa29d17aa62d` | (v0.1.3 tag) dynamic multi-agent workflow layer: persists workflows as `.workflow.json` capsules and exposes `workflow_list` / `run_workflow` / `workflow_manage` tools, so a model invokes a workflow by name instead of copying a large JS block. Pinned at the tag whose peer deps target the dsh `^0.1.0-rc.5` family (closest to the uniterra-pinned `0.1.2-rc.1`); its `compatibility.json` records dsh `0.1.0-rc.5` (COMMIT `47f943859bef60e4160492346772ded9b24f765a`) — the same `0.0.1-rc.2` anchor issue #18 flagged is only for the older default-branch builds, and pnpm reports the peer ranges as **unsatisfied (warn)** against `0.1.1-rc.2` (npm's pre-release gate: `^0.1.0-rc.5` does not match `0.1.2-rc.1`). Loads via `ctx.subagents` + `ctx.tools` (not the native inline-only engine); the symbols it imports (`defineTool` from `@deepseek-ai/dsh-tools`, `createUserMessage` from `@deepseek-ai/dsh-llm`, `WorkflowRunId` from `@deepseek-ai/dsh-workflow`) exist in the `0.1.2-rc.1` family. Runtime deps: `@deepseek-ai/cordis@^4.0.1` (host-provided) and `quickjs-emscripten@0.32.0`, which the copy-based built-in cannot auto-install — the desktop installs it as a profile runtime dependency (`PROFILE_RUNTIME_DEPS` in `packages/uniterra-desktop/src/builtin.ts`). Trimmed to runtime (`lib/` + `package.json` + `cordis.patch.yml` + `compatibility.json` + `reference.json` + docs + examples); `src/`/`tests/`/`scripts/` are source, not runtime. Package name: `@dsh-external/workflow`. MIT. **LOCAL PATCH (2026-08):** `lib/engine.js` `DynamicWorkflowEngine.needsApproval` now honors the live DSH session approval policy — when a session's effective policy is `never` (the full-access / no-approval-preset mode), a workflow run is no longer gated on approval. Without this, `run_workflow` for a `capability-generated`/`trusted-local` workflow under full access called `ApprovalService.request()`, which the DSH approval service auto-rejects (fail-closed) for `never`, so the run was DENIED before any child started ("cannot start" in full-access mode). Patch is compiled straight into the vendored `lib/`. Pending upstream (`omdsh-dev/dsh_workflow`): fold the session approval policy into the approval decision. Regression net: `packages/uniterra-desktop/test/workflow-engine-approval-pbt.test.mjs` (PBT + deterministic anchors, via `workflow-engine-stub-loader.mjs`). **Propagation:** the desktop identifies a copy-based built-in as stale by its `package.json` `version` — a content-only local patch with the SAME version was therefore never re-provisioned into an existing profile, so an updated app kept running the OLD engine and a workflow was still denied. `copyEntryStale` in `packages/uniterra-desktop/src/builtin.ts` now also compares a content fingerprint (ignoring `package.json`/`node_modules`), so any local patch propagates into an already-provisioned profile on the next boot. Regression net: `packages/uniterra-desktop/test/builtin-pbt.test.mjs` (`STALE regression: a customized copy with the SAME version but DIFFERENT content is stale`). **LOCAL PATCH (2026-08):** `lib/index.js` `ModelTier` output-token ceilings raised to the model's real max (384_000). The plugin defaulted them to 4_096 (`fast`) / 8_192 (`balanced`) / 16_384 (`deep`), so every `run_workflow` child without an explicit `maxTokens` resolved to the `balanced` tier and was handed `agentOptions.maxTokens = 8_192` (forwarded verbatim as `max_output_tokens`); a reasoning-heavy FIXER AGENT burned the whole 8_192 ceiling inside one chain-of-thought trace and the upstream gateway ended the response as `response.incomplete` → `INCOMPLETE` ("response not completed"). Normal subagent/main-agent calls never pass through `modelTiers`, so they use the model's real default and are not truncated — which is exactly why the failure only ever appeared on workflow agents. Regression net: `packages/uniterra-desktop/test/workflow-tier-defaults.test.mjs` (`{fast,balanced,deep}MaxTokens default ceiling is not artificially small`). **LOCAL PATCH (2026-08):** `wf.readFile(path)` added to the workflow API — `lib/engine.js` `createApi` (resolve the repo-relative path via `workspacePath`, read it as UTF-8 within the workspace, raise `WorkflowControlError` on workspace escape / ENOENT), `lib/runtime.js` (proxyApi + guest `wf` + the async bridge `readFile` dispatch), `lib/types.d.ts` (`WorkflowApi.readFile`). Lets a capsule inline a file's content into a subagent prompt — the `implement` capsule now inlines each task's `promptFile` brief so the subagent does not read the file itself, while `run_workflow` args stay tiny (paths, not briefs). Additive — no behaviour change to existing workflows. Regression net: `packages/uniterra-desktop/test/workflow-engine-readfile.test.mjs` (reads within the workspace, rejects escape + ENOENT). **LOCAL PATCH (2026-08-31):** `scriptWallTimeoutMs` default raised from `3_600_000` (1 h) to `28_800_000` (8 h) in `lib/index.js` — both the Schemastery schema `z.default` and the `resolveConfig` fallback. The upstream 1-h default armed a whole-run wall timer that fired while long multi-hour agent fan-outs were still working: `onTimeout` called `engine.stop(runId, 'workflow script timed out')`, every still-running child was cancelled, and `run_workflow(..., { wait: true })` surfaced a `stopped` run with `workflow script timed out after 3600000ms` — the "system timeout, agents unfinished" failure. The limit stays reachable via plugin config; the default only decides what unconfigured profiles get. Pending upstream (`omdsh-dev/dsh_workflow`): raise the default or make the wall limit opt-in per run. Regression net: `packages/uniterra-desktop/test/workflow-wall-timeout-default.test.mjs` (deterministic source-pattern guard: the default is at least 8 h and both declaration sites agree). **LOCAL PATCH (2026-09-03):** the approval gate now keys on the session SANDBOX MODE and background launches detach from the launching step's signal. (1) `lib/engine.js` `DynamicWorkflowEngine.needsApproval` — when the DSH `ctx.sandboxPolicy` seam is mounted (wired through `lib/index.js` `apply` + `lib/service.js` `engine()`), the decision is resolved from the session's effective sandbox mode: `danger-full-access` returns `false` (full access runs ungated, the approval step is skipped entirely) while `read-only`/`workspace-write` follow `approvalMode` (the user's approval popup). The old patch keyed on the session APPROVAL POLICY (`effectivePolicy === 'never'`), but the policy knob and the sandbox-mode knob are independent session facts (delegation copies them separately — production sessions exist at `workspace-write` sandbox + `never` approval), so a `danger-full-access` session with an `ask` policy still ran the gate and the run was DENIED without any user prompt. Without the seam (other deployments) the previous policy shortcut remains as the fallback. (2) `lib/engine.js` `start()` now exposes `detach()` on the run handle and `lib/index.js` `runResult` calls it on every background (`wait: false`) launch: the run (and its still-pending approval ask) is owned by the DSH job system once it outlives the tool step, so the launcher step's signal no longer reaches the run controller. In Code Mode (the PTC agent preset) every tool-exec signal IS the `run_code` run controller, which the code-mode registry aborts the moment the model's program settles ("run_code settled"); a background launch returned before the approval ask settled, so the abort arrived mid-ask — the DSH answerer settles `cancelled` on an aborted signal and the run was DENIED ("workflow approval cancelled") with no user prompt, while an already-running background fan-out was cancelled ~100 ms after start. Standard mode survived because its exec signal is the agent-loop turn signal, not aborted at step close — exactly "only standard mode works". Synchronously awaited runs (`wait: true`) keep the binding so cancelling the parent turn still cancels the workflow. Pending upstream (`omdsh-dev/dsh_workflow`): fold the session sandbox-mode resolution and background signal detachment into the approval decision. Regression nets: `packages/uniterra-desktop/test/workflow-engine-approval-mode-pbt.test.mjs` (PBT + deterministic anchors: full access never gates, restricted modes gate per approvalMode, policy knob does not decide) and `packages/uniterra-desktop/test/workflow-engine-detach.test.mjs` (detached approval ask survives the launcher step closing; attached runs still follow the launcher signal). **LOCAL PATCH (2026-09-05):** child-result collection now survives the dsh session-API refactor. dsh 0.1.2-rc.1 REMOVED the public `Session#events` accessor (0.1.1-rc.2 exposed `get events()`; the new API is `snapshotEvents()` / `ownEvents()` / `eventAt()`), so the four unguarded iteration sites in `lib/engine.js` (`usageOf`, `observedToolEvidence`, `latestAssistantText`, `childRecordedCompleted`) threw `TypeError: agent.session.events is not iterable` in `driveTask` right after `await childRun.result` — every finished child was then recorded `agent-completed { outcome: 'failed' }` with its real output already in the task workspace, batches stopped advancing, and a run hung or was cancelled on host teardown ("jobs service disposed"). `lib/engine.js` now adapts via `sessionEventsOf(agent)` (array `session.events` when present, else `snapshotEvents()`, else `[]`) and wraps every collection call site (usage / evidence / latest text / completed-record) in `collect()` with auxiliary-data fallbacks, so a log-shape surprise can never fail a completed task; `lib/index.js` handoff detection uses the same adapter. Pending upstream (`omdsh-dev/dsh_workflow`): read the session log through the current dsh API and treat collection failures as non-fatal. Regression net: `packages/uniterra-desktop/test/workflow-engine-session-events.test.mjs` (new-family `snapshotEvents` session collects usage + task completes; legacy `events` session unchanged; totally event-less session degrades without failing the task). |

## Retired plugins

These were vendored built-ins once, then dropped because their function
overlapped another built-in (see the desktop's `RETIRED_BUILTINS` list):

| Directory (removed) | Replaced by |
|---|---|
| `dsh-subagent-monitor` (`@leetoners/dsh-ui-subagent-monitor`) | `dsh-better-sidebar` Tasks page (subagent topology + background jobs) |
| `dsh-git-graph` | `dsh-better-sidebar` Git panel (history, diff, uncommitted changes) |
| `dsh-thinking-effort` | `@uniterra-solutions/uniterra-provider` (declares + edits `reasoningEfforts` from models.dev) |
| `dsh-hotkeys` (npm) | `dsh-shortcuts` |

## Update policy

To bump one plugin:

1. `git -C vendor/dsh-plugins/<name> fetch --depth 1 origin`
2. Checkout the new commit, verify it still targets the uniterra-pinned dsh
   family (`0.1.2-rc.1` / cordis `4.0.2`), re-run the smoke test below.
3. Update this ledger's commit row.

## Optional plugins

`dsh-deep-whale` is a built-in **option**: the desktop ships the source but
never installs or activates it unless the user's profile opts in. The toggle
is the profile's `.uniterra.json` (created by the desktop on first run):

```json
{
  "version": 1,
  "optionalPlugins": {
    "@dsh-external/dsh-client-ui-skin-maid-atelier": true
  }
}
```

- `true` (or the key present) → the desktop ensures the skin's bundle row and
  a fresh copy in the profile at every boot; removing the key (or the whole
  `optionalPlugins` object) → the row and the copy are removed.
- No file yet (pre-toggle installs) → the desktop migrates: an existing skin
  row is preserved and persisted as enabled; a profile without one stays
  skin-free.

Manual, CLI-free enable/disable via the dsh CLI also works (the desktop
honours whatever the row says when no file exists, and a working pnpm link is
left alone):

```sh
dsh plugin --profile web add /absolute/path/vendor/dsh-plugins/dsh-deep-whale
dsh plugin --profile web remove @dsh-external/dsh-client-ui-skin-maid-atelier
```

## Install (in a uniterra profile)

`dsh-shortcuts` is a built-in — provisioned automatically. The manual
`dsh plugin add` path above is only needed to opt into the optional skin
without editing `.uniterra.json`.

Smoke test after any change: sandbox `DSH_HOME`, boot the profile, expect
HTTP 200 on the web port with no load error mentioning these plugins.
