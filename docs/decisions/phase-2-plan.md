# Phase-2 task list (T7)

Date: 2026-09-20. Status: proposed; nothing here is authorized until the user's go/no-go recorded in the phase-1 feature document.

Sizing uses the ~400 authored-changed-lines planning heuristic (additions plus deletions, generated files excluded) per task, tests and docs included. Every task closes with at least one Conventional Commit on its own branch, and each task becomes its own pull request; the chain strategy is chosen once at the start of phase 2 (`ask-on-risk` default). Each task gets its own ODD feature document when it starts; this list is the backlog, not the tracker.

Dependencies: P0 before anything that touches inference; P1 before everything else; P2 → P3 → P4/P5/P6 (parallelizable) → P7 → P8 → P9 → P10 → P11.

## P0 — Spikes (throwaway code, not merged)

| ID | Task | Checks | Size |
|---|---|---|---|
| S2 | Load `Ghilda/htdemucs-onnx` and `kramp/htdemucs-6s-webgpu-onnx` in `onnxruntime-web` on the WebGPU and WASM providers. Confirm input/output shapes of both graphs. Time one 5-minute song per model per provider on the reference machine (Ryzen 7 5800X, Edge). Diff the stems against a Python reference built from `adefossez/HTDemucs*` safetensors (max abs error, SNR per stem). Record peak JS heap and GPU memory. | Table of timings and errors in `docs/decisions/spike-s2.md`; go/no-go on the runtime and on whether both exports keep their current pipeline shape or one is re-exported. | ~150 lines of throwaway code, one note |
| S1 | Deploy a hello-world page with `coi-serviceworker` to GitHub Pages; check `crossOriginIsolated` and a `SharedArrayBuffer` allocation in Chrome, Edge, Firefox and Safari, desktop and mobile, normal and private mode. | Matrix in `docs/decisions/spike-s1.md`; decides whether multithreaded WASM is offered as an opportunistic upgrade. Optional if S2 shows WebGPU alone meets the bar on the reference machine. | ~50 lines, one note |

## P1 — Scaffold

| ID | Task | Checks | Size |
|---|---|---|---|
| P1 | Vite + React + TypeScript strict; Vitest (Node) and Vitest browser mode (Playwright, Chromium); ESLint with import-boundary rules enforcing `domain → application → infrastructure/ui`; Dragon Atelier tokens as CSS custom properties; GitHub Actions workflow (typecheck, unit, browser tests, build, deploy to Pages from `main`); README with the accepted-risk statement about model weights and the third-party notices (onnxruntime MIT, Demucs MIT code, mirror attributions). | `npm run typecheck`, `npm test`, `npm run test:browser`, `npm run build` green in CI; a deployed empty shell on Pages. | ~350 |

## P2 — Domain

| ID | Task | Checks | Size |
|---|---|---|---|
| P2a | Profiles (Basic, Rock) and pipeline fingerprint: canonical JSON over the desktop field set, SHA-256 through a `HashPort`. Track entity and the six-state status machine with allowed transitions. | TDD. Tests translated from `test_stem_profile.py` and the status parts of `test_history.py`. | ~300 |
| P2b | Identity-claim rules: displacement ordering (`ready > processing > preparing > else`, then newest), adopt-and-retry for failed/interrupted owners, ready-reuse, different-pipeline-is-not-a-duplicate. Pure functions over an in-memory catalog snapshot. | TDD. Tests translated from `test_history.py` claim/duplicate/retry cases. | ~350 |

## P3 — Application

| ID | Task | Checks | Size |
|---|---|---|---|
| P3a | Ports (`CatalogPort`, `StemStorePort`, `ModelStorePort`, `InferencePort`, `AudioEnginePort`, `QuotaPort`, `LockPort`, `HashPort`) and in-memory fakes. Use cases: add-to-library (hash, claim under lock, quota pre-flight), remove (refused while running), retry. | TDD against fakes. Concurrency test: two simultaneous identical adds run one separation. | ~400 |
| P3b | Use cases: separate (model ensure → inference → publish all-or-nothing → `ready`), cancel (queued removal vs running terminate, lands on `interrupted`), startup sweeps (`recover_unfinished`, `validate_ready`, referential orphan sweep). | TDD. Tests translated from `test_history.py` cancel/crash/partial-artifact cases and `test_job_manager.py` queue cases. | ~400 |

## P4–P6 — Infrastructure adapters (parallelizable)

