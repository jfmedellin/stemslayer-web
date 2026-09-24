# Mixer Track Controls and Reset

## Objective
Make each track's mute/solo controls easier to scan beside its name, and provide a clear way to restore the mix to its initial settings.

## Problem
Mute/solo controls are currently separated vertically from the lane names, and users have no single action to undo changes to lane or master mix levels and M/S states.

## Why
The user requested the layout shown in the supplied reference and a Reset button at the end of the tracks that becomes available after mix controls change.

## Scope
- Place each lane's M and S buttons immediately to the left of its name, preserving lane labels and button accessibility state.
- Add a centered `Reset` button after the lane rows and before the transport controls.
- Keep the button disabled while all mix settings equal their initial defaults; enable when any lane gain/M/S or master gain differs.
- Reset all lane gains to 100%, all mute/solo states to false, and master gain to 100%.
- Do not change playback, playhead, or A/B loop state.
- Add browser regressions for layout, disabled/enabled transitions, and restored audio-engine gains.

## Constraints
- Strict TDD enabled; exact runner: `npm run test:browser`.
- Focused runner: `npm run test:browser -- src/ui/mixer/MixerPage.browser.test.tsx`.
- Also run `npm run typecheck`; known unrelated TS2493 at `src/infrastructure/cache-api/cache-api-model-store.browser.test.ts:130` must be reported if present.
- Current branch is `feat/p7b-onnx-worker`; do not push or create a PR as part of this local implementation.
- RDD is user-disabled; delivery remains disabled/unmanaged; do not start or toggle review.
- Delivery strategy: `ask-on-risk`; estimated authored diff under 400 lines.
- Leave the unrelated untracked `odd/tasks/first-public-release.md` untouched.

## Authorized Scope
`src/ui/mixer/LaneRow.tsx`, `src/ui/mixer/MixerPage.tsx`, `src/ui/tokens.css`, `src/ui/mixer/MixerPage.browser.test.tsx`, and this task document plus its Engram mirror.

## Acceptance Criteria
- In every lane row, M and S appear immediately before the lane name on the same heading line; the gain fader/readout remains on its own line beneath.
- Existing M/S accessible names and `aria-pressed` states, and the gain slider labels remain intact.
- Reset is centered after all lane rows and before transport controls, and is natively disabled at initial state.
- Changing any lane fader, M, S, or master fader enables Reset; returning every value manually to the defaults disables it again.
- Activating Reset restores every lane fader to 100%, clears M/S across all lanes, restores master gain to 100%, and disables Reset.
- Reset does not change playhead position, playback state, or A/B loop state.
- Focused and full browser suites pass; no unrelated app behavior changes.

## Applicable Checks
- RED then GREEN focused browser tests: `npm run test:browser -- src/ui/mixer/MixerPage.browser.test.tsx`.
- Full browser suite: `npm run test:browser`.
- `npm run typecheck` (record the known unrelated TS2493 failure if present).
- `git diff --check` and structural readback of lane controls, reset state, tests, and CSS.

## Tasks
- [x] MCR-01 — Align per-lane M/S controls with names and add dirty-aware reset for all mix settings.
  - Route: delegated direct.
  - Trigger evidence: state behavior, lane markup, shared CSS, and browser regressions span 4 non-trivial files; mapping and writer triggers apply.
  - Forecast: approximately 160–280 authored changed lines; one coherent mixer-controls work unit.
  - Verification evidence: RED observed with 3 new regression tests failing before source edits; focused browser suite passed (17/17); full browser suite passed (22 files, 159 tests); `git diff --check` passed. `npm run typecheck` remains blocked by the known unrelated TS2493 at `src/infrastructure/cache-api/cache-api-model-store.browser.test.ts:130`.
  - Commit: pending.
  - RDD assessment: disabled/unmanaged; no review.

## Progress
- Read-only CodeGraph mapping confirmed `MixerPage` owns both lane and master gain state, while `LaneRow` renders lane names and M/S controls.
- Defaults are lane gain 100%, mute false, solo false, and master gain 100%.
- The reset dirty condition will compare current mix values against defaults, rather than tracking whether a control was touched; moving a value back to defaults disables Reset.
- `MixerPage` audio effects already propagate lane/master values to the audio engine, so resetting React state reuses the established gain path.

## Next Step
Record the implementation commit identity, then save and read back the final tracker mirror.
