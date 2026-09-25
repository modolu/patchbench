# PatchBench

**Make AI patches prove themselves.**

PatchBench is a local-first developer tool that makes AI-generated bug fixes
compete against reproducible tests and repository evidence before a developer
trusts one. Built by Shipyard for the IBM Bob 2.0 Hackathon.

> Reproduce before repair: a regression test must fail on the untouched
> baseline before any candidate fix is written. That test is then frozen and
> used, unchanged, against every candidate.

## Status

Milestones 0–1 (scaffold + deterministic core, no live Bob). See
`docs/PATCHBENCH_ARCHITECTURE.md` §30 for the milestone plan.

## Requirements

- Node.js ≥ 22.18 (native TypeScript for the fixture's `node --test`)
- pnpm 11
- Git

## Setup

```bash
pnpm install
pnpm dev             # http://localhost:3000
```

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test            # unit + integration, fake Bob adapter, zero Bobcoins
pnpm build
pnpm test:e2e        # requires: pnpm exec playwright install chromium
```

## Layout

```text
docs/            source-of-truth product brief, architecture, execution plan
src/domain/      Zod schemas: run, candidate, evidence, events, policy, errors
src/server/      runs (state machine, store), runner, git, bob, …
fixtures/        auth-expiry-bug demo repository (synthetic data)
tests/           unit, integration, e2e, fake Bob scenarios
bob_sessions/    IBM Bob IDE task-summary screenshots
.bob/            Bob project rules
```

## IBM Bob usage

- **Development:** IBM Bob IDE tasks per `docs/PATCHBENCH_HACKATHON_EXECUTION_PLAN.md` §4;
  session summaries in `bob_sessions/`.
- **Product:** Bob sits behind a `BobAdapter` boundary. Tests and local
  development use a deterministic `FakeBobAdapter`; the bounded Bob Shell
  adapter arrives in Milestone 4. No Bob credentials are stored in this repo.

## Data & privacy

- The demo fixture uses synthetic users and tokens only.
- Runtime artifacts (`.patchbench/`) stay local and are gitignored.
- Captured command output is secret-redacted before it is persisted.
