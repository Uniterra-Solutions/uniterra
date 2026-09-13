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
| `vendor/dsh-harness/` | `deepseek-ai/deepseek-harness` | `dsh-v0.1.5-rc.2` | `fb2c4b9e698e30edb738bca4cf0618587db7d203` | MIT |

The tree is that release tag's complete source, taken as the GitHub source
archive (`…/archive/refs/tags/dsh-v0.1.5-rc.2.tar.gz`) and copied in with
`rsync -a --delete --exclude node_modules --exclude .dsh-build`; it therefore
carries no `.git` and must stay a plain copy (it lives inside the uniterra
worktree). It includes its own `pnpm-lock.yaml` so `pnpm install
--frozen-lockfile` stays reproducible. Build outputs (`lib/`, `dist/`,
`node_modules/`) are never committed — the root `.gitignore` `node_modules/`
entry covers the vendored install (and the upstream tree itself ignores its own
outputs anyway).

Commit verified against upstream with
`git ls-remote --tags https://github.com/deepseek-ai/deepseek-harness.git`:
`fb2c4b9e698e30edb738bca4cf0618587db7d203 refs/tags/dsh-v0.1.5-rc.2`.

**Lockstep gap at this pin (2026-09-13):** the npm dependency the desktop pins
(`@deepseek-ai/dsh@0.1.2-rc.1`) is still one family behind this tree. The
`@deepseek-ai/*` pin bump and the pnpm patches are a separate, parallel task;
until it lands the dev desktop runs 0.1.5-rc.2 source while the packaged app
embeds the 0.1.2-rc.1 npm packages. The two must be back in the same family
before release.

## Local divergences (2026-09-13)

| File | Upstream | Change | Why | Status at `dsh-v0.1.5-rc.2` |
|---|---|---|---|---|
| `package.json` | `scripts.postinstall: node scripts/install-lefthook.mjs` | `node scripts/install-vendored-nopostinstall.mjs` | Upstream's postinstall configures Git worktree-local hooks and a merge driver in the repository it runs in (`extensions.worktreeConfig`, `core.hooksPath`, `merge.dsh-translation-pairing`). The vendored copy lives INSIDE the uniterra worktree, so the upstream script would mutate OUR repo's Git config and hooks. The no-op keeps `pnpm install --frozen-lockfile` passing locally and in CI. | **STILL APPLIED.** The 0.1.5-rc.2 `scripts/install-lefthook.mjs` still writes those same keys (`REPOSITORY_EXTENSION_PATTERN`, `PAIRING_MERGE_DRIVER_CONFIG`), so the reason is unchanged. Proven by the install log line `postinstall: vendor/dsh-harness: postinstall no-op (upstream lefthook install skipped)`. |
| `scripts/install-vendored-nopostinstall.mjs` | (absent) | added | No-op replacement script (prints one line). | **STILL APPLIED.** Re-created verbatim on this tree; the postinstall row above is inert without it. |
| `packages/core/session/src/index.ts` | (no isJsonValue/snapshotJsonValue) | `export { isJsonValue, snapshotJsonValue } from '@deepseek-ai/dsh-util-values'` — TEMPORARY alias | The 0.1.2-rc.1 family moved these JSON helpers to `@deepseek-ai/dsh-util-values`, but old-family plugin copies still import them from `dsh-session`. Re-exporting keeps the whole plugin layer loadable. | **STILL APPLIED.** 0.1.5-rc.2 still keeps both helpers only in `@deepseek-ai/dsh-util-values`; the installed plugin layer still needs the alias — `@deepseek-ai/dsh-tools@0.1.1-rc.2/lib/index.js:5` reads `import { isJsonValue, snapshotJsonValue } from "@deepseek-ai/dsh-session"`, and `dsh-computer-use@0.2.0` pins exactly that `dsh-tools` (`"@deepseek-ai/dsh-tools": "0.1.1-rc.2"`). Paired npm-family patch: `patches/@deepseek-ai__dsh-session@<pinned-family>.patch`, owned by the parallel `@deepseek-ai/*` pin task. |
| `packages/llm/llm/src/brand.ts` | (no `CallId` / `assertNever` / `deepFreeze` export) | `export { ToolCallId as CallId }` plus `export { assertNever, deepFreeze } from '@deepseek-ai/dsh-util-values'` — TEMPORARY compatibility alias | The 0.1.2-rc.1 family renamed `CallId` → `ToolCallId` and moved `assertNever`/`deepFreeze` out of `dsh-llm`, but the community plugin ecosystem (every npm built-in we ship) still imports all three from `@deepseek-ai/dsh-llm`; without the aliases the whole plugin layer fails to load (`The requested module '@deepseek-ai/dsh-llm' does not provide an export named 'CallId'`). | **STILL APPLIED.** `ToolCallId` is still the only spelling in 0.1.5-rc.2 and the installed plugin layer still imports the old one — `@deepseek-ai/dsh-tools@0.1.1-rc.2/lib/index.js:4` reads `import { CallId, HarnessError, assertNever, createUserMessage, deepFreeze } from "@deepseek-ai/dsh-llm"`. Retirement trigger unchanged: the last pinned plugin re-published against the renamed surface (the npm-family side of this shim is the `patches/@deepseek-ai__dsh-llm@<pinned-family>.patch` workspace patch, owned by the parallel pin task). |

