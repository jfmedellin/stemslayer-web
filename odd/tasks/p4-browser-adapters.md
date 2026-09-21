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

- [ ] **P4-01 — Web Crypto `HashPort` and Web Locks `LockPort`.** Route: delegated writer. Checks: known SHA-256 vectors; lock serialisation and release-on-rejection in the browser; unsupported-environment error.
- [ ] **P4-02 — IndexedDB `CatalogPort`.** Route: same writer. Checks: schema, ordering, duplicate key, identity collision, update/remove, frozen round trip, cross-instance visibility; databases cleaned up per test.
- [ ] **P4-03 — End-to-end wiring test.** Route: same writer. Checks: real catalog + lock + hash through `addToLibrary`; two racing adds claim once.
- [ ] **P4-04 — Close the feature.** Route: inline. Checks: five commands green; evidence here; PR(s) opened stacked on #14.

## Acceptance criteria

- Three adapters implementing their ports with browser-run tests.
- The identity-claim path proven end to end in a real browser.
- All checks green; RED/GREEN evidence per task.

## Progress / evidence

- 2026-09-21 — branch and document created. Forecast ≈420 authored lines (adapters ~170, browser tests ~250).

## Next step

P4-01 by a delegated writer with the strict-TDD contract above.
