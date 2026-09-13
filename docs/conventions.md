# Conventions

Company-standard rules drawn from `AGENTS.md`, `eslint.config.mjs` and `tsconfig.base.json`. Every rule is falsifiable against the code; the module docs own the detail these rules point at.

## Language / Module System

| Rule                                                                   | Enforcement                                   |
| ---------------------------------------------------------------------- | --------------------------------------------- |
| Node ≥ 22 (`.nvmrc`, `engines`)                                        | Manual                                        |
| NodeNext ESM: internal imports carry `.js` extensions                  | Node runtime failure                          |
| Named exports only; no default exports                                 | Manual (`AGENTS.md`)                          |
| No `any`                                                               | ESLint `no-explicit-any: error`               |
| Explicit function return types                                         | ESLint `explicit-function-return-type: error` |
| Readonly by default, exhaustive switches, no floating/misused promises | ESLint strictTypeChecked + extra rules        |

## TypeScript Config (shared)

`tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals` / `noUnusedParameters`, `noFallthroughCasesInSwitch`, `module` / `moduleResolution` NodeNext, `target` / `lib` ES2022, `isolatedModules`, `rootDir: ${configDir}/src`, `outDir: ${configDir}/dist`. Every package extends it.

## Dependencies

- **Exact `@deepseek-ai/*` pins (no caret).** dsh is a developer preview with breaking changes, and `npm view X version` returns a stale `latest` tag — the current family is on the `next` tag.
- **`pnpm install --frozen-lockfile` in CI** — never a bare `pnpm install`; reproducible installs.
- **`@uniterra-solutions/*` exports point at built `dist`**, never `./src`: the desktop consumes them as externalized dependencies, and Node cannot load TS source.
- **Exception — `@uniterra-solutions/uniterra-provider` exports point at `lib/`** (its esbuild bundle), not `dist/`; that is why `eslint.config.mjs` ignores `**/lib/` alongside `**/dist/`.
- **Ask before adding a dependency or changing lint / tsconfig rules** — they encode the company standard.

## Formatting (Prettier)

Single quotes, trailing commas, print width 100, LF line endings. Run `pnpm format`; the gate is `pnpm format:check`.

## Git / Commits

- Imperative subject lines in Conventional-Commit style (`feat:`, `fix:`, `chore(release):` — see `CHANGELOG.md`).
- `.husky/pre-commit` runs `lint-staged`: `*.{ts,tsx}` → `prettier --write` + `eslint --fix --max-warnings 0`; `*.{json,md,yaml,yml}` → `prettier --write`. Any ESLint warning or error blocks the commit.
- Never commit `.env` files or secrets; never edit `generated/` or `node_modules/`.
- Don't hand-edit `vendor/dsh-plugins/` unless the plugin is one we **customize** — a customized plugin is vendored FOR that reason and edited in place, with the divergence + pending-upstream note recorded in the `vendor/dsh-plugins/VENDOR.md` pin ledger; anything else stays a `node_modules`/npm import, bumped via that ledger's update policy, never in place. Do not vendor a plugin you will not modify.
- Root `prepare` is `husky || true` — GitHub source tarballs ship no `.git`, so husky must tolerate absence.

## Testing

