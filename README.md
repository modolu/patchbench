# PatchBench

**Make AI patches prove themselves.**

A local-first verification bench for AI-generated bug fixes: reproduce the bug,
test isolated candidates under the same policy, and give the developer evidence
to decide which patches are safe to consider.

**[Open the live demo](https://patchbench-kappa.vercel.app)** ·
**[Inspect the evidence matrix](https://patchbench-kappa.vercel.app/runs/run-20260926073526-aab88e/evidence)**

## The problem

AI makes code generation cheap. Verification is the bottleneck.

A plausible patch can fix the reported symptom while breaking adjacent behavior.
Existing tests may also miss the bug entirely. Reviewers need proof that the bug
existed, proof that the patch fixes it, and a clear account of what else changed.

## What PatchBench does

**REPRODUCE BEFORE REPAIR.** A regression test must fail on the untouched baseline
for the expected reason before candidate implementation begins. A passing or
invalid reproduction stops the run as `UNVERIFIED`.

```text
Bug report → Immutable baseline SHA → Bob reproduction proposal
                                           ↓
                              Independent reproduction gate
                                           ↓
                                   Frozen regression
                                           ↓
                            Candidate patches A / B / C
                                           ↓
                          Isolated verification, same bench
                                           ↓
                             Evidence matrix → Developer decision
```

The engine preserves the baseline, freezes the accepted test, creates isolated
candidate worktrees, and records deterministic verification results. The UI
renders those persisted results, including rejection reasons, diffs, and logs.

## Live demo

The [public showcase](https://patchbench-kappa.vercel.app) runs with
`PATCHBENCH_MODE=showcase`. It serves a **sanitized captured benchmark** and does
not execute arbitrary repositories remotely. Repository execution remains local.

- [New benchmark screen](https://patchbench-kappa.vercel.app/new)
- [Captured run and reproduction proof](https://patchbench-kappa.vercel.app/runs/run-20260926073526-aab88e)
- [Evidence matrix, candidate diffs, and logs](https://patchbench-kappa.vercel.app/runs/run-20260926073526-aab88e/evidence)

The capture uses deterministic `FakeBobAdapter` proposals and real Git worktrees,
test commands, and verification. The separate real IBM Bob reproduction proof is
documented below.

## Demo result

In the synthetic `auth-expiry-bug` fixture, expired refresh tokens return
**HTTP 500 instead of HTTP 401**. The baseline passes its 12 existing tests;
the new regression test exposes the missing behavior.

| Evidence | Candidate A | Candidate B | Candidate C |
|---|---|---|---|
| Approach | Map expiry in the HTTP error mapper | Treat every refresh failure as unauthorized | Handle expiry in the refresh route |
| Frozen regression | PASS | PASS | PASS |
| Test suite, including regression | 13/13 | 11/13 | 13/13 |
| New failures vs baseline | 0 | **2** | 0 |
| Typecheck / build | PASS / PASS | PASS / PASS | PASS / PASS |
| Eligibility | **ELIGIBLE** | **REJECTED** | **ELIGIBLE** |

**Candidate B fixes the reported bug and still gets rejected.** Its broad error
handling turns two distinct responses into 401:

- A disabled account should return **403 `account_disabled`**.
- A token-store outage should return **503**, not an authentication error.

These are actual failures in the [captured test log](showcase/runs/run-20260926073526-aab88e/candidates/b/logs/test.log),
recorded in the [persisted evidence matrix](showcase/runs/run-20260926073526-aab88e/report.json).
`ELIGIBLE` means the candidate cleared the configured hard gates; the developer
still reviews the surviving patches.

## Why this is different

- **Reproduction comes first.** A green result matters only after the same test
  has proved the defect on the original code.
- **Every candidate faces the same bench.** The baseline SHA, frozen regression,
  command policy, timeouts, and environment allow-list are shared.
- **Evidence stays inspectable.** Exact failures and diffs explain the outcome.
  There is no opaque quality score, automatic winner, or auto-merge.

## IBM Bob integration

The implemented real integration is a **manual IBM Bob IDE handoff adapter**:

1. PatchBench creates an isolated reproduction workspace at the baseline SHA and
   writes a bounded task packet.
2. The developer opens that workspace in Bob IDE. Bob inspects the code, adds a
   regression test, and writes a structured JSON handoff result.
3. PatchBench validates the result and changed files, then independently runs its
   own reproduction command. Bob's proposed command is informational.
4. Only an assertion failure matching the expected behavior establishes
   `REPRODUCED`; PatchBench then freezes the test and permits the repair stage.

The completed real Bob task produced a test expecting **401** and receiving
**500**. PatchBench independently confirmed it and advanced the run to
`STRATEGIZING`. See the [reproduction result](bob_sessions/shipyard_t05_real_reproduction_run/reproduction/result.json),
[task history](bob_sessions/shipyard_t05_real_reproduction_history.md), and
[committed Bob task screenshot](bob_sessions/shipyard_t05_real_reproduction_summary.png).
The Bob evidence export redacts token literals; its recorded hashes refer to
the original runtime artifacts, before export redaction.

**Bob proposes evidence. PatchBench decides whether it proves the bug.**

Current boundary: `ManualBobAdapter` supports reproduction only. Real Bob
strategy generation and candidate implementation are not wired through this
adapter; the complete A/B/C benchmark uses `FakeBobAdapter`. Bob does not choose
a winning patch.

## Architecture

```text
BobAdapter → Reproduction gate → Candidate worktrees → Shared verifier
                    ↕                    ↕                  ↕
              Run state machine + filesystem store (JSON / JSONL)
                                      ↓
                              Next.js evidence UI

Git adapter + bounded command runner support all execution stages.
```

- `src/domain/`: Zod schemas and types.
- `src/server/runs/`: explicit state transitions, orchestration, persisted runs
  and append-only events.
- `src/server/git/` and `runner/`: native Git worktree lifecycle and bounded
  process execution.
- `src/server/bob/`, `reproduction/`, `candidates/`, `verification/`: adapter
  contracts, reproduction proof, patch isolation, and evidence generation.
- `src/server/ui/` and `src/components/pb/`: artifact readers and presentation.

Baseline and reproduction checks use **detached Git worktrees** at the immutable
baseline SHA. Candidates start from that same SHA in
`.patchbench/worktrees/<run-id>/<candidate-id>/`, on branches
`patchbench/<run-id>/<candidate-id>`. Each receives its own strategy and the
identical frozen test. The engine verifies candidates sequentially.

See the [architecture document](docs/PATCHBENCH_ARCHITECTURE.md) for the full
design; the implementation boundaries above describe the current build.

## Verification model

- **Frozen regression:** the accepted test patch and individual test files have
  SHA-256 hashes. PatchBench checks the stored artifact and candidate copies;
  modification or deletion produces `REGRESSION_TEST_MUTATED`.
- **Regression gate:** the intact regression must execute real tests and pass.
- **Baseline failure subtraction:** `newFailures = candidateFailures − baselineFailures`,
  using normalized failure identities. Pre-existing failures remain visible and
  do not automatically reject a candidate. New failures do.
- **Required checks:** failing configured typecheck/build checks reject when
  required by policy. Lint is informational unless explicitly marked required.
- **Informational evidence:** suite totals, preserved baseline failures, diff
  size, changed files, dependency/config changes, and duration support review
  without a composite score.

## Repository artifacts / evidence

Runtime evidence lives in the gitignored `.patchbench/` directory:

```text
.patchbench/runs/<run-id>/
├── run.json                     # policy, state, baseline, candidates
├── events.jsonl                 # append-only timeline
├── baseline/result.json         # original checks and failures
├── reproduction/
│   ├── regression.patch         # accepted test
│   ├── regression.sha256        # frozen patch hash
│   └── result.json              # reproduction proof and file hashes
├── candidates/<candidate-id>/
│   ├── result.json
│   ├── diff.patch
│   └── logs/
└── report.json                  # evidence matrix
```

Baseline and reproduction command logs are also retained. Committed evidence is
in [showcase/](showcase/README.md) (sanitized deterministic capture) and
[bob_sessions/](bob_sessions/) (real Bob task records and screenshots).

## Run locally

Use **Node.js 22.18+**, **pnpm 11.5.1** (the pinned package manager), and **Git**.
The fixture uses Node's native TypeScript support and `node --test`.

```bash
pnpm install
pnpm --dir fixtures/auth-expiry-bug install
pnpm dev
```

Open `http://localhost:3000/new`. `PATCHBENCH_MODE=local` is the default: it reads
local runs and committed captures and allows read-only repository inspection.
**Starting a benchmark from the UI is not wired yet.** The form validates inputs;
the engine's complete fixture workflow is exercised through integration tests:

```bash
pnpm vitest run tests/integration/candidate-pipeline.test.ts
```

To materialize the fixture as a standalone Git repository:

```bash
pnpm fixture:prepare
```

This creates `.patchbench/fixture-repos/auth-expiry-bug`; rerunning replaces only
that generated directory. To browse only the committed showcase locally:

```bash
PATCHBENCH_MODE=showcase pnpm dev
```

Verification commands:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Build before Playwright: its configuration starts a production showcase server
on port 3100. Automated unit/integration and E2E checks do not invoke real Bob.

## Quality

Verified on 26 September 2026: **244 unit/integration tests passed**, **4/4
Playwright tests passed**, and **lint and typecheck passed**. The production build
passed with `pnpm exec next build --webpack`; the default `pnpm build` hit a
Turbopack port-binding restriction in the verification environment. Playwright
ran against the successful webpack build.
Coverage includes reproduction rejection, frozen-test mutation, dirty primary
worktree preservation, baseline subtraction, candidate hard gates, and showcase
navigation through failure evidence, diffs, and logs.

## Security / trust boundaries

- Repository scripts execute locally and must be trusted; Git worktrees are
  isolation for changes, not a container sandbox.
- The runner uses argument arrays with `shell: false`, mandatory timeouts,
  bounded output, an allowed working-directory scope, and an allow-listed child
  environment. Captured output is secret-redacted before return or persistence.
- Safe IDs, realpath containment, and regular-file checks defend against path
  traversal and symlink escapes in worktree and artifact handling.
- The Bob handoff scopes work to the reproduction workspace, bug report, and
  baseline. It forbids reading `.env` files; PatchBench validates the returned
  changes and owns verification command policy. Code Bob inspects is handled
  through the developer's Bob IDE setup.
- The fixture contains synthetic data. Showcase export rewrites machine paths
  and omits worktrees. PatchBench does not auto-merge or auto-push patches.

## Project documents

- [Product brief](docs/PATCHBENCH_PRODUCT_BRIEF.md)
- [Architecture](docs/PATCHBENCH_ARCHITECTURE.md)
- [Hackathon execution plan](docs/PATCHBENCH_HACKATHON_EXECUTION_PLAN.md)
- [Bob evidence](bob_sessions/)

## Built for

**IBM Bob 2.0 Hackathon** · Team **Shipyard**
