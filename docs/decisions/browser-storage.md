# Browser storage and memory design (T5)

Date: 2026-09-20. Status: design note, written by a delegated writer from desktop source and browser platform documentation. Depends on the weights decision (`licenses.md`, `feature-parity.md`), the runtime baseline (`inference-runtime.md` as amended by `weight-mirrors.md`: ONNX Runtime Web, WebGPU provider with WASM fallback), and the already-decided answers in the feature document: Web Locks for identity claims, `Worker.terminate()` plus a `beforeunload` warning, `navigator.storage.estimate()` before accepting a job, and a single store keyed by `(source_hash, pipeline_fingerprint)`.

Desktop source read: `SeparationWorker/history.py`, `engine/stem_cache.py`, `engine/publication.py`, `paths.py`, `model_manager.py`, `model_manifest.py`, and the specifying tests in `Tests/Portable/test_history.py`, `test_stem_cache.py`. Demucs' own chunking defaults are read from the vendored dependency at `separador-pistas/.venv/Lib/site-packages/demucs/{htdemucs.py,apply.py}`, not from `SeparationWorker` itself.

---

## 1. IndexedDB schema

The desktop catalog is SQLite (`tracks` + `identity_claims`, schema v2, `history.py:142-186`). The web catalog is one IndexedDB database, one `tracks` object store, `keyPath: "trackId"`.

