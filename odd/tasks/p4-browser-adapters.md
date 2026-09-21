# P4 — Browser adapters: IndexedDB catalog, Web Locks, Web Crypto

Status: opened 2026-09-21. Delivery strategy: `ask-on-risk`; chain strategy: `stacked-to-main` (branch `feat/p4-browser-adapters` stacked on `feat/p3b-separation-lifecycle`, PR #14).

## Objective

Implement the first real adapters under `src/infrastructure/`: `CatalogPort` on IndexedDB, `LockPort` on the Web Locks API, `HashPort` on Web Crypto, each proven by tests that run in a real Chromium through Vitest browser mode.

## Problem / why

Every use case from P3 runs against fakes. The catalog is where the desktop's persistence rules bite (`docs/decisions/browser-storage.md` section 1: one `tracks` store, unique compound index on `[sourceHash, pipelineFingerprint]`, `by_createdAt` index; section 7: the identity-claim sequence is serialised by a Web Lock, not by IndexedDB alone). These adapters have to be exercised in a browser because Node has neither IndexedDB nor `navigator.locks`.

## Scope

- `src/infrastructure/indexeddb/indexeddb-catalog.ts` implementing `CatalogPort`: database `stemslayer`, version 1, object store `tracks` keyed by `trackId`, unique compound index `by_identity` on `[sourceHash, pipelineFingerprint]` (rows without `sourceHash` are skipped by IndexedDB, as the design note relies on), index `by_createdAt` on `createdAtUtc`. `listAll` returns rows ordered newest first through `by_createdAt`. `insert` rejects a duplicate key with a typed error; a unique-index collision surfaces as a typed `IdentityCollisionError` (this is the safety net under the Web Lock, never the primary mechanism). `update` requires an existing row; `remove` of an unknown id is a no-op. Track objects are stored as plain data (`structuredClone`-safe) and read back frozen exactly as `createTrack` produces them.
- `src/infrastructure/web-locks/web-locks-lock.ts` implementing `LockPort` with `navigator.locks.request(key, { mode: 'exclusive' }, callback)`; a rejecting callback releases the lock; a missing `navigator.locks` throws a typed unsupported error at construction.
- `src/infrastructure/web-crypto/web-crypto-hash.ts` implementing `HashPort` with `crypto.subtle.digest('SHA-256', …)`, lower-case hex.
- Browser tests (`*.browser.test.tsx` under `src/infrastructure/`, the pattern the Vitest browser project already includes): schema creation and version; insert/get/list ordering; duplicate key; unique-index collision; update/remove semantics; round trip of a `createTrack` object; two catalogs on the same database observing each other's writes; lock serialisation of two racing callbacks and release after rejection; SHA-256 against the known vector for `"abc"` (`ba7816bf…`) and for empty input; each test uses a fresh database name and deletes it afterwards.
- One end-to-end browser test wiring the real catalog, lock and hash into the P3a `addToLibrary` use case with the in-memory fakes for the remaining ports: two racing adds of the same bytes claim exactly once through the real Web Lock.

## Out of scope

- OPFS stem store, quota (P5); Cache API model store (P6); inference Worker (P7); UI.
- Schema migrations (version 1 only; there is no earlier schema).
- Changing domain or application code except to export something an adapter needs; report anything that looks wrong instead of patching around it.

## Constraints and decisions

- Artifacts in English. Conventional Commits, scope `infrastructure`, no AI attribution lines. One commit per task with its tests and the tracker update.
- TDD: **strict, on**. Runner: `npm run test:browser` for adapters (Playwright Chromium); `npm test` must stay green. Observed RED before every implementation, recorded per task.
- Layering enforced by `npm run lint`: `infrastructure` implements ports and imports `domain`/`application` types only; never `ui`.
- Size heuristic ~400 authored lines per task, advisory; never omit tests to fit.
- RDD: off. Checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:browser`, `npm run build`.

## Tasks

- [x] **P4-01 — Web Crypto `HashPort` and Web Locks `LockPort`.** Route: delegated writer. Checks: known SHA-256 vectors; lock serialisation and release-on-rejection in the browser; unsupported-environment error.
- [x] **P4-02 — IndexedDB `CatalogPort`.** Route: same writer. Checks: schema, ordering, duplicate key, identity collision, update/remove, frozen round trip, cross-instance visibility; databases cleaned up per test.
- [x] **P4-03 — End-to-end wiring test.** Route: same writer. Checks: real catalog + lock + hash through `addToLibrary`; two racing adds claim once.
- [ ] **P4-04 — Close the feature.** Route: inline. Checks: five commands green; evidence here; PR(s) opened stacked on #14.

## Acceptance criteria

- Three adapters implementing their ports with browser-run tests.
- The identity-claim path proven end to end in a real browser.
- All checks green; RED/GREEN evidence per task.

## Progress / evidence

- 2026-09-21 — branch and document created. Forecast ≈420 authored lines (adapters ~170, browser tests ~250).

- 2026-09-21 — **P4-01 done.** `WebCryptoHash` in `src/infrastructure/web-crypto/web-crypto-hash.ts`; `WebLocksLock` and `UnsupportedLockEnvironmentError` in `src/infrastructure/web-locks/web-locks-lock.ts`.
  - Technical shape decision (recorded per the brief): widened `vitest.config.ts`'s browser project `include` from `src/{infrastructure,ui}/**/*.browser.test.tsx` to `src/{infrastructure,ui}/**/*.browser.test.{ts,tsx}`, so adapter tests with no JSX can use plain `.browser.test.ts`; the `ui` project keeps `.tsx` for its React tests.
  - `WebLocksLock` reads `navigator.locks` at construction (or an injected `LockManager` for tests), throwing `UnsupportedLockEnvironmentError` when neither is present; `withLock` wraps `navigator.locks.request(key, { mode: 'exclusive' }, callback)`, which already releases on a rejecting callback per the Locks API spec.
  - RED (`Failed to resolve import`, 0 ran, module did not exist): `hashes the known SHA-256 vector for "abc"`, `hashes the known SHA-256 vector for empty input`; then `serializes two callbacks racing for the same key`, `releases the lock after a rejecting callback so the next caller still runs`, `throws a typed error when the Locks API is unavailable`.
  - One test-only flake fixed before GREEN: the racing-callbacks test first used an arbitrary `setTimeout(10)` to let the first callback start, which failed once (`expected [] to deeply equal ['first-start']`) — replaced with a deterministic "first callback is running" signal promise; stable across two full `npm run test:browser` runs afterward.
  - GREEN: `npm run test:browser` → 3 files, 6 tests, run twice for stability. `npm test` → 18 files, 175 tests (unchanged, no Node-project adapter imports). `npm run typecheck`, `npm run lint` both clean.
  - Commit `7db1086` — `feat(infrastructure): add Web Crypto hash and Web Locks lock adapters` (133 lines: `git diff --shortstat <parent> 7db1086 -- src tests vitest.config.ts`, includes the `vitest.config.ts` one-line widen).

- 2026-09-21 — **P4-02 done.** `IndexedDbCatalog`, `DuplicateTrackIdError`, `TrackNotFoundError`, `IdentityCollisionError` in `src/infrastructure/indexeddb/indexeddb-catalog.ts`.
  - `insert`/`update` check for an existing row with a preliminary `getById` (typed `DuplicateTrackIdError`/`TrackNotFoundError`) before the IDB write; a `ConstraintError` from the write itself (the `by_identity` unique-index collision, the actual safety net under the Web Lock) is mapped to `IdentityCollisionError`. `close()` is exposed beyond `CatalogPort` for connection lifecycle (used by tests and available for app shutdown).
  - RED (`Failed to resolve import`, 0 ran, module did not exist): all 10 tests in `indexeddb-catalog.browser.test.ts` — schema/version, insert+getById round trip, `listAll` newest-first ordering, duplicate-key rejection, identity-index-collision rejection, no-sourceHash-never-collides, update-requires-existing-row, remove-unknown-is-no-op, frozen round trip, two-instances-same-database visibility.
  - GREEN on first implementation pass (all 10), no fixes needed. `npm run test:browser` → 4 files, 16 tests, run twice for stability. `npm test` → 18 files, 175 tests (unchanged). `npm run typecheck`, `npm run lint` both clean.
  - Commit `a847627` — `feat(infrastructure): add the IndexedDB catalog adapter` (313 lines).

- 2026-09-21 — **P4-03 done.** `src/infrastructure/add-to-library.browser.test.ts` wires `IndexedDbCatalog` + `WebLocksLock` + `WebCryptoHash` into the P3a `addToLibrary` use case, with `InMemoryModelStore` (footprint pre-cached, no download) and `FakeQuota` for the remaining ports.
  - No new production code: this task is pure composition of already-implemented pieces (P3a's `addToLibrary`, P4-01's hash/lock, P4-02's catalog), so neither a missing-module RED nor a behavioural RED was available or applicable — recorded per the brief's "behavioural RED preferred... where the module already exists" note, extended to the case where no module needs to exist at all. The test passed on its first run; stability was instead verified by running `npm run test:browser` four times in a row (all 17/17) to rule out a race-condition flake in the two-racing-`Promise.all` assertion, since the safety this test proves is exactly about concurrency.
  - Two concurrent `addToLibrary` calls for identical bytes/profile: one resolves `claimed`, the other `awaiting` (both target `preparing` status, so `planIdentityClaim` resolves the second as `await-owner`, not a second claim); `catalog.listAll()` afterward has exactly one row, `status: 'preparing'` — the identity claim exactly once, end to end through the real Web Lock.
  - GREEN: `npm run test:browser` → 5 files, 17 tests, run four times total for stability. `npm test` → 18 files, 175 tests (unchanged). `npm run typecheck`, `npm run lint` both clean.
  - Commit `<pending>` — `feat(infrastructure): add the end-to-end add-to-library wiring test`.

## Next step

P4-04 (close the feature): re-run all five checks, confirm evidence, open the PR stacked on #14.
