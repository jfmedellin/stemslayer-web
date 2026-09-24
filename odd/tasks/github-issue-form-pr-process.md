# GitHub Issue Form and Main Integration

## Objective
Enable the repository's issue-first delivery process with a valid YAML Issue Form, then prepare the user-requested integration PR to `main` only after approval requirements are satisfied.

## Problem
The target repository has Issues enabled but no YAML Issue Forms on its default branch. Repository workflow requires every PR to link an issue carrying `status:approved`, while the mandatory issue-creation policy forbids creating issues through Markdown or alternate routes.

## Why
The user explicitly requested that all locally committed work be sent to `main`, authorized creating the missing YAML form, and authorized a direct commit/push to `main` via GitHub CLI for this prerequisite.

## Scope
- Add one GitHub YAML Issue Form for feature/integration requests, using only discovered existing ordinary labels; never auto-apply `status:approved`.
- Publish this form directly to `main` using the explicitly authorized GitHub CLI session and target repository.
- Create a form-compliant, user-reviewed issue only after the form is available on default branch.
- Wait for explicit maintainer approval of that exact issue before opening the PR.
- Prepare delivery for the current `feat/p7b-onnx-worker` branch without force-pushing or silently changing the requested scope.

## Constraints
- Exact target: `github.com/jfmedellin/stemslayer-web`; base: `main`.
- User authorized GitHub CLI and direct commit/push of the required Issue Form to `main`.
- User explicitly requests one PR containing the full current branch after being informed of its 129 commits/18,808 changed lines; the verified target-host principal `jfmedellin` has `ADMIN`. Record the explicit single-PR size exception and rationale; do not silently bypass the budget.
- The repository has no Issue Form on `main`; Markdown/blank/browser/alternate-publisher issue creation is prohibited by issue-creation policy.
- `status:approved` is protected. Do not apply it without current direct instruction naming the exact issue and target-host permission verification.
- Branch delivery remains gated on an approved issue. User explicitly chose one PR for the whole branch, so do not create a chain; retain the documented 18,808-line size-exception rationale and do not apply protected `size:exception` label without target-bound instruction for the exact PR.
- Current branch is `feat/p7b-onnx-worker` at `28852b08bc929e460773503beaa59ae5b8b4785f`, and is not published on the target remote. Remote `main` is `00c0c53f74e5f194eab3266f27aaf02498fad4ef`; relative to it the branch has 129 branch-only commits, 3 main-only commits, and 197 changed files (+18,738/-70; 18,808 changed lines). The common base is `b8dc65621d6a2faf1153934c06b0790f44a69c25`.
- Today's branch work is 23 commits across 27 files (+1,199/-104; 1,303 lines), parent `44194244cd695d219f7d192c64fb67e42de58efb`. It cannot be applied directly to current `main`: 18 of 19 changed `src/`/`tests/` paths are absent there, and the first daily commit descends from feature-branch history after the main merge base. Today's Mixer changes rely on prior unmerged foundation (e.g. `MixerPage.tsx` added in `82ae5cc`, `AppShell.tsx` in `02d4df7`, `AudioEnginePort` in `eddf635`).
- RDD is globally disabled; do not start/toggle review lifecycle.
- Preserve unrelated untracked `odd/tasks/first-public-release.md` without reading, staging, or modifying it.

## Authorized Scope
`.github/ISSUE_TEMPLATE/feature_request.yml`, this tracker and its Engram mirror, and remote work via GitHub CLI in `github.com/jfmedellin/stemslayer-web`. The Issue Form was explicitly authorized for direct addition to `main`; after learning the branch size, the user explicitly chose one PR containing the whole branch. Target-host CLI identity `jfmedellin` was verified as `ADMIN`. Branch push and PR creation remain gated below by a user-reviewed issue, protected issue approval, required PR body/type label, and the explicit size-exception rationale.

