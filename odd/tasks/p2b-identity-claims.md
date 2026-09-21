# P2b — Identity claims and duplicate ownership

Status: P2B-01 implemented and verified; P2B-02 pending. Delivery strategy: `ask-on-risk`; chain strategy: `stacked-to-main`.

## Objective

Implement pure domain decisions for duplicate identity ownership, preferred-owner ordering, ready reuse, awaiting active work, and retry adoption without performing persistence, locking, or orchestration.

## Problem / why

The application must make one deterministic decision when multiple catalog rows refer to the same source bytes and pipeline. Encoding that policy as pure functions prevents duplicate separations and keeps later IndexedDB and Web Lock adapters focused on atomic execution rather than business rules.

## Scope

- Define identity as exact equality of `sourceHash` and `pipelineFingerprint`.
- Select the preferred existing owner using status rank and newest creation timestamp.
- Exclude tracks without identity and exclude the current candidate from competitor selection.
- Plan one of four outcomes: `claim-candidate`, `reuse-ready`, `await-owner`, or `adopt-and-retry`.
- Treat `failed`, `interrupted`, and `unavailable` owners as retry-adoptable.
- Add an explicit, guarded retry-only operation that rebinds source identity without weakening ordinary track immutability.

## Out of scope

- IndexedDB uniqueness, Web Locks, concurrency control, persistence, deletion, queueing, transitions, separation, or side effects.
- P3 application orchestration and P4 infrastructure behavior.
- Mutation of input catalog snapshots or tracks.
- Remote operations or changes to pending P1/P2a pull-request delivery.

## Constraints and decisions

- Owner rank is `ready > processing > preparing > terminal`, where terminal groups `failed`, `interrupted`, and `unavailable`.
- Newest `createdAtUtc` wins within a rank; catalog order is the final tie-break for equal timestamps.
- A different source hash or pipeline fingerprint is not a duplicate.
- A ready owner is reused; a processing/preparing owner is awaited; a terminal owner is adopted and retried.
- General `sourceHash` immutability remains. The user explicitly approved a narrow retry-rebind operation for changed source bytes.
- Pure functions return decisions only and never execute the later action.
- Artifacts and code are English; commits use Conventional Commits with no AI attribution.

## Development and runner mode

Strict TDD is enabled. Every implementation task records observed RED, GREEN, and REFACTOR evidence.

| Command | Purpose |
|---|---|
| `npm test -- tests/domain/identity-claim.test.ts` | Focused identity-claim tests. |
| `npm test -- tests/domain/track.test.ts` | Focused retry-rebind regression tests when track behavior changes. |
| `npm test` | Full Node regression suite. |
| `npm run lint` | Architectural and source lint checks. |
| `npm run typecheck` | Strict TypeScript check. |
| `npm run test:browser` | Existing browser regression check. |
| `npm run build` | Production-build regression check. |

## Tasks

- [x] **P2B-01 — Match identity and select the preferred owner.**
  - Route: delegated direct. Trigger: new domain module plus a substantial translated test matrix.
  - RED: exact two-field identity, missing-source exclusion, candidate exclusion, rank ordering, newest-within-rank ordering, and stable catalog-order tie-break.
  - GREEN/REFACTOR: minimal immutable types and pure owner-selection functions.
  - Rollback: owner-selection domain code, tests, and this slice's tracker evidence only.
- [ ] **P2B-02 — Plan claims and guarded retry rebinding.**
  - Route: delegated direct. Trigger: claim-decision union, terminal-owner semantics, and a narrow amendment to the track entity with tests.
  - RED: all four decision outcomes, failed/interrupted/unavailable adoption, different-pipeline/source independence, missing candidate, immutability, and changed-bytes retry rebinding.
  - GREEN/REFACTOR: pure claim planner plus explicit guarded retry-only identity rebind; no orchestration.
  - Rollback: claim-planning additions, retry-rebind amendment, related tests, and this slice's tracker evidence only.
- [ ] **P2B-03 — Close the feature.**
  - Route: parent-owned commits, exact native assessments, and final mirror update.
  - Evidence: focused/full checks, strict-TDD history, authored counts, rollback boundaries, commit identities, and native review outcomes.

## Acceptance criteria

- [x] Identity matching requires exact source hash and pipeline fingerprint equality.
- [x] Preferred-owner ordering matches the decided rank, timestamp, and stable tie-break rules.
- [ ] No owner produces `claim-candidate`.
- [ ] Ready produces `reuse-ready`; processing/preparing produce `await-owner`.
- [ ] Failed, interrupted, and unavailable produce `adopt-and-retry`.
- [x] Different source bytes or pipeline fingerprints remain independent.
- [ ] Retry rebinding is explicit and guarded; ordinary identity remains immutable.
- [x] Catalog snapshots and tracks are not mutated.
- [ ] All focused and regression checks pass with observed strict-TDD evidence.

## Forecast and delivery

Forecast: approximately 390–460 authored changed lines including tests and this tracker. Generated files are not expected. The cached `stacked-to-main` strategy applies to P2: slice 1 contains owner matching/selection; slice 2 contains claim planning, retry rebinding, and closure. Each PR merges to `main` in order only after P1 and both P2a slices.

P2b branches from P2a commit `a203880`. No pending remote branch or pull request is modified without separate authorization.

## Applicable checks

- Required per task: focused Vitest with real RED then GREEN.
- Required before closure: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser`, and `npm run build`.
- Runtime harness: N/A. P2b is pure domain behavior; existing browser checks remain regression evidence.
- Review: verify rank/tie semantics, mutation resistance, explicit retry rebind, P2b-only scope, and authored-line counts.

## Progress / evidence

- 2026-09-21 — Read-only mapping completed from the phase plan, browser-storage decision, P2a domain code, and desktop history behavior/tests.
- 2026-09-21 — User resolved the contract conflict: unavailable owners are retry-adoptable, and changed-byte retries use an explicit guarded identity rebind.
- 2026-09-21 — Created `feat/p2b-identity-claims` from P2a commit `a203880`.
- 2026-09-21 P2B-01 RED — `npm test -- tests/domain/identity-claim.test.ts` exited 1 because the intentionally absent `src/domain/identity-claim.ts` could not be imported; 0 tests were collected.
- 2026-09-21 P2B-01 GREEN — the first implementation run exposed three test-helper failures because an explicit `undefined` activated a default hash; changing the fixture sentinel to `null` made the focused command pass 1 file/16 tests.
- 2026-09-21 P2B-01 REFACTOR — the pure selection loop and immutable API required no behavior change; the focused rerun passed 1 file/16 tests, `npm run lint` exited 0, and `npm run typecheck` exited 0.
- 2026-09-21 P2B-01 regression/delivery — `npm test` passed 5 files/85 tests; `npm run test:browser` passed 1 file/1 test; `npm run build` passed with 16 transformed modules. Runtime harness is N/A. Slice 1 is 307 Git-authored additions; rollback removes `src/domain/identity-claim.ts`, `tests/domain/identity-claim.test.ts`, and this tracker evidence. Commit/native assessment remain parent-owned.

## Next step

Commit and assess P2B-01, then implement P2B-02 without changing this slice's rollback boundary.
