# PatchBench — Product Brief

**Team:** Shipyard  
**Hackathon:** IBM Bob 2.0 Hackathon  
**Build window:** 25–27 September 2026  
**Product status:** Hackathon MVP specification — locked unless kickoff rules invalidate a requirement  
**Tagline:** **Make AI patches prove themselves.**

---

## 1. Executive Summary

PatchBench is a local-first developer tool that turns AI-assisted bug fixing from a one-shot generation problem into an evidence-driven engineering workflow.

A developer gives PatchBench a repository and a bug report. PatchBench first establishes a clean baseline, then uses IBM Bob to investigate the defect and generate a regression test that proves the bug exists. Only after that test fails on the unmodified codebase does PatchBench produce multiple independent repair strategies. Each strategy is implemented in its own isolated Git worktree, then evaluated against the same evidence: the regression test, the repository's existing test suite, build, lint, typecheck, and change-surface checks.

PatchBench does **not** tell developers to trust whichever answer an AI agent produced first. It makes candidate fixes compete against reproducible evidence.

The core product thesis is simple:

> AI makes code generation cheap. Verification becomes the bottleneck.

PatchBench is the verification bench for AI-generated patches.

---

## 2. The Problem

AI coding agents are increasingly capable of diagnosing bugs and writing fixes, but the usual workflow still has a weak point:

1. A developer describes a bug.
2. An AI agent proposes a fix.
3. The developer reviews the diff.
4. Existing tests are run.
5. If everything looks plausible, the patch is accepted.

This workflow is fragile for three reasons.

### 2.1 The first plausible fix is not necessarily the safest fix

The same defect can often be repaired at multiple layers: validation, business logic, API boundary, database constraint, state model, or caller. Different fixes can all appear reasonable while having very different blast radii.

### 2.2 Existing test suites frequently encode incomplete knowledge

A patch can pass every existing test and still fail to address the actual user-reported edge case. If the bug is not first converted into a failing regression test, "green tests" can create false confidence.

### 2.3 Humans spend time comparing changes without standardized evidence

Reviewers mentally weigh patch size, files touched, test behavior, build status, dependency changes, and behavioral risk. AI-generated patches increase the volume of code that needs this review.

PatchBench standardizes that verification work.

---

## 3. Product Thesis

PatchBench changes the default mental model from:

> **Bug → AI → Patch**

to:

> **Bug → Reproduction → Competing Patches → Verification → Evidence**

The primary product output is not "the answer." It is a **decision-ready evidence package**.

PatchBench should be opinionated about hard correctness gates but conservative about subjective judgement. It can say:

- this candidate did not reproduce the expected behavior;
- this candidate caused two previously passing tests to fail;
- this candidate changed a public contract;
- this candidate introduced a dependency;
- this candidate touched seven files while another touched two.

It should **not** pretend that a single opaque score can decide what is "best" for every engineering team.

The developer retains final control.

---

## 4. Target User

### Primary persona: Product engineer using AI coding agents

A full-stack/backend engineer working in an active TypeScript repository who already uses an AI assistant to investigate or repair bugs.

They care about:

- shipping quickly;
- avoiding regressions;
- understanding what an AI changed;
- keeping diffs reviewable;
- proving that a patch addresses the reported defect;
- reducing review time.

### Secondary users

- maintainers reviewing AI-generated pull requests;
- senior engineers responsible for code quality;
- QA engineers converting reports into regression coverage;
- teams experimenting with autonomous coding agents.

---

## 5. Jobs To Be Done

When I have a bug report and an AI can generate several plausible fixes, I want to:

1. prove the bug is reproducible;
2. explore more than one repair strategy;
3. isolate each implementation;
4. test every candidate against identical conditions;
5. quickly reject candidates that introduce regressions;
6. understand the trade-offs among survivors;
7. preserve evidence for code review.

So that I can ship a fix with evidence rather than intuition.

---

## 6. Why PatchBench Fits the IBM Bob 2.0 Challenge

