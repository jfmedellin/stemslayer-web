# Spike S2 — ONNX Runtime Web viability for htdemucs / htdemucs_6s

## Objective
Decide, with measured numbers on the reference machine, whether the two chosen ONNX mirrors run in the browser on ONNX Runtime Web at an acceptable speed and reproduce the Demucs reference output. This is the technical go/no-go for the phase-2 inference design (`docs/decisions/phase-2-plan.md`, P0).

## Problem / why
Both mirrors are third-party re-exports with different pipeline shapes (`docs/decisions/weight-mirrors.md`): the 4-stem export keeps STFT/iSTFT outside the graph, the 6-stem export embeds iSTFT and was patched for WebGPU. Nobody has verified them against the author's weights, nor measured them on the WASM provider. Writing the product inference adapter before that would be building on a guess.

## Scope (authorized)
- Throwaway spike code under `spikes/s2/`, on branch `spike/s2-onnx-runtime`. Never merged into the product tree; the decision note `docs/decisions/spike-s2.md` is the merged deliverable.
- Model files, reference stems and virtualenvs are gitignored.
- Python reference uses the desktop `.venv` (`../separador-pistas/.venv`, demucs 4.1.0, torch 2.13 with CUDA) read-only; a separate spike venv may be created under `spikes/s2/.venv` for `onnx`.

## Out of scope
- Any product code under `src/`. No React, no ports, no adapters.
- Optimising the exports or re-exporting models. If an export is broken, the note says so and proposes the re-export as a follow-up.

## Constraints
- Artifacts in English. Conventional Commits, no AI attribution lines.
- TDD: off for this spike (throwaway code; phase-2 TDD applies to `domain`/`application` only, `docs/decisions/architecture.md`). Checks are the measurements themselves.
- RDD: off (default). Delivery: `single-pr` (spike branch, small).
- Reference machine: AMD Ryzen 7 5800X, Microsoft Edge, WebGPU available. The user runs the browser harness and reports.

## Tasks
- [x] S2.1 — Graph inspection. Download `Ghilda/htdemucs-onnx` (`htdemucs.onnx`) and `kramp/htdemucs-6s-webgpu-onnx` (`htdemucs_6s.onnx`) into `spikes/s2/models/` pinned to the mirror commit; verify SHA-256 against `docs/decisions/weight-mirrors.md`; dump opset, input and output names, shapes and dtypes with the `onnx` package; record them in `spikes/s2/README.md` together with what pre/post-processing each graph expects (STFT in or out, complex-as-channels layout, segment length).
  - Route: delegated worker (downloads, Python). Checks: hashes match; shapes table recorded.
  - Done 2026-09-20: `spikes/s2/README.md`. Pinned commits `850cd894…` (Ghilda) and `0c850a01…` (kramp); both SHA-256 match. Correction to the survey: `htdemucs.onnx` takes `mix [1,2,343980]` AND `mag [1,4,2048,336]` (CAC spectrogram) and returns `freq` mask + `time` branch, so STFT, iSTFT and the branch sum happen in JS; `htdemucs_6s.onnx` is self-contained (`mix` in, `stems [1,6,2,343980]` out). No STFT/DFT ops in either graph. Flag: `htdemucs.onnx` keeps 19 `ConstantOfShape` nodes (not WebGPU-folded); S2.3 must check whether the WebGPU provider accepts it.
- [x] S2.2 — Python reference. `spikes/s2/reference.py`: takes an input audio file, cuts a 30 s excerpt (from 60 s in, to avoid silent intros) to `spikes/s2/reference/excerpt.wav` (44.1 kHz stereo float32), runs `htdemucs` and `htdemucs_6s` with Demucs defaults through the desktop venv, writes float32 WAV stems per model to `spikes/s2/reference/<model>/<stem>.wav`. Also runs the same graphs through `onnxruntime` (CPU) in Python on the excerpt with the pre/post-processing from S2.1, and reports max abs error and SNR per stem against the Demucs output. This isolates "export is wrong" from "browser is wrong" before any JS exists.
  - Route: same worker as S2.1. Checks: script runs end to end on a user-provided file; per-stem error table in `spikes/s2/README.md`.
  - Done 2026-09-20: `reference_demucs.py` (desktop venv, CUDA) and `compare_onnx.py` (spike venv, CPU). Numpy STFT/iSTFT validated against torch (max diff 4e-7). Test audio: user-supplied 4-minute rock track, 30 s excerpt from 60 s. ONNX-CPU vs Demucs-CUDA SNR: htdemucs 43–58 dB; htdemucs_6s 56–72 dB on loud stems, 26–27 dB on the near-silent `other`/`piano` (max abs error 5e-5–7e-5, the smallest in the table). Both exports reproduce the reference. Parent spot check: re-ran `compare_onnx.py`, identical table.
