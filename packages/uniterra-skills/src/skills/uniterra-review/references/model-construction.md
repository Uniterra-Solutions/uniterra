# Review knowledge — model construction

How to build the model for EVERY verification layer (layer 1 intra-module, layer 2 interaction,
layer 3 integration). Read everything first, THEN turn it into one spec table (invariant
taxonomy). The models are what every property test proves against — partial models are partial
reviews, and each layer is proven by PBT, not by hand.

## Layer 1 — the module's own model

### 1.1 Enumerate every public operation

List EVERY exported function / handler / API / event callback — the happy path included — plus all
the private state they share (fields, resources, cursors, timers, concurrency, persistence).

### 1.2 Map the LIFECYCLE

Initial state → operations that may run in any order / any combination (incl. interleavings and
repeats) → intermediate states → normal termination → teardown → restart. Track state that
accumulates across calls, resources acquired and released, retry/race/re-entrancy windows, and
every path back to a clean state.

### 1.3 Hunt for HIDDEN state and interactions

A lifecycle that is not obvious is exactly where the bugs live:

- **Implicit / derived state** — fields, caches, lazy initialization, closures, monotonic
  counters, memory of previous calls, accumulated effects: anything operations read or write
  besides their arguments.
- **Asynchronous / event boundaries** — callbacks, timers, promises, pending-request tables,
  subscription order. The lifecycle is event-driven, not call-driven, so the model includes event
  sequences and their interleavings.
- **Internal composition** — the module's own operations call private helpers in some order.
  Model each internal step and derive composition invariants: one step's postcondition must
  satisfy the next step's precondition on EVERY path that reaches it.

### 1.4 Stateless modules

A pure input→output module with no carried state and no events has no lifecycle to model: its
layer-1 model is only the DATA invariants of its operations. Do NOT invent a fake lifecycle.

## Layer 2 — the counterpart model (interaction)

For each counterpart the module communicates with — another module, an API, a service, an event
emitter, a plugin:

- **Contract of the counterpart**: what inputs it accepts (shape + invariants), what events/data
  it emits, its ordering requirements, its response semantics (success / error / timeout /
  malformed), and its ownership/authorization rules.
- **What the module EMITS** must be a legal input for the counterpart's contract — and what the
  counterpart emits must be a legal input for what the module ACCEPTS. Model both directions.
- **The pair's interaction points**: call sites, callbacks, events, subscriptions, retries —
  the points where one side's state becomes the other's input, plus the error/exception channels
  between them.
- Model the counterpart as a state machine over its promised states, and the module's behavior
  for every state the counterpart can present.

## Layer 3 — the system-slice model (integration)

- **Which slices**: the smallest system flows that involve the module — its real/interacting
  neighbours composed together (install → boot → use → teardown for a CLI; mount → render →
  update → unmount for a UI; request → translate → forward → respond for a gateway). Enumerate
  the slices that the review scope touches.
- **The external-world boundary**: in every slice, mock the external world — filesystem (tmpdir),
  network/HTTP (in-memory fetch), process/env/argv, clock, subprocess, event queues. For each
  boundary enumerate its possible EXTERNAL STATES: happy, empty, malformed, timeout, slow,
  error/5xx, permission-denied, partial write, missing dependency, env unset, clock skew,
  duplicated or out-of-order events, restart underneath. The environment is a state machine the
  code does NOT control: a module can be internally correct and still wrong against the world.
- **The slice lifecycle**: start → flow → teardown → restart, with failure injected at any point;
  what must hold at the END (no leak, clean state, re-usable) and across a restart.

## Model vocabulary per software type

The METHOD is one for every software type; only the model's vocabulary changes (operations +
lifecycle per type):

- **Backend / library / service**: layer-1 operations = the module's exports; layer-2 counterparts
  = its callers and the services it calls; layer-3 slices = request paths through the system.
- **Desktop / web UI**: layer-1 = the UI state machine (mount/update/unmount, double-clicks,
  in-flight request races); layer-2 = component ↔ store/API/event-bus contracts; layer-3 = the app
  flow slices (launch → journey → exit). Geometry and pixels are NOT review's job — that is QA.
- **CLI / installer / script**: layer-1 = command/step logic; layer-2 = the CLI ↔ filesystem /
  subprocess / env / user-input contracts; layer-3 = install → build → launch → upgrade/rollback.
- **Data / config / schema** (configs, manifests, wire formats): invariants = shape validity, no
  silent field loss, idempotent re-apply, write→read round-trip.
- **Infra / CI workflows**: operations = jobs/steps/triggers; invariants = determinism, ordering,
  env/secret hygiene.

## Out of scope for the review agent

State it where it applies; do not fake it:

- **Measured timing/performance and liveness ('eventually …')** are NOT review's job — they need
  maintainer-defined targets and are verified by the acceptance / perf suites, statistically
  (e.g. a percentage-of-paths-above-target pass criterion), not by this review.
- **Real scheduler interleavings** and **anything only visible in a pixel** are QA's domain.
- What IS review's job here: deterministic complexity/risk smells (obvious O(n²) / N+1 queries /
  unbounded memory growth / busy-wait loops over the whole path) — reason about them from the
  code and report them without benchmarking.

## One pass, obey the scope

Read everything in ONE pass before writing any test — never read one module, test it, and move
on. Inspect ONLY the review scope, but INSIDE it model everything — every operation, every state,
every counterpart, every external state, not just error branches.
