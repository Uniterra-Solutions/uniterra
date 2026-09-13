# Uniterra

A desktop app built on the DeepSeek Harness (dsh) agent runtime and community dsh plugins: an Electron shell launches the bundled dsh CLI, provisions built-in plugins and skills into the user's profile, and hosts the dsh Web UI in a window. **The goal is to let you build your own desktop agent app through plugins** — it ships 6 npm community plugins, 4 vendored community plugins (dsh-shortcuts, the dsh_workflow dynamic-workflow layer, the ego-browser browser-automation plugin, and the skill-market installer), 1 optional vendored plugin (the Deep Whale skin, opt-in), and 1 in-house provider plugin, and you can install more at any time. A finished turn raises a native OS notification, so long agent runs do not need watching.

**Docs: [Documentation](docs/README.md)** (architecture diagrams, module deep dives, setup, testing, workflows) · **Spec: [AGENTS.md](AGENTS.md)**

## Built-in Plugins

The app ships 12 built-in plugins (6 npm community, 4 vendored, 1 optional, 1 in-house). Source and license:

| Plugin                                  | Type     | Source                                                                                                       | License                                |
| --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `dshmarket`                             | npm      | [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market)                                            | MIT                                    |
| `dsh-better-sidebar`                    | npm      | [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)                              | MIT                                    |
| `dsh-find-plugin`                       | npm      | [awesome-dsh-plugin/dsh-find-plugin](https://github.com/awesome-dsh-plugin/dsh-find-plugin)                  | MIT                                    |
| `dsh-tool-git`                          | npm      | [lxj808624/dsh-tool-git](https://github.com/lxj808624/dsh-tool-git)                                          | MIT                                    |
| `dsh-computer-use`                      | npm      | [988hj7tczd-oss/dsh-computer-use](https://github.com/988hj7tczd-oss/dsh-computer-use)                        | MIT                                    |
| `dsh-git-worktree`                      | npm      | [wloops/dsh-git-worktree](https://github.com/wloops/dsh-git-worktree)                                        | MIT                                    |
| `dsh-deep-whale`                        | optional | [Small-tailqwq/dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale)                              | MIT (code) + CC BY-NC-SA 4.0 (artwork) |
| `dsh-shortcuts`                         | vendored | [Ricketts-Guo/dsh-shortcuts](https://github.com/Ricketts-Guo/dsh-shortcuts)                                  | MIT                                    |
| `@dsh-external/workflow`                | vendored | [omdsh-dev/dsh_workflow](https://github.com/omdsh-dev/dsh_workflow)                                          | MIT                                    |
| `dsh-ego-browser`                       | vendored | [Fisfzy/dsh-ego-browser](https://github.com/Fisfzy/dsh-ego-browser)                                          | MIT                                    |
| `dsh-skill-market`                      | vendored | [QQ-M/dsh-skill-market](https://github.com/QQ-M/dsh-skill-market)                                            | MIT                                    |
| `@uniterra-solutions/uniterra-provider` | in-house | [Uniterra-Solutions/uniterra](https://github.com/Uniterra-Solutions/uniterra) (`packages/uniterra-provider`) | MIT                                    |

Vendored plugins are pinned at fixed commits — see [vendor/dsh-plugins/VENDOR.md](vendor/dsh-plugins/VENDOR.md). We vendor a plugin **only because we customize it** (edit its copied source in place, recording the divergence + pending-upstream note in the `VENDOR.md` pin ledger); a plugin we do not modify stays a `node_modules`/npm import.

Three former npm built-ins are retired into the dsh 0.1.5 core instead of shipping twice: the file-upload plugin (the web app now carries its own native client row), the subagent model picker (the native `subagent` tool selects `provider`/`model` per delegation), and the browser-automation plugin (superseded by the vendored `dsh-ego-browser`). Each stays declared `retired: true` in the registry, so an already-provisioned profile is healed by removal on its next launch and user-installed plugins are never touched.

`dsh-deep-whale` is an optional (opt-in) skin — not installed by default. At the pinned v0.1.2 tag its licence is split: **MIT for the code** (`LICENSE`) and **CC BY-NC-SA 4.0 for the artwork** (`LICENSE-ARTWORK`, non-commercial). It is redistributed free of charge, unmodified, for non-commercial use. If you are its author and do not want it bundled, please open an issue and we will remove it.

## Built-in Workflows

| Workflow                                                                 | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Adversarial review workflow** (`uniterra-review`)                      | Requirement-as-standard adversarial review, usable with or without a plan: hand the review agent the review scope and — when a plan exists — `prd.md` + `acceptance.md` as their ORIGINAL TEXT (documents in, main-agent narrative out) → the review agent models and PROVES three layers by property-based testing (>10,000 runs per invariant: intra-module logic + lifecycle, module × counterpart interactions, the system slices with the external world mocked), audits every requirement line against the acceptance evidence it names, and returns the compliance table (requirements X/Y, acceptance M/N) plus the three instrument findings (coverage gap / hollow test / spec contradiction) → a fixer repairs each counterexample and pins a deterministic unit regression per fix → the main agent aggregates by severity + user impact instead of re-running the tests. Invoke with `run_workflow('review', { task, standard })`. See [docs/workflows.md](docs/workflows.md). |
| **Skill & prompt authoring** (`dsh-skill-creator` / `dsh-prompt-writer`) | Author the toolchain itself: `dsh-skill-creator` freezes a reusable process into a dsh skill — where the SKILL.md belongs (project / user / bundled roots, and which root wins a duplicate name), the naming + frontmatter contract, a body that changes behaviour, and how to verify the registry picked it up; `dsh-prompt-writer` turns a request into one self-contained executor order — recon with real tools, settle every decision, deliver it as a single copyable fenced block, then verify the result instead of trusting the report. See [docs/modules/uniterra-skills.md](docs/modules/uniterra-skills.md).                                                                                                                                                                                                                                                                                                                                                                    |
| **TDD debugging workflow** (`uniterra-pbt-debugging`)                    | Don't change code first: read the business logic, encode it as invariants, reproduce the bug via property testing (must fail; the counterexample is the reproduction) → fix the root cause → lock it with regression tests. Reduces debugging to a machine-search problem, maximizing an AI agent's ability to fix software defects                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Project documentation management** (`project-documentation`, etc.)     | Structured `docs/` tree generation and incremental updates; plus QA acceptance (`uniterra-qa`), AGENTS.md management (`manage-agents-md`), git workflows (`manage-git-repo`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Workflow details: [docs/modules/uniterra-skills.md](docs/modules/uniterra-skills.md) · common task recipes: [docs/workflows.md](docs/workflows.md)

## Built-in Provider Enhancement

`@uniterra-solutions/uniterra-provider`: a dual-protocol (OpenAI chat completions + Responses API) LLM provider plugin that can be configured against any OpenAI-compatible external provider, with upstream model metadata (context window / output tokens / reasoning efforts) auto-detected via models.dev, and a Web settings page for managing the gateway and per-model protocol overrides. See [docs/modules/uniterra-provider.md](docs/modules/uniterra-provider.md).

## Turn-Completion Notifications

When a turn finishes, the app raises one native OS notification (session title + how the turn ended) so you do not have to watch a long run. It is **on by default** and toggled from the application menu's **Notifications** checkbox; the preference lives in `~/.dsh/.uniterra.json`.

The shell owns the whole path — no notification plugin — and only user-facing sessions are followed (an intermediate subagent turn never notifies). A broken stream, a refused socket, or a dead runtime degrades to silence rather than an error. See [docs/modules/uniterra-desktop.md](docs/modules/uniterra-desktop.md#turn-completion-notifications).

## Quick Start

```bash
# Install the app (macOS / Windows 10+)
npm install -g @uniterra-solutions/uniterra
uniterra setup
# macOS → ~/Applications/Uniterra.app; Windows → %LOCALAPPDATA%\Programs\Uniterra (with a Start Menu shortcut)
uniterra update
# One-command update: refresh the CLI + rebuild/reinstall the app + auto-relaunch (Update Now in the app runs this too)

# Development
git clone https://github.com/Uniterra-Solutions/uniterra.git
cd uniterra
pnpm install --frozen-lockfile
pnpm build && pnpm lint && pnpm typecheck
pnpm build:vendored-dsh                                   # build the vendored DeepSeek Harness source (one-time; dev then runs dsh from this source)
pnpm --filter @uniterra-solutions/uniterra-desktop dev    # dev mode (does not touch the real ~/.dsh)
```

The dsh runtime source is vendored at `vendor/dsh-harness` (pinned `dsh-v0.1.5-rc.2` — npm ships compiled `lib/` only). The dev app resolves its built CLI first, so a source edit there runs on the next dev boot; see `vendor/dsh-harness/VENDOR.md` and `pnpm run build:vendored-dsh` for the loop.

Test commands and the verification matrix: [docs/testing.md](docs/testing.md) · environment variables: [docs/setup.md](docs/setup.md)

## Tech Stack

Node ≥ 22 · Electron 37 · @deepseek-ai/dsh 0.1.5-rc.2 (pinned exact) · TypeScript ~6.0.3 (NodeNext ESM) · pnpm 11 · fast-check (PBT) · esbuild / electron-builder. Full list: [docs/tech-stack.md](docs/tech-stack.md)

## Conventions

NodeNext ESM (internal imports carry `.js` suffixes) · named exports only · no `any` · `@deepseek-ai/*` pinned exact · every business logic has tests. See [AGENTS.md](AGENTS.md) and [docs/conventions.md](docs/conventions.md).

## License

[MIT](LICENSE)
