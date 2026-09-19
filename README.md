# Stemslayer Web

A free, static, in-browser stem separator: the web counterpart of the
[Stemslayer desktop app](https://github.com/jfmedellin/separador-pistas).
Separation runs entirely in the browser (Demucs compiled to WebAssembly/WebGPU);
nothing is uploaded and there is no server.

## Status

Phase 1: planning and validation, no product code yet. The plan, its tasks and
the evidence gathered so far live in
[`odd/tasks/stemslayer-web-static.md`](odd/tasks/stemslayer-web-static.md).

## Relationship to the desktop app

This is a rewrite, not a port. The desktop app's design, stem profiles, mixer
semantics and its `Tests/Portable` suite are the specification; its Python code
does not run here.
