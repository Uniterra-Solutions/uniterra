# dsh-skill-market

A DeepSeek Harness plugin that adds a **Skill Market** to the web UI **settings page**: search GitHub for skills and install them with one click into `~/.dsh/skills` (the `user-dsh` skill root that the model's `skill` tool already reads).

- Host half (`index.js`): a `webServer` prefix route `/skill-market/api/*` doing GitHub repo search, repo inspection, tarball download + extract, and skill install/uninstall.
- Browser half (`client.js`): a hand-authored `__ModuleLoader__` bundle (no build step) registering a `settings.section` entry labeled 技能市场 / Skill Market.

## Features

- Search GitHub (dsh-skill topic first, keyword fallback) for skill repos.
- Inspect a repo's layout (root `SKILL.md` → one skill; `skills/<name>/SKILL.md` or `skills/<name>.md` → several).
- One-click install: downloads the repo tarball from `codeload.github.com`, extracts it, copies each skill into the install dir.
- Installed-skills tab with per-skill uninstall (moved to `.trash-*`, recoverable).
- Same-origin POST guard on mutating endpoints.

## Install

```sh
# from GitHub (pin a commit for production use)
dsh plugin --profile web add "github:QQ-M/dsh-skill-market"

# or from a tarball / local path:
# dsh plugin --profile web add ./dsh-skill-market-0.1.0.tgz
```

Then restart the web profile (`dsh web`) — the browser half is picked up from the `dsh.client` declaration at boot.

## Configuration

The bundle patch (`cordis.patch.yml`) inserts the plugin row; the following `config` keys are supported:

| Key | Default | Meaning |
|---|---|---|
| `installDir` | `<DSH_HOME>/skills` | Where installed skills are written |
| `githubToken` | `''` | GitHub token to lift the 10 req/min anonymous search limit |
| `githubTokenFile` | `''` | Path to a file containing a GitHub token |
| `searchLimit` | `20` | Max search results |

If neither token option is set, `GITHUB_TOKEN` from the environment is used. Anonymous search works but is rate-limited (~10 req/min), so a token is recommended for heavy browsing.

Example override in your profile `cordis.patch.yml` (replaces the whole row by `id` — restate every key):

```yaml
- insert:
    - id: skill-market
      name: dsh-skill-market
      config:
        installDir: /path/to/skills
        githubTokenFile: /path/to/gh-token
```

## API

All endpoints are same-origin JSON under `/skill-market/api/`:

- `GET /api/search?q=<query>` → `{ ok, items: [{ fullName, owner, repo, description, stars, updatedAt, url, topics }] }`
- `GET /api/repo?owner=&repo=` → `{ ok, defaultBranch, description, stars, url, skills: [{ name, path }] }`
- `POST /api/install` `{ owner, repo, ref? }` → `{ ok, branch, installed: [{ name, path, description }] }`
- `GET /api/installed` → `{ ok, installDir, items: [{ name, path, description }] }`
- `POST /api/uninstall` `{ name }` → `{ ok, message }`

## Development

```sh
node --check index.js   # syntax check host half
node --check client.js  # syntax check browser bundle
```

The host half depends only on `node:*` builtins + the bare `schemastery` schema package (LOCAL PATCH: upstream imported the scoped `@deepseek-ai/schemastery`, which a dsh profile does not resolve). The browser half depends only on the module table's `react`.
