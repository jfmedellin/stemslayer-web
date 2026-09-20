# Spike S2 — ONNX Runtime Web viability (result and decision)

Date: 2026-09-20. Status: **go**. Runtime baseline confirmed: ONNX Runtime Web 1.30.0, WebGPU execution provider, WASM provider as fallback. Spike code lives on branch `spike/s2-onnx-runtime` under `spikes/s2/` and is not merged; this note is the merged deliverable.

Reference machine: AMD Ryzen 7 5800X, Microsoft Edge 153 (Chromium 153), WebGPU adapter present (adapter info not exposed by the browser). Test track: a 4:02 rock song (MP3, 44.1 kHz stereo); accuracy measured on a 30 s excerpt from 60 s in.

## What was verified

1. **Mirrors and hashes.** `Ghilda/htdemucs-onnx` at commit `850cd894…` and `kramp/htdemucs-6s-webgpu-onnx` at `0c850a01…`; both SHA-256 match `weight-mirrors.md`. CORS fetch from the pinned `resolve` URLs works; the Cache API copy is served on later loads (129–212 ms).
2. **Exports reproduce Demucs.** Python ONNX Runtime (CPU) against Demucs 4.1.0 with the author's weights on the same excerpt, then the browser against the same references: identical error tables.

| Model | Stem | Max abs error | SNR (dB), Python CPU | SNR (dB), Edge WebGPU |
|---|---|---|---|---|
| htdemucs | drums | 0.00103 | 57.86 | 57.86 |
| htdemucs | bass | 0.00749 | 42.89 | 42.89 |
| htdemucs | other | 0.00411 | 45.33 | 45.33 |
| htdemucs | vocals | 0.00076 | 53.11 | 53.11 |
| htdemucs_6s | drums | 0.00157 | 57.58 | 57.58 |
| htdemucs_6s | bass | 0.00066 | 72.03 | 72.13 |
| htdemucs_6s | other | 0.00010 | 27.33 | 27.32 |
| htdemucs_6s | vocals | 0.00090 | 59.90 | 59.91 |
| htdemucs_6s | guitar | 0.00195 | 55.97 | 55.97 |
| htdemucs_6s | piano | 0.00005 | 25.64 | 25.64 |

The two low-SNR rows (`other`, `piano` on the 6-stem model) are near-silent stems on this track: their absolute errors are the smallest in the table, so the ratio is poor while the error is not.

3. **Timing on WebGPU, full song (241.95 s of audio, 42 windows of 7.8 s with 25 % overlap).**

| Model | Wall time | ms per window (min / mean / max) | Realtime factor |
|---|---|---|---|
| htdemucs_6s (Rock) | 23.9 s | 518 / 551 / 869 | **10.1×** |
| htdemucs (Basic) | 35.6 s | 706 / 831 / 1253 | **6.8×** |

The first window is the slowest (shader compilation and warm-up); steady state is close to the minimum. The 4-stem model is slower than the 6-stem one because its STFT, iSTFT and branch sum run in JavaScript on the main worker thread rather than inside the graph. Against the phase-1 acceptance bar (the user accepted ~0.8× realtime, under 4 minutes for a 5-minute song), both models are 8–12× faster.

4. **WebGPU accepts both graphs on Chromium.** `htdemucs.onnx` keeps 19 `ConstantOfShape` nodes that were never folded for WebGPU; ONNX Runtime Web 1.30.0 created the session and ran it on Edge 153 without error. The concern raised in `weight-mirrors.md` (risk 3 and the S2.1 flag) is closed for Chromium-based browsers; Firefox and Safari WebGPU remain unverified.

5. **Memory.** Main-thread JS heap peaked at 88 MB (6-stem) and 600 MB (4-stem, holding the decoded input and all output stems in memory). Worker heap could not be sampled: `performance.memory` is not exposed in dedicated workers on Edge 153. GPU memory was not measured. A 4-minute song fits with wide margin; the 15-minute soft ceiling recommended in `browser-storage.md` stands until P7 measures a long input.

6. **DSP port.** The JavaScript STFT/iSTFT (radix-2 FFT, torch-compatible padding, complex-as-channels layout) matches the Python implementation to 7e-14 on a fixture and round-trips to 8e-14. It exists as spike code only; P7a rewrites it under TDD.

## Not verified

- **WASM provider on the reference machine.** The sandbox browser ran the 4-stem model single-threaded at 0.33× realtime (about 15 s per window). On the 5800X the figure is pending; it decides the copy shown to users whose browser lacks WebGPU, not the baseline. Recorded as a follow-up measurement, not a blocker.
- WebGPU on Firefox and Safari (spike S1 territory together with cross-origin isolation).
- Peak GPU memory and behaviour on integrated GPUs or laptops.

## Decision

- **Runtime:** ONNX Runtime Web, WebGPU provider first, WASM provider as fallback, exactly as amended in `weight-mirrors.md`. demucs.cpp is dropped from consideration.
- **Mirrors:** keep both picks and their pinned commits and hashes. No re-export is needed for correctness; both exports are numerically sound.
- **Pipeline shapes:** the app ships two inference paths, as the spike did: `mix + mag → freq + time` with STFT, iSTFT and branch sum in JS for Basic, and `mix → stems` for Rock. Unifying them by re-exporting the 4-stem graph in the self-contained form stays an optional optimisation (it would also close the 6.8× versus 10.1× gap), not a phase-2 task.
- **Product promise:** on a WebGPU-capable desktop the Rock profile separates a 4-minute song in about 25 seconds and the Basic profile in about 36 seconds. The drop zone shows an estimate based on the detected provider.
- **Follow-ups inherited by phase-2 tasks:** P7b measures WASM on the reference machine and long-input memory; S1 covers Firefox and Safari; P8a's quota readout uses the ONNX sizes (166 MiB + 272 MiB).

## Harness bugs found on the way

Three defects in the spike harness, all fixed on the branch: a Float32 buffer was reinterpreted as Float64 (halved and corrupted the audio); the reported audio duration was read from a transferred, therefore detached, buffer; and a local model file was assigned the pipeline chosen in the dropdown instead of being identified by its hash, which produced `invalid input 'mag'` when the two disagreed. The last one is a lesson for P6/P7: the model store must identify weights by content hash, never by a UI selection.