The hackathon brief asks participants to improve a specific developer workflow where time, effort, or errors are high and to use IBM Bob meaningfully across multiple stages.

PatchBench targets the **debugging → testing → code review** workflow.

IBM Bob is used for high-value software-engineering reasoning rather than decorative chat:

- repository investigation;
- bug localization;
- regression-test generation;
- candidate strategy generation;
- isolated patch implementation;
- failure analysis;
- final engineering review.

The product also gives a natural reason to showcase Plan mode, Agent mode, repository context, subagents/parallel investigation, persistent project guidance, and optionally Bob Shell for automation.

---

## 7. Product Principles

### 7.1 Reproduce before repair

A candidate is not evaluated until PatchBench has a regression test or other executable assertion that fails on the baseline.

If PatchBench cannot reproduce the reported bug, the run is explicitly marked **UNVERIFIED**.

### 7.2 One benchmark, identical conditions

Every candidate is evaluated against the same:

- baseline commit;
- regression test;
- dependency lockfile;
- configured verification commands;
- environment variables.

### 7.3 Candidate independence

Candidates are implemented in isolated Git worktrees. A candidate must not see another candidate's diff unless the user explicitly asks for comparison after implementation.

### 7.4 Evidence over magic scores

Hard failures are clear. Subjective trade-offs remain visible.

### 7.5 Local-first by default

Private code should not have to leave the developer's machine merely to benchmark a patch.

### 7.6 Honest failure states

"Could not reproduce," "baseline already failing," "candidate timed out," and "verification incomplete" are first-class outcomes.

### 7.7 Build for the demo, architect for reality

The hackathon MVP supports a narrow, reliable repository class. It must feel like the first version of a real developer product, not a scripted mockup.

---

## 8. Core Product Workflow

### Step 1 — Select a repository

For the hackathon MVP:

- local Git repository;
- Node.js / TypeScript project;
- clean or explicitly acknowledged working tree;
- known package manager.

Stretch:

- clone a public GitHub repository;
- GitHub App/PR integration.

### Step 2 — Describe the defect

Required:

- bug title;
- bug description;
- expected behavior.

Optional:

- actual behavior;
- stack trace;
- reproduction hints;
- relevant files;
- failing command.

### Step 3 — Baseline the repository

PatchBench records:

- current commit SHA;
- branch;
- package manager;
- scripts available;
- test/build/lint/typecheck status;
- baseline duration;
- existing failures.

A dirty or already-broken baseline must be visible.

### Step 4 — Reproduce the bug

IBM Bob investigates the codebase and writes a minimal regression test.

PatchBench runs the test against the untouched baseline.

Outcomes:

- **REPRODUCED** — test fails for the expected reason;
- **NOT_REPRODUCED** — generated assertion does not fail;
- **INVALID_REPRODUCTION** — test itself is broken;
- **MANUAL_REVIEW** — user intervention required.

Only **REPRODUCED** runs enter the normal candidate benchmark.

### Step 5 — Generate independent strategies

Bob proposes up to three distinct repair strategies.

Each strategy must include:

- short title;
- reasoning;
- files likely affected;
- expected trade-offs;
- implementation instructions.

Example:

- A — catch domain error at API boundary;
- B — change token verifier semantics;
- C — introduce typed error mapping in auth service.

### Step 6 — Isolate candidates

PatchBench creates one Git worktree per strategy from the same baseline commit.

Example:

```text
.patchbench/worktrees/<run-id>/
├── candidate-a/
├── candidate-b/
└── candidate-c/
```

The approved regression test is injected identically into each worktree before patch implementation.

### Step 7 — Implement candidates

Bob implements one strategy in each worktree.

Each candidate records:

- Bob task/session identifier where available;
- start/end time;
- changed files;
- unified diff;
- command/tool events when available;
- implementation status.

### Step 8 — Verify every candidate

PatchBench executes the same verification pipeline:

1. regression test;
2. existing tests;
3. typecheck;
4. lint;
5. production build;
6. diff/change-surface analysis.

