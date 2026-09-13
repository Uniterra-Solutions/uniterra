# PRD — dsh 0.1.5 migration: plugin set, toolchain, and family upgrade (milestone v0.17.0)

## Background

Uniterra is a thin Electron shell over the DeepSeek Harness (dsh): the app boots the
bundled `dsh` CLI, and every capability the user sees comes from the dsh profile the
desktop provisions from one declarative registry
(`packages/uniterra-desktop/src/builtin.ts`) plus the in-house LLM provider
(`packages/uniterra-provider`) written against dsh's host and client APIs. The whole
stack is pinned at `@deepseek-ai/dsh@0.1.2-rc.1` — desktop devDependency, 14 provider
peer/dev dependencies, the vendored harness tree (`vendor/dsh-harness`), and two pnpm
patches.

dsh `0.1.5-rc.2` is published on the `next` tag with breaking changes across exactly
those surfaces (Session V3, `SessionHandle`/async `agentLoop`, panel API changes,
removal of `ctx.agent`, persona prefix/suffix, subprocess without pid, default-tool
changes). GitHub milestone **v0.17.0** (issues #35–#52, execution index #53) sequences
the work as three workstreams: plugin-set changes, developer-toolchain upgrades, and the
dsh-family migration itself — with #52 as the single integration convergence point that
justifies the release tag. Two issues in the requested range sit outside that milestone:
#33 (Windows startup failure, reported without a reproduction, error code, or log) and
#34 (a new turn-completion notification feature).

This document is the planning phase for that batch: it states **what must hold** and how
each requirement is objectively verified. It deliberately designs nothing.

## Goal

Take the app to the v0.17.0 milestone state — plugins the dsh core now covers natively
are removed, browser capability is carried by the vendored `dsh-ego-browser`, the
developer toolchain sits on a supported line, and the dsh family runs on `0.1.5-rc.2`
with the complete old-profile upgrade path verified end-to-end — plus #34's native
turn-completion notification, every requirement accepted by recorded, re-runnable
evidence.

## Functional Requirements

Requirement numbering is a **fixed offset: REQ-n is GitHub issue #(n+33)**, so the
mapping never has to be looked up:

| Issue | #34 | #35 | #36 | #37 | #38 | #39 | #40 | #41 | #42 | #43 | #44 | #45 | #46 | #47 | #48 | #49 | #50 | #51 | #52 |
| ----- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Req   | 1   | 2   | 3   | 4   | 5   | 6   | 7   | 8   | 9   | 10  | 11  | 12  | 13  | 14  | 15  | 16  | 17  | 18  | 19  |

Issue #33 is excluded from this plan (see Out of Scope).

### Desktop notification (#34)

- **REQ-1** — When the agent completes a response turn, a running desktop app raises a
  native OS notification carrying the session title and the completion status.
  Intermediate subagent-internal turns never raise one (no duplicates, no redundancy).
  The behaviour is controlled from a **native Electron application-menu checkbox** whose
  state is persisted per profile in the profile's `.uniterra.json` toggle file and
  survives an app restart: enabled ⇒ notification raised, disabled ⇒ none, with no other
  observable change to the shell.

### Plugin-set changes (#35–#39)

- **REQ-2** — `Fisfzy/ego-browser` is vendored under `vendor/dsh-plugins/` at a single
  pinned commit and registered in the desktop built-in registry as `kind: 'vendor'`
  (package name recorded), so a freshly provisioned profile receives it through the
  existing provisioning path with **no npm install**. At least one `ego_*` tool is
  visible in a session and executes successfully. The pin, license, trimmed scope and any
  divergence are recorded in `vendor/dsh-plugins/VENDOR.md` and
  `docs/modules/vendor-plugins.md`. No upstream source is modified beyond a recorded
  divergence that carries a removal condition.
- **REQ-3** — `dsh-browser-playwright` is declared `retired: true` in the same registry
  and is absent from the expected bundle set; a profile that already carries its bundle
  row, its `dependencies` entry and its installed copy is healed by removal on the next
  ensure pass, idempotently and touching no other package. Its
  `minimumReleaseAgeExclude` entry and docs rows are removed. **This requirement must not
  land before REQ-2 is verified** — the browser capability may never have a gap.
- **REQ-4** — `dsh-file-upload` is declared `retired: true` and healed out of already
  provisioned profiles by the same mechanism; its `minimumReleaseAgeExclude` entry and
  docs rows are removed. dsh 0.1.5's native upload path must demonstrably cover the
  capability: one attachment send is performed and recorded. **This requirement must not
  land before REQ-11** — on the 0.1.2 family the native upload path does not exist.
- **REQ-5** — `dsh-subagent-model-picker` is declared `retired: true` and healed out of
  already provisioned profiles by the same mechanism; its `minimumReleaseAgeExclude`
  entry and docs rows are removed. The native `subagent` tool must demonstrably cover the
  capability: one delegation naming an explicit `provider` + `model` is performed and
  recorded.
- **REQ-6** — The pi-ai dependency is gone: `packages/uniterra-systemprompt/` and its
  `@earendil-works/pi-coding-agent` dependency are deleted, together with the root
  `tsconfig.json` project reference, the CI job step that ran its test, its documentation
  page and its rows in `docs/` and `AGENTS.md`, with `pnpm-lock.yaml` regenerated. After
  the removal, no reference to `uniterra-systemprompt` or `pi-coding-agent` remains
  outside `node_modules/`, `dist/`, `vendor/`, `.git/` and `CHANGELOG.md` (which is a
  historical record and is not rewritten). The working-rules injection this package
  implemented is **not** reimplemented here.

### Developer toolchain (#40–#43)

- **REQ-7** — `typescript-eslint` is upgraded to 8.70.x and `@types/node` to 22.20.2, with
  `pnpm-lock.yaml` updated and only those two dependency specs changed. Lint and typecheck
  thresholds are unchanged (strict type-checked config, `--max-warnings 0`).
- **REQ-8** — `eslint` and `@eslint/js` are upgraded to 10.x. Rule intent and ignore
  behaviour are unchanged: `strictTypeChecked`, `--max-warnings 0`, and the
  `vendor/` / `lib/` / `dist/` ignores behave exactly as before. Every configuration
  change forced by a renamed or removed rule is itemised in the change record; no rule may
  silently stop applying.
- **REQ-9** — `lint-staged` is upgraded to 17.x. The pre-commit path stays equivalent:
  the `.husky/pre-commit` hook plus the root `lint-staged` file mapping
  (`prettier --write`, `eslint --fix --max-warnings 0 --no-warn-ignored`) runs to success
  on a staged `.ts` file, and no new dependency (notably not the now-optional `yaml`) is
  added.
- **REQ-10** — `typescript` is upgraded to 6.0.3 and **not** to the 7.x line. `tsc -b`
  build behaviour is unchanged: project references, `rootDir`/`outDir` conventions, build,
  typecheck and lint all green. Any type error or tsconfig adjustment is itemised with its
  reason; no `@ts-ignore`/`@ts-expect-error` escape hatch is added.

### dsh 0.1.5-rc.2 migration (#44–#51)

- **REQ-11** — Every `@deepseek-ai/*` dependency is pinned **exact** `0.1.5-rc.2` — the
  desktop devDependency, the provider's peer and dev dependencies, and the two
  `patchedDependencies` targets in `pnpm-workspace.yaml` — and `vendor/dsh-harness` is
  re-pinned to the `dsh-v0.1.5-rc.2` tag and rebuilt. The three pins (desktop, provider,
  vendored tree) are consistent, `pnpm install --frozen-lockfile` resolves, and the
  vendored CLI reports `0.1.5-rc.2`. The pin ledger in `vendor/dsh-harness/VENDOR.md` is
  updated and the status of each existing divergence (the postinstall no-op and the two
  alias patches) is recorded. This requirement carries **no adaptation code**.
- **REQ-12** — Both pnpm patches are re-evaluated against the 0.1.5 tarballs. A patch still
  required is re-derived and renamed to the 0.1.5-rc.2 target, keeps its alias-only
  semantics, and carries a removal condition in its header; a patch no longer required is
  deleted and the deletion recorded. `pnpm-workspace.yaml`'s `patchedDependencies` and the
  `patches/` directory correspond one-to-one with no dangling entry, and every built-in
  plugin that needs an alias still loads in a 0.1.5 profile.
- **REQ-13** — `preset-compat` converges on 0.1.5. Session-level dependence is removed:
  0.1.5's native `session-format-catalog` migration (v0/v1/v2 → v3, including the
  header and `agent-preset/selected` `code` → `ptc` rewrite) is confirmed to carry the
  legacy-session case, so the module no longer has to serve session headers. The settings
  layer (`agent-presets.default: code`) is measured on 0.1.5 and resolved one way or the
  other — either the user-preset shim is kept (with a recorded reason and removal
  condition) or a one-time settings migration is implemented. The never-overwrite-a-user-file
  guarantee is preserved, the module comment and the docs are updated, and an upgraded
  profile can both create a new session and resume an old one.
