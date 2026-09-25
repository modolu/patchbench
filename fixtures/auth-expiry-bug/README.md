# Auth service (PatchBench fixture)

A tiny, framework-free authentication API used as the PatchBench demo
repository. All users, tokens, and credentials are synthetic.

## API contract

| Endpoint | Outcome | Response |
|---|---|---|
| `POST /auth/login` | success | `200` session |
| | wrong credentials | `401 { "error": "invalid_credentials" }` |
| | missing fields | `400 { "error": "invalid_request" }` |
| `POST /auth/refresh` | success | `200` rotated session |
| | unknown / revoked / reused token | `401 { "error": "invalid_token" }` |
| | expired token | `401` |
| | disabled account | `403 { "error": "account_disabled" }` |
| | token store unavailable | `503 { "error": "service_unavailable" }` |
| any | unexpected error | `500 { "error": "internal_error" }` |

## Commands

```bash
pnpm test        # node --test (no install required, Node >= 22.18)
pnpm typecheck   # requires pnpm install
pnpm build
```
