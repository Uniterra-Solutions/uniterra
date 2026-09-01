---
name: uniterra-review
description: >
  Company-standard property-based adversarial review on DeepSeek Harness. Usable
  whenever there is a review scope — no plan required. Assemble the review scope
  (what to review), then run a review workflow: a review agent is given ONLY that
  scope — no main-agent goal/requirements/design/acceptance framing, to avoid
  bias — models and PROVES three verification layers by PBT: (1) the module's
  OWN business logic + lifecycle (intra-module: every operation, every state,
  happy paths included — hidden state / async events / internal composition
  included), (2) the module × its communication counterparts (interaction:
  interface contract, event order, error propagation, ownership), and (3) the
  system slices involving the module (integration: composed lifecycle with the
  external world mocked, end-to-end invariants). Property tests brute-force
  random operation and external-state sequences in one pass, executed in the
  background with an iteration budget > 10,000 runs, then shrink every
  counterexample to a structured error report (file, line, input or sequence,
  expected/actual). A fixer agent repairs each reported invariant and re-runs
  the counterexample green, reporting straight back. You (the main agent) then
  aggregate every counterexample + fix by severity (critical / medium / low) and
  state which business logic is wrong, why, and the user impact — never
  re-running the tests yourself. LOAD when:
  - User asks to review changes, hunt for bugs, or run the review phase
    (review / 審查 / code review)
  - User asks to verify business logic is invariant-correct
  Use uniterra-simplify for simplification review, uniterra-plan for planning,
  and uniterra-implement for implementing.
---

# Uniterra Review — three-layer property-based adversarial review

Pipeline position: after `uniterra-implement`, or standalone. The review is
driven by the **review scope** (what changed / what to review) — NOT by
`execution-plan.json` and NOT by the main agent's requirements/design/acceptance
interpretation.

## 1. Assemble the review scope

Give the review agent ONLY the scope — deliberately, so the review is unbiased by your
reading and the agent does the reading itself:

- **Keep the scope free of your own reading.** Hand it just the scope; leave out any
  "what this does" summary, a believed bug, an expected contract, or your
  interpretation of the intent — the review agent derives those from the code itself.
- **Let the review agent read the code itself.** It reads the code in scope directly;
  your pre-reading only duplicates that work and injects your conclusions.
- Name the scope: the changed business modules / the diff (+ any focus).

- **task** — what to review: the scope (default: the uncommitted changes / the diff), e.g.
  "review the changed modules in packages/uniterra-provider (the diff)".

The review agent reads those business modules itself, models all three layers, and derives the
invariants — so it is not pre-biased by your framing.

## 2. Run the review workflow

Invoke the persisted `review` workflow by name with the dsh_workflow `run_workflow` tool as
**ONE call**: `run_workflow('review', { task })` (the scope). No JS to copy — the
orchestration is the `review` capsule. It orchestrates **two subagents** — there is no
main-agent step inside it:

### The three verification layers

The review agent models and PROVES **all three** — none is optional; the layers verify different
things, and each needs its own model + invariants + tests:

1. **Layer 1 — intra-module PBT.** The module's OWN business logic and lifecycle: model its public
   operations, its private state, its lifecycle (init → use → teardown → restart) and prove the
   state / transition / composition / lifecycle / data invariants with state-machine properties
   (random operation sequences) + input-generating properties. This finds what the module itself
   gets wrong — including the bugs only a sequence can reach (leaks, races, re-entrancy, restart).
2. **Layer 2 — interaction PBT.** The module × each COUNTERPART it communicates with (another
   module, an API, a service, an event emitter — anything it exchanges data/events with). Model
   the PAIR: what the module emits must be legal input for the counterpart's contract and vice
   versa; event order, ownership/authorization, and error propagation across the interface must
   hold for every interleaving. Prove it by mocking the counterpart **to its contract** (or using
   the real counterpart when it is in scope) and injecting different counterpart states —
   happy, empty, malformed, timeout, error, out-of-order. This finds contract mismatches,
   swallowed/misclassified errors, and ordering bugs that the module's own tests cannot.
3. **Layer 3 — integration PBT.** The SYSTEM SLICES that involve the module: the composed
   lifecycle of the module + its real/interacting neighbours, with the EXTERNAL WORLD mocked
   (filesystem, network, env, clock). Prove the end-to-end invariants over whole system flows —
   no loss / no duplication across the composed flow, no leak at system level, correct ordering
   across boundaries, restart/replay correctness — with failures injected at any point. This
   finds the cross-module bugs that only the system's composition exposes.

