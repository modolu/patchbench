# PatchBench — pitch deck outline

8 slides. Each slide gets one idea, one visual, and at most about 25 words on screen.
Speaker notes sit under each slide. Images live in `docs/assets/`.

---

## 1 · PatchBench

**Make AI patches prove themselves.**

- Visual: product wordmark on dark, with a small inset of `patchbench-evidence-matrix.png`
- Footer: Team Shipyard · IBM Bob 2.0 Hackathon · patchbench-kappa.vercel.app

---

## 2 · Problem

**Generation is cheap. Verification is the bottleneck.**

- Visual: three "looks fine ✓" patch cards, with one of them hiding a crack
- One line: *A patch can fix the symptom and quietly break its neighbours.*

> Notes: Reviewers need proof that the bug existed, proof that the fix works,
> and an account of what else changed.

---

## 3 · Product: reproduce before repair

`Bug report → Baseline → Reproduce (gate) → Candidates → Verify → Evidence → Developer`

- Visual: the 5-step pipeline from `/new`, with the **Reproduce** step highlighted
- One line: *No reproduction means no repair. The run stops as `UNVERIFIED`.*

---

## 4 · IBM Bob integration

**Bob proposes evidence. PatchBench decides whether it proves the bug.**

- Visual: `bob_sessions/shipyard_t05_real_reproduction_summary.png` beside the
  **Reproduction gate** panel (`expected 401, received 500 · REPRODUCED`)
- Three beats:
  1. Real IBM Bob (Bob IDE hand-off) inspects the code and writes the regression test
  2. PatchBench validates Bob's output and runs the test on the untouched baseline itself
  3. Only an assertion failure for the expected reason counts, and the test is then frozen

> Notes: Keep this accurate. Real Bob is wired for **reproduction**. The
> captured A/B/C showcase uses the deterministic `FakeBobAdapter`.

---

## 5 · Demo result

| | A | B | C |
|---|---|---|---|
| Frozen regression | ✓ | ✓ | ✓ |
| New failures | 0 | **2** | 0 |
| Verdict | **ELIGIBLE** | **REJECTED** | **ELIGIBLE** |

- Visual: `patchbench-why-rejected.png`
- One line: *B fixed the bug and still failed. Disabled accounts lost their 403 and outages lost their 503.*

---

## 6 · Trust model

Five icons in a row:

- **Immutable baseline**: one SHA for everything
- **Frozen regression**: SHA-256, and any mutation causes rejection
- **Isolated worktrees**: one per candidate, with no shared context
- **Shared verifier**: same commands, timeouts, and environment
- **Evidence matrix**: hard gates reject, everything else is informational

> Notes: No shell, allow-listed environment, secret redaction, no auto-merge and
> no push. The hosted showcase can't execute repositories.

---

## 7 · Who it's for

**Developers and teams already using AI coding agents.**

- Value: turn "the AI says it's fixed" into reviewable evidence
- Value: compare several fixes on equal terms, then pick one yourself
- Visual: `patchbench-live-bench.png`

---

## 8 · Roadmap *(not built yet)*

- Pull-request integration
- CI integration
- More language adapters beyond TypeScript
- Policy profiles for team-specific hard gates
- Real Bob for strategy and candidate implementation

Close with: **patchbench-kappa.vercel.app**. *No score. No AI winner. Evidence, then you decide.*
