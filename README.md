# Uniterra

A desktop app built on the DeepSeek Harness (dsh) agent runtime and community dsh plugins: an Electron shell launches the bundled dsh CLI, provisions built-in plugins and skills into the user's profile, and hosts the dsh Web UI in a window. **The goal is to let you build your own desktop agent app through plugins** — it ships 9 npm community plugins, 2 vendored community plugins (dsh-shortcuts, plus the dsh_workflow dynamic-workflow layer), 1 optional vendored plugin (the Deep Whale skin, opt-in), and 1 in-house provider plugin, and you can install more at any time.

**Docs: [Documentation](docs/README.md)** (architecture diagrams, module deep dives, setup, testing, workflows) · **Spec: [AGENTS.md](AGENTS.md)**

## Built-in Plugins

The app ships 13 built-in plugins (9 npm community, 2 vendored, 1 optional, 1 in-house). Source and license:

| Plugin                                  | Type     | Source                                                                                                       | License         |
| --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ | --------------- |
| `dshmarket`                             | npm      | [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market)                                            | MIT             |
| `dsh-notifier`                          | npm      | [THEWOLFWALKER/dsh-notifier](https://github.com/THEWOLFWALKER/dsh-notifier)                                  | MIT             |
| `dsh-better-sidebar`                    | npm      | [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)                              | MIT             |
| `dsh-file-upload`                       | npm      | [HongMing-Huang/dsh-file-upload](https://github.com/HongMing-Huang/dsh-file-upload)                          | MIT             |
| `dsh-find-plugin`                       | npm      | [awesome-dsh-plugin/dsh-find-plugin](https://github.com/awesome-dsh-plugin/dsh-find-plugin)                  | MIT             |
| `dsh-subagent-model-picker`             | npm      | [npm package](https://www.npmjs.com/package/dsh-subagent-model-picker) (author ninjasln, no public repo)     | MIT             |
| `dsh-tool-git`                          | npm      | [lxj808624/dsh-tool-git](https://github.com/lxj808624/dsh-tool-git)                                          | MIT             |
| `dsh-browser-playwright`                | npm      | [ChenyuHeee/dsh-browser-playwright](https://github.com/ChenyuHeee/dsh-browser-playwright)                    | MIT             |
| `dsh-computer-use`                      | npm      | [988hj7tczd-oss/dsh-computer-use](https://github.com/988hj7tczd-oss/dsh-computer-use)                        | MIT             |
| `dsh-deep-whale`                        | optional | [Small-tailqwq/dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale)                              | CC BY-NC-SA 4.0 |
| `dsh-shortcuts`                         | vendored | [Ricketts-Guo/dsh-shortcuts](https://github.com/Ricketts-Guo/dsh-shortcuts)                                  | MIT             |
| `@dsh-external/workflow`                | vendored | [omdsh-dev/dsh_workflow](https://github.com/omdsh-dev/dsh_workflow)                                          | MIT             |
| `@uniterra-solutions/uniterra-provider` | in-house | [Uniterra-Solutions/uniterra](https://github.com/Uniterra-Solutions/uniterra) (`packages/uniterra-provider`) | MIT             |

Vendored plugins are pinned at fixed commits — see [vendor/dsh-plugins/VENDOR.md](vendor/dsh-plugins/VENDOR.md). We vendor a plugin **only because we customize it** (edit its copied source in place, recording the divergence + pending-upstream note in the `VENDOR.md` pin ledger); a plugin we do not modify stays a `node_modules`/npm import.

`dsh-deep-whale` is an optional (opt-in) skin — not installed by default. It is licensed under CC BY-NC-SA 4.0 and is redistributed free of charge, unmodified, for non-commercial use. If you are its author and do not want it bundled, please open an issue and we will remove it.

## Built-in Workflows

| Workflow                                                                                                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **TDD development workflow** (`uniterra-plan` → `uniterra-implement` → `uniterra-simplify` / `uniterra-review`) | Plan → clarify requirements + design interactively → scaffold the run dir (`init_plan.mjs`) and write `prd.md` / `design.md` / `acceptance.md` → confirm the plan with the user → review them in a SINGLE parallel pass (3 agents: feasibility / over-engineering / verifiable acceptance; no repair agent, no re-review loop — the main agent applies the returned issues and may re-run the review fresh) → implement: write ALL failing property tests, decompose into a task list (each brief is scaffolded by `init_task.mjs` under `.dsh/<YYYYMMDD>/<task>/` and inlined into the subagent prompt by the workflow — `args` carries only a `promptFile` path, keeping the `run_workflow` JSON tiny), run a batched / full-parallel workflow of subagents → review (property-based: extract each branch's pre/post-conditions + invariants into a formal spec table, and derive security invariants from the security checklist so logic security is verified via PBT too; write all the tests in one pass, prove them with >10,000-run PBT in a background job, shrink counterexamples into structured error reports (every adversarial test named after the test purpose it pins); a fixer repairs each and reports back, and the main agent — you — aggregates by severity + user impact without re-running the tests) and/or simplify (over-engineering checklist, behaviour-preserving; the plan's design is an authoritative constraint). Property testing blocks the bugs a known invariant would introduce, during development |
| **TDD debugging workflow** (`uniterra-pbt-debugging`)                                                           | Don't change code first: read the business logic, encode it as invariants, reproduce the bug via property testing (must fail; the counterexample is the reproduction) → fix the root cause → lock it with regression tests. Reduces debugging to a machine-search problem, maximizing an AI agent's ability to fix software defects                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Project documentation management** (`project-documentation`, etc.)                                            | Structured `docs/` tree generation and incremental updates; plus QA acceptance (`uniterra-qa`), AGENTS.md management (`manage-agents-md`), git workflows (`manage-git-repo`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Workflow details: [docs/modules/uniterra-skills.md](docs/modules/uniterra-skills.md) · common task recipes: [docs/workflows.md](docs/workflows.md)

## Built-in Provider Enhancement

`@uniterra-solutions/uniterra-provider`: a dual-protocol (OpenAI chat completions + Responses API) LLM provider plugin that can be configured against any OpenAI-compatible external provider, with upstream model metadata (context window / output tokens / reasoning efforts) auto-detected via models.dev, and a Web settings page for managing the gateway and per-model protocol overrides. See [docs/modules/uniterra-provider.md](docs/modules/uniterra-provider.md).

## Quick Start

```bash
# Install the app (macOS / Windows 10+)
npm install -g @uniterra-solutions/uniterra
uniterra setup
# macOS → ~/Applications/Uniterra.app; Windows → %LOCALAPPDATA%\Programs\cardo (with a Start Menu shortcut)
uniterra update
# One-command update: refresh the CLI + rebuild/reinstall the app + auto-relaunch (Update Now in the app runs this too)

# Development
git clone https://github.com/Uniterra-Solutions/uniterra.git
cd uniterra
pnpm install --frozen-lockfile
pnpm build && pnpm lint && pnpm typecheck
pnpm --filter @uniterra-solutions/uniterra-desktop dev    # dev mode (does not touch the real ~/.dsh)
```

Test commands and the verification matrix: [docs/testing.md](docs/testing.md) · environment variables: [docs/setup.md](docs/setup.md)

## Tech Stack

Node ≥ 22 · Electron 37 · @deepseek-ai/dsh 0.1.1-rc.2 (pinned exact) · TypeScript ~5.9 (NodeNext ESM) · pnpm 11 · fast-check (PBT) · esbuild / electron-builder. Full list: [docs/tech-stack.md](docs/tech-stack.md)

## Conventions

NodeNext ESM (internal imports carry `.js` suffixes) · named exports only · no `any` · `@deepseek-ai/*` pinned exact · every business logic has tests. See [AGENTS.md](AGENTS.md) and [docs/conventions.md](docs/conventions.md).

## License

[MIT](LICENSE)
