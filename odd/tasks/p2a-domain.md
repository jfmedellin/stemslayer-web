# P2a — Profiles, pipeline identity, and track state

Status: P2A-01 implemented and verified; P2A-02 pending. Delivery strategy: `ask-on-risk`; chain strategy: `stacked-to-main`.

## Objective

Implement the first pure domain slice for Stemslayer Web: the Basic and Rock stem profiles, deterministic pipeline fingerprints through a minimal `HashPort`, and the track status state machine.

## Problem / why

Later catalog, storage, and inference work needs stable profile identity and legal track transitions before adapters or orchestration are introduced. Keeping these rules pure makes them testable without browser infrastructure and preserves desktop-compatible pipeline fingerprints.

## Scope

- Define the Basic and Rock profiles with validated raw outputs, ordered published lanes, residual folding, and the Rock center/sides guitar split metadata.
- Produce canonical pipeline identity data with stable key order, explicit nulls, ordered arrays, UTF-8 encoding, and no insignificant whitespace.
- Define only the `HashPort` needed to hash canonical pipeline identity and an application function that returns the SHA-256 fingerprint.
- Define the track entity and the six statuses: `preparing`, `processing`, `ready`, `failed`, `interrupted`, and `unavailable`.
- Enforce the accepted transition matrix and immutable identity fields.

## Out of scope

- P2b identity claims, duplicate ordering, adoption, retry selection, or ready reuse.
- IndexedDB, OPFS, browser locks, manifests, model downloads, DSP, inference, audio, or UI behavior.
- Specialist profiles, Metal Roles, or Lead/Rhythm claims for guitar lanes.
- Any remote operation or modification of the open P1 pull request.

## Constraints and decisions

- Internal profile IDs remain `legacy-four-stem` and `metal-stereo-six-stem`; Basic and Rock are user-facing names.
- Basic publishes `vocals`, `drums`, `bass`, and residual `other`.
- Rock consumes the six-stem model, folds `piano` into residual `other`, and publishes positional `guitar_center` and `guitar_sides` lanes through `center-sides-v1`.
- Pipeline identity excludes cosmetic fields and preserves the desktop field set and canonical order.
- An unassigned `sourceHash` is absent rather than null so the future IndexedDB compound index omits incomplete identities.
- Domain code remains dependency-free. Canonicalization belongs to domain; hashing orchestration belongs to application through `HashPort`.
- Artifacts and code are English; commits use Conventional Commits with no AI attribution.

## Development and runner mode

Strict TDD is enabled by the project architecture and repository instructions. Each implementation task must show observed RED, GREEN, and REFACTOR evidence.

| Command | Purpose |
|---|---|
| `npm test -- tests/domain/stem-profile.test.ts tests/application/create-pipeline-fingerprint.test.ts` | Focused profile and fingerprint tests. |
| `npm test -- tests/domain/track.test.ts` | Focused track state-machine tests. |
| `npm test` | Full Node regression suite. |
| `npm run lint` | Architectural and source lint checks. |
| `npm run typecheck` | Strict TypeScript check. |
| `npm run test:browser` | Existing browser regression check. |
| `npm run build` | Production-build regression check. |

## Tasks

- [x] **P2A-01 — Implement profiles and deterministic fingerprints.**
  - Route: delegated direct. Trigger: multiple non-trivial domain, application, and test files plus strict-TDD evidence.
  - RED: profile invariants, canonical serialization, known Basic/Rock digest vectors, cosmetic-field exclusion, and identity-changing pipeline fields.
  - GREEN/REFACTOR: minimal dependency-free domain model, canonicalizer, `HashPort`, application hashing function, and clean names/boundaries.
  - Rollback: profile domain files, fingerprint application/port files, and their tests only.
- [ ] **P2A-02 — Implement the track status machine.**
  - Route: delegated direct. Trigger: non-trivial entity rules and tests across multiple files.
  - RED: initial status, all allowed and rejected transitions, same-state metadata behavior, absent pre-identity source hash, and immutable identity fields.
  - GREEN/REFACTOR: minimal track entity and transition API without P2b claim rules.
  - Rollback: track domain file and its tests only.
- [ ] **P2A-03 — Close the feature.**
  - Route: delegated verification plus parent-owned commit and native assessment.
  - Evidence: exact focused/full check results, RED/GREEN/REFACTOR history, authored-line count, rollback boundaries, commit identities, and review outcomes.

## Acceptance criteria

- [x] Basic and Rock exactly preserve the decided model outputs, lane order, residual behavior, and positional guitar naming.
- [x] Invalid profile definitions fail deterministically.
- [x] Canonical identity produces the known Basic digest `2b0c71ec79d6c660c43842a8f45c99f4fbddf22e8cb5a81e4105a8284743ca69`.
- [x] Canonical identity produces the known Rock digest `dc80db8098e29c07b43c90ca38bba381433ad6c3c3a43e096521773ff4813351`.
- [x] Cosmetic changes do not affect identity; pipeline changes do.
- [ ] Track transitions accept only the documented matrix and preserve immutable identity fields.
- [x] Domain code imports no external packages or application/infrastructure/UI modules.
- [ ] All focused and regression checks pass with observed strict-TDD evidence.

## Forecast and delivery

Forecast: approximately 430–510 authored changed lines including tests and this tracker. Generated files are not expected. The user selected `stacked-to-main`: slice 1 contains P2A-01 profiles/fingerprint; slice 2 contains P2A-02 track/state machine plus feature closure. Each PR merges to `main` in order after P1. No code-golf or omitted tests are allowed.

P2a branches from the P1 commit `18230e5` while PR #2 remains open. Publication must not merge or retarget P1 without separate authorization.

## Applicable checks

- Required per task: the focused Vitest command with observed RED then GREEN.
- Required before closure: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser`, and `npm run build`.
- Runtime harness: N/A. P2a is pure domain/application behavior with no new browser runtime boundary; the existing browser suite remains a regression check.
- Review: inspect dependency boundaries, canonical byte/string fixtures, transition coverage, authored changed-line count, and absence of P2b/infrastructure scope.

## Progress / evidence

- 2026-09-21 RED — `npm test -- tests/domain/stem-profile.test.ts tests/application/create-pipeline-fingerprint.test.ts` exited 1: both suites failed to import the intentionally absent domain/application modules (0 tests collected).
- 2026-09-21 GREEN — the same focused command passed: 2 files, 16 tests. Known Basic/Rock hashes, canonical strings, profile invariants, cosmetic exclusion, and pipeline changes are covered.
- 2026-09-21 REFACTOR — boundaries and names reviewed without behavior changes; focused rerun passed 2 files and 16 tests, `npm run lint` exited 0, and `npm run typecheck` exited 0.
- 2026-09-21 regression — `npm test` passed 3 files/22 tests; `npm run test:browser` passed 1 file/1 test; `npm run build` passed with 16 transformed modules. Runtime harness remains N/A because this slice adds pure domain/application behavior.
- 2026-09-21 delivery — slice 1 is 465 Git-authored additions including this tracker; the user authorized `size:exception` for the corrected count. Rollback removes `src/domain/stem-profile.ts`, `src/application/create-pipeline-fingerprint.ts`, `src/application/ports/hash-port.ts`, and both profile/fingerprint test files; commit and native assessment remain parent-owned.

## Next step

Commit and assess the verified P2A-01 work unit, then begin P2A-02 without changing this slice's rollback boundary.
