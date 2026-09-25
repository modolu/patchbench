# PatchBench — Hackathon Execution Plan

**Team:** Shipyard  
**Purpose:** Operational checklist for the 48-hour IBM Bob 2.0 Hackathon.

---

## 1. Locked Product

**PatchBench:** Make AI-generated bug fixes compete against reproducible tests and repository evidence before a developer trusts one.

Do not reopen ideation unless the kickoff introduces a rule that materially conflicts with the product.

---

## 2. MVP Boundary

### Ship

- local TypeScript Git repo support;
- bug report input;
- clean baseline capture;
- Bob-generated failing regression test;
- frozen reproduction artifact;
- 3 independent repair strategies;
- Git worktree isolation;
- Bob-assisted candidate implementation;
- same verification suite for every candidate;
- evidence matrix;
- diff/detail view;
- deterministic fixture;
- hosted captured demo run;
- tests;
- `bob_sessions/` evidence.

### Do not ship during the hackathon

- auth;
- billing;
- team SaaS;
- GitHub OAuth;
- arbitrary cloud code execution;
- automatic PR/merge;
- more languages;
- composite AI score;
- complex analytics.

---

## 3. Bobcoin Plan

Budget: **40 Bobcoins maximum per participant**.

Target: finish core build while leaving **6 coins untouched** until final hardening.

| Task family | Cap |
|---|---:|
| Architecture / initialization | 3 |
| Domain + orchestration | 4 |
| Git isolation | 4 |
| Reproduction | 4 |
| Bob integration | 5 |
| Verification | 4 |
| UI | 3 |
| Fixture/demo | 3 |
| Debugging | 2 |
| Final audit | 2 |
| Reserve | 6 |

Use fake Bob responses for automated tests. Do not burn real Bobcoins in CI/unit tests.

---

## 4. Bob Task Sequence

### T01 — Initialize and sanity-check plan
**Mode:** Plan  
**Deliverable:** implementation plan aligned with `docs/ARCHITECTURE.md`.  
**Evidence:** `bob_sessions/shipyard_t01_plan_summary.png`.

### T02 — Domain model/state machine
**Mode:** Agent  
**Deliverable:** typed states, events, schemas, tests.  
**Evidence:** `shipyard_t02_domain_summary.png`.

### T03 — Git/worktree layer
**Mode:** Agent  
**Deliverable:** safe worktree creation/cleanup + integration tests.  
**Evidence:** `shipyard_t03_git_summary.png`.

### T04 — Baseline/reproduction gate
**Mode:** Agent  
**Deliverable:** command runner, baseline capture, frozen regression hash.  
**Evidence:** `shipyard_t04_reproduction_summary.png`.

### T05 — Bob adapter
**Mode:** Agent  
**Deliverable:** fake adapter + bounded Shell adapter + validated output contracts.  
**Evidence:** `shipyard_t05_bob_adapter_summary.png`.

### T06 — Candidate verification
**Mode:** Agent  
**Deliverable:** shared verification pipeline, baseline subtraction, evidence matrix.  
**Evidence:** `shipyard_t06_verification_summary.png`.

### T07 — Product UI
**Mode:** Agent  
**Deliverable:** new run, live run, evidence matrix, candidate details.  
**Evidence:** `shipyard_t07_ui_summary.png`.

### T08 — Demo fixture
**Mode:** Agent  
**Deliverable:** deterministic auth-expiry defect and adjacent tests.  
**Evidence:** `shipyard_t08_fixture_summary.png`.

### T09 — E2E hardening
**Mode:** Agent  
**Deliverable:** Playwright pass + recovery states.  
**Evidence:** `shipyard_t09_e2e_summary.png`.

### T10 — Final audit
**Mode:** Ask → Agent if fixes needed  
**Deliverable:** security/scope/demo review, final fixes.  
**Evidence:** `shipyard_t10_final_audit_summary.png`.

---

## 5. 48-Hour Build Order

### Hours 0–2
- confirm kickoff rules;
- create repo;
- commit product brief/architecture;
- install/init Bob;
- run `/init`;
- lock fixture defect;
- scaffold UI/test stack.

### Hours 2–8
- state machine;
- filesystem run store;
- command runner;
- Git adapter/worktrees;
- deterministic fixture;
- fake Bob adapter.

**Checkpoint:** a scripted/fake benchmark works end to end without real Bob.

### Hours 8–16
- reproduction gate;
- frozen regression test;
- candidate isolation;
- verification/evidence engine;
- baseline failure subtraction.

**Checkpoint:** controlled candidate patches can be correctly accepted/rejected.

### Hours 16–24
- real Bob adapter;
- bounded prompts;
- strategy generation;
- candidate implementation;
- structured output validation.

**Checkpoint:** one real Bob-backed run works.

### Hours 24–32
- UI polish;
- SSE progress;
- candidate detail/diff;
- error states;
- metrics.

### Hours 32–38
- full fixture demo;
- fix flakiness;
- capture real run artifact;
- deploy showcase mode.

### Hours 38–43
- Playwright;
- README;
- Bob usage documentation;
- `bob_sessions/` audit;
- submission copy.

### Hours 43–48
- video;
- pitch/slides;
- final clean clone test;
- submit early enough to recover from upload/form problems.

---

## 6. Demo Script

### Opening
"AI coding agents can generate a plausible fix in seconds. PatchBench answers the harder question: which fix can we actually trust?"

### Bug
"Expired refresh tokens should return 401. This repository currently returns 500."

### Reproduction
"Before generating any fixes, Bob converts the report into a regression test. PatchBench runs it on the original commit and confirms the defect."

### Candidates
"Bob now explores three independent repair strategies. PatchBench gives each one an isolated Git worktree starting from the exact same SHA."

### Verification
"Every candidate receives the same frozen regression test and the same verification suite."

### Reveal
"All three appear to fix the reported bug, but Candidate B breaks two existing authentication tests. PatchBench rejects it automatically."

### Evidence
"We can inspect the surviving diffs, changed files, build/typecheck results, and exact failure evidence."

### Close
"We didn't trust the first AI patch. We made the patches prove themselves. PatchBench is the verification layer for AI-generated software."

---

## 7. Visual Direction

**Mood:** forensic engineering lab / benchmark console.

**Avoid:** chatbot UI, purple AI gradients, floating assistant orb, dashboard clutter.

**Hero object:** three candidate columns feeding into one evidence matrix.

**Status language:** Pending, Reproduced, Implementing, Verifying, Eligible, Rejected.

**Typography:** clean sans + mono.

**Primary screens:**
1. New Benchmark.
2. Reproduction Proof.
3. Candidate Bench.
4. Evidence Matrix.
5. Candidate Diff.

---

## 8. Submission Checklist

- working local prototype;
- public hosted showcase URL;
- GitHub repository;
- title + short/long description;
- cover image;
- demo video;
- pitch deck;
- technology/category tags;
- `bob_sessions/` with clearly named PNG task summaries;
- README explains Bob usage;
- dataset/data note: synthetic fixture only unless otherwise documented;
- no secrets;
- post-hackathon feedback form completed for participant-reward eligibility.

---

## 9. Kill Criteria

Drop or simplify a feature immediately if it threatens:

1. reproduction gate correctness;
2. worktree isolation;
3. shared verification;
4. evidence matrix;
5. deterministic demo;
6. Bob evidence requirement.

Everything else is negotiable.

---

## 10. Final Standard

A judge should understand PatchBench within 20 seconds and see undeniable evidence within two minutes.

The product should feel less like "AI generated some code" and more like:

> **a disciplined engineering workflow that becomes practical because IBM Bob can investigate, implement, and reason across the repository.**
