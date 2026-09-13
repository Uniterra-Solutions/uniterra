# Workflows

Task recipes. Each links to the module/skill that owns the details.

## Review Changes (company standard)

1. Load the `uniterra-review` skill and assemble the review scope: what changed / what to
   review (default: the uncommitted diff), stated as a pointer — e.g. "review the changed
   modules in packages/uniterra-provider (the diff)". Hand the review agent no summary of your
   own; it reads the code and the documents itself.
2. When requirements of record exist, add the **standard**: pass
   `standard: { requirements, acceptance }` — repo-relative paths to the requirement and
   acceptance documents (e.g. `.plan/20260913/orders/prd.md` +
   `.plan/20260913/orders/acceptance.md`). Both must exist and carry content; the capsule
   reads them with `wf.readFile` and inlines them VERBATIM into the review AND the fixer
   prompt (documents in, main-agent narrative out). With no plan, omit it — the review then
   runs standalone as pure code modelling.
3. Call `run_workflow('review', { task, standard })` as ONE call. It orchestrates two
   subagents in a single pass. The **review agent** models and PROVES three layers by
   property-based testing (>10,000 runs per invariant, one pass, background job): (1)
   intra-module — the module's own business logic + lifecycle, every operation and state,
   happy paths included; (2) interaction — the module × each counterpart contract, with the
   counterpart mocked to its contract and its states injected; (3) integration — the system
   slices involving the module with the external world mocked (fs/network/env/clock), failures
   injected at any point. Security invariants come from the security checklist and are
   PBT-proven too. On the standard axis it audits every requirement line → its acceptance line
   → the test that evidence names (exists / passes / non-hollow) and returns one `compliance`
   row per requirement, reporting the three instrument findings — coverage gap, hollow test,
   spec contradiction. Every counterexample is shrunk into a structured report (file, line,
   input, expected/actual).
4. The **fixer agent** receives the same standard, repairs each counterexample so its property
   test passes, re-runs it green, and adds a DETERMINISTIC unit regression test per
   counterexample (one concrete minimal input + the outcome the invariant requires, named
   after the TEST PURPOSE it pins — never a finding id). It never repairs against a
   requirement: a report that conflicts with the standard is refused and reported as `failed`.
   It leaves changes UNCOMMITTED.
