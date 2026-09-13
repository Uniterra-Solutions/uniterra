# Common Development Commands

- `pnpm run build` — TypeScript compilation (tsc -b). Run it before the other gates: `tsc -b --noEmit` fails with TS6310 when referenced projects are stale.
- `pnpm run typecheck` — type-check without emitting output.
- `pnpm run lint` — ESLint strictTypeChecked, `--max-warnings 0`.
- `pnpm run format` — Prettier (single quotes, trailing commas, 100 width, LF); `pnpm run format:check` is the gate.
- `pnpm install --frozen-lockfile` — the only install form, CI and local.

Each package builds first, then tests its compiled output (`dist/`, or `lib/` for the provider):

- `pnpm --filter @uniterra-solutions/uniterra-provider test` — dual-protocol translate (chat completions + Responses API), reasoning-preservation regressions and seeded properties; `pnpm --filter @uniterra-solutions/uniterra-provider run lint` / `run typecheck` cover host + client source.
- `pnpm --filter @uniterra-solutions/uniterra-skills test` — the build regenerates the review capsule and `dist/skills/`, then provisioning + workflow-capsule contract / orchestration-PBT / deterministic-regression tests run.
- `pnpm --filter @uniterra-solutions/uniterra run build` — compile the installer CLI; `pnpm --filter @uniterra-solutions/uniterra test` adds CLI unit + install-logic PBT; `run lint` / `run typecheck` cover the source.
- `pnpm --filter @uniterra-solutions/uniterra-desktop test` — profile bootstrap, built-ins/readiness PBT, the spawn contract, the turn-notification suites, vendored-plugin conformance and the workflow-engine pins.

Live harnesses drive the REAL runtime and are the regression net for wire facts — never replace one with a fake:

- `scripts/verify-turn-notification/run.sh` — boots the bundled dsh in a throwaway `DSH_HOME` and asserts the real transport (root-token cookie, `session/list`, `session/follow`); needs a built desktop package.
- `scripts/verify-cli-container/run.sh` — replays the CLI setup/update flow in a clean container (Docker).
- `scripts/verify-windows-install/verify.ps1` — the real Windows install on windows-latest (CI release gate only, never locally on macOS).
- `scripts/verify-dsh-shortcuts-smoke/run.sh` — real dsh web boot with the vendored `dsh-shortcuts` plugin.

# Project Goals

- A free, non-commercial desktop workspace: one app that unifies the DeepSeek Harness (dsh) agent runtime and its plugins into a single surface.
- Assembled for our own use and open-sourced as a shared toolchain — anyone can use it; no paid tiers or revenue model.
- The project's working conventions ship as bundled skills (see packages/uniterra-skills).

# Project Structure

`packages/*` are pnpm workspace packages; each extends `tsconfig.base.json` with `rootDir: src` / `outDir: dist`. The root holds shared tooling only (eslint, prettier, husky, tsconfig). Each bullet below is a responsibility map entry; the linked module doc owns the detail.

- `packages/uniterra-skills/` — built-in skill registry: the standard skills in `src/skills/*` ship to `dist/skills/` (`scripts/copy-skills.mjs`, stale entries removed) plus the persisted `review` workflow capsule (`scripts/build-workflow-capsules.mjs`). `provisionBuiltinSkills()` installs them idempotently and removes retired names; in dsh they ship as the rank-600 bundled provider via `DSH_BUNDLED_SKILL_DIR`. Details: [docs/modules/uniterra-skills.md](docs/modules/uniterra-skills.md)
- `packages/uniterra-desktop/` — Electron shell over the bundled dsh CLI: one declarative built-in registry (`src/builtin.ts`) with copy/staleness/retirement semantics, skill + workflow-capsule + agent-preset provisioning, turn-completion notifications owned by the shell, the update check with its single detached updater hand-off (`src/update-launch.ts`), and the one-shot report of the last update read from the CLI's durable record (`src/update-progress.ts`). Details: [docs/modules/uniterra-desktop.md](docs/modules/uniterra-desktop.md)
- `packages/uniterra-provider/` — in-house dual-protocol LLM provider (chat completions + Responses API over any OpenAI-compatible gateway, models.dev metadata, per-model protocol and vision flags, Web settings page); ships as a workspace built-in built to a self-contained `lib/`. Details: [docs/modules/uniterra-provider.md](docs/modules/uniterra-provider.md)
- `packages/uniterra-cli/` — public npm installer (`@uniterra-solutions/uniterra`, bin `uniterra`): `uniterra setup` downloads or builds the source, packages it with electron-builder, embeds the source tree and installs it; `uniterra update` is the one-command full update. Both commands stream NDJSON progress events (`@@uniterra `) beside the untouched human output and mirror them to `UNITERRA_UPDATE_PROGRESS_FILE` when set. Details: [docs/modules/uniterra-cli.md](docs/modules/uniterra-cli.md)
- `packages/uniterra-updater/` — pure update-check decision logic (no Electron imports). Details: [docs/modules/uniterra-updater.md](docs/modules/uniterra-updater.md)
- `vendor/dsh-plugins/` — community plugins we **customize**, vendored in place at pinned commits: every local divergence and its pending-upstream note lives in the `VENDOR.md` pin ledger, and a customized plugin keeps its pinned-family conformance suite green. Details: [docs/modules/vendor-plugins.md](docs/modules/vendor-plugins.md)
- `vendor/dsh-harness/` — the full upstream DeepSeek Harness source at the pinned tag, vendored because npm publishes compiled `lib/` only; the dev desktop prefers its built CLI (`pnpm run build:vendored-dsh`) and otherwise falls back to the npm-linked package. Pin ledger: `vendor/dsh-harness/VENDOR.md`
- `scripts/verify-*` — the live harnesses listed under Commands.

