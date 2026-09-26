# Showcase runs

Sanitized, captured PatchBench runs used by the hosted showcase
(`PATCHBENCH_MODE=showcase`) and by UI tests.

- `runs/<run-id>/` is a real deterministic run of `fixtures/auth-expiry-bug`
  with `FakeBobAdapter` (zero Bobcoins): A eligible, B rejected for exactly two
  new test failures, C eligible.
- Regenerate with `pnpm showcase:capture` (requires fixture dependencies:
  `pnpm --dir fixtures/auth-expiry-bug install`).
- Absolute machine paths are rewritten to `<local>/…`; the capture fails if any
  survive. Worktrees are not exported. Command output was secret-redacted by
  the runner before it was persisted.

Showcase mode renders these artifacts only; it cannot execute repositories.
