# Weight mirror survey (T3b)

Date: 2026-09-20. Sources: Hugging Face model API, file trees and model cards, read on that date by a research worker; CORS confirmed with ranged GET requests carrying an `Origin` header and following redirects to the CDN hop.

## Decision

- **htdemucs (Basic profile): `Ghilda/htdemucs-onnx`**, single fp32 ONNX file, 174 MB, opset 18, fixed input `[1, 2, 343980]` (7.8 s at 44.1 kHz), STFT and iSTFT computed outside the graph in JS. Proven in a shipped browser extension on `onnxruntime-web` with the WebGPU provider.
- **htdemucs_6s (Rock profile): `kramp/htdemucs-6s-webgpu-onnx`**, 285 MB ONNX patched for WebGPU (`ConstantOfShape` folded to `Constant`), iSTFT embedded, used by a public Hugging Face Space. Fallback base: `StemSplitio/htdemucs-6s-onnx` (fp32 258 MB, fp16 136 MB).
- **Ground truth: `adefossez/HTDemucs` and `adefossez/HTDemucs-6s`**, safetensors uploaded by the Demucs author (2026-08-31), file names matching the original checkpoints (`955717e8`, `5c90dfd2`). Not runnable in the browser as-is; used to validate the ONNX exports numerically in spike S2.
- **Runtime consequence (amends T3):** the baseline becomes **ONNX Runtime Web, WebGPU execution provider, WASM provider as fallback**. demucs.cpp stays as an alternative path only if a spike shows that the author's safetensors can be converted to ggml in the browser.
- Every mirror is pinned by commit SHA and the file's SHA-256 (recorded below) is verified after download before the model is cached.

## License caveat

All the ONNX mirrors tag their cards "MIT", citing "official MIT-licensed weights published by Meta". That claim is wrong: the Demucs maintainer states in `facebookresearch/demucs#327` that the weights are not covered by MIT and are provided for scientific purposes only (`licenses.md`). Fetching from these mirrors does not launder that restriction; it only keeps this repository from redistributing the files. The accepted-risk decision in the feature document stands unchanged.

## Survey

| Repository | Format | Models | Files (bytes) | SHA-256 | Export notes | Runtime | Updated | Browser evidence |
|---|---|---|---|---|---|---|---|---|
| adefossez/HTDemucs | safetensors | htdemucs | `955717e8.safetensors` (84,025,440) | `d9fa1413…576dd` | raw weights, loaded by the Python `demucs` package | Python | 2026-08-31 | none; author-published reference |
| adefossez/HTDemucs-6s | safetensors | htdemucs_6s | `5c90dfd2.safetensors` (54,885,744) | `d2a1745f…9d411` | raw weights | Python | 2026-08-31 | none; author-published reference |
| Ghilda/htdemucs-onnx | ONNX fp32, opset 18 | htdemucs | `htdemucs.onnx` (174,266,088) | `e528a932a7d091e15938369135569884b62c2193fb11044c3d4a0d4c7b9221af` | STFT/iSTFT outside the graph; fixed 7.8 s segment | onnxruntime-web, WebGPU | 2026-06-03 | shipped Chrome/Brave extension ("YouStem") |
| kramp/htdemucs-6s-webgpu-onnx | ONNX, WebGPU-patched | htdemucs_6s | `htdemucs_6s.onnx` (284,797,240) | `a3f5050696cda4b2344d465123acb21ee699dad7d0634dba1d282497a04ac86a` | fork of StemSplitio base; `ConstantOfShape` folded; iSTFT embedded; claims bit-identical output | onnxruntime-web, WebGPU | 2026-06-30 | public Hugging Face Space |
| StemSplitio/htdemucs-6s-onnx | ONNX fp32 + fp16 | htdemucs_6s | `htdemucs_6s.onnx` (258,159,781); fp16 variant (136,428,532) | `48f8e894…ca779a` / `7ce55792…56869` | targets native ORT on mobile (CoreML, DirectML) | onnxruntime native | 2026-05-21 | none |
| monteslu/htdemucs-web-onnx | ONNX, 21 sub-graphs, mixed precision | htdemucs | `htdemucs_p00…p20.onnx` (~125,881,245 total) | per file in the API | split at encoder/transformer/decoder to keep GPU submissions under 30 ms; needs custom multi-session orchestration | onnxruntime-web, WebGPU | 2026-07-07 | README reports a UI-friendly pipeline |
| StemSplitio/htdemucs-ft-onnx | ONNX, 4 per-stem models | htdemucs_ft (not plain htdemucs) | 4 × ~316 MB fp32 / 4 × ~166 MB fp16 | in the API | explicitly not for browser/WASM | onnxruntime native | 2026-05-21 | none |
| cstr/htdemucs-GGUF | GGUF f16/q8_0/q4_k | htdemucs | 84.3 / 54.8 / 39.1 MB | in the API | loaded by a custom CLI tool, not demucs.cpp | CLI | 2026-08-02 | none |
| ogbabydiesal/demucs-ggml | tagged ggml/wasm | unclear | not verified | — | no README content confirmed | unverified | 2026-07-29 | unverified |

CORS: `Ghilda`, `kramp`, `StemSplitio/htdemucs-6s-onnx` and `adefossez/*` all answer the `resolve` URL with `Access-Control-Allow-Origin` on the 302 and `access-control-allow-origin: *` with 206 on the CDN hop. Gated repositories (401) are unusable and none of the picks is gated.

Other results (Kani95/*-ort, gentij/htdemucs-ort, several 6s ONNX clones) have zero downloads, no browser claim and were not examined further.

## Risks

1. **Provenance.** Every browser-ready file is an unofficial re-export, two hops from Meta's checkpoint in the 6-stem case. The author's safetensors are the only first-hand source, so S2 must diff the ONNX outputs against them on a fixed input before either pick is trusted.
2. **Mirror churn.** All picks are single-author uploads with zero downloads and no maintenance signal. Mitigations: pin the commit SHA, verify the file hash, cache in the browser, and keep the second 6-stem mirror as a fallback. Self-hosting a copy is excluded by the weights decision.
3. **Two pipeline shapes.** The 4-stem pick expects STFT/iSTFT in JS; the 6-stem pick embeds iSTFT. Either both are normalised in S2 (re-export one of them) or the app ships two integration paths. Decide in S2, not now.
4. **WASM fallback unproven.** The 6-stem file was patched for WebGPU; its behaviour under the WASM provider is untested. Firefox on Linux/Android and older browsers would take that path.
5. **Self-reported license tags.** See the caveat above; treat "MIT" on these cards as noise.

## Spike S2, updated scope

Load `Ghilda/htdemucs-onnx` and `kramp/htdemucs-6s-webgpu-onnx` in `onnxruntime-web` on the WebGPU and WASM providers; time one 5-minute song on the reference machine (Ryzen 7 5800X, Edge); diff the stems against the Python reference built from the author's safetensors; report peak memory. Go/no-go for the runtime decision above.
