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

- [x] **P3B-01 — Real port contracts and fake upgrades.** Route: delegated writer. Checks: `InferencePort`, `ModelStorePort`, `StemStorePort` typed as above; `FakeInference` can be scripted to succeed, fail, or hang until terminated, and records written lane keys; `InMemoryModelStore.ensure` reports progress; fakes' focused tests updated.
- [x] **P3B-02 — `separate` and all-or-nothing publish.** Route: same writer. Checks: success path with progress events; failure leaves no referenced partial stems; cancellation lands on `interrupted`; a non-`preparing` row is refused.
- [x] **P3B-03 — `SeparationQueue` and `cancel`.** Route: same writer. Checks: one running job at a time, FIFO; queued cancel never runs the job; running cancel terminates; unknown returns `false`; retry after cancel works (P3a `retryTrack`).
- [x] **P3B-04 — `runStartupSweeps`.** Route: same writer. Checks: the three sweeps in order with the desktop copy and counts; idempotent on a clean catalog.
- [ ] **P3B-05 — Close the feature.** Route: inline. Checks: five commands green; evidence here; PR(s) opened stacked on #10.

## Acceptance criteria

- Ports carry real types; fakes cover the new behaviours.
- `separate`, `cancel`, `runStartupSweeps` with behaviour-first tests translated from the desktop.
- All checks green; RED/GREEN evidence per task.

## Progress / evidence

- 2026-09-21 — branch and document created. Forecast ≈650 authored lines across four commits; delivery as two stacked PRs (ports + separate; queue/cancel + sweeps) if the total exceeds the review budget, decided at closure.

- 2026-09-21 — **P3B-01 done.** `InferencePort`, `ModelStorePort`, `StemStorePort` given real shapes in `src/application/ports/{inference,model-store,stem-store}-port.ts`; fakes upgraded (`tests/fakes/in-memory-stem-store.ts` gains `exists`/`listResultKeys`, `tests/fakes/in-memory-model-store.ts` gains `ensure`/`setDownloadSteps`) and a new `tests/fakes/fake-inference.ts` added, scriptable per track id to succeed (writing lane keys into an injected `InMemoryStemStore`), fail, or hang until `terminate()`.
  - Ports are pure interface declarations, same as P3A-01: no RED/GREEN cycle applies to them.
  - RED (all failed on `TypeError: <method> is not a function`, confirmed before implementation; `fake-inference.test.ts` failed on `Cannot find module` since the fake did not exist yet): `InMemoryModelStore > ensure resolves immediately with no progress when already cached`, `> ensure reports a default full-download step and then caches an uncached profile`, `> ensure reports configured download steps in order`, `InMemoryStemStore > exists reports whether a key is currently stored`, `> listResultKeys returns every currently stored key`, `> listResultKeys omits a key after it is deleted` (6 failed), plus the whole `fake-inference.test.ts` suite (4 tests, 0 ran).
  - GREEN: `npm test` → 15 test files passed, 158 tests passed (148 previous + 10 new). One test-only unhandled-rejection warning from an unattached `.finally()` chain was fixed by adding `.catch(() => {})` before commit. `npm run typecheck` and `npm run lint` both clean.
  - Commit `7f3823e` — `feat(application): add real separation port contracts and fakes` (315 lines).

