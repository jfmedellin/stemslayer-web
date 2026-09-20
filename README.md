# Stemslayer Web

A free, static, in-browser stem separator: the web counterpart of the
[Stemslayer desktop app](https://github.com/jfmedellin/separador-pistas).
Separation runs entirely in the browser (Demucs compiled to WebAssembly/WebGPU);
nothing is uploaded and there is no server.

## Status

Phase 2 scaffold: the empty React shell and validation pipeline are in place.
Product behavior, model downloads, audio processing, storage, and phone support
are intentionally not part of this foundation.

## Relationship to the desktop app

This is a rewrite, not a port. The desktop app's design, stem profiles, mixer
semantics and its `Tests/Portable` suite are the specification; its Python code
does not run here.

## Local setup

Requirements: Node.js 24 and npm 11.

```sh
npm ci
npx playwright install chromium
npm run dev
```

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser`,
and `npm run build` before proposing changes. The browser target is desktop and
landscape tablet; phone support remains deferred.

## Model-weight risk

Demucs pretrained weights are not covered by the Demucs MIT license. Their
maintainer describes them as scientific-use only. This project accepts that
risk for its free, non-commercial use case, but **never redistributes model
weights**. Future builds will fetch pinned third-party mirrors at runtime and
verify their SHA-256 hashes. See the [license audit](docs/decisions/licenses.md)
and [mirror decision](docs/decisions/weight-mirrors.md).

## Third-party notices

- ONNX Runtime and ONNX Runtime Web are MIT-licensed by Microsoft.
- Demucs source code is MIT-licensed by Facebook Research; that grant does not
  cover pretrained weights.
- The planned Basic-profile mirror is `Ghilda/htdemucs-onnx`.
- The planned Rock-profile mirror is `kramp/htdemucs-6s-webgpu-onnx`, with
  `StemSplitio/htdemucs-6s-onnx` retained as a fallback reference.

Mirror-hosted license tags do not override the upstream scientific-use limit.
The repository contains no model files and does not claim redistribution rights.
