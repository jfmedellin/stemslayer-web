# P7a — Windowing and Basic spectral processing

Status: P7A-01 reviewed; overlap-proof follow-up pending before spectral work. Delivery strategy: `ask-on-risk`; chain strategy: `feature-branch-chain`.

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
- [x] **P7A-01F — Prove triangular overlap blending independently.**
  - Route: delegated direct follow-up. Trigger: native advisory `R3-001` requires an independent numerical oracle rather than another identity reconstruction.
  - Proof: successive windows return distinct constants; assertions calculate expected overlap samples independently, including a partial final window.
  - This is separate later work and never reopens or reruns the approved P7A-01 candidate.
  - Rollback: the focused proof and its tracker evidence only.
- [x] **P7A-02A — Add radix-2 FFT primitives.**
  - Route: delegated direct. Trigger: numerical kernel plus deterministic round-trip and golden-vector tests.
  - RED: invalid FFT lengths, deterministic complex fixtures, and real FFT round trips.
  - GREEN/REFACTOR: minimal FFT/rFFT/iFFT primitives with internal `Float64Array` precision.
  - Tolerance: round-trip and golden maximum error `<= 1e-6`.
  - Rollback: `fft.ts`, its focused tests, and P7A-02A tracker evidence.
- [x] **P7A-02B — Add Basic STFT and CAC processing.**
  - Route: delegated direct. Trigger: STFT/iSTFT, CAC, Demucs padding, and golden parity tests span multiple non-trivial files.
  - RED: STFT round trips, S2 golden bins, Nyquist handling, CAC layout, padding/frame count, and branch reconstruction.
  - GREEN/REFACTOR: Basic-only spectral adapters over P7A-02A; no Worker/ONNX behavior.
  - Tolerance: round-trip and golden maximum error `<= 1e-6`.
  - Rollback: `stft.ts`, its focused tests, and P7A-02B tracker evidence; windowing and FFT remain.
- [ ] **P7A-03 — Close P7a.**
  - Route: parent-owned commits, assessments, final checks, and Engram mirror update.
  - Evidence: strict-TDD history, exact checks, authored counts, rollback boundaries, commit identities, and native outcomes.

## Acceptance criteria

- [x] Window offsets and progress are deterministic and strictly ordered.
- [x] Short, exact, overlapping, and partial-final inputs reconstruct with maximum error `<= 1e-6`.
- [x] Frame count and channel alignment are preserved; invalid shapes fail closed.
- [x] Full triangular weighting and accumulated normalization match S2 behavior.
- [x] FFT and STFT/iSTFT round trips satisfy `<= 1e-6`. (FFT/iFFT closed by P7A-02A; centered/normalized STFT/iSTFT round trip and golden bins closed by P7A-02B.)
- [x] Basic CAC layout, Nyquist behavior, Demucs padding, and branch reconstruction match S2 evidence.
- [ ] Rock remains waveform-only and does not depend on Basic spectral code.
- [ ] Focused and full checks pass with observed strict-TDD evidence.

## Forecast and delivery

Forecast: P7A-01 approximately 300–420 authored lines; P7A-01F is a small proof follow-up; P7A-02A and P7A-02B split the original 450–650-line spectral estimate into honest FFT and STFT/CAC slices. The 400-line value remains a review heuristic and will not be met by deleting tests, documentation, or clarity.

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
- 2026-09-21 — Tracker commit `968d58f` brought the combined candidate to 407 authored lines. Native lineage `review-fc873875ea898c02` approved and acknowledged the candidate; advisory `R3-001` requested a separate later proof that distinct per-window outputs blend with the exact triangular weights.
- 2026-09-21 — P7A-01F verification-only follow-up: added an independent numerical oracle that never calls production weight helpers, feeds constants `1`, `2`, and `3` from successive windows, and checks representative samples in both the full-window overlap and the seven-sample partial-final overlap. The focused suite passed immediately (1 file / 17 tests), so production code was unchanged and no RED was fabricated. Runtime harness remains N/A for this pure deterministic proof. Rollback: remove this focused test and P7A-01F evidence only; approved P7A-01 remains intact.

- 2026-09-21 — P7A-02A strict-TDD RED: `npm test -- --run tests/infrastructure/onnx-worker/fft.test.ts` failed before source implementation because `src/infrastructure/onnx-worker/fft` did not exist (0 tests collected, import error).
- 2026-09-21 — P7A-02A GREEN: the same focused command passed 1 file / 23 tests. Implemented `transformInPlace` (in-place radix-2 iterative Cooley-Tukey FFT/iFFT with bit-reversal permutation and `1/length` inverse normalization), `forwardFft`/`inverseFft` wrappers, and `realForwardFft`/`realInverseFft` (non-redundant `[0, length/2]` bin real transform with conjugate-mirror reconstruction), all restricted to power-of-two lengths and computed in `Float64Array` precision. Tests include invalid-length/invalid-bin RED cases, deterministic complex fixtures checked against an independent O(n^2) direct-DFT oracle (not the FFT itself), complex and real round trips at multiple power-of-two lengths (including 4096), and a DC/Nyquist real-bin check.
- 2026-09-21 — P7A-02A REFACTOR: extracted `assertPowerOfTwoLength`, `assertRealTransformLength`, and `bitReversalPermute` helpers; no behavior change. `npm run typecheck` and `npm run lint` passed. Runtime harness: N/A — pure deterministic DSP, no browser/Worker/ONNX boundary.
- 2026-09-21 — P7A-02A verification: focused 1 file / 23 tests; full Node suite 21 files / 223 tests; `npm run typecheck`, `npm run lint`, and `npm run build` passed.
- 2026-09-21 — P7A-02A rollback boundary: remove `src/infrastructure/onnx-worker/fft.ts`, `tests/infrastructure/onnx-worker/fft.test.ts`, and this P7A-02A tracker evidence; P7A-01/P7A-01F remain intact and P7A-02B stays absent.
- 2026-09-21 — P7A-02A source/test commit `fa06725` (`feat(inference): add radix-2 FFT primitives`) contains 323 authored insertions (2 files: `src/infrastructure/onnx-worker/fft.ts`, `tests/infrastructure/onnx-worker/fft.test.ts`).

