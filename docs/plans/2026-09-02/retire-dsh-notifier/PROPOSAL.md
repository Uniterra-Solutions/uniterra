# Proposal: Retire dsh-notifier as a Bundled Built-in Plugin

- **Date**: 2026-09-02
- **Source**: Produced by the `discuss` skill through structured conversation, grounded in GitHub issue Uniterra-Solutions/uniterra#26

---

## 1. Scope

### In Scope

- Flip the `dsh-notifier@0.8.6` entry in the desktop's built-in plugin registry from an active npm built-in to a **retired** entry with an explanatory comment, reusing the existing retired mechanism (same as `dsh-hotkeys`, `dsh-git-graph`, etc.)
- Profile healing: `removeRetiredBuiltins()` removes the `dsh-notifier` bundle row (and its files) from existing profiles on startup
- Verification: unit tests asserting `retiredBuiltinNames()` contains `'dsh-notifier'` and that `removeRetiredBuiltins()` removes only that row from a fixture profile
- Documentation: the removal is called out in the release notes / changelog
- Priority: ship as soon as possible

### Out of Scope (Explicitly Excluded)

- A successor or replacement notification feature (dsh-notifier's notifications are simply no longer bundled)
- Auditing or retiring any other overlapping plugins (e.g. `dsh-better-sidebar` Tasks, `@leetoners/dsh-ui-subagent-monitor`)
- Changes to other existing retired entries or to any other bundle row in profiles
- Any in-app notice about the removal (release notes only)
- Deleting `dsh-notifier` copies that users installed themselves (only the bundled row is healed away)
- New data structures or mechanisms beyond the existing `retired` marking

---

## 2. User Scenarios

### Target Users

- Maintainers provisioning the desktop app (registry stays declarative and clean)
- Existing desktop users whose profile already contains the bundled `dsh-notifier` row

### Typical Flow

1. A user upgrades to a release that ships the retirement.
2. On the next startup, built-in provisioning treats `dsh-notifier` as retired.
3. `removeRetiredBuiltins()` removes the `dsh-notifier` bundle row from the profile; everything else stays untouched.
4. A user who installed `dsh-notifier` on their own keeps it — the heal only targets the bundled row.

### Success Criteria

- `retiredBuiltinNames()` includes `'dsh-notifier'`
- Existing profiles no longer contain the `dsh-notifier` bundle row after startup
- User-installed copies are preserved
- Lint, typecheck, and the desktop test suite are green
- The removal is mentioned in the release notes

### Error Handling

- Healing is non-destructive by design: only the bundle row is removed; an illegible or already-modified profile is never damaged, and user-installed copies are never touched

---

## 3. Constraints

- Timeline: as soon as possible (next release)
- Scope of change: only `packages/uniterra-desktop/src/builtin.ts` and its related tests; no refactor of other retired entries
- No new data structures — reuse the existing `retired` marking mechanism
- Quality gates: `pnpm run lint`, `pnpm run typecheck`, and `pnpm --filter @uniterra-solutions/uniterra-desktop test` must all pass

---

## 4. Business Value

### Problem Statement

`dsh-notifier` is bundled as a built-in even though its responsibilities overlap with other dsh notification/monitoring plugins and the project no longer depends on it, so shipping it as an active built-in adds surface area and confusion; retiring it keeps the bundled registry aligned with what the project actually relies on.

---

## 5. Requirement Summary

- Registry change: `dsh-notifier` flips from an active npm built-in to a retired entry with a comment, reusing the existing retired mechanism
- Profile healing: `removeRetiredBuiltins()` removes its bundle row from existing profiles at startup; user-installed copies are untouched
- Verification and docs: unit tests for `retiredBuiltinNames()` / `removeRetiredBuiltins()`, lint/typecheck/desktop tests green, and the removal noted in the release notes — prioritised ASAP

---

## 6. Open Questions

None
