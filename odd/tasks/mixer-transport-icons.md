# Mixer transport icon controls

## Objective
Update the Mixer’s primary transport controls to use the compact icon-button language shown in the user’s reference image, while retaining existing playback, ±10-second seek, and loop behavior.

## Problem
The reference mockup uses icon-based transport controls, while the current Mixer renders text buttons for Play/Pause and ±10 s seek and has no visible loop-toggle button. The A/B loop markers are separate functional controls and should remain available.

## Why
The user explicitly requested that the base Play, forward, back, and loop controls be adjusted to use the controls shown in the supplied image.

## Scope and constraints
- Implement only the requested primary controls: Play/Pause, seek backward/forward by 10 seconds, and loop toggle.
- Use the supplied image as visual reference: compact dark transport buttons with clear symbols; retain current design palette and responsive behavior.
- Keep Set A, Set B, and Clear loop controls; they define/clear the loop interval and are not replaced by the loop toggle.
- Loop icon must reuse current keyboard `L` toggle semantics and indicate whether a loop is active.
- Do not add a Stop control in this task; it was not included in the user's requested base-control list.
- No unrelated Mixer changes, dependency additions, or remote operations.

## TDD and verification
- Strict TDD: enabled by project instructions.
- Test runner: `npm run test:browser` (exact browser test script); Vitest name filtering may use `npm run test:browser -- -t "<test name>"`.
- Also run `npm run typecheck` and applicable browser tests for the task.
- RDD: disabled per current project/session instructions; ordinary checks only.

## Tasks
- [x] **MTR-01 — Add accessible icon transport controls** (delegated direct; preparation + write delegated because the JSX, CSS, and browser tests are coupled non-trivial files). Used inline SVG to avoid a new dependency. Preserved play/pause, ±10 s seek, loop-toggle semantics, disabled states, and Set A/Set B/Clear controls. Added browser coverage first, observed RED, implemented, then observed GREEN. Full browser suite passes; typecheck is blocked by an unrelated error in unchanged `src/infrastructure/cache-api/cache-api-model-store.browser.test.ts:130` (TS2493: tuple `[]` has no element at index `0`).

## Acceptance criteria
- The four primary transport actions are icon buttons visually aligned with the supplied mockup.
- Buttons have accessible names and visible focus states; skip controls communicate the 10-second increment.
- Play icon reflects pause state while playing.
- Loop icon toggles the existing loop behavior, exposes its pressed/active state, and remains synchronized with the keyboard `L` behavior.
- Set A/Set B/Clear remain available and keep their existing behavior.
- Focused browser tests and typecheck pass; any unavailable or failing check is recorded honestly.

## Progress and evidence
- Confirmed current working branch: `feat/p7b-onnx-worker`; working tree was clean before this task.
- CodeGraph mapping confirms the current UI has text Play/Pause and ±10 s controls, Set A/Set B/Clear loop controls, and an existing keyboard `L` loop toggle. `handleToggleLoopKey` is the behavior to reuse.
- Forecast: approximately 100–180 authored changed lines (excluding generated files).
- Delivery strategy: `ask-on-risk` default; forecast is below the ~400-line slice threshold.
- RED: `npm run test:browser -- -t "primary transport actions"` failed because the loop icon button did not exist yet.
- GREEN: `npm run test:browser -- -t "primary transport actions"` passed (1 test); `npm run test:browser -- -t "A/B loop markers"` passed (1 test).
- Full browser suite: `npm run test:browser` passed (22 files, 149 tests).
- Typecheck: `npm run typecheck` failed only at unchanged `src/infrastructure/cache-api/cache-api-model-store.browser.test.ts:130` with TS2493 (`[]` tuple has no index `0`). No Mixer-related type errors were reported.
- Runtime harness: browser Vitest/Chromium; icon-button semantics and loop keyboard/button synchronization exercised by the Mixer browser tests.
- Rollback boundary: revert the MTR-01 commit, which removes the compact controls and their focused browser coverage without affecting other Mixer behavior.
- Behavior work-unit commit: `f905423c7d1771beba7de61b8ef8f425453d44e5` (`feat(mixer): add compact icon transport controls`). This task-document evidence update is in a follow-up commit to record the behavior commit identity without a self-referential hash.

## Next step
Parent to read back this document and synchronize its Engram mirror.

## Relevant files
- `src/ui/mixer/TransportBar.tsx` — transport controls and A/B loop controls.
- `src/ui/mixer/MixerPage.tsx` — playback/seek/loop handlers and state.
- `src/ui/tokens.css` — Mixer transport styling.
- `src/ui/mixer/MixerPage.browser.test.tsx` — browser-level Mixer interaction coverage.