- **Every business-logic change ships with tests.** Property-based tests (fast-check) pin the invariants; contract and end-to-end tests are added only where they earn their place.
- **Review regression tests are permanent.** `uniterra-review`'s review agent pins each invariant as a property-based test in the repo's existing test + property-testing stack, at the conventional test location and named after the TEST PURPOSE it pins (the guarantee it enforces, never a finding id); it reports only counterexamples it confirmed red. The fix agent turns them green but never deletes or renames them, and adds a deterministic unit regression test per counterexample (a concrete minimal input + the exact outcome the invariant requires, under the same purpose-named title) so the bug reproduces without RNG.
- **Vendored-plugin patches are pinned against the vendored dsh family.** A customized plugin ships a local suite (`packages/uniterra-desktop/test/<plugin>-*.test.mjs` + a real-boot smoke): a plugin-side contract table, a dsh-api oracle that reads the `vendor/dsh-harness` sources so drift fails by name, and behaviour/PBT. Patching in place means keeping the suite green and recording the divergence as a `LOCAL PATCH` in `vendor/dsh-plugins/VENDOR.md` + the `docs/modules/vendor-plugins.md` row.
- **Hermetic verification for installs.** `scripts/verify-cli-container/run.sh` replays the installer flow in Docker (no macOS runner needed); Windows branches are exercised by `scripts/verify-windows-install/verify.ps1` on windows-latest. Both gate a release.
- **Wire facts are verified LIVE, not assumed.** A seam read out of the vendored sources is a claim about the shipped runtime, so the transport behind it ships a re-runnable harness that drives a REAL dsh: `scripts/verify-turn-notification/run.sh` (cookie exchange, `session/list`, `session/follow`) and `scripts/verify-dsh-shortcuts-smoke/run.sh`. A dsh pin bump re-runs both.
- **PBT-first bug fixes.** Encode the invariant as a failing property before touching the code — see [modules/uniterra-skills.md](modules/uniterra-skills.md#uniterra-pbt-debugging) and [workflows.md](workflows.md#debug-a-bug-pbt-first).

## Workflow Capsules

- **`review` is the only bundled capsule.** `uniterra-review` ships `workflows/review.workflow.json` and calls it by NAME through the dsh_workflow `run_workflow('review', args)` tool — never by copying a JS block into a `workflow` tool call.
- **Capsule format.** `format: dsh.workflow`, `version: 1`, `workflowApiVersion: 1`, a valid manifest (name / phases / readOnly / maxAgents / maxConcurrency / patterns) and a `source` defining `async function run(wf, args)` over the `wf` API (`wf.phase` / `wf.runAgent` with `outputSchema` / `wf.readFile`). Subagent reports to the workflow are the structured output of each `runAgent`.
- **Args stay tiny: paths, never documents.** When `standard` names the requirements / acceptance documents, the capsule reads them itself with `wf.readFile` (the engine rejects a path that escapes the workspace) and inlines their original text into the review and fixer prompts.
- **Report through `structured_output`.** Every agent prompt requires dsh's built-in `structured_output` tool exactly once with the exact schema, and forbids finishing with a plain-text JSON string or a markdown code block. Review/fix-produced tests are named after the TEST PURPOSE they pin, never a finding id.
- **Retired capsules are healed on boot.** `ensureWorkflowCapsules` removes every `RETIRED_WORKFLOW_CAPSULES` name (`packages/uniterra-desktop/src/builtin.ts`) from the profile's workflow dir on every boot.
- **Approval follows the session sandbox mode.** The `run_workflow` approval gate is decided by the sandbox mode the `/permission` presets switch: `danger-full-access` skips it, `read-only` / `workspace-write` require the user's approval popup; the approval-policy knob is only a fallback when the DSH sandbox-policy seam is absent. A background launch (`wait: false`) is detached once handed to the DSH job system, so the launching step closing can never cancel a pending approval or a running fan-out; a synchronous launch (`wait: true`) keeps the binding, so cancelling the parent turn cancels the workflow.
- Pins: `packages/uniterra-skills/test/workflow-templates.test.mts` (structure + stubbed-`wf` execution under the engine contract), `packages/uniterra-desktop/test/workflow-engine-approval-mode-pbt.test.mjs` and `workflow-engine-detach.test.mjs`; the engine ledger is `vendor/dsh-plugins/VENDOR.md`.

## Build / Distribution

- **Desktop resolves consumed packages via their `dist` exports** — after changing `uniterra-skills` or `uniterra-updater` source, run `pnpm run build`.
- **The provider ships via `lib/`** — after changing `uniterra-provider` source, run `pnpm run build` (tsc + esbuild) or the profile ships a stale plugin.
- **Skills and the review capsule refresh in the same build** — after changing `src/skills/*`, `pnpm run build` reruns `copy-skills.mjs` (stale entries removed, so a deleted skill stops shipping) and `build-workflow-capsules.mjs` (regenerated byte-identically from the skill's reference files).
- **Installer-flow changes** — after changing the `uniterra setup` flow or root scripts, run `scripts/verify-cli-container/run.sh`; the Windows branches are re-verified by the release gate on windows-latest.
- **A dsh pin bump** — re-run `scripts/verify-turn-notification/run.sh` and `scripts/verify-dsh-shortcuts-smoke/run.sh`, and rebuild the vendored CLI (`pnpm run build:vendored-dsh`): a new family can move any seam the shell or a vendored plugin relies on.

## How to Update

- New convention adopted → add it here and to `AGENTS.md` (the rulebook; this file mirrors the falsifiable subset).
- ESLint / Prettier / tsconfig change → ask first, then update this file and the tool config together.
- Documentation budget → `AGENTS.md` + this file stay at or under 32,000 bytes COMBINED (`wc -c AGENTS.md docs/conventions.md`); move detail into `docs/modules/*` rather than growing these two.

## Find It Fast

```bash
grep -n '"@deepseek-ai/' packages/*/package.json   # exact-version pin check
grep -rn 'no-explicit-any' eslint.config.mjs       # any-ban rule
wc -c AGENTS.md docs/conventions.md                # documentation budget
```
