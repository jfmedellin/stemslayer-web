# P10 — Export: per-stem download and zip-all

Status: opened 2026-09-22. Delivery strategy: `ask-on-risk`; chain strategy: `feature-branch-chain` (continuing P7a/P7b/P8/P9's convention). Developed locally on `feat/p7b-onnx-worker` (has P1..P9); publication base decided at closure.

## Objective

Build the real Export page: a per-track stem checklist with sizes, single-stem WAV download, and a client-side "download ZIP" of the selected stems (store-only, no compression — the stems are already float32 PCM, incompressible). Replaces the P8/P9 `PlaceholderPane` currently shown for the Export nav destination and wired from Mixer's "Export stems" button.

## Problem / why

P1..P9 built everything up to real, audible, controllable stems, but there is still no way to get them *out* of the browser onto disk. Export is the last piece `feature-parity.md`'s Export section and `phase-2-plan.md`'s P10 row describe: `feature-parity.md`'s own governing rule is that export is a **raw byte-for-byte copy** of the already-published per-lane WAV file — "never re-encoded... never has mute/solo/gain baked in" (`mixer_controller.py:417-434`'s docstring, quoted directly in the parity table) — which this web app already satisfies structurally, since `StemStorePort.readLane` returns the exact bytes `encodeFloat32Wav` wrote at separation time (P5).

## Scope

