# Workflows

Task recipes. Each links to the module/skill that owns the details.

## Develop a Feature (company standard)

1. Load the `uniterra-plan` skill; clarify the requirements list AND architecture design interactively; scaffold the run dir (`node "<skill_base>/scripts/init_plan.mjs" <name>`) and fill `prd.md` / `design.md` / `acceptance.md` under `<repo>/.plan/<YYYYMMDD>/<name>/`.
2. Confirm the plan with the user — read the three docs back with a short summary and ask (`ask_user_question`) whether the content is broadly correct and matches their needs; apply the edits they raise and show the result again until they confirm.
3. Run the plan's review workflow — a SINGLE parallel review pass: three review agents (feasibility, over-engineering, verifiable acceptance) run once; the capsule returns each failing axis's issues and the main agent applies them itself (no repair agent, no re-review loop; each run is a fresh single pass). Call `run_workflow('plan-review', { prd_dir, design_dir, acceptance_dir })` (the persisted `plan-review` capsule; no script to copy).
4. Load `uniterra-implement`: write ALL failing property tests (red phase), decompose into a task list — scaffold each brief with `node "<skill_base>/scripts/init_task.mjs" <project-name> <task-id> <task-name>` (writes `.dsh/<YYYYMMDD-HHmmss>/<project-name>/<task-name>.md` + that project's `task.json` manifest — one manifest per project, so multiple projects under one timestamp never overwrite each other) and pass `{ id, name, promptFile }` per task — call `run_workflow('implement', { tasks })` for independent tasks (full-parallel) or `run_workflow('implement', { batches })` for overlapping ones (serial batches of parallel tasks); the capsule inlines each brief into the subagent prompt (subagents report via `structured_output`, never a JSON string); confirm the full suite is green. Do NOT write a separate plan document.
5. Run `uniterra-review` (property-based adversarial: the review agent reads every business module in scope in one pass and models the WHOLE business logic + lifecycle — every operation, every state, happy paths included, not just the paths that look suspicious — into a formal spec table of state / transition / lifecycle / data / security invariants, AND derives security invariants from the security checklist so logic security is PBT-verified too, writes state-machine property tests that brute-force random operation sequences (plus input-generating properties) in one pass then runs them together in a background job with >10,000 iterations, and shrinks each counterexample into a structured error report — file, line, input or operation sequence, expected/actual; the fixer repairs each, pins it with a deterministic unit regression test (concrete minimal input — no RNG), and names every test after the TEST PURPOSE it pins (never a finding id), and reports back to the main agent, which aggregates by severity critical/medium/low, stating which logic is wrong, why, and the user impact — without ever re-running the tests) and/or `uniterra-simplify` (over-engineering checklist, behaviour-preserving; the plan's design is an authoritative constraint). The review is proven sound when no counterexample remains.
   Details: [modules/uniterra-skills.md](modules/uniterra-skills.md#uniterra-plan).

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

## Bump a Vendored Plugin

Only for a plugin we do NOT customize (a customized plugin is edited in place — see below):

1. `git -C vendor/dsh-plugins/<name> fetch --depth 1 origin`; checkout the new commit.
2. Verify dsh-family compatibility (0.1.1-rc.2 / cordis 4.0.1); re-run the smoke test.
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