- **REQ-14** — `@uniterra-solutions/uniterra-provider` works on the 0.1.5 family: it loads,
  its `llm-uniterra` settings section is visible and editable under every
  settings-provider mount order, both protocols (chat completions and Responses API) are
  usable, and a model that declares image input receives images. One real conversation
  including a tool call, plus one image input, are performed and recorded. The external
  configuration format (the model-row schema) stays backward compatible; any compatibility
  branch added for 0.1.5 carries a removal condition.
- **REQ-15** — Every npm built-in is evaluated on 0.1.5 and the result is recorded:
  `dsh-better-sidebar` is upgraded to 0.19.0 (native sidebar API) and its sidebar
  integration is exercised (open a tab, open a file); `dshmarket`, `dsh-computer-use`,
  `dsh-git-worktree`, `dsh-find-plugin`, `dsh-tool-git` and the newly vendored
  `ego-browser` each get a recorded verdict covering **load + one key action** —
  green / degraded / removed / awaiting upstream. No entry may be silently disabled: a
  failure is either an explicit recorded degradation or a follow-up issue. No upstream
  plugin source is modified (a needed patch goes through the vendor policy).
- **REQ-16** — The vendored plugin pins are updated: `@dsh-external/workflow` to v0.1.4
  and `dsh-deep-whale` to v0.1.2, both recorded in `vendor/dsh-plugins/VENDOR.md`
  together with the verdict on the workflow plugin's local patch (re-planted with a
  recorded divergence, or removed and recorded). On 0.1.5, `run_workflow` succeeds for one
  of the three pipeline capsules (or the blocker and its follow-up issue are recorded
  explicitly), and the deep-whale skin loads in a profile whose optional toggle enables it.
