# Scenario 1 — Full parallel (independent tasks)

Use when NO two tasks overlap: their `owned_files` sets are disjoint and none depends on
another's output. This is the default when the requirements cleanly separate into modules.

The script is fixed — see `assets/workflow-template.md`. You do NOT write a script here; you
only choose the orchestration shape by setting `args.tasks` (flat array) instead of
`args.batches`, and copy the template's script verbatim.

## Decomposition

1. Map the requirements + acceptance rows onto the modules they live in: each task owns the
   requirements it satisfies, the acceptance lines that verify them, and the tests allocated
   to it. That requirements + acceptance mapping — not an architecture document — is what
   defines the partition.
2. Verify the `owned_files` sets are pairwise disjoint. If any two intersect, use the
   batched scenario instead.
3. **Freeze every seam.** List the data flow between tasks. Each cross-task seam (an
   interface, a serialized shape, an event one task emits and another consumes) must already
   be pinned by a test in the red suite, or be promoted to a requirement / acceptance line
   now. Two tasks that share a seam belong in the same batch — each mocking the seam — or in
   separate batches with the provider first (see `references/batched-workflow.md`).
4. Each task's `forbidden_files` = every OTHER task's `owned_files` (the partition must be
   complete so parallel agents never collide).
5. Scaffold each task's brief with the init CLI
   (`node "<skill_base>/scripts/init_task.mjs" <project-name> <id> <name>`) — it writes the brief
   into `.dsh/<YYYYMMDD-HHmmss>/<project-name>/<task-name>.md` and registers it in the project's
   `task.json` manifest — then fill in the placeholders and reference it via `promptFile`.
   `args` stays tiny.

## `args` shape

```json
{
  "goal": "...",
  "tasks": [
    { "id": "T1", "name": "...", "promptFile": ".dsh/20260827-143052/user-auth/token-issuance.md" }
  ]
}
```

Set exactly one of `tasks` or `batches`. Set `tasks` (flat) for the parallel shape.

## Watch for

- A `null` result means the child failed (or its return did not validate) — it fails the
  run; surface the failure rather than silently continuing.
- Same-batch `owned_files` overlap is a decomposition bug — re-check the file sets before
  dispatching.
- The subagent **returns JSON** (via `schema`); only its **input prompt** is markdown.
