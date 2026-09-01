# Review knowledge — invariant taxonomy

Turn the models into one machine-readable specification table (an array of rows). Each row is a
claim the code must satisfy for ANY input and ANY operation or external-state sequence — a model
of the whole behaviour, not a list of conditional branches.

## Spec-table row fields

- **module** — the file/path of the module.
- **state** — the lifecycle state / phase the row applies to (initial, steady-state, terminating,
  restart, …), or 'any'.
- **operation** — the operation / transition the row pins ('any' when the invariant must hold in
  EVERY state, unconditionally). For layer-2/3 rows, name the interaction or system flow.
- **precondition** — what must hold before it runs.
- **postcondition** — what must hold after it runs.
- **invariant** — the property that must hold for ANY input (the claim a property test can pin).

Every row belongs to one verification layer — the layers re-use these kinds, and all of them are
proven by PBT:

## Layer 1: intra-module invariants

- **STATE invariants** — hold in EVERY reachable state after ANY sequence of operations (e.g.
  'account balances never go negative', 'cursors stay within bounds', 'every acquired resource is
  allocated before use and released exactly once after').
- **TRANSITION invariants** — every operation's pre→post contract ('precondition ⇒ postcondition
  for any input'), pinned as a property over operation + input.
- **COMPOSITION invariants** — the module's INTERNAL interactions: any internal step / private
  helper that an operation calls has a precondition that the caller's postcondition is guaranteed
  to satisfy, so the composition is consistent on EVERY path that reaches it ('the output state of
  each step is a legal input state for the next step').
- **LIFECYCLE invariants** — properties over WHOLE sequences: any interleaving of operations still
  holds the state invariants; a complete lifecycle (init → operations → teardown) ends clean
  (nothing leaked, no dangling state); restart / replaying a sequence is idempotent or
  re-entrancy-correct.

## Layer 2: interaction-contract invariants

The pair contract, for every counterpart the module communicates with:

- **EMIT compatibility** — everything the module emits is a legal input for the counterpart's
  contract (shape, ordering, ownership) for ANY reachable state of the pair.
- **ACCEPT coverage** — everything the counterpart can emit (per its contract) is handled correctly
  by the module: no swallowed exceptions, no misclassified errors, no crash on a legal-but-weird
  counterpart input.
- **ORDERING invariants** — event/subscription/callback order across the interface is preserved
  exactly as the pair's contract requires, for any interleaving the counterpart can produce.
- **ERROR-CHANNEL invariants** — failures on the counterpart side (timeout, error/5xx,
  malformed, permission-denied) surface to the caller per contract: never swallowed, never
  misclassified, never left as a silent partial state.

## Layer 3: integration end-to-end invariants

Over whole system flows that involve the module (with the external world mocked):

- **COMPOSED-FLOW invariants** — end-to-end no loss / no duplication / correct totals across the
  composed modules (what enters the slice and what leaves it agree), for every interleaving of the
  modules' operations and injected external states.
- **CROSS-BOUNDARY invariants** — ordering and consistency hold at every module boundary of the
  slice; a state committed at one boundary is visible as the expected state at the next.
- **LEAK-FREE-SYSTEM invariants** — a complete slice lifecycle (start → flow → teardown) leaves
  nothing behind at system level (no held resources, no partial records, no lingering handles),
  even when an external call fails at any point.
- **REPLAY / RESTART invariants** — restart or replay of a slice (from the mocked persisted state)
  is idempotent or re-entrancy-correct; failure injected mid-flow does not corrupt the replayed
  result.
- **FAILURE-POINT invariants** — for each identified failure point in the slice, the system
  reaches a defined, safe outcome: bounded retries, defined fallback, clean error surfaced, no
  infinite loop.

## DATA invariants (pure functions, any layer)

Pure input→output properties of value functions. Scale the oracle effort to BUSINESS MEANING: a
trivial pure helper ('isEven', 'pad') needs only the cheap purity/structure checks below; a pure
function that IS the business rule (a response translator, a mapping, a money/time/score
computation) needs the strongest oracle — a wrong business-rule function that passes all its tests
is the worst review outcome, and it is exactly what this review is for.

Where to get the STANDARD that can make an implementation fail (the oracle), strongest first:

- **INVERSE / round-trip** — the function pairs with an inverse or re-encoding that must recover
  the input ('encode→decode = identity', 'parse→serialize = fixpoint', canonical-form
  round-trips).
- **REFERENCE implementation** — write the naive / obviously-correct version of the same intent (a
  simple sort as the oracle for a faster one, the direct formula for a memoized one) and require
  agreement on arbitrary inputs — differential testing. The strongest oracle when no inverse or
  law exists.
- **ALGEBRAIC laws** — associativity, commutativity, idempotency, absorption, monoid laws,
  canonicity ('every input in the same equivalence class maps to the same output'), fixpoint
  ('format(format(x)) === format(x)').
- **RELATIONALLY COMPLETE contracts** — pin the whole input→output relation without naming the
  implementation: 'sort' = output is sorted AND a permutation of the input; 'dedupe' = preserves
  order AND has no duplicates AND the same set; 'chunk' = preserves order AND total content is
  unchanged AND every chunk fits the limit.
- **PURITY / structure laws** — same input → same output (determinism); arguments are NOT mutated
  (deep-freeze the inputs or snapshot-compare before/after); output depends only on the arguments
  (no hidden read of mutable module state); output structure conforms to the domain (result ⊆
  domain, keys preserved, ranges respected).

## SECURITY invariants

First-class, not an afterthought. Run the inlined security checklist (the last section of your
prompt) and, for EVERY item that applies to the code in scope, add a spec row whose invariant is
the security property (e.g. 'the resolved path always stays under the base directory for any
user-supplied input', 'get(id) denies resources the caller does not own', 'no untrusted input
reaches a query/command/path sink without escaping'). Each security invariant is proven with its
own PBT test, exactly like a business-logic invariant. The checklist's non-property items (a
hardcoded secret, a known-vulnerable dependency) are checked deterministically and reported as
findings if present.
