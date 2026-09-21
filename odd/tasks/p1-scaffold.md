# P1 — Establish the web scaffold

Status: implemented and locally verified; ready for the work-unit commit. Delivery strategy: `exception-ok` after the user approved a cohesive P1 `size:exception`.

## Objective

Create the smallest deployable foundation for Stemslayer: Vite 8, React, strict TypeScript, two Vitest 4 projects, architectural import boundaries, Dragon Atelier foundations, an empty application shell, CI/Pages delivery, and the required risk and attribution documentation.

## Problem / why

Phase 2 needs one reproducible baseline before product behavior is added. Without it, later work could mix toolchain setup, architecture enforcement, UI foundations, and feature code, making failures and rollback boundaries difficult to review.

## Scope

- Configure Vite 8, React, and TypeScript with `strict` enabled.
- Configure Vitest 4 as a Node project for future `domain`/`application` tests and a browser project using Playwright Chromium for future `infrastructure`/`ui` checks.
- Establish `src/domain`, `src/application`, `src/infrastructure`, and `src/ui`, with ESLint import restrictions enforcing `domain → application → infrastructure/ui` dependency direction.
- Add Dragon Atelier foundational CSS custom properties from `docs/decisions/design-reference.md` and render an empty, accessible app shell without feature behavior.
- Add one GitHub Actions workflow for typecheck, unit tests, browser tests, build, and GitHub Pages deployment from `main` only.
- Update the README with the accepted scientific-use model-weight risk and third-party notices for ONNX Runtime (MIT), Demucs code (MIT), and the selected model-mirror attributions. No model weights enter the repository.

## Out of scope

- Domain, application, storage, inference, audio, upload, library, mixer, or export behavior.
- Model downloads, runtime adapters, service-worker isolation, and deployment execution.
- Product-page implementation from Stitch screens; those remain references for P8–P11.
- Phone support and responsive phone layouts.

## Confirmed device scope

Phase 2 supports desktop and landscape tablet. Phones are excluded until a phase-3 real-device feasibility spike establishes performance, memory, storage, and interaction viability. Existing phone Stitch screens are visual reference material only and are not acceptance targets for P1 or phase 2.

## Constraints and decisions

- Artifacts and UI copy are English; commits use Conventional Commits with no AI attribution.
- The repository is static, serverless, account-free, telemetry-free, and hosted on GitHub Pages.
- The repository must never contain model weights; later runtime fetches use pinned, hash-verified third-party mirrors.
- Architecture follows `docs/decisions/architecture.md`: `domain` is pure and isolated; `application` may use `domain`; `infrastructure` implements application ports and may not import `ui`; `ui` reaches use cases through containers.
- Dragon Atelier is dark-only and token-led. P1 copies foundational tokens without reinterpreting the product screens or adding a UI kit.
- The generated package lockfile is required for reproducible CI but excluded from the authored-line forecast.

## Development and runner mode

Strict TDD is reserved for future `domain` and `application` behavior: RED, GREEN, REFACTOR with Vitest. P1 contains no domain/application behavior, so scaffold work uses ordinary functional checks rather than artificial test-first assertions.

| Command | Runner / purpose |
|---|---|
| `npm run typecheck` | TypeScript no-emit strict check. |
| `npm test` | Vitest 4 Node project; must succeed even before behavioral suites exist. |
| `npm run test:browser` | Vitest 4 browser project through Playwright Chromium; includes a minimal shell smoke check. |
| `npm run lint` | ESLint, including architectural import-boundary rules. |
| `npm run build` | Vite 8 production build, including the GitHub Pages base-path contract. |
| `npm run dev` | Local Vite runner for a manual shell check at desktop and landscape-tablet widths. |

CI runs install from the lockfile, then lint, typecheck, Node tests, Playwright Chromium browser tests, and build. Deployment consumes the built artifact only on `main`; pull requests validate without deploying.

## Tasks

- [x] **P1-01 — Bootstrap the strict toolchain.** Create the Vite 8 + React package, strict TypeScript configs, deterministic scripts, and generated lockfile.
  - Route: delegated direct. Writer trigger: the implementation touches 2+ non-trivial files. Evidence: Vite 8.3.0, React 19.3.0, TypeScript 6.0.3; `npm install`, `npm ci`, typecheck, and build passed.
  - Rollback: package manifest, lockfile, Vite/TypeScript config, and bootstrap entry files only.
- [x] **P1-02 — Establish test projects.** Configure Vitest 4 Node and browser projects, Playwright Chromium, and the minimal empty-shell smoke fixture.
  - Route: delegated direct. Writer trigger: the implementation touches 2+ non-trivial files. Evidence: Vitest 4.1.11 Node and Playwright Chromium projects passed.
  - Rollback: Vitest/Playwright config and scaffold smoke test only.
- [x] **P1-03 — Enforce architectural boundaries.** Create the four source layer roots and ESLint rules that reject forbidden imports while permitting the decided dependency direction.
  - Route: delegated direct. Writer trigger: the implementation touches 2+ non-trivial files. Evidence: ESLint passed; six deterministic valid/invalid boundary cases passed.
  - Rollback: layer placeholders, ESLint config, and boundary-check fixtures only.
