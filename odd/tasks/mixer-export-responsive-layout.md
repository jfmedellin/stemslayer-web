# Mixer and Export Responsive Layout

## Objective
Make Mixer and Export use the available workspace width in maximized desktop viewports, and let Mixer use additional vertical space without compromising shorter viewports.

## Problem
The workspace shell already fills the browser, but `.mixer-page` and `.export-page` have separate fixed `max-width` caps. Mixer also keeps intrinsic track heights, leaving large unused space below the timeline in a tall viewport.

## Why
The maximized screenshots show substantial unused horizontal space on both pages and unused vertical space in Mixer.

## Scope
- Remove or adapt page-specific width caps so both pages expand to the workspace while preserving mobile gutters and usable content proportions.
- Make Mixer distribute available vertical space into its track/timeline composition at tall desktop sizes, retaining sensible minimum lane sizes and normal scrolling at short sizes.
- Add browser-level regression coverage for wide and tall viewports and responsive behavior.
- Do not redesign controls, change audio behavior, or force Export's individual content to stretch vertically.

## Constraints
- Strict TDD enabled; source of mode: project/session instruction. Exact test runner: `npm run test:browser`.
- Also run `npm run typecheck`; baseline has a previously observed unrelated TS2493 at `src/infrastructure/cache-api/cache-api-model-store.browser.test.ts:130`, and report current result honestly.
- Existing dark visual language and compact styling remain unchanged; use CSS layout only unless tests require otherwise.
- Delivery strategy: `ask-on-risk` default; forecast under 400 authored changed lines, so no chain choice expected.

## Authorized Scope
Only the responsive Mixer and Export layout and its regression tests, plus this task document and Engram mirror.

## Acceptance Criteria
- On wide maximized screens, Mixer and Export content containers use the available workspace width rather than stopping at their current 1280px/1160px caps.
- On tall Mixer viewports, tracks/timeline use available height while keeping a usable minimum lane height; at shorter heights the page remains scrollable and content is not clipped.
- Export's current two-column information hierarchy and mobile stacking are preserved.
- Regression tests pass and no audio behavior changes.

## Applicable Checks
- RED then GREEN: `npm run test:browser -- --run src/ui/mixer/MixerPage.browser.test.tsx src/ui/export/ExportPage.browser.test.tsx` (adapt exact file-selection syntax only if the existing runner requires it; document the observed command).
- Full applicable browser suite: `npm run test:browser`.
- `npm run typecheck` (record known unrelated baseline issue if present).
- Structural readback of changed CSS and tests.

## Tasks
- [x] MRE-01 — Add viewport regression tests and implement fluid Mixer/Export desktop sizing with responsive height behavior.
  - Route: delegated direct.
  - Trigger evidence: implementation needs coordinated CSS and browser-test edits; writer trigger applies. Mapping of 4+ layout/test files was delegated before deciding.
  - Forecast: approximately 120–220 authored changed lines; actual implementation diff is 58 authored lines before this document update.
  - Verification evidence: RED observed on the new viewport tests before CSS changes: Mixer width capped at 1280px and Export at 1160px. GREEN: `npm run test:browser -- --run src/ui/mixer/MixerPage.browser.test.tsx src/ui/export/ExportPage.browser.test.tsx` — 2 files / 27 tests passed; `npm run test:browser` — 22 files / 152 tests passed. `npm run typecheck` remains blocked by the documented unrelated `src/infrastructure/cache-api/cache-api-model-store.browser.test.ts(130,43): TS2493`.
  - Commit: `7badd37` (`fix(ui): expand mixer and export layouts`).
  - RDD assessment: disabled/unmanaged (repository review switch was already reported globally off; no review launched or toggled).

## Progress
- Read-only mapping confirmed shared workspace fills the shell; individual page max-width caps cause most horizontal whitespace. Mixer has no tall-viewport height distribution.
- Added browser geometry regressions and observed RED at the old 1280px Mixer / 1160px Export caps.
- Removed page width caps; on tall viewports the Mixer now uses workspace height and distributes it across lanes with an 80px minimum row, while shorter layouts retain natural page scrolling. Export's existing columns and responsive stacking remain unchanged.
- Focused and full browser suites pass; typecheck reports only the known TS2493 baseline failure above.

## Next Step
No implementation work remains; full suite passed and the work unit is committed as `7badd37`.
