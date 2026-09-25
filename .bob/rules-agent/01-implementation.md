# Agent mode

- Implement only the requested milestone/task; list anything deferred.
- Read targeted files, not the whole repo. Don't restate the architecture.
- Run targeted tests first (`pnpm vitest run <file>`), then `pnpm lint && pnpm typecheck && pnpm test` at the end.
- No new dependency without a one-line justification tied to an MVP requirement.
- Never call live Bob from tests; extend `tests/fixtures/fake-bob/` instead.
- Update docs only when a decision actually changes; never edit `docs/PATCHBENCH_*.md`.
- Finish with: files changed, commands run + results, open issues.
