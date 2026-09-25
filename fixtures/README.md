# Fixtures

## auth-expiry-bug

Deterministic demo repository for PatchBench. Materialise it as a standalone
Git repository (fixed identity + dates → fixed SHA):

```bash
pnpm fixture:prepare   # → .patchbench/fixture-repos/auth-expiry-bug
```

Re-running the command is the **reset**: it replaces only that directory.

**Known baseline SHA:** `dc1762cc68af9e14586def7887699f074de48784`
(changes whenever any file under `fixtures/auth-expiry-bug/` changes; update this line).

### Hidden explanation (Shipyard only — never pass to Bob)

This file lives outside the fixture directory so it is not part of the
materialised repo Bob investigates.

- **Defect:** `AuthService.refresh` throws `TokenExpiredError` for an expired
  refresh token. `toErrorResponse` (`src/http-errors.ts`) has no mapping for
  it, so it falls through to `500 internal_error` instead of `401`.
- **Adjacent protection:** `test/account-policy.test.ts` pins `403
  account_disabled` and `503 service_unavailable` on the refresh route. An
  over-broad "any refresh failure → 401" fix breaks exactly those two tests.
- Pre-authored fake Bob outputs (regression test + candidates a/b/c) live in
  `tests/fixtures/fake-bob/auth-expiry-bug/`.
