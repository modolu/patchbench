# PatchBench T01 — Architecture Sanity Check

Read:
- AGENTS.md
- docs/PATCHBENCH_PRODUCT_BRIEF.md
- docs/PATCHBENCH_ARCHITECTURE.md
- docs/PATCHBENCH_HACKATHON_EXECUTION_PLAN.md
- the existing .bob/ rules

Inspect the current implementation only as needed.

Do not modify any files.

PatchBench is a local-first developer tool that proves a bug with a regression test, freezes that benchmark, generates isolated candidate fixes, and verifies them identically.

Milestone 2 is complete and the deterministic part of Milestone 3 is implemented.

Your task is planning/review only:

1. Check whether the current implementation still matches the architecture and core invariant:
   “Reproduce before repair.”

2. Identify any concrete architectural or correctness problems that should be fixed before implementing the shared verifier.

3. Give the minimum implementation plan for the next deterministic milestone:
   shared verifier + evidence matrix.

The verifier must compare:
- frozen regression
- existing tests
- typecheck
- lint
- build

It must distinguish baseline failures from new candidate regressions.

Hard failures should reject a candidate.
The run should complete with an evidence matrix allowing the developer to compare candidates.

Do not redesign the product.
Do not add cloud services, databases, auth, GitHub integration or new languages.
Do not implement anything.

Keep the response concise and conserve Bobcoins.

---

**Status:** active  **Date:** 2026-09-25

---

### 👤 User

PatchBench T01 — Architecture Sanity Check

Read:
- AGENTS.md
- docs/PATCHBENCH_PRODUCT_BRIEF.md
- docs/PATCHBENCH_ARCHITECTURE.md
- docs/PATCHBENCH_HACKATHON_EXECUTION_PLAN.md
- the existing .bob/ rules

Inspect the current implementation only as needed.

Do not modify any files.

PatchBench is a local-first developer tool that proves a bug with a regression test, freezes that benchmark, generates isolated candidate fixes, and verifies them identically.

Milestone 2 is complete and the deterministic part of Milestone 3 is implemented.

Your task is planning/review only:

1. Check whether the current implementation still matches the architecture and core invariant:
   “Reproduce before repair.”

2. Identify any concrete architectural or correctness problems that should be fixed before implementing the shared verifier.

3. Give the minimum implementation plan for the next deterministic milestone:
   shared verifier + evidence matrix.

The verifier must compare:
- frozen regression
- existing tests
- typecheck
- lint
- build

It must distinguish baseline failures from new candidate regressions.

Hard failures should reject a candidate.
The run should complete with an evidence matrix allowing the developer to compare candidates.

Do not redesign the product.
Do not add cloud services, databases, auth, GitHub integration or new languages.
Do not implement anything.

Keep the response concise and conserve Bobcoins.

---

### 🤖 Assistant

> 🔧 called: spawn_subagent, list_files



> 🔧 **spawn_subagent** — explore

> 🔧 **list_files** — .

### 🤖 Assistant

> 🔧 called: spawn_subagent, spawn_subagent



> 🔧 **spawn_subagent** — Read and return the FULL contents of these files from /Users/Apple/patchbench:

1. src/domain/run.ts
2. src/domain/evidence.ts
3. src/domain/errors.ts
4. src/domain/events.ts
5. src/domain/candidate.ts
6. src/domain/policy.ts
7. src/server/runs/state-machine.ts
8. src/server/runs/orchestrator.ts
9. src/server/runs/lifecycle.ts
10. src/server/verification/diff-analysis.ts
11. src/server/runner/command-runner.ts
12. src/server/reproduction/reproduction-service.ts
13. src/server/reproduction/regression-artifact.ts
14. src/server/candidates/candidate-service.ts

Return each file's full content with filename headers.

> 🔧 **spawn_subagent** — Read and return the FULL contents of these files from /Users/Apple/patchbench:

1. src/server/bob/adapter.ts
2. src/server/bob/fake-adapter.ts
3. src/server/bob/schemas.ts
4. src/server/git/git-adapter.ts
5. src/server/git/worktrees.ts
6. src/server/runs/store.ts
7. src/server/runner/test-output.ts
8. src/server/runner/redaction.ts
9. src/server/reproduction/classify.ts
10. docs/PATCHBENCH_ARCHITECTURE.md (lines 1-200 only)

