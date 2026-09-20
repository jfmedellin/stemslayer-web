# Stemslayer Web (static, in-browser) — phase 1: plan and validation

## Objective
Decide, with evidence and without writing product code, whether a free, static, in-browser version of Stemslayer is worth building, and leave a phase-2 implementation plan ready to authorize.

## Problem / why
The desktop app requires downloading a PyInstaller bundle and a Windows machine. A web version removes that barrier, but a hosted version costs GPU, storage and a domain, which is not justified for a hobby project against Moises/LALAL.AI. The zero-cost path is a static site (GitHub Pages) running Demucs inside the browser via WebAssembly/WebGPU. Everything the desktop app ships today is htdemucs, htdemucs_6s and the deterministic `split_center_sides` splitter (`REGISTERED_SPECIALISTS` is empty), and both models are already ported by demucs.cpp, so there is no model-porting blocker.

## Scope (authorized, phase 1)
- Validation spikes and decision records only. Deliverables are this document, decision notes under `docs/decisions/` if they grow past a paragraph, and the phase-2 task list.
- No product code, no new repository, no scaffolding, no prototypes in phase 1.

## Out of scope
- Any hosted/server variant (GPU workers, uploads, accounts). Decided against on 2026-09-19.
- Guitar/role specialist models: none is admitted today; a web port is not planned.

## Product decisions
- 2026-09-20 — Positioning: instrumental/rock focus (vocals, drums, bass, guitars). The web app ships both desktop profiles: "Basic" (Legacy, htdemucs, 4 stems) and "Rock" (Metal Stereo, htdemucs_6s + deterministic guitar centre/sides split). Rock is the default; Basic is the low-friction option. Profile choice is presented in user language, never by model name. Model weights download lazily per profile on first use and are cached in the browser. Metal Roles stays disabled, as on desktop.
- 2026-09-20 — Source input accepts one file at a time, as on desktop (extra dropped files are ignored). Decided by the user; closes question 3 of `docs/decisions/feature-parity.md`. Questions 1, 2, 4, 5 and 6 there are technical and get resolved in T5/T6 with the recommended answers: Web Locks for identity claims, `Worker.terminate()` plus a `beforeunload` warning, one `AudioWorklet` mixing all lanes with a shared cursor, `navigator.storage.estimate()` before accepting a job, and a single store keyed by `(source_hash, pipeline_fingerprint)`.
- 2026-09-20 — Visual design: the Stitch project "Kanagawa Audio Stem Demixer" (`projects/16027644409535149502`) supplies the design system (Dragon Atelier: warm dark surfaces, moss/gold/rust accents, Geist + JetBrains Mono, 4px radii, tonal elevation). Its screens are not the interaction reference: they carry a 2/4/6-stem selector, fake DAW telemetry, extra mixer and export features and cloud targets that contradict the decisions above. Screens get rebuilt from the parity table after T3 and T5 close. Recorded in `docs/decisions/design-reference.md`.
- 2026-09-20 — Weights delivery: (a2) chosen. The web app fetches the model weights at runtime from a third-party Hugging Face mirror, pinned to a revision, verified by content hash, cached in the browser. The repository never hosts or redistributes weights. Consequences: the inference runtime follows the mirror's format (ONNX mirrors imply ONNX Runtime Web rather than demucs.cpp), so T3's spike S2 becomes mandatory and a mirror survey is added as T3b. The scientific-use restriction on the weights stays recorded as an accepted risk for a free, non-commercial project (see `docs/decisions/licenses.md`).
- Modifying the desktop app. It keeps working as is; the web app is a rewrite that reuses the desktop design and `Tests/Portable` as its specification, not its Python code.

## Constraints
- Artifacts in English. Conventional Commits, no AI attribution lines.
- TDD: n/a in phase 1 (no code). Runner for phase 2 to be decided in T6.
- RDD: off (default). Delivery: `single-pr` (docs only, forecast ~200 authored changed lines).
- Phase 1 lives on `master` of this repository (docs only); phase 2 tasks branch per work unit.
- Phase 1 must end with an explicit go/no-go from the user before any phase-2 task is authorized.

## Tasks
- [x] T1 — Timing spike (user-run). Separate 2–3 songs (one ~3 min, one ~7 min) on freemusicdemixer.com in the user's usual browser; record duration per song, model used (4-stem vs 6-stem), browser, CPU, whether WebGPU was active, and peak memory if visible. The user states the wait they consider acceptable for a product. This is the go/no-go input for everything below.
  - Route: inline (no code; the user reports, the parent records). Checks: numbers recorded here with date and machine.
  - Done 2026-09-20: one ~5 min song, 6-stem model, freemusicdemixer.com, under 4 minutes (about 0.8x real time). Machine: AMD Ryzen 7 5800X (8 cores / 16 threads), Microsoft Edge, WebGPU reported active by the browser. Acceptable wait stated by the user: this speed is fine. Not established: whether the site used WebGPU or multithreaded WASM; peak memory. Those feed spikes S1/S2, not this task.
