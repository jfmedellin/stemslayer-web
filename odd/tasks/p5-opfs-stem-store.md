# P5 — OPFS stem store, WAV encoder and storage quota

Status: opened 2026-09-21. Delivery strategy: `ask-on-risk`; chain strategy: `stacked-to-main` (branch `feat/p5-opfs-stem-store` stacked on `feat/p4-browser-adapters`, PR #16).

## Objective

Implement `StemStorePort` on the Origin Private File System with a float32 WAV encoder byte-identical to the desktop's, and `QuotaPort` on `navigator.storage`, both proven in Chromium through Vitest browser mode.

## Problem / why

Stems are the bulk of what the app stores (≈101 MiB per stem per 5 minutes, `docs/decisions/browser-storage.md` section 2). The design note fixes where they live (OPFS, one WAV per lane under `/stems/<resultKey>/<laneId>.wav`), their format (32-bit float PCM, format tag 3, no metadata chunks, interleaved, exactly `engine/wav.py`), how export reuses the stored bytes unchanged, how the referential sweep finds orphans (section 4), and how quota is checked before a job and handled on `QuotaExceededError`. None of that exists yet; P3 runs against fakes.

## Scope

- **WAV codec**, `src/infrastructure/opfs/float32-wav.ts`, pure functions usable from the main thread and from the inference Worker (P7): `encodeFloat32Wav({ sampleRate, planar: Float32Array[] })` producing the exact byte layout of `engine/wav.py` (`RIFF`, `WAVEfmt ` with a 16-byte fmt chunk `<HHIIHH` = format 3, channels, sample rate, byte rate, block align, 32 bits, then `data`; peak above 1.0 or non-finite rejected with a typed `export.clipping` error carrying the peak, as the desktop does), and `decodeFloat32Wav(bytes)` back to planar Float32 for the mixer and the tests. Golden-byte test: a two-channel, three-frame fixture whose bytes are computed by the desktop encoder (run `../separador-pistas/.venv/Scripts/python.exe` once to print them, record the hex in the test) must match exactly.
- **`StemStorePort` extended** with `writeLane(resultKey, laneId, audio)` and `readLane(resultKey, laneId)` returning the stored bytes (a `Blob` or `Uint8Array`; decide once and record), keeping `delete`, `exists`, `listResultKeys`. Update `tests/fakes/in-memory-stem-store.ts` and the P3 tests that depend on it; keep them green.
- **`OpfsStemStore`**, `src/infrastructure/opfs/opfs-stem-store.ts`: root directory `stems` under `navigator.storage.getDirectory()`, one directory per result key, one file per lane; `writeLane` through `createWritable()` (main thread) with the encoder; `readLane` through `getFile()`; `delete` removes the whole result directory recursively; `exists` and `listResultKeys` from directory iteration; a `QuotaExceededError` (DOMException name) from a write is mapped to a typed `StorageQuotaExceededError` carrying the desktop message `Not enough browser storage to save this separation. Remove old tracks and retry.` (`browser-storage.md` section 4). Each test uses its own root directory name (constructor option) and removes it afterwards.
- **`NavigatorStorageQuota`**, `src/infrastructure/opfs/navigator-storage-quota.ts`, implementing `QuotaPort.availableBytes()` as `quota - usage` from `navigator.storage.estimate()` (0 when either is undefined), plus `requestPersistence()` wrapping `navigator.storage.persist()` and `isPersisted()`; tested in the browser against the real API (values are asserted as non-negative numbers and consistent, not as fixed amounts) and against an injected fake `StorageManager` for the arithmetic.
- **Sweep integration test**: write two result keys, remove one row from an `InMemoryCatalog`, run the P3b `runStartupSweeps` with the real `OpfsStemStore`; the orphan directory is gone, the referenced one survives, `validateReady` flips a row whose directory was deleted out of band to `unavailable`.

## Out of scope

- Cache API model store (P6); the inference Worker and `FileSystemSyncAccessHandle` writes (P7, which reuses the codec); the mixer's decoding into `AudioBuffer` (P9); export UI (P10).
- Eviction policy beyond the referential sweep; migrations.
- Changing domain or application code except to extend `StemStorePort` and its fake; report anything else that looks wrong.

## Constraints and decisions

- Artifacts in English. Conventional Commits, scope `infrastructure`, no AI attribution lines. One commit per task with its tests and the tracker update.
- TDD: **strict, on**. Codec tests run in the Node project (pure functions; place them under `tests/infrastructure/` or make the codec file's test a `*.test.ts` picked by the Node include; record the choice); adapter tests run with `npm run test:browser`. Observed RED before every implementation, recorded per task.
- Layering enforced by `npm run lint`.
- Size heuristic ~400 authored lines per task, advisory; never omit tests to fit.
- RDD: off. Checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:browser`, `npm run build`.

## Tasks

- [x] **P5-01 — Float32 WAV codec.** Route: delegated writer. Checks: golden bytes from the desktop encoder; round trip; clipping and non-finite rejection with the desktop message shape; odd lengths and mono/stereo.
- [x] **P5-02 — `StemStorePort` extension and `OpfsStemStore`.** Route: same writer. Checks: write/read round trip byte-identical; delete removes the directory; exists/list; quota error mapping (simulated through an injected writable that throws a `QuotaExceededError` DOMException); per-test root cleanup.
- [x] **P5-03 — `NavigatorStorageQuota` and the sweep integration test.** Route: same writer. Checks: arithmetic against a fake `StorageManager`; real API sanity; orphan sweep and `validateReady` through the real store.
- [ ] **P5-04 — Close the feature.** Route: inline. Checks: five commands green; evidence here; PR(s) opened stacked on #16.

## Acceptance criteria

- Codec byte-identical to the desktop on a golden fixture.
- OPFS store implementing the extended port with browser-run tests and quota error mapping.
- Quota adapter with arithmetic tests; sweeps proven through the real store.
- All checks green; RED/GREEN evidence per task.

## Progress / evidence

- 2026-09-21 — branch and document created. Forecast ≈500 authored lines (codec ~90, store ~150, quota ~40, tests ~220).

- 2026-09-21 — **P5-01 done.** `encodeFloat32Wav`, `decodeFloat32Wav`, `ClippingError` in `src/infrastructure/opfs/float32-wav.ts`.
  - Technical shape decision: codec tests run under `tests/infrastructure/float32-wav.test.ts` (Node project's `tests/**/*.test.ts` include), since the module itself lives under `src/infrastructure/` which the Node project does not include and the codec has no browser dependency.
  - Golden fixture generated read-only from the desktop encoder: `D:\cursos\separador-pistas\.venv\Scripts\python.exe` running `PlanarPCM(sample_rate=44100, planar=((0.5, -0.25, 0.0), (1.0, -1.0, 0.125)))` through `encode_float32_wav`; the exact Python snippet and resulting hex are recorded as a comment in the test.
  - Clipping message shape follows the app's own established convention (`{code} {cause} {recovery}`, e.g. `separation-copy.ts`'s `CANCELLED_ERROR_DETAIL`), not desktop's Python `f"{code}: {cause} Recovery: {recovery}"` string — same `export.clipping` code and `peak` field carried on the typed error, same "reduce gain" recovery wording as `wav.py`'s `ExportError`.
  - RED (`Cannot find module '../../src/infrastructure/opfs/float32-wav'`, 0 ran): all 5 tests in `tests/infrastructure/float32-wav.test.ts` — golden bytes, fixed header layout, mono/stereo round trip with an odd frame count, peak-above-1.0 clipping, non-finite-sample clipping.
  - GREEN on first implementation pass (all 5), no fixes needed. `npm test` → 19 files, 180 tests (175 + 5 new). `npm run test:browser` → 5 files, 17 tests (unchanged). `npm run typecheck`, `npm run lint` both clean.
  - Commit `57c6466` — `feat(infrastructure): add the float32 WAV codec` (242 lines: `git diff --shortstat 2dfcb8c 57c6466 -- src tests`).

- 2026-09-21 — **P5-02 done.** `StemStorePort` extended with `writeLane`/`readLane`; `OpfsStemStore`, `StorageQuotaExceededError` in `src/infrastructure/opfs/opfs-stem-store.ts`; `tests/fakes/in-memory-stem-store.ts` extended to match.
  - Technical shape decision: lane bytes are `Uint8Array` on both `writeLane` and `readLane` (not `Blob`) — consistent with `WebCryptoHash`'s existing `Uint8Array` convention in this codebase and avoids a Node/browser type split in the fake.
  - Technical shape decision: `OpfsStemStore`'s constructor takes a `rootDirectoryName` option (default `stems`, the production root); tests pass a unique name per test for isolation, never the production root. A "key" accepted by `delete`/`exists` is resolved generically: the full result key (`resultKey`, e.g. `stems/track-1`, embedding its own `/` segments as nested OPFS directories under the store's root) or one lane key within it (`${resultKey}/${laneId}`, the shape `expectedLaneKeys` already produces for `separate.ts`'s per-lane cleanup and `run-startup-sweeps.ts`'s `validateReady`) — resolved by trying the last segment first as a directory, then as a `<name>.wav` file. `listResultKeys` walks the tree recursively and returns the joined path of every leaf directory (one holding files, not further subdirectories), so it works regardless of how many `/`-segments a result key embeds.
  - `writeLane` accepts an injectable `createWritable` factory (default `fileHandle.createWritable()`) so quota exhaustion can be simulated deterministically in tests without writing hundreds of MiB; a `QuotaExceededError` DOMException from it is mapped to `StorageQuotaExceededError` carrying the desktop message (`browser-storage.md` section 4).
  - RED, fake extension (`tests/fakes/in-memory-stem-store.test.ts`, Node): `store.writeLane is not a function` / `store.readLane is not a function`, 3 failing — round trip, result-key-and-lane-key existence, read-before-write rejection.
  - RED, `OpfsStemStore` (`Failed to resolve import "./opfs-stem-store"`, 0 ran): all 9 tests in `opfs-stem-store.browser.test.ts` — round trip, multiple lanes, exists (result key and lane key), listResultKeys, delete-whole-result-key, delete-single-lane-keeps-siblings, delete-unknown-is-no-op, quota mapping, root isolation.
  - One lint fix after GREEN: `readLane`'s not-found rethrow needed `{ cause: error }` for the `preserve-caught-error` rule.
  - GREEN: `npm test` → 19 files, 183 tests (175 + 5 codec + 3 fake). `npm run test:browser` → 6 files, 26 tests (17 + 9 new), run twice for stability. `npm run typecheck`, `npm run lint` both clean.
  - Commit `1aa9a16` — `feat(infrastructure): add the OPFS stem store adapter` (399 lines: `git diff --shortstat 57c6466 1aa9a16 -- src tests`).

- 2026-09-21 — **P5-03 done.** `NavigatorStorageQuota` in `src/infrastructure/opfs/navigator-storage-quota.ts`; sweep integration test in `src/infrastructure/opfs/startup-sweeps.browser.test.ts`.
  - Technical shape decision: `requestPersistence`/`isPersisted` are adapter-only methods beyond `QuotaPort` (which stays exactly `availableBytes()`), the same precedent as P4-02's `IndexedDbCatalog.close()` — nothing in this feature's scope wires persistence-request into a use case yet.
  - RED (`Failed to resolve import "./navigator-storage-quota"`, 0 ran): all 7 tests in `navigator-storage-quota.browser.test.ts` — arithmetic against a fake `StorageManager` (present/missing quota/missing usage), `requestPersistence`/`isPersisted` wrapping, and two real-API sanity checks.
  - GREEN on first implementation pass (all 7), no fixes needed.
  - The sweep integration test (`startup-sweeps.browser.test.ts`) is pure composition of already-implemented pieces (P3b's `runStartupSweeps`, P5-02's `OpfsStemStore`, the `InMemoryCatalog` fake) — same as P4-03's precedent, no missing-module or behavioural RED was applicable; passed on first run, then re-run three times total (all green) since it exercises real OPFS state including nested result-key directories under a shared root.
  - GREEN: `npm test` → 19 files, 183 tests (unchanged). `npm run test:browser` → 8 files, 35 tests (26 + 7 quota + 2 sweep), run three times for stability. `npm run typecheck`, `npm run lint` both clean.
  - Commit `<pending>` — `feat(infrastructure): add the navigator storage quota adapter and sweep integration test`.

## Next step

P5-04 — close the feature: re-run all five checks, confirm evidence, open the PR stacked on #16.