- 2026-09-21 — **P3B-02 done.** `separate` in `src/application/separate.ts`, plus two small shared modules: `resolve-stem-profile.ts` (`profileId` → `StemProfile`, since `Track` only stores the id) and `separation-lane-keys.ts` (the per-lane `StemStorePort` keys expected under a track's `resultKey`, `${resultKey}/${laneId}`), and `separation-copy.ts` for the desktop-matching status text.
  - Technical shape decisions (yours to make per the brief, recorded here): (1) `separate(trackId, source, deps)` takes the raw source bytes as an explicit parameter — the port's job field is "Uint8Array-or-decoded-PCM-opaque-handle" and P3b never decodes audio, so the bytes must come from the caller (the queue, fed at `enqueue` time), mirroring how `retryTrack` already takes optional bytes. (2) `separate` returns a `SeparateHandle` (`{ result, terminate() }`) instead of a bare promise, so a caller can cancel uniformly whether the job is still in the model-ensure phase or already inferring: `terminate()` before the `InferenceHandle` exists sets a flag checked immediately after `ensure()` resolves (mirroring desktop's `commit_if_active`'s "flag checked immediately before the final commit"), then forwards to `InferenceHandle.terminate()` once inference has started. (3) Publish success requires every key in `separation-lane-keys.ts`'s expected set to be present in the value `InferencePort.run` resolved with; a resolved-but-incomplete set is treated as a failure (cleaned up like any other), never silently published.
  - Progress is `SeparateProgressEvent`: `{ phase: 'preparing'; detail }` using the exact desktop copy `Preparing <profile>: <percent>%`, and `{ phase: 'processing'; window; totalWindows }` left as raw numbers for the UI to render, matching `feature-parity.md`'s note that the separation step itself has no text progress bar on desktop, only the model-download step does.
  - Scope note: desktop's `_prepare` also backfills `duration_seconds` on success from the decoded session; web has no decoded duration available in P3b (`decodeAudioData` is P9, explicitly out of scope), so `separate` leaves `durationSeconds` untouched. Not a product-decision blocker — decoding literally does not exist yet for `separate` to source a value from.
  - RED (all failed on `Cannot find module '../../src/application/separate'`, 0 ran): `refuses a non-preparing row`, `refuses an unknown track`, `success path flips to ready once every expected lane key is written, with progress events`, `an inference failure lands on failed with no partial stems referenced`, `cancelling the running inference lands on interrupted with the desktop cancel copy and no partial stems`, `terminating before inference ever starts still lands on interrupted without running inference`, `a publish that is missing an expected lane key is treated as a failure and cleans up`.
  - GREEN on first implementation pass (all 7); one typecheck failure in the test file itself (discriminated-union narrowing on `result.reason` needed an explicit `'not-preparing'` guard before accessing `.track`) fixed before commit. `npm test` → 16 files, 165 tests. `npm run typecheck`, `npm run lint` clean.
  - Commit `96ed0c7` — `feat(application): add the separate use case with all-or-nothing publish` (369 lines).

- 2026-09-21 — **P3B-03 done.** `SeparationQueue` in `src/application/separation-queue.ts`.
  - RED: the whole suite failed on `Cannot find module` first (5 tests, 0 ran). After implementing, 2 of 5 tests failed on the first run — not a logic bug, a test-synchronization bug: fixed-count `await Promise.resolve()` ticks were too few to observe `settleFailure`'s multi-hop async chain (reject → `Promise.all` delete → `catalog.update` → handle settles → queue's `.finally`). Replaced with a `waitUntilStatus` poll helper; all 5 then passed against the unchanged implementation.
  - GREEN: `npm test` → 17 files, 170 tests. `npm run typecheck`, `npm run lint` clean.
  - Commit `2b780f0` — `feat(application): add the separation queue and cancel` (261 lines).

- 2026-09-21 — **P3B-04 done.** `runStartupSweeps` in `src/application/run-startup-sweeps.ts`, reusing `separation-lane-keys.ts` for `validateReady`'s all-or-nothing check and matching `sweepOrphans` against any stored key whose prefix is a still-referenced `resultKey` (`key === resultKey || key.startsWith(resultKey + '/')`).
  - RED (`Cannot find module`, 0 ran): `is idempotent on a clean catalog`, `recoverUnfinished flips every preparing/processing row to interrupted with the crash copy`, `validateReady marks a ready row unavailable when its stems are missing, and leaves a complete one alone`, `sweepOrphans deletes stem keys with no matching catalog row and keeps referenced ones`, `runs the sweeps in order: a crash-recovered row is then also validated and its stray stems orphan-swept`.
  - GREEN on first implementation pass (all 5). `npm test` → 18 files, 175 tests. `npm run typecheck`, `npm run lint` clean.
  - Commit `7bb19cc` — `feat(application): add the startup sweeps use case` (225 lines).

- 2026-09-21 — **Verification for the feature** (all five required commands, re-run clean at HEAD `7bb19cc`): `npm run typecheck` clean; `npm run lint` clean; `npm test` → 175/175 (148 pre-existing + 27 new, across P3B-01..04); `npm run test:browser` → 1/1 (pre-existing architecture-boundary test, unaffected); `npm run build` → `tsc --noEmit && vite build` succeeded.
  - Total authored diff across the four task commits: 1,170 lines (`src` + `tests`; `git diff --shortstat <parent> <commit>` per commit: 315 + 369 + 261 + 225). This exceeds the forecast and the ~400-line review-budget heuristic the document opened with; per that forecast, delivery is two stacked PRs on top of #10 (ports + `separate`; queue/cancel + sweeps) unless the parent decides otherwise at P3B-05 closure.
  - No domain module (`src/domain/*`) was changed; no P3a use case or port was narrowed, only the three placeholder ports were widened with additive fields no existing P3a code touches.

## Next step

P3B-05 (close the feature) is inline work for the parent orchestrator: confirm the delivery strategy (two stacked PRs vs. one, given the 1,170-line total) and open the PR(s) stacked on #10.