| Desktop (`history.py`) | Web (`tracks` store) | Status | Notes |
|---|---|---|---|
| `track_id` (uuid4 hex), PK | `trackId` (string, `crypto.randomUUID()`), keyPath | keep | |
| `source_path` | — | drop | No persistent handle back to a picked/dropped file exists in a browser without re-granted File System Access permission; see §7. |
| `source_hash` | `sourceHash` | keep | `crypto.subtle.digest("SHA-256", …)`, see §3. |
| `title`, `artist`, `genre` | same, camelCase | adapt | Read via a JS tag library instead of `mutagen`; same never-fatal, filename-fallback contract (`history.py:68-93`). |
| `duration_seconds` | `durationSeconds` | keep | |
| `bpm`, `musical_key` | `bpm`, `musicalKey` | keep (unused) | Stored, never populated or rendered, exactly as desktop (`gui.py:192`). |
| `created_at_utc` | `createdAtUtc` (ISO 8601) | keep | Indexed, `direction: "prev"` for the Newest sort. |
| `profile_id` | `profileId` | keep | |
| `pipeline_fingerprint` | `pipelineFingerprint` | keep | See §3. |
| `result_directory` (path) | `resultKey` (OPFS directory name or blob-set id) | adapt | No filesystem path; the key just names the stem group. |
| `status` (6-value enum) | `status` | keep | Same 6 values: `preparing, processing, ready, failed, interrupted, unavailable`. |
| `error_detail` | `errorDetail` | keep | Same `"{cause} {recovery}"` shape. |
| `identity_claims(source_hash, pipeline_fingerprint)` UNIQUE, separate table (`history.py:178-186`) | unique compound index `by_identity` on `[sourceHash, pipelineFingerprint]` on the `tracks` store | adapt | One store instead of two: IndexedDB skips index entries where a keyPath component is `undefined`, so a row with no `sourceHash` yet (status `preparing`, hash not computed) never collides. Folding the two tables is safe because there is no v1-schema data to keep decoupled from a lazy migration (`history.py:175-186`'s reason for the split), matching the "no legacy tier" finding in `feature-parity.md` §Cache/reuse. |
| `tracks_created_idx`, `tracks_identity_idx` | `by_createdAt`, `by_identity` indexes | keep | |
| Search (`title`/`artist` LIKE, wildcard-escaped) | in-memory `.toLocaleLowerCase().includes()` over the loaded row list | adapt | IndexedDB has no LIKE/wildcard query; a hobby-scale catalog (tens to low hundreds of rows) fits in memory. Already recorded in `feature-parity.md`. |
| Title/Duration sort (case-insensitive, nulls-last) | in-memory sort | adapt | IndexedDB indexes can't express custom collation or nulls-last; same conclusion as `feature-parity.md`. |

**Identity-claim mechanism.** Desktop's `claim_identity` (`history.py:259-346`) is one `BEGIN IMMEDIATE` transaction: look up an existing claim, and if the requested identity belongs to a different track, displace it (steal ordered by status `ready > processing > preparing > else`, then `created_at` desc) before inserting the new claim — all serialized by SQLite's file lock, so two threads or two OS processes can never both win the same identity (`test_history.test_concurrent_same_identity_adds_run_separation_exactly_once`). The decided web mechanism is a **Web Lock**: `navigator.locks.request("stemslayer:identity-claim", async () => { … })` wraps the read-decide-write sequence (read candidate row, query `by_identity`, decide displace/adopt/reuse, write). Web Locks are scoped per origin and serialize across tabs and workers of that origin ([MDN, Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)), which is what a browser needs in place of SQLite's cross-process file lock — a single IndexedDB `readwrite` transaction alone only guarantees atomicity for its own store mutation, not for the multi-step decide-then-act sequence that spans it.

---

## 2. Stem storage

**Where.** Recommendation: stem audio as files in **OPFS** (Origin Private File System), one file per lane under `/stems/{trackId}/{laneId}.wav`, not as IndexedDB Blobs. The separation Worker already owns this data and runs off the main thread, and OPFS's `FileSystemSyncAccessHandle` (worker-only, synchronous read/write, [MDN](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)) is a better fit for writing hundreds of megabytes per job than IndexedDB's async `put()` of large Blobs. Track metadata (small, structured) stays in IndexedDB; stem bytes go to OPFS, referenced by `resultKey`.

**Format.** WAV, 32-bit float PCM, matching desktop's on-disk format exactly: format tag `3` (`WAVE_FORMAT_IEEE_FLOAT`), no metadata chunks, interleaved (`engine/wav.py:1-35`; `encode_float32_wav`). The inference runtime emits stems as planar Float32 arrays; a lightweight interleave-and-header step at publish time reproduces this byte layout, so a track's stored file **is** a valid, self-contained WAV — the same "raw byte-for-byte copy" export contract desktop guarantees (`mixer_controller.py:417-434`) needs no re-encoding on web either. The mixer's *playback* representation stays planar Float32 (`AudioBuffer` is planar internally), decoded once from the stored WAV.

**Size per song.** 44,100 samples/s × 4 bytes (float32) × 2 channels = 352,800 bytes/s = 21,168,000 bytes/min ≈ **20.19 MiB/min** per stem. For a 5-minute song: 5 × 20.19 ≈ **100.9 MiB per stem**.
- Basic (4 stems): 4 × 100.9 ≈ **403.7 MiB**.
- Rock (6 stems): 6 × 100.9 ≈ **605.6 MiB**.

This excludes the source file and any transient input copy (§7).

**Export implication.** Because the stored file is already the exact WAV desktop would have written, export is a plain `Blob` handed to `<a download>` or `showSaveFilePicker` — no `OfflineAudioContext` render, no re-encoding, and no "export with the current mix" feature unless that is deliberately added later (open question kept from `feature-parity.md`).

---

## 3. Cache key and reuse

Desktop's `cache_key` (`engine/stem_cache.py:38-57`) hashes the **input path**, normalized for case-insensitive filesystems, then mixes in `pipeline_fingerprint` for every profile except the legacy grandfather namespace. None of that applies to a fresh web deployment: there is no filesystem path and no pre-profile cache to grandfather (`test_stem_cache.PipelineNamespaceTests.test_legacy_profile_keeps_the_key_published_before_profiles_existed` — dropped, §8).

**Resolution of `feature-parity.md` open question 6.** The web cache key and the library's own identity key collapse into the same thing: `(sourceHash, pipelineFingerprint)`, the same compound index from §1. Desktop keeps `stem_cache` (temp, orphan-swept) and `library_root` (durable) as two tiers because it also supports "load an arbitrary folder" outside the managed library; the web app has no such affordance, so every result is library-managed and a separate cache tier adds nothing.

**`pipeline_fingerprint` reproduction.** Desktop's fingerprint is a SHA-256 of canonical JSON over `{schema, profile_id, primary_model, specialist_id, specialist_input, splitter_id, split_input, raw_outputs, residual_sources, lanes}`, deliberately excluding the cosmetic `note` field (`engine/stem_profile.py:172-187`). The web build recomputes the identical canonical JSON (`JSON.stringify` over a sorted-key object, no whitespace) over the same field set for Basic and Rock, hashed with `crypto.subtle.digest`. Byte-identical serialization with desktop's Python output is not required — the two codebases never interoperate (T6) — only internal stability across app versions matters, unless the pipeline itself changes.

**Reuse vs. recompute.** A job reuses an existing result when `(sourceHash, pipelineFingerprint)` already has a `ready` row (mirrors `find_duplicate`/`claim_identity`'s ready-reuse path, `history.py:685-687`). A job recomputes when: the bytes differ (any single-byte change changes the SHA-256), the profile differs (Basic vs. Rock share no namespace), or the existing owner is `failed`/`interrupted`/`unavailable` — in that case the owner's `track_id` is adopted and re-run, never silently served stale (`history.py:688-691`).

---

## 4. Quota strategy

**Pre-flight (decided).** `navigator.storage.estimate()` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate)) runs before accepting a job; `quota - usage` is compared against a worst-case forecast: the target profile's stem set (§2: ≈403.7 MiB Basic, ≈605.6 MiB Rock) plus that profile's model weights if not yet cached (§5).