- [x] T2 — License audit. For demucs.cpp, sevagh/free-music-demixer, timcsy/demucs-web, bengfarrell/demucs-wasm, the Demucs weights (htdemucs, htdemucs_6s) and any ONNX/WASM runtime considered: record license, whether code reuse, weight redistribution and static hosting are permitted, and attribution obligations. Output: a table in this document distinguishing "may reuse code" from "idea only".
  - Route: delegated research worker (read-only, primary sources: the repositories' LICENSE files). Checks: every row cites the LICENSE URL.
  - Done 2026-09-20: `docs/decisions/licenses.md`. Code layer clear (MIT/BSD/MPL 2.0 everywhere). **Blocker found:** the Demucs weights (htdemucs, htdemucs_6s) are not MIT; the maintainer states in `facebookresearch/demucs#327` that they are for scientific purposes only, and MusDB adds a research-only restriction. Verified by hand in the issue thread. Serving the weights from GitHub Pages is redistribution without a grant. Decision needed from the user before phase 2 (see Progress).
- [x] T3 — Inference runtime decision. Compare demucs.cpp/WASM (CPU, multithreaded, mature), WebGPU ports (faster, uneven browser support) and ONNX-in-browser on: speed from T1, browser coverage, memory ceiling, weight loading/caching (81 MB + 53 MB), maintenance risk. Recommend a baseline plus optional progressive path. Include the GitHub Pages gotcha: multithreaded WASM needs `SharedArrayBuffer`, which needs COOP/COEP headers that Pages cannot set; verify whether a service-worker shim (coi-serviceworker pattern) is viable or whether single-threaded WASM is the real baseline.
  - Route: delegated research worker. Checks: decision record with tradeoffs and sources; the COOP/COEP question answered with evidence.
  - Done 2026-09-20: `docs/decisions/inference-runtime.md`. Baseline demucs.cpp WASM, single-threaded by default, `coi-serviceworker` as opportunistic multithreading; progressive path ONNX Runtime Web with WebGPU provider after an export spike; hand-written WebGPU ports rejected (all wrap ORT Web). COOP/COEP answered: Pages cannot set headers, the service-worker shim works with a first-load reload but its Safari/iframe/private-mode behaviour is unverified, so spike S1 is attached to phase 2. Conditional on the weights decision from T2.
- [x] T4 — Feature parity inventory. Map every desktop behavior to its web equivalent or mark it dropped: Split view (drag-and-drop, profile pick, channels), library/history (catalog by source SHA-256, filters, detail column), mixer (lanes, mute/solo, per-lane and master gain, loop, skip 10 s, spacebar), export, cache reuse by content hash, job cancel. Explicitly dropped: single-instance lock, Win32 job containment, CUDA path, PyInstaller self-test. Source of truth: `Tests/Portable/*` and `SeparationWorker/engine/*` in the desktop repository (`../separador-pistas`).
  - Route: delegated mapper (reads 4+ files). Checks: table with one row per behavior and the test file that specifies it.
  - Done 2026-09-20: `docs/decisions/feature-parity.md` (table per area, every portable test file mapped, six open product/design questions in section 3). Key finding, verified in `gui.py:776-786`: the hero Split controls are hidden on purpose; the live flow is drop/browse -> profile dialog -> library row with progress and cancel.
- [x] T3b — Weight mirror survey. For htdemucs and htdemucs_6s on Hugging Face: list mirrors that publish a browser-usable format (ONNX, ORT, ggml), with repository, revision, file names and sizes, declared license, opset/export notes, whether the 6-stem model is included, and the last update. Recommend one mirror per model and the runtime it implies; confirm CORS on the exact `resolve` URLs.
  - Route: delegated research worker (read-only). Checks: every row cites the repository URL; CORS confirmed with a ranged GET carrying an `Origin` header.
  - Done 2026-09-20: `docs/decisions/weight-mirrors.md`. Picks: `Ghilda/htdemucs-onnx` (4 stems) and `kramp/htdemucs-6s-webgpu-onnx` (6 stems, fallback `StemSplitio/htdemucs-6s-onnx`); author-published safetensors (`adefossez/HTDemucs*`) as numeric ground truth. CORS confirmed on all. **Amends T3:** baseline is now ONNX Runtime Web (WebGPU provider, WASM fallback); demucs.cpp demoted to an alternative pending a conversion spike. The mirrors' "MIT" tags are self-reported and contradicted by T2; the accepted-risk decision is unchanged.
- [ ] T5 — Browser storage and memory design. IndexedDB schema mirroring `history.py` (tracks, stems as Blobs, profile fingerprint in the cache key as `stem_cache.cache_key` does), quota strategy and eviction (the `sweep_orphans` equivalent), stem format (WAV vs Float32 planar), chunked inference for long songs, WASM memory ceiling, and what happens on quota errors. Output: design note.
  - Route: delegated writer of one design note (reads `history.py`, `stem_cache.py`, `publication.py`). Checks: every desktop persistence rule has a web counterpart or an explicit drop.
- [ ] T6 — Architecture and repository decision. Decided 2026-09-19: a separate repository (different stack, CI target and release cadence; no shared runtime code). Repository `stemslayer-web` created locally on 2026-09-19 and this document moved here. Remaining: layout, toolchain (Vite + TypeScript is the working assumption), Web Worker for inference, Web Audio graph for the mixer (one source + gain node per lane, master gain, loop), `OfflineAudioContext` export, test runner, CI to GitHub Pages. Output: decision record.
  - Route: inline after T3–T5 (decision, not exploration). Checks: user confirms repository name and toolchain.
- [ ] T7 — Phase-2 task list. Ordered implementation tasks sized by the ~400 authored-line planning heuristic, each with its checks, to be authorized separately after the go/no-go.
  - Route: inline. Checks: user reviews and authorizes or stops.

## Acceptance criteria (phase 1)
- T1 numbers recorded and a stated acceptable wait.
- License table with sources; nothing planned for reuse under an incompatible license.
- Runtime decision with the COOP/COEP question closed.
- Parity inventory and storage design cover every desktop behavior (kept or dropped, no gaps).
- Explicit user go/no-go recorded below before phase 2.

## Progress / evidence
- 2026-09-19 — feature document created in the desktop repository, then moved here when `stemslayer-web` was created. Separate-repository decision recorded in T6.
- 2026-09-20 — Design reference reviewed and recorded (`docs/decisions/design-reference.md`): design system adopted, screens rejected as-is, seven deviations listed, two elements parked on T3/T5.
- 2026-09-20 — T2 done. **Open decision (blocks the go/no-go):** the Demucs weights carry a scientific-use-only restriction. Options: (a) accept the risk for a free non-commercial hobby site that fetches the weights at runtime from Meta's host and never redistributes them, pending a CORS check on `dl.fbaipublicfiles.com`; (b) replace the models with weights that carry a clear redistribution grant, which changes the parity promise (no htdemucs_6s guitar lanes); (c) stop the web project. Not decided.
- 2026-09-20 — T3 done. Two phase-2 spikes recorded (S1 cross-origin isolation on Pages, S2 ONNX export timing).
- 2026-09-20 — Weights decision, part 1 (user): the web app stays free and non-commercial; the user accepts the scientific-use restriction as a recorded risk rather than stopping or swapping models. CORS check on `dl.fbaipublicfiles.com` (both `.th` files, ranged GET with `Origin`, and OPTIONS preflight): no `Access-Control-Allow-Origin`, preflight 403. A browser on GitHub Pages cannot fetch the weights from Meta's host, so runtime fetch from the original host is not viable. Hugging Face Hub does send `Access-Control-Allow-Origin` and hosts many third-party htdemucs mirrors (ONNX/ORT conversions, including htdemucs_6s). Part 2, how the weights reach the browser, pending user choice: (a1) user supplies the weight file by drag-and-drop, app converts and caches; (a2) runtime fetch from a pinned Hugging Face mirror, hash-verified and cached; (a3) host in this repository (redistribution, not recommended).
- 2026-09-20 — T3b done; T3 amended to ONNX Runtime Web as baseline. Spike S2 rescoped (timing on both providers, numeric diff against the author's safetensors, peak memory).
- 2026-09-20 — T1 closed: AMD Ryzen 7 5800X, Microsoft Edge, WebGPU reported active. Whether the site actually used WebGPU or multithreaded WASM is still not established; it is a caveat on the timing promise, resolved by spikes S1/S2.
- 2026-09-20 — T1 partial (user-reported): a ~5 min song separated on freemusicdemixer.com with the 6-stem model in under 4 minutes (about 0.8x real time). User judges this fast enough. Still missing: browser, CPU, whether WebGPU was active, peak memory. T1 stays open until the WebGPU question is answered, since it feeds T3.

## Next step
User decides the weights question (T2, Progress). If the project continues: close T1 (browser, CPU, isolation/WebGPU state), then T5 (storage and memory design), T6, T7. After T5 closes, redraw the Stitch screens from the parity table and `docs/decisions/design-reference.md` section 3.