Optional/derived checks:

- dependency manifest changed;
- new dependencies introduced;
- public API file touched;
- migration/configuration files touched;
- lines added/deleted;
- files changed.

### Step 9 — Present evidence

The result view is a side-by-side comparison.

Example:

| Evidence | Candidate A | Candidate B | Candidate C |
|---|---:|---:|---:|
| Regression test | PASS | PASS | PASS |
| Existing tests | 142/142 | 140/142 | 142/142 |
| Typecheck | PASS | PASS | PASS |
| Build | PASS | PASS | PASS |
| Files changed | 2 | 7 | 3 |
| Dependency changes | 0 | 1 | 0 |
| Existing regressions | 0 | 2 | 0 |
| Status | ELIGIBLE | REJECTED | ELIGIBLE |

PatchBench highlights why a candidate failed a hard gate.

The user makes the final selection.

---

## 9. Product Specification

### 9.1 Inputs

`RepositoryInput`

- absolute local repository path;
- optional target commit/branch.

`IssueInput`

- title;
- description;
- expected behavior;
- optional actual behavior;
- optional evidence.

`RunPolicy`

- number of candidates: default 3;
- verification commands;
- per-command timeout;
- per-Bob-task cost/turn caps;
- files/directories to exclude;
- allowed package managers.

### 9.2 Outputs

A PatchBench run produces:

- immutable run metadata;
- baseline report;
- regression-test artifact;
- strategy descriptions;
- candidate worktrees;
- candidate diffs;
- command logs;
- structured verification results;
- evidence matrix;
- timing metrics;
- machine-readable JSON artifact;
- human-readable report.

### 9.3 Run states

```text
CREATED
  → BASELINING
  → REPRODUCING
  → STRATEGIZING
  → PREPARING_CANDIDATES
  → PATCHING
  → VERIFYING
  → COMPLETE
```

Terminal exceptional states:

- `BLOCKED_BASELINE`
- `UNVERIFIED`
- `FAILED`
- `CANCELLED`

### 9.4 Candidate states

- `PENDING`
- `IMPLEMENTING`
- `IMPLEMENTED`
- `VERIFYING`
- `ELIGIBLE`
- `REJECTED`
- `FAILED`
- `TIMED_OUT`

---

## 10. Evidence Model

PatchBench separates evidence into two classes.

### Hard gates

A candidate is rejected when:

- required regression test still fails;
- candidate cannot build where build is required;
- candidate introduces new failures relative to baseline;
- patch cannot be applied or worktree is invalid.

### Informational evidence

Shown without automatically rejecting:

- files changed;
- lines added/deleted;
- dependency changes;
- API/schema/config files touched;
- test duration;
- total verification duration;
- warnings.

This avoids false precision from an arbitrary "87/100 patch quality" score.

---

## 11. Measurable Impact

The product should instrument impact from the first build.

Metrics PatchBench can measure honestly:

- time to baseline;
- time to first successful reproduction;
- time to generate candidate strategies;
- time per candidate implementation;
- total verification time;
- number of automated checks;
- number of candidates rejected automatically;
- number of newly discovered regressions;
- number of files/lines a reviewer would need to inspect;
- number of failing/passing tests.

The demo should never invent a "manual process takes 45 minutes" statistic unless Shipyard actually measures it.

A strong demo statement is:

> PatchBench produced three independent repairs, executed the same verification suite against all three, and automatically rejected one because it broke two previously passing tests.

That is concrete and defensible.

---

## 12. MVP Boundary

### Must ship

1. Local Git repository selection/path input.
2. Node.js/TypeScript repository support.
3. Bug report form.
4. Baseline command detection and execution.
5. One Bob-generated regression test.
6. Proof that the regression test fails on baseline.
7. Three independent candidate strategies.
8. One isolated Git worktree per candidate.
9. Bob-assisted candidate implementation.
10. Shared verification pipeline.
11. Side-by-side evidence matrix.
12. Candidate diff/detail screen.
13. Persistent run artifacts.
14. Sample fixture repository with a deterministic bug.
15. Clear progress/error states.
16. `bob_sessions/` evidence folder in the submission repository.
17. Hosted showcase/demo URL with a real captured PatchBench run.
18. Automated tests for the orchestration/state machine.

