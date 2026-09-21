# P7a — Windowing and Basic spectral processing

Status: P7A-01 committed and assessed; P7A-02 pending. Delivery strategy: `ask-on-risk`; chain strategy: `feature-branch-chain`.

## Objective

Implement deterministic planar-audio windowing shared by both inference profiles and the external FFT/STFT pipeline required only by the Basic model.

## Problem / why

The ONNX Worker cannot safely execute either model until input windows, overlap reconstruction, progress boundaries, and Basic's external spectral transform exactly match the S2 evidence. P7a isolates that pure DSP from Worker lifecycle and ONNX Runtime concerns.

## Scope

- Fixed 343980-sample windows with a 257985-sample stride and 25% overlap.
- Symmetric end-context extension and center trimming to the natural chunk length.
- Full triangular segment weight with accumulated-weight normalization.
- Immutable planar `Float32Array` input/output and strict shape validation.
- Per-window monotonic progress callback.
- Basic-only radix-2 FFT, normalized STFT/iSTFT, CAC layout, Demucs spectral padding, and time/frequency branch reconstruction.

## Out of scope

- ONNX Runtime sessions, providers, Worker protocol, transfer lists, cancellation, or termination.
- Model download/cache behavior from P6.
- Stem persistence from P5.
- Audio decoding, resampling, UI, or application composition.
- Remote publication.

## Constraints and decisions

- Base branch `feat/p7-integration` at merge commit `9198af8` contains P5 and P6 without rewriting reviewed commits.
- Both models use segment length 343980, stride 257985, symmetric context, center trim, triangular weighting, and normalization.
- Basic requires external JS FFT/STFT and CAC construction; Rock consumes and produces waveform tensors directly.
- STFT parameters are FFT 4096, hop 1024, periodic Hann, reflect padding, and normalized transform.
- Public audio arrays use `Float32Array`; FFT/STFT may use `Float64Array` internally for numerical parity.
- Runtime harness is N/A for P7a because this phase is pure deterministic DSP; P7b owns browser Worker/ONNX execution.
- Strict TDD is enabled; every implementation task records observed RED, GREEN, and REFACTOR evidence.
- Code and artifacts are English; commits use Conventional Commits without AI attribution.

## Tasks

- [x] **P7A-01 — Add fixed-window overlap reconstruction.**
  - Route: delegated direct. Trigger: new DSP module plus substantial deterministic tests.
  - RED: offsets, triangular weights, short/exact/overlapping/final-partial reconstruction, channel alignment, progress order, and invalid shapes.
  - GREEN/REFACTOR: minimal immutable planar-window API and normalized overlap-add.
  - Tolerance: maximum identity reconstruction error `<= 1e-6`.
  - Rollback: `windowing.ts`, its focused tests, and this task's tracker evidence.
- [ ] **P7A-02 — Add Basic external spectral processing.**
  - Route: delegated direct. Trigger: FFT, STFT/iSTFT, CAC, Demucs padding, and golden parity tests span multiple non-trivial files.
  - RED: FFT and STFT round trips, S2 golden bins, Nyquist handling, CAC layout, padding/frame count, and branch reconstruction.
  - GREEN/REFACTOR: radix-2 FFT plus Basic-only spectral adapters; no Worker/ONNX behavior.
  - Tolerance: round-trip and golden maximum error `<= 1e-6`.
  - Rollback: `fft.ts`, `stft.ts`, their focused tests, and P7A-02 tracker evidence; P7A-01 remains.
- [ ] **P7A-03 — Close P7a.**
  - Route: parent-owned commits, assessments, final checks, and Engram mirror update.
  - Evidence: strict-TDD history, exact checks, authored counts, rollback boundaries, commit identities, and native outcomes.

## Acceptance criteria

- [x] Window offsets and progress are deterministic and strictly ordered.
- [x] Short, exact, overlapping, and partial-final inputs reconstruct with maximum error `<= 1e-6`.
- [x] Frame count and channel alignment are preserved; invalid shapes fail closed.
- [x] Full triangular weighting and accumulated normalization match S2 behavior.
- [ ] FFT and STFT/iSTFT round trips satisfy `<= 1e-6`.
- [ ] Basic CAC layout, Nyquist behavior, Demucs padding, and branch reconstruction match S2 evidence.
- [ ] Rock remains waveform-only and does not depend on Basic spectral code.
- [ ] Focused and full checks pass with observed strict-TDD evidence.

## Forecast and delivery

Forecast: P7A-01 approximately 300–420 authored lines; P7A-02 approximately 450–650 authored lines. Two feature-branch-chain slices are the honest boundary because the S2 DSP source alone exceeds the original roadmap estimate. The 400-line value remains a review heuristic and will not be met by deleting tests, documentation, or clarity.

Planned chain:

```text
feat/p7-integration
  └─ feat/p7a-windowing (P7A-01)
       └─ follow-up P7A-02 slice
```

## Applicable checks

- P7A-01 focused: `npm test -- --run tests/infrastructure/onnx-worker/windowing.test.ts`.
- P7A-02 focused: `npm test -- --run tests/infrastructure/onnx-worker/fft.test.ts tests/infrastructure/onnx-worker/stft.test.ts`.
- Closure: `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
- Review focus: exact S2 constants, edge-window semantics, normalization, shape validation, numerical tolerance, and keeping Worker/ONNX out of P7a.

## Progress / evidence

- 2026-09-21 — Created local integration branch `feat/p7-integration` from P5 and merged P6 at `9198af8`; reviewed P6 commit identities remain intact.
- 2026-09-21 — Created `feat/p7a-windowing` from the integration base.
- 2026-09-21 — Read-only mapping confirmed P7a's S2 semantics and the Basic-only external spectral path; no product decision is open.
- 2026-09-21 — P7A-01 strict-TDD RED: `npm test -- --run tests/infrastructure/onnx-worker/windowing.test.ts` failed before source implementation because `src/infrastructure/onnx-worker/windowing` did not exist (0 tests collected).
- 2026-09-21 — P7A-01 GREEN: the same focused command passed 1 file / 16 tests. Implemented immutable planar fixed-window processing with segment `343980`, stride `257985`, symmetric centered context for partial chunks, center trim, full triangular weight, accumulated normalization, strict input/output shape checks, deterministic offsets, and exactly-once ascending progress.
- 2026-09-21 — P7A-01 REFACTOR: extracted input/output validation and centered-window construction helpers; `npm run typecheck`, `npm run lint`, and `git diff --check` passed. Runtime harness: N/A — this work unit is pure deterministic DSP with no browser/Worker/ONNX runtime boundary.
- 2026-09-21 — P7A-01 verification: focused 1 file / 16 tests; full Node suite 20 files / 199 tests; typecheck, lint, build, and whitespace checks passed.
- 2026-09-21 — P7A-01 rollback boundary: remove `src/infrastructure/onnx-worker/windowing.ts`, `tests/infrastructure/onnx-worker/windowing.test.ts`, and this P7A-01 evidence; P7A-02 and Worker behavior remain absent.
- 2026-09-21 — P7A-01 source/test commit `25067de772275d2cbd294c927ed2483a0e8d123a` (`feat(inference): add fixed-window overlap reconstruction`) contains 304 authored additions. Native assessment was medium/under_budget, so review remains pending in the feature slice.

## Next step

Commit this tracker evidence and assess the resulting slice before P7A-02.
