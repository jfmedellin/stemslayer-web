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
- [ ] PFS-01 — Add RED tests for unchanged >1 finite float32 WAV round-trip and ONNX stem persistence; retain non-finite rejection. Remove the misplaced peak guard and misleading diagnostic without relaxing non-finite validation. Align the relevant decision/comment text. Observe GREEN and applicable full checks, then create one Conventional Commit on the feature branch.
  - Acceptance: a finite >1 model stem is persisted unchanged, no automatic gain change occurs, non-finite samples still fail, and no active user message recommends Mixer gain for stem publication.
  - Verification: RED and GREEN exact commands/results, full checks, runtime synthetic integration result; real-song retry pending user action.
  - Rollback boundary: codec policy, its focused tests, and related explanatory documentation only.
  - Commit: pending.

## Progress and next step
Pre-implementation mapping complete. Next: delegated writer performs strict RED → GREEN → REFACTOR and reports exact proof. Mirror to Engram before source edits.