# Prohibitions

- Never remove `.js` extensions from internal imports — required by NodeNext ESM resolution.
- Never use the `any` type — blocked by `no-explicit-any: error`.
- Never run `pnpm install` without `--frozen-lockfile` in CI.
- Never commit TypeScript that fails ESLint, warnings included — `.husky/pre-commit` runs `lint-staged` with `--max-warnings 0`.
- Never bump Node below 22 — pinned in `.nvmrc` and `package.json`.
- Never add default exports — named exports only.
- Never hand-edit `vendor/dsh-plugins/` unless the plugin is one we customize; a customized plugin is vendored FOR that reason and edited in place, with the divergence recorded as a `LOCAL PATCH` in the `VENDOR.md` ledger **and** the `docs/modules/vendor-plugins.md` row, and its conformance suite kept green. Everything else stays a `node_modules`/npm import, bumped via the ledger's update policy. Do not vendor a plugin you will not modify.
- Never point an `@uniterra-solutions/*` package export at `./src` when the desktop consumes it — Node cannot load TS source as an externalized dependency, so exports point at built `dist`. Exception: `uniterra-provider` ships its esbuild bundle as `lib/index.js` / `lib/client.js`, which is why `eslint.config.mjs` ignores `**/lib/` alongside `**/dist/`.
- Never loosen the dsh pins: every `@deepseek-ai/*` dependency is an exact version (no caret) — dsh is a developer preview with breaking changes, and `npm view X version` returns a stale `latest` tag (the current family is on the `next` tag).

# Boundaries

**Always:**

- Run `pnpm run lint` and `pnpm run typecheck` before committing, after a build (`tsc -b --noEmit` fails with TS6310 when referenced projects are stale).
- Add tests for new behaviour.
- Keep this file and `docs/conventions.md` at or under 32,000 bytes COMBINED (`wc -c AGENTS.md docs/conventions.md`) — they are orientation and rules; detail belongs in the linked `docs/` module docs, not here.
- `uniterra-review` regression tests are permanent: the review agent pins each invariant with a property-based test in the repo's existing test + property-testing stack and conventional test location, named after the TEST PURPOSE it pins (the guarantee it enforces, never a finding id), and reports only counterexamples it confirmed (red); the fix agent turns them green but never deletes or renames them, and adds a DETERMINISTIC unit regression test per counterexample (a concrete minimal input + the exact outcome the invariant requires, under a purpose-named title) so the bug reproduces without RNG — those deterministic regressions are permanent too.
- Keep `run_workflow('<workflow>', args)` args tiny — pass repo-relative paths (the review capsule reads the standard documents itself via `wf.readFile`), never inline document text.
- Rebuild what the desktop consumes: `pnpm run build` after changing `packages/uniterra-skills` or `packages/uniterra-updater` source (the app resolves their `dist` exports), and after changing `packages/uniterra-provider` source (its built `lib/` is copied into the profile — stale `lib/` ships an outdated plugin).
- After changing `packages/uniterra-skills/src/skills/*` or the review capsule's prompt sources, run `pnpm run build` so `build-workflow-capsules.mjs` regenerates `src/skills/uniterra-review/workflows/review.workflow.json` and `copy-skills.mjs` refreshes `dist/skills/`.
- After changing `vendor/dsh-harness` source (or bumping its pin), run `pnpm run build:vendored-dsh` (or `--host-only` for server-only edits) and record the change in `vendor/dsh-harness/VENDOR.md`.
- After changing the turn-notification transport (`packages/uniterra-desktop/src/dsh-observer.ts`) or bumping the dsh pin, run `scripts/verify-turn-notification/run.sh` — it drives the REAL dsh and fails when a wire fact (the cookie, the unary envelope, the mux stream protocol) drifts.
- After changing the `uniterra setup` install flow or root package scripts, run `scripts/verify-cli-container/run.sh` — it replays the installer flow in a clean container and fails on any regression (no-TTY pnpm install, dsh resolution, bundled skills). Windows branches run in the release gate (`scripts/verify-windows-install/verify.ps1`, windows-latest).

**Ask first:**

- Adding new dependencies to `package.json`.
- Changing eslint / prettier / tsconfig rules — they encode the project standard.

**Never:**

- Commit `.env` files or secrets.
- Edit `generated/` or `node_modules/`.
