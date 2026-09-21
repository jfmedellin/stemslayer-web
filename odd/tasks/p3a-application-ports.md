# P3a — Application ports, fakes and the library use cases

Status: opened 2026-09-21. Delivery strategy: `ask-on-risk`; chain strategy: `stacked-to-main` (branch `feat/p3a-application-ports` stacked on `feat/p2b-identity-claims`, PR #6; this PR targets `main` after #6 merges).

## Objective

Define the application layer's ports with in-memory fakes and implement the three library use cases that need no inference: add-to-library, remove and retry. Everything is exercised against fakes; no browser API is touched.

## Problem / why

`docs/decisions/architecture.md` fixes the hexagonal layout: use cases orchestrate ports, adapters implement them later (P4–P7). Writing the use cases first against fakes pins the contracts the adapters must satisfy and turns the desktop behaviours (`docs/decisions/feature-parity.md`, library section; `docs/decisions/browser-storage.md` sections 1, 3, 4) into executable tests before any IndexedDB or Web Lock code exists.

## Scope

- Ports under `src/application/ports/`: `CatalogPort`, `StemStorePort`, `ModelStorePort`, `InferencePort`, `AudioEnginePort`, `QuotaPort`, `LockPort` (plus the existing `HashPort`). Each port declares only the methods this task's use cases need or that later tasks are already specified to need in `architecture.md`; keep them minimal and documented.
- In-memory fakes under `tests/fakes/` (or `src/application/testing/` if the writer prefers a shippable location; decide once and record it): `InMemoryCatalog`, `InMemoryStemStore`, `InMemoryModelStore`, `FakeQuota`, `FakeLock` (serialises callbacks per key, records acquisition order), `FakeHash` (deterministic digest of the bytes, distinct per content).
- Use case `addToLibrary`: decode nothing; take `{ bytes, fileName, profile }`; compute `sourceHash` through `HashPort` and `pipelineFingerprint` through `createPipelineFingerprint`; quota pre-flight through `QuotaPort` using the stem-set forecast per profile from `browser-storage.md` section 2 (≈403.7 MiB Basic, ≈605.6 MiB Rock) plus the profile's model size when `ModelStorePort` reports it uncached; under `LockPort` key `stemslayer:identity-claim`, read the catalog snapshot, call `planIdentityClaim`, and act on the decision: `claim-candidate` creates a `preparing` track with the identity; `reuse-ready` returns the existing ready track; `await-owner` returns the owner without creating anything; `adopt-and-retry` moves the owner to `preparing` (rebinding the hash when the bytes changed). Return a typed result naming the decision and the track.
- Use case `removeTrack`: refused with a typed error while `preparing` or `processing`; otherwise deletes the stem set through `StemStorePort` and the row through `CatalogPort`, in that order, and reports a stem-store failure as `unavailable` instead of deleting the row (desktop `history.py:456-464`).
- Use case `retryTrack`: only `failed`, `interrupted`, `unavailable`; moves to `preparing` with `errorDetail` cleared; unknown ids return `false`.
- Tests translated from the desktop intent in `Tests/Portable/test_history.py`: concurrent identical adds claim once (two `addToLibrary` calls racing under `FakeLock` produce one `claim-candidate` and one `await-owner`); same bytes with a different profile are independent; changed bytes create a new track; retry after changed bytes rebinds identity and releases the old one; remove refused while running; quota refusal before any catalog write.

## Out of scope

- Any adapter (IndexedDB, OPFS, Cache API, Web Locks, Web Crypto): P4–P6.
- `separate`, `cancel`, startup sweeps: P3b.
- UI, React, tokens.
- Changing the domain modules from P2 except to add a missing export; if a domain rule is found wrong, report it instead of patching around it.

## Constraints and decisions

- Artifacts in English. Conventional Commits, no AI attribution lines. One commit per task below, each carrying its tests.
- TDD: **strict, on** (source: session configuration; runner `vitest`, `npm test`). Observed RED before GREEN for every behaviour; record the failing test name and the first passing run per task.
- Layering: `application` imports `domain` and its own ports only; fakes may import `application` and `domain`. `npm run lint` enforces it.
- Size heuristic ~400 authored lines per task (advisory; tests and docs count; never omit tests to fit).
- RDD: off. Ordinary checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:browser`, `npm run build`.

## Tasks

- [x] **P3A-01 — Ports and fakes.** Route: delegated writer. Checks: every port has a doc comment naming the adapter task that implements it; fakes have their own focused tests for the behaviours the use cases rely on (lock serialisation order, hash determinism, quota arithmetic).
- [x] **P3A-02 — `addToLibrary`.** Route: same writer. Checks: the six translated desktop scenarios above pass; quota refusal leaves the catalog untouched; the concurrent test proves one claim.
- [x] **P3A-03 — `removeTrack` and `retryTrack`.** Route: same writer. Checks: refusal while running; stem-store failure lands on `unavailable`; retry statuses and `errorDetail` clearing; unknown id.
- [ ] **P3A-04 — Close the feature.** Route: inline. Checks: all five commands green; this document carries the evidence; PR opened stacked on #6.

## Acceptance criteria

- Eight ports defined and documented; fakes cover them.
- Three use cases with behaviour-first tests translated from the desktop.
- All checks green; RED/GREEN evidence recorded per task.

## Progress / evidence

- 2026-09-21 — branch and document created. Forecast ≈450 authored lines (ports ~120, fakes ~150, use cases ~120, tests ~250; the total exceeds the per-task heuristic across three commits, not within one).
- 2026-09-21 — **P3A-01 done.** Ports are pure interface declarations with no runtime behaviour, so no RED/GREEN cycle applies to them (same as the existing `hash-port.ts`, which has no dedicated test); only the fakes carry behaviour and went through TDD.
  - Fakes location decision: `tests/fakes/` (tracker's first option), since nothing outside tests imports them and it keeps them out of the shipped `src/` tree.
  - Port→adapter task mapping used in doc comments: `CatalogPort`→P4 (indexeddb), `StemStorePort`→P5 (opfs), `ModelStorePort`→P6 (cache-api), `InferencePort`→P7 (onnx-worker), `AudioEnginePort`→P8 (web-audio), `LockPort`→P9 (web-locks). `QuotaPort` has no dedicated adapter folder in `architecture.md`'s infrastructure layout (it wraps one global `navigator.storage.estimate()` call); documented as implemented alongside P5. This is a technical labeling call, not a product decision, so it did not block the task.
  - RED (all failed on `Cannot find module`, confirmed before any fake existed): `FakeLock > serializes callbacks racing for the same key in call order`, `FakeLock > does not serialize callbacks for different keys`, `FakeLock > a rejecting callback still releases the key for the next caller`, `FakeHash > is deterministic for the same bytes`, `FakeHash > is distinct for different content`, `FakeQuota > reports the configured available bytes`, `FakeQuota > reflects a later change in available bytes`, `InMemoryCatalog > starts empty`, `InMemoryCatalog > inserts and reads a track back`, `InMemoryCatalog > updates an existing track in place`, `InMemoryCatalog > removes a track`, `InMemoryStemStore > deletes a stored key without error`, `InMemoryStemStore > deleting an unknown key is a no-op`, `InMemoryStemStore > rejects when the key is configured to fail`, `InMemoryModelStore > reports an uncached profile with zero size by default`, `InMemoryModelStore > reports a configured footprint` (6 suites failed to import, 0 ran).
  - GREEN: `npm test` → 11 test files passed, 118 tests passed (102 pre-existing + 16 new). `npm run typecheck` and `npm run lint` both clean.
  - Commit `eddf635` — `feat(application): add ports and in-memory fakes`.
- 2026-09-21 — **P3A-02 done.** `addToLibrary` in `src/application/add-to-library.ts`.
  - Technical finding, not a product-decision blocker (resolved by reading `src/domain/identity-claim.ts` directly, not guessed): `selectPreferredIdentityOwner` only ever matches a competitor whose `sourceHash` **and** `pipelineFingerprint` exactly equal the identity being claimed (`identity-claim.ts`'s own tests confirm this — `adopt-and-retry` is only exercised with the *same* identity as the failed/interrupted/unavailable owner). So the scope bullet's "adopt-and-retry ... rebinding the hash when the bytes changed" and the translated scenario "retry after changed bytes rebinds identity and releases the old one" cannot both mean *changed* bytes trigger `adopt-and-retry` through `addToLibrary`'s normal flow — a genuinely different hash never matches a stale owner, it always produces a fresh `claim-candidate` (own test: "changed bytes leave a stale failed identity untouched and independent"). The realizable translation of desktop's `test_failed_duplicate_retries_the_existing_identity` is: re-adding the *same* bytes after a failure adopts and retries that row; `rebindTrackSourceHashForRetry` is still called unconditionally in the adopt-and-retry branch (satisfying the deliverable's instruction to use that domain function), but it is a no-op there since the hash already matches by construction — documented in the test's own comment.
  - RED (all failed on `Cannot find module '../../src/application/add-to-library'`, 0 ran): `claims a new identity and creates a preparing track`, `reuses an existing ready track for identical bytes and profile`, `same bytes with a different profile are independent (not a duplicate)`, `changed bytes create a new track instead of reusing the old identity`, `re-adding the same bytes after a failure adopts and retries the existing identity`, `changed bytes leave a stale failed identity untouched and independent`, `a preparing/processing owner is awaited without creating anything new`, `quota refusal happens before any catalog write`, `quota forecast adds the model footprint only when uncached`, `concurrent identical adds under the same lock claim exactly once`.
  - First implementation pass also failed typecheck (`Object.freeze(...) as const` is invalid on a call expression, TS1355) and one test used `ModelStorePort.setFootprint` which only the fake exposes, not the port — both fixed before GREEN.
  - GREEN: `npm test` → 12 test files passed, 128 tests passed (118 previous + 10 new). `npm run typecheck` and `npm run lint` both clean.
  - Commit `b823cc0` — `feat(application): add the addToLibrary use case`.
- 2026-09-21 — **P3A-03 done.** `removeTrack` in `src/application/remove-track.ts`, `retryTrack` in `src/application/retry-track.ts`.
  - RED (all failed on `Cannot find module`, 0 ran): `removeTrack > returns not-found for an unknown track`, `removeTrack > refuses removal while preparing`, `removeTrack > refuses removal while processing`, `removeTrack > deletes the stem set then the catalog row while ready/failed/interrupted/unavailable` (×4), `removeTrack > a stem-store failure marks the track unavailable instead of deleting the row`, `removeTrack > a repeated stem-store failure on an already-unavailable track keeps its status`, `retryTrack > returns false for an unknown track`, `retryTrack > moves a failed/interrupted/unavailable track back to preparing and clears errorDetail` (×3), `retryTrack > refuses to retry while preparing/processing/ready` (×3).
  - GREEN on first implementation pass: `npm test` → 14 test files passed, 144 tests passed (128 previous + 16 new). `npm run typecheck`, `npm run lint` clean.
  - Full verification run for the feature: `npm run typecheck` clean; `npm run lint` clean; `npm test` → 144/144; `npm run test:browser` → 1/1 (pre-existing architecture boundary test, unaffected by this feature since no `infrastructure`/`ui` code was touched); `npm run build` → `tsc --noEmit && vite build` succeeded.

- 2026-09-21 — **P3A-03 follow-up: `retryTrack` rebinds identity when a retry brings changed bytes.** Corrects the earlier P3A-03 entry above: the coordinator located the rule I could not place — it lives in desktop's `retry()` (`history.py:617-630`, re-hashes the source on every retry), not in `add()`, and `test_retry_after_source_bytes_change_transfers_identity_without_stale_reuse` specifies it; `feature-parity.md` marks it "keep", and `browser-storage.md` section 7 confirms the web equivalent needs the user to resupply the file, so the bytes arrive as `retryTrack` input.
  - `retryTrack(trackId, deps, input?)` now takes an optional `{ bytes }`. No bytes, or bytes hashing to the same `sourceHash`, keep the original bytes-less behaviour unchanged. Different bytes are hashed through `HashPort`, then rebound under the `stemslayer:identity-claim` `LockPort` key: if another track already owns `(newHash, pipelineFingerprint)` the retry is refused (`{ ok: false, reason: 'identity-owned', ownerTrackId }`) rather than creating a duplicate identity; otherwise `rebindTrackSourceHashForRetry` + `transitionTrack('preparing')` run on the same row, releasing the old identity.
  - Removed the no-op `rebindTrackSourceHashForRetry` call (and its now-inaccurate comment) from `addToLibrary`'s adopt-and-retry branch: that branch's owner always already carries the requested hash by construction, so the call never did anything there; rebinding now only happens in `retryTrack`, which is where a hash can actually change. Extracted the shared `'stemslayer:identity-claim'` string into `src/application/identity-claim-lock-key.ts` (`IDENTITY_CLAIM_LOCK_KEY`), used by both `addToLibrary` and `retryTrack`, to avoid two independently-drifting copies of the same lock key.
  - RED (new tests only; run against the pre-change `retryTrack`, which silently ignored the extra `input` argument): `retryTrack > retrying with newly supplied bytes > rebinds the source hash in place when the bytes changed` (expected new hash, got the old one unchanged), `> refuses to rebind when another track already owns the new identity` (expected a refusal, got `ok: true` — the old code adopted nothing and just retried in place), `> releases the old identity so re-adding the old bytes claims a fresh track` (expected `'claimed'`, got `'awaiting'`, since the row never moved off the old hash). The other 8 pre-existing tests plus the new `unchanged bytes behave like a bytes-less retry` test passed unchanged (no regression, and `unchanged bytes` needed no new code to already be correct).
  - GREEN: `npm test` → 14 test files passed, 148 tests passed (144 previous + 4 new: 3 that were RED above, plus `unchanged bytes behave like a bytes-less retry`). `npm run typecheck`, `npm run lint`, `npm run test:browser`, `npm run build` all clean.

## Feature closed

All three tasks (P3A-01, P3A-02, P3A-03) are done, each in its own commit with tests and this tracker updated. Eight ports declared (`CatalogPort`, `StemStorePort`, `ModelStorePort`, `InferencePort`, `AudioEnginePort`, `QuotaPort`, `LockPort`, plus the existing `HashPort`), six fakes under `tests/fakes/`, and three use cases (`addToLibrary`, `removeTrack`, `retryTrack`) with 42 new tests (16 fakes + 10 addToLibrary + 16 remove/retry). No domain module was modified. P3A-04 (closing the branch/PR) is inline work for the parent orchestrator, not this writer.

## Next step

P3A-01 by a delegated writer with the strict-TDD contract above.