### Should ship if core path is stable

- streaming run progress;
- cancel/retry candidate;
- export Markdown report;
- copy Git command / checkout selected candidate;
- public GitHub URL clone;
- candidate reasoning timeline.

### Explicitly not in the hackathon MVP

- GitHub OAuth;
- automatic PR creation;
- SaaS multi-tenancy;
- team accounts;
- cloud execution of private repositories;
- arbitrary-language repository support;
- Docker sandboxing for hostile repositories;
- enterprise policy engine;
- automatic merge;
- composite "AI confidence" score;
- long-term analytics.

Those are post-hackathon opportunities, not weekend requirements.

---

## 13. Demo Scenario

### Fixture

A small TypeScript API application with authentication/session logic and an intentional defect:

> An expired refresh token bubbles up as an unhandled domain error, returning HTTP 500 instead of the documented HTTP 401 response.

The fixture also contains tests protecting adjacent authentication behavior.

### Demo narrative

**0:00–0:20 — Problem**

"AI agents can generate a fix in seconds. The expensive part is proving which fix is safe."

**0:20–0:40 — Create run**

Paste the bug report and select the fixture repo.

**0:40–1:00 — Baseline**

PatchBench shows the current commit and green baseline suite.

**1:00–1:20 — Reproduction**

Bob creates a regression test. PatchBench runs it against baseline:

`expected 401, received 500` — FAIL.

The bug is now executable evidence.

**1:20–1:45 — Competing strategies**

Show three independent repair strategies.

**1:45–2:15 — Verification**

Show candidate worktrees and live checks.

One candidate fixes the error globally but breaks an existing auth test.

**2:15–2:45 — Evidence matrix**

PatchBench marks that candidate rejected and shows two eligible alternatives with diff size/change-surface evidence.

**2:45–3:00 — Close**

"We didn't ask AI for one answer. We made AI-generated patches prove themselves."

### Demo safety

Before recording/judging:

- pre-warm dependencies;
- keep fixture deterministic;
- cap Bob turns/cost;
- maintain a captured real run for replay if network/model latency becomes problematic;
- never fake a result—label replay mode clearly.

---

## 14. IBM Bob Usage Strategy

Bob should be visible in two ways.

### 14.1 Bob as the hackathon development environment

Use Bob IDE for:

- project initialization and persistent context;
- architecture implementation;
- test generation;
- debugging;
- repository refactors;
- final audit.

Capture the task summary for each meaningful Bob IDE task in `bob_sessions/`.

### 14.2 Bob inside the PatchBench workflow

Preferred automated path:

- PatchBench invokes Bob Shell non-interactively for bounded repository tasks;
- prompts are scoped per stage;
- machine-readable output is parsed and validated;
- candidate implementation occurs inside isolated worktrees;
- each invocation has cost and turn limits.

If Bob Shell integration becomes unreliable, the fallback is an interactive Bob IDE workflow that writes to the same PatchBench run manifest/artifact structure. The verification engine remains useful and functional.

---

## 15. Bobcoin Strategy

Assumption: one participant has 40 Bobcoins. Treat that as a hard engineering budget, not an unlimited chat quota.

### Operating rules

- reserve at least 6 Bobcoins for late debugging/final audit;
- never spend Bob on trivial CSS or naming decisions;
- use Plan mode once per major subsystem rather than repeatedly;
- give Bob narrow tasks with explicit acceptance criteria;
- cap Bob Shell calls with `--max-cost` and `--max-turns`;
- stop/rewrite prompts that are meandering;
- capture session evidence immediately after meaningful IDE tasks.

### Solo budget target

