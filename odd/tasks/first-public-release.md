# First Public Release — Vercel Hobby Readiness

## Objective

Ship the first public Stemslayer Web release only after the client-side app, its production artifact, model supply chain, browser security controls, and hosting path have observable evidence of readiness.

## Problem and Why

The current app is functional in local tests but is not release-ready: lint and typecheck failed in the 2026-09-24 audit, the existing `dist` contains an uncompiled TypeScript AudioWorklet, uploaded files are fully read before resource limits are enforced, model downloads are bounded only after completion, and no Vercel header policy exists. A public URL would expose these gaps to users and make failures harder to diagnose or reverse.

## Scope and Authorization

- This document authorizes **planning only**. It does not authorize source changes, dependency installation or registry access, Vercel/GitHub account access, push, deployment, release tagging, or public launch.
- Target architecture: static Vite/React app on Vercel Hobby; audio and results stay in browser storage; model weights are fetched directly from pinned third-party mirrors and verified before use. Accounts and cloud sync are out of scope.
- Preserve the existing GitHub Pages workflow until the owner chooses the production delivery path. Do not accidentally publish a second production site by pushing to `main`.
- Preserve the documented Demucs weight-license caveat. Technical checks cannot grant a license or settle the owner's legal risk decision.
- Each implementation task, once separately authorized, gets tests and documentation with its behavior and closes with a Conventional Commit. Do not treat a checkbox or this plan as release approval.

## Baseline and Constraints

| Item | Last observed evidence (2026-09-24) | Required exit |
| --- | --- | --- |
| Working tree | Clean on `feat/p7b-onnx-worker` after responsive-navigation work | Recheck branch and changes before implementation and release |
| Lint | Fails: `no-control-regex` in `src/infrastructure/cache-api/cache-api-model-store.ts:34` | Passes |
| Typecheck | Fails: TS2493 in `src/infrastructure/cache-api/cache-api-model-store.browser.test.ts:130` | Passes |
| Node tests | 34 files / 367 tests passed | Passes after changes |
| Browser tests | 22 files / 155 tests passed | Passes after changes |
| Production build | Not freshly validated because typecheck fails; existing `dist/assets/mixer-processor-*.ts` contains TypeScript | Fresh build and deployed mixer smoke test pass |
| Security | No app backend or tracked obvious secret pattern in local scan; no complete advisory/history audit | Complete the targeted checks below |
| RDD | User-disabled in prior project context | Do not re-enable or invoke review lifecycle without user instruction |

Strict TDD is enabled by project instruction. For implementation, observe RED → GREEN → REFACTOR with the applicable exact runner (`npm test` for Node or `npm run test:browser` for browser behavior), then run the full checks. Reconfirm configuration on resume. Delivery strategy is `ask-on-risk`; preliminary forecast is roughly 700–1,200 authored changed lines across all work units, not a per-task cap. Before the next commit after the running total approaches 400, obtain the chain strategy or another explicit delivery choice. This estimate is a planning heuristic, not a reason to omit tests or compress code.

## Work Units

### Gate A — Make the artifact trustworthy

- [ ] **REL-01 — Restore a green validation baseline.** Fix the lint and TypeScript failures without suppressing useful rules; add/adjust focused regressions where behavior changes. **Accept:** `npm run lint`, `npm run typecheck`, `npm test`, and `npm run test:browser` all pass. **Route forecast:** delegated direct if both production and test logic need non-trivial edits; otherwise inline for a single mechanical fix. **Evidence:** exact command results and commit ID.
- [ ] **REL-02 — Verify the production AudioWorklet and build.** Establish a failing production-artifact or served-build regression for the mixer, then ensure Vite emits executable JavaScript with resolvable imports and the correct MIME type. Test actual playback in the built app, not only the injected worklet test fixture. **Accept:** `npm run build` passes; no raw TypeScript worklet is served; a production-preview mixer smoke test plays a known stem. **Route forecast:** delegated direct (build wiring, browser regression, and source are separate non-trivial surfaces). **Evidence:** artifact inspection, browser result, and commit ID.

### Gate B — Bound untrusted inputs and dependencies

