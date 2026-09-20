# License audit — Demucs-in-browser stack (T2)

Date: 2026-09-20. Sources read on that date; primary sources (raw LICENSE files, GitHub license API, repository READMEs, the `facebookresearch/demucs` issue thread) unless noted. Collected by a research worker; the weights finding was re-verified by hand with `gh issue view 327 --repo facebookresearch/demucs --comments`.

## 1. Table

| Item | License | Source | Code reuse | Weight redistribution | Static hosting | Attribution | Classification |
|---|---|---|---|---|---|---|---|
| demucs.cpp (sevagh) | MIT | https://raw.githubusercontent.com/sevagh/demucs.cpp/main/LICENSE | Yes | n/a, inference code only | Yes | Keep copyright and MIT notice | May reuse code |
| free-music-demixer (sevagh, repo) | MIT for the WASM/JS code; README excludes the model weights and site assets ("proprietary, not covered by the MIT license") | https://github.com/sevagh/free-music-demixer | Yes, wrapper code only | No | Code yes; bundled weights and assets no | MIT notice for the code | May reuse code (not weights or assets) |
| freemusicdemixer.com (site) | No open-source release; now redirects (301) to musicdemixer.com | https://freemusicdemixer.com/ | No | No | No | n/a | Idea only |
| timcsy/demucs-web | MIT (GitHub license API) | https://github.com/timcsy/demucs-web | Yes | n/a, no weights of its own | Yes | Copyright and MIT notice | May reuse code |
| bengfarrell/demucs-wasm | MIT (GitHub license API); README states it was built by reverse-engineering the freemusicdemixer code and does not document the provenance of its converted weights | https://github.com/bengfarrell/demucs-wasm | Yes, its own code | Unverified, provenance undocumented | Code yes | Copyright and MIT notice | May reuse code; weights unresolved |
| Demucs source (facebookresearch) | MIT | https://raw.githubusercontent.com/facebookresearch/demucs/main/LICENSE | Yes | — | Yes | Copyright and MIT notice | May reuse code |
| Demucs pretrained weights (htdemucs, htdemucs_ft, htdemucs_6s) | **Not MIT.** Maintainer adefossez: "The model weights are not covered by the MIT license, and are provided only for scientific purposes." Contributor CarlGao4: trained on MusDB, whose terms restrict resulting models to research use. | https://github.com/facebookresearch/demucs/issues/327 | n/a | **No** | **No** grant to redistribute or serve from a public site | n/a | **Idea only as shipped weights** |
| ONNX Runtime / ONNX Runtime Web | MIT | https://raw.githubusercontent.com/microsoft/onnxruntime/main/LICENSE | Yes | n/a | Yes | Copyright and MIT notice | May reuse code |
| Eigen (demucs.cpp dependency) | MPL 2.0, file-level copyleft | https://gitlab.com/libeigen/eigen/-/blob/master/COPYING.MPL2 | Yes; modified Eigen files stay MPL 2.0 and source-available | n/a | Yes | Preserve MPL notices on Eigen files | May reuse code |
| libnyquist (demucs.cpp CLI dependency) | BSD-2-Clause | GitHub license API for `ddiakopoulos/libnyquist` | Yes | n/a | Yes | Copyright and license notice | May reuse code |

## 2. Findings

1. **The code layer is clear.** Every inference runtime and port considered (demucs.cpp, demucs-web, demucs-wasm, ONNX Runtime Web, Eigen, libnyquist, Demucs source) is MIT, BSD or MPL 2.0. No AGPL or other network-copyleft license appears, so the "public static site with no server" concern does not arise from code.
2. **The weights are the blocker.** The plan assumed the Demucs weights were MIT because the README used to say so. The maintainer's own statement in issue #327 contradicts that: the weights are outside the MIT grant and released for scientific purposes only, and the MusDB training data adds a research-only restriction. This applies to htdemucs and htdemucs_6s, the two models the desktop app ships and the web app planned to serve.
3. **Nobody upstream has cleared weights either.** free-music-demixer disclaims its weights as proprietary; demucs-wasm does not document where its ONNX weights come from. Reusing their code does not inherit any weight clearance.
4. **Redistribution versus use.** Serving the weight files from GitHub Pages is redistribution and is not granted. Fetching them at runtime from Meta's original host (`dl.fbaipublicfiles.com`), as the desktop app does, avoids redistribution but not the "scientific purposes only" scope, and it only works in a browser if that host sends permissive CORS headers, which has not been checked.

## 3. What this audit does not decide

Whether a free, non-commercial hobby site that fetches the weights from Meta's host at runtime falls inside "scientific purposes" is a legal judgement, not a technical one. The options are recorded in the feature document for the user's go/no-go: accept the risk with runtime fetching and no redistribution, replace the models with weights that carry a clear redistribution grant, or stop the web project.
