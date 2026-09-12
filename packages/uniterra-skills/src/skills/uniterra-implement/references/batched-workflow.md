# Scenario 2 — Batched (overlapping tasks)

Use when some tasks overlap: their file/module sets intersect, or one depends on another's
output. Batches run serially; agents WITHIN a batch run in parallel.

The script is fixed — see `assets/workflow-template.md`. You do NOT write a script here; you
only choose the orchestration shape by setting `args.batches` (array of task arrays) instead
of `args.tasks`, and copy the template's script verbatim.

## Overlap → partition

1. Build the overlap relation from `owned_files` intersections **and from the seams**: two
   tasks that share a seam (an interface, a serialized shape, an event one emits and the other
   consumes) overlap even when their file sets are disjoint.
2. Partition tasks into the smallest number of batches such that overlapping tasks land in
   DIFFERENT batches — except two tasks that share a seam and each mock it, which may share a
   batch. Tasks that only depend on earlier batches sit in later batches, and when a seam is
   NOT mocked the PROVIDER goes first, its consumer in a later batch.
3. Every seam must already be pinned by a test in the red suite, or be promoted to a
   requirement / acceptance line before dispatch.
4. `args.batches` is an array of task arrays (not the flat task list) — partition before
   dispatching. Scaffold each task's brief with the init CLI
   (`node "<skill_base>/scripts/init_task.mjs" <project-name> <id> <name>`), fill in the
   placeholders, and reference it via `promptFile` — `args` stays tiny.

## `args` shape

```json
{
  "goal": "...",
  "batches": [
    [
      {
        "id": "T1",
        "name": "...",
        "promptFile": ".dsh/20260827-143052/user-auth/token-issuance.md"
      }
    ]
  ]
}
```

Set exactly one of `tasks` or `batches`. Set `batches` (array of task arrays) for the batched
shape.

## Watch for

- Earlier batches edit files that later batches also touch; later tasks' `context.files[].read`
  hints may be stale — prefer symbol / heading references over line numbers for exactly this
  reason.
- A `null` in any batch fails the whole run (later batches likely depend on it); surface it
  rather than continuing.
- The subagent **returns JSON** (via `schema`); only its **input prompt** is markdown.
