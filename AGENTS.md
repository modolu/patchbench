# PatchBench — agent guidance

PatchBench (team Shipyard, IBM Bob 2.0 Hackathon, 48-hour build) is a
**local-first** developer tool that makes AI-generated bug fixes compete
against a reproducible regression test and identical verification before a
developer trusts one.

Source of truth (read the relevant section, don't re-derive):
`docs/PATCHBENCH_PRODUCT_BRIEF.md`, `docs/PATCHBENCH_ARCHITECTURE.md`,
`docs/PATCHBENCH_HACKATHON_EXECUTION_PLAN.md`. Do not edit these docs; do not
redesign or broaden the MVP without a concrete implementation blocker.

## Benchmark invariants (never violate)

1. **Reproduce before repair.** A regression test must fail on the untouched
   baseline before any candidate is implemented. If it doesn't, the run is
   `UNVERIFIED`.
2. **Frozen regression artifact.** Once accepted, the test patch is hashed and
   injected unchanged into every candidate. Candidates must never modify or
   delete it; mutation → `REGRESSION_TEST_MUTATED`.
3. **Isolation.** One Git worktree per candidate under
   `.patchbench/worktrees/<run-id>/`, all from the same baseline SHA, on
   branches `patchbench/<run-id>/<candidate-id>`. Candidates never see each
   other's strategies or diffs.
4. **Deterministic evidence.** Hard gates (regression still failing, new test
   failures vs baseline, required build/typecheck failing) reject. Everything
   else is informational. No composite/AI quality score.
5. **Never** auto-merge, push, `git reset --hard` the user's worktree, delete a
   non-`patchbench/` branch, or modify global Git config.

## Architecture boundaries

- `src/domain/` — Zod schemas + types only. No I/O, no React.
- `src/server/runs/` — state machine (explicit transition table), filesystem
  run store (`.patchbench/runs/<id>/run.json` + append-only `events.jsonl`).
- `src/server/runner/` — the only place processes are spawned: argument
  arrays, no shell, mandatory timeout, cwd allow-list, bounded output, secret
  redaction before anything is returned or persisted.
- `src/server/git/` — typed native-git adapter; worktree lifecycle behind
  `WorktreeManager`.
- `src/server/bob/` — `BobAdapter` boundary. `FakeBobAdapter` for tests/dev.
  Bob output is validated with Zod; PatchBench owns the command policy and
  never executes commands proposed by a model.
- UI renders persisted run state; orchestration never lives in React.

## Scope: out for the MVP

Database, auth/accounts, billing, Redis/queues, Docker orchestration, cloud
runners, GitHub OAuth, analytics SDKs, auto PR/merge, non-TypeScript repos.

## Security

- Path mutations must resolve (realpath) beneath repo root, `.patchbench/`, or
  a candidate worktree. IDs must pass `isSafeId`.
- Child env is allow-listed. Never read `.env` into prompts or logs. Never
  commit credentials (including Bob). `.patchbench/` is gitignored.
- Fixture data is synthetic only. Never put the fixture's intended fix in
  anything a real Bob run can read (`fixtures/auth-expiry-bug/` is what Bob sees).

## Commands

```bash
pnpm dev                 # local app
pnpm lint && pnpm typecheck
pnpm test                # vitest unit + integration (fake Bob, zero Bobcoins)
pnpm test:unit | pnpm test:integration
pnpm vitest run <file>   # targeted — prefer this while iterating
pnpm build
pnpm test:e2e            # Playwright; milestone boundaries only
pnpm fixture:prepare     # materialise fixture as git repo (deterministic SHA)
```

## Resource discipline (Bobcoins + context)

- Budget ~40 Bobcoins; keep ≥6 in reserve for final debugging/audit.
- Never call real Bob in automated tests; use `FakeBobAdapter` and
  `tests/fixtures/fake-bob/`. Live Bob only for repository-level reasoning with
  a clear acceptance criterion.
- Don't spend Bob on CSS, copy, naming, or questions the docs already answer.
- Implement only the requested milestone. Targeted tests while iterating;
  full lint/typecheck/test/build at milestone boundaries.
- Don't rewrite files for small changes. No dependency without a concrete MVP need.
- Capture a `bob_sessions/shipyard_tNN_*_summary.png` screenshot after each
  meaningful Bob IDE task.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