| Area | Target cap |
|---|---:|
| Initialization + architecture validation | 3 |
| Core domain/state machine | 4 |
| Git/worktree isolation | 4 |
| Baseline + regression runner | 4 |
| Bob adapter + candidate workflow | 5 |
| Verification/evidence engine | 4 |
| UI implementation | 3 |
| Demo fixture + E2E path | 3 |
| Testing/debugging | 2 |
| Final audit/docs | 2 |
| **Reserve** | **6** |
| **Total** | **40** |

These are caps, not quotas. Unspent coins move to reserve.

### If teammates join

Do not recruit merely for extra Bobcoins. If a competent teammate joins:

- assign independently useful work;
- keep one owner for architectural decisions;
- use separate Bob tasks;
- merge through small, reviewable commits;
- preserve each participant's required Bob-session evidence.

---

## 16. Bob Task Plan

Every task has a deliverable and a screenshot requirement.

| Task | Bob mode | Deliverable | Screenshot name |
|---|---|---|---|
| T01 Product/architecture sanity pass | Plan | approved implementation plan | `shipyard_t01_plan_summary.png` |
| T02 Domain + state machine | Agent | typed run/candidate model + tests | `shipyard_t02_domain_summary.png` |
| T03 Git isolation | Agent | worktree lifecycle + cleanup tests | `shipyard_t03_git_summary.png` |
| T04 Baseline/reproduction | Agent | command runner + repro gate | `shipyard_t04_reproduction_summary.png` |
| T05 Bob orchestration | Agent | Bob adapter + structured contracts | `shipyard_t05_bob_adapter_summary.png` |
| T06 Verification engine | Agent | evidence pipeline + regression comparison | `shipyard_t06_verification_summary.png` |
| T07 UI | Agent | run creation + live/result views | `shipyard_t07_ui_summary.png` |
| T08 Demo fixture | Agent | deterministic bug + baseline tests | `shipyard_t08_fixture_summary.png` |
| T09 End-to-end hardening | Agent | E2E test + error recovery | `shipyard_t09_e2e_summary.png` |
| T10 Final review | Ask/Agent | audit findings + fixes | `shipyard_t10_final_audit_summary.png` |

Do not manufacture empty tasks simply to create screenshots. Evidence should correspond to real work.

---

## 17. Repository Structure

```text
patchbench/
├── AGENTS.md
├── .bob/
│   ├── rules/
│   │   ├── 01-product-constraints.md
│   │   └── 02-engineering-standards.md
│   ├── rules-plan/
│   └── rules-agent/
├── bob_sessions/
│   └── .gitkeep
├── docs/
│   ├── PRODUCT_BRIEF.md
│   ├── ARCHITECTURE.md
│   └── DEMO.md
├── fixtures/
│   └── auth-expiry-bug/
├── src/
│   ├── app/
│   ├── components/
│   ├── domain/
│   ├── server/
│   │   ├── bob/
│   │   ├── git/
│   │   ├── runner/
│   │   ├── verification/
│   │   └── runs/
│   └── lib/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── .patchbench/
│   └── README.md
├── package.json
└── README.md
```

Runtime worktrees and run artifacts are gitignored.

---

## 18. Visual Direction

PatchBench should feel like a serious engineering instrument: **benchmark lab + code review console**, not a generic AI chatbot.

### Brand idea

A patch enters a test bench and emerges with evidence.

### Visual language

- deep graphite/near-black application shell;
- warm off-white text/surfaces for readable evidence;
- signal amber for "under evaluation";
- restrained green for verified pass;
- restrained red for hard failure;
- monospace used for code, command output, SHAs, and metrics;
- clean sans-serif for product copy;
- dense but orderly comparison tables;
- no gratuitous gradients;
- no glowing "AI orb";
- no chat bubble as the primary UI.

### Typography

- **Geist Sans** or equivalent clean UI sans;
- **Geist Mono** for evidence and code.

### Signature screens

1. **New Benchmark** — repo + bug report.
2. **Run Timeline** — baseline → reproduce → strategies → patch → verify.
3. **Candidate Bench** — three candidate cards moving through checks.
4. **Evidence Matrix** — the hero screen.
5. **Candidate Detail** — diff, failed checks, command output, strategy rationale.

