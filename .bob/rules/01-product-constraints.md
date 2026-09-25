# Product constraints

- Never bypass the reproduction gate: no candidate work until a regression test fails on the untouched baseline.
- Never modify, delete, or weaken the frozen regression test during candidate implementation.
- Candidates are isolated: implement exactly one strategy in its own worktree; never read other candidates' diffs.
- Never auto-merge, auto-push, hard-reset the user's worktree, or delete non-`patchbench/` branches.
- Evidence is deterministic: hard gates + informational facts. No composite quality score.
- Out of scope: database, auth, billing, queues, Docker, cloud runners, GitHub OAuth, non-TypeScript repos.
- Details: `AGENTS.md`, `docs/PATCHBENCH_ARCHITECTURE.md` §9–§10.
