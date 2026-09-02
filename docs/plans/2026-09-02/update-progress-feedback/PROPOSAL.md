# Proposal: Update Progress & Completion Feedback (Desktop App)

- **Date**: 2026-09-02
- **Source**: Produced by the `discuss` skill through structured conversation, grounded in GitHub issue Uniterra-Solutions/uniterra#15

---

## 1. Scope

### In Scope

- In-app update feedback for every update entry point in the desktop app (both prompted "new version available" and user-initiated update checks)
- A non-blocking progress panel that shows the current stage (Checking → Downloading → Installing → Finishing) plus a numeric percentage wherever the update process can measure it
- A clear success state: the app confirms the installed version and the user restarts whenever convenient (no forced auto-restart)
- A distinct failure state: a message naming the step that failed, a Retry action, and access to the update log
- Cancellation only at safe points (before destructive install steps begin)
- Support on macOS and Windows, with bilingual (English / Chinese) UI copy consistent with the rest of the app

### Out of Scope (Explicitly Excluded)

- Terminal/CLI feedback for `uniterra update` (desktop app only)
- Guaranteed determinate progress for phases where exact metrics cannot be measured (indeterminate indicator is acceptable there)
- Automatic restart after a successful update
- Automatic rollback when an update fails
- Free-form cancellation at any moment during the install
- Changes to the underlying update/download mechanism itself

---

## 2. User Scenarios

### Target Users

All desktop app users on macOS and Windows who update Uniterra through the app.

### Typical Flow

1. A new version is available (or the user checks for updates) and the user consents to update.
2. The app shows a progress panel with the current stage and a percentage when measurable; the update runs in the background while the user keeps working.
3. On success, the app confirms the new version and the user restarts whenever convenient.
4. On failure, the app shows a distinct error state naming the failing step, with a Retry action and access to the update log.

### Success Criteria

- At every moment the user knows whether an update is running, which phase it is in, and what to do next.
- Users stop force-quitting mid-update: no more "app froze during update" confusion, no interrupted installs.

### Error Handling

- A failure names the failing step, offers Retry and the update log, and reassures the user the app is in a safe state with clear next steps.
- Cancellation is offered only at safe points, before any destructive step, so a cancelled update never leaves a broken install.

---

## 3. Constraints

- Timeline: none — backlog item, ships whenever ready
- Platforms: macOS and Windows
- Language: bilingual UI copy (English + Chinese), matching existing app text conventions
- Security / Privacy: none beyond normal app-update handling
- Other: an update involves lengthy third-party install steps; once the destructive phase starts the process must not be interrupted

---

## 4. Business Value

### Problem Statement

Users currently cannot tell whether an update is progressing, so they may assume the app froze, force-quit, and corrupt the installation; clear progress and completion feedback removes that ambiguity, and a measured drop in update-related support reports after release is the success metric.

---

## 5. Requirement Summary

- In-app progress feedback: whenever an update runs (prompted or manual), the desktop app shows a non-blocking panel with stage labels and numeric percentages where measurable
- Clear success state: on completion the app confirms the new version and the user restarts whenever convenient — no forced auto-restart
- Failure handling: a distinct error state names the failing step, with Retry and access to the update log
- Safe cancellation: users may cancel only at safe points before destructive install steps; visible progress removes the need to force-quit
- Audience & copy: all desktop users on macOS and Windows, with bilingual (English/Chinese) messages

---

## 6. Open Questions

None