Return each file's full content with filename headers.

### 🤖 Assistant

> 🔧 called: read_file, read_file



> 🔧 **read_file** — src/server/candidates/candidate-service.ts

> 🔧 **read_file** — docs/PATCHBENCH_ARCHITECTURE.md

### 🤖 Assistant

> 🔧 called: read_file, read_file



> 🔧 **read_file** — docs/PATCHBENCH_ARCHITECTURE.md

> 🔧 **read_file** — docs/PATCHBENCH_HACKATHON_EXECUTION_PLAN.md

### 🤖 Assistant

> 🔧 called: glob

Now I have everything I need. Let me look at one remaining gap — whether a baseline runner exists:

> 🔧 **glob** — src/server/**/*.ts

### 🤖 Assistant

> 🔧 called: execute_command



> 🔧 **execute_command** — find src/server -name "*.ts" | sort

### 🤖 Assistant

> 🔧 called: read_file, read_file



> 🔧 **read_file** — src/server/runner/script-detector.ts

> 🔧 **read_file** — src/server/runs/repository-snapshot.ts

### 🤖 Assistant

I now have a complete picture. Here is my analysis:

---

## 1. Architecture conformance — "Reproduce before repair"

**Core invariant: intact.**

The implementation correctly enforces the invariant:

- [`orchestrator.ts`](src/server/runs/orchestrator.ts) transitions `BASELINING → REPRODUCING → STRATEGIZING` before any candidate work.
- [`reproduction-service.ts`](src/server/reproduction/reproduction-service.ts) gates the entire forward path: if the regression test does not fail as expected on baseline, the run moves to `UNVERIFIED`, never to `STRATEGIZING`.
- [`regression-artifact.ts`](src/server/reproduction/regression-artifact.ts) freezes the patch with SHA-256, validates with `writeFileExclusive` (exclusive-link atomic write), and re-verifies the hash on `loadFrozenArtifact`.
- [`candidate-service.ts`](src/server/candidates/candidate-service.ts) re-checks the frozen files are byte-identical after Bob implements the candidate (`verifyFrozenRegression`).
- The state machine [`state-machine.ts`](src/server/runs/state-machine.ts) has no shortcut path from `CREATED` to `PATCHING` or `VERIFYING`.

The benchmark protocol matches §9 of the architecture document throughout.

---

## 2. Concrete problems to fix before implementing the verifier

**A. No baseline check execution.** The `BASELINING` stage ([`orchestrator.ts:52-57`](src/server/runs/orchestrator.ts:52)) only captures the SHA and detects scripts. It does not run the test/typecheck/lint/build commands against the baseline commit. The `BaselineResultSchema` in [`run.ts`](src/domain/run.ts) has a `checks` field for this, but it is never populated. The verifier needs baseline `CheckResult` values to subtract pre-existing failures from candidate failures per §14. Without them, every pre-existing failure becomes a false regression.

**B. `src/server/verification/verifier.ts` does not exist.** The architecture specifies it at §5 module layout and §16 (Evidence Engine). The directory holds only [`diff-analysis.ts`](src/server/verification/diff-analysis.ts). `evidence-builder.ts` is also absent. The orchestrator stops in `VERIFYING` with no verifier to call.

**C. `VerificationResult` is never written to `CandidateResult`.** [`candidate-service.ts:139`](src/server/candidates/candidate-service.ts:139) leaves the candidate in `VERIFYING` with `verification: undefined`. There is no code that runs the verification commands and fills `candidate.verification`.

**D. `RunPolicy.verificationCommands` is always empty.** [`policy.ts`](src/domain/policy.ts) `defaultRunPolicy` initializes it as `[]`. The baseline stage must populate it from `detectedScripts`, or it must be set at run-creation time before the pipeline starts. The verifier has nothing to run otherwise.

**E. No `baseline/result.json` or `candidates/<id>/result.json` persisted.** The architecture's run-store layout (§17) specifies these files, but neither the baseline stage nor candidate-service writes them. This is informational for the MVP but will block log-path rendering in the UI.

---

## 3. Minimum implementation plan — shared verifier + evidence matrix

This is T06 scope. Everything below is strictly deterministic — no Bob calls.

### 3.1 Populate `verificationCommands` during baseline (prerequisite)