- [x] S2.3 — Browser harness. `spikes/s2/index.html` + `spikes/s2/harness.js`: onnxruntime-web pinned from jsdelivr; provider selector (webgpu / wasm); model fetch from the pinned Hugging Face `resolve` URL with byte progress and SHA-256 check, cached in the Cache API; audio file input decoded with `decodeAudioData`; JS pre/post-processing matching S2.1; window loop with 25 % overlap and linear cross-fade; timing per model per provider; peak `performance.memory` where available; optional reference-stem upload for max abs error and SNR in the browser; results as a copyable JSON block. Served with `python -m http.server` from `spikes/s2/`.
  - Route: delegated writer after S2.1/S2.2 report. Checks: the excerpt runs on both providers on the user's machine and matches the Python ONNX errors from S2.2 within float tolerance.
  - Done 2026-09-20: `spikes/s2/index.html`, `harness.js`, `harness.worker.js`, `models.js`, `dsp/*`, `selftest.html`, `HARNESS.md`. onnxruntime-web 1.30.0 (ESM, jsdelivr), WASM forced to one thread, no COOP/COEP. Selftest: STFT round trip 8e-14, Python fixture match 7e-14. Parent spot check in the built-in browser (WASM, htdemucs, 30 s excerpt): SNR 57.2/42.8/45.2/52.8 dB vs Python 57.9/42.9/45.3/53.1; 6 windows, ~14.9 s per window, 0.33x real time single-threaded in the sandbox. Two reporting bugs found and fixed (detached buffer read as duration 0; heap sampled on the wrong thread). WebGPU runs on the reference machine belong to S2.4.
- [x] S2.4 — Measurements and decision. The user runs the harness on the full 5-minute song for timing and on the excerpt for accuracy, on Edge, both providers, both models. Parent records the numbers and writes `docs/decisions/spike-s2.md` with the go/no-go: runtime confirmed or not, which export needs re-export, WASM fallback viable or not, drop-zone ceiling revisited.
  - Route: inline. Checks: table of timings, errors and memory with date and machine; decision stated.
  - Done 2026-09-20: `docs/decisions/spike-s2.md`. User-run on Ryzen 7 5800X / Edge 153: WebGPU accepts both graphs; browser errors identical to Python; full 4:02 song in 23.9 s (6 stems, 10.1× realtime) and 35.6 s (4 stems, 6.8×). Decision: go for ONNX Runtime Web with WebGPU first. Pending measurement, not blocking: WASM provider timing on the reference machine (sandbox: 0.33× single-threaded); recorded as a P7b follow-up.

## Acceptance criteria
- Both graphs inspected and documented; hashes verified.
- Python-side ONNX error against Demucs reference known per stem for both models.
- Browser timings on WebGPU and WASM for a 5-minute song on the reference machine.
- Decision note merged to `master`.

## Progress / evidence
- 2026-09-20 — branch `spike/s2-onnx-runtime` created; feature document created.
- 2026-09-20 — S2.1 and S2.2 done and verified; exports numerically sound. Route: delegated worker (downloads + Python across two venvs).
- 2026-09-20 — S2.3 done and spot-checked. Route: delegated writer (10 files).
- 2026-09-20 — Harness mismatch fix (`ac1f87d`, inline, 3 files) after the user hit `invalid input 'mag'`.
- 2026-09-20 — S2.4 done: four WebGPU runs reported by the user; decision note written. Spike closed with go.

## Next step
Merge `docs/decisions/spike-s2.md` and this document to `master`; keep `spikes/s2/` on the branch. Then P1 scaffold (`docs/decisions/phase-2-plan.md`). Optional extra measurement when convenient: WASM provider on the excerpt, 6-stem model, on the reference machine.
