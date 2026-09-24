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

## Progress
- Read-only mapping confirmed the app shell always reserves 192px, with no collapse state or shell-level mobile navigation treatment.
- User confirmed the narrow-screen navigation should start hidden and open from a menu button.
- Added a header toggle with accurate expanded/control semantics; desktop collapse expands the workspace, while narrow screens start hidden and open a dismissible overlay drawer.
- Hidden navigation uses the native `hidden` attribute, so its destinations leave the accessibility tree and tab order. Narrow drawer closes on destination selection, backdrop, and Escape, returning focus to the toggle.
- Narrow viewport regression exposed a pre-existing `body { min-width: 768px; }`; overridden within the existing 700px breakpoint to prevent horizontal overflow.
- Focused browser suite: `npm run test:browser -- --run src/ui/shell/AppShell.browser.test.tsx` — 11/11 passed.
- Full browser suite: `npm run test:browser` — 22 files / 155 tests passed.
- Typecheck: `npm run typecheck` — known unrelated TS2493 failure at `src/infrastructure/cache-api/cache-api-model-store.browser.test.ts:130`.

## Next Step
RSB-01 is complete; no additional work is pending for this feature.
