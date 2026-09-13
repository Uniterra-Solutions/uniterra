---
name: uniterra-review
description: >
  Company-standard property-based adversarial review on DeepSeek Harness. Usable
  whenever there is a review scope — no plan required. When a plan exists the
  standard IS the plan: prd.md + acceptance.md (requirement as standard) are
  handed to the review agent as their ORIGINAL TEXT, never as the main agent's
  summary, so the review measures the code against the requirements of record
  and produces the compliance table itself (one row per requirement, plus the
  three instrument findings: coverage gap / hollow test / spec contradiction).
  The three-layer PBT verification stays as a standard-external axis — a
  review agent given only the scope and the standard documents models and PROVES
  three layers by PBT: (1) the module's OWN business logic + lifecycle
  (intra-module: every operation, every state, happy paths included — hidden
  state / async events / internal composition included), (2) the module × its
  communication counterparts (interaction: interface contract, event order, error
  propagation, ownership), and (3) the system slices involving the module
  (integration: composed lifecycle with the external world mocked, end-to-end
  invariants). Property tests brute-force random operation and external-state
  sequences in one pass, executed in the background with an iteration budget >
  10,000 runs, then shrink every counterexample to a structured error report
  (file, line, input or sequence, expected/actual). A fixer agent repairs each
  reported invariant — never against a requirement — and re-runs the
  counterexample green, reporting straight back. You (the main agent) then
  aggregate every counterexample + fix by severity (critical / medium / low) plus
  the compliance summary (requirements X/Y, acceptance M/N), and state which
  business logic is wrong, why, and the user impact — never re-running the tests
  yourself. Without a plan the review falls back to pure code modelling
  (standalone review). LOAD when:
  - User asks to review changes, hunt for bugs, or run the review phase
    (review / 審查 / code review)
  - User asks to verify business logic is invariant-correct
---

# Uniterra Review — requirement as standard + three-layer property-based adversarial review

Pipeline position: standalone — the review runs on any scope, with or without a
plan. The review is driven by the **review scope** (what changed / what to review) and — when a plan
exists — by the **standard**: the plan's `prd.md` + `acceptance.md` as their
original text. It is NOT driven by `execution-plan.json`, and NOT by the main
agent's reading of the requirements / acceptance.

## 1. Assemble the review scope and the standard

Give the review agent ONLY objective material — deliberately, so the review is unbiased by your
reading and the agent does the reading itself:

- **Keep your reading out of it.** Hand over just the scope and the standard documents;
  leave out any "what this does" summary, a believed bug, an expected contract, or your
  interpretation of the intent — the review agent derives those from the code and the
  documents themselves.
- **The pollution boundary: documents in, narrative out.** The standard is the plan's
  `prd.md` + `acceptance.md` **verbatim** (path handoff — the capsule reads the files
  itself). Your summary, your paraphrase, or your guess at a bug MUST NOT enter it. A
  narrative is your reading; the documents are the record.
- **Let the review agent read the code itself.** It reads the code in scope directly;
  your pre-reading only duplicates that work and injects your conclusions.

Assemble the two args:

- **task** — what to review: the scope (default: the uncommitted changes / the diff), e.g.
  "review the changed modules in packages/uniterra-provider (the diff)".
- **standard** (optional) — `{ requirements, acceptance }`, each a **repo-relative path**
  to the plan document of record (e.g. `{ requirements: '.plan/20260913/orders/prd.md',
acceptance: '.plan/20260913/orders/acceptance.md' }`). Both must exist and carry content
  for the standard to be in force; with no plan, omit it and the review runs standalone.

The review agent reads those business modules itself, models all three layers, audits the
standard, and derives the invariants — so it is not pre-biased by your framing.

## 2. Run the review workflow

Invoke the persisted `review` workflow by name with the dsh_workflow `run_workflow` tool as
**ONE call**: `run_workflow('review', { task, standard })` (scope + standard; `standard` is
optional). No JS to copy — the orchestration is the `review` capsule. It orchestrates **two
subagents** — there is no main-agent step inside it:

### The standard axis — requirement as standard

When a standard is in force, the review measures the code against it and PRODUCES the compliance
table itself (you never synthesize it):

- For every requirement line, walk the chain: the acceptance line that verifies it → the test
  that evidence names → does it **exist**, does it **pass**, and is it **non-hollow** (could it
  fail if the behaviour were wrong?).
- Each requirement line yields one compliance row: `pass` / `fail` / `missing` /
  `contradiction`.
- Three instrument findings come out of the axis, reported both as compliance rows and as
  ordinary counterexample reports for the fixer:
  - **coverage gap** — no test covers the requirement / acceptance line (`missing`);
  - **hollow test** — a test that exists and passes but proves nothing (`fail`, with the reason);
  - **spec contradiction** — the code or its tests contradict the requirement
    (`contradiction`).
- The standard is the authority for WHAT must hold; a contradiction is a finding against the
  code, never a licence to soften the requirement.

The standard axis runs ALONGSIDE the three verification layers below, not inside them: the layers
prove the code's own invariants, the standard axis proves the code against the plan. Standalone
(no standard), the review falls back to pure code modelling — the three layers alone.