The knowledge for all three lives in `references/` (each file owns one responsibility — see the
Files section): `references/review-agent.md` carries the three-layer operating manual (the
agent's spine + rules + severity + output), and `references/model-construction.md` /
`references/invariant-taxonomy.md` / `references/test-patterns.md` carry the modeling, invariant,
and test-pattern knowledge behind it.

### The two subagents

1. **review agent** (`references/review-agent.md`) — given ONLY the scope (not the orchestrator's
   goal/requirements/design/acceptance, to avoid bias), it reads every business module in scope in
   ONE pass, then models and proves ALL THREE layers (intra-module / interaction / integration)
   as one formal specification table, discovers the repo's test + property-testing conventions
   (never assumes a framework), AND derives security invariants from the security checklist
   (`references/security-checklist.md`) — security is verified via PBT too, not just correctness.
   It writes ALL the property tests in one pass — state-machine sequence properties,
   environment-mock fault-injection properties, input-generating properties — then runs them
   together in a **background** terminal job with an iteration budget **> 10,000 runs**. Each
   counterexample is shrunk to its minimal failing input / operation / external-state sequence and
   wrapped as a structured error report (id, severity, file, line, invariant, input,
   expected/actual, test). Only confirmed counterexamples are reported. Returns
   `{ spec_table, reports }`.
2. **fixer agent** (`references/fix-agent.md`) — repairs each reported invariant so its
   property test passes, re-runs the counterexample to confirm green, and **adds a DETERMINISTIC
   unit regression test per counterexample** — one concrete minimal input (the report's `input`) +
   the exact outcome the invariant requires — so the bug is instantly reproducible with no RNG. It
   names each regression after the TEST PURPOSE (the guarantee the test enforces, never the finding
   id — so a maintainer sees at a glance what it tests), keeps it permanent, and never
   deletes or weakens the review agent's property tests or any regression test. It leaves changes
   UNCOMMITTED.

The workflow **returns** `{ status, clean, reports, fixes }`, and runs a **single pass** (no
re-review loop) because the PBT executes **> 10,000 runs per invariant**, which is a statistically
strong (near-formal) proof — the fixer only re-runs each counterexample to confirm it is green.

**Then YOU (the main agent) aggregate** (`references/main-agent.md`): after the workflow returns,
summarize the counterexamples + fixes by severity (**critical / medium / low**), state which layer
each came from, and list which business logic is wrong, why it is wrong, and the actual user
impact, plus whether each was fixed. You produce the final `{ verdict, summary, issues }` report
yourself — you do NOT dispatch another sub-agent to do it, and you **never re-run the
property-based tests** (the review agent ran them > 10,000 runs each and the fixer re-confirmed
its fixes; re-running just wastes time).

The subagent **reports to the workflow as JSON** (validated by the `schema` each `agent(...)`
call passes); only the subagent **input prompts** are text.

## Severity levels

- **critical** — wrong results / data loss / a security hole / a core invariant that never
  holds. Blocks delivery.
- **medium** — fails on an edge/error path or a non-core invariant. Concrete risk, no immediate
  breakage.
- **low** — a confirmed but non-blocking counterexample with no correctness impact. Rare, since
  style/naming nit rows are not reported.

## Rules

- The review agent writes only the property tests that expose and pin the counterexamples; it
  leaves source changes to the fixer.
- The fixer agent leaves changes UNCOMMITTED and preserves the property tests and the
  deterministic unit regression tests it adds for each counterexample (it adds new ones, and
  strengthens existing ones, over deleting or weakening any).
- The main agent (you) trusts the reported counterexamples and fixes as the evidence — the
  review agent ran them (> 10,000 runs each) and the fixer re-confirmed its fixes; the aggregation
  is your job, re-running the property-based tests is not.
- Counterexample reports reference a concrete file + line + failure mode (the property the
  branch violated).

## Files — knowledge organisation (one responsibility per file)

- `workflows/review.workflow.json` — the persisted `review` capsule (review → fix orchestration;
  `args` is `{ task }`). Invoke it by name: `run_workflow('review', { task })`. The prompt text is
  composed at build time from the reference files below.
- `references/review-agent.md` — the review agent's CORE operating manual: mission, anti-bias,
  the three-layer spine, rules, severity, output schema. Read this first.
- `references/model-construction.md` — HOW to build the models, one section per layer: the
  module's own ops/lifecycle/hidden state (layer 1), the counterpart model (layer 2), the
  system-slice model with the external-world boundary (layer 3); stateless modules, software-type
  mapping, out-of-scope boundaries.
- `references/invariant-taxonomy.md` — WHAT to prove: the spec-table row fields and every
  invariant kind per layer (state / transition / composition / lifecycle → layer 1; interaction
  contract → layer 2; integration end-to-end → layer 3; data oracles, security).
- `references/test-patterns.md` — HOW to prove it: discover the repo's stack, the three test
  patterns (model-based sequences / environment-mock fault injection / input-generating), the
  purpose-naming rules, background run > 10k, shrink + structured report.
- `references/security-checklist.md` — the mandatory security axis: 12 common AI-agent security
  mistakes, each converted into a security invariant and PBT-proven (inlined into the capsule
  prompt at build time).
- `references/fix-agent.md` — the fixer prompt.
- `references/main-agent.md` — the main agent's (orchestrator) aggregation guide.
- `assets/workflow-template.md` — **migrated.** Historical review → fix workflow script; kept as a
  reference only, not to be copied into a `workflow` tool call.
