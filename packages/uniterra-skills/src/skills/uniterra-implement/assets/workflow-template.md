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
    "tasks": [{ "id": "T1", "name": "-task name-", "promptFile": ".dsh/20260828/task-one/task.md" }]
  }
}
```

`meta` + `script` are required; `args` is optional. Splitting `meta`/`script`/`args` across
parallel calls fails with `missing required property "meta"` / `"script"`; wrapping them in
`arguments` fails with `"arguments" must be an object`. `meta` must contain only `name` and
`description` (plus optional `whenToUse`/`phases`). `args` may carry an optional `maxRounds`.

**Keep `args` tiny — never embed the task brief in it.** Each task carries a `promptFile`
(repo-relative path to a file holding the rendered markdown task brief); the capsule inlines that
file into the subagent prompt at dispatch (the subagent does not read it). Writing the brief to a
file keeps `run_workflow`'s `args` JSON to a handful of short strings, so it is always valid and
never corrupts the tool call (the exact failure mode when a long brief was embedded inline).

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
prior conversation context — your full brief is inlined in the '## Task to implement' block
below plus the rules here. Do not ask for clarification; make a reasonable, documented decision
where the task is ambiguous.

- Your full brief — goal, context files, requirements with their allocated failing tests,
  conventions, and constraints — is ALREADY in your prompt. Do not re-read the task file unless
  a referenced file's details are missing; the inlined brief is the source of truth.

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
- Record any deviation from the design doc in \`deviations\`.
- Report your result with the \`structured_output\` tool exactly once: the JSON report
  (changed_files, satisfied_requirements, deviations). Do NOT finish with a plain-text JSON
  string or a markdown code block — only the \`structured_output\` call counts as your result.`;
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

// Build a SMALL prompt per task: the full brief is inlined from the file at
// t.promptFile (a repo-relative path) via host readFile, so args stay tiny and
// the subagent does NOT read the file itself. `taskPrompt` throws if a task is
// missing `promptFile` (a contract violation).
async function taskPrompt(t) {
  if (t == null || typeof t !== 'object') throw new Error('implement task must be an object');
  const id = t.id === undefined ? 'task' : String(t.id);
  if (typeof t.promptFile !== 'string' || t.promptFile.trim().length === 0) {
    throw new Error(
      'implement task "' +
        id +
        '" is missing a promptFile path: write the task brief to a file and pass its repo-relative path (keep args small)',
    );
  }
  let brief = '';
  try {
    brief = (await wf.readFile(t.promptFile)) || '';
  } catch {
    brief = '';
  }
  const briefBlock =
    brief.trim().length > 0
      ? brief.trim()
      : '! The task brief could not be loaded automatically — read the file at ' +
        t.promptFile +
        ' now with the read tool. It is your full brief.';
  return [
    '## Task to implement',
    '- task id: ' + id,
    '- task name: ' + (t.name === undefined ? id : String(t.name)),
    '- task file: ' + t.promptFile,
    '',
    briefBlock,
  ].join('\n');
}

const results = [];
for (let b = 0; b < groups.length; b++) {
  if (groups.length > 1) phase('batch-' + (b + 1));
  const done = await parallel(
    groups[b].map(
      (t) => async () =>
        agent((await taskPrompt(t)) + '\n\n' + FIXED_RULES, { label: t.id, schema: RETURN_SCHEMA }),
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