### Interaction principles

- status must be readable without color;
- failures link directly to evidence;
- progress should feel deterministic, not magical;
- terminal output is collapsible;
- important facts stay above the fold on laptop screens.

---

## 19. Security and Privacy

Hackathon MVP guardrails:

- local-first repository execution;
- no repository upload by default;
- do not log secrets or `.env` content;
- redact common secret patterns from captured command output;
- never execute a candidate against an untrusted repository without an explicit trust acknowledgement;
- limit verification to configured commands;
- exclude `.git`, `node_modules`, build outputs, and secret files from prompts;
- never commit Bob/API credentials;
- runtime run artifacts containing source snippets remain local and gitignored.

The fixture repository contains synthetic data only.

---

## 20. Risks and Mitigations

### Bob automation is unreliable or authentication blocks Shell

**Mitigation:** preserve the same run artifact protocol and drive patch generation through Bob IDE manually. The core PatchBench value—the reproduction gate, isolated candidates, and verification bench—still works.

### Candidate strategies converge on the same fix

**Mitigation:** strategy-generation prompt explicitly requires materially different repair layers/approaches and rejects near-duplicates before implementation.

### Regression test does not reproduce the bug

**Mitigation:** stop the benchmark. Show `UNVERIFIED`. Allow one bounded Bob refinement attempt.

### Fixture demo is flaky

**Mitigation:** choose deterministic logic, not timing-sensitive concurrency, for the primary demo.

### Verification takes too long

**Mitigation:** configurable command timeouts; demo fixture has a fast suite; run independent candidate checks concurrently where safe.

### 48 hours disappears into infrastructure

**Mitigation:** no database, auth, billing, queues, Docker orchestration, or GitHub OAuth in MVP.

---

## 21. Success Criteria

PatchBench is submission-ready when:

1. a user can create a benchmark from a local TypeScript Git repo and bug report;
2. the untouched baseline is measured and recorded;
3. Bob generates a regression test that demonstrably fails on baseline;
4. PatchBench produces three independent strategies;
5. each candidate is isolated from the same commit;
6. candidate implementations can be generated/applied;
7. all candidates run through the same verification suite;
8. the evidence matrix correctly rejects regressions;
9. the demo fixture works repeatedly;
10. the product has a polished, understandable UI;
11. automated tests cover the state machine and worktree/verification logic;
12. a real run is available in hosted showcase/replay mode;
13. all required Bob IDE session screenshots are committed to `bob_sessions/`;
14. README contains setup, demo, Bob usage, and dataset/privacy notes;
15. demo video can explain the entire value proposition in roughly three minutes.

---

## 22. Post-Hackathon Roadmap

If PatchBench continues beyond the event:

### Phase 2

- GitHub App;
- PR ingestion;
- automatic candidate pull requests;
- Docker/container isolation;
- Python/Go/Java repository adapters;
- organization verification policies;
- CI integration.

### Phase 3

- historical patch benchmarking;
- agent/model comparisons;
- flaky-test-aware verification;
- semantic API compatibility checks;
- performance/security regression plugins;
- team analytics.

The long-term opportunity is not "another coding agent."

It is the **verification layer around coding agents**.

---

## 23. Pitch

### One sentence

**PatchBench makes AI-generated bug fixes compete against reproducible tests and repository evidence before a developer trusts one.**

### Thirty seconds

AI coding agents can generate a plausible fix in seconds, but developers still carry the risk of deciding whether that fix is actually safe. PatchBench first turns a bug report into a failing regression test, then uses IBM Bob to generate independent repair strategies in isolated Git worktrees. Every candidate runs through the same tests, build, lint, typecheck, and change-surface checks. Instead of trusting the first AI answer, developers get an evidence matrix showing which patches actually fixed the bug and which introduced regressions.

### Closing line

**Don't trust the first patch. Bench it.**