| ID | Task | Checks | Size |
|---|---|---|---|
| P4 | IndexedDB `CatalogPort` (`tracks` store, `by_identity` unique compound index, `by_createdAt`), Web Locks `LockPort`, Web Crypto `HashPort`. | Browser tests: schema creation, unique-index collision, lock serialization across two workers, SHA-256 against a known vector. | ~350 |
| P5 | OPFS `StemStorePort`: float32 WAV encoder byte-identical to `engine/wav.py`, per-lane files, referential sweep, `QuotaPort` over `navigator.storage.estimate()`/`persist()`, `QuotaExceededError` mapping. | Browser tests: WAV header golden bytes, write/read round trip, orphan removal, quota error surfaces as `failed` with the decided message. | ~350 |
| P6 | Cache API `ModelStorePort`: streamed fetch with byte progress, revision-named caches, SHA-256 verification before first use, fail-closed on mismatch, atomic switch on revision change. Manifest pinning mirror commit SHAs and file digests. | Browser tests with a mocked fetch: progress events, mismatch deletes the entry, old cache survives a failed re-fetch. | ~300 |

## P7 — Inference (after S2)

| ID | Task | Checks | Size |
|---|---|---|---|
| P7a | Windowing: fixed-length windows with 25 % overlap and linear cross-fade over planar Float32; STFT/iSTFT in JS only if S2 keeps the 4-stem export's external-STFT shape. | Unit tests: reconstruction of a known signal through window/overlap-add is identity within tolerance; STFT round trip if present. | ~300 |
| P7b | `InferencePort` Worker: onnxruntime-web session with WebGPU provider and WASM fallback, model bytes from `ModelStorePort`, window loop, per-window progress, stem writes through `StemStorePort`, `terminate()` handling and the interrupted path. | Browser test on a 10-second fixture: produces N lanes, progress monotonic, terminate leaves no `ready` row. Manual check on the reference song against S2's numbers. | ~400 (may exceed; split the Worker protocol out if so) |

## P8 — UI: shell, upload, library

| ID | Task | Checks | Size |
|---|---|---|---|
| P8a | App shell with the three destinations; upload page: single-file drop zone and browse, file card (name, format, duration, size), profile cards Basic/Rock (Rock default), quota and model-cache readout, primary action. Atoms and molecules from the token set. | Component tests; browser test drops a file and reaches the profile choice; extra dropped files ignored. | ~400 |
| P8b | Library page: dense list, status per row (preparing/processing with model-download percentage, ready, failed with retry, interrupted, unavailable), search, three sorts, cancel with confirm, remove with guard, open in mixer. | Component tests translated from `test_gui_library_rows.py` and `test_gui_view_state.py` where they describe visible behaviour. | ~400 |

## P9 — Mixer

| ID | Task | Checks | Size |
|---|---|---|---|
| P9a | Mixer domain and `AudioEnginePort`: lane gains, mute/solo resolution, master gain, loop range, shared cursor, skip 10 s. `AudioWorklet` adapter mixing all lanes. | TDD for the domain (translated from `test_mixer_controller.py`); browser test renders a known mix through an `OfflineAudioContext` and checks samples. | ~400 |
| P9b | Mixer UI: lanes with stem ribbon, waveform, mute/solo pills, fader; transport bar with play/pause, loop, skip, time readout in mono; spacebar. | Component tests for controls; keyboard shortcut test. | ~400 |

## P10 — Export and storage messaging

| ID | Task | Checks | Size |
|---|---|---|---|
| P10 | Export page: stem checklist with sizes, per-stem WAV download and zip-all (client-side zip, store-only). Storage notices: quota warning on the drop zone, Safari seven-day notice, eviction result copy on `unavailable` rows. | Browser test downloads a stem and compares bytes with the stored file; zip test opens with a standard reader. | ~300 |

## P11 — Design pass and release

| ID | Task | Checks | Size |
|---|---|---|---|
| P11 | Redraw the Stitch screens from the parity table and `design-reference.md` section 3 (can run before P8 as a design activity, it is listed here as the polish gate); apply to the React pages; accessibility pass (focus order, contrast on the dark palette, reduced motion); README usage section. | Manual review against the Stitch screens; axe run clean; Lighthouse accessibility ≥ 90. | ~300 |

## Forecast

Roughly 5,900 authored changed lines across 15 merged tasks plus two throwaway spikes. Delivery follows the chain strategy chosen at phase-2 start; each task is one reviewable pull request.
