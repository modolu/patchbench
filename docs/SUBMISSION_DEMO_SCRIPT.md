# PatchBench — demo video script

Target runtime: **~2:40** (hard cap 3:00). Record the public showcase:
**https://patchbench-kappa.vercel.app**. Browser window about 1440×900,
no bookmarks bar, single tab, zoom 100%.

Reference stills: `docs/assets/patchbench-*.png`.

## Accuracy rule (read before recording)

The captured showcase run (`run-20260926073526-aab88e`) was produced with the
deterministic **`FakeBobAdapter`**. Its Git worktrees, test commands, and
verification are real. The **real IBM Bob** reproduction is separate evidence:
task T05 in `bob_sessions/`. Never say or imply that real Bob produced the
showcase candidates. The sidebar shows `Bob adapter: fake`, so don't contradict it.

## Shot list

| Time | Screen | Action | Voiceover |
|---|---|---|---|
| 0:00–0:15 | Title card (or `/new`, static) | None | "AI can write several plausible fixes for one bug in seconds. The hard part is proving which ones are safe." |
| 0:15–0:30 | Title card: **Make AI patches prove themselves.** · *Reproduce before repair.* | None | "PatchBench makes AI patches prove themselves. Rule one: reproduce before repair. No candidate gets written until a regression test fails on the untouched code." |
| 0:30–0:55 | `/new` | Point to the **Showcase mode** panel and the disabled **Start benchmark** button. Click **View captured benchmark →**. | "Locally, you point PatchBench at a repository and describe the defect. This hosted build doesn't execute anyone's code. It serves a sanitized capture of a real benchmark run, so everything you see is read from persisted evidence." |
| 0:55–1:20 | `/runs/run-20260926073526-aab88e` (Live bench), top half | Hover **Bug report**, then the **Reproduction gate** panel (`expected 401, received 500`, `REPRODUCED`). | "The bug: an expired refresh token returns HTTP 500 instead of the documented 401. The regression test fails on the untouched baseline for exactly that reason, 401 expected and 500 received. PatchBench then hashes the test and freezes it." |
| 1:20–1:30 | Cut to `bob_sessions/shipyard_t05_real_reproduction_summary.png` (GitHub or an image viewer, cropped) | None | "We ran this reproduction step with real IBM Bob. Bob found the root cause and wrote the test. PatchBench didn't trust Bob's word: it ran the test itself on the baseline and confirmed the failure." |
| 1:30–1:55 | Live bench, scroll to **Candidate bench** | Point to A, B, and C in turn, then to B's red **Test suite · new failures 11/13 · 2 new** row. | "Three candidates, each in its own worktree from the same commit, each given the identical frozen test. All three fix the reported bug. But candidate B broke two other things." |
| 1:55–2:25 | Click **Evidence matrix** tab | Show the hard-gates rows. Click **Why rejected?** under B. Hold on the rejection box listing the two failures. | "Same frozen regression, same commands, same bench. B catches every refresh failure and returns 401, so a disabled account no longer gets 403 and a token-store outage no longer gets 503. That's two new failures against the baseline, so B is rejected by a hard gate." |
| 2:25–2:40 | Evidence matrix, footer line: *No composite score. No recommendation.* | Optional: click the **Diff** tab on B to show it's still inspectable. | "No opaque score, and no AI-picked winner. A and C both remain eligible. PatchBench gives the developer the evidence, and the developer makes the decision." |

## Recording notes

- Start at `/new` and move through the app by clicking, not by pasting URLs.
  The flow is `/new` → **View captured benchmark** → **Evidence matrix**.
- **Why rejected?** moves the detail pane to B and focuses the rejection box. Wait
  about a second for the scroll before narrating.
- The T05 cutaway can be a static image. Crop out everything except the Bob panel.

## What NOT to show or say

- Don't show a terminal, `.env`, the Vercel dashboard, other browser tabs, or
  desktop notifications.
- Don't type into the `/new` form. It's disabled in showcase mode, and the demo
  shouldn't pretend a hosted run starts.
- Don't claim the hosted app runs repositories, that Bob generated A, B, or C,
  that PatchBench picks a winner, or that it auto-merges.
- Don't claim PR, CI, or multi-language support. Those are roadmap items.
- Don't describe `ELIGIBLE` as "correct" or "safe to merge". It means the
  candidate cleared the configured hard gates.
