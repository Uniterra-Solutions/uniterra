# Setup

Two paths: end-user install (the `uniterra` CLI) and developer setup (this monorepo).

## End-User Install (macOS / Windows 10+)

```bash
npm install -g @uniterra-solutions/uniterra
uniterra setup            # download source → build → package → install → launch
```

Install targets: macOS `~/Applications/Uniterra.app`; Windows `%LOCALAPPDATA%\Programs\Uniterra` (plus a Start Menu shortcut). Prerequisites on both platforms: Node ≥ 22, pnpm, git; Windows 10+ ships `tar` built in.

`uniterra setup` flags: `--source <dir>` (build a local workspace checkout instead of downloading a release), `--move-source` (treat the `--source` checkout as disposable and move it into the app instead of copying — throwaway checkouts only, e.g. CI verification; the checkout must not be a working copy you want to keep), `--no-open` (skip launch), `--dry-run` (print the plan, install nothing). Re-running `uniterra setup` reinstalls the app. `uniterra update` is the one-command update: it refreshes the CLI itself, then rebuilds + reinstalls the app from the latest source and relaunches it (same flags as `setup`; `--no-open` skips the relaunch). The desktop's Update Now quits the app and runs `uniterra update` automatically — the relaunch IS the restart. See [modules/uniterra-cli.md](modules/uniterra-cli.md).

## Upgrading a 0.1.2-Era Profile (Session V3 Is One-Way)

Uniterra 0.1.5 runs dsh 0.1.5-rc.2, which raised the session-log format from v0 to v3 and ships the
`v0 → v1 → v2 → v3` migration catalog. Opening an existing profile with 0.1.5 therefore rewrites
state that a 0.1.2-era app can no longer read: **the upgrade is one-way, so back up `~/.dsh`
first.**

### Before You Upgrade

```bash
cp -a ~/.dsh ~/.dsh-pre-0.1.5-backup   # or a Time Machine / volume snapshot
```

That copy is the only way back: a 0.1.2-era app cannot read what 0.1.5 wrote into the live home,
so restoring the backup — or staying on the 0.1.5 line — are the only options. Keep at least
`sessions/`, `settings.yaml` and `profiles/web/` (manifest + `.uniterra.json`): the desktop
rewrites the profile manifest in place on the first 0.1.5 launch (retired plugins removed,
`dsh-better-sidebar` bumped, `dsh-ego-browser` added), and every session touched afterwards is
migrated in place.

### What the Upgrade Does

1. `ensureBuiltinPlugins` reconciles the profile before the runtime starts (retired built-ins
   removed, missing/stale built-ins installed). A profile that still lists the retired
   `dsh-file-upload` cannot boot 0.1.5 at all ("duplicate loader entry id: file-upload", the row
   the 0.1.5 web app now owns), so run the app — not the raw CLI — to upgrade.
2. The first time a pre-upgrade session is opened or resumed, the migration catalog rewrites its
   header and events. The original log is left untouched as `session.jsonl.zstd`; the migrated log
   is written beside it as `session.v3.jsonl.zstd` and every later turn lands there. A legacy
   `agentPreset: "code"` (Code Mode) header becomes `ptc`.
3. Sessions created by 0.1.5 exist only as `session.v3.jsonl.zstd`.

```bash
zstd -dc ~/.dsh/sessions/*/*/session.v3.jsonl.zstd | head -1   # header: {"type":"session","version":3,…}
```

### Start a New Conversation After Upgrading

**A conversation you resume from before the upgrade keeps the tool set it was created with** — this is
the one upgrade effect a user can notice.

dsh rebuilds a live session from its own log, so the request sent to the model replays the tool roster
recorded when that session was created. Measured on a resumed pre-upgrade session versus a new one
(same profile, same runtime):

| Conversation                    | Tools sent | `browser_*` (retired) | `ego_*` (new) |
| ------------------------------- | ---------- | --------------------- | ------------- |
| Resumed from before the upgrade | 75         | 17                    | 0             |
| Started after the upgrade       | 93         | 0                     | 32            |

The retired `dsh-browser-playwright` is gone from the profile, so an older conversation that decides
to browse will call a tool that no longer exists and the call fails — and it does not know about the
`ego_*` browser tools that replaced it. Everything else (chat, files, bash, git, `computer_*`,
workflow) is unaffected, and **a new conversation is always fully up to date.**

So: to pick up the new tools, start a new conversation. This is a session-log property of dsh, not
something the app can migrate — the roster in an existing session's header is what the model is shown.

### What Is NOT Possible Afterwards

- **Reading or continuing upgraded work from a 0.1.2-era app.** The older runtime knows only the
  `session.jsonl.zstd` layout — it does not list a 0.1.5-created session, and resuming that id
  creates a brand-new empty v0 log under the same session id, so the work looks lost.
