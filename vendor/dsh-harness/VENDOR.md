# Vendored DeepSeek Harness source (dsh)

The full upstream source tree of the DeepSeek Harness monorepo, vendored so we
can develop **against dsh source** instead of the compiled npm packages.

Why source: npm publishes `@deepseek-ai/dsh` and its ~60 `@deepseek-ai/dsh-*`
packages with compiled `lib/` only (`files` never includes `src/`), so a
behavioural change to dsh cannot be made against the installed packages. The
desktop's dev loop resolves this tree first (see
`packages/uniterra-desktop/src/dsh-cli-path.ts`): when the vendored source is
built, the dev app runs it — source edits take effect on the next dev boot.

## Pin ledger

| Directory | Upstream | Pinned tag | Pinned commit | License |
|---|---|---|---|---|
| `vendor/dsh-harness/` | `deepseek-ai/deepseek-harness` | `dsh-v0.1.2-rc.1` (merge 2026-09-03) | `a66e4702047846cdaa10c66c9d3df3951f5ea70d` | MIT |

The tree is the release tag's complete source (shallow clone minus `.git`),
including its own `pnpm-lock.yaml` so `pnpm install --frozen-lockfile` stays
reproducible. Build outputs (`lib/`, `dist/`, `node_modules/`) are never
committed — the root `.gitignore` `node_modules/` entry covers the vendored
install (and the upstream tree itself ignores its own outputs anyway).

The pin matches the desktop's npm dependency exactly: uniterra-desktop pins
`@deepseek-ai/dsh@0.1.2-rc.1` and the vendored tree is that release's source.

## Local divergences (2026-09-04)

| File | Upstream | Change | Why |
|---|---|---|---|
| `package.json` | `scripts.postinstall: node scripts/install-lefthook.mjs` | `node scripts/install-vendored-nopostinstall.mjs` | Upstream's postinstall configures Git worktree-local hooks and a merge driver in the repository it runs in (`extensions.worktreeConfig`, `core.hooksPath`, `merge.dsh-translation-pairing`). The vendored copy lives INSIDE the uniterra worktree, so the upstream script would mutate OUR repo's Git config and hooks. The no-op keeps `pnpm install --frozen-lockfile` passing locally and in CI. |
| `scripts/install-vendored-nopostinstall.mjs` | (absent) | added | No-op replacement script (prints one line). |
| `packages/core/session/src/index.ts` | (no isJsonValue/snapshotJsonValue) | `export { isJsonValue, snapshotJsonValue } from '@deepseek-ai/dsh-util-values'` — TEMPORARY alias | Same rename wave: the 0.1.2-rc.1 family moved these JSON helpers to `@deepseek-ai/dsh-util-values`, but old-family copies still import them from `dsh-session` — notably `@deepseek-ai/dsh-tools@0.1.1-rc.2`, the exact-version dependency that `dsh-computer-use@0.2.0` still pins. Re-exporting keeps the whole plugin layer loadable. Paired npm-family patch: `patches/@deepseek-ai__dsh-session@0.1.2-rc.1.patch`. Remove with the other alias row. |
| `packages/llm/llm/src/brand.ts` | (no CallId export) | `export { ToolCallId as CallId }` — TEMPORARY compatibility alias | The 0.1.2-rc.1 family renamed `CallId` → `ToolCallId` (breaking, per the pre-release stance), but the community plugin ecosystem (dsh-better-sidebar, dsh-file-upload, dsh-find-plugin, dsh-subagent-model-picker, dsh-tool-git, dsh-browser-playwright, dsh-computer-use, dsh-git-worktree — every npm built-in we ship) still imports `CallId` from `@deepseek-ai/dsh-llm`, so the whole plugin layer fails to load on the new family (`The requested module '@deepseek-ai/dsh-llm' does not provide an export named 'CallId'`). The row also re-exports `assertNever` / `deepFreeze` from `@deepseek-ai/dsh-util-values` (moved out of dsh-llm in the same rename wave) — the plugins import all three together. Keeping the aliases makes the plugins loadable until upstream re-releases them against the renamed surface; remove this row when the last pinned plugin version is re-published. The npm-family side of this shim ships as the workspace pnpm patch `patches/@deepseek-ai__dsh-llm@0.1.2-rc.1.patch` (`patchedDependencies` in the root `pnpm-workspace.yaml`). |

Everything else is pristine upstream source. **Never edit upstream files
without recording the divergence here** (same policy as
`vendor/dsh-plugins/VENDOR.md`). This bump re-applied the same two divergences
on the 0.1.2-rc.1 tree — the upstream postinstall script is unchanged.

## Family notes (0.1.2-rc.1 vs 0.1.1-rc.2)

Breaking changes the uniterra migration had to absorb (see the release
changelog): `@deepseek-ai/dsh-client-runtime` was REMOVED — the web client
runtime is now `@deepseek-ai/dsh-cordis-client-runner` (+ `@deepseek-ai/dsh-client-ui-cordis`), the client wire face moved from `connection.api` (IApiClient) to the typed Remote namespaces on `ctx.remote` (`dsh-api-remotes` assembly), the client-plugin module table changed to `packages/client/web`'s `PLATFORM_MODULES`, the settings section slot gained the `locale` registration field and the `settings.section` owner `close` prop, `ctx.settings.register` replaces the old `installSettingsSection` helper, cordis bumped to 4.0.2 (strict `inject` guards), and `@deepseek-ai/dsh-llm`'s `CallId` was renamed `ToolCallId` — a rename the community plugin ecosystem hasn't caught up with (see the brand.ts divergence row for the temporary compatibility alias).

## Development loop

From the repo root:

```sh
# one-time + after every upstream pin bump: install (frozen lockfile) + full build
pnpm run build:vendored-dsh

# after changing only a HOST (server-side) package under vendor/dsh-harness:
pnpm run build:vendored-dsh --host-only

# run the dev desktop (uses the vendored CLI when built, npm fallback otherwise)
pnpm --filter @uniterra-solutions/uniterra-desktop dev
```

`pnpm run build:vendored-dsh` runs, inside `vendor/dsh-harness/`,
`pnpm install --frozen-lockfile` then `pnpm run build` — which is upstream's
`tsx scripts/build.ts` (host packages, client packages, and the
`@deepseek-ai/dsh-web-frontend` vite build; the CLI entry
`apps/cli/lib/bin.js` comes out of the host pass). `--host-only` skips
the client + web passes — the fast loop for server-side edits (restart the dev
app to pick them up).

Verify the vendored CLI standalone:

```sh
node vendor/dsh-harness/apps/cli/lib/bin.js --version   # 0.1.2-rc.1
```

The packaged app is unaffected: `uniterra setup` still embeds the installed
npm `@deepseek-ai/dsh@0.1.2-rc.1` packages. Shipping the desktop FROM vendored
source (and the Windows/CI ramifications) is a deliberate follow-up, not part
of this pin.

## Update policy

To bump the vendored harness:

1. Clone upstream (shallow) and checkout the new release tag, e.g.
   `git clone --depth 1 --branch dsh-v0.1.2-rc.2 https://github.com/deepseek-ai/deepseek-harness.git /tmp/dsh-src`.
2. Verify the desktop's own `@deepseek-ai/dsh` pin (`packages/uniterra-desktop/`
   `devDependencies`) matches the new tag's family; the vendored tree and the
   npm pin must stay in lockstep.
3. Re-apply the local divergences (postinstall no-op + its script), then
   replace `vendor/dsh-harness/` with the new tree (minus `.git`).
4. `pnpm run build:vendored-dsh` and re-run the dev desktop smoke.
5. Update this ledger's rows and every divergence note.