- [x] **P1-04 — Add Dragon Atelier foundations and the empty shell.** Add foundational tokens and a semantic, accessible shell sized for desktop and landscape tablet, without product features.
  - Route: delegated direct. Writer trigger: the implementation touches 2+ non-trivial files. Evidence: browser smoke and Chromium checks passed at 1440×900 and 1024×768; phone was not evaluated.
  - Rollback: shell, shell styles, and token files only.
- [x] **P1-05 — Add CI and Pages delivery.** Add one workflow that validates every change and deploys the Vite artifact only from `main`.
  - Route: delegated direct. Writer trigger: the implementation touches 2+ non-trivial files. Evidence: local equivalents passed; upload and deploy both guard on push to `refs/heads/main`. Remote deployment remains deferred.
  - Rollback: workflow file and Pages-specific Vite configuration only; repository settings are a separate remote boundary.
- [x] **P1-06 — Document accepted risk and notices.** Add setup/check instructions, the scientific-use weight-risk statement, no-redistribution rule, and third-party notices/attributions to the README.
  - Route: delegated direct. Writer trigger: the implementation touches 2+ non-trivial files. Evidence: README covers setup, checks, scientific-use risk, no redistribution, MIT notices, and all selected mirrors.
  - Rollback: P1 README sections only.
- [x] **P1-07 — Close the work unit.** Run all applicable checks, record exact evidence below, inspect authored changed-line count, and prepare one Conventional Commit carrying this document with the scaffold.
  - Route: inline; closure stays with the feature owner. Delegation trigger: authored additions plus deletions exceed 400 or a cohesive rollback boundary no longer fits one review unit. Evidence: final status/diff, check outputs, authored-line count excluding the generated lockfile, and commit identity.
  - Rollback: revert the P1 work-unit commit; do not combine rollback with later product tasks.

## Acceptance criteria

- [x] A clean install can run lint, strict typecheck, Node tests, Playwright Chromium browser tests, and the Vite production build.
- [x] The Node and browser suites are distinct Vitest 4 projects with their intended environments.
- [x] ESLint rejects imports that violate the documented layer direction.
- [x] The empty shell renders without feature behavior at desktop and landscape-tablet widths using Dragon Atelier foundational tokens.
- [x] CI validates pull requests and deploys to GitHub Pages only from `main`.
- [x] README records the accepted scientific-use weight risk, no-weight-redistribution rule, ONNX Runtime and Demucs MIT notices, and selected mirror attributions.
- [x] No phone-support claim, model weight, domain behavior, or product page is introduced.
- [x] Final evidence includes exact commands/results, runtime smoke result, authored-line count, rollback boundary, and commit identity. The immutable SHA is recorded in the Engram mirror and delivery report immediately after Git creates the commit, avoiding an impossible self-referential hash inside that same commit.

## Forecast and delivery

Forecast was approximately 350 authored changed lines excluding the generated lockfile. Implementation crossed 400 lines; work stopped at 419 and resumed only after the user explicitly approved a cohesive P1 `size:exception`. The final count is recorded below without code-golf or omitted checks.

## Applicable checks

- Required locally: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser`, `npm run build`.
- Runtime harness: `npm run dev`; verify the empty shell in Chromium at desktop and landscape-tablet widths, with no phone claim.
- Review: inspect `git diff --stat`, authored additions plus deletions excluding the generated lockfile, workflow deploy guards, and absence of tracked model weights or `.codegraph/` content.
- Remote Pages deployment evidence is deferred until remote execution is explicitly authorized.

## Progress / evidence

- 2026-09-20 — P1 ODD preparation started on `feat/p1-scaffold` from `master`.
- Route evidence: delegated writer because P1 changes 2+ non-trivial files; P1 remains one cohesive rollback and review unit.
- Install: `npm install` and `npm ci` each exited 0, installed 157 packages, and reported 0 vulnerabilities; Playwright installed Chromium 153.0.8010.12 (v1243).
- Final checks: `npm run lint` exit 0; `npm run typecheck` exit 0; `npm test` exit 0 (1 file, 6 tests); `npm run test:browser` exit 0 (1 file, 1 test); `npm run build` exit 0 (16 modules, 220.18 kB JS / 68.80 kB gzip).
- Runtime: `npm run dev -- --host 127.0.0.1` started Vite 8.3.0 in 206 ms. Chromium at desktop 1440×900 and landscape tablet 1024×768 showed the expected title and heading, a visible main region, no horizontal overflow, and no console errors. Phone was not evaluated.
- Workflow inspection: pull requests and pushes validate; artifact upload and Pages deployment both require a push to `refs/heads/main`. No remote run was performed.
- Repository inspection: 20 files, 3,217 insertions and 3 deletions including the 2,772-line generated lockfile; 448 authored additions plus deletions exclude that lockfile and `.codegraph`. `.codegraph/` is ignored, and `git ls-files` contains no model weights or `.codegraph` content.
- Rollback boundary: revert the pending P1 work-unit commit to remove only the scaffold, validation workflow, empty shell, README additions, and this tracker update; there is no remote or product-data state to unwind.
- Commit identity: the single commit containing this document with subject `feat(scaffold): establish P1 web foundation`; its immutable SHA is recorded in the Engram mirror and delivery report immediately after creation.

## Next step

Create the prepared Conventional Commit, record its immutable SHA in the Engram mirror, and assess that committed P1 candidate. Pages deployment remains a separately authorized remote boundary.
