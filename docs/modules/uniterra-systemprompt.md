# Module: uniterra-systemprompt

**Purpose:** pi-agent extension that appends the app-wide working rules to every agent turn's system prompt via a `before_agent_start` handler.

Source: `packages/uniterra-systemprompt/src/index.ts`; tests `test/general.test.mjs`.

## Registration

- `package.json` exposes `"pi": { "extensions": ["./src/index.ts"] }`.
- The entry is a **default-exported factory** `generalExtension(pi: ExtensionAPI)` — pi's loader requires `jiti.import(path, { default: true })` then `typeof factory === 'function'`. This is the single platform exception to the no-default-exports rule.
- Handler: `pi.on('before_agent_start', (event) => ({ systemPrompt: event.systemPrompt + '\n\n' + WORKING_RULES }))` — stateless rebuild from `event.systemPrompt`, so rules stay active all session with no cross-turn duplication (locked by test).

## Working Rules

Appended to every turn:

| #   | Rule                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Use plain text in replies — leave emoji out of every message                                                                                                                                                                                                                                                                              |
| 2   | Thinking has a cost: reason only as far as needed to set direction, then act. Reach a conclusion once and move on; when in doubt, verify with evidence rather than re-deriving a settled conclusion                                                                                                                                       |
| 3   | Work in an **infer-verify-correct** loop: (1) reason to a conclusion or hypothesis, (2) test it against the real system (run the code, read the files, execute the tests, query the APIs), (3) correct the conclusion from what the evidence shows — a conclusion that contradicts evidence is a hypothesis to drop, not a fact to defend |
| 4   | Keep replies concise: state the essentials — outcome, evidence, next step — and nothing else. No filler, no restating the question, no recap of the process                                                                                                                                                                               |
| 5   | Work first, ask only when something genuinely needs user clarification                                                                                                                                                                                                                                                                    |
| 6   | Keep the change scoped to the task: make the minimal change that satisfies the requirements, and leave unrequested refactors or changes out                                                                                                                                                                                               |
| 7   | Match comment density to code complexity — prefer precise names and concise code; comment only when logic is not self-evident (e.g. abstract iteration)                                                                                                                                                                                   |
| 8   | Write exactly the code the user's requirements need — nothing beyond that, no speculative design, no future-proofing for a case that does not exist                                                                                                                                                                                       |
| 9   | Research the latest usage and APIs of external libraries before writing code — write only what you have verified against real documentation                                                                                                                                                                                               |
| 10  | Develop test-driven: understand the logic, write tests for each piece of business logic, make the minimal change to pass, then refactor to clean and elegant code                                                                                                                                                                         |
| 11  | Reply in the user's language by default, unless the user explicitly asks for a specific language                                                                                                                                                                                                                                          |
| 12  | When you start a background tool (a background subagent or job), start it and then STOP — wait for the completion notification that comes back to you; use the meantime for independent work, and when there is none, end your turn and let the notification wake you                                                                     |

## Test Guarantees

- `before_agent_start` handler is registered.
- Output starts with the base prompt and includes the rule-1 (plain text / no emoji), rule-10 (test-driven), and rule-11 (reply language) substrings.
- The thinking-cost framing (rules 2–3), the concise-output rule (4), the scoped-change rule (6), the external-API verification rule (9), and the background-tool rule (12) are asserted by dedicated tests.
- Running the handler twice yields identical output with exactly one occurrence of each rule (no accumulation).

## Dependencies

- Outbound: `@earendil-works/pi-coding-agent` (types + `ExtensionAPI`).
- Inbound: none in-repo (consumed by the pi runtime via the `pi.extensions` manifest).

## Patterns & Gotchas

- Keep the factory default-exported and the filename `src/index.ts` — pi's loader contract.
- Rules live here only; `AGENTS.md` mirrors the falsifiable subset for human agents.

## How to Update

- Rule added/changed → edit `WORKING_RULES`, extend the test, run `pnpm run build` (desktop consumes the built `dist` export).

## Find It Fast

```bash
grep -n 'WORKING_RULES' packages/uniterra-systemprompt/src/index.ts
```
