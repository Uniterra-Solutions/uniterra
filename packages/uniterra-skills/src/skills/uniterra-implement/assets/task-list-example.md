# Task List — per-task contract for the workflow script

The workflow script receives the task list through `args`. **Each task carries a `promptFile`** —
a repo-relative path to a file that holds that task's pre-rendered markdown brief. At decomposition
time you write the brief (goal/context/requirements with their tests/conventions/constraints) to
that file, then pass only the path. This keeps `args` to a handful of short strings, so the
`run_workflow` / `workflow` tool call JSON is tiny and always valid — never the big embedded
brief that corrupts the tool call.

## Shape

```json
{
  "goal": "one-line feature goal (shared by every task)",
  "tasks": [{ "id": "T1", "name": "…", "promptFile": ".dsh/tasks/T1.md" }]
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
  their `test`, conventions, context files, constraints). The script appends the shared
  `FIXED_RULES` (see `assets/workflow-template.md`) after it at run time.
- **Do NOT put the brief in `args`.** Never pass a `prompt`/`goal`/`requirements`/`conventions`/
  `constraints` nested object as an `args` value — writing the brief to a file and passing only
  `promptFile` is what keeps the tool call JSON small and valid.

## Writing the brief file

At decomposition time, write each task's markdown to `.dsh/tasks/<id>.md` (create the dir), e.g.:

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

The subagent reads this file before acting. The file is transient (under `.dsh/`, typically
gitignored), so nothing extra is committed.

## Example

```json
{
  "goal": "Add user authentication with refresh-token rotation",
  "tasks": [
    {
      "id": "auth-issue",
      "name": "Token issuance endpoint",
      "promptFile": ".dsh/tasks/auth-issue.md"
    },
    {
      "id": "auth-refresh",
      "name": "Refresh-token rotation",
      "promptFile": ".dsh/tasks/auth-refresh.md"
    }
  ]
}
```

`.dsh/tasks/auth-issue.md` holds the rendered brief for that task (see "Writing the brief file").
Paths are repo-relative — the subagent's cwd is the repo root.
