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
| `dsh-shortcuts` | `Ricketts-Guo/dsh-shortcuts` | `bf392410868c9686ed3292d2c2272469da3a3293` | 34 pre-registered keyboard shortcuts (session/view/clipboard/model/permission/system), one-click recording, macOS-first defaults (v1.1.4). Client-only plugin (needs `react`, `@deepseek-ai/cordis` — all host-provided). **LOCAL PATCH (2026-09-04, dsh 0.1.2-rc.1 migration):** the plugin's `dsh.client.inject` row and the `peerDependencies` entry naming `@deepseek-ai/dsh-client-runtime` were dropped — that package was REMOVED in the new dsh family (the web client runtime is now `@deepseek-ai/dsh-cordis-client-runner`, composed by the shell), and the client-modules loader would fail resolving a nonexistent inject row. The client bundle itself requires only module-table specifiers, so nothing else changed. Pending upstream (`Ricketts-Guo/dsh-shortcuts`): republish against the new family. **LOCAL PATCH (2026-09-05, dsh 0.1.2-rc.1 API migration):** four client seams that the new family removed/relocated were fixed in `lib/client.js` (new session via `sessions.create` + `open` instead of the nonexistent `workspaces.startSession`; copy-last-message via `binding.eventSource` (`assistant/message` + `chunkrow/text-chunks`) instead of the nonexistent `conversation` projection; focus-composer via the `[role="textbox"]` contentEditable composer seat instead of `textarea`; theme toggle only flips the built-in light/dark pair instead of dropping a registered skin theme to the hardcoded base). Every fix is pinned by the local suite shown below. Pending upstream: same republish note. Trimmed to runtime (`lib/` + `package.json` + `cordis.patch.yml` + docs); `test/`/`install.sh` are source/ops, not runtime. |
| `dsh-workflow` | `omdsh-dev/dsh_workflow` | `804e4c38e4e1649f5777f92fed28fa29d17aa62d` | (v0.1.3 tag) dynamic multi-agent workflow layer: persists workflows as `.workflow.json` capsules and exposes `workflow_list` / `run_workflow` / `workflow_manage` tools, so a model invokes a workflow by name instead of copying a large JS block. Pinned at the tag whose peer deps target the dsh `^0.1.0-rc.5` family (closest to the uniterra-pinned `0.1.2-rc.1`); its `compatibility.json` records dsh `0.1.0-rc.5` (COMMIT `47f943859bef60e4160492346772ded9b24f765a`) — the same `0.0.1-rc.2` anchor issue #18 flagged is only for the older default-branch builds, and pnpm reports the peer ranges as **unsatisfied (warn)** against `0.1.1-rc.2` (npm's pre-release gate: `^0.1.0-rc.5` does not match `0.1.2-rc.1`). Loads via `ctx.subagents` + `ctx.tools` (not the native inline-only engine); the symbols it imports (`defineTool` from `@deepseek-ai/dsh-tools`, `createUserMessage` from `@deepseek-ai/dsh-llm`, `WorkflowRunId` from `@deepseek-ai/dsh-workflow`) exist in the `0.1.2-rc.1` family. Runtime deps: `@deepseek-ai/cordis@^4.0.1` (host-provided) and `quickjs-emscripten@0.32.0`, which the copy-based built-in cannot auto-install — the desktop installs it as a profile runtime dependency (`PROFILE_RUNTIME_DEPS` in `packages/uniterra-desktop/src/builtin.ts`). Trimmed to runtime (`lib/` + `package.json` + `cordis.patch.yml` + `compatibility.json` + `reference.json` + docs + examples); `src/`/`tests/`/`scripts/` are source, not runtime. Package name: `@dsh-external/workflow`. MIT. **LOCAL PATCH (2026-08):** `lib/engine.js` `DynamicWorkflowEngine.needsApproval` now honors the live DSH session approval policy — when a session's effective policy is `never` (the full-access / no-approval-preset mode), a workflow run is no longer gated on approval. Without this, `run_workflow` for a `capability-generated`/`trusted-local` workflow under full access called `ApprovalService.request()`, which the DSH approval s... (line truncated to 2000 chars)

## Local dsh-shortcuts test suite (2026-09-05)

`packages/uniterra-desktop/test/dsh-shortcuts-*.test.mjs` (run by the desktop
`node --test test/*.test.mjs` suite) pin the plugin against the PINNED dsh
family, plus `scripts/verify-dsh-shortcuts-smoke/run.sh` (real dsh web boot;
auto-skips when the CLI is not linked). Layer 1: the plugin-side contract
(module face, inject list, slot surfaces, per-feature service/projection/DOM
usage table) — green. Layer 2: the dsh-api oracle, which reads the vendored
harness sources and fails by name when a seam the plugin uses no longer
exists. Layer 3: behavior tests (combo matching, Tab-hold, persistence,
model/effort selection, permission cycle, recording UI, PBT invariants).

**Breakages found by the suite, fixed locally (2026-09-05)** — the four
defects the suite reported are fixed in `lib/client.js`; each is now pinned
green by a purpose-named regression test in the behavior file and (where it
reads a dsh seam) by the dsh-api oracle:

1. **New session** (`⌘N` + palette "new session" row): `workspaces.startSession`
   does not exist in the pinned family (IWorkspaces has only create/rename/
   delete/insertBefore/archiveSession/insertSessionBefore) — the action threw
   and created nothing. Now creates through `sessions.create({ workspaceId? })`
   (target = current session's workspace, else the most recently active one)
   and opens the new id via `sessions.open`, mirroring ui-workspace.startSession.
2. **Copy last assistant message**: read the `conversation` session projection,
   which the pinned family does not provide (real keys: modelSelection/title/
   todos/permissions/plan/goal/tokenUsage/contextPressure/contextBreakdown/
   sessionStats/imageLimits/sessionListMetadata) — a permanent no-op. Now reads
   `binding.eventSource`: last `assistant/message` text blocks, falling back
   to the last `chunkrow/text-chunks` run while streaming.
3. **Focus composer**: probed `textarea`; the pinned composer is the
   contentEditable div with `role="textbox"` (ComposerContentEditable is the
   only such element in the client). Now focuses `[role="textbox"]`.
4. **Theme toggle**: hardcoded the light/dark pair, so a registered non-built-in
   theme (skin, e.g. the deep-whale maid-dark theme) was dropped to the base
   `light`. Now toggles only the built-in pair and leaves a skin theme active.

Everything else (loading protocol, slots, model/effort selection, permission
cycle + loopback route, settings persistence/migration, host route) is
pinned green by the same suite; the real dsh web boot smoke also passes.
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