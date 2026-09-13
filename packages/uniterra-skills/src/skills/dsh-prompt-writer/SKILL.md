---
name: dsh-prompt-writer
description: >
  Write one complete, self-contained prompt (work order) for an executor agent:
  recon with real tools, settle every decision, deliver it as one copyable
  fenced block, then verify it with real tools. Covers the canonical order
  structure, the dispatch specifics and the tests-first discipline software
  orders carry. LOAD when:
  - User asks for a prompt / work order / task brief (寫 prompt / 工作單 / 任務書)
  - A vague request must become an executable instruction
---

# dsh Prompt Writer

Turn a request into ONE order an executor agent can carry out on the first try.
The order is the deliverable: every decision is baked in, every fact the
executor cannot derive is stated, and nothing is left as an open TBD. Writing
the order is the job — implement only when the user asks for that too.

## When to use

- The user asks for a prompt, a work order or a task brief for an executor
  agent (寫 prompt / 工作單 / 任務書 / order), or wants work handed to a subagent.
- A vague request must become an executable, self-contained instruction.

Not for: authoring a reusable skill (use `dsh-skill-creator`), or doing the
work yourself when the user only wants the task completed.

## The six beats

1. **Recon with real tools.** Read the target repo (tree, conventions, scripts,
   test setup) and the machine (tool versions that the order will depend on).
   Record what you verified, with the command that verified it. Completion
   criterion: every environment fact the order asserts was observed, not
   assumed.
2. **Discuss, then settle.** Present the plan as answers, not questions:
   the verdict first, then the choices with a one-line reason each. Put every
   open decision into ONE `ask_user_question` call (at most four questions,
   recommended option first, each option written as a concrete choice).
   Completion criterion: no decision is left to the executor.
3. **Write the complete order.** Use the canonical structure below. Every
   decision from step 2 becomes a concrete value in the text. Completion
   criterion: the order answers every question an executor would otherwise
   have to ask.
4. **Deliver it as ONE four-backtick fenced block** in chat, ready to copy: one
   lead-in line naming what it is and where it goes, the block, and at most two
   usage lines after it. The four-backtick fence is what lets the order's own
   triple-backtick blocks (file trees, code, schemas) survive nesting.
   Completion criterion: one selection copies the whole order.
5. **The user pastes it to the executor.** Do not summarise the order instead
   of writing it, and do not write it to a file unless asked.
6. **Verify with real tools.** See the last section. Completion criterion: the
   result was observed, not reported.

## dsh specifics

- The executor is a dsh session, a `subagent`, or a workflow agent. All three
  see the ORDER, never your conversation: a subagent in particular is a fresh
  context, so the prompt must carry the paths, the current state, the
  constraints and the acceptance criteria itself.
- Keep dispatch args tiny. When the order is handed to a tool
  (`run_workflow('<name>', args)`), pass repo-relative paths and small values —
  never inline a long brief. Long content lives in a file the executor reads
  with `read`, or it IS the pasted order.
- Name the runtime's real tools (`read`, `write`, `edit`, `glob`, `grep`, `bash`,
  `skill`, `ask_user_question`, `subagent`) so the executor does not translate prose into
  commands.
- Write the order in the user's working language. It is a deliverable and falls
  under the same language rule as the chat itself.
- Quote evidence, not conclusions: "the file at `src/x.ts:41` calls Y with Z" beats
  "the code is wrong". The executor re-derives nothing.
- The tree moves while you write. Re-check `git log --oneline` / `git status` before
  quoting line numbers or a HEAD commit, and say so in the order.

## Canonical structure

1. **Header block** — who the order is for; the repo, branch and current tree
   state (HEAD commit + clean/dirty); the required prior reading (AGENTS.md and
   the repo's convention docs, in order); where the brief came from.
2. **Mission** — one paragraph. State success in three layers: behavioural
   (measurable), systemic (what the architecture/tests must show) and
   perceptual (what a human will look at). Add an explicit scope line: what is
   added, and what must stay byte-identical.
3. **Hard constraints** — numbered, and all of them acceptance items: no new
   dependencies unless listed; language and formatting rules; the claims
   red-line (what must never be asserted without evidence); the test discipline
   (only the assertions this order legitimately changes); the file-creation
   discipline (only the listed files may be created — no extra plans, reports
   or decision logs); one conventional commit per phase, on the local branch
   only, never pushed.
4. **Workstreams** — one item per deliverable, each written as: current state
   with `file:line` evidence → the concrete requirement (values, names, copy).
   Add one standing clause: "if the line numbers differ from the actual code,
   the code wins — say so in the report".
5. **Acceptance conditions** — the global gates (build / typecheck / lint /
   format / the package test commands), one NEW contract test per invariant the
   order introduces, the allowlist of existing assertions this order may
   change, and the manual acceptance step when a human must look at something.
6. **Execution order and commit discipline** — the phases in order, the exact
   commit message shape per phase, and the no-push rule.
7. **Appendix** — verified facts the executor cannot infer, a pointer to any
   long document that stays in the repo, and an explicit Out-of-Scope list
   (prose that blocks helpful scope creep).

## Tests-first discipline for software orders

When the order covers code, apps or tooling, load
`references/pbt-first-dev-mode.md` and bake its rules into the order: the red
baseline comes first, the tests are frozen before dispatch, and every subagent
greens its own slice. Non-software orders skip it and use the domain's own
acceptance evidence instead.

## Design around executor pitfalls

- Executors add artefacts unless forbidden: extra markdown, decision logs,
  report files, screenshot trees. Say exactly what may be created.
- They commit in batches while you are still writing the next message. Do not
  quote a HEAD commit you have not just re-read.
- They do not push unless told — state the rule either way rather than leaving
  it to chance.
- They weaken a failing test to make it pass unless the order freezes the test
  files and names who may edit them.
- They report success without evidence. Every phase in the order must demand
  the exact command and its output.
- They fix what the order did not ask for. The Out-of-Scope list is what stops
  that; make it explicit.

## After execution: verify, do not trust

- `git log --oneline` and `git status --short`: one commit per phase, nothing
  unexpected committed (extra markdown, the order itself).
- Run the gates the order defined, and the grep sweeps it listed.
- Open the produced artefacts yourself when the acceptance is perceptual.
- Report the drift against the order as follow-up batches. Never patch it
  silently, and never present an unverified result as verified.