- **REQ-17** — The vendored `dsh-shortcuts` local patches are re-planted on the 0.1.5
  client API. All 34 shortcuts are individually verified and the result recorded as a
  coverage table with no "untested" row: working / needs repair / disabled with a reason.
  Every failure is repaired or explicitly disabled, the local conformance suite (plugin
  contract, dsh-api oracle over the vendored harness sources, behaviour/PBT) and the real
  dsh web boot smoke are green, and the suite is neither deleted nor weakened. Each
  divergence is recorded in `VENDOR.md` with its upstream-removal condition. No
  compatibility-unrelated feature work is added.
- **REQ-18** — The desktop's runtime integration is verified and adapted on 0.1.5 across
  every surface it owns: the readiness line (including its auth token, never truncated),
  the `--profile` and other CLI arguments, the `DSH_BUNDLED_SKILL_DIR` contract, the
  `$DSH_HOME` layout (workflow capsules, agent presets, profiles), and exit/cleanup
  behaviour. Dev and packaged resolution paths behave identically. The three pipeline
  workflow capsules are provisioned and `run_workflow` is available, bundled skills are
  visible, and both a dev boot and a packaged boot reach an operable UI. Every surface
  change is recorded; any compatibility branch carries a removal condition.

### Integration verification (#52)

- **REQ-19** — The upgrade path is verified end-to-end and the evidence retained: the
  container replay and the Windows verification gate pass (a Windows run that cannot be
  executed is recorded with its reason and a catch-up plan — a blocking gate must pass
  before release); a pre-upgrade profile (settings `default: code` plus v0/v1/v2 session
  logs) opens a **new** session and **resumes** a pre-upgrade session on 0.1.5; the whole
  built-in plugin set loads, including the `ego_*` tools; and `run_workflow` works. Every
  step is read-only against production data and leaves a re-runnable record (command plus
  output summary). The documentation records the Session V3 one-way upgrade risk and the
  rollback guidance. Defects found are filed as follow-up issues — no in-scope repair.

## Out of Scope

- **#33 (Windows startup failure).** It carries no reproduction, no error code and no log
  — it cannot be stated as a verifiable requirement yet. It stays open and unplanned until
  the diagnostics arrive.