- **A merged history.** Resuming a migrated session in the older app appends to the frozen
  pre-upgrade file while 0.1.5 keeps writing the v3 file: two logs, one session id, silently
  diverging. There is no downgrade migration in either direction.
- The only supported ways forward are an app built on the 0.1.5 line, or restoring the backup
  taken above and losing everything written after the upgrade.

## Developer Setup

Prerequisites:

| Tool    | Version                                                                                               |
| ------- | ----------------------------------------------------------------------------------------------------- |
| Node.js | ≥ 22 (`.nvmrc`)                                                                                       |
| pnpm    | 11.17.0 (enable via corepack or install globally)                                                     |
| Docker  | optional — only for `scripts/verify-cli-container/run.sh`                                             |
| OS      | macOS (for `electron .` and electron-builder `--mac`) or Windows 10+ (electron-builder `--win --dir`) |

```bash
git clone https://github.com/Uniterra-Solutions/uniterra.git
cd uniterra
pnpm install --frozen-lockfile   # installs workspace deps + husky hooks
pnpm build                       # tsc -b + skills copy + provider bundle
pnpm typecheck                   # tsc -b --noEmit
pnpm lint                        # eslint . (strictTypeChecked, max-warnings 0)
```

Run the desktop in dev (never touches the real `~/.dsh` — uses a mirrored test home):

```bash
pnpm --filter @uniterra-solutions/uniterra-desktop dev
```

## Environment Variables

| Var                             | Default                       | Used by                         | Notes                                                        |
| ------------------------------- | ----------------------------- | ------------------------------- | ------------------------------------------------------------ |
| `UNITERRA_GITHUB_REPO`          | `Uniterra-Solutions/uniterra` | uniterra-cli                    | Point the installer at a fork/mirror                         |
| `UNITERRA_BUILD_VERSION`        | —                             | uniterra-desktop package script | Override electron-builder version                            |
| `UNITERRA_BASE_URL`             | provider default              | uniterra-provider               | Gateway base URL fallback (trusted layers only)              |
| `UNITERRA_UPDATE_API_BASE`      | GitHub API                    | uniterra-desktop                | Update-probe endpoint override                               |
| `UNITERRA_UPDATE_NPM_URL`       | npm registry                  | uniterra-desktop                | CLI dist-tag probe override                                  |
| `UNITERRA_UPDATE_COMMAND`       | `uniterra --version`          | uniterra-desktop                | Installed-CLI version probe                                  |
| `UNITERRA_UPDATE_RELEASES_PAGE` | GitHub                        | uniterra-desktop                | Release page shown in the prompt                             |
| `UNITERRA_UPDATE_DELAY_MS`      | 5000                          | uniterra-desktop                | Startup delay before the update check                        |
| `DSH_HOME`                      | `~/.dsh`                      | dsh runtime                     | dsh home; dev uses the mirrored test home instead            |
| `DSH_BUNDLED_SKILL_DIR`         | —                             | dsh runtime                     | Set by the app to the bundled skills dir                     |
| `PI_CODING_AGENT_DIR`           | `~/.pi/agent`                 | uniterra-skills                 | Agent skills dir for pi-agent provisioning                   |
| `ELECTRON_RUN_AS_NODE`          | —                             | uniterra-desktop                | Internal: Electron binary runs as plain Node                 |
| `UNITERRA_SOURCE_ROOT`          | repo root                     | scripts/verify-cli-container    | Source root the container PBT suite loads built modules from |

## Verify

```bash
pnpm run build && pnpm run lint && pnpm run typecheck      # static gates
pnpm --filter @uniterra-solutions/uniterra-desktop test                     # boot + builtins/readiness PBT
pnpm --filter @uniterra-solutions/uniterra-provider test                    # composition + wire invariants
pnpm --filter @uniterra-solutions/uniterra test                # CLI + install-logic PBT
pnpm --filter @uniterra-solutions/uniterra-skills test                      # provisioning idempotency
scripts/verify-cli-container/run.sh                         # clean-container installer replay (Docker)
scripts/verify-windows-install/verify.ps1                    # real Windows install + boot smoke (CI: windows-latest, release gate)
```

Test details: [testing.md](testing.md).

## How to Update

- Install/run commands change → update this file and the root README's commands (one home per fact: commands live here; the README links).
- New env var → add a row to the table.
- Installer flow changes → also run `scripts/verify-cli-container/run.sh` (and the Windows gate runs on release).

## Find It Fast

```bash
grep -rn 'UNITERRA_' packages/*/src scripts/ --include='*.ts' --include='*.mjs' # env surface
```
