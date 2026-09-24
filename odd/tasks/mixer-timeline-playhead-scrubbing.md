# Mixer Timeline Ruler and Playhead Scrubbing

## Objective
Make Mixer navigation along a track precise and comfortable with a graduated timeline ruler and draggable playhead flag.

## Problem
The Mixer currently has a compact ruler with only five time labels and seeking by click or keyboard, while its playhead appears only as a line across the waveforms. The supplied reference uses ruler graduations and a flag-shaped cursor that communicates and controls the current position.

## Why
The user requested the ruler and arrow/flag shown in the reference so listeners can move confidently through the track.

## Scope
- Add clear major/minor timeline graduations while preserving the existing time labels.
- Render a visible flag/arrow at the current sample position, aligned with the shared waveform playhead.
- Support pointer dragging on the ruler to scrub continuously through the track, with sensible sample clamping.
- Preserve existing click-to-seek, keyboard slider semantics/shortcuts, A/B loop markers, and responsive layout.
- Add browser regressions for ruler graduations, flag position, and dragging/seeking.

## Constraints
- Strict TDD enabled; exact runner: `npm run test:browser`.
- Focused runner: `npm run test:browser -- src/ui/mixer/MixerPage.browser.test.tsx`.
- Preserve existing `role="slider"`, accessible label/value, keyboard seeking, and loop marker behavior.
- Keep the flag decorative to assistive technology; slider remains the accessible control.
- Local-only implementation; no remote discovery, push, pull request, deployment, or RDD lifecycle.
- Leave unrelated untracked `odd/tasks/first-public-release.md` untouched.

## Authorized Scope
`src/ui/mixer/MixerStrip.tsx`, `src/ui/tokens.css`, `src/ui/mixer/MixerPage.browser.test.tsx`, and this task document plus its Engram mirror.

## Acceptance Criteria
- The ruler remains directly above the waveform tracks and includes graduated minor ticks plus the existing major time labels.
- A flag/arrow is visible at the current playhead position and tracks the same sample position as the vertical waveform line.
- Dragging the ruler/flag seeks smoothly to the pointer position and clamps at the beginning/end of the track.
- Existing click and keyboard seek still work; keyboard Arrow handling does not also trigger the document-level seek shortcut.
- Existing A/B loop markers remain correctly positioned and usable.
- Focused and full browser suites pass; no unrelated app behavior changes.

## Applicable Checks
- RED then GREEN focused browser tests: `npm run test:browser -- src/ui/mixer/MixerPage.browser.test.tsx`.
- Full browser suite: `npm run test:browser`.
- `npm run typecheck`; report any existing unrelated failure without broadening scope.
- `git diff --check` and structural readback of ruler events/visuals and playhead alignment.

## Tasks
- [x] MTR-01 — Add graduated ruler, aligned draggable playhead flag, and browser coverage.
  - Route: delegated direct.
  - Trigger evidence: ruler markup/interaction, shared styling, playback seek propagation, and browser regressions require understanding and editing 4+ files; mapping and writer triggers apply.
  - Forecast: approximately 100–180 authored changed lines; one coherent Mixer navigation work unit.
  - Verification evidence: strict-TDD RED showed 2 new failures (missing ticks/flag and no drag seeking); GREEN focused suite passed 19/19, full browser suite passed 22 files / 161 tests, and `git diff --check` passed. `npm run typecheck` remains blocked only by the unrelated pre-existing TS2493 at `src/infrastructure/cache-api/cache-api-model-store.browser.test.ts:130`.
  - Runtime: N/A — local browser UI behavior is exercised by the browser test runner; no external runtime boundary is part of this task.
  - Commit: `c3e04a54092e13bea964f3223458914cf598e52b` (`feat(mixer): add timeline ruler scrubbing`).
  - RDD assessment: disabled/unmanaged; no review.

## Progress
- CodeGraph and targeted mapping confirmed the existing ruler is already a focusable accessible slider with click seeking and one-second keyboard seeking; `MixerPage` clamps seeks and updates both engine and UI state.
- The existing playhead is a single vertical line over the waveform rows. The current ruler shows five time labels but has no graduated ticks, flag, or drag-to-seek.
- Prior keyboard-seeking work established that arrow-key events must stop propagation or the document-level ±10-second shortcut also fires.
- No product ambiguity remains: the supplied image supports retaining existing labels/seeking and adding graduated ticks plus a draggable flag.
- Implemented 101 decorative ruler graduations (longer at quarter marks), a decorative flag positioned from `currentSample`, and pointer capture plus pointer-move seeking with clamping; click seeking also clamps locally. The mobile ruler now begins at the waveform overlay's 35% offset so both cursors share the same horizontal timeline.
- Added browser regressions for graduated ticks, flag/playhead alignment, drag scrubbing and both bounds; existing click, keyboard, loop, and responsive tests remain green.
- Check evidence: focused `npm run test:browser -- src/ui/mixer/MixerPage.browser.test.tsx` passed (19/19); full `npm run test:browser` passed (22 files, 161 tests); `npm run typecheck` failed only at the known unrelated TS2493 line; `git diff --check` passed.

## Next Step
MTR-01 is complete. The implementation is committed locally; the unrelated untracked `odd/tasks/first-public-release.md` remains untouched. No remote work was authorized or performed.
