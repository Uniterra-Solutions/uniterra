# PBT-First Dev Mode

Load this for software-development orders (code, apps, tooling) and bake the
rules into the order. Orders that do not produce software skip it — they use
the domain's own acceptance evidence instead.

## The iron rules

- **The orchestrator writes ALL failing tests FIRST** — property-based tests
  (module level and integration level, verifying business logic) plus the
  contract and end-to-end tests that need them. In JS/TS that is
  `node:test` + the repo's property-testing stack; in Python
  `pytest` + `hypothesis`.
- **Stub the modules with their real signatures first**, so RED is behavioural:
  a failure must mean "not implemented", never an import or syntax error.
- **Confirm RED and store the baseline as evidence** — the exact command plus
  its failing output — before any implementation starts.
- **Freeze the tests.** Only the orchestrator edits them. Each subagent makes
  its OWN assigned tests green and may not weaken, rename or delete any of
  them; a test believed wrong stays red and is reported as a deviation.
- **Every write-path test runs against temp fixtures.** Real content and real
  user data stay read-only for the whole run.
- **Subagents report with real command output.** A claim without the command
  that produced it is rejected.

## Why it works

- Tests-first turns the failing set into the specification: RED → the task
  becomes "make exactly these green".
- Frozen tests stop a subagent from rewriting the assertion it cannot satisfy.
- Temp fixtures keep the user's real data byte-identical throughout the run.

## What the order must therefore contain

- Where the tests live, and the exact command that runs them.
- The red-baseline evidence the orchestration must produce before dispatch.
- The file ownership table: one file, one writer; test files owned by the
  orchestrator alone.
- The per-workstream completion criterion: that workstream's tests green AND
  the full suite still green.