In `BASELINING`, after `captureRepositorySnapshot` succeeds, build `verificationCommands` from `run.repository.detectedScripts` using [`scriptInvocation()`](src/server/runner/script-detector.ts:60). Save the updated run with `store.saveRun`. Also record `BaselineResult` by running those commands now (see §3.2).

### 3.2 Run baseline checks and record `BaselineResult`

Still in `BASELINING`, for each `verificationCommand`: run it via `runCommand`, collect a `CheckResult`, write them into `run.baseline`. This produces the `baselineFailures` set used for subtraction. Failure here is not a hard stop — it records which checks already fail so candidates are judged relative to that.

> Edge case: if the regression test command itself passes on baseline (i.e. the bug is already fixed), the `REPRODUCING` stage will catch it with `NOT_REPRODUCED`. The baseline check of the _general_ test suite is separate and can pre-exist failures.

### 3.3 Implement `src/server/verification/verifier.ts`

Single exported function:

```ts
verifyCandidate(deps, { runId, candidateId }): Promise<Result<VerificationResult, PatchBenchError>>
```

Steps, in order:

1. Load run; assert status `VERIFYING`; assert candidate status `VERIFYING`.
2. **Regression check** — run `policy.regressionCommand` + frozen test files in the candidate worktree via `runCommand`. Parse TAP with `parseNodeTap`. `regression.passed = (exitCode === 0 && fail === 0)`.
3. **Suite checks** — for each `policy.verificationCommand` (test, lint, typecheck, build), run the command in the candidate worktree. Collect `CheckResult`. Log to `candidates/<id>/logs/<name>.log` under the run dir.
4. **Baseline subtraction** — compute `newFailures = candidateTestFailures − run.baseline.failures`. Compute `baselineFailures = intersection`.
5. **Hard-gate logic** (§16):
   ```
   rejectionReasons = []
   if !regression.passed → "Regression test still fails"
   if newFailures.length > 0 → "Introduced new test failures"
   if policy.requireBuild && !build?.passed → "Build failed"
   if policy.requireTypecheck && !typecheck?.passed → "Typecheck failed"
   hardGatePassed = rejectionReasons.length === 0
   ```
6. Assemble `VerificationResult` (already typed in [`evidence.ts`](src/domain/evidence.ts)).
7. Transition candidate: `ELIGIBLE` if `hardGatePassed`, `REJECTED` otherwise.

### 3.4 Call verifier from orchestrator

In `VERIFYING` stage (after the `PATCHING → VERIFYING` transition), loop over candidates whose status is `VERIFYING`, call `verifyCandidate` for each. After all are done, transition run to `COMPLETE`.

Sequentially is correct and sufficient for MVP.

### 3.5 Evidence matrix assembly

Add `src/server/verification/evidence-builder.ts`:

```ts
buildEvidenceMatrix(run: PatchBenchRun): EvidenceMatrixRow[]
```

Row per check (regression, tests, typecheck, lint, build, newFailures, filesChanged, dependencyManifestChanged). Kind: `"hard-gate"` for the first four, `"informational"` for the rest. One column per candidate. This is a pure function over persisted run state — no I/O.

### 3.6 Tests required

- `verifier.ts`: regression-still-failing → `REJECTED`; regression-fixed + no new failures → `ELIGIBLE`; regression-fixed + new failures → `REJECTED`; build-required + build-fails → `REJECTED`.
- Baseline subtraction: pre-existing failure not counted as `newFailure`.
- Evidence matrix: hard-gate rows correct for each rejection reason.
- Orchestrator integration: `VERIFYING → COMPLETE` transition after all candidates settle.

### 3.7 File summary

| File | Action |
|---|---|
| `src/server/runs/orchestrator.ts` | Add baseline check execution; add verifier loop in VERIFYING stage |
| `src/server/verification/verifier.ts` | **Create** — `verifyCandidate` |
| `src/server/verification/evidence-builder.ts` | **Create** — `buildEvidenceMatrix` |
| `src/domain/evidence.ts` | Add `EvidenceMatrixRow` type (or inline in evidence-builder if simpler) |
| `src/server/candidates/candidate-service.ts` | No changes needed — already leaves candidate in `VERIFYING` |
| `src/server/runs/state-machine.ts` | No changes needed — `VERIFYING → COMPLETE` already valid |