5. The run returns `{ status, clean, reports, fixes, compliance }`. **You (the main agent)
   aggregate**: group the counterexamples + fixes by severity (critical / medium / low), say
   which layer each came from, which logic is wrong and the user impact, and — when a standard
   was supplied — report the compliance summary (requirements X/Y, acceptance M/N) with every
   non-`pass` row. Do NOT dispatch a summarizer agent and do NOT re-run the property tests.
   Details: [modules/uniterra-skills.md](modules/uniterra-skills.md#uniterra-review).

## Debug a Bug (PBT-first)

1. Load the `uniterra-pbt-debugging` skill; read the business logic, find its invariants.
2. Encode the invariants as a fast-check property; run it — it must FAIL (the counterexample is the reproduction). Refine until it fails.
3. Fix the root cause; the PBT goes green; add a unit regression test for the concrete case; run the full suite.
   Details: [modules/uniterra-skills.md](modules/uniterra-skills.md#uniterra-pbt-debugging).

## Add a Bundled Skill

1. Create `packages/uniterra-skills/src/skills/<name>/SKILL.md` (model it on an existing bundled skill's `SKILL.md` — same frontmatter `name:` + `description:` structure).
2. Add the name to `SKILL_NAMES` in `packages/uniterra-skills/src/index.ts`.
3. `pnpm run build` (copy-skills refreshes `dist/skills/`).
4. Extend `packages/uniterra-skills/test/provision.test.mts`.

Creating a dsh **user** skill — one that belongs to the user or their project rather than to this bundled set — is a different job: load the `dsh-skill-creator` skill, which covers the roots a skill can live in, the naming + frontmatter contract and how to verify discovery.

## Bump a Vendored Plugin

Only for a plugin we do NOT customize (a customized plugin is edited in place — see below):

1. `git -C vendor/dsh-plugins/<name> fetch --depth 1 origin`; checkout the new commit.
2. Verify dsh-family compatibility (0.1.5-rc.2 / cordis 4.0.2); re-run the smoke test.
3. Update the pin-ledger row in `vendor/dsh-plugins/VENDOR.md`.
   Details: [modules/vendor-plugins.md](modules/vendor-plugins.md).

## Customize a Vendored Plugin

Vendor it because we need to modify it, then edit the copied source in place and record the divergence + pending-upstream note in the pin-ledger row (`VENDOR.md` **LOCAL PATCH** note). An unmodified plugin is NOT vendored — keep it a `node_modules`/npm import.

## Add a Built-in npm Plugin

1. Add the pinned spec as a `registerBuiltinPlugin({ kind: 'npm', spec })` entry in `packages/uniterra-desktop/src/builtin.ts`.
2. Add it to the root `pnpm-workspace.yaml` `minimumReleaseAgeExclude`.
3. Extend `packages/uniterra-desktop/test/builtin-pbt.test.mjs` and update [modules/vendor-plugins.md](modules/vendor-plugins.md).

## Change the Provider

1. Edit `packages/uniterra-provider/src/` (translators, adapter, or settings page).
2. New wire shape → per-shape regression + seeded property in `test/reasoning-preservation.test.mjs`.
3. `pnpm --filter @uniterra-solutions/uniterra-provider test`, then root `pnpm run build` — the desktop provisions the built `lib/`.

## Change an Installer/Desktop Behaviour

1. Edit `packages/uniterra-cli` or `packages/uniterra-desktop`; extend the PBT lanes (platform branches included).
2. `pnpm run build && pnpm run lint && pnpm run typecheck`; per-package tests.
3. Installer/root-script changes additionally: `scripts/verify-cli-container/run.sh` (clean-container replay); Windows branches are exercised by `scripts/verify-windows-install/verify.ps1` in the release gate (windows-latest).
4. Bumping the dsh pin additionally: rebuild the vendored CLI (`pnpm run build:vendored-dsh`) and re-run the LIVE harnesses — `scripts/verify-turn-notification/run.sh` (the observer's cookie/unary/mux seams) and `scripts/verify-dsh-shortcuts-smoke/run.sh` (a real dsh web boot with the vendored plugin). A new family can move any of them, and the fakes in the suites cannot see that.

## Release a Version

1. Bump the version declarations — root `package.json`, `packages/uniterra-cli/package.json`, `packages/uniterra-desktop/package.json`, and the version table in `docs/tech-stack.md` — plus a `CHANGELOG.md` entry; commit, push.
2. Push tag `v<version>` — `release.yml` gates the publish on the full matrix (CI lint/typecheck/tests + clean-container installer replay + windows-latest install verification, all via `needs`); on success it publishes the CLI via npm trusted publishing, builds the workspace on Linux, and creates the GitHub Release carrying the `uniterra-src-<tag>.tar.gz` source asset (built tree + `.uniterra-prebuilt` marker).
3. Version mismatch between tag and `packages/uniterra-cli/package.json` fails the release.
   Details: [modules/uniterra-cli.md](modules/uniterra-cli.md), [modules/uniterra-updater.md](modules/uniterra-updater.md).

## Regenerate Documentation

1. Load the `project-documentation` skill (SCAN → ANALYZE → GENERATE → VERIFY).
2. Generate in dependency order; `docs/README.md` LAST; then sync the root README.
3. Run the 5-dimension audit (coverage, links, freshness, quality, diagrams).

## How to Update

- Recipe becomes stale → update the steps and re-check the linked module doc.
- New common task → add a recipe here.

## Find It Fast

```bash
ls packages/uniterra-skills/src/skills/   # skills referenced above
```
