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

- [ ] **P3A-01 — Ports and fakes.** Route: delegated writer. Checks: every port has a doc comment naming the adapter task that implements it; fakes have their own focused tests for the behaviours the use cases rely on (lock serialisation order, hash determinism, quota arithmetic).
- [ ] **P3A-02 — `addToLibrary`.** Route: same writer. Checks: the six translated desktop scenarios above pass; quota refusal leaves the catalog untouched; the concurrent test proves one claim.
- [ ] **P3A-03 — `removeTrack` and `retryTrack`.** Route: same writer. Checks: refusal while running; stem-store failure lands on `unavailable`; retry statuses and `errorDetail` clearing; unknown id.
- [ ] **P3A-04 — Close the feature.** Route: inline. Checks: all five commands green; this document carries the evidence; PR opened stacked on #6.

## Acceptance criteria

- Eight ports defined and documented; fakes cover them.
- Three use cases with behaviour-first tests translated from the desktop.
- All checks green; RED/GREEN evidence recorded per task.

## Progress / evidence

- 2026-09-21 — branch and document created. Forecast ≈450 authored lines (ports ~120, fakes ~150, use cases ~120, tests ~250; the total exceeds the per-task heuristic across three commits, not within one).

## Next step

P3A-01 by a delegated writer with the strict-TDD contract above.
