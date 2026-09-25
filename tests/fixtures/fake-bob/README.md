# Fake Bob scenarios

See `auth-expiry-bug/README.md` for the main scenario.

## Negative reproduction scenarios

Sibling directories used by the reproduction-gate tests (reproduction only):

- `repro-passes/` — assertion already holds on baseline → `NOT_REPRODUCED`.
- `repro-malformed/` — syntax error, file fails to load → `INVALID_REPRODUCTION`.
- `repro-wrong-reason/` — fails on an unrelated assertion → `INVALID_REPRODUCTION`.
- `repro-touches-src/` — modifies `src/errors.ts` while declaring it a test → `INVALID_REPRODUCTION`.
