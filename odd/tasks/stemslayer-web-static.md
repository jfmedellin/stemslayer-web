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
- Modifying the desktop app. It keeps working as is; the web app is a rewrite that reuses the desktop design and `Tests/Portable` as its specification, not its Python code.

## Constraints
- Artifacts in English. Conventional Commits, no AI attribution lines.
- TDD: n/a in phase 1 (no code). Runner for phase 2 to be decided in T6.
- RDD: off (default). Delivery: `single-pr` (docs only, forecast ~200 authored changed lines).
- Phase 1 lives on `master` of this repository (docs only); phase 2 tasks branch per work unit.
- Phase 1 must end with an explicit go/no-go from the user before any phase-2 task is authorized.

## Tasks
- [ ] T1 — Timing spike (user-run). Separate 2–3 songs (one ~3 min, one ~7 min) on freemusicdemixer.com in the user's usual browser; record duration per song, model used (4-stem vs 6-stem), browser, CPU, whether WebGPU was active, and peak memory if visible. The user states the wait they consider acceptable for a product. This is the go/no-go input for everything below.
  - Route: inline (no code; the user reports, the parent records). Checks: numbers recorded here with date and machine.
- [ ] T2 — License audit. For demucs.cpp, sevagh/free-music-demixer, timcsy/demucs-web, bengfarrell/demucs-wasm, the Demucs weights (htdemucs, htdemucs_6s) and any ONNX/WASM runtime considered: record license, whether code reuse, weight redistribution and static hosting are permitted, and attribution obligations. Output: a table in this document distinguishing "may reuse code" from "idea only".
  - Route: delegated research worker (read-only, primary sources: the repositories' LICENSE files). Checks: every row cites the LICENSE URL.
- [ ] T3 — Inference runtime decision. Compare demucs.cpp/WASM (CPU, multithreaded, mature), WebGPU ports (faster, uneven browser support) and ONNX-in-browser on: speed from T1, browser coverage, memory ceiling, weight loading/caching (81 MB + 53 MB), maintenance risk. Recommend a baseline plus optional progressive path. Include the GitHub Pages gotcha: multithreaded WASM needs `SharedArrayBuffer`, which needs COOP/COEP headers that Pages cannot set; verify whether a service-worker shim (coi-serviceworker pattern) is viable or whether single-threaded WASM is the real baseline.
  - Route: delegated research worker. Checks: decision record with tradeoffs and sources; the COOP/COEP question answered with evidence.
- [x] T4 — Feature parity inventory. Map every desktop behavior to its web equivalent or mark it dropped: Split view (drag-and-drop, profile pick, channels), library/history (catalog by source SHA-256, filters, detail column), mixer (lanes, mute/solo, per-lane and master gain, loop, skip 10 s, spacebar), export, cache reuse by content hash, job cancel. Explicitly dropped: single-instance lock, Win32 job containment, CUDA path, PyInstaller self-test. Source of truth: `Tests/Portable/*` and `SeparationWorker/engine/*` in the desktop repository (`../separador-pistas`).
  - Route: delegated mapper (reads 4+ files). Checks: table with one row per behavior and the test file that specifies it.
  - Done 2026-09-20: `docs/decisions/feature-parity.md` (table per area, every portable test file mapped, six open product/design questions in section 3). Key finding, verified in `gui.py:776-786`: the hero Split controls are hidden on purpose; the live flow is drop/browse -> profile dialog -> library row with progress and cancel.
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
- 2026-09-20 — T1 partial (user-reported): a ~5 min song separated on freemusicdemixer.com with the 6-stem model in under 4 minutes (about 0.8x real time). User judges this fast enough. Still missing: browser, CPU, whether WebGPU was active, peak memory. T1 stays open until the WebGPU question is answered, since it feeds T3.

## Next step
Resolve the six open questions in `docs/decisions/feature-parity.md` section 3, then run T2/T3/T5 (research and design notes) and the web design mockups derived from the parity table.
