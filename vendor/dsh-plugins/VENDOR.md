# Vendored dsh community plugins

These plugins are vendored at pinned commits because they are **not published
to npm** (`dsh plugin add github:<owner>/<repo>` would install the default
branch's HEAD with no version lock — a breaking-change surprise under a fast
moving ecosystem). Vendoring gives uniterra a reproducible, auditable, patchable
copy for every checkout, with no build-time GitHub dependency.

## Pin ledger (dsh 0.1.5 re-pin, 2026-09-13)

| Directory | Upstream | Pinned commit | Notes |
|---|---|---|---|
| `dsh-deep-whale` | `Small-tailqwq/dsh-deep-whale` | `ce98fc01df0c93ca80976ed050a7c6268cd2bb33` | Whale-maid skin, **standalone distribution** (`maid-atelier/` package), v0.1.2 tag — the release built for the new dsh family (`skin.json` declares `dshCompatibility: 0.1.5rc1`). Re-pinned 2026-09-13 from v0.1.1 (`d7cfec22…`, `dshCompatibility: 0.1.2rc1`). **NO local patch** — the copy is upstream verbatim: `lib/index.js` and `cordis.patch.yml` are byte-identical between the two tags, `lib/client.js` grows 3,418,026 → 8,043,089 bytes (newly embedded artwork), and `skin.json` changes exactly one field. **LICENCE MODEL CHANGED at v0.1.2:** project code is **MIT** (`LICENSE`) while the artwork — character art, backgrounds, icons, previews, and their embedded/transformed copies including the data URIs inside `lib/client.js` — is **CC BY-NC-SA 4.0** under the new `LICENSE-ARTWORK` (attribution chain in `NOTICE`); the v0.1.1 copy shipped one whole-project CC BY-NC-SA 4.0 `LICENSE`. Non-commercial either way. **OPTIONAL** — shipped but not installed by default (see "Optional plugins" below). Chosen over the GGBond `deep-whale-day-night-theme` builtin-row distribution, which depends on `dsh-client-ui-theme-plugins` / `dsh-host-theme-catalog` (absent in the pinned family) and so silently never loaded. This copy self-inserts its `ui-skin-maid-atelier` row, ships a no-op host (`apply` is empty, art embedded as data URIs) and needs only `@deepseek-ai/cordis`. Trimmed to runtime files (`lib/` + `package.json` + `cordis.patch.yml` + `skin.json` + `preview/` + `LICENSE`/`LICENSE-ARTWORK`/`NOTICE`/`README.md`); `src/`/`assets/`/`build/`/`tests/` are source/build, not runtime. Package name: `@dsh-external/dsh-client-ui-skin-maid-atelier`. |
| `dsh-shortcuts` | `Ricketts-Guo/dsh-shortcuts` | `bf392410868c9686ed3292d2c2272469da3a3293` | 34 pre-registered keyboard shortcuts (session/view/clipboard/model/permission/system), one-click recording, macOS-first defaults (v1.1.4). Client-only plugin (needs `react`, `@deepseek-ai/cordis` — all host-provided). **LOCAL PATCH (2026-09-04, dsh 0.1.2-rc.1 migration):** the plugin's `dsh.client.inject` row and the `peerDependencies` entry naming `@deepseek-ai/dsh-client-runtime` were dropped — that package was REMOVED in the new dsh family (the web client runtime is now `@deepseek-ai/dsh-cordis-client-runner`, composed by the shell), and the client-modules loader would fail resolving a nonexistent inject row. The client bundle itself requires only module-table specifiers, so nothing else changed. Pending upstream (`Ricketts-Guo/dsh-shortcuts`): republish against the new family. **LOCAL PATCH (2026-09-05, dsh 0.1.2-rc.1 API migration):** four client seams that the new family removed/relocated were fixed in `lib/client.js` (new session via `sessions.create` + `open` instead of the nonexistent `workspaces.startSession`; copy-last-message via `binding.eventSource` (`assistant/message` + `chunkrow/text-chunks`) instead of the nonexistent `conversation` projection; focus-composer via the `[role="textbox"]` contentEditable composer seat instead of `textarea`; theme toggle only flips the built-in light/dark pair instead of dropping a registered skin theme to the hardcoded base). Every fix is pinned by the local suite shown below. **REMOVAL CONDITIONS (patches 1-4):** the same upstream republish — a `Ricketts-Guo/dsh-shortcuts` release built against the pinned dsh family, which already carries no `dsh.client.inject` row naming the removed `dsh-client-runtime`, creates sessions through `sessions.create` + `open`, reads the pinned event window, focuses the `[role="textbox"]` composer seat and keeps a registered skin theme active. At that point the vendored copy is re-pinned and this patch is dropped. Pending upstream: same republish note. **LOCAL PATCH (2026-09-13, dsh 0.1.5-rc.2 API re-plant):** the harness re-pin broke two seams the plugin reads; both are re-planted in `lib/client.js` on the 0.1.5-native API, never a shim, and the four patches above stay intact. (a) **Details toggle:** `ctx.layout.openDetails()` / `closeDetails()` were REMOVED — 0.1.5's `ctx.layout` is a panel-action face only (`selectPanel`, `beginNavigation`, `toggleSidebar`, and the `openRightbar`/`closeRightbar` presentation reports, which say where the panel is drawn and cannot open it), because the right column's expanded state now belongs to its occupant `ui-sidebar-right`. The toggle is that owner's native face: `ctx.sidebarRight.toggleExpanded()` (local `detailsOpen` mirror deleted). It fails loudly with no mounted seat, so the action swallows that per the plugin's view-action convention. **REMOVAL CONDITION:** upstream `Ricketts-Guo/dsh-shortcuts` republishes against the dsh 0.1.5 family (or a later family whose layout face still exposes the details toggle) — then re-pin and drop this patch. (b) **Copy-last-message streaming fallback:** the session event `chunkrow/text-chunks` was REMOVED, so the reader no longer matches `event.type === "chunkrow/text-chunks"` + `data.texts`; it now reads the client-only transient row `{ type: "transient", event: AssistantLiveChunkEvent }` and joins the `text-delta` texts of the same `data.attemptId`/`turn`/`step` run in window order (the entry union gained its own `type` discriminant, which the reader now requires instead of reading `entry.event.type` blind). **REMOVAL CONDITION:** the same republish — the vendored copy then carries neither reader. Pending upstream: same republish note. Trimmed to runtime (`lib/` + `package.json` + `cordis.patch.yml` + docs); `test/`/`install.sh` are source/ops, not runtime. |
| `dsh-workflow` | `omdsh-dev/dsh_workflow` | `bdc45548aae20a6c077910a352099091f1b0f4d8` | (v0.1.4 tag) dynamic multi-agent workflow layer: persists workflows as `.workflow.json` capsules and exposes `workflow_list` / `run_workflow` / `workflow_manage` tools, so a model invokes a workflow by name instead of copying a large JS block. Re-pinned 2026-09-13 from v0.1.3 (`804e4c38…`); v0.1.4 is **metadata-only** over v0.1.3 — 23 of the 24 `lib/` files are byte-identical (including `lib/engine.js`), only `lib/index.js` differs (`pluginVersion` 0.1.3 → 0.1.4, `dshVersion` 0.1.0-rc.5 → 0.1.3-alpha.1), and the peer ranges move from `^0.1.0-rc.5` to `^0.1.3-alpha.1` — the tag that targets the new dsh family (its `compatibility.json` records dsh `0.1.3-alpha.1`, COMMIT `d347e703908d0406b7a7ef80e3a0e594d86b2215`). Loads via `ctx.subagents` + `ctx.tools` (not the native inline-only engine). Runtime deps: `@deepseek-ai/cordis@^4.0.1` (host-provided) and `quickjs-emscripten@0.32.0`, which the copy-based built-in cannot auto-install — the desktop installs it as a profile runtime dependency (`PROFILE_RUNTIME_DEPS` in `packages/uniterra-desktop/src/builtin.ts`). Trimmed to runtime (`lib/` + `package.json` + `cordis.patch.yml` + `compatibility.json` + `reference.json` + docs + examples); `src/`/`tests/`/`scripts/` are source, not runtime. Package name: `@dsh-external/workflow`. **MIT.** Carries FIVE local patches upstream v0.1.4 does not contain (upstream still iterates `agent.session.events`, still has the original three-rule `needsApproval`, and ships no `detach` / `readFile` / raised defaults); all five were re-applied onto the new tag and are recorded, with a removal condition each, in "Local dsh-workflow patches" below. |
| `ego-browser` | `Fisfzy/dsh-ego-browser` | `6133edfbdb3ceb6a982e0d4147860b3c11e1010c` | (v0.8.3) ego-browser (ego-lite) integration: 32 `ego_*` structured browser-automation tools that drive a VENDORED ego-lite Chromium runtime through `ctx.subprocess`, plus a realtime watch panel in the web shell (live SSE screencast, direct mouse interaction, download capture, human-verification notice). **Vendored WITHOUT a local patch — the deliberate, documented exception to the "vendor a plugin only to customize it" policy (AGENTS.md / issue #35), recorded here so a future maintainer sees why:** npm only ever published `dsh-ego-browser@0.8.0`, whose peers target `@deepseek-ai/dsh-client-runtime` — a package the pinned dsh family no longer ships — so an npm import cannot resolve, while this pin declares `dsh.engines.dsh` `>=0.1.2-rc.1` and self-inserts its `ego-browser` Loader row under its own package name, i.e. it works as shipped (the copy adds nothing and removes nothing). `cordis.patch.yml` is a single self-contained root `- insert:` whose specifier MUST equal the `package.json` `name`: an earlier `@dsh-external/ego-browser` alias made the client-modules scan classify the row as non-client, so the watch panel silently disappeared. All 8 `peerDependencies` are OPTIONAL (`peerDependenciesMeta` marks each `optional: true`) and resolve from the profile's base bundles. Runtime dep: a **bare** `schemastery ^3.18.0` (NOT `@deepseek-ai/schemastery`), statically imported by `lib/index.js` and used to build the Config schema at module scope, so the copy cannot be evaluated without it — the desktop installs it as a profile runtime dependency (`PROFILE_RUNTIME_DEPS`, pinned `schemastery@3.18.0`, the bare package's latest and the only version satisfying `^3.18.0`). Trimmed to runtime files per upstream `files[]`: `lib/` + `bin/` + `runtime/` + `cordis.patch.yml` + `dsh-plugin.json` + `THIRD_PARTY_NOTICES.md`, plus `package.json` (the copy/provisioning mechanism reads its `version`) and `LICENSE`; `src/`, `tests/`, `docs/`, `scripts/`, `*.config.*` and the `lib/client.js.map` source map are source/build, not runtime. Verified verbatim: `diff -r` of every copied path against the clone at the pinned commit reports no difference (`bin`, `runtime`, `package.json`, `cordis.patch.yml`, `dsh-plugin.json`, `THIRD_PARTY_NOTICES.md`, `LICENSE` all identical; `lib/` differs only by the intentionally dropped `.map`). Upstream default branch is `master`, not `main`. Package name: `dsh-ego-browser` (unscoped). **MIT** (`LICENSE`, Copyright (c) 2026 Fisfzy and dsh-ego-browser contributors); the bundled `runtime/` is a vendored copy of CitroLabs/ego-lite (MIT, Linux port) whose provenance and its own local modifications are documented in `runtime/PATCHES.md`. Repo-side only (no upstream file touched): `vendor/dsh-plugins/ego-browser/.gitignore` re-includes `runtime/ego-browser/dist/out/index.js` — the repository-wide `dist/` rule would otherwise drop the ego-lite compiled browser entry (loaded by `runtime/ego-linux/bin/ego-browser.mjs` on every `ego_*` call) from the commit. |

## Local dsh-workflow patches (re-applied onto v0.1.4, 2026-09-13)

The vendored copy IS upstream at the v0.1.4 tag plus exactly the seven files
below, and nothing else: `lib/engine.js` (+96/-15), `lib/engine.d.ts` (+15/-0),
`lib/index.js` (+19/-9, on top of upstream's own `pluginVersion`/`dshVersion`
bump), `lib/runtime.js` (+3/-0), `lib/service.js` (+1/-0), `lib/types.d.ts`
(+9/-0) and `docs/CONFIGURATION.md` (+1/-1). Diffed against the tag itself:
every other vendored file — including `package.json`, `cordis.patch.yml`,
`compatibility.json`, `reference.json`, the rest of `lib/`, `docs/` and
`examples/` — is byte-identical to v0.1.4. Upstream at v0.1.4 contains NONE of
these patches: it still iterates `agent.session.events`, still has the original
three-rule `needsApproval` with no sandbox/approval-policy probe, and has no
`detach`, no `wf.readFile` and no raised tier/wall defaults.

Each patch is pinned green by the local, pinned-family conformance suite named
with it (`packages/uniterra-desktop/test/workflow-*.test.mjs`, run by the
desktop `node --test` suite); the suites load the vendored `lib/` through
`workflow-engine-stub-loader.mjs` (which stubs the bare `@deepseek-ai/*` peers
the test packages do not install), so they always exercise the real vendored
engine.

1. **Session-API compatibility layer** (`sessionEventsOf` + `collect` —
   `lib/engine.js`, `lib/index.js`). dsh 0.1.2-rc.1 removed the public
   `Session#events` accessor (0.1.1-rc.2 exposed it) in favour of
   `snapshotEvents()`; the engine's four child-result collectors iterated
   `agent.session.events` unguarded, so every child that finished crashed
   result collection (`TypeError: agent.session.events is not iterable`) and
   runs hung. `sessionEventsOf(agent)` reads `events` when it is an array and
   otherwise falls back to `snapshotEvents()`, and every collection call site is
   wrapped in `collect()` so a log-shape surprise degrades to the
   auxiliary-data fallback instead of failing the task. Pinned by
   `workflow-engine-session-events.test.mjs`.
   *Removal condition:* drop when upstream reads the session log through a
   family-agnostic accessor — i.e. when upstream stops iterating
   `agent.session.events` (or when nothing pins us to a family where the
   accessor was removed).

2. **`detach()` on the run handle** (`lib/engine.js`, `lib/index.js`,
   `lib/types.d.ts`). `DynamicWorkflowEngine.start()` forwards the launching
   tool-exec signal into the long-lived run controller; in Code Mode (PTC) that
   signal IS the `run_code` run controller, aborted as soon as the model's
   program settles — which raced a still-pending approval ask (the answerer
   settles `cancelled` on an aborted signal) and denied the run without ever
   prompting the user. `runResult()` now calls `run.detach?.()` the moment a
   launch is handed to the DSH background-job system (`wait: false`), so the
   run is owned by DSH jobs; a synchronously awaited run (`wait: true`) keeps
   the binding so cancelling the parent turn still cancels the workflow. Pinned
   by `workflow-engine-detach.test.mjs`.
   *Removal condition:* drop when upstream ships a launch/ownership seam for
   background runs, or when DSH stops aborting the tool-exec signal once a
   background job is attached.

3. **Sandbox-mode approval gate** (`lib/engine.js`, `lib/engine.d.ts`,
   `lib/index.js`, `lib/service.js`). `needsApproval` keys on the session's
   SANDBOX MODE — the knob the `/permission` presets (read-only /
   workspace-write / danger-full-access) actually switch: `danger-full-access`
   runs ungated, `read-only`/`workspace-write` follow the plugin's
   `approvalMode`. The engine takes an optional `sandboxPolicy` seam
   (`ctx.sandboxPolicy`, declared structurally in `lib/engine.d.ts` so the
   vendored plugin needs no peer dependency on the sandbox-policy package);
   without the seam it falls back to the old approval-policy shortcut, where a
   `never` policy means the approval service is fail-closed and the workflow
   must run ungated rather than be auto-rejected. The seam is passed through
   `lib/index.js` `apply` → `lib/service.js` → the engine. Pinned by
   `workflow-engine-approval-mode-pbt.test.mjs` (seam mounted) and
   `workflow-engine-approval-pbt.test.mjs` (no-seam fallback), each with
   deterministic anchor cases alongside the properties.
   *Removal condition:* drop when upstream keys `needsApproval` on the session
   sandbox mode (or when DSH ships an upstream-adopted preset helper).

4. **`wf.readFile` bridge** (`lib/engine.js`, `lib/runtime.js`,
   `lib/types.d.ts`). The `uniterra-review` capsule reads the standard's
   requirements / acceptance documents through `wf.readFile` (the repo-relative
   paths in `args.standard`) and inlines their original text into the review and
   fixer prompts, so the documents reach the agents as text rather than as the
   main agent's summary. The host method resolves a repo-relative path against
   the parent session's cwd, reads it as UTF-8, and rejects workspace escapes
   (absolute or `..`) and missing files; the QuickJS runtime bridge exposes the
   same method inside workflow scripts. Pinned by
   `workflow-engine-readfile.test.mjs`.
   *Removal condition:* drop when upstream ships `wf.readFile`, or when the
   review capsule stops reading documents through it.

5. **Raised token/wall defaults** (`lib/index.js` schema + `resolveConfig`,
   `docs/CONFIGURATION.md`). The per-tier output ceilings default to 384_000
   (upstream 4_096 / 8_192 / 16_384): the `balanced` default capped every
   reasoning child far below the model's real max output and truncated responses
   mid-trace (`INCOMPLETE`), and `scriptWallTimeoutMs` defaults to 28_800_000
   (8 h, upstream 3_600_000) so a long agent fan-out is not aborted while its
   children are still working. Pinned by `workflow-tier-defaults.test.mjs` and
   `workflow-wall-timeout-default.test.mjs` (deterministic source guards).
   *Removal condition:* drop when upstream raises both defaults itself (≥ the
   model's real max output, ≥ 8 h wall).

**Verification limit (2026-09-13).** The suites above pin the vendored plugin's
real `lib/` under the stub loader, and both re-pins were verified by diffing the
vendored trees against the tags. A live `run_workflow` against a dsh 0.1.5
profile could NOT be exercised from this task: the `@deepseek-ai/*` npm pin bump
(`0.1.5-rc.2`) and the harness re-pin are separate, parallel tasks, so re-run
the smoke test below once they land.

## Local dsh-shortcuts test suite (2026-09-05, re-planted 2026-09-13)

`packages/uniterra-desktop/test/dsh-shortcuts-*.test.mjs` (run by the desktop
`node --test test/*.test.mjs` suite) pin the plugin against the PINNED dsh
family (`dsh-v0.1.5-rc.2` at the 2026-09-13 harness re-pin), plus
`scripts/verify-dsh-shortcuts-smoke/run.sh` (real dsh web boot;
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
   to the last streaming text run (the `chunkrow/text-chunks` row at 0.1.2; the
   transient `assistant/live-chunk` deltas at 0.1.5 — see the re-plant below).
3. **Focus composer**: probed `textarea`; the pinned composer is the
   contentEditable div with `role="textbox"` (ComposerContentEditable is the
   only such element in the client). Now focuses `[role="textbox"]`.
4. **Theme toggle**: hardcoded the light/dark pair, so a registered non-built-in
   theme (skin, e.g. the deep-whale maid-dark theme) was dropped to the base
   `light`. Now toggles only the built-in pair and leaves a skin theme active.

Everything else (loading protocol, slots, model/effort selection, permission
cycle + loopback route, settings persistence/migration, host route) is
pinned green by the same suite; the real dsh web boot smoke also passes.

**Breakages found by the suite, fixed locally (2026-09-13, dsh 0.1.5-rc.2
re-plant)** — the harness re-pin (patch list above) broke two seams; both are
re-planted on the 0.1.5-native API and pinned by purpose-named cases:

5. **Details toggle** (`⌘⇧D`): `ctx.layout.openDetails()`/`closeDetails()` are
   gone (0.1.5 `ctx.layout` = `selectPanel`/`beginNavigation`/
   `toggleSidebar`/`openRightbar`/`closeRightbar`; the last two report where
   the panel is drawn, they do not open it — the right column's expanded state
   belongs to its occupant `ui-sidebar-right`). The action now calls
   `ctx.sidebarRight.toggleExpanded()`, the owner's native collapse/expand
   face, and no-ops safely when that service or its mounted seat is absent
   (the service throws loudly with no mounted seat — the pinned contract).
   The oracle asserts `sidebarRight.toggleExpanded`/`isExpanded` present and
   `layout.openDetails`/`closeDetails` ABSENT, so a re-added layout notify
   fails by name too.
6. **Copy-last-message streaming fallback**: the `chunkrow/text-chunks`
   session event was removed with the 0.1.5 event-window rework; the window's
   entry union is now `{ type: 'event'; event }` |
   `{ type: 'transient'; event: AssistantLiveChunkEvent }` and the streaming
   text rides `event.data.chunk` as a raw `StreamChunk`. The reader checks the
   entry's own `type`, matches `assistant/live-chunk`, and joins the
   `text-delta` texts of the same `attemptId`/`turn`/`step` run in window
   order (a settled `assistant/message` still wins). The oracle asserts the
   `transient`/`assistant/live-chunk` rows present and the removed
   `chunkrow/` name absent.

Both are re-planted seams, not new features: the shortcut count (34),
registrations, loading protocol and the host half are unchanged, and every
0.1.2-fixed seam above stays green. All 34 shortcuts were individually driven
against the 0.1.5 fixtures with zero missing seams (see the coverage table in
the task report); the plugin-side contract test asserts each one's exact
service/projection/DOM surface, and the behavior file adds a purpose-named
case per repaired seam.
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
2. Checkout the new commit, verify it still targets the dsh family the desktop
   pins (`@deepseek-ai/dsh` in `packages/uniterra-desktop/package.json` —
   `0.1.5-rc.2` at the 2026-09-13 re-pin; its `peerDependencies`/`skin.json`
   `dshCompatibility` should name that family or the alpha it is built on),
   re-apply and re-record any local patch, re-run the smoke test below.
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