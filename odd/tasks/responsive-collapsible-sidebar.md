# Responsive Collapsible Sidebar

## Objective
Let users hide the left navigation on desktop to reclaim workspace, and make narrow-screen navigation usable without shrinking or breaking page content.

## Problem
The app shell always reserves 192px for its left navigation and has no narrow-screen shell layout; this wastes workspace on desktop and squeezes content on small viewports.

## Why
The user wants more usable screen space and a layout that remains functional on phones/small screens.

## Scope
- Add an accessible navigation toggle in the app header.
- On desktop, show the sidebar initially and allow it to collapse completely and restore.
- At the existing narrow-screen breakpoint, start with the sidebar closed and show it as an overlay drawer when opened.
- Close the narrow-screen drawer on destination selection, backdrop activation, and Escape.
- Ensure hidden navigation is not focusable or exposed as active navigation to assistive technology.
- Add browser regressions for desktop state, narrow-screen behavior, navigation, and viewport overflow.
- Preserve the current visual system and destination behavior; no auth, account, or persistence changes.

## Constraints
- Narrow-screen hidden-by-default drawer behavior explicitly confirmed by the user.
- Strict TDD enabled; source: project/session instruction. Exact runner: `npm run test:browser`.
- Also run `npm run typecheck`; known unrelated baseline TS2493 at `src/infrastructure/cache-api/cache-api-model-store.browser.test.ts:130` must be reported if still present.
- Current branch is `feat/p7b-onnx-worker`; do not push or create a PR.
- RDD is user-disabled; keep delivery disabled/unmanaged and do not launch or toggle review.
- Delivery strategy: `ask-on-risk`, forecast under 400 authored changed lines.

## Authorized Scope
`src/ui/shell/AppShell.tsx`, `src/ui/tokens.css`, `src/ui/shell/AppShell.browser.test.tsx`, and this task document plus its Engram mirror.

## Acceptance Criteria
- Desktop starts with navigation visible; the header toggle hides it and the workspace expands, and a second activation restores it.
- The sidebar toggle sits at the far right of the header beside the engine badge, not between the brand and right-side controls, and uses a compact outlined sidebar/panel icon matching the supplied reference.
- At narrow widths (existing 700px breakpoint), navigation is hidden by default and can be opened as an overlay without forcing horizontal page overflow.
- On narrow screens the drawer closes after choosing a destination, activating the backdrop, or pressing Escape.
- The toggle exposes correct accessible name/state/control relationship; hidden destinations are absent from keyboard tab order/accessibility tree.
- Existing navigation destination and active-page behavior continue working.
- Focused and full browser suites pass; no unrelated app behavior changes.

## Applicable Checks
- RED then GREEN focused browser test: `npm run test:browser -- --run src/ui/shell/AppShell.browser.test.tsx` (use exact observed runner syntax).
- Full browser suite: `npm run test:browser`.
- `npm run typecheck` (record the known unrelated TS2493 baseline failure if present).
- Structural readback of shell markup, responsive CSS, and regression tests.

## Tasks
- [x] RSB-01 — Implement accessible desktop collapse and narrow-screen navigation drawer with browser regressions.
  - Route: delegated direct.
  - Trigger evidence: coordinated behavior and responsive styling touches 3 non-trivial files; writer trigger applies. Four-file layout/accessibility mapping was delegated before implementation.
  - Forecast: approximately 120–220 authored changed lines.
  - Verification evidence: RED observed (3 new browser regressions failed before implementation); focused suite 11/11 passed; full browser suite 22 files / 155 tests passed; `git diff --check` passed. `npm run typecheck` still fails only with the known unrelated TS2493 at `src/infrastructure/cache-api/cache-api-model-store.browser.test.ts:130`.
  - Commit: `171cb17d3851e09961c8f82de4c5e0c75ddd4e04` — `feat(shell): add collapsible responsive navigation`.
  - RDD assessment: disabled/unmanaged; no review.
- [x] RSB-02 — Align the navigation toggle with the right-side header controls and replace the hamburger glyph with an outlined sidebar icon.
  - Route: delegated direct.
  - Trigger evidence: test-first presentation correction touches shell markup, shared CSS, and browser regressions (3 non-trivial files); writer trigger applies.
  - Forecast: approximately 40–100 authored changed lines; delivery strategy remains `ask-on-risk`.
  - Verification evidence: RED observed: focused test failed because `.header-controls` did not exist (11 passed, 1 failed); focused GREEN: 12/12 passed. Full browser suite: 22 files / 156 tests passed. `git diff --check` passed. `npm run typecheck` remains blocked only by the known unrelated TS2493 at `src/infrastructure/cache-api/cache-api-model-store.browser.test.ts:130`.
  - Commit: `f3fd1abb43ffbd780da8d7c5fbe9d35d6ea8f044` — `feat(shell): align navigation toggle with header controls`.
  - RDD assessment: disabled/unmanaged; no review.

## Progress
- Read-only mapping confirmed the app shell always reserves 192px, with no collapse state or shell-level mobile navigation treatment.
- User confirmed the narrow-screen navigation should start hidden and open from a menu button.
- Added a header toggle with accurate expanded/control semantics; desktop collapse expands the workspace, while narrow screens start hidden and open a dismissible overlay drawer.
- Hidden navigation uses the native `hidden` attribute, so its destinations leave the accessibility tree and tab order. Narrow drawer closes on destination selection, backdrop, and Escape, returning focus to the toggle.
- Narrow viewport regression exposed a pre-existing `body { min-width: 768px; }`; overridden within the existing 700px breakpoint to prevent horizontal overflow.
- Focused browser suite: `npm run test:browser -- --run src/ui/shell/AppShell.browser.test.tsx` — 11/11 passed.
- Full browser suite: `npm run test:browser` — 22 files / 155 tests passed.
- Typecheck: `npm run typecheck` — known unrelated TS2493 failure at `src/infrastructure/cache-api/cache-api-model-store.browser.test.ts:130`.
- User feedback: first iteration placed the navigation toggle in the middle of the header. The supplied reference places the sidebar control at the far right; RSB-02 corrects alignment and icon without changing navigation behavior.
- RSB-02 uses a right-aligned header-controls group containing the engine badge and toggle; the toggle now renders a compact decorative SVG panel outline while preserving its accessible name, expanded state, and controls relationship.
- RSB-02 regression: `npm run test:browser -- --run src/ui/shell/AppShell.browser.test.tsx` — 12/12 passed after observing RED (11 passed, 1 failed before implementation).
- RSB-02 full browser suite: `npm run test:browser` — 22 files / 156 tests passed.
- RSB-02 typecheck: `npm run typecheck` — failed with only the known unrelated TS2493 at `src/infrastructure/cache-api/cache-api-model-store.browser.test.ts:130`.
- RSB-02 whitespace validation: `git diff --check` — passed.

## Next Step
RSB-01 and RSB-02 are complete; no additional work is pending for this feature.
