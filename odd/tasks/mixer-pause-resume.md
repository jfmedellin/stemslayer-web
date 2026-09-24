# Restore Mixer playback after pause

## Objective
Make Play resume after the Mixer is paused by keeping the UI's playback state synchronized with the AudioWorklet.

## Problem and rationale
The worklet flips its private `playing` state on pause but posts progress only while it is rendering. After pause, no new progress reaches `MixerPage`; its `progress.isPlaying` can remain `true`, so the next click sends another pause. The fake engine currently emits progress on pause and masks the production behavior.

## Authorized scope and constraints
- Authorized by the user's 2026-09-24 approval of the focused Mixer pause/resume fix and regression tests.
- Preserve the single AudioWorklet transport and existing user-visible controls; do not add redundant state or change audio routing.
- No unrelated Mixer improvements, remote operations, or model download/retry.

## Delivery and testing
- Route: delegated direct. CodeGraph and read-only mapping establish the cause; writer owns preparation and changes because multiple non-trivial files are involved.
- One coherent work unit; forecast 60–100 authored changed lines; strategy `ask-on-risk` (below the ~400-line heuristic).
- Strict TDD: enabled by project policy. Focused runner: `npm run test:browser -- src/infrastructure/web-audio/web-audio-engine.browser.test.ts`; RED before production changes, then GREEN and REFACTOR.
- Full applicable checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser`, `npm run build`, `git diff --check`.
- RDD: disabled by the user; ordinary checks only, no review invocation.

## Tasks
- [x] MPR-01 — Add a regression test proving the real playback state reports paused and then playing after pause/replay; correct the worklet's progress acknowledgement (or smallest evidence-backed equivalent) and ensure the Mixer UI toggle resumes. Preserve progress cursor. Run focused and full checks, then create one Conventional Commit on the feature branch.
  - Acceptance: after Pause, UI state is false and the next Play reaches the worklet and resumes from the same cursor; test coverage no longer depends on the fake prematurely emitting real-engine acknowledgements.
  - Verification: RED `npm run test:browser -- src/infrastructure/web-audio/web-audio-engine.browser.test.ts` reproduced missing progress events. GREEN: focused browser 7/7 (parent spot-check 7/7), full `npm test` 367/367, full browser 144/144, `git diff --check` passed. `npm run lint` fails on the existing `src/infrastructure/cache-api/cache-api-model-store.ts:34` (`no-control-regex`); typecheck and build fail on existing `src/infrastructure/cache-api/cache-api-model-store.browser.test.ts:130` (`TS2493`). These unrelated HEAD errors remain out of scope.
  - Rollback boundary: worklet transport acknowledgement, its focused tests, and any corresponding Mixer integration test only.
  - Commit: `57022da` (`fix(mixer): resume playback after pause`).

## Progress and next step
Implementation and synthetic AudioWorklet verification complete. The actual user's track playback was not manually re-tested. RDD disabled/unmanaged; no review was run. Next: user can retry Pause → Play in the Mixer and report any remaining mixer issue.
