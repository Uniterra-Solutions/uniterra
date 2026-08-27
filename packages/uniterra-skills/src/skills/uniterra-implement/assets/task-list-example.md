# Task List — per-task contract for the workflow script

The workflow script receives the task list through `args`. **Each task carries a `promptFile`** —
a repo-relative path to a file that holds that task's pre-rendered markdown brief. Scaffold it
with the init CLI (`node "<skill_base>/scripts/init_task.mjs" <id> <name>`), fill in the
placeholders, then pass only the path. This keeps `args` to a handful of short strings, so the
`run_workflow` / `workflow` tool call JSON is tiny and always valid — never the big embedded
brief that corrupts the tool call.

## Shape

```json
{
  "goal": "one-line feature goal (shared by every task)",
  "tasks": [{ "id": "T1", "name": "…", "promptFile": ".dsh/<YYYYMMDD>/<task-name>/task.md" }]
}
```

- For the **batched** shape use `"batches": [ [ { id, name, promptFile } ], … ]` (an array of task
  arrays) instead of `"tasks"`.
- `goal` is hoisted to the top level as a heading-only anchor; the real content lives in each task
  file. If `goal` is not needed, it may be omitted.
- `promptFile` paths are **repo-relative** (the subagent's cwd is the repo root).

## Field notes

- `id` — stable identifier, used as the agent `label` for observability.
- `name` — one-line task name.
- `promptFile` — **the file that holds the entire subagent instruction block as one markdown
  string**. It must include, at minimum, the sections rendered below (goal, requirements with
  their `test`, conventions, context files, constraints). The capsule inlines this file into the
  subagent prompt at run time and appends the shared `FIXED_RULES` (see
  `assets/workflow-template.md`) — the subagent does NOT read the file itself.
- **Do NOT put the brief in `args`.** Never pass a `prompt`/`goal`/`requirements`/`conventions`/
  `constraints` nested object as an `args` value — writing the brief to a file and passing only
  `promptFile` is what keeps the tool call JSON small and valid.

## Writing the brief file

At decomposition time, scaffold each task's brief with the init CLI — it writes the markdown
to `.dsh/<YYYYMMDD>/<task-name>/task.md` and maintains the run's `tasks.json` manifest:

```
node "<skill_base>/scripts/init_task.mjs" "<task-id>" "<task-name>"
```

Then fill in the placeholders, e.g.:

```markdown
# Task: <name>

## Goal

<goal>

## Context

- <path> — <description> (read: <symbol / §section>)
- …

## Requirements

- <REQ-id>: <text> — [test: <package/x/test.ts → 'case'>]
- …

## Conventions

- <module-local test command or convention>
- …

## Constraints

- owned_files: <path>, <path>
- forbidden_files: <path>, <path>
```

The capsule inlines this file into the subagent's prompt at dispatch; the subagent does not read
it itself. The file is transient (under `.dsh/`, typically gitignored), so nothing extra is
committed.

## Example

```json
{
  "goal": "Add user authentication with refresh-token rotation",
  "tasks": [
    {
      "id": "auth-issue",
      "name": "Token issuance endpoint",
      "promptFile": ".dsh/20260828/token-issuance/task.md"
    },
    {
      "id": "auth-refresh",
      "name": "Refresh-token rotation",
      "promptFile": ".dsh/20260828/refresh-rotation/task.md"
    }
  ]
}
```

`.dsh/20260828/token-issuance/task.md` holds the rendered brief for that task (see "Writing the
brief file"). Paths are repo-relative — the subagent's cwd is the repo root.
