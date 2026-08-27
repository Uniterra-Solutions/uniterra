# Implement Workflow Template — one fixed script, you only fill `meta` + `args`

> **MIGRATED.** This historical script is superseded by the persisted
> `workflows/implement.workflow.json` capsule. The skill now calls
> `run_workflow('implement', args)` — do NOT copy this JS block into a `workflow`
> tool call. It is retained only as a reference for the orchestration and fixed
> rules the capsule now owns.

One workflow: dispatch subagents to implement an approved task list. Make **ONE** `workflow`
tool call — `meta`, `script`, and `args` are three properties of ONE arguments object, never
three separate calls, and never wrapped under a field named `arguments`:

```json
{
  "meta": { "name": "implement", "description": "Implement the approved task list via subagents" },
  "script": "<the JS below — copy verbatim, do not edit>",
  "args": {
    "goal": "-one-line feature goal-",
    "tasks": [{ "id": "T1", "name": "-task name-", "promptFile": ".dsh/tasks/T1.md" }]
  }
}
```

`meta` + `script` are required; `args` is optional. Splitting `meta`/`script`/`args` across
parallel calls fails with `missing required property "meta"` / `"script"`; wrapping them in
`arguments` fails with `"arguments" must be an object`. `meta` must contain only `name` and
`description` (plus optional `whenToUse`/`phases`). `args` may carry an optional `maxRounds`.

**Keep `args` tiny — never embed the task brief in it.** Each task carries a `promptFile`
(repo-relative path to a file holding the rendered markdown task brief); the subagent reads that
file. Writing the brief to a file keeps `run_workflow`'s `args` JSON to a handful of short
strings, so it is always valid and never corrupts the tool call (the exact failure mode when a
long brief was embedded inline).

**You choose only the orchestration shape, not the script.** This one script handles both:

- independent tasks → `args.tasks` (flat array, all run in parallel);
- overlapping tasks → `args.batches` (array of task arrays; batches run serially, agents
  within a batch run in parallel).

Use exactly one of `tasks` or `batches` — never both. Write each task's brief to its prompt file
and reference it via `promptFile` (see `assets/task-list-example.md`). For the shape decision and
partition rules, see `references/parallel-workflow.md` and `references/batched-workflow.md`.

## Fixed rules (appended by the script)

```js
const FIXED_RULES = `You are an isolated subagent implementing ONE task of an approved project. You have no
prior conversation context — everything you need is in your task file + the rules below. Do not
ask for clarification; make a reasonable, documented decision where the task is ambiguous.

- FIRST read your task file with the read tool (the 'task file' path in the Task block). It is
  your full brief — goal, context files, requirements with their allocated failing tests,
  conventions, constraints — and the source of truth. Never guess or reconstruct the brief from
  memory.

- Work at the repo root (your cwd). Leave all changes UNCOMMITTED — a later review reads the diff.
- Touch only the files named in your task's \`owned_files\`; never modify \`forbidden_files\` or any
  file outside your task's scope — parallel agents may be working at the same time.
- Your requirement's failing property tests are already written (named in \`requirements[].test\`).
  FIRST prioritize STRENGTHENING / completing those existing failing test cases — extend the
  property, add the missing edge cases and invariant asserts — then make them GREEN. Never
  start by writing a brand-new property test from scratch for a requirement that already has
  an allocated failing test.
- Follow the project's conventions (AGENTS.md / CLAUDE.md): run lint / typecheck / build, add
  tests for new behaviour, and make your requirements' failing property tests GREEN.
- Verify external APIs before using them; never write from memory.
- Record any deviation from the design doc in \`deviations\`.`;
```

## Return contract (subagent reports to the workflow as JSON)

```js
const RETURN_SCHEMA = {
  type: 'object',
  required: ['changed_files', 'satisfied_requirements'],
  properties: {
    changed_files: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'lines'],
        properties: { file: { type: 'string' }, lines: { type: 'string' } },
      },
    },
    satisfied_requirements: { type: 'array', items: { type: 'string' } },
    deviations: { type: 'array', items: { type: 'string' } },
  },
};
```

`agent(prompt, { schema: RETURN_SCHEMA })` returns the validated JSON object (or `null` when
the child fails or the shape does not validate). **The subagent report to the workflow is
JSON via this `schema`** — do NOT convert it to markdown; only the subagent input prompt is
markdown.

## Script (copy this block verbatim)

```js
const { tasks, batches } = args;

// batches present → serial batches (agents within a batch run in parallel);
// otherwise → one parallel group.
const groups = batches ?? [tasks];

// Build a SMALL prompt per task: the full brief lives in a file the subagent
// reads (t.promptFile, a repo-relative path), so args stay tiny. `taskPrompt`
// throws if a task is missing `promptFile` (a contract violation).
function taskPrompt(t) {
  if (t == null || typeof t !== 'object') throw new Error('implement task must be an object');
  const id = t.id === undefined ? 'task' : String(t.id);
  if (typeof t.promptFile !== 'string' || t.promptFile.trim().length === 0) {
    throw new Error(
      'implement task "' +
        id +
        '" is missing a promptFile path: write the task brief to a file and pass its repo-relative path (keep args small)',
    );
  }
  return [
    '## Task to implement',
    '- task id: ' + id,
    '- task name: ' + (t.name === undefined ? id : String(t.name)),
    '- task file: ' + t.promptFile,
    '',
    'Read the task file NOW with the read tool — it is your full task brief (goal, owned/forbidden files, requirements + allocated failing tests, conventions, constraints). Then follow the fixed rules below.',
  ].join('\n');
}

const results = [];
for (let b = 0; b < groups.length; b++) {
  if (groups.length > 1) phase('batch-' + (b + 1));
  const done = await parallel(
    groups[b].map(
      (t) => () =>
        agent(taskPrompt(t) + '\n\n' + FIXED_RULES, { label: t.id, schema: RETURN_SCHEMA }),
    ),
  );
  if (done.some((r) => r === null)) return { status: 'failed', batch: b + 1 };
  results.push(...done);
}
return { status: 'done', agents: results.length };
```

## Reading the result

- `status: 'done'` — all tasks returned a valid JSON report; `agents` is the count.
- `status: 'failed'` — a task returned `null` (child failed or return did not validate); when
  batched, `batch` names the failing batch. A `null` in any group fails the whole run because
  later batches likely depend on it.
- The subagent **returns JSON** (via `schema`); only its **input prompt** is markdown.