- **Cutting the release.** The version bump 0.16.4 → 0.17.0, the CHANGELOG entry, the tag
  and the CLI publish are a separate maintainer action; this plan stops at "every gate
  green".
- **A replacement for the removed working-rules injection.** #39 explicitly defers it to a
  separate issue; removing the pi extension does not by itself restore the rules under dsh.
- **The pnpm pin bump** 11.17.0 → 11.26.0 (deferred by #53: it drags the container and
  Windows gates for little gain).
- **Product-position decisions** deliberately deferred by #53: whether `dsh-find-plugin`
  and `dsh-shortcuts` stay, whether `uniterra-provider` keeps its current positioning, and
  upstream alignment for `dsh-computer-use` / `dsh-git-worktree` beyond the load test
  REQ-15 requires.
- **Adaptation code inside REQ-11.** The pin alignment is delivered alone; the adaptation
  is owned by REQ-12 through REQ-18.
- **New capability beyond the stated requirements** — no feature work on the plugins, no
  restructuring of the desktop, no provider translation-layer refactor unless 0.1.5
  compatibility requires it.

## Assumptions & Constraints

Facts and constraints the requirements rely on. Each lands in a requirement or an
acceptance row — never as design prose.

- **The target family is `@deepseek-ai/dsh@0.1.5-rc.2`, pinned exact.** Verified against
  the npm registry on 2026-09-13: `dist-tags` are `next: 0.1.5-rc.2`, `latest:
0.1.5-rc.1`, `alpha: 0.1.5-alpha.2`. Caret ranges are forbidden by the project's
  dsh-migration rule.
- **This dev machine is macOS-only.** Windows evidence can only come from the CI release
  gate on `windows-latest`, and container evidence from Docker. **Decision taken with the
  user: a local macOS run for the dev path plus a CI-triggered gate run for the container
  and Windows paths is acceptable evidence**, each recorded as command + output summary.
- **`dsh-ego-browser` cannot come from npm.** The registry's only published version is
  0.8.0, whose peer targets a client-runtime package the 0.1.2 family already removed; the
  pin must come from a source checkout at the recorded commit, re-verified at
  implementation time (the candidate is `6133edfb`, upstream `package.json` says
  0.8.3).
- **Session V3 is a one-way upgrade.** After a profile's sessions are opened on 0.1.5, the
  0.1.2 family cannot read them. The upgrade-path verification must therefore run against a
  **copy** of the profile, never the user's only copy, and the risk must be documented.
- **Release-gate behaviour is binding:** the container and Windows verifications are
  declared `needs` of the publish job, so a red gate blocks the release. A gate may not be
  weakened to pass — a verification script may only be corrected so that its original
  intent runs.
- **The project's standing rules apply to every requirement:** no `any`; no default
  exports (the single pi-extension exception disappears with REQ-6); internal imports keep
  their `.js` extension; `pnpm install --frozen-lockfile` in CI; lint and typecheck green
  with `--max-warnings 0`; tests for new behaviour; and after changing
  `packages/uniterra-skills` or `packages/uniterra-provider` sources the workspace build
  must run so `dist/` and `lib/` are fresh.
- **Test conventions are binding:** every regression test is named after the guarantee it
  pins (never a finding id), each PBT counterexample gains a deterministic unit regression,
  and existing purpose-named tests are never deleted or weakened.
- **The registry contract is centralised:** the built-in set is declared once in
  `registerBuiltinPlugin`, and `packages/uniterra-desktop/test/builtin-pbt.test.mjs`
  asserts its current shape (`NPM_SPECS.length >= 9`, `RETIRED.length === 6`). REQ-3,
  REQ-4 and REQ-5 change those counts, so that suite is updated in the same change — it is
  the registry's contract, not an obstacle.
- **Ordering is binding** (from #53): REQ-3 after REQ-2; REQ-4 after REQ-11; REQ-12 through
  REQ-18 after REQ-11; REQ-19 after REQ-2, REQ-3, REQ-4, REQ-5 and REQ-11 through REQ-18.
  REQ-1, REQ-6 through REQ-10 and REQ-11 have no prerequisite and may proceed first.
- **Verification is read-only against production data** and every step leaves a re-runnable
  record; defects discovered during REQ-19 are filed as follow-up issues rather than fixed
  in scope.
