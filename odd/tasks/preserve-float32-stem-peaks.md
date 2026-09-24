# Preserve float32 stem peaks

## Objective
Allow model-generated stems with finite samples above absolute peak 1 to be stored without attenuation, clipping, or a false mixer-gain instruction.

## Problem and rationale
The Basic model reached stem persistence but a generated peak of 1.1079013347625732 triggered `export.clipping`. The current float32 WAV encoder applies a future rendered-mixdown clipping policy to raw stems. Mixer gain cannot affect this stage. Preserving the model samples is less surprising than automatic normalization or limiting.

## Authorized scope and constraints
- Authorized by the user's 2026-09-24 approval of the focused fix and tests.
- Preserve every finite float32 sample verbatim; continue rejecting non-finite samples with accurate diagnostics.
- No real model download, track retry, Mixer feature work, or remote operation is authorized by this task.
- Preserve the documented no-silent-clipping requirement for a future rendered mixdown; do not implement that future export path here.

## Delivery and testing
- Route: delegated direct. Mapping and preparation delegated; writer trigger applies because codec, domain tests, and browser integration tests are non-trivial files.
- One coherent work unit, forecast 60–100 authored changed lines; strategy `ask-on-risk` (not near the ~400-line threshold).
- Strict TDD: enabled by project architecture and runtime configuration. Runner: `npm test -- --run tests/domain/float32-wav.test.ts` and focused browser test via `npm run test:browser -- --run src/infrastructure/onnx-worker/onnx-worker-inference.browser.test.ts`.
- Full applicable checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser`, `npm run build`, `git diff --check`.
- RDD: disabled by the user; report `disabled/unmanaged`, with no review invocation.

## Tasks
- [x] PFS-01 — Add RED tests for unchanged >1 finite float32 WAV round-trip and ONNX stem persistence; retain non-finite rejection. Remove the misplaced peak guard and misleading diagnostic without relaxing non-finite validation. Align the relevant decision/comment text. Observe GREEN and applicable full checks, then create one Conventional Commit on the feature branch.
  - Acceptance: a finite >1 model stem is persisted unchanged, no automatic gain change occurs, non-finite samples still fail, and no active user message recommends Mixer gain for stem publication.
  - Verification: RED `npm test -- --run tests/domain/float32-wav.test.ts` (4 failing cases) and `npm run test:browser -- src/infrastructure/onnx-worker/onnx-worker-inference.browser.test.ts` (over-range Worker/OPFS case failed at peak 1.6000). GREEN: focused Node 7/7, focused browser 6/6; full `npm test` 367/367, full `npm run test:browser` 143/143, and `git diff --check` passed. Parent spot-check reran focused Node 7/7. `npm run lint` fails at existing `src/infrastructure/cache-api/cache-api-model-store.ts:34` (`no-control-regex`); `npm run typecheck` and `npm run build` fail at existing `src/infrastructure/cache-api/cache-api-model-store.browser.test.ts:130` (`TS2493`). Both offending lines are unchanged from HEAD. Real-song retry remains pending user action.
  - Rollback boundary: codec policy, its focused tests, and related explanatory documentation only.
  - Commit: `620750b` (`fix(audio): preserve finite float32 stem peaks`).

## Progress and next step
Implementation and synthetic runtime verification complete. No silent attenuation or clipping was added. RDD disabled/unmanaged; no review was run. Next: resolve the unrelated existing lint/typecheck failures in separate authorized scope, then ask the user to retry the original song in the local app; this task does not claim that live scenario as verified.
