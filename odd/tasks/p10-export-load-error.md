# Export load failure recovery

Status: complete locally 2026-09-23. Authorized by the user's confirmation to fix the known Export loading failure before P11. Local work only on `feat/p7b-onnx-worker`; no push, PR, or deployment authorized. Delivery strategy: `ask-on-risk`; chain strategy: `feature-branch-chain` if needed.

## Objective and problem

A rejected catalog read can leave Export showing `Loading…` indefinitely and produce an unhandled promise rejection. The P10 native review reported this as non-blocking warning `R3-unhandled-export-load-rejection`; the user selected it as the next independent work unit. Exit loading on any asynchronous load failure and show the existing actionable error state, without reopening P10's acknowledged review.

## Scope and constraints

- `src/ui/export/ExportPage.tsx` load effect and its browser tests. Handle rejection from either catalog lookup, `exportTrack`, or row decoding; respect effect cancellation so an obsolete load cannot replace a newer result.
- Reuse the existing `loadFailed` state and alert. Do not add a new state, error taxonomy, retry mechanism, or UI copy unless evidence requires it.
- Keep other P10 export behavior and byte identity unchanged. No remote operations.
- Strict TDD is enabled by the current AGENTS.md; exact focused runner: `npm run test:browser -- src/ui/export/ExportPage.browser.test.tsx` if the script accepts a file filter, otherwise `npm run test:browser`. Observe RED before the fix, then GREEN/REFACTOR.
- Full checks: `npm test`, `npm run test:browser`, `npm run typecheck`, `npm run lint`, `npm run build`, `git diff --check`.

## Tasks

- [x] **E1 — Recover from rejected Export loading.** Route: delegated direct writer. Trigger: the browser test and non-trivial React load effect are two files, with reading as preparation for writing. First reproduced a rejected catalog read in a browser test; then made the smallest cancellation-safe correction. Acceptance: loading ends, the alert appears, no unhandled rejection occurs, and stale/cancelled loads do not overwrite a newer track. Authored change: 39 additions and 1 deletion. Rollback: revert this work unit's ExportPage load-effect and test changes; P10's earlier behavior and review record remain untouched.
- [x] **E2 — Verify and close locally.** Route: parent-owned readback, work-unit commit assessment, and tracker/Engram closure. Commit `5cacde4799a8ab1b4e8eb2201edfdad7cfb32c9e` is the behavior/test work unit; the closure document is a separate passive work unit.

## Acceptance criteria

- [x] A rejecting catalog operation no longer leaves Export on `Loading…`; the existing error alert is visible.
- [x] No unhandled rejection is emitted by the load chain.
- [x] A superseded or unmounted load cannot write its error/result into the active view.
- [x] Applicable focused and full checks pass; the work is committed in a Conventional Commit.

## Progress and next step

2026-09-23 — User confirmed fixing this warning before P11. Parent verified the root class through CodeGraph: `ExportPage` starts `Promise.all([...]).then(...)` without a rejection handler; `IndexedDbCatalog.getById` can reject. Existing `loadFailed` and alert already cover a failure state. The native P10 review is complete and must not be reopened for this separate fix.

2026-09-23 — E1 RED: `npm run test:browser -- src/ui/export/ExportPage.browser.test.tsx` failed (1/10; timeout waiting for alert), with one Vitest unhandled rejection from the rejected catalog. GREEN: the same command passed (10/10), then a stale-load regression case passed (11/11). The load chain now catches rejection and exits loading only when its effect is current. Full checks: `npm test` first failed due to a 5-second timeout in `tests/architecture.test.ts` and passed on retry (365/365); `npm run test:browser` passed (128/128); `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` passed. Runtime boundary: Chromium browser test with real React rendering and injected rejecting catalog; no external runtime needed.

2026-09-23 — E1 committed as `5cacde4799a8ab1b4e8eb2201edfdad7cfb32c9e` (`fix(export): recover from rejected catalog loads`), 74 additions / 1 deletion across the tracker, component, and browser test. Parent independently inspected the diff and reran the focused Chromium test (11/11). Native assessment against the last passive reviewed boundary `03d7742` classified the work unit medium risk, `review_due: false` (`under_budget`, 3 paths / 75 lines). This range remains pending in the cumulative slice; it has no review receipt. No push or PR was attempted. Rollback boundary: revert `5cacde4` for the behavior/test change; the earlier acknowledged P10 remains intact.

Next: P11 local design and accessibility work. Publication remains a separate user decision.