### The three verification layers — the standard-external axis

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
Files section): `references/review-agent.md` carries the three-layer operating manual + the
standard axis (the agent's spine + rules + severity + output), and
`references/model-construction.md` / `references/invariant-taxonomy.md` /
`references/test-patterns.md` carry the modeling, invariant, and test-pattern knowledge behind
it (`test-patterns.md` also carries the standard-axis evidence audit).

### The two subagents

1. **review agent** (`references/review-agent.md`) — given ONLY the scope and the standard
   documents (not the orchestrator's summary of them, to avoid bias), it reads every business
   module in scope in ONE pass, then models and proves ALL THREE layers (intra-module /
   interaction / integration) as one formal specification table, discovers the repo's test +
   property-testing conventions (never assumes a framework), AND derives security invariants from
   the security checklist (`references/security-checklist.md`) — security is verified via PBT
   too, not just correctness. When a standard is in force it ALSO audits every requirement line
   against its acceptance evidence and returns the compliance rows, reporting each coverage gap,
   hollow test, and spec contradiction as a counterexample report. It writes ALL the property
   tests in one pass — state-machine sequence properties, environment-mock fault-injection
   properties, input-generating properties — then runs them together in a **background** terminal
   job with an iteration budget **> 10,000 runs**. Each counterexample is shrunk to its minimal
   failing input / operation / external-state sequence and wrapped as a structured error report
   (id, severity, file, line, invariant, input, expected/actual, test). Only confirmed
   counterexamples are reported. Returns `{ spec_table, reports, compliance }`.
2. **fixer agent** (`references/fix-agent.md`) — receives the standard too, and repairs each
   reported invariant so its property test passes, re-runs the counterexample to confirm green,
   and **adds a DETERMINISTIC unit regression test per counterexample** — one concrete minimal
   input (the report's `input`) + the exact outcome the invariant requires — so the bug is
   instantly reproducible with no RNG. It names each regression after the TEST PURPOSE (the
   guarantee the test enforces, never the finding id — so a maintainer sees at a glance what it
   tests), keeps it permanent, and never deletes or weakens the review agent's property tests or
   any regression test. A report that CONFLICTS with the standard is not repaired: the fixer says
   so in that item's explanation instead of fixing the code against a requirement. It leaves
   changes UNCOMMITTED.

The workflow **returns** `{ status, clean, reports, fixes, compliance }`, and runs a **single
pass** (no re-review loop) because the PBT executes **> 10,000 runs per invariant**, which is a
statistically strong (near-formal) proof — the fixer only re-runs each counterexample to confirm
it is green.

**Then YOU (the main agent) aggregate** (`references/main-agent.md`): after the workflow returns,
summarize the counterexamples + fixes by severity (**critical / medium / low**), state which layer
each came from, and list which business logic is wrong, why it is wrong, and the actual user
impact, plus whether each was fixed. When a standard was supplied, also report the **compliance
summary** — requirements X/Y and acceptance M/N met, and every non-`pass` row with its reason,
naming the three instrument findings (coverage gap / hollow test / spec contradiction) as their
own axis next to the severity report. You produce the final `{ verdict, summary, issues }` report
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
  strengthens existing ones, over deleting or weakening any). It never repairs against the
  standard.
- The main agent (you) trusts the reported counterexamples and fixes as the evidence — the
  review agent ran them (> 10,000 runs each) and the fixer re-confirmed its fixes; the aggregation
  is your job, re-running the property-based tests is not.
- Counterexample reports reference a concrete file + line + failure mode (the property the
  branch violated).

## Files — knowledge organisation (one responsibility per file)

- `workflows/review.workflow.json` — the persisted `review` capsule (review → fix orchestration;
  `args` is `{ task, standard? }`). Invoke it by name:
  `run_workflow('review', { task, standard })`. The prompt text is composed at build time from
  the reference files below.
- `references/review-agent.md` — the review agent's CORE operating manual: mission, anti-bias,
  the standard axis, the three-layer spine, rules, severity, output schema. Read this first.
- `references/model-construction.md` — HOW to build the models, one section per layer: the
  module's own ops/lifecycle/hidden state (layer 1), the counterpart model (layer 2), the
  system-slice model with the external-world boundary (layer 3); stateless modules, software-type
  mapping, out-of-scope boundaries.
- `references/invariant-taxonomy.md` — WHAT to prove: the spec-table row fields and every
  invariant kind per layer (state / transition / composition / lifecycle → layer 1; interaction
  contract → layer 2; integration end-to-end → layer 3; data oracles, security).
- `references/test-patterns.md` — HOW to prove it: discover the repo's stack, the three test
  patterns (model-based sequences / environment-mock fault injection / input-generating), the
  purpose-naming rules, background run > 10k, shrink + structured report, plus the standard-axis
  evidence audit (exists → passes → non-hollow).
- `references/security-checklist.md` — the mandatory security axis: 12 common AI-agent security
  mistakes, each converted into a security invariant and PBT-proven (inlined into the capsule
  prompt at build time).
- `references/fix-agent.md` — the fixer prompt (including the standard-is-authoritative rule).
- `references/main-agent.md` — the main agent's (orchestrator) aggregation guide.
- `assets/workflow-template.md` — **migrated.** Historical review → fix workflow script; kept as a
  reference only, not to be copied into a `workflow` tool call.
