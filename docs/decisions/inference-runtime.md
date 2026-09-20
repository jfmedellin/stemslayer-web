# Inference runtime decision (T3)

Date: 2026-09-20. Status: decided, with two phase-2 spikes attached. Collected by a research worker from primary sources read on that date; the recommendation is conditional on the weights decision recorded in `licenses.md`.

## Decision

- **Baseline: demucs.cpp compiled to WebAssembly**, single-threaded by default, with `coi-serviceworker` as an opportunistic upgrade to multithreading when cross-origin isolation succeeds. Feature-detect `SharedArrayBuffer` at startup; when absent, run single-threaded and tell the user the expected wait.
- **Progressive path, not a launch dependency: ONNX Runtime Web with the WebGPU execution provider** and its WASM provider as fallback, once the htdemucs ONNX export is proven in a spike.
- **Rejected: hand-written WebGPU ports.** Every "Demucs WebGPU" repository found (`eclipse005/demucs-wgpu`, `gianlourbano/demucs-onnx`, `timcsy/demucs-web`, `bakkot/demucs-js`) wraps the same ONNX Runtime Web WebGPU provider; none is a maintained, independent kernel implementation.

## Comparison

| Criterion | A. demucs.cpp WASM | B. WebGPU port | C. ONNX Runtime Web |
|---|---|---|---|
| Speed | Only option with real-world validation at the accepted bar (freemusicdemixer.com, user-measured ~0.8x real time). Published pre-2025 numbers: ~17 min for a 4-min song single-threaded, ~7–9 min for a 7-min song with 8 workers (HN thread 38840776; archived free-music-demixer repo). The live site is faster than its archived code. | No published benchmarks. Unverified. | No published browser benchmarks. |
| Browser coverage | Any WASM browser single-threaded; multithreaded wherever isolation succeeds. | WebGPU only: Chrome/Edge since 113 (2023), Safari 26 (June 2025), Firefox 141 on Windows (July 2025) and 145 on macOS ARM64; Firefox Linux/Android incomplete (web.dev, "WebGPU supported in major browsers"). | WebGPU provider: same as B. WASM provider: same as A. |
| Memory ceiling | wasm32, 4 GB; demucs.cpp targets low memory with ggml weights. Memory64 exists in Chrome/Firefox with a performance penalty; not a practical target (v8.dev, 4 GB wasm memory). | WebGPU buffer and binding limits, driver-dependent, on top of the WASM ceiling. | WASM provider as A; WebGPU provider as B. Unverified for the htdemucs transformer. |
| Weight loading and caching | Same-origin static fetch; Cache API / OPFS caching to add. | One example hosts a ~172 MB ONNX model on Hugging Face (timcsy/demucs-web). | Same-origin fetch supported; Cache API / IndexedDB caching is a documented pattern. |
| Maintenance risk | demucs.cpp: MIT, single maintainer, active. `sevagh/free-music-demixer` archived and read-only since 2025-04-26; the live site's code is no longer public. | Small, new hobby repos with low commit counts and no production evidence. | ONNX Runtime Web is Microsoft-maintained. The htdemucs to ONNX export fix (STFT/iSTFT and multi-head attention, `StemSplit/demucs-onnx`, 2026) is single-developer and unproven. |
| Integration effort | High: Emscripten pthreads toolchain, worker glue, audio I/O; a working reference exists. | High and speculative. | Moderate once the export works: no DSP kernels to write. |

## The COOP/COEP question

- GitHub Pages cannot set response headers, and multithreaded WASM needs `SharedArrayBuffer`, which is gated behind cross-origin isolation (`Cross-Origin-Opener-Policy: same-origin` plus `Cross-Origin-Embedder-Policy: require-corp` or `credentialless`). Sources: Wasmer docs on COOP/COEP headers; tomayac, "Setting COOP/COEP headers on static hosting like GitHub Pages" (2025-03-08).
- `gzuidhof/coi-serviceworker` injects the headers from a service worker precisely for hosts that cannot set them. Confirmed limitations from its README: a reload on first load, must be self-hosted, needs HTTPS or localhost. Its behaviour in Safari, in cross-origin iframes and in private mode could not be verified from primary sources. Whether freemusicdemixer.com uses it is unknown (evidence gap).
- Single-threaded WASM is the realistic fallback. The historical penalty is roughly 2–3x, which would push a 5-minute 6-stem separation past the accepted "under 4 minutes".
- WebGPU compute does not need cross-origin isolation, so it sidesteps the header problem. Caveat: `timcsy/demucs-web` still requires COOP/COEP because ONNX Runtime Web's WASM thread pool sits beside the WebGPU provider; a pipeline avoiding WASM threads would not.

## Risks

1. The Demucs weights are scientific-use only (`licenses.md`). Every runtime option inherits this; the runtime decision does not resolve it.
2. `coi-serviceworker` on Safari, iframes and private mode is unverified.
3. The htdemucs ONNX export path is single-developer and untested here.
4. No independent benchmarks exist for either WebGPU path; option A's published numbers are older and slower than the user's measurement.

## Spikes attached to phase 2

- **S1 (blocks the timing promise):** deploy a hello-world WASM page with `coi-serviceworker` to GitHub Pages and check `crossOriginIsolated` in Chrome, Firefox and Safari, desktop and mobile, including private mode.
- **S2 (progressive path only):** export htdemucs and htdemucs_6s to ONNX with the reported patches and measure WASM-provider and WebGPU-provider timings before committing to option C.

Also still open from T1: whether the user's 0.8x real-time run on freemusicdemixer.com had multithreading or WebGPU active. If that site ran single-threaded, the baseline meets the bar without `coi-serviceworker`; if not, S1 decides.