- 2026-09-21 — P7A-02B strict-TDD RED: `npm test -- --run tests/infrastructure/onnx-worker/stft.test.ts` failed before source implementation because `src/infrastructure/onnx-worker/stft` did not exist (0 tests collected, import error).
- 2026-09-21 — P7A-02B golden vectors: `spikes/s2/reference/stft_fixture.json` and `spikes/s2/generate_stft_fixture.py`'s output are not retrievable from `spike/s2-onnx-runtime` (gitignored on that branch). Read `spikes/s2/generate_stft_fixture.py` and `spikes/s2/compare_onnx.py` (`demucs_spec`/`demucs_ispec`) from that branch and re-ran their exact numpy method, read-only, against `D:\cursos\separador-pistas\.venv\Scripts\python.exe` (numpy 2.5.2 available; no torch needed for this method). Produced two independent golden fixtures: `tests/infrastructure/onnx-worker/fixtures/stft-golden.json` (raw centered/normalized STFT frame0/frame1 bins, signal trimmed to 4096 samples — verified bit-for-bit identical to the untrimmed 44100-sample signal's frame0/frame1 before trimming, since STFT frames only depend on samples up to their own window) and `fixtures/demucs-spec-golden.json` (HTDemucs `_spec`/`_ispec` bins and identity-mask reconstruction for a 5000-sample signal, ported line-for-line from `compare_onnx.py`).
- 2026-09-21 — Product/numerical finding recorded before GREEN: `demucs_spec`/`demucs_ispec` (HTDemucs' own spectral pre/post-processing) is not a lossless round trip by construction — it drops the Nyquist bin and trims to the middle `ceil(N/hop)` STFT frames, which the model's learned mask is trained to compensate for. Verified this against the S2 reference implementation itself (`spikes/s2/dsp/stft.js`, unmodified) at the real model segment length (343980 samples): self round-trip max abs error is `~0.349`, not `<=1e-6`. This is expected S2 behavior, not a port bug, so `demucsForwardSpec`/`demucsInverseSpec` are verified against the independent Python golden values (a value-parity golden, like the raw STFT bins), not an identity-mask round-trip-to-original-signal property; the raw `centeredNormalizedStft`/`centeredNormalizedIstft` (matching plain `torch.stft`/`torch.istft`, which S2's README does document as round-tripping to `~1.19e-6`) still satisfies the `<=1e-6` round-trip criterion directly. No open question — resolved by re-reading the S2 README and reference code before GREEN, no product decision was needed.
- 2026-09-21 — P7A-02B GREEN: the same focused command passed 1 file / 14 tests. Implemented `centeredNormalizedStft`/`centeredNormalizedIstft` (torch.stft/torch.istft-equivalent: reflect-pad by `n_fft/2`, periodic Hann window, `normalized=True` scaling, Hann-weighted overlap-add with `wsum` normalization), `demucsForwardSpec`/`demucsInverseSpec` (HTDemucs `_spec`/`_ispec`: `hop//2*3=1536` context padding, Nyquist-bin drop, middle `ceil(N/hop)`-frame trim, symmetric zero-padding on inverse), `buildCacInput`/`decodeCacOutputToWaveforms` (flat row-major `[4, 2048, frames]` CAC layout, `[L.real, L.imag, R.real, R.imag]`), and `combineFrequencyAndTimeBranches` (pure elementwise sum). Tests cover: raw STFT round trip and independent numpy golden bins; invalid reflect-pad and invalid-bin-count RED cases; Nyquist-bin drop and `ceil(N/hop)=336`-frame count at the real model segment length; the independent Python `demucs_spec`/`demucs_ispec` golden bins and identity-mask reconstruction; CAC layout ordering, a mismatched-frame-count rejection, and CAC encode/decode value preservation; and branch-combination unit and golden-integration tests. No Worker/ONNX/session code was added.
- 2026-09-21 — P7A-02B REFACTOR: no structural changes were needed; `npm run typecheck`, `npm run lint`, and `git diff --check` passed on the first pass. Runtime harness: N/A — pure deterministic DSP, no browser/Worker/ONNX boundary.
- 2026-09-21 — P7A-02B verification: focused 1 file / 14 tests; full Node suite 22 files / 237 tests; `npm run typecheck`, `npm run lint`, and `npm run build` passed.
- 2026-09-21 — P7A-02B rollback boundary: remove `src/infrastructure/onnx-worker/stft.ts`, `tests/infrastructure/onnx-worker/stft.test.ts`, `tests/infrastructure/onnx-worker/fixtures/stft-golden.json`, `tests/infrastructure/onnx-worker/fixtures/demucs-spec-golden.json`, and this P7A-02B tracker evidence; windowing and FFT (P7A-01/P7A-01F/P7A-02A) remain intact.
- 2026-09-21 — P7A-02B source/test commit `12f6978` (`feat(inference): add Basic STFT and CAC processing`) contains 574 authored lines across `src/infrastructure/onnx-worker/stft.ts` (326) and `tests/infrastructure/onnx-worker/stft.test.ts` (248), plus two golden-fixture JSON data files (not authored logic).

## Next step

Assess the P7A-02A and P7A-02B candidates under the user-owned RDD switch (native review remains opt-in and was not invoked by this writer), then execute P7A-03 (parent-owned close: final commits, assessments, and Engram mirror update).
