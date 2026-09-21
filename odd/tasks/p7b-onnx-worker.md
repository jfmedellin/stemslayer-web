# P7b — ONNX Worker: session, provider selection, windowed inference, cancellation

Status: opened 2026-09-21. Delivery strategy: `ask-on-risk`; chain strategy: `feature-branch-chain` (continuing P7a's convention). Developed locally on `feat/p7a-windowing` (has P5, P6 and P7a); publication base decided at closure, same reasoning as P7a (branch directly off whichever of P4/P5/P6/P7a this code actually imports from).

## Objective

Implement `InferencePort` for real: a dedicated Worker hosting `onnxruntime-web`, selecting the WebGPU execution provider with a WASM fallback, running the fixed-window inference loop from P7a over model bytes obtained from `ModelStorePort` (P6), and writing each stem lane through `StemStorePort` (P5). `terminate()` cancels cleanly with no partial `ready` row.

## Problem / why

Every earlier phase built the pieces this needs: P5 stores stems, P6 caches verified model weights, P7a provides deterministic windowing and the Basic-only spectral transform. Nothing yet runs the actual neural network. P7b is the phase that makes separation real, matching spike S2's proven runtime choice (`docs/decisions/spike-s2.md`: ONNX Runtime Web, WebGPU first, WASM fallback, ~10x realtime on the reference machine) and the two pinned exports (`docs/decisions/weight-mirrors.md`: `Ghilda/htdemucs-onnx` for Basic, `kramp/htdemucs-6s-webgpu-onnx` for Rock).

## Scope

- Add `onnxruntime-web` (pin `1.30.0`, the version S2 validated) as a real npm dependency, bundled through Vite — not a CDN import, unlike the S2 spike.
- Worker message protocol as pure TS types shared by both sides: job envelope (trackId, profile, resultKey, source bytes), progress messages (window/totalWindows), a result message (written lane keys), an error message, and a cancel message.
- `OnnxSessionManager`: creates an `ort.InferenceSession` from model bytes with the WebGPU execution provider, falling back to WASM on session-creation failure (matching S2's finding that `htdemucs.onnx`'s un-folded `ConstantOfShape` nodes ran fine on WebGPU in Chromium, but the fallback path must still exist for browsers without WebGPU).
- Two `PlanarWindowProcessor` implementations (P7a's callback shape) that each session type plugs into `processPlanarWindows`:
  - Rock: single `mix` input, single `stems` output, both `[1, 2|6, samples]`-shaped — self-contained, no external DSP.
  - Basic: `buildCacInput` (P7a) before the session call, `mix`+`mag` inputs, `freq`+`time` outputs, `decodeCacOutputToWaveforms` + `combineFrequencyAndTimeBranches` (P7a) after.
- `OnnxWorkerInference` implementing `InferencePort`: spawns the Worker, calls `ModelStorePort.ensure()` for the job's profile, sends the job, relays progress, on completion writes each stem lane through `StemStorePort.writeLane` (P5's float32 WAV codec) and resolves with the written lane keys; `terminate()` calls `Worker.terminate()` and rejects the pending result with `InferenceCancelled`, per the existing `InferencePort` contract.
- **Test fixture strategy (technical decision, not a product one):** the real pinned models are 174–285 MB and cannot be part of an automated test suite. Automated browser tests exercise the Worker's own logic — session creation, provider fallback, message protocol, progress, cancellation, `StemStorePort` writes — against **synthetic ONNX models** with the real production I/O shapes (`mix [1,2,343980]`, Rock's `stems [1,6,2,343980]`, Basic's `mag [1,4,2048,336]` / `freq [1,4,4,2048,336]` / `time [1,4,2,343980]`) but near-zero weights (a single deterministic op, e.g. scale-by-constant), so runtime behaviour is exercised end-to-end while the fixture stays small enough to commit. Generate them once, read-only, with Python's `onnx` package (same pattern as the P7a golden fixtures) and record the exact script. Numerical fidelity against the real pinned models and the S2 reference numbers is a **manual** verification step at closure (P7B-06), matching `docs/decisions/phase-2-plan.md`'s own note for this row ("Manual check on the reference song against S2's numbers") — never an automated CI assertion.

## Out of scope

- The mixer's audio decoding into `AudioBuffer` and playback (P9).
- UI (P8): progress rendering, upload flow.
- Quota pre-flight before starting a job (already P3a's `addToLibrary`); this phase only runs once a job exists.
- Changing P5/P6/P7a code except to import from it; report anything that looks wrong instead of patching around it.
- Cross-origin isolation / multithreaded WASM (spike S1 territory); this phase runs WASM single-threaded, matching the S2 baseline.

## Constraints and decisions

- Artifacts in English. Conventional Commits, scope `inference` or `infrastructure` matching the touched layer, no AI attribution lines. One commit per task with its tests and the tracker update, matching P7a's established rhythm (source+test commit, then a separate `docs(odd)` tracker commit).
- TDD: strict, on. Runner: `npm test` for pure-TS protocol/session-selection logic where it can be isolated from the Worker boundary; `npm run test:browser` for anything touching a real Worker, `onnxruntime-web`, or `StemStorePort`/`ModelStorePort` adapters. Observed RED before every implementation, recorded per task exactly as P7a's entries.
- Layering: `src/infrastructure/onnx-worker/` implements `InferencePort` and imports `domain`/`application` types plus its own P7a modules; never imports `ui`. `npm run lint` enforces it.
- Size heuristic ~400 authored lines per task, advisory; this row was flagged in the plan as likely to exceed ~400 total, hence the six-task split below.
- RDD: the same protocol as P7a — after each commit, `gentle-ai review assess --base-ref <last acknowledged boundary> --committed-only --json`; if `review_due` and a large binary/data fixture risks `lens_context_budget_exceeded` again, keep fixture-heavy commits in their own small slice separated from code-heavy commits, and record the same terminal-limitation note if it recurs rather than retrying indefinitely.
- Checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:browser`, `npm run build`.

## Tasks

- [ ] **P7B-01 — Dependency, protocol types, and synthetic test-fixture models.**
  - Route: delegated direct. Trigger: new dependency, shared protocol types, and binary test fixtures.
  - Add `onnxruntime-web@1.30.0` to `package.json`; confirm it builds through Vite (a worker entry importing it, even a trivial one, must build and the bundle must be servable).
  - Define `WorkerJobMessage`, `WorkerProgressMessage`, `WorkerResultMessage`, `WorkerErrorMessage` (or an equivalent discriminated union) in `src/infrastructure/onnx-worker/protocol.ts`.
  - Generate two synthetic `.onnx` fixtures (Rock-shaped, Basic-shaped) with the real I/O shapes and trivial deterministic weights, via a documented read-only Python snippet; commit them under `tests/infrastructure/onnx-worker/fixtures/`.
  - Checks: `npm run build` succeeds with the new dependency; a browser test loads each synthetic fixture into an `ort.InferenceSession` on the WASM provider and confirms the expected output shape and a known deterministic value.
- [ ] **P7B-02 — `OnnxSessionManager`: provider selection and fallback.**
  - Route: delegated direct. Trigger: new adapter with real WebGPU/WASM branching logic and browser tests.
  - RED/GREEN: session creation prefers WebGPU when `navigator.gpu` is present and session creation succeeds; falls back to WASM on any WebGPU session-creation failure; a typed error when both fail.
  - Checks: browser tests against the P7B-01 fixtures on Chromium (WebGPU may or may not be available in the test browser; assert the fallback path works either way, and assert WebGPU is used when available).
- [ ] **P7B-03 — Rock inference path.**
  - Route: delegated direct. Trigger: new `PlanarWindowProcessor` implementation plus browser tests running real inference on the synthetic fixture.
  - RED/GREEN: a `PlanarWindowProcessor` that runs the Rock-shaped session per window, called through P7a's `processPlanarWindows` end to end on a short synthetic signal, producing the documented deterministic output.
  - Checks: browser test asserts per-window progress is monotonic and the final accumulated output matches the fixture's known deterministic transform.
- [ ] **P7B-04 — Basic inference path.**
  - Route: delegated direct. Trigger: wires three P7a modules (`buildCacInput`, session run, `decodeCacOutputToWaveforms`/`combineFrequencyAndTimeBranches`) together; substantial enough for its own slice.
  - RED/GREEN: a `PlanarWindowProcessor` that builds the CAC input, runs the Basic-shaped session, decodes and combines branches, on the P7B-01 Basic fixture.
  - Checks: browser test on a short synthetic signal, same progress/determinism assertions as P7B-03.
- [ ] **P7B-05 — `OnnxWorkerInference`: the real Worker and `InferencePort` adapter.**
  - Route: delegated direct. Trigger: Worker script, message protocol wiring, `StemStorePort`/`ModelStorePort` integration, and cancellation — the actual browser-boundary adapter.
  - RED/GREEN: end-to-end browser test spawning the real Worker with a synthetic fixture wired in place of a real model (inject via a test-only model-bytes override, not a real 174–285 MB download): job in, progress out, lane keys written to a real `OpfsStemStore`, resolves with the written keys. A second test starts a job and calls `terminate()` before it finishes: the pending result rejects with `InferenceCancelled`, and no lane key was left referenced in the stem store.
  - Checks: matches the phase-2 plan's own row check ("produces N lanes, progress monotonic, terminate leaves no ready row"), against the synthetic fixture rather than the real model.
- [ ] **P7B-06 — Close P7b.**
  - Route: parent-owned commits, assessments, final checks, and Engram mirror update.
  - Evidence: strict-TDD history, exact checks, authored counts, rollback boundaries, commit identities, and native outcomes, matching P7a's closure entry.
  - Document the manual validation procedure against the real pinned models and the reference song (pointing at `spikes/s2/HARNESS.md` as the closest existing harness and naming what changes for the product Worker), and either run it or explicitly flag it as pending for the user's reference machine.

## Acceptance criteria

- [ ] `onnxruntime-web` builds through Vite; a Worker entry point exists and is servable.
- [ ] WebGPU is preferred and WASM is a real, tested fallback.
- [ ] Rock and Basic inference paths each produce correct, deterministic output against their synthetic fixture.
- [ ] The full `InferencePort` contract holds: progress monotonic, lane keys written on success, `InferenceCancelled` on `terminate()`, no partial/orphaned stem data after cancellation.
- [ ] Focused and full checks pass with observed strict-TDD evidence.
- [ ] Manual validation against the real models is documented, and its outcome (run or explicitly deferred) is recorded.

## Forecast and delivery

Forecast: P7B-01 ~150–250 lines (mostly protocol types plus a small fixture-generation script; the fixtures themselves are binary, not authored logic); P7B-02 ~150–250; P7B-03 ~150–250; P7B-04 ~200–300; P7B-05 ~250–400 (the actual Worker, likely the largest slice); P7B-06 closure only. Total likely 900–1450 authored lines across five substantive commits — expect a chained sequence of pull requests at closure, exactly as P7a needed three. The 400-line figure is a per-slice review heuristic, not a target to hit by cutting tests or the Worker protocol's error handling.

## Applicable checks

- P7B-01 focused: `npm run build`; a browser test loading each fixture.
- P7B-02 focused: `npm run test:browser -- src/infrastructure/onnx-worker/onnx-session-manager.browser.test.ts` (or equivalent path chosen by the writer).
- P7B-03/04 focused: their own `*.browser.test.ts` files.
- P7B-05 focused: the end-to-end Worker browser test.
- Closure: `npm test`, `npm run lint`, `npm run typecheck`, `npm run test:browser`, and `npm run build`.
- Review focus: provider fallback correctness, cancellation leaving no partial state, exact adherence to the `InferencePort`/`StemStorePort`/`ModelStorePort` contracts already established, and keeping the synthetic-fixture test strategy honest (never silently asserting against the real models' actual audio quality, which stays a manual check).

## Progress / evidence

- 2026-09-21 — Feature document created on `feat/p7a-windowing` (has P5, P6, P7a locally). Publication base to be decided at closure per P7a's own precedent: branch directly off the earliest ancestor this code actually needs, once real imports are known.

## Next step

P7B-01 by a delegated writer: add the dependency, define the protocol types, and generate the two synthetic ONNX fixtures.