- [ ] **REL-03 — Bound local audio input before allocation.** Decide a documented maximum source byte size and duration based on measured desktop-browser memory. Reject oversized or unsupported files before `file.arrayBuffer()`; enforce duration after decoding; handle malformed/empty media and concurrent selection safely. Keep the UI copy aligned with actual limits. **Accept:** browser tests for boundary, malformed, and repeated selection; a resource-stress smoke test does not freeze the tab. **Route forecast:** delegated direct (UI, validation, tests). **Evidence:** limits, test results, and commit ID.
- [ ] **REL-04 — Bound model downloads while streaming.** Reject an overlong response as soon as received bytes exceed the pinned manifest size; cancel the reader, leave no unverified cache entry, and preserve existing SHA-256 verification for exact-size data. Check redirects/CORS and failure messaging without logging sensitive browser data. **Accept:** tests cover exact size, excess bytes, failed stream, digest mismatch, and cache recovery. **Route forecast:** delegated direct if adapter and tests both need non-trivial edits. **Evidence:** focused and full test results, commit ID.
- [ ] **REL-05 — Audit the software and model supply chain.** With separately authorized registry/network access, review the lockfile's production and build-time advisories, exploitability, update path, and licenses; inspect committed history for secrets without printing them; confirm the pinned model origins, integrity hashes, CORS behavior, and notices. Avoid reflexive major upgrades: record mitigation or accepted risk per finding. **Accept:** no unexplained critical/high exploitable finding, no exposed credential requiring rotation, and a dated evidence log. **Route forecast:** read-only audit first; any fixes become scoped work units. **Evidence:** advisory sources, exact versions, and disposition.

### Gate C — Protect the browser deployment

- [ ] **REL-06 — Configure and verify Vercel response headers.** Add a restrictive, tested CSP and relevant browser security headers through Vercel configuration. Account explicitly for Vite modules, AudioWorklet, workers, WebAssembly/WebGPU, and the Hugging Face/CDN model fetches; do not add COOP/COEP casually because current WASM fallback is single-threaded and cross-origin model loading must keep working. **Accept:** headers observed on served HTML and assets; normal inference and mixer work; forbidden script/connect probes are blocked. **Route forecast:** delegated direct (deployment config plus browser coverage). **Evidence:** observed headers, regression results, commit ID.
- [ ] **REL-07 — Confirm privacy and storage behavior.** Verify that input audio and stems are never sent to the hosting origin or analytics, that data is isolated to the browser origin, and that eviction, shared-device access, and origin changes are explained accurately. Check error messages and logs for accidental filenames, paths, or audio bytes. **Accept:** network inspection through upload/separation/export and a concise public privacy/storage notice matching behavior. **Route forecast:** delegated direct if code and docs change; otherwise read-only verification. **Evidence:** network capture summary, notice location, commit ID if changed.

### Gate D — Rehearse and decide the release

- [ ] **REL-08 — Choose one production delivery path and configure a protected preview.** Decide whether GitHub Pages remains active, is retired, or is intentionally a mirror; configure Vercel build/output/base path and deployment protection accordingly. Vercel Hobby is for personal/non-commercial use; verify plan fit at decision time. Do not deploy or use an account until destination, operation, and credential/session are explicitly authorized. **Accept:** no accidental parallel public release; preview access and routing behave as intended; production domain remains unpublished until go/no-go. **Route forecast:** configuration/documentation work unit after the owner's choice. **Evidence:** configuration readback and preview URL only after authorization.
- [ ] **REL-09 — Run the release acceptance matrix on the production build.** Exercise upload → separation → library → mixer → WAV/ZIP export; both Basic and Rock; WebGPU and WASM fallback; bad model/network response; cancellation/retry; low storage, refresh, and data eviction. Include target browser matrix, keyboard/accessibility checks, and performance/large-file measurements. **Accept:** all supported paths pass; failures have clear dispositions; accessibility and performance targets are recorded before go/no-go. **Route forecast:** verification first, with separate scoped fixes for findings. **Evidence:** dated browser/device matrix and results.
- [ ] **REL-10 — Resolve legal/product and launch decisions.** Owner explicitly decides whether the scientific-use-only Demucs weight restriction is acceptable for this public, non-commercial release, and approves the public privacy copy, domain, support channel, and release scope. Prepare version/changelog, rollback procedure, and minimal post-launch monitoring. **Accept:** signed-off go/no-go record; no unresolved blocking issue; release tag/deployment only after separate authorization. **Route forecast:** decision and documentation; remote publishing is not implied by this plan. **Evidence:** decision record, final check results, release identity when authorized.

## Release Gate

**No-go** while any Gate A–C task is unchecked, a supported Gate D acceptance path fails, a critical/high exploitable dependency finding lacks disposition, the model-license decision is unresolved, or the exact production artifact has not been exercised. A green unit suite alone is insufficient.

At final review, capture the commit, artifact hash, commands and results, supported-browser matrix, known limitations, and rollback target. Record failed, skipped, unavailable, and pending checks explicitly; never convert them into a pass. Publication and release tagging require a separate explicit user instruction.

## Progress

- Plan created from the 2026-09-24 local read-only audit; no implementation task has started or been checked off.
- Current evidence must be refreshed before implementation because the repository and hosting policies can change.

## Next Step

Start with REL-01 after the user authorizes implementation. Recheck the working tree and TDD runner first; keep this document and its Engram mirror synchronized after each completed work unit.
