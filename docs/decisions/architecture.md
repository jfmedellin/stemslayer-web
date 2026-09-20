# Architecture and repository decision (T6)

Date: 2026-09-20. Status: decided; toolchain confirmed by the user.

## Repository

- Separate repository `stemslayer-web` (decided 2026-09-19): different stack, CI target and release cadence from the desktop app; no shared runtime code. The desktop repository (`../separador-pistas`) is the behavioural specification through `Tests/Portable/*` and the design of its views, never a code dependency.
- Hosting: GitHub Pages from a GitHub Actions build. The repository never contains model weights (`weight-mirrors.md`).

## Toolchain

| Concern | Choice | Why |
|---|---|---|
| Build | Vite | Static output, native Worker and WASM asset handling, fast dev loop. |
| Language | TypeScript, `strict` | The domain rules (identity claims, status machine, fingerprints) are the part most worth type-checking. |
| UI | React | The mixer and the library share derived state (lanes, gains, transport, job progress); a component model with container/presentational separation and atomic design keeps that manageable. Vanilla or Lit would be lighter but the mixer would be hand-built state plumbing. |
| Styling | CSS custom properties from the Dragon Atelier tokens (`design-reference.md`), no UI kit | The design system is already specified; a kit would fight it. |
| Tests | Vitest in Node for `domain` and `application`; Vitest browser mode (Playwright, Chromium) for `infrastructure` adapters | IndexedDB, OPFS, Web Audio, Web Locks and ONNX Runtime Web only exist in a real browser; everything else runs fast in Node against fake adapters. |
| TDD | On for `domain` and `application` (RED, GREEN, REFACTOR, runner `vitest`); integration tests, not strict TDD, for `infrastructure` and `ui` | Source: user decision 2026-09-20. |
| CI | GitHub Actions: typecheck, unit tests, browser tests, build, deploy to Pages | One workflow; deploy only from `main`. |

## Layers (hexagonal, screaming)

```
src/
  domain/          pure TypeScript, no browser APIs
    profiles/      Basic, Rock; pipeline fingerprint (canonical JSON + SHA-256)
    library/       Track, status machine, identity claim rules
    mixer/         lane model, gain, mute/solo resolution, loop range
  application/     use cases, orchestrating ports
    add-to-library, separate, cancel, retry, remove, export, open-in-mixer
    ports/         CatalogPort, StemStorePort, ModelStorePort, InferencePort,
                   AudioEnginePort, QuotaPort, LockPort, HashPort
  infrastructure/  one adapter per port
    indexeddb/     CatalogPort (tracks store, by_identity, by_createdAt)
    opfs/          StemStorePort (float32 WAV per lane)
    cache-api/     ModelStorePort (revision-named caches, SHA-256 check)
    onnx-worker/   InferencePort: Web Worker hosting onnxruntime-web
    web-audio/     AudioEnginePort: AudioWorklet mixing all lanes
    web-locks/     LockPort
    web-crypto/    HashPort
  ui/              React, atomic design, container/presentational
    tokens/        Dragon Atelier CSS variables
    atoms/ molecules/ organisms/ templates/ pages/
    containers/    wire use cases to presentational components
```

Rules: `domain` imports nothing from outside `domain`; `application` imports `domain` and its own ports; `infrastructure` implements ports and never imports `ui`; `ui` calls use cases through containers only. Tests for `domain`/`application` translate the desktop's portable tests one by one against fake adapters (`feature-parity.md` section 2 lists the mapping).

## Runtime topology

- **Main thread:** React UI, use cases, IndexedDB catalog, Web Locks. Never decodes or mixes audio itself.
- **Inference Worker (one per running job):** loads onnxruntime-web, selects the WebGPU provider when `navigator.gpu` is present and the session creates successfully, otherwise the WASM provider; receives decoded PCM, runs fixed-length windows with 25 % overlap and cross-fade (`browser-storage.md` section 6), writes each lane as float32 WAV into OPFS through `FileSystemSyncAccessHandle`, reports progress per window. Cancel is `Worker.terminate()` followed by the referential sweep; the job row lands on `interrupted`.
- **Model fetch:** streamed `fetch()` from the pinned mirror into a revision-named Cache API cache, progress by bytes, SHA-256 verified before first use; only then handed to the Worker as an `ArrayBuffer` (or a `Response` re-read from the cache inside the Worker).
- **Mixer:** one `AudioContext`, one `AudioWorkletNode` mixing every lane from planar Float32 buffers with a shared cursor, per-lane gain and mute/solo resolved in the domain and pushed as parameters, master gain node after the worklet, loop range handled inside the worklet. Skip 10 s and spacebar map to cursor operations. Export is the stored WAV `Blob` (no re-render), as decided in `browser-storage.md` section 2.
- **Decoding:** `AudioContext.decodeAudioData` on the main thread for the input file (the only main-thread audio work), then transfer of the planar buffers to the Worker.
- **Single-instance behaviour:** dropped on desktop parity; two tabs are serialized only where it matters (identity claims) by Web Locks.

## Cross-origin isolation

Not required by the baseline: onnxruntime-web's WebGPU provider and single-threaded WASM provider run without `SharedArrayBuffer`. Multithreaded WASM through `coi-serviceworker` stays an opportunistic upgrade evaluated in spike S1 (`inference-runtime.md`); if adopted, it is feature-detected and never a prerequisite.

## Consequences

- No server, no accounts, no telemetry. Everything the user produces lives in their browser's origin storage and can vanish under quota eviction or Safari's seven-day rule (`browser-storage.md` section 4); the UI says so.
- Two ONNX exports with different pipeline shapes (`weight-mirrors.md`, risk 3) may force either a re-export or two inference code paths; S2 decides before the inference adapter is written.
- Firefox on Linux/Android and browsers without WebGPU take the WASM provider and will be slower than the measured 0.8x real time; the drop zone shows an estimate based on the detected provider.