Everything else is pristine upstream source at this tag. Audited, not assumed:
`diff -rq --exclude=node_modules --exclude=.dsh-build` between the extracted
`dsh-v0.1.5-rc.2` archive and this tree reports exactly the three files above
plus the added `scripts/install-vendored-nopostinstall.mjs` (and this
`VENDOR.md`, which is ours, not upstream). The same audit against the previous
`dsh-v0.1.2-rc.1` archive confirmed the previous ledger listed every divergence
that existed — nothing was silently dropped by this re-pin. **Never edit
upstream files without recording the divergence here** (same policy as
`vendor/dsh-plugins/VENDOR.md`).

## Family notes (0.1.5-rc.2 vs 0.1.2-rc.1)

Structural deltas a consumer of this tree has to know (verified against both
archives):

- 267 packages vs 249; 18 added, none removed. The added set is mostly the new
  Session-format migration family — `session/session-format`,
  `session/session-format-catalog`, `session/session-format-v0-to-v1`,
  `session/session-format-v1-to-v2`, `session/session-format-v2-to-v3` — plus
  `api/workspace-files`, `fs/tool-present`, `host/open-in-app`,
  `util/chunked-list`, `util/http-proxy`, `util/package-manifest`, `client/file-upload`,
  `client/resources`, and five `client/ui-*` plugins.
- `SESSION_FORMAT_VERSION` in `packages/core/session/src/types.ts` is now `3`
  (it was `0` at 0.1.2-rc.1), and `docs/session-format-status.md` records
  `latestReleasedVersion: 3` with `evidenceTag: dsh-v0.1.5-alpha.1`. The v2→v3
  step is where the session header's `agentPreset` and every
  `agent-preset/selected` event are rewritten `'code'` → `'ptc'`
  (`packages/session/session-format-v2-to-v3/src/migration.ts:18` and `:142-144`);
  `session-persistence-jsonl` depends on that package directly, and the exact rewrite
  is pinned in `packages/session/session-format-v2-to-v3/tests/preset-migration.spec.ts`
  (`migrates only the exact legacy header preset`, `preserves admitted selection
  metadata`, plus the negative cases `code-custom` / `Code`);
  `packages/session/session-persistence-jsonl/tests/v2-ptc-migration.spec.ts` replays
  the same v2→v3 step end to end through real JSONL publication.
- `native/landlock-run` (`@deepseek-ai/node-addon-landlock-run`) was replaced by
  `native/system` (`@deepseek-ai/node-addon-system`), and the root build runs
  `tsx native/system/scripts/build.ts --host-addon-only` before the libraries.

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
`tsx scripts/build.ts` (native system addon, host packages, client packages, and
the `@deepseek-ai/dsh-web-frontend` vite build; the CLI entry
`apps/cli/lib/bin.js` comes out of the host pass). `--host-only` runs
`build:lib:host` only — the fast loop for server-side edits (restart the dev app
to pick them up).

Verify the vendored CLI standalone:

```sh
node vendor/dsh-harness/apps/cli/lib/bin.js --version   # 0.1.5-rc.2
```

The packaged app is unaffected by this pin: `uniterra setup` still embeds the
installed npm `@deepseek-ai/dsh@0.1.2-rc.1` packages until the parallel npm pin
task lands. Shipping the desktop FROM vendored source (and the Windows/CI
ramifications) is a deliberate follow-up, not part of this pin.

## Update policy

To bump the vendored harness:

1. Verify the tag and its commit with `git ls-remote --tags
   https://github.com/deepseek-ai/deepseek-harness.git`, then download the
   source archive:
   `curl -L https://github.com/deepseek-ai/deepseek-harness/archive/refs/tags/<tag>.tar.gz`
   and extract it under `/tmp`.
2. Audit the OUTGOING tree before replacing it, so no unrecorded local edit is
   lost: `diff -rq --exclude=node_modules --exclude=.dsh-build` the previous
   tag's archive against `vendor/dsh-harness`. Every difference must be a row in
   this ledger (plus this file).
3. Copy the new tree in: `rsync -a --delete --exclude node_modules --exclude
   .dsh-build <extracted>/ vendor/dsh-harness/`. `--delete` is required so
   files the new tag removed do not linger. Two traps: (a) macOS ships rsync
   2.6.9, which rejects `--info=stats2` (`--stats` works) and reports it as a
   usage error that a pipeline can swallow; (b) when a removed path still holds
   an excluded `node_modules` directory, rsync warns `not empty, cannot
   delete` and leaves the skeleton behind — check with
   `diff -rq … | grep '^Only in'` and remove the leftovers by hand.
   This file (`VENDOR.md`) is ours, not upstream: rsync deletes it, so keep a
   copy and rewrite it.
4. Re-apply every divergence above (postinstall no-op + its script, the two
   compatibility aliases), or record in the table why it is retired.
5. Check the npm lockstep: `packages/uniterra-desktop`'s `@deepseek-ai/dsh` pin
   and the vendored tree should be the same family; record the gap here if they
   cannot move together.
6. `pnpm run build:vendored-dsh` and re-run the dev desktop smoke.
7. Update this ledger's rows (tag, commit, per-divergence status) and the family
   notes.
