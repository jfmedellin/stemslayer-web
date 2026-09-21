# P3b — Separation lifecycle: separate, cancel, startup sweeps

Status: opened 2026-09-21. Delivery strategy: `ask-on-risk`; chain strategy: `stacked-to-main` (branch `feat/p3b-separation-lifecycle` stacked on `feat/p3a-application-ports`, PR #10).

## Objective

Implement the application-level separation lifecycle against fakes: run a separation for a `preparing` track (model ensure → inference → all-or-nothing publish → `ready`), cancel it whether queued or running, and the three startup sweeps. No adapter, no Worker, no browser API.

## Problem / why

The library use cases (P3a) create `preparing` rows; nothing yet moves them to `ready`, and nothing repairs rows left behind by a crash, a closed tab or storage eviction. The desktop specifies all of this in `SplitLibraryController` and `JobManager` (`docs/decisions/feature-parity.md`, split-view and library sections; `docs/decisions/browser-storage.md` sections 4 and 7). Encoding it as use cases over ports pins the contracts the inference Worker (P7) and the storage adapters (P4–P6) must honour.

## Scope

- **Port contracts made real** (the P3a placeholders used `unknown`): `InferencePort.run(job, onProgress)` takes `{ trackId, profile, source: Uint8Array-or-decoded-PCM-opaque-handle, resultKey }`, reports `{ window, totalWindows }` progress, resolves with the list of lane keys written through `StemStorePort`, and exposes a cancel handle whose `terminate()` rejects the pending run with a typed `InferenceCancelled` error. `ModelStorePort.ensure(profileId, onProgress)` resolves when the profile's weights are verified and cached, reporting `{ receivedBytes, totalBytes }`. `StemStorePort` gains `listResultKeys()` and `exists(resultKey)` for the sweeps. `CatalogPort` stays as is.
- **Use case `separate(trackId)`**: only for `preparing` rows; `ensure` model (progress surfaces as a "preparing" detail: `Preparing <profile>: <percent>%`), transition to `processing`, run inference, then publish: one catalog update that records the result key and flips to `ready` only when every expected lane key is present (`publish_atomic` contract, `browser-storage.md` section 7). Inference failure → `failed` with `errorDetail` in the desktop `"{cause} {recovery}"` shape; cancellation → `interrupted` with the desktop cancel copy; any partial stem set is deleted through `StemStorePort` before the status change. Progress and status changes are observable through a callback or an event port so P8 can render them.
- **Job queue and `cancel(trackId)`**: an in-memory `SeparationQueue` with one running job at a time (desktop `JobManager` semantics: queued jobs never start once cancelled, `job_manager.py:329-336`); `cancel` on a queued job removes it and lands the row on `interrupted` without ever running; `cancel` on the running job calls `terminate()` on the inference handle and lands on `interrupted`; `cancel` on a track that is neither queued nor running returns `false`.
- **Startup sweeps** as one use case `runStartupSweeps()` executed in this order: `recoverUnfinished` (every `preparing`/`processing` row → `interrupted` with the crash copy, `history.py:385-391`), `validateReady` (every `ready` row whose result key is missing from `StemStorePort` → `unavailable` with the desktop copy, `history.py:393-412`), `sweepOrphans` (every result key in `StemStorePort` with no catalog row → deleted; `browser-storage.md` section 4). Returns counts per sweep.
- **Tests** translated from `Tests/Portable/test_history.py` (cancel mid-run lands on interrupted with no partial artifacts and retry still works; failed job keeps no partial artifacts; success flips to ready with duration) and `Tests/Portable/test_job_manager.py` (cancel on a queued job removes it without starting; only one job runs at a time; queue order preserved), plus the three sweeps with mixed catalogs.

## Out of scope

- The real Worker, ONNX Runtime, OPFS, IndexedDB, Cache API (P4–P7).
- Audio decoding (`decodeAudioData`) and the mixer (P9).
- UI (P8). Changing P2 domain rules; if one blocks, report it.

## Constraints and decisions

- Artifacts in English. Conventional Commits, scope `application`, no AI attribution lines. One commit per task, each with its tests and the tracker update.
- TDD: **strict, on** (runner `vitest`, `npm test`). Observed RED before every implementation; RED and GREEN evidence recorded per task in this document.
- Layering enforced by `npm run lint`: `application` imports `domain` and its own ports only; fakes in `tests/fakes/`.
- Size heuristic ~400 authored lines per task, advisory; never omit tests to fit.
- RDD: off. Checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:browser`, `npm run build`.

## Tasks

- [ ] **P3B-01 — Real port contracts and fake upgrades.** Route: delegated writer. Checks: `InferencePort`, `ModelStorePort`, `StemStorePort` typed as above; `FakeInference` can be scripted to succeed, fail, or hang until terminated, and records written lane keys; `InMemoryModelStore.ensure` reports progress; fakes' focused tests updated.
- [ ] **P3B-02 — `separate` and all-or-nothing publish.** Route: same writer. Checks: success path with progress events; failure leaves no referenced partial stems; cancellation lands on `interrupted`; a non-`preparing` row is refused.
- [ ] **P3B-03 — `SeparationQueue` and `cancel`.** Route: same writer. Checks: one running job at a time, FIFO; queued cancel never runs the job; running cancel terminates; unknown returns `false`; retry after cancel works (P3a `retryTrack`).
- [ ] **P3B-04 — `runStartupSweeps`.** Route: same writer. Checks: the three sweeps in order with the desktop copy and counts; idempotent on a clean catalog.
- [ ] **P3B-05 — Close the feature.** Route: inline. Checks: five commands green; evidence here; PR(s) opened stacked on #10.

## Acceptance criteria

- Ports carry real types; fakes cover the new behaviours.
- `separate`, `cancel`, `runStartupSweeps` with behaviour-first tests translated from the desktop.
- All checks green; RED/GREEN evidence per task.

## Progress / evidence

- 2026-09-21 — branch and document created. Forecast ≈650 authored lines across four commits; delivery as two stacked PRs (ports + separate; queue/cancel + sweeps) if the total exceeds the review budget, decided at closure.

## Next step

P3B-01 by a delegated writer with the strict-TDD contract above.