## Acceptance Criteria
- A valid, rendered YAML feature/integration Issue Form is available from the default branch.
- Its auto-labels are only discovered existing ordinary labels; it cannot mark an issue approved.
- No issue is created before the user can review its exact form, title, and body.
- The issue is approved by an authorized maintainer before PR creation.
- The PR includes exactly the scope chosen by the user and links the approved issue; no force-push or unrelated untracked-file inclusion.

## Applicable Checks
- Validate the YAML syntax and GitHub Issue Form structure before publishing.
- Read back the target-host file and verify its content and default-branch path after the one direct commit.
- Before issue creation, complete/retain the open-and-closed duplicate search, review exact issue title/body/form/labels, and perform a privacy scan.
- Verify approved issue state and target-host actor permission before protected-label mutation or PR creation.
- Inspect branch/base commit identities and change scope before push; use the chosen PR chain strategy.

## Tasks
- [x] GHIF-01 — Add and publish the YAML Issue Form directly to `main`.
  - Route: delegated direct, with a bounded worker handling the single form file and authorized GitHub CLI publication.
  - Trigger evidence: external GitHub CLI execution is remote work and is delegated; only this target, operation, and authorized GitHub CLI session are in scope.
  - Forecast: approximately 30–60 authored lines.
  - Verification evidence: YAML and GitHub Issue Form schema validated; final privacy scan passed; target-host readback at `main` matched blob `81133991622859f2088bf488e6ce1be1d97a616d` exactly (parent spot-check recomputed the Git blob SHA from returned bytes).
  - Commit identity: `00c0c53f74e5f194eab3266f27aaf02498fad4ef` (direct main commit, explicitly authorized).
  - Note: first parent readback parsing attempt used a malformed PowerShell tab split; corrected retrieval and hash check passed. Temporary protected-folder cleanup was blocked by execution policy; no repository files were affected.
- [ ] GHIF-02 — Prepare and create the prerequisite integration issue after user review.
  - Route: delegated CLI execution for external tooling.
  - Fresh all-state duplicate searches: `audio stem separation`, `mixer export browser`, and `upload library responsive web` found no candidate; `ONNX worker inference` found open #25. Its private target-host body was read once, target identity verified, and it was classified as a narrow signal-processing subcomponent, not an equivalent to this end-to-end workflow.
  - Draft title and required form answers were presented to the user with selected form and labels; explicit approval received to create exactly that issue. One create attempt is authorized; no retries.
  - Approval label remains a separate protected action and is not implied by issue creation.
- [ ] GHIF-03 — Push current feature branch and open the main PR after approval.
  - Route: delegated CLI execution for external tooling.
  - Branch diff is 18,808 changed lines. User explicitly chose one PR containing the full branch after being informed of the budget; record the documented `size:exception` rationale and do not split.
  - PR target: `main`; issue must already have `status:approved`; no force-push.

## Progress
- GitHub CLI read-only discovery confirmed the exact repository/default branch, Issues enabled, Discussions disabled, existing labels `enhancement`, `status:approved`, and `type:feature`, and no YAML Issue Form under `.github/ISSUE_TEMPLATE/` on `main`.
- The current branch PR would cover the full long-lived feature branch, not only recent Mixer commits.
- Explicit user authorization received to add the required YAML Issue Form directly to `main` using GitHub CLI.
- Read-only mapping confirmed the active branch is much broader than today's Mixer and related UI changes; the active branch is not yet on the remote. A single PR is 18,808 changed lines, above 400. User explicitly directed one PR for the full branch after being informed of the size. Today's 23 commits alone are not a runnable delta on main because they rely on earlier branch-only foundations. Target-host session identity `jfmedellin` has `ADMIN`. Fresh all-state duplicate search plus private readback classified #25 as a related narrow algorithm issue, not an equivalent. No issue or PR has been created and no branch has been pushed.

## Next Step
Use the explicitly approved title, answers, selected form, and labels for one private-file GitHub CLI issue-create attempt and target-host readback. Do not retry if the outcome is unknown. Then stop for separate exact issue-number approval before any `status:approved` mutation; no PR until that gate is satisfied.
