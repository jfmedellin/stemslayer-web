# P6 — Cache API model store

Status: P6-01 committed and assessed; P6-02 pending. Delivery strategy: `ask-on-risk`; chain strategy: `feature-branch-chain`.

## Objective

Implement the browser `ModelStorePort` with pinned model manifests, streaming Cache API downloads, byte progress, SHA-256 verification, fail-closed cache behavior, and atomic revision replacement.

## Problem / why

Inference must never consume incomplete, stale, or unverified model weights. P6 needs a browser adapter that preserves a previously verified revision while a replacement downloads and only activates the replacement after its bytes and digest are proven.

## Scope

- Define a typed manifest keyed by `profileId` with pinned URL, revision, byte size, and SHA-256 digest.
- Implement `CacheApiModelStore` for `ModelStorePort`.
- Stream downloads and report monotonic byte progress.
- Verify SHA-256 before first use or revision activation.
- Reuse verified cache hits without network access.
- Keep the previous verified revision until a replacement is completely verified.
- Remove obsolete revisions for the same profile only after successful activation.

## Out of scope

- ONNX inference execution and worker lifecycle.
- UI progress presentation.
- OPFS stem persistence, quota policy, and P5 behavior.
- Service-worker installation or application composition.
- Remote publication or restructuring the existing PR chain.

## Constraints and decisions

- Branch from `feat/p4-browser-adapters` (`2dfcb8c`) because P4, P5, and P6 are parallelizable and P6 requires `WebCryptoHash` but not P5.
- Cache identity includes profile and revision; Basic and Rock use independent pinned revisions.
- Unknown profiles, network failures, stream failures, byte-count mismatches, and digest mismatches fail closed with typed errors.
- A failed replacement must not remove or replace the prior verified revision.
- Strict TDD is enabled; every implementation task records observed RED, GREEN, and REFACTOR evidence.
- Artifacts and code are English; commits use Conventional Commits without AI attribution.

## Pinned manifest

| Profile | Revision | SHA-256 | Bytes |
|---|---|---|---:|
| Basic | `850cd89461d0817276337061c29e6abceb86d75f` | `e528a932a7d091e15938369135569884b62c2193fb11044c3d4a0d4c7b9221af` | 174266088 |
| Rock | `0c850a01007f48d94900b21b49a0d0ae1a17239f` | `a3f5050696cda4b2344d465123acb21ee699dad7d0634dba1d282497a04ac86a` | 284797240 |

The pinned URLs must match `spikes/s2/models.js`; final verification must also reconcile `docs/decisions/weight-mirrors.md`.

## Tasks

- [x] **P6-01 — Add the pinned manifest and verified streaming cache adapter.**
  - Route: delegated direct. Trigger: new infrastructure adapter, manifest, typed failures, and browser tests span multiple non-trivial files.
  - RED: unknown profile; cold download progress; verified cache hit without network/progress; network/stream/size/digest failures; failed entries removed.
  - GREEN/REFACTOR: minimal typed manifest and `CacheApiModelStore` implementation.
  - Rollback: manifest, adapter, focused browser tests, and this task's tracker evidence.
- [ ] **P6-02 — Make revision replacement atomic.**
  - Route: delegated direct. Trigger: multi-cache lifecycle behavior plus failure-preservation tests.
  - RED: failed replacement preserves prior revision; successful replacement activates the new revision and removes only obsolete revisions for the same profile.
  - GREEN/REFACTOR: profile+revision cache identity and post-verification cleanup.
  - Rollback: revision transition behavior and its tests without removing P6-01 cache verification.
- [ ] **P6-03 — Close the feature.**
  - Route: parent-owned commits, assessments, final verification evidence, and Engram mirror update.
  - Evidence: focused/full checks, strict-TDD history, authored counts, rollback boundaries, commit identities, and delivery decision.

## Acceptance criteria

- [x] Progress reports received bytes monotonically and ends at the actual verified byte count.
- [x] Manifest metadata exactly matches the S2 decision evidence.
- [x] Unknown profiles and all unverified content fail closed with typed errors.
- [x] A verified cache hit performs no network access and emits no download progress.
- [x] A digest or size mismatch removes the new invalid entry and never exposes its bytes.
- [ ] A failed revision replacement preserves the previous verified revision.
- [ ] A successful replacement activates the new revision and removes only obsolete revisions for the same profile.
- [x] Inputs and returned metadata are immutable where applicable.
- [x] Focused and regression checks pass with observed strict-TDD evidence for P6-01.

## Forecast and delivery

Forecast: approximately 350–500 authored changed lines including browser tests and this tracker. Natural review slices are verified download/cache behavior, then atomic revision replacement. The 400-line value is a review heuristic, never a reason to reduce tests or compress code. The user selected `feature-branch-chain` for P6, matching the current remote topology.

No remote operation is authorized by this tracker.

## Applicable checks

- Focused RED/GREEN: `npm run test:browser -- src/infrastructure/cache-api/cache-api-model-store.browser.test.ts`.
- Closure: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:browser`, and `npm run build`.
- Review focus: manifest integrity, streamed progress, cache-hit behavior, fail-closed verification, and atomic revision activation.

## Progress / evidence

- 2026-09-21 — Branch and PR audit confirmed P1–P5 implementation exists, the open delivery chain is clean, and P6 has no implementation or issue yet.
- 2026-09-21 — Read-only mapping confirmed P6 is parallel to P5 and should branch from P4 commit `2dfcb8c`.
- 2026-09-21 — Created `feat/p6-model-store` from `feat/p4-browser-adapters`.
- 2026-09-21 — P6-01 RED: focused browser command failed before collection because `cache-api-model-store` did not exist.
- 2026-09-21 — P6-01 GREEN: focused browser command passed 8 tests covering immutable pins, unknown profiles, streamed progress, verified cache hits, network/stream failures, size/digest failures, and invalid-entry cleanup.
- 2026-09-21 — P6-01 REFACTOR/verification: focused browser tests remained 8/8; typecheck and lint passed; node tests passed 175/175; full browser tests passed 25/25; production build passed. The work unit adds 390 source/test lines before tracker evidence. Runtime harness: browser-project tests exercise Chromium Cache API, Fetch Response streams, and WebCrypto. Rollback boundary: remove `src/infrastructure/cache-api/` without affecting the existing application port or P1–P5 behavior. Commit and native assessment remain parent-owned.
- 2026-09-21 — User selected `feature-branch-chain` for P6 after the observed feature record plus P6-01 implementation exceeded the 400-line review heuristic.
- 2026-09-21 — P6-01 source/test commit `2c78803ebb76cd975ce430af743e39583179397e` (`feat(infrastructure): add verified Cache API model store`) contains 390 authored additions. Native assessment was medium/under_budget, so review remains pending in the feature slice.

## Next step

Commit this tracker evidence, assess the resulting slice, then execute P6-02 without weakening P6-01 verification.