- **`src/application/export-track.ts`** (new use case, matching `open-in-mixer.ts`'s style — architecture.md's own use-case list already names `export` alongside `add-to-library`/`separate`/`cancel`/`retry`/`remove`/`open-in-mixer`): given a `trackId`, reads the `Track` via `CatalogPort`, reuses `resolveStemProfile` (same lane-set derivation `separate.ts`/`open-in-mixer.ts` already use — do not re-derive), reads every lane's raw bytes via `StemStorePort.readLane` (the exact stored bytes, never re-decoded/re-encoded — this is the entire point of the "raw byte-for-byte copy" rule), and returns one entry per lane: `{ laneId, displayName, fileName, bytes }`. File naming: `` `${title}-${stem}.wav` `` when the track has a title, bare `` `${stem}.wav` `` otherwise (`mixer_controller.py:101-123`'s `_export_target` naming scheme) — **no collision-suffix logic** (`feature-parity.md`'s own note: that only matters for a File System Access API write to a chosen folder; a plain `<a download>` lets the browser dedupe filenames itself, and this task does not use the File System Access API). Absent lanes (Rock's `guitar_center`/`guitar_sides` with no detectable energy) are exported like any other lane — real, aligned silence, per the same "still... exportable" rule already applied to the Mixer (`feature-parity.md`'s Absent-lane row). A track that can't be found, or whose stems fail to read, is a typed refusal (`{ ok: false, reason: 'track-not-found' | 'stems-unavailable' }`), never a throw — matching `openInMixer`'s own error-handling shape, though unlike the Mixer there is no meaningful "fallback session" to export, so Export's failure path is a plain refusal with no placeholder data.
- **`src/domain/zip/zip-writer.ts`** (new pure codec, matching `domain/audio/float32-wav.ts`'s precedent — hand-rolled, no dependency, exact documented byte layout): a minimal ZIP writer producing valid archives with **STORED (uncompressed)** entries only — `phase-2-plan.md`'s own "client-side zip, store-only" — appropriate since float32 PCM WAV is already high-entropy and gains nothing from DEFLATE. Needs: a CRC-32 implementation (the standard IEEE 802.3 polynomial, same one every ZIP reader expects — a small lookup-table implementation, well-specified, easy to test against known vectors), local file headers, the central directory, and the end-of-central-directory record, exactly per the [PKZIP APPNOTE](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT) STORED-method layout (version needed 2.0, compression method `0`, general-purpose flag `0`, DOS date/time — a fixed constant timestamp is fine, nothing meaningful to encode). Takes `readonly { fileName: string; bytes: Uint8Array }[]`, returns one `Uint8Array` — pure function, no browser API. Verify against a standard reader in tests (see Strict TDD below), not just against its own inverse.
- **Export page UI** (`src/ui/export/`, following P8/P9's established container/presentational precedent): reads the track via the same pattern `MixerPage`/`LibraryPage` already use; a stem checklist (checkbox per lane, defaulting to all checked, "Select all" toggle), each row showing name/format/size (`"{size} · WAV 32-bit float · {sampleRate} kHz"`, matching the fetched Stitch screen's copy below); a summary line (`"{N} files · {totalSize}"`); two primary actions — "Download ZIP · {totalSize} download" (builds the zip client-side from every **checked** lane via `zip-writer.ts` and triggers one `<a download>`) and "Download selected" (triggers one `<a download>` per checked lane — the browser's own multi-download prompt/permission applies, nothing this app can suppress); a "What you get" info card with the fetched exact copy (below); the storage notice with the fetched exact copy (below); "Back to mixer" navigation. Track header: title/artist/duration/profile/lane-count, matching the fetched Stitch screen's format `"{title} · {artist} · {duration} · {PROFILE} · {N} STEMS"`.
- **Exact copy fetched directly from the real Stitch mockup** (screen id `2a5990409e2c4d3cacdadb478c183682`, read via WebFetch the same way every prior UI phase's tracker did — do not paraphrase):
  - Per-stem row spec format: `"{size} · WAV 32-bit float · {sampleRate} kHz"` (the mockup shows an example `"101.7 MB · WAV 32-bit float · 44.1 kHz"`).
  - Summary: `"{N} files · {totalSize}"`.
  - Primary buttons: `"Download ZIP · {totalSize} download"` and `"Download selected"`.
  - "What you get" card: "Exactly the stems the separator produced, byte for byte." / "Same sample rate and length as the source." / `"<track> - <stem>.wav"` (the naming pattern shown to the user, matching the actual naming rule above).
  - Storage notice (verbatim): "These stems live only in this browser. Safari deletes site data after 7 days without a visit; other browsers may evict it under disk pressure. Download what you want to keep." — this is the exact sentence `phase-2-plan.md`'s own P10 row calls for ("Safari seven-day notice") and `architecture.md`/`browser-storage.md` section 4 already establish as fact (WebKit ITP 7-day full-storage deletion); no new fact-finding needed, just surfacing it in this page's copy.
- **Integration gap found before delegating (read directly, not assumed — see "Design reconciliation" below)**: neither of Export's two existing entry points carries a `trackId`. `src/ui/mixer/TrackHeader.tsx`'s "Export stems" button calls `onExport: () => void`, and `App.tsx`'s `onExport={() => setDestination('export')}` just navigates with no track selected — the exact same class of gap P9B found and fixed for "Open in mixer" (`onOpenInMixer` now carries `trackId`; `onExport` never got the same treatment because Export didn't exist yet). This task must: (1) thread `trackId` through `onExport: (trackId: string) => void` from `TrackHeader` → `MixerPage` → `App.tsx`; (2) add a direct "Export" action to Library's ready rows too (`TrackRow.tsx`/`LibraryPage.tsx`), matching the original fetched Library mockup's three ready-row actions ("Open in mixer" / "Export" / more — P8B only built "Open in mixer" since Export was out of scope then); both paths set the same `exportTrackId` state in `App.tsx`, mirroring `mixerTrackId`'s existing pattern exactly.

## Design reconciliation done before delegating

`feature-parity.md`'s Export section only describes the *rules* (raw copy, naming, batch semantics, gate refusals) — it does not prescribe a specific web UI, since desktop's export is a native folder-picker dialog with no web equivalent. The fetched Stitch screen and this tracker's own read of it are the actual UI decision for this phase, same pattern as every earlier UI phase (P8/P9). One divergence from desktop worth stating plainly: desktop's `export_stem`/`export_stems` report a structured per-item `(name, path_or_null, error_code_or_null)` result because a native folder write can fail per-file (disk full, permission denied mid-batch); a browser `<a download>` trigger has no comparable per-file failure signal exposed to script — the browser handles the actual write and reports nothing back. This task's "one failing item never blocks the rest of the batch" therefore means: build every requested lane's bytes/filename that can be built, and skip (not abort) any lane whose `readLane` call itself fails (a stem that's missing/corrupt), rather than reproducing desktop's structured per-item outcome list, since there is no web equivalent trigger-level failure to report.

## Out of scope

- The File System Access API (`showSaveFilePicker`) and its collision-suffix naming rule — plain `<a download>` only, per Scope above.
- Any mixdown/rendered export (baking in current mixer gain/mute/solo) — `feature-parity.md` explicitly keeps export mute/solo/gain-free; this task does not add that as a new feature.
- Any change to `StemStorePort`/`CatalogPort`/`resolveStemProfile` or their existing adapters — Export only reads, never writes.
- Lossy encoding (MP3/AAC), LUFS normalization, or any of `design-reference.md` section 3's already-rejected desktop-mockup deviations — WAV only, no analysis.
- Pixel-perfect visual polish — P11 owns that gate, same as every prior UI phase.

## Constraints and decisions

- Artifacts in English. Conventional Commits, scope `export` (application/domain pieces) or `ui` (UI pieces). No AI attribution lines. One commit per task with its tests and the tracker update, matching the established rhythm.
- TDD: strict for `src/domain/zip/zip-writer.ts` and `src/application/export-track.ts` (pure logic/application, `npm test`); integration-level (real assertions, not RED/GREEN) for `ui`, per `architecture.md`'s own stated rule, same as every prior UI phase.
- Layering: `domain/zip/` imports nothing outside `domain`; `application/export-track.ts` imports `domain` and its own ports only; `ui/export/` calls the use case through a container only. `npm run lint` enforces it.
- Size heuristic ~300 authored lines (`phase-2-plan.md`'s own P10 estimate), advisory — smaller than P8/P9's own tasks since there is no new domain-math surface comparable to the mixer's, mostly a codec plus a read-and-package use case plus a UI page. If it naturally splits (e.g. zip-writer+export-track as one slice, UI as another), audit once real line counts are known rather than pre-splitting.
- RDD: same protocol as every prior phase — after each commit, `gentle-ai review assess --base-ref <last acknowledged boundary> --committed-only --json`, follow the returned transitions. P9's closure reached a clean terminal state (unlike P8's `gentle-ai#4571` dead end); follow the same defect-handoff protocol if a tooling dead end recurs, rather than retrying indefinitely.
- Checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:browser`, `npm run build`.

## Tasks

- [ ] **P10A — `zip-writer`, `export-track`, and the Export page.**
  - Route: delegated direct (writer). Trigger: a new pure codec, a new use case, and a new UI page — well past the writer/mapping triggers.
  - Dependency: existing `StemStorePort`/`CatalogPort`/`resolveStemProfile` (P5/P4/P3a), the `mixerTrackId`/`onOpenInMixer` pattern P9B already established in `App.tsx` (this task mirrors it for `exportTrackId`).
  - Scope: see Scope section above, in full, including the trackId-threading gap and the Library ready-row "Export" action.
  - Acceptance: `zip-writer.ts` produces an archive a standard reader can open (verify with a real unzip — see Strict TDD); `export-track.ts` returns byte-identical file contents for every lane of a real track, including absent lanes, and refuses cleanly (no throw) for an unknown/broken track; the Export page is reachable from both Mixer's "Export stems" and Library's new "Export" action, always for the track that was actually selected (proven end to end, not just type-checked — this exact class of bug was P9C's own finding); "Download selected" and "Download ZIP" both trigger real browser downloads whose bytes match the stored stems exactly.
  - Strict TDD: `zip-writer.ts`/`export-track.ts` test-first, record RED, then GREEN/REFACTOR. `ui` integration-level per Constraints. Run typecheck/lint and the full suite (both projects).
  - Rollback boundary: revert `src/domain/zip/`, `src/application/export-track.ts`, `src/ui/export/`, the `App.tsx`/`TrackHeader.tsx`/`TrackRow.tsx`/`LibraryPage.tsx` trackId-threading changes, and this task's evidence; the Export nav destination reverts to `PlaceholderPane`, and Mixer's "Export stems" button reverts to not carrying a trackId. P1..P9 remain fully intact.
  - Forecast: ~300 authored lines (`phase-2-plan.md`'s own estimate).

- [ ] **P10B — Close P10.**
  - Route: parent-owned commits, assessments, final checks, and Engram mirror update.
  - Evidence: strict-TDD history (domain/application), integration-test evidence (ui), exact checks, authored counts, rollback boundaries, commit identities, and native outcomes, matching every prior phase's closure entry.

## Acceptance criteria

- [ ] `zip-writer.ts` produces a spec-valid STORED-only ZIP archive a standard tool/library can open and extract byte-identical contents from.
- [ ] `export-track.ts` reads a real track's stems byte-identical via `StemStorePort.readLane` (never re-decoded/re-encoded), names them `{title}-{stem}.wav`/`{stem}.wav`, includes absent lanes as real silence, and refuses cleanly for a missing/broken track.
- [ ] The Export page is reachable from both Mixer and Library, always scoped to the actually-selected track (no repeat of P9C's trackId-omission bug class).
- [ ] Per-stem download and zip-all both produce real, byte-correct downloads; the stem checklist, "What you get" card, and storage notice all match the fetched Stitch screen's exact copy.
- [ ] Focused and full checks pass with observed evidence appropriate to each layer's TDD rigor.

## Forecast and delivery

Forecast: P10A ~300+ lines (`phase-2-plan.md`'s own estimate; may exceed once the trackId-threading fix and Library Export-button addition are counted, same pattern as P9B exceeding its own estimate); P10B closure only. One work unit unless real line counts reveal a natural split. Expect a chained pull request at closure, same as every prior phase.

## Applicable checks

- P10A focused: `zip-writer.ts`/`export-track.ts` unit tests (`npm test`); a real browser test downloading/building a zip and verifying byte-correctness against the stored stems.
- Closure: `npm test`, `npm run lint`, `npm run typecheck`, `npm run test:browser`, and `npm run build`.
- Review focus: byte-identical export (no accidental re-encode path), correct STORED-ZIP framing (a real reader must open it, not just this codebase's own inverse function), the trackId-threading fix proven end to end (not just type-checked, per P9C's own finding), and no File System Access API / collision-suffix logic sneaking in where a plain `<a download>` was scoped.

## Progress / evidence

- 2026-09-22 — Feature document created on `feat/p7b-onnx-worker` (has P1..P9). Explored directly before writing: `docs/decisions/phase-2-plan.md`'s P10 row, `docs/decisions/feature-parity.md`'s full Export section (exact desktop rules with source references), `docs/decisions/architecture.md`'s use-case list (confirms `export` was always the planned name), confirmed no zip dependency exists in `package.json` (this task hand-rolls a minimal STORED-only ZIP writer, matching the project's existing from-scratch-codec precedent set by `float32-wav.ts`), and fetched+read the real Export Stitch screen (`2a5990409e2c4d3cacdadb478c183682`) via the Stitch MCP for exact UI copy the same way every prior UI phase's tracker did.
- 2026-09-22 — Integration gap found before delegating, same class as P9B's `onOpenInMixer` fix and P9C's `R3-mixer-stale-load-race` finding: neither of Export's two entry points (`TrackHeader`'s "Export stems", `App.tsx`'s `onExport`) carries a `trackId`; Library's ready rows also never got an "Export" action even though the original fetched Library mockup showed three ready-row actions. Both are now explicit required scope, not left for the writer to discover mid-implementation.

## Next step

Start P10A: `zip-writer.ts` first (pure, no dependencies on anything else in this task), then `export-track.ts`, then the Export page UI plus the trackId-threading fix across `TrackHeader`/`LibraryPage`/`TrackRow`/`App.tsx`. Route: delegated direct writer, per the Writer trigger.
