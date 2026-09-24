# Restore Mixer playback after pause

## Objective
Make Mixer Play/Pause reliably resume audible real-time audio, including when the browser's AudioContext is suspended.

## Problem and rationale
Initially, the worklet flipped its private `playing` state on pause but posted progress only while rendering. MPR-01 fixed that stale UI state and is covered against the real Worklet. Manual testing then showed that the button changes while the track remains silent. Code inspection found that the app constructs the real `AudioContext` at startup, but `WebAudioEngine.play()` only posts a Worklet message and never resumes a suspended real-time context. The active browser context was unavailable for inspection, so suspended context is a code-supported hypothesis, not proven live state. MDN documents resuming a suspended Web Audio context from a user-initiated click: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices and https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume.

## Authorized scope and constraints
- Authorized by the user's 2026-09-24 approval of the focused Mixer pause/resume fix and regression tests.
- Preserve the single AudioWorklet transport and existing user-visible controls; do not add redundant state or change audio routing. Resume a suspended real-time context from the user's Play gesture without breaking OfflineAudioContext-based tests.
- No unrelated Mixer improvements, remote operations, or model download/retry.

## Delivery and testing
- Route: delegated direct. CodeGraph and read-only mapping establish the cause; writer owns preparation and changes because multiple non-trivial files are involved.
- MPR-02 is a separate coherent work unit; forecast 40–100 authored changed lines; strategy `ask-on-risk` (below the ~400-line heuristic).
- Strict TDD: enabled by project policy. Focused runner: `npm run test:browser -- src/infrastructure/web-audio/web-audio-engine.browser.test.ts`; RED before production changes, then GREEN and REFACTOR.
- Full applicable checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser`, `npm run build`, `git diff --check`.
- RDD: disabled by the user; ordinary checks only, no review invocation.

## Tasks
- [x] MPR-01 — Add a regression test proving the real playback state reports paused and then playing after pause/replay; correct the worklet's progress acknowledgement (or smallest evidence-backed equivalent) and ensure the Mixer UI toggle resumes. Preserve progress cursor. Run focused and full checks, then create one Conventional Commit on the feature branch.
  - Acceptance: after Pause, UI state is false and the next Play reaches the worklet and resumes from the same cursor; test coverage no longer depends on the fake prematurely emitting real-engine acknowledgements.
  - Verification: RED `npm run test:browser -- src/infrastructure/web-audio/web-audio-engine.browser.test.ts` reproduced missing progress events. GREEN: focused browser 7/7 (parent spot-check 7/7), full `npm test` 367/367, full browser 144/144, `git diff --check` passed. `npm run lint` fails on the existing `src/infrastructure/cache-api/cache-api-model-store.ts:34` (`no-control-regex`); typecheck and build fail on existing `src/infrastructure/cache-api/cache-api-model-store.browser.test.ts:130` (`TS2493`). These unrelated HEAD errors remain out of scope.
  - Rollback boundary: worklet transport acknowledgement, its focused tests, and any corresponding Mixer integration test only.
  - Commit: `57022da` (`fix(mixer): resume playback after pause`).
- [x] MPR-02 — Resume a suspended real-time audio context from the Play action, while preserving OfflineAudioContext test behavior. Keep the actual live-tab root and audible output as manual verification until confirmed.
  - Trigger: user re-tested MPR-01 and reported the Play/Pause button changes but no audio is heard; the updated app page had already been reloaded.
  - Acceptance: when the real-time context is suspended, the Play gesture requests resume before sending the Worklet play command; an already-running context remains unaffected, and no play command/playing acknowledgement is sent if resume rejects. Actual audible output on the user's browser is verified manually after implementation.
  - Verification: RED focused browser test reproduced the defect (`expected running, received suspended`; 7 passed/1 failed). GREEN `npm run test:browser -- src/infrastructure/web-audio/web-audio-engine.browser.test.ts` 11/11 (parent spot-check 11/11); full browser 148/148; Node `npm test -- --testTimeout=15000` 367/367. Default `npm test` had one unrelated architecture-test timeout (366/367); rerun with 15s timeout passed. `git diff --check` passed. Existing lint failure at `cache-api-model-store.ts:34` (`no-control-regex`) and typecheck/build failure at `cache-api-model-store.browser.test.ts:130` (`TS2493`) remain unrelated. New automated tests mock `resume()` fulfillment/rejection because Chromium automation cannot provide genuine autoplay user activation; manual audible playback with the user's track is therefore still pending.
  - Rollback boundary: the WebAudioEngine real-time context activation path and its focused tests only.
  - Commit: `d7be2eb` (`fix(mixer): resume suspended audio context on play`).

## Progress and next step
MPR-01 and the MPR-02 implementation are complete with automated tests; the live audible result remains unverified. RDD disabled/unmanaged; no review was run. Next: user reloads the updated app, retries Play/Pause with the original track, and confirms whether sound is audible. Do not state the real browser cause as confirmed until that check.
