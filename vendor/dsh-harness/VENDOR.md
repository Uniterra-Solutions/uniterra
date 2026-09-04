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
| `vendor/dsh-harness/` | `deepseek-ai/deepseek-harness` | `dsh-v0.1.1-rc.2` (merge 2026-08-21) | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` | MIT |

The tree is the release tag's complete source (shallow clone minus `.git`),
including its own `pnpm-lock.yaml` so `pnpm install --frozen-lockfile` stays
reproducible. Build outputs (`lib/`, `dist/`, `node_modules/`) are never
committed — the root `.gitignore` `node_modules/` entry covers the vendored
install (and the upstream tree itself ignores its own outputs anyway).

The pin matches the desktop's npm dependency exactly: uniterra-desktop pins
`@deepseek-ai/dsh@0.1.1-rc.2` and the vendored tree is that release's source.

## Local divergences (2026-09-04)

| File | Upstream | Change | Why |
|---|---|---|---|
| `package.json` | `scripts.postinstall: node scripts/install-lefthook.mjs` | `node scripts/install-vendored-nopostinstall.mjs` | Upstream's postinstall configures Git worktree-local hooks and a merge driver in the repository it runs in (`extensions.worktreeConfig`, `core.hooksPath`, `merge.dsh-translation-pairing`). The vendored copy lives INSIDE the uniterra worktree, so the upstream script would mutate OUR repo's Git config and hooks. The no-op keeps `pnpm install --frozen-lockfile` passing locally and in CI. |
| `scripts/install-vendored-nopostinstall.mjs` | (absent) | added | No-op replacement script (prints one line). |

Everything else is pristine upstream source. **Never edit upstream files
without recording the divergence here** (same policy as
`vendor/dsh-plugins/VENDOR.md`).

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
`build:lib:host` + `build:lib:client` + `build:web` (host packages, client
packages, and the `apps/web` vite client build; the CLI entry
`apps/cli/lib/bin.js` comes out of the host pass). `--host-only` skips the
client + web passes — the fast loop for server-side edits (restart the dev
app to pick them up).

Verify the vendored CLI standalone:

```sh
node vendor/dsh-harness/apps/cli/lib/bin.js --help
```

The packaged app is unaffected: `uniterra setup` still embeds the installed
npm `@deepseek-ai/dsh@0.1.1-rc.2` packages. Shipping the desktop FROM vendored
source (and the Windows/CI ramifications) is a deliberate follow-up, not part
of this pin.

## Update policy

To bump the vendored harness:

1. Clone upstream (shallow) and checkout the new release tag, e.g.
   `git clone --depth 1 --branch dsh-v0.1.1-rc.3 https://github.com/deepseek-ai/deepseek-harness.git /tmp/dsh-src`.
2. Verify the desktop's own `@deepseek-ai/dsh` pin (`packages/uniterra-desktop/`
   `devDependencies`) matches the new tag's family; the vendored tree and the
   npm pin must stay in lockstep.
3. Re-apply the local divergences (postinstall no-op + its script), then
   replace `vendor/dsh-harness/` with the new tree (minus `.git`).
4. `pnpm run build:vendored-dsh` and re-run the dev desktop smoke.
5. Update this ledger's rows and every divergence note.