**`navigator.storage.persist()`.** Recommendation: request persistence ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)) once, right after the first successful separation, not on page load. Chromium and Firefox grant it automatically based on site-engagement heuristics rather than a prompt; Safari's behavior is governed by its own tracking-prevention policy below, not a simple grant/deny.

**What counts against quota, per browser:**
- Chrome/Edge: "best-effort" (evictable) storage is bounded to a large fraction of free disk space per origin, evicted LRU under global disk pressure; `persist()` exempts an origin from that eviction. ([MDN, Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria))
- Firefox: a per-eTLD+1 "group" limit and a global limit, both fractions of total disk space; the least-recently-used group is evicted first when the global limit is reached. (same MDN page)
- Safari (WebKit): in addition to whatever disk-based limit WebKit applies, **all script-writable storage** — IndexedDB, Cache API, OPFS, `localStorage` — is deleted after 7 days without user interaction with the site as first-party, under Intelligent Tracking Prevention; a same-site visit within the window resets the timer, and a home-screen-installed PWA is exempt. ([WebKit, Intelligent Tracking Prevention 2.1](https://webkit.org/blog/8613/intelligent-tracking-prevention-2-1/); [WebKit, Tracking Prevention policy](https://webkit.org/tracking-prevention/))

IndexedDB records+Blobs, Cache API entries, and OPFS files all draw from the **same** per-origin bucket — the cached model weights (§5) and the song library compete for the same budget, which the UI should surface rather than let users discover via a failed job.

**Eviction policy and the `sweep_orphans` equivalent.** Desktop's `sweep_orphans` deletes cache entries older than 6 hours (`ORPHAN_MAX_AGE_SECONDS = 21600`, `engine/stem_cache.py:22,102-138`) inside its separate temp tier. Since §3 folds cache and library into one tier, there is no age-based sweep to reproduce; its web counterpart is a **referential** sweep at startup: remove any OPFS stem set with no matching `tracks` row (an interrupted write whose metadata transaction never committed), and run the `validate_ready()` equivalent (§7) to catch rows whose blobs were evicted by the browser. This resolves `feature-parity.md` open question 5 for the eviction half of that question.

**On `QuotaExceededError`.** The pre-flight estimate is the primary defense; if the exception ([MDN, `QuotaExceededError`](https://developer.mozilla.org/en-US/docs/Web/API/DOMException#quotaexceedederror)) is still thrown mid-write (another tab or origin consumed the headroom after the estimate), the track is marked `failed` with `storage.quota_exceeded — Not enough browser storage to save this separation. Remove old tracks and retry.`, in the same `"{cause} {recovery}"` shape desktop already uses (`history.py`'s failure path, `SplitLibraryController._prepare`, `history.py:738-745`). No partial stems are ever left referenced (§7).

---

## 5. Model weights cache

**Cache API vs. OPFS.** Recommendation: **Cache API** for the weight artifacts. `fetch()` responses can be stored directly with `cache.put(request, response)` without buffering the whole body into memory first, matching the streamed-download progress already decided (`ReadableStream`, mirroring `model_manager.py:156-180`'s `on_progress`). OPFS would need the fetch body streamed manually into a `FileSystemSyncAccessHandle` for no benefit here, since weights are read-mostly and fetched at most once per profile per browser. ([MDN, Cache](https://developer.mozilla.org/en-US/docs/Web/API/Cache); [MDN, OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system))

**Sizes (from `weight-mirrors.md`, T3b).** Basic: `Ghilda/htdemucs-onnx`, 174,266,088 bytes (≈166.2 MiB). Rock: `kramp/htdemucs-6s-webgpu-onnx`, 284,797,240 bytes (≈271.6 MiB). The ONNX exports are two to five times larger than the original `.th` checkpoints (84 MB and 55 MB) because they are fp32 graphs with the segment shape baked in; both profiles cached together cost ≈438 MiB of the origin's quota.

**Hash verification on first fetch.** Mirrors `model_manager.py:83-94` (`_verify_existing`) and `:97-111` (`_verify_or_raise`): after the response is cached, re-read the bytes and `crypto.subtle.digest("SHA-256", …)` against a digest pinned in the web build's own manifest — necessarily a new digest, since conversion changes the bytes from the original `.th` files (`model_manifest.py:54-55,70-71`). The pinned digests are the ones Hugging Face reports for the chosen files (`weight-mirrors.md`, survey table); the manifest also pins the mirror commit SHA. On mismatch, delete the cache entry and refuse to load it into the Worker, fail-closed exactly as `model.hash_mismatch`.

**Pinned revision and invalidation.** The mirror fetch is pinned to a Hugging Face revision (feature doc, weights decision). Recommendation: name the Cache API cache by revision (`caches.open("models-v{revision}")`) rather than one shared, mutated-in-place cache. When the pinned revision changes, fetch and verify into the new named cache first, and only `caches.delete()` the old one after that succeeds — reproducing `ensure_model`'s "verify everything before `os.replace()`, never mutate in place" atomicity (`model_manager.py:236-254`), so a failed re-fetch never leaves the app with no usable weights.

---

## 6. Memory during inference

**WASM 32-bit ceiling.** A wasm32 instance's linear memory address space is capped at 4 GiB (2³², [v8.dev, "A new WebAssembly memory dashboard"](https://v8.dev/blog/4gb-wasm-memory)). On the ONNX Runtime Web WASM provider (the fallback path) the weights, activations and per-chunk buffers all live inside that instance; on the WebGPU provider the weights and activations live in GPU buffers instead, bounded by the adapter's `maxBufferSize`/`maxStorageBufferBindingSize`, and only the per-chunk input/output crosses the JS boundary. The arithmetic below is the WASM-provider worst case.

**Countable buffers for a 5-minute song** (recap of §2's arithmetic, ≈20.19 MiB/min stereo float32):
- Decoded input PCM: ≈100.9 MiB.
- Output stems in memory before they reach storage: ≈403.7 MiB (Basic, 4 stems) or ≈605.6 MiB (Rock, 6 stems).
- Resident model weights: ≈166.2 MiB (Basic) or ≈271.6 MiB (Rock) (§5), whichever profile is active.
- Summed, countable-only: **≈671 MiB (Basic) to ≈978 MiB (Rock)** before any intermediate activation memory — already a meaningful share of the 4 GiB ceiling.
- Intermediate activation memory inside the transformer/conv stack is **not computable from the material read for this note** (it depends on hidden-channel counts, sequence length, and the runtime's own buffer reuse) and is not estimated here; a phase-2 profiling spike should measure it directly rather than have it guessed.

Recommendation: keep the decoded input and the accumulating output stems in JS `ArrayBuffer`/OPFS, copied across the WASM boundary one chunk at a time, so the wasm32 instance itself only has to hold weights plus one chunk's activations, not the whole song twice over.

**Chunked/segmented inference.** Demucs does not run a whole song through in one pass. `HTDemucs`'s default `segment` attribute is **10 seconds**, with `use_train_segment=True` meaning the length actually applied is derived from the model's training configuration rather than the raw attribute (`demucs/htdemucs.py:131-132,235-236,518-534`, vendored dependency, not `SeparationWorker` code — the exact resolved seconds are not in the files read here). `apply_model`'s chunking defaults to **25% overlap** (`overlap=0.25`) with a linear cross-fade weight between adjacent chunks (`demucs/apply.py:148,261-298`). The chosen ONNX exports bake the segment into the graph: `Ghilda/htdemucs-onnx` takes a fixed `[1, 2, 343980]` input, 7.8 s at 44.1 kHz (`weight-mirrors.md`); the 6-stem export's input shape is confirmed in spike S2. The web port therefore runs the song as a sequence of fixed-length windows with 25 % overlap and a linear cross-fade in JS, which both matches the reference implementation numerically and bounds peak activation memory per window regardless of song length.

**File ceiling for the drop zone — recommendation, with its arithmetic, not a hard technical limit.** Budgeting roughly half the wasm32 ceiling (≈2048 MiB) for song-length-dependent buffers, leaving headroom for the runtime, weights, and activations:
- Rock (6 stems, ≈6 × 20.19 ≈ 121.1 MiB/min of output alone): 2048 ÷ 121.1 ≈ **17 minutes**.
- Basic (4 stems, ≈4 × 20.19 ≈ 80.8 MiB/min): 2048 ÷ 80.8 ≈ **25 minutes**.

Recommend a single conservative ceiling across both profiles, around **15 minutes**, shown on the drop zone as a soft warning rather than a hard block, and revisited once the S1/S2 phase-2 spikes (`inference-runtime.md`) produce real measurements — this arithmetic ignores the unmeasured activation term and real browsers frequently cap wasm32 memory below the theoretical 4 GiB.

---

## 7. Failure handling

- **Quota errors.** Covered in §4: pre-flight refusal is primary; a mid-write `QuotaExceededError` lands the track on `failed` with an actionable message in desktop's `"{cause} {recovery}"` shape.
- **Worker crash.** An unexpected Worker termination (not a deliberate cancel) lands the track on `failed`, e.g. `worker.crashed The separation worker stopped unexpectedly. Retry from the original audio.`, mirroring `history.py:738-745`'s generic exception handling. No partial stem set is ever referenced from `tracks`, reproducing `publish_atomic`'s all-or-nothing contract (`engine/publication.py:171-247`): the track only flips to `ready` in the same transaction that records every stem's final key.
- **Tab close mid-job.** `beforeunload` is already decided, but a browser neither shows a custom message nor awaits async work before unload ([HTML Standard, unloading documents](https://html.spec.whatwg.org/multipage/nav-history-apis.html#unloading-documents)), so desktop's blocking, worded `shutdown(deadline=8.0)` drain (`job_manager.py:349-374`) has no true web equivalent. If the tab actually closes mid-job, the row is simply left `preparing`/`processing`; the next load's startup sweep flips it to `interrupted` with desktop's own copy (`history.py:385-391`, `_CANCELLED_ERROR_DETAIL`-style message).
- **Storage cleared by the browser** (manual clear-site-data, private-mode teardown, Safari's 7-day ITP cap from §4, or ordinary quota eviction). There is no notification API for storage disappearing while the app is closed; the only detector is the startup validation sweep (`validate_ready()` equivalent, `history.py:393-412`), which flips affected rows to `unavailable` with the same actionable copy. Retry after that is only possible if the user still has the original file, since (§1) there is no standing handle back to it.

---

## 8. Parity table — persistence rules

Every persistence rule found in `history.py`, `engine/stem_cache.py`, `engine/publication.py`, `paths.py`, and `model_manager.py`, mapped kept / adapted / dropped. Rules already fully covered by `feature-parity.md`'s own Persistence/Cache/Models tables are marked "see feature-parity.md" rather than restated.

| # | Rule | Source | Status | Reason |
|---|---|---|---|---|
| 1 | SQLite `PRAGMA user_version` migration v1→v2 | `history.py:142-186` | drop | No pre-existing on-disk schema to migrate on a fresh deployment. |
| 2 | `tracks` table + indexes | `history.py:150-171` | keep | §1. |
| 3 | `identity_claims` as a separate table | `history.py:178-186` | adapt | Folded into one unique compound index on `tracks` (§1). |
| 4 | `claim_identity` displacement/tie-break ordering | `history.py:259-346` | keep | Same ordering, reimplemented under a Web Lock (§1). |
| 5 | `source_sha256`, streamed 1 MiB chunks | `history.py:46-51` | adapt | `crypto.subtle.digest` has no incremental/streaming API; the whole file is buffered before hashing. |
| 6 | `read_metadata`, never-fatal tag reading | `history.py:68-93` | see feature-parity.md | Library area, row "Detail column". |
| 7 | `query()` search/filter/sort | `history.py:348-383` | see feature-parity.md | Library area. |
| 8 | `recover_unfinished()` startup sweep | `history.py:385-391` | keep | §7. |
| 9 | `validate_ready()` startup sweep + duration backfill | `history.py:393-412` | keep | §4, §7. |
| 10 | `remove()` refused while `preparing`/`processing` | `history.py:449-454` | see feature-parity.md | Library area. |
| 11 | Result-directory path-escape guard on discard | `history.py:424-426,459-461` | drop | No path-escape surface in OPFS/IndexedDB. |
| 12 | ARC-02 immutable input copy before hashing | `history.py:754-770` | adapt | A browser `File` snapshots its bytes at selection time; whether that alone satisfies the immutability guarantee, or an explicit OPFS staging copy is still needed, is unverified — carried over from `feature-parity.md`'s own open item. |
| 13 | `discard_input_copy` / `purge_input_copies` | `history.py:468-505` | keep (conditional) | Applies only if rule 12 needs an explicit OPFS copy; moot if the `File` snapshot alone suffices. |
| 14 | `remove()` unloads mixer via `release()` before deleting | `history.py:456-457` | see feature-parity.md | Mixer/Library area. |
| 15 | Single-instance lock | `instance_lock.py` | drop | Decided in `feature-parity.md`. |
| 16 | Cancel/crash never leaves a partial published result | `history.py:721-745` | keep | §7, via rule 25's atomic commit. |
| 17 | `cache_key`, path-based content addressing | `engine/stem_cache.py:38-57` | adapt | Content-hash based; folded into rule 4's identity key (§3). |
| 18 | Legacy pipeline grandfather namespace | `engine/stem_cache.py:30-36,54-55` | drop | No legacy cache exists on a fresh deployment. |
| 19 | Non-legacy pipeline fingerprint mixed into key | `engine/stem_cache.py:56-57` | keep | §3. |
| 20 | Separate temp `cache_root()` tier | `engine/stem_cache.py:25-27` | drop | Folded into the one library tier (§3, resolves `feature-parity.md` open question 6). |
| 21 | `discard()` refuses non-direct-child paths | `engine/stem_cache.py:75-99` | drop | No path-traversal surface in OPFS/IndexedDB. |
| 22 | `sweep_orphans()`, 6h age threshold | `engine/stem_cache.py:22,102-138` | adapt | Replaced by a referential orphan sweep, no separate temp tier to age out (§4). |
| 23 | `expected_publication` manifest-digest identity | `engine/publication.py:39-50` | keep | Reused to validate an adopted/reconciled stem set. |
| 24 | `reconcile_publication`, adopt a matching existing result | `engine/publication.py:66-106` | keep (subsumed) | Same effect as claim_identity's ready-reuse path (§3, rule 4). |
| 25 | `publish_atomic` staging + atomic rename + `fsync` | `engine/publication.py:171-247` | adapt | No atomic multi-file rename or `fsync`-grade durability in OPFS; approximated by writing all stem blobs first, then flipping `status: "ready"` in one IndexedDB transaction only once every stem is present. This is a real durability gap versus desktop's `fsync`, not a full equivalent. |
| 26 | `_safe_parts` path-escape validation | `engine/publication.py:129-138` | drop | No path-escape surface in OPFS/IndexedDB. |
| 27 | `commit_if_active`, cancel serialized with commit | `engine/publication.py:109-126` | keep | An in-Worker flag checked immediately before the final "mark ready" transaction gives the same ordering guarantee. |
| 28 | `local_data_root()`, `%LOCALAPPDATA%\Stemslayer` | `paths.py:9-13` | drop | IndexedDB/OPFS are already origin-scoped; no app-specific root needed. |
| 29 | Re-verify every model file's hash on every call | `model_manager.py:83-94` | keep | §5. |
| 30 | Fail-closed acquisition, no partial directory left | `model_manager.py:44-56,126-255` | keep | §5. |
| 31 | Bundled `.yaml` bag files, hash-verified, never downloaded | `model_manager.py:114-123,240-241` | adapt | Web ships the equivalent config as a bundled static asset; hash-verify-before-trust carries over only if it is ever fetched instead. |
| 32 | Verified cache skips the network entirely | `model_manager.py:226-227` | keep | §5. |
| 33 | `on_progress` streamed-bytes reporting | `model_manager.py:156-180` | keep | §5. |
| 34 | `_command()` closes off `torch.hub`'s network path | `model_manager.py` docstring | drop | No Python/torch runtime exists on web to have this path in the first place. |

No rule from the five files read for this note was left unmapped.